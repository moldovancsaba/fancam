# Authorization Guide

**Version**: 1.0.0  
**Last Updated**: 2025-11-09T20:30:00.000Z

## Critical: Always Use `session.appRole` for Authorization

### ⚠️ Common Mistake

**WRONG** ❌:
```typescript
if (session.user.role === 'admin') {
  // This checks SSO-level role, NOT app-level role!
}
```

**CORRECT** ✅:
```typescript
if (session.appRole === 'admin' || session.appRole === 'superadmin') {
  // This checks app-specific role from SSO permissions
}
```

---

## Why Two Role Fields?

### `session.user.role` (SSO-Level Role)
- **Source**: Extracted from OIDC ID token during OAuth login
- **Scope**: User's global role across ALL SSO-managed applications
- **Examples**: `'super-admin'`, `'user'`, `null`
- **Use Case**: SSO administration, NOT for app-specific authorization

### `session.appRole` (App-Level Role)
- **Source**: Queried from SSO `/api/users/{userId}/apps/{clientId}/permissions` during OAuth callback
- **Scope**: User's role specifically for THIS application (Camera)
- **Examples**: `'admin'`, `'user'`, `'none'`, `'superadmin'`
- **Use Case**: **ALL app authorization checks**

---

## SSO Multi-App Permission System

SSO v5.24.0+ uses a **multi-app permission model** where:

1. Each application has its own client ID
2. Users must explicitly request access to each app
3. Admins grant app-specific roles to users
4. Each user can have different roles in different apps

**Example**:
- User A: `admin` in Camera app, `user` in Analytics app
- User B: `user` in Camera app, `admin` in Analytics app

### Where permissions live (conceptual)

Camera talks to SSO **over HTTPS** (`/api/oauth/*`, `/api/users/.../permissions`). It does **not** use `SSO_MONGODB_URI` or read the SSO service MongoDB.

On the SSO side, permissions are still typically backed by data like **app permissions** per user and client (conceptually similar to):

```javascript
// Illustrative — actual storage is inside the SSO product, not queried by Camera
{
  userId: "5143beb1-9bb6-47e7-a099-e9eeb2d89e93",
  clientId: "1e59b6a1-3c18-4141-9139-7a3dd0da62bf",  // Camera app
  role: "admin",
  hasAccess: true,
  status: "approved"
}
```

**“Deactivate” in Camera admin (SSO users):** Camera stores `cameraAccountDisabled` on **submissions** so slideshows/galleries can hide that person without a Mongo connection to SSO. That does not revoke SSO login by itself—use the SSO admin tools if login must be blocked at the IdP.

---

## How Roles Are Set During Login

### OAuth Callback Flow (`app/api/auth/callback/route.ts`)

1. **Exchange code for tokens** → Get ID token with `user.role`
2. **Decode ID token** → Extract `session.user.role` (SSO-level)
3. **Query SSO permissions API** → Get `appRole` for Camera app
4. **Store both in session**:
   ```typescript
   await createSession(user, tokens, {
     appRole: permission.role,  // 'admin', 'user', etc.
     appAccess: permission.hasAccess
   });
   ```

---

## Authorization Patterns

### Pattern 1: Require Admin (Recommended)

Use the `requireAdmin()` middleware from `lib/api/middleware.ts`:

```typescript
import { requireAdmin } from '@/lib/api';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireAdmin();  // ✅ Checks appRole
  
  // Admin-only logic
});
```

**Implementation**:
```typescript
export async function requireAdmin(): Promise<Session> {
  const session = await requireAuth();
  
  // ✅ CORRECT: Checks appRole
  if (session.appRole !== 'admin' && session.appRole !== 'superadmin') {
    throw apiForbidden('Admin access required for this app');
  }
  
  return session;
}
```

### Pattern 2: Manual Check

```typescript
const session = await getSession();

if (!session) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// ✅ CORRECT: Check appRole
if (session.appRole !== 'admin' && session.appRole !== 'superadmin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

### Pattern 3: Owner or Admin

```typescript
const isOwner = resource.userId === session.user.id;
// ✅ CORRECT: Check appRole for admin
const isAdmin = session.appRole === 'admin' || session.appRole === 'superadmin';

