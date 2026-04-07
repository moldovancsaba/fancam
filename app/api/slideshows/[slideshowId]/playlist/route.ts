/**
 * Slideshow Playlist API
 * Version: 2.0.0
 * 
 * GET: Generate next 5 slides for a slideshow with smart playlist logic
 * Returns slides with mosaic layouts for 1:1 and 9:16 images
 * 
 * v2.0.0: Filters inactive users (pseudo: userInfo.isActive; SSO: cameraAccountDisabled mirror on submissions)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { generatePlaylist } from '@/lib/slideshow/playlist';
import { findEventForSlideshow } from '@/lib/slideshow/resolve-event';
import { getInactiveUserEmails } from '@/lib/db/sso';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api';

/**
 * GET /api/slideshows/[slideshowId]/playlist?limit=N&exclude=id1,id2,id3
 * Generate slides with least-played logic
 * 
 * Query params:
 * - limit: Number of slides to return (default: slideshow.bufferSize or 10)
 * - exclude: Comma-separated list of submission IDs to exclude (images in other active playlists)
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

    // Build match filter: event + exclude IDs in other playlists + archived/hidden check + active users only
    // BACKWARD COMPATIBILITY: Support both eventId (singular) and eventIds (array)
    const matchFilter: any = {
      $and: [
        {
          $or: [
            { eventId: eventUuid },              // OLD: singular eventId field
            { eventIds: { $in: [eventUuid] } }   // NEW: eventIds array
          ]
        },
        { isArchived: { $ne: true } },           // Exclude archived
        {
          $or: [
            { hiddenFromEvents: { $exists: false } },     // Field doesn't exist (old data)
            { hiddenFromEvents: { $nin: [eventUuid] } }  // Not hidden from this event
          ]
        },
        // Exclude submissions from inactive SSO users (real users)
        // Also exclude pseudo users who have been marked inactive
        {
          $and: [
            // Filter out inactive real users (SSO authenticated)
            {
              $or: [
                // Real users: check userEmail against inactive list
                { userEmail: { $nin: Array.from(inactiveEmails) } },
                // Pseudo users: userId='anonymous' is always kept (not real SSO user)
                { userId: 'anonymous' }
              ]
            },
            // Filter out inactive pseudo users (userInfo.isActive = false)
            {
              $or: [
                { 'userInfo.isActive': { $ne: false } },  // Not inactive pseudo
                { userInfo: { $exists: false } }          // Not a pseudo user
              ]
            }
          ]
        }
      ]
    };
    if (excludeIds.length > 0) {
      // Convert string IDs to ObjectId for MongoDB comparison
      const excludeObjectIds = excludeIds
        .filter(id => ObjectId.isValid(id))
        .map(id => new ObjectId(id));
      
      if (excludeObjectIds.length > 0) {
        // Add _id exclusion to the $and array
        matchFilter.$and.push({ _id: { $nin: excludeObjectIds } });
        if (dbg) {
          console.log(
            `[Playlist] Excluding ${excludeObjectIds.length} images currently in other playlists`
          );
        }
      }
    }
    
    // Get submissions for the event, sorted by playCount (least played first)
    // CRITICAL: Handle undefined/null playCount by treating as 0
    // Then by createdAt (OLDEST first) to ensure fair rotation - older images get priority
    const submissions = await db
      .collection(COLLECTIONS.SUBMISSIONS)
      .aggregate([
        { $match: matchFilter },
        {
          $addFields: {
            // Ensure playCount is always a number (default 0 if undefined/null)
            normalizedPlayCount: { $ifNull: ['$playCount', 0] }
          }
        },
        { $sort: { normalizedPlayCount: 1, createdAt: 1 } } // ASCENDING for both (lowest first, oldest first)
      ])
      .toArray();
    
    if (dbg) {
      console.log(`[Playlist] Total submissions available (after filtering): ${submissions.length}`);
      console.log(`[Playlist] Match filter:`, JSON.stringify(matchFilter, null, 2));
      console.log('[Playlist] First 15 submissions by playCount (least played first):');
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
      return NextResponse.json({
        slideshow: {
          _id: slideshow._id,
          eventId: eventMongoId,
          eventUuid,
          name: slideshow.name,
          eventName: slideshow.eventName,
        },
        playlist: [],
        message: 'No submissions available for this event',
      });
    }

    // Generate playlist with mosaic logic
    const playlist = generatePlaylist(submissions, limit);

    return NextResponse.json({
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
      },
      playlist,
      totalSubmissions: submissions.length,
    });
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
