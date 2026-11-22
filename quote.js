// Get a quote page. Submit posts the form to /api/quote (worker.js), which emails it
// with any attached files to hello@leeframes.com.
(() => {
const TO = 'hello@leeframes.com';

// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', open);
});

// Required: Interested in, Budget, Brand, Email (marked data-required in quote.html).
// The Submit button (end of the form) stays disabled until all four are in.
const form = document.getElementById('q-form');
const submits = [...form.querySelectorAll('.q-submit')];
const sent = document.getElementById('q-sent');
const required = [...form.querySelectorAll('[data-required]')];
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// A chip group (fieldset) counts once anything in it is chosen; the budget counts once the
// slider has been touched (its hidden field is empty until then)
const isFilled = (el) => {
  if (el.tagName === 'FIELDSET') return !!el.querySelector('input:checked');
  return el.name === 'email' ? emailOk(el.value.trim()) : el.value.trim() !== '';
};
let sending = false;

function check() {
  const missing = required.filter((el) => !isFilled(el));
  submits.forEach((b) => {
    b.classList.toggle('is-ready', missing.length === 0);
    b.disabled = sending || missing.length > 0;
  });
  return missing;
}
// Budget slider: 1k–10k in 1k steps. The first touch (drag, click, or a key) picks a value
const budget = document.getElementById('q-budget');
const range = document.getElementById('q-budget-range');
const budgetOut = document.getElementById('q-budget-value');
const budgetField = document.getElementById('q-budget-field');
const budgetTicks = [...budget.querySelectorAll('.q-ticks span')];
function showBudget(touched) {
  const k = Number(range.value);
  range.style.setProperty('--fill', touched ? ((k - 1) / 9) * 100 + '%' : '0%');
  budget.classList.toggle('is-untouched', !touched);
  budgetOut.textContent = touched ? `$${k}k` : 'Slide to choose';
  range.setAttribute('aria-valuetext', touched ? `${k} thousand dollars` : 'Not chosen yet');
  budgetField.value = touched ? `$${k}k` : '';
  budgetTicks.forEach((t, i) => t.classList.toggle('is-on', touched && i + 1 === k));
}
const touchBudget = () => { showBudget(true); check(); };
range.addEventListener('input', touchBudget);
range.addEventListener('pointerdown', touchBudget); // choosing 1k needs no movement
range.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') setTimeout(touchBudget); });
form.addEventListener('reset', () => setTimeout(() => { showBudget(false); check(); }));
showBudget(false);

form.addEventListener('input', check);
form.addEventListener('change', check);
check();

// Attached files: kept in our own list (a file input forgets earlier picks) and copied
// back into the input with DataTransfer so FormData sends them
const MAX_FILES = 5, MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 15 * 1024 * 1024;
const fileInput = document.getElementById('q-file');
const fileList = document.getElementById('q-file-list');
let files = [];
const mb = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
function renderFiles(error) {
  fileList.replaceChildren(...files.map((f, i) => {
    const li = document.createElement('li');
    const rm = Object.assign(document.createElement('button'), { type: 'button', textContent: '×' });
    rm.setAttribute('aria-label', 'Remove ' + f.name);
    rm.addEventListener('click', () => { files.splice(i, 1); syncFiles(); renderFiles(); });
    li.append(Object.assign(document.createElement('span'), { textContent: `${f.name} · ${mb(f.size)}` }), rm);
    return li;
  }));
  if (error) fileList.append(Object.assign(document.createElement('li'), { className: 'q-file-error', textContent: error }));
}
function syncFiles() {
  try {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    fileInput.files = dt.files;
  } catch (err) { /* very old browsers: the last pick is what gets sent */ }
}
fileInput.addEventListener('change', () => {
  let error = '';
  for (const f of fileInput.files) {
    const total = files.reduce((n, x) => n + x.size, 0);
    if (files.length >= MAX_FILES) { error = `Up to ${MAX_FILES} files.`; break; }
    if (f.size > MAX_FILE) { error = `${f.name} is over 8 MB.`; continue; }
    if (total + f.size > MAX_TOTAL) { error = 'Files add up to more than 15 MB.'; continue; }
    if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
  }
  syncFiles();
  renderFiles(error);
});

// Bot check: when the form was opened (the server ignores sends faster than a person)
document.getElementById('q-t').value = Date.now();

