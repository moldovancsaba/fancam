/**
 * PATCH /api/admin/users/[email]/status
 * Real/administrator: mirror deactivate/reactivate on Camera submissions (cameraAccountDisabled).
 * Pseudo: unchanged (userInfo.isActive on submissions).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { setCameraAccountDisabledForEmail } from '@/lib/sso/submission-account';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ email: string }> }
) {
  try {
    const session = await requireAdmin();
    const { email } = await context.params;

    const body = await request.json();
    const { isActive, userType } = body;

    if (typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'isActive must be a boolean' },
        { status: 400 }
      );
    }

    if (!userType || !['real', 'pseudo', 'administrator'].includes(userType)) {
      return NextResponse.json(
        { error: 'Invalid userType. Must be "real", "pseudo", or "administrator"' },
        { status: 400 }
      );
    }

    const decodedEmail = decodeURIComponent(email);

    if (decodedEmail === session.user.email && !isActive) {
      return NextResponse.json(
        { error: 'Cannot deactivate yourself' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    if (userType === 'real' || userType === 'administrator') {
      const db = await connectToDatabase();
      const modified = await setCameraAccountDisabledForEmail(
        db,
        decodedEmail,
        !isActive,
        { actorUserId: session.user.id }
      );

      if (modified === 0) {
        return NextResponse.json(
          { error: 'No submissions found for this email (cannot mirror account status)' },
          { status: 404 }
        );
      }

      console.log(
        `✓ Camera mirror status: ${decodedEmail} → ${isActive ? 'active' : 'inactive'} (${modified} rows)`
      );

      return NextResponse.json({
        success: true,
        message: isActive
          ? 'User marked active in Camera (submissions). They can use the app if SSO still allows login.'
          : 'User hidden in Camera slideshows/gallery. SSO login may still work until blocked in SSO.',
        email: decodedEmail,
        isActive,
        userType,
        submissionsUpdated: modified,
      });
    }

    if (userType === 'pseudo') {
      const db = await connectToDatabase();

      const result = await db.collection(COLLECTIONS.SUBMISSIONS).updateMany(
        { 'userInfo.email': decodedEmail },
        {
          $set: {
            'userInfo.isActive': isActive,
            'userInfo.statusChangedBy': session.user.id,
            'userInfo.statusChangedAt': now,
            updatedAt: now,
          },
        }
      );

      if (result.matchedCount === 0) {
        return NextResponse.json(
          { error: 'No submissions found for this pseudo user' },
          { status: 404 }
        );
      }

      console.log(
        `✓ Pseudo user status: ${decodedEmail} → ${isActive ? 'active' : 'inactive'} (${result.modifiedCount} submissions)`
      );

      return NextResponse.json({
        success: true,
        message: `Pseudo user ${isActive ? 'activated' : 'deactivated'} successfully`,
        email: decodedEmail,
        isActive,
        userType,
        submissionsUpdated: result.modifiedCount,
      });
    }

    return NextResponse.json({ error: 'Unsupported userType' }, { status: 400 });
  } catch (error) {
    console.error('Error updating user status:', error);
    return NextResponse.json(
      {
        error: 'Failed to update user status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
