'use strict';
// src/renderer/account.js, Settings › Account & sync, in plain Node: the script runs in a vm over a small DOM (enough
// for its templates: elements, attributes, text, the selectors it uses, click, input and keydown) with a stand-in
// for window.recaller, whose calls the test answers. Checked: what the page shows while a sign-out or an account
// deletion first saves the full-size pictures here (ai_memory/15, 6.2), the toasts after a sign-out, the deletion
// that fails while saving ("Nothing was deleted…", never "Finishing account deletion…"), and the 60 s waits of
// [Send link] and "Change password" (2.7). Every string names this Mac or this PC (6.9).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../src/renderer/account.js'), 'utf8');

// ---- a small DOM

const VOID = new Set(['INPUT', 'BR', 'IMG', 'HR', 'META', 'LINK']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

class Text {
  constructor(text) {
    this.nodeType = 3;
    this.text = text;
    this.parent = null;
  }

  get textContent() { return this.text; }
}

class El {
  constructor(doc, tag, attrs = []) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(attrs);
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.value = this.attrs.get('value') ?? '';
    this.checked = this.attrs.has('checked');
    const el = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? el.attrs.get(`data-${kebab(k)}`) : undefined),
      set: (_, k, v) => { el.attrs.set(`data-${kebab(k)}`, String(v)); return true; },
    });
    this.classList = {
      contains: (c) => (el.attrs.get('class') || '').split(/\s+/).includes(c),
      toggle(c, force) {
        const list = (el.attrs.get('class') || '').split(/\s+/).filter(Boolean);
        const on = force === undefined ? !list.includes(c) : Boolean(force);
        el.attrs.set('class', [...list.filter((x) => x !== c), ...(on ? [c] : [])].join(' '));
        return on;
      },
    };
  }

  flag(name, on) { if (on) this.attrs.set(name, ''); else this.attrs.delete(name); }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { this.flag('hidden', v); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { this.flag('disabled', v); }
  get id() { return this.attrs.get('id') || ''; }
  get name() { return this.attrs.get('name') || ''; }
  get type() { return this.attrs.get('type') || (this.tagName === 'INPUT' ? 'text' : ''); }
  set type(v) { this.attrs.set('type', String(v)); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) {
    this.children = [];
    if (String(v)) this.append(new Text(String(v)));
  }

  set innerHTML(html) {
    this.children = [];
    for (const c of parse(this.ownerDocument, String(html))) this.append(c);
  }

  append(c) {
    c.parent = this;
    this.children.push(c);
  }

  * all() {
    for (const c of this.children) {
      if (c.nodeType !== 1) continue;
      yield c;
      yield* c.all();
    }
  }

  querySelectorAll(sel) { const m = matcher(sel); return [...this.all()].filter(m); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    const m = matcher(sel);
    for (let e = this; e && e.nodeType === 1; e = e.parent) if (m(e)) return e;
    return null;
  }

  contains(node) {
    for (let e = node; e; e = e.parent) if (e === this) return true;
    return false;
  }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(ev) {
    ev.target ||= this;
    for (let e = this; e && !ev.stopped; e = e.parent) for (const fn of e.listeners[ev.type] || []) fn(ev);
  }

  click() { if (!this.disabled) this.dispatchEvent(event('click')); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}

function event(type, extra = {}) {
  return { type, bubbles: true, isComposing: false, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...extra };
}

// Selectors: a comma list of compounds (tag, [attr], [attr="v"], .class, #id), no combinators.
function matcher(sel) {
  const parts = sel.split(',').map((s) => s.trim()).map((s) => {
    const m = /^([a-zA-Z][\w-]*)?((?:\[[\w-]+(?:="[^"]*")?\]|\.[\w-]+|#[\w-]+)*)$/.exec(s);
    if (!m) throw new Error(`selector not supported here: ${s}`);
    const tag = m[1]?.toUpperCase();
    const tests = [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]|\.([\w-]+)|#([\w-]+)/g)].map((t) => {
      if (t[1]) return (e) => e.attrs.has(t[1]) && (t[2] === undefined || e.attrs.get(t[1]) === t[2]);
      if (t[3]) return (e) => e.classList.contains(t[3]);
      return (e) => e.id === t[4];
    });
    return (e) => (!tag || e.tagName === tag) && tests.every((x) => x(e));
  });
  return (e) => parts.some((p) => p(e));
}

function parse(doc, html) {
  const root = new El(doc, 'root');
  let cur = root;
  const re = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      const tag = m[1].toUpperCase();
      let e = cur;
      while (e !== root && e.tagName !== tag) e = e.parent;
      if (e !== root) cur = e.parent;
    } else if (m[2]) {
      const attrs = [...m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
        .map((a) => [a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? '')]);
      const el = new El(doc, m[2], attrs);
      cur.append(el);
      if (!m[4] && !VOID.has(el.tagName)) cur = el;
    } else if (m[5]) {
      cur.append(new Text(decode(m[5])));
    }
  }
  for (const c of root.children) c.parent = null;
  return root.children;
}

