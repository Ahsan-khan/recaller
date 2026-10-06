'use strict';
// Mac-safe helpers for the e2e suites, which were written on the Windows PC. On a Mac they keep a
// run out of the owner's way. On Windows every helper is inert: MOD is 'control', MOD_KEY is
// 'Control', quiet() does nothing, and the suites only call macRect() when IS_MAC is true.

const { app, Menu, screen, shell } = require('electron');

const IS_MAC = process.platform === 'darwin';
// The app's shortcut and multi-select modifier: ⌘ on a Mac (where Control+click is a right-click).
const MOD = IS_MAC ? 'meta' : 'control';
const MOD_KEY = IS_MAC ? 'Meta' : 'Control'; // its keyCode, for holding it down
const macState = { hides: 0 }; // app.hide() calls, counted by quiet()

// Where a test window goes on a Mac: past the outer left or right edge of all displays, on the
// side away from the cursor, at the top of the display that forms that edge. 2 px stay on screen:
// macOS stops drawing a window that is wholly off screen, and capturePage and animations stop with it.
function macRect(W, H) {
  const c = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((d) => d.bounds.x));
  const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const toLeft = c.x - left > right - c.x;
  // y from the display that forms that outer edge, so the sliver lands on a screen when several are attached
  const edge = displays.find((d) => (toLeft ? d.bounds.x === left : d.bounds.x + d.bounds.width === right));
  const x = toLeft ? left - W + 2 : right - 2;
  return { x, y: edge.workArea.y, width: W, height: H };
}

// Call before require(APP_MAIN). Mac only: no Dock icon; the owner's pointer passes through the
// test windows (sendInputEvent still reaches them); no native menu, System Settings or Finder
// opens; and the app can never take focus or hide itself (app.hide is counted instead).
function quiet() {
  if (!IS_MAC) return;
  app.dock?.hide();
  app.on('browser-window-created', (_e, w) => w.setIgnoreMouseEvents(true));
  Menu.prototype.popup = () => {};
  shell.openExternal = async () => {};
  shell.openPath = async () => '';
  app.focus = () => {};
  app.show = () => {};
  app.hide = () => { macState.hides += 1; };
}

module.exports = { IS_MAC, MOD, MOD_KEY, macRect, quiet, macState };
