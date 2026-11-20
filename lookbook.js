// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
toggle.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  toggle.setAttribute('aria-expanded', open);
});

// Source tiles from META_COLUMNS (site-data.js): one column per source folder,
// kept in a hidden list and cloned into the columns below. A { video } item is a film tile.
const pad2 = (n) => String(n).padStart(2, '0');
const items = [];
META_COLUMNS.forEach((column, col) => {
  column.items.forEach((entry, i) => {
    const video = typeof entry === 'object' ? entry.video : null;
    const src = video || entry;
    const li = document.createElement('li');
    li.dataset.col = col;
    const tile = Object.assign(document.createElement('button'), { className: 'tile' });
    tile.dataset.title = 'No. ' + pad2(i + 1);
    tile.dataset.n = i + 1;                      // position in its folder, for the counter
    tile.dataset.total = column.items.length;   // size of its folder
    tile.dataset.src = src;
    if (video) tile.dataset.film = '';
    const span = (cls, text = '') => Object.assign(document.createElement('span'), { className: cls, textContent: text });
    const img = span('tile-img has-photo');
    if (!video) img.style.backgroundImage = `url("${src}")`; // DOM fallback when WebGL is off
    const cap = span('tile-cap');
    cap.append(span('mono small', column.label), span('tile-name', tile.dataset.title));
    tile.append(img, cap);
    if (video) tile.append(span('tile-badge mono', '▶'));
    li.append(tile);
    document.getElementById('lb-grid').append(li);
    items.push(li);
  });
});
document.getElementById('lb-total').textContent = items.length;

// Columns: each column loops vertically and only moves when scrolled (neighbouring
// columns go opposite ways) or dragged. Hovering a tile shows its name bottom-left;
// clicking it glides it to the column's centre and opens it. Touch can drag them.
const colsEl = document.getElementById('lb-cols');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const AUTO = reduceMotion ? 0 : 10; // px/s slow drift per column when idle (alternate columns opposite ways)
const WHEEL_GAIN = 2.5;             // px/s added per unit of wheel delta
const MAX_SPEED = 4000;             // px/s
let lanes = [];                     // { col, track, setH, offset, dir, vel, snap, tiles, tileH, pitch }
let last = performance.now();
let drag = null, dragged = false;

