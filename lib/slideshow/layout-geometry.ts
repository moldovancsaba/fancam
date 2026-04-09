/**
 * Map CardMass-style tile lists to percentage boxes over the layout grid.
 */

export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function parseTile(tile: string): { r: number; c: number } | null {
  const [rs, cs] = tile.split('-');
  const r = Number(rs);
  const c = Number(cs);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { r, c };
}

/**
 * Bounding box of an area as percentage of the full grid (0–100).
 */
export function areaToPercentBox(
  tiles: string[],
  rows: number,
  cols: number
): PercentBox | null {
  if (rows < 1 || cols < 1 || tiles.length === 0) return null;

  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (const t of tiles) {
    const p = parseTile(t);
    if (!p) return null;
    if (p.r < 0 || p.r >= rows || p.c < 0 || p.c >= cols) return null;
    minR = Math.min(minR, p.r);
    maxR = Math.max(maxR, p.r);
    minC = Math.min(minC, p.c);
    maxC = Math.max(maxC, p.c);
  }

  if (!Number.isFinite(minR)) return null;

  return {
    left: (minC / cols) * 100,
    top: (minR / rows) * 100,
    width: ((maxC - minC + 1) / cols) * 100,
    height: ((maxR - minR + 1) / rows) * 100,
  };
}
