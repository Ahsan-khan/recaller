'use strict';

(async () => {
  const img = document.getElementById('shot');
  const sel = document.getElementById('sel');
  const size = document.getElementById('size');

  try {
    const { bytes } = await window.shot.image();
    img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    await img.decode();
  } catch {
    // Still usable: the selection maps onto the capture held by the main process.
  }
  window.shot.ready();

  let start = null;
  let rect = null;

  function draw() {
    sel.hidden = false;
    Object.assign(sel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    const ratio = window.devicePixelRatio || 1;
    size.textContent = `${Math.round(rect.w * ratio)} × ${Math.round(rect.h * ratio)}`;
  }

  window.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return window.shot.cancel();
    if (e.button !== 0) return;
    document.body.setPointerCapture?.(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
    rect = { x: start.x, y: start.y, w: 0, h: 0 };
    document.body.classList.add('selecting');
    draw();
  });

  window.addEventListener('pointermove', (e) => {
    if (!start) return;
    rect = {
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      w: Math.abs(e.clientX - start.x),
      h: Math.abs(e.clientY - start.y),
    };
    draw();
  });

  window.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    if (!rect || rect.w < 6 || rect.h < 6) window.shot.done({ full: true });
    else window.shot.done(rect);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.shot.cancel();
    else if (e.key === 'Enter') window.shot.done(rect && rect.w >= 6 && rect.h >= 6 ? rect : { full: true });
  });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.shot.cancel();
  });
})();
