'use strict';
// The board edits of the desktop page (src/renderer/app.js), as a pure module for the iPhone app.
// It runs in plain JavaScriptCore: no modules are loaded, no host globals are touched, and copies are
// made with JSON. JavaScript owns the board data: every edit mutates the live data object in place, so
// fields this version doesn't know about survive (the sync writes whole items, and a dropped field
// would be deleted on every computer).
//
// const board = createBoard(page), where page = { data (getter), markContent(label), persist(), now(), newId() }.
// Every action returns { ok: true, ...extra } or { ok: false, error }. A no-op on a real target returns
// { ok: true, changed: false } and saves nothing. Labels are the desktop's own undo labels: the sync
// engine's mass-delete guard (src/sync/engine.js EXPLAINING) reads them.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.RecallerBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const HISTORY_LIMIT = 80;
  const DATA_VERSION = 2;
  const EATEN_MAX = 300;
  const IMAGE_ID = /^[a-f0-9]{32}$/;
  const LISTS = ['notes', 'used', 'combined'];
  const STAGE_NAME = { notes: 'Cooking', used: 'Cooked', combined: 'Served' };
  const STAGE_WHOLE = { used: 'Cooked note', combined: 'Served text' };
  const HIGHLIGHTS = ['amber', 'rose', 'sky', 'lime'];

  // Listed in the order new projects pick them (app.js PALETTE). Stored ids never change.
  const PALETTE = Object.freeze([
    { id: 'monstera', name: 'Emerald', color: '#0e9f6e' },
    { id: 'moss', name: 'Sky', color: '#0284c7' },
    { id: 'sun', name: 'Sun', color: '#d97706' },
    { id: 'orchid', name: 'Orchid', color: '#9333ea' },
    { id: 'fern', name: 'Lime', color: '#65a30d' },
    { id: 'clay', name: 'Blossom', color: '#db2777' },
    { id: 'eucalyptus', name: 'Teal', color: '#0d9488' },
    { id: 'sage', name: 'Bark', color: '#78716c' },
    { id: 'indigo', name: 'Indigo', color: '#4f46e5' },
    { id: 'ember', name: 'Ember', color: '#ea580c' },
    { id: 'lagoon', name: 'Lagoon', color: '#0891b2' },
    { id: 'ruby', name: 'Ruby', color: '#dc2626' },
    { id: 'forest', name: 'Forest', color: '#15803d' },
    { id: 'fuchsia', name: 'Fuchsia', color: '#c026d3' },
    { id: 'slate', name: 'Slate', color: '#475569' },
    { id: 'mustard', name: 'Mustard', color: '#a16207' },
    { id: 'navy', name: 'Navy', color: '#1e3a8a' },
    { id: 'wine', name: 'Wine', color: '#9f1239' },
  ].map((c) => Object.freeze(c)));

  // app.js CC_GUIDE / claudeCodeText(): the Cooked note as a Claude Code prompt (a fixed template).
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

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const cleanImages = (list) => (Array.isArray(list) ? list : [])
    .filter((i) => i && IMAGE_ID.test(i.id))
    .map((i) => ({ ...i, w: Number(i.w) || 0, h: Number(i.h) || 0 }));

  // ---- loading (app.js normalize(): lossless, repairs only malformed data)

  function normalize(raw, newId, now) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return null;
    const ids = new Set();
    const cleanId = (id) => {
      let v = typeof id === 'string' && id ? id : newId();
      if (ids.has(v)) v = newId();
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
        createdAt: num(n.createdAt, now()),
        updatedAt: num(n.updatedAt, num(n.createdAt, now())),
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
        createdAt: num(p.createdAt, now()),
        notes: notes(p.notes),
        used: notes(p.used),
        combined: notes(p.combined),
      })),
    };
  }

  const makeNote = (text, images, newId, now) => {
    const t = now();
    return { id: newId(), text, images, createdAt: t, updatedAt: t, copied: 0, lastCopiedAt: 0, usedAt: 0 };
  };

  // app.js seedData(), with the key labels as the Mac edition writes them (kb() on a Mac).
  function seedData(newId, now) {
    // The iPhone's own ten tips (the desktop's speak of clicks, ⌘ keys and column widths). The sync engine
    // recognises an untouched Welcome by its shape, not its words (src/sync/model.js isPristineWelcome).
    const tips = [
      'Tap a prompt to copy it, then paste it anywhere.',
      'Swipe a prompt right to move it to Cooked. Prompts in Cooked join into one note.',
      'Swipe a prompt left to delete it. Undo brings it back.',
      'Tap Dictate and speak: the text appears as you talk. Add your OpenAI key in Settings first.',
      'Tap New text to type a prompt. Add pictures from Photos, the camera or the clipboard.',
      'Tap Served on the Cooked note to add it to the final text. Tap Cooked or Served to copy all of it.',
      'Press and hold a prompt to edit it, highlight it or move it.',
      'Tap the column chips at the top to switch columns, or swipe across a column’s header.',
      'Notepad is one scratch page, saved as you type.',
      'Sign in under ⋯ › Settings to sync this board with your computers.',
    ];
    return {
      version: 2,
      prefs: { density: 'slim' },
      projects: [{
        id: newId(), name: 'Welcome', color: 'monstera', usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now(),
        notes: tips.map((t) => makeNote(t, [], newId, now)), used: [], combined: [],
      }],
    };
  }

  // ---- the board

  function createBoard(page) {
    const D = () => page.data;
    const now = () => page.now();
    const newId = () => page.newId();
    const history = { undo: [], redo: [] };

    const ok = (extra) => Object.assign({ ok: true }, extra || {});
    const fail = (error) => ({ ok: false, error });
    const same = () => ({ ok: true, changed: false });

    const projects = () => (Array.isArray(D().projects) ? D().projects : (D().projects = []));
    const prefs = () => (isObj(D().prefs) ? D().prefs : (D().prefs = {}));
    const list = (p, l) => (Array.isArray(p[l]) ? p[l] : (p[l] = []));
    const isNotepad = (p) => Boolean(p) && p.notepad === true;
    const boardProjects = () => projects().filter((p) => isObj(p) && !isNotepad(p));
    // A new board order: the hidden notepad stays at the end (app.js setBoardOrder).
    const setBoardOrder = (order) => { D().projects = order.concat(projects().filter(isNotepad)); };
    const findProject = (id) => projects().find((p) => isObj(p) && p.id === id) || null;
    const findBoardProject = (id) => {
      const p = findProject(id);
      return p && !isNotepad(p) ? p : null;
    };
    const groupOf = (p) => (typeof p.group === 'string' && p.group.trim() ? p.group.trim() : '');
    const isEating = (p) => Number.isFinite(p.eating) && p.eating > 0;
    const isMinimized = (p) => p.minimized === true || p.localMinimized === true;
    const isClaudeCode = (p) => p.cookedFormat === 'claude-code' && list(p, 'used').length > 0;
    const joiner = () => (prefs().joiner === 'line' ? '\n' : '\n\n');
    const joined = (notes) => notes.map((n) => n.text).filter((t) => t.trim()).join(joiner());
    const cookedText = (p) => (isClaudeCode(p) ? claudeCodeText(list(p, 'used').map((n) => n.text)) : joined(list(p, 'used')));
    const imageKey = (images) => images.map((i) => i.id).join(',');
    const stageImages = (notes) => {
      const seen = new Set();
      return notes.flatMap((n) => n.images || []).filter((img) => !seen.has(img.id) && seen.add(img.id));
    };
    // Once Cooked is empty again, the next batch starts as plain text.
    const settleCooked = (p) => { if (p && !list(p, 'used').length) delete p.cookedFormat; };

    // A note on the board (never one in the notepad project).
    function locate(noteId) {
      for (const p of boardProjects()) {
        for (const l of LISTS) {
          const index = list(p, l).findIndex((n) => n && n.id === noteId);
          if (index >= 0) return { project: p, list: l, index, note: p[l][index] };
        }
      }
      return null;
    }

    const eatenList = () => (Array.isArray(D().localEaten)
      ? D().localEaten.filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.text === 'string')
      : []);
    function setEatenList(rounds) {
      if (rounds && rounds.length) D().localEaten = rounds.slice(0, EATEN_MAX);
      else delete D().localEaten;
    }

    // ---- undo / redo (app.js pushHistory / applySnapshot / undo / redo)

    const snapshot = () => JSON.stringify(projects());

    function checkpoint(label, extra) {
      history.undo.push(Object.assign({ label, snap: snapshot(), eaten: eatenList() }, extra || {}));
      if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
      history.redo.length = 0;
      page.markContent(label);
    }

    const carry = (to, from, k) => {
      if (from[k] !== undefined) to[k] = from[k];
      else delete to[k];
    };

    // Live counters, drafts, folds, Eating and minimized are carried over: undo rewinds only edits.
    function applySnapshot(snap, restore) {
      const next = normalize({ projects: JSON.parse(snap) }, newId, now);
      const liveProjects = new Map();
      const liveNotes = new Map();
      for (const p of projects()) {
        if (!isObj(p)) continue;
        liveProjects.set(p.id, p);
        for (const l of LISTS) for (const n of list(p, l)) if (n) liveNotes.set(n.id, n);
      }
      for (const p of next.projects) {
        const live = liveProjects.get(p.id);
        if (live) {
          p.draft = live.draft;
          p.draftImages = live.draftImages;
          for (const k of ['notesCollapsed', 'usedCollapsed', 'augCollapsed', 'augExpanded', 'usedExpanded']) carry(p, live, k);
          for (const k of ['eating', 'minimized', 'localMinimized']) if (!restore.includes(k)) carry(p, live, k);
        }
        for (const n of p.notes.concat(p.used, p.combined)) {
          const ln = liveNotes.get(n.id);
          if (!ln) continue;
          n.copied = ln.copied;
          n.lastCopiedAt = ln.lastCopiedAt;
          carry(n, ln, 'expanded');
        }
      }
      // The notepad is typed outside the board's history: undo leaves it as it is now.
      D().projects = next.projects.filter((p) => !isNotepad(p)).concat(projects().filter(isNotepad));
    }

    function step(from, to, label) {
      const entry = from.pop();
      if (!entry) return fail(label === 'Undo' ? 'nothing to undo' : 'nothing to redo');
      to.push({ label: entry.label, snap: snapshot(), eaten: eatenList(), restore: entry.restore });
      page.markContent(label);
      setEatenList(entry.eaten);
      applySnapshot(entry.snap, entry.restore || []);
      page.persist();
      return ok({ label: entry.label });
    }

    // ---- input

    const cleanText = (text) => (typeof text === 'string' ? text.trim() : null);
    const takeImages = (images) => cleanImages(clone(Array.isArray(images) ? images : []));

    // ---- actions (each named after, and doing what, the app.js function noted beside it)

    const actions = {
      // addNote()
      addNote(projectId, text, images = []) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        const value = cleanText(text);
        if (value === null) return fail('bad text');
        const imgs = takeImages(images);
        if (!value && !imgs.length) return fail('empty');
        checkpoint('New note');
        const note = makeNote(value, imgs, newId, now);
        list(p, 'notes').push(note); // new prompts go to the bottom
        delete p.notesCollapsed;
        p.draft = '';
        p.draftImages = [];
        page.persist();
        return ok({ id: note.id });
      },

      // startEdit() onSave for a card; saveStageEdit() with a partId for a Cooked or Served part
      editNote(noteId, text, images) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        const value = cleanText(text);
        if (value === null) return fail('bad text');
        const imgs = images === undefined ? at.note.images : takeImages(images);
        if (!value && !imgs.length) return fail('empty');
        const changed = at.note.text !== value || imageKey(at.note.images || []) !== imageKey(imgs);
        if (at.list === 'notes') {
          // Saving a sync conflict copy ("Other version") from its editor settles it, changed or not.
          if (!changed && !at.note.syncConflict) return same();
          checkpoint('Edit note');
          if (changed) {
            at.note.text = value;
            at.note.images = imgs;
            at.note.updatedAt = now();
          }
          delete at.note.syncConflict;
        } else {
          if (!changed) return same();
          checkpoint('Edit note');
          at.note.text = value;
          at.note.images = imgs;
          at.note.updatedAt = now();
        }
        page.persist();
        return ok();
      },

      // deleteNote() for a card; deletePart() for a Cooked or Served part
      deleteNote(noteId) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        checkpoint('Delete note');
        at.project[at.list].splice(at.index, 1);
        if (at.list !== 'notes') settleCooked(at.project);
        page.persist();
        return ok();
      },

      // moveBetween(id, 'used')
      moveToCooked(noteId) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        if (at.list !== 'notes') return fail('not in Cooking');
        checkpoint('Move to Cooked');
        at.project.notes.splice(at.index, 1);
        at.note.usedAt = now();
        list(at.project, 'used').push(at.note);
        page.persist();
        return ok();
      },

      // Cooked part: moveBetween(id, 'notes') ("Move back"); Served part: sendBackFromFinal()
      sendBack(noteId) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        if (at.list === 'used') {
          checkpoint('Move back');
          at.project.used.splice(at.index, 1);
          list(at.project, 'notes').push(at.note); // to the bottom of Cooking
          delete at.project.notesCollapsed;
          settleCooked(at.project);
        } else if (at.list === 'combined') {
          checkpoint('Send back to Cooked');
          at.project.combined.splice(at.index, 1);
          list(at.project, 'used').push(at.note);
        } else {
          return fail('in Cooking');
        }
        page.persist();
        return ok({ to: at.list === 'used' ? 'notes' : 'used' });
      },

      // moveAugmentedToFinal()
      serveCooked(projectId) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        const used = list(p, 'used');
        if (!used.length) return fail('Cooked is empty');
        const cc = isClaudeCode(p);
        checkpoint(cc ? 'Serve as Claude Code' : 'Move to Served');
        const t = now();
        if (cc) {
          // What is served is the formatted text, as one note carrying all the pictures.
          list(p, 'combined').push(Object.assign(makeNote(cookedText(p), clone(stageImages(used)), newId, now), { usedAt: t }));
        } else {
          for (const n of used) n.usedAt = t;
          list(p, 'combined').push(...used);
        }
        p.used = [];
        settleCooked(p);
        page.persist();
        return ok();
      },

      // dragEnd() within a list ("Reorder"), and movePart() on a Cooked or Served row
      reorderNote(noteId, toIndex) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        if (!Number.isInteger(toIndex)) return fail('bad index');
        const arr = at.project[at.list];
        const j = Math.max(0, Math.min(toIndex, arr.length - 1));
        if (j === at.index) return same();
        checkpoint('Reorder');
        arr.splice(at.index, 1);
        arr.splice(j, 0, at.note);
        page.persist();
        return ok();
      },

      // saveStageEdit() without a partId. `images` undefined keeps the stage's pictures; `openedIds`
      // (the parts the editor was opened with) defaults to every part now in the stage.
      editStage(projectId, list_, text, images, openedIds) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        if (list_ !== 'used' && list_ !== 'combined') return fail('bad list');
        const arr = list(p, list_);
        if (!arr.length) return fail('empty stage');
        const value = cleanText(text);
        if (value === null) return fail('bad text');
        const openSet = new Set(Array.isArray(openedIds) ? openedIds : arr.map((n) => n.id));
        const opened = arr.filter((n) => openSet.has(n.id));
        const arrived = arr.filter((n) => !openSet.has(n.id));
        const openedImages = opened.flatMap((n) => n.images || []);
        const imgs = images === undefined ? clone(openedImages) : takeImages(images);
        if (!value && !imgs.length) return fail('empty');
        // Saved unchanged: keep the separate parts as they are.
        if (joined(opened) === value && imageKey(openedImages) === imageKey(imgs)) return same();
        checkpoint(`Edit ${STAGE_NAME[list_]}`);
        const note = Object.assign(makeNote(value, imgs, newId, now), { usedAt: now() });
        p[list_] = [note].concat(arrived);
        page.persist();
        return ok({ id: note.id });
      },

      // deleteStageText()
      deleteStage(projectId, list_, openedIds) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        if (list_ !== 'used' && list_ !== 'combined') return fail('bad list');
        const arr = list(p, list_);
        const openSet = new Set(Array.isArray(openedIds) ? openedIds : arr.map((n) => n.id));
        if (!arr.some((n) => openSet.has(n.id))) return fail('empty stage');
        checkpoint(`Delete ${STAGE_WHOLE[list_]}`);
        p[list_] = arr.filter((n) => !openSet.has(n.id));
        settleCooked(p);
        page.persist();
        return ok();
      },

      // clearStage()
      clearList(projectId, list_) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        if (list_ !== 'used' && list_ !== 'combined') return fail('bad list');
        if (!list(p, list_).length) return same();
        checkpoint(`Clear ${STAGE_NAME[list_]}`);
        p[list_] = [];
        settleCooked(p);
        page.persist();
        return ok();
      },

      // setHighlight()
      highlight(noteId, color) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        const hl = color == null ? null : color;
        if (hl !== null && !HIGHLIGHTS.includes(hl)) return fail('bad highlight');
        if ((at.note.highlight == null ? null : at.note.highlight) === hl) return same();
        checkpoint(hl ? 'Highlight' : 'Remove highlight');
        if (hl) at.note.highlight = hl;
        else delete at.note.highlight;
        page.persist();
        return ok();
      },

      // copyNote() / toggleSelect(): a copy is never a content change
      copied(noteId, n = 1) {
        const at = locate(noteId);
        if (!at) return fail('no note');
        const by = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
        at.note.copied = (at.note.copied || 0) + by;
        at.note.lastCopiedAt = now();
        page.persist();
        return ok();
      },

      // copyAugmented() / copyFinal() count nothing and save nothing
      copiedStage(projectId, list_) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        if (list_ !== 'used' && list_ !== 'combined') return fail('bad list');
        return ok({ changed: false });
      },

      // createProject() (plus an optional group, joined as setGroup() would)
      addProject(name = 'New project', opts = {}) {
        const o = isObj(opts) ? opts : {};
        const value = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'New project';
        checkpoint('New project');
        const board = boardProjects();
        const taken = new Set(board.map((p) => p.color));
        const color = typeof o.color === 'string' && o.color
          ? o.color
          : (PALETTE.find((c) => !taken.has(c.id)) || PALETTE[board.length % PALETTE.length]).id;
        const project = { id: newId(), name: value, color, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: now(), notes: [], used: [], combined: [] };
        const group = typeof o.group === 'string' ? o.group.trim().slice(0, 60) : '';
        let order = board.concat(project);
        if (group) {
          project.group = group;
          const members = board.filter((p) => groupOf(p) === group);
          if (members.length) {
            order = board.slice();
            order.splice(order.indexOf(members[members.length - 1]) + 1, 0, project);
          }
        }
        setBoardOrder(order);
        page.persist();
        return ok({ id: project.id, color });
      },

      // startRename() finish
      renameProject(id, name) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        const value = typeof name === 'string' ? name.trim().slice(0, 80) : '';
        if (!value) return fail('empty name');
        if (value === p.name) return same();
        checkpoint('Rename project');
        p.name = value;
        page.persist();
        return ok();
      },

      // the ⋯ menu's swatches
      recolorProject(id, color) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        if (typeof color !== 'string' || !color) return fail('bad color');
        if (p.color === color) return same();
        checkpoint('Change color');
        p.color = color;
        page.persist();
        return ok();
      },

      // deleteProject()
      deleteProject(id) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        checkpoint('Delete project');
        projects().splice(projects().indexOf(p), 1);
        page.persist();
        return ok();
      },

      // columnDragEnd() without a group change ("Reorder projects"). toIndex is in drawn order: the
      // order view() lists, where a group's columns stand together where its first one is.
      moveProject(id, toIndex) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        if (!Number.isInteger(toIndex)) return fail('bad index');
        const drawn = drawnOrder();
        const from = drawn.indexOf(p);
        const next = drawn.slice();
        next.splice(from, 1);
        next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, p);
        const before = boardProjects();
        if (next.every((q, i) => q === before[i])) return same();
        checkpoint('Reorder projects');
        setBoardOrder(next);
        page.persist();
        return ok();
      },

      // setMinimized(): synced, not undoable
      setMinimized(id, on) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        const want = Boolean(on);
        if (isMinimized(p) === want) return same();
        if (want) p.minimized = true;
        else delete p.minimized;
        delete p.localMinimized;
        page.markContent(want ? 'Minimize column' : 'Open column');
        page.persist();
        return ok();
      },

      // setGroup(): a name joins (or makes) that group, at its end; null or '' takes the column out
      setGroup(id, name) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        const value = typeof name === 'string' ? name.trim().slice(0, 60) : '';
        if (name != null && typeof name !== 'string') return fail('bad name');
        if (groupOf(p) === value) return same();
        checkpoint(value ? 'Move to group' : 'Remove from group');
        if (value) p.group = value;
        else delete p.group;
        const members = projects().filter((q) => q !== p && isObj(q) && groupOf(q) === value);
        if (value && members.length) {
          const all = projects();
          all.splice(all.indexOf(p), 1);
          all.splice(all.indexOf(members[members.length - 1]) + 1, 0, p);
        }
        page.persist();
        return ok({ group: value || null });
      },

      // newGroupFrom(): ⋯ › New group… ("Important", then "Group 2", …)
      newGroup(id) {
        if (!findBoardProject(id)) return fail('no project');
        const taken = new Set(groupNames());
        let name = 'Important';
        if (taken.has(name)) for (let i = 2; ; i++) if (!taken.has(`Group ${i}`)) { name = `Group ${i}`; break; }
        return actions.setGroup(id, name);
      },

      // renameGroup(): renaming into another group's name merges them; the fold follows the name
      renameGroup(from, to) {
        if (typeof from !== 'string' || typeof to !== 'string') return fail('bad name');
        const value = to.trim().slice(0, 60);
        if (!value) return fail('empty name');
        const members = boardProjects().filter((p) => groupOf(p) === from);
        if (!members.length) return fail('no group');
        if (value === from) return same();
        checkpoint('Rename group');
        for (const p of members) p.group = value;
        const folded = foldedGroups();
        const next = folded.filter((g) => g !== from);
        if (folded.includes(from) && !next.includes(value)) next.push(value);
        if (next.length) prefs().foldedGroups = next;
        else delete prefs().foldedGroups;
        page.persist();
        return ok();
      },

      // ungroup(): the columns stay where they are
      ungroup(name) {
        const members = boardProjects().filter((p) => groupOf(p) === name);
        if (!members.length) return fail('no group');
        checkpoint('Ungroup');
        for (const p of members) delete p.group;
        const folded = foldedGroups();
        if (folded.includes(name)) {
          const next = folded.filter((g) => g !== name);
          if (next.length) prefs().foldedGroups = next;
          else delete prefs().foldedGroups;
        }
        page.persist();
        return ok();
      },

      // moveGroup(): the whole group steps past its neighbour (a column or another group)
      moveGroup(name, delta) {
        const units = boardLayout();
        const i = units.findIndex((u) => u.group === name);
        if (i < 0) return fail('no group');
        const j = i + (delta < 0 ? -1 : 1);
        if (j < 0 || j >= units.length) return same();
        checkpoint('Move group');
        const t = units[i];
        units[i] = units[j];
        units[j] = t;
        setBoardOrder(units.flatMap((u) => u.projects));
        page.persist();
        return ok();
      },

      // setClaudeCode()
      setCookedFormat(id, format) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        if (format != null && format !== 'claude-code') return fail('bad format');
        const on = format === 'claude-code';
        if (!list(p, 'used').length) return fail('Cooked is empty');
        if (isClaudeCode(p) === on) return same();
        checkpoint(on ? 'Format for Claude Code' : 'Back to original');
        if (on) p.cookedFormat = 'claude-code';
        else delete p.cookedFormat;
        page.persist();
        return ok();
      },

      // setEating(id, true): synced, not undoable
      startEating(id) {
        return setEating(id, true);
      },

      // ⋯ › Stop eating, keep it in Served: setEating(id, false)
      stopEating(id) {
        return setEating(id, false);
      },

      // finishEating(): the Served text becomes one round in Eaten; with nothing served it just stops
      doneEating(id) {
        const p = findBoardProject(id);
        if (!p) return fail('no project');
        const served = list(p, 'combined');
        const text = joined(served);
        const images = stageImages(served);
        if (!text && !images.length) {
          const r = setEating(id, false);
          return r.ok ? ok({ round: null, changed: r.changed }) : r;
        }
        checkpoint('Done eating', { restore: ['eating'] });
        const round = {
          id: newId(), project: p.id, name: p.name, color: p.color, text, images: clone(images),
          parts: served.length, startedAt: isEating(p) ? p.eating : 0, doneAt: now(),
        };
        setEatenList([round].concat(eatenList()));
        p.combined = [];
        delete p.eating;
        page.persist();
        return ok({ round: round.id });
      },

      // serveAgain(): appended as one note to its column's Served, and out of Eaten
      serveAgain(roundId) {
        const round = eatenList().find((r) => r.id === roundId);
        if (!round) return fail('no round');
        const p = findProject(round.project);
        if (!p) return fail('column deleted');
        checkpoint('Serve again');
        list(p, 'combined').push(Object.assign(makeNote(round.text, cleanImages(clone(round.images)), newId, now), { usedAt: now() }));
        setEatenList(eatenList().filter((r) => r.id !== roundId));
        page.persist();
        return ok();
      },

      // deleteEaten()
      deleteEaten(roundId) {
        if (!eatenList().some((r) => r.id === roundId)) return fail('no round');
        checkpoint('Delete from Eaten');
        setEatenList(eatenList().filter((r) => r.id !== roundId));
        page.persist();
        return ok();
      },

      // The notepad page. As in app.js the hidden project is made by the first text typed into an
      // empty notepad, so this returns nulls until then; notepad({ create: true }) makes it now.
      notepad(opts) {
        const at = notepadPage();
        if (at) return ok({ projectId: at.project.id, noteId: at.note.id });
        if (!(isObj(opts) && opts.create)) return ok({ projectId: null, noteId: null });
        const made = ensureNotepad();
        page.markContent(null);
        page.persist();
        return ok({ projectId: made.project.id, noteId: made.note.id });
      },

      // notepadInput() + saveNotepadNow(): the text goes in as typed (never trimmed), outside the
      // board's undo; a synced content change with no undo label. The host may debounce calls.
      setNotepadText(text) {
        if (typeof text !== 'string') return fail('bad text');
        let at = notepadPage();
        if (!at) {
          if (!text) return same();
          at = ensureNotepad();
        }
        if (at.note.text === text) return same();
        at.note.text = text;
        at.note.updatedAt = now();
        delete at.note.syncConflict; // the page as typed here is the page
        page.markContent(null);
        page.persist();
        return ok({ projectId: at.project.id, noteId: at.note.id });
      },

      // closeComposer(): the new-text editor's draft (per computer, not content)
      setDraft(projectId, text, images = []) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        if (typeof text !== 'string') return fail('bad text');
        p.draft = text;
        p.draftImages = takeImages(images);
        page.persist();
        return ok();
      },

      // Settings › Join notes with: the one synced preference, not undoable
      setJoiner(value) {
        if (value !== 'blank' && value !== 'line') return fail('bad joiner');
        if (prefs().joiner !== value) {
          page.markContent('Join setting');
          prefs().joiner = value;
        } else {
          return same();
        }
        page.persist();
        return ok();
      },

      // sortOldestFirst()
      sortPrompts(projectId) {
        const p = findBoardProject(projectId);
        if (!p) return fail('no project');
        const notes = list(p, 'notes');
        if (notes.length < 2 || isOldestFirst(notes)) return same();
        checkpoint('Sort prompts');
        p.notes = notes.slice().sort((a, b) => a.createdAt - b.createdAt);
        page.persist();
        return ok();
      },

      undo() {
        return step(history.undo, history.redo, 'Undo');
      },

      redo() {
        return step(history.redo, history.undo, 'Redo');
      },

      // The host calls this when a sync patch changes content (app.js: page.history = 0).
      clearHistory() {
        history.undo.length = 0;
        history.redo.length = 0;
        return ok();
      },
    };

    function setEating(id, on) {
      const p = findBoardProject(id);
      if (!p) return fail('no project');
      if (isEating(p) === on) return same();
      if (on) p.eating = now();
      else delete p.eating;
      page.markContent(on ? 'Eating' : 'Done eating');
      page.persist();
      return ok();
    }

    const isOldestFirst = (notes) => notes.every((n, i) => i === 0 || notes[i - 1].createdAt <= n.createdAt);

    const foldedGroups = () => (Array.isArray(prefs().foldedGroups) ? prefs().foldedGroups.filter((g) => typeof g === 'string') : []);

    // app.js boardLayout(): a group stands where its first member is.
    function boardLayout() {
      const units = [];
      const byGroup = new Map();
      for (const p of boardProjects()) {
        const g = groupOf(p);
        if (!g) units.push({ group: null, projects: [p] });
        else if (byGroup.has(g)) byGroup.get(g).projects.push(p);
        else {
          const unit = { group: g, projects: [p] };
          byGroup.set(g, unit);
          units.push(unit);
        }
      }
      return units;
    }
    const drawnOrder = () => boardLayout().flatMap((u) => u.projects);
    const groupNames = () => boardLayout().filter((u) => u.group).map((u) => u.group);

    // The page is the first note of the first notepad project; other notes in one are other versions.
    function notepadPage() {
      for (const p of projects()) if (isObj(p) && isNotepad(p) && list(p, 'notes')[0]) return { project: p, note: p.notes[0] };
      return null;
    }
    function ensureNotepad() {
      const t = now();
      const note = { id: newId(), text: '', images: [], createdAt: t, updatedAt: t, copied: 0, lastCopiedAt: 0, usedAt: 0 };
      let project = projects().find((p) => isObj(p) && isNotepad(p));
      if (!project) {
        project = { id: newId(), name: 'Notepad', color: 'slate', notepad: true, usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], createdAt: t, notes: [], used: [], combined: [] };
        projects().push(project);
      }
      list(project, 'notes').unshift(note);
      return { project, note };
    }

    // ---- search (app.js parseQuery / matches: every space-separated term, case-insensitive)

    function search(query) {
      const terms = typeof query === 'string' ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
      if (!terms.length) return [];
      const out = [];
      for (const p of drawnOrder()) {
        for (const l of LISTS) {
          for (const n of list(p, l)) {
            if (!n || typeof n.text !== 'string') continue;
            const text = n.text.toLowerCase();
            if (terms.every((t) => text.includes(t))) out.push({ projectId: p.id, list: l, noteId: n.id, text: n.text });
          }
        }
      }
      return out;
    }

    // ---- the view model Swift draws

    const num = (v) => (Number.isFinite(v) ? v : 0);
    const imageView = (images) => (Array.isArray(images) ? images : [])
      .filter((i) => i && typeof i.id === 'string')
      .map((i) => ({ id: i.id, w: Number(i.w) || 0, h: Number(i.h) || 0 }));
    const noteView = (n) => ({
      id: n.id,
      text: n.text,
      images: imageView(n.images),
      copied: num(n.copied),
      lastCopiedAt: num(n.lastCopiedAt),
      highlight: typeof n.highlight === 'string' ? n.highlight : null,
      conflict: isObj(n.syncConflict)
        ? { device: typeof n.syncConflict.device === 'string' ? n.syncConflict.device : null, at: Number.isFinite(n.syncConflict.at) ? n.syncConflict.at : null }
        : null,
      createdAt: num(n.createdAt),
      updatedAt: num(n.updatedAt),
      usedAt: num(n.usedAt),
    });
    const notesOf = (p, l) => list(p, l).filter((n) => n && typeof n.text === 'string');

    function view() {
      const top = (stack) => stack[stack.length - 1] || null;
      const u = top(history.undo);
      const r = top(history.redo);
      let noteCount = 0;
      const shown = drawnOrder().map((p) => {
        const notes = notesOf(p, 'notes');
        const used = notesOf(p, 'used');
        const combined = notesOf(p, 'combined');
        noteCount += notes.length + used.length + combined.length;
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          group: groupOf(p) || null,
          minimized: isMinimized(p),
          eating: isEating(p) ? p.eating : null,
          cookedFormat: typeof p.cookedFormat === 'string' ? p.cookedFormat : null,
          notes: notes.map(noteView),
          cooked: { text: cookedText(p), parts: used.map(noteView), images: imageView(stageImages(used)) },
          served: { text: joined(combined), parts: combined.map(noteView), images: imageView(stageImages(combined)) },
          draft: typeof p.draft === 'string' ? p.draft : '',
          draftImages: imageView(p.draftImages),
        };
      });
      const pad = notepadPage();
      return {
        joiner: prefs().joiner === 'line' ? 'line' : 'blank',
        undo: { can: Boolean(u), label: u ? u.label : null },
        redo: { can: Boolean(r), label: r ? r.label : null },
        projects: shown,
        notepad: pad ? { projectId: pad.project.id, noteId: pad.note.id, text: pad.note.text } : null,
        eaten: eatenList().map((round) => {
          const live = findProject(round.project);
          return {
            id: round.id,
            project: round.project,
            name: live ? live.name : (typeof round.name === 'string' ? round.name : 'Deleted column'),
            color: live ? live.color : round.color,
            text: round.text,
            startedAt: num(round.startedAt),
            doneAt: num(round.doneAt),
            images: imageView(cleanImages(round.images)),
            parts: Number(round.parts) || 1,
            alive: Boolean(live),
          };
        }),
        counts: { projects: shown.length, notes: noteCount },
      };
    }

    // Every action answers; none throws into the host.
    const board = {};
    for (const name of Object.keys(actions)) {
      board[name] = function () {
        try {
          if (!isObj(D())) return fail('no data');
          return actions[name].apply(null, arguments);
        } catch (err) {
          return fail(String((err && err.message) || err));
        }
      };
    }
    board.search = (query) => {
      try { return isObj(D()) ? search(query) : []; } catch (err) { return []; }
    };
    board.view = () => (isObj(D()) ? view() : {
      joiner: 'blank', undo: { can: false, label: null }, redo: { can: false, label: null },
      projects: [], notepad: null, eaten: [], counts: { projects: 0, notes: 0 },
    });
    return board;
  }

  return { createBoard, normalize, seedData, PALETTE, claudeCodeText, HISTORY_LIMIT, EATEN_MAX };
});
