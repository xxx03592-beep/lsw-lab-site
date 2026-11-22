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
const fillEl = document.getElementById('mc-fill');
const bottomEl = stage.querySelector('.mc-bottom');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Motion and layout tuning. Card proportions follow the reference (exp.fiddle.digital,
// measured at 1440×900 and 1890×892): the centre card is 44.2% of the window height, 0.673 wide:tall, 9px apart.
// Ours is drawn 10% larger than that.
const EMPHASIS = 0.4;    // a card at the stage edge loses 40% of its height
const ASPECT = 0.673;    // card width / height
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

// As in the reference, cards keep their width and only lose height, hanging from
// a shared top line, so the row tapers toward both edges. The loss grows with the
// square of the distance: ~5% for the neighbours, ~22% for the next ones out.
function heightAt(x) {
  const d = Math.min(Math.abs(x) / half, 1.15);
  return 1 - EMPHASIS * d * d;
}

function measure() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const mobile = w < 760;
  // The row (card titles + cards) sits between the bottom of the menu and the top of the
  // bottom-left title block, slightly below centre. The stage starts at the top of the header on both pages.
  const menuBottom = mobile ? 72 : 66;
  const titleTop = bottomEl.offsetTop;
  const space = titleTop - menuBottom;
  // Sized from the window height (not the stage, which loses the announcement bar on the home page)
  cardH = mobile ? Math.min((w * 0.72) / ASPECT, h * 0.5) : Math.min(innerHeight * 0.486, (w * 0.2035) / ASPECT); // reference size + 10%
  cardH = Math.min(cardH, space - LABEL_H - 48);
  cardW = Math.round(cardH * ASPECT);
  cardH = Math.round(cardH);
  stride = cardW + (mobile ? 8 : 9);
  half = w / 2;
  const drop = mobile ? 0 : 6; // a touch below the exact middle, nearer the menu than the title
  const cardTop = menuBottom + (space - (cardH + LABEL_H + 4)) / 2 + LABEL_H + 4 + drop;
  rowLift = h / 2 - (cardTop + cardH / 2);
  stage.style.setProperty('--card-h', cardH + 'px');
  stage.style.setProperty('--card-w', cardW + 'px');
  stage.style.setProperty('--row-lift', rowLift + 'px');
}

