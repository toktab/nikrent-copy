# State, undo and persistence

All of it lives in `src/store/useEditorStore.ts`. This is the part of the
codebase where a mistake loses somebody's drawing rather than mis-counting a
panel, so it is worth the page.

## Two modes, decided at load

`isConfigured` (`src/lib/supabase.ts`) is true when a Supabase URL and anon key
are present. It changes what localStorage is for:

| | key | what is stored locally |
|---|---|---|
| **with a server** | `du-formwork-prefs` | preferences only |
| **local-only** | `du-formwork-v2` | preferences **+ catalog, documents, warehouses** |

`partialize` implements exactly that. The two keys are deliberately different:
sharing one would mean a local-only drawing and a server-backed session writing
over each other's shape of data.

**Preferences** are the 19 keys in `PREF_KEYS` - zoom, pan, snap settings, which
panels are open, which view. Everything about how you are looking at the
drawing, nothing about the drawing.

## The active document is a mirror

`state.pieces`, `state.sketch` and `state.measures` are the *active* drawing,
and the real copy lives in `documents[activeDocId]`. `syncDoc` keeps them in
step: any patch that touches `pieces`, `sketch` or `measures` also writes them
back into the active document and stamps `updatedAt`.

Every place that switches, creates, duplicates, restores or loads a drawing
has to set all three mirrors. A new drawing that set only `pieces` once kept
showing the previous drawing's lines, and the first edit wrote them into it.

**So never call `set()` directly for anything that changes pieces, sketch or
measures.** Detection imports go through `appendSketch`, a drawing file through
`importDrawing`.
Use one of these two, both defined inside `create()`:

- **`commit(fn)`** - a real edit. Runs through `syncDoc`, pushes the previous
  state onto `past` (capped at `HISTORY_LIMIT`) and clears `future`.
- **`apply(fn)`** - the same, without a history entry. This is for live
  dragging, where one gesture must be one undo step rather than sixty.

The usual shape of a drag is: `commit` once when the pointer goes down to open
the step, then `apply` on every move.

## What undo actually restores

`snap()` captures five things: `materials`, `pieces`, `sketch`, `measures`,
`removedBuiltins`. The catalog is in there deliberately - deleting a material
and undoing has to bring it back - which also means an undo taken after a
catalog edit rolls that edit back too.

## The trap that silently eats a drawing

Rehydration runs **while the store is being built**. Anything it reaches must be
initialised by then, so any `const` it touches has to be declared **above**
`create()`. A `const` further down the file is still in its temporal dead zone
at that moment, the `ReferenceError` is swallowed by the persist middleware, and
the result is the saved drawing being dropped and then overwritten with an empty
one on the next autosave. Silent, and total.

`BUILTIN_SIZE_FIXES` and `applySizeFixes` carry a warning to this effect. Heed
it: if you add anything that rehydration consults, put it near them.

`onRehydrateStorage` exists for the other half of the problem - it reports a
genuine load failure loudly instead of letting the app come up empty and
autosave over the wreckage.

## Migrations

`version: 6`, with `migrate` (`migratePersisted`, exported so it is tested
directly) handling old preference values rather than old document shapes:
grid steps of 1, 10 and 25 cm that no longer exist are moved to the nearest
step the catalog divides into, and the old lengths settings (v4's `showDims`
switch, v5's `dimMode`) become the `showLengths` master switch plus the
per-kind `lengthVisibility` table (off stays off, "all" stays all, everyone
else gets the default table). `merge` repairs `measureStyle`,
`lengthVisibility` and `pdfVisibility` field by field. `merge` normalises the two
historical shapes (a top-level `pieces` array from v2, versus named documents).

Stored materials always beat the seed, which is what makes a user's catalog
edits stick; `BUILTIN_SIZE_FIXES` is the narrow exception, and it only fires
where the stored value still matches the known-wrong one.