class Doc {
  constructor() {
    this.body = new El(this, 'body');
    this.activeElement = this.body;
  }

  getElementById(id) {
    for (const e of this.body.all()) if (e.id === id) return e;
    return null;
  }
}

// ---- the page, with main stood in for

const T0 = Date.parse('2026-10-01T12:00:00.000Z');
const SIGNED_OUT = { enabled: true, state: 'signed-out' };
const signedIn = (extra = {}) => ({
  enabled: true, state: 'signed-in', email: 'owner@example.com', keyStore: 'test',
  sync: { phase: 'synced', pending: 0, lastSyncedAt: T0, tooLarge: 0, quarantined: 0, tooLargePictures: 0 },
  choice: null, devices: [{ id: 'd1', name: 'Mac', platform: 'darwin', lastSeenAt: 0, current: true }],
  counts: { projects: 1, notes: 2, pictures: 3 }, deleting: null, ...extra,
});

function boot({ platform = 'darwin', state = SIGNED_OUT } = {}) {
  const doc = new Doc();
  const box = new El(doc, 'section', [['id', 'account'], ['hidden', '']]);
  doc.body.append(box);
  doc.body.append(new El(doc, 'button', [['id', 'sync-status'], ['hidden', '']]));
  const clock = { t: T0 };
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.t); }
    static now() { return clock.t; }
  }
  const page = { box, clock, state, calls: [], toasts: [], shown: [], answers: new Map(), changed: null };
  const call = (op) => (...args) => {
    page.calls.push(JSON.parse(JSON.stringify([op, ...args]))); // out of the vm's realm
    return new Promise((resolve) => page.answers.set(op, resolve));
  };
  const recaller = {
    platform,
    account: {
      get: async () => page.state,
      onChanged: (fn) => { page.changed = fn; return () => {}; },
      signUp: call('sign-up'), signIn: call('sign-in'), resendVerification: call('resend'), checkVerified: call('check'),
      discardUnverified: call('discard'), resetPassword: call('reset'), signOut: call('sign-out'), deleteAccount: call('delete'),
    },
    sync: { now: async () => null, choose: async () => ({ ok: true }) },
  };
  const storage = new Map();
  const ctx = {
    document: doc, recaller, ICONS: {}, RecallerUI: { toast: (text) => page.toasts.push(text) },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    setTimeout, clearTimeout, setInterval, clearInterval, console, Date: FakeDate, addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'src/renderer/account.js' });

  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
  const seen = () => page.shown.push(norm(box.textContent)); // everything the section showed, for the Mac fence
  Object.assign(page, {
    settle,
    view: () => box.dataset.view,
    text: () => norm(box.textContent),
    slot: (name) => { const n = box.querySelector(`[data-slot="${name}"]`); return n && !n.hidden ? norm(n.textContent) : ''; },
    button: (action) => box.querySelectorAll(`[data-action="${action}"]`).find((b) => !b.hidden) || null,
    look: (action) => { const b = page.button(action); return b ? { label: norm(b.textContent), disabled: b.disabled } : null; },
    click(action) {
      const b = page.button(action);
      assert.ok(b && !b.disabled, `[${action}] can be clicked in view ${page.view()} (${page.text().slice(0, 120)})`);
      b.click();
      seen();
    },
    type(name, value) {
      const input = box.querySelector(`input[name="${name}"]`);
      assert.ok(input, `input ${name}`);
      input.value = value;
      input.dispatchEvent(event('input'));
    },
    enter(name) { box.querySelector(`input[name="${name}"]`).dispatchEvent(event('keydown', { key: 'Enter' })); },
    push(next) { // account:changed from main
      page.state = next;
      page.changed(next);
      seen();
    },
    repaint() { page.push(page.state); }, // what the 1 s ticker does while Settings is open
    async answer(op, res) {
      const resolve = page.answers.get(op);
      assert.ok(resolve, `a ${op} call waits for its answer`);
      page.answers.delete(op);
      resolve(res);
      await settle();
      seen();
    },
  });
  return page;
}

