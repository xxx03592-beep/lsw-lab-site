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
//   REPLY_FROM  auto-reply sender and Reply-To, default hello@leeframes.com
//   WORKER_AUTO_REPLY  "on" to send the auto-reply from here (needs Workers Paid + Email Sending)
// After the studio is notified, the visitor gets an automatic reply (best effort: on the
// Workers Free plan Cloudflare only delivers to verified destination addresses, so for
// other visitors it fails quietly and the request still counts as sent).

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
  company: ['Brand', 200, true],
  email: ['Email', 254, true],
  budget: ['Budget', 50, true],
  name: ['Name', 200, false],
  idea: ['Project idea', 4000, false],
  website: ['Website', 300, false],
  deadline: ['Deadline', 200, false],
  refs: ['References', 2000, false],
};
const INTERESTS = ['Lookbook', 'Meta ad creatives'];
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
  const interests = form.getAll('interest').map(String).filter((x) => INTERESTS.includes(x));
  if (!interests.length) missing.unshift('Interested in');
  if (missing.length) return json(400, { ok: false, error: 'missing', fields: missing });
  if (!EMAIL_RE.test(v.email)) return json(400, { ok: false, error: 'bad_email' });

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
    ['Brand', v.company],
    ['Website', v.website],
    ['Deadline', v.deadline],
    ['Name', v.name],
    ['Email', v.email],
    ['References', v.refs],
    ['Files', files.map((f) => f.name).join(', ')],
  ].filter(([, x]) => x);
  const idea = v.idea || '(No project idea written: just say hello back.)';
  const who = v.name || `the ${v.company} team`;
  const text = `${idea}\n\n${rows.map(([k, x]) => `${k}: ${x}`).join('\n')}\n\nReply to this email to answer ${who}.\n`;
  const html = `<p style="font-size:16px;white-space:pre-wrap">${escapeHtml(idea)}</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows.map(([k, x]) => `<tr><td style="color:#666;vertical-align:top">${escapeHtml(k)}</td><td>${escapeHtml(x)}</td></tr>`).join('')}</table>
<p style="color:#666;font-size:13px">Reply to this email to answer ${escapeHtml(who)}.</p>`;

  const from = env.QUOTE_FROM || 'quote@leeframes.com';
  const to = env.QUOTE_TO || 'hello@leeframes.com';
  const subject = oneLine(`Quote request: ${v.company}${v.name ? ` (${v.name})` : ''}`).slice(0, 200);
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
    // Cloudflare's error code (e.g. E_RECIPIENT_PLAN_RESTRICTED) says which setting is missing
    return json(502, { ok: false, error: 'send_failed', code: String((err && err.code) || (err && err.name) || 'unknown').slice(0, 80) });
  }

  // Automatic reply to the visitor, same binding. Off unless WORKER_AUTO_REPLY is "on":
  // on the Workers Free plan it can't reach visitors, so Gmail answers them instead
  // (apps-script/quote-auto-reply.gs). Never turns a delivered request into an error.
  let reply = 'skipped';
  if (env.EMAIL && env.WORKER_AUTO_REPLY === 'on') {
    const mail = autoReply(v, files.length > 0);
    const replyFrom = env.REPLY_FROM || 'hello@leeframes.com';
    try {
      await env.EMAIL.send({
        from: { email: replyFrom, name: 'Leeframes Studio' },
        to: v.email,
        replyTo: replyFrom,
        subject: 'Got it — your Leeframes quote request',
        text: mail.text,
        html: mail.html,
      });
      reply = 'sent';
    } catch (err) {
      console.log('auto-reply failed', err && err.code, err && err.message);
      reply = 'failed:' + String((err && err.code) || 'unknown').slice(0, 60);
    }
  }
  return json(200, { ok: true, reply });
}

// Auto-reply body. Asks only for what the form left out, numbered 1, 2, … in order:
// a photo or link (no files and no references), a timeline (no deadline),
// where the images will run (no project idea). "within 24h" wording matches the website pop-up.
function autoReply(v, hasFiles) {
  const asks = [];
  if (!hasFiles && !v.refs) asks.push('A product photo or link');
  if (!v.deadline) asks.push('Your ideal timeline');
  if (!v.idea) asks.push('Where the images will run (Feed, Stories, website, etc.)');
  // The brand is typed by the visitor and the reply goes to whatever address was typed,
  // so a brand that carries a link or runs long becomes a plain greeting
  const brand = oneLine(v.company);
  const plain = brand.length <= 60 && !/(https?:|www\.|\.[a-z]{2,}\/|[<>])/i.test(brand);
  const paras = [plain ? `Hi ${brand} team,` : 'Hi there,', 'Thanks for reaching out — your request is in.'];
  if (asks.length) {
    paras.push('To get you an accurate quote faster, just reply with:\n' + asks.map((q, i) => `${i + 1}. ${q}`).join('\n'));
    paras.push("No worries if you don't have everything yet. We'll get back to you within 24h either way.");
  } else {
    paras.push("We'll get back to you within 24h.");
  }
  paras.push('— Leeframes Studio\nhello@leeframes.com');
  const text = paras.join('\n\n') + '\n';
  const html = paras.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return { text, html };
}
