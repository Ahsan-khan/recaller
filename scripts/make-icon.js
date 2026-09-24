'use strict';
// Renders build/icon.png (512×512) from the same monstera leaf used in the UI.
// Run with: npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const SIZE = 512;
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

app.whenReady().then(async () => {
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
