// Home hero "magnifier field": a grid of tiles (even cells = Meta ads, odd cells = lookbook covers from site-data.js).
// Each tile grows and brightens by how close its centre is to the cursor; on touch screens an invisible cursor
// traces a slow figure-8 instead (off with reduced motion; the mouse effect stays on).
(() => {
  const hero = document.getElementById('hero');
  const field = hero && hero.querySelector('.lf-hero__field');
  const tag = hero && hero.querySelector('.lf-hero__tag');
  if (!field || typeof LOOKBOOK_SETS === 'undefined' || typeof META_COLUMNS === 'undefined') return;

  const DEFAULT_TAG = 'Move the cursor';
  const narrow = matchMedia('(max-width: 760px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const touch = matchMedia('(hover: none)');

  // Meta images taken round-robin across the folders so every product shows up
  const metaPool = [];
  const cols = META_COLUMNS.map((c) => ({ label: c.label, items: c.items.filter((i) => typeof i === 'string') }));
  for (let i = 0; metaPool.length < 40 && i < 40; i++) {
    cols.forEach((c) => { if (c.items[i]) metaPool.push({ src: c.items[i], label: c.label, n: c.items[i].match(/(\d+)\.\w+$/)[1] }); });
  }
  const lookPool = LOOKBOOK_SETS.map((s) => ({
    src: s.cover,
    name: s.title.toLowerCase().startsWith(s.brand.toLowerCase()) ? s.title : s.brand + ' ' + s.title,
  }));

  let tiles = []; // { el, cx, cy, label, z }
  function build() {
    const count = narrow.matches ? 5 * 6 : 12 * 6;
    field.textContent = '';
    tiles = [];
    let m = 0, l = 0;
    for (let i = 0; i < count; i++) {
      const isMeta = i % 2 === 0;
      const d = isMeta ? metaPool[m++ % metaPool.length] : lookPool[l++ % lookPool.length];
      const el = document.createElement('div');
      el.className = 'lf-hero__tile';
      const img = document.createElement('img');
      img.src = d.src;
      img.alt = '';
      img.loading = i < 20 ? 'eager' : 'lazy'; // the first rows show at once
      if (i < 10) img.fetchPriority = 'high';
      img.decoding = 'async';
      el.appendChild(img);
      field.appendChild(el);
      tiles.push({ el, label: isMeta ? `Meta ad · ${d.label} ${d.n}` : `Lookbook · ${d.name}`, k: -1 });
    }
    measure();
  }

  // The hero fills the screen under the announcement bar and nav (styles.css: 100svh - --header-h).
  // script.js fires a resize when the bar is closed, which lands here again
  const announce = document.getElementById('announce');
  const header = document.querySelector('.header');
  function setHeaderH() {
    const h = (announce ? announce.offsetHeight : 0) + (header ? header.offsetHeight : 0);
    document.documentElement.style.setProperty('--header-h', h + 'px');
  }

  // Untransformed tile boxes relative to the section (offset* ignores the scale transform).
  // Tiles under the centre text (label, title, buttons) may only grow to k = 0.5, so the text stays readable
  let width = 1;
  function measure() {
    width = hero.clientWidth || 1;
    const hr = hero.getBoundingClientRect();
    const boxes = [...hero.querySelectorAll('.lf-hero__center > *')].map((el) => el.getBoundingClientRect());
    const tb = {
      left: Math.min(...boxes.map((b) => b.left)) - hr.left, right: Math.max(...boxes.map((b) => b.right)) - hr.left,
      top: Math.min(...boxes.map((b) => b.top)) - hr.top, bottom: Math.max(...boxes.map((b) => b.bottom)) - hr.top,
    };
    tiles.forEach((t) => {
      const x = field.offsetLeft + t.el.offsetLeft, y = field.offsetTop + t.el.offsetTop;
      const w = t.el.offsetWidth, h = t.el.offsetHeight;
      t.cx = x + w / 2;
      t.cy = y + h / 2;
      t.maxK = x < tb.right && x + w > tb.left && y < tb.bottom && y + h > tb.top ? 0.5 : 1;
      t.k = -1; // re-apply on the next frame
    });
  }

  let px = null, py = null, queued = false;
  function apply() {
    queued = false;
    const radius = width * 0.24;
    let best = null, bestD = Infinity;
    tiles.forEach((t) => {
      let k = 0;
      if (px !== null) {
        const dx = (t.cx - px) * 1.6, dy = t.cy - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        k = Math.min(t.maxK, Math.max(0, 1 - dist / radius));
        if (dist < bestD) { bestD = dist; best = t; }
      }
      k = Math.round(k * 1000) / 1000;
      if (k === t.k) return;
      t.k = k;
      const s = t.el.style;
      if (k === 0) { s.transform = s.opacity = s.zIndex = ''; return; }
      s.transform = `scale(${(0.62 + k * 0.88).toFixed(3)})`;
      s.opacity = (0.32 + k * 0.68).toFixed(3);
      s.zIndex = String(1 + Math.round(k * 100));
    });
    const text = best && bestD < radius ? best.label : DEFAULT_TAG;
    if (tag.textContent !== text) tag.textContent = text;
  }
  function point(x, y) {
    px = x; py = y;
    if (!queued) { queued = true; requestAnimationFrame(apply); }
  }

  // Mouse
  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || touch.matches) return;
    const r = hero.getBoundingClientRect();
    point(e.clientX - r.left, e.clientY - r.top);
  });
  hero.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !touch.matches) point(null, null);
  });

  // Touch screens: invisible cursor on a slow figure-8, only while the hero is on screen
  let visible = true, start = performance.now(), raf = 0;
  function loop(now) {
    raf = 0;
    if (!visible || !touch.matches || reduced.matches) return;
    const t = (now - start) / 1000 * 0.35;
    const w = hero.clientWidth, h = hero.clientHeight;
    point(w / 2 + Math.sin(t) * w * 0.36, h / 2 + Math.sin(2 * t) * h * 0.32);
    raf = requestAnimationFrame(loop);
  }
  function startLoop() { if (!raf && visible && touch.matches && !reduced.matches) raf = requestAnimationFrame(loop); }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; startLoop(); }).observe(hero);

  function reset() { point(null, null); startLoop(); }
  [touch, reduced].forEach((q) => q.addEventListener('change', reset));
  narrow.addEventListener('change', () => { build(); reset(); });
  const resize = () => { setHeaderH(); measure(); point(px, py); };
  addEventListener('resize', resize);
  window.addEventListener('load', resize);
  if (document.fonts) document.fonts.ready.then(measure); // the text box depends on the web font
  setHeaderH();
  build();
  startLoop();
})();
