/**
 * Slideshow Next Candidate API
 * Version: 1.0.0
 * 
 * GET: Returns single best next slide for rolling buffer
 * Used for continuous background refresh without interrupting playback
 * 
 * Query params:
 * - excludeIds: Comma-separated list of submission IDs already in buffer
 */

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { generatePlaylist } from '@/lib/slideshow/playlist';
import { findEventForSlideshow } from '@/lib/slideshow/resolve-event';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api';

/**
 * GET /api/slideshows/[slideshowId]/next-candidate?excludeIds=id1,id2,...
 * Returns single best candidate slide (16:9, 1:1 pair, or 9:16 triplet)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slideshowId: string }> }
) {
  try {
    await checkRateLimit(request, RATE_LIMITS.SLIDESHOW_NEXT);

    const { slideshowId } = await params;
    const { searchParams } = request.nextUrl;
    const excludeIdsParam = searchParams.get('excludeIds');
    
    // Parse excluded IDs (already in buffer)
    const excludeIds = excludeIdsParam ? excludeIdsParam.split(',') : [];

    const db = await connectToDatabase();

    // Get slideshow details
    const slideshow = await db
      .collection(COLLECTIONS.SLIDESHOWS)
      .findOne({ slideshowId });

    if (!slideshow) {
      return NextResponse.json({ error: 'Slideshow not found' }, { status: 404 });
    }

    const event = await findEventForSlideshow(db, String(slideshow.eventId));

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const eventUuid = event.eventId;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[NextCandidate] Slideshow stored event ref: ${slideshow.eventId}`);
      console.log(`[NextCandidate] Event UUID (event.eventId): ${eventUuid}`);
    }

    // Get submissions for the event, sorted by playCount (least played first)
    // Exclude submissions already in buffer
    // Only show submissions visible in Event Gallery (not hidden or archived)
    const submissions = await db
      .collection(COLLECTIONS.SUBMISSIONS)
      .find({ 
        $and: [
          {
            $or: [
              { eventId: eventUuid },                    // Old schema: singular eventId field
              { eventIds: { $in: [eventUuid] } }         // New schema: eventIds array
            ]
          },
          { _id: { $nin: excludeIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) } },
          { isArchived: { $ne: true } },                 // Exclude archived submissions
          {
            $or: [
              { hiddenFromEvents: { $exists: false } },  // Field doesn't exist yet (old data)
              { hiddenFromEvents: { $nin: [eventUuid] } } // Field exists and event not in it - USE UUID!
            ]
          }
        ]
      })
      .sort({ playCount: 1, createdAt: 1 })
      .toArray();

    if (submissions.length === 0) {
      return NextResponse.json({
        candidate: null,
        message: 'No new submissions available',
      });
    }

    // Generate single slide (might be 16:9, 1:1 pair, or 9:16 triplet)
    const playlist = generatePlaylist(submissions, 1);

    if (playlist.length === 0) {
      return NextResponse.json({
        candidate: null,
        message: 'No valid candidate found',
      });
    }

    return NextResponse.json({
      candidate: playlist[0],
      totalAvailable: submissions.length,
    });
  } catch (error) {
    if (error instanceof NextResponse) {
      return error;
    }
    console.error('Error generating next candidate:', error);
    return NextResponse.json(
      { error: 'Failed to generate next candidate' },
      { status: 500 }
    );
  }
}