if (!isOwner && !isAdmin) {
  throw apiForbidden('You can only access your own resources');
}
```

### Pattern 4: Frontend Display

```typescript
// Homepage - Show admin button
{session.appRole === 'admin' || session.appRole === 'superadmin' && (
  <a href="/admin">Admin Panel</a>
)}

// Admin layout - Protect route
if (session.appRole !== 'admin' && session.appRole !== 'superadmin') {
  redirect('/');
}
```

---

## Granting App-Level Admin Access

### Via Script

```bash
node scripts/grant-app-permission.mjs <userId> admin
```

**Example**:
```bash
node scripts/grant-app-permission.mjs 5143beb1-9bb6-47e7-a099-e9eeb2d89e93 admin
```

### Via MongoDB

```javascript
// Connect to SSO database
const db = client.db('sso');

// Grant admin role
await db.collection('appPermissions').updateOne(
  {
    userId: "5143beb1-9bb6-47e7-a099-e9eeb2d89e93",
    clientId: "1e59b6a1-3c18-4141-9139-7a3dd0da62bf"
  },
  {
    $set: {
      role: "admin",
      hasAccess: true,
      status: "approved",
      grantedAt: new Date().toISOString()
    }
  },
  { upsert: true }
);
```

**User must logout and login again for changes to take effect.**

---

## Complete Checklist

When adding authorization to an endpoint:

- [ ] Use `requireAdmin()` middleware OR
- [ ] Manually check `session.appRole` (NOT `session.user.role`)
- [ ] Check for both `'admin'` AND `'superadmin'` roles
- [ ] Add comment: `// Check app-specific role (appRole), not SSO-level role (user.role)`
- [ ] Test with actual admin user
- [ ] Verify 403 response for non-admin users

---

## Files Fixed

All authorization checks have been updated to use `session.appRole`:

- ✅ `lib/api/middleware.ts` - `requireAdmin()` middleware
- ✅ `app/page.tsx` - Homepage admin button
- ✅ `app/admin/layout.tsx` - Admin route protection
- ✅ `components/admin/CollapsibleSidebar.tsx` - Sidebar role display
- ✅ `app/api/partners/[partnerId]/route.ts` - PATCH and DELETE
- ✅ `app/api/partners/[partnerId]/toggle/route.ts` - Toggle status
- ✅ `app/api/frames/[id]/route.ts` - PUT and DELETE
- ✅ `app/api/submissions/[submissionId]/route.ts` - DELETE

---

## Troubleshooting

### "Forbidden" error despite being admin in SSO

**Problem**: You have SSO admin role but not app-level admin role.

**Solution**:
1. Check your app permission:
   ```bash
   node scripts/grant-app-permission.mjs <your-user-id> admin
   ```
2. Logout and login again
3. Check sidebar - should show "admin" not "user"

### Session shows wrong role

**Problem**: Cached session with old role.

**Solution**:
1. Logout completely
2. Login again
3. Session will refresh with new `appRole`

---

## Social login (Google / Facebook)

The Camera app starts OAuth at **`GET /api/auth/login`** with optional **`provider=google`** or **`provider=facebook`**. Those values are forwarded to the SSO authorize URL (same pattern as the Amanoba project: `…/login?provider=google`). The SSO service ([sso.doneisbetter.com](https://sso.doneisbetter.com)) must accept that `provider` query parameter for your OAuth client.

---

## Transactional email vs SSO

**SSO ([sso.doneisbetter.com](https://sso.doneisbetter.com))** handles **authentication** (OAuth2/OIDC, tokens, app permissions). It is **not** a transactional email API for this app: it does not send “your photo is ready” or welcome messages on behalf of Camera.

If you need outbound mail later, use a mail provider (e.g. Resend, SendGrid) from **this app’s server code**, or whatever mechanism your IdP offers **separately** from the login protocol. Replacing Resend with “SSO” is only possible if the IdP exposes a documented **send-email** API you integrate explicitly—OIDC discovery alone does not provide that.

This repository **does not** currently send email from any API route; there is no dependency on Resend for runtime behavior.

---

## References

- **SSO Service**: https://sso.doneisbetter.com
- **SSO HTTP API**: `https://sso.doneisbetter.com` (OAuth + permissions endpoints)
- **Camera Client ID**: `1e59b6a1-3c18-4141-9139-7a3dd0da62bf`
- **Session Interface**: `lib/auth/session.ts`
- **OAuth Callback**: `app/api/auth/callback/route.ts`
