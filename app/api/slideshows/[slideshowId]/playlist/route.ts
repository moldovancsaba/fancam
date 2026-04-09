/**
 * Slideshow Playlist API
 * Version: 2.0.0
 * 
 * GET: Generate next 5 slides for a slideshow with smart playlist logic
 * Returns slides with mosaic layouts for 1:1 and 9:16 images
 * 
 * v2.0.0: Filters inactive users (pseudo: userInfo.isActive; SSO: cameraAccountDisabled mirror on submissions)
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import {
  fnv1a32,
  generatePlaylist,
  rotateLeftBy,
  shuffleInPlace,
  shuffleInPlaceSeeded,
  expandPlaylistToLength,
} from '@/lib/slideshow/playlist';
import { findEventForSlideshow } from '@/lib/slideshow/resolve-event';
import { getInactiveUserEmails } from '@/lib/db/sso';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api';

/** Playlist is personalized (random / instanceKey); never cache across clients or layout cells. */
export const dynamic = 'force-dynamic';

const PLAYLIST_NO_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, must-revalidate',
} as const;

/**
 * GET /api/slideshows/[slideshowId]/playlist?limit=N&exclude=id1,id2,id3
 * Generate slides with least-played logic
 * 
 * Query params:
 * - limit: Number of slides to return (default: slideshow.bufferSize or 10)
 * - exclude: Comma-separated list of submission IDs to exclude (images in other active playlists)
 * - instanceKey: Optional stable id (e.g. layout region). With orderMode random, each key gets an
 *   independent shuffle per request (seed = hash(key) XOR per-request salt) so duplicate slideshows in a layout differ.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slideshowId: string }> }
) {
  try {
    await checkRateLimit(request, RATE_LIMITS.SLIDESHOW_PLAYLIST);

    const { slideshowId } = await params;
    const { searchParams } = request.nextUrl;
    const limitParam = searchParams.get('limit');
    const excludeParam = searchParams.get('exclude');
    const excludeIds = excludeParam ? excludeParam.split(',').filter(id => id.trim()) : [];
    const rawInstanceKey = searchParams.get('instanceKey')?.trim() ?? '';
    const instanceKey =
      rawInstanceKey.length > 256 ? rawInstanceKey.slice(0, 256) : rawInstanceKey;

    const db = await connectToDatabase();

    // Get slideshow details
    const slideshow = await db
      .collection(COLLECTIONS.SLIDESHOWS)
      .findOne({ slideshowId });

    if (!slideshow) {
      return NextResponse.json({ error: 'Slideshow not found' }, { status: 404 });
    }

    // Determine how many slides to generate
    const limit = limitParam ? parseInt(limitParam) : (slideshow.bufferSize || 10);

    const event = await findEventForSlideshow(db, String(slideshow.eventId));

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const eventUuid = event.eventId;
    const eventMongoId = event._id!.toString();
    const dbg = process.env.NODE_ENV !== 'production';
    if (dbg) {
      console.log(`[Playlist] Slideshow stored event ref: ${slideshow.eventId}`);
      console.log(`[Playlist] Event UUID (event.eventId): ${eventUuid}`);
      console.log(`[Playlist] Event Name: ${event.name}`);
    }

    // Emails mirrored as inactive on submissions (cameraAccountDisabled); not SSO MongoDB
    const inactiveEmails = await getInactiveUserEmails();
    if (dbg) {
      console.log(`[Playlist] Filtering out ${inactiveEmails.size} inactive users`);
    }

    const excludeObjectIds =
      excludeIds.length > 0
        ? excludeIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
        : [];

    if (dbg && excludeObjectIds.length > 0) {
      console.log(
        `[Playlist] Excluding ${excludeObjectIds.length} images currently in other playlists`
      );
    }

    // Build match filter: event + optional exclude + archived/hidden + active users only
    const buildMatchFilter = (excludeOids: ObjectId[]) => {
      const and: object[] = [
        {
          $or: [
            { eventId: eventUuid },
            { eventIds: { $in: [eventUuid] } },
          ],
        },
        { isArchived: { $ne: true } },
        {
          $or: [
            { hiddenFromEvents: { $exists: false } },
            { hiddenFromEvents: { $nin: [eventUuid] } },
          ],
        },
        {
          $and: [
            {
              $or: [
                { userEmail: { $nin: Array.from(inactiveEmails) } },
                { userId: 'anonymous' },
              ],
            },
            {
              $or: [
                { 'userInfo.isActive': { $ne: false } },
                { userInfo: { $exists: false } },
              ],
            },
          ],
        },
      ];
      if (excludeOids.length > 0) {
        and.push({ _id: { $nin: excludeOids } });
      }
      return { $and: and };
    };

    const fetchSubmissionsSorted = async (excludeOids: ObjectId[]) => {
      const matchFilter = buildMatchFilter(excludeOids);
      return db
        .collection(COLLECTIONS.SUBMISSIONS)
        .aggregate([
          { $match: matchFilter },
          {
            $addFields: {
              normalizedPlayCount: { $ifNull: ['$playCount', 0] },
            },
          },
          { $sort: { normalizedPlayCount: 1, createdAt: 1 } },
        ])
        .toArray();
    };

    let submissions = await fetchSubmissionsSorted(excludeObjectIds);
    // Small pool: excluding every ID already on screen can yield zero rows — fall back so buffers stay non-empty.
    if (submissions.length === 0 && excludeObjectIds.length > 0) {
      if (dbg) {
        console.log('[Playlist] Exclude exhausted pool; refetching without exclude');
      }
      submissions = await fetchSubmissionsSorted([]);
    }

    const orderMode = slideshow.orderMode === 'random' ? 'random' : 'fixed';
    if (orderMode === 'random' && submissions.length > 1) {
      if (instanceKey) {
        const randomSalt = randomBytes(4).readUInt32BE(0);
        const seed = (fnv1a32(instanceKey) ^ randomSalt) >>> 0;
        shuffleInPlaceSeeded(submissions, seed);
      } else {
        shuffleInPlace(submissions);
      }
    } else if (instanceKey && submissions.length > 1) {
      // Fixed fairness order: without this, every layout cell starts at the same head → identical tiles.
      rotateLeftBy(submissions, fnv1a32(instanceKey) % submissions.length);
    }

    const playMode = slideshow.playMode === 'once' ? 'once' : 'loop';

    const bgPrimary =
      typeof slideshow.backgroundPrimaryColor === 'string' && slideshow.backgroundPrimaryColor
        ? slideshow.backgroundPrimaryColor
        : '#312e81';
    const bgAccent =
      typeof slideshow.backgroundAccentColor === 'string' && slideshow.backgroundAccentColor
        ? slideshow.backgroundAccentColor
        : '#0f172a';
    const bgImage =
      typeof slideshow.backgroundImageUrl === 'string' && slideshow.backgroundImageUrl.trim()
        ? slideshow.backgroundImageUrl.trim()
        : null;
    const viewportScale = slideshow.viewportScale === 'fill' ? 'fill' : 'fit';
    
    if (dbg) {
      console.log(`[Playlist] Total submissions available (after filtering): ${submissions.length}`);
      console.log(
        `[Playlist] excludeObjectIds: ${excludeObjectIds.length}, orderMode: ${orderMode}, playMode: ${playMode}`
      );
      console.log('[Playlist] First 15 submissions (order may be shuffled when random):');
      submissions.slice(0, 15).forEach((sub, i) => {
        const width = sub.metadata?.finalWidth || sub.metadata?.originalWidth || '?';
        const height = sub.metadata?.finalHeight || sub.metadata?.originalHeight || '?';
        const ratio =
          width !== '?' && height !== '?' ? (width / height).toFixed(3) : '?';
        const hidden = sub.hiddenFromEvents || [];
        console.log(
          `  ${i + 1}. ${sub._id.toString().slice(-6)} - playCount: ${sub.playCount || 0}, ${width}x${height} (${ratio}), hidden: ${hidden.length > 0 ? hidden.join(',') : 'none'}`
        );
      });
    }

    if (submissions.length === 0) {
      return NextResponse.json(
        {
        slideshow: {
          _id: slideshow._id,
          eventId: eventMongoId,
          eventUuid,
          name: slideshow.name,
          eventName: slideshow.eventName,
          transitionDurationMs: slideshow.transitionDurationMs,
          fadeDurationMs: slideshow.fadeDurationMs,
          bufferSize: slideshow.bufferSize || 10,
          refreshStrategy: slideshow.refreshStrategy || 'continuous',
          playMode,
          orderMode,
          backgroundPrimaryColor: bgPrimary,
          backgroundAccentColor: bgAccent,
          backgroundImageUrl: bgImage,
          viewportScale,
        },
        playlist: [],
        message: 'No submissions available for this event',
        },
        { headers: PLAYLIST_NO_CACHE_HEADERS }
      );
    }

    // Generate playlist with mosaic logic
    const rawPlaylist = generatePlaylist(submissions, limit);
    const playlist =
      playMode === 'loop' && rawPlaylist.length > 0
        ? expandPlaylistToLength(rawPlaylist, limit)
        : rawPlaylist;

    return NextResponse.json(
      {
      slideshow: {
        _id: slideshow._id,
        eventId: eventMongoId,
        eventUuid,
        name: slideshow.name,
        eventName: slideshow.eventName,
        transitionDurationMs: slideshow.transitionDurationMs,
        fadeDurationMs: slideshow.fadeDurationMs,
        bufferSize: slideshow.bufferSize || 10,
        refreshStrategy: slideshow.refreshStrategy || 'continuous',
        playMode,
        orderMode,
        backgroundPrimaryColor: bgPrimary,
        backgroundAccentColor: bgAccent,
        backgroundImageUrl: bgImage,
        viewportScale,
      },
      playlist,
      totalSubmissions: submissions.length,
      },
      { headers: PLAYLIST_NO_CACHE_HEADERS }
    );
  } catch (error) {
    if (error instanceof NextResponse) {
      return error;
    }
    console.error('Error generating playlist:', error);
    return NextResponse.json(
      { error: 'Failed to generate playlist' },
      { status: 500 }
    );
  }
}
