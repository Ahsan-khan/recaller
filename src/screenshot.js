'use strict';
// Snip-style screenshot: hide Recaller, grab the screen under the cursor, then
// let the user drag a region on a full-screen overlay. The crop is taken from
// the original capture, so it is pixel-exact.

const { BrowserWindow, desktopCapturer, screen } = require('electron');
const path = require('node:path');
const images = require('./images');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

function pickRegion(display, capture) {
  return new Promise((resolve) => {
    const { x, y, width, height } = display.bounds;
    const overlay = new BrowserWindow({
      x, y, width, height,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, 'overlay', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setBounds({ x, y, width, height });

    let settled = false;
    const finish = (rect) => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      if (!overlay.isDestroyed()) overlay.destroy();
      resolve(rect);
    };
    const show = () => {
      if (overlay.isDestroyed() || overlay.isVisible()) return;
      overlay.show();
      overlay.focus();
      overlay.once('blur', () => finish(null)); // alt-tab away = cancel
    };
    const safety = setTimeout(() => finish(null), 3 * 60 * 1000);

    const ipc = overlay.webContents.ipc;
    ipc.handle('shot:image', () => ({ bytes: capture.toJPEG(90) }));
    ipc.on('shot:ready', show);
    ipc.on('shot:done', (_e, rect) => finish(rect && typeof rect === 'object' ? rect : null));
    ipc.on('shot:cancel', () => finish(null));
    overlay.on('closed', () => finish(null));
    overlay.webContents.on('render-process-gone', () => finish(null));
    setTimeout(show, 2500); // show even if the page never reports ready

    overlay.loadFile(path.join(__dirname, 'overlay', 'overlay.html'));
  });
}

async function capture(mainWindow) {
  if (busy) return { ok: false, code: 'BUSY', error: 'A screenshot is already in progress.' };
  busy = true;
  const restore = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (restore) {
      mainWindow.hide();
      await sleep(260); // let Windows finish removing the window from the screen
    }
    const sf = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    const shot = source?.thumbnail;
    if (!shot || shot.isEmpty()) throw new Error('Windows returned an empty screen capture.');

    const rect = await pickRegion(display, shot);
    if (!rect) return { ok: false, code: 'CANCELLED' };

    const size = shot.getSize();
    const sx = size.width / display.bounds.width;
    const sy = size.height / display.bounds.height;
    let image = shot;
    if (!rect.full) {
      const cx = Math.max(0, Math.round(rect.x * sx));
      const cy = Math.max(0, Math.round(rect.y * sy));
      const cw = Math.min(size.width - cx, Math.round(rect.w * sx));
      const ch = Math.min(size.height - cy, Math.round(rect.h * sy));
      if (cw < 2 || ch < 2) return { ok: false, code: 'CANCELLED' };
      image = shot.crop({ x: cx, y: cy, width: cw, height: ch });
    }
    return { ok: true, image: images.store(image) };
  } catch (err) {
    console.error('[screenshot]', err);
    return { ok: false, code: 'FAILED', error: `Screenshot failed: ${err.message}` };
  } finally {
    busy = false;
    if (restore && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

module.exports = { capture };
