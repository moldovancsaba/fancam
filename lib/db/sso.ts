/**
 * SSO-related data access without connecting to the SSO service MongoDB.
 *
 * Inactive SSO-linked users are mirrored on Camera `submissions` via
 * `cameraAccountDisabled` (see lib/sso/submission-account.ts).
 */

import { connectToDatabase } from '@/lib/db/mongodb';
import { getInactiveUserEmailsFromMirror } from '@/lib/sso/submission-account';

/**
 * Emails of users whose submissions should be hidden (SSO-linked, disabled in Camera admin).
 */
export async function getInactiveUserEmails(): Promise<Set<string>> {
  const db = await connectToDatabase();
  return getInactiveUserEmailsFromMirror(db);
}
