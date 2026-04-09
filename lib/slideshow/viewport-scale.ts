/**
 * Fit = contain entire stage in viewport (letterbox).
 * Fill = cover viewport (crop overflow).
 */

export type ViewportScaleMode = 'fit' | 'fill';

const SLIDESHOW_STAGE_ASPECT = 16 / 9;

/**
 * 16:9 slideshow stage size inside a rectangular container (layout cell or window).
 */
export function slideshowStageDimensions(
  containerW: number,
  containerH: number,
  mode: ViewportScaleMode
): { width: number; height: number } {
  if (containerW <= 0 || containerH <= 0) {
    return { width: 0, height: 0 };
  }
  const ar = SLIDESHOW_STAGE_ASPECT;
  const car = containerW / containerH;
  if (mode === 'fit') {
    if (car > ar) {
      const height = containerH;
      const width = height * ar;
      return { width, height };
    }
    const width = containerW;
    const height = width / ar;
    return { width, height };
  }
  if (car > ar) {
    const width = containerW;
    const height = width / ar;
    return { width, height };
  }
  const height = containerH;
  const width = height * ar;
  return { width, height };
}

/**
 * Composite layout: cols × rows uniform cells, each cell matches the **16:9 slideshow stage**.
 *
 * Outer width:height = (cols × 16) : (rows × 9), so (W/cols)/(H/rows) = 16/9.
 * (Using cols:rows here made square cells for N×N grids — e.g. 3×3 → 1:1 tiles.)
 */
/** Rigid videowall aspect for CSS `aspect-ratio`: (cols×16) : (rows×9). */
export function layoutGridAspectRatioCss(cols: number, rows: number): string {
  if (cols < 1 || rows < 1) return '16 / 9';
  return `${cols * 16} / ${rows * 9}`;
}

export function layoutGridStageDimensions(
  viewportW: number,
  viewportH: number,
  cols: number,
  rows: number,
  mode: ViewportScaleMode
): { width: number; height: number } {
  if (viewportW <= 0 || viewportH <= 0 || cols < 1 || rows < 1) {
    return { width: 0, height: 0 };
  }
  const ar = (cols * SLIDESHOW_STAGE_ASPECT) / rows;
  const car = viewportW / viewportH;
  if (mode === 'fit') {
    let width: number;
    let height: number;
    if (car > ar) {
      height = viewportH;
      width = height * ar;
    } else {
      width = viewportW;
      height = width / ar;
    }
    /* Uniform scale fixes float noise and keeps aspect when capping to viewport */
    const scale = Math.min(1, viewportW / width, viewportH / height);
    width *= scale;
    height *= scale;
    return {
      width: Math.max(0, Math.floor(width)),
      height: Math.max(0, Math.floor(height)),
    };
  }
  if (car > ar) {
    const width = viewportW;
    const height = width / ar;
    return { width, height };
  }
  const height = viewportH;
  const width = height * ar;
  return { width, height };
}
