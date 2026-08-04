# Du კოლონის ფორმვორკის რედაქტორი (v2)

2D drag-and-drop editor for **Du column formwork** — a metric (cm) drawing surface where
materials are placed at their approximately correct real-world size, with a live bill of
materials, inventory tracking and Excel/PDF export.

Rebuilt from the single-file prototype `Du-Formwork-Editor.html` (kept in the repo as the v1
reference) into a React + Vite + TypeScript project.

---

## Running it

Requires **Node.js 18+**. This machine has Node v24.18.1 installed at
`~/.local/node-v24.18.1-darwin-arm64/`; put it on your `PATH` with:

```bash
echo 'export PATH="$HOME/.local/node-v24.18.1-darwin-arm64/bin:$PATH"' >> ~/.zshrc
```

Then:

```bash
npm install && npm run dev
```

Then open the URL Vite prints — <http://localhost:5173> by default.

| script | what it does |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck (`tsc --noEmit`) then production build into `dist/` |
| `npm run preview` | serve the production build |
| `npm run typecheck` | types only |
| `npm test` | Vitest suite (100 tests over the pure logic) |
| `npm run test:watch` | tests in watch mode |

### Deploying it

`npm run build` produces a fully static `dist/` — no server code, no API, no database. Copy
it to any static host (a company file share served over HTTP, Netlify, GitHub Pages, an
nginx directory) and it runs. All data lives in the browser's `localStorage` per machine, so
share the **catalog JSON** to keep component data and stock in step across computers.

---

## Project layout

```
src/
  types.ts               Material, Piece, Category, Shape, file formats
  data/
    categories.ts        the 7 fixed categories: Georgian label + default colour
    seedCatalog.ts       the 41 built-in Du materials (verbatim from v1)
  store/
    useEditorStore.ts    single Zustand store + localStorage autosave
  lib/
    geometry.ts          world↔screen maths, bounds, snapping, ruler steps
    shapePath.ts         rect / L / line geometry, shared by SVG + canvas renderers
    bom.ts               live bill-of-materials aggregation
    excelExport.ts       SheetJS: BOM → .xlsx / .csv, catalog → .xlsx
    pdfExport.ts         html2canvas + jsPDF: printable BOM, paginated onto A4
    snapshot.ts          renders the drawing to a PNG for the PDF
    sheetImport.ts       SheetJS: bulk component import + validation
    catalogFile.ts       catalog/layout JSON export + import (incl. v1 layouts)
    files.ts             download / file-picker helpers
    ids.ts               stable material ids, piece ids
  components/            Header, Palette, StageCanvas, PieceView, LabelLayer,
                         Rulers, SidePanel, DetailsPanel, BomPanel,
                         InventoryPanel, MaterialFormDialog, SheetImportDialog,
                         Modal, ConfirmDialog, ShapeSvg
```

---

## Rendering choice: DOM + CSS transform (not react-konva)

The canvas keeps the prototype's approach — absolutely positioned `div`s inside a `#world`
layer that carries `translate(panX, panY) scale(zoom)` — for three reasons:

1. **Hit-testing is free.** Each piece is a real DOM node, so selection and drag are plain
   pointer events; no manual bounding-box maths, no separate hit graph.
2. **Labels are the hard part, and HTML is better at text.** Always-visible dimension
   labels need real text layout, ellipsis, and DOM-cheap re-flow on every pan/zoom. Konva
   would mean measuring text manually anyway.
3. **Less machinery.** No extra rendering library, no stage/layer lifecycle, and shapes are
   ordinary inline SVG that the palette swatch reuses verbatim.

Konva would win if the drawing grew to thousands of pieces or needed free rotation and
snapping guides. At the scale of a column formwork layout (tens to a few hundred pieces)
the DOM approach is comfortably fast and much easier to maintain.

### Canvas maths

World units are centimetres. The world layer is drawn at 1 cm = 1 px and then transformed:

```
screen = world * zoom + pan
world  = (screen - pan) / zoom
```

so `zoom` is literally *screen pixels per centimetre*.

### The drawing is a PLAN view