// Bottom-left category + big title for the current tile, with the Lookbook page's text scramble
const curCat = document.getElementById('lb-cur-cat');
const curTitle = document.getElementById('lb-cur-title');
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*';
let scrambleId = 0, shown = null;
function scramble(text) {
  const id = ++scrambleId;
  if (reduceMotion) { curTitle.textContent = text; return; }
  const start = performance.now();
  const run = (now) => {
    if (id !== scrambleId) return;
    const p = Math.min((now - start) / 450, 1);
    const n = Math.floor(p * text.length);
    curTitle.textContent = text.split('').map((c, i) => (i < n || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    if (p < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}
function showInfo(tile) {
  const key = tile && tile.dataset.src; // titles repeat across folders ("No. 01"), sources don't
  if (!tile || key === shown) return;
  shown = key;
  curCat.textContent = tile.querySelector('.tile-cap .mono').textContent;
  scramble(tile.dataset.title);
  // Counter + gauge: this ad's place in its own folder (e.g. 05 —— 21)
  const n = Number(tile.dataset.n), total = Number(tile.dataset.total);
  posEl.textContent = pad2(n);
  posTotalEl.textContent = pad2(total);
  posFillEl.style.width = (n / total) * 100 + '%';
}
const posEl = document.getElementById('lb-pos');
const posTotalEl = document.getElementById('lb-pos-total');
const posFillEl = document.getElementById('lb-pos-fill');

// Glide a clicked tile to the middle of its column
function centreTile(lane, tile) {
  const r = tile.getBoundingClientRect();
  const c = colsEl.getBoundingClientRect();
  lane.vel = 0; // stop dead so the glide lands exactly
  lane.snap = (c.top + c.height / 2) - (r.top + r.height / 2); // px still to travel
}

function buildStrip() {
  colsEl.innerHTML = '';
  lanes = [];
  const tiles = visibleTiles();
  if (!tiles.length) return;
  showInfo(tiles[0]);
  // One column per source folder, on every screen size (tiles shrink to fit)
  const n = META_COLUMNS.length;
  for (let k = 0; k < n; k++) {
    const list = tiles.map((t, i) => [t, i]).filter(([t]) => Number(t.closest('li').dataset.col) === k);
    if (!list.length) continue;
    const col = document.createElement('div');
    col.className = 'lb-col';
    const track = document.createElement('div');
    track.className = 'lb-col-track';
    col.appendChild(track);
    colsEl.appendChild(col);
    const addSet = () => list.forEach(([t, i]) => {
      const c = t.cloneNode(true);
      c.dataset.index = i;
      track.appendChild(c);
    });
    addSet();
    const setH = track.scrollHeight;
    // Enough copies that one full set can scroll past without a gap
    while (track.scrollHeight < setH + colsEl.clientHeight * 1.5) addSet();
    [...track.children].slice(list.length).forEach((c) => { c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; });
    // Even columns drift up, odd columns down; offsets staggered so rows never line up
    const kids = [...track.children];
    const lane = { col, track, setH, offset: -setH * ((k * 0.37) % 1), dir: k % 2 ? 1 : -1, vel: 0, snap: 0,
      tiles: kids, tileH: kids[0].offsetHeight, pitch: kids.length > 1 ? kids[1].offsetTop - kids[0].offsetTop : kids[0].offsetHeight };
    lane.vel = AUTO * lane.dir;
    lanes.push(lane);
  }
  glBuild();
}

// ---------------------------------------------------------------------------
// WebGL, the vertical twin of the Lookbook gallery (meta.js): tiles are flat
// planes drawn to an offscreen target, then the shared glass-lens pass
// (lens-shader.js) bends them toward the screen edge, refracts the rim, splits
// colour fringes and paints the pastel aura. As in the gallery, tiles lose size
// away from the middle (here width, toward the top and bottom), crop rather than
// squash, slide their picture against the motion, and stretch along the motion
// when a column moves fast. The DOM tiles stay underneath, invisible, for hover
// and clicks. Without WebGL the DOM tiles show with the same width taper.
// ---------------------------------------------------------------------------
const EMPHASIS = 0.28; // tiles at the top/bottom edge lose up to 28% of their width (gallery: height)
const stageEl = colsEl.closest('main');
const TILE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TILE_FRAG = `
uniform sampler2D uTex;
uniform float uCrop;
uniform float uParallax;
uniform vec2 uSize;    // drawn size in px
uniform float uRadius; // corner radius in px
varying vec2 vUv;
float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  // Rounded corners, anti-aliased over about a pixel
  float edge = 1.0 - smoothstep(-1.0, 1.0, roundBox((vUv - 0.5) * uSize, uSize * 0.5, uRadius));
  if (edge <= 0.0) discard;
  // Narrower tiles crop the picture (cover) instead of squashing it; the
  // picture is zoomed 1.08x inside the tile and slides against the motion
  vec2 uv = vec2((vUv.x - 0.5) * uCrop, vUv.y - 0.5) / 1.08 + 0.5 + vec2(0.0, uParallax * 0.04);
  gl_FragColor = vec4(texture2D(uTex, uv).rgb, edge);
}`;

// 1 through the middle of the screen, easing to 0 only in the last stretch
// before the top/bottom edge, so tiles narrow as they leave rather than all the way
const EDGE_ZONE = 0.775; // |ny| beyond which tiles start to narrow
function emphasisAt(ny) {
  const v = 1 - Math.min(Math.max((Math.abs(ny) - EDGE_ZONE) / (1 - EDGE_ZONE), 0), 1);
  return v * v * (3 - 2 * v);
}
const widthAt = (ny) => 1 - EMPHASIS * (1 - emphasisAt(ny));

const gl = initGL();
const textures = new Map();
let energy = 0; // 0..1 from the fastest column, drives the lens like the gallery's scroll speed

function initGL() {
  if (!window.THREE || typeof LENS_FRAG === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'lb-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stageEl.prepend(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    canvas.remove();
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  const camera = new THREE.PerspectiveCamera(12, 1, 1, 50000); // long lens, flat tiles
  const target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
  const c = (v) => new THREE.Color(v);
  const lens = new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    depthTest: false,
    uniforms: {
      tScene: { value: target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uCalm: { value: -1 }, // no flat centre strip here: full bend everywhere
      uBend: { value: -1 }, // same pull as the gallery
      uRimMode: { value: 1 }, // lens only at the top and bottom, where tiles leave the screen
      uBand: { value: 0.08 }, // thin band: the middle stays straight, tiles bend only as they leave
      uBase: { value: c('#CBC6D0') },
      uGlowA: { value: c('#F3B3CF') },
      uGlowB: { value: c('#9FE3CF') },
      uGlowC: { value: c('#A9C2F2') },
      uGlowD: { value: c('#D3BAF4') },
      uSideL: { value: c('#8FE3C4') }, uSideL2: { value: c('#A9C8F5') }, // left edge: mint ↔ sky
      uSideR: { value: c('#F2A9D2') }, uSideR2: { value: c('#C7A6F6') }, // right edge: pink ↔ violet
    },
  });
  const post = new THREE.Scene();
  post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lens));
  document.body.classList.add('lb-gl');
  return { renderer, camera, scene: new THREE.Scene(), target, lens, post, postCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), dpr, meshes: [], geometry: null, start: performance.now() };
}

// Tile artwork: the ad image itself (cover-fit, no caption on top), or a film's
// first frame with a play badge. Drawn grey first, then redrawn once it loads.
function makeTexture(tile) {
  const key = tile.dataset.src;
  if (textures.has(key)) return textures.get(key);
  const cv = document.createElement('canvas');
  cv.width = 384; // tiles are ~150px wide, so 2x+ is plenty
  cv.height = 683;
  const g = cv.getContext('2d');
  g.fillStyle = '#b9b3c0';
  g.fillRect(0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const paint = (pic, pw, ph) => {
    const s = Math.max(cv.width / pw, cv.height / ph);
    g.drawImage(pic, (cv.width - pw * s) / 2, (cv.height - ph * s) / 2, pw * s, ph * s);
    if ('film' in tile.dataset) {
      g.fillStyle = 'rgba(16,18,20,.5)';
      g.beginPath();
      g.arc(cv.width - 52, 52, 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '500 26px "Abcwhytemono", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('▶', cv.width - 50, 53);
    }
    tex.needsUpdate = true;
  };
  if ('film' in tile.dataset) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = key;
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(0.5, v.duration / 2 || 0); }, { once: true });
    v.addEventListener('seeked', () => paint(v, v.videoWidth, v.videoHeight), { once: true });
  } else {
    const img = new Image();
    img.onload = () => paint(img, img.naturalWidth, img.naturalHeight);
    img.src = key;
  }
  textures.set(key, tex);
  return tex;
}

