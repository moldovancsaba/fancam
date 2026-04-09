/**
 * Public GET slideshow layout by layoutId (for composite player).
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ layoutId: string }> }
) {
  try {
    await checkRateLimit(_request, RATE_LIMITS.SLIDESHOW_LAYOUT_GET);

    const { layoutId } = await params;
    if (!layoutId) {
      return NextResponse.json({ error: 'layoutId required' }, { status: 400 });
    }

    const db = await connectToDatabase();
    const layout = await db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .findOne({ layoutId, isActive: { $ne: false } });

    if (!layout) {
      return NextResponse.json({ error: 'Layout not found' }, { status: 404 });
    }

    return NextResponse.json({
      layout: {
        layoutId: layout.layoutId,
        name: layout.name,
        eventName: layout.eventName,
        rows: layout.rows,
        cols: layout.cols,
        areas: layout.areas,
        background: layout.background || '',
      },
    });
  } catch (error) {
    if (error instanceof NextResponse) {
      return error;
    }
    console.error('Error fetching layout:', error);
    return NextResponse.json(
      { error: 'Failed to fetch layout' },
      { status: 500 }
    );
  }
}
