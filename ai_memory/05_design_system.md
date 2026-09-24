# 05: Design system

All styling is in `src/renderer/styles.css`, driven by CSS custom properties.

- **Theme** is a class on `<body>`: `theme-deep` (default) or `theme-soft`.
- **Density:** `density-compact`, `density-slim` or `density-roomy`.
- **Column title font:** `title-instrument` (default), `title-jakarta`, `title-onest`, `title-sora`, `title-space`, `title-inter`, `title-manrope`, `title-geist` or `title-caps`.

The renderer swaps these classes in `render()` and `applyTheme()`.

## Design principles (from the owner's feedback)

1. **Nature and monstera, but modern:** deep forest greens, emerald accents, a monstera leaf in the logo and as faint background art.
2. **Every region is visibly distinct:** the canvas, columns, column headers, the three stages and cards each have their own tone. Neighbouring projects get different hues.
3. **Dense:** slim columns (268px default), with actions in headers or bars rather than extra rows. The Compact and Roomy options exist, and since 1.6 each column can be resized by dragging its edge (the top-bar ↔ button resets all of them).
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
| `--aug-bg` / `--aug-edge` / `--aug-ink` | #e6e9ef / #c9cfda / #334058 | Cooked block background, border, text (data `used`) |
| `--aug-card` / `--aug-card-edge` | #f9fafc / #d6dbe4 | the near-white Cooked note |
| `--aug-bar` / `--aug-bar-hover` / `--aug-band` | #3f4a62 / #2f384c / gradient #47526b → #384259 | Cooked accent bar, Move to Served bar, and the slate-navy header band |
| `--final-card` / `--final-card-edge` | #f3f8f5 / #cfe3d6 | the pale mint Served text box (data `combined`) |
| `--stage-lines` | 6 | how many lines the Cooked note and Served text show before "Show more" |

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

The owner asked twice for more difference between the stages. Since 1.6 each stage has its own frame *and* its own "paper". In 1.7 they then rejected the bright violet as "weird", "girly" and too bright, and asked for "modern and adult". So Cooked is now muted slate. Keep stage colours low in saturation; the saturated colour belongs to the column headers.

