'use strict';

(() => {
  const api = window.recaller;
  const I = window.ICONS;
  const Voice = window.Voice;
  const IS_MAC = api.platform === 'darwin'; // the Mac edition; on Windows everything runs as before

  // Gesture tuning
  const HOLD_MS = 240;       // press-and-hold before a card lifts for dragging
  const MOVE_SLOP = 7;       // px of movement before a press becomes a gesture
  const SWIPE_RATIO = 0.36;  // fraction of card width to swipe for delete
  // On a Mac (trackpad) a shorter swipe deletes: 22% of the card, at most 60 px. Windows keeps 36%.
  const swipeDistance = (width) => (IS_MAC ? Math.min(width * 0.22, 60) : width * SWIPE_RATIO);
  const EDGE = 64;           // auto-scroll zone while dragging
  const EDGE_SPEED = 18;
  const HISTORY_LIMIT = 80;

  // Listed in the order new projects pick them, so neighbours look different.
  // Ids are stored in the user's file: never rename one, only add new ones at the end.
  const PALETTE = [
    // 1.20.11: the four status colours (STATUS, below) are deep jewel tones, picked by the owner over
    // pastels (1.20.10, "too bright"). The other ids stay so columns that already carry them still draw.
    { id: 'monstera', name: 'Done', color: '#17694d' },
    { id: 'moss', name: 'Pending', color: '#24507f' },
    { id: 'sun', name: 'Working', color: '#8a6416' },
    { id: 'orchid', name: 'Orchid', color: '#9333ea' },
    { id: 'fern', name: 'Lime', color: '#65a30d' },
    { id: 'clay', name: 'Blossom', color: '#db2777' },
    { id: 'eucalyptus', name: 'Teal', color: '#0d9488' },
    { id: 'sage', name: 'Bark', color: '#78716c' },
    // added in 1.6
    { id: 'indigo', name: 'Indigo', color: '#4f46e5' },
    { id: 'ember', name: 'Ember', color: '#ea580c' },
    { id: 'lagoon', name: 'Lagoon', color: '#0891b2' },
    { id: 'ruby', name: 'Blocked', color: '#8e2f2f' },
    { id: 'forest', name: 'Forest', color: '#15803d' },
    { id: 'fuchsia', name: 'Fuchsia', color: '#c026d3' },
    { id: 'slate', name: 'Slate', color: '#475569' },
    { id: 'mustard', name: 'Mustard', color: '#a16207' },
    { id: 'navy', name: 'Navy', color: '#1e3a8a' },
    { id: 'wine', name: 'Wine', color: '#9f1239' },
  ];
  // 1.20.7: four column colours carry a meaning, shown as a legend in the top bar and named first in a
  // column's colour menu. Only the meaning is new: they are ordinary palette colours (ids unchanged).
  const STATUS = [
    { id: 'monstera', label: 'Done', meaning: 'Green: done, active or live' },
    { id: 'ruby', label: 'Blocked', meaning: 'Red: blocked, stopped or needs attention' },
    { id: 'moss', label: 'Pending', meaning: 'Blue: pending, needs work' },
    { id: 'sun', label: 'Working', meaning: 'Yellow: working on it now' },
  ];
  const DATA_VERSION = 2;
  const DENSITIES = ['compact', 'slim', 'roomy'];
  const THEMES = ['deep', 'soft'];
  const ANCHOR_MS = 2 * 60 * 1000;
  const HIGHLIGHTS = [
    { id: 'amber', name: 'Check again', color: '#f59e0b', bg: '#fff3d4' },
    { id: 'rose', name: 'Important', color: '#f43f5e', bg: '#ffe4e9' },
    { id: 'sky', name: 'Idea', color: '#0ea5e9', bg: '#dff3fd' },
    { id: 'lime', name: 'Ready', color: '#65a30d', bg: '#ecf6da' },
  ];
  const highlightOf = (note) => HIGHLIGHTS.find((h) => h.id === note.highlight) || null;

  // The three stages of a column, top to bottom. On screen (since 1.8) they are called:
  //   notes     — "Cooking": new prompts, one card each
  //   used      — "Cooked": the prompts moved down, joined into ONE note
  //   combined  — "Served": the final text; moving the Cooked note down appends it here
  // The on-screen names changed in 1.4, 1.6 and 1.8 (Used/Augmented → Combined/Final
  // → Cooked/Served). The data names were kept so existing notes load exactly as before.
  const LISTS = ['notes', 'used', 'combined'];
  const STAGE_NAME = { notes: 'Cooking', used: 'Cooked', combined: 'Served' };
  const STAGE_WHOLE = { used: 'Cooked note', combined: 'Served text' };
  const TITLE_FONTS = ['instrument', 'jakarta', 'onest', 'sora', 'space', 'inter', 'manrope', 'geist', 'caps'];
  const DEFAULT_TITLE_FONT = 'instrument';
  const titleFont = () => (TITLE_FONTS.includes(data.prefs.titleFont) ? data.prefs.titleFont : DEFAULT_TITLE_FONT);
  // Settings › Cooked colour (1.12; light palettes since 1.13). Stored in prefs.cookedColor only
  // when picked; a value from an older version (e.g. caramel) falls back to ocean when drawing.
  const COOKED_COLORS = ['ocean', 'teal', 'midnight', 'graphite'];
  const cookedColor = () => (COOKED_COLORS.includes(data.prefs.cookedColor) ? data.prefs.cookedColor : 'ocean');
  // Column widths: drag a column's edge; the top-bar button puts them all back to the default.
  const MIN_COL_W = 200;
  const MAX_COL_W = 900;
  // How notes are joined when combined (Cooked, Served, Ctrl+click): a blank line or a single new line.
  const joiner = () => (data.prefs.joiner === 'line' ? '\n' : '\n\n');
  const IMAGE_ID = /^[a-f0-9]{32}$/;

  // 1.18. Column groups: a project's `group` is the name of the group it sits in (synced, like the
  // name). Members are drawn together where the first one is; a folded group is marked on its members
  // (`groupFolded`, below). `minimized` folds one column to a slim strip; since 1.20 it syncs like the
  // name. 1.18–1.19 wrote `localMinimized` (per computer: keys starting with "local" never sync); it is
  // still read, and goes when the column is opened. `eating` is when "Eating" was switched on: an
  // agent is running that column's Served text.
  const groupOf = (p) => (typeof p.group === 'string' && p.group.trim() ? p.group.trim() : '');
  // 1.20.7: a folded group is marked on its members (`groupFolded: true`, synced like `minimized`), so
  // it is folded on every computer. 1.18–1.20.6 kept folds per computer in prefs.foldedGroups; init()
  // turns those into the flag once. A group is folded while any member carries the flag.
  // A column that leaves its group drops the flag (a stale one would fold the next group it joins).
  const foldedGroups = () => [...new Set(data.projects.filter((p) => p.groupFolded === true && groupOf(p)).map(groupOf))];
  const isEating = (p) => Number.isFinite(p.eating) && p.eating > 0;
  const isMinimized = (p) => p.minimized === true || p.localMinimized === true;

  // The notepad (1.20): one scratch page, kept as the first note of a hidden project marked
  // `notepad: true`, so it syncs like any note (a conflict keeps both texts). It is never drawn on the
  // board; an older Recaller shows it as an ordinary column named "Notepad".
  const isNotepad = (p) => p?.notepad === true;
  const boardProjects = () => data.projects.filter((p) => !isNotepad(p));
  // A new board order (from a drag or a move): the hidden notepad stays at the end.
  const setBoardOrder = (list) => { data.projects = list.concat(data.projects.filter(isNotepad)); };

  // Eaten (1.18): the rounds an agent finished. Done on an eating column moves its Served text here, newest
  // first: { id, project, name, color, text, images, parts, startedAt, doneAt }. Kept on this computer only
  // (a top-level "local" key never syncs), in the local backups, and undoable with the board.
  const EATEN_MAX = 300;
  const eatenList = () => (Array.isArray(data.localEaten)
    ? data.localEaten.filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.text === 'string')
    : []);
  function setEatenList(list) {
    if (list?.length) data.localEaten = list.slice(0, EATEN_MAX);
    else delete data.localEaten;
  }

  // The Cooked note as a Claude Code prompt (1.18, a fixed template: no AI involved). Only while the
  // column's `cookedFormat` is 'claude-code'; moving it to Served serves the formatted text.
  const CC_GUIDE = [
    '<how_to_work>',
    '- Read the relevant files first, and follow the existing code style and conventions.',
    '- If something is ambiguous, choose the most sensible reading, say which one, and carry on.',
    '- Keep the change focused on the request; leave unrelated code alone.',
    '- Check your work: run the tests or the app, and say what you verified.',
    "- Don't commit, push or delete anything unless the request asks for it.",
    '</how_to_work>',
    '',
    '<when_done>',
    'Reply with a short summary: one line per request item, what changed, and anything left open.',
    '</when_done>',
  ].join('\n');

  function claudeCodeText(parts) {
    const items = parts.map((t) => t.trim()).filter(Boolean);
    if (!items.length) return '';
    const body = items.length === 1
      ? items[0]
      : items.map((t, i) => `${i + 1}. ${t.replace(/\n/g, '\n   ')}`).join('\n\n');
    return `Complete the request below in this codebase.\n\n<request>\n${body}\n</request>\n\n${CC_GUIDE}`;
  }

  // ---- macOS (1.16 Mac edition). These only change anything when IS_MAC is true.

  // A Windows key label as a Mac writes it: 'Ctrl+Shift+S' → '⇧⌘S', 'Ctrl+Enter' → '⌘↩'.
  // On Windows the label comes back unchanged.
  function kb(label) {
    if (!IS_MAC) return label;
    if (label === 'Ctrl+Y') return '⇧⌘Z'; // a Mac redoes with ⇧⌘Z
    const parts = label.split('+');
    const key = parts.pop();
    // Apple's order is ⌃⌥⇧⌘; Ctrl on the PC is ⌘ on a Mac.
    const mods = (parts.includes('Alt') ? '⌥' : '') + (parts.includes('Shift') ? '⇧' : '') + (parts.includes('Ctrl') ? '⌘' : '');
    return mods + (key === 'Enter' ? '↩' : key);
  }

  // The app's shortcuts: ⌘ on a Mac, so ⌃K, ⌃F, ⌃N and ⌃M stay text-editing keys there.
  const modKey = (e) => (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey || e.metaKey);
  // Picking several cards: ⌘-click on a Mac, where Control+click is a right-click.
  const multiKey = (e) => (IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey);

  // Mac labels and titles from index.html (data-mac, data-mac-title), before anything is drawn.
  if (IS_MAC) {
    document.body.classList.add('is-mac');
    for (const node of document.querySelectorAll('[data-mac]')) node.textContent = node.dataset.mac;
    for (const node of document.querySelectorAll('[data-mac-title]')) node.title = node.dataset.macTitle;
  }

  // ================================================================ utilities

  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function uid() {
    try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const imgUrl = (id, thumb = false) => `recaller-img://img/${id}${thumb ? '.t' : ''}.png`;

  function relTime(ts) {
    if (!ts) return '';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Keeps `parent`'s children equal to `nodes`, in order, moving as little as possible
  // so focus, scroll and running animations survive re-renders.
  function syncChildren(parent, nodes) {
    let ref = parent.firstChild;
    for (const node of nodes) {
      if (node === ref) { ref = ref.nextSibling; continue; }
      parent.insertBefore(node, ref);
    }
    while (ref) {
      const next = ref.nextSibling;
      ref.remove();
      ref = next;
    }
  }

  // FLIP: animate `items` from where they were to where `mutate` puts them.
  function flip(items, mutate, duration = 200) {
    const first = new Map();
    for (const n of items) first.set(n, n.getBoundingClientRect());
    mutate();
    const moved = [];
    for (const n of items) {
      if (!n.isConnected) continue;
      n.style.transition = 'none';
      n.style.transform = '';
    }
    for (const n of items) {
      if (!n.isConnected) continue;
      const a = first.get(n);
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      n.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(n);
    }
    if (!moved.length) return;
    void document.body.offsetWidth;
    for (const n of moved) {
      n.style.transition = `transform ${duration}ms var(--ease)`;
      n.style.transform = '';
      clearTimeout(n._flipTimer);
      n._flipTimer = setTimeout(() => { n.style.transition = ''; }, duration + 30);
    }
  }

  async function imageFileToBytes(file) {
    if (file.type === 'image/png' || file.type === 'image/jpeg') return new Uint8Array(await file.arrayBuffer());
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ================================================================ data

  let data = { version: 2, prefs: { density: 'slim' }, projects: [] };
  const ui = {
    search: '',
    composing: null,   // project id with the "new prompt" composer open
    editing: null,     // note id being edited
    lastProjectId: null,
    settings: null,
    selection: [],     // note ids picked with Ctrl+click, in click order
    anchor: null,      // { id, at }: note just copied with a plain click; a following Ctrl+click includes it
    widget: false,     // 1.19: the window is the widget, showing one column (widgetId)
    widgetId: null,
  };
  const fresh = new Set(); // note ids to animate in on next render

  const colorOf = (p) => (PALETTE.find((c) => c.id === p.color) || PALETTE[0]).color;

  function makeNote(text, images = []) {
    const now = Date.now();
    return { id: uid(), text, images, createdAt: now, updatedAt: now, copied: 0, lastCopiedAt: 0, usedAt: 0 };
  }

  const cleanImages = (list) => (Array.isArray(list) ? list : [])
    .filter((i) => i && IMAGE_ID.test(i.id))
    .map((i) => ({ ...i, w: Number(i.w) || 0, h: Number(i.h) || 0 }));

  // Loading is lossless: fields this version doesn't know about (written by a
  // newer version, say) are carried through untouched, and user choices such as
  // colours or density are never rewritten, only interpreted when drawing.

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return null;
    const ids = new Set();
    const cleanId = (id) => {
      let v = typeof id === 'string' && id ? id : uid();
      if (ids.has(v)) v = uid();
      ids.add(v);
      return v;
    };
    const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
    const notes = (list) => (Array.isArray(list) ? list : [])
      .filter((n) => n && typeof n.text === 'string')
      .map((n) => ({
        ...n,
        id: cleanId(n.id),
        text: n.text,
        images: cleanImages(n.images),
        createdAt: num(n.createdAt, Date.now()),
        updatedAt: num(n.updatedAt, num(n.createdAt, Date.now())),
        copied: num(n.copied),
        lastCopiedAt: num(n.lastCopiedAt),
        usedAt: num(n.usedAt),
      }));
    const prefs = raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {};
    return {
      ...raw,
      version: Math.max(DATA_VERSION, Number(raw.version) || 0),
      prefs: { ...prefs, density: typeof prefs.density === 'string' ? prefs.density : 'slim' },
      projects: raw.projects.filter((p) => p && typeof p === 'object').map((p) => ({
        ...p,
        id: cleanId(p.id),
        name: typeof p.name === 'string' && p.name.trim() ? p.name : 'Untitled',
        color: typeof p.color === 'string' && p.color ? p.color : PALETTE[0].id,
        usedCollapsed: Boolean(p.usedCollapsed),
        augCollapsed: Boolean(p.augCollapsed),
        draft: typeof p.draft === 'string' ? p.draft : '',
        draftImages: cleanImages(p.draftImages),
        createdAt: num(p.createdAt, Date.now()),
        notes: notes(p.notes),
        used: notes(p.used),
        combined: notes(p.combined),
      })),
    };
  }

  function seedData() {
    const tips = [
      `Click a note to copy it, then paste anywhere with ${kb('Ctrl+V')}.`,
      `Swipe a note to the left (hold the mouse button and drag) to delete it. ${kb('Ctrl+Z')} brings it back.`,
      'Press and hold a note, then drag it down into “Cooked”. Drop it on another project to move it.',
      'Click Dictate next to New text to speak a prompt — text appears as you talk. Add your OpenAI key in Settings first.',
      'Tap the camera in the editor to snip part of your screen into a note. Click an image on a card to copy it.',
      `Hold ${IS_MAC ? '⌘' : 'Ctrl'} and click several notes to copy them all at once, with a blank line between each.`,
      'New prompts start in “Cooking”. Move them down into “Cooked” and they join into one note. Move that note down into “Served” (swipe it left, drag it, or click Move to Served) and it is added to the final text. Click either one to copy it; the pencil edits it.',
      'Hover a note and click the highlighter to colour-mark it, e.g. to check it again later.',
      'Drag the right edge of a column to make it wider or narrower. The top bar’s ☰ menu › Reset column widths puts every column back to the default width.',
      `${kb('Ctrl+K')} search · ${kb('Ctrl+N')} new prompt · ${kb('Ctrl+M')} dictate · ${kb('Ctrl+Shift+S')} screenshot · ${kb('Ctrl+Z')} undo`,
    ];
    return {
      version: 2,
      prefs: { density: 'slim' },
      projects: [{
        id: uid(), name: 'Welcome', color: 'monstera', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: Date.now(),
        notes: tips.map((t) => makeNote(t)), used: [], combined: [],
      }],
    };
  }

  // The second argument is for sync (see the sync section); main ignores it while signed out.
  function persist(extra = {}) {
    try {
      api.saveData(data, { session: SESSION, seq: ++saveSeq, contentSeq, labels: pendingLabels.splice(0), ...extra });
    } catch (err) {
      console.error('save failed', err);
      toast('Could not save your changes.');
    }
  }

  let draftTimer = null;
  function persistSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persist, 400);
  }

  // A Mac quits with ⌘Q before that timer fires, which would lose the last keystrokes of a draft:
  // send the waiting save now.
  if (IS_MAC) {
    window.addEventListener('beforeunload', () => {
      if (!draftTimer) return;
      clearTimeout(draftTimer);
      persist();
    });
  }

  const findProject = (id) => data.projects.find((p) => p.id === id);

  function locate(noteId) {
    for (const project of data.projects) {
      for (const list of LISTS) {
        const index = project[list].findIndex((n) => n.id === noteId);
        if (index >= 0) return { project, list, index, note: project[list][index] };
      }
    }
    return null;
  }

  function referencedImageIds() {
    const ids = [];
    for (const p of data.projects) {
      for (const n of p.notes.concat(p.used, p.combined)) n.images.forEach((i) => ids.push(i.id));
      p.draftImages.forEach((i) => ids.push(i.id));
    }
    for (const round of eatenList()) for (const i of cleanImages(round.images)) ids.push(i.id);
    return ids;
  }

  // ================================================================ undo / redo
  // Snapshot-based: before each change we store the projects as JSON. Live
  // counters (copy counts), drafts and collapsed state are carried over on
  // restore so undo only rewinds what the user actually did.

  const history = { undo: [], redo: [] };
  const snapshot = () => JSON.stringify(data.projects);

  // Each entry also holds the Eaten list as it was (1.18): its rounds are never changed in place,
  // so a copy of the array is enough, and Done / Serve again undo together with the board.
  function pushHistory(label, snap, eaten = eatenList()) {
    contentSeq++; // every checkpointed edit, dragEnd's included: a sync patch from before it is stale
    pendingLabels.push(label);
    history.undo.push({ label, snap, eaten });
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo.length = 0;
    dismissHistoryToasts();
    paintHistory();
  }

  const checkpoint = (label) => pushHistory(label, snapshot());

  // `restore` names carried-over keys the snapshot should rewind after all (Done puts Eating back on).
  function applySnapshot(snap, restore = []) {
    const next = normalize({ projects: JSON.parse(snap) });
    const liveProjects = new Map(data.projects.map((p) => [p.id, p]));
    const liveNotes = new Map();
    for (const p of data.projects) for (const n of p.notes.concat(p.used, p.combined)) liveNotes.set(n.id, n);
    const nextNoteIds = new Set();
    for (const p of next.projects) {
      const live = liveProjects.get(p.id);
      if (live) {
        p.draft = live.draft;
        p.draftImages = live.draftImages;
        p.notesCollapsed = live.notesCollapsed;
        p.usedCollapsed = live.usedCollapsed;
        p.augCollapsed = live.augCollapsed;
        p.augExpanded = live.augExpanded;
        p.usedExpanded = live.usedExpanded;
        // Eating and a minimized column are states, not edits: undo leaves them as they are.
        for (const k of ['eating', 'minimized', 'localMinimized', 'groupFolded']) {
          if (restore.includes(k)) continue;
          if (live[k] !== undefined) p[k] = live[k];
          else delete p[k];
        }
        if (p.groupFolded !== undefined && !groupOf(p)) delete p.groupFolded;
      }
      for (const n of p.notes.concat(p.used, p.combined)) {
        nextNoteIds.add(n.id);
        const ln = liveNotes.get(n.id);
        if (ln) {
          n.copied = ln.copied;
          n.lastCopiedAt = ln.lastCopiedAt;
          n.expanded = ln.expanded;
        } else {
          fresh.add(n.id);
        }
      }
    }
    // The notepad is typed like a draft, outside the board's history: undo leaves it as it is now.
    data.projects = next.projects.filter((p) => !isNotepad(p)).concat(data.projects.filter(isNotepad));
    if (ui.editing && !nextNoteIds.has(ui.editing)) ui.editing = null;
    if (ui.composing && !findProject(ui.composing)) ui.composing = null;
    persist();
    render();
  }

  function undo() {
    const entry = history.undo.pop();
    if (!entry) {
      toast('Nothing to undo');
      return;
    }
    if (ui.editing) stopEditing();
    closeStageEditors();
    history.redo.push({ label: entry.label, snap: snapshot(), eaten: eatenList(), restore: entry.restore });
    contentSeq++;
    pendingLabels.push('Undo');
    setEatenList(entry.eaten);
    applySnapshot(entry.snap, entry.restore);
    paintHistory();
    dismissHistoryToasts();
    toast(`Undone: ${entry.label}`, { action: 'Redo', onAction: redo, history: true });
  }

  function redo() {
    const entry = history.redo.pop();
    if (!entry) return;
    if (ui.editing) stopEditing();
    closeStageEditors();
    history.undo.push({ label: entry.label, snap: snapshot(), eaten: eatenList(), restore: entry.restore });
    contentSeq++;
    pendingLabels.push('Redo');
    setEatenList(entry.eaten);
    applySnapshot(entry.snap, entry.restore);
    paintHistory();
    dismissHistoryToasts();
    toast(`Redone: ${entry.label}`, { action: 'Undo', onAction: undo, history: true });
  }

  const undoBtn = $('#undo');
  const redoBtn = $('#redo');
  function paintHistory() {
    const u = history.undo[history.undo.length - 1];
    const r = history.redo[history.redo.length - 1];
    undoBtn.disabled = !u;
    redoBtn.disabled = !r;
    undoBtn.title = u ? `Undo ${u.label.toLowerCase()} (${kb('Ctrl+Z')})` : 'Nothing to undo';
    redoBtn.title = r ? `Redo ${r.label.toLowerCase()} (${kb('Ctrl+Y')})` : 'Nothing to redo';
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // ================================================================ search

  function parseQuery(raw) {
    const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
    return { terms, key: terms.join(' ') };
  }

  function matches(note, query) {
    if (!query.terms.length || note.id === ui.editing) return true;
    const text = note.text.toLowerCase();
    return query.terms.every((t) => text.includes(t));
  }

  function highlight(text, query) {
    if (!query.terms.length) return escapeHtml(text);
    const lower = text.toLowerCase();
    const ranges = [];
    for (const term of query.terms) {
      let i = lower.indexOf(term);
      while (i !== -1) {
        ranges.push([i, i + term.length]);
        i = lower.indexOf(term, i + term.length);
      }
    }
    if (!ranges.length) return escapeHtml(text);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r);
    }
    let out = '';
    let pos = 0;
    for (const [s, e] of merged) {
      out += escapeHtml(text.slice(pos, s)) + '<mark>' + escapeHtml(text.slice(s, e)) + '</mark>';
      pos = e;
    }
    return out + escapeHtml(text.slice(pos));
  }

  // ================================================================ views

  const board = $('#board');
  const columns = new Map(); // project id -> column view
  const cards = new Map();   // note id -> card view
  let dragActive = false;
  let resizing = null;       // column view whose width is being dragged

  const addColumnEl = el('button', 'add-column', `${I.plus}<span>New project</span>`);
  addColumnEl.addEventListener('click', () => createProject());
  // 1.18: the same from the top bar, so a new column doesn't need a scroll to the end of the board.
  $('#new-column').addEventListener('click', () => createProject());

  const emptyEl = el('div', 'empty-board', `
    <svg><use href="#monstera"/></svg>
    <h1>Plant your first project</h1>
    <p>Projects are columns. Prompts and notes live inside them.</p>
    <button class="btn btn-primary">${I.plus}<span>New project</span></button>`);
  emptyEl.querySelector('button').addEventListener('click', () => createProject());

  function createColumn(project) {
    const root = el('section', 'column');
    root.dataset.id = project.id;
    root.innerHTML = `
      <header class="col-head">
        <svg class="col-leaf"><use href="#monstera"/></svg>
        <h2 class="col-name"></h2>
        <button class="head-btn col-quick col-pad" title="This column's notepad" aria-label="This column's notepad">${I.pad}</button>
        <button class="head-btn col-quick col-min" title="Minimize column" aria-label="Minimize column">${I.minimize}</button>
        <span class="col-mini" aria-hidden="true"><span class="mini-eat"></span><span class="mini-count"></span></span>
        <button class="head-btn col-menu" title="Project options" aria-label="Project options">${I.more}</button>
      </header>
      <div class="cook-headrow">
        <button class="cook-head" title="Cooking: prompts you're still working on"><span class="chev">${I.chevron}</span>${I.flame}<span>Cooking</span><span class="cook-count"></span></button>
      </div>
      <div class="col-new">
        <button class="new-prompt col-add"><span class="np-icon">${I.plus}</span><span class="np-label"><span class="lbl-long">New text</span><span class="lbl-short">New</span><span class="lbl-draft">Draft</span></span></button>
        <button class="new-prompt new-voice col-mic" title="Dictate a new prompt (${kb('Ctrl+M')})" aria-label="Dictate a new prompt"><span class="np-icon">${I.mic}</span><span class="np-label">Dictate</span></button>
      </div>
      <div class="col-compose"></div>
      <div class="col-scroll">
        <div class="list active-list"></div>
        <div class="list-empty active-empty"><span class="empty-text"></span></div>
        <section class="used is-empty">
          <div class="used-headrow">
            <button class="used-head" title="Prompts moved here join into one note"><span class="chev">${I.chevron}</span>${I.layers}<span>Cooked</span><span class="used-count"></span></button>
          </div>
          <div class="aug-wrap">
            <div class="aug-under">${I.used}<b>Move to Served</b></div>
            <div class="aug-note" tabindex="0" title="Click to copy · swipe left or drag onto Served to move it down">
              <div class="aug-text"></div>
              <button class="aug-more stage-more" hidden></button>
              <div class="aug-images stage-images" hidden></div>
              <div class="aug-foot"><span class="aug-stats"></span><span class="spacer"></span><button class="aug-parts-btn">Notes</button><button class="aug-cc" aria-pressed="false">${I.terminal}</button><button class="aug-edit" title="Edit the cooked note" aria-label="Edit the cooked note">${I.edit}</button></div>
              <div class="aug-parts" hidden></div>
            </div>
          </div>
          <button class="aug-move" title="Add this note to the end of Served">${I.arrowDown}<span>Move to Served</span></button>
          <div class="aug-empty">Move prompts here and they join into one note</div>
        </section>
        <section class="final" hidden>
          <div class="final-head">
            <button class="final-toggle" title="Served: the final text, every note added from Cooked, joined"><span class="chev">${I.chevron}</span>${I.used}<span>Served</span></button>
            <button class="eat-btn" aria-pressed="false"><span class="eat-dot"></span>${I.utensils}<span class="eat-label"><span class="eat-btn-word">Eating</span><span class="eat-btn-time"></span></span></button>
          </div>
          <div class="final-body">
            <div class="final-text" title="Click to copy it all"></div>
            <button class="final-more stage-more" hidden></button>
            <div class="final-images stage-images" hidden></div>
            <div class="final-empty">Move the Cooked note down to add it here</div>
            <div class="final-foot"><span class="final-stats"></span><span class="spacer"></span><button class="final-parts-btn">Notes</button><button class="final-edit" title="Edit the served text" aria-label="Edit the served text">${I.edit}</button></div>
            <div class="final-parts" hidden></div>
          </div>
          <div class="final-edit-host"></div>
        </section>
      </div>
      <div class="col-resize" title="Drag to resize · double-click for the default width"></div>`;
    return {
      id: project.id,
      root,
      head: $('.col-head', root),
      nameEl: $('.col-name', root),
      cookHead: $('.cook-head', root),
      countEl: $('.cook-count', root),
      addBtn: $('.col-add', root),
      newRow: $('.col-new', root),
      composeHost: $('.col-compose', root),
      scroll: $('.col-scroll', root),
      activeList: $('.active-list', root),
      emptyText: $('.empty-text', root),
      usedSection: $('.used', root),
      usedHead: $('.used-head', root),
      usedCount: $('.used-count', root),
      augWrap: $('.aug-wrap', root),
      augNote: $('.aug-note', root),
      augText: $('.aug-text', root),
      augStats: $('.aug-stats', root),
      augMore: $('.aug-more', root),
      augImages: $('.aug-images', root),
      augParts: $('.aug-parts', root),
      augPartsBtn: $('.aug-parts-btn', root),
      augMoveBtn: $('.aug-move', root),
      augCcBtn: $('.aug-cc', root),
      eatBtn: $('.eat-btn', root),
      eatTime: $('.eat-btn-time', root),
      miniCount: $('.mini-count', root),
      padBtn: $('.col-pad', root),
      augSig: null,
      // Cooked and Served always start at their fixed size; "Show more" opens them up
      // for the session only. (Older versions saved that as usedExpanded / augExpanded;
      // those flags are left in the file untouched but no longer read.)
      augExpanded: false,
      augPartsOpen: false,
      finalSection: $('.final', root),
      finalHead: $('.final-head', root),
      finalBody: $('.final-body', root),
      finalText: $('.final-text', root),
      finalStats: $('.final-stats', root),
      finalMore: $('.final-more', root),
      finalImages: $('.final-images', root),
      finalParts: $('.final-parts', root),
      finalPartsBtn: $('.final-parts-btn', root),
      finalEditHost: $('.final-edit-host', root),
      finalSig: null,
      finalExpanded: false,
      partsOpen: false,
      stageEditor: null, // { list, partId, composer }: editing the Cooked note or the Served text
      composer: null,
      renaming: false,
    };
  }

  function createCard(note) {
    const root = el('div', 'card-wrap');
    root.dataset.id = note.id;
    root.innerHTML = `
      <div class="card-under"><span class="under-delete">${I.trash}</span></div>
      <span class="sel-badge"></span>
      <article class="card" tabindex="0">
        <div class="card-text"></div>
        <div class="card-images" hidden></div>
        <div class="card-meta"><span class="card-hl-tag"></span><span class="card-sync-tag"></span><span class="card-time"></span><span class="card-copies"></span><button class="card-more" hidden>Show more</button></div>
        <div class="card-actions">
          <button class="card-act act-hl" title="Highlight (H)" aria-label="Highlight">${I.highlighter}</button>
          <button class="card-act act-used act-primary" title="Move to Cooked (U)" aria-label="Move to Cooked">${I.arrowDown}<span>Cooked</span></button>
        </div>
      </article>`;
    if (fresh.has(note.id)) {
      fresh.delete(note.id);
      root.classList.add('is-new');
      root.addEventListener('animationend', () => root.classList.remove('is-new'), { once: true });
    }
    return {
      id: note.id,
      root,
      card: $('.card', root),
      textEl: $('.card-text', root),
      imagesEl: $('.card-images', root),
      timeEl: $('.card-time', root),
      copiesEl: $('.card-copies', root),
      moreBtn: $('.card-more', root),
      hlTag: $('.card-hl-tag', root),
      syncTag: $('.card-sync-tag', root),
      selBadge: $('.sel-badge', root),
      sig: '',
      expanded: Boolean(note.expanded),
      editor: null,
    };
  }

  function renderCardImages(view, images) {
    const box = view.imagesEl;
    box.hidden = !images.length;
    box.classList.toggle('is-single', images.length === 1);
    box.innerHTML = images.slice(0, 3).map((img, i) => `
      <div class="card-img" data-img="${img.id}" title="Click to copy image">
        <img src="${imgUrl(img.id, true)}" alt="" draggable="false" loading="lazy" />
        ${i === 2 && images.length > 3 ? `<span class="more">+${images.length - 3}</span>` : ''}
        <button class="img-expand" title="View full size" aria-label="View full size">${I.expand}</button>
      </div>`).join('');
  }

  // The pictures of every note in Cooked or Served, in order, shown as a strip under the text.
  // Clicking one copies it (the text is copied on its own; see copyStageImage).
  function stageImages(notes) {
    const seen = new Set();
    return notes.flatMap((n) => n.images).filter((img) => !seen.has(img.id) && seen.add(img.id));
  }

  function renderStageImages(box, images) {
    box.hidden = !images.length;
    box.innerHTML = images.map((img) => `
      <div class="card-img" data-img="${img.id}" title="Click to copy this image">
        <img src="${imgUrl(img.id, true)}" alt="" draggable="false" loading="lazy" />
        <button class="img-expand" title="View full size" aria-label="View full size">${I.expand}</button>
      </div>`).join('');
  }

  const toMeasure = new Set();

  function updateCard(view, note, query) {
    view.timeEl.textContent = relTime(note.updatedAt || note.createdAt);
    const imageKey = note.images.map((i) => i.id).join(',');
    const hl = highlightOf(note);
    const syncTip = note.syncConflict ? syncTagTitle(note.syncConflict) : ''; // a conflict copy from sync
    const sig = `${note.text}\u0001${query.key}\u0001${view.expanded}\u0001${note.copied}\u0001${imageKey}\u0001${hl?.id ?? ''}\u0001${syncTip}`;
    if (sig === view.sig) return;
    const imagesChanged = !view.sig || view.imageKey !== imageKey;
    view.sig = sig;
    view.imageKey = imageKey;
    view.textEl.innerHTML = highlight(note.text, query);
    if (imagesChanged) renderCardImages(view, note.images);
    view.copiesEl.textContent = note.copied ? `· copied ${note.copied}×` : '';
    view.root.classList.toggle('is-expanded', view.expanded);
    view.root.classList.toggle('is-hl', Boolean(hl));
    if (hl) {
      view.root.style.setProperty('--hl', hl.color);
      view.root.style.setProperty('--hl-bg', hl.bg);
    }
    view.hlTag.textContent = hl ? hl.name : '';
    view.syncTag.textContent = syncTip ? 'Other version' : '';
    if (view.syncTag.title !== syncTip) view.syncTag.title = syncTip;
    toMeasure.add(view);
  }

  const augToMeasure = new Set();

  function measureCards() {
    for (const col of augToMeasure) {
      if (!col.root.isConnected) continue;
      const augOver = col.augText.scrollHeight > col.augText.clientHeight + 2;
      paintMore(col.augMore, col.augExpanded, augOver);
      col.augText.classList.toggle('fits', !augOver && !col.augExpanded);
      const overflowing = col.finalText.scrollHeight > col.finalText.clientHeight + 2;
      paintMore(col.finalMore, col.finalExpanded, overflowing);
      col.finalText.classList.toggle('fits', !overflowing && !col.finalExpanded);
    }
    augToMeasure.clear();
    for (const view of toMeasure) {
      if (!view.root.isConnected) continue;
      const overflowing = view.textEl.scrollHeight > view.textEl.clientHeight + 2;
      view.moreBtn.hidden = !(view.expanded || overflowing);
      view.moreBtn.textContent = view.expanded ? 'Show less' : 'Show more';
    }
    toMeasure.clear();
  }

  // The slim "Show more / Show less" bar under the Cooked note and the Served text.
  function paintMore(btn, expanded, overflowing) {
    btn.hidden = !(expanded || overflowing);
    btn.classList.toggle('is-open', expanded);
    btn.innerHTML = `${I.chevron}<span>${expanded ? 'Show less' : 'Show more'}</span>`;
  }

  // After a column changes width, the "Show more" buttons need checking again.
  function remeasure(cols = [...columns.values()]) {
    for (const col of cols) {
      if (!col) continue;
      augToMeasure.add(col);
      for (const view of cards.values()) if (view.projectId === col.id) toMeasure.add(view);
    }
    requestAnimationFrame(measureCards);
  }

  const hitsAll = (text, query) => query.terms.length > 0 && query.terms.every((t) => text.toLowerCase().includes(t));

  // The Notes list under the Cooked note and the Served text: one row per part,
  // with buttons to reorder it, edit it on its own, send it back up a stage, or delete it.
  // A note id can come from the account (1.17), so it is escaped like any text.
  function partsHtml(notes, query, back) {
    return notes.map((note, i) => `
      <div class="final-part" data-id="${escapeHtml(note.id)}">
        <span class="fp-num">${i + 1}</span>
        <span class="fp-text">${highlight(note.text.split('\n')[0] || '(image)', query)}</span>
        <span class="fp-acts">
          <button class="fp-up" title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${I.arrowUp}</button>
          <button class="fp-down" title="Move down" aria-label="Move down"${i === notes.length - 1 ? ' disabled' : ''}>${I.arrowDown}</button>
          <button class="fp-edit" title="Edit this note" aria-label="Edit this note">${I.edit}</button>
          <button class="${back.cls}" title="${back.title}" aria-label="${back.title}">${I.restore}</button>
          <button class="fp-del" title="Delete this note" aria-label="Delete this note">${I.trash}</button>
        </span>
      </div>`).join('');
  }

  function syncList(listEl, notes, project, query, seen) {
    const nodes = [];
    for (const note of notes) {
      let view = cards.get(note.id);
      if (!view) {
        view = createCard(note);
        cards.set(note.id, view);
      }
      seen.add(note.id);
      view.projectId = project.id;
      updateCard(view, note, query);
      const order = ui.selection.indexOf(note.id);
      view.root.classList.toggle('is-selected', order >= 0);
      if (order >= 0) view.selBadge.textContent = String(order + 1);
      nodes.push(view.root);
    }
    syncChildren(listEl, nodes);
  }

  function updateColumn(col, project, query, seen) {
    col.root.style.setProperty('--accent', colorOf(project));
    const minimized = isMinimized(project) && !ui.widget; // the widget always shows its column open
    col.root.classList.toggle('is-minimized', minimized);
    col.root.classList.toggle('is-eating', isEating(project));
    col.miniCount.textContent = String(project.notes.length + project.used.length);
    col.head.title = minimized ? `${project.name} · click to open the column, drag to move it` : '';
    // 1.20.7: the column's notepad button stays visible once its page has text, and looks pressed while open
    const padText = Boolean(columnPad(project.id)?.note.text.trim());
    col.padBtn.classList.toggle('has-pad', padText);
    col.padBtn.classList.toggle('is-open', isNotepadOpen() && notepadFor === project.id);
    col.padBtn.title = padText ? `${project.name}: notepad` : `Notepad for ${project.name}`;
    if (resizing !== col) {
      const w = colWidth(project.id);
      const width = w ? `${w}px` : '';
      if (col.root.style.width !== width) col.root.style.width = width;
      col.root.classList.toggle('is-resized', Boolean(w));
    }
    if (!col.renaming && col.nameEl.textContent !== project.name) {
      col.nameEl.textContent = project.name;
      col.nameEl.title = `${project.name} · double-click to rename, drag to reorder`;
    }

    const active = project.notes.filter((n) => matches(n, query));
    const searching = query.terms.length > 0;
    col.countEl.textContent = searching ? `· ${active.length}/${project.notes.length}` : project.notes.length ? `· ${project.notes.length}` : '';
    // Cooking can be collapsed like the other stages (a search always shows the matches).
    col.root.classList.toggle('cooking-collapsed', Boolean(project.notesCollapsed) && !searching);
    col.usedCount.textContent = project.used.length ? `· ${project.used.length}` : '';
    col.emptyText.textContent = searching ? 'No matches' : 'Nothing cooking yet. Click New text or Dictate.';
    col.usedSection.classList.toggle('is-collapsed', project.usedCollapsed);

    // The composer survives re-renders; it's only created/destroyed here.
    const composing = ui.composing === project.id;
    if (composing && !col.composer) {
      col.composer = createComposer({
        text: project.draft,
        images: project.draftImages,
        placeholder: 'Type a prompt, tap the mic, or paste a screenshot…',
        closeLabel: 'Close',
        allowClear: true,
        onDraft: (text, images) => {
          const p = findProject(col.id);
          if (!p) return;
          p.draft = text;
          p.draftImages = images;
          persistSoon();
        },
        onSave: (text, images) => {
          addNote(col.id, text, images);
          closeComposer('', []); // saved: the editor closes and New prompt | Dictate come back
        },
        onCancel: (text, images) => closeComposer(text, images),
      });
      col.composeHost.appendChild(col.composer.root);
    } else if (!composing && col.composer) {
      col.composer.destroy();
      col.composer.root.remove();
      col.composer = null;
    }
    const hasDraft = Boolean(project.draft.trim() || project.draftImages.length);
    col.addBtn.classList.toggle('has-draft', hasDraft && !composing);
    col.addBtn.title = hasDraft ? `Resume draft (${kb('Ctrl+N')})` : `New text (${kb('Ctrl+N')})`;
    col.newRow.hidden = composing;

    syncList(col.activeList, active, project, query, seen);

    // Cooked (data `used`): the prompts moved here, joined into one note in the order they were added.
    // A search also highlights matches here, and opens the text up if it matches.
    const augText = cookedText(project);
    const nAug = project.used.length;
    const augEditing = col.stageEditor?.list === 'used';
    const cc = isClaudeCode(project);
    col.usedSection.classList.toggle('is-empty', !nAug);
    col.usedSection.classList.toggle('is-cc', cc);
    col.augCcBtn.hidden = !augmentedText(project);
    col.augCcBtn.setAttribute('aria-pressed', String(cc));
    col.augCcBtn.title = cc ? 'Formatted for Claude Code · click for the original text' : 'Format for Claude Code (a task structure around your prompts; click again for the original)';
    col.usedSection.classList.toggle('is-expanded', col.augExpanded || hitsAll(augText, query));
    col.usedSection.classList.toggle('is-editing', augEditing);
    col.augMoveBtn.hidden = !nAug || augEditing;
    const augImages = stageImages(project.used);
    const augSig = `${augText}\u0001${project.used.map((n) => n.id).join(',')}\u0001${augImages.map((i) => i.id).join(',')}\u0001${col.augPartsOpen}\u0001${query.key}`;
    if (col.augSig !== augSig) {
      col.augSig = augSig;
      col.augText.innerHTML = highlight(augText, query);
      renderStageImages(col.augImages, augImages);
      const words = augText.trim() ? augText.trim().split(/\s+/).length : 0;
      col.augStats.textContent = cc ? 'Claude Code' : `${nAug} prompt${nAug === 1 ? '' : 's'} · ${words.toLocaleString()} words`;
      col.augParts.hidden = !col.augPartsOpen;
      col.augPartsBtn.setAttribute('aria-pressed', String(col.augPartsOpen));
      col.augPartsBtn.title = col.augPartsOpen ? 'Hide the separate notes' : 'Show the separate notes: reorder, edit, send back or delete one';
      col.augParts.innerHTML = partsHtml(project.used, query, { cls: 'ap-back fp-back', title: 'Send back to Cooking' });
      augToMeasure.add(col);
    }

    // Served (data `combined`): the exact text of every note added to it, in order.
    const combined = finalText(project);
    col.finalSection.hidden = !(project.used.length || project.combined.length);
    col.finalSection.classList.toggle('is-collapsed', project.augCollapsed);
    col.finalSection.classList.toggle('is-expanded', col.finalExpanded || hitsAll(combined, query));
    col.finalSection.classList.toggle('is-empty', !project.combined.length);
    col.finalSection.classList.toggle('is-editing', col.stageEditor?.list === 'combined');
    // Eating: shown once something is served, or while it is on.
    const eating = isEating(project);
    col.eatBtn.hidden = !(project.combined.length || eating);
    col.eatBtn.setAttribute('aria-pressed', String(eating));
    // the time has its own span, so a narrow column can drop the word "Eating" and keep the time
    col.eatTime.textContent = eating ? eatFor(project.eating) : '';
    col.eatBtn.title = eating
      ? 'An agent is running this served prompt · click when it is done'
      : 'Mark as Eating: an agent is running this served prompt';
    const finalImages = stageImages(project.combined);
    const sig = `${combined}\u0001${project.combined.map((n) => n.id).join(',')}\u0001${finalImages.map((i) => i.id).join(',')}\u0001${col.partsOpen}\u0001${query.key}`;
    if (col.finalSig !== sig) {
      col.finalSig = sig;
      col.finalText.innerHTML = highlight(combined, query);
      renderStageImages(col.finalImages, finalImages);
      const n = project.combined.length;
      const words = combined.trim() ? combined.trim().split(/\s+/).length : 0;
      col.finalStats.textContent = `${n} note${n === 1 ? '' : 's'} · ${words.toLocaleString()} words`;
      col.finalParts.hidden = !col.partsOpen;
      col.finalPartsBtn.setAttribute('aria-pressed', String(col.partsOpen));
      col.finalPartsBtn.title = col.partsOpen ? 'Hide the separate notes' : 'Show the separate notes: reorder, edit, send back or delete one';
      col.finalParts.innerHTML = partsHtml(project.combined, query, { cls: 'fp-back', title: 'Send back to Cooked' });
      augToMeasure.add(col);
    }
  }

  const augmentedText = (project) => project.used.map((n) => n.text).filter((t) => t.trim()).join(joiner());
  const finalText = (project) => project.combined.map((n) => n.text).filter((t) => t.trim()).join(joiner());
  const isClaudeCode = (project) => project.cookedFormat === 'claude-code' && project.used.length > 0;
  // What the Cooked note shows and copies: its prompts as they are, or formatted for Claude Code.
  const cookedText = (project) => (isClaudeCode(project) ? claudeCodeText(project.used.map((n) => n.text)) : augmentedText(project));

  // "now", "7m", "1h 4m": how long something has been going (or went on for)
  function spanText(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  const eatFor = (since) => spanText(Date.now() - since);

  function render() {
    if (dragActive) return;
    document.body.classList.remove(...DENSITIES.map((d) => `density-${d}`));
    document.body.classList.add(`density-${DENSITIES.includes(data.prefs.density) ? data.prefs.density : 'slim'}`);
    document.body.classList.remove(...TITLE_FONTS.map((t) => `title-${t}`));
    document.body.classList.add(`title-${titleFont()}`);
    document.body.classList.remove(...COOKED_COLORS.map((c) => `cooked-${c}`));
    document.body.classList.add(`cooked-${cookedColor()}`);
    ui.selection = ui.selection.filter((id) => locate(id)?.list === 'notes');
    const query = parseQuery(ui.search);
    const seen = new Set();
    const nodes = [];
    const columnNode = (project) => {
      let col = columns.get(project.id);
      if (!col) {
        col = createColumn(project);
        columns.set(project.id, col);
      }
      updateColumn(col, project, query, seen);
      return col.root;
    };
    const folded = new Set(foldedGroups());
    const liveGroups = new Set();
    const liveStacks = new Set();
    const shown = ui.widget ? widgetProject() : null;
    if (shown) {
      ui.widgetId = shown.id;
      nodes.push(columnNode(shown));
    }
    for (const unit of shown ? [] : boardLayout()) {
      if (!unit.group) {
        nodes.push(columnNode(findProject(unit.ids[0])));
        continue;
      }
      const members = unit.ids.map(findProject);
      const view = groupView(unit.group);
      liveGroups.add(unit.group);
      updateGroup(view, unit.group, members, folded.has(unit.group));
      syncChildren(view.cols, stackMinimized(members.map(columnNode), liveStacks));
      nodes.push(view.root);
    }
    if (!shown) nodes.splice(0, nodes.length, ...stackMinimized(nodes, liveStacks));
    for (const [name, view] of groups) {
      if (liveGroups.has(name) || view.renaming) continue;
      view.root.remove();
      groups.delete(name);
    }
    for (const [key, box] of stacks) {
      if (liveStacks.has(key)) continue;
      box.remove();
      stacks.delete(key);
    }
    for (const [id, col] of columns) {
      if (findProject(id)) continue;
      col.composer?.destroy();
      col.stageEditor?.composer.destroy();
      col.root.remove();
      columns.delete(id);
    }
    for (const [id, view] of cards) {
      if (seen.has(id)) continue;
      view.editor?.destroy();
      view.root.remove();
      cards.delete(id);
    }
    if (!boardProjects().length) nodes.push(emptyEl);
    else if (!shown) nodes.push(addColumnEl);
    syncChildren(board, nodes);
    paintWidget();
    if (toMeasure.size || augToMeasure.size) requestAnimationFrame(measureCards);
    updatePan();
    paintSelection();
    paintWidthReset();
    paintEating();
    paintEaten();
    paintNotepad();
  }

  // ---- the widget (1.19): a small window that stays on top of other apps and shows one column.
  // main resizes the window and keeps it on top (window:widget); the page draws only that column,
  // full width, with a picker in the top bar. The same button goes back to the full board.

  const widgetBtn = $('#widget-toggle');
  const widgetPick = $('#widget-pick');

  function widgetProject() {
    const keep = (p) => (p && !isNotepad(p) ? p : null);
    return keep(findProject(ui.widgetId)) || keep(findProject(ui.lastProjectId)) || boardProjects()[0] || null;
  }

  function paintWidget() {
    widgetBtn.title = ui.widget
      ? 'Back to the full board'
      : 'Widget: a small window that stays on top, with one column';
    widgetBtn.setAttribute('aria-pressed', String(ui.widget));
    const widgetLabel = ui.widget ? 'Back to the full board' : 'Widget: a small window on top';
    if ($('#widget-label').textContent !== widgetLabel) $('#widget-label').textContent = widgetLabel;
    widgetPick.hidden = !ui.widget;
    if (!ui.widget) return;
    const p = widgetProject();
    widgetPick.style.setProperty('--accent', p ? colorOf(p) : '');
    const name = p ? p.name : 'No columns';
    const nameEl = widgetPick.querySelector('.widget-pick-name');
    if (nameEl.textContent !== name) nameEl.textContent = name;
    widgetPick.title = `${name} · pick another column`;
  }

  async function setWidget(on) {
    if (ui.widget === on) return;
    closeMenu();
    closeEaten?.();
    const p = on ? widgetProject() : findProject(ui.widgetId);
    ui.widget = on;
    if (p) ui.widgetId = p.id;
    document.body.classList.toggle('is-widget', on);
    render();
    try {
      await api.setWidget(on, ui.widgetId);
    } catch (err) {
      console.error(err);
    }
    if (!on && p) setTimeout(() => revealColumn(p.id), 260); // back on the board, where the widget was
  }

  function showInWidget(id) {
    if (!findProject(id)) return;
    ui.widgetId = id;
    ui.lastProjectId = id; // Ctrl+N / Ctrl+M write here
    rememberProject();
    render();
    board.scrollLeft = 0;
    api.setWidget(true, id).catch(() => {});
  }

  function openWidgetPicker() {
    openMenu(widgetPick, (menu) => {
      menu.classList.add('widget-menu');
      for (const p of boardLayout().flatMap((u) => u.ids).map(findProject)) {
        const leaf = `<svg class="menu-leaf" style="color:${colorOf(p)}"><use href="#monstera"/></svg>`;
        menuItem(menu, leaf, p.name + (isEating(p) ? '  ·  eating' : ''), () => showInWidget(p.id));
        if (p.id === ui.widgetId) menu.lastChild.classList.add('is-current');
      }
      menuItem(menu, I.plus, 'New project', () => createProject());
    });
  }

  widgetBtn.addEventListener('click', () => setWidget(!ui.widget));
  widgetPick.addEventListener('click', () => (openMenuEl?.anchor === widgetPick ? closeMenu() : openWidgetPicker()));

  // ---- minimized columns (1.20.2): side by side on the board (or in a group), they share one slot as a
  // stack of rows, each with its leaf, name and count, so the names read across instead of down a strip.
  // A lone minimized column is a stack of one. Nothing is stored: the stack follows the board order.

  const stacks = new Map(); // id of a stack's first column -> its element

  function stackMinimized(nodes, live) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const key = run[0].dataset.id;
      let box = stacks.get(key);
      if (!box) {
        box = el('div', 'mini-stack');
        stacks.set(key, box);
      }
      live.add(key);
      syncChildren(box, run);
      out.push(box);
      run = [];
    };
    for (const n of nodes) {
      if (n.classList.contains('column') && n.classList.contains('is-minimized')) run.push(n);
      else {
        flush();
        out.push(n);
      }
    }
    flush();
    return out;
  }

  // ---- column groups (1.18)

  const groups = new Map(); // group name -> group view

  // The board in drawing order: single columns, and groups holding their members in board order.
  // A group stands where its first member is.
  function boardLayout() {
    const units = [];
    const byGroup = new Map();
    for (const p of data.projects) {
      if (isNotepad(p)) continue; // the notepad is never drawn on the board
      const g = groupOf(p);
      if (!g) units.push({ group: null, ids: [p.id] });
      else if (byGroup.has(g)) byGroup.get(g).ids.push(p.id);
      else {
        const unit = { group: g, ids: [p.id] };
        byGroup.set(g, unit);
        units.push(unit);
      }
    }
    return units;
  }

  const groupNames = () => boardLayout().filter((u) => u.group).map((u) => u.group);

  function groupView(name) {
    let view = groups.get(name);
    if (view) return view;
    const root = el('section', 'col-group');
    root.innerHTML = `
      <header class="group-head">
        <button class="group-toggle" title="Click to fold the group away or open it · drag to move the whole group"><span class="chev">${I.chevron}</span><span class="group-name"></span><span class="group-count"></span></button>
        <button class="head-btn group-menu" title="Group options" aria-label="Group options">${I.more}</button>
      </header>
      <div class="group-strip" title="Open the group · drag to move it"><span class="strip-name"></span><span class="strip-dots"></span></div>
      <div class="group-cols"></div>`;
    view = {
      root,
      toggle: $('.group-toggle', root),
      nameEl: $('.group-name', root),
      countEl: $('.group-count', root),
      stripName: $('.strip-name', root),
      stripDots: $('.strip-dots', root),
      cols: $('.group-cols', root),
      renaming: false,
    };
    groups.set(name, view);
    return view;
  }

  function updateGroup(view, name, members, isFolded) {
    view.name = name;
    view.root.dataset.group = name;
    view.root.classList.toggle('is-folded', isFolded);
    if (!view.renaming) view.nameEl.textContent = name;
    view.stripName.textContent = name;
    view.countEl.textContent = `· ${members.length}`;
    const dots = members.map((p) => `<svg style="color:${colorOf(p)}"><use href="#monstera"/></svg>`).join('');
    if (view.stripDots.innerHTML !== dots) view.stripDots.innerHTML = dots;
  }

  // Folding is a state, like minimizing: synced (1.20.7), not undoable.
  function markGroupFolded(name, fold) {
    let changed = false;
    for (const p of data.projects) {
      if (groupOf(p) !== name || (p.groupFolded === true) === fold) continue;
      if (fold) p.groupFolded = true;
      else delete p.groupFolded;
      changed = true;
    }
    if (!changed) return false;
    contentSeq++; // synced like any project field: a sync patch from before this is stale
    pendingLabels.push(fold ? 'Fold group' : 'Open group');
    return true;
  }

  function setGroupFolded(name, fold) {
    if (!markGroupFolded(name, fold)) return;
    persist();
    render();
  }

  function uniqueGroupName() {
    const taken = new Set(groupNames());
    if (!taken.has('Important')) return 'Important';
    for (let i = 2; ; i++) if (!taken.has(`Group ${i}`)) return `Group ${i}`;
  }

  // A column joins a group (a new one, or an existing one: it then moves to the end of that group).
  function setGroup(projectId, name) {
    const project = findProject(projectId);
    if (!project || groupOf(project) === name) return;
    checkpoint(name ? 'Move to group' : 'Remove from group');
    const joinsFolded = Boolean(name) && foldedGroups().includes(name);
    if (name) project.group = name;
    else delete project.group;
    if (joinsFolded) project.groupFolded = true;
    else delete project.groupFolded;
    const members = data.projects.filter((p) => p !== project && groupOf(p) === name);
    if (name && members.length) {
      data.projects.splice(data.projects.indexOf(project), 1);
      data.projects.splice(data.projects.indexOf(members[members.length - 1]) + 1, 0, project);
    }
    persist();
    render();
  }

  function newGroupFrom(projectId) {
    const name = uniqueGroupName();
    setGroup(projectId, name);
    const view = groups.get(name);
    if (view) startGroupRename(view);
  }

  function ungroup(name) {
    const members = data.projects.filter((p) => groupOf(p) === name);
    if (!members.length) return;
    checkpoint('Ungroup');
    for (const p of members) {
      delete p.group;
      delete p.groupFolded;
    }
    persist();
    render();
    toast(`Ungrouped “${name}”`, { action: 'Undo', onAction: undo, history: true });
  }

  function renameGroup(from, to) {
    to = to.trim().slice(0, 60);
    if (!to || to === from) return;
    const members = data.projects.filter((p) => groupOf(p) === from);
    if (!members.length) return;
    checkpoint('Rename group');
    // Renaming into an existing group's name joins the two. The fold flag sits on the members, so it
    // follows the rename.
    for (const p of members) p.group = to;
    persist();
  }

  function startGroupRename(view) {
    if (view.renaming) return;
    view.renaming = true;
    const from = view.name;
    const input = el('input', 'col-name-input group-name-input');
    input.value = from;
    input.maxLength = 60;
    input.spellcheck = false;
    view.toggle.hidden = true;
    view.toggle.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) renameGroup(from, input.value);
      input.remove();
      view.toggle.hidden = false;
      view.renaming = false;
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // A whole group moves past its neighbour (a column or another group).
  function moveGroup(name, delta) {
    const units = boardLayout();
    const i = units.findIndex((u) => u.group === name);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= units.length) return;
    checkpoint('Move group');
    [units[i], units[j]] = [units[j], units[i]];
    setBoardOrder(units.flatMap((u) => u.ids).map(findProject));
    persist();
    render();
  }

  function openGroupMenu(view, anchor) {
    const name = view.name;
    const units = boardLayout();
    const i = units.findIndex((u) => u.group === name);
    openMenu(anchor, (menu) => {
      menuItem(menu, I.pencilLine, 'Rename group', () => startGroupRename(view));
      menuItem(menu, I.chevron, foldedGroups().includes(name) ? 'Open group' : 'Fold group', () => setGroupFolded(name, !foldedGroups().includes(name)));
      menu.appendChild(el('div', 'menu-sep'));
      menuItem(menu, I.arrowLeft, 'Move group left', () => moveGroup(name, -1), { disabled: i <= 0 });
      menuItem(menu, I.arrowRight, 'Move group right', () => moveGroup(name, 1), { disabled: i < 0 || i >= units.length - 1 });
      menu.appendChild(el('div', 'menu-sep'));
      menuItem(menu, I.close, 'Ungroup (keep the columns)', () => ungroup(name));
    });
  }

  // ---- Eating (1.18): an agent is running a column's Served text. A switch on the Served
  // section, and a strip at the bottom right of the board listing every column that's eating.

  const eatingBar = $('#eating');
  const eatingList = $('#eating-list');

  function setEating(projectId, on) {
    const project = findProject(projectId);
    if (!project || isEating(project) === on) return;
    if (on) project.eating = Date.now();
    else delete project.eating;
    contentSeq++; // synced like any project field: a sync patch from before this is stale
    pendingLabels.push(on ? 'Eating' : 'Done eating');
    persist();
    render();
  }

  function paintEating() {
    const eating = boardLayout().flatMap((u) => u.ids).map(findProject).filter(isEating);
    eatingBar.hidden = !eating.length;
    document.body.classList.toggle('has-eating', eating.length > 0);
    eatingCount.textContent = eating.length > 1 ? String(eating.length) : '';
    // 1.19: every eating column gets its own chip, and the strip wraps onto more rows rather than
    // hiding chips behind a sideways scroll (with 3 or more, the old strip showed only the first two).
    const html = eating.map((p) => `
      <span class="eat-chip${ui.widget && p.id === ui.widgetId ? ' is-shown' : ''}" data-id="${escapeHtml(p.id)}" style="--accent:${colorOf(p)}" title="${escapeHtml(p.name)} · eating for ${eatFor(p.eating)} · click to show the column">
        <span class="eat-badge"><svg class="eat-leaf"><use href="#monstera"/></svg></span>
        <span class="eat-text"><span class="eat-name">${escapeHtml(p.name)}</span><span class="eat-time"><span class="eat-word">eating · </span>${eatFor(p.eating)}</span></span>
        <button class="eat-done" title="Done: move it to Eaten" aria-label="Done">${I.check}<span>Done</span></button>
        <span class="eat-flow" aria-hidden="true"></span>
      </span>`).join('');
    if (eatingList.innerHTML !== html) eatingList.innerHTML = html;
    fitEatingRoom();
  }

  // The board keeps exactly the strip's height free under the columns, so a strip that wraps onto a
  // second row still never covers a card (1.18 reserved a fixed 58 px for one row).
  const eatingCount = $('#eating-count');
  function fitEatingRoom() {
    const h = eatingBar.hidden ? 0 : Math.ceil(eatingBar.getBoundingClientRect().height);
    document.body.style.setProperty('--eating-room', `${h ? h + 26 : 0}px`);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitEatingRoom).observe(eatingBar);

  eatingList.addEventListener('click', (e) => {
    const chip = e.target.closest('.eat-chip');
    if (!chip) return;
    const id = chip.dataset.id;
    if (e.target.closest('.eat-done')) return finishEating(id);
    if (ui.widget) return showInWidget(id);
    revealColumn(id);
  });

  // Done (1.18): the agent finished. The Served text moves to Eaten as one round, Served starts
  // empty for the next batch, and Eating ends. Undo puts all three back.
  function finishEating(projectId) {
    const project = findProject(projectId);
    if (!project) return;
    const text = finalText(project);
    const images = stageImages(project.combined);
    if (!text && !images.length) return setEating(projectId, false); // nothing served: just stop
    const col = columns.get(projectId);
    if (col?.stageEditor?.list === 'combined') closeStageEditor(col);
    checkpoint('Done eating');
    history.undo[history.undo.length - 1].restore = ['eating'];
    const round = {
      id: uid(), project: project.id, name: project.name, color: project.color, text, images,
      parts: project.combined.length, startedAt: isEating(project) ? project.eating : 0, doneAt: Date.now(),
    };
    setEatenList([round, ...eatenList()]);
    project.combined = [];
    delete project.eating;
    persist();
    render();
    toast(`“${project.name}” is done · moved to Eaten`, { action: 'Undo', onAction: undo, duration: 7000, history: true });
  }

  // The Served switch while eating: Done, or stop eating and keep the text in Served.
  function openEatingMenu(projectId, anchor) {
    const project = findProject(projectId);
    if (!project) return;
    openMenu(anchor, (menu) => {
      menuItem(menu, I.check, 'Done: move it to Eaten', () => finishEating(projectId));
      menuItem(menu, I.close, 'Stop eating, keep it in Served', () => setEating(projectId, false));
    });
  }

  // ---- the Eaten drawer (1.18): every finished round, newest first, by day; filter by column, search,
  // and per round Copy, Serve again (back into its column's Served) and Delete.

  const eatenPanel = $('#eaten-panel');
  const eatenListEl = $('#eaten-list');
  const eatenFilters = $('#eaten-filters');
  const eatenSearch = $('#eaten-search');
  const eatenBtn = $('#open-eaten');
  const eatenUi = { filter: null, query: '', openIds: new Set() };

  const isEatenOpen = () => eatenPanel.classList.contains('is-open');

  function openEaten(projectId = null) {
    closeMenu();
    if (isNotepadOpen()) closeNotepad(); // one drawer at a time
    eatenUi.filter = projectId && eatenList().some((r) => r.project === projectId) ? projectId : null;
    eatenPanel.classList.add('is-open');
    document.body.classList.add('eaten-open');
    eatenPanel.setAttribute('aria-hidden', 'false');
    eatenBtn.classList.add('is-open');
    paintEaten();
  }

  function closeEaten() {
    eatenPanel.classList.remove('is-open');
    document.body.classList.remove('eaten-open');
    eatenPanel.setAttribute('aria-hidden', 'true');
    eatenBtn.classList.remove('is-open');
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, d.getFullYear() === today.getFullYear()
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function paintEaten() {
    const rounds = eatenList();
    eatenBtn.hidden = !rounds.length;
    eatenBtn.title = `Eaten: ${rounds.length} finished prompt${rounds.length === 1 ? '' : 's'}`;
    $('.eaten-badge', eatenBtn).textContent = rounds.length > 99 ? '99+' : String(rounds.length);
    if (!isEatenOpen()) return;
    $('#eaten-total').textContent = rounds.length ? String(rounds.length) : '';
    // the columns that have rounds, in board order, then any that were deleted since
    const nameOf = (r) => findProject(r.project)?.name ?? r.name ?? 'Deleted column';
    const colourOf = (r) => colorOf(findProject(r.project) ?? { color: r.color });
    const order = data.projects.map((p) => p.id);
    const ids = [...new Set(rounds.map((r) => r.project))].sort((a, b) => ((order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9)));
    if (eatenUi.filter && !ids.includes(eatenUi.filter)) eatenUi.filter = null;
    eatenFilters.hidden = ids.length < 2;
    eatenFilters.innerHTML = [`<button class="eaten-filter${eatenUi.filter ? '' : ' is-active'}" data-filter="">All<span>${rounds.length}</span></button>`]
      .concat(ids.map((id) => {
        const r = rounds.find((x) => x.project === id);
        const n = rounds.filter((x) => x.project === id).length;
        return `<button class="eaten-filter${eatenUi.filter === id ? ' is-active' : ''}" data-filter="${escapeHtml(id)}" style="--accent:${colourOf(r)}"><svg class="eat-leaf"><use href="#monstera"/></svg>${escapeHtml(nameOf(r))}<span>${n}</span></button>`;
      })).join('');
    const query = parseQuery(eatenUi.query);
    const shown = rounds.filter((r) => (!eatenUi.filter || r.project === eatenUi.filter)
      && query.terms.every((t) => r.text.toLowerCase().includes(t) || nameOf(r).toLowerCase().includes(t)));
    if (!shown.length) {
      eatenListEl.innerHTML = `<div class="eaten-empty">${rounds.length
        ? 'Nothing matches.'
        : `${I.utensils}<b>Nothing eaten yet</b><span>When an agent has finished a served prompt, click <b>Done</b> on its Eating switch. The prompt moves here, and Served is ready for the next batch.</span>`}</div>`;
      return;
    }
    let html = '';
    let day = '';
    for (const r of shown) {
      const label = dayLabel(r.doneAt || Date.now());
      if (label !== day) {
        day = label;
        html += `<h3 class="eaten-day">${escapeHtml(label)}</h3>`;
      }
      const at = new Date(r.doneAt || Date.now()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const span = r.startedAt && r.doneAt > r.startedAt ? spanText(r.doneAt - r.startedAt) : '';
      const took = span ? ` · ate for ${span === 'now' ? 'under a minute' : span}` : '';
      const words = r.text.trim() ? r.text.trim().split(/\s+/).length : 0;
      const images = cleanImages(r.images);
      const parts = Number(r.parts) || 1;
      const alive = Boolean(findProject(r.project));
      html += `
        <article class="eaten-item${eatenUi.openIds.has(r.id) ? ' is-open' : ''}" data-id="${escapeHtml(r.id)}" style="--accent:${colourOf(r)}">
          <header class="eaten-item-head"><svg class="eat-leaf"><use href="#monstera"/></svg><b>${escapeHtml(nameOf(r))}</b><span class="eaten-meta">${escapeHtml(at + took)}</span></header>
          <div class="eaten-text" title="${eatenUi.openIds.has(r.id) ? 'Click to fold' : 'Click to read it all'}">${highlight(r.text, query)}</div>
          ${images.length ? `<div class="eaten-pics">${images.map((img) => `<button class="eaten-pic" data-img="${img.id}" title="Copy this picture"><img src="${imgUrl(img.id, true)}" alt="" draggable="false" loading="lazy" /></button>`).join('')}</div>` : ''}
          <footer class="eaten-item-foot">
            <span class="eaten-stats">${parts} note${parts === 1 ? '' : 's'} · ${words.toLocaleString()} words</span>
            <span class="spacer"></span>
            <button class="eaten-act eaten-copy" title="Copy the text">${I.copy}<span>Copy</span></button>
            <button class="eaten-act eaten-again" title="${alive ? 'Put it back into this column’s Served' : 'Its column was deleted'}"${alive ? '' : ' disabled'}>${I.restore}<span>Serve again</span></button>
            <button class="eaten-act eaten-del" title="Delete it from Eaten" aria-label="Delete it from Eaten">${I.trash}</button>
          </footer>
        </article>`;
    }
    eatenListEl.innerHTML = html;
  }

  function serveAgain(id) {
    const round = eatenList().find((r) => r.id === id);
    const project = round && findProject(round.project);
    if (!project) return;
    checkpoint('Serve again');
    project.combined.push({ ...makeNote(round.text, cleanImages(round.images)), usedAt: Date.now() });
    setEatenList(eatenList().filter((r) => r.id !== id));
    persist();
    render();
    revealColumn(project.id);
    toast(`Back in “${project.name}” · Served`, { action: 'Undo', onAction: undo, history: true });
  }

  function deleteEaten(id) {
    if (!eatenList().some((r) => r.id === id)) return;
    checkpoint('Delete from Eaten');
    setEatenList(eatenList().filter((r) => r.id !== id));
    persist();
    render();
    toast('Deleted from Eaten', { action: 'Undo', onAction: undo, duration: 7000, history: true });
  }

  eatenBtn.addEventListener('click', () => (isEatenOpen() ? closeEaten() : openEaten()));
  $('#eaten-close').addEventListener('click', closeEaten);
  eatenSearch.addEventListener('input', () => {
    eatenUi.query = eatenSearch.value;
    paintEaten();
  });
  eatenFilters.addEventListener('click', (e) => {
    const b = e.target.closest('.eaten-filter');
    if (!b) return;
    eatenUi.filter = b.dataset.filter || null;
    paintEaten();
  });
  eatenListEl.addEventListener('click', async (e) => {
    const item = e.target.closest('.eaten-item');
    const round = item && eatenList().find((r) => r.id === item.dataset.id);
    if (!round) return;
    const pic = e.target.closest('.eaten-pic');
    if (pic) {
      const ok = await api.copyImage(pic.dataset.img).catch(() => false);
      toast(ok ? 'Image copied' : "Couldn't copy to the clipboard.");
      return;
    }
    if (e.target.closest('.eaten-copy')) {
      try {
        await api.copy(round.text);
        toast('Copied');
      } catch {
        toast("Couldn't copy to the clipboard.");
      }
      return;
    }
    if (e.target.closest('.eaten-again')) return serveAgain(round.id);
    if (e.target.closest('.eaten-del')) return deleteEaten(round.id);
    if (e.target.closest('.eaten-text') && !String(window.getSelection())) {
      if (eatenUi.openIds.has(round.id)) eatenUi.openIds.delete(round.id);
      else eatenUi.openIds.add(round.id);
      paintEaten();
    }
  });

  // ---- the colour legend (1.20.7): the four status colours in the top bar; hover one for its meaning
  $('#legend').innerHTML = STATUS.map((st) => {
    const c = PALETTE.find((x) => x.id === st.id).color;
    return `<span class="legend-item" style="--c:${c}" title="${escapeHtml(st.meaning)}"><i></i>${escapeHtml(st.label)}</span>`;
  }).join('');

  // ---- the notepad (1.20): one scratch page for random notes, from the top bar or Ctrl+J. It saves as
  // you type and syncs like any note, as the first note of a hidden "Notepad" project (see isNotepad).
  // Two computers typing at once keep both texts: the other one shows under the page, to add or drop.
  // 1.20.7: every column can have a page of its own too (the page button in its header): a hidden
  // notepad project with `padFor: <column id>`. The page takes bold, italic, underline and bullet lists:
  // the note keeps the plain text in `text` (search, copy, older versions) and the formatting in `html`,
  // which is drawn only while it still matches `text` (an older version may have edited the text since).
  // The drawer can be resized from its left edge; the width stays on this computer (prefs.notepadWidth).

  const notepadPanel = $('#notepad-panel');
  const notepadText = $('#notepad-text');
  const notepadBtn = $('#open-notepad');
  const notepadStatus = $('#notepad-status');
  const notepadOthers = $('#notepad-others');
  const notepadForEl = $('#notepad-for');
  const NOTEPAD_SAVE_MS = 500;
  const NOTEPAD_MIN_W = 300;
  let notepadTimer = null;
  let notepadFor = null; // the column whose page is open, or null for the main notepad

  const isNotepadOpen = () => notepadPanel.classList.contains('is-open');
  const padKey = (p) => (typeof p.padFor === 'string' && p.padFor ? p.padFor : null);
  const notepadProjects = (forId = notepadFor) => data.projects.filter((p) => isNotepad(p) && padKey(p) === forId);
  // The page is the first note of the first notepad project; every other note in one is "another version".
  const pageOf = (forId) => {
    for (const p of notepadProjects(forId)) if (p.notes[0]) return { project: p, note: p.notes[0] };
    return null;
  };
  const notepadPage = () => pageOf(notepadFor);
  const columnPad = (id) => pageOf(id);
  const notepadExtras = () => {
    const page = notepadPage();
    return notepadProjects().flatMap((p) => p.notes.concat(p.used, p.combined)).filter((n) => n !== page?.note);
  };
  // While the page has focus, or a save is waiting, a change from the cloud waits (like an open editor).
  const notepadBusy = () => Boolean(notepadTimer) || (isNotepadOpen() && document.activeElement === notepadText);

  // -- the page's formatting: only these tags are kept, without attributes (the html may come from
  // another computer, so it is always cleaned before it is drawn).
  const PAD_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', UL: 'ul', OL: 'ol', LI: 'li', BR: 'br', DIV: 'div', P: 'div' };
  function cleanPadHtml(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    const out = document.createElement('div');
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) dst.appendChild(document.createTextNode(n.data));
        else if (n.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT)$/.test(n.tagName)) continue;
        else if (PAD_TAGS[n.tagName]) walk(n, dst.appendChild(document.createElement(PAD_TAGS[n.tagName])));
        else walk(n, dst); // any other tag: keep its text, drop the tag
      }
    };
    walk(t.content, out);
    return out.innerHTML;
  }
  // The plain text of the page: one line per block, "• " before a bullet, "1. " in a numbered list.
  function padTextOf(root) {
    let s = '';
    const block = (n) => /^(DIV|P|LI|UL|OL)$/.test(n.tagName);
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) s += n.data.replace(/ /g, ' ');
        else if (n.nodeType !== Node.ELEMENT_NODE) continue;
        else if (n.tagName === 'BR') s += '\n';
        else if (block(n)) {
          if (s && !s.endsWith('\n')) s += '\n';
          if (n.tagName === 'LI') {
            const ol = n.parentNode?.tagName === 'OL';
            s += ol ? `${[...n.parentNode.children].indexOf(n) + 1}. ` : '• ';
          }
          walk(n);
          if (!s.endsWith('\n')) s += '\n';
        } else walk(n);
      }
    };
    walk(root);
    return s.endsWith('\n') ? s.slice(0, -1) : s;
  }
  const plainToPadHtml = (text) => String(text).split('\n').map((line) => (line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>')).join('');
  const hasFormatting = (html) => /<(b|i|u|ul|ol)\b/i.test(html);
  // What the page should show for a note: its formatting while it still matches the text, else the text.
  function padHtmlOf(note) {
    if (!note) return '';
    if (typeof note.html === 'string' && note.html) {
      const clean = cleanPadHtml(note.html);
      const probe = document.createElement('div');
      probe.innerHTML = clean;
      if (padTextOf(probe) === note.text) return clean;
    }
    return note.text ? plainToPadHtml(note.text) : '';
  }

  function notepadWidth() {
    const w = Number(data.prefs.notepadWidth);
    return Number.isFinite(w) && w >= NOTEPAD_MIN_W ? Math.round(w) : null;
  }
  function applyNotepadWidth() {
    const w = notepadWidth();
    if (w) document.body.style.setProperty('--notepad-w', `${w}px`);
    else document.body.style.removeProperty('--notepad-w');
  }

  function caretToEnd() {
    const r = document.createRange();
    r.selectNodeContents(notepadText);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function openNotepad(forId = null) {
    closeMenu();
    if (isEatenOpen()) closeEaten();
    if (forId && !findProject(forId)) forId = null;
    if (isNotepadOpen() && notepadFor !== forId) saveNotepadNow();
    const switching = notepadFor !== forId;
    notepadFor = forId;
    notepadPanel.classList.add('is-open');
    document.body.classList.add('notepad-open');
    notepadPanel.setAttribute('aria-hidden', 'false');
    notepadBtn.classList.toggle('is-open', !forId);
    if (switching) notepadText.innerHTML = '';
    paintNotepad(true);
    notepadText.focus();
    caretToEnd();
    render(); // the column's page button shows it's open
  }

  function closeNotepad() {
    if (!isNotepadOpen()) return;
    saveNotepadNow();
    notepadPanel.classList.remove('is-open');
    document.body.classList.remove('notepad-open');
    notepadPanel.setAttribute('aria-hidden', 'true');
    notepadBtn.classList.remove('is-open');
    if (document.activeElement === notepadText) notepadText.blur();
    render();
  }

  // The text goes into the data at once; the save (and its sync) follows a short pause in typing.
  function notepadInput() {
    const text = padTextOf(notepadText);
    const html = cleanPadHtml(notepadText.innerHTML);
    let page = notepadPage();
    if (!page) {
      if (!text) return;
      const now = Date.now();
      const note = { id: uid(), text: '', images: [], createdAt: now, updatedAt: now, copied: 0, lastCopiedAt: 0, usedAt: 0 };
      let project = notepadProjects()[0];
      if (!project) {
        const col = notepadFor ? findProject(notepadFor) : null;
        project = col
          ? { id: uid(), name: `Notepad: ${col.name}`, color: col.color, notepad: true, padFor: col.id }
          : { id: uid(), name: 'Notepad', color: 'slate', notepad: true };
        Object.assign(project, { usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now, notes: [], used: [], combined: [] });
        data.projects.push(project);
      }
      project.notes.unshift(note);
      page = { project, note };
    }
    const keepHtml = hasFormatting(html) ? html : undefined;
    if (page.note.text === text && page.note.html === keepHtml) return;
    page.note.text = text;
    if (keepHtml) page.note.html = keepHtml;
    else delete page.note.html;
    page.note.updatedAt = Date.now();
    delete page.note.syncConflict; // the page as typed here is the page
    clearTimeout(notepadTimer);
    notepadTimer = setTimeout(saveNotepadNow, NOTEPAD_SAVE_MS);
    paintNotepadStatus();
  }

  function saveNotepadNow() {
    if (!notepadTimer) return;
    clearTimeout(notepadTimer);
    notepadTimer = null;
    contentSeq++; // synced: a sync patch from before this is stale
    persist();
    paintNotepadStatus();
    if (notepadFor) render(); // the column's page button
    if (pendingPatch) tryApplyPatch();
  }

  function paintNotepadStatus() {
    const text = padTextOf(notepadText).trim();
    const words = text ? text.split(/\s+/).length : 0;
    notepadStatus.textContent = notepadTimer ? 'Saving…' : notepadPage() ? `Saved · ${words.toLocaleString()} word${words === 1 ? '' : 's'}` : 'Saves as you type';
  }

  // The B / I / U / list buttons light up for the text under the cursor.
  function paintNotepadTools() {
    if (!isNotepadOpen()) return;
    for (const b of notepadPanel.querySelectorAll('.pad-tool')) {
      let on = false;
      try {
        on = document.activeElement === notepadText && document.queryCommandState(b.dataset.cmd);
      } catch {}
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // Called from render(): shows the page as the data has it (after a sync or an undo elsewhere), never
  // under the cursor while someone is typing.
  function paintNotepad(force = false) {
    notepadBtn.title = `Notepad (${kb('Ctrl+J')})`;
    applyNotepadWidth();
    if (!isNotepadOpen()) return;
    if (notepadFor && !findProject(notepadFor)) {
      // its column was deleted (here or on another computer): back to the main notepad
      notepadFor = null;
      notepadText.innerHTML = '';
      force = true;
    }
    const col = notepadFor ? findProject(notepadFor) : null;
    notepadForEl.hidden = !col;
    if (col) {
      notepadForEl.style.setProperty('--accent', colorOf(col));
      const label = notepadForEl.querySelector('.notepad-for-name');
      if (label.textContent !== col.name) label.textContent = col.name;
      notepadForEl.title = `This page belongs to ${col.name}`;
    }
    notepadText.dataset.placeholder = col ? `Notes for ${col.name}. They save as you type.` : 'Jot anything here. It saves as you type.';
    const page = notepadPage();
    const html = padHtmlOf(page?.note);
    if ((force || document.activeElement !== notepadText) && !notepadTimer && cleanPadHtml(notepadText.innerHTML) !== html) notepadText.innerHTML = html;
    notepadText.classList.toggle('is-empty', !padTextOf(notepadText) && !notepadText.querySelector('li'));
    const extras = notepadExtras();
    notepadOthers.hidden = !extras.length;
    const others = extras.length ? `<p class="notepad-others-head">${extras.some((n) => n.syncConflict)
      ? 'Changed on two computers at once, so both versions are kept. The other one:'
      : 'Also in the notepad:'}</p>${extras.map((n) => `
        <article class="notepad-other" data-id="${escapeHtml(n.id)}">
          <div class="notepad-other-text">${escapeHtml(n.text) || '<i>(empty)</i>'}</div>
          <footer>
            <button class="notepad-act notepad-take" title="Add this text to the end of the page">${I.plus}<span>Add to the page</span></button>
            <button class="notepad-act notepad-drop" title="Delete this version">${I.trash}<span>Delete</span></button>
          </footer>
        </article>`).join('')}` : '';
    if (notepadOthers.innerHTML !== others) notepadOthers.innerHTML = others;
    paintNotepadStatus();
    paintNotepadTools();
  }

  // Removes a note from the notepad (an extra version), and its project when nothing is left in it.
  function dropNotepadNote(id) {
    for (const p of notepadProjects()) {
      for (const list of LISTS) {
        const i = p[list].findIndex((n) => n.id === id);
        if (i < 0) continue;
        const [note] = p[list].splice(i, 1);
        const emptied = !p.notes.length && !p.used.length && !p.combined.length && p !== notepadPage()?.project;
        if (emptied) data.projects.splice(data.projects.indexOf(p), 1);
        contentSeq++;
        pendingLabels.push('Delete note');
        if (emptied) pendingLabels.push('Delete project');
        return { project: p, list, index: i, note, emptied };
      }
    }
    return null;
  }

  notepadBtn.addEventListener('click', () => (isNotepadOpen() && !notepadFor ? closeNotepad() : openNotepad()));
  $('#notepad-close').addEventListener('click', closeNotepad);
  notepadText.addEventListener('input', () => {
    notepadInput();
    notepadText.classList.toggle('is-empty', !padTextOf(notepadText) && !notepadText.querySelector('li'));
    paintNotepadTools();
  });
  // Pasting brings plain text only, so nothing foreign (fonts, colours, links, pictures) lands on the page.
  notepadText.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) document.execCommand('insertText', false, text);
  });
  notepadText.addEventListener('drop', (e) => e.preventDefault());
  notepadText.addEventListener('keydown', (e) => {
    // Ctrl+B / I / U are the browser's own; keep them, and the button states, in step
    if (modKey(e) && /^[biu]$/i.test(e.key)) setTimeout(paintNotepadTools, 0);
  });
  notepadText.addEventListener('blur', () => {
    saveNotepadNow();
    paintNotepadTools();
    if (pendingPatch) tryApplyPatch();
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === notepadText) paintNotepadTools();
  });
  for (const b of notepadPanel.querySelectorAll('.pad-tool')) {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection in the page
    b.addEventListener('click', () => {
      if (document.activeElement !== notepadText) {
        notepadText.focus();
        caretToEnd();
      }
      document.execCommand(b.dataset.cmd, false);
      notepadInput();
      paintNotepadTools();
    });
  }
  $('#notepad-copy').addEventListener('click', async () => {
    const text = padTextOf(notepadText);
    if (!text.trim()) return toast('The notepad is empty');
    try {
      await api.copy(text);
      toast('Notepad copied');
    } catch {
      toast("Couldn't copy to the clipboard.");
    }
  });
  notepadOthers.addEventListener('click', (e) => {
    const item = e.target.closest('.notepad-other');
    if (!item) return;
    const id = item.dataset.id;
    const note = notepadExtras().find((n) => n.id === id);
    if (!note) return;
    if (e.target.closest('.notepad-take')) {
      saveNotepadNow();
      // trailing empty lines go, then a blank line, then the other version
      const blank = (n) => (n.nodeType === Node.TEXT_NODE ? !n.data.trim()
        : n.nodeType !== Node.ELEMENT_NODE || (!/^(UL|OL)$/.test(n.tagName) && !n.textContent.trim()));
      while (notepadText.lastChild && blank(notepadText.lastChild)) notepadText.lastChild.remove();
      const has = Boolean(padTextOf(notepadText).trim());
      notepadText.insertAdjacentHTML('beforeend', (has ? '<div><br></div>' : '') + plainToPadHtml(note.text));
      notepadInput();
      dropNotepadNote(id);
      saveNotepadNow();
      paintNotepad(true);
      return;
    }
    if (e.target.closest('.notepad-drop')) {
      const gone = dropNotepadNote(id);
      persist();
      paintNotepad(true);
      toast('Deleted the other version', {
        action: 'Undo',
        duration: 7000,
        onAction: () => {
          if (!gone) return;
          if (gone.emptied) data.projects.push(gone.project);
          gone.project[gone.list].splice(gone.index, 0, gone.note);
          contentSeq++;
          persist();
          paintNotepad(true);
        },
      });
    }
  });
  // Resize from the left edge (double-click: back to the default width). Per computer, like column widths.
  $('#notepad-resize').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const right = notepadPanel.getBoundingClientRect().right;
    document.body.classList.add('is-resizing-pad');
    trackPointer(e, {
      onMove(ev) {
        const w = Math.max(NOTEPAD_MIN_W, Math.min(window.innerWidth - 80, right - ev.clientX));
        document.body.style.setProperty('--notepad-w', `${Math.round(w)}px`);
      },
      onEnd() {
        document.body.classList.remove('is-resizing-pad');
        const w = parseInt(document.body.style.getPropertyValue('--notepad-w'), 10);
        if (Number.isFinite(w) && w !== notepadWidth()) {
          data.prefs.notepadWidth = w;
          persist();
        }
      },
    });
  });
  $('#notepad-resize').addEventListener('dblclick', () => {
    delete data.prefs.notepadWidth;
    persist();
    applyNotepadWidth();
  });
  // The last keystrokes are saved when the window goes (on Windows the draft timer isn't flushed then).
  window.addEventListener('beforeunload', saveNotepadNow);

  // Scrolls a column into view, opening its group or strip first, and flashes it.
  function revealColumn(id) {
    const project = findProject(id);
    if (!project) return;
    const g = groupOf(project);
    if (g && foldedGroups().includes(g)) setGroupFolded(g, false);
    const col = columns.get(id);
    if (!col) return;
    col.root.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    bump(col.head);
  }

  // A column about to be written in comes out of its strip or folded group (Ctrl+N, Ctrl+M).
  function unhide(projectId) {
    const project = findProject(projectId);
    if (!project) return;
    const g = groupOf(project);
    if (!isMinimized(project) && !(g && foldedGroups().includes(g))) return;
    if (isMinimized(project)) {
      delete project.minimized;
      delete project.localMinimized;
      contentSeq++; // synced (1.20)
      pendingLabels.push('Open column');
    }
    if (g) markGroupFolded(g, false);
    persist();
  }

  // ---- minimize a column to a slim strip (⋯ › Minimize, a click on the strip opens it). Since 1.20
  // it syncs, so the column is minimized on every computer; it isn't undoable (a state, like Eating).

  function setMinimized(projectId, on) {
    const project = findProject(projectId);
    if (!project || isMinimized(project) === on) return;
    if (on) {
      project.minimized = true;
      delete project.localMinimized;
      if (ui.composing === projectId) closeComposer();
      if (columns.get(projectId)?.stageEditor) closeStageEditor(columns.get(projectId));
      if (ui.editing && locate(ui.editing)?.project === project) stopEditing();
    } else {
      delete project.minimized;
      delete project.localMinimized;
    }
    contentSeq++; // synced like any project field: a sync patch from before this is stale
    pendingLabels.push(on ? 'Minimize column' : 'Open column');
    persist();
    render();
    if (!on) remeasure([columns.get(projectId)]);
  }

  // ---- the Cooked note as Claude Code input (1.18)

  function setClaudeCode(projectId, on) {
    const project = findProject(projectId);
    if (!project || !project.used.length || isClaudeCode(project) === on) return;
    checkpoint(on ? 'Format for Claude Code' : 'Back to original');
    if (on) project.cookedFormat = 'claude-code';
    else delete project.cookedFormat;
    persist();
    render();
  }

  // Once Cooked is empty again, the next batch starts as plain text.
  function settleCooked(project) {
    if (project && !project.used.length) delete project.cookedFormat;
  }

  // ================================================================ note actions

  function currentProjectId() {
    if (ui.lastProjectId && findProject(ui.lastProjectId) && !isNotepad(findProject(ui.lastProjectId))) return ui.lastProjectId;
    return boardProjects()[0]?.id ?? null;
  }

  // Which column you last worked in is remembered across restarts.
  let lastProjectSaved = null;
  function rememberProject() {
    const id = ui.lastProjectId;
    if (!id || id === lastProjectSaved || id === data.prefs.lastProjectId) return;
    lastProjectSaved = id;
    data.prefs.lastProjectId = id;
    persistSoon();
  }

  function addNote(projectId, text, images = []) {
    const project = findProject(projectId);
    if (!project) return;
    checkpoint('New note');
    const note = makeNote(text, images);
    // New prompts go to the bottom, so a column reads oldest → newest and flows on down into Cooked.
    project.notes.push(note);
    delete project.notesCollapsed; // a collapsed Cooking opens to show it
    project.draft = '';
    project.draftImages = [];
    fresh.add(note.id);
    persist();
    render();
    cards.get(note.id)?.root.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  // Project menu › Sort oldest first: lines up prompts saved before new ones went to the bottom.
  const isOldestFirst = (notes) => notes.every((n, i) => i === 0 || notes[i - 1].createdAt <= n.createdAt);

  function sortOldestFirst(projectId) {
    const project = findProject(projectId);
    if (!project || project.notes.length < 2 || isOldestFirst(project.notes)) return;
    checkpoint('Sort prompts');
    project.notes = project.notes.slice().sort((a, b) => a.createdAt - b.createdAt);
    persist();
    render();
    toast('Prompts sorted oldest first', { action: 'Undo', onAction: undo, history: true });
  }

  function openComposer(projectId, { voice = false, screenshot = false } = {}) {
    if (!projectId) {
      createProject();
      return null;
    }
    if (ui.editing) stopEditing();
    closeStageEditors();
    if (ui.composing && ui.composing !== projectId) closeComposer();
    unhide(projectId);
    ui.composing = projectId;
    ui.lastProjectId = projectId;
    render();
    const col = columns.get(projectId);
    col?.root.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    col?.composer?.focus();
    if (voice) col?.composer?.startVoice();
    if (screenshot) col?.composer?.screenshot();
    return col?.composer ?? null;
  }

  function closeComposer(text, images) {
    const col = columns.get(ui.composing);
    const project = findProject(ui.composing);
    if (project) {
      project.draft = text ?? col?.composer?.value() ?? project.draft;
      project.draftImages = images ?? col?.composer?.images() ?? project.draftImages;
      persist();
    }
    ui.composing = null;
    render();
  }

  function activeComposer() {
    if (ui.editing) return cards.get(ui.editing)?.editor ?? null;
    for (const c of columns.values()) if (c.stageEditor) return c.stageEditor.composer;
    return columns.get(ui.composing)?.composer ?? null;
  }

  // Any editor open (new prompt, a card, the Cooked note or the Served text)?
  const isEditing = () => Boolean(ui.composing || ui.editing || [...columns.values()].some((c) => c.stageEditor));

  function startEdit(id) {
    const view = cards.get(id);
    const loc = locate(id);
    if (!view || !loc) return;
    if (ui.composing) closeComposer();
    closeStageEditors();
    if (ui.editing && ui.editing !== id) stopEditing();
    ui.editing = id;
    ui.lastProjectId = loc.project.id;
    view.editor = createComposer({
      text: loc.note.text,
      images: loc.note.images,
      placeholder: 'Edit note…',
      closeLabel: 'Cancel',
      allowDelete: true,
      onSave: (text, images) => {
        const current = locate(id);
        const changed = current && (current.note.text !== text || imageKey(current.note.images) !== imageKey(images));
        // Saving a sync conflict copy ("Other version") from its editor settles it, changed or not.
        if (changed || current?.note.syncConflict) {
          checkpoint('Edit note');
          if (changed) {
            current.note.text = text;
            current.note.images = images;
            current.note.updatedAt = Date.now();
          }
          delete current.note.syncConflict;
          persist();
        }
        stopEditing();
      },
      onCancel: () => stopEditing(),
      onDelete: () => {
        stopEditing();
        deleteNote(id);
      },
    });
    view.root.classList.add('is-editing');
    view.root.appendChild(view.editor.root);
    view.editor.focus();
  }

  function stopEditing() {
    const view = cards.get(ui.editing);
    ui.editing = null;
    if (view?.editor) {
      view.editor.destroy();
      view.editor.root.remove();
      view.editor = null;
      view.root.classList.remove('is-editing');
      view.sig = '';
      view.card.focus({ preventScroll: true });
    }
    render();
  }

  async function copyNote(id, event, imageId) {
    const loc = locate(id);
    if (!loc) return;
    ui.selection = [];
    const note = loc.note;
    const image = imageId || (!note.text.trim() && note.images[0]?.id) || null;
    let ok = true;
    try {
      if (image) ok = await api.copyImage(image);
      else await api.copy(note.text);
    } catch (err) {
      console.error(err);
      ok = false;
    }
    if (!ok) {
      toast("Couldn't copy to the clipboard.");
      return;
    }
    const cur = locate(id); // a sync patch may have moved or removed the note during the await
    if (cur) {
      cur.note.copied = (cur.note.copied || 0) + 1;
      cur.note.lastCopiedAt = Date.now();
    }
    persist();
    ui.lastProjectId = loc.project.id;
    // Like Explorer: click one, then Ctrl+click more, and the first one is included.
    ui.anchor = image ? null : { id, at: Date.now() };
    const view = cards.get(id);
    if (view) {
      if (image) {
        const thumb = view.imagesEl.querySelector(`[data-img="${image}"]`) || view.imagesEl.firstElementChild;
        thumb?.classList.remove('is-copied');
        void thumb?.offsetWidth;
        thumb?.classList.add('is-copied');
        setTimeout(() => thumb?.classList.remove('is-copied'), 1300);
      }
      playCopied(view, event, image ? 'Image copied' : 'Copied');
    }
    render();
    if (ui.settings?.hideAfterCopy) setTimeout(() => api.minimize(), 260);
  }

  const playCopied = (view, event, label) => flashCopied(view.card, event, label);

  function flashCopied(card, event, label) {
    const r = card.getBoundingClientRect();
    const x = event && event.clientX ? event.clientX - r.left : r.width / 2;
    const y = event && event.clientY ? event.clientY - r.top : r.height / 2;
    const size = Math.max(r.width, r.height) * 2.2;
    const ripple = el('span', 'ripple');
    Object.assign(ripple.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
    card.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });

    let chip = card.querySelector('.copied-chip');
    if (!chip) {
      chip = el('span', 'copied-chip');
      card.appendChild(chip);
    }
    chip.innerHTML = `${I.check}<span>${label}</span>`;
    card.classList.remove('is-copied');
    void card.offsetWidth;
    card.classList.add('is-copied');
    clearTimeout(card._copiedTimer);
    card._copiedTimer = setTimeout(() => card.classList.remove('is-copied'), 1300);
  }

  // Clicking the Served text copies all of it.
  async function copyFinal(projectId, event) {
    const col = columns.get(projectId);
    const project = findProject(projectId);
    if (!col || !project) return;
    const text = finalText(project);
    // Only pictures, no text: copy the first picture, as Cooked does (1.20.7; it copied nothing before).
    if (!text) return void (col.finalImages.firstElementChild && copyStageImage(col, col.finalImages.firstElementChild, event));
    try {
      await api.copy(text);
    } catch (err) {
      console.error(err);
      toast("Couldn't copy to the clipboard.");
      return;
    }
    ui.lastProjectId = projectId;
    flashCopied(col.finalBody, event, col.finalImages.hidden ? 'Copied' : 'Text copied');
    col.finalSection.classList.remove('is-flash');
    void col.finalSection.offsetWidth;
    col.finalSection.classList.add('is-flash');
    if (ui.settings?.hideAfterCopy) setTimeout(() => api.minimize(), 260);
  }

  // ---- Ctrl+click multi-select: the clipboard always holds the whole selection

  const selectionBar = $('#selection-bar');
  const selCount = $('#sel-count');

  function paintSelection() {
    const n = ui.selection.length;
    selectionBar.hidden = n === 0;
    document.body.classList.toggle('has-selection', n > 0);
    if (n) selCount.textContent = `${n} note${n === 1 ? '' : 's'} copied`;
  }

  async function copySelection() {
    const text = ui.selection.map((id) => locate(id)?.note.text ?? '').filter((t) => t.trim()).join(joiner());
    try {
      await api.copy(text);
      return true;
    } catch (err) {
      console.error(err);
      toast("Couldn't copy to the clipboard.");
      return false;
    }
  }

  async function toggleSelect(id, event) {
    const loc = locate(id);
    if (!loc) return;
    const at = ui.selection.indexOf(id);
    if (at >= 0) {
      ui.selection.splice(at, 1);
    } else {
      if (!loc.note.text.trim()) {
        toast('Image-only notes have no text to combine. Click the image to copy it.');
        return;
      }
      const anchor = ui.anchor;
      if (!ui.selection.length && anchor && anchor.id !== id && Date.now() - anchor.at < ANCHOR_MS && locate(anchor.id)?.note.text.trim()) {
        ui.selection.push(anchor.id);
      }
      ui.selection.push(id);
    }
    ui.anchor = null;
    ui.lastProjectId = loc.project.id;
    if (!ui.selection.length) {
      render();
      return;
    }
    if (!(await copySelection())) return;
    if (at < 0) {
      const cur = locate(id); // as in copyNote: the note may have moved or gone during the await
      if (cur) {
        cur.note.copied = (cur.note.copied || 0) + 1;
        cur.note.lastCopiedAt = Date.now();
      }
      persist();
    }
    render();
    const view = cards.get(id);
    if (view && at < 0) playCopied(view, event, `${ui.selection.length} copied`);
  }

  function clearSelection() {
    ui.anchor = null;
    if (!ui.selection.length) return;
    ui.selection = [];
    render();
  }

  // A selection is a one-off gathering: once you switch away (to paste it), the
  // next Ctrl+click starts a fresh one instead of silently adding to the old.
  window.addEventListener('blur', clearSelection);

  function moveSelectionToUsed() {
    const ids = ui.selection.filter((id) => locate(id)?.list === 'notes');
    if (!ids.length) {
      toast('Those notes are already in Cooked');
      return;
    }
    checkpoint('Move to Cooked');
    // Appended in click order, so the combined note reads in that order.
    for (const id of ids) {
      const loc = locate(id);
      loc.project.notes.splice(loc.index, 1);
      loc.note.usedAt = Date.now();
      loc.project.used.push(loc.note);
      fresh.add(id);
      cards.get(id)?.root.remove();
      cards.delete(id);
    }
    ui.selection = [];
    persist();
    render();
    toast(`Moved ${ids.length} to Cooked`, { action: 'Undo', onAction: undo, history: true });
  }

  $('#sel-used').addEventListener('click', moveSelectionToUsed);
  $('#sel-clear').addEventListener('click', clearSelection);

  // Stack icon / "U": new prompt → end of the Cooked note.
  function toggleUsed(id) {
    if (locate(id)?.list === 'notes') moveBetween(id, 'used');
  }

  function moveBetween(id, to) {
    const loc = locate(id);
    if (!loc || loc.list === to) return;
    const toUsed = to === 'used';
    checkpoint(toUsed ? 'Move to Cooked' : 'Move back');
    loc.project[loc.list].splice(loc.index, 1);
    if (toUsed) {
      loc.note.usedAt = Date.now();
      loc.project.used.push(loc.note);
    } else {
      loc.project.notes.push(loc.note); // back to the bottom of Cooking, just above Cooked
      delete loc.project.notesCollapsed; // and show it
      settleCooked(loc.project);
    }
    fresh.add(id);
    const view = cards.get(id);
    if (view) {
      // Recreate so the enter animation plays in the new spot.
      view.root.remove();
      cards.delete(id);
    }
    persist();
    render();
    const col = columns.get(loc.project.id);
    if (toUsed && loc.project.usedCollapsed && col) bump(col.usedHead);
    toast(toUsed ? 'Added to Cooked' : 'Moved back to Cooking', { action: 'Undo', onAction: undo, history: true });
  }

  // The whole Cooked note → appended to the Served text; Cooked starts empty again.
  function moveAugmentedToFinal(projectId, { animate = false } = {}) {
    const project = findProject(projectId);
    const col = columns.get(projectId);
    if (!project || !project.used.length) return;
    const commit = () => {
      const p = findProject(projectId);
      if (!p || !p.used.length) return;
      checkpoint(isClaudeCode(p) ? 'Serve as Claude Code' : 'Move to Served');
      const now = Date.now();
      if (isClaudeCode(p)) {
        // Formatted for Claude Code: what is served is the formatted text, as one note.
        p.combined.push({ ...makeNote(cookedText(p), stageImages(p.used)), usedAt: now });
      } else {
        for (const n of p.used) n.usedAt = now;
        p.combined.push(...p.used);
      }
      p.used = [];
      settleCooked(p);
      if (col) {
        col.augNote.style.transition = '';
        col.augNote.style.transform = '';
        col.augNote.style.opacity = '';
        col.usedSection.classList.remove('is-swiping');
      }
      persist();
      render();
      if (col) {
        col.finalSection.classList.remove('is-flash');
        void col.finalSection.offsetWidth;
        col.finalSection.classList.add('is-flash');
      }
      toast('Moved to Served', { action: 'Undo', onAction: undo, history: true });
    };
    if (!animate || !col) return commit();
    col.augNote.style.transition = 'transform .2s cubic-bezier(.4,0,1,1), opacity .2s ease-in';
    col.augNote.style.transform = `translateX(-${col.augNote.offsetWidth + 30}px)`;
    col.augNote.style.opacity = '0';
    setTimeout(commit, 220);
  }

  async function copyAugmented(projectId, event) {
    const col = columns.get(projectId);
    const project = findProject(projectId);
    if (!col || !project) return;
    const text = cookedText(project);
    // Only pictures, no text: copy the first picture, like an image-only card.
    if (!text) return void (col.augImages.firstElementChild && copyStageImage(col, col.augImages.firstElementChild, event));
    try {
      await api.copy(text);
    } catch (err) {
      console.error(err);
      toast("Couldn't copy to the clipboard.");
      return;
    }
    ui.lastProjectId = projectId;
    flashCopied(col.augNote, event, col.augImages.hidden ? 'Copied' : 'Text copied');
    if (ui.settings?.hideAfterCopy) setTimeout(() => api.minimize(), 260);
  }

  // A picture in the strip under the Cooked note or the Served text copies on its own.
  // The text never carries its pictures: when the clipboard holds text and a picture,
  // Claude, ChatGPT and most chat boxes attach the picture and drop the text.
  async function copyStageImage(col, tile, event) {
    let ok = false;
    try {
      ok = await api.copyImage(tile.dataset.img);
    } catch (err) {
      console.error(err);
    }
    if (!ok) {
      toast("Couldn't copy to the clipboard.");
      return;
    }
    ui.lastProjectId = col.id;
    tile.classList.remove('is-copied');
    void tile.offsetWidth;
    tile.classList.add('is-copied');
    setTimeout(() => tile.classList.remove('is-copied'), 1300);
    flashCopied(tile.closest('.aug-note, .final-body'), event, 'Image copied');
    if (ui.settings?.hideAfterCopy) setTimeout(() => api.minimize(), 260);
  }

  // ---- editing the Cooked note and the Served text
  // The pencil in the footer edits the whole text, which is saved back as ONE note.
  // The pencil on a row in the Notes list edits just that part; the others stay separate.

  function closeStageEditor(col) {
    const editor = col?.stageEditor;
    if (!editor) return;
    col.stageEditor = null;
    editor.composer.destroy();
    editor.composer.root.remove();
    render();
  }

  function closeStageEditors() {
    for (const c of columns.values()) closeStageEditor(c);
  }

  const imageKey = (list) => list.map((i) => i.id).join(',');
  const stageText = (project, list) => (list === 'used' ? augmentedText(project) : finalText(project));

  function editStage(projectId, list, partId = null) {
    const col = columns.get(projectId);
    const project = findProject(projectId);
    if (!col || !project || !project[list].length) return;
    const part = partId ? project[list].find((n) => n.id === partId) : null;
    if (partId && !part) return;
    if (ui.composing) closeComposer();
    if (ui.editing) stopEditing();
    closeStageEditors();
    const name = STAGE_NAME[list];
    const openedIds = new Set(project[list].map((n) => n.id));
    const composer = createComposer({
      text: part ? part.text : stageText(project, list),
      images: part ? part.images : project[list].flatMap((n) => n.images),
      placeholder: part ? 'Edit this note…' : `Edit the ${name.toLowerCase()} text…`,
      closeLabel: 'Cancel',
      allowDelete: true,
      deleteLabel: part ? 'Delete this note' : `Delete the whole ${STAGE_WHOLE[list].toLowerCase()}`,
      onSave: (text, images) => {
        saveStageEdit(projectId, list, partId, text, images, openedIds);
        closeStageEditor(col);
      },
      onCancel: () => closeStageEditor(col),
      onDelete: () => {
        closeStageEditor(col);
        if (partId) deletePart(projectId, list, partId);
        else deleteStageText(projectId, list, openedIds);
      },
    });
    col.stageEditor = { list, partId, composer };
    (list === 'used' ? col.augWrap : col.finalEditHost).appendChild(composer.root);
    ui.lastProjectId = projectId;
    render();
    composer.focus();
  }

  function saveStageEdit(projectId, list, partId, text, images, openedIds) {
    const p = findProject(projectId);
    if (!p) return;
    if (partId) {
      const note = p[list].find((n) => n.id === partId);
      if (!note || (note.text === text && imageKey(note.images) === imageKey(images))) return;
      checkpoint('Edit note');
      note.text = text;
      note.images = images;
      note.updatedAt = Date.now();
    } else {
      // Notes that arrived while the editor was open (a prompt dropped in, say)
      // weren't in the text being edited, so they stay, after the edited note.
      const arrived = p[list].filter((n) => !openedIds.has(n.id));
      const opened = p[list].filter((n) => openedIds.has(n.id));
      const openedText = opened.map((n) => n.text).filter((t) => t.trim()).join(joiner());
      // Saved unchanged: keep the separate parts as they are.
      if (openedText === text && imageKey(opened.flatMap((n) => n.images)) === imageKey(images)) return;
      checkpoint(`Edit ${STAGE_NAME[list]}`);
      p[list] = [{ ...makeNote(text, images), usedAt: Date.now() }, ...arrived];
    }
    persist();
  }

  // One part of the Cooked note or the Served text: the trash on its Notes row, or in its editor.
  function deletePart(projectId, list, partId) {
    const p = findProject(projectId);
    const index = p ? p[list].findIndex((n) => n.id === partId) : -1;
    if (index < 0) return;
    const col = columns.get(projectId);
    if (col?.stageEditor?.list === list) closeStageEditor(col);
    checkpoint('Delete note');
    p[list].splice(index, 1);
    settleCooked(p);
    persist();
    render();
    toast('Note deleted', { action: 'Undo', onAction: undo, duration: 7000, history: true });
  }

  // The trash in the whole-text editor deletes the whole Cooked note (or Served text).
  // Anything that arrived while the editor was open wasn't in it, so it stays.
  function deleteStageText(projectId, list, openedIds) {
    const p = findProject(projectId);
    if (!p || !p[list].some((n) => openedIds.has(n.id))) return;
    const what = STAGE_WHOLE[list];
    checkpoint(`Delete ${what}`);
    p[list] = p[list].filter((n) => !openedIds.has(n.id));
    settleCooked(p);
    persist();
    render();
    toast(`${what} deleted`, { action: 'Undo', onAction: undo, duration: 7000, history: true });
  }

  // ↑ / ↓ on a row in the Notes list: reorder the parts of the Cooked note or the Served text.
  function movePart(id, delta) {
    const loc = locate(id);
    if (!loc || loc.list === 'notes') return;
    const list = loc.project[loc.list];
    const j = loc.index + delta;
    if (j < 0 || j >= list.length) return;
    checkpoint('Reorder');
    list.splice(loc.index, 1);
    list.splice(j, 0, loc.note);
    persist();
    render();
  }

  // A note in the Served text → back to the end of the Cooked note.
  function sendBackFromFinal(id) {
    const loc = locate(id);
    if (!loc || loc.list !== 'combined') return;
    checkpoint('Send back to Cooked');
    loc.project.combined.splice(loc.index, 1);
    loc.project.used.push(loc.note);
    fresh.add(id);
    persist();
    render();
    toast('Sent back to Cooked', { action: 'Undo', onAction: undo, history: true });
  }

  function setHighlight(id, hl) {
    const loc = locate(id);
    if (!loc || (loc.note.highlight ?? null) === hl) return;
    checkpoint(hl ? 'Highlight' : 'Remove highlight');
    if (hl) loc.note.highlight = hl;
    else delete loc.note.highlight;
    persist();
    render();
  }

  function openHighlightMenu(id, anchor) {
    const loc = locate(id);
    if (!loc) return;
    openMenu(anchor, (menu) => {
      for (const h of HIGHLIGHTS) {
        const b = el('button', 'menu-item hl-item', `<span class="hl-dot" style="--c:${h.color}"></span><span>${escapeHtml(h.name)}</span>${loc.note.highlight === h.id ? I.check : ''}`);
        b.addEventListener('click', () => { closeMenu(); setHighlight(id, h.id); });
        menu.appendChild(b);
      }
      menu.appendChild(el('div', 'menu-sep'));
      const none = el('button', 'menu-item', `${I.close}<span>No highlight</span>`);
      none.disabled = !loc.note.highlight;
      none.addEventListener('click', () => { closeMenu(); setHighlight(id, null); });
      menu.appendChild(none);
    });
  }

  function bump(node) {
    node.classList.remove('is-bump');
    void node.offsetWidth;
    node.classList.add('is-bump');
  }

  function deleteNote(id, { animate = true } = {}) {
    const view = cards.get(id);
    const commit = () => {
      const loc = locate(id);
      if (!loc) return;
      checkpoint('Delete note');
      loc.project[loc.list].splice(loc.index, 1);
      persist();
      render();
      toast('Note deleted', { action: 'Undo', onAction: undo, duration: 7000, history: true });
    };
    if (!locate(id)) return;
    if (!animate || !view || !view.root.isConnected) return commit();
    animateOut(view).then(commit);
  }

  function animateOut(view) {
    return new Promise((resolve) => {
      const wrap = view.root;
      const card = view.card;
      wrap.classList.add('is-removing');
      wrap.style.height = `${wrap.offsetHeight}px`;
      card.style.transition = 'transform .2s cubic-bezier(.4,0,1,1), opacity .2s ease-in';
      card.style.transform = `translateX(-${wrap.offsetWidth + 30}px)`;
      card.style.opacity = '0';
      setTimeout(() => {
        wrap.style.transition = 'height .18s var(--ease), margin .18s var(--ease)';
        wrap.style.height = '0px';
        wrap.style.marginBottom = 'calc(var(--gap) * -1)';
      }, 150);
      setTimeout(resolve, 340);
    });
  }

  // ================================================================ project actions

  function createProject(name = 'New project') {
    checkpoint('New project');
    const color = 'moss'; // 1.20.10: a new column starts as Pending (blue)
    const project = { id: uid(), name, color, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: Date.now(), notes: [], used: [], combined: [] };
    setBoardOrder(boardProjects().concat(project));
    ui.lastProjectId = project.id;
    if (ui.widget) { // the widget shows the new column (1.19)
      ui.widgetId = project.id;
      api.setWidget(true, project.id).catch(() => {});
    }
    persist();
    render();
    const col = columns.get(project.id);
    col.root.classList.add('is-new');
    col.root.addEventListener('animationend', () => col.root.classList.remove('is-new'), { once: true });
    col.root.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    startRename(col);
  }

  function startRename(col) {
    if (col.renaming) return;
    const project = findProject(col.id);
    if (!project) return;
    col.renaming = true;
    const input = el('input', 'col-name-input');
    input.value = project.name;
    input.maxLength = 80;
    input.spellcheck = false;
    col.nameEl.hidden = true;
    col.nameEl.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const p = findProject(col.id);
      const value = input.value.trim();
      if (save && p && value && value !== p.name) {
        checkpoint('Rename project');
        p.name = value;
        persist();
      }
      input.remove();
      col.nameEl.hidden = false;
      col.renaming = false;
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  function deleteProject(id) {
    const index = data.projects.findIndex((p) => p.id === id);
    if (index < 0) return;
    checkpoint('Delete project');
    const [project] = data.projects.splice(index, 1);
    if (ui.composing === id) ui.composing = null;
    if (ui.editing && project.notes.concat(project.used).some((n) => n.id === ui.editing)) ui.editing = null;
    persist();
    render();
    toast(`Deleted “${project.name}”`, { action: 'Undo', onAction: undo, duration: 9000, history: true });
  }

  // Project menu › Clear Cooked / Clear Served (list is the data name: 'used' or 'combined').
  function clearStage(id, list) {
    const project = findProject(id);
    if (!project || !project[list].length) return;
    const col = columns.get(id);
    if (col?.stageEditor?.list === list) closeStageEditor(col);
    const name = STAGE_NAME[list];
    checkpoint(`Clear ${name}`);
    project[list] = [];
    settleCooked(project);
    persist();
    render();
    toast(`Cleared ${name}`, { action: 'Undo', onAction: undo, duration: 7000, history: true });
  }

  // Move left / right in drawing order: inside a group a column moves among its group; outside
  // one it steps past the neighbouring column or the whole neighbouring group.
  function moveTarget(id, delta) {
    const project = findProject(id);
    if (!project) return null;
    const units = boardLayout();
    const g = groupOf(project);
    if (g) {
      const unit = units.find((u) => u.group === g);
      const i = unit.ids.indexOf(id);
      const j = i + delta;
      if (j >= 0 && j < unit.ids.length) return { units, swap: () => { [unit.ids[i], unit.ids[j]] = [unit.ids[j], unit.ids[i]]; } };
      // 1.20: at the group's edge it steps out of the group, to just beside it
      const gi = units.indexOf(unit);
      return { units, leaves: g, swap: () => { unit.ids.splice(i, 1); units.splice(delta < 0 ? gi : gi + 1, 0, { group: null, ids: [id] }); delete project.group; delete project.groupFolded; } };
    }
    const i = units.findIndex((u) => !u.group && u.ids[0] === id);
    const j = i + delta;
    return i < 0 || j < 0 || j >= units.length ? null : { units, swap: () => { [units[i], units[j]] = [units[j], units[i]]; } };
  }

  function moveProject(id, delta) {
    const move = moveTarget(id, delta);
    if (!move) return;
    checkpoint(move.leaves ? 'Remove from group' : 'Move project');
    const cols = [...columns.values()].map((c) => c.root);
    flip(cols, () => {
      move.swap();
      setBoardOrder(move.units.flatMap((u) => u.ids).map(findProject));
      render();
    }, 260);
    persist();
  }

  // ================================================================ composer

  function createComposer({ text = '', images: initialImages = [], placeholder, closeLabel = 'Close', allowDelete = false, allowClear = false, deleteLabel = 'Delete note', onSave, onCancel, onDraft, onDelete }) {
    const root = el('div', 'composer');
    root.innerHTML = `
      <textarea rows="2" spellcheck="true"></textarea>
      <div class="composer-images"></div>
      <div class="composer-msg" hidden></div>
      <div class="composer-bar">
        <button type="button" class="mic-btn" aria-label="Dictate">
          <span class="mic-ico">${I.mic}</span><span class="stop-ico">${I.stop}</span>
          <span class="rec-time">0:00</span>
          <span class="bars"><i style="--k:.55"></i><i style="--k:1"></i><i style="--k:.75"></i><i style="--k:.4"></i></span>
        </button>
        <button type="button" class="icon-btn shot-btn" title="Add a screenshot (${kb('Ctrl+Shift+S')}) — or paste an image" aria-label="Add a screenshot">${I.camera}</button>
        <span class="composer-status"></span>
        <span class="spacer"></span>
        ${allowClear ? `<button type="button" class="icon-btn comp-clear" title="Clear the text (dictation keeps listening)" aria-label="Clear the text">${I.eraser}</button>` : ''}
        ${allowDelete ? `<button type="button" class="icon-btn danger comp-delete" title="${deleteLabel}" aria-label="${deleteLabel}">${I.trash}</button>` : ''}
        <button type="button" class="icon-btn comp-cancel" title="${closeLabel} (Esc)" aria-label="${closeLabel}">${I.close}</button>
        <button type="button" class="btn btn-primary comp-save" title="Save (${kb('Ctrl+Enter')})">Save</button>
      </div>`;
    const ta = $('textarea', root);
    const micBtn = $('.mic-btn', root);
    const timeEl = $('.rec-time', root);
    const statusEl = $('.composer-status', root);
    const msgEl = $('.composer-msg', root);
    const imagesEl = $('.composer-images', root);
    ta.value = text;
    ta.placeholder = placeholder;

    let images = initialImages.slice();
    let recState = 'off';  // off | starting | on
    let rec = null;
    let timer = null;
    const queue = [];      // recorded phrases waiting for transcription, in order
    let working = false;
    let anchor = ta.value.length; // where the next dictated text goes
    let context = '';      // recent dictated text, sent as a prompt for continuity
    let pendingSave = false;
    let capturing = false;
    let destroyed = false;
    let lastValue = ta.value; // to work out what the user changed on each keystroke
    let region = null;        // { start, text }: where the phrase being transcribed is streaming in
    let epoch = 0;            // raised by Clear: a phrase still landing from before it is dropped

    // When the user edits while dictation is landing, shift the dictation point and
    // the streaming region so spoken text keeps going to the right place.
    function followUserEdit() {
      const oldV = lastValue;
      const newV = ta.value;
      lastValue = newV;
      if (oldV === newV) return;
      let p = 0;
      while (p < oldV.length && p < newV.length && oldV[p] === newV[p]) p++;
      let sfx = 0;
      while (sfx < oldV.length - p && sfx < newV.length - p && oldV[oldV.length - 1 - sfx] === newV[newV.length - 1 - sfx]) sfx++;
      const oldEnd = oldV.length - sfx;
      const newEnd = newV.length - sfx;
      const delta = newV.length - oldV.length;
      const map = (pos) => (pos < p ? pos : pos > oldEnd ? pos + delta : newEnd);
      anchor = map(anchor);
      if (region) {
        const rs = region.start;
        const re = rs + region.text.length;
        if (oldEnd <= rs) region.start += delta;          // edit before the streaming text
        else if (p >= re) { /* edit after it: nothing moves */ }
        else {                                             // edit inside it: the user owns that text now
          region.detached = true;
          region.start = re + delta;
          region.text = '';
        }
      }
    }

    const draft = () => onDraft?.(ta.value, images.slice());

    function autosize() {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight + 2, 300)}px`;
    }

    function refresh() {
      const busy = working || queue.length > 0;
      root.classList.toggle('is-starting', recState === 'starting');
      root.classList.toggle('is-recording', recState === 'on');
      root.classList.toggle('is-busy', working || capturing);
      ta.readOnly = false; // you can keep typing and editing while it listens
      micBtn.title = recState === 'on' ? `Stop dictating (${kb('Ctrl+M')})` : `Dictate (${kb('Ctrl+M')})`;
      if (recState === 'starting') statusEl.innerHTML = '<span class="shimmer">Starting mic…</span>';
      else if (recState === 'on') statusEl.innerHTML = `<span class="shimmer">${working ? 'Writing…' : 'Listening…'}</span>`;
      else if (recState === 'off' && working) statusEl.innerHTML = `<span class="shimmer">${pendingSave ? 'Saving…' : 'Writing…'}</span>`;
      else if (recState === 'off' && busy) statusEl.textContent = '';
      else statusEl.textContent = '';
    }

    // ---- messages (errors and notices get their own full-width row)
    function showMessage(message, { error = false, actions = [] } = {}) {
      msgEl.hidden = false;
      msgEl.classList.toggle('is-error', error);
      msgEl.innerHTML = `<span>${escapeHtml(message)}</span>`;
      for (const action of actions) {
        const btn = el('button', 'status-action', escapeHtml(action.label));
        btn.type = 'button';
        btn.addEventListener('click', action.fn);
        msgEl.appendChild(btn);
      }
    }
    function hideMessage() {
      msgEl.hidden = true;
      msgEl.textContent = '';
    }

    // ---- images
    function renderImages() {
      imagesEl.innerHTML = images.map((img) => `
        <div class="attach" data-img="${img.id}" title="Click to view">
          <img src="${imgUrl(img.id, true)}" alt="" draggable="false" />
          <button type="button" class="attach-remove" title="Remove image" aria-label="Remove image">${I.close}</button>
        </div>`).join('');
    }
    function addImage(image) {
      if (destroyed || !image || images.some((i) => i.id === image.id)) return;
      images.push(image);
      renderImages();
      draft();
    }
    async function addFiles(files) {
      for (const file of files) {
        try {
          const res = await api.saveImage(await imageFileToBytes(file));
          if (res.ok) addImage(res.image);
          else showMessage(res.error, { error: true });
        } catch {
          showMessage("That file isn't an image Recaller can read.", { error: true });
        }
      }
    }
    async function screenshot() {
      if (capturing || destroyed) return;
      capturing = true;
      refresh();
      let res = null;
      try {
        res = await api.captureScreen();
      } catch (err) {
        res = { ok: false, error: err.message };
      }
      capturing = false;
      if (destroyed) return;
      refresh();
      if (res?.ok) {
        addImage(res.image);
        hideMessage();
      } else if (IS_MAC && res?.code === 'PERMISSION') {
        // macOS hasn't allowed Recaller to record the screen yet: offer the settings pane.
        showMessage(res.error || 'Screenshot failed.', { error: true, actions: [{ label: 'Open System Settings', fn: () => api.openPrivacy('screen') }] });
      } else if (res && res.code !== 'CANCELLED') {
        showMessage(res.error || 'Screenshot failed.', { error: true });
      }
      ta.focus();
    }

    // ---- voice: phrases are transcribed while you keep talking
    function tick() {
      if (!rec) return;
      const s = Math.floor(rec.elapsed() / 1000);
      timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    async function startVoice() {
      if (recState !== 'off' || destroyed) return;
      if (ui.settings && !ui.settings.hasKey) {
        showMessage('Voice needs an OpenAI API key.', { error: true, actions: [{ label: 'Add key', fn: () => openSettings({ focusKey: true }) }] });
        return;
      }
      hideMessage();
      if (!working && !queue.length) anchor = document.activeElement === ta ? ta.selectionEnd : ta.value.length;
      recState = 'starting';
      refresh();
      try {
        const r = await Voice.start({
          onLevel: (level) => root.style.setProperty('--level', level.toFixed(3)),
          onSegment: (audio) => {
            if (destroyed) return;
            queue.push(audio);
            pump();
          },
          onAutoStop: () => stopVoice(),
        });
        if (destroyed || r.cancelled) { r.cancel(); return; }
        rec = r;
        recState = 'on';
        timeEl.textContent = '0:00';
        refresh();
        timer = setInterval(tick, 250);
      } catch (err) {
        if (destroyed) return;
        recState = 'off';
        refresh();
        if (IS_MAC && err.code === 'DENIED') {
          // macOS blocked the microphone: offer the settings pane.
          showMessage(err.message || 'Could not start the microphone.', { error: true, actions: [{ label: 'Open System Settings', fn: () => api.openPrivacy('microphone') }] });
          return;
        }
        showMessage(err.message || 'Could not start the microphone.', { error: true });
      }
    }

    async function stopVoice() {
      if (recState !== 'on' || !rec) return;
      clearInterval(timer);
      const r = rec;
      rec = null;
      recState = 'off';
      refresh();
      const heard = await r.stop(); // hands the last phrase to the queue
      if (destroyed) return;
      if (!heard && !queue.length && !working) {
        if (pendingSave) {
          pendingSave = false;
          save();
        } else {
          showMessage("Didn't catch that. Try speaking a little longer.");
        }
        return;
      }
      if (!working && !queue.length) settle();
    }

    async function pump() {
      if (working || destroyed) return;
      working = true;
      refresh();
      while (queue.length && !destroyed) {
        const audio = queue[0];
        try {
          await transcribeInto(audio);
          if (queue[0] === audio) queue.shift(); // Clear may have emptied the queue meanwhile
        } catch (err) {
          if (destroyed) return;
          if (queue[0] !== audio) continue; // cleared while it was on its way: nothing to retry
          working = false;
          pendingSave = false;
          refresh();
          const needsKey = err.code === 'NO_KEY' || err.code === 'AUTH';
          showMessage(err.message || 'Transcription failed.', {
            error: true,
            actions: needsKey
              ? [{ label: 'Settings', fn: () => openSettings({ focusKey: true }) }]
              : [
                { label: 'Retry', fn: () => { hideMessage(); pump(); } },
                { label: 'Discard', fn: () => { queue.length = 0; hideMessage(); refresh(); settle(); } },
              ],
          });
          return;
        }
      }
      working = false;
      refresh();
      if (!destroyed && recState === 'off') settle();
    }

    // Streams one phrase into the textarea at the dictation point, without
    // disturbing the user's own cursor if they are typing at the same time.
    async function transcribeInto(audio) {
      const mine = epoch;
      anchor = Math.min(anchor, ta.value.length);
      region = { start: anchor, text: '', detached: false };
      let streamed = '';  // everything received for this phrase
      let owned = 0;      // how much of `streamed` the user has since edited into their own text
      const leadAt = (pos) => {
        const before = ta.value.slice(0, pos);
        return before && !/\s$/.test(before) ? ' ' : '';
      };
      const put = (t) => {
        if (mine !== epoch) return; // cleared: this phrase no longer has a place
        const v = ta.value;
        const { start, text: old } = region;
        const focused = document.activeElement === ta;
        const [s0, s1] = [ta.selectionStart, ta.selectionEnd];
        ta.value = v.slice(0, start) + t + v.slice(start + old.length);
        region.text = t;
        lastValue = ta.value;
        const delta = t.length - old.length;
        // Caret before the dictation stays put; at or after it, it moves along with the new words.
        const fix = (pos) => (pos < start ? pos : pos >= start + old.length ? pos + delta : start + t.length);
        if (focused) ta.setSelectionRange(fix(s0), fix(s1));
        else {
          ta.setSelectionRange(start + t.length, start + t.length);
          ta.scrollTop = ta.scrollHeight;
        }
        autosize();
      };
      const textFor = (full) => {
        if (region.detached && owned === 0) owned = streamed.length;
        let rest = full.slice(owned);
        if (!rest) return '';
        if (!region.detached) rest = rest.trimStart();
        const lead = region.detached ? '' : (region.lead ??= leadAt(region.start));
        return lead + rest;
      };
      let result;
      try {
        result = await Voice.transcribe(audio, {
          context,
          onDelta: (d) => {
            if (destroyed) return;
            streamed += d;
            put(textFor(streamed));
          },
          onReset: () => {
            if (destroyed) return;
            streamed = '';
            owned = 0;
            put('');
          },
        });
      } catch (err) {
        if (mine !== epoch) throw err;
        if (!destroyed && !region.detached) put('');
        region = null;
        throw err;
      }
      if (destroyed || mine !== epoch) return;
      if (region.detached && owned === 0) owned = streamed.length;
      put(result ? textFor(result) : '');
      anchor = region.start + region.text.length;
      region = null;
      if (result) {
        context = `${context} ${result}`.slice(-600);
        root.classList.remove('is-flash');
        void root.offsetWidth;
        root.classList.add('is-flash');
      }
      draft();
    }

    // Called once a dictation session has fully landed in the textarea.
    function settle() {
      const v = ta.value;
      const typing = document.activeElement === ta && (ta.selectionStart !== anchor || ta.selectionEnd !== anchor);
      if (anchor > 0 && anchor < v.length && !/\s/.test(v[anchor]) && !/\s/.test(v[anchor - 1])) {
        const [s0, s1] = [ta.selectionStart, ta.selectionEnd];
        ta.value = `${v.slice(0, anchor)} ${v.slice(anchor)}`;
        lastValue = ta.value;
        if (typing) ta.setSelectionRange(s0 >= anchor ? s0 + 1 : s0, s1 >= anchor ? s1 + 1 : s1);
        anchor += 1;
      }
      refresh();
      if (!typing) {
        ta.focus();
        ta.setSelectionRange(anchor, anchor);
      }
      draft();
      if (pendingSave) {
        pendingSave = false;
        save();
      }
    }

    function toggleVoice() {
      if (recState === 'on') stopVoice();
      else if (recState === 'off') startVoice();
    }

    // ---- save / cancel
    function save() {
      if (capturing) return;
      if (recState === 'on') {
        pendingSave = true;
        stopVoice();
        return;
      }
      if (recState === 'starting' || working) {
        pendingSave = true;
        refresh();
        return;
      }
      queue.length = 0; // a failed phrase the user chose not to retry
      const value = ta.value.trim();
      if (!value && !images.length) {
        root.classList.remove('is-shake');
        void root.offsetWidth;
        root.classList.add('is-shake');
        ta.focus();
        return;
      }
      onSave(value, images.slice());
      if (!destroyed) {
        hideMessage();
        ta.value = '';
        lastValue = '';
        images = [];
        renderImages();
        anchor = 0;
        context = '';
        autosize();
        refresh();
        ta.focus();
      }
    }

    function cancel() {
      if (recState === 'on') return stopVoice(); // first Esc stops listening
      if (recState === 'starting') return;
      onCancel(ta.value, images.slice());
    }

    // Clear (1.18, the new-text editor): empties the text and pictures. Dictation keeps listening,
    // and phrases spoken before the Clear are dropped. The toast's Undo puts it all back.
    function clear() {
      const before = { text: ta.value, images: images.slice() };
      if (!before.text && !before.images.length && !queue.length && !working) return ta.focus();
      epoch++;
      queue.length = 0;
      region = null;
      pendingSave = false;
      ta.value = '';
      lastValue = '';
      images = [];
      renderImages();
      anchor = 0;
      context = '';
      hideMessage();
      autosize();
      refresh();
      draft();
      ta.focus();
      if (!before.text && !before.images.length) return;
      toast('Text cleared', {
        action: 'Undo',
        onAction: () => {
          if (destroyed) return;
          ta.value = before.text + (ta.value ? ` ${ta.value}` : '');
          lastValue = ta.value;
          for (const img of before.images) if (!images.some((i) => i.id === img.id)) images.push(img);
          renderImages();
          anchor = ta.value.length;
          autosize();
          draft();
          ta.focus();
        },
      });
    }

    // ---- events
    ta.addEventListener('input', () => {
      followUserEdit();
      autosize();
      draft();
    });
    ta.addEventListener('keydown', (e) => {
      const mod = modKey(e);
      const k = e.key.toLowerCase();
      if (e.key === 'Enter' && mod) { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (mod && !e.shiftKey && !e.altKey && k === 'm') { e.preventDefault(); e.stopPropagation(); toggleVoice(); }
      else if (mod && e.shiftKey && k === 's') { e.preventDefault(); e.stopPropagation(); screenshot(); }
    });
    ta.addEventListener('paste', (e) => {
      const dt = e.clipboardData;
      if (!dt || dt.getData('text/plain')) return; // text wins over an image preview of it
      const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });
    root.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      root.classList.add('is-dropping');
    });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('is-dropping'); });
    root.addEventListener('drop', (e) => {
      root.classList.remove('is-dropping');
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });
    imagesEl.addEventListener('click', (e) => {
      const tile = e.target.closest('.attach');
      if (!tile) return;
      if (e.target.closest('.attach-remove')) {
        images = images.filter((i) => i.id !== tile.dataset.img);
        renderImages();
        draft();
      } else {
        openLightbox(tile.dataset.img);
      }
    });
    micBtn.addEventListener('click', toggleVoice);
    $('.shot-btn', root).addEventListener('click', screenshot);
    $('.comp-save', root).addEventListener('click', save);
    $('.comp-cancel', root).addEventListener('click', cancel);
    $('.comp-delete', root)?.addEventListener('click', () => onDelete?.());
    $('.comp-clear', root)?.addEventListener('click', clear);

    renderImages();
    refresh();
    requestAnimationFrame(autosize);

    return {
      root,
      focus() {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        autosize();
      },
      startVoice,
      toggleVoice,
      screenshot,
      addImage,
      clear,
      value: () => ta.value,
      images: () => images.slice(),
      isBusy: () => recState !== 'off' || working || capturing,
      destroy() {
        destroyed = true;
        clearInterval(timer);
        rec?.cancel();
        rec = null;
      },
    };
  }

  // ================================================================ gestures

  // Things inside a column that scroll on their own (the opened-up Cooked and Served
  // texts and their Notes lists scroll inside a capped height).
  const SCROLLERS = '.col-scroll, textarea, .aug-text, .final-text, .aug-parts, .final-parts, .mini-stack';
  const onScrollbar = (e) => e.target instanceof HTMLElement && e.target.matches(SCROLLERS) && e.offsetX >= e.target.clientWidth;

  board.addEventListener('pointerdown', (e) => {
    // On a Mac, Control+click is a right-click: no copy, select, drag or pan (the contextmenu listener edits).
    if (IS_MAC && e.ctrlKey && e.button === 0) return;
    // Middle button anywhere, or left button on empty canvas: pan the board.
    const canvas = (e.target === board || e.target.classList.contains('group-cols') || e.target.classList.contains('col-group')) && !onScrollbar(e);
    if (e.button === 1 || (e.button === 0 && canvas)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (onScrollbar(e)) return; // dragging a scrollbar, not the note
    const ctrlOnCard = multiKey(e) && e.target.closest('.card-wrap') && !e.target.closest('button');
    if (!ctrlOnCard) ui.anchor = null;
    const colEl = e.target.closest('.column');
    if (colEl) {
      ui.lastProjectId = colEl.dataset.id;
      rememberProject();
    }
    if (colEl && e.target.closest('.col-resize')) {
      startColumnResize(e, columns.get(colEl.dataset.id));
      return;
    }
    // 1.20.10: a press on a Minimized card outside its rows (its label, the space around them) moves the
    // whole card, all its rows together. A row still moves on its own from the row itself.
    const cardEl = !colEl && !ui.widget && e.target.closest('.mini-stack');
    if (cardEl) {
      if (cardEl.querySelector('.column')) {
        e.preventDefault();
        startColumnGesture(e, cardEl);
      }
      return;
    }
    const groupGrip = !ui.widget && e.target.closest('.group-head, .group-strip');
    if (groupGrip && !e.target.closest('.group-menu, input')) {
      const groupEl = groupGrip.closest('.col-group');
      if (groupEl && !groups.get(groupEl.dataset.group)?.renaming) startGroupGesture(e, groupEl);
      return;
    }
    if (e.target.closest('button, input, textarea, select, .composer, a')) return;

    const augNote = e.target.closest('.aug-note');
    if (augNote && colEl) {
      e.preventDefault();
      startAugGesture(e, columns.get(colEl.dataset.id));
      return;
    }
    const wrap = e.target.closest('.card-wrap');
    if (wrap && !wrap.classList.contains('is-editing') && !wrap.classList.contains('is-removing')) {
      e.preventDefault(); // no text selection / native drag
      startCardGesture(e, wrap);
      return;
    }
    const head = e.target.closest('.col-head');
    if (head && colEl && !ui.widget && !columns.get(colEl.dataset.id)?.renaming) startColumnGesture(e, colEl);
  });

  function trackPointer(e, { onMove, onEnd }) {
    const id = e.pointerId;
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      // Button no longer held but we never saw pointerup (e.g. released during an
      // alt-tab): abandon the gesture instead of dragging with a free-floating mouse.
      if (ev.buttons === 0) return blur();
      onMove(ev);
    };
    const end = (ev) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', blur);
      onEnd(ev, ev.type === 'pointercancel');
    };
    const blur = () => end({ pointerId: id, type: 'pointercancel', clientX: 0, clientY: 0 });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', blur);
  }

  function startCardGesture(e, wrap) {
    const view = cards.get(wrap.dataset.id);
    if (!view) return;
    const g = {
      id: view.id, view, wrap, card: view.card,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: null,
      imageId: e.target.closest('.card-img')?.dataset.img ?? null,
      multi: multiKey(e),
    };
    view.card.classList.add('is-pressed');
    const hold = setTimeout(() => { if (!g.mode) beginDrag(g); }, HOLD_MS);

    trackPointer(e, {
      onMove(ev) {
        g.x = ev.clientX;
        g.y = ev.clientY;
        const dx = g.x - g.x0;
        const dy = g.y - g.y0;
        g.travel = Math.max(g.travel || 0, Math.hypot(dx, dy));
        if (!g.mode) {
          if (Math.hypot(dx, dy) < MOVE_SLOP) return;
          clearTimeout(hold);
          if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2) beginSwipe(g);
          else beginDrag(g);
        }
        if (g.mode === 'swipe') swipeMove(g, dx, ev.timeStamp);
        else if (g.mode === 'drag') dragMove(g);
      },
      onEnd(ev, cancelled) {
        clearTimeout(hold);
        view.card.classList.remove('is-pressed');
        if (!g.mode) {
          if (!cancelled) (g.multi ? toggleSelect(g.id, ev) : copyNote(g.id, ev, g.imageId));
        } else if (g.mode === 'swipe') {
          swipeEnd(g, cancelled);
        } else if (g.mode === 'drag') {
          // A long press that never moved is still a click: copy, don't drag.
          const stillClick = !cancelled && (g.travel || 0) < MOVE_SLOP;
          dragEnd(g, cancelled || stillClick);
          if (stillClick) (g.multi ? toggleSelect(g.id, ev) : copyNote(g.id, ev, g.imageId));
        }
      },
    });
  }

  // ---- the Cooked note: click copies, swipe left or drag onto Served moves it down

  function startAugGesture(e, col) {
    if (!col) return;
    const note = col.augNote;
    const g = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: null, travel: 0 };
    // A click on a picture in the strip copies that picture; anywhere else copies the text.
    const tile = e.target.closest('.aug-images .card-img');
    const copy = (ev) => (tile ? copyStageImage(col, tile, ev) : copyAugmented(col.id, ev));
    const beginDrag = () => {
      g.mode = 'drag';
      dragActive = true;
      const rect = note.getBoundingClientRect();
      g.offX = g.x0 - rect.left;
      g.offY = g.y0 - rect.top;
      g.ghost = el('div', 'drag-ghost');
      g.ghost.style.width = `${rect.width}px`;
      g.ghost.style.setProperty('--accent', col.root.style.getPropertyValue('--accent'));
      const clone = note.cloneNode(true);
      clone.classList.add('card');
      clone.querySelectorAll('.ripple, .copied-chip').forEach((n) => n.remove());
      g.ghost.appendChild(clone);
      document.body.appendChild(g.ghost);
      note.classList.add('is-drag-source');
      document.body.classList.add('is-dragging');
      requestAnimationFrame(() => g.ghost.classList.add('is-lifted'));
    };
    const overFinal = () => {
      const r = col.finalSection.getBoundingClientRect();
      return g.x >= r.left - 20 && g.x <= r.right + 20 && g.y >= r.top - 8;
    };
    const hold = setTimeout(() => { if (!g.mode) beginDrag(); }, HOLD_MS);
    trackPointer(e, {
      onMove(ev) {
        g.x = ev.clientX;
        g.y = ev.clientY;
        const dx = g.x - g.x0;
        const dy = g.y - g.y0;
        g.travel = Math.max(g.travel, Math.hypot(dx, dy));
        if (!g.mode) {
          if (g.travel < MOVE_SLOP) return;
          clearTimeout(hold);
          if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            g.mode = 'swipe';
            g.width = note.offsetWidth;
            col.usedSection.classList.add('is-swiping');
          } else {
            beginDrag();
          }
        }
        if (g.mode === 'swipe') {
          const x = Math.min(0, dx);
          g.lastX = x;
          note.style.transform = `translateX(${x}px)`;
          col.augWrap.style.setProperty('--swipe', Math.min(1, -x / (g.width * SWIPE_RATIO)).toFixed(3));
        } else if (g.mode === 'drag') {
          g.ghost.style.transform = `translate3d(${g.x - g.offX}px, ${g.y - g.offY}px, 0)`;
          col.finalSection.classList.toggle('is-drop-target', overFinal());
        }
      },
      onEnd(ev, cancelled) {
        clearTimeout(hold);
        if (!g.mode) {
          if (!cancelled) copy(ev);
          return;
        }
        if (g.mode === 'swipe') {
          if (!cancelled && -(g.lastX || 0) >= g.width * SWIPE_RATIO) {
            moveAugmentedToFinal(col.id, { animate: true });
          } else {
            note.style.transition = 'transform .32s var(--spring)';
            note.style.transform = '';
            setTimeout(() => {
              note.style.transition = '';
              col.usedSection.classList.remove('is-swiping');
              col.augWrap.style.setProperty('--swipe', '0');
            }, 320);
          }
          return;
        }
        // drag
        const drop = !cancelled && overFinal();
        const stillClick = !cancelled && g.travel < MOVE_SLOP;
        col.finalSection.classList.remove('is-drop-target');
        note.classList.remove('is-drag-source');
        document.body.classList.remove('is-dragging');
        dragActive = false;
        if (drop) {
          const head = col.finalHead.getBoundingClientRect();
          g.ghost.classList.add('is-dropping');
          g.ghost.style.transition = 'transform .28s var(--ease), opacity .28s ease';
          g.ghost.style.transformOrigin = '0 0';
          g.ghost.style.transform = `translate3d(${head.left + 20}px, ${head.top}px, 0) scale(0.2)`;
          g.ghost.style.opacity = '0';
          setTimeout(() => g.ghost.remove(), 300);
          moveAugmentedToFinal(col.id);
        } else {
          g.ghost.remove();
          render();
          if (stillClick) copy(ev);
        }
      },
    });
  }

  // ---- swipe to delete

  function beginSwipe(g) {
    g.mode = 'swipe';
    g.width = g.card.offsetWidth;
    g.samples = [];
    g.card.classList.remove('is-pressed');
    g.wrap.classList.add('is-swiping');
  }

  function swipeMove(g, dx, t) {
    const x = Math.min(0, dx);
    const limit = g.width * 0.9;
    const shown = x > -limit ? x : -limit + (x + limit) * 0.25;
    g.lastX = x;
    g.card.style.transform = `translateX(${shown}px)`;
    const progress = Math.min(1, -x / swipeDistance(g.width));
    g.wrap.style.setProperty('--swipe', progress.toFixed(3));
    g.wrap.classList.toggle('will-delete', progress >= 1);
    g.samples.push({ x, t });
    if (g.samples.length > 5) g.samples.shift();
  }

  function swipeEnd(g, cancelled) {
    const s = g.samples;
    const velocity = s.length > 1 ? (s[s.length - 1].x - s[0].x) / Math.max(1, s[s.length - 1].t - s[0].t) : 0;
    const distance = -(g.lastX || 0);
    const flick = IS_MAC ? velocity < -0.4 && distance > 28 : velocity < -0.8 && distance > 50;
    const commit = !cancelled && (distance >= swipeDistance(g.width) || flick);
    if (commit) {
      deleteNote(g.id);
      return;
    }
    g.card.style.transition = 'transform .32s var(--spring)';
    g.card.style.transform = '';
    g.wrap.style.setProperty('--swipe', '0');
    g.wrap.classList.remove('will-delete');
    setTimeout(() => {
      g.card.style.transition = '';
      g.wrap.classList.remove('is-swiping');
    }, 320);
  }

  // ---- drag to reorder / move to Cooked or Served / move between projects

  function beginDrag(g) {
    g.mode = 'drag';
    dragActive = true;
    g.card.classList.remove('is-pressed');
    const rect = g.wrap.getBoundingClientRect();
    g.offX = g.x0 - rect.left;
    g.offY = g.y0 - rect.top;

    g.ghost = el('div', 'drag-ghost');
    g.ghost.style.width = `${rect.width}px`;
    const colEl = g.wrap.closest('.column');
    g.ghost.style.setProperty('--accent', getComputedStyle(colEl).getPropertyValue('--accent'));
    const clone = g.card.cloneNode(true);
    clone.classList.remove('is-pressed', 'is-copied');
    clone.querySelectorAll('.ripple, .copied-chip').forEach((n) => n.remove());
    g.ghost.appendChild(clone);
    document.body.appendChild(g.ghost);

    g.placeholder = el('div', 'placeholder');
    g.placeholder.style.height = `${rect.height}px`;
    g.wrap.parentNode.insertBefore(g.placeholder, g.wrap);
    g.wrap.classList.add('is-drag-source');
    document.body.classList.add('is-dragging');

    positionGhost(g);
    requestAnimationFrame(() => g.ghost.classList.add('is-lifted'));
    g.raf = requestAnimationFrame(() => autoScroll(g, () => dragMove(g)));
    dragMove(g);
  }

  function positionGhost(g) {
    g.ghost.style.transform = `translate3d(${g.x - g.offX}px, ${g.y - g.offY}px, 0)`;
  }

  function columnAt(x) {
    let best = null;
    let bestDist = Infinity;
    for (const col of columns.values()) {
      if (!col.root.isConnected || col.root.classList.contains('is-drag-source')) continue;
      // A minimized column, or one in a folded group, takes no drops.
      if (col.root.classList.contains('is-minimized') || !col.root.offsetWidth) continue;
      const r = col.root.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < bestDist) {
        bestDist = d;
        best = col;
      }
    }
    return best;
  }

  function cardTarget(g) {
    const col = columnAt(g.x);
    if (!col) return null;
    const project = findProject(col.id);
    if (!col.finalSection.hidden) {
      const finalTop = col.finalSection.getBoundingClientRect().top;
      if (g.y >= finalTop - 4) return { col, list: 'combined', final: true };
    }
    const usedTop = col.usedSection.getBoundingClientRect().top;
    if (g.y >= usedTop - 6) return { col, list: 'used', stack: true };
    const listEl = col.activeList;
    // Use layout positions (offsetTop) so in-flight FLIP transforms don't cause jitter.
    const listTop = listEl.getBoundingClientRect().top;
    let before = null;
    for (const child of listEl.children) {
      if (!child.classList.contains('card-wrap') || child === g.wrap) continue;
      const mid = listTop + child.offsetTop + child.offsetHeight / 2;
      if (g.y < mid) {
        before = child;
        break;
      }
    }
    return { col, list: 'notes', listEl, before };
  }

  function dragMove(g) {
    positionGhost(g);
    const t = cardTarget(g);
    if (!t) return;
    for (const col of columns.values()) {
      col.usedHead.classList.toggle('is-drop-target', t.list === 'used' && t.col === col);
      col.usedSection.classList.toggle('is-drop-target', t.list === 'used' && t.col === col);
      col.finalSection.classList.toggle('is-drop-target', t.list === 'combined' && t.col === col);
    }
    g.target = t;
    if (t.stack || t.final) {
      if (g.placeholder.isConnected) {
        const parent = g.placeholder.parentNode;
        flip(cardWraps(parent), () => g.placeholder.remove());
      }
      return;
    }
    let next = g.placeholder.nextSibling;
    if (next === g.wrap) next = next.nextSibling;
    if (g.placeholder.parentNode === t.listEl && next === t.before) return;
    const parents = new Set([g.placeholder.parentNode, t.listEl].filter(Boolean));
    const items = [...parents].flatMap(cardWraps);
    flip(items, () => t.listEl.insertBefore(g.placeholder, t.before));
  }

  function cardWraps(listEl) {
    return [...listEl.children].filter((n) => n.classList.contains('card-wrap') && !n.classList.contains('is-drag-source'));
  }

  function autoScroll(g, onScrolled) {
    if (g.done) return;
    const speed = (dist) => EDGE_SPEED * Math.min(1, Math.max(0, 1 - dist / EDGE));
    const br = board.getBoundingClientRect();
    let vx = 0;
    if (g.x < br.left + EDGE) vx = -speed(g.x - br.left);
    else if (g.x > br.right - EDGE) vx = speed(br.right - g.x);
    let scrolled = false;
    if (vx) {
      const before = board.scrollLeft;
      board.scrollLeft += vx;
      scrolled = board.scrollLeft !== before;
    }
    const col = g.target?.col;
    if (col && g.mode === 'drag') {
      const sr = col.scroll.getBoundingClientRect();
      let vy = 0;
      if (g.y < sr.top + EDGE && g.y > sr.top - EDGE) vy = -speed(g.y - sr.top);
      else if (g.y > sr.bottom - EDGE && g.y < sr.bottom + EDGE) vy = speed(sr.bottom - g.y);
      if (vy) {
        const before = col.scroll.scrollTop;
        col.scroll.scrollTop += vy;
        scrolled = scrolled || col.scroll.scrollTop !== before;
      }
    }
    if (scrolled) onScrolled();
    g.raf = requestAnimationFrame(() => autoScroll(g, onScrolled));
  }

  function neighbourId(node, dir) {
    let n = dir > 0 ? node.nextSibling : node.previousSibling;
    while (n && (!n.classList?.contains('card-wrap') || n.classList.contains('is-drag-source'))) {
      n = dir > 0 ? n.nextSibling : n.previousSibling;
    }
    return n?.dataset.id ?? null;
  }

  function dragEnd(g, cancelled) {
    g.done = true;
    cancelAnimationFrame(g.raf);
    for (const col of columns.values()) {
      col.usedHead.classList.remove('is-drop-target');
      col.usedSection.classList.remove('is-drop-target');
      col.finalSection.classList.remove('is-drop-target');
    }
    const t = g.target;
    const loc = locate(g.id);
    let moveLabel = null;

    if (!cancelled && t && loc) {
      const dest = findProject(t.col.id);
      if (dest) {
        const before = snapshot();
        const nextId = t.stack || t.final ? null : neighbourId(g.placeholder, 1);
        const prevId = t.stack || t.final ? null : neighbourId(g.placeholder, -1);
        const from = { project: loc.project, list: loc.list, index: loc.index };
        loc.project[loc.list].splice(loc.index, 1);
        const arr = dest[t.list];
        let index = 0;
        const ni = nextId ? arr.findIndex((n) => n.id === nextId) : -1;
        const pi = prevId ? arr.findIndex((n) => n.id === prevId) : -1;
        if (ni >= 0) index = ni;
        else if (pi >= 0) index = pi + 1;
        if (t.final || t.stack) index = arr.length; // combined notes grow at the end
        arr.splice(index, 0, loc.note);
        if (t.list !== 'notes' && loc.list !== t.list) loc.note.usedAt = Date.now();
        if (t.list === 'notes') delete dest.notesCollapsed; // a collapsed Cooking opens to show it
        settleCooked(loc.project);
        const moved = !(from.project === dest && from.list === t.list && from.index === index);
        if (moved) {
          if (t.list === 'combined') moveLabel = 'Add to Served';
          else if (from.project !== dest) moveLabel = `Move to ${dest.name}`;
          else if (t.list === 'used' && from.list !== 'used') moveLabel = 'Add to Cooked';
          else if (t.list === 'notes' && from.list === 'used') moveLabel = 'Move back';
          else moveLabel = 'Reorder';
          pushHistory(moveLabel, before);
        }
        ui.lastProjectId = dest.id;
      }
    }

    g.placeholder.remove();
    g.wrap.classList.remove('is-drag-source');
    document.body.classList.remove('is-dragging');
    dragActive = false;
    if (moveLabel) persist();

    const ghostCard = g.ghost.firstChild;
    const from = ghostCard.getBoundingClientRect();
    render();

    if (g.wrap.isConnected) {
      // Land the real card where the ghost is, then glide it home.
      const to = g.wrap.getBoundingClientRect();
      g.ghost.remove();
      g.wrap.style.transition = 'none';
      g.wrap.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
      g.wrap.style.zIndex = '5';
      void g.wrap.offsetWidth;
      g.wrap.style.transition = 'transform .26s var(--ease)';
      g.wrap.style.transform = '';
      setTimeout(() => {
        g.wrap.style.transition = '';
        g.wrap.style.zIndex = '';
      }, 280);
    } else if (t?.stack || t?.final) {
      // Dropped on a collapsed header or the final text: shrink the ghost into it.
      const head = (t.final ? t.col.finalHead : t.col.usedHead).getBoundingClientRect();
      g.ghost.classList.add('is-dropping');
      g.ghost.style.transition = 'transform .28s var(--ease), opacity .28s ease';
      g.ghost.style.transformOrigin = '0 0';
      g.ghost.style.transform = `translate3d(${head.left + 20}px, ${head.top}px, 0) scale(0.2)`;
      g.ghost.style.opacity = '0';
      setTimeout(() => g.ghost.remove(), 300);
      bump(t.final ? t.col.finalHead : t.col.usedHead);
    } else {
      g.ghost.remove();
    }
    if (moveLabel && moveLabel !== 'Reorder') {
      const labels = { 'Add to Cooked': 'Added to Cooked', 'Move back': 'Moved back', 'Add to Served': 'Added to Served' };
      toast(labels[moveLabel] || `Moved to ${findProject(t.col.id)?.name}`, { action: 'Undo', onAction: undo, history: true });
    }
  }

  // ---- column drag (reorder projects). Since 1.20 a column goes wherever it is dropped: among the
  // board's columns and groups, or into an open group's lane, which it then joins; dropped on the
  // board, it leaves its group. A whole group moves the same way, by its band or its folded strip.

  const GROUP_EDGE = 28; // px just inside a group's sides that still mean "next to the group", not "into it"
  let clickBlockedUntil = 0; // the click that ends a drag mustn't fold a group or open a minimized strip

  function startColumnGesture(e, colEl) {
    // A whole Minimized card (1.20.10) drags like one column carrying all its rows.
    const ids = colEl.classList.contains('mini-stack')
      ? [...colEl.children].filter((n) => n.classList.contains('column')).map((n) => n.dataset.id)
      : [colEl.dataset.id];
    const g = { id: ids[0], ids, colEl, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: null };
    trackPointer(e, {
      onMove(ev) {
        g.x = ev.clientX;
        g.y = ev.clientY;
        if (!g.mode) {
          if (Math.hypot(g.x - g.x0, g.y - g.y0) < MOVE_SLOP) return;
          beginColumnDrag(g);
        }
        columnDragMove(g);
      },
      onEnd(_ev, cancelled) {
        if (g.mode) columnDragEnd(g, cancelled);
      },
    });
  }

  function beginColumnDrag(g) {
    g.mode = 'column';
    dragActive = true;
    closeMenu();
    const rect = g.colEl.getBoundingClientRect();
    g.offX = g.x0 - rect.left;
    g.offY = g.y0 - rect.top;
    g.ghost = el('div', 'drag-ghost');
    g.ghost.style.width = `${rect.width}px`;
    const clone = g.colEl.cloneNode(true);
    clone.style.setProperty('--accent', g.colEl.style.getPropertyValue('--accent'));
    clone.style.height = `${rect.height}px`;
    g.ghost.appendChild(clone);
    document.body.appendChild(g.ghost);
    g.placeholder = el('div', 'col-placeholder');
    g.placeholder.style.height = `${rect.height}px`;
    g.placeholder.style.width = `${rect.width}px`;
    g.container = g.colEl.parentNode; // the board, or a group's lane
    // a minimized row starts inside its card (1.20.9: it moves up and down there; see rowDragMove)
    const home = g.container.classList.contains('mini-stack') ? g.container.parentNode : g.container;
    g.fromGroup = home.classList.contains('group-cols') ? home.parentNode.dataset.group : '';
    g.colEl.parentNode.insertBefore(g.placeholder, g.colEl);
    g.colEl.classList.add('is-drag-source');
    document.body.classList.add('is-dragging', 'is-col-drag'); // is-col-drag: no card drop zones
    positionGhost(g);
    requestAnimationFrame(() => g.ghost.classList.add('is-lifted'));
    g.raf = requestAnimationFrame(() => autoScroll(g, () => columnDragMove(g)));
  }

  // The open group lane under the pointer, else the board. Once inside a lane, the column stays in it
  // until the pointer leaves the lane, so the lane growing and shrinking can't make it flicker.
  function dropContainer(g) {
    for (const view of groups.values()) {
      const root = view.root;
      if (!root.isConnected || root.classList.contains('is-folded')) continue;
      const box = root.getBoundingClientRect();
      const edge = g.container === view.cols ? 0 : GROUP_EDGE;
      if (g.x > box.left + edge && g.x < box.right - edge) return view.cols;
    }
    return board;
  }

  // What a dragged column or group can land between, in a container.
  function dropUnits(parent, skip) {
    return [...parent.children].filter((n) => !skip.includes(n)
      && (n.classList.contains('column') || n.classList.contains('mini-stack') || (parent === board && n.classList.contains('col-group'))));
  }

  // The first unit whose middle is right of the pointer (layout boxes, not transformed ones, so
  // in-flight FLIP moves cause no jitter).
  function unitAfter(units, x, fallback) {
    for (const c of units) {
      const r = c.getBoundingClientRect();
      const shift = c.style.transform ? new DOMMatrix(getComputedStyle(c).transform).m41 : 0;
      if (x < r.left - shift + r.width / 2) return c;
    }
    return fallback;
  }

  // Mac only: within the container that holds the slot, the column itself decides, not the pointer.
  // It passes a neighbour once its leading edge crosses that neighbour's middle (its right edge going
  // right, its left edge going left), so a slot is about half a column away wherever the header was
  // grabbed. By the pointer, grabbing the name and moving right took over a column's width.
  const COL_SNAP_SLACK = 4; // px either side of a middle, so the slot can't flicker at the boundary
  function unitAfterGhost(units, g, fallback) {
    const left = g.x - g.offX;
    const right = left + g.ghost.offsetWidth;
    for (const c of units) {
      // The resting box: a neighbour still sliding (its FLIP has already cleared style.transform) is
      // measured where it will settle, or the slot would flip back mid-slide.
      const r = c.getBoundingClientRect();
      const t = getComputedStyle(c).transform;
      const shift = t && t !== 'none' ? new DOMMatrix(t).m41 : 0;
      const mid = r.left - shift + r.width / 2;
      const beforeSlot = g.placeholder.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING;
      if (beforeSlot ? left < mid - COL_SNAP_SLACK : right <= mid + COL_SNAP_SLACK) return c;
    }
    return fallback;
  }

  // 1.20.9: a minimized row is moved up and down inside its Minimized card, and leaves the card only once
  // the pointer is clearly outside it (STACK_EDGE), so the first nudge doesn't shift the whole board.
  // Anything that moves because a row was dragged slides at a calmer pace (CALM_MS).
  const STACK_EDGE = 40;
  const CALM_MS = 340;
  function stackUnder(g) {
    for (const s of board.querySelectorAll('.mini-stack')) {
      const b = s.getBoundingClientRect();
      const m = g.container === s ? STACK_EDGE : 0;
      if (g.x > b.left - m && g.x < b.right + m && g.y > b.top - m && g.y < b.bottom + m) return s;
    }
    return null;
  }

  function rowDragMove(g, stack) {
    const rows = [...stack.children].filter((n) => n.classList.contains('column') && n !== g.colEl);
    let before = null;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      const t = getComputedStyle(r).transform;
      const dy = t && t !== 'none' ? new DOMMatrix(t).m42 : 0; // where it will settle, not mid-slide
      if (g.y < b.top - dy + b.height / 2) { before = r; break; }
    }
    let next = g.placeholder.nextSibling;
    if (next === g.colEl) next = next.nextSibling;
    if (g.placeholder.parentNode === stack && next === before) return;
    const fromOutside = g.placeholder.parentNode !== stack;
    g.container = stack;
    const items = fromOutside ? rows.concat(dropUnits(board, [g.colEl, g.placeholder])) : rows;
    flip(items, () => stack.insertBefore(g.placeholder, before), CALM_MS);
  }

  function columnDragMove(g) {
    positionGhost(g);
    if (g.colEl.classList.contains('is-minimized')) {
      const stack = stackUnder(g);
      if (stack) return rowDragMove(g, stack);
    }
    const container = dropContainer(g);
    const inBoard = container === board;
    const skip = [g.colEl, g.placeholder];
    const cols = dropUnits(container, skip);
    const fallback = inBoard ? addColumnEl : null;
    const before = IS_MAC && g.placeholder.parentNode === container
      ? unitAfterGhost(cols, g, fallback)
      : unitAfter(cols, g.x, fallback);
    let next = g.placeholder.nextSibling;
    if (next === g.colEl) next = next.nextSibling;
    const same = g.placeholder.parentNode === container;
    if (same && next === before) return;
    // Within a group its columns slide; anything else moves the board's columns and groups.
    const items = same && !inBoard ? cols : dropUnits(board, skip);
    g.container = container;
    flip(items, () => container.insertBefore(g.placeholder, before), g.colEl.classList.contains('is-minimized') ? CALM_MS : 240);
  }

  function columnDragEnd(g, cancelled) {
    g.done = true;
    cancelAnimationFrame(g.raf);
    clickBlockedUntil = Date.now() + 350;
    if (!cancelled) {
      let lane = g.placeholder.parentNode;
      if (lane?.classList.contains('mini-stack')) lane = lane.parentNode; // dropped among a card's rows
      const into = lane?.classList.contains('group-cols') ? lane.parentNode.dataset.group || '' : '';
      const order = [];
      const walk = (parent) => {
        for (const n of parent.children) {
          if (n === g.placeholder) order.push(...g.ids);
          else if (n.classList.contains('column') && !g.ids.includes(n.dataset.id)) order.push(n.dataset.id);
          else if (n.classList.contains('col-group')) walk(n.querySelector('.group-cols'));
          else if (n.classList.contains('mini-stack') && n !== g.colEl) walk(n);
        }
      };
      walk(board);
      const byId = new Map(data.projects.map((p) => [p.id, p]));
      const next = order.map((id) => byId.get(id)).filter(Boolean);
      const now = boardProjects();
      const project = byId.get(g.id);
      const moving = g.ids.map((id) => byId.get(id)).filter(Boolean);
      const regroup = moving.some((p) => groupOf(p) !== into);
      if (project && next.length === now.length && (regroup || next.some((p, i) => p !== now[i]))) {
        checkpoint(regroup ? (into ? 'Move to group' : 'Remove from group') : 'Reorder projects');
        for (const p of moving) {
          if (into) p.group = into;
          else delete p.group;
          if (regroup) delete p.groupFolded; // dropped into an open lane or onto the board
        }
        setBoardOrder(next);
        persist();
        if (regroup) {
          toast(into ? `Added to “${into}”` : `Taken out of “${g.fromGroup}”`, { action: 'Undo', onAction: undo, history: true });
        }
      }
    }
    const from = g.ghost.firstChild.getBoundingClientRect();
    g.placeholder.remove();
    g.colEl.classList.remove('is-drag-source');
    document.body.classList.remove('is-dragging', 'is-col-drag');
    dragActive = false;
    render();
    g.ghost.remove();
    if (!g.colEl.isConnected) return; // a dragged card that merged into another one
    const to = g.colEl.getBoundingClientRect();
    g.colEl.style.transition = 'none';
    g.colEl.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    g.colEl.style.zIndex = '5';
    void g.colEl.offsetWidth;
    g.colEl.style.transition = 'transform .28s var(--ease)';
    g.colEl.style.transform = '';
    setTimeout(() => {
      g.colEl.style.transition = '';
      g.colEl.style.zIndex = '';
    }, 300);
  }

  // ---- group drag (1.20): press the group's band (or its folded strip) and move. A plain click still
  // folds or opens it. The ghost is a small card with the group's name and leaves, so the board under it
  // stays visible; a dashed slot the group's size shows where it will land.

  function startGroupGesture(e, groupEl) {
    const g = { name: groupEl.dataset.group, groupEl, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: null };
    trackPointer(e, {
      onMove(ev) {
        g.x = ev.clientX;
        g.y = ev.clientY;
        if (!g.mode) {
          if (Math.hypot(g.x - g.x0, g.y - g.y0) < MOVE_SLOP) return;
          beginGroupDrag(g);
        }
        groupDragMove(g);
      },
      onEnd(_ev, cancelled) {
        if (g.mode) groupDragEnd(g, cancelled);
      },
    });
  }

  function beginGroupDrag(g) {
    g.mode = 'group';
    dragActive = true;
    closeMenu();
    const rect = g.groupEl.getBoundingClientRect();
    const members = data.projects.filter((p) => groupOf(p) === g.name);
    g.ghost = el('div', 'drag-ghost');
    const card = el('div', 'group-ghost');
    card.innerHTML = `<span class="group-ghost-leaves">${members.slice(0, 8).map((p) => `<svg style="color:${colorOf(p)}"><use href="#monstera"/></svg>`).join('')}</span><b class="group-ghost-name"></b><span class="group-ghost-count"></span>`;
    $('.group-ghost-name', card).textContent = g.name;
    $('.group-ghost-count', card).textContent = `· ${members.length}`;
    g.ghost.appendChild(card);
    document.body.appendChild(g.ghost);
    g.offX = Math.min(Math.max(0, g.x0 - rect.left), 36);
    g.offY = 18;
    g.placeholder = el('div', 'col-placeholder group-placeholder');
    g.placeholder.style.width = `${rect.width}px`;
    g.placeholder.style.height = `${rect.height}px`;
    board.insertBefore(g.placeholder, g.groupEl);
    g.groupEl.classList.add('is-drag-source');
    document.body.classList.add('is-dragging', 'is-col-drag');
    positionGhost(g);
    requestAnimationFrame(() => g.ghost.classList.add('is-lifted'));
    g.raf = requestAnimationFrame(() => autoScroll(g, () => groupDragMove(g)));
  }

  function groupDragMove(g) {
    positionGhost(g);
    const units = dropUnits(board, [g.groupEl, g.placeholder]);
    const before = unitAfter(units, g.x, addColumnEl);
    let next = g.placeholder.nextSibling;
    if (next === g.groupEl) next = next.nextSibling;
    if (next === before) return;
    flip(units, () => board.insertBefore(g.placeholder, before), 240);
  }

  function groupDragEnd(g, cancelled) {
    g.done = true;
    cancelAnimationFrame(g.raf);
    clickBlockedUntil = Date.now() + 350;
    if (!cancelled) {
      const ids = [];
      for (const n of board.children) {
        if (n === g.placeholder) ids.push(...data.projects.filter((p) => groupOf(p) === g.name).map((p) => p.id));
        else if (n === g.groupEl) continue;
        else if (n.classList.contains('column')) ids.push(n.dataset.id);
        else if (n.classList.contains('mini-stack')) for (const c of n.children) ids.push(c.dataset.id);
        else if (n.classList.contains('col-group')) for (const c of n.querySelectorAll('.group-cols .column')) ids.push(c.dataset.id);
      }
      const next = ids.map(findProject).filter(Boolean);
      const now = boardProjects();
      if (next.length === now.length && next.some((p, i) => p !== now[i])) {
        checkpoint('Move group');
        setBoardOrder(next);
        persist();
      }
    }
    g.placeholder.remove();
    g.groupEl.classList.remove('is-drag-source');
    document.body.classList.remove('is-dragging', 'is-col-drag');
    dragActive = false;
    g.ghost.remove();
    render();
    g.groupEl.classList.add('is-landed');
    setTimeout(() => g.groupEl.classList.remove('is-landed'), 400);
  }

  // ---- column width: drag a column's right edge. Widths live in data.prefs.colWidths
  // ({ projectId: px }); a column without an entry uses the Settings › Column width default.

  const defaultColWidth = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--col-w')) || 268;

  function colWidth(id) {
    const widths = data.prefs.colWidths;
    const w = widths && typeof widths === 'object' ? Number(widths[id]) : NaN;
    return Number.isFinite(w) && w > 0 ? Math.round(Math.min(MAX_COL_W, Math.max(MIN_COL_W, w))) : 0;
  }

  // 0 puts the column back to the default width.
  function setColWidth(id, w) {
    const current = data.prefs.colWidths;
    const widths = current && typeof current === 'object' ? { ...current } : {};
    if (w) widths[id] = w;
    else delete widths[id];
    if (Object.keys(widths).length) data.prefs.colWidths = widths;
    else delete data.prefs.colWidths;
    persist();
  }

  function startColumnResize(e, col) {
    if (!col) return;
    e.preventDefault();
    closeMenu();
    const x0 = e.clientX;
    const w0 = col.root.offsetWidth;
    const def = defaultColWidth();
    let w = w0;
    resizing = col;
    dragActive = true;
    col.root.classList.add('is-resizing');
    document.body.classList.add('is-resizing');
    trackPointer(e, {
      onMove(ev) {
        w = Math.round(Math.min(MAX_COL_W, Math.max(MIN_COL_W, w0 + ev.clientX - x0)));
        if (Math.abs(w - def) <= 6) w = def; // snaps to the default on the way past
        col.root.style.width = `${w}px`;
      },
      onEnd(_ev, cancelled) {
        resizing = null;
        dragActive = false;
        col.root.classList.remove('is-resizing');
        document.body.classList.remove('is-resizing');
        if (!cancelled && w !== w0) setColWidth(col.id, w === def ? 0 : w);
        render();
        remeasure([col]);
      },
    });
  }

  function resetColumnWidth(id) {
    if (!colWidth(id)) return;
    setColWidth(id, 0);
    render();
    remeasure([columns.get(id)]);
  }

  // Top bar button: every column back to the default width (with an Undo on the toast).
  const widthResetBtn = $('#reset-widths');

  function paintWidthReset() {
    const n = data.projects.filter((p) => colWidth(p.id)).length;
    widthResetBtn.disabled = n === 0;
    widthResetBtn.title = n
      ? `Reset ${n === 1 ? 'the resized column' : `all ${n} resized columns`} to the default width`
      : 'Every column is at the default width. Drag a column’s right edge to resize it.';
  }

  function resetColumnWidths() {
    const before = data.prefs.colWidths;
    if (!data.projects.some((p) => colWidth(p.id))) return;
    delete data.prefs.colWidths;
    persist();
    render();
    remeasure();
    toast('Column widths reset to default', {
      action: 'Undo',
      onAction: () => {
        data.prefs.colWidths = before;
        persist();
        render();
        remeasure();
      },
    });
  }

  widthResetBtn.addEventListener('click', resetColumnWidths);

  // ================================================================ board scrolling

  const panLeft = $('#pan-left');
  const panRight = $('#pan-right');

  function updatePan() {
    const max = board.scrollWidth - board.clientWidth;
    panLeft.hidden = board.scrollLeft <= 2;
    panRight.hidden = max <= 2 || board.scrollLeft >= max - 2;
  }

  // The arrows stay out of sight until the pointer comes near their edge of the board
  // (1.16: an always-on › over the last column was a distraction on a wide board).
  const stageEl = board.parentElement;
  const PAN_ZONE = 96; // px from the stage's left / right edge
  let panNear = 0; // -1 left edge, 1 right edge, 0 neither

  function setPanNear(near) {
    if (near === panNear) return;
    panNear = near;
    panLeft.classList.toggle('is-near', near === -1);
    panRight.classList.toggle('is-near', near === 1);
  }

  stageEl.addEventListener('pointermove', (e) => {
    const r = stageEl.getBoundingClientRect();
    setPanNear(e.clientX - r.left < PAN_ZONE ? -1 : r.right - e.clientX < PAN_ZONE ? 1 : 0);
  }, { passive: true });
  stageEl.addEventListener('pointerleave', () => setPanNear(0));

  function columnStep() {
    const col = board.querySelector('.column:not(.is-minimized)');
    const gap = parseFloat(getComputedStyle(board).columnGap) || 12;
    return col ? col.offsetWidth + gap : 280;
  }

  function startPan(e) {
    const x0 = e.clientX;
    const left0 = board.scrollLeft;
    let moved = 0;
    ui.anchor = null;
    document.body.classList.add('is-panning');
    trackPointer(e, {
      onMove(ev) {
        moved = Math.max(moved, Math.abs(ev.clientX - x0));
        board.scrollLeft = left0 - (ev.clientX - x0);
      },
      onEnd() {
        document.body.classList.remove('is-panning');
        if (moved < 4) clearSelection(); // plain click on empty space
      },
    });
  }

  // Click scrolls one column; press and hold keeps gliding.
  for (const [btn, dir] of [[panLeft, -1], [panRight, 1]]) {
    let holdTimer = null;
    let raf = null;
    const stop = () => {
      clearTimeout(holdTimer);
      cancelAnimationFrame(raf);
      holdTimer = null;
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      btn.dataset.held = '';
      holdTimer = setTimeout(() => {
        btn.dataset.held = '1';
        const glide = () => {
          board.scrollLeft += dir * 14;
          raf = requestAnimationFrame(glide);
        };
        glide();
      }, 320);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('click', () => {
      if (btn.dataset.held === '1') return;
      board.scrollBy({ left: dir * columnStep(), behavior: 'smooth' });
    });
  }

  // A vertical wheel over anything that can't scroll vertically scrolls the board sideways.
  board.addEventListener('wheel', (e) => {
    if (e.ctrlKey || dragActive) return;
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    if (board.scrollWidth <= board.clientWidth) return;
    // Leave the wheel to anything under the pointer that can scroll vertically itself.
    for (let n = e.target; n && n !== board; n = n.parentElement) {
      if (n.matches(SCROLLERS) && n.scrollHeight > n.clientHeight + 1 && getComputedStyle(n).overflowY !== 'hidden') return;
    }
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? board.clientWidth : 1;
    board.scrollLeft += e.deltaY * unit;
  }, { passive: false });

  board.addEventListener('scroll', updatePan, { passive: true });

  let scrollTimer = null;
  let scrollRestored = false;
  // Only positions the user scrolled to are saved. A restore that the browser
  // had to clamp (smaller window, say) must never overwrite what was remembered.
  let userScrolledAt = 0;
  let userScrolled = false;
  for (const type of ['wheel', 'pointerdown', 'keydown']) {
    board.addEventListener(type, () => { userScrolledAt = Date.now(); }, { capture: true, passive: true });
  }

  function saveScrollNow() {
    clearTimeout(scrollTimer);
    if (!scrollRestored || !userScrolled) return;
    const cols = {};
    for (const [id, col] of columns) if (col.scroll.scrollTop > 0) cols[id] = Math.round(col.scroll.scrollTop);
    const next = { board: Math.round(board.scrollLeft), cols };
    const prev = data.prefs.scroll || { board: 0, cols: {} };
    if (JSON.stringify(next) === JSON.stringify({ board: prev.board || 0, cols: prev.cols || {} })) return;
    data.prefs.scroll = next;
    persist();
  }
  function rememberScroll() {
    if (!scrollRestored || dragActive) return;
    if (Date.now() - userScrolledAt > 1500) return; // not caused by the user
    userScrolled = true;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveScrollNow, 700);
  }
  // Also on the way out, so quitting right after scrolling doesn't lose the spot.
  window.addEventListener('beforeunload', saveScrollNow);
  // Scroll events don't bubble, but a capturing listener still sees the columns'.
  board.addEventListener('scroll', rememberScroll, { passive: true, capture: true });

  function restoreScroll() {
    const saved = data.prefs.scroll;
    if (saved) {
      board.scrollLeft = saved.board || 0;
      for (const [id, top] of Object.entries(saved.cols || {})) {
        const col = columns.get(id);
        if (col) col.scroll.scrollTop = top;
      }
    }
    // The scroll events this causes compare equal to what's saved, so nothing is rewritten.
    scrollRestored = true;
  }
  window.addEventListener('resize', updatePan);

  // ================================================================ clicks & keys on the board

  board.addEventListener('click', (e) => {
    if (Date.now() < clickBlockedUntil) return; // the end of a column or group drag
    const colEl = e.target.closest('.column');
    const col = colEl && columns.get(colEl.dataset.id);
    const wrap = e.target.closest('.card-wrap');

    if (e.target.closest('.img-expand')) {
      openLightbox(e.target.closest('.card-img').dataset.img, wrap?.dataset.id);
      return;
    }
    if (e.target.closest('.act-used') && wrap) return toggleUsed(wrap.dataset.id);
    if (e.target.closest('.act-hl') && wrap) return openHighlightMenu(wrap.dataset.id, e.target.closest('.act-hl'));
    if (e.target.closest('.card-more') && wrap) {
      const view = cards.get(wrap.dataset.id);
      const loc = locate(wrap.dataset.id);
      if (view && loc) {
        view.expanded = !view.expanded;
        if (view.expanded) loc.note.expanded = true;
        else delete loc.note.expanded;
        persist();
        render();
      }
      return;
    }
    const groupEl = e.target.closest('.col-group');
    if (groupEl && !col) {
      const view = groups.get(groupEl.dataset.group);
      if (!view || view.renaming) return;
      if (e.target.closest('.group-menu')) return openGroupMenu(view, e.target.closest('.group-menu'));
      if (e.target.closest('.group-toggle, .group-strip')) return setGroupFolded(view.name, !foldedGroups().includes(view.name));
      return;
    }
    if (!col) return;
    // A minimized column is a slim strip: a click anywhere on it opens it again.
    if (col.root.classList.contains('is-minimized')) return void (e.target.closest('.col-head') && setMinimized(col.id, false));
    if (e.target.closest('.eat-btn')) {
      if (isEating(findProject(col.id))) return openEatingMenu(col.id, e.target.closest('.eat-btn'));
      return setEating(col.id, true);
    }
    if (e.target.closest('.aug-cc')) return setClaudeCode(col.id, !isClaudeCode(findProject(col.id)));
    if (e.target.closest('.col-add')) return openComposer(col.id);
    if (e.target.closest('.col-mic')) return openComposer(col.id, { voice: true });
    if (e.target.closest('.col-menu')) return openColumnMenu(col, e.target.closest('.col-menu'));
    if (e.target.closest('.col-min')) return setMinimized(col.id, true);
    if (e.target.closest('.col-pad')) return isNotepadOpen() && notepadFor === col.id ? closeNotepad() : openNotepad(col.id);
    if (e.target.closest('.used-head')) {
      const p = findProject(col.id);
      p.usedCollapsed = !p.usedCollapsed;
      persist();
      render();
      return;
    }
    if (e.target.closest('.cook-head')) {
      // Only written while collapsed, so columns never collapsed keep no extra field.
      const p = findProject(col.id);
      if (p.notesCollapsed) delete p.notesCollapsed;
      else p.notesCollapsed = true;
      persist();
      render();
      return;
    }
    if (e.target.closest('.final-toggle')) {
      const p = findProject(col.id);
      p.augCollapsed = !p.augCollapsed;
      persist();
      render();
      return;
    }
    if (e.target.closest('.final-more')) {
      col.finalExpanded = !col.finalExpanded;
      augToMeasure.add(col);
      render();
      return;
    }
    if (e.target.closest('.final-parts-btn')) {
      col.partsOpen = !col.partsOpen;
      render();
      return;
    }
    if (e.target.closest('.aug-move')) return moveAugmentedToFinal(col.id, { animate: true });
    if (e.target.closest('.aug-edit')) return editStage(col.id, 'used');
    if (e.target.closest('.final-edit')) return editStage(col.id, 'combined');
    if (e.target.closest('.aug-parts-btn')) {
      col.augPartsOpen = !col.augPartsOpen;
      render();
      return;
    }
    if (e.target.closest('.aug-more')) {
      col.augExpanded = !col.augExpanded;
      augToMeasure.add(col);
      render();
      return;
    }
    // rows in the Notes list of the Cooked note (.aug-parts) and the Served text (.final-parts)
    const part = e.target.closest('.final-part');
    if (part) {
      const id = part.dataset.id;
      if (e.target.closest('.fp-up')) return movePart(id, -1);
      if (e.target.closest('.fp-down')) return movePart(id, 1);
      if (e.target.closest('.fp-edit')) return editStage(col.id, part.closest('.aug-parts') ? 'used' : 'combined', id);
      if (e.target.closest('.ap-back')) return moveBetween(id, 'notes');
      if (e.target.closest('.fp-back')) return sendBackFromFinal(id);
      if (e.target.closest('.fp-del')) return deletePart(col.id, part.closest('.aug-parts') ? 'used' : 'combined', id);
      return;
    }
    // A picture under the Served text copies just that picture (the Cooked note's strip
    // is handled by its press gesture).
    const servedImg = e.target.closest('.final-images .card-img');
    if (servedImg) return copyStageImage(col, servedImg, e);
    // Clicking the final text copies it all, unless the user is selecting part of it
    // (or dragging the scrollbar of the opened-up text).
    if (e.target.closest('.final-text') && !String(window.getSelection()) && !onScrollbar(e) && Date.now() - selectionClearedAt > 500) copyFinal(col.id, e);
  });

  // 1.20.12: selected text goes away with the next left click anywhere, and with Esc. Cards, the Cooked
  // note and the board take over a press for copying and dragging, so a selection used to stay until a
  // click landed inside other text. The click that clears a selection doesn't also copy the Served text.
  // Fields and the notepad keep their own selections; a Mac's Control+click (a right-click) is left alone.
  let selectionClearedAt = 0;
  const clearSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !String(sel).trim()) return false;
    const node = sel.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
    if (node?.closest?.('input, textarea, [contenteditable="true"], .composer')) return false;
    sel.removeAllRanges();
    return true;
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (IS_MAC && e.ctrlKey)) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"], .composer')) return;
    if (clearSelection()) selectionClearedAt = Date.now();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isTyping(e.target)) clearSelection();
  }, true);

  // A Mac selects the word under a right-click (or Control+click) before contextmenu fires,
  // so there the selection is read as the button goes down.
  let selectionAtPress = '';
  if (IS_MAC) {
    board.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) selectionAtPress = String(window.getSelection()).trim();
    }, true);
  }

  // Right-click edits: a prompt card, the Cooked note or the Served text (whole), or one row
  // of their Notes lists (that part alone). With text selected, the usual Copy menu shows instead.
  board.addEventListener('contextmenu', (e) => {
    const selected = IS_MAC ? selectionAtPress : String(window.getSelection()).trim();
    if (IS_MAC) selectionAtPress = '';
    if (selected) return;
    if (e.target.closest('input, textarea, .composer')) return;
    const colEl = e.target.closest('.column');
    const col = colEl && columns.get(colEl.dataset.id);
    if (!col) return;
    const part = e.target.closest('.final-part');
    const wrap = e.target.closest('.card-wrap');
    let edit = null;
    if (part) edit = () => editStage(col.id, part.closest('.aug-parts') ? 'used' : 'combined', part.dataset.id);
    else if (wrap && !wrap.classList.contains('is-editing')) edit = () => startEdit(wrap.dataset.id);
    else if (e.target.closest('.aug-note')) edit = () => editStage(col.id, 'used');
    else if (e.target.closest('.final-body') && !col.finalSection.classList.contains('is-empty')) edit = () => editStage(col.id, 'combined');
    if (!edit) return;
    e.preventDefault();
    closeMenu();
    if (IS_MAC) window.getSelection()?.removeAllRanges(); // drop the word the Mac selected for its menu
    edit();
  });

  board.addEventListener('dblclick', (e) => {
    const handle = e.target.closest('.col-resize');
    if (handle) {
      resetColumnWidth(handle.closest('.column').dataset.id);
      return;
    }
    const name = e.target.closest('.col-name');
    if (!name) return;
    const col = columns.get(name.closest('.column').dataset.id);
    if (col) startRename(col);
  });

  board.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.card');
    if (!card || e.target !== card) return;
    const id = card.closest('.card-wrap').dataset.id;
    const key = e.key.toLowerCase();
    // On a Mac, ⌘, ⌃ and ⌥ keys go to the menus (⌘H hides the app); only ⌘⌫ deletes, like the Finder.
    if (IS_MAC && (e.metaKey || e.ctrlKey || e.altKey)) {
      const metaOnly = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (metaOnly && (key === 'backspace' || key === 'delete')) { e.preventDefault(); deleteNote(id); }
      return;
    }
    if (key === 'enter' || key === ' ') { e.preventDefault(); copyNote(id); }
    else if (key === 'e' || key === 'f2') { e.preventDefault(); startEdit(id); }
    else if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteNote(id); }
    else if (key === 'u') { e.preventDefault(); toggleUsed(id); }
    else if (key === 'h') { e.preventDefault(); setHighlight(id, locate(id)?.note.highlight ? null : 'amber'); }
    else if (key === 'arrowdown' || key === 'arrowup') {
      e.preventDefault();
      const all = [...board.querySelectorAll('.card-wrap:not(.is-editing) > .card')].filter((n) => n.offsetParent);
      const i = all.indexOf(card);
      all[i + (key === 'arrowdown' ? 1 : -1)]?.focus();
    }
  });

  // A broken thumbnail falls back to the full image, then hides.
  board.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const tile = img.closest('[data-img]');
    if (tile && !img.dataset.fallback) {
      img.dataset.fallback = '1';
      img.src = imgUrl(tile.dataset.img);
    } else if (tile) {
      tile.hidden = true;
    }
  }, true);

  // Close an empty "new prompt" composer when clicking elsewhere. Done on
  // pointerup so the layout doesn't shift under a click that is in progress.
  let downOutsideComposer = false;
  document.addEventListener('pointerdown', (e) => {
    const col = columns.get(ui.composing);
    downOutsideComposer = Boolean(col?.composer && !col.composeHost.contains(e.target) && !col.head.contains(e.target) && !col.newRow.contains(e.target));
  }, true);
  document.addEventListener('pointerup', () => {
    if (!downOutsideComposer) return;
    downOutsideComposer = false;
    const col = columns.get(ui.composing);
    const c = col?.composer;
    if (c && !c.value().trim() && !c.images().length && !c.isBusy()) closeComposer('', []);
  }, true);

  // ================================================================ menus

  let openMenuEl = null;

  function closeMenu() {
    if (!openMenuEl) return;
    openMenuEl.anchor?.classList.remove('is-open');
    if (openMenuEl === appMenu) {
      appMenu.hidden = true; // it lives in the page; the other menus are built each time
      appMenuBtn.setAttribute('aria-expanded', 'false');
    } else {
      openMenuEl.remove();
    }
    openMenuEl = null;
  }

  // ---- the app menu (1.20.1): Eaten, the widget, Reset column widths, How Recaller works and Settings,
  // in one dropdown from the top bar's ☰ (they were five buttons). It is a menu like the others: a click
  // outside, Esc or another menu closes it. Its rows are the old buttons, with their ids and handlers.
  const appMenu = $('#app-menu');
  const appMenuBtn = $('#app-menu-btn');

  function openAppMenu() {
    closeMenu();
    appMenu.anchor = appMenuBtn;
    appMenu.hidden = false;
    appMenuBtn.classList.add('is-open');
    appMenuBtn.setAttribute('aria-expanded', 'true');
    const r = appMenuBtn.getBoundingClientRect();
    const mw = appMenu.offsetWidth;
    appMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
    appMenu.style.top = `${r.bottom + 6}px`;
    openMenuEl = appMenu;
  }

  appMenuBtn.addEventListener('click', () => (openMenuEl === appMenu ? closeMenu() : openAppMenu()));

  // ---- zoom (1.20.6): − 100% + in the ☰ menu (also Ctrl + / Ctrl − / Ctrl 0 and Ctrl + the wheel, which
  // main handles). Main sets the window's zoom and remembers it for this computer; the page shows it.
  const zoomValue = $('#zoom-reset');
  function showZoom(z) {
    const zoom = Number(z) > 0 ? Number(z) : 1;
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    $('#zoom-out').disabled = zoom <= 0.5;
    $('#zoom-in').disabled = zoom >= 2;
    document.documentElement.style.setProperty('--zoom', String(zoom));
    if (ui.settings) ui.settings.zoom = zoom;
  }
  async function changeZoom(patch) {
    try {
      showZoom((await api.setSettings(patch)).zoom);
    } catch (err) {
      console.error(err);
    }
  }
  $('#zoom-out').addEventListener('click', () => changeZoom({ zoomStep: -1 }));
  $('#zoom-in').addEventListener('click', () => changeZoom({ zoomStep: 1 }));
  zoomValue.addEventListener('click', () => changeZoom({ zoom: 1 }));
  api.onZoom?.(showZoom);
  // a row does its job (its own listener runs first), then the menu closes
  appMenu.addEventListener('click', (e) => {
    if (e.target.closest('.menu-item:not(:disabled)') && openMenuEl === appMenu) closeMenu();
  });

  function openMenu(anchor, build) {
    closeMenu();
    const menu = el('div', 'menu');
    menu.anchor = anchor;
    build(menu);
    document.body.appendChild(menu);
    anchor.classList.add('is-open');
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - mh - 8, r.bottom + 6))}px`;
    openMenuEl = menu;
    menu.querySelector('.menu-item')?.focus();
  }

  function menuItem(menu, icon, label, fn, { danger = false, disabled = false } = {}) {
    const b = el('button', `menu-item${danger ? ' danger' : ''}`, `${icon || ''}<span>${escapeHtml(label)}</span>`);
    b.disabled = disabled;
    b.addEventListener('click', () => {
      closeMenu();
      fn();
    });
    menu.appendChild(b);
  }

  function openColumnMenu(col, anchor) {
    const project = findProject(col.id);
    if (!project) return;
    openMenu(anchor, (menu) => {
      menuItem(menu, I.camera, 'New from screenshot', () => openComposer(col.id, { screenshot: true }));
      menuItem(menu, I.pencilLine, 'Rename', () => startRename(col));
      // the four status colours, named (1.20.7; since 1.20.10 the only ones offered)
      const statusRow = el('div', 'menu-status');
      for (const st of STATUS) {
        const c = PALETTE.find((x) => x.id === st.id);
        const b = el('button', `status-pick${project.color === st.id ? ' is-active' : ''}`);
        b.style.setProperty('--c', c.color);
        b.title = st.meaning;
        b.innerHTML = `<i></i><span>${st.label}</span>`;
        b.addEventListener('click', () => {
          closeMenu();
          if (project.color === st.id) return;
          checkpoint('Change color');
          project.color = st.id;
          persist();
          render();
        });
        statusRow.appendChild(b);
      }
      menu.appendChild(statusRow); // 1.20.10: the only colours offered
      menu.appendChild(el('div', 'menu-sep'));
      const eatenHere = eatenList().filter((r) => r.project === col.id).length;
      if (eatenHere) menuItem(menu, I.utensils, `Eaten from this column (${eatenHere})`, () => openEaten(col.id));
      menuItem(menu, I.minimize, 'Minimize column', () => setMinimized(col.id, true));
      const group = groupOf(project);
      for (const name of groupNames().filter((g) => g !== group)) {
        menuItem(menu, I.group, `Move to group “${name}”`, () => setGroup(col.id, name));
      }
      menuItem(menu, I.group, 'New group…', () => newGroupFrom(col.id));
      if (group) menuItem(menu, I.close, `Remove from “${group}”`, () => setGroup(col.id, ''));
      menu.appendChild(el('div', 'menu-sep'));
      const left = moveTarget(col.id, -1);
      const right = moveTarget(col.id, 1);
      menuItem(menu, I.arrowLeft, left?.leaves ? `Move left, out of “${left.leaves}”` : 'Move left', () => moveProject(col.id, -1), { disabled: !left });
      menuItem(menu, I.arrowRight, right?.leaves ? `Move right, out of “${right.leaves}”` : 'Move right', () => moveProject(col.id, 1), { disabled: !right });
      menuItem(menu, I.width, 'Reset width', () => resetColumnWidth(col.id), { disabled: !colWidth(col.id) });
      menuItem(menu, I.sort, 'Sort prompts oldest first', () => sortOldestFirst(col.id), { disabled: project.notes.length < 2 || isOldestFirst(project.notes) });
      menu.appendChild(el('div', 'menu-sep'));
      menuItem(menu, I.layers, `Clear Cooked (${project.used.length})`, () => clearStage(col.id, 'used'), { disabled: !project.used.length });
      menuItem(menu, I.used, `Clear Served (${project.combined.length})`, () => clearStage(col.id, 'combined'), { disabled: !project.combined.length });
      menuItem(menu, I.trash, 'Delete project', () => deleteProject(col.id), { danger: true });
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (openMenuEl && !openMenuEl.contains(e.target) && !openMenuEl.anchor?.contains(e.target)) closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  // A zoom is a resize too (1.20.6): the ☰ menu stays open through it, placed again under its button.
  let lastRatio = window.devicePixelRatio;
  window.addEventListener('resize', () => {
    const zoomed = window.devicePixelRatio !== lastRatio;
    lastRatio = window.devicePixelRatio;
    if (zoomed && openMenuEl === appMenu) openAppMenu();
    else closeMenu();
  });
  board.addEventListener('scroll', closeMenu, { passive: true });

  // ================================================================ toasts

  const toastHost = $('#toasts');

  function toast(message, { action, onAction, duration = 3200, history: isHistory = false } = {}) {
    const t = el('div', 'toast', `<span>${escapeHtml(message)}</span>`);
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      if (t.classList.contains('is-leaving')) return;
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 180);
    };
    t.dismiss = dismiss;
    if (isHistory) t.dataset.history = '1';
    if (action) {
      const b = el('button', 'toast-action', escapeHtml(action));
      b.addEventListener('click', () => {
        dismiss();
        onAction?.();
      });
      t.appendChild(b);
    }
    t.addEventListener('pointerenter', () => clearTimeout(timer));
    t.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 1500); });
    toastHost.appendChild(t);
    while (toastHost.children.length > 3) toastHost.firstChild.remove();
    timer = setTimeout(dismiss, duration);
    return dismiss;
  }

  // An "Undo" toast always refers to the latest change, so older ones go away.
  function dismissHistoryToasts() {
    for (const t of toastHost.querySelectorAll('.toast[data-history]')) t.dismiss?.();
  }

  // ================================================================ lightbox

  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightbox-img');
  let lightboxImage = null;

  function openLightbox(imageId) {
    lightboxImage = imageId;
    lightboxImg.src = imgUrl(imageId);
    if (!lightbox.open) lightbox.showModal();
  }
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxImg) lightbox.close();
  });
  $('#lightbox-close').addEventListener('click', () => lightbox.close());
  $('#lightbox-copy').addEventListener('click', async () => {
    if (lightboxImage && (await api.copyImage(lightboxImage))) {
      toast('Image copied');
      lightbox.close();
    }
  });

  // ================================================================ search

  const searchInput = $('#search');

  searchInput.addEventListener('input', () => {
    ui.search = searchInput.value;
    render();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchInput.value) {
        searchInput.value = '';
        ui.search = '';
        render();
      } else {
        searchInput.blur();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = [...board.querySelectorAll('.active-list > .card-wrap:not(.is-editing)')].find((n) => n.offsetParent);
      if (first) copyNote(first.dataset.id);
      else toast('Nothing matches');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      board.querySelector('.card-wrap:not(.is-editing) > .card')?.focus();
    }
  });

  function focusSearch() {
    searchInput.focus();
    searchInput.select();
  }

  // ================================================================ settings

  const dialog = $('#settings');
  const f = {
    key: $('#set-key'),
    keyRemove: $('#set-key-remove'),
    keyStatus: $('#set-key-status'),
    model: $('#set-model'),
    language: $('#set-language'),
    hint: $('#set-hint'),
    hotkey: $('#set-hotkey'),
    hotkeyStatus: $('#set-hotkey-status'),
    shotHotkey: $('#set-shot-hotkey'),
    shotHotkeyStatus: $('#set-shot-hotkey-status'),
    hide: $('#set-hide'),
    density: $('#set-density'),
    theme: $('#set-theme'),
    titleFont: $('#set-title-font'),
    cooked: $('#set-cooked'),
    joiner: $('#set-joiner'),
    backup: $('#set-backup'),
    backupStatus: $('#backup-status'),
  };

  const BACKUP_KIND = { upgrade: 'Before update', daily: 'Daily', manual: 'Manual', 'before-restore': 'Before restore', 'before-sync': 'Before sync' };

  async function paintBackups(selectId) {
    let list = [];
    try { list = await api.listBackups(); } catch (err) { console.error(err); }
    f.backup.innerHTML = '';
    for (const b of list) {
      const when = new Date(b.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const what = b.kind === 'upgrade' ? `Before update to ${b.toVersion}` : BACKUP_KIND[b.kind] || b.kind;
      f.backup.add(new Option(`${when} · ${what} · ${b.notes} notes`, b.id));
    }
    if (!list.length) f.backup.add(new Option('No backups yet', ''));
    if (selectId) f.backup.value = selectId;
    f.backupStatus.textContent = list.length
      ? `${list.length} kept. Recaller backs up automatically before every update and once a day.`
      : 'Recaller backs up automatically before every update and once a day.';
  }

  function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : 'deep';
    document.body.classList.remove(...THEMES.map((x) => `theme-${x}`));
    document.body.classList.add(`theme-${t}`);
  }

  // On a Mac a hotkey reads like its menus do: ⌃⌥⇧⌘ in Apple's order, then the key ('Control+Alt+R' → '⌃⌥R').
  const MAC_MODS = { Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Super: '⌘', Meta: '⌘' };
  const MAC_KEYS = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↩', Return: '↩', Esc: '⎋', Escape: '⎋', Plus: '+' };
  function macAccel(a) {
    const parts = (a || '').split('+').filter(Boolean);
    const mods = parts.filter((p) => Object.hasOwn(MAC_MODS, p)).map((p) => MAC_MODS[p]);
    const keys = parts.filter((p) => !Object.hasOwn(MAC_MODS, p)).map((p) => (Object.hasOwn(MAC_KEYS, p) ? MAC_KEYS[p] : p));
    return ['⌃', '⌥', '⇧', '⌘'].filter((m) => mods.includes(m)).join('') + keys.join('');
  }

  const prettyAccel = (a) => (IS_MAC ? macAccel(a) : (a || '').replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + '));

  function paintHotkey(input, status, value, ok) {
    input.value = prettyAccel(value);
    status.className = `help ${value ? (ok ? 'ok' : 'bad') : ''}`;
    status.textContent = !value ? 'Off · Backspace clears' : ok ? 'Active everywhere' : 'Taken by another app — try another combo';
  }

  function paintDensity() {
    for (const b of f.density.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === data.prefs.density));
    const title = titleFont();
    for (const b of f.titleFont.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === title));
    const cooked = cookedColor();
    for (const b of f.cooked.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === cooked));
    const join = data.prefs.joiner === 'line' ? 'line' : 'blank';
    for (const b of f.joiner.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === join));
  }

  function paintSettings(s) {
    ui.settings = s;
    f.key.value = '';
    if (s.hasKey) {
      f.key.placeholder = `•••• ${s.keyHint}`;
      f.keyStatus.className = 'help ok';
      f.keyStatus.textContent = s.keySource === 'env'
        ? 'Using OPENAI_API_KEY from your environment. Paste a key here to override it.'
        : IS_MAC ? 'Saved in your Mac’s keychain. Paste a new key to replace it.' : 'Saved and encrypted on this PC. Paste a new key to replace it.';
    } else {
      f.key.placeholder = 'sk-…';
      f.keyStatus.className = 'help';
      f.keyStatus.innerHTML = 'Needed for voice. Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.';
    }
    f.keyRemove.hidden = s.keySource !== 'saved';
    if (![...f.model.options].some((o) => o.value === s.model)) f.model.add(new Option(s.model, s.model));
    f.model.value = s.model;
    f.language.value = s.language;
    f.hint.value = s.hint;
    paintHotkey(f.hotkey, f.hotkeyStatus, s.hotkey, s.hotkeyOk);
    paintHotkey(f.shotHotkey, f.shotHotkeyStatus, s.shotHotkey, s.shotHotkeyOk);
    f.hide.checked = s.hideAfterCopy;
    for (const b of f.theme.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === s.theme));
    applyTheme(s.theme);
    paintDensity();
  }

  async function saveSetting(patch) {
    try {
      paintSettings(await api.setSettings(patch));
    } catch (err) {
      console.error(err);
      toast("Couldn't save settings.");
    }
  }

  async function openSettings({ focusKey = false } = {}) {
    closeMenu();
    try {
      paintSettings(await api.getSettings());
    } catch (err) {
      console.error(err);
    }
    paintBackups();
    if (!dialog.open) dialog.showModal();
    if (focusKey) f.key.focus();
  }

  f.key.addEventListener('change', () => { if (f.key.value.trim()) saveSetting({ apiKey: f.key.value.trim() }); });
  f.keyRemove.addEventListener('click', () => saveSetting({ apiKey: '' }));
  f.model.addEventListener('change', () => saveSetting({ model: f.model.value }));
  f.language.addEventListener('change', () => saveSetting({ language: f.language.value }));
  f.hint.addEventListener('change', () => saveSetting({ hint: f.hint.value }));
  f.hide.addEventListener('change', () => saveSetting({ hideAfterCopy: f.hide.checked }));
  f.density.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.dataset.value === data.prefs.density) return;
    data.prefs.density = b.dataset.value;
    persist();
    paintDensity();
    render();
    remeasure();
  });
  f.joiner.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    if (data.prefs.joiner !== b.dataset.value) { // the one synced preference
      contentSeq++;
      pendingLabels.push('Join setting');
    }
    data.prefs.joiner = b.dataset.value;
    persist();
    paintDensity();
    render();
  });
  f.cooked.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    data.prefs.cookedColor = b.dataset.value;
    persist();
    paintDensity();
    render();
  });
  f.titleFont.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    data.prefs.titleFont = b.dataset.value;
    persist();
    paintDensity();
    render();
  });
  f.theme.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.dataset.value === ui.settings?.theme) return;
    applyTheme(b.dataset.value);
    saveSetting({ theme: b.dataset.value });
  });
  $('#open-data').addEventListener('click', () => api.openDataFolder());
  $('#backup-now').addEventListener('click', async () => {
    const id = await api.createBackup();
    await paintBackups(id);
    toast(id ? 'Backup saved' : 'Nothing to back up yet');
  });
  $('#backup-restore').addEventListener('click', async () => {
    const id = f.backup.value;
    if (!id) return;
    const label = f.backup.selectedOptions[0]?.textContent || 'that backup';
    // Signed in, a restore deletes nothing from the account (5.12), so the question differs.
    const acc = api.account ? await api.account.get().catch(() => null) : null;
    const sure = window.confirm(acc?.state === 'signed-in'
      ? `Bring back the board from ${label}?\n\nYou're signed in, so nothing is deleted from your account: notes in the backup are added back, and notes that are only in your account stay. What you have now is backed up first.`
      : `Replace all your projects and notes with the backup from ${label}?\n\nWhat you have now is backed up first, so you can go back to it.`);
    if (!sure) return;
    const res = await api.restoreBackup(id);
    if (!res?.ok) toast(res?.error || 'Restore failed.');
  });
  $('#open-settings').addEventListener('click', () => openSettings());

  // ---- help (top-bar ?, F1): how the stages work, handy moves and shortcuts
  const helpDialog = $('#help');

  function openHelp() {
    closeMenu();
    if (dialog.open) dialog.close();
    const hotkey = ui.settings?.hotkey;
    $('#help-hotkey').textContent = hotkey ? prettyAccel(hotkey).replace(/ \+ /g, ' ') : 'Off';
    $('#help-hotkey-label').textContent = hotkey ? 'Show or hide Recaller from any app' : 'Show/hide from any app (set a key in Settings)';
    if (!helpDialog.open) helpDialog.showModal();
  }
  $('#open-help').addEventListener('click', openHelp);
  dialog.addEventListener('close', () => {
    if (f.key.value.trim()) saveSetting({ apiKey: f.key.value.trim() });
  });

  const KEY_NAMES = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': 'Plus' };
  // On a Mac, Option changes e.key (⌥, types ≤), so punctuation is named from the key itself.
  const MAC_CODE_KEYS = { Space: 'Space', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' };

  for (const input of document.querySelectorAll('.hotkey-input')) {
    const setting = input.dataset.setting;
    const status = setting === 'hotkey' ? f.hotkeyStatus : f.shotHotkeyStatus;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') return;
      e.preventDefault();
      e.stopPropagation();
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        saveSetting({ [setting]: '' });
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const mods = [];
      if (e.ctrlKey) mods.push(IS_MAC ? 'Control' : 'CommandOrControl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push(IS_MAC ? 'Command' : 'Super');
      let key = e.key;
      if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
      else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
      else if (IS_MAC && Object.hasOwn(MAC_CODE_KEYS, e.code)) key = MAC_CODE_KEYS[e.code];
      else key = KEY_NAMES[key] || (key.length === 1 ? key.toUpperCase() : key);
      if (!mods.length && !/^F\d{1,2}$/.test(key)) {
        status.className = 'help bad';
        status.textContent = IS_MAC ? 'Use at least one of ⌃, ⌥, ⇧ or ⌘' : 'Use at least one of Ctrl, Alt or Shift';
        return;
      }
      saveSetting({ [setting]: [...mods, key].join('+') });
    });
  }

  // ================================================================ global keys

  function isTyping(target) {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function screenshotToNote() {
    const composer = activeComposer();
    if (composer) composer.screenshot();
    else openComposer(currentProjectId(), { screenshot: true });
  }

  document.addEventListener('keydown', (e) => {
    const mod = modKey(e);
    const k = e.key.toLowerCase();
    if (dialog.open || lightbox.open || helpDialog.open) return;
    if (e.key === 'Escape' && openMenuEl) {
      closeMenu();
      return;
    }
    if (e.key === 'Escape' && isNotepadOpen()) {
      closeNotepad();
      return;
    }
    if (e.key === 'Escape' && isEatenOpen()) {
      if (e.target === eatenSearch && eatenSearch.value) {
        eatenSearch.value = '';
        eatenUi.query = '';
        paintEaten();
      } else {
        closeEaten();
      }
      return;
    }
    if (e.key === 'Escape' && (ui.selection.length || ui.anchor)) {
      clearSelection();
      if (!isTyping(e.target)) return;
    }
    if (!['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) ui.anchor = null;
    if (mod && !e.shiftKey && k === 'z' && !isTyping(e.target)) {
      e.preventDefault();
      undo();
    } else if (mod && ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y')) && !isTyping(e.target)) {
      e.preventDefault();
      redo();
    } else if (mod && !e.shiftKey && (k === 'k' || k === 'f')) {
      e.preventDefault();
      if (ui.widget) setWidget(false).then(() => setTimeout(focusSearch, 300)); // search lives on the full board
      else focusSearch();
    } else if (mod && e.shiftKey && k === 'n') {
      e.preventDefault();
      createProject();
    } else if (mod && e.shiftKey && k === 's') {
      e.preventDefault();
      screenshotToNote();
    } else if (mod && !e.shiftKey && k === 'n') {
      e.preventDefault();
      openComposer(currentProjectId());
    } else if (mod && !e.shiftKey && k === 'm') {
      e.preventDefault();
      const composer = activeComposer();
      if (composer) {
        composer.focus();
        composer.toggleVoice();
      } else {
        openComposer(currentProjectId(), { voice: true });
      }
    } else if (mod && !e.shiftKey && k === 'j') {
      e.preventDefault();
      if (isNotepadOpen() && !notepadFor) closeNotepad();
      else openNotepad();
    } else if (mod && k === ',') {
      e.preventDefault();
      openSettings();
    } else if (e.key === 'F1' || (e.key === '?' && !mod && !isTyping(e.target))) {
      e.preventDefault();
      openHelp();
    }
  });

  api.onSummoned(() => {
    if (dialog.open || helpDialog.open || isEditing() || Voice.isActive() || ui.widget) return; // the widget has no search box
    focusSearch();
  });

  // The Mac menu bar (Settings…, How Recaller Works, Edit › Undo / Redo) and full screen.
  if (IS_MAC) {
    api.onCommand((name) => {
      if (name === 'fullscreen-on' || name === 'fullscreen-off') {
        // Full screen hides the traffic lights, so the top bar stops making room for them.
        document.body.classList.toggle('is-fullscreen', name === 'fullscreen-on');
      } else if (name === 'settings') {
        if (!dialog.open) openSettings(); // already open: repainting it would wipe what's being typed
      } else if (name === 'help') {
        openHelp();
      } else if (name === 'undo' || name === 'redo') {
        // Typing in a field: the field's own undo. Otherwise the board's, unless a dialog is open.
        if (isTyping(document.activeElement)) document.execCommand(name);
        else if (dialog.open || helpDialog.open || lightbox.open) return;
        else if (name === 'undo') undo();
        else redo();
      }
    });
  }

  // Screenshot taken with the global shortcut while Recaller was in the background.
  api.onScreenshot((result) => {
    if (!result?.ok) {
      if (IS_MAC && result?.code === 'PERMISSION') toast(result.error, { action: 'Open Settings', onAction: () => api.openPrivacy('screen'), duration: 12000 });
      else if (result?.error) toast(result.error);
      return;
    }
    const composer = activeComposer() || openComposer(currentProjectId());
    composer?.addImage(result.image);
  });

  window.addEventListener('error', (e) => console.error('[recaller]', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[recaller]', e.reason));

  // Keep "5m ago" labels fresh.
  setInterval(() => { if (!dragActive) render(); }, 60_000);

  // ---- sync (1.17): the page's side of accounts and sync (ai_memory/15, 5.8 and 6.5)
  // Main does the network. The account's changes arrive as patches, applied only while nothing
  // is mid-edit and acknowledged by the save that follows; every save carries the bookkeeping.
  // Without sync (signed out, or a preload without it) none of this does anything.

  const SESSION = uid();    // this page load: a patch made for another is stale
  let saveSeq = 0;
  let contentSeq = 0;       // raised by every content change: a patch based on an older one is stale
  const pendingLabels = []; // undo labels since the last save, for main's mass-delete guard
  let pendingPatch = null;
  let patchTimer = null;
  let pageReady = false;    // init() has loaded the board
  const HERE = IS_MAC ? 'this Mac' : 'this PC';
  const HERE_CAP = IS_MAC ? 'This Mac' : 'This PC';

  const tally = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const holdsDraft = (p) => Boolean(p && (p.draft.trim() || p.draftImages.length));

  // "your Mac", "your other PC", … from a DeviceRef.
  function deviceName(ref) {
    if (ref?.platform === 'darwin') return ref.sameAsThis ? 'your other Mac' : 'your Mac';
    if (ref?.platform === 'win32') return ref.sameAsThis ? 'your other PC' : 'your Windows PC';
    return 'another computer';
  }

  // A notice's toast. `own` counts the patch's new conflict copies that hold this computer's
  // version: all of them, except after a restore with no base to compare (5.7).
  function noticeText(n, own) {
    const k = tally(n.count) || 1;
    const device = deviceName(n.device);
    const name = n.name || 'Untitled';
    switch (n.code) {
      case 'CONFLICT': {
        const mine = own >= k;
        return k === 1
          ? `A note was changed on two computers. Both versions are kept; ${mine ? `${HERE}'s` : 'the copy'} is marked Check again.`
          : `${k} notes were changed on two computers. Both versions of each are kept; ${mine ? `${HERE}'s` : 'the copies'} are marked Check again.`;
      }
      case 'KEPT_NOTE':
        return k === 1
          ? `A note you deleted was changed on ${device}, so it was kept.`
          : `${k} notes you deleted were changed on ${device}, so they were kept.`;
      case 'KEPT_PROJECT':
        return `“${name}” was deleted on ${device}, but it had changes here, so it was kept.`;
      case 'KEPT_PROJECT_DRAFT':
        return `“${name}” was deleted on ${device}, but it had an unsaved draft here, so it was kept.`;
      case 'REMOTE_DELETES':
        return `${device[0].toUpperCase()}${device.slice(1)} deleted ${plural(tally(n.count), 'note')}. ${HERE_CAP}'s board was backed up first (Settings › Backups).`;
      case 'RESTORED_FROM_ACCOUNT':
        return `${HERE_CAP}'s notes file couldn't be read, so your board was restored from your account. The unreadable file was kept in the data folder.`;
      case 'COMBINED':
        return `Combined: ${plural(tally(n.a), 'project')} from your account and ${tally(n.b)} from ${HERE}.`;
      case 'USED_ACCOUNT':
        return `${HERE_CAP} now shows your account's board. Its previous board is in Settings › Backups.`;
      default:
        return '';
    }
  }

  // How many of a patch's new conflict copies hold this page's own text and pictures, looked at
  // before the patch puts the account's version in their original's place.
  function ownCopies(p) {
    let n = 0;
    for (const [id, up] of Object.entries(p.notes.upsert || {})) {
      const f = up?.fields;
      const original = typeof f?.syncConflict?.of === 'string' && !locate(id) ? locate(f.syncConflict.of)?.note : null;
      if (original && original.text === f.text && imageKey(original.images) === imageKey(Array.isArray(f.images) ? f.images : [])) n++;
    }
    return n;
  }

  // The card tag's tooltip names the computer a conflict copy came from, by device id. That
  // needs AccountState's devices with their ids; until main sends them it says less.
  let deviceNames = new Map();
  let devicesAsked = false;

  function learnDevices(state) {
    if (!Array.isArray(state?.devices)) return;
    const next = new Map();
    for (const d of state.devices) {
      if (typeof d?.id === 'string') next.set(d.id, d.current ? HERE : deviceName({ platform: d.platform, sameAsThis: d.platform === api.platform }));
    }
    const changed = next.size !== deviceNames.size || [...next].some(([id, name]) => deviceNames.get(id) !== name);
    deviceNames = next;
    if (changed && pageReady) render();
  }

  function syncTagTitle(conflict) {
    if (!devicesAsked) {
      devicesAsked = true;
      api.account?.get().then(learnDevices, () => {});
    }
    const from = deviceNames.get(conflict?.device);
    return `Changed on two computers at once.${from ? ` This copy is the version from ${from}.` : ''}`;
  }

  // Pointers down on the board: a press can still become a drag of a card, the Cooked note or
  // a column, and a patch that removed it would break the drag.
  const pressing = new Set();
  let releasedAt = 0;
  if (api.sync) {
    const release = (e) => { if (pressing.delete(e.pointerId)) releasedAt = Date.now(); };
    board.addEventListener('pointerdown', (e) => { pressing.add(e.pointerId); }, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('pointermove', (e) => { if (e.buttons === 0) release(e); }, true);
    window.addEventListener('blur', () => {
      if (pressing.size) releasedAt = Date.now();
      pressing.clear();
    });
  }

  // A patch that changes content waits while anything holds the board: an editor, a press, a
  // delete or swipe still animating, a menu, dictation or an Undo toast.
  function syncBusy(p) {
    if (!p.changesContent && !p.resetHistory) return false; // counters are commutative: apply at once
    if (ui.editing || dragActive || resizing || openMenuEl || Voice.isActive()) return true;
    if (pressing.size || document.body.classList.contains('is-panning')) return true;
    if (board.querySelector('.card-wrap.is-removing')) return true; // a deleted card sliding out
    // A swiped Cooked note moves to Served 220 ms after the release, whatever Cooked then holds.
    // A class an interrupted swipe left behind must not hold the account's changes back for good.
    if (Date.now() - releasedAt < 1000 && board.querySelector('.used.is-swiping')) return true;
    for (const c of columns.values()) if (c.stageEditor || c.renaming || c.composer?.isBusy()) return true;
    if (ui.composing && p.projects.remove.includes(ui.composing)) return true;
    if (notepadBusy()) return true; // someone is typing in the notepad (1.20)
    return Boolean(toastHost.querySelector('.toast[data-history]:not(.is-leaving)')); // wait out an Undo toast
  }

  function tryApplyPatch() {
    clearTimeout(patchTimer);
    const p = pendingPatch;
    if (!p || !pageReady) return;
    if (p.session !== SESSION || (p.changesContent && p.basedOnContentSeq !== contentSeq)) {
      pendingPatch = null;
      api.sync?.nack({ patchId: p.id, reason: 'stale' });
      return;
    }
    if (syncBusy(p)) {
      patchTimer = setTimeout(tryApplyPatch, 700);
      return;
    }
    // A draft typed into a column after main read the file would go with the column. Saved,
    // it makes main's next merge keep the column (only "Use my account's board" replaces it).
    if (p.projects.remove.some((id) => holdsDraft(findProject(id))) && !p.notices.some((n) => n?.code === 'USED_ACCOUNT')) {
      pendingPatch = null;
      clearTimeout(draftTimer);
      persist();
      api.sync?.nack({ patchId: p.id, reason: 'stale' });
      return;
    }
    pendingPatch = null;
    const own = p.notices.some((n) => n?.code === 'CONFLICT') ? ownCopies(p) : 0;
    let created;
    try {
      ({ created } = window.SyncApply.applyPatch(data, p));
    } catch (err) {
      console.error('[sync] patch failed', err);
      api.sync?.nack({ patchId: p.id, reason: 'invalid' });
      render();
      return;
    }
    if (p.changesContent) contentSeq++;
    if (p.changesContent || p.resetHistory) {
      history.undo.length = 0;
      history.redo.length = 0;
      dismissHistoryToasts();
      paintHistory();
    }
    if (created.length <= 10) created.forEach((id) => fresh.add(id));
    persist({ ack: p.id });
    render(); // also drops removed ids from ui.selection
    if (ui.editing && !locate(ui.editing)) ui.editing = null;
    if (ui.anchor && !locate(ui.anchor.id)) ui.anchor = null;
    if (dialog.open) paintDensity(); // "Join notes with"
    for (const n of p.notices) {
      const text = n && typeof n === 'object' ? noticeText(n, own) : '';
      if (text) toast(text, { duration: 7000 });
    }
  }

  api.sync?.onPatch((p) => {
    if (!p || typeof p.id !== 'string') return;
    if (!Array.isArray(p.projects?.remove) || !Array.isArray(p.notes?.remove) || !Array.isArray(p.notices)) {
      api.sync.nack({ patchId: p.id, reason: 'invalid' });
      return;
    }
    pendingPatch = p;
    tryApplyPatch();
  });
  api.account?.onChanged?.(learnDevices);

  // For account.js, which loads after this file.
  window.RecallerUI = Object.freeze({ toast, openSettings: () => openSettings(), relTime });

  // ================================================================ boot

  async function init() {
    let raw = null;
    try {
      raw = await api.loadData();
    } catch (err) {
      console.error('load failed', err);
    }
    data = normalize(raw) || seedData();
    // 1.20.4: a column minimized by 1.18–1.19 carries the per-computer `localMinimized`, so it stayed
    // minimized on that computer only. Turn it into the synced flag once, so every computer gets it.
    const oldMinimized = data.projects.filter((p) => p.localMinimized === true);
    for (const p of oldMinimized) {
      p.minimized = true;
      delete p.localMinimized;
    }
    if (oldMinimized.length) {
      contentSeq++;
      pendingLabels.push('Minimize column');
    }
    // 1.20.7: groups folded on this computer only (prefs.foldedGroups) become synced folds, once.
    let oldFolds = false;
    if ('foldedGroups' in data.prefs) {
      const names = Array.isArray(data.prefs.foldedGroups) ? data.prefs.foldedGroups.filter((g) => typeof g === 'string') : [];
      delete data.prefs.foldedGroups;
      for (const name of names) markGroupFolded(name.trim(), true);
      oldFolds = true;
    }
    // Only write on load when there was nothing to load (first run), the file predates the current
    // format, or old minimized columns or folds were just converted; otherwise the file is left alone.
    if (!raw || !(Number(raw.version) >= DATA_VERSION) || oldMinimized.length || oldFolds) persist();
    const last = findProject(data.prefs.lastProjectId);
    ui.lastProjectId = last && !isNotepad(last) ? last.id : boardProjects()[0]?.id ?? null;
    lastProjectSaved = ui.lastProjectId;
    try {
      ui.settings = await api.getSettings();
      applyTheme(ui.settings.theme);
      showZoom(ui.settings.zoom);
      ui.widget = Boolean(ui.settings.widget);
      ui.widgetId = ui.settings.widgetProject || null;
      document.body.classList.toggle('is-widget', ui.widget);
    } catch (err) {
      console.error(err);
    }
    render();
    paintHistory();
    // Not tied to an animation frame: a window that starts hidden or minimized
    // gets no frames, and must still come up fully restored.
    restoreScroll();
    void document.body.offsetWidth; // let the fade-in transition start from opacity 0
    document.body.classList.add('is-ready');
    updatePan();
    // Sweep image files that no note references any more.
    api.gcImages(referencedImageIds()).catch(() => {});
    pageReady = true;
    tryApplyPatch(); // one that came in while loading
    api.sync?.ready({ session: SESSION });
  }

  init();
})();
