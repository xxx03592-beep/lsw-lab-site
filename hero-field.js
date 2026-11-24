// Home hero "magnifier field": 5 rows of 9:16 tiles, as many columns as fit (Meta ads and lookbook photos from
// site-data.js in a checkerboard), no image shown twice and no grid/collage images. Each tile grows and brightens by how close its centre is to the cursor, at most to the size of
// its own grid cell, so grown tiles never overlap; on touch screens an invisible cursor
// traces a slow figure-8 instead (off with reduced motion; the mouse effect stays on).
(() => {
  const hero = document.getElementById('hero');
  const field = hero && hero.querySelector('.lf-hero__field');
  const tag = hero && hero.querySelector('.lf-hero__tag');
  if (!field || typeof LOOKBOOK_SETS === 'undefined' || typeof META_COLUMNS === 'undefined') return;

  const DEFAULT_TAG = 'Move the cursor';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const touch = matchMedia('(hover: none)');

  // Every image appears once. Meta: round-robin across the folders so every product shows up.
  // Lookbook: photos from inside each set (first, middle, then quarter points), not cover.jpg, because several
  // covers are copies of one of their set's photos and would show up twice
  const metaPool = [];
  const folders = META_COLUMNS.map((c) => ({ label: c.label, items: c.items.filter((i) => typeof i === 'string') }));
  const longest = Math.max(...folders.map((c) => c.items.length));
  for (let i = 0; i < longest; i++) {
    folders.forEach((c) => { if (c.items[i]) metaPool.push({ src: c.items[i], label: c.label, n: c.items[i].match(/(\d+)\.\w+$/)[1] }); });
  }
  // Collage images (several photos in a grid in one file) read as clutter at tile size: never used here.
  // Checked by eye across every Meta and lookbook image; add a path when a new collage is added to site-data.js
  const GRID_IMAGES = new Set([
    'images/lookbook/6a-6a-on-beach/01.jpg', 'images/lookbook/6a-us-local-shoot/01.jpg',
    'images/lookbook/akoihaus-housewear/01.jpg', 'images/lookbook/akoihaus-housewear/06.jpg',
    'images/lookbook/cleartype-rebranding/01.jpg', 'images/lookbook/produktepr-rebranding-1/01.jpg',
    'images/lookbook/produktepr-rebranding-2/01.jpg', 'images/lookbook/yar-multiple/01.jpg',
  ]);
  const lookPool = [];
  const seen = new Set();
  [0, 0.5, 0.25, 0.75].forEach((at) => LOOKBOOK_SETS.forEach((s) => {
    // from this point in the set, the first photo that is neither a collage nor already taken
    for (let i = Math.floor(s.images.length * at); i < s.images.length; i++) {
      const src = s.images[i];
      if (GRID_IMAGES.has(src) || seen.has(src)) continue;
      seen.add(src);
      lookPool.push({ src, name: s.title.toLowerCase().startsWith(s.brand.toLowerCase()) ? s.title : s.brand + ' ' + s.title });
      return;
    }
  }));

  const ROWS = 5;
  let tiles = []; // { el, cx, cy, label, z }
  let cols = 0;
  function build() {
    field.style.setProperty('--cols', cols);
    field.textContent = '';
    tiles = [];
    let m = 0, l = 0;
    for (let i = 0; i < cols * ROWS; i++) {
      const isMeta = (Math.floor(i / cols) + (i % cols)) % 2 === 0; // checkerboard
      const d = isMeta ? metaPool[m++] : lookPool[l++];
      if (!d) break; // out of images: fewer tiles rather than a repeat
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
  // Tile size: the largest 9:16 box that fits one grid cell (that is the tile at scale 1, its biggest)
  let width = 1;
  // Columns: as many 9:16 tiles (at the height 5 rows allow) as fit across, so the side spacing matches the row gap.
  // Returns true when the count changed and the tiles were rebuilt
  function fitColumns() {
    const cs = getComputedStyle(field);
    const gap = parseFloat(cs.columnGap) || 0;
    const ah = field.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const aw = field.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const tw = ((ah - gap * (ROWS - 1)) / ROWS) * 9 / 16;
    const n = Math.max(3, Math.floor((aw + gap) / (tw + gap)));
    if (n === cols) return false;
    cols = n;
    build();
    return true;
  }
  function sizeTiles() {
    const cs = getComputedStyle(field);
    const ncol = cs.gridTemplateColumns.split(' ').length, nrow = cs.gridTemplateRows.split(' ').length;
    const gx = parseFloat(cs.columnGap) || 0, gy = parseFloat(cs.rowGap) || 0;
    const cw = (field.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gx * (ncol - 1)) / ncol;
    const ch = (field.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - gy * (nrow - 1)) / nrow;
    const h = Math.min(ch, cw * 16 / 9);
    field.style.setProperty('--tile-w', (h * 9 / 16).toFixed(2) + 'px');
    field.style.setProperty('--tile-h', h.toFixed(2) + 'px');
  }
  function measure() {
    sizeTiles();
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
      s.transform = `scale(${(0.8 + k * 0.2).toFixed(3)})`; // 1 at most: the tile fills its own cell, no overlap
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
  const resize = () => { setHeaderH(); if (!fitColumns()) measure(); point(px, py); };
  addEventListener('resize', resize);
  window.addEventListener('load', resize);
  if (document.fonts) document.fonts.ready.then(measure); // the text box depends on the web font
  setHeaderH();
  fitColumns();
  startLoop();
})();
