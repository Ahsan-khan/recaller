'use strict';

const {
  app, BrowserWindow, ipcMain, clipboard, ClipboardItem, safeStorage, globalShortcut,
  session, shell, Menu, screen,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonWithFallback, writeJsonAtomic, backup } = require('./store');
const { transcribe } = require('./transcribe');
const images = require('./images');
const screenshot = require('./screenshot');
const backups = require('./backups');
const cloud = require('./cloud'); // accounts and sync (1.17); every hook returns at once while signed out

const IS_MAC = process.platform === 'darwin'; // the Mac edition; on Windows everything runs as before

// Where notes live. Pinned explicitly so that no future change to the app's
// name or packaging can ever point a new version at a different (empty) folder.
if (process.env.RECALLER_DATA_DIR) app.setPath('userData', path.resolve(process.env.RECALLER_DATA_DIR));
else app.setPath('userData', path.join(app.getPath('appData'), 'Recaller'));
images.registerScheme();

const DATA_FILE = () => path.join(app.getPath('userData'), 'recaller-data.json');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'recaller-settings.json');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const MAC_ICON = path.join(__dirname, '..', 'build', 'icon-mac.png'); // Dock icon when run from source (npm run icon:mac)

// Window-controls colours must match the top bar of each theme.
const THEMES = {
  deep: { color: '#082a1f', symbolColor: '#e7f7ee' },
  soft: { color: '#fbfdfc', symbolColor: '#0c2a1d' },
};
const titleBar = () => ({ ...(THEMES[settings.theme] || THEMES.deep), height: 48 });

const DEFAULT_SETTINGS = {
  model: 'gpt-transcribe',
  language: '',
  hint: '',
  hotkey: IS_MAC ? 'Control+Alt+R' : 'CommandOrControl+Alt+R', // Mac: ⌃⌥R (⌥⌘R is VS Code's Reveal in Finder)
  shotHotkey: '',
  hideAfterCopy: false,
  theme: 'deep',
  apiKey: null, // { enc: base64 } when OS encryption is available, else { plain }
  bounds: null,
  maximized: false,
};

let win = null;
let settings = { ...DEFAULT_SETTINGS };
const hotkeyOk = { hotkey: false, shotHotkey: false };
let quitting = false; // Mac: set on ⌘Q, so closing the window stops meaning "hide"
let sessionEnding = false; // Windows: the computer logs out, restarts or shuts down: quitting waits for nothing (sync)
let sessionEndingAt = 0; // Mac: when powerMonitor last said so; a log out the person cancels stops counting after a minute

// ---------------------------------------------------------------- settings

function loadSettings() {
  const { value, from } = readJsonWithFallback(SETTINGS_FILE());
  if (from === SETTINGS_FILE()) backup(SETTINGS_FILE()); // last-good copy, like the data file
  settings = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
}

function saveSettings() {
  try {
    writeJsonAtomic(SETTINGS_FILE(), settings);
  } catch (err) {
    console.error('[settings] save failed:', err);
  }
}

function getApiKey() {
  const stored = settings.apiKey;
  if (stored?.enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
    } catch (err) {
      console.error('[settings] could not decrypt API key:', err.message);
    }
  }
  if (stored?.plain) return stored.plain;
  return process.env.OPENAI_API_KEY || '';
}

function setApiKey(key) {
  key = String(key || '').trim();
  if (!key) settings.apiKey = null;
  else if (safeStorage.isEncryptionAvailable()) settings.apiKey = { enc: safeStorage.encryptString(key).toString('base64') };
  else settings.apiKey = { plain: key };
}

function publicSettings() {
  const key = getApiKey();
  return {
    hasKey: Boolean(key),
    keySource: settings.apiKey ? 'saved' : key ? 'env' : null,
    keyHint: key ? key.slice(-4) : '',
    model: settings.model,
    language: settings.language,
    hint: settings.hint,
    hotkey: settings.hotkey,
    hotkeyOk: hotkeyOk.hotkey,
    shotHotkey: settings.shotHotkey,
    shotHotkeyOk: hotkeyOk.shotHotkey,
    hideAfterCopy: settings.hideAfterCopy,
    theme: settings.theme,
    dataDir: app.getPath('userData'),
  };
}

// ---------------------------------------------------------------- data

