'use client';

/**
 * Public composite layout: each region runs an independent slideshow.
 */

import { use, useEffect, useState } from 'react';
import { SlideshowPlayerCore } from '@/components/slideshow/SlideshowPlayerCore';
import { areaToPercentBox } from '@/lib/slideshow/layout-geometry';
import type { SlideshowLayoutArea } from '@/lib/db/schemas';

interface LayoutPayload {
  layoutId: string;
  name: string;
  eventName: string;
  rows: number;
  cols: number;
  areas: SlideshowLayoutArea[];
  background: string;
}

export default function SlideshowLayoutPage({
  params,
}: {
  params: Promise<{ layoutId: string }>;
}) {
  const { layoutId } = use(params);
  const [layout, setLayout] = useState<LayoutPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const areas = (L.areas || []).map((a) => {
          const objectFit: 'contain' | 'cover' =
            a.objectFit === 'cover' ? 'cover' : 'contain';
          return {
            ...a,
            objectFit,
            delayMs: typeof a.delayMs === 'number' ? a.delayMs : 0,
          };
        });
        if (!cancelled) {
          setLayout({ ...L, areas });
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

  if (error) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
        Loading layout…
      </div>
    );
  }

  const bg = layout.background?.trim();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
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
      <div className="absolute inset-0 z-10">
        {layout.areas.map((area) => {
          const box = areaToPercentBox(area.tiles, layout.rows, layout.cols);
          if (!box) return null;
          return (
            <div
              key={area.id}
              className="absolute overflow-hidden bg-black"
              style={{
                left: `${box.left}%`,
                top: `${box.top}%`,
                width: `${box.width}%`,
                height: `${box.height}%`,
              }}
            >
              {area.slideshowId ? (
                <SlideshowPlayerCore
                  slideshowId={area.slideshowId}
                  objectFit={area.objectFit === 'cover' ? 'cover' : 'contain'}
                  delayMs={area.delayMs || 0}
                  variant="embedded"
                  className="absolute inset-0"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs md:text-sm px-2 text-center">
                  No slideshow assigned
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
