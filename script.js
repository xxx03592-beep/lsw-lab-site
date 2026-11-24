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

// Placeholder play buttons toggle state
document.querySelectorAll('.play').forEach((b) =>
  b.addEventListener('click', () => {
    b.classList.toggle('playing');
    b.textContent = b.classList.contains('playing') ? '❚❚' : '▶';
  })
);

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
  ['#C6C1D0', '#ECC6D6', '#C6CCF4', '#C3B4F4', '#93DCE0'], // first screen: pink / periwinkle sides, purple top, teal bottom
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

// What we make blind cards: photo counts from site-data.js; on touch screens the strips rise once
// when a card is 70% in view and drop again 1.5s after they are all up (a tap still follows the card's link)
const blinds = [...document.querySelectorAll('.lf-blind')];
if (typeof META_COLUMNS !== 'undefined') {
  const ads = META_COLUMNS.reduce((n, c) => n + c.items.length, 0);
  const setCount = (key, text) => document.querySelectorAll(`[data-count="${key}"]`).forEach((el) => (el.textContent = text));
  setCount('meta', `${ads} ads · ${META_COLUMNS.length} formats`);
  setCount('lookbook', `${LOOKBOOK_SETS.length} lookbooks`);
}
if (blinds.length && matchMedia('(hover: none)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    e.target.classList.add('is-open');
    setTimeout(() => e.target.classList.remove('is-open'), 600 + 5 * 45 + 1500);
  }), { threshold: 0.7 });
  blinds.forEach((b) => io.observe(b));
}
