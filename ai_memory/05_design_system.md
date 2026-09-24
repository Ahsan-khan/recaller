# 05: Design system

All styling is in `src/renderer/styles.css`, driven by CSS custom properties.

- **Theme** is a class on `<body>`: `theme-deep` (default) or `theme-soft`.
- **Density:** `density-compact`, `density-slim` or `density-roomy`.
- **Column title font:** `title-sora`, `title-space`, `title-inter`, `title-manrope`, `title-geist` or `title-caps`.

The renderer swaps these classes in `render()` and `applyTheme()`.

## Design principles (from the owner's feedback)

1. **Nature and monstera, but modern:** deep forest greens, emerald accents, a monstera leaf in the logo and as faint background art.
2. **Every region is visibly distinct:** the canvas, columns, column headers, the three stages and cards each have their own tone. Neighbouring projects get different hues.
3. **Dense:** slim columns (268px default), with actions in headers or bars rather than extra rows. The Compact and Roomy options exist.
4. **Sharp, readable type:**
   - titles are at least 15px and bold, with neutral letter-spacing;
   - no text-shadow on text over a colour (it renders soft on Windows);
   - small labels in dark ink, never light grey.
5. **Nothing overlaps:** buttons get their own space; long names wrap to two lines, then shorten with "…".
6. **Feedback is quick and satisfying but brief:** ripples, chips, flashes and spring animations of 0.2–0.4s. All motion is reduced under `prefers-reduced-motion`.

## Colour tokens

