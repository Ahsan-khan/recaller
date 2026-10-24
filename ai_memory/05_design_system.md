# 05: Design system

All styling is in `src/renderer/styles.css`, driven by CSS custom properties.

- **Theme** is a class on `<body>`: `theme-deep` (default) or `theme-soft`.
- **Density:** `density-compact`, `density-slim` or `density-roomy`.
- **Column title font:** `title-instrument` (default), `title-jakarta`, `title-onest`, `title-sora`, `title-space`, `title-inter`, `title-manrope`, `title-geist` or `title-caps`.
- **Cooked colour:** `cooked-ocean` (default), `cooked-teal`, `cooked-midnight` or `cooked-graphite`.
- **Mac only:** `is-mac`, added once at startup, and `is-fullscreen`, while the window is in full screen. See "macOS" at the end.

The renderer swaps these classes in `render()` and `applyTheme()`. `index.html` starts `<body>` with `density-slim theme-deep title-instrument cooked-ocean`.

## Design principles (from the owner's feedback)

1. **Nature and monstera, but modern:** deep forest greens, emerald accents, a monstera leaf in the logo and as faint background art.
2. **Every region is visibly distinct:** the canvas, columns, column headers, the three stages and cards each have their own tone. Neighbouring projects get different hues.
3. **Dense:** slim columns (268px default), with actions in headers or bars rather than extra rows. The Compact and Roomy options exist, and since 1.6 each column can be resized by dragging its edge (the top-bar ↔ button resets all of them).
4. **Sharp, readable type:**
   - column titles are 15–16px and bold, with neutral or slightly tight letter-spacing (0 to −0.015em). The one exception is the Sora Caps option: 12.5px, uppercase, +0.08em;
   - no text-shadow on text over a colour (it renders soft on Windows);
   - section and stage labels are in dark ink, never light grey. Smaller meta text (card meta, stage footers, part numbers, empty-list text, help lines, `kbd`) uses the muted grey-green `--ink-3` (#718d7d) at 10.5–12px.
5. **Nothing overlaps:** buttons get their own space; long names wrap to two lines, then shorten with "…".
6. **Feedback is quick and satisfying but brief:** most transitions and springs take 0.2–0.4s. A few effects run longer: the ripple (0.6s), the Served flash (0.7s), the composer flash (0.9s) and the looping busy line (1.1s), and the "Copied" chip stays 1.3s. Under `prefers-reduced-motion` every CSS animation and transition is cut to almost nothing; the four smooth scrolls started from `app.js` don't check it.

## Colour tokens

### Base (`:root`, which is also the Soft theme)

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` / `--canvas-2` | #dce9e1 / #cddfd4 | board background gradient (its first stop, #e4efe8, is a literal) |
| `--canvas-dot` | rgba(12,42,29,.07) | 20px dot grid on the canvas |
| `--topbar` | #fbfdfc | top bar (and the Windows title-bar overlay; on a Mac, only the window background) |
| `--topbar-h` | 48px | top bar height; must equal the title-bar overlay height (48) in `main.js` |
| `--col-edge` | #cddfd4 | the border of columns, menus and the Settings/Help dialogs |
| `--card` / `--card-edge` | #ffffff / #dfe9e3 | cards |
| `--ink` / `--ink-2` / `--ink-3` | #0c2a1d / #3c5a4b / #718d7d | text, strong to muted |
| `--line` / `--line-strong` | rgba(12,42,29,.09) / .16 | hairlines, field borders |
| `--primary` / `--primary-deep` | #0e9f6e / #057a55 | brand emerald (buttons, focus rings) |
| `--primary-soft` / `--primary-mist` | #d9f5e8 / #effaf5 | soft emerald fills (`--primary-soft` is unused) |
| `--highlight` | #b6f2cd | search match marks |
| `--rec` | #e5484d | recording pill |
| `--danger` | #dc4f3a | delete swipe, errors |
| `--aug-bg` / `--aug-edge` / `--aug-ink` | #e9f1fb / #c9dbf1 / #1d4f8c | Cooked block background, border and label text (data `used`) |
| `--aug-card` / `--aug-card-edge` | #fdfeff / #d8e5f6 | the near-white Cooked note |
| `--aug-bar` / `--aug-bar-hover` | #3a6fb5 / #2d5b98 | the Cooked accent: the note's 3px edge, the ↓ Move to Served bar and the card's ↓ Cooked button |
| `--final-bg` / `--final-edge` / `--final-ink` | #e4eee8 / #c6dccd / #0b5a3f | the light sage Served section, its border and its label (data `combined`) |
| `--final-card` / `--final-card-edge` | #fbfdfb / #d3e6da | the near-white Served text box |
| `--stage-lines` | 6 | how many lines the Cooked note and Served text show before "Show more" |
| `--frame-edge` | `linear-gradient(150deg, rgba(5,122,85,.55) 0%, rgba(12,42,29,.2) 30%, rgba(12,42,29,.17) 100%)` | the board frame's 1px edge (1.16), a gradient painted under a transparent border |
| `--frame-glow` / `--frame-hi` | rgba(16,168,116,.06) / rgba(255,255,255,.7) | the frame's faint 3px outer glow and its inner top highlight |

The `--aug-*` values are the Ocean palette (since 1.13), identical to `body.cooked-ocean`. They never show on their own, because `<body>` always carries a `cooked-*` class (see "Cooked palettes" below).

- **No band token:** there is no `--aug-band`. 1.13 removed the Cooked header band, its token (in `:root` and six palette variants) and both of its uses.
- **Dead tokens:** `--used-bg` / `--used-edge` (defined in `:root` and again in Deep), `--primary-soft` and `--accent-wash` are defined but never used, so changing them does nothing.
- **Hard-coded colours:** several theme colours are literals, not tokens: the canvas's first gradient stop (#e4efe8 Soft, #145640 Deep), the column bodies (#f6f8f7 Soft, #eef2f0 Deep), the Served accents (#047857 and rgba(4,120,87,…)), the empty-Served label ink #0b5a3f, the Served drop outline #34d399 and its drag frame #10a874. Changing `--canvas`, `--final-ink` or `--primary` alone won't recolour them.
- **Stale comments:** a few comments in `styles.css` still describe rejected looks. Above the `--aug-*` tokens: "a muted slate block with a slate-navy header band … Served … a deep-green block". At the ↓ Cooked button: "in the Cooked stage's slate". At the Cooked picker: "six preview tiles, each a mini Cooked header band" (there are four, each a mini light note). At the empty stages: "a dashed outline" (at rest the border is transparent). Trust this file and the rules themselves, not those comments; the owner rejected the slate band and the deep-green Served.

**Per-column accent tokens** are set inline on each `.column` as `--accent: <project colour>`. The derived shades are redeclared on `:root, .column, .drag-ghost`, because custom properties resolve where they are declared:

- `--accent-ink`: 68% accent mixed with #06140d (accent-coloured text);
- `--accent-tint`: 15% accent on white;
- `--accent-wash`: 4% accent on #f7faf8 (defined, but unused);
- `--accent-deep`: 80% accent on black.

### Deep theme (`body.theme-deep`, the default)

- **Canvas:** `linear-gradient(165deg, #145640, #0e3a2b 45%, #06231a)` with white dots at 3.5% (1.9 halved them from 7%). The monstera leaves are drawn in #6ee7b7 at 5–7% opacity.
- **Board frame (1.16):** `--frame-edge` is `linear-gradient(150deg, rgba(167,243,208,.72) 0%, rgba(52,211,153,.4) 28%, rgba(52,211,153,.32) 100%)` (a bright mint sheen at the top-left settling to an even emerald), `--frame-glow` rgba(52,211,153,.07), `--frame-hi` rgba(255,255,255,.06). The margin around the frame is `body`'s background, #082a1f like the top bar.
- **Top bar:** #082a1f, with white text. Since 1.16 it has no bottom border or shadow; the board frame below it draws that edge. The search box is white 9% and turns white on focus. The Windows title-bar overlay matches: #082a1f with #e7f7ee symbols. (On a Mac there is no overlay colour: the traffic lights keep macOS's own colours, and only the window background follows the theme.)
- **Columns:** since 1.9 a flat neutral body, #eef2f0, with no accent tint, a rgba(0,0,0,.2) border and a strong drop shadow.
- **Column header:** a solid gradient from `mix(accent 90%, black)` to `--accent-deep`, holding the small leaf, a white title (no shadow) and the ⋯ button in white at 92%. There is no count pill: the prompt count moved to the Cooking row in 1.8, and a test checks that `.col-head .col-count` is absent.
- **Primary:** #10a874.
- **Toasts and selection bar:** light mint (#f0fdf6) with dark text, so they stand out on the dark canvas. In Soft they are dark (#0c2a1d) with light text.

### Soft theme differences

The Soft theme is simply the `:root` values. `applyTheme()` adds a `theme-soft` class, but no CSS rule targets it; all theme styling lives in `body.theme-deep` rules. So to change Soft, edit `:root` and check that the matching Deep override still wins.

The canvas is a light green-grey gradient (#e4efe8 → #dce9e1 → #cddfd4) and the top bar is near-white (#fbfdfc). Column bodies are #f6f8f7. The column header is 24% of the column colour on white (1.18; it was `--accent-tint`, 15%) with a 34% edge below and a 3px accent line on top, and the title is in dark ink.

### Stage colours (the same in both themes)

The owner asked twice for more difference between the stages, and then, round after round, for less weight and less brightness. Where it ended (1.13): **Cooking** is white cards on the column's neutral surface, **Cooked** is a light section in a clean accent (Ocean blue by default, pickable), and **Served** is a light sage section. Both stage sections are light; the difference is carried by hue and label colour, not by heavy bands. Rejected on the way: bright violet ("girly", 1.7), a slate header band ("too ugly", 1.12), brown/caramel ("looks like shit", 1.13), and a deep-green Served block ("highlight it less", 1.10).

| Stage | Look |
| --- | --- |
| New prompts | White cards with a 3px project-accent bar on the left (`--accent-deep` in Deep theme) |
| Cooked (data `used`) | 1.13: a light section in the Cooked palette (Ocean by default): pale block (#e9f1fb, border #c9dbf1), label "COOKED · n" in #1d4f8c (no band), a white note with a 3px #3a6fb5 edge, and a full-width #3a6fb5 "↓ Move to Served" bar (hover #2d5b98). Collapsed, only the label row shows. **Empty:** only its faint name; a drop zone while dragging |
| Served (data `combined`) | 1.10: a light sage section (`--final-bg` #e4eee8, border `--final-edge` #c6dccd, faint shadow) with the header label "SERVED" in `--final-ink` #0b5a3f (no counter, no Copy all since 1.6). A near-white text box (`--final-card` #fbfdfb, border `--final-card-edge` #d3e6da) gets an emerald ring on hover and a "Copied" chip when clicked. Before 1.10 it was a deep-green gradient block; the owner asked for less emphasis because "it will always be served". **Empty:** only its faint name; a drop zone while dragging |

### Cooked palettes (1.12; light since 1.13)

Cooked is a **light section like Served**: a pale block, the label in `--aug-ink` (no dark header band), a white note with a 3px `--aug-bar` edge, and one filled accent (`--aug-bar`) for the Move to Served bar and the card's ↓ Cooked button. `body.cooked-<name>` (and `.co-<name>` for the Settings tiles) sets `--aug-bar`, `--aug-bar-hover`, `--aug-ink`, `--aug-bg`, `--aug-edge`, `--aug-card` and `--aug-card-edge`. Shadows and tints are `color-mix()` of `--aug-bar`.

| Name | Accent (bar) | Label ink | Block bg | Note |
| --- | --- | --- | --- | --- |
| **ocean** (default) | #3a6fb5 | #1d4f8c | #e9f1fb | #fdfeff |
| teal | #20807a | #145f59 | #e4f3f1 | #fcfefe |
| midnight | #2c3b63 | #1f2c4d | #e8ebf3 | #fcfcfe |
| graphite | #4a5059 | #2f343b | #eceef1 | #fdfdfd |

The `:root` `--aug-*` values are the ocean fallback; `render()` always puts one `cooked-*` class on `<body>`.

**History:** violet band (1.4–1.6, "girly") → slate band (1.7–1.11, "too ugly") → caramel and other band palettes including three browns (1.12, "looks like shit"). All three rejected looks shared the heavy dark header band; Served only started working once it became light. Don't bring back the band or brown tones.

### Project palette

See `03`. The order is emerald #0e9f6e, sky #0284c7, sun #d97706, orchid #9333ea, lime #65a30d, blossom #db2777, teal #0d9488, bark #78716c, then (1.6) indigo #4f46e5, ember #ea580c, lagoon #0891b2, ruby #dc2626, forest #15803d, fuchsia #c026d3, slate #475569, mustard #a16207, navy #1e3a8a, wine #9f1239. New projects take the first unused colour. The ⋯ menu shows them as a 9-column grid of 19px swatches. All are mid-to-dark so white header text stays readable in Deep theme.

### Highlight colours

| Name | Colour | Card background |
| --- | --- | --- |
| amber, "Check again" | #f59e0b | #fff3d4 |
| rose, "Important" | #f43f5e | #ffe4e9 |
| sky, "Idea" | #0ea5e9 | #dff3fd |
| lime, "Ready" | #65a30d | #ecf6da |

A highlighted card gets a tinted background, a 55% border, a 4px bar in the colour, and a label chip. A highlight overrides the stage look.

### Other states

- **Selected (Ctrl+click; ⌘-click on a Mac):** a 2px accent ring, a light accent background, and a round `--accent-deep` badge with the order number (top-left, white outline).
- **Drop targets:**
  - Cooked: a 2px dashed outline in `--aug-bar`, so it follows the picked Cooked palette (Ocean #3a6fb5 by default). An empty Cooked shows a 1.5px dashed `--aug-bar` frame on `--aug-bg` while anything is being dragged.
  - Served: a 2px dashed outline in #34d399. An empty Served shows a 1.5px dashed #10a874 frame on an 8% green tint while dragging.
  - Card placeholders: 2px dashed in the column's accent at 55%, on an 8% accent tint (they sit in that column's list).
  - The column placeholder (dragging a whole column) is not in an accent: a fixed emerald rgba(14,159,110,.4) in Soft, pale mint rgba(236,253,245,.35) in Deep.
- **Swipe backdrops:** red gradient for delete; green gradient (#0e9f6e) for "Move to Served" on the Cooked note.
- **Notes-list rows** (Cooked and Served): number, first line, and on hover ↑ ↓ ✎ ↩ 🗑 buttons (22px, icons 13px). The trash (`.fp-del`, 1.15) sits 3px apart from the others and is quiet grey like them; only on hover does it turn `--danger` red on a 10% red tint (the other buttons tint in the stage colour). At the slim default width a hovered row keeps about 60px for its text (checked by the suite: at least 40px; the check passes on the Mac too). The Notes toggle looks pressed (tinted background) while open; its label stays "Notes" so the word-count stats keep their room.
- **Column resize handle** (`.col-resize`): a 10px strip in the gap right of each column. On hover a 3px × 48px rounded line appears (dark ink at 30% in Soft, mint at 60% in Deep); while dragging it runs the full height and the cursor is `col-resize` everywhere.

## Typography

Fonts are bundled in `src/renderer/fonts/`, all under the OFL licence. They came from `@fontsource-variable` 5.x packages, but only the `.woff2` files were copied in; the packages are not dependencies.

| Family (CSS name) | File(s) | Used for |
| --- | --- | --- |
| Geist | geist-latin.woff2, geist-latin-ext.woff2 | All UI text and headings (`--font-ui`, `--font-head`); also the "Geist" column title option (16px / 700 / −0.01em) |
| Geist Mono | geist-mono-latin.woff2 | Timestamps and card meta, word/note stats, shortcut hints (kbd; on a Mac kbd uses the system font, see "macOS"), recording timer, part numbers (`--font-mono`) |
| Instrument Sans | instrument-sans-latin.woff2 | Column titles, **default since 1.6** (16px / 650 / 0em). Weight axis 400–700 |
| Plus Jakarta Sans | plus-jakarta-sans-latin.woff2 | Column title option (15.5px / 700 / −0.005em) |
| Onest | onest-latin.woff2 | Column title option (16px / 650 / −0.005em) |
| Sora | sora-latin.woff2 | Column title option (15px / 650 / −0.01em; the default in 1.3–1.5); "Sora Caps" option (12.5px / 700 / +0.08em / uppercase) |
| Space Grotesk | space-grotesk-latin.woff2 | Column title option (16px / 700 / −0.01em) |
| "Recaller Inter" (Inter with optical sizing) | inter-latin.woff2 | Column title option "Inter Display" (16px / 700 / −0.015em). Renamed so it doesn't clash with an installed Inter |
| Manrope | manrope-latin.woff2 | Column title option (15.5px / 800 / −0.005em) |

- **Title fonts** are applied through the variables `--title-font`, `--title-size`, `--title-weight`, `--title-track` and `--title-case`. They are set by the `body.title-*` classes and by the `.t-*` classes on the preview tiles.
- **Brand wordmark:** Geist 17px / 700 / −0.035em.
- **Section labels** (COOKING, COOKED, SERVED): Geist 11.5px / 700 / +0.045em / uppercase. (Before 1.6 these stages were called AUGMENTED and USED.) The Settings and Help section headings (`.modal-section`) are 12px.
- **Font stacks and fallback:** `font-display: block` avoids a flash of the fallback font.
  - On Windows (`:root`): `--font-ui` is Geist, "Segoe UI Variable Text", "Segoe UI", system-ui; `--font-head` the same with "Segoe UI Variable Display"; `--font-mono` is Geist Mono, "Cascadia Mono", Consolas, ui-monospace. Geist covers Latin and Latin Extended (two files); anything else falls back to Segoe UI, then system-ui. Geist Mono has Latin only (no latin-ext file).
  - On a Mac, `body.is-mac` keeps Geist and Geist Mono first and swaps the Windows fallbacks for the system fonts (SF Pro and SF Mono); see "macOS".
  - No bundled font has ✓, ↔, ⌘, ⇧, ⌥, ⌃ or ↩. The picker ticks, Help's ↔ and the Mac key symbols therefore come from a system font (Segoe on Windows, an Apple font on a Mac) and look a little different on each.
- **History:** the soft serif Fraunces was used in versions 1.0–1.2 and was removed in 1.3. Sora was the title default in 1.3–1.5. In 1.6 the owner asked for a "sharper cleaner" title font; nine candidates (Plus Jakarta Sans, Onest, Instrument Sans, Inter Tight, Red Hat Display, Schibsted Grotesk, Outfit, Figtree, Hanken Grotesk) were rendered on real headers next to Sora at 1× scale, and Instrument Sans (crisp, slightly condensed, distinct from Geist) became the default, with Plus Jakarta Sans and Onest added to the picker.
- **Licences:** each font has its OFL licence file next to it in `src/renderer/fonts/` (`INSTRUMENT-SANS-LICENSE.txt`, `PLUS-JAKARTA-SANS-LICENSE.txt`, `ONEST-LICENSE.txt`, …).

## Sizes and layout

- **Window:** default 1280×820, minimum 480×400. Top bar 48px.
- **Board frame (1.16):** `.stage` has margin 2px 12px 12px, radius 14px, `overflow: hidden`, a transparent 1px border with `--frame-edge` painted as a `border-box` background layer under it (the canvas layers are `padding-box`), and `box-shadow: 0 0 0 3px var(--frame-glow), inset 0 1px 0 var(--frame-hi)`. `body` uses `--topbar` as its background, so the shell around the frame matches the top bar in both themes. The board's scrollbar track has a 12px margin at each end so the thumb clears the round corners. Why a gradient on a background layer: `border-image` ignores `border-radius`.
- **Densities** (the default column width; a resized column uses its own width, 200–900px):

  | Setting | Column width | Card padding | Card text | Line clamp | Card gap | Column gap |
  | --- | --- | --- | --- | --- | --- | --- |
  | compact | 236px | 8/9/7/12px | 12.5px | 3 lines | 5px | 10px |
  | slim (default) | 268px | 9/10/8/13px | 13px | 4 lines | 6px | 12px |
  | roomy | 330px | 11/13/10/16px | 13.5px | 6 lines | 8px | 16px |

- **Column:** radius 16px. Header at least 46px tall; the name wraps to two lines.
- **Cooking header (1.8; plain since 1.9):** a 28px row with no background or border, text `--accent-ink`, the same 11.5px / 700 / uppercase / +0.045em type as the Cooked and Served labels, with a chevron and a flame icon. It tints to accent 9% on hover.
- **New prompt bar (1.8; soft since 1.9):** two equal flex halves, 36px tall, gap 6px, each pill with padding 0 6px (the bar itself 6px 8px 2px), 13px / 650 labels. White pills with no border at rest (1.5px transparent) and a hairline shadow; on hover a 55%-accent border and `--shadow-md`. The icons (plus, mic) are 16–17px glyphs in `--accent-deep`, with no filled square. `.col-new` is a size container: under 244px the left label switches to "New". Its content box is the column's width minus 18px (the 1px borders and the bar's padding), so Compact (236px) shows "New", Slim (268px) shows "New prompt", and any column resized to 262px or less shows "New". A draft shows "Draft" plus an 8px amber dot by the +.
- **Calm-board rules (1.9, for many columns):**
  - every column body is the same neutral (#eef2f0 in Deep, #f6f8f7 in Soft); only headers and card bars carry colour;
  - empty Cooked/Served show just their name at 60% opacity (the drop-zone frame and helper sentence appear only while dragging);
  - cards in Deep have no border, just a soft two-layer shadow;
  - canvas dots are at 3.5% white.
  Keep repeated per-column furniture light; weight belongs to content.
- **Cards:** radius 12px, no border in Deep (soft shadow). On hover, an action pill appears top-right with two buttons (1.11): the highlighter (a 26px button with a 15px icon) and **↓ Cooked**, a filled `--aug-bar` button (the Cooked accent, Ocean blue by default) with a down arrow and the word "Cooked" (white, 11.5px / 650), hover `--aug-bar-hover`. The edit pencil was removed (right-click or E edits).
- **Cooked and Served:** blocks radius 12px (light sections; neither has a header band since 1.13), inner note or box radius 9px. The text shows `--stage-lines` (6) lines with a fade. Under it, a slim full-width **Show more / Show less** bar (`.stage-more`, 24px, chevron that flips) opens it to min(56vh, 480px), scrolling inside. The Notes lists are capped at 220px. The footer gap is 4px so "n prompts · w words" fits next to Notes and the pencil at slim width.
- **Dialogs:** Settings and Help share `.modal-card`. `.modal-section` headings are 12px / 700 / uppercase / `--ink-2` with a hairline above. The Help stage cards are white with a coloured square per stage. `kbd` inside Help is forced light, because Deep theme otherwise styles `kbd` for the dark top bar.
- **Top bar:** brand, search, then (right) undo/redo, the ↔ reset-widths icon button, the sync indicator (1.17; hidden unless sync needs a look, see "Accounts and sync"), the ? help button (1.7), the settings gear. No "+ Project" button since 1.6. Disabled top-bar icon buttons are drawn at 30% opacity. Its left padding is 14px; the right padding (`calc(100vw - env(titlebar-area-x) - env(titlebar-area-width) + 12px)`) keeps clear of the Windows window controls. On a Mac the left padding is 84px, or 14px in full screen, to clear the traffic lights (see "macOS"). Below 700px of window width, the "Recaller" name and the search box's key hint are hidden.
- **Composer:**
  - radius 12px, with a 1.5px border in the accent at 45% and a soft 3px accent ring around it; the textarea grows up to 300px;
  - an attachment row, and a message row for errors with action links;
  - the bottom bar holds the mic (a 30px circle, or a red pill with timer and bars while recording), the camera, a status line, then (edit mode) delete, close (×) and Save.
- **Menus** radius 12px, **toasts** 12px, **settings dialog** 18px.
- **Scroll arrows (`.pan-btn`, restyled in 1.16):** 38px circles, 10px in from the board edges at 45% height. A solid white-to-mint gradient disc (`#fff` → `#f3f8f5`), a 1.5px ring (Chromium draws it 1px at 100% scale; at the Mac's 2× it draws a true 1.5px, see "macOS") in `color-mix(--primary 60%, #0c2a1d)` (deep emerald), a faint 3px white halo (16%) and a soft drop shadow; the chevron is `--ink-2`, 18px, stroke 2.2. Hover: ring `--primary`, chevron `--primary-deep`, `scale: 1.06`. Hidden at rest (`opacity: 0`, nudged 6px outward with `translate`); `.is-near` (pointer within 96px of that edge) or `:focus-visible` fades and slides it in over about 0.2s. They use the separate `translate` / `scale` properties so the slide and the hover grow don't fight over `transform`. A see-through frosted disc was tried and dropped: over the dark canvas it read as muddy grey. The ring came from reading the owner's "a slight border to it" as a border on the arrow; they meant the board frame. It was kept because it matches the frame, and the owner can ask for a plain disc (see `10`, message 24).

## Icons (`src/renderer/icons.js`, 24px grid, stroke width 1.8)

30 icons: `plus`, `mic`, `stop`, `copy`, `check`, `edit`, `trash`, `more`, `chevron`, `used` (check in circle, the Served icon), `restore` (circular arrow), `grip`, `pencilLine`, `arrowLeft`, `arrowRight`, `camera`, `close`, `expand`, `image`, `layers` (the "stack" icon for Cooked), `highlighter`, `arrowDown`, `arrowUp`, `width` (two bars with a double arrow: column width), `flame` (the Cooking header), `sort` (lines with a down arrow), `undo`, and since 1.17 `cloud`, `cloudOff` and `cloudAlert` (the sync indicator: one cloud outline, crossed out, or with a "!").

Four of them (`copy`, `grip`, `image`, `undo`) are defined but not used by `app.js`; the three cloud icons are used only by `account.js`. Top-bar icons (search, undo/redo, reset widths, help, gear) are inlined in `index.html`; the sync indicator's icon is set by `account.js`.

## App icon and monstera art

`build/icon.png` (512×512, the Windows icon) is generated by `npm run icon` (`scripts/make-icon.js`). The script renders the `#monstera` SVG symbol from `index.html`'s sprite onto an emerald rounded square: a 480px body inset 16px with radius 116, a diagonal gradient #63ad72 → #1f5530, a soft white radial glow (22% at the top-left), and a light leaf (#eaf6dc) tilted −16°. The Mac icon, `build/icon-mac.png`, is described under "macOS" below.

The `#monstera` symbol has three paths: a stroked stem, the leaf fill, and a midrib stroked in `var(--rib, rgba(255,255,255,.28))`. A mask cuts slits (thick lines) and holes (ellipses) into the leaf and the midrib, not the stem. Every use sets `--rib` to suit its background (the top-bar mark, column-header leaves, the empty board, the background leaves, the Deep variants and both app icons), so recolouring a leaf needs both `color` and `--rib`.

## Motion

- **Easings:** `--ease` is `cubic-bezier(.2,.8,.2,1)`; `--spring` is `cubic-bezier(.34,1.5,.64,1)`.
- **Card enter:** fade and slide, 0.32s.
- **FLIP reorder:** 0.2–0.26s.
- **Swipe spring-back:** 0.32s.
- **Copy:** a ripple of 0.6s and a chip for 1.3s.
- **Toasts:** spring in.
- **Served flash:** an expanding emerald ring, 0.7s, when text lands in Served or the Served text is copied.
- **Composer:** busy progress line (1.1s loop); recording ring grows with the input level; a 0.9s flash.

## Accounts and sync (1.17)

One block near the end of `styles.css`, just before the macOS block, styles the Settings section, the top-bar indicator and the conflict-copy tag. `account.js` builds the section and the indicator, and `app.js` fills the card tag. The strings and states are in `15_accounts_and_sync.md`, section 6. The amber used here is the Check-again amber #f59e0b, written as a literal.

- **Settings › Account & sync** (`#account`): built from the existing Settings parts (`.field`, `.help`, `.key-row`, `.btn-primary`, `.btn-ghost`) plus the classes below. The modal card is light in both themes, so none of it has a Deep variant.
  - **Layout:** `#account` is a size container. `.account-grid` puts two fields side by side (gap 10px 14px) and stacks them when the section is narrower than 520px. `.account-actions` is a wrapping row of buttons (gap 6px 8px); `.account-spacer` pushes what follows to the right.
  - **Type:** `.account-email` and `.account-title` are 13.5px / 650 in `--ink`. `.account-text` is 13px / 1.45 in `--ink-2`, with bold parts in `--ink`. The status line and notes are `--ink-2`.
  - **`.account-warn`:** a line that needs a look (another account's board, "Wait until everything is uploaded…") gets a 6px amber dot before it, like the top-bar dot. Never the red of Delete.
  - **`.account-link`:** a text button, 12.5px / 600 in `--primary-deep`, with a faint ink tint on hover. `.account-link.is-danger` ("Delete account…") is `--danger` red with an 8% red tint on hover.
  - **`.account-panel`:** every panel opens inline in the section (no stacked dialogs): white, a 1px `--card-edge` border, radius 12px, padding 12px 14px. Two variants:
    - `.is-choice`, the **mint choice panel** (Upload this board?, Your account already has a board, the mass-delete question, the missing cloud board): `--primary-mist` with a 30% `--primary` border;
    - `.is-danger`, the **faint-red delete panel**: still white, with a 40% `--danger` border.
  - **`.btn-danger`:** the one filled red button (Delete account): `--danger` with white text and a soft red shadow, darker on hover (86% `--danger` with black). **`.btn-danger-ghost`** (Delete them everywhere): red text with an 8% red tint on hover.
  - **`.account-check`:** the "Also remove this board…" checkbox row, 12.5px in `--ink-2`, with a 14px box in `--primary`.
  - **`details.privacy-note`:** 12px / 1.45; its summary, "What's stored and where", reads as a `--primary-deep` link.
  - Disabled buttons in the section are drawn at 45%, without their hover look.
- **Top-bar indicator** (`#sync-status`, an `.icon-btn` with `.sync-btn`, between ↔ and ?): hidden unless sync needs a look (`15`, 6.4). `account.js` puts the `cloud`, `cloudOff` or `cloudAlert` icon in it.
  - `.sync-dot`: a 6px amber dot at the button's top right (top 6px, right 5px), with a 1.5px ring in `--topbar` so it reads on both themes.
  - `.is-muted` (offline): the icon at 55%.
  - `.is-syncing`: the `sync-breathe` animation, the icon's opacity dipping to 0.35 and back every 1.2s, on a loop. It stops under `prefers-reduced-motion`.
- **Conflict-copy tag** (`.card-sync-tag`, in `.card-meta` after the highlight chip): "Other version" on a copy made by a sync conflict. Empty means none, and an empty tag is hidden. A pill: radius 999px, padding 0 6px, a 1px ink border at 16%, white at 70%, `--font-ui` (not the meta row's mono) 10.5px / 650 in `--ink-2`, line height 15px. It shortens with "…" only in a row narrower than itself.
  - **Wrap rule:** on a card whose tag is filled (`.card-meta:has(.card-sync-tag:not(:empty))`), the meta row may wrap onto a second line (4px row gap) when it doesn't fit, and each chip and the time stay whole (`nowrap`) instead of squeezing. Every other card's meta row is unchanged.

## macOS (the Mac edition only)

The Mac edition of 1.16.0 (branch `masos`, committed and pushed on 2026-09-29, merged into `main` on 2026-10-06) keeps the same design. Everything Mac-only in the CSS is one block at the end of `styles.css`, under `body.is-mac`. `app.js` adds that class on a Mac only, before the first render, so none of it reaches Windows. (The rest of the Mac edition is in `14_macos.md`.)

- **The top bar:**
  - `body.is-mac .topbar { padding-left: 84px; }` starts the brand after the traffic lights (they end at x 70, plus 14px);
  - `body.is-mac.is-fullscreen .topbar { padding-left: 14px; }`: in full screen the lights are hidden, so the bar gets its space back. `main.js` sends `fullscreen-on` / `fullscreen-off`, and `app.js` toggles `is-fullscreen`;
  - the right-padding formula needs no change: on a Mac it comes to 12px.
- **Traffic-light geometry:**
  - `main.js` sets `trafficLightPosition: { x: 16, y: 16 }`. The three standard buttons are 14×16pt frames, 20pt apart, so they span x 16–70 and y 16–32, centred on y 24, the middle of the 48px bar;
  - measured by the features suite on this Mac: `getWindowButtonPosition()` = {x: 16, y: 16}, and the logo at x 84 with its centre at y 24;
  - `env(titlebar-area-x)` reports 92px there (the area Electron keeps clear of the lights). The CSS uses the fixed 84px instead;
  - the lights keep macOS's colours in both themes; only the window background follows the theme.
- **Font stacks,** declared on `body.is-mac`:
  - `--font-ui` and `--font-head`: "Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  - `--font-mono`: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace.

  Geist and Geist Mono still draw all Latin text; anything else falls back to SF Pro or SF Mono instead of the Windows fonts. They are declared on `body`, not `:root`, because the `body.title-*` classes resolve `var(--font-head)` on `body`: that way the column titles and the title-picker tiles pick up the Mac stack too. The lists are written out in full on purpose, because a variable that refers to itself is invalid.
- **Key caps:** `body.is-mac kbd { font-family: -apple-system, BlinkMacSystemFont, var(--font-ui); letter-spacing: 0.04em; }`. No bundled font has ⌘ ⇧ ⌥ ⌃ ↩ (their cmap tables were checked), so the system font draws them, the way macOS menus do. On Windows, `kbd` stays in Geist Mono.
- **Labels:** the Mac key labels are text, not styling: `data-mac` / `data-mac-title` attributes in `index.html` and the `kb()` helper in `app.js` (see `04` §25).
- **Retina:** this Mac's screen is 2× (3024×1964px, 1512×982pt), while the owner's PC is 1× (a 5120×1392 ultrawide at 100%). Every size is in CSS px, so the layout is identical, but some things draw differently:
  - 1.5px borders draw at full weight at 2× (3 device px), while the 1× PC floors them to 1px. So the scroll arrows' ring and the composer ring look slightly heavier than on the PC. The same goes for the New prompt hover border, the rename field, the "+ New project" tile and the empty Cooked/Served drag frames;
  - the frame's 1px gradient edge gets two device pixels and reads stronger at 2×. The other faint effects tuned at 1× (the 3px glow, the canvas dots, the resize line) also look crisper;
  - `-webkit-font-smoothing: antialiased` (on `body`) only takes effect on a Mac, and Core Text at 2× renders text differently from DirectWrite at 1×;
  - the owner's taste was set on the 1× Windows screen. They first opened the Mac edition at the very end of the seventh session, and their view of the Mac look isn't recorded. Nothing was retuned for Retina, on purpose: wait for their review, and don't retune weights, tracking or opacities from the Mac alone;
  - the e2e suites force device scale factor 1 (so does `make-icon.js`), so the suites' captures show 1×. `SCALE=2 npm run capture` renders the board at 2× on a Mac (not run yet). The Mac icon's hidden-window capture still came back at 2× (below).
- **The Mac icon** (`build/icon-mac.png`, 1024×1024, made by `npm run icon:mac`, which runs `scripts/make-icon.js --mac`):
  - Apple's icon grid: an 824×824 rounded-square body, inset 100px (100–924), corner radius 185, in a transparent 1024px canvas;
  - the Windows icon's gradient (#63ad72 → #1f5530), radial glow and leaf, mapped from its 480px body onto the 824px one (scale 824/480);
  - a soft drop shadow under the body: `feDropShadow` dy 12, stdDeviation 7 (a 14px blur), 28% black;
  - it is rendered in a hidden 1024px window (`enableLargerThanScreen`) with `capturePage`. On this Retina Mac the capture comes back at 2× (2048px), so it is scaled to 1024 at 'best' quality. (An offscreen window's paint frame came back empty here, which is why.) The Dock icon is hidden while the script runs, so nothing flashes;
  - the capture is checked before any scaling: if it is empty, not square or smaller than 1024px, the script prints "icon:mac: no usable capture", exits with code 1 and writes nothing. That way the Mac app can't quietly ship with the Windows icon, or with a clipped capture stretched to fit. Only then is a larger capture (2048px on this Retina Mac) scaled down to exactly 1024px. The check was made this strict after the 1.16.0 dmg was built; re-run with it, the script wrote an icon byte-identical to the one the dmg was built with;
  - `package.json` `build.mac.icon` points at it, and electron-builder makes the app's 1024px `icon.icns` from it. A run from source also puts it in the Dock (`app.dock.setIcon`);
  - `npm run icon` without `--mac` behaves exactly as before, and `build/icon.png` is unchanged.

## 1.18 additions (one block before the account block in `styles.css`)

- **Eating switch** (`.eat-btn`, on the Served header): off, a quiet pill with a 26% emerald outline, the fork-and-knife icon and "Eating" in `--final-ink`; on, filled #047857 with white text, a 7px white dot blinking every 1.6 s instead of the icon, and the minutes ("Eating · 7m").
- **The column's eating dot** (`.mini-eat`): 8px #10b981 with an expanding ring (`eat-ring`, 1.8 s), before ⋯ in the header.
- **The Eating strip** (`#eating`, bottom right of `.stage`, 16px in, 18px up): white at 94% (Deep: #f0fdf6, like the toasts), radius 13, `--shadow-md`. An uppercase "EATING" label in #047857 with a ringing dot, then chips: 12% of the column colour on white with a 30% edge, radius 9, the leaf in the column colour, the name (ellipsis at 230px), the time in mono `--ink-3`, and ×. At most `max(280px, 50% − 230px)` wide, so it clears the toasts in the middle; the chips scroll sideways. While it shows, `body.has-eating .board` has 58px of bottom padding, so no column runs under it.
- **Minimized column** (`.column.is-minimized`): 46px wide, at least 190px tall, only the header showing: a full-height rounded strip in the header colour, the leaf, the name written vertically (`writing-mode: vertical-rl`, 14px, ellipsis at 300px), and at the bottom the eating dot and a count pill.
- **Groups** (`.col-group`): a lane at the board's full height, radius 18, 1px edge, a 4.5% ink tint (Deep: 4.5% white, the edge 13% mint). Its band is 36px: a chevron, the name in 11.5px / 700 / +0.06em capitals in `--ink-2` (Deep #d1fae5), "· n" in `--ink-3`, and ⋯. Folded, a 46px strip: the name written vertically in capitals and a leaf per member in its colour.
- **Claude Code toggle** (`.aug-cc`, the `terminal` icon): 22px like the pencil; filled `--aug-bar` while on.
- **Icons:** `utensils`, `terminal`, `eraser`, `minimize`, `group` join `icons.js`.
- **Eaten drawer** (`.eaten-panel`, fixed over the board's right side: 10px under the top bar, 22px in, 400px wide or the window less 44px): white, radius 16, `--shadow-lg` (Deep: a deeper shadow, no border), sliding in from the right (18px, 0.22 s). A header (fork and knife in #047857, "Eaten" 16px / 700, a count pill), a soft search field (#f1f5f3, an emerald ring on focus), filter chips (26px pills; the active one tinted in its column's colour), day labels (11px capitals in `--ink-3`, sticky), and round cards (white, radius 12, a 3px inset bar in the column's colour like a prompt card; the name 12.5px / 650, the time and "ate for" in mono `--ink-3`; the text 12.5px clamped to 4 lines with a fade; quiet text buttons Copy, Serve again in #047857, and a trash that turns red). A footer note says it is kept on this computer. While it is open the Eating strip slides left of it.
- **Eaten button** (`#open-eaten`): the fork and knife in the top bar, shown once something is eaten, with a 15px #10b981 count badge ringed in the top bar's colour.
- **Done on the strip** (`.eat-done`): a ✓ in #047857 that fills emerald on hover, where the × was.

## 1.19 additions

- **Eating strip (redesigned):** white (Deep: #f4fdf8) with a 1 px emerald edge (35%; Deep: mint 55%), a soft 4 px emerald halo and `--shadow-md` (Deep: a deep shadow), radius 16, 16 px in from the board's bottom right, at most the board's width less 32 px. The label: "EATING" 11 px / 750 / +0.07em in #047857 with a 9 px ringing dot and an 18 px #047857 count badge (two or more). Chips wrap, right-aligned, 6 px apart: 40 px tall, radius 12, 7% of the column colour on white with a 32% edge (14% and a coloured lift on hover); a 28 px rounded badge filled with the column colour holding a white leaf; the name 12.5 px / 680 (ellipsis at 260 px) over "eating · 12m" in mono 10.5 px `--ink-3`; **✓ Done**, a 28 px pill tinted 9% #047857 (filled on hover); and a 2 px sheen in the column colour sliding along the foot every 2.6 s. The board's bottom padding is the strip's measured height + 26 px (`--eating-room`).
- **1.20.6:** the strip itself is dark in both themes: `#0a2219`, a 45% `#34d399` edge, a 4 px 12% emerald halo; "EATING" in mint `#6ee7b7`, the count badge `#10b981` with `#052e1f` text; the chips are unchanged (light). The Served header's Eating pill: in a Served narrower than 262 px the Served icon goes, under 226 px the word "Eating" (the dot and time stay). A minimized stack's scrollbar: a 14 px track, the 6 px thumb 7 px off the rows. **Zoom row** in ☰ (`.menu-zoom`): the magnifier and "Zoom" like a row, then 28 px square − and + buttons with a `--line-strong` edge and the percentage in mono 12 px / 600 between them; all tint `--primary-mist` on hover.
- **Mac column drag (zoomed out):** 1.19.0 only; removed in 1.19.1 (the owner disliked it). The column drag looks as in 1.18.
- **Widget:** the column picker is a 32 px pill tinted 16% of the column colour with a 45% edge, the leaf in the colour, the name in the title font 14 px / 650 (white in Deep), a chevron at 70%. The stage margin shrinks to 8 px and the board padding to 8 px. Eating chips there are 32 px badges with only the time; the shown column's chip has a 2 px ring in its colour. The top-bar glyph is a window with a smaller window inside; in the widget it is four outward arrows.

## 1.20 additions

- **Group drag:** the ghost is a small card, not a clone of the lane: white, radius 12, 38 px tall, a 1 px `--col-edge` border, the group's leaves (13 px, tilted −14°, up to 8) in their colours, the name in 11.5 px / 700 / +0.06em capitals and "· n" in `--ink-3`; lifted it tilts 1.4° and scales 1.03 with `--shadow-lg`. The slot is the usual dashed `.col-placeholder` at the group's size (radius 18, at least 190 px tall). A landed group flashes a 3 px emerald ring that fades in 0.4 s (`.is-landed`).
- **Notepad:** the top-bar icon is a page with three lines (`#open-notepad`, pressed look while open). The drawer copies Eaten's frame (fixed, 10 px under the top bar, 22 px in, 420 px wide, radius 16, white, `--shadow-lg`, Deep: a deeper shadow and no border; slides in 18 px over 0.22 s). Header: the page icon in `--primary-deep`, "Notepad" 16 px / 700, then a quiet **Copy** text button and ×. The page: a text area filling the drawer, 14 px Geist at 1.6 line height, `#fbfcfb` with a 1 px `--line` border and radius 12, turning white with an emerald ring on focus. Other versions: amber boxes (`#fff8e8`, a 45% `#f59e0b` edge, radius 10, 12.5 px text, at most 140 px then scrolling) with **Add to the page** and **Delete** (red on hover). Footer: 11 px `--ink-3`, the save status left and the Ctrl J hint right (its key cap forced light, as in Help). The Eating strip slides left of it, as for Eaten.
- **Column drags** no longer light up empty Cooked and Served sections (`body.is-col-drag` turns off the seven `body.is-dragging` drop-zone rules).

## 1.20.1 additions

- **Top bar:** five icon buttons (Eaten, widget, ↔, ?, gear) became rows of a ☰ dropdown, so the bar reads: search … Notepad pill, +, ↶ ↷ |, cloud, ☰. The dropdown (`.app-menu`) shares the `.menu` look (white, radius 12, `--shadow-lg`), 248 px wide, with each row's icon, label and, for help and settings, a light key cap; Eaten's count is the green badge, inline.
- **Notepad pill:** 32 px tall, radius 999, padding 0 14 0 11, 13 px / 650 Geist, a 17 px page icon; Soft: 12% `--primary` fill, a 45% `--primary` edge, `--primary-deep` text; Deep: mint at 14% with a 42% mint edge and #d1fae5 text, brighter on hover; open: filled emerald (#10a874 in Deep) with white text and a soft emerald shadow. The one tinted, labelled control on the bar, so it reads as the main action there.
- **I-beam:** a 16 × 24 SVG, two curved serifs and a stem in #0c2a1d at 1.4 px over a 3.4 px white stroke, hotspot (8, 12), for the notepad's page and Eaten's search.

## 1.20.2: minimized columns

- **The row:** 184 px wide (the stack's width), at least 40 px tall, radius 12, the column's own header look (Deep: the dark gradient; Soft: the 24% tint with its 3 px accent line on top), padding 6 / 10 / 6 / 12, the leaf, the name in the title font at 13.5 px on one line with an ellipsis, then the Eating dot and the count pill. Hover lifts the brightness 6%.
- **The stack:** `.mini-stack`, a flex column 184 px wide with 6 px gaps, top-aligned among the columns. It replaces the 46 px vertical strips of 1.18–1.20.1 (names written downward, strips of uneven height), which the owner found odd and unreadable. Compared side by side: even upward strips (still vertical) and 164 px horizontal cards (one slot each); the stack won.
- **Board scrollbar (1.20.3):** `--board-bar` 28 px tall, the thumb inset 4 px (20 px visible, radius 999), 2 px inset (24 px) on hover or while held; the track keeps its 12 px margins clear of the frame's corners. The owner drags it a lot. The Eating strip's foot sits `--board-bar` + 10 px above the board's bottom, so it never covers the bar.
- **Stack scrolling (1.20.3):** a `.mini-stack` is at most the board's height and scrolls on its own, with a 6 px thumb (ink 22%; Deep: white 28%).
