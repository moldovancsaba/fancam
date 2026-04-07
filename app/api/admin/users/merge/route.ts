/**
 * Admin User Merge API
 * POST /api/admin/users/merge
 * Resolves the real SSO user id from Camera submissions (no SSO MongoDB).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { resolveSsoUserIdByEmail } from '@/lib/sso/submission-account';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    const body = await request.json();
    const { pseudoEmail, realUserEmail, realUserId: bodyUserId } = body;

    if (!pseudoEmail || !realUserEmail) {
      return NextResponse.json(
        { error: 'Both pseudoEmail and realUserEmail are required' },
        { status: 400 }
      );
    }

    const db = await connectToDatabase();

    const realUserId =
      (typeof bodyUserId === 'string' && bodyUserId.trim()) ||
      (await resolveSsoUserIdByEmail(db, realUserEmail));

    if (!realUserId) {
      return NextResponse.json(
        {
          error:
            'Could not resolve SSO user id for that email. The user must sign in at least once so a submission or session row exists with their SSO id, or pass realUserId in the request body.',
        },
        { status: 404 }
      );
    }

    const realUser = await db.collection(COLLECTIONS.SUBMISSIONS).findOne(
      { userId: realUserId },
      { sort: { createdAt: -1 }, projection: { userEmail: 1, userName: 1 } }
    );

    const pseudoSubmissions = await db.collection(COLLECTIONS.SUBMISSIONS).find({
      'userInfo.email': pseudoEmail,
    }).toArray();

    if (pseudoSubmissions.length === 0) {
      return NextResponse.json(
        { error: 'No submissions found for pseudo user email' },
        { status: 404 }
      );
    }

    const alreadyMerged = pseudoSubmissions.some((s) => s.userInfo?.mergedWith);
    if (alreadyMerged) {
      return NextResponse.json(
        { error: 'Some submissions are already merged with another user' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const userEmail = realUser?.userEmail || realUserEmail;
    const userName = realUser?.userName || realUserEmail.split('@')[0];

    const result = await db.collection(COLLECTIONS.SUBMISSIONS).updateMany(
      { 'userInfo.email': pseudoEmail },
      {
        $set: {
          userId: realUserId,
          userEmail,
          userName,
          'userInfo.mergedWith': realUserId,
          'userInfo.mergedAt': now,
          'userInfo.mergedBy': session.user.id,
          updatedAt: now,
        },
      }
    );

    console.log(
      `✓ Merged pseudo ${pseudoEmail} → ${realUserEmail} (${result.modifiedCount} submissions)`
    );

    return NextResponse.json({
      success: true,
      message: `Successfully merged ${result.modifiedCount} submissions from pseudo user to real user`,
      pseudoEmail,
      realUserEmail,
      realUserId,
      submissionsMerged: result.modifiedCount,
      mergedAt: now,
    });
  } catch (error) {
    console.error('Error merging users:', error);
    return NextResponse.json(
      {
        error: 'Failed to merge users',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
