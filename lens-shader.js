// Full-screen "glass lens" pass shared by the Lookbook gallery (meta.js) and the
// Meta Ad Creatives columns (lookbook.js): clean middle, barrel pull and refraction
// toward the screen edge, colour fringes, an animated pastel aura behind the cards.
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
uniform vec3 uBase;
uniform vec3 uGlowA;
uniform vec3 uGlowB;
uniform vec3 uGlowC;
uniform vec3 uGlowD;
uniform vec3 uSideL, uSideL2; // left edge tones (mint / sky)
uniform vec3 uSideR, uSideR2; // right edge tones (pink / violet)
varying vec2 vUv;

// Signed distance to the screen's rounded outline, in screen-height units
float screenSd(vec2 p, vec2 halfSize) {
  float r = 0.14;
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Pastel colour drifting round the screen edge; the middle stays plain
vec3 aura(vec2 uv, float aspect, float frame) {
  vec3 col = uBase;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float a = uTime * (0.09 + fi * 0.017) + fi * 1.5708;
    vec2 c = vec2(cos(a) * aspect * 0.5, sin(a) * 0.5);
    float w = exp(-dot(p - c, p - c) / 0.18);
    vec3 tint = i == 0 ? uGlowA : i == 1 ? uGlowB : i == 2 ? uGlowC : uGlowD;
    col = mix(col, tint, w * frame * 0.9);
  }
  // Left and right edges: a different colour on each side that keeps swaying on
  // its own (width ripples down the edge, colour drifts between two tones)
  float t = uTime;
  float wl = 0.2 + 0.08 * sin(uv.y * 5.0 + t * 1.4) + 0.04 * sin(uv.y * 11.0 - t * 0.9);
  float wr = 0.2 + 0.08 * sin(uv.y * 4.5 - t * 1.2 + 1.7) + 0.04 * sin(uv.y * 9.0 + t * 1.0);
  vec3 left = mix(uSideL, uSideL2, 0.5 + 0.5 * sin(t * 0.6 + uv.y * 2.0));
  vec3 right = mix(uSideR, uSideR2, 0.5 + 0.5 * sin(t * 0.5 - uv.y * 2.0 + 1.0));
  col = mix(col, left, (1.0 - smoothstep(0.0, wl, uv.x)) * 0.85);
  col = mix(col, right, (1.0 - smoothstep(0.0, wr, 1.0 - uv.x)) * 0.85);
  return col;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 halfSize = vec2(aspect, 1.0) * 0.5;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);

  // How far into the glass band we are: 0 in the clean middle, 1 at the rim.
  // uRimMode 0: the whole screen outline (gallery, cards leave at the sides).
  // uRimMode 1: only the top and bottom edges (columns, tiles leave up and down).
  float inside = -screenSd(p, halfSize);
  float rimInside = mix(inside, 0.5 - abs(p.y), uRimMode);
  float band = uBand;
  float mask = 1.0 - smoothstep(0.0, band, rimInside);

  // Direction from the rim toward the middle (gradient of the outline)
  vec2 e = vec2(0.002, 0.0);
  vec2 g = vec2(screenSd(p + e.xy, halfSize) - screenSd(p - e.xy, halfSize),
                screenSd(p + e.yx, halfSize) - screenSd(p - e.yx, halfSize));
  vec2 n = length(g) > 1e-5 ? -normalize(g) : vec2(0.0);
  n = mix(n, vec2(0.0, -sign(p.y)), uRimMode);
  n.x /= aspect;

  vec2 c = vUv - 0.5;
  float distort = 0.32 + 0.3 * uEnergy;
  // Pull toward the centre. Across the centre card the vertical pull ignores x,
  // so that card's top and bottom edges stay level instead of bowing.
  float sideWeight = smoothstep(uCalm, uCalm + 0.05, abs(c.x));
  vec2 bend = uBend * c * vec2(dot(c, c), c.y * c.y + c.x * c.x * sideWeight) * distort;
  vec2 ring = n * sin(mask * 3.14159) * 0.02 * (1.0 + uEnergy); // refraction along the rim
  vec2 uvRaw = vUv + (bend + ring) * mask;
  // Pushing outward samples past the screen edge: show nothing there rather than smearing the edge pixels
  float onScreen = step(0.0, uvRaw.x) * step(uvRaw.x, 1.0) * step(0.0, uvRaw.y) * step(uvRaw.y, 1.0);
  vec2 uv = clamp(uvRaw, 0.001, 0.999);

  // Colour fringes, stronger at the rim and with speed
  vec2 split = n * (0.0015 + 0.006 * uEnergy) * mask;
  vec4 base = texture2D(tScene, uv) * onScreen;
  vec3 scene = vec3(texture2D(tScene, uv + split).r, base.g, texture2D(tScene, uv - split).b) * onScreen;

  float frame = 1.0 - smoothstep(0.0, 0.42, inside);
  vec3 bg = aura(vUv, aspect, frame);
  vec3 col = scene + bg * (1.0 - base.a);
  col += (noise(gl_FragCoord.xy + uTime) - 0.5) * 0.012 * (0.4 + mask);
  gl_FragColor = vec4(col, 1.0);
}`;