// Build the cards
function build() {
  if (detailOpen) closeDetail(); // card indices change
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
uniform float uAlpha;
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
  gl_FragColor = vec4(texture2D(uTex, uv).rgb, edge * uAlpha);
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
  const k = (0.5 * 373) / (cardH || 373); // half the original badge size
  const paint = (pic, pw, ph) => {
    g.fillStyle = '#b9b3c0';
    g.fillRect(0, 0, c.width, c.height);
    // The picture covers the whole texture (cropped, never letterboxed); shorter
    // cards show less of its height (uCrop in CARD_FRAG), so it opens up toward the centre
    if (pic) drawCover(g, pic, pw, ph, c.width, c.height);
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
        uAlpha: { value: 1 },
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
  const v = ['--bg-l', '--bg-base', '--bg-r'].map((n) => rootCss.getPropertyValue(n).trim());
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
  if (!cards.length) { lastFrame = now; requestAnimationFrame(frame); return; } // stage had no size at build time
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
      const target = reduceMotion || detailOpen ? 0 : DRIFT;
      driftV += (target - driftV) * (1 - Math.exp(-1.5 * dt));
      pos += driftV * dt;
    }
  }

  const raw = reduceMotion ? 0 : Math.pow(Math.min(Math.abs(vel) / 2600, 1), 0.75);
  energy += (raw - energy) * (1 - Math.exp(-(raw > energy ? 8 : 6) * dt));

  // Detail view: the opened card grows into the column, the others shrink into side previews
  spread += (spreadTarget - spread) * (1 - Math.exp(-6 * dt));
  if (spreadTarget === 0 && spread < 0.001) { spread = 0; openK = -1; }
  const ease = spread * spread * (3 - 2 * spread);
  if (openK >= 0) updateDetailLayout(dt, false);
  if (!detail.hidden) stepColumn(dt);

  const top = rowLift + cardH / 2; // shared top line, in GL units (y up)
  const stretch = 1 + 0.1 * energy;  // slight horizontal stretch with speed
  cards.forEach((el, k) => {
    const x = wrapped(k);
    const s = heightAt(x);
    el.style.transform = `translateX(calc(-50% + ${x.toFixed(1)}px)) scaleY(${s.toFixed(3)})`;
    el.style.filter = gl || reduceMotion ? '' : `blur(${(energy * 6).toFixed(1)}px)`;
    el.classList.toggle('is-active', Math.abs(x) < stride / 2);
    if (gl) {
      const mesh = gl.meshes[k];
      const u = mesh.material.uniforms;
      let cw = cardW * stretch, ch = cardH * s, cy = top - ch / 2, cx = x, alpha = 1;
      const d = openK >= 0 && ease > 0 ? detLayout[k] : null;
      if (d) {
        cx += (d.x - cx) * ease;
        cy += (d.y - cy) * ease;
        cw += (d.w - cw) * ease;
        ch += (d.h - ch) * ease;
        alpha = 1 + (d.a - 1) * ease;
      }
      mesh.position.set(cx, cy, 0);
      mesh.scale.set(cw / cardW, ch / cardH, 1);
      u.uSize.value.set(cw, ch);
      u.uCrop.value = d ? (ch / cw) * (cardW / cardH) : s;
      u.uParallax.value = clamp(x / half, -1.2, 1.2) * (1 - ease);
      u.uAlpha.value = alpha;
      mesh.visible = alpha > 0.01 && Math.abs(cx) < half + cw;
      const label = gl.labels[k];
      label.position.set(x - (cardW * (stretch - 1)) / 2, top + LABEL_H / 2 + 2, 0);
      label.material.opacity = 1 - ease;
      label.visible = ease < 0.99 && Math.abs(x) < half + cardW;
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
  moved = Math.max(moved, Math.abs(e.clientX - startX));
  // Lookbook page: a mouse drag doesn't move the row (wheel, keys and clicks do);
  // touch swipes still do, since phones have no other way to move it
  if (!embedded && e.pointerType === 'mouse') return;
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
  openDetail(Number(card.dataset.i), cards.indexOf(card));
}

// Where the mouse rests over the stage (for the hovered-card info), null when away
let mouseAt = null;
stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouseAt = { x: e.clientX, y: e.clientY }; });
stage.addEventListener('pointerleave', () => { mouseAt = null; });

