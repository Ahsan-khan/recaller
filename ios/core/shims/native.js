'use strict';
// The bridge the host installs before the bundle runs: globalThis.__native. On the iPhone it is Swift
// (ios/Recaller/Core/JSHost.swift); in the Node tests it is ios/core/test/node-native.js. Every function is
// synchronous; errors come back as { __err: 'ENOENT', message } instead of throwing across the bridge.
//
//   fsRead(path) → Uint8Array            fsWrite(path, bytes)          fsExists(path) → bool
//   fsMkdir(path, recursive)             fsRename(from, to)            fsCopy(from, to)
//   fsReaddir(path) → [names]            fsRm(path, recursive)         fsStat(path) → { size, dir, ino, birthtimeMs, mtimeMs }
//   utf8Encode(string) → Uint8Array      utf8Decode(bytes) → string    utf8Length(string) → number
//   base64Encode(bytes) → string         base64Decode(string) → Uint8Array
//   hash('sha256'|'md5', bytes) → Uint8Array                           randomBytes(n) → Uint8Array
//   setTimer(id, ms)  clearTimer(id)     → the host later calls globalThis.__timerFire(id)
//   fetch(id, url, method, headers, body, timeoutMs) → later __fetchDone(id, status, headers, bytes) or __fetchFail(id, msg)
//   fetchCancel(id)
//   isOnline() → bool    hostname() → string    log(level, text)
//   emit(event, json)    → tells the app something changed (board, account, notice)
//   makeThumb(src, dst) → bool   (a PNG at most 640 px wide)
//   seal(string) → Uint8Array    unseal(bytes) → string   (the sign-in token, under a Keychain key)

const N = globalThis.__native;
if (!N) throw new Error('the native bridge is missing');
module.exports = N;
