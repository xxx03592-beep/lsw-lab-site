/**
 * Leeframes quote auto-reply (Google Apps Script, runs in the studio Gmail account).
 *
 * Every 5 minutes it looks for new "Quote request:" emails sent by the website form
 * (from quote@leeframes.com), reads the visitor's address from Reply-To, and answers
 * them from Gmail. Handled threads get the label "Quote auto-replied" so nobody is
 * answered twice.
 *
 * Install (once):
 *   1. script.google.com → New project → paste this whole file over the sample code → Save.
 *   2. Choose the function "setup" in the toolbar → Run → allow the permissions it asks for.
 *      That creates the 5-minute timer. Running it again does no harm.
 * Sender: if hello@leeframes.com is added in Gmail → Settings → Accounts →
 * "Send mail as", replies go out from it; otherwise from this Gmail address.
 */

const CONFIG = {
  formSender: 'quote@leeframes.com',     // the website's notification sender (worker.js QUOTE_FROM)
  subjectPrefix: 'Quote request:',
  fromAlias: 'hello@leeframes.com',      // used when set up under "Send mail as"
  replyTo: 'hello@leeframes.com',
  senderName: 'Leeframes Studio',
  label: 'Quote auto-replied',
  lookBack: '3d',                        // only recent requests: never answers old mail on first run
};

/** Run once: creates the 5-minute timer (and removes an older copy of it). */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'replyToNewQuotes')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('replyToNewQuotes').timeBased().everyMinutes(5).create();
  replyToNewQuotes();
}

/** The timer's job: answer every new quote request once. */
function replyToNewQuotes() {
  const label = GmailApp.getUserLabelByName(CONFIG.label) || GmailApp.createLabel(CONFIG.label);
  const query = `from:${CONFIG.formSender} subject:"${CONFIG.subjectPrefix}" -label:"${CONFIG.label}" newer_than:${CONFIG.lookBack}`;
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const useAlias = GmailApp.getAliases().map((a) => a.toLowerCase()).includes(CONFIG.fromAlias.toLowerCase());

  GmailApp.search(query, 0, 50).forEach((thread) => {
    const msg = thread.getMessages()[0];
    const to = extractAddress(msg.getReplyTo());
    // No visitor address, or the request came from the studio itself (tests): just mark it
    if (to && to !== me && to !== CONFIG.fromAlias.toLowerCase() && to !== CONFIG.formSender) {
      const mail = buildReply(parseRequest(msg.getPlainBody()));
      const options = { htmlBody: mail.html, name: CONFIG.senderName, replyTo: CONFIG.replyTo };
      if (useAlias) options.from = CONFIG.fromAlias;
      GmailApp.sendEmail(to, 'Got it — your Leeframes quote request', mail.text, options);
    }
    thread.addLabel(label);
  });
}

/** "Name <a@b.com>" or "a@b.com" → "a@b.com" (lower case), or '' when it isn't an address. */
function extractAddress(raw) {
  const m = String(raw || '').match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/);
  return m ? m[0].toLowerCase() : '';
}

/** Reads the notification written by worker.js: the idea, then "Field: value" lines. */
function parseRequest(body) {
  // The field list comes after the idea, so the last matching line wins
  // (a visitor could type "Deadline: …" inside the idea itself)
  const field = (name) => {
    const all = [...body.matchAll(new RegExp('^' + name + ': (.*)$', 'gm'))];
    return all.length ? all[all.length - 1][1].trim() : '';
  };
  return {
    brand: field('Brand'),
    hasIdea: !/^\s*\(No project idea written/.test(body),
    deadline: field('Deadline'),
    refs: field('References'),
    files: field('Files'),
  };
}

/** Same wording and rules as the website's auto-reply: asks only for what is missing. */
function buildReply(r) {
  const asks = [];
  if (!r.files && !r.refs) asks.push('A product photo or link');
  if (!r.deadline) asks.push('Your ideal timeline');
  if (!r.hasIdea) asks.push('Where the images will run (Feed, Stories, website, etc.)');
  // The brand was typed by the visitor: one carrying a link or running long becomes a plain greeting
  const brand = r.brand.replace(/[\r\n]+/g, ' ').trim();
  const plain = brand && brand.length <= 60 && !/(https?:|www\.|\.[a-z]{2,}\/|[<>])/i.test(brand);
  const paras = [plain ? `Hi ${brand} team,` : 'Hi there,', 'Thanks for reaching out — your request is in.'];
  if (asks.length) {
    paras.push('To get you an accurate quote faster, just reply with:\n' + asks.map((q, i) => `${i + 1}. ${q}`).join('\n'));
    paras.push("No worries if you don't have everything yet. We'll get back to you within 24h either way.");
  } else {
    paras.push("We'll get back to you within 24h.");
  }
  paras.push('— Leeframes Studio\nhello@leeframes.com');
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return {
    text: paras.join('\n\n') + '\n',
    html: paras.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n'),
  };
}
