// Announcement bar close
document.querySelector('.announce-close').addEventListener('click', () => {
  document.getElementById('announce').classList.add('hidden');
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

// Exhibit B tiles from site-data.js: every Lookbook project (opens meta-ad-creatives.html)
// alternating with Meta ads, the first two of each folder (open lookbook.html). Each link
// names the item so that page opens its viewer on it.
const adGroup = document.querySelector('.ad-group');
if (adGroup && typeof LOOKBOOK_SETS !== 'undefined') {
  const span = (cls, text = '') => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  const tile = ({ href, img, kind, sub, name, badge }) => {
    const a = Object.assign(document.createElement('a'), { href, className: 'ad-tile' });
    const pic = span('ad-img');
    pic.style.backgroundImage = `url("${img}")`;
    const cap = span('ad-cap');
    cap.append(span('mono small', `${kind} · ${sub}`), span('ad-name', name));
    a.append(pic, span('ad-kind mono', kind));
    if (badge) a.append(span('ad-badge mono', badge));
    a.append(cap);
    a.setAttribute('aria-label', `${kind}: ${sub} ${name}`);
    return a;
  };
  const looks = LOOKBOOK_SETS.map((set, i) => tile({
    href: `meta-ad-creatives.html?open=${i}`, img: set.cover, kind: 'Lookbook',
    sub: set.brand, name: set.title, badge: '▦ ' + set.images.length,
  }));
  const metas = [];
  for (let n = 0; n < 2; n++) META_COLUMNS.forEach((col, c) => {
    const src = col.items[n];
    if (typeof src === 'string') metas.push(tile({
      href: `lookbook.html?col=${c}&n=${n + 1}`, img: src, kind: 'Meta Ad',
      sub: col.label, name: 'No. ' + String(n + 1).padStart(2, '0'),
    }));
  });
  for (let i = 0; i < Math.max(looks.length, metas.length); i++) {
    if (looks[i]) adGroup.append(looks[i]);
    if (metas[i]) adGroup.append(metas[i]);
  }
}

// Exhibit B marquee: duplicate the tile group so translateX(-50%) loops seamlessly
const adTrack = document.querySelector('.ad-track');
if (adTrack) {
  const clone = adTrack.firstElementChild.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
  adTrack.appendChild(clone);
}

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
const PALETTE = [
  { bg: '#D8D4E0', aura: ['#BCC4F6', '#AEEBD6', '#C2ACF4', '#F6BCDD', '#D9A6F3'] }, // lavender / mint
  { bg: '#E0D6DE', aura: ['#F6BCDD', '#C9C2F7', '#B4E6DA', '#F7D3B6', '#E1AEEB'] }, // rose / peach
  { bg: '#D4DCE2', aura: ['#AEE3EB', '#C2ACF4', '#F3C2E2', '#B9CDF7', '#B6EBC9'] }, // sky / sea-green
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
  rootStyle.setProperty('--bg', mix(from.bg, to.bg, t));
  from.aura.forEach((c, k) => rootStyle.setProperty('--aura-' + (k + 1), mix(c, to.aura[k], t)));
}
addEventListener('scroll', () => { if (!tintQueued) { tintQueued = true; requestAnimationFrame(tint); } }, { passive: true });
tint();
