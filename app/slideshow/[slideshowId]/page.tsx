'use client';

/**
 * Full-screen slideshow — thin wrapper around SlideshowPlayerCore.
 */

import { use } from 'react';
import { SlideshowPlayerCore } from '@/components/slideshow/SlideshowPlayerCore';

export default function SlideshowPage({
  params,
}: {
  params: Promise<{ slideshowId: string }>;
}) {
  const { slideshowId } = use(params);
  return <SlideshowPlayerCore slideshowId={slideshowId} variant="fullscreen" />;
}
