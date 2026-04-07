/**
 * Camera-side mirror of "account disabled" for SSO-linked users.
 * We no longer read the SSO MongoDB; deactivation is stored on submissions here
 * and used for playlist / gallery filtering (with pseudo users still using userInfo.isActive).
 */

import type { Db } from 'mongodb';

import { COLLECTIONS } from '@/lib/db/schemas';

const FIELD = 'cameraAccountDisabled' as const;

/** Emails of SSO-backed users marked inactive via Camera admin (not pseudo form). */
export async function getInactiveUserEmailsFromMirror(db: Db): Promise<Set<string>> {
  const emails = await db
    .collection(COLLECTIONS.SUBMISSIONS)
    .distinct('userEmail', {
      [FIELD]: true,
      userEmail: { $exists: true, $nin: [null, '', 'anonymous@event'] },
    });
  const set = new Set<string>();
  for (const e of emails) {
    if (typeof e === 'string' && e) set.add(e);
  }
  return set;
}

/** Resolve SSO user id (sub) from any submission row for this email. */
export async function resolveSsoUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const row = await db.collection(COLLECTIONS.SUBMISSIONS).findOne(
    {
      userEmail: email,
      userId: { $exists: true, $nin: ['anonymous', null, ''] },
    },
    { projection: { userId: 1 }, sort: { createdAt: -1 } }
  );
  const id = row?.userId;
  return typeof id === 'string' && id !== 'anonymous' ? id : null;
}

export async function setCameraAccountDisabledForEmail(
  db: Db,
  email: string,
  disabled: boolean,
  meta: { actorUserId: string }
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.collection(COLLECTIONS.SUBMISSIONS).updateMany(
    { userEmail: email },
    {
      $set: {
        [FIELD]: disabled,
        cameraAccountDisabledAt: disabled ? now : null,
        cameraAccountDisabledBy: disabled ? meta.actorUserId : null,
        updatedAt: now,
      },
    }
  );
  return result.modifiedCount;
}

export { FIELD as CAMERA_ACCOUNT_DISABLED_FIELD };