let pendingData = null;
let pendingMeta = null; // sync's bookkeeping for pendingData (null while signed out)
let dataTimer = null;
let restoring = false; // while true, saves from the page are ignored (a backup is being put back)

function loadData() {
  // A reload must never read a file that is older than the last save it sent.
  if (!restoring) flushData();
  restoring = false;
  const { value, from } = readJsonWithFallback(DATA_FILE());
  cloud.onLoadResult({ from: from === DATA_FILE() ? 'main' : from ? 'bak' : null, value, file: DATA_FILE() });
  if (from === DATA_FILE()) backup(DATA_FILE()); // session-start snapshot of a known-good file
  return value;
}

function flushData() {
  clearTimeout(dataTimer);
  dataTimer = null;
  if (!pendingData || restoring) return;
  let text;
  try {
    text = writeJsonAtomic(DATA_FILE(), pendingData);
  } catch (err) {
    console.error('[data] save failed:', err);
    return; // pendingData is kept: the next flush tries again
  }
  const written = pendingData;
  const meta = pendingMeta;
  pendingData = null;
  pendingMeta = null;
  cloud.onFileWritten(written, meta, text); // sync reads the board only as it is on disk
}

function scheduleDataWrite(data, meta) {
  // Signed in, a save acknowledging a sync patch never takes the place of the save waiting before it: that one
  // is written first, so sync sees what it held (a draft in a column the patch removes is backed up).
  if (meta?.ack && pendingData && cloud.active()) flushData();
  pendingData = data;
  pendingMeta = cloud.mergeSaveMeta(pendingMeta, meta);
  clearTimeout(dataTimer);
  dataTimer = setTimeout(flushData, 250);
}

// ---------------------------------------------------------------- window

function visibleBounds(bounds) {
  if (!bounds) return null;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width - 80 && bounds.x + bounds.width > a.x + 80 &&
    bounds.y < a.y + a.height - 40 && bounds.y + 40 > a.y);
  return onScreen ? bounds : null;
}

let boundsTimer = null;
function rememberBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    settings.maximized = win.isMaximized();
    // Mac: a full-screen frame is not the window's own size, so it isn't kept.
    if (!settings.maximized && !win.isMinimized() && !(IS_MAC && win.isFullScreen())) settings.bounds = win.getBounds();
    saveSettings();
  }, 400);
}