### Base (`:root`, which is also the Soft theme)

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` / `--canvas-2` | #dce9e1 / #cddfd4 | board background gradient |
| `--canvas-dot` | rgba(12,42,29,.07) | 20px dot grid on the canvas |
| `--topbar` | #fbfdfc | top bar (and Windows title-bar overlay) |
| `--card` / `--card-edge` | #ffffff / #dfe9e3 | cards |
| `--ink` / `--ink-2` / `--ink-3` | #0c2a1d / #3c5a4b / #718d7d | text, strong to muted |
| `--line` / `--line-strong` | rgba(12,42,29,.09) / .16 | hairlines, field borders |
| `--primary` / `--primary-deep` | #0e9f6e / #057a55 | brand emerald (buttons, focus rings) |
| `--primary-soft` / `--primary-mist` | #d9f5e8 / #effaf5 | soft emerald fills |
| `--highlight` | #b6f2cd | search match marks |
| `--rec` | #e5484d | recording pill |
| `--danger` | #dc4f3a | delete swipe, errors |
| `--aug-bg` / `--aug-edge` / `--aug-ink` / `--aug-card` / `--aug-bar` | #e8ebfb / #c3cbf1 / #3b46a0 / #fafbff / #6366f1 | Augmented stage (indigo) |

**Per-column accent tokens** are set inline on each `.column` as `--accent: <project colour>`. The derived shades are redeclared on `:root, .column, .drag-ghost`, because custom properties resolve where they are declared:

- `--accent-ink`: 68% accent mixed with #06140d (accent-coloured text);
- `--accent-tint`: 15% accent on white;
- `--accent-wash`: 4% accent on #f7faf8;
- `--accent-deep`: 80% accent on black.

### Deep theme (`body.theme-deep`, the default)

- **Canvas:** `linear-gradient(165deg, #145640, #0e3a2b 45%, #06231a)` with white 7% dots. The monstera leaves are drawn in #6ee7b7 at 5–7% opacity.
- **Top bar:** #082a1f, with white text. The search box is white 9% and turns white on focus. The Windows title-bar overlay matches: #082a1f with #e7f7ee symbols.
- **Columns:** a light body (`color-mix(accent 7%, #f3f7f4)`) with a strong drop shadow.
- **Column header:** a solid gradient from `mix(accent 90%, black)` to `--accent-deep`, with a white title (no shadow), a white-22% count pill, and white header buttons.
- **Primary:** #10a874.
- **Toasts and selection bar:** light mint (#f0fdf6) with dark text, so they stand out on the dark canvas. In Soft they are dark (#0c2a1d) with light text.

### Soft theme differences

The canvas is a light green-grey gradient and the top bar is white. The column header is `--accent-tint` with a 3px accent line on top, and the title is in dark ink.

### Stage colours (the same in both themes)

| Stage | Look |
| --- | --- |
| New prompts | White cards with a 3px project-accent bar on the left (`--accent-deep` in Deep theme) |
| Augmented (data `used`) | Indigo tray (#e8ebfb, border #c3cbf1), header text #3b46a0. One white note with a 3px #6366f1 bar. A full-width #6366f1 "↓ Move to Used" bar (hover #4f46e5) |
| Used (data `combined`) | A deep-green block with gradient #11523c → #0b3a2a (border #0a2f22), header text #d1fae5, a **Copy all** button in #34d399 with #053b28 text (white when "Copied"), and a white inner text box |

### Project palette

See `03`. The order is emerald #0e9f6e, sky #0284c7, sun #d97706, orchid #9333ea, lime #65a30d, blossom #db2777, teal #0d9488, bark #78716c. New projects take the first unused colour.

### Highlight colours

| Name | Colour | Card background |
| --- | --- | --- |
| amber, "Check again" | #f59e0b | #fff3d4 |
| rose, "Important" | #f43f5e | #ffe4e9 |
| sky, "Idea" | #0ea5e9 | #dff3fd |
| lime, "Ready" | #65a30d | #ecf6da |

A highlighted card gets a tinted background, a 55% border, a 4px bar in the colour, and a label chip. A highlight overrides the stage look.

### Other states

- **Selected (Ctrl+click):** a 2px accent ring, a light accent background, and a round `--accent-deep` badge with the order number (top-left, white outline).
- **Drop targets:** a dashed outline (Augmented in indigo, Used in #34d399). Dashed placeholders in the accent colour.
- **Swipe backdrops:** red gradient for delete; green gradient (#0e9f6e) for "Move to Used" on the Augmented note.

## Typography

Fonts are bundled in `src/renderer/fonts/`, all under the OFL licence. They came from `@fontsource-variable` 5.x packages, but only the `.woff2` files were copied in; the packages are not dependencies.

| Family (CSS name) | File(s) | Used for |
| --- | --- | --- |
| Geist | geist-latin.woff2, geist-latin-ext.woff2 | All UI text and headings (`--font-ui`, `--font-head`) |
| Geist Mono | geist-mono-latin.woff2 | Timestamps and card meta, word/note stats, shortcut hints (kbd), recording timer, part numbers (`--font-mono`) |
| Sora | sora-latin.woff2 | Column titles, default (15px / 650 / −0.01em); "Sora Caps" option (12.5px / 700 / +0.08em / uppercase) |
| Space Grotesk | space-grotesk-latin.woff2 | Column title option (16px / 700 / −0.01em) |
| "Recaller Inter" (Inter with optical sizing) | inter-latin.woff2 | Column title option "Inter Display" (16px / 700 / −0.015em). Renamed so it doesn't clash with an installed Inter |
| Manrope | manrope-latin.woff2 | Column title option (15.5px / 800 / −0.005em) |

- **Title fonts** are applied through the variables `--title-font`, `--title-size`, `--title-weight`, `--title-track` and `--title-case`. They are set by the `body.title-*` classes and by the `.t-*` classes on the preview tiles.
- **Brand wordmark:** Geist 17px / 700 / −0.035em.
- **Section labels** ("AUGMENTED", "USED"): Geist 11.5px / 700 / +0.045em / uppercase.
- **Font loading:** `font-display: block` avoids a flash of the fallback font. Characters outside the Latin set fall back to Geist latin-ext, then Segoe UI.
- **History:** the soft serif Fraunces was used in versions 1.0–1.2 and was removed in 1.3.

## Sizes and layout

- **Window:** default 1280×820, minimum 480×400. Top bar 48px.
- **Densities:**

  | Setting | Column width | Card padding | Card text | Line clamp | Card gap | Column gap |
  | --- | --- | --- | --- | --- | --- | --- |
  | compact | 236px | 8/9/7/12px | 12.5px | 3 lines | 5px | 10px |
  | slim (default) | 268px | 9/10/8/13px | 13px | 4 lines | 6px | 12px |
  | roomy | 330px | 11/13/10/16px | 13.5px | 6 lines | 8px | 16px |

- **Column:** radius 16px. Header at least 46px tall; the name wraps to two lines.
- **New prompt bar:** 36px tall; the plus sits in a 22px `--accent-deep` square. A 36px square mic button sits beside it.
- **Cards:** radius 12px. On hover, an action pill appears top-right (highlighter, stack "to Augmented", edit) with 26px buttons.
- **Augmented and Used:** trays radius 12px, inner note or box radius 9px, combined text clamped to 8 lines with a fade until "Show all".
- **Composer:**
  - radius 12px with an accent ring; the textarea grows up to 300px;
  - an attachment row, and a message row for errors with action links;
  - the bottom bar holds the mic (a 30px circle, or a red pill with timer and bars while recording), the camera, a status line, then (edit mode) delete, close (×) and Save.
- **Menus** radius 12px, **toasts** 12px, **settings dialog** 18px.
- **Scroll arrows:** 36px circles on the board edges.

## Icons (`src/renderer/icons.js`, 24px stroke, 1.8 width)

`plus`, `mic`, `stop`, `copy`, `check`, `edit`, `trash`, `more`, `chevron`, `used` (check in circle), `restore` (circular arrow), `grip`, `pencilLine`, `arrowLeft`, `arrowRight`, `arrowDown`, `camera`, `close`, `expand`, `image`, `layers` (the "stack" icon for Augmented), `highlighter`, `undo`.

Top-bar icons (search, undo/redo, gear) are inlined in `index.html`.

## App icon and monstera art

`build/icon.png` (512×512) is generated by `npm run icon` (`scripts/make-icon.js`). The script renders the `#monstera` SVG symbol from `index.html`'s sprite onto an emerald rounded square (gradient #63ad72 → #1f5530, with a light leaf).

The leaf is one path, with a mask cutting slits (thick lines) and holes (ellipses). The same symbol is used for the top-bar mark, column-header leaves, the empty board and the background leaves.

## Motion

- **Easings:** `--ease` is `cubic-bezier(.2,.8,.2,1)`; `--spring` is `cubic-bezier(.34,1.5,.64,1)`.
- **Card enter:** fade and slide, 0.32s.
- **FLIP reorder:** 0.2–0.26s.
- **Swipe spring-back:** 0.32s.
- **Copy:** a ripple of 0.6s and a chip for 1.3s.
- **Toasts:** spring in.
- **Used flash:** an expanding emerald ring, 0.7s.
- **Composer:** busy progress line; recording ring grows with the input level.
