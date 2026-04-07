/**
 * Update another user's Camera app role via SSO HTTP API (no SSO MongoDB).
 */

import { SSO_CONFIG } from '@/lib/auth/sso';

export type AppRoleWrite = 'user' | 'admin';

export async function updateUserAppRoleViaSso(
  targetUserId: string,
  role: AppRoleWrite,
  adminAccessToken: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const config = SSO_CONFIG();
  const clientId = config.clientId;
  const url = `${config.baseUrl}/api/users/${encodeURIComponent(targetUserId)}/apps/${encodeURIComponent(clientId)}/permissions`;

  const tryPatch = async () =>
    fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role }),
    });

  let res = await tryPatch();

  if (res.status === 405 || res.status === 404) {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role }),
    });
  }

  if (res.ok) {
    return { ok: true };
  }

  const detail = await res.text();
  return { ok: false, status: res.status, detail };
}
