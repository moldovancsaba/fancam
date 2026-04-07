/**
 * Hashtags API
 * Version: 1.7.1
 * 
 * GET: Get all unique hashtags from frames (for filtering)
 */

import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { withErrorHandler, apiSuccess, checkRateLimit, RATE_LIMITS } from '@/lib/api';

/** Escape user input for safe use inside MongoDB `$regex` (avoid ReDoS / broken patterns). */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/hashtags
 * Get all unique hashtags with optional search
 * 
 * Query params:
 * - q: Search query (case-insensitive substring match)
 * - limit: Maximum number of results (default: 50)
 * 
 * Returns array of unique hashtag strings sorted alphabetically
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
    await checkRateLimit(request, RATE_LIMITS.READ);

    const { searchParams } = request.nextUrl;
    const query = searchParams.get('q');
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));

    const db = await connectToDatabase();
    
    // Use MongoDB aggregation to get unique hashtags from all frames
    // This extracts hashtags array, unwinds it, groups by unique values
    const pipeline: any[] = [
      // Only include frames that have hashtags
      { $match: { hashtags: { $exists: true, $ne: [] } } },
      // Unwind the hashtags array to separate documents
      { $unwind: '$hashtags' },
      // Group by hashtag to get unique values
      { $group: { _id: '$hashtags' } },
      // Sort alphabetically
      { $sort: { _id: 1 } },
    ];

    // Add search filter if query provided
    if (query && query.trim() !== '') {
      const safe = escapeRegex(query.trim());
      pipeline.splice(1, 0, {
        $match: {
          hashtags: { $regex: safe, $options: 'i' },
        },
      });
    }

    // Limit results
    pipeline.push({ $limit: limit });

    const results = await db
      .collection(COLLECTIONS.FRAMES)
      .aggregate(pipeline)
      .toArray();

    // Extract hashtag strings from _id field
    const hashtags = results.map((result) => result._id);

  return apiSuccess({
    hashtags,
    count: hashtags.length,
  });
});