function createWindow() {
  const bounds = visibleBounds(settings.bounds);
  win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: 'Recaller',
    icon: ICON,
    backgroundColor: titleBar().color,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : titleBar(),
    // Mac: traffic lights centred in the 48 px top bar, and the click that brings Recaller forward also lands.
    ...(IS_MAC ? { trafficLightPosition: { x: 16, y: 16 }, acceptFirstMouse: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (settings.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  // Sync polls more often while Recaller is in front, and pulls when it comes back.
  for (const name of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.on(name, () => cloud.onWindowState());
  win.on('close', (e) => {
    flushData();
    settings.maximized = win.isMaximized();
    if (!settings.maximized && !win.isMinimized() && win.isVisible() && !(IS_MAC && win.isFullScreen())) settings.bounds = win.getBounds();
    saveSettings();
    // Mac: the red button and ⌘W only hide the window (the hotkey brings it back); ⌘Q quits.
    if (IS_MAC && !quitting) {
      e.preventDefault();
      if (win.isFullScreen()) {
        // Hiding a full-screen window leaves its Space behind as an empty black screen: leave full screen first.
        const w = win;
        w.once('leave-full-screen', () => { if (!w.isDestroyed()) w.hide(); });
        w.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });
  win.on('closed', () => {
    win = null;
    if (IS_MAC) flushData(); // ⌘Q: the page's last save (on beforeunload) arrives after 'close'
  });
  win.on('session-end', flushData); // Windows shutdown / sign-out
  win.on('session-end', () => { sessionEnding = true; });

  // Mac: full screen hides the traffic lights, so the page gives their space back to the top bar.
  if (IS_MAC) {
    const w = win;
    const fullScreen = (on) => {
      if (!w.isDestroyed()) w.webContents.send('app:command', on ? 'fullscreen-on' : 'fullscreen-off');
    };
    w.on('enter-full-screen', () => fullScreen(true));
    w.on('leave-full-screen', () => fullScreen(false));
    w.webContents.on('did-finish-load', () => fullScreen(w.isFullScreen()));
  }

  win.webContents.on('context-menu', (_e, params) => showContextMenu(params));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i') ||
      (IS_MAC && input.meta && input.alt && input.code === 'KeyI'); // ⌘⌥I (Option changes input.key)
    if (devtools && !app.isPackaged) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function showContextMenu(params) {
  const template = [];
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
    }
    template.push({
      label: 'Add to dictionary',
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    template.push({ type: 'separator' });
  }
  if (params.isEditable) {
    template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
  } else if (params.selectionText) {
    template.push({ role: 'copy' });
  }
  if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
}

function applyTheme() {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(titleBar().color);
  if (process.platform !== 'darwin') win.setTitleBarOverlay(titleBar());
}

function summon() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  if (IS_MAC) app.show(); // undo a ⌘H / app.hide() first
  win.show();
  if (IS_MAC) app.focus({ steal: true }); // the hotkey was pressed in another app: come to the front
  win.focus();
  cloud.onSummon();
  win.webContents.send('app:summoned');
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused() && !win.isMinimized()) {
    if (IS_MAC) app.hide(); // focus goes straight back to the previous app, so a paste lands there
    else win.minimize();
  } else {
    summon();
  }
}

// Global "screenshot to Recaller": snip first, then bring Recaller up with it.
async function screenshotFromAnywhere() {
  const onScreen = win && win.isVisible() && !win.isMinimized();
  const result = await screenshot.capture(onScreen ? win : null);
  // Mac: the snip made Recaller the active app; a cancel hands focus back. Never on BUSY (a snip is still up).
  if (IS_MAC && result.code === 'CANCELLED' && !onScreen) app.hide();
  if (result.code === 'CANCELLED' || result.code === 'BUSY') return;
  summon();
  if (IS_MAC) sendWhenLoaded('shot:captured', result);
  else win?.webContents.send('shot:captured', result);
}

function applyHotkeys() {
  globalShortcut.unregisterAll();
  const bind = (name, handler) => {
    hotkeyOk[name] = false;
    if (!settings[name]) return;
    try {
      hotkeyOk[name] = globalShortcut.register(settings[name], handler);
    } catch (err) {
      console.error('[hotkey] invalid accelerator:', settings[name], err.message);
    }
  };
  bind('hotkey', toggleWindow);
  bind('shotHotkey', screenshotFromAnywhere);
}

// ---------------------------------------------------------------- macOS menu

// Sends once the page is listening: a window created a moment ago is still loading.
function sendWhenLoaded(channel, payload) {
  if (!win || win.isDestroyed()) return;
  const contents = win.webContents;
  if (contents.isLoading()) contents.once('did-finish-load', () => contents.send(channel, payload));
  else contents.send(channel, payload);
}

// Brings the window up for a menu command. Not summon(): its 'app:summoned'
// would move focus to the search box.
function showForCommand() {
  if (!win) return createWindow();
  app.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function macMenu() {
  const command = (name) => () => {
    showForCommand();
    sendWhenLoaded('app:command', name);
  };
  // The page picks text undo in a field or its own history, so these leave the window alone. With the
  // window hidden (⌘W) or minimized, ⌘Z would change the board out of sight, so then they do nothing.
  const edit = (name) => () => {
    if (win && win.isVisible() && !win.isMinimized()) sendWhenLoaded('app:command', name);
  };
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: command('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { id: 'undo', label: 'Undo', accelerator: 'Command+Z', click: edit('undo') },
        { id: 'redo', label: 'Redo', accelerator: 'Shift+Command+Z', click: edit('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { label: 'Minimize', click: () => win?.minimize() }, // no ⌘M: in the page that is Dictate
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'Command+W', click: () => win?.close() }, // hides, see 'close'
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'How Recaller Works', click: command('help') }, // no accelerator: the page handles ?
      ],
    },
  ]);
}

// ---------------------------------------------------------------- updates & backups

// Before a new version touches anything, keep a copy of exactly what the old
// version left behind. Also keeps one rolling copy per day.
function protectData() {
  const current = app.getVersion();
  try {
    if (settings.lastVersion !== current) {
      backups.create('upgrade', { fromVersion: settings.lastVersion || 'earlier', toVersion: current });
      settings.lastVersion = current;
      saveSettings();
    }
    backups.dailyIfDue();
  } catch (err) {
    console.error('[backups]', err);
  }
}

function restoreBackup(id) {
  let restored;
  try {
    restored = backups.readData(id);
  } catch {
    return { ok: false, error: "That backup couldn't be read." };
  }
  if (!restored || !Array.isArray(restored.projects)) return { ok: false, error: "That backup couldn't be read." };
  flushData();
  backups.create('before-restore', { restoredFrom: id });
  cloud.onRestore(id); // signed in: the next sync is a union that deletes nothing from the account
  restoring = true;
  clearTimeout(dataTimer);
  pendingData = null;
  pendingMeta = null;
  writeJsonAtomic(DATA_FILE(), restored);
  setTimeout(() => win?.webContents.reload(), 50);
  return { ok: true };
}

// ---------------------------------------------------------------- IPC

// Clipboard writes are async; chain them so quick successive copies (e.g. a
// burst of Ctrl+clicks) can never finish out of order and leave an older text.
let clipboardQueue = Promise.resolve();
function inOrder(write) {
  const next = clipboardQueue.then(write);
  clipboardQueue = next.catch(() => {});
  return next;
}

function registerIpc() {
  ipcMain.handle('data:load', () => {
    cloud.onPageLoading();
    return loadData();
  });

  ipcMain.on('data:save', (_e, data, meta) => {
    if (restoring) return;
    if (data && typeof data === 'object' && Array.isArray(data.projects)) scheduleDataWrite(data, meta);
  });

  ipcMain.handle('clipboard:write', (_e, text) => inOrder(() => clipboard.writeText(String(text ?? ''))).then(() => true));

  ipcMain.handle('window:minimize', () => (IS_MAC ? app.hide() : win?.minimize())); // Mac: hide, like ⌘H

  ipcMain.handle('settings:get', () => publicSettings());

  ipcMain.handle('settings:set', (_e, patch = {}) => {
    if ('apiKey' in patch) setApiKey(patch.apiKey);
    for (const key of ['model', 'language', 'hint', 'hotkey', 'shotHotkey']) {
      if (typeof patch[key] === 'string') settings[key] = patch[key].trim();
    }
    if (typeof patch.hideAfterCopy === 'boolean') settings.hideAfterCopy = patch.hideAfterCopy;
    if (patch.theme in THEMES) {
      settings.theme = patch.theme;
      applyTheme();
    }
    if (!settings.model) settings.model = DEFAULT_SETTINGS.model;
    if ('hotkey' in patch || 'shotHotkey' in patch) applyHotkeys();
    saveSettings();
    return publicSettings();
  });

  ipcMain.handle('app:open-data-folder', () => shell.openPath(app.getPath('userData')));

  // Mac: opens the System Settings pane where a blocked permission is turned on.
  if (IS_MAC) {
    const PRIVACY_PANES = { microphone: 'Privacy_Microphone', screen: 'Privacy_ScreenCapture' };
    ipcMain.handle('app:open-privacy', async (_e, kind) => {
      if (typeof kind !== 'string' || !Object.hasOwn(PRIVACY_PANES, kind)) return false;
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + PRIVACY_PANES[kind]);
      return true;
    });
  }

  // ---- images
  ipcMain.handle('image:save', (_e, bytes) => {
    try {
      return { ok: true, image: images.storeBytes(bytes) };
    } catch (err) {
      console.error('[images] save failed:', err.message);
      return { ok: false, error: "That image couldn't be read." };
    }
  });

  ipcMain.handle('image:copy', async (_e, id) => {
    try {
      const write = (png) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
      if (cloud.active()) {
        // A picture from another computer may have to download first: in the queue, so a copy made after it
        // still lands last.
        await inOrder(async () => {
          await cloud.ensureImage(String(id), false);
          await write(images.readPng(String(id))); // clipboard.write is async: the next copy waits for it
        });
      } else {
        const png = images.readPng(String(id));
        await inOrder(() => write(png));
      }
      return true;
    } catch (err) {
      console.error('[images] copy failed:', err.message);
      return false;
    }
  });

  ipcMain.handle('images:gc', (_e, keepIds) => {
    const keep = new Set(Array.isArray(keepIds) ? keepIds : []);
    for (const id of backups.imageIds()) keep.add(id);
    return images.collectGarbage([...keep]);
  });

  ipcMain.handle('backups:list', () => backups.list());
  ipcMain.handle('backups:create', () => {
    flushData();
    return backups.create('manual');
  });
  ipcMain.handle('backups:restore', (_e, id) => restoreBackup(String(id)));

  ipcMain.handle('shot:capture', () => screenshot.capture(win));

  // ---- speech to text (partial text is streamed back as 'stt:event')
  ipcMain.handle('stt:transcribe', async (event, { reqId, bytes, mime, context } = {}) => {
    const send = (payload) => { if (!event.sender.isDestroyed()) event.sender.send('stt:event', { reqId, ...payload }); };
    try {
      const text = await transcribe(getApiKey(), bytes, String(mime || 'audio/webm'), {
        model: settings.model,
        language: settings.language,
        hint: settings.hint,
        context,
      }, {
        onDelta: (delta) => send({ type: 'delta', delta }),
        onReset: () => send({ type: 'reset' }),
      });
      return { ok: true, text };
    } catch (err) {
      console.error('[stt]', err.code || '', err.message);
      return { ok: false, code: err.code || 'UNKNOWN', error: err.message || 'Transcription failed.' };
    }
  });

  cloud.registerIpc(ipcMain); // account:* and sync:*; account:get answers even with accounts off
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', summon);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.akhan.recaller');
    loadSettings();
    protectData();
    cloud.init({
      app, ipcMain, safeStorage, userData: app.getPath('userData'), isPackaged: app.isPackaged, getWindow: () => win,
      images, backups, flushData, hasPendingWrite: () => pendingData !== null, isRestoring: () => restoring,
      // Uploaded as this computer's backup only, never applied elsewhere; never apiKey, bounds or lastVersion.
      getDeviceSettings: () => ({
        theme: settings.theme, model: settings.model, language: settings.language, hint: settings.hint,
        hotkey: settings.hotkey, shotHotkey: settings.shotHotkey, hideAfterCopy: settings.hideAfterCopy,
      }),
      // Signing out with "remove this board": saves are ignored, as during a restore, until the page loads again.
      holdSaves: () => {
        restoring = true;
        clearTimeout(dataTimer);
        pendingData = null;
        pendingMeta = null;
      },
      appVersion: app.getVersion(), platform: process.platform,
      onShutdown: () => { sessionEndingAt = Date.now(); }, // Mac: powerMonitor's shutdown, watched while signed in
    });
    // Mac: the app runs for days without restarting, so look for the day's backup every hour.
    if (IS_MAC) {
      setInterval(() => {
        flushData();
        try { backups.dailyIfDue(); } catch (err) { console.error('[backups]', err); }
      }, 60 * 60 * 1000);
    }

    if (process.platform === 'darwin') {
      app.setAboutPanelOptions({
        applicationName: 'Recaller',
        applicationVersion: app.getVersion(),
        credits: 'Your prompts and notes, one click away.',
      });
      Menu.setApplicationMenu(macMenu());
      // Run from source, the Dock would show Electron's icon.
      if (!app.isPackaged && fs.existsSync(MAC_ICON)) app.dock?.setIcon(MAC_ICON);
    } else {
      Menu.setApplicationMenu(null);
    }

    // Only the microphone (and clipboard writes) are ever granted.
    const allowed = new Set(['media', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    images.serve({ fetchMissing: cloud.ensureImage });
    registerIpc();
    applyHotkeys();
    createWindow();

    app.on('activate', () => {
      if (!win) createWindow();
      else if (IS_MAC && !win.isVisible()) summon(); // Dock click brings the hidden window back
    });
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => event.preventDefault());
  });

  app.on('before-quit', flushData);
  if (IS_MAC) app.on('before-quit', () => { quitting = true; });
  // Signed in with changes not yet uploaded: up to 1.5 s for them, once (app.quit() comes back here). Not while
  // the computer logs out or shuts down (macOS would say Recaller canceled it): they upload at the next start.
  let finalPushDone = false;
  app.on('before-quit', (e) => {
    if (finalPushDone || sessionEnding || Date.now() - sessionEndingAt < 60000 || !cloud.active() || !cloud.hasUnpushed()) return;
    e.preventDefault();
    finalPushDone = true;
    flushData();
    cloud.finalPush(1500).finally(() => app.quit());
  });
  app.on('will-quit', () => {
    if (IS_MAC) flushData(); // ⌘Q never reaches 'window-all-closed'
    globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', () => {
    flushData();
    if (process.platform !== 'darwin') app.quit();
  });
}
