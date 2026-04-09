# Plan: Slideshow layouts (multi-cell mosaic player)

**Status:** Delivered (v1 in app)  
**Last updated:** 2026-04-09  

## Goal

Add **slideshow layouts**: a full-screen **mosaic** where **each region (“box”) runs one existing slideshow** (same behavior as `/slideshow/[slideshowId]`), composed into one public view. Layout configuration is **only**:

- Geometry (how the screen is split — same *class* of UX as CardMass **board creator**).
- Per-box: **which slideshow** (`slideshowId`), **delay** (phase offset), **scale mode** (`fit` = letterbox/pillarbox, `fill` = crop) while **always preserving image aspect ratio** (`object-fit: contain` vs `cover`).

All playlist logic, fairness, play counts, and timing *per slideshow* stay in **individual slideshow** documents and existing APIs.

---

## Reference: CardMass board creator (patterns to reuse)

**Location:** `~/Projects/cardmass/app/creator/ui/CreatorApp.tsx`

| Pattern | What it does | Reuse for Camera |
|--------|----------------|------------------|
| **Grid** | `rows`, `cols`; tiles addressed as `"r-c"` | Same: define a grid; each **area** is a set of tiles forming a rectangle (or arbitrary union — see below). |
| **Areas** | `areas[]`: `{ id, label, color, tiles: TileId[] }` | Map each **area** → one **layout cell**: assign `slideshowId`, `delayMs`, `objectFit`. Labels become operator-facing names (e.g. “Left tower”). |
| **Selection** | Drag rectangle, brush reparent tiles, `commitArea` | Same interaction for defining regions; **drop** CardMass-specific fields where not needed (`color` optional for builder preview only). |
| **Persistence** | Org mode: `GET/PATCH` board with `rows`, `cols`, `areas` | Camera: `POST/PATCH` **slideshow layout** with same structural idea; no org UUID — scope by **event** (see data model). |
| **Runtime** | Tagger renders board from areas | Camera: **public layout page** computes each area’s **bounding box** in % of the full viewport and positions **one slideshow cell** per area. |

**Optional simplification (MVP):** If full “paint territories” is too heavy for v1, ship **row/column split presets** + “merge adjacent cells” later; the plan below assumes **parity with CardMass-style areas** as the target UX.

---

## Product behavior

### Public page

- **URL:** `/slideshow-layout/[layoutId]` (new `layoutId` string, analogous to `slideshowId`).
- **No auth** for display (same as single slideshow), subject to existing rate limits / ops choices.
- **Layout root:** full viewport; black or configurable **background** (optional: reuse CardMass-style `background` CSS snippet for the *outer* frame only — not required for v1).
- **Per area (cell):**
  - If **no** `slideshowId`: show empty state (black or “Unassigned” placeholder).
  - If **slideshowId** set: run **the same playback pipeline** as the single player (playlist fetch, A/B/C buffers, `played` POSTs, preload) **inside that cell’s rectangle**.
  - **Scale:** `fit` → `object-fit: contain`; `fill` → `object-fit: cover` (both preserve aspect ratio).
  - **Delay:** `delayMs` **offsets the start** of that cell’s playback loop (and/or the first advance) so duplicate references to the **same** `slideshowId` in multiple cells **do not show identical slides at the same wall-clock time** when possible.

### Admin

- New section on the event page: **“Event Slideshow Layouts”** (alongside **Event Slideshows**).
- Same **class** of operations as individual slideshows:
  - Create / rename / delete layout
  - Copy **public URL**
  - Open **layout builder** (grid + areas)
  - Per area: dropdown of **this event’s** slideshows, `delayMs`, `objectFit`
- **Authorization:** same as `POST /api/slideshows` (admin / superadmin session).

### Out of scope for the layout layer

- No duplicate of buffer size, transition duration, or playlist rules on the layout document **unless** we later add **layout-level overrides** (not in current requirements).
- Layout **does not** replace single-slideshow URLs; both coexist.

---

## Data model (MongoDB)

**New collection:** `slideshow_layouts` (name aligned with `slideshows`).

```text
{
  layoutId: string,          // public id in URL (generateId() same as slideshows)
  eventId: string,           // event UUID (same convention as slideshows.eventId)
  eventName: string,         // denormalized for admin/player title
  name: string,              // operator label, e.g. "Main videowall"

  rows: number,
  cols: number,
  areas: [
    {
      id: string,            // stable uuid per area (client + server)
      label: string,         // operator-facing
      tiles: string[],       // ["0-0","0-1",...] same as CardMass

      slideshowId: string | null,
      delayMs: number,       // default 0; phase offset for this cell
      objectFit: "contain" | "cover"   // FIT | FILL (aspect preserved)
    }
  ],

  background?: string,       // optional: multiline CSS background-* only (CardMass-style), v1 optional

  isActive: boolean,
  createdBy, createdAt, updatedAt
}
```

**Indexes:** unique `layoutId`; `{ eventId: 1, createdAt: -1 }`.

**Validation (server):**

- `rows` / `cols` within safe bounds (e.g. 1–100 as CardMass).
- Every tile id ∈ `[0..rows-1]x[0..cols-1]`; **no tile in more than one area**.
- Each `slideshowId` either `null` or must reference a slideshow with **same `eventId`** (prevent cross-event leakage).

