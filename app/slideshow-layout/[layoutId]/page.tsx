'use client';

/**
 * Public composite layout: one CSS grid (rows×cols) scaled as a single rigid unit;
 * each region runs an independent slideshow.
 */

import { use, useEffect, useMemo, useState } from 'react';
import { SlideshowPlayerCore } from '@/components/slideshow/SlideshowPlayerCore';
import { computeCompactGridSpec } from '@/lib/slideshow/layout-geometry';
import {
  layoutGridAspectRatioCss,
  layoutGridStageDimensions,
  type ViewportScaleMode,
} from '@/lib/slideshow/viewport-scale';
import {
  layoutAlignmentFlexClasses,
  normalizeLayoutAlignHorizontal,
  normalizeLayoutAlignVertical,
  resolvedSafetyGradientColors,
  safetyGradientCss,
  type LayoutAlignHorizontal,
  type LayoutAlignVertical,
} from '@/lib/slideshow/layout-presentation';
import type { SlideshowLayoutArea } from '@/lib/db/schemas';

interface LayoutPayload {
  layoutId: string;
  name: string;
  eventName: string;
  rows: number;
  cols: number;
  areas: SlideshowLayoutArea[];
  background: string;
  viewportScale: ViewportScaleMode;
  alignVertical: LayoutAlignVertical;
  alignHorizontal: LayoutAlignHorizontal;
  safetyPrimaryColor: string;
  safetyAccentColor: string;
}

/**
 * Size used for layoutGridStageDimensions — must match the visible viewport.
 * innerWidth/innerHeight alone disagree with 100vw/100vh in Safari (esp. landscape);
 * visualViewport + clientWidth/Height align better with what actually fits on screen.
 */
function readViewportCssPixels(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  const vv = window.visualViewport;
  if (
    vv &&
    Number.isFinite(vv.width) &&
    Number.isFinite(vv.height) &&
    vv.width > 8 &&
    vv.height > 8
  ) {
    return { w: Math.floor(vv.width), h: Math.floor(vv.height) };
  }
  const el = document.documentElement;
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  return {
    w: Math.max(0, Math.floor(w)),
    h: Math.max(0, Math.floor(h)),
  };
}

function useViewportSize() {
  const [size, setSize] = useState(() =>
    typeof window !== 'undefined' ? readViewportCssPixels() : { w: 0, h: 0 }
  );

  useEffect(() => {
    const set = () => setSize(readViewportCssPixels());
    set();
    window.addEventListener('resize', set);
    window.visualViewport?.addEventListener('resize', set);
    window.visualViewport?.addEventListener('scroll', set);
    return () => {
      window.removeEventListener('resize', set);
      window.visualViewport?.removeEventListener('resize', set);
      window.visualViewport?.removeEventListener('scroll', set);
    };
  }, []);

  return size;
}