| Stage | Look |
| --- | --- |
| New prompts | White cards with a 3px project-accent bar on the left (`--accent-deep` in Deep theme) |
| Cooked (data `used`) | Pale cool-grey block (#e6e9ef, border #c9cfda, soft slate shadow) with a slate-navy header band (`--aug-band`) and white uppercase label "COOKED · n". One near-white note (#f9fafc, border #d6dbe4) with a 3px #3f4a62 bar. A full-width #3f4a62 "↓ Move to Served" bar (hover #2f384c). Collapsed, only the band shows. **Empty:** transparent with a 1.5px dashed slate outline and a slate label; it fills in while dragging |
| Served (data `combined`) | A deep-green block with gradient #11523c → #0b3a2a (border #0a2f22), header label "SERVED" in #d1fae5 (no counter, no Copy all since 1.6), and a pale mint text box (#f3f8f5, border #cfe3d6) that gets an emerald ring on hover and a "Copied" chip when clicked. **Empty:** a dashed green outline with a green label |

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

- **Selected (Ctrl+click):** a 2px accent ring, a light accent background, and a round `--accent-deep` badge with the order number (top-left, white outline).
- **Drop targets:** a dashed outline (Cooked in slate #3f4a62, Served in #34d399). Dashed placeholders in the accent colour.
- **Swipe backdrops:** red gradient for delete; green gradient (#0e9f6e) for "Move to Served" on the Cooked note.
- **Notes-list rows** (Cooked and Served): number, first line, and on hover ↑ ↓ ✎ ↩ buttons (22px). The Notes toggle looks pressed (tinted background) while open; its label stays "Notes" so the word-count stats keep their room.
- **Column resize handle** (`.col-resize`): a 10px strip in the gap right of each column. On hover a 3px × 48px rounded line appears (dark ink at 30% in Soft, mint at 60% in Deep); while dragging it runs the full height and the cursor is `col-resize` everywhere.

## Typography

Fonts are bundled in `src/renderer/fonts/`, all under the OFL licence. They came from `@fontsource-variable` 5.x packages, but only the `.woff2` files were copied in; the packages are not dependencies.

| Family (CSS name) | File(s) | Used for |
| --- | --- | --- |
| Geist | geist-latin.woff2, geist-latin-ext.woff2 | All UI text and headings (`--font-ui`, `--font-head`) |
| Geist Mono | geist-mono-latin.woff2 | Timestamps and card meta, word/note stats, shortcut hints (kbd), recording timer, part numbers (`--font-mono`) |
| Instrument Sans | instrument-sans-latin.woff2 | Column titles, **default since 1.6** (16px / 650 / 0em). Weight axis 400–700 |
| Plus Jakarta Sans | plus-jakarta-sans-latin.woff2 | Column title option (15.5px / 700 / −0.005em) |
| Onest | onest-latin.woff2 | Column title option (16px / 650 / −0.005em) |
| Sora | sora-latin.woff2 | Column title option (15px / 650 / −0.01em; the default in 1.3–1.5); "Sora Caps" option (12.5px / 700 / +0.08em / uppercase) |
| Space Grotesk | space-grotesk-latin.woff2 | Column title option (16px / 700 / −0.01em) |
| "Recaller Inter" (Inter with optical sizing) | inter-latin.woff2 | Column title option "Inter Display" (16px / 700 / −0.015em). Renamed so it doesn't clash with an installed Inter |
| Manrope | manrope-latin.woff2 | Column title option (15.5px / 800 / −0.005em) |

- **Title fonts** are applied through the variables `--title-font`, `--title-size`, `--title-weight`, `--title-track` and `--title-case`. They are set by the `body.title-*` classes and by the `.t-*` classes on the preview tiles.
- **Brand wordmark:** Geist 17px / 700 / −0.035em.
- **Section labels** ("AUGMENTED", "USED"): Geist 11.5px / 700 / +0.045em / uppercase.
- **Font loading:** `font-display: block` avoids a flash of the fallback font. Characters outside the Latin set fall back to Geist latin-ext, then Segoe UI.
- **History:** the soft serif Fraunces was used in versions 1.0–1.2 and was removed in 1.3. Sora was the title default in 1.3–1.5. In 1.6 the owner asked for a "sharper cleaner" title font; nine candidates (Plus Jakarta Sans, Onest, Instrument Sans, Inter Tight, Red Hat Display, Schibsted Grotesk, Outfit, Figtree, Hanken Grotesk) were rendered on real headers next to Sora at 1× scale, and Instrument Sans (crisp, slightly condensed, distinct from Geist) became the default, with Plus Jakarta Sans and Onest added to the picker.
- **Licences:** each font has its OFL licence file next to it in `src/renderer/fonts/` (`INSTRUMENT-SANS-LICENSE.txt`, `PLUS-JAKARTA-SANS-LICENSE.txt`, `ONEST-LICENSE.txt`, …).

## Sizes and layout

- **Window:** default 1280×820, minimum 480×400. Top bar 48px.
- **Densities** (the default column width; a resized column uses its own width, 200–900px):

  | Setting | Column width | Card padding | Card text | Line clamp | Card gap | Column gap |
  | --- | --- | --- | --- | --- | --- | --- |
  | compact | 236px | 8/9/7/12px | 12.5px | 3 lines | 5px | 10px |
  | slim (default) | 268px | 9/10/8/13px | 13px | 4 lines | 6px | 12px |
  | roomy | 330px | 11/13/10/16px | 13.5px | 6 lines | 8px | 16px |

- **Column:** radius 16px. Header at least 46px tall; the name wraps to two lines.
- **Cooking header (1.8; plain since 1.9):** a 28px row with no background or border, text `--accent-ink`, the same 11.5px / 700 / uppercase / +0.045em type as the Cooked and Served labels, with a chevron and a flame icon. It tints to accent 9% on hover.
- **New prompt bar (1.8; soft since 1.9):** two equal flex halves, 36px tall, gap 6px, padding 0 6px, 13px / 650 labels. White pills with no border at rest (1.5px transparent) and a hairline shadow; on hover a 55%-accent border and `--shadow-md`. The icons (plus, mic) are 16–17px glyphs in `--accent-deep`, with no filled square. `.col-new` is a size container: under 244px the left label switches to "New". A draft shows "Draft" plus an 8px amber dot by the +.
- **Calm-board rules (1.9, for many columns):**
  - every column body is the same neutral (#eef2f0 in Deep, #f6f8f7 in Soft); only headers and card bars carry colour;
  - empty Cooked/Served show just their name at 60% opacity (the drop-zone frame and helper sentence appear only while dragging);
  - cards in Deep have no border, just a soft two-layer shadow;
  - canvas dots are at 3.5% white.
  Keep repeated per-column furniture light; weight belongs to content.
- **Cards:** radius 12px. On hover, an action pill appears top-right (highlighter, stack "to Cooked", edit) with 26px buttons.
- **Cooked and Served:** blocks radius 12px (Cooked's header band 11px top corners), inner note or box radius 9px. The text shows `--stage-lines` (6) lines with a fade. Under it, a slim full-width **Show more / Show less** bar (`.stage-more`, 24px, chevron that flips) opens it to min(56vh, 480px), scrolling inside. The Notes lists are capped at 220px. The footer gap is 4px so "n prompts · w words" fits next to Notes and the pencil at slim width.
- **Dialogs:** Settings and Help share `.modal-card`. `.modal-section` headings are 12px / 700 / uppercase / `--ink-2` with a hairline above. The Help stage cards are white with a coloured square per stage. `kbd` inside Help is forced light, because Deep theme otherwise styles `kbd` for the dark top bar.
- **Top bar:** brand, search, then (right) undo/redo, the ↔ reset-widths icon button, the ? help button (1.7), the settings gear. No "+ Project" button since 1.6. Disabled top-bar icon buttons are drawn at 30% opacity.
- **Composer:**
  - radius 12px with an accent ring; the textarea grows up to 300px;
  - an attachment row, and a message row for errors with action links;
  - the bottom bar holds the mic (a 30px circle, or a red pill with timer and bars while recording), the camera, a status line, then (edit mode) delete, close (×) and Save.
- **Menus** radius 12px, **toasts** 12px, **settings dialog** 18px.
- **Scroll arrows:** 36px circles on the board edges.

## Icons (`src/renderer/icons.js`, 24px stroke, 1.8 width)

`plus`, `mic`, `stop`, `copy`, `check`, `edit`, `trash`, `more`, `chevron`, `used` (check in circle, the Served icon), `restore` (circular arrow), `grip`, `pencilLine`, `arrowLeft`, `arrowRight`, `arrowDown`, `arrowUp`, `width` (two bars with a double arrow: column width), `sort` (lines with a down arrow), `camera`, `close`, `expand`, `image`, `layers` (the "stack" icon for Cooked), `highlighter`, `undo`.

Top-bar icons (search, undo/redo, reset widths, help, gear) are inlined in `index.html`.

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
- **Served flash:** an expanding emerald ring, 0.7s, when text lands in Served or the Served text is copied.
- **Composer:** busy progress line; recording ring grows with the input level.