function glBuild() {
  if (!gl || !lanes.length) return;
  const { renderer, camera, scene, target, lens, dpr } = gl;
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  renderer.setSize(w, h, false);
  target.setSize(Math.round(w * dpr), Math.round(h * dpr));
  lens.uniforms.uRes.value.set(w, h);
  camera.aspect = w / h;
  camera.position.z = h / 2 / Math.tan((6 * Math.PI) / 180); // 1 unit = 1 px at z = 0
  camera.far = camera.position.z * 2;
  camera.updateProjectionMatrix();
  gl.meshes.forEach((m) => { scene.remove(m); m.material.dispose(); });
  if (gl.geometry) gl.geometry.dispose();
  const first = lanes[0].tiles[0];
  gl.tileW = first.offsetWidth;
  gl.geometry = new THREE.PlaneGeometry(gl.tileW, lanes[0].tileH);
  gl.meshes = [];
  const sr = stageEl.getBoundingClientRect();
  const cr = colsEl.getBoundingClientRect();
  lanes.forEach((lane) => {
    const r = lane.col.getBoundingClientRect();
    lane.cx = r.left + r.width / 2 - sr.left; // column centre, stage px
    lane.top = cr.top - sr.top;               // track top, stage px
    lane.meshes = lane.tiles.map((el) => {
      const src = items[Number(el.dataset.index)].querySelector('.tile');
      const mat = new THREE.ShaderMaterial({
        vertexShader: TILE_VERT,
        fragmentShader: TILE_FRAG,
        transparent: true,
        depthTest: false,
        uniforms: { uTex: { value: makeTexture(src) }, uCrop: { value: 1 }, uParallax: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) }, uRadius: { value: innerWidth < 760 ? 6 : 10 } },
      });
      const mesh = new THREE.Mesh(gl.geometry, mat);
      scene.add(mesh);
      gl.meshes.push(mesh);
      return mesh;
    });
  });
}

