// Full-screen "glass lens" pass shared by the Lookbook gallery (meta.js) and the
// Meta Ad Creatives columns (lookbook.js): clean middle, barrel pull and refraction
// toward the screen edge, colour fringes. The canvas is transparent: the page's CSS
// gradient shows behind the cards, and the gallery cards take on that gradient's
// colour near the left and right edges.
// Loaded as a classic script, so these constants are visible to the page scripts.

const LENS_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const LENS_FRAG = `
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uEnergy;
uniform float uCalm; // half the centre card's width, in screen-width units
uniform float uBend; // -1 pulls the picture in (gallery), +1 pushes it out so it curves away from the viewer
uniform float uRimMode; // 0: lens along the whole screen edge, 1: top and bottom edges only
uniform float uBand;    // depth of the glass band from the edge, in screen-height units
uniform vec3 uBgL, uBgC, uBgR; // page background: left band, base, right band (--bg-l / --bg-base / --bg-r)
varying vec2 vUv;

// Distance in from the screen edge, in screen-height units, as a smooth minimum of
// the distances to the four sides. A plain rounded-box distance has creases along the
// diagonals from the corners, and the refraction direction taken from it flips there,
// which slices the picture; this one bends evenly everywhere.
float rimDistance(vec2 p, vec2 halfSize) {
  float k = 0.08;
  float s = exp(-(halfSize.x + p.x) / k) + exp(-(halfSize.x - p.x) / k)
          + exp(-(halfSize.y + p.y) / k) + exp(-(halfSize.y - p.y) / k);
  return -k * log(max(s, 1e-30));
}

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// The left/right edge bands of the CSS page background (styles.css --page-bg):
// weight (1 - x/20vw)³
vec3 pageBg(float x) {
  float band = 0.2;
  float wl = pow(1.0 - clamp(x / band, 0.0, 1.0), 3.0);
  float wr = pow(1.0 - clamp((1.0 - x) / band, 0.0, 1.0), 3.0);
  return mix(mix(uBgC, uBgR, wr), uBgL, wl);
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 halfSize = vec2(aspect, 1.0) * 0.5;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);

  // How far into the glass band we are: 0 in the clean middle, 1 at the rim.
  // uRimMode 0: the whole screen outline (gallery, cards leave at the sides).
  // uRimMode 1: only the top and bottom edges (columns, tiles leave up and down).
  float inside = rimDistance(p, halfSize);
  float rimInside = mix(inside, 0.5 - abs(p.y), uRimMode);
  float band = uBand;
  float mask = 1.0 - smoothstep(0.0, band, rimInside);

  // Direction from the rim toward the middle (gradient of the smooth rim distance)
  vec2 e = vec2(0.002, 0.0);
  vec2 g = vec2(rimDistance(p + e.xy, halfSize) - rimDistance(p - e.xy, halfSize),
                rimDistance(p + e.yx, halfSize) - rimDistance(p - e.yx, halfSize));
  vec2 n = length(g) > 1e-5 ? normalize(g) : vec2(0.0);
  n = mix(n, vec2(0.0, -sign(p.y)), uRimMode);
  n.x /= aspect;

  vec2 c = vUv - 0.5;
  float distort = 0.32 + 0.3 * uEnergy;
  // Pull toward the centre. Across the centre card the vertical pull ignores x,
  // so that card's top and bottom edges stay level; the pull fades in gradually
  // beside it (a short ramp here showed as a vertical seam).
  float sideWeight = smoothstep(uCalm, uCalm + 0.22, abs(c.x));
  vec2 bend = uBend * c * vec2(dot(c, c), c.y * c.y + c.x * c.x * sideWeight) * distort;
  vec2 ring = n * sin(mask * 3.14159) * 0.006 * (1.0 + uEnergy); // gentle refraction along the rim
  vec2 uvRaw = vUv + (bend + ring) * mask;
  // Pushing outward samples past the screen edge: show nothing there rather than smearing the edge pixels
  float onScreen = step(0.0, uvRaw.x) * step(uvRaw.x, 1.0) * step(0.0, uvRaw.y) * step(uvRaw.y, 1.0);
  vec2 uv = clamp(uvRaw, 0.001, 0.999);

  // Colour fringes, stronger at the rim and with speed
  vec2 split = n * (0.0015 + 0.006 * uEnergy) * mask;
  vec4 base = texture2D(tScene, uv) * onScreen;
  vec3 scene = vec3(texture2D(tScene, uv + split).r, base.g, texture2D(tScene, uv - split).b) * onScreen;

  // Scene colours are premultiplied by alpha. Gallery cards nearing the left/right
  // edge fade toward the background colour behind them, as in the reference.
  float a = base.a;
  float edgeX = min(vUv.x, 1.0 - vUv.x);
  float tint = (1.0 - smoothstep(0.02, 0.26, edgeX)) * 0.6 * (1.0 - uRimMode);
  vec3 col = mix(scene, pageBg(vUv.x) * a, tint);
  col += (noise(gl_FragCoord.xy + uTime) - 0.5) * 0.012 * (0.4 + mask) * a;
  gl_FragColor = vec4(col, a);
}`;
