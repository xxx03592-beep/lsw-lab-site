// Own scope: on the home page this runs next to script.js
(() => {
const stage = document.getElementById('mc-stage');
// Embedded at the top of the home page: the page keeps its vertical scroll, the nav belongs to script.js
const embedded = stage.classList.contains('mc-embed');

// Mobile nav toggle
if (!embedded) {
  const toggle = document.querySelector('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', open);
  });
}

// Cards from site-data.js: one per project; its images open in the viewer
const ADS = LOOKBOOK_SETS.map((set) => ({ cat: set.brand.toLowerCase(), label: set.brand, title: set.title, count: set.images.length, images: set.images, cover: set.cover }));

const track = document.getElementById('mc-track');
const titleEl = document.getElementById('mc-title');
const catEl = document.getElementById('mc-cat');
const indexEl = document.getElementById('mc-index');
const countEl = document.getElementById('mc-count');
const totalEl = document.getElementById('mc-total');
const fillEl = document.getElementById('mc-fill');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Motion and layout tuning. Card proportions follow the reference (exp.fiddle.digital
// at 1440×900): 266×400 cards (2:3), 9px apart, top edge 21.6% down the screen.
const EMPHASIS = 0.17;   // cards away from the centre lose up to 17% of their height
const ASPECT = 2 / 3;    // card width / height
let rowLift = 0;         // row centre sits this far above the stage centre, px
const FRICTION = 6;      // velocity decay per second
const WHEEL_GAIN = 7;    // px/s added per unit of wheel delta (was 16, then 11; lowered for a calmer scroll)
const MAX_SPEED = 9000;  // px/s
const SETTLE_SPEED = 140; // below this the row eases onto the nearest card
const DRIFT = 18;        // px/s the row creeps left once it has come to rest (none with reduced motion or the viewer open)

let items = [];  // the cards' ads, in order
let cards = [];  // DOM cards; the list is repeated so the row always loops past both edges
let cardW = 0;
let cardH = 0;
let stride = 0;  // card width + gap, in layout space
let half = 0;    // half the stage width
let pos = 0;     // scroll position, px
let vel = 0;     // px/s
let settle = null;
let resting = false; // parked after an input: the slow drift runs
let driftV = 0;      // current drift speed, px/s
let energy = 0;  // 0..1, drives the lens and stretch
let dragging = false;
let active = -1;

// Emphasis: 1 at the centre, easing to 0 at the stage edge. As in the
// reference, cards keep their width and only lose height, hanging from a
// shared top line, so the row tapers toward both edges.
function emphasisAt(x) {
  const v = 1 - Math.min(Math.abs(x) / half, 1);
  return v * v * (3 - 2 * v);
}
const heightAt = (x) => 1 - EMPHASIS * (1 - emphasisAt(x));

function measure() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const mobile = w < 760;
  cardH = mobile ? Math.min((w * 0.72) / ASPECT, h * 0.5) : Math.min(h * 0.444, (w * 0.185) / ASPECT);
  cardW = Math.round(cardH * ASPECT);
  cardH = Math.round(cardH);
  stride = cardW + (mobile ? 8 : 9);
  half = w / 2;
  rowLift = h / 2 - (h * (mobile ? 0.22 : 0.216) + cardH / 2);
  stage.style.setProperty('--card-h', cardH + 'px');
  stage.style.setProperty('--card-w', cardW + 'px');
  stage.style.setProperty('--row-lift', rowLift + 'px');
}

// Build the cards
function build() {
  items = ADS.slice();
  measure();
  const need = Math.ceil((stage.clientWidth * 2.4) / stride);
  const loop = [];
  while (loop.length < need) loop.push(...items.map((ad, i) => ({ ad, i })));
  track.innerHTML = '';
  cards = loop.map(({ ad, i }) => {
    const el = document.createElement('button');
    el.className = 'mc-card';
    el.dataset.i = i;
    el.setAttribute('aria-label', ad.title);
    // Built with textContent, not innerHTML, so ad data can never be parsed as markup
    const span = (cls, text = '') => Object.assign(document.createElement('span'), { className: cls, textContent: text });
    const img = span('tile-img');
    if (ad.cover) img.style.backgroundImage = `url("${ad.cover}")`; // DOM fallback when WebGL is off
    img.classList.add('has-photo');
    el.append(img, span('tile-badge mono', '▦ ' + ad.count));
    track.appendChild(el);
    return el;
  });
  totalEl.textContent = items.length;
  countEl.textContent = pad(items.length);
  pos = vel = 0;
  settle = null;
  active = -1;
  shown = -1; // refresh the bottom-left info after a rebuild
  if (gl) glBuild();
}

