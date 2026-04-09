/**
 * Public GET slideshow layout by layoutId (for composite player).
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api';
import {
  normalizeLayoutAlignHorizontal,
  normalizeLayoutAlignVertical,
  normalizeStoredSafetyColor,
} from '@/lib/slideshow/layout-presentation';

function normalizeDelayMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(600_000, Math.floor(raw)));
  }
  if (typeof raw === 'string') {
    const n = parseInt(raw.trim(), 10);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(600_000, n));
    }
  }
  return 0;
}

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

    const rawAreas = Array.isArray(layout.areas) ? layout.areas : [];
    const areas = rawAreas.map((a: Record<string, unknown>) => ({
      ...a,
      delayMs: normalizeDelayMs(a.delayMs),
    }));

    const L = layout as Record<string, unknown>;

    return NextResponse.json({
      layout: {
        layoutId: layout.layoutId,
        name: layout.name,
        eventName: layout.eventName,
        rows: layout.rows,
        cols: layout.cols,
        areas,
        background: layout.background || '',
        viewportScale: layout.viewportScale === 'fill' ? 'fill' : 'fit',
        alignVertical: normalizeLayoutAlignVertical(L.alignVertical),
        alignHorizontal: normalizeLayoutAlignHorizontal(L.alignHorizontal),
        safetyPrimaryColor: normalizeStoredSafetyColor(L.safetyPrimaryColor),
        safetyAccentColor: normalizeStoredSafetyColor(L.safetyAccentColor),
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
