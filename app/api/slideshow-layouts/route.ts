/**
 * Slideshow layouts API — composite videowall (multiple slideshows on a grid).
 */

import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/lib/db/mongodb';
import {
  COLLECTIONS,
  generateId,
  generateTimestamp,
  type SlideshowLayoutArea,
} from '@/lib/db/schemas';
import { getSession } from '@/lib/auth/session';
import { validateLayoutAreas } from '@/lib/slideshow/validate-layout';
import {
  normalizeLayoutAlignHorizontal,
  normalizeLayoutAlignVertical,
  parseSafetyColorInput,
} from '@/lib/slideshow/layout-presentation';

const DEFAULT_ROWS = 2;
const DEFAULT_COLS = 2;

function defaultAreas(rows: number, cols: number): SlideshowLayoutArea[] {
  const colors = ['#0ea5e9', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899'];
  const areas: SlideshowLayoutArea[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      areas.push({
        id: generateId(),
        label: `Cell ${r + 1}-${c + 1}`,
        tiles: [`${r}-${c}`],
        color: colors[i % colors.length],
        slideshowId: null,
        delayMs: 0,
        objectFit: 'contain',
      });
      i++;
    }
  }
  return areas;
}

async function assertSlideshowsForEvent(
  db: Awaited<ReturnType<typeof connectToDatabase>>,
  eventUuid: string,
  areas: SlideshowLayoutArea[]
): Promise<boolean> {
  const ids = [
    ...new Set(
      areas.map((a) => a.slideshowId).filter((x): x is string => Boolean(x))
    ),
  ];
  if (ids.length === 0) return true;
  const count = await db.collection(COLLECTIONS.SLIDESHOWS).countDocuments({
    slideshowId: { $in: ids },
    eventId: eventUuid,
  });
  return count === ids.length;
}