// Per frame: taper each tile by its distance from the middle (DOM and GL alike),
// place the GL planes, then run the lens pass
function placeTiles(now, dt) {
  const h = stageEl.clientHeight;
  const half = h / 2;
  let fastest = 0;
  lanes.forEach((lane) => { fastest = Math.max(fastest, Math.abs(lane.vel)); });
  const raw = reduceMotion ? 0 : Math.pow(Math.min(fastest / 2600, 1), 0.75);
  energy += (raw - energy) * (1 - Math.exp(-(raw > energy ? 8 : 6) * dt));
  lanes.forEach((lane) => {
    const laneEnergy = reduceMotion ? 0 : Math.pow(Math.min(Math.abs(lane.vel) / 2600, 1), 0.75);
    const stretch = 1 + 0.1 * laneEnergy; // slight stretch along the motion with speed
    const top = lane.top ?? 0;
    lane.tiles.forEach((el, j) => {
      const cy = top + lane.offset + j * lane.pitch + lane.tileH / 2; // tile centre, stage px
      const visible = cy > -lane.tileH && cy < h + lane.tileH;
      const ny = (cy - half) / half; // -1 top edge, 0 middle, 1 bottom edge
      const s = widthAt(ny);
      if (visible) el.style.transform = `scaleX(${s.toFixed(3)})`;
      if (!gl || !lane.meshes) return;
      const mesh = lane.meshes[j];
      mesh.visible = visible;
      if (!visible) return;
      // Narrowed tiles stay centred on their column
      mesh.position.set(lane.cx - stageEl.clientWidth / 2, half - cy, 0);
      mesh.scale.set(s, stretch, 1);
      mesh.material.uniforms.uCrop.value = s;
      mesh.material.uniforms.uSize.value.set(gl.tileW * s, lane.tileH * stretch); // drawn size, so the corner radius stays round
      mesh.material.uniforms.uParallax.value = Math.max(-1.2, Math.min(1.2, ny));
    });
  });
  if (!gl) return;
  const { renderer, lens } = gl;
  lens.uniforms.uTime.value = reduceMotion ? 0 : (now - gl.start) / 1000;
  lens.uniforms.uEnergy.value = energy;
  renderer.setRenderTarget(gl.target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(gl.scene, gl.camera);
  renderer.setRenderTarget(null);
  renderer.render(gl.post, gl.postCam);
}

function frameLoop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  lanes.forEach((lane) => {
    if (!drag) {
      const target = AUTO * lane.dir;
      lane.vel += (target - lane.vel) * Math.min(1, dt * (Math.abs(lane.vel) > AUTO * 2 ? 2.5 : 6)); // wheel flings coast longer
      lane.offset += lane.vel * dt;
      if (lane.snap) {
        const step = Math.abs(lane.snap) < 0.5 ? lane.snap : lane.snap * (1 - Math.exp(-9 * dt));
        lane.offset += step;
        lane.snap -= step;
      }
    }
    lane.offset = ((lane.offset % lane.setH) - lane.setH) % lane.setH; // keep in (-setH, 0]
    lane.track.style.transform = `translate3d(0, ${lane.offset}px, 0)`;
  });
  placeTiles(now, dt);
  // Bottom-left info follows the tile under a resting mouse (re-checked each
  // frame, since tiles slide under it while scrolling); nothing moves on hover
  if (mouseAt && !drag) showInfo(document.elementFromPoint(mouseAt.x, mouseAt.y)?.closest('#lb-cols .tile'));
  requestAnimationFrame(frameLoop);
}

let mouseAt = null; // where the mouse rests over the columns, null when away
colsEl.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouseAt = { x: e.clientX, y: e.clientY }; });
colsEl.addEventListener('pointerleave', () => { mouseAt = null; });

colsEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  drag = { y: e.clientY, start: lanes.map((l) => l.offset) };
  dragged = false;
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 6) dragged = true;
  lanes.forEach((l, k) => { l.offset = drag.start[k] + dy; });
});
window.addEventListener('pointerup', () => { drag = null; });

// Wheel: scrolling down speeds each column along its own direction, up reverses them
window.addEventListener('wheel', (e) => {
  if (!box.hidden) return;
  e.preventDefault();
  const d = (e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * WHEEL_GAIN;
  lanes.forEach((l) => {
    l.snap = 0;
    l.vel = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, l.vel + d * l.dir));
  });
}, { passive: false });