// Text scramble when the active card changes
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*';
let scrambleId = 0;
function scramble(text) {
  const id = ++scrambleId;
  if (reduceMotion) { titleEl.textContent = text; return; }
  const start = performance.now();
  const run = (now) => {
    if (id !== scrambleId) return;
    const p = Math.min((now - start) / 450, 1);
    const shown = Math.floor(p * text.length);
    titleEl.textContent = text.split('').map((c, i) => (i < shown || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    if (p < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

// Bottom-left category / title / progress: the hovered card if the mouse is over
// one, otherwise the centred card
let shown = -1;
function showInfo(i) {
  if (i === shown) return;
  shown = i;
  const ad = items[i];
  catEl.textContent = ad.label;
  scramble(ad.title);
  indexEl.textContent = pad(i + 1);
  fillEl.style.width = ((i + 1) / items.length) * 100 + '%';
}

// Wrap a layout position into [-total/2, total/2)
function wrapped(k) {
  const total = cards.length * stride;
  const x = k * stride - pos;
  return ((((x + total / 2) % total) + total) % total) - total / 2;
}

// ---------------------------------------------------------------------------
// WebGL. The cards are flat planes; the bending comes from a full-screen
// "glass lens" pass applied afterwards: the middle of the screen stays clean,
// toward the edges the picture is pulled inward (barrel distortion), refracted
// along the edge and split into colour fringes. Faster scrolling = stronger lens.
// An animated colour aura fills the background. Without WebGL the DOM cards show.
// ---------------------------------------------------------------------------
const CARD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CARD_FRAG = `
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uRadius;
uniform float uParallax;
uniform float uCrop;
varying vec2 vUv;
float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = roundBox((vUv - 0.5) * uSize, uSize * 0.5, uRadius);
  float edge = 1.0 - smoothstep(-1.0, 1.0, d);
  if (edge <= 0.0) discard;
  // Shorter cards crop the picture (cover) rather than squash it; the picture
  // is zoomed 1.2x inside the card and slides against the scroll
  vec2 uv = vec2(vUv.x - 0.5, (vUv.y - 0.5) * uCrop) / 1.2 + 0.5 + vec2(uParallax * 0.07, 0.0);
  gl_FragColor = vec4(texture2D(uTex, uv).rgb, edge);
}`;
// LENS_VERT / LENS_FRAG live in lens-shader.js (shared with the Meta Ad Creatives page)


const gl = initGL();
const textures = new Map();

function initGL() {
  if (!window.THREE) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('mc-canvas'), antialias: true, alpha: true });
  } catch (err) {
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  // Long lens (12°) so the cards look flat, like the reference
  const camera = new THREE.PerspectiveCamera(12, 1, 1, 50000);
  const target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
  const lens = new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    depthTest: false,
    uniforms: {
      tScene: { value: target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uCalm: { value: 0.12 },
      uBend: { value: -1 }, // pull in: cards bulge toward the viewer
      uRimMode: { value: 0 }, // lens along the whole screen edge
      uBand: { value: 0.34 },
      uBgL: { value: new THREE.Color() }, uBgC: { value: new THREE.Color() }, uBgR: { value: new THREE.Color() },
    },
  });
  const post = new THREE.Scene();
  post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lens));
  stage.classList.add('gl-on');
  return { renderer, camera, scene: new THREE.Scene(), target, lens, post, postCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), dpr, meshes: [], labels: [], geometry: null, labelGeometry: null };
}

