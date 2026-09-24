'use strict';

const {
  app, BrowserWindow, ipcMain, clipboard, ClipboardItem, safeStorage, globalShortcut,
  session, shell, Menu, screen,
} = require('electron');
const path = require('node:path');
const { readJsonWithFallback, writeJsonAtomic, backup } = require('./store');
const { transcribe } = require('./transcribe');
const images = require('./images');
const screenshot = require('./screenshot');
const backups = require('./backups');

// Where notes live. Pinned explicitly so that no future change to the app's
// name or packaging can ever point a new version at a different (empty) folder.
if (process.env.RECALLER_DATA_DIR) app.setPath('userData', path.resolve(process.env.RECALLER_DATA_DIR));
else app.setPath('userData', path.join(app.getPath('appData'), 'Recaller'));
images.registerScheme();

const DATA_FILE = () => path.join(app.getPath('userData'), 'recaller-data.json');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'recaller-settings.json');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

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
  hotkey: 'CommandOrControl+Alt+R',
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
let dataTimer = null;
let restoring = false; // while true, saves from the page are ignored (a backup is being put back)

function loadData() {
  // A reload must never read a file that is older than the last save it sent.
  if (!restoring) flushData();
  restoring = false;
  const { value, from } = readJsonWithFallback(DATA_FILE());
  if (from === DATA_FILE()) backup(DATA_FILE()); // session-start snapshot of a known-good file
  return value;
}

function flushData() {
  clearTimeout(dataTimer);
  dataTimer = null;
  if (!pendingData || restoring) return;
  try {
    writeJsonAtomic(DATA_FILE(), pendingData);
    pendingData = null;
  } catch (err) {
    console.error('[data] save failed:', err);
  }
}

function scheduleDataWrite(data) {
  pendingData = data;
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
    if (!settings.maximized && !win.isMinimized()) settings.bounds = win.getBounds();
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
  win.on('close', () => {
    flushData();
    settings.maximized = win.isMaximized();
    if (!settings.maximized && !win.isMinimized() && win.isVisible()) settings.bounds = win.getBounds();
    saveSettings();
  });
  win.on('closed', () => { win = null; });
  win.on('session-end', flushData); // Windows shutdown / sign-out

  win.webContents.on('context-menu', (_e, params) => showContextMenu(params));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
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
  win.show();
  win.focus();
  win.webContents.send('app:summoned');
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused() && !win.isMinimized()) win.minimize();
  else summon();
}

// Global "screenshot to Recaller": snip first, then bring Recaller up with it.
async function screenshotFromAnywhere() {
  const onScreen = win && win.isVisible() && !win.isMinimized();
  const result = await screenshot.capture(onScreen ? win : null);
  if (result.code === 'CANCELLED' || result.code === 'BUSY') return;
  summon();
  win?.webContents.send('shot:captured', result);
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
  restoring = true;
  clearTimeout(dataTimer);
  pendingData = null;
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
  ipcMain.handle('data:load', () => loadData());

  ipcMain.on('data:save', (_e, data) => {
    if (restoring) return;
    if (data && typeof data === 'object' && Array.isArray(data.projects)) scheduleDataWrite(data);
  });

  ipcMain.handle('clipboard:write', (_e, text) => inOrder(() => clipboard.writeText(String(text ?? ''))).then(() => true));

  ipcMain.handle('window:minimize', () => win?.minimize());

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
      const png = images.readPng(String(id));
      await inOrder(() => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]));
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

    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
      Menu.setApplicationMenu(null);
    }

    // Only the microphone (and clipboard writes) are ever granted.
    const allowed = new Set(['media', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    images.serve();
    registerIpc();
    applyHotkeys();
    createWindow();

    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => event.preventDefault());
  });

  app.on('before-quit', flushData);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    flushData();
    if (process.platform !== 'darwin') app.quit();
  });
}