// Click: the tile glides to the middle of its column and its viewer opens at the same time
colsEl.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t || dragged) return;
  const lane = lanes.find((l) => l.col.contains(t));
  if (lane) centreTile(lane, t);
  open(Number(t.dataset.index));
});
window.addEventListener('resize', buildStrip);

// Lightbox: steps through the tiles currently visible
const box = document.getElementById('lightbox');
const frame = document.getElementById('lb-frame');
const playIcon = frame.querySelector('.play-icon');
const nameEl = document.getElementById('lb-name');
const countEl = document.getElementById('lb-count');
let current = 0;

const visibleTiles = () => items.filter((li) => !li.classList.contains('is-hidden')).map((li) => li.querySelector('.tile'));

// The viewer shows the ad whole (image, or the film playing); the arrows step
// through the ads of the same folder / column
const boxImg = Object.assign(document.createElement('img'), { className: 'lb-media', alt: '' });
const boxVideo = Object.assign(document.createElement('video'), { className: 'lb-media', controls: true, loop: true, playsInline: true });
frame.append(boxImg, boxVideo);
frame.classList.add('has-media');
playIcon.hidden = true;
let boxCol = 0;
function show(i) {
  const tiles = visibleTiles();
  const t = tiles[(i + tiles.length) % tiles.length];
  boxCol = Number(t.closest('li').dataset.col);
  const group = tiles.filter((x) => Number(x.closest('li').dataset.col) === boxCol);
  const at = group.indexOf(t);
  current = tiles.indexOf(t);
  const film = 'film' in t.dataset;
  boxImg.hidden = film;
  boxVideo.hidden = !film;
  if (film) {
    boxVideo.src = t.dataset.src;
    boxVideo.play().catch(() => {});
  } else {
    boxVideo.pause();
    boxVideo.removeAttribute('src');
    boxImg.src = t.dataset.src;
    boxImg.alt = `${META_COLUMNS[boxCol].label} ${t.dataset.title}`;
  }
  nameEl.textContent = `${META_COLUMNS[boxCol].label} · ${t.dataset.title}`;
  countEl.textContent = `${pad2(at + 1)} / ${pad2(group.length)}`;
}
// Step within the open ad's folder, wrapping round
function stepBox(d) {
  const tiles = visibleTiles();
  const group = tiles.filter((x) => Number(x.closest('li').dataset.col) === boxCol);
  const at = group.indexOf(tiles[current]);
  show(tiles.indexOf(group[(at + d + group.length) % group.length]));
}
function open(i) { show(i); box.hidden = false; document.body.style.overflow = 'hidden'; }
function close() {
  box.hidden = true;
  document.body.style.overflow = '';
  boxVideo.pause();
  boxVideo.removeAttribute('src');
  boxVideo.load();
}

buildStrip();
requestAnimationFrame(frameLoop);

// Opened from a home-page tile (?col=<folder>&n=<1-based position>): glide that tile
// to the middle of its column and open its viewer
const startQ = new URLSearchParams(location.search);
if (startQ.has('col')) {
  const start = visibleTiles().findIndex((t) => t.closest('li').dataset.col === startQ.get('col') && t.dataset.n === startQ.get('n'));
  if (start >= 0) {
    const lane = lanes.find((l) => l.col === colsEl.children[Number(startQ.get('col'))]);
    if (lane) {
      // The first frame has not placed the column yet; do it now so the tile's position reads true,
      // then glide the copy of the tile nearest the middle
      lane.track.style.transform = `translate3d(0, ${lane.offset}px, 0)`;
      const mid = colsEl.getBoundingClientRect();
      const dist = (t) => { const r = t.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - (mid.top + mid.height / 2)); };
      const tile = lane.tiles.filter((t) => Number(t.dataset.index) === start).sort((a, b) => dist(a) - dist(b))[0];
      if (tile) centreTile(lane, tile);
    }
    open(start);
  }
}

box.querySelector('.lb-close').addEventListener('click', close);
box.querySelector('.lb-prev').addEventListener('click', () => stepBox(-1));
box.querySelector('.lb-next').addEventListener('click', () => stepBox(1));
box.addEventListener('click', (e) => e.target === box && close());
document.addEventListener('keydown', (e) => {
  if (box.hidden) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') stepBox(-1);
  if (e.key === 'ArrowRight') stepBox(1);
});