function say(text, link) {
  sent.replaceChildren(text);
  if (link) sent.append(' ', Object.assign(document.createElement('a'), { href: `mailto:${TO}`, textContent: TO }), '.');
  sent.hidden = false;
  sent.scrollIntoView({ block: 'center', behavior: 'smooth' }); // also when sent from the lower button
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sending || check().length) return;
  const data = new FormData(form); // folded optional fields are included too
  sending = true;
  check();
  submits.forEach((b) => { b.classList.add('is-sending'); b.textContent = 'Sending…'; });
  sent.hidden = true;
  let res = null, out = null;
  try {
    res = await fetch('/api/quote', { method: 'POST', body: data });
    out = await res.json();
  } catch (err) { /* offline, or no function on this host */ }
  sending = false;
  submits.forEach((b) => { b.classList.remove('is-sending'); b.textContent = 'Submit'; });
  check();
  if (out && out.ok) {
    form.reset();
    files = [];
    syncFiles();
    renderFiles();
    document.getElementById('q-t').value = Date.now();
    check();
    sent.hidden = true;
    const done = document.getElementById('q-done');
    if (done && typeof done.showModal === 'function') done.showModal();
    else say("Got it, thank you! Your request is in. We'll get back to you within 24 hours.");
    return;
  }
  if (res && res.status === 400 && out) {
    const why = {
      missing: 'Please fill in: ' + (out.fields || []).join(', ') + '.',
      bad_email: 'That email address does not look right.',
      too_long: `${out.field} is too long.`,
      too_many_files: 'Up to 5 files, please.',
      file_too_big: `${out.file} is over 8 MB.`,
      files_too_big: 'Files add up to more than 15 MB.',
      file_type: `${out.file}: please send images, PDF, ZIP or MP4.`,
    }[out.error];
    if (why) { say(why); return; }
  }
  // Sending failed or isn't set up: keep the answers in the form and offer the address
  say('Sorry, your request could not be sent just now. Please try again in a minute, or write to', true);
});

// Success pop-up: a click on the dimmed area outside it closes it too
const doneBox = document.getElementById('q-done');
if (doneBox) doneBox.addEventListener('click', (e) => {
  const r = doneBox.getBoundingClientRect(); // the box's own padding is the dialog too, so test the position
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) doneBox.close();
});

// Copy the address
const copyBtn = document.getElementById('q-copy');
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyBtn.dataset.copy);
    copyBtn.textContent = 'Copied';
  } catch (err) {
    copyBtn.textContent = 'Select it';
  }
  setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600);
});

// Analog clock on Seoul time, plus the footer's digital one
const ticks = document.querySelector('.q-clock-ticks');
for (let i = 0; i < 12; i++) {
  const a = (i * Math.PI) / 6, r1 = i % 3 ? 41 : 37;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', 50 + Math.sin(a) * r1);
  line.setAttribute('y1', 50 - Math.cos(a) * r1);
  line.setAttribute('x2', 50 + Math.sin(a) * 44);
  line.setAttribute('y2', 50 - Math.cos(a) * 44);
  ticks.append(line);
}
const hands = ['h', 'm', 's'].map((k) => document.getElementById('q-hand-' + k));
const footClock = document.getElementById('clock');
function tick() {
  const [h, m, s] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour12: false }).split(':').map(Number);
  const deg = [((h % 12) + m / 60) * 30, (m + s / 60) * 6, s * 6];
  hands.forEach((el, i) => { el.style.transform = `rotate(${deg[i]}deg)`; });
  footClock.textContent = 'Seoul, ' + new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Seoul', hour12: false });
}
tick();
setInterval(tick, 1000);

// Strip of lookbook covers (twice, so the loop is seamless); each opens the Lookbook page
const track = document.getElementById('q-photos');
if (typeof LOOKBOOK_SETS !== 'undefined') { // a top-level const in site-data.js, not a window property
  const make = (set, i, copy) => {
    const a = Object.assign(document.createElement('a'), { href: 'lookbook.html' });
    a.setAttribute('aria-label', `${set.brand}: ${set.title}`);
    if (copy) { a.tabIndex = -1; a.setAttribute('aria-hidden', 'true'); }
    a.append(Object.assign(document.createElement('img'), { src: set.cover, alt: '', loading: 'lazy', decoding: 'async' }));
    return a;
  };
  track.append(...LOOKBOOK_SETS.map((s, i) => make(s, i, false)), ...LOOKBOOK_SETS.map((s, i) => make(s, i, true)));
}
})();
