/**
 * Edit slideshow layout (grid + per-region slideshow assignment).
 */

import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { ObjectId } from 'mongodb';
import { notFound } from 'next/navigation';
import SlideshowLayoutBuilder from '@/components/admin/SlideshowLayoutBuilder';
import {
  normalizeLayoutAlignHorizontal,
  normalizeLayoutAlignVertical,
  normalizeStoredSafetyColor,
} from '@/lib/slideshow/layout-presentation';

export default async function EditSlideshowLayoutPage({
  params,
}: {
  params: Promise<{ id: string; layoutMongoId: string }>;
}) {
  const { id, layoutMongoId } = await params;

  if (!ObjectId.isValid(id) || !ObjectId.isValid(layoutMongoId)) {
    notFound();
  }

  const db = await connectToDatabase();
  const event = await db
    .collection(COLLECTIONS.EVENTS)
    .findOne({ _id: new ObjectId(id) });

  if (!event) {
    notFound();
  }

  const layout = await db.collection(COLLECTIONS.SLIDESHOW_LAYOUTS).findOne({
    _id: new ObjectId(layoutMongoId),
    eventId: event.eventId,
  });

  if (!layout) {
    notFound();
  }

  const layoutRaw = layout as Record<string, unknown>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Slideshow layout
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm">
        Event: {event.name} · Assign each region to a slideshow, set delay offsets and fit/fill.
      </p>
      <SlideshowLayoutBuilder
        layoutMongoId={layoutMongoId}
        eventMongoId={id}
        eventUuid={event.eventId}
        initialName={layout.name as string}
        initialRows={layout.rows as number}
        initialCols={layout.cols as number}
        initialAreas={JSON.parse(JSON.stringify(layout.areas || []))}
        initialBackground={(layout.background as string) || ''}
        initialViewportScale={
          (layout as { viewportScale?: string }).viewportScale === 'fill'
            ? 'fill'
            : 'fit'
        }
        initialAlignVertical={normalizeLayoutAlignVertical(
          layoutRaw.alignVertical
        )}
        initialAlignHorizontal={normalizeLayoutAlignHorizontal(
          layoutRaw.alignHorizontal
        )}
        initialSafetyPrimaryColor={normalizeStoredSafetyColor(
          layoutRaw.safetyPrimaryColor
        )}
        initialSafetyAccentColor={normalizeStoredSafetyColor(
          layoutRaw.safetyAccentColor
        )}
      />
    </div>
  );
}