// Small mono title that sits on each card's top-left edge
const LABEL_H = 22;
function makeLabel(ad) {
  const key = 'label:' + ad.title + ':' + cardW;
  if (textures.has(key)) return textures.get(key);
  const c = document.createElement('canvas');
  c.width = cardW * 2;
  c.height = LABEL_H * 2;
  const g = c.getContext('2d');
  g.font = '400 22px "KHTekaMono", monospace';
  if ('letterSpacing' in g) g.letterSpacing = '1px';
  g.fillStyle = 'rgba(16,18,20,.72)';
  g.textBaseline = 'middle';
  g.fillText(ad.title.toUpperCase(), 0, LABEL_H);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  textures.set(key, tex);
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Draw a picture into the canvas like CSS object-fit: cover
function drawCover(g, src, sw, sh, w, h) {
  const s = Math.max(w / sw, h / sh);
  g.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
}

// Card artwork: the project's thumbnail with the image-count badge on top.
// Drawn grey first, then redrawn once the picture loads.
function makeTexture(ad) {
  const key = ad.cover + ':' + cardH; // by image (two projects share the title "Multiple"); badge size depends on card height
  if (textures.has(key)) return textures.get(key);
  const c = document.createElement('canvas');
  c.width = 640; // 2:3, same as the card
  c.height = 960;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  // Badge sits inside the 1.2x zoom crop (visible texels: x 53..587, y 80..880).
  // k keeps it the same on-screen size as on the original 373px-tall card,
  // however large the card is drawn.
  const k = 373 / (cardH || 373);
  const paint = (pic, pw, ph) => {
    g.fillStyle = '#b9b3c0';
    g.fillRect(0, 0, c.width, c.height);
    if (pic) {
      // Thumbnail shown whole (no crop): a blurred copy fills the card, the sharp
      // picture is fitted inside the part of the texture the card shows when it
      // stands at full height in the middle (x 53..587, y 80..880)
      g.save();
      g.filter = 'blur(26px) saturate(1.1) brightness(.92)';
      drawCover(g, pic, pw, ph, c.width, c.height);
      g.restore();
      const s = Math.min(534 / pw, 800 / ph);
      g.drawImage(pic, 320 - (pw * s) / 2, 480 - (ph * s) / 2, pw * s, ph * s);
    }
    const label = '▦ ' + ad.count;
    g.font = `500 ${30 * k}px "KHTekaMono", monospace`;
    const bh = 56 * k, bw = g.measureText(label).width + 40 * k;
    const bx = 587 - 51 * k - bw, by = 80 + 32 * k;
    g.fillStyle = 'rgba(16,18,20,.45)';
    roundRect(g, bx, by, bw, bh, bh / 2);
    g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(label, bx + 20 * k, by + bh / 2 + 1);
    tex.needsUpdate = true;
  };
  paint(null);
  const img = new Image();
  img.onload = () => paint(img, img.naturalWidth, img.naturalHeight);
  img.src = ad.cover;
  textures.set(key, tex);
  return tex;
}

function glBuild() {
  const { renderer, camera, scene, target, lens, dpr } = gl;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  target.setSize(Math.round(w * dpr), Math.round(h * dpr));
  lens.uniforms.uRes.value.set(w, h);
  lens.uniforms.uCalm.value = (cardW / 2 + 4) / w;
  camera.aspect = w / h;
  camera.position.z = h / 2 / Math.tan((6 * Math.PI) / 180); // 1 unit = 1 px at z = 0
  camera.far = camera.position.z * 2;
  camera.updateProjectionMatrix();

  [...gl.meshes, ...gl.labels].forEach((m) => { scene.remove(m); m.material.dispose(); });
  if (gl.geometry) gl.geometry.dispose();
  if (gl.labelGeometry) gl.labelGeometry.dispose();
  gl.geometry = new THREE.PlaneGeometry(cardW, cardH);
  gl.labelGeometry = new THREE.PlaneGeometry(cardW, LABEL_H);
  gl.meshes = cards.map((el) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      transparent: true,
      depthTest: false,
      uniforms: {
        uTex: { value: makeTexture(items[Number(el.dataset.i)]) },
        uSize: { value: new THREE.Vector2(cardW, cardH) },
        uRadius: { value: w < 760 ? 8 : 10 }, // rounded corners, px
        uParallax: { value: 0 },
        uCrop: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(gl.geometry, mat);
    scene.add(mesh);
    return mesh;
  });
  gl.labels = cards.map((el) => {
    const mat = new THREE.MeshBasicMaterial({ map: makeLabel(items[Number(el.dataset.i)]), transparent: true, depthTest: false });
    const mesh = new THREE.Mesh(gl.labelGeometry, mat);
    scene.add(mesh);
    return mesh;
  });
}

// ---------------------------------------------------------------------------
// Render loop: inertia physics, then lay the cards out and draw
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
const startTime = lastFrame;

// The lens tints edge cards with the page gradient; follow it as script.js shifts it on scroll
const rootCss = getComputedStyle(document.documentElement);
let bgKey = '';
function syncBg(u) {
  const v = ['--bg-l', '--bg-c', '--bg-r'].map((n) => rootCss.getPropertyValue(n).trim());
  const key = v.join();
  if (key === bgKey) return;
  bgKey = key;
  u.uBgL.value.setStyle(v[0]);
  u.uBgC.value.setStyle(v[1]);
  u.uBgR.value.setStyle(v[2]);
}

let onScreen = true;
let looping = true;
function frame(now) {
  if (!onScreen) { looping = false; return; }
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  // Scrolling, dragging, keys and clicks move the row and park it on the nearest
  // card; once parked it creeps along slowly (easing in) until the next input
  if (!dragging) {
    if (settle !== null) {
      const before = pos;
      pos += (settle - pos) * (1 - Math.exp(-9 * dt));
      vel = dt > 0 ? (pos - before) / dt : 0;
      if (Math.abs(settle - pos) < 0.5) { pos = settle; vel = 0; settle = null; resting = true; driftV = 0; }
    } else {
      pos += vel * dt;
      vel *= Math.exp(-FRICTION * dt);
      if (Math.abs(vel) < SETTLE_SPEED && !resting) settle = Math.round(pos / stride) * stride;
    }
    if (resting && settle === null) {
      const target = reduceMotion || !box.hidden ? 0 : DRIFT;
      driftV += (target - driftV) * (1 - Math.exp(-1.5 * dt));
      pos += driftV * dt;
    }
  }

  const raw = reduceMotion ? 0 : Math.pow(Math.min(Math.abs(vel) / 2600, 1), 0.75);
  energy += (raw - energy) * (1 - Math.exp(-(raw > energy ? 8 : 6) * dt));

  const top = rowLift + cardH / 2; // shared top line, in GL units (y up)
  const stretch = 1 + 0.1 * energy;  // slight horizontal stretch with speed
  cards.forEach((el, k) => {
    const x = wrapped(k);
    const s = heightAt(x);
    el.style.transform = `translateX(calc(-50% + ${x.toFixed(1)}px)) scaleY(${s.toFixed(3)})`;
    el.style.filter = gl || reduceMotion ? '' : `blur(${(energy * 6).toFixed(1)}px)`;
    el.classList.toggle('is-active', Math.abs(x) < stride / 2);
    if (gl) {
      const visible = Math.abs(x) < half + cardW;
      const mesh = gl.meshes[k];
      const u = mesh.material.uniforms;
      mesh.position.set(x, top - (cardH * s) / 2, 0);
      mesh.scale.set(stretch, s, 1);
      u.uSize.value.set(cardW * stretch, cardH * s);
      u.uCrop.value = s;
      u.uParallax.value = clamp(x / half, -1.2, 1.2);
      mesh.visible = visible;
      const label = gl.labels[k];
      label.position.set(x - (cardW * (stretch - 1)) / 2, top + LABEL_H / 2 + 2, 0);
      label.visible = visible;
    }
  });

  if (gl) {
    const { renderer, lens } = gl;
    syncBg(lens.uniforms);
    lens.uniforms.uTime.value = reduceMotion ? 0 : (now - startTime) / 1000;
    lens.uniforms.uEnergy.value = energy;
    renderer.setRenderTarget(gl.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(gl.scene, gl.camera);
    renderer.setRenderTarget(null);
    renderer.render(gl.post, gl.postCam);
  }

  const n = cards.length;
  const idx = (((Math.round(pos / stride) % n) + n) % n);
  active = Number(cards[idx].dataset.i); // the centred card
  // Card under a resting mouse (re-checked each frame, since cards slide under it while scrolling)
  const under = mouseAt && !dragging ? document.elementFromPoint(mouseAt.x, mouseAt.y)?.closest('.mc-card') : null;
  showInfo(under ? Number(under.dataset.i) : active);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input: wheel, drag/swipe, keys, tap
// ---------------------------------------------------------------------------
stage.addEventListener('wheel', (e) => {
  const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (embedded && !sideways) return; // vertical wheel scrolls the home page
  e.preventDefault();
  // Vertical wheel and horizontal trackpad swipes both move the row sideways
  const d = sideways ? e.deltaX : e.deltaY;
  vel = clamp(vel + (e.deltaMode === 1 ? d * 30 : d) * WHEEL_GAIN, -MAX_SPEED, MAX_SPEED);
  settle = null;
  resting = false;
}, { passive: false });

let startX = 0;
let startPos = 0;
let lastX = 0;
let lastT = 0;
let moved = 0;
stage.addEventListener('pointerdown', (e) => {
  dragging = true;
  moved = 0;
  startX = lastX = e.clientX;
  lastT = performance.now();
  startPos = pos;
  vel = 0;
  settle = null;
  resting = false;
  stage.classList.add('is-dragging');
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const now = performance.now();
  const dtMs = Math.max(now - lastT, 1);
  const v = ((lastX - e.clientX) * 1.1 * 1000) / dtMs;
  vel = vel * 0.6 + v * 0.4;
  lastX = e.clientX;
  lastT = now;
  moved = Math.max(moved, Math.abs(e.clientX - startX));
  pos = startPos + (startX - e.clientX) * 1.1;
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  stage.classList.remove('is-dragging');
  // Pointer held still before release: no fling
  if (performance.now() - lastT > 80) vel = 0;
  vel = clamp(vel, -MAX_SPEED, MAX_SPEED);
  if (moved < 6) { vel = 0; handleClick(e); }
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', () => { dragging = false; stage.classList.remove('is-dragging'); });

// Tap: a side card glides to the centre, the centre card opens
// A side card glides to the centre and its viewer opens at the same time
function handleClick(e) {
  const card = document.elementFromPoint(e.clientX, e.clientY)?.closest('.mc-card');
  if (!card) { settle = Math.round(pos / stride) * stride; return; }
  if (!card.classList.contains('is-active')) settle = Math.round((pos + wrapped(cards.indexOf(card))) / stride) * stride;
  else settle = Math.round(pos / stride) * stride;
  openBox(Number(card.dataset.i));
}

// Where the mouse rests over the stage (for the hovered-card info), null when away
let mouseAt = null;
stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouseAt = { x: e.clientX, y: e.clientY }; });
stage.addEventListener('pointerleave', () => { mouseAt = null; });

stage.addEventListener('keydown', (e) => {
  if (!box.hidden) return;
  const here = Math.round((settle ?? pos) / stride);
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { settle = (here + 1) * stride; vel = 0; e.preventDefault(); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { settle = (here - 1) * stride; vel = 0; e.preventDefault(); }
  if (e.key === 'Enter') openBox(active);
});


// Lightbox
const box = document.getElementById('lightbox');
const frameEl = document.getElementById('lb-frame');
const playIcon = frameEl.querySelector('.play-icon');
const lbName = document.getElementById('lb-name');
const lbCount = document.getElementById('lb-count');
// Viewer: a project opens on its first image and the arrows step through all of its images
const boxImg = Object.assign(document.createElement('img'), { className: 'lb-media', alt: '' });
frameEl.append(boxImg);
frameEl.classList.add('has-media');
let boxAd = null;
let boxImage = 0;
function showImage(n) {
  const list = boxAd.images;
  boxImage = (n + list.length) % list.length;
  boxImg.src = list[boxImage];
  boxImg.alt = `${boxAd.title} ${boxImage + 1}`;
  lbCount.textContent = `${pad(boxImage + 1)} / ${pad(list.length)}`;
}
function openBox(i) {
  boxAd = items[(i + items.length) % items.length];
  lbName.textContent = boxAd.title;
  playIcon.hidden = true;
  box.querySelectorAll('.lb-nav').forEach((b) => { b.hidden = boxAd.images.length < 2; });
  showImage(0);
  box.hidden = false;
}
function closeBox() { box.hidden = true; stage.focus(); }
const step = (d) => { if (boxAd) showImage(boxImage + d); };
box.querySelector('.lb-close').addEventListener('click', closeBox);
box.querySelector('.lb-prev').addEventListener('click', () => step(-1));
box.querySelector('.lb-next').addEventListener('click', () => step(1));
box.addEventListener('click', (e) => e.target === box && closeBox());
document.addEventListener('keydown', (e) => {
  if (box.hidden) return;
  if (e.key === 'Escape') closeBox();
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

// Rebuild when the stage changes size (not on mobile URL-bar resizes), keeping the same card in the centre
let builtSize = '';
const stageSize = () => stage.clientWidth + 'x' + stage.clientHeight;
window.addEventListener('resize', () => {
  if (stageSize() === builtSize) return;
  builtSize = stageSize();
  const at = Math.round(pos / stride);
  build();
  pos = at * stride;
});

build();
builtSize = stageSize();
// Opened from a home-page tile (?open=<project index>): centre that card and open its viewer
const startAt = embedded ? null : new URLSearchParams(location.search).get('open');
if (startAt !== null && items[Number(startAt)]) {
  pos = Number(startAt) * stride;
  openBox(Number(startAt));
}
// Redraw card badges once the mono font has loaded
if (gl && document.fonts) document.fonts.ready.then(() => { textures.clear(); glBuild(); });
if (!embedded) stage.focus({ preventScroll: true });
// Stop drawing while the home-page slider is scrolled out of view
if (embedded && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen && !looping) { looping = true; lastFrame = performance.now(); requestAnimationFrame(frame); }
  }).observe(stage);
}
requestAnimationFrame(frame);
})();