This is the single most important thing to understand about the model. A name like
**„პანელი 30*300"** means **30 cm wide and 300 cm tall**. The 300 is *height* — it points
vertically, up out of the page — so it is **not** drawn. What you see is the panel's width
and its thickness:

| field | meaning | drawn? |
| --- | --- | --- |
| `w` | width along the column face (30) | **yes** |
| `h` | height of the pour (300) | no — drives area, labels and panel courses |
| `depth` | plan thickness — **9 cm for every Du panel** | **yes** |

So a 30×300 panel appears as a 30 × 9 bar. `planW()` / `planH()` in `lib/geometry.ts` are the
only sanctioned way to ask how big a piece is on screen; everything that positions, hit-tests,
snaps, prints or bounds a piece goes through them. `defaultDepth()` in `data/seedCatalog.ts`
assigns thickness per category: 9 cm for panels and fillers, the square cross-section for
corners and posts, and the existing profile for walers, tie rods and accessories.

### Rotation

`Piece.rot` is **any angle in degrees**, not just quarter turns. `R` and the toolbar button
still step by 90° because that is the common case; the Details tab has an exact degree field
and a slider.

Rotation happens about a piece's **centre**, so `Piece.x/y` — the top-left of the *un-rotated*
box — is not where a turned piece's footprint starts. `rotatedExtent()` gives the true
on-screen extents at any angle, `pieceBounds()` the axis-aligned box, and the column wizard's
`placeAt()` converts "put the footprint's corner here" into the x/y to store. Getting that
wrong is exactly what made the first plan-view column land its turned faces off the concrete.

---

## Features

### Editor (all v1 behaviour preserved)

Drag-drop placement at true cm scale · click to select · drag to move · `R` rotate 90° ·
`Del` delete · snap-to-grid with a 1/5/10/25 cm step · wheel zoom (cursor-anchored) and
zoom buttons · fit-to-content · space+drag or middle-mouse pan · cm rulers · dark Georgian
UI · layout JSON export/import (also reads **v1 prototype layout files**, which referenced
materials by array index).

### 0 — Editing that survives real use