---

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/slideshow-layouts` | Create layout (admin); body: `eventId` (Mongo `_id` like slideshows), `name`, optional initial `rows/cols`. |
| `GET` | `/api/slideshow-layouts?eventId=<uuid>` | List layouts for event (admin list + builder pickers). |
| `GET` | `/api/slideshow-layouts/[layoutId]` | **Public** read: layout geometry + area bindings + fit/delay (no secrets). Rate limit. |
| `PATCH` | `/api/slideshow-layouts?id=<mongoId>` | Update name, rows/cols/areas/bindings/background/isActive. |
| `DELETE` | `/api/slideshow-layouts?id=<mongoId>` | Delete layout. |

**Note:** `GET ?eventId=` should use **event UUID** for listing, consistent with `GET /api/slideshows?eventId=`.

---

## Frontend architecture

### 1. Layout builder (admin)

- **New client component** (e.g. `components/admin/SlideshowLayoutBuilder.tsx`), modeled on **CardMass `CreatorApp`**:
  - Set rows/cols, drag-select tiles, commit areas, brush mode, remove area.
  - Side panel / modal per area: **Slideshow** (select from `GET /api/slideshows?eventId=`), **Delay (ms)**, **Fit: Fit / Fill**.
- **Entry:** from `SlideshowLayoutManager` → “Edit layout” navigates to `app/admin/events/[id]/layouts/[layoutMongoId]/page.tsx` **or** large modal; full page is easier for complex grids.
- **Save:** `PATCH` with full `areas` + `rows` + `cols`.

### 2. Public player

- **New route:** `app/slideshow-layout/[layoutId]/page.tsx`.
- **Load:** `GET /api/slideshow-layouts/[layoutId]`.
- **Render:**
  - Compute **bounding box** per area from its `tiles` (min/max row/col → `left`, `top`, `width`, `height` as `%` of grid).
  - For each area with `slideshowId`, render **`SlideshowCell`** (see refactor below) positioned `absolute` with `%`.
- **Delay:** pass `delayMs` into the cell so the **first** transition and/or **initial buffer load** is deferred — goal: **stagger** cells that share the same `slideshowId`.

### 3. Refactor: shared slideshow playback core

Today logic lives entirely in `app/slideshow/[slideshowId]/page.tsx` (~700 lines).

**Plan:**

- Extract **`SlideshowPlayerCore`** (or hook `useSlideshowPlayer({ slideshowId, objectFit, delayMs, onDimensions? })`) into e.g. `components/slideshow/SlideshowPlayerCore.tsx` (or `lib/slideshow/player/`).
- **Single route** `/slideshow/[id]` becomes a thin wrapper: full viewport, default `objectFit: contain`, `delayMs: 0`.
- **Layout route** mounts **N** instances with **constrained** parent `div` and per-cell `objectFit` / `delayMs`.

This avoids iframes (lighter than N full Next documents).

---

## Delay semantics (duplicate `slideshowId`)

**Problem:** Two cells using the same slideshow will otherwise fetch the same playlist and advance in lockstep.

**Approach (recommended):**

1. **`delayMs`:** On mount, cell waits `delayMs` before starting the **auto-advance timer** (after initial preload), so wall-clock phases differ.
2. **Optional enhancement:** `initialPlaylistSkip` = `floor(delayMs / transitionDurationMs)` % playlistLength — *only if* we need stronger desync without long idle time (can be v2).

Document in UI: *“Delay offsets this cell’s playback so the same slideshow in multiple boxes shows different photos.”*

**Play counts:** Each visible slide still calls `POST .../played` as today. Staggered cells should usually report **different** `submissionIds` at the same time; if they ever align, double increment is acceptable short-term, or add a **layout-scoped** `X-Cell-Id` header later for analytics-only dedupe (not required for v1).

---

## Admin UI placement

On `app/admin/events/[id]/page.tsx`:

- After **Event Slideshows**, add **`SlideshowLayoutManager`**:
  - Title: **Event Slideshow Layouts**
  - Create layout (prompt name → POST)
  - List: name, public URL copy, Edit builder, Delete
  - Mirror patterns from `components/admin/SlideshowManager.tsx`

---

## Documentation & governance

- After implementation: extend **`docs/SLIDESHOW_LOGIC.md`** with a **“Layout composition”** section (link to this plan, then replace plan with user-facing doc).
- **`ARCHITECTURE.md`**: new collection + routes in API index.
- **Rate limits:** new keys for `GET layout` (public) and mutating routes.

---

## Phased delivery

| Phase | Deliverable |
|-------|-------------|
| **P1** | Schema + CRUD APIs + `SlideshowLayoutManager` (list/create/delete/copy URL) + stub builder (single full-grid cell only) + public page rendering one cell — proves routing. |
| **P2** | Full **CardMass-style** grid builder + area assignment + `objectFit` + `delayMs` persisted. |
| **P3** | Extract **`SlideshowPlayerCore`**; wire single slideshow page + layout cells; tune preload memory for N cells. |
| **P4** | Optional outer **background** CSS; stronger desync algorithm; E2E / load testing on 6+ cells. |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **N × playlist polling** | Rate limits; consider smaller default `bufferSize` for embedded cells; cache responses per `slideshowId` in a short-lived SWR layer *only if* safe (exclude lists differ per cell — likely **no shared cache**). |
| **Memory / GPU** | Limit max areas or max grid size; document recommended max cells (e.g. 9). |
| **Huge refactor** | Extract player in **P3** after layout shell works with **one** embedded player duplicated twice for manual test. |

---

## Open decisions (confirm before build)

1. **Max grid** (`rows*cols` and max areas) for safety.
2. **Empty cell** behavior: pure black vs dim “No slideshow” text.
3. **Background** on layout v1 or defer to P4.
4. Whether **non-admin** can **list** layouts for an event (probably **no** — only admin list; public only by `layoutId`).

---

**References**

- CardMass creator: `~/Projects/cardmass/app/creator/ui/CreatorApp.tsx`
- Camera slideshow doc: `docs/SLIDESHOW_LOGIC.md`
- Camera slideshow APIs: `app/api/slideshows/`
- Camera player: `app/slideshow/[slideshowId]/page.tsx`
