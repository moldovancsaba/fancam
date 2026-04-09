'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface SlideshowLayoutListItem {
  _id: string;
  layoutId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  eventMongoId: string;
  initialLayouts: SlideshowLayoutListItem[];
}

export default function SlideshowLayoutManager({
  eventMongoId,
  initialLayouts,
}: Props) {
  const [layouts, setLayouts] = useState(initialLayouts);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const name = prompt('Layout name (e.g. Main videowall):');
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/slideshow-layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eventMongoId, name: name.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to create layout');
        return;
      }
      const data = await res.json();
      setLayouts([
        {
          _id: data.layout._id,
          layoutId: data.layout.layoutId,
          name: data.layout.name,
          isActive: data.layout.isActive,
          createdAt: data.layout.createdAt,
        },
        ...layouts,
      ]);
    } catch {
      alert('Failed to create layout');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (mongoId: string) => {
    if (!confirm('Delete this slideshow layout?')) return;
    try {
      const res = await fetch(`/api/slideshow-layouts?id=${mongoId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setLayouts(layouts.filter((l) => l._id !== mongoId));
      } else {
        alert('Failed to delete');
      }
    } catch {
      alert('Failed to delete');
    }
  };

  const copyUrl = (layoutId: string) => {
    const url = `${window.location.origin}/slideshow-layout/${layoutId}`;
    navigator.clipboard.writeText(url);
    alert('Layout URL copied to clipboard');
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              📺 Event Slideshow Layouts
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Combine multiple slideshows on one screen (grid builder)
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {creating ? 'Creating…' : '➕ New layout'}
          </button>
        </div>
      </div>

      {layouts.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-5xl mb-4">🎛️</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No layouts yet
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Create a layout to assign slideshows to regions on a shared display
          </p>
        </div>
      ) : (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {layouts.map((layout) => (
              <div
                key={layout._id}
                className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {layout.name}
                    </h3>
                    <span
                      className={`inline-flex mt-1 px-2 py-1 text-xs font-semibold rounded-full ${
                        layout.isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {layout.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(layout._id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Created {new Date(layout.createdAt).toLocaleDateString()}
                  </div>
                  <Link
                    href={`/admin/events/${eventMongoId}/layouts/${layout._id}`}
                    className="block w-full px-3 py-2 bg-indigo-600 text-white rounded text-sm font-semibold hover:bg-indigo-700 transition-colors text-center"
                  >
                    ✏️ Edit layout
                  </Link>
                  <Link
                    href={`/slideshow-layout/${layout.layoutId}`}
                    target="_blank"
                    className="block w-full px-3 py-2 bg-gray-800 text-white rounded text-sm font-semibold hover:bg-gray-900 transition-colors text-center"
                  >
                    🎬 Open layout
                  </Link>
                  <button
                    type="button"
                    onClick={() => copyUrl(layout.layoutId)}
                    className="w-full px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded text-xs hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  >
                    📋 Copy public URL
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