stage.addEventListener('keydown', (e) => {
  if (detailOpen) return;
  const here = Math.round((settle ?? pos) / stride);
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { settle = (here + 1) * stride; vel = 0; e.preventDefault(); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { settle = (here - 1) * stride; vel = 0; e.preventDefault(); }
  if (e.key === 'Enter') openDetail(active, Math.round(pos / stride));
});


// Detail view. Opening a card grows it (in GL) into the first photo while the other cards
// shrink into small previews on both sides, where they stay; clicking one switches project.
// The photos sit in one vertical column, all the same size, scrolled with the slider's
// inertia and a soft spring that settles each photo in the middle (and bounces off the ends).
let spread = 0;        // 0..1, eased in the render loop
let spreadTarget = 0;
let openK = -1;        // index in cards of the opened card
let openCY = 0;        // where the column's centre sits, GL units (y up from the stage centre)
let colTop = 0;        // top of the column's current photo, px from the top of the window
let colW = 0;          // photo width and height in the column, px
let detailH = 0;
let detailOpen = false;
let detailAd = null;
let columnReady = false; // the column's photos are showing: the grown GL card fades out under them
let detLayout = [];    // per card {x, y, w, h, a}: smoothed detail-view placement
const GAP = 24;
const PREVIEW = 0.42;  // preview size relative to a slider card
const el = (tag, cls, props = {}) => Object.assign(document.createElement(tag), { className: cls }, props);
const detail = el('div', 'mc-detail', { hidden: true });
detail.setAttribute('role', 'dialog');
detail.setAttribute('aria-modal', 'true');
const dView = el('div', 'mcd-view', { tabIndex: -1 });
const dList = el('div', 'mcd-list');
const dCount = el('p', 'mcd-count mono');
dView.append(dList);
detail.append(dView, dCount);

// Zoom: a second tap on a photo opens it alone in the shared zoom view (zoom-view.js), where
// wheel/pinch zooms and a drag moves it; a tap or Esc sends it back into the column
let fullAt = 0;
const fullOpen = () => !!(window.ZoomView && ZoomView.isOpen());
// Where a photo's picture actually shows inside its box (the box letterboxes wide photos)
function pictureRect(img) {
  const r = img.getBoundingClientRect();
  const a = img.naturalWidth ? img.naturalWidth / img.naturalHeight : r.width / (r.height || 1);
  let w = r.width, h = r.height;
  if (w / h > a) w = h * a; else h = w / a;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}
function openFull(n) {
  const src = dList.children[n];
  if (!src || !window.ZoomView) return;
  fullAt = n;
  dVel = 0;
  dTarget = n * dStep(); // settle the column on this photo underneath
  ZoomView.open(src, pictureRect(src), { getRect: () => pictureRect(dList.children[fullAt] || src) });
}
if (!gl) detail.classList.add('no-gl');
document.body.append(detail);

function detailSize() {
  const mobile = innerWidth < 760;
  // From just under the menu (and announcement bar) down to the bottom of the window
  const headerBottom = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--announce-h')) || 0) + (mobile ? 72 : 66);
  colTop = headerBottom + (mobile ? 12 : 16);
  detailH = innerHeight - colTop - (mobile ? 12 : 16);
  // The column is as wide as a 4:5 photo at full height: photos keep their own proportions inside it
  // (narrower ones are simply narrower, wider ones shrink to fit), so nothing is ever cropped
  colW = Math.round(Math.min(detailH * 0.8, innerWidth * (mobile ? 0.72 : 0.6))); // narrow screens: keep room for the previews
  detailH = Math.round(Math.min(detailH, colW / 0.8));
  detail.style.setProperty('--mcd-top', colTop + 'px');
  detail.style.setProperty('--mcd-h', detailH + 'px');
  detail.style.setProperty('--mcd-w', colW + 'px');
  detail.style.setProperty('--mcd-gap', GAP + 'px');
}

// Column scroll physics, in px down the column
let dPos = 0, dVel = 0, dTarget = null, dDragging = false;
const dStep = () => detailH + GAP;
const dLast = () => (detailAd ? detailAd.images.length - 1 : 0);
const dIndex = () => clamp(Math.round(dPos / dStep()), 0, dLast());
function stepColumn(dt) {
  if (!dDragging) {
    const max = dLast() * dStep();
    if (dTarget === null && (dPos < 0 || dPos > max)) dTarget = clamp(Math.round(dPos / dStep()), 0, dLast()) * dStep();
    if (dTarget === null) {
      dPos += dVel * dt;
      dVel *= Math.exp(-FRICTION * dt);
      if (Math.abs(dVel) < SETTLE_SPEED) dTarget = dIndex() * dStep();
    } else {
      // Slightly under-damped spring: overshoots a touch, then settles
      const w = 13, zeta = 0.62;
      dVel += (w * w * (dTarget - dPos) - 2 * zeta * w * dVel) * dt;
      dPos += dVel * dt;
      if (Math.abs(dTarget - dPos) < 0.3 && Math.abs(dVel) < 5) { dPos = dTarget; dVel = 0; }
    }
  }
  dList.style.transform = `translate3d(0, ${(-dPos).toFixed(1)}px, 0)`;
  if (detailAd) dCount.textContent = `${pad(dIndex() + 1)} / ${pad(detailAd.images.length)}`;
}
function resetColumn() { dPos = 0; dVel = 0; dTarget = null; }

detail.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (fullOpen()) return;
  const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  dVel = clamp(dVel + (e.deltaMode === 1 ? d * 30 : d) * WHEEL_GAIN, -MAX_SPEED, MAX_SPEED);
  dTarget = null;
}, { passive: false });

