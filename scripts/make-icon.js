'use strict';
// Renders build/icon.png (512×512) from the same monstera leaf used in the UI.
// Run with: npm run icon
// With --mac (npm run icon:mac) it renders only build/icon-mac.png (1024×1024) on Apple's icon grid.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const SIZE = 512;
const MAC = process.argv.includes('--mac');
const MAC_SIZE = 1024;
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const sprite = renderer.match(/<svg class="sprite"[\s\S]*?<\/svg>/)[0];

const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}.sprite{position:absolute;width:0;height:0}svg{display:block}</style></head><body>
${sprite}
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#63ad72"/>
      <stop offset="1" stop-color="#1f5530"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#glow)"/>
  <g transform="translate(256 262) rotate(-16) translate(-160 -170)" style="color:#eaf6dc;--rib:rgba(31,85,48,.35)">
    <use href="#monstera" width="320" height="340"/>
  </g>
</svg></body></html>`;

// Mac: Apple's grid puts an 824 px body, inset 100 px, in a transparent 1024 px canvas, with room
// for a soft shadow (dy 12, blur 14 = stdDeviation 7, 28 % black). The gradient, glow and leaf are
// the Windows icon's; the outer group maps its 480 px body (16…496) onto 824 px (100…924).
const macHtml = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}.sprite{position:absolute;width:0;height:0}svg{display:block}</style></head><body>
${sprite}
<svg width="${MAC_SIZE}" height="${MAC_SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#63ad72"/>
      <stop offset="1" stop-color="#1f5530"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="12" stdDeviation="7" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#glow)"/>
  <g transform="translate(100 100) scale(${824 / 480}) translate(-16 -16)">
    <g transform="translate(256 262) rotate(-16) translate(-160 -170)" style="color:#eaf6dc;--rib:rgba(31,85,48,.35)">
      <use href="#monstera" width="320" height="340"/>
    </g>
  </g>
</svg></body></html>`;

if (MAC) app.dock?.hide(); // before any window, so no Dock icon flashes

app.whenReady().then(async () => {
  if (MAC) return renderMac();
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log('wrote', out, image.getSize());
  app.quit();
});

// The same hidden window as the Windows icon, 1024 px (allowed to be taller than the 982 pt screen; it is
// never shown). A Retina screen captures it at 2× (2048 px), so the capture is scaled to Apple's 1024.
// (An offscreen window's 'paint' frame came back empty here.)
async function renderMac() {
  const win = new BrowserWindow({
    width: MAC_SIZE, height: MAC_SIZE, show: false, transparent: true, frame: false, useContentSize: true, enableLargerThanScreen: true,
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(macHtml)}`);
  await new Promise((r) => setTimeout(r, 300));
  const shot = await win.webContents.capturePage({ x: 0, y: 0, width: MAC_SIZE, height: MAC_SIZE });
  const image = shot.isEmpty() ? null : shot.resize({ width: MAC_SIZE, height: MAC_SIZE, quality: 'best' });
  // Fail loudly: without the file, electron-builder would quietly use the Windows icon for the Mac app.
  const size = image?.getSize();
  if (!image || size.width !== MAC_SIZE || size.height !== MAC_SIZE) {
    console.error('icon:mac: no usable capture', shot.getSize());
    app.exit(1);
    return;
  }
  const out = path.join(__dirname, '..', 'build', 'icon-mac.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log('wrote', out, size);
  app.quit();
}
