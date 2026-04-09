/**
 * Public slideshow layout: viewport alignment + safety (letterbox) gradient.
 * Defaults match SlideshowPlayerCore failover gradient.
 */

import type { CSSProperties } from 'react';

export type LayoutAlignVertical = 'top' | 'middle' | 'bottom';
export type LayoutAlignHorizontal = 'left' | 'center' | 'right';

export const DEFAULT_SAFETY_PRIMARY = '#312e81';
export const DEFAULT_SAFETY_ACCENT = '#0f172a';

export function normalizeLayoutAlignVertical(
  raw: unknown
): LayoutAlignVertical {
  if (raw === 'top' || raw === 'bottom') return raw;
  return 'middle';
}

export function normalizeLayoutAlignHorizontal(
  raw: unknown
): LayoutAlignHorizontal {
  if (raw === 'left' || raw === 'right') return raw;
  return 'center';
}

/** Stored value: '' or valid #RRGGBB; anything else normalizes to ''. */
export function normalizeStoredSafetyColor(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (s === '') return '';
  return /^#[0-9A-Fa-f]{6}$/.test(s) ? s : '';
}

/** Create/PATCH: reject invalid non-empty hex; null/undefined → ''. */
export function parseSafetyColorInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: '' };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Safety gradient colors must be strings (#RRGGBB or empty)' };
  }
  const s = raw.trim();
  if (s === '') return { ok: true, value: '' };
  if (!/^#[0-9A-Fa-f]{6}$/.test(s)) {
    return {
      ok: false,
      error: 'Safety gradient colors must be empty or #RRGGBB (e.g. #312e81)',
    };
  }
  return { ok: true, value: s };
}

export function resolvedSafetyGradientColors(
  primaryStored: string,
  accentStored: string
): { primary: string; accent: string } {
  const p = normalizeStoredSafetyColor(primaryStored);
  const a = normalizeStoredSafetyColor(accentStored);
  return {
    primary: p || DEFAULT_SAFETY_PRIMARY,
    accent: a || DEFAULT_SAFETY_ACCENT,
  };
}

export function safetyGradientCss(primary: string, accent: string): string {
  return `linear-gradient(to bottom left, ${primary}, ${accent})`;
}

/** Flex container for positioning the rigid videowall in the viewport. */
export function layoutRootFlexStyle(
  vertical: LayoutAlignVertical,
  horizontal: LayoutAlignHorizontal
): CSSProperties {
  return {
    display: 'flex',
    width: '100%',
    height: '100%',
    alignItems:
      vertical === 'top'
        ? 'flex-start'
        : vertical === 'bottom'
          ? 'flex-end'
          : 'center',
    justifyContent:
      horizontal === 'left'
        ? 'flex-start'
        : horizontal === 'right'
          ? 'flex-end'
          : 'center',
  };
}
