/**
 * Atlas index definitions for the Camera database.
 * Run via: npm run db:ensure-indexes (requires MONGODB_URI + MONGODB_DB).
 *
 * Safe to run repeatedly: MongoDB reconciles existing matching indexes.
 * Unique indexes fail if duplicate values exist — fix data first, then re-run.
 */

import type { Db } from 'mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';

export interface IndexEnsureResult {
  collection: string;
  name: string;
  status: 'created' | 'exists' | 'error';
  detail?: string;
}

/**
 * Create recommended indexes for production workloads (slideshow, capture, admin lists).
 */
export async function ensureCameraIndexes(db: Db): Promise<IndexEnsureResult[]> {
  const results: IndexEnsureResult[] = [];

  const track = async (
    collection: string,
    fn: () => Promise<string>
  ): Promise<void> => {
    try {
      const name = await fn();
      results.push({ collection, name, status: 'created' });
    } catch (e: unknown) {
      const err = e as { code?: number; codeName?: string; message?: string };
      const msg = err.message ?? String(e);
      if (
        err.code === 85 ||
        err.code === 86 ||
        err.codeName === 'IndexOptionsConflict' ||
        err.codeName === 'IndexKeySpecsConflict' ||
        msg.includes('already exists')
      ) {
        results.push({ collection, name: '(same spec)', status: 'exists', detail: msg });
        return;
      }
      results.push({
        collection,
        name: '(error)',
        status: 'error',
        detail: msg,
      });
    }
  };

  // --- partners ---
  await track(COLLECTIONS.PARTNERS, () =>
    db.collection(COLLECTIONS.PARTNERS).createIndex(
      { partnerId: 1 },
      {
        unique: true,
        name: 'partners_partnerId_unique',
        partialFilterExpression: { partnerId: { $type: 'string' } },
      }
    )
  );
  await track(COLLECTIONS.PARTNERS, () =>
    db.collection(COLLECTIONS.PARTNERS).createIndex({ isActive: 1, createdAt: -1 }, { name: 'partners_isActive_createdAt' })
  );

  // --- events ---
  await track(COLLECTIONS.EVENTS, () =>
    db.collection(COLLECTIONS.EVENTS).createIndex(
      { eventId: 1 },
      {
        unique: true,
        name: 'events_eventId_unique',
        partialFilterExpression: { eventId: { $type: 'string' } },
      }
    )
  );
  await track(COLLECTIONS.EVENTS, () =>
    db.collection(COLLECTIONS.EVENTS).createIndex({ partnerId: 1, createdAt: -1 }, { name: 'events_partnerId_createdAt' })
  );
  await track(COLLECTIONS.EVENTS, () =>
    db.collection(COLLECTIONS.EVENTS).createIndex({ isActive: 1, partnerId: 1 }, { name: 'events_isActive_partnerId' })
  );

  // --- frames ---
  await track(COLLECTIONS.FRAMES, () =>
    db.collection(COLLECTIONS.FRAMES).createIndex({ frameId: 1 }, { unique: true, name: 'frames_frameId_unique' })
  );
  await track(COLLECTIONS.FRAMES, () =>
    db.collection(COLLECTIONS.FRAMES).createIndex({ isActive: 1, createdAt: -1 }, { name: 'frames_isActive_createdAt' })
  );
  await track(COLLECTIONS.FRAMES, () =>
    db.collection(COLLECTIONS.FRAMES).createIndex({ partnerId: 1, isActive: 1 }, { name: 'frames_partnerId_isActive' })
  );

  // --- logos ---
  await track(COLLECTIONS.LOGOS, () =>
    db.collection(COLLECTIONS.LOGOS).createIndex({ isActive: 1, createdAt: -1 }, { name: 'logos_isActive_createdAt' })
  );

  // --- submissions (hot paths: slideshow aggregate, user gallery, admin) ---
  await track(COLLECTIONS.SUBMISSIONS, () =>
    db
      .collection(COLLECTIONS.SUBMISSIONS)
      .createIndex({ userId: 1, createdAt: -1 }, { name: 'submissions_userId_createdAt' })
  );
  await track(COLLECTIONS.SUBMISSIONS, () =>
    db
      .collection(COLLECTIONS.SUBMISSIONS)
      .createIndex(
        { eventId: 1, isArchived: 1, playCount: 1, createdAt: 1 },
        { name: 'submissions_eventId_archive_play_created' }
      )
  );
  await track(COLLECTIONS.SUBMISSIONS, () =>
    db
      .collection(COLLECTIONS.SUBMISSIONS)
      .createIndex(
        { eventIds: 1, isArchived: 1, playCount: 1, createdAt: 1 },
        { name: 'submissions_eventIds_archive_play_created' }
      )
  );
  await track(COLLECTIONS.SUBMISSIONS, () =>
    db
      .collection(COLLECTIONS.SUBMISSIONS)
      .createIndex({ isArchived: 1, createdAt: -1 }, { name: 'submissions_isArchived_createdAt' })
  );
  await track(COLLECTIONS.SUBMISSIONS, () =>
    db
      .collection(COLLECTIONS.SUBMISSIONS)
      .createIndex({ 'userInfo.email': 1 }, { sparse: true, name: 'submissions_userInfo_email_sparse' })
  );

  // --- slideshows ---
  await track(COLLECTIONS.SLIDESHOWS, () =>
    db
      .collection(COLLECTIONS.SLIDESHOWS)
      .createIndex({ slideshowId: 1 }, { unique: true, name: 'slideshows_slideshowId_unique' })
  );
  await track(COLLECTIONS.SLIDESHOWS, () =>
    db
      .collection(COLLECTIONS.SLIDESHOWS)
      .createIndex({ eventId: 1, createdAt: -1 }, { name: 'slideshows_eventId_createdAt' })
  );

  // --- slideshow layouts (composite videowall) ---
  await track(COLLECTIONS.SLIDESHOW_LAYOUTS, () =>
    db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .createIndex({ layoutId: 1 }, { unique: true, name: 'slideshow_layouts_layoutId_unique' })
  );
  await track(COLLECTIONS.SLIDESHOW_LAYOUTS, () =>
    db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .createIndex({ eventId: 1, createdAt: -1 }, { name: 'slideshow_layouts_eventId_createdAt' })
  );

  return results;
}
