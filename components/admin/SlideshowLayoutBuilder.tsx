'use client';

/**
 * CardMass-style grid + area editor for slideshow layouts.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { SlideshowLayoutArea } from '@/lib/db/schemas';

type TileId = string;

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const PRESET_COLORS = [
  '#0ea5e9',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#ef4444',
];

function defaultAreas(rows: number, cols: number): SlideshowLayoutArea[] {
  const areas: SlideshowLayoutArea[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      areas.push({
        id: uid(),
        label: `Cell ${r + 1}-${c + 1}`,
        tiles: [`${r}-${c}`],
        color: PRESET_COLORS[i % PRESET_COLORS.length],
        slideshowId: null,
        delayMs: 0,
        objectFit: 'contain',
      });
      i++;
    }
  }
  return areas;
}

interface SlideshowOpt {
  _id: string;
  slideshowId: string;
  name: string;
}

interface Props {
  layoutMongoId: string;
  eventMongoId: string;
  eventUuid: string;
  initialName: string;
  initialRows: number;
  initialCols: number;
  initialAreas: SlideshowLayoutArea[];
  initialBackground?: string;
}

export default function SlideshowLayoutBuilder({
  layoutMongoId,
  eventMongoId,
  eventUuid,
  initialName,
  initialRows,
  initialCols,
  initialAreas,
  initialBackground = '',
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState(initialRows);
  const [cols, setCols] = useState(initialCols);
  const [areas, setAreas] = useState<SlideshowLayoutArea[]>(initialAreas);
  const [background, setBackground] = useState(initialBackground || '');
  const [slideshows, setSlideshows] = useState<SlideshowOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(
    initialAreas[0]?.id ?? null
  );

  const [selection, setSelection] = useState<Set<TileId>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<{ r: number; c: number } | null>(null);
  const [dragHover, setDragHover] = useState<{ r: number; c: number } | null>(null);
  const [newAreaLabel, setNewAreaLabel] = useState('');

  const wrapRef = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState({ w: 28, h: 28 });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/slideshows?eventId=${encodeURIComponent(eventUuid)}`
        );
        if (res.ok) {
          const data = await res.json();
          setSlideshows(data.slideshows || []);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [eventUuid]);

  const tileId = useCallback((r: number, c: number) => `${r}-${c}`, []);

  const tileToArea = useMemo(() => {
    const m = new Map<TileId, SlideshowLayoutArea>();
    for (const a of areas) {
      for (const t of a.tiles) {
        m.set(t, a);
      }
    }
    return m;
  }, [areas]);

  const rectTiles = useCallback(
    (a: { r: number; c: number }, b: { r: number; c: number }) => {
      const r1 = Math.min(a.r, b.r);
      const r2 = Math.max(a.r, b.r);
      const c1 = Math.min(a.c, b.c);
      const c2 = Math.max(a.c, b.c);
      const out: TileId[] = [];
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          out.push(tileId(r, c));
        }
      }
      return out;
    },
    [tileId]
  );

  const dragSet = useMemo(() => {
    if (!isDragging || !dragAnchor || !dragHover) return new Set<TileId>();
    return new Set(rectTiles(dragAnchor, dragHover));
  }, [isDragging, dragAnchor, dragHover, rectTiles]);

  useEffect(() => {
    function onUp() {
      if (!isDragging) return;
      setSelection((prev) => {
        const next = new Set(prev);
        for (const id of dragSet) {
          next.add(id);
        }
        return next;
      });
      setIsDragging(false);
      setDragAnchor(null);
      setDragHover(null);
    }
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [isDragging, dragSet]);

  useEffect(() => {
    function recompute() {
      const el = wrapRef.current;
      if (!el || cols <= 0 || rows <= 0) return;
      const gap = 1;
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      const cw = Math.max(8, Math.floor((availW - (cols - 1) * gap) / cols));
      const ch = Math.max(8, Math.floor((availH - (rows - 1) * gap) / rows));
      setCellPx({ w: cw, h: ch });
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', recompute);
    return () => {
      try {
        ro.disconnect();
      } catch {
        /* ignore */
      }
      window.removeEventListener('resize', recompute);
    };
  }, [rows, cols]);

  const commitSelectionAsArea = useCallback(() => {
    const tiles = Array.from(selection);
    const label = newAreaLabel.trim() || `Area ${areas.length + 1}`;
    if (tiles.length === 0) return;

    for (const t of tiles) {
      const [rs, cs] = t.split('-').map(Number);
      if (rs < 0 || rs >= rows || cs < 0 || cs >= cols) return;
    }

    setAreas((prev) => {
      let next = prev.map((a) => ({
        ...a,
        tiles: a.tiles.filter((t) => !selection.has(t)),
      }));
      next = next.filter((a) => a.tiles.length > 0);
      const color = PRESET_COLORS[next.length % PRESET_COLORS.length];
      const area: SlideshowLayoutArea = {
        id: uid(),
        label,
        tiles,
        color,
        slideshowId: null,
        delayMs: 0,
        objectFit: 'contain',
      };
      return [...next, area];
    });
    setSelection(new Set());
    setNewAreaLabel('');
  }, [selection, newAreaLabel, areas.length, rows, cols]);

  const removeArea = useCallback((id: string) => {
    setAreas((prev) => prev.filter((a) => a.id !== id));
    setSelectedAreaId((cur) => (cur === id ? null : cur));
  }, []);

  const applyGridReset = useCallback(() => {
    const r = Math.max(1, Math.min(24, rows));
    const c = Math.max(1, Math.min(24, cols));
    if (
      !confirm(
        `Set grid to ${r}×${c} and reset all regions to single cells? Unsaved slideshow assignments in merged areas will be lost.`
      )
    ) {
      return;
    }
    setRows(r);
    setCols(c);
    setAreas(defaultAreas(r, c));
    setSelection(new Set());
    setSelectedAreaId(null);
  }, [rows, cols]);

  const selectedArea = areas.find((a) => a.id === selectedAreaId) ?? null;

  const updateSelectedArea = (patch: Partial<SlideshowLayoutArea>) => {
    if (!selectedAreaId) return;
    setAreas((prev) =>
      prev.map((a) => (a.id === selectedAreaId ? { ...a, ...patch } : a))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/slideshow-layouts?id=${layoutMongoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          rows,
          cols,
          areas,
          background,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Save failed');
        return;
      }
      alert('Saved');
      router.refresh();
    } catch {
      alert('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <button
          type="button"
          onClick={() => router.push(`/admin/events/${eventMongoId}`)}
          className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
        >
          ← Back to event
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save layout'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col text-sm">
              <span className="text-gray-600 dark:text-gray-400">Layout name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 min-w-[200px]"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-gray-600 dark:text-gray-400">Rows</span>
              <input
                type="number"
                min={1}
                max={24}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value) || 1)}
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 w-20 bg-white dark:bg-gray-800"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-gray-600 dark:text-gray-400">Cols</span>
              <input
                type="number"
                min={1}
                max={24}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value) || 1)}
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 w-20 bg-white dark:bg-gray-800"
              />
            </label>
            <button
              type="button"
              onClick={applyGridReset}
              className="px-3 py-2 bg-amber-600 text-white rounded text-sm font-medium"
            >
              Apply grid & reset cells
            </button>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Drag on the grid to select tiles, then name the region and commit. Each region maps to one
            slideshow. Tiles cannot overlap.
          </p>

          <div
            ref={wrapRef}
            className="border border-gray-200 dark:border-gray-600 rounded-lg p-2 bg-gray-100 dark:bg-gray-900"
            style={{ height: 'min(60vh, 520px)' }}
          >
            <div
              className="grid h-full w-full"
              style={{
                gridTemplateColumns: `repeat(${cols}, ${cellPx.w}px)`,
                gridTemplateRows: `repeat(${rows}, ${cellPx.h}px)`,
                gap: 1,
              }}
            >
              {Array.from({ length: rows * cols }, (_, i) => {
                const r = Math.floor(i / cols);
                const c = i % cols;
                const tid = tileId(r, c);
                const area = tileToArea.get(tid);
                const inDrag = dragSet.has(tid);
                const inSel = selection.has(tid);
                const bg = area?.color || '#374151';
                return (
                  <div
                    key={tid}
                    role="presentation"
                    className={`rounded-sm cursor-pointer border border-black/20 ${
                      selectedAreaId && area?.id === selectedAreaId
                        ? 'ring-2 ring-white'
                        : ''
                    }`}
                    style={{
                      backgroundColor: bg,
                      opacity: inDrag || inSel ? 0.85 : 1,
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                      setDragAnchor({ r, c });
                      setDragHover({ r, c });
                    }}
                    onMouseEnter={() => {
                      if (isDragging) setDragHover({ r, c });
                    }}
                    onClick={() => {
                      if (area) setSelectedAreaId(area.id);
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="New region label"
              value={newAreaLabel}
              onChange={(e) => setNewAreaLabel(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm flex-1 min-w-[160px] bg-white dark:bg-gray-800"
            />
            <button
              type="button"
              onClick={commitSelectionAsArea}
              disabled={selection.size === 0}
              className="px-3 py-2 bg-indigo-600 text-white rounded text-sm disabled:opacity-40"
            >
              Create region from selection
            </button>
            <button
              type="button"
              onClick={() => setSelection(new Set())}
              className="px-3 py-2 bg-gray-300 dark:bg-gray-600 rounded text-sm"
            >
              Clear selection
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Outer background (CSS, background-* only)
            </span>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              rows={4}
              className="font-mono text-xs border border-gray-300 dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-800"
            />
          </label>
        </div>

        <div className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">Regions</h3>
          <ul className="space-y-2 max-h-48 overflow-y-auto text-sm">
            {areas.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedAreaId(a.id)}
                  className={`w-full text-left px-2 py-1 rounded ${
                    selectedAreaId === a.id
                      ? 'bg-indigo-100 dark:bg-indigo-900/40'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <span
                    className="inline-block w-3 h-3 rounded mr-2 align-middle"
                    style={{ backgroundColor: a.color || '#999' }}
                  />
                  {a.label} ({a.tiles.length} tiles)
                </button>
              </li>
            ))}
          </ul>

          {selectedArea ? (
            <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-600">
              <div>
                <label className="text-xs text-gray-500">Label</label>
                <input
                  value={selectedArea.label}
                  onChange={(e) => updateSelectedArea({ label: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Slideshow</label>
                <select
                  value={selectedArea.slideshowId || ''}
                  onChange={(e) =>
                    updateSelectedArea({
                      slideshowId: e.target.value || null,
                    })
                  }
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-900"
                >
                  <option value="">— None —</option>
                  {slideshows.map((s) => (
                    <option key={s.slideshowId} value={s.slideshowId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Delay (ms)</label>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  value={selectedArea.delayMs}
                  onChange={(e) =>
                    updateSelectedArea({ delayMs: Number(e.target.value) || 0 })
                  }
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Photo scaling</label>
                <select
                  value={selectedArea.objectFit}
                  onChange={(e) =>
                    updateSelectedArea({
                      objectFit: e.target.value as 'contain' | 'cover',
                    })
                  }
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-900"
                >
                  <option value="contain">Fit (letterbox)</option>
                  <option value="cover">Fill (crop)</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => removeArea(selectedArea.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove region
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Select a region to edit.</p>
          )}
        </div>
      </div>
    </div>
  );
}
