// Worker for leeframes.com (Cloudflare Workers with static assets, see wrangler.jsonc).
// Every page and file is served straight from the assets; only /api/* reaches this code.
//
// POST /api/quote: the Get a quote form (quote.html). Emails the answers and any attached
// files to the studio, reply-to set to the visitor. Sends through the send_email binding
// (EMAIL); without it, through the Email Sending REST API if CF_ACCOUNT_ID and the
// CF_EMAIL_TOKEN secret are set; with neither it answers 503 not_configured.
// The from address must be on a domain onboarded to Cloudflare Email Sending.
//   QUOTE_TO    where requests go,  default hello@leeframes.com
//   QUOTE_FROM  sender,             default quote@leeframes.com

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/quote') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
      return handleQuote(request, env);
    }
    if (pathname.startsWith('/api/')) return json(404, { ok: false, error: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};

const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;   // per file
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // all files; base64 adds a third, the API caps a message at 25 MiB
const ALLOWED_TYPE = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/(pdf|zip|x-zip-compressed)|video\/(mp4|quicktime))$/;
const FIELDS = {
  idea: ['Project idea', 4000, true],
  company: ['Company', 200, true],
  website: ['Website', 300, false],
  deadline: ['Deadline', 200, false],
  name: ['Name', 200, true],
  email: ['Email', 254, true],
  refs: ['References', 2000, false],
  budget: ['Budget', 50, false],
};
const INTERESTS = ['Lookbook', 'Meta ad creatives', 'AI video', 'Media buying'];
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (s) => s.replace(/[\r\n]+/g, ' ').trim(); // nothing typed can add header lines

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function handleQuote(request, env) {
  if (!env.EMAIL && !(env.CF_ACCOUNT_ID && env.CF_EMAIL_TOKEN)) return json(503, { ok: false, error: 'not_configured' });

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }

  // Bots: a hidden field people never see, and a form sent faster than a person could fill it
  if ((form.get('fax') || '') !== '') return json(200, { ok: true });
  const started = Number(form.get('t'));
  if (started && Date.now() - started < 3000) return json(200, { ok: true });

  const v = {};
  const missing = [];
  for (const [key, [label, max, required]] of Object.entries(FIELDS)) {
    const raw = (form.get(key) || '').toString().trim();
    if (raw.length > max) return json(400, { ok: false, error: 'too_long', field: label });
    if (required && !raw) missing.push(label);
    v[key] = raw;
  }
  if (missing.length) return json(400, { ok: false, error: 'missing', fields: missing });
  if (!EMAIL_RE.test(v.email)) return json(400, { ok: false, error: 'bad_email' });
  const interests = form.getAll('interest').map(String).filter((x) => INTERESTS.includes(x));

  const files = form.getAll('files').filter((f) => typeof f === 'object' && f && f.size > 0);
  if (files.length > MAX_FILES) return json(400, { ok: false, error: 'too_many_files', max: MAX_FILES });
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (f.size > MAX_FILE_BYTES) return json(400, { ok: false, error: 'file_too_big', file: f.name });
    if (!ALLOWED_TYPE.test(f.type)) return json(400, { ok: false, error: 'file_type', file: f.name });
  }
  if (total > MAX_TOTAL_BYTES) return json(400, { ok: false, error: 'files_too_big' });
  const attachments = await Promise.all(files.map(async (f) => ({
    content: await f.arrayBuffer(),
    filename: oneLine(f.name).replace(/[\\/]/g, '_').slice(0, 120) || 'file',
    type: f.type,
    disposition: 'attachment',
  })));

  const rows = [
    ['Interested in', interests.join(', ')],
    ['Budget', v.budget],
    ['Company', v.company],
    ['Website', v.website],
    ['Deadline', v.deadline],
    ['Name', v.name],
    ['Email', v.email],
    ['References', v.refs],
    ['Files', files.map((f) => f.name).join(', ')],
  ].filter(([, x]) => x);
  const text = `${v.idea}\n\n${rows.map(([k, x]) => `${k}: ${x}`).join('\n')}\n\nReply to this email to answer ${v.name}.\n`;
  const html = `<p style="font-size:16px;white-space:pre-wrap">${escapeHtml(v.idea)}</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows.map(([k, x]) => `<tr><td style="color:#666;vertical-align:top">${escapeHtml(k)}</td><td>${escapeHtml(x)}</td></tr>`).join('')}</table>
<p style="color:#666;font-size:13px">Reply to this email to answer ${escapeHtml(v.name)}.</p>`;

  const from = env.QUOTE_FROM || 'quote@leeframes.com';
  const to = env.QUOTE_TO || 'hello@leeframes.com';
  const subject = oneLine(`Quote request: ${v.company} (${v.name})`).slice(0, 200);
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({
        from: { email: from, name: 'Leeframes quote form' },
        to,
        replyTo: v.email,
        subject,
        text,
        html,
        ...(attachments.length ? { attachments } : {}),
      });
    } else {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CF_EMAIL_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from, to, reply_to: v.email, subject, text, html,
          ...(attachments.length ? { attachments: attachments.map((a) => ({ ...a, content: toBase64(a.content) })) } : {}),
        }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok || !out || !out.success) throw Object.assign(new Error('rest send failed'), { code: res.status + ' ' + JSON.stringify(out && out.errors) });
    }
  } catch (err) {
    // The reason goes to the Worker's logs; the visitor is asked to email directly
    console.log('quote send failed', err && err.code, err && err.message);
    return json(502, { ok: false, error: 'send_failed' });
  }
  return json(200, { ok: true });
}