/**
 * POST — create layout (admin)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.appRole !== 'admin' && session.appRole !== 'superadmin') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { eventId, name, rows = DEFAULT_ROWS, cols = DEFAULT_COLS, areas } = body;

    if (!eventId || !name) {
      return NextResponse.json(
        { error: 'Event ID and layout name are required' },
        { status: 400 }
      );
    }

    const db = await connectToDatabase();
    const event = await db
      .collection(COLLECTIONS.EVENTS)
      .findOne({ _id: new ObjectId(eventId) });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const r = Math.max(1, Math.min(24, parseInt(String(rows), 10) || DEFAULT_ROWS));
    const c = Math.max(1, Math.min(24, parseInt(String(cols), 10) || DEFAULT_COLS));

    let layoutAreas: SlideshowLayoutArea[] =
      Array.isArray(areas) && areas.length > 0 ? areas : defaultAreas(r, c);

    const v = validateLayoutAreas(r, c, layoutAreas);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }

    if (!(await assertSlideshowsForEvent(db, event.eventId, layoutAreas))) {
      return NextResponse.json(
        { error: 'One or more slideshowIds are invalid for this event' },
        { status: 400 }
      );
    }

    const layoutViewportScale = body.viewportScale === 'fill' ? 'fill' : 'fit';

    const sp = parseSafetyColorInput(body.safetyPrimaryColor);
    const sa = parseSafetyColorInput(body.safetyAccentColor);
    if (!sp.ok) {
      return NextResponse.json({ error: sp.error }, { status: 400 });
    }
    if (!sa.ok) {
      return NextResponse.json({ error: sa.error }, { status: 400 });
    }

    const doc = {
      layoutId: generateId(),
      eventId: event.eventId,
      eventName: event.name,
      name: String(name).trim(),
      rows: r,
      cols: c,
      areas: layoutAreas,
      background: typeof body.background === 'string' ? body.background : '',
      viewportScale: layoutViewportScale,
      alignVertical: normalizeLayoutAlignVertical(body.alignVertical),
      alignHorizontal: normalizeLayoutAlignHorizontal(body.alignHorizontal),
      safetyPrimaryColor: sp.value,
      safetyAccentColor: sa.value,
      isActive: true,
      createdBy: session.user.id,
      createdAt: generateTimestamp(),
      updatedAt: generateTimestamp(),
    };

    const result = await db.collection(COLLECTIONS.SLIDESHOW_LAYOUTS).insertOne(doc);

    return NextResponse.json({
      success: true,
      layout: { _id: result.insertedId.toString(), ...doc },
    });
  } catch (error) {
    console.error('Error creating slideshow layout:', error);
    return NextResponse.json(
      { error: 'Failed to create layout' },
      { status: 500 }
    );
  }
}

/**
 * GET — list layouts for event (event UUID in query, same as slideshows)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json(
        { error: 'Event ID is required' },
        { status: 400 }
      );
    }

    const db = await connectToDatabase();
    const layouts = await db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .find({ eventId })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({ layouts });
  } catch (error) {
    console.error('Error fetching slideshow layouts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch layouts' },
      { status: 500 }
    );
  }
}

/**
 * PATCH — update layout (admin)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.appRole !== 'admin' && session.appRole !== 'superadmin') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Valid layout ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const db = await connectToDatabase();

    const existing = await db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return NextResponse.json({ error: 'Layout not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      updatedAt: generateTimestamp(),
    };

    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    if (body.background !== undefined) updates.background = String(body.background ?? '');
    if (body.viewportScale !== undefined) {
      if (body.viewportScale !== 'fit' && body.viewportScale !== 'fill') {
        return NextResponse.json(
          { error: 'viewportScale must be "fit" or "fill"' },
          { status: 400 }
        );
      }
      updates.viewportScale = body.viewportScale;
    }

    if (body.alignVertical !== undefined) {
      const v = body.alignVertical;
      if (v !== 'top' && v !== 'middle' && v !== 'bottom') {
        return NextResponse.json(
          { error: 'alignVertical must be "top", "middle", or "bottom"' },
          { status: 400 }
        );
      }
      updates.alignVertical = v;
    }
    if (body.alignHorizontal !== undefined) {
      const h = body.alignHorizontal;
      if (h !== 'left' && h !== 'center' && h !== 'right') {
        return NextResponse.json(
          { error: 'alignHorizontal must be "left", "center", or "right"' },
          { status: 400 }
        );
      }
      updates.alignHorizontal = h;
    }
    if (body.safetyPrimaryColor !== undefined) {
      const p = parseSafetyColorInput(body.safetyPrimaryColor);
      if (!p.ok) {
        return NextResponse.json({ error: p.error }, { status: 400 });
      }
      updates.safetyPrimaryColor = p.value;
    }
    if (body.safetyAccentColor !== undefined) {
      const a = parseSafetyColorInput(body.safetyAccentColor);
      if (!a.ok) {
        return NextResponse.json({ error: a.error }, { status: 400 });
      }
      updates.safetyAccentColor = a.value;
    }

    let nextRows = existing.rows as number;
    let nextCols = existing.cols as number;
    if (body.rows !== undefined) {
      nextRows = Math.max(1, Math.min(24, parseInt(String(body.rows), 10) || 1));
      updates.rows = nextRows;
    }
    if (body.cols !== undefined) {
      nextCols = Math.max(1, Math.min(24, parseInt(String(body.cols), 10) || 1));
      updates.cols = nextCols;
    }

    if (body.areas !== undefined) {
      if (!Array.isArray(body.areas)) {
        return NextResponse.json({ error: 'areas must be an array' }, { status: 400 });
      }
      const v = validateLayoutAreas(nextRows, nextCols, body.areas);
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 });
      }
      if (
        !(await assertSlideshowsForEvent(
          db,
          existing.eventId as string,
          body.areas
        ))
      ) {
        return NextResponse.json(
          { error: 'One or more slideshowIds are invalid for this event' },
          { status: 400 }
        );
      }
      updates.areas = body.areas;
    }

    const result = await db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updates },
        { returnDocument: 'after' }
      );

    return NextResponse.json({ success: true, layout: result });
  } catch (error) {
    console.error('Error updating slideshow layout:', error);
    return NextResponse.json(
      { error: 'Failed to update layout' },
      { status: 500 }
    );
  }
}

/**
 * DELETE — remove layout (admin)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.appRole !== 'admin' && session.appRole !== 'superadmin') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Valid layout ID is required' }, { status: 400 });
    }

    const db = await connectToDatabase();
    const result = await db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Layout not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting slideshow layout:', error);
    return NextResponse.json(
      { error: 'Failed to delete layout' },
      { status: 500 }
    );
  }
}