Shortcuts are written below with the macOS symbols; on Windows and Linux `⌘` is `Ctrl` and
`⌫` is `Del`. **The interface relabels itself** — see [Keyboard](#keyboard).

* **Undo / redo** — `⌘Z` / `⌘⇧Z` (or `Ctrl`), plus toolbar buttons. A drag, an array, a
  catalog edit or a bulk import is one step each; live dragging does not flood the history.
  Depth 80.
* **Multi-piece editing** — drag on empty surface for a rubber-band select, `Shift`-click to
  add or remove, `⌘A` to select all. Move, rotate, duplicate and delete all act on the whole
  selection; dragging any selected piece moves the group.
* **Duplicate and clipboard** — `⌘D` duplicates in place, `⌘C` / `⌘V` copy and paste, each
  offset by one grid step. Repeated pasting keeps stepping away from the original.
* **Arrow-key nudge** — one grid step per press, or exactly 1 cm with `Shift`.
* **Array tool** — repeat the selection N times along X or Y at a fixed pitch. The pitch
  defaults to the selected piece's own width, so panels butt together; a negative pitch
  arrays the other way. This is the fast path for a run of panels or a ladder of walers.
* **Named drawings** — a drawing picker in the title bar plus a manager for
  new / switch / rename / duplicate / delete. The catalog and stock are company-wide and
  shared across every drawing; a drawing only owns its placed pieces.
* **Storage safety** — if `localStorage` is full or blocked, a banner warns that autosave
  failed rather than losing work quietly, and the app keeps running.

### Tier 2 — formwork, not just shapes

* **Column wizard** (`🏛 კოლონა`) — give it a cross-section and a pour height and it builds
  the whole assembly in plan: four panel faces closing a box around the concrete, L-corners
  at the four corners, waler rings outside the faces and tie rods across. Counts flow
  straight into the BOM, which is the point.

  It is deliberately conservative about accuracy. Panels only cover what is left *between*
  the corner profiles; walers are sized per face rather than one bar spanning everything;
  and where the catalog cannot satisfy the geometry (an odd face width, a height that does
  not divide into available panel heights) it **warns instead of rounding** — an under-count
  here is a short delivery on site.

  **Exact cover, not greedy.** Face widths and course heights are solved with a small
  dynamic program that finds the fewest pieces summing to exactly the target. Greedy
  largest-first is the obvious approach and it is wrong: a 105 cm face has an exact
  75 + 30 answer, but greedy takes the 90 and strands 15, so the wizard reported a shortfall
  that did not exist. A 180 cm pour is 90 + 90; greedy takes 150 and strands 30.

  **Fillers close what panels cannot.** ჩაკერება are searched separately, and only after
  the panels have covered something — a 70 cm face is a 60 panel plus a 10 filler. Throwing
  fillers into one combined search instead lets a face with no fitting panel be "solved"
  with a dozen 5 cm strips, which is not an answer; there, the wizard says so.

  **Corners are set in by the panel they stand off.** A corner leg is measured from the
  outside of the box, so a 24 cm leg wrapping a 9 cm panel reaches 15 cm along the concrete.
  Treating the bare leg as face coverage left a 9 cm hole beside every corner — visible on
  the drawing and short on the order. Corner profiles are also chosen per course: a 300 cm
  corner repeated on a 150 cm course stood 150 cm proud of the pour.

  Without corner profiles the two X faces wrap the ends instead, pinwheel-fashion. Four
  faces each spanning only their own section leaves a panel-thickness hole at every box
  corner, so the box has to close the way it does on site.

  Walers and tie rods are **centred on the column**. A 100 cm waler on a 78 cm side has
  22 cm spare; hanging all of it off one end put the ring visibly askew in the 3D view.
* **Edge snapping** — dragged pieces snap to nearby piece edges and centres, not just the
  grid, with alignment guides. Panel widths are not grid multiples, so this is what actually
  makes panels butt together.
* **Overlap detection** — intersecting footprints are outlined in red. Linear materials are
  excluded: walers and ties are *meant* to lie across panels, and flagging those painted a
  correct column entirely red.
* **Price, weight, article, supplier** per component. The BOM becomes a costed ordering sheet
  and a crane/truck load figure. Rows with no price or weight are counted and the totals are
  marked with `*`, so a partial total is never mistaken for a complete one.
* **Printable drawing** (`🖨 ბეჭდვა`) — a to-scale, dimensioned A4/A3 sheet with a title block
  (project, drawing, scale, sheet, revision, date). Scale is honoured exactly, or set to
  **ავტომატური** to pick the largest standard scale that fits.

### Tier 4 — multi-site inventory

* **Warehouses** — stock is counted per store. Companies with one store never meet the
  concept; deleting a store folds its quantities into another rather than destroying them.
* **Company-wide commitment** — the Inventory tab shows what *every* drawing has committed,
  not just the open one, and therefore what is genuinely free to allocate, with a per-drawing
  breakdown.
* **Tablet support** — pinch to zoom, two-finger pan, larger touch targets, and side panels
  that fold away so the canvas is usable on a small screen.

### Navigating the view

A trackpad and a mouse both work at once, with nothing to configure:

| gesture | does |
| --- | --- |
| two-finger scroll (trackpad) | **pan** |
| wheel notch (mouse) | **zoom** |
| pinch, or `⌘`/`Ctrl` + scroll | **zoom** (anchored on the pointer) |
| `Shift` + scroll | horizontal pan (for one-wheel mice) |
| space + drag, or middle-mouse drag | pan |

`Ctrl` + wheel needs care: a trackpad pinch and a Windows mouse zoom both arrive as
ctrl+wheel. They are told apart by delta shape — small or fractional means pinch, a chunky
integer notch means mouse. Reading a Windows Ctrl+wheel as a pinch zoomed e¹ ≈ 2.7× per
click and convinced the classifier the mouse was a trackpad, after which every plain scroll
panned instead of zooming.

### Keyboard

The handlers have always accepted either modifier (`e.metaKey || e.ctrlKey`), and `Delete`
and `Backspace` both delete, so every shortcut works on both platforms. What was wrong was
what the interface *said*: hard-coded `⌘Z` and `Ctrl/⌘` labels, which read as noise on
Windows and name a key that machine does not have.

`lib/platform.ts` detects the OS once and `combo(['mod', 'Z'])` renders `⌘Z` on a Mac and
`Ctrl+Z` everywhere else — macOS strings its symbols together, Windows spells them out and
joins with `+`. Sources are consulted in order of trustworthiness (`userAgentData`, then
`navigator.platform`, then the user-agent string), and macOS is tested before Windows
because "Darwin" contains "win" and an iPad reports as a Mac.

Both devices arrive as `wheel` events, so `lib/wheelInput.ts` tells them apart by shape: a
trackpad emits small, often fractional deltas with a non-zero `deltaX` and reports a pinch as
ctrl+wheel, while a mouse emits chunky integer notches with no horizontal axis. Evidence
accumulates over several events rather than being judged one at a time — a single trackpad
flick can momentarily look mouse-like — and swapping devices mid-session flips it back within
a few events.

### 3D view

The **2D / 3D** switch in the title bar opens a read-only visualisation. The editor works in
plan, so it can only ever show footprints; the 3D view extrudes every piece to its real `h`
so the formwork can be seen standing up, with a 1 m ground grid and the overall pour height
called out.

Drag to orbit, `Shift`+drag or middle-drag to pan, scroll/pinch to zoom. **გეგმა** snaps the
camera straight overhead. It is deliberately not editable — all editing stays in 2D.

`lib/iso3d.ts` holds the maths: a plain axonometric (no perspective) camera, so parallel
edges stay parallel and the view keeps a measurable, CAD-like feel. Faces are back-face
culled by testing their outward normal against the view direction.

**Shapes are extruded, not boxed.** The footprint comes from `planOutline` in
`lib/shapePath.ts` — the same function the on-screen SVG and the PDF snapshot use — so an
L-corner is extruded as an actual L. Extruding its bounding box instead drew corners as
plain squares and filled in the notch the panels tuck into. Everything is derived from the
outline's winding: read as the top ring it faces +Z, the base is that ring reversed, and each
wall follows one outline edge, which puts the outward normal on the correct side even for the
two walls inside a concave notch. `line` materials keep their full box rather than the
slimmed, rounded bar the 2D view draws: that bar is a stylisation for legibility at small
scale, whereas a waler's `depth` really is its profile.

**Orientation.** Plan `y` grows *downward* on screen, so `(x, y, z)` is a left-handed triple
and the textbook camera formula silently mirrors the model — which reads as looking at the
column from underneath. The camera is built so that at elevation π/2 the projection is
exactly the 2D plan (`x` right, `y` down) and every lower elevation just tips that plan
toward the viewer. Elevation is clamped to the upper hemisphere, so the eye is always above
the ground. A test asserts the ground plane's winding is preserved at every camera angle,
which is precisely the mirroring that used to slip through.

### Hidden lines

Formwork cannot be drawn by sorting faces. A 100 cm waler whose centroid is nearer than a
300 cm panel still runs *behind* that panel, so any painter's algorithm paints it straight
over the face that should hide it — which is what put stray bars and lines across the
panels.

`lib/raster3d.ts` rasterises faces into a real per-pixel depth buffer instead. Depth
interpolates linearly across a face because the projection is parallel, so it is exact — no
perspective correction. The same buffer then answers "is this stretch of edge behind
something?", which is what the **ფარული ხაზები** control uses:

| mode | edges behind other pieces |
| --- | --- |
| `დამალული` (default) | dropped — a clean solid model |
| `წყვეტილი` | drawn dashed, the drafting convention |
| `გამჭვირვალე` | all drawn solid — x-ray, for checking ties buried inside a column |

An edge lies exactly on the face it belongs to, so the depth test carries a tolerance sized
to the depth a face gains over a pixel or two; without it every piece loses its own outline.
Worst case — geometry covering the whole viewport — the buffer clear, fill and blit measure
under 10 ms a frame, and a real model covers a fraction of that.

### Piece elevation

`Piece.z` is the height of a piece's underside in cm. The 2D plan **ignores it entirely** —
two pieces at different heights sit on top of each other in plan, which is correct for a plan
view — but it means a stacked course or a waler ring is a real, counted piece rather than a
multiplier applied to the summary afterwards.

That distinction matters: the column wizard used to place one course and one waler ring and
then multiply the *summary* by the level count, so the wizard promised 16 walers while the
BOM ordered 4. Every ring and course is now placed for real at its own elevation, the counts
agree, and the 3D view shows the rings at their true heights. A test pins summary-vs-placed
agreement so it cannot drift again.

### Dropping materials

A dragged material shows a **live ghost** of exactly where it will land — grid snapping and
edge snapping included — and the piece is placed on that spot, so the preview and the result
can never disagree. Both come from one `dropPosition()` function.

The piece is centred on the cursor using its **plan** size (`w × depth`). Using `h` here is
the classic mistake: it put a 300 cm panel 150 cm away from the pointer.

### 1 — Component creation & management

* **＋ ახალი კომპონენტი** — name, category, width/height in cm, shape (rect / L / line),
  colour (defaults to the category colour), starting stock. Live preview.
* **✎ on any palette row** — edit any component, built-ins included. Edits apply to every
  placed piece of that type immediately, because pieces reference materials by id.
* **🗑** — delete. If the component is in use, a confirm dialog offers to cascade-delete the
  placed pieces along with it; otherwise a plain confirm. Deleted built-ins stay deleted
  across reloads.
* **📊 იმპორტი ცხრილიდან** — bulk import from `.xlsx` / `.csv`, or paste CSV/TSV straight
  into the dialog. Columns: `name, category, width_cm, height_cm, shape?, color?, stock?`
  (English or Georgian headers, plus common aliases). Every row is validated and shown in a
  preview table with per-row errors and warnings before anything is added. A template file
  is one click away.
* Shapes render identically in the palette swatch and on the surface: `rect` filled box,
  `L` angle profile, `line` thin bar with rounded ends.

### 2 — Persistence

* **Autosave** to `localStorage` (`du-formwork-v2`) on every change: catalog, stock, placed
  pieces, view and label settings. Restored on load.
* **Catalog file** — `კატალოგი ⤓ ექსპორტი` / `⤒ იმპორტი` writes and reads a JSON file with
  every material and its stock, so a catalog can be shared between computers.
* **Layout file** — `ნახაზი ⤓ ექსპორტი` / `⤒ იმპორტი` handles just the placed pieces, kept
  deliberately separate from the catalog.
* On reload the stored catalog is repaired and merged with the seed list, so new built-ins
  introduced by a future version appear without wiping the user's edits or stock.
* **Corrections to built-in sizes** ride along in `BUILTIN_SIZE_FIXES`, applied only where
  the stored value still matches the wrong one — a company that has already entered its own
  size keeps it. Stored materials always win over the seed (that is what makes edits stick),
  so without this a saved catalog would carry a bad dimension forever.

  That table **must stay above `create()`**. Rehydration runs while the store is still being
  built, so anything it reaches has to be initialised by then; a `const` declared further
  down the file is still in its temporal dead zone at that moment. The persist middleware
  swallows whatever `merge` throws, leaving the store on its empty defaults — and the next
  autosave then writes those over the user's saved drawing, silently. `onRehydrateStorage`
  now reports any such failure to the console *and* to the storage banner, so this class of
  bug can never be quiet again.

### 3 — Bill of materials

* **Live on-screen panel** (`უწყისი` tab): every component in use, grouped by category, with
  quantity, in-stock and remaining per row, plus a per-category subtotal and a grand total.
* **Summary card**: total pieces, total length in m, total area in m², shortage count, cost
  and weight.

  **Length is counted for every structural material**, not just linear ones. A
  "პანელი 30*300" is 3 m long exactly like a 3 m waler; counting only `shape: 'line'`
  materials left panels, corners and fillers — most of a real order — contributing nothing,
  so the metres total read far too low. Accessories are the exception: a nut is ordered by
  the piece and has neither a meaningful length nor a face area. Area stays restricted to
  what actually forms the concrete face (panels, fillers, corners).
* **⤓ Excel** — ordering sheet with `Component, Category, Size (cm), Quantity, Length (m),
  In stock, Remaining, Unit price, Line total, Weight` (bilingual headers), plus a second
  summary sheet. **⤓ CSV** writes the same list with a UTF-8 BOM so Excel renders Georgian
  correctly. This is the internal sheet, so it keeps the stock columns.
* **⤓ PDF** — printable A4 table, optionally with a snapshot of the drawing above it.

  The PDF is the **handout**, not the internal sheet: its columns are
  `კომპონენტი, ზომა, რაოდ., სიგრძე, წონა`. Stock and remaining are deliberately absent —
  they are internal figures that mean nothing to whoever receives the document, whereas
  weight is what a crane and a truck are booked against. Totals that are incomplete because
  a component has no weight entered are marked `*` and footnoted rather than printed as if
  they were real.

  The table is laid out as HTML and rasterised with html2canvas before being placed into
  jsPDF: jsPDF's built-in fonts have no Georgian glyphs, so drawing text directly would
  produce garbage. The drawing snapshot is rendered by a dedicated 2D-canvas routine
  (`lib/snapshot.ts`) rather than screenshotting the live stage, so the printout gets a
  clean light background with no rulers or selection chrome, independent of how the user
  happened to be zoomed.

  The snapshot goes into the PDF through `pdf.addImage()` and deliberately **not** through
  html2canvas — making html2canvas re-load and re-rasterise a multi-megapixel data URL took
  the export from 2 seconds to effectively hanging. Both the snapshot and the table slices
  are added with Flate compression (`'FAST'`); without it a single drawing produced a 20 MB
  file instead of ~140 KB.

### 4 — Inventory

* Stock is editable inline on every palette row and in the `მარაგი` tab.
* Everywhere a used quantity is shown, so are **In stock** and **Remaining** (`stock − used`).
* Rows where `used > stock` turn red, and a **⚠ დეფიციტი: n** badge appears in the header
  and on the inventory tab.
* Stock persists with the catalog — autosave and catalog file alike.

### 5 — Always-visible dimensions

Every placed piece is labelled at all times, no hover or selection needed.

* Labels are drawn in a **screen-space overlay**, so they stay horizontal whatever the piece
  rotation and stay a readable size whatever the zoom.
* The size sits centred on the piece when it fits — for linear items (walers, rods) the
  label is the length alone, positioned along the bar, CAD-style. When the full
  name + size does not fit, the label shrinks (11 → 10 → 9 px), then drops to size-only,
  and only then moves just outside the piece (above it, flipping below near the top edge).
* Pieces smaller than ~12 px on screen are skipped, as is everything below 12 % zoom.
* Toolbar toggles: **ზომები** (dimensions, on by default), **სახელები** (names, on by
  default) and **ყოველთვის**, which forces labels on even when they would normally be
  hidden for density.

---

## Notes

* Sizes are approximate, derived from the material names (`პანელი 45*300` = 45 × 300 cm);
  walers and tie rods are sized by length with a thin profile, and small hardware uses
  representative sizes. They all live in one place — `src/data/seedCatalog.ts` — and any of
  them can be corrected from the UI when a real spec sheet arrives.
* `npm audit` reports **0 vulnerabilities**. Getting there needed `xlsx` from the SheetJS CDN
  (the npm mirror is stuck on a version with two high-severity advisories and no fix),
  jsPDF 4, Vite 6 and Vitest 4 — so do not "helpfully" repoint `xlsx` at the npm registry.
* The export libraries (`xlsx`, `jspdf`, `html2canvas`) are **lazy-loaded** on first use.
  That is why `lib/sheetSchema.ts` (headers, aliases, validation — no SheetJS) is separate
  from `lib/sheetImport.ts` (the SheetJS half): the import dialog statically imports the
  former, and if it imported the latter the whole 160 kB library would land in the main
  bundle. Main bundle is ~256 kB (79 kB gzipped) instead of ~1.2 MB.
* Clearing site data in the browser resets the app to the 41 built-in materials — export the
  catalog file first if stock has been entered.
