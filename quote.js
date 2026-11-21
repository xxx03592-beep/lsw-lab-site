// Get a quote page. The site has no server, so Submit opens the visitor's email app
// with a message to the studio that already holds every answer.
(() => {
const TO = 'hello@leeframes.com';

// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', open);
});

// Required fields: listed under the form until filled in; Submit darkens once all are
const form = document.getElementById('q-form');
const missingEl = document.getElementById('q-missing');
const submit = document.getElementById('q-submit');
const sent = document.getElementById('q-sent');
const required = [...form.querySelectorAll('[data-required]')];
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isFilled = (el) => (el.name === 'email' ? emailOk(el.value.trim()) : el.value.trim() !== '');
let tried = false; // after a first Submit, empty rows are marked too

function check() {
  const missing = required.filter((el) => !isFilled(el));
  missingEl.replaceChildren();
  if (missing.length) {
    missingEl.append('Following fields need to be filled in: ');
    // Built with textContent, so nothing typed can become markup
    missing.forEach((el) => missingEl.append(Object.assign(document.createElement('b'), { textContent: el.dataset.required }), ' '));
  }
  submit.classList.toggle('is-ready', missing.length === 0);
  required.forEach((el) => el.closest('.q-row').classList.toggle('is-missing', tried && !isFilled(el)));
  return missing;
}
form.addEventListener('input', check);
check();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  tried = true;
  const missing = check();
  if (missing.length) { missing[0].focus(); return; }
  const data = new FormData(form);
  const val = (k) => (data.get(k) || '').toString().trim();
  const interests = data.getAll('interest').join(', ');
  const lines = [
    ['Interested in', interests],
    ['Budget', val('budget')],
    ['Company', val('company')],
    ['Website', val('website')],
    ['Deadline', val('deadline')],
    ['Name', val('name')],
    ['Email', val('email')],
    ['References', val('refs')],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const body = `${val('idea')}\n\n${lines.join('\n')}\n`;
  const subject = `Quote request${val('company') ? ' — ' + val('company') : ''}`;
  location.href = `mailto:${TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  sent.hidden = false;
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
