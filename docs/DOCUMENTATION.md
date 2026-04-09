# Keeping documentation aligned with code

**Last updated:** 2026-04-09

This repo’s behavior is defined by **the running code**. When docs and implementation disagree, **update the docs** unless you are deliberately changing a published contract (then update code *and* docs in the same change).

## Canonical sources

| Topic | Source of truth |
|--------|-----------------|
| **App / package version** | `package.json` → `"version"` (currently synced with `RELEASE_NOTES.md` header when you ship) |
| **Dependencies (Next, React, TS, …)** | `package.json` `dependencies` / `devDependencies` — refresh **`README.md`**, **`ARCHITECTURE.md`**, **`TECH_STACK.md`** when you bump majors |
| **MongoDB shapes** | `lib/db/schemas.ts` — **`ARCHITECTURE.md`** collection summaries are abbreviated; link here for full fields |
| **HTTP API surface** | `app/api/**/route.ts` — run `find app/api -name route.ts` or read **`ARCHITECTURE.md`** API tree (regenerate that tree when adding routes) |
| **Slideshow playlist + public player** | `lib/slideshow/playlist.ts`, `app/api/slideshows/[slideshowId]/playlist/route.ts`, **`components/slideshow/SlideshowPlayerCore.tsx`** — narrative detail in **`docs/SLIDESHOW_LOGIC.md`** |
| **Admin gate** | Root **`middleware.ts`** (`/admin/*` cookie + `appRole` + `appAccess`), **`app/admin/layout.tsx`**, **`lib/api/middleware.ts`** → `requireAdmin()` |
| **Composite videowall** | `app/slideshow-layout/[layoutId]/page.tsx`, `layoutGridStageDimensions` in **`lib/slideshow/viewport-scale.ts`** (per-cell 16:9 grid), **`docs/SLIDESHOW_LOGIC.md`** §13 |

## Slideshow player (common drift)

The public player is **`SlideshowPlayerCore`** (fullscreen wrapper: `app/slideshow/[slideshowId]/page.tsx`). It uses a **FIFO slide queue** seeded from **`GET …/playlist`**; **`bufferSize`** is a **target depth** only—in **loop** mode **`maintainLoopBuffer`** refills with **`GET …/playlist?limit=N`** (plus a light interval) so playback is not tied to “running out of buffer.” On **composite layouts**, the player passes **`instanceKey`** (layout area id). It does **not** implement a rotating **A / B / C** triple-buffer client; the `exclude` query on the playlist API exists mainly for **other clients** or future use—see code before documenting exclusion behavior for this player.

## After you change behavior

1. Update **`docs/SLIDESHOW_LOGIC.md`** (or the relevant doc) in the **same PR** as the code.
2. Bump **`ARCHITECTURE.md`** / **`README.md`** version lines if you cut a release.
3. If you add **`app/api/.../route.ts`**, add it to the API tree in **`ARCHITECTURE.md`**.