const HERE = { darwin: 'this Mac', win32: 'this PC' };

// Nothing the section or a toast showed calls this computer by the other platform's name (the privacy note's
// "Mac" or "Windows PC" names both on purpose).
function fence(page, platform) {
  const other = platform === 'darwin' ? /this PC|This PC/ : /this Mac|This Mac|Mac’s keychain/;
  for (const text of [...page.shown, ...page.toasts]) assert.doesNotMatch(text, other, `${platform}: ${text.slice(0, 160)}`);
}

// ---- sign-out

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: signing out shows the full-size pictures being saved here, and the toast says what stayed in the account`, async () => {
    const here = HERE[platform];
    const toasts = {
      0: 'Signed out. Your board stays on this computer.',
      1: `Signed out. 1 full-size picture stays in your account, and ${here} keeps its preview. Signing in again brings it here.`,
      3: `Signed out. 3 full-size pictures stay in your account, and ${here} keeps their previews. Signing in again brings them here.`,
    };
    for (const left of [0, 1, 3]) {
      const page = boot({ platform, state: signedIn() });
      await page.settle();
      assert.equal(page.view(), 'in');
      page.click('sign-out');
      assert.equal(page.view(), 'sign-out');
      page.click('sign-out-confirm');
      await page.settle();
      assert.deepEqual(page.calls.at(-1), ['sign-out', { force: false, removeBoard: false, removeUnreadable: false }]);
      page.push(signedIn({ signingOut: { what: 'pictures', done: 1, total: 3 } }));
      assert.equal(page.slot('status'), `Saving full-size pictures to ${here}… 1 of 3`);
      page.push(signedIn({ signingOut: { what: 'pictures', done: 3, total: 3 } }));
      assert.equal(page.slot('status'), `Saving full-size pictures to ${here}… 3 of 3`);
      page.push(SIGNED_OUT); // main signs out before it answers
      await page.answer('sign-out', left ? { ok: true, picturesLeft: left } : { ok: true });
      assert.deepEqual(page.toasts, [toasts[left]]);
      assert.equal(page.view(), 'out');
      fence(page, platform);
    }
  });

  // ---- deleting the account

  test(`${platform}: a deletion that fails while saving the pictures here says nothing was deleted, never "Finishing account deletion…"`, async () => {
    const here = HERE[platform];
    const page = boot({ platform, state: signedIn() });
    await page.settle();
    page.click('delete');
    assert.equal(page.view(), 'delete');
    page.type('password', 'password-1234');
    page.type('confirm-delete', 'DELETE');
    page.click('delete-confirm');
    await page.settle();
    assert.deepEqual(page.calls.at(-1), ['delete', 'password-1234']);
    page.push(signedIn({ deleting: { what: 'save-pictures', done: 0, total: 2 } }));
    assert.equal(page.slot('status'), `Saving full-size pictures to ${here}… 0 of 2`);
    page.push(signedIn({ deleting: { what: 'save-pictures', done: 1, total: 2 } }));
    assert.equal(page.slot('status'), `Saving full-size pictures to ${here}… 1 of 2`);
    page.push(signedIn({ deleting: null })); // main's last state: no deletion to finish
    await page.answer('delete', { ok: false, code: 'NETWORK' });
    assert.equal(page.slot('error'), `Nothing was deleted: not every full-size picture could be saved to ${here} first. Check your connection, then try again.`);
    assert.equal(page.view(), 'delete');
    page.click('cancel');
    page.push(signedIn());
    assert.equal(page.view(), 'in');
    assert.ok(page.shown.every((t) => !t.includes('Finishing account deletion')), 'never "Finishing account deletion…"');
    fence(page, platform);

    // Once something was erased, a failure says so.
    page.click('delete');
    page.type('password', 'password-1234');
    page.type('confirm-delete', 'DELETE');
    page.click('delete-confirm');
    await page.settle();
    page.push(signedIn({ deleting: { what: 'save-pictures', done: 2, total: 2 } }));
    page.push(signedIn({ deleting: { what: 'pictures', done: 1, total: 4 } }));
    assert.equal(page.slot('status'), 'Deleting pictures… 1 of 4');
    page.push(signedIn({ deleting: { what: 'account', done: 0, total: 0 } }));
    await page.answer('delete', { ok: false, code: 'NETWORK' });
    assert.equal(page.slot('error'), 'Deletion stopped partway. Sign in again to finish it.');
    fence(page, platform);
  });
}

// ---- the reset link's wait

test('[Send link] waits 60 s once a link went out, or as long as main says (at most a minute); a failed send starts no wait', async () => {
  const page = boot({ state: SIGNED_OUT });
  await page.settle();
  page.click('sign-in');
  page.click('forgot');
  assert.equal(page.view(), 'forgot');
  page.type('email', 'someone@example.com');

  // reCAPTCHA required: the send failed, so the button can be clicked again at once
  page.click('send-reset');
  await page.settle();
  assert.deepEqual(page.calls.at(-1), ['reset', 'someone@example.com']);
  await page.answer('reset', { ok: false, code: 'RESET_UNAVAILABLE' });
  assert.equal(page.slot('error'), "Recaller can't send a reset link right now. Wait a while, then try again.");
  assert.deepEqual(page.look('send-reset'), { label: 'Send link', disabled: false });

  // a link went out
  page.click('send-reset');
  await page.settle();
  await page.answer('reset', { ok: true });
  assert.equal(page.slot('note'), "If there's an account for someone@example.com, a link is on its way (if it isn't in your inbox, look in Spam). After you change the password, sign in again on each computer.");
  assert.deepEqual(page.look('send-reset'), { label: 'Send link (60 s)', disabled: true });
  const asked = page.calls.length;
  page.enter('email'); // Enter in the email field sends nothing while the button waits
  await page.settle();
  assert.equal(page.calls.length, asked);
  page.clock.t += 59 * 1000;
  page.repaint();
  assert.deepEqual(page.look('send-reset'), { label: 'Send link (1 s)', disabled: true });
  page.clock.t += 1000;
  page.repaint();
  assert.deepEqual(page.look('send-reset'), { label: 'Send link', disabled: false });

  // main still holds this email for 40 s (another window, or a reload)
  page.click('send-reset');
  await page.settle();
  await page.answer('reset', { ok: false, code: 'RESET_UNAVAILABLE', retryAfterMs: 40 * 1000 });
  assert.deepEqual(page.look('send-reset'), { label: 'Send link (40 s)', disabled: true });
  page.clock.t += 40 * 1000;
  page.repaint();
  page.click('send-reset');
  await page.settle();
  await page.answer('reset', { ok: false, code: 'RESET_UNAVAILABLE', retryAfterMs: 60 * 60 * 1000 });
  assert.deepEqual(page.look('send-reset'), { label: 'Send link (60 s)', disabled: true }, 'never more than a minute');
});

test('"Change password" waits 60 s once the link went out', async () => {
  const page = boot({ state: signedIn() });
  await page.settle();
  page.click('change-password');
  await page.settle();
  assert.deepEqual(page.calls.at(-1), ['reset', 'owner@example.com']);
  await page.answer('reset', { ok: true });
  assert.equal(page.slot('note'), "We emailed owner@example.com a link to set a new password (if it isn't in your inbox, look in Spam). After you change it, sign in again on each computer.");
  assert.deepEqual(page.look('change-password'), { label: 'Change password (60 s)', disabled: true });
  page.clock.t += 60 * 1000;
  page.repaint();
  assert.deepEqual(page.look('change-password'), { label: 'Change password', disabled: false });
});