let dStartY = 0, dStartPos = 0, dLastY = 0, dLastT = 0, dMoved = 0;
dView.addEventListener('pointerdown', (e) => {
  dDragging = true;
  dMoved = 0;
  dStartY = dLastY = e.clientY;
  dStartPos = dPos;
  dLastT = performance.now();
  dVel = 0;
  dTarget = null;
  dView.setPointerCapture(e.pointerId);
});
dView.addEventListener('pointermove', (e) => {
  if (!dDragging) return;
  const now = performance.now();
  const v = ((dLastY - e.clientY) * 1000) / Math.max(now - dLastT, 1);
  dVel = dVel * 0.6 + v * 0.4;
  dLastY = e.clientY;
  dLastT = now;
  dMoved = Math.max(dMoved, Math.abs(e.clientY - dStartY));
  let p = dStartPos + (dStartY - e.clientY);
  const max = dLast() * dStep();
  if (p < 0) p *= 0.35; else if (p > max) p = max + (p - max) * 0.35; // rubber band past the ends
  dPos = p;
});
const dEnd = (e) => {
  if (!dDragging) return;
  dDragging = false;
  if (performance.now() - dLastT > 80) dVel = 0;
  dVel = clamp(dVel, -MAX_SPEED, MAX_SPEED);
  if (e.type === 'pointerup' && dMoved < 6) { dVel = 0; detailClick(e); }
};
dView.addEventListener('pointerup', dEnd);
dView.addEventListener('pointercancel', dEnd);

// A tap on a side preview opens that project, a tap on a photo does nothing,
// a tap anywhere else (the background) closes the view
function detailClick(e) {
  if (!detailAd) return;
  if (gl) {
    const r = stage.getBoundingClientRect();
    const gx = e.clientX - (r.left + r.width / 2);
    const gy = r.top + r.height / 2 - e.clientY;
    const hit = detLayout.findIndex((d, k) => d && k !== openK && Math.abs(gx - d.x) < d.w / 2 && Math.abs(gy - d.y) < d.h / 2);
    if (hit >= 0) { switchDetail(hit); return; }
  }
  const along = e.clientY - colTop + dPos; // px down the column
  const n = Math.floor(along / dStep());
  const pic = n >= 0 && n <= dLast() && dList.children[n] ? pictureRect(dList.children[n]) : null;
  const onPhoto = pic && e.clientX >= pic.x && e.clientX <= pic.x + pic.w && e.clientY >= pic.y && e.clientY <= pic.y + pic.h;
  if (onPhoto) openFull(n); else closeDetail();
}

// Where card k sits in the detail view: the opened one fills the column, the rest line up small on both sides
function detailTarget(k) {
  const n = cards.length;
  let j = (((k - openK) % n) + n) % n;
  if (j > n / 2) j -= n;
  if (j === 0) return { x: 0, y: openCY, w: colW, h: detailH, a: columnReady ? 0 : 1 };
  const pw = cardW * PREVIEW, ph = cardH * PREVIEW;
  const gap = innerWidth < 760 ? 14 : 36;
  const x = Math.sign(j) * (colW / 2 + gap + pw / 2 + (Math.abs(j) - 1) * (pw + 10));
  return { x, y: openCY, w: pw, h: ph, a: 1 };
}
function updateDetailLayout(dt, snap) {
  if (openK < 0) return;
  const t = snap ? 1 : 1 - Math.exp(-9 * dt);
  cards.forEach((_, k) => {
    const g = detailTarget(k);
    const d = detLayout[k];
    if (!d || snap) { detLayout[k] = { ...g }; return; }
    for (const key of ['x', 'y', 'w', 'h']) d[key] += (g[key] - d[key]) * t;
    d.a += (g.a - d.a) * (1 - Math.exp(-(g.a < d.a ? 6 : 14) * dt));
  });
}

