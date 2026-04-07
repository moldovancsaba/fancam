/**
 * Admin Users Page
 * Version: 2.5.0
 * 
 * Comprehensive user management interface.
 * 
 * Features:
 * - Lists all user types: Administrators, Real users, Pseudo users, Anonymous users
 * - Role management (user ↔ admin)
 * - Status management (active ↔ inactive)
 * - Merge pseudo users with real users
 * - Visual indicators for user status and role
 * 
 * User Types:
 * - Administrator: SSO authenticated with admin role
 * - Real: SSO authenticated with user role
 * - Pseudo: Event guests who provided name/email
 * - Anonymous: Session-based, no personal info
 */

import { connectToDatabase } from '@/lib/db/mongodb';
import { getSession } from '@/lib/auth/session';
import Link from 'next/link';
import UserManagementActions from '@/components/admin/UserManagementActions';
import DatabaseConnectionAlert from '@/components/admin/DatabaseConnectionAlert';
import { getAppPermission, hasAppAccess } from '@/lib/auth/sso-permissions';

// Force dynamic rendering (uses cookies for session)
export const dynamic = 'force-dynamic';

/**
 * Sanitize username for URL
 * Replaces spaces and special characters with underscores
 */
function sanitizeUsername(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

export default async function AdminUsersPage() {
  let users: any[] = [];
  let error: unknown = null;
  let currentUserEmail = '';

  try {
    // Get current session for admin email
    const session = await getSession();
    currentUserEmail = session?.user.email || '';
    
    // Fetch camera database submissions
    const db = await connectToDatabase();
    const submissions = await db
      .collection('submissions')
      .find({ 
        $or: [
          { isArchived: false },
          { isArchived: { $exists: false } }
        ]
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Group submissions by user identifier (SSO profile loaded over HTTP below)
    const userMap = new Map<string, any>();

    for (const submission of submissions) {
      const hasUserInfo = submission.userInfo?.email && submission.userInfo?.name;
      const isMergedPseudo = hasUserInfo && submission.userInfo?.mergedWith;

      const identifier = isMergedPseudo
        ? submission.userInfo.mergedWith
        : hasUserInfo
          ? submission.userInfo.email
          : submission.userId || submission.userEmail;

      const isAnonymous =
        !hasUserInfo &&
        (submission.userId === 'anonymous' || submission.userEmail === 'anonymous@event');

      if (!userMap.has(identifier)) {
        const isPseudoUser = hasUserInfo && !isMergedPseudo;
        const isRealOrAdmin = !hasUserInfo && !isAnonymous;
        const isMergedUser = isMergedPseudo;

        let ssoIdForPermission: string | null = null;
        if (isMergedUser && submission.userInfo?.mergedWith) {
          ssoIdForPermission = submission.userInfo.mergedWith;
        } else if (
          isRealOrAdmin &&
          submission.userId &&
          submission.userId !== 'anonymous'
        ) {
          ssoIdForPermission = submission.userId;
        }

        let userType = 'pseudo';
        let role = 'user';
        let isActive = true;

        if (isAnonymous) {
          userType = 'anonymous';
        } else if (isMergedUser) {
          userType = 'real';
        } else if (isRealOrAdmin) {
          userType = 'real';
        } else if (isPseudoUser) {
          isActive = submission.userInfo?.isActive !== false;
          userType = 'pseudo';
        }

        const accountDisabledMirror = submission.cameraAccountDisabled === true;

        userMap.set(identifier, {
          email: hasUserInfo ? submission.userInfo.email : submission.userEmail,
          name: hasUserInfo
            ? submission.userInfo.name
            : isAnonymous
              ? 'Anonymous User'
              : submission.userName || 'Unknown',
          isAnonymous,
          type: userType,
          role,
          isActive,
          mergedWith: submission.userInfo?.mergedWith,
          collectedAt: submission.userInfo?.collectedAt || submission.createdAt,
          eventId: submission.eventId,
          eventName: submission.eventName || 'Unknown Event',
          submissions: [],
          ssoIdForPermission,
          accountDisabledMirror,
        });
      } else {
        const ent = userMap.get(identifier);
        if (ent && submission.cameraAccountDisabled) {
          ent.accountDisabledMirror = true;
        }
      }

      userMap.get(identifier)?.submissions.push({
        _id: submission._id,
        imageUrl: submission.imageUrl,
        createdAt: submission.createdAt,
      });
    }

    const adminSession = await getSession();
    if (adminSession?.accessToken) {
      const permCache = new Map<string, Awaited<ReturnType<typeof getAppPermission>>>();

      for (const u of userMap.values()) {
        if (!u.ssoIdForPermission) continue;

        try {
          let perm = permCache.get(u.ssoIdForPermission);
          if (!perm) {
            perm = await getAppPermission(u.ssoIdForPermission, adminSession.accessToken);
            permCache.set(u.ssoIdForPermission, perm);
          }

          const r = perm.role;
          u.role = r === 'superadmin' ? 'admin' : r;
          u.type =
            r === 'admin' || r === 'superadmin' ? 'administrator' : 'real';
          const approved = hasAppAccess(perm);
          u.isActive = approved && !u.accountDisabledMirror;
        } catch (e) {
          console.warn('[admin/users] getAppPermission failed for', u.ssoIdForPermission, e);
          u.isActive = !u.accountDisabledMirror;
        }
      }
    } else {
      for (const u of userMap.values()) {
        if (u.type === 'real' || u.type === 'administrator') {
          u.isActive = !u.accountDisabledMirror;
        }
      }
    }

    for (const u of userMap.values()) {
      if (u.type === 'pseudo') {
        u.isActive = u.isActive !== false;
      }
      if (u.type === 'anonymous') {
        u.isActive = true;
      }
    }

    users = Array.from(userMap.values());

  } catch (err) {
    console.error('Error fetching users:', err);
    error = err;
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Users</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Compact list with core info</p>
      </div>

      {error != null ? <DatabaseConnectionAlert error={error} /> : null}

      {!error && users.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="text-6xl mb-4">👥</div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No users yet</h3>
          <p className="text-gray-600 dark:text-gray-400">Waiting for first submissions</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {users.map((user: any, index: number) => {
              const profileHref = `/users/${sanitizeUsername(user.name || 'Anonymous')}`;
              const emailDisplay = user.isAnonymous ? 'anonymous@event.com' : (user.email || 'unknown');
              const registeredAt = new Date(user.collectedAt).toLocaleString();
              const photosCount = user.submissions.length;
              const lastEvent = user.eventName || 'Unknown Event';

              return (
                <div key={`${user.email}-${index}`} className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    {/* User Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <Link href={profileHref} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline truncate">
                          {user.name || 'Anonymous'}
                        </Link>
                        
                        {/* Status Badges */}
                        {user.isAnonymous && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">Anonymous</span>
                        )}
                        {user.type === 'administrator' && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded">Admin</span>
                        )}
                        {/* Only show Pseudo badge if NOT merged */}
                        {user.type === 'pseudo' && !user.mergedWith && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">Pseudo</span>
                        )}
                        {!user.isActive && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded">Inactive</span>
                        )}
                        {/* Show Merged badge but don't show Pseudo at the same time */}
                        {user.mergedWith && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">Merged</span>
                        )}
                      </div>
                      
                      <div className="space-y-1">
                        <div className="text-sm text-gray-600 dark:text-gray-400 truncate">📧 {emailDisplay}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 truncate">📸 {photosCount} photos</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 truncate">🎉 Last Event: {lastEvent}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 truncate">📅 Registered: {registeredAt}</div>
                      </div>
                    </div>
                    
                    {/* Management Actions */}
                    <div className="lg:w-80">
                      <UserManagementActions 
                        user={{
                          email: user.email,
                          name: user.name,
                          type: user.type,
                          role: user.role,
                          isActive: user.isActive,
                          mergedWith: user.mergedWith,
                        }}
                        currentUserEmail={currentUserEmail}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
