# Recaller for iPhone

A native SwiftUI app that runs the desktop's own sync engine (`src/sync`, `src/cloud`) inside JavaScriptCore, so
the iPhone signs into the same account and syncs the same board as the PC and the Mac. The plan and the rules it
keeps are in `ai_memory/16_iphone_app_plan.md`.

## Layout

| Path | What |
| --- | --- |
| `core/app-core.js` | The phone's main + page: saves, loads, patches, and the desktop's `src/cloud/index.js` wired through stand-ins |
| `core/board.js` | Every board edit, ported from `src/renderer/app.js` (same undo labels, so the mass-delete guard behaves) |
| `core/shims/` | What Node and Electron gave the desktop code: Buffer, fs, crypto, fetch, timers, a few Electron pieces |
| `core/build.js` | Bundles all of it into `Recaller/Resources/core/recaller-core.js` (generated, not in git) |
| `core/test/` | `board.test.js` (38) and `core.test.js` (the bundle in a bare sandbox, against the mock cloud, beside a desktop peer) |
| `core/dev-mock.js` | The mock cloud on 127.0.0.1:9311 with a test account and a "Mac" that uploads a sample board |
| `Recaller/Core/` | `JSHost.swift` (the bridge), `AppStore.swift` (the store the screens use), `Models.swift` |
| `Recaller/UI/` | The screens |
| `Recaller/Voice/` | Dictation (the desktop's `voice.js` + `transcribe.js` in Swift) and its tests |
| `project.yml` | The Xcode project, generated with XcodeGen |

## Build

Needs Xcode 27 (in `/Applications`), Node and XcodeGen (`brew install xcodegen`). The build runs `node core/build.js`
by itself; `src/cloud/project.json` must exist (`npm run cloud:config`) or the app has no accounts.

```bash
cd ios && xcodegen generate
```

```bash
open ios/Recaller.xcodeproj
```

On this Mac `xcode-select` points at the Command Line Tools; prefix command-line builds with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`, or switch once with
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

## Test

```bash
node --test ios/core/test/board.test.js
```

```bash
node ios/core/test/core.test.js
```

Swift tests: Product › Test in Xcode (or `xcodebuild … test`).

## Try it in the Simulator against the mock cloud

```bash
node ios/core/dev-mock.js
```

Then run the app with the scheme's environment `RECALLER_GCP_BASE=http://127.0.0.1:9311` (debug builds only) and sign
in as `demo@example.com` / `password-1234` (an account that exists only in the mock). `RECALLER_DEV_SIGNIN=email:password`
signs in at launch; `RECALLER_DEV_SHOW=settings,composer,…` opens screens for screenshots (see `RootView.devShow`).
Lines typed into the mock's terminal arrive on the phone as new prompts from the "Mac".

## On a real iPhone

With the Apple Developer account added in Xcode › Settings › Accounts: pick the team under Signing & Capabilities
(or set `DEVELOPMENT_TEAM` in `project.yml`), plug the iPhone in, turn on Settings › Privacy & Security › Developer
Mode on the phone, choose it as the run destination and press Run. A release build always uses the real cloud.
