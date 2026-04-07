/**
 * PATCH /api/admin/users/[email]/role
 * Updates Camera app role via SSO HTTP API (PATCH permissions), not SSO MongoDB.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/db/mongodb';
import { resolveSsoUserIdByEmail } from '@/lib/sso/submission-account';
import { updateUserAppRoleViaSso } from '@/lib/sso/update-app-permission';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ email: string }> }
) {
  try {
    const session = await requireAdmin();
    const { email } = await context.params;

    const body = await request.json();
    const { role } = body;

    if (!role || !['user', 'admin'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be "user" or "admin"' },
        { status: 400 }
      );
    }

    const decodedEmail = decodeURIComponent(email);

    if (decodedEmail === session.user.email && role === 'user') {
      return NextResponse.json(
        { error: 'Cannot demote yourself from admin' },
        { status: 403 }
      );
    }

    const db = await connectToDatabase();
    const targetUserId = await resolveSsoUserIdByEmail(db, decodedEmail);

    if (!targetUserId) {
      return NextResponse.json(
        {
          error:
            'No SSO user id found for this email. The user must sign in once so Camera has a submission with their userId, or manage the role in the SSO admin UI.',
        },
        { status: 404 }
      );
    }

    const result = await updateUserAppRoleViaSso(
      targetUserId,
      role,
      session.accessToken
    );

    if (!result.ok) {
      console.error('SSO role update failed:', result.status, result.detail);
      return NextResponse.json(
        {
          error: 'SSO refused the role update',
          status: result.status,
          hint:
            'Ensure your SSO account may change app permissions over HTTP, or set the role in the SSO admin console.',
          detail: result.detail.slice(0, 500),
        },
        { status: 502 }
      );
    }

    console.log(`✓ App role updated via SSO: ${decodedEmail} → ${role} (by ${session.user.email})`);

    return NextResponse.json({
      success: true,
      message: `User app role updated to ${role}. User must sign out and sign in again to refresh tokens.`,
      email: decodedEmail,
      role,
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    return NextResponse.json(
      {
        error: 'Failed to update user role',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
