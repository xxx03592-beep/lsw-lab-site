// Announcement bar close; its height is kept in --announce-h so the lookbook slider fits the first screen
const announce = document.getElementById('announce');
const setAnnounceH = () => document.documentElement.style.setProperty('--announce-h', announce.offsetHeight + 'px');
setAnnounceH();
addEventListener('resize', setAnnounceH);
document.querySelector('.announce-close').addEventListener('click', () => {
  announce.classList.add('hidden');
  setAnnounceH();
  dispatchEvent(new Event('resize')); // slider re-measures
});

// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', open);
});
document.querySelectorAll('.nav a').forEach((a) =>
  a.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', false);
  })
);

// Receipts figures, worked out from the date so every visitor sees the same numbers:
// [data-grow] values rise 1% of their base a day, simple interest (ticking up between days);
// Link CTR drifts up and down a little each day around 2.84%, with its multiple of the median
const GROW_FROM = Date.UTC(2026, 9, 29, 5); // 29 Oct 2026, 14:00 Seoul time: the figures as supplied
const BASE_DAY = Date.UTC(2026, 9, 28, 15); // 29 Oct 2026, 00:00 Seoul time: CTR changes at Seoul midnight
const DAILY_GROWTH = 0.01; // share of the base value added per day
const CTR_BASE = 2.84;
const CTR_MEDIAN = 1.64; // e-commerce industry median link CTR, %
const growers = [...document.querySelectorAll('[data-grow]')];
const ctrEl = document.getElementById('ctr');
const ctrNote = document.getElementById('ctr-note');
function tick() {
  const grown = Math.max(0, (Date.now() - GROW_FROM) / 864e5);
  growers.forEach((el) => {
    const n = Math.floor(Number(el.dataset.grow) * (1 + DAILY_GROWTH * grown)).toLocaleString('en-US');
    el.textContent = 'money' in el.dataset ? '$' + n : n;
  });
  // Two slow waves keyed to the Seoul day number: 2.84% on day 0, then roughly 2.71–2.97%
  const d = Math.max(0, Math.floor((Date.now() - BASE_DAY) / 864e5));
  const ctr = CTR_BASE + 0.08 * Math.sin(d * 2.1) + 0.05 * Math.sin(d * 0.7);
  ctrEl.textContent = ctr.toFixed(2) + '%';
  ctrNote.textContent = `About ${(ctr / CTR_MEDIAN).toFixed(1)}× the e-commerce industry median (${CTR_MEDIAN}%)`;
}
tick();
setInterval(tick, 1000);

// Placeholder play buttons toggle state
document.querySelectorAll('.play').forEach((b) =>
  b.addEventListener('click', () => {
    b.classList.toggle('playing');
    b.textContent = b.classList.contains('playing') ? '❚❚' : '▶';
  })
);

// Receipts "As of" label: current month in Seoul time, e.g. "As of October 2026"
const asOf = document.getElementById('as-of');
if (asOf) {
  asOf.textContent = 'As of ' + new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', month: 'long', year: 'numeric' });
}

// Footer clock (Seoul time)
const clock = document.getElementById('clock');
setInterval(() => {
  clock.textContent = 'Seoul, ' + new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Seoul', hour12: false });
}, 1000);

// Reveal sections on scroll
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
  { threshold: 0.1 }
);
document.querySelectorAll('.section .container > *, .stat, .card, .play-step').forEach((el) => {
  el.classList.add('reveal');
  io.observe(el);
});

// Background tint follows scroll: blends between palette stops from top to bottom of the page
// Page background (styles.css --page-bg) at the top, middle and bottom of the page:
// base, then the left / right / top / bottom edge colours. The first stop is sampled from the reference.
const BG_VARS = ['--bg-base', '--bg-l', '--bg-r', '--bg-t', '--bg-b'];
const PALETTE = [
  ['#C6C1D0', '#ECC6D6', '#C6CCF4', '#CBC3F3', '#A1DCEC'], // pink / periwinkle, cyan below
  ['#C7C2CF', '#B4E3D3', '#EEC2DC', '#E3C4EC', '#C3C3F4'], // mint / pink, lavender below
  ['#C4C3D1', '#C2CCF6', '#DBC2F2', '#B8E1D9', '#F0C7D8'], // sky / violet, rose below
];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => 'rgb(' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(',') + ')';
const rootStyle = document.documentElement.style;
let tintQueued = false;
function tint() {
  tintQueued = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  const pos = p * (PALETTE.length - 1);
  const i = Math.min(PALETTE.length - 2, Math.floor(pos));
  const t = pos - i;
  const [from, to] = [PALETTE[i], PALETTE[i + 1]];
  BG_VARS.forEach((name, k) => rootStyle.setProperty(name, mix(from[k], to[k], t)));
}
addEventListener('scroll', () => { if (!tintQueued) { tintQueued = true; requestAnimationFrame(tint); } }, { passive: true });
tint();
