'use client';

/**
 * Public composite layout: one CSS grid (rows×cols) scaled as a single rigid unit;
 * each region runs an independent slideshow.
 */

import { use, useEffect, useMemo, useState } from 'react';
import { SlideshowPlayerCore } from '@/components/slideshow/SlideshowPlayerCore';
import { computeCompactGridSpec } from '@/lib/slideshow/layout-geometry';
import {
  layoutGridStageDimensions,
  type ViewportScaleMode,
} from '@/lib/slideshow/viewport-scale';
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
}

function useViewportSize() {
  const [size, setSize] = useState(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 0, h: 0 }
  );

  useEffect(() => {
    const set = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
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
        const L = data.layout as LayoutPayload;
        const areas = (L.areas || []).map((a) => ({
          ...a,
          objectFit: a.objectFit === 'cover' ? ('cover' as const) : ('contain' as const),
        }));
        const viewportScale: ViewportScaleMode =
          L.viewportScale === 'fill' ? 'fill' : 'fit';
        if (!cancelled) {
          setLayout({ ...L, areas, viewportScale });
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

  if (error) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  if (!layout) {
    return (
      <div
        className="h-screen w-screen bg-black"
        aria-busy="true"
      />
    );
  }

  const bg = layout.background?.trim();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center">
      {bg ? (
        <>
          <style
            dangerouslySetInnerHTML={{
              __html: `.slideshow-layout-root-bg { ${bg} }`,
            }}
          />
          <div
            className="slideshow-layout-root-bg absolute inset-0 z-0 pointer-events-none"
            aria-hidden
          />
        </>
      ) : null}

      <div
        className="relative z-10 overflow-hidden shadow-2xl"
        style={{
          width: stage.width > 0 ? `${stage.width}px` : '100%',
          height: stage.height > 0 ? `${stage.height}px` : '100%',
          maxWidth: '100%',
          maxHeight: '100%',
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
                    instanceKey={area.id}
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
