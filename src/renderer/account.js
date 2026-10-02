'use strict';
// Settings › Account & sync, the first-sync choice panels and the top-bar sync indicator (1.17).
// Main makes every network call: this page only sees AccountState and Results, never a token.
// Strings and the DOM contract: ai_memory/15_accounts_and_sync.md §6.
(() => {
  const api = window.recaller;
  const acct = api?.account;
  const box = document.getElementById('account');
  if (!box || !acct) return;
  const syncApi = api.sync;
  const I = window.ICONS || {};
  const head = document.getElementById('account-head');
  const helpLine = document.getElementById('help-account');
  const indicator = document.getElementById('sync-status');
  const settings = document.getElementById('settings');

  // Every Mac difference goes through IS_MAC (§6.9).
  const IS_MAC = api.platform === 'darwin';
  const HERE = IS_MAC ? 'this Mac' : 'this PC';
  const HERE_CAP = IS_MAC ? 'This Mac' : 'This PC';

  const PRIVACY_VERSION = '2026-10-01';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const RESEND_MS = 60_000;
  const SYNCING_QUIET_MS = 1500;   // a quick sync never shows the indicator
  const OFFLINE_QUIET_MS = 60_000;
  const VERIFY_POLL_MS = 30_000;
  const VERIFY_POLL_FOR_MS = 10 * 60_000;
  const VERIFY_FOCUS_MS = 10_000;
  const TOAST_MS = 7000;
  const REMOVED_FLAG = 'recaller.boardRemoved'; // sessionStorage: main reloads the page after removing the board
  const REMOVED_TOAST = 'Signed out. This board was removed from this computer; your account keeps it.';
  const CHOICES = new Set(['first-upload', 'first-merge', 'mass-delete', 'account-gone']);
  const ANSWERS = {
    'choice-upload': 'upload', 'choice-combine': 'combine', 'choice-use-account': 'use-account',
    'choice-not-now': 'not-now', 'choice-keep': 'keep', 'choice-delete-everywhere': 'delete-everywhere', retry: 'retry',
  };

  // §6.6, by Result.code. LOCKED_OUT is counted down in paintError().
  const ERRORS = {
    INVALID_EMAIL: "That email address doesn't look right.",
    WEAK_PASSWORD: 'Use at least 8 characters.',
    EMAIL_EXISTS: "There's already an account with this email.",
    WRONG_PASSWORD: 'Email or password is wrong.',
    USER_DISABLED: 'This account has been turned off.',
    TOO_MANY_ATTEMPTS: 'Too many tries from this network. Wait a few minutes, then try again.',
    SIGNUP_PAUSED: 'New accounts are paused right now. Try again later.',
    RESET_UNAVAILABLE: "Recaller can't send a reset link right now. Wait a while, then try again.",
    NETWORK: "Can't reach Recaller's cloud. Check your internet connection.",
    NOT_VERIFIED: 'Not verified yet. The email can take a minute; check your spam folder too.',
  };
  const UNAVAILABLE = "Accounts aren't available right now. Try again later.";

  let st = { enabled: false, state: 'signed-out' }; // the last AccountState from main
  const ui = {
    view: 'idle',          // what the person opened: idle | create | sign-in | forgot | sign-out | delete
    after: null,           // { state, view, focus }: the view to open when main reports that state
    email: '',             // typed email, kept between the forms (never the password)
    showPassword: false,
    busy: '',              // the account operation in flight
    syncBusy: false,
    error: null,           // { text, signIn? } or { code: 'LOCKED_OUT', until }
    note: null,            // { text, tone }
    focus: '',             // a field to focus after the next render
    resendUntil: 0,
    resetUntil: 0,         // "Send link" and "Change password" wait 60 s after a reset link went out (§2.7)
    pending: 0,            // sign-out panel: changes waiting
    removeBoard: false,
    unreadable: 0,         // sign-out panel: copies of an unreadable notes file main named; the checkbox names them too
    dismissedChoice: '',   // "Not now" hides that choice until Settings closes
    deleteResume: false,   // the delete panel asks only for the password (the deletion already started)
    resumeDismissed: false,
    deleteStarted: false,  // the deletion erased something (or resumes one that did)
    deleteSaving: false,   // it was still saving the full-size pictures here, so nothing was erased yet
    expectUpload: false,
  };
  const since = { syncing: 0, offline: 0 };
  let built = '';

  // ---- small helpers

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const plural = (count, word) => {
    const k = Math.max(0, Math.floor(Number(count) || 0));
    return `${k} ${word}${k === 1 ? '' : 's'}`;
  };
  const validEmail = (s) => s.length <= 254 && EMAIL_RE.test(s);
  const slot = (name) => box.querySelector(`[data-slot="${name}"]`);
  const field = (name) => box.querySelector(`input[name="${name}"]`);
  const fieldValue = (name) => field(name)?.value || '';
  const emailValue = () => (field('email')?.value ?? ui.email).trim();

  function setText(name, text) {
    const node = slot(name);
    if (!node) return null;
    if (node.textContent !== text) node.textContent = text;
    node.hidden = !text;
    return node;
  }

  function setLabel(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  // app.js's relTime, for when window.RecallerUI isn't there.
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

  function rel(ts) {
    const fn = window.RecallerUI?.relTime;
    try { return typeof fn === 'function' ? fn(ts) : relTime(ts); } catch { return relTime(ts); }
  }

  function toast(message) {
    const fn = window.RecallerUI?.toast;
    if (typeof fn !== 'function') return;
    try { fn(message, { duration: TOAST_MS }); } catch (err) { console.error('[account]', err); }
  }

  // "your Mac", "your other PC", … from a DeviceRef (§6.5).
  function deviceName(ref) {
    if (ref?.platform === 'darwin') return ref.sameAsThis ? 'your other Mac' : 'your Mac';
    if (ref?.platform === 'win32') return ref.sameAsThis ? 'your other PC' : 'your Windows PC';
    return 'another computer';
  }

  // "15 s" or "5 min" until an automatic retry.
  function untilText(at, now) {
    const s = Math.ceil(((Number(at) || 0) - now) / 1000);
    if (!(s > 0)) return 'a moment';
    return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
  }

  function flag(set) {
    try {
      if (set) { sessionStorage.setItem(REMOVED_FLAG, '1'); return true; }
      const was = sessionStorage.getItem(REMOVED_FLAG) === '1';
      sessionStorage.removeItem(REMOVED_FLAG);
      return was;
    } catch {
      return false;
    }
  }

  // ---- status texts (§6.2, §6.4)

  // tooLargePictures isn't in SyncStatus (yet); it's read when main sends it.
  function tooLargeText(sync) {
    const notes = Number(sync?.tooLarge) || 0;
    const pictures = Number(sync?.tooLargePictures) || 0;
    const out = [];
    if (notes > 1) out.push(`${notes} notes are too large to sync (over 900 KB). They stay on ${HERE}.`);
    else if (notes === 1 || !pictures) out.push(`1 note is too large to sync (over 900 KB). It stays on ${HERE}.`);
    if (pictures > 1) out.push(`${pictures} pictures are too large to sync (over 32 MB).`);
    else if (pictures === 1) out.push('1 picture is too large to sync (over 32 MB).');
    return out.join(' ');
  }

  function pauseCode(sync) {
    if (sync?.error?.code) return sync.error.code;
    if (sync?.tooLarge > 0 || sync?.tooLargePictures > 0) return 'TOO_LARGE';
    return sync?.quarantined > 0 ? 'PERMISSION' : 'UNKNOWN';
  }

  function pausedReason(sync, now) {
    const retryAt = sync?.error?.retryAt;
    switch (pauseCode(sync)) {
      case 'PERMISSION': return `the cloud refused a change. It stays on ${HERE}.`;
      case 'QUOTA': return 'Google Cloud is busy. Recaller will try again in a few minutes.';
      case 'SERVER': return `Google Cloud had a problem. Trying again in ${untilText(retryAt, now)}.`;
      case 'TOO_LARGE': return tooLargeText(sync);
      case 'BAD_REQUEST': return `this version of Recaller hit an error. Your notes are safe on ${HERE}; check for an update.`;
      default: return `something went wrong. Trying again in ${untilText(retryAt, now)}.`;
    }
  }

  function progressText(p) {
    const done = Number(p?.done) || 0;
    const total = Number(p?.total) || 0;
    if (p?.what === 'upload-notes') return `Uploading your board… ${done} of ${total} notes`;
    if (p?.what === 'upload-pictures') return `Uploading pictures… ${done} of ${total}`;
    if (p?.what === 'download-notes') return `Downloading your board… ${done} of ${total} notes`;
    return 'Syncing…';
  }

  // The status line under the email: [text, tone].
  function statusLine(sync, now) {
    if (!sync) return ['', ''];
    const synced = () => [sync.lastSyncedAt ? `Synced · ${rel(sync.lastSyncedAt)}` : 'Synced', 'ok'];
    const n = Math.floor(Number(sync.pending) || 0);
    switch (sync.phase) {
      case 'synced': return synced();
      case 'syncing': return [progressText(sync.progress), ''];
      case 'pending':
        if (n <= 0) return synced();
        return [n === 1 ? '1 change waiting to upload' : `${n} changes waiting to upload`, ''];
      case 'offline': return ["Offline · changes upload when you're back online", ''];
      case 'waiting': return [`Changes from ${deviceName(sync.waitingFor)} will appear when you close the editor.`, ''];
      case 'choosing': return [`Choose how to sync ${HERE}'s board`, 'warn'];
      case 'paused': return [`Sync paused · ${pausedReason(sync, now)}`, 'warn'];
      case 'update-needed': return [`Your account was synced by a newer Recaller. Update Recaller on ${HERE} to keep syncing.`, 'warn'];
      case 'deleting-elsewhere': return ['This account is being deleted on another computer.', 'warn'];
      default: return ['', ''];
    }
  }

  // A refused or too-large item doesn't stop the rest from syncing, so it gets its own line.
  function sideLine(sync) {
    if (!sync || sync.phase === 'paused') return { text: '', retry: false };
    const tooLarge = Number(sync.tooLarge) || 0;
    const refused = Math.max(0, (Number(sync.quarantined) || 0) - tooLarge);
    const out = [];
    if (refused) out.push(`Sync paused · ${pausedReason({ error: { code: 'PERMISSION' } }, 0)}`);
    if (tooLarge || Number(sync.tooLargePictures) > 0) out.push(tooLargeText(sync));
    return { text: out.join(' '), retry: refused > 0 };
  }

  function keptText() {
    if (st.keyStore === 'session') return "This computer can't store your sign-in securely, so you'll sign in again next time you open Recaller.";
    if (st.keyStore === 'keychain' || st.keyStore === 'dpapi' || st.keyStore === 'test') {
      return IS_MAC ? 'Your sign-in is kept in your Mac’s keychain.' : 'Your sign-in is kept encrypted on this PC.';
    }
    return '';
  }

  function devicesText() {
    const others = (Array.isArray(st.devices) ? st.devices : []).filter((d) => d && !d.current);
    if (!others.length) return '';
    const names = others.map((d) => {
      const name = deviceName({ platform: d.platform, sameAsThis: d.platform === api.platform });
      return d.lastSeenAt ? `${name} · ${rel(d.lastSeenAt)}` : name;
    });
    return `Also signed in on: ${names.join(', ')}`;
  }

  function deleteBody() {
    const c = st.counts; // not in AccountState (yet): { projects, notes, pictures } of the account's board
    const what = c && typeof c === 'object'
      ? `${plural(c.projects, 'project')}, ${plural(c.notes, 'note')} and ${plural(c.pictures ?? c.images, 'picture')}`
      : 'its projects, notes and pictures';
    return `This deletes your account and everything in it from Google Cloud: ${what}. ${HERE_CAP} keeps its own copy of the board. Other computers keep theirs but stop syncing. Google's backups of the deleted data expire within 7 days. This can't be undone.`;
  }

  // A sign-out or a deletion first saves here the full-size pictures this computer holds only as previews.
  const savingText = (p) => (Number(p?.total) > 0 ? `Saving full-size pictures to ${HERE}… ${Number(p.done) || 0} of ${Number(p.total)}` : '');

  function deletingText() {
    const d = st.deleting;
    if (!d) return '';
    if (d.what === 'save-pictures') return savingText(d);
    if (d.what === 'pictures') return `Deleting pictures… ${Number(d.done) || 0} of ${Number(d.total) || 0}`;
    if (d.what === 'notes') return `Deleting notes… ${Number(d.done) || 0} of ${Number(d.total) || 0}`;
    return 'Deleting account…';
  }

  // The top-bar indicator (§6.4): null keeps it hidden.
  function indicatorLook(now) {
    if (!st.enabled) return null;
    const attention = (tip, icon = 'cloud') => ({ icon, dot: true, tip });
    switch (st.state) {
      case 'unverified': return attention('Verify your email to start syncing');
      case 'needs-sign-in': return attention('Sign in again to keep syncing');
      case 'deleted':
      case 'disabled': return attention("This account can't sync · click for details");
      case 'signed-in': break;
      default: return null;
    }
    const sync = st.sync || {};
    const n = Number(sync.pending) || 0;
    switch (sync.phase) {
      case 'syncing':
        return now - since.syncing >= SYNCING_QUIET_MS ? { icon: 'cloud', breathe: true, tip: 'Syncing…' } : null;
      case 'offline':
        if (n > 0) return { icon: 'cloudOff', muted: true, tip: `Offline · ${plural(n, 'change')} will upload when you're back online` };
        return now - since.offline >= OFFLINE_QUIET_MS
          ? { icon: 'cloudOff', muted: true, tip: "Offline · changes from your other computers arrive when you're back online" }
          : null;
      case 'waiting': return { icon: 'cloud', tip: `Changes from ${deviceName(sync.waitingFor)} will appear when you close the editor` };
      case 'choosing': return attention(`Choose how to sync ${HERE}'s board`);
      case 'paused': return attention('Sync paused · click for details', 'cloudAlert');
      case 'update-needed': return attention('Update Recaller to keep syncing');
      case 'deleting-elsewhere': return attention("This account can't sync · click for details");
      default: return null; // synced, and pending while online
    }
  }

  // ---- templates. Every button is type="button": Settings is a <form method="dialog">.

  const button = (action, label, kind = 'btn-ghost', extra = '') =>
    `<button type="button" class="btn ${kind}" data-action="${action}"${extra}>${esc(label)}</button>`;
  const link = (action, label, extra = '') =>
    `<button type="button" class="account-link${extra}" data-action="${action}">${esc(label)}</button>`;
  const EMAIL_LINE = '<p class="account-email" data-slot="email" hidden></p>';
  const MESSAGES = '<p class="help account-note" data-slot="note" hidden></p><p class="help bad account-error" data-slot="error" hidden></p>';
  const STATUS = '<p class="help account-status" id="account-status" data-slot="status" aria-live="polite" hidden></p>';
  const EMAIL_FIELD = `
    <div class="field">
      <label for="account-email">Email</label>
      <input id="account-email" type="text" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" spellcheck="false" autocapitalize="off" maxlength="254" />
    </div>`;
  const passwordField = (autocomplete) => `
    <div class="field">
      <label for="account-password">Password</label>
      <div class="key-row">
        <input id="account-password" type="password" name="password" placeholder="At least 8 characters" autocomplete="${autocomplete}" spellcheck="false" autocapitalize="off" maxlength="4096" />
        ${button('toggle-password', 'Show')}
      </div>
    </div>`;
  const NEEDS_TEXT = `<p class="account-text">You're signed out on ${HERE} because your password changed or your sign-in expired. Your notes here are safe, and changes you make meanwhile upload after you sign in.</p>`;
  const PRIVACY = `
    <details class="privacy-note">
      <summary>What's stored and where <span class="muted">(version ${PRIVACY_VERSION})</span></summary>
      <ul>
        <li><b>Your account:</b> your email address and your password, kept by Google Identity Platform (the password only as a secure hash).</li>
        <li><b>Your board:</b> every project and note in Cooking, Cooked and Served, their order, highlights, copy counts and the "Join notes with" setting, and the pictures in your notes. Notes and projects you delete are kept for 30 days so they can be recovered, then erased; only a small record that each was deleted, with no text, stays until the account is deleted. Pictures stay in your account until the account is deleted, even after the note or draft that held them is gone.</li>
        <li><b>Each computer's own things,</b> as a backup that is never copied onto another computer: its name ("Mac" or "Windows PC"), platform, Recaller version and last sync time, its unsaved drafts and their pictures, its view (column widths, folded sections, scroll positions, density, title font, Cooked colour), and these settings: colour theme, voice model, language, vocabulary hint, the two shortcuts, and "hide after copying".</li>
        <li><b>Never uploaded:</b> your OpenAI API key and your local backups. Voice recordings go from your computer straight to OpenAI with your own key.</li>
        <li><b>Where:</b> Google Cloud (Firebase), in the United States (South Carolina). Google encrypts it in transit and at rest, but it is <b>not end-to-end encrypted</b>: the person who runs Recaller's Google Cloud project can technically read it, and only looks at it to fix a problem you report.</li>
        <li>Your data isn't sold, shared, or used for ads or AI training.</li>
        <li><b>Deleting:</b> Settings › Account &amp; sync › Delete account removes your account, board and pictures from Google Cloud straight away. Google's backups of the database and of deleted pictures expire within 7 days, and Google finishes erasing sign-in records within 180 days.</li>
        <li><b>Contact:</b> ahsan@ponders.ai</li>
      </ul>
    </details>`;

  const VIEWS = {
    out: () => `
      <p class="help">Keep this board in your own Recaller account on Google Cloud, and on every computer where you sign in. Recaller works the same without an account.</p>
      ${MESSAGES}
      <div class="account-actions">${button('create', 'Create account', 'btn-primary')}${button('sign-in', 'Sign in')}</div>
      ${STATUS}`,

    create: () => `
      <div class="account-grid">${EMAIL_FIELD}${passwordField('new-password')}</div>
      <p class="help">By creating an account you agree to how your data is stored: see What's stored and where.</p>
      ${PRIVACY}
      ${MESSAGES}
      <div class="account-actions">
        ${button('submit-create', 'Create account', 'btn-primary', ' data-slot="submit"')}${button('cancel', 'Cancel')}
        <span class="account-spacer"></span>${link('sign-in', 'I already have an account')}
      </div>
      ${STATUS}`,

    'sign-in': (again) => `
      ${again ? NEEDS_TEXT : ''}
      <div class="account-grid">${EMAIL_FIELD}${passwordField('current-password')}</div>
      ${MESSAGES}
      <div class="account-actions">
        ${button('submit-sign-in', 'Sign in', 'btn-primary', ' data-slot="submit"')}${button('cancel', 'Cancel')}
        <span class="account-spacer"></span>${link('forgot', 'Forgot password?')}${again ? '' : link('create', 'Create an account instead')}
      </div>
      ${STATUS}`,

    forgot: () => `
      <div class="account-grid">${EMAIL_FIELD}</div>
      <p class="help">We'll email you a link to set a new password.</p>
      ${MESSAGES}
      <div class="account-actions">${button('send-reset', 'Send link', 'btn-primary', ' data-slot="submit"')}${button('cancel', 'Cancel')}</div>
      ${STATUS}`,

    verify: () => `
      <p class="account-title">Check your email</p>
      <p class="account-text">We sent a link to <b data-slot="verify-email"></b>. Open it, then come back to Recaller: it notices by itself. Not in your inbox? Look in Spam. Nothing is uploaded until your email is verified.</p>
      ${MESSAGES}
      <div class="account-actions">
        ${button('verified', "I've verified", 'btn-primary')}${button('resend', 'Send again', 'btn-ghost', ' data-slot="resend"')}${button('different-email', 'Use a different email')}
      </div>
      ${STATUS}`,

    in: (deletingElsewhere) => `
      ${EMAIL_LINE}
      ${STATUS}
      <p class="help account-warn" data-slot="side" hidden></p>
      <p class="help">This board is kept in your account and on every computer where you sign in. Changes sync by themselves, so there's nothing to press; Sync now only skips the wait. Column widths, folded sections, scroll, drafts and the look stay on each computer.</p>
      <p class="help" data-slot="kept" hidden></p>
      <p class="help" data-slot="devices" hidden></p>
      ${MESSAGES}
      <div class="account-actions">
        ${deletingElsewhere
          ? button('delete', 'Finish deleting')
          : button('retry', 'Retry', 'btn-ghost', ' data-slot="retry" hidden') + button('sync-now', 'Sync now')}${button('sign-out', 'Sign out')}
        <span class="account-spacer"></span>${deletingElsewhere ? '' : link('change-password', 'Change password') + link('delete', 'Delete account…', ' is-danger')}
      </div>
      ${PRIVACY}`,

    choice: (kind) => {
      let body;
      if (kind === 'first-upload') {
        body = `
          <p class="account-title">Upload this board?</p>
          <p class="account-text" data-slot="choice-body"></p>
          <p class="help account-warn" data-slot="other" hidden></p>
          <div class="account-actions">${button('choice-upload', 'Upload this board', 'btn-primary')}${button('choice-not-now', 'Not now')}</div>`;
      } else if (kind === 'first-merge') {
        body = `
          <p class="account-title">Your account already has a board</p>
          <p class="account-text" data-slot="choice-account"></p>
          <p class="account-text" data-slot="choice-local"></p>
          <p class="help account-warn" data-slot="other" hidden></p>
          <p class="help" data-slot="choice-help"></p>
          <div class="account-actions">
            ${button('choice-combine', 'Combine both', 'btn-primary')}${button('choice-use-account', "Use my account's board")}
            <span class="account-spacer"></span>${link('choice-not-now', 'Not now')}
          </div>`;
      } else if (kind === 'mass-delete') {
        body = `
          <p class="account-title" data-slot="choice-title"></p>
          <p class="account-text" data-slot="choice-body"></p>
          <div class="account-actions">${button('choice-keep', 'Keep them in my account', 'btn-primary')}${button('choice-delete-everywhere', 'Delete them everywhere', 'btn-danger-ghost')}</div>`;
      } else {
        body = `
          <p class="account-title">Your account's cloud board is missing</p>
          <p class="account-text">Your account exists, but its cloud board is empty or was removed.</p>
          <div class="account-actions">${button('choice-upload', 'Upload this board', 'btn-primary')}${button('sign-out', 'Sign out')}</div>`;
      }
      return `${EMAIL_LINE}<div class="account-panel is-choice">${body}${MESSAGES}</div>${STATUS}`;
    },

    'sign-out': (waiting) => `
      ${EMAIL_LINE}
      <div class="account-panel">
        <p class="account-text" data-slot="sign-out-text"></p>
        <label class="account-check"><input type="checkbox" name="remove-board" /><span data-slot="remove-label">${esc(removeLabel())}</span></label>
        ${waiting ? `<p class="help account-warn" data-slot="wait" hidden>Wait until everything is uploaded before removing the board from ${HERE}.</p>` : ''}
        ${MESSAGES}
        <div class="account-actions">
          ${waiting
            ? button('keep-syncing', 'Keep syncing', 'btn-primary', ' data-slot="keep"') + button('sync-now', 'Sync now', 'btn-primary', ' data-slot="sync" hidden') + button('sign-out-confirm', 'Sign out anyway', 'btn-ghost', ' data-slot="confirm"')
            : button('sign-out-confirm', 'Sign out', 'btn-primary', ' data-slot="confirm"') + button('cancel', 'Cancel')}
        </div>
        ${STATUS}
      </div>`,

    delete: (resume) => `
      ${EMAIL_LINE}
      <div class="account-panel is-danger">
        ${resume
          ? '<p class="account-title">Finishing account deletion…</p>'
          : '<p class="account-title">Delete your Recaller account?</p><p class="account-text" data-slot="delete-body"></p>'}
        <div class="account-grid">
          <div class="field">
            <label for="account-password">Password</label>
            <input id="account-password" type="password" name="password" autocomplete="current-password" spellcheck="false" maxlength="4096" />
          </div>
          ${resume ? '' : `
          <div class="field">
            <label for="account-confirm-delete">Type DELETE to confirm</label>
            <input id="account-confirm-delete" type="text" name="confirm-delete" placeholder="DELETE" autocomplete="off" spellcheck="false" autocapitalize="characters" maxlength="20" />
          </div>`}
        </div>
        ${MESSAGES}
        <div class="account-actions">${button('delete-confirm', 'Delete account', 'btn-danger', ' data-slot="confirm" disabled')}${button('cancel', 'Cancel')}</div>
        ${STATUS}
      </div>`,

    needs: () => `
      ${EMAIL_LINE}
      ${NEEDS_TEXT}
      ${MESSAGES}
      <div class="account-actions">${button('sign-in-again', 'Sign in', 'btn-primary')}${button('stop-syncing', 'Stop syncing')}</div>
      ${STATUS}`,

    gone: (state) => `
      ${EMAIL_LINE}
      <p class="account-text">${state === 'deleted' ? 'This account was deleted. Your notes here are safe.' : 'This account has been turned off. Your notes here are safe.'}</p>
      ${MESSAGES}
      <div class="account-actions">${button('use-without-account', 'Use without an account', 'btn-primary')}</div>
      ${STATUS}`,
  };

  // ---- rendering

  // What the section shows: from the account state, and from what the person opened.
  function currentView() {
    switch (st.state) {
      case 'unverified': return 'verify';
      case 'needs-sign-in':
        return ['sign-in', 'forgot', 'sign-out'].includes(ui.view) ? ui.view : 'needs';
      case 'deleted':
      case 'disabled': return 'gone';
      case 'signed-in':
        if (ui.view === 'sign-out' || ui.view === 'delete') return ui.view;
        if (CHOICES.has(st.choice?.kind) && ui.dismissedChoice !== st.choice.kind) return 'choice';
        return 'in';
      default:
        return ['create', 'sign-in', 'forgot'].includes(ui.view) ? ui.view : 'out';
    }
  }

  const pendingNow = () => Math.max(0, Math.floor(Number(ui.pending) || 0));

  // The argument each template takes; a change rebuilds the section.
  function variant(view) {
    switch (view) {
      case 'sign-in': return st.state === 'needs-sign-in';
      case 'choice': return st.choice.kind;
      case 'sign-out': return pendingNow() > 0;
      case 'delete': return ui.deleteResume;
      case 'in': return st.sync?.phase === 'deleting-elsewhere';
      case 'gone': return st.state;
      default: return '';
    }
  }

  function render() {
    const on = Boolean(st.enabled);
    box.hidden = !on;
    if (head) head.hidden = !on;
    if (helpLine) helpLine.hidden = !on;
    box.dataset.state = st.state || 'signed-out';
    box.dataset.phase = st.sync?.phase || '';
    paintIndicator();
    if (!on) {
      built = '';
      return;
    }
    const view = currentView();
    const arg = variant(view);
    const key = `${view}:${arg}`;
    if (key !== built) {
      const hadFocus = box.contains(document.activeElement);
      box.dataset.view = view;
      box.innerHTML = VIEWS[view](arg);
      built = key;
      const email = field('email');
      if (email) email.value = st.state === 'needs-sign-in' && !ui.email ? st.email || '' : ui.email;
      const remove = field('remove-board');
      if (remove) remove.checked = ui.removeBoard;
      if (hadFocus && !ui.focus) ui.focus = 'first';
    }
    paint(view);
    if (ui.focus) {
      focusIn(ui.focus, view);
      ui.focus = '';
    }
  }

  function focusIn(what, view) {
    let target = null;
    if (what === 'first') {
      const inputs = [...box.querySelectorAll('input')].filter((i) => i.type !== 'checkbox');
      if (inputs.length) target = inputs.find((i) => !i.value) || inputs[0];
      else if (view === 'sign-out') target = field('remove-board');
      else if (view !== 'choice') target = [...box.querySelectorAll('button[data-action]')].find((b) => !b.hidden && !b.disabled);
    } else {
      target = field(what);
    }
    try { target?.focus(); } catch { /* not focusable yet */ }
  }

  function paint(view = box.dataset.view) {
    const now = Date.now();
    setText('email', st.email || '');
    paintNote();
    paintError(now);
    const busy = Boolean(ui.busy);
    box.setAttribute('aria-busy', String(busy));
    for (const b of box.querySelectorAll('button[data-action]')) b.disabled = busy;

    const toggle = box.querySelector('[data-action="toggle-password"]');
    if (toggle) {
      toggle.disabled = false;
      setLabel(toggle, ui.showPassword ? 'Hide' : 'Show');
      const pw = field('password');
      if (pw) pw.type = ui.showPassword ? 'text' : 'password';
    }

    let status = ['', ''];
    if (view === 'create') {
      setLabel(slot('submit'), ui.busy === 'create' ? 'Creating account…' : 'Create account');
    } else if (view === 'sign-in') {
      setLabel(slot('submit'), ui.busy === 'sign-in' ? 'Signing in…' : 'Sign in');
    } else if (view === 'verify') {
      setText('verify-email', st.email || '');
      paintWait(slot('resend'), 'Send again', ui.resendUntil, busy, now);
    } else if (view === 'forgot') {
      paintWait(slot('submit'), 'Send link', ui.resetUntil, busy, now);
    } else if (view === 'in') {
      status = statusLine(st.sync, now);
      const side = sideLine(st.sync);
      setText('side', side.text);
      const retry = slot('retry');
      if (retry) retry.hidden = !((st.sync?.phase === 'paused' && pauseCode(st.sync) === 'PERMISSION') || side.retry);
      setText('kept', keptText());
      setText('devices', devicesText());
      const syncBtn = box.querySelector('[data-action="sync-now"]');
      if (syncBtn) syncBtn.disabled = busy || ui.syncBusy;
      paintWait(box.querySelector('[data-action="change-password"]'), 'Change password', ui.resetUntil, busy, now);
    } else if (view === 'choice') {
      paintChoice();
    } else if (view === 'sign-out') {
      paintSignOut(busy);
      if (pendingNow() > 0) status = statusLine(st.sync, now);
      if (savingText(st.signingOut)) status = [savingText(st.signingOut), ''];
    } else if (view === 'delete') {
      if (!ui.deleteResume) setText('delete-body', deleteBody());
      const ready = Boolean(fieldValue('password')) && (ui.deleteResume || fieldValue('confirm-delete') === 'DELETE');
      slot('confirm').disabled = busy || !ready;
      status = [deletingText(), ''];
    }
    paintStatus(status[0], status[1]);
  }

  // A button that waits out its 60 s: "Send again (42 s)".
  function paintWait(node, label, until, busy, now) {
    if (!node) return;
    const left = Math.ceil((until - now) / 1000);
    setLabel(node, left > 0 ? `${label} (${left} s)` : label);
    node.disabled = busy || left > 0;
  }

  function paintStatus(text, tone) {
    const node = setText('status', text);
    if (!node) return;
    node.classList.toggle('ok', tone === 'ok');
    node.classList.toggle('account-warn', tone === 'warn');
  }

  function paintNote() {
    const node = setText('note', ui.note?.text || '');
    if (node) node.classList.toggle('ok', ui.note?.tone === 'ok');
  }

  const painted = new WeakMap();
  function paintError(now) {
    const node = slot('error');
    if (!node) return;
    const e = ui.error;
    let text = e?.text || '';
    if (e?.code === 'LOCKED_OUT') {
      const s = Math.ceil((e.until - now) / 1000);
      if (s > 0) text = `Too many wrong passwords. Try again in ${s} ${s === 1 ? 'second' : 'seconds'}.`;
      else ui.error = null;
    }
    const key = text && e?.signIn ? `${text}\u0001` : text;
    if (painted.get(node) !== key) {
      node.innerHTML = text ? esc(text) + (e?.signIn ? ` ${link('sign-in', 'Sign in instead')}` : '') : '';
      painted.set(node, key);
    }
    node.hidden = !text;
  }

  function paintChoice() {
    const c = st.choice || {};
    const local = c.local || {};
    const other = c.otherAccount
      ? `${HERE_CAP}'s board was last synced with another account (${c.otherAccount}). Uploading copies it into ${st.email || 'this account'}.`
      : '';
    if (c.kind === 'first-upload') {
      const counts = `${plural(local.projects, 'project')} · ${plural(local.notes, 'note')} · ${plural(local.pictures, 'picture')}`;
      setText('choice-body', `Your account${st.email ? ` ${st.email}` : ''} is empty. Upload ${HERE}'s board (${counts}) to it? It then syncs with every computer where you sign in.`);
      setText('other', other);
    } else if (c.kind === 'first-merge') {
      const a = c.account || {};
      const changed = a.changedAt ? ` · last changed ${rel(a.changedAt)}${a.device ? ` on ${deviceName(a.device)}` : ''}` : '';
      setText('choice-account', `Account: ${plural(a.projects, 'project')} · ${plural(a.notes, 'note')}${changed}`);
      setText('choice-local', `${HERE_CAP}: ${plural(local.projects, 'project')} · ${plural(local.notes, 'note')}`);
      setText('other', other);
      setText('choice-help', `Combine keeps everything from both; ${HERE}'s projects are added after your account's, and nothing is deleted. Use my account's board replaces ${HERE}'s board and puts it in a backup first (Settings › Backups). Either way, Recaller backs up ${HERE}'s board before changing anything.`);
    } else if (c.kind === 'mass-delete') {
      const notes = plural(c.count, 'note');
      setText('choice-title', `Delete ${notes} everywhere?`);
      setText('choice-body', `Recaller is about to delete ${notes} from your account and every computer, but no delete you made explains it.`);
    }
  }

  // Once main has named copies of a notes file it couldn't read (they may hold notes the board doesn't), the
  // checkbox names them too, and ticking it agrees to remove them with the board (§5.14).
  function removeLabel() {
    const k = ui.unreadable;
    const copies = k ? `, plus ${k === 1 ? '1 unreadable copy' : `${k} unreadable copies`} of an older notes file` : '';
    return `Also remove this board, its pictures and its backups from ${HERE}${copies}`;
  }

  function paintSignOut(busy) {
    const n = pendingNow();
    setLabel(slot('remove-label'), removeLabel());
    const remove = field('remove-board');
    if (remove) remove.checked = ui.removeBoard; // unticked when main names copies it didn't agree to
    if (!n) {
      setText('sign-out-text', `Sign out of ${st.email || 'this account'}? Your board stays on ${HERE} unless you remove it.`);
      return;
    }
    setText('sign-out-text', n === 1
      ? `1 change hasn't uploaded yet. It stays on ${HERE}; notes you deleted may come back if you sign in again later.`
      : `${n} changes haven't uploaded yet. They stay on ${HERE}; notes you deleted may come back if you sign in again later.`);
    // Removing the board waits until everything is uploaded (§5.14).
    const blocked = ui.removeBoard;
    slot('wait').hidden = !blocked;
    slot('sync').hidden = !blocked;
    slot('sync').disabled = busy || ui.syncBusy;
    slot('confirm').hidden = blocked;
    const keep = slot('keep');
    keep.classList.toggle('btn-primary', !blocked);
    keep.classList.toggle('btn-ghost', blocked);
  }

  let lookKey = '';
  function paintIndicator() {
    if (!indicator) return;
    indicator.dataset.phase = st.state === 'signed-in' ? st.sync?.phase || '' : st.state || '';
    const look = indicatorLook(Date.now());
    indicator.hidden = !look;
    if (!look) return;
    const key = `${look.icon}:${look.dot ? 1 : 0}`;
    if (key !== lookKey) {
      indicator.innerHTML = (I[look.icon] || '') + (look.dot ? '<span class="sync-dot"></span>' : '');
      lookKey = key;
    }
    indicator.classList.toggle('is-muted', Boolean(look.muted));
    indicator.classList.toggle('is-syncing', Boolean(look.breathe));
    if (indicator.getAttribute('title') !== look.tip) {
      indicator.setAttribute('title', look.tip);
      indicator.setAttribute('aria-label', look.tip);
    }
  }

  // ---- state from main

  let quietTimer = null;
  function repaintIndicatorIn(ms) {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { quietTimer = null; paintIndicator(); }, ms + 50);
  }

  let removedToastDue = flag(false);

  function apply(next) {
    if (!next || typeof next !== 'object') return;
    const prev = st;
    st = next;
    const now = Date.now();
    const phase = st.sync?.phase || '';
    const prevPhase = prev.sync?.phase || '';
    if (phase === 'syncing' && prevPhase !== 'syncing') {
      since.syncing = now;
      repaintIndicatorIn(SYNCING_QUIET_MS);
    } else if (phase === 'offline' && prevPhase !== 'offline') {
      since.offline = now;
      repaintIndicatorIn(OFFLINE_QUIET_MS);
    }
    if (st.state !== prev.state) {
      const after = ui.after?.state === st.state ? ui.after : null;
      ui.view = after?.view || 'idle';
      if (after?.focus) ui.focus = after.focus;
      ui.after = null;
      ui.error = null;
      ui.note = null;
      ui.dismissedChoice = '';
      ui.deleteResume = false;
      ui.resumeDismissed = false;
      ui.removeBoard = false;
      ui.unreadable = 0;
      if (st.state !== 'unverified') stopVerifyPoll();
      if (st.state !== 'signed-in') ui.expectUpload = false;
    }
    if (ui.view === 'sign-out' && st.sync && st.sync.pending !== prev.sync?.pending) ui.pending = Number(st.sync.pending) || 0;
    if (ui.busy === 'delete' && st.deleting) {
      if (st.deleting.what === 'save-pictures') ui.deleteSaving = true;
      else ui.deleteStarted = true;
    }
    // An interrupted deletion asks for the password again (§5.15).
    if (st.state === 'signed-in' && st.deleting && !ui.busy && ui.view === 'idle' && !ui.resumeDismissed) {
      ui.view = 'delete';
      ui.deleteResume = true;
    }
    if (ui.expectUpload && st.state === 'signed-in' && phase === 'synced' && !st.choice) {
      ui.expectUpload = false;
      toast('Your board is in your account now.');
    }
    if (removedToastDue && st.enabled && st.state === 'signed-out') {
      removedToastDue = false;
      toastSoon(REMOVED_TOAST);
    }
    if (!st.enabled) stopTicker();
    else if (settings?.open) startTicker();
    render();
  }

  // After a reload, app.js may still be starting: wait a little for RecallerUI.
  function toastSoon(message, tries = 0) {
    if (typeof window.RecallerUI?.toast === 'function' || tries >= 20) toast(message);
    else setTimeout(() => toastSoon(message, tries + 1), 150);
  }

  function refresh() {
    Promise.resolve()
      .then(() => acct.get())
      .then(apply, () => {});
  }

  // ---- operations. One at a time; main answers BUSY while another one runs.

  async function call(fn) {
    try {
      const res = await fn();
      return res && typeof res === 'object' ? res : { ok: false, code: 'UNAVAILABLE' };
    } catch (err) {
      console.error('[account]', err);
      return { ok: false, code: 'UNAVAILABLE' };
    }
  }

  async function run(op, fn, done) {
    if (ui.busy) return;
    const focused = box.contains(document.activeElement) ? document.activeElement : null;
    ui.busy = op;
    ui.error = null;
    ui.note = null;
    render();
    let res = await call(fn);
    if (res.code === 'BUSY') {
      await sleep(700);
      res = await call(fn);
    }
    ui.busy = '';
    try {
      done(res);
    } finally {
      render();
      // Disabling or replacing the focused control drops focus to <body>; give keyboard users a place
      // to continue (never pulling focus back from somewhere else they moved it).
      const active = document.activeElement;
      if (focused && (!active || active === document.body)) {
        if (box.contains(focused)) {
          try { focused.focus(); } catch { /* gone */ }
        } else {
          focusIn('first', box.dataset.view);
        }
      }
    }
  }

  function errorFor(res) {
    const code = res?.code;
    if (code === 'LOCKED_OUT') return { code, until: Date.now() + Math.max(1000, Number(res.retryAfterMs) || 30_000) };
    if (code === 'EMAIL_EXISTS') return { text: ERRORS.EMAIL_EXISTS, signIn: true };
    return { text: Object.hasOwn(ERRORS, code || '') ? ERRORS[code] : UNAVAILABLE };
  }

  // Checked here first, with no network call.
  function fail(code, name, text) {
    ui.error = text ? { text } : errorFor({ code });
    ui.note = null;
    ui.focus = name;
    render();
  }

  function clearPasswords({ confirm = true } = {}) {
    for (const input of box.querySelectorAll(confirm ? 'input[name="password"], input[name="confirm-delete"]' : 'input[name="password"]')) input.value = '';
  }

  function open(view) {
    if (view !== 'sign-out') {
      ui.removeBoard = false;
      ui.unreadable = 0;
    }
    ui.view = view;
    ui.error = null;
    ui.note = null;
    ui.showPassword = false;
    ui.focus = 'first';
    render();
  }

  function closeForm() {
    if (ui.busy) return; // the running operation's answer belongs in this form
    const view = currentView();
    if (view === 'forgot') return open('sign-in');
    if (view === 'delete' && ui.deleteResume) ui.resumeDismissed = true;
    if (view === 'delete') ui.deleteResume = false;
    clearPasswords();
    open('idle');
  }

  // Enter in an account input: that small form's main button.
  function submit() {
    const view = currentView();
    if (view === 'create') createAccount();
    else if (view === 'sign-in') signIn();
    else if (view === 'forgot') sendReset();
    else if (view === 'delete' && !slot('confirm')?.disabled) deleteAccount();
  }

  function createAccount() {
    const email = emailValue();
    const password = fieldValue('password');
    if (!validEmail(email)) return fail('INVALID_EMAIL', 'email');
    if (password.length < 8) return fail('WEAK_PASSWORD', 'password');
    ui.email = email;
    run('create', () => acct.signUp(email, password, PRIVACY_VERSION), (res) => {
      if (res.ok) {
        clearPasswords();
        ui.resendUntil = Date.now() + RESEND_MS;
        startVerifyPoll();
        refresh();
        return;
      }
      ui.error = errorFor(res);
      if (res.code === 'WEAK_PASSWORD') ui.focus = 'password';
    });
  }

  function signIn() {
    const email = emailValue();
    const password = fieldValue('password');
    if (!validEmail(email)) return fail('INVALID_EMAIL', 'email');
    if (!password) {
      ui.focus = 'password';
      return render();
    }
    ui.email = email;
    run('sign-in', () => acct.signIn(email, password), (res) => {
      if (res.ok) {
        clearPasswords();
        refresh();
        return;
      }
      if (res.code === 'WRONG_PASSWORD' || res.code === 'LOCKED_OUT') {
        clearPasswords();
        ui.focus = 'password';
      }
      ui.error = errorFor(res);
    });
  }

  // After a reset link went out, both buttons wait 60 s, or as long as main says one more must wait.
  function resetWait(res) {
    const ms = res.ok ? RESEND_MS : Math.min(RESEND_MS, Math.max(0, Number(res.retryAfterMs) || 0));
    if (ms) ui.resetUntil = Date.now() + ms;
  }

  function sendReset() {
    if (Date.now() < ui.resetUntil) return;
    const email = emailValue();
    if (!email) return fail('', 'email', 'Type your email above first.');
    if (!validEmail(email)) return fail('INVALID_EMAIL', 'email');
    ui.email = email;
    run('reset', () => acct.resetPassword(email), (res) => {
      if (res.ok) ui.note = { text: `If there's an account for ${email}, a link is on its way (if it isn't in your inbox, look in Spam). After you change the password, sign in again on each computer.`, tone: 'ok' };
      else ui.error = errorFor(res);
      resetWait(res);
    });
  }

  function changePassword() {
    const email = st.email;
    if (!email || Date.now() < ui.resetUntil) return;
    run('reset', () => acct.resetPassword(email), (res) => {
      if (res.ok) ui.note = { text: `We emailed ${email} a link to set a new password (if it isn't in your inbox, look in Spam). After you change it, sign in again on each computer.`, tone: 'ok' };
      else ui.error = errorFor(res);
      resetWait(res);
    });
  }

  // "I've verified", window focus and a slow poll share one lookup at a time.
  let checking = null;
  let lastCheck = 0;
  function sharedCheck() {
    if (!checking) {
      lastCheck = Date.now();
      checking = call(() => acct.checkVerified()).finally(() => { checking = null; });
    }
    return checking;
  }

  function quietCheck() {
    if (st.state !== 'unverified' || ui.busy) return;
    sharedCheck().then((res) => { if (res.ok && res.verified) refresh(); });
  }

  let pollTimer = null;
  let pollUntil = 0;
  function startVerifyPoll() {
    pollUntil = Date.now() + VERIFY_POLL_FOR_MS;
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (st.state !== 'unverified' || Date.now() > pollUntil) stopVerifyPoll();
      else quietCheck();
    }, VERIFY_POLL_MS);
  }

  function stopVerifyPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function verified() {
    run('verify', sharedCheck, (res) => {
      if (res.ok && res.verified) refresh();
      else if (res.ok || res.code === 'NOT_VERIFIED') ui.note = { text: ERRORS.NOT_VERIFIED, tone: '' };
      else ui.error = errorFor(res);
    });
  }

  function resend() {
    if (Date.now() < ui.resendUntil) return;
    run('resend', () => acct.resendVerification(), (res) => {
      if (res.ok) {
        ui.note = { text: `Sent again to ${st.email || 'your email'}. Not in your inbox? Look in Spam.`, tone: 'ok' };
        ui.resendUntil = Date.now() + RESEND_MS;
        startVerifyPoll();
      } else {
        ui.error = errorFor(res);
      }
    });
  }

  function differentEmail() {
    if (ui.busy) return;
    ui.email = ''; // main's account:changed can arrive before this call's answer and open the form
    ui.after = { state: 'signed-out', view: 'create', focus: 'email' };
    run('discard', () => acct.discardUnverified(), (res) => {
      if (res.ok) {
        refresh();
      } else {
        ui.after = null;
        ui.error = errorFor(res);
      }
    });
  }

  async function syncNow() {
    if (typeof syncApi?.now !== 'function' || ui.syncBusy) return;
    ui.dismissedChoice = '';
    ui.syncBusy = true;
    render();
    try {
      const status = await syncApi.now();
      if (status && typeof status === 'object' && status.phase) {
        if (ui.view === 'sign-out') ui.pending = Number(status.pending) || 0;
        ui.syncBusy = false;
        apply({ ...st, sync: status });
        return;
      }
    } catch (err) {
      console.error('[account]', err);
    }
    ui.syncBusy = false;
    render();
  }

  function choose(answer) {
    if (typeof syncApi?.choose !== 'function' || ui.busy) return;
    if (answer === 'not-now') ui.dismissedChoice = st.choice?.kind || '';
    run('choose', () => syncApi.choose(answer), (res) => {
      if (res.ok) {
        if (answer === 'upload') ui.expectUpload = true;
        refresh();
      } else if (answer !== 'not-now') {
        ui.error = errorFor(res);
      }
    });
  }

  function confirmSignOut() {
    const waiting = pendingNow() > 0;
    if (waiting && ui.removeBoard) return; // refused until everything is uploaded
    // The unreadable copies the checkbox names go only when it was ticked while naming them.
    signOut({ force: waiting, removeBoard: ui.removeBoard, removeUnreadable: ui.removeBoard && ui.unreadable > 0 });
  }

  function signOut(opts, { quiet = false } = {}) {
    if (ui.busy) return;
    if (opts.removeBoard) flag(true); // main reloads the page after removing the board
    const agreed = opts.removeUnreadable ? ui.unreadable : 0; // the copies this request agrees to remove
    run('sign-out', () => acct.signOut(opts), (res) => {
      if (res.ok) {
        ui.view = 'idle';
        ui.removeBoard = false;
        ui.unreadable = 0;
        const left = Math.max(0, Math.floor(Number(res.picturesLeft) || 0)); // full-size pictures that stayed in the account
        if (opts.removeBoard) setTimeout(() => { if (flag(false)) toast(REMOVED_TOAST); }, 2000);
        else if (left === 1) toast(`Signed out. 1 full-size picture stays in your account, and ${HERE} keeps its preview. Signing in again brings it here.`);
        else if (left > 1) toast(`Signed out. ${left} full-size pictures stay in your account, and ${HERE} keeps their previews. Signing in again brings them here.`);
        else if (!quiet) toast('Signed out. Your board stays on this computer.');
        refresh();
        return;
      }
      if (opts.removeBoard) flag(false);
      if (res.code === 'PENDING') {
        const copies = Math.max(0, Math.floor(Number(res.localOnly?.unreadable) || 0));
        const waiting = Math.floor(Number(res.pending) || 0);
        ui.pending = copies && waiting <= 0 ? 0 : Math.max(1, waiting);
        // What this request asked, never an older tick; copies it didn't agree to are named first, and the
        // person ticks the box again to agree.
        ui.removeBoard = Boolean(opts.removeBoard) && copies <= agreed;
        ui.unreadable = copies;
        if (opts.removeBoard && copies > agreed) {
          ui.note = {
            text: copies === 1
              ? `${HERE_CAP} also holds an unreadable copy of an older notes file, which may have notes this board doesn't. To remove it with the board, tick the box again.`
              : `${HERE_CAP} also holds ${copies} unreadable copies of an older notes file, which may have notes this board doesn't. To remove them with the board, tick the box again.`,
          };
        }
        ui.view = 'sign-out';
        return;
      }
      ui.error = errorFor(res);
    });
  }

  function openSignOut() {
    ui.pending = Number(st.sync?.pending) || 0;
    ui.removeBoard = false;
    ui.unreadable = 0;
    open('sign-out');
  }

  function openDelete() {
    ui.deleteResume = st.sync?.phase === 'deleting-elsewhere' || Boolean(st.deleting);
    open('delete');
  }

  function deleteAccount() {
    const password = fieldValue('password');
    if (!password || (!ui.deleteResume && fieldValue('confirm-delete') !== 'DELETE')) return;
    ui.deleteStarted = Boolean(st.deleting);
    ui.deleteSaving = false;
    run('delete', () => acct.deleteAccount(password), (res) => {
      clearPasswords({ confirm: false }); // the typed DELETE stays for another try
      if (res.ok) {
        ui.view = 'idle';
        ui.deleteResume = false;
        toast(`Account deleted. Your board stays on ${HERE}.`);
        refresh();
        return;
      }
      if (res.code === 'WRONG_PASSWORD') ui.error = { text: 'Password is wrong.' };
      else if (ui.deleteStarted) ui.error = { text: 'Deletion stopped partway. Sign in again to finish it.' };
      else if (ui.deleteSaving) ui.error = { text: `Nothing was deleted: not every full-size picture could be saved to ${HERE} first. Check your connection, then try again.` };
      else ui.error = errorFor(res);
      ui.focus = 'password';
    });
  }

  function togglePassword() {
    ui.showPassword = !ui.showPassword;
    paint();
  }

  const ACTIONS = {
    create: () => open('create'),
    'sign-in': () => open('sign-in'),
    'sign-in-again': () => { ui.email = st.email || ui.email; open('sign-in'); },
    forgot: () => open('forgot'),
    cancel: closeForm,
    'toggle-password': togglePassword,
    'submit-create': createAccount,
    'submit-sign-in': signIn,
    'send-reset': sendReset,
    verified,
    resend,
    'different-email': differentEmail,
    'sync-now': syncNow,
    'sign-out': openSignOut,
    'sign-out-confirm': confirmSignOut,
    'keep-syncing': () => open('idle'),
    'stop-syncing': () => signOut({ force: false, removeBoard: false }),
    'use-without-account': () => signOut({ force: true, removeBoard: false }, { quiet: true }),
    'change-password': changePassword,
    delete: openDelete,
    'delete-confirm': deleteAccount,
  };

  // ---- events

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || !box.contains(b) || b.disabled) return;
    const action = b.dataset.action;
    if (Object.hasOwn(ANSWERS, action)) choose(ANSWERS[action]);
    else if (Object.hasOwn(ACTIONS, action)) ACTIONS[action]();
  });

  box.addEventListener('input', (e) => {
    const name = e.target.name;
    if (name === 'email') ui.email = e.target.value;
    if (name === 'password' || name === 'confirm-delete') paint();
  });

  box.addEventListener('change', (e) => {
    if (e.target.name !== 'remove-board') return;
    ui.removeBoard = e.target.checked;
    paint();
  });

  // Settings is a <form method="dialog">: Enter would close it and Esc would cancel it (§6.1).
  box.addEventListener('keydown', (e) => {
    if (e.target.tagName !== 'INPUT' || e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target.type !== 'checkbox') submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeForm();
    }
  });

  // Settings open: live times and countdowns. Closed: passwords go, panels fold back.
  let ticker = null;
  function startTicker() {
    if (!ticker && st.enabled) ticker = setInterval(() => paint(), 1000);
  }
  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  if (settings) {
    settings.addEventListener('close', () => {
      stopTicker();
      clearPasswords();
      if (ui.busy) return;
      ui.view = 'idle';
      ui.error = null;
      ui.note = null;
      ui.dismissedChoice = '';
      ui.deleteResume = false;
      ui.resumeDismissed = false;
      ui.removeBoard = false;
      ui.unreadable = 0;
      ui.showPassword = false;
      render();
    });
    new MutationObserver(() => {
      if (!settings.open) return;
      startTicker();
      render();
    }).observe(settings, { attributes: true, attributeFilter: ['open'] });
  }

  if (indicator) {
    indicator.addEventListener('click', async () => {
      ui.dismissedChoice = '';
      ui.resumeDismissed = false;
      try {
        const openSettings = window.RecallerUI?.openSettings;
        if (typeof openSettings === 'function') await openSettings();
        else document.getElementById('open-settings')?.click();
      } catch (err) {
        console.error('[account]', err);
      }
      reveal();
    });
  }

  // Scroll the section into view once Settings is open (opening it waits for main).
  function reveal(tries = 0) {
    if (!settings || settings.open) {
      render();
      (head || box).scrollIntoView({ block: 'start' });
    } else if (tries < 40) {
      setTimeout(() => reveal(tries + 1), 25);
    }
  }

  window.addEventListener('focus', () => {
    if (st.enabled && st.state === 'unverified' && Date.now() - lastCheck >= VERIFY_FOCUS_MS) quietCheck();
  });

  // ---- start

  render();
  if (typeof acct.onChanged === 'function') acct.onChanged(apply);
  refresh();
})();