function fillColumn() {
  dList.replaceChildren(...detailAd.images.map((src, j) => {
    const img = el('img', '', { src, alt: `${detailAd.title} ${j + 1}`, decoding: 'async', draggable: false });
    if (j > 1) img.loading = 'lazy';
    return img;
  }));
  detail.setAttribute('aria-label', detailAd.title);
  resetColumn();
  stepColumn(0);
}

let readyTimer = 0, detailTimer = 0;
function showColumnSoon(delay) {
  columnReady = false;
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => { detail.classList.add('is-ready'); columnReady = true; }, reduceMotion ? 0 : delay);
}
function centreRowOn(k) {
  settle = Math.round((pos + wrapped(k)) / stride) * stride;
  vel = 0;
}

function openDetail(i, k) {
  if (detailOpen) return;
  const n = items.length;
  detailAd = items[((i % n) + n) % n];
  detailOpen = true;
  detailSize();
  const r = stage.getBoundingClientRect();
  openCY = r.top + r.height / 2 - (colTop + detailH / 2);
  openK = gl ? k : -1;
  centreRowOn(k);
  spreadTarget = 1;
  detLayout = [];
  updateDetailLayout(0, true);
  fillColumn();
  clearTimeout(detailTimer);
  detail.classList.remove('is-ready');
  detail.hidden = false;
  stage.classList.add('is-detail');
  document.documentElement.classList.add('mcd-lock');
  requestAnimationFrame(() => detail.classList.add('is-open'));
  showColumnSoon(650);
  dView.focus({ preventScroll: true });
}
function switchDetail(k) {
  if (!gl || k === openK) return;
  detailAd = items[Number(cards[k].dataset.i)];
  openK = k;
  centreRowOn(k);
  detail.classList.remove('is-ready');
  columnReady = false;
  clearTimeout(detailTimer);
  detailTimer = setTimeout(fillColumn, reduceMotion ? 0 : 200);
  showColumnSoon(600);
}
function closeDetail() {
  if (!detailOpen) return;
  if (fullOpen()) ZoomView.close(true);
  detailOpen = false;
  columnReady = false;
  clearTimeout(readyTimer);
  clearTimeout(detailTimer);
  detail.classList.remove('is-open', 'is-ready');
  stage.classList.remove('is-detail');
  if (detLayout[openK]) detLayout[openK].a = 1; // the grown card reappears under the fading column
  spreadTarget = 0;
  resting = true;
  driftV = 0;
  document.documentElement.classList.remove('mcd-lock');
  detailTimer = setTimeout(() => { detail.hidden = true; dList.replaceChildren(); }, reduceMotion ? 0 : 400);
  stage.focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => {
  if (!detailOpen) return;
  if (fullOpen()) return; // the zoom view handles its own keys
  if (e.key === 'Escape') closeDetail();
  const down = ['ArrowDown', 'PageDown', ' '].includes(e.key), up = ['ArrowUp', 'PageUp'].includes(e.key);
  if (down || up) { e.preventDefault(); dTarget = clamp(dIndex() + (down ? 1 : -1), 0, dLast()) * dStep(); dVel = 0; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') switchDetail((openK + (e.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length);
});
addEventListener('resize', () => {
  if (!detailOpen) return;
  detailSize();
  const r = stage.getBoundingClientRect();
  openCY = r.top + r.height / 2 - (colTop + detailH / 2);
  dPos = dIndex() * dStep();
  dTarget = null;
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
  openDetail(Number(startAt), Number(startAt));
}
// Redraw card badges once the mono font has loaded
// and re-centre the row, since the bottom title's height changes with the font
if (document.fonts) document.fonts.ready.then(() => { textures.clear(); const at = Math.round(pos / stride); build(); pos = at * stride; });
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
