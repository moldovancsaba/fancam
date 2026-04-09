'use client';

/**
 * Admin-only: upload files into the event gallery (creates submissions via API).
 */

import { useRef, useState } from 'react';

interface Props {
  eventMongoId: string;
  onUploaded: (submission: Record<string, unknown>) => void;
}

async function probeImageSize(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

export default function EventGalleryUpload({
  eventMongoId,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pickFile = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setMessage(null);
    setBusy(true);
    try {
      const { width, height } = await probeImageSize(file);
      const formData = new FormData();
      formData.append('file', file);
      if (width > 0) formData.append('imageWidth', String(width));
      if (height > 0) formData.append('imageHeight', String(height));

      const res = await fetch(
        `/api/admin/events/${encodeURIComponent(eventMongoId)}/gallery-upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json.error === 'string' ? json.error : 'Upload failed'
        );
      }

      const submission = json.data?.submission;
      if (!submission) {
        throw new Error('Invalid response');
      }

      onUploaded(submission);
      setMessage('Photo added to gallery');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-900/40 p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Add photos to this event
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Admin only — uploads appear in the gallery and slideshows for this event (JPEG, PNG,
            WebP; max 32&nbsp;MB).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onChange}
          />
          <button
            type="button"
            onClick={pickFile}
            disabled={busy}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Uploading…' : 'Upload image'}
          </button>
        </div>
      </div>
      {message && (
        <p
          className={`text-xs mt-2 ${message.includes('fail') || message.includes('Invalid') || message.includes('required') ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
