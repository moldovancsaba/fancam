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

export interface GridPlacement {
  gridRow: string;
  gridColumn: string;
}

/**
 * Public videowall: collapse grid tracks that contain no tiles assigned to any area,
 * so “checkerboard” layouts (e.g. images on rows 0,2,4 of a 6-row grid) render as
 * contiguous rows without blank bands showing the outer background.
 */
export interface CompactGridSpec {
  effectiveRows: number;
  effectiveCols: number;
  areaToPlacement: (tiles: string[]) => GridPlacement | null;
}

export function computeCompactGridSpec(
  areas: readonly { tiles: string[] }[],
  declaredRows: number,
  declaredCols: number
): CompactGridSpec {
  if (declaredRows < 1 || declaredCols < 1) {
    return {
      effectiveRows: Math.max(1, declaredRows),
      effectiveCols: Math.max(1, declaredCols),
      areaToPlacement: (tiles) =>
        areaToGridPlacement(tiles, Math.max(1, declaredRows), Math.max(1, declaredCols)),
    };
  }

  const usedR = new Set<number>();
  const usedC = new Set<number>();
  for (const a of areas) {
    for (const t of a.tiles) {
      const p = parseTile(t);
      if (!p) continue;
      if (p.r >= 0 && p.r < declaredRows && p.c >= 0 && p.c < declaredCols) {
        usedR.add(p.r);
        usedC.add(p.c);
      }
    }
  }

  const rowsSorted = [...usedR].sort((a, b) => a - b);
  const colsSorted = [...usedC].sort((a, b) => a - b);

  if (rowsSorted.length === 0 || colsSorted.length === 0) {
    return {
      effectiveRows: declaredRows,
      effectiveCols: declaredCols,
      areaToPlacement: (tiles) =>
        areaToGridPlacement(tiles, declaredRows, declaredCols),
    };
  }

  const rMap = new Map(rowsSorted.map((r, i) => [r, i]));
  const cMap = new Map(colsSorted.map((c, i) => [c, i]));

  const areaToPlacement = (tiles: string[]): GridPlacement | null => {
    if (tiles.length === 0) return null;
    let minR = Infinity;
    let maxR = -Infinity;
    let minC = Infinity;
    let maxC = -Infinity;
    for (const tile of tiles) {
      const p = parseTile(tile);
      if (!p) return null;
      if (p.r < 0 || p.r >= declaredRows || p.c < 0 || p.c >= declaredCols) {
        return null;
      }
      const cr = rMap.get(p.r);
      const cc = cMap.get(p.c);
      if (cr === undefined || cc === undefined) return null;
      minR = Math.min(minR, cr);
      maxR = Math.max(maxR, cr);
      minC = Math.min(minC, cc);
      maxC = Math.max(maxC, cc);
    }
    if (!Number.isFinite(minR)) return null;
    return {
      gridRow: `${minR + 1} / ${maxR + 2}`,
      gridColumn: `${minC + 1} / ${maxC + 2}`,
    };
  };

  return {
    effectiveRows: rowsSorted.length,
    effectiveCols: colsSorted.length,
    areaToPlacement,
  };
}

/**
 * CSS Grid placement for an area (1-based line indices; end exclusive).
 * Keeps row/column lines contiguous so cells share edges with no gap.
 */
export function areaToGridPlacement(
  tiles: string[],
  rows: number,
  cols: number
): GridPlacement | null {
  const boxTiles = tiles;
  if (rows < 1 || cols < 1 || boxTiles.length === 0) return null;

  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (const t of boxTiles) {
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
    gridRow: `${minR + 1} / ${maxR + 2}`,
    gridColumn: `${minC + 1} / ${maxC + 2}`,
  };
}
