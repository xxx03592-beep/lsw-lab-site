// Zoom view, shared by the Lookbook (meta.js) and Meta Ads (lookbook.js) viewers.
// A photo grows from where it sits to fill the window height (whole picture, uncropped) over the
// page gradient. Wheel or pinch zooms around the pointer (1x to 6x); when zoomed, drag to move.
// A click that doesn't drag, or Esc, sends it back to where it came from.
window.ZoomView = (() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX = 6;
  const view = Object.assign(document.createElement('div'), { className: 'zoom-view', hidden: true });
  view.setAttribute('role', 'dialog');
  view.setAttribute('aria-modal', 'true');
  view.tabIndex = -1;
  const img = Object.assign(document.createElement('img'), { alt: '', draggable: false });
  view.append(img);
  document.body.append(view);

  let isOpen = false, getRect = null, onClose = null, timer = 0;
  let base = { x: 0, y: 0, w: 0, h: 0 }; // the photo fitted to the window, before zooming
  let s = 1, tx = 0, ty = 0;              // zoom and pan on top of that
  const pointers = new Map();
  let drag = null, pinch = null, moved = 0;

  const place = (b) => Object.assign(img.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  function fit() {
    const a = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : base.w / (base.h || 1) || 0.75;
    let h = innerHeight, w = h * a;
    if (w > innerWidth) { w = innerWidth; h = w / a; }
    return { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2, w, h };
  }
  // Keep the picture covering the window when it's bigger, centred when it's smaller
  function clamp() {
    const w = base.w * s, h = base.h * s;
    tx = w <= innerWidth ? (innerWidth - w) / 2 - base.x : Math.min(-base.x, Math.max(innerWidth - w - base.x, tx));
    ty = h <= innerHeight ? (innerHeight - h) / 2 - base.y : Math.min(-base.y, Math.max(innerHeight - h - base.y, ty));
  }
  function apply() {
    img.style.transform = s === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
    view.classList.toggle('is-zoomed', s > 1.01);
  }
  // Zoom to `next` keeping the point under (cx, cy) where it is
  function zoomAt(next, cx, cy) {
    next = Math.min(MAX, Math.max(1, next));
    const px = cx - base.x, py = cy - base.y;
    tx = px - ((px - tx) * next) / s;
    ty = py - ((py - ty) * next) / s;
    s = next;
    if (s === 1) { tx = 0; ty = 0; }
    clamp();
    apply();
  }

  function open(source, rect, opts = {}) {
    clearTimeout(timer);
    getRect = opts.getRect || (() => rect);
    onClose = opts.onClose || null;
    isOpen = true;
    s = 1; tx = 0; ty = 0;
    img.style.transform = '';
    img.src = source.currentSrc || source.src;
    img.alt = source.alt || '';
    view.hidden = false;
    view.classList.remove('is-open', 'is-zoomed');
    view.classList.add('is-moving');
    place(rect);
    void view.offsetWidth; // start the growth from the photo's own place
    view.classList.add('is-open');
    const go = () => { base = fit(); place(base); };
    if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true });
    timer = setTimeout(() => view.classList.remove('is-moving'), reduce ? 0 : 500);
    view.focus({ preventScroll: true });
  }
  function close(instant) {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(timer);
    s = 1; tx = 0; ty = 0;
    view.classList.add('is-moving');
    apply();
    view.classList.remove('is-open', 'is-zoomed');
    place(getRect ? getRect() : base);
    const done = onClose;
    timer = setTimeout(() => { view.hidden = true; view.classList.remove('is-moving'); }, instant || reduce ? 0 : 500);
    if (done) done();
  }

  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!isOpen || view.classList.contains('is-moving')) return;
    const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    zoomAt(s * Math.exp(-d * 0.0018), e.clientX, e.clientY);
  }, { passive: false });

  view.addEventListener('pointerdown', (e) => {
    if (!isOpen) return;
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, tx, ty }; moved = 0; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s };
      drag = null;
      moved = 99; // a pinch is never a click
    }
  });
  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomAt((pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (drag) {
      moved = Math.max(moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
      if (s > 1.01) {
        tx = drag.tx + (e.clientX - drag.x);
        ty = drag.ty + (e.clientY - drag.y);
        clamp();
        apply();
        view.classList.add('is-dragging');
      }
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    view.classList.remove('is-dragging');
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      const click = e.type === 'pointerup' && moved < 5;
      drag = null;
      if (click) close();
    }
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
    if (e.key === '+' || e.key === '=') zoomAt(s * 1.4, innerWidth / 2, innerHeight / 2);
    if (e.key === '-') zoomAt(s / 1.4, innerWidth / 2, innerHeight / 2);
  }, true); // capture: Esc closes the zoom first, not the viewer under it
  addEventListener('resize', () => { if (!isOpen) return; base = fit(); place(base); clamp(); apply(); });

  return { open, close, isOpen: () => isOpen };
})();
