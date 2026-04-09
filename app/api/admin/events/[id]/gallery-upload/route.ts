/**
 * Admin-only: upload an existing image file into an event's gallery (new submission).
 *
 * POST multipart/form-data: file (required), imageWidth, imageHeight (optional, from client probe)
 */

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS, generateTimestamp } from '@/lib/db/schemas';
import { uploadImage } from '@/lib/imgbb/upload';
import {
  withErrorHandler,
  requireAdmin,
  apiCreated,
  apiBadRequest,
  apiNotFound,
  checkRateLimit,
  RATE_LIMITS,
} from '@/lib/api';

const MAX_BYTES = 32 * 1024 * 1024; // imgbb limit

export const POST = withErrorHandler(
  async (
    request: NextRequest,
    context?: { params?: Promise<{ id: string }> }
  ) => {
    const session = await requireAdmin(request);
    await checkRateLimit(request, RATE_LIMITS.UPLOAD);

    const { id: eventMongoId } = await context!.params!;

    if (!ObjectId.isValid(eventMongoId)) {
      throw apiBadRequest('Invalid event id');
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const widthRaw = formData.get('imageWidth');
    const heightRaw = formData.get('imageHeight');

    if (!file || typeof file === 'string') {
      throw apiBadRequest('Image file is required');
    }

    if (!(file instanceof File)) {
      throw apiBadRequest('Invalid file upload');
    }

    if (!file.type.startsWith('image/')) {
      throw apiBadRequest('File must be an image');
    }

    if (file.size > MAX_BYTES) {
      throw apiBadRequest(`Image must be under ${MAX_BYTES / 1024 / 1024} MB`);
    }

    const imageWidth =
      widthRaw != null && widthRaw !== ''
        ? Math.max(1, parseInt(String(widthRaw), 10) || 0)
        : 0;
    const imageHeight =
      heightRaw != null && heightRaw !== ''
        ? Math.max(1, parseInt(String(heightRaw), 10) || 0)
        : 0;

    const db = await connectToDatabase();

    const event = await db
      .collection(COLLECTIONS.EVENTS)
      .findOne({ _id: new ObjectId(eventMongoId) });

    if (!event) {
      throw apiNotFound('Event not found');
    }

    const partner = event.partnerId
      ? await db
          .collection(COLLECTIONS.PARTNERS)
          .findOne({ partnerId: event.partnerId })
      : null;

    const eventUuid = event.eventId as string;
    const now = generateTimestamp();

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString('base64');

    const uploadResult = await uploadImage(base64, {
      name: `admin-gallery-${eventUuid}-${Date.now()}`,
    });

    const adminLabel =
      session.user.name || session.user.email || 'Admin';

    const submission = {
      userId: session.user.id,
      userEmail: session.user.email || 'admin@upload',
      userName: `${adminLabel} (gallery upload)`,
      frameId: null,
      frameName: null,
      frameCategory: null,
      partnerId: (event.partnerId as string) || null,
      partnerName: (partner?.name as string) || null,
      eventId: eventUuid,
      eventIds: [eventUuid],
      eventName: (event.name as string) || null,
      imageUrl: uploadResult.imageUrl,
      finalImageUrl: uploadResult.imageUrl,
      deleteUrl: uploadResult.deleteUrl,
      imageId: uploadResult.imageId,
      fileSize: uploadResult.fileSize,
      mimeType: uploadResult.mimeType,
      consents: [] as unknown[],
      isArchived: false,
      shareCount: 0,
      downloadCount: 0,
      playCount: 0,
      hiddenFromPartner: false,
      hiddenFromEvents: [] as string[],
      metadata: {
        device: request.headers.get('user-agent'),
        ip:
          request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip'),
        finalFileSize: uploadResult.fileSize,
        finalWidth: imageWidth || 1920,
        finalHeight: imageHeight || 1080,
        adminGalleryUpload: true,
        adminUploadedBy: session.user.id,
        adminUploadedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    const result = await db
      .collection(COLLECTIONS.SUBMISSIONS)
      .insertOne(submission);

    return apiCreated({
      submission: {
        ...submission,
        _id: result.insertedId.toString(),
      },
    });
  }
);