export default function SlideshowLayoutPage({
  params,
}: {
  params: Promise<{ layoutId: string }>;
}) {
  const { layoutId } = use(params);
  const [layout, setLayout] = useState<LayoutPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { w: vw, h: vh } = useViewportSize();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/slideshow-layouts/${layoutId}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Layout not found');
        }
        const L = data.layout as Record<string, unknown> & {
          areas?: SlideshowLayoutArea[];
          viewportScale?: string;
        };
        const areas = (L.areas || []).map((a) => ({
          ...a,
          objectFit: a.objectFit === 'cover' ? ('cover' as const) : ('contain' as const),
        }));
        const viewportScale: ViewportScaleMode =
          L.viewportScale === 'fill' ? 'fill' : 'fit';
        if (!cancelled) {
          setLayout({
            layoutId: String(L.layoutId ?? ''),
            name: String(L.name ?? ''),
            eventName: String(L.eventName ?? ''),
            rows: Math.max(1, Math.floor(Number(L.rows)) || 1),
            cols: Math.max(1, Math.floor(Number(L.cols)) || 1),
            areas,
            background: typeof L.background === 'string' ? L.background : '',
            viewportScale,
            alignVertical: normalizeLayoutAlignVertical(L.alignVertical),
            alignHorizontal: normalizeLayoutAlignHorizontal(L.alignHorizontal),
            safetyPrimaryColor:
              typeof L.safetyPrimaryColor === 'string' ? L.safetyPrimaryColor : '',
            safetyAccentColor:
              typeof L.safetyAccentColor === 'string' ? L.safetyAccentColor : '',
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [layoutId]);

  const compactGrid = useMemo(
    () =>
      computeCompactGridSpec(
        layout?.areas ?? [],
        layout && layout.rows >= 1 ? layout.rows : 1,
        layout && layout.cols >= 1 ? layout.cols : 1
      ),
    [layout]
  );

  const stage = useMemo(() => {
    if (!layout || vw <= 0 || vh <= 0) {
      return { width: 0, height: 0 };
    }
    return layoutGridStageDimensions(
      vw,
      vh,
      compactGrid.effectiveCols,
      compactGrid.effectiveRows,
      layout.viewportScale
    );
  }, [layout, compactGrid, vw, vh]);

  const alignClass = layoutAlignmentFlexClasses(
    layout ? layout.alignVertical : 'middle',
    layout ? layout.alignHorizontal : 'center'
  );
  const safetyResolved = resolvedSafetyGradientColors(
    layout?.safetyPrimaryColor ?? '',
    layout?.safetyAccentColor ?? ''
  );
  const safetyLayerStyle = {
    background: safetyGradientCss(safetyResolved.primary, safetyResolved.accent),
  };

  if (error) {
    return (
      <div
        className={`relative min-h-0 min-w-0 w-screen h-screen overflow-hidden flex ${alignClass} text-red-300`}
      >
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={safetyLayerStyle}
          aria-hidden
        />
        <div className="relative z-10 px-4 text-center">{error}</div>
      </div>
    );
  }

  if (!layout) {
    return (
      <div
        className={`relative min-h-0 min-w-0 h-screen w-screen overflow-hidden flex ${alignClass}`}
        aria-busy="true"
      >
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={safetyLayerStyle}
          aria-hidden
        />
      </div>
    );
  }

  const bg = layout.background?.trim();
  const rigidAspect = layoutGridAspectRatioCss(
    compactGrid.effectiveCols,
    compactGrid.effectiveRows
  );
  const letterboxFit = layout.viewportScale !== 'fill';

  return (
    <div
      className={`relative min-h-0 min-w-0 w-screen h-screen overflow-hidden flex ${alignClass}`}
    >
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={safetyLayerStyle}
        aria-hidden
      />
      {bg ? (
        <>
          <style
            dangerouslySetInnerHTML={{
              __html: `.slideshow-layout-root-bg { ${bg} }`,
            }}
          />
          <div
            className="slideshow-layout-root-bg absolute inset-0 z-[1] pointer-events-none"
            aria-hidden
          />
        </>
      ) : null}

      <div
        className={
          letterboxFit
            ? 'relative z-10 min-h-0 min-w-0 overflow-hidden shadow-2xl'
            : 'relative z-10 overflow-hidden shadow-2xl'
        }
        style={{
          aspectRatio: rigidAspect,
          width: stage.width > 0 ? `${stage.width}px` : '100%',
          height: 'auto',
          boxSizing: 'border-box',
          ...(letterboxFit
            ? {
                /* Viewport caps: % alone inside flex can fail in Safari landscape */
                maxWidth: 'min(100vw, 100%)',
                maxHeight: 'min(100vh, 100%)',
              }
            : {}),
        }}
      >
        <div
          className="grid w-full h-full bg-transparent"
          style={{
            gridTemplateColumns: `repeat(${compactGrid.effectiveCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${compactGrid.effectiveRows}, minmax(0, 1fr))`,
            gap: 0,
          }}
        >
          {layout.areas.map((area) => {
            const placement = compactGrid.areaToPlacement(area.tiles);
            if (!placement) return null;
            return (
              <div
                key={area.id}
                className="relative min-h-0 min-w-0 overflow-hidden bg-transparent"
                style={{
                  gridRow: placement.gridRow,
                  gridColumn: placement.gridColumn,
                }}
              >
                {area.slideshowId ? (
                  <SlideshowPlayerCore
                    slideshowId={area.slideshowId}
                    instanceKey={`${layout.layoutId}:${area.id}`}
                    objectFit={area.objectFit === 'cover' ? 'cover' : 'contain'}
                    delayMs={area.delayMs ?? 0}
                    variant="embedded"
                    className="absolute inset-0"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
