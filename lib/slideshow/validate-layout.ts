import type { SlideshowLayoutArea } from '@/lib/db/schemas';

export interface LayoutValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Ensures areas do not overlap and tiles are in grid bounds.
 */
export function validateLayoutAreas(
  rows: number,
  cols: number,
  areas: SlideshowLayoutArea[]
): LayoutValidationResult {
  if (rows < 1 || rows > 24 || cols < 1 || cols > 24) {
    return { ok: false, error: 'rows and cols must be between 1 and 24' };
  }

  const used = new Set<string>();

  for (const area of areas) {
    if (!area.id || !area.label?.trim()) {
      return { ok: false, error: 'Each area needs id and label' };
    }
    if (!Array.isArray(area.tiles) || area.tiles.length === 0) {
      return { ok: false, error: `Area "${area.label}" has no tiles` };
    }
    if (
      area.objectFit != null &&
      area.objectFit !== 'contain' &&
      area.objectFit !== 'cover'
    ) {
      return { ok: false, error: `Area "${area.label}" objectFit must be contain or cover` };
    }
    if (typeof area.delayMs !== 'number' || area.delayMs < 0 || area.delayMs > 600_000) {
      return { ok: false, error: `Area "${area.label}" delayMs must be 0–600000` };
    }

    for (const tile of area.tiles) {
      const [rs, cs] = tile.split('-');
      const r = Number(rs);
      const c = Number(cs);
      if (!Number.isFinite(r) || !Number.isFinite(c)) {
        return { ok: false, error: `Invalid tile id "${tile}"` };
      }
      if (r < 0 || r >= rows || c < 0 || c >= cols) {
        return { ok: false, error: `Tile "${tile}" out of grid bounds` };
      }
      if (used.has(tile)) {
        return { ok: false, error: `Tile "${tile}" used in more than one area` };
      }
      used.add(tile);
    }
  }

  return { ok: true };
}
