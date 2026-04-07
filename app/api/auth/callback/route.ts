/**
 * OAuth Callback API Route
 * Version: 1.0.0
 * 
 * Handles OAuth2 callback from SSO after user authentication.
 * 
 * Flow:
 * 1. Verify state parameter (CSRF protection)
 * 2. Exchange authorization code for tokens
 * 3. Fetch user information
 * 4. Create session with tokens
 * 5. Redirect to homepage or profile
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForToken,
  decodeIdToken,
  getUserInfo,
} from '@/lib/auth/sso';
import { consumePendingSession, createSession } from '@/lib/auth/session';
import { getAppPermission, hasAppAccess } from '@/lib/auth/sso-permissions';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Check for OAuth errors from SSO
    if (error) {
      console.error('✗ OAuth error from SSO:', error);
      const errorDescription = searchParams.get('error_description');
      
      return NextResponse.redirect(
        new URL(`/?error=${error}&message=${encodeURIComponent(errorDescription || 'Authentication failed')}`, request.url)
      );
    }

    // Validate required parameters
    if (!code || !state) {
      console.error('✗ Missing code or state parameter');
      return NextResponse.redirect(
        new URL('/?error=invalid_request&message=Missing required parameters', request.url)
      );
    }

    // Get and verify pending session (CSRF protection)
    const pendingSession = await consumePendingSession();
    
    if (!pendingSession) {
      console.error('✗ No pending session found or expired');
      return NextResponse.redirect(
        new URL('/?error=session_expired&message=Login session expired, please try again', request.url)
      );
    }

    // Verify state matches (CSRF protection)
    if (pendingSession.state !== state) {
      console.error('✗ State mismatch (e.g. second login tab overwrote cookie, or stale redirect)', {
        cookieStateLen: pendingSession.state.length,
        queryStateLen: state.length,
      });
      return NextResponse.redirect(
        new URL('/?error=invalid_state&message=Invalid state parameter', request.url)
      );
    }

    console.log('✓ State verified, exchanging code for tokens');

    // Exchange authorization code for tokens using PKCE verifier
    const tokens = await exchangeCodeForToken(code, pendingSession.codeVerifier);
    
    console.log('✓ Tokens obtained, extracting user info from ID token');

    // Extract user information from ID token (JWT)
    // SSO v5.24.0 includes all user claims in the id_token
    let user = decodeIdToken(tokens.id_token);

    console.log('✓ User info extracted:', user.email);

    // If ID token email is missing or the SSO placeholder, enrich from OIDC UserInfo (HTTP only).
    const badEmail =
      !user.email ||
      user.email === 'sso@doneisbetter.com' ||
      user.email === 'unknown@unknown.com';
    if (badEmail) {
      try {
        const info = await getUserInfo(tokens.access_token);
        const email = info.email;
        if (email && email !== 'sso@doneisbetter.com') {
          user = {
            ...user,
            id: info.id || user.id,
            email,
            name: info.name ?? user.name,
            role: info.role ?? user.role,
          };
          console.log('✓ User profile enriched from SSO userinfo');
        }
      } catch (error) {
        console.warn('⚠ SSO userinfo enrichment failed (continuing with ID token claims):', error);
      }
    }

    // WHAT: Query SSO for user's app-specific permission
    // WHY: SSO is the source of truth for app-level roles (user/admin)
    // HOW: Use access token to authenticate with SSO permission endpoint
    let appRole: 'none' | 'user' | 'admin' | 'superadmin' = 'none';
    let appAccess = false;
    
    try {
      const permission = await getAppPermission(user.id, tokens.access_token);
      appRole = permission.role;
      appAccess = hasAppAccess(permission);
      
      console.log('✓ App permission retrieved:', {
        role: appRole,
        hasAccess: appAccess,
        status: permission.status
      });
    } catch (error) {
      console.error('✗ Failed to get app permission:', error);
      // Continue with default (no access) - user will see access denied page
    }

    // Check for capture flow resume (v2.9.0: SSO in capture flow)
    const captureEventId = request.cookies.get('captureEventId')?.value;
    const capturePageIndex = request.cookies.get('capturePageIndex')?.value;
    
    if (captureEventId) {
      console.log('✓ Resuming capture flow:', captureEventId, 'page:', capturePageIndex);
      
      // Redirect back to capture page with resume signal
      const resumeUrl = new URL(`/capture/${captureEventId}`, request.url);
      resumeUrl.searchParams.set('resume', 'true');
      if (capturePageIndex) {
        resumeUrl.searchParams.set('page', capturePageIndex);
      }
      
      const response = NextResponse.redirect(resumeUrl);
      response.cookies.delete('captureEventId');
      response.cookies.delete('capturePageIndex');

      await createSession(user, tokens, { appRole, appAccess }, response);
      console.log('✓ Session created');
      return response;
    }

    console.log('✓ Redirecting to homepage');

    const homeResponse = NextResponse.redirect(new URL('/', request.url));
    await createSession(user, tokens, { appRole, appAccess }, homeResponse);
    console.log('✓ Session created');
    return homeResponse;
    
  } catch (error) {
    console.error('✗ OAuth callback failed:', error);
    
    return NextResponse.redirect(
      new URL(
        `/?error=auth_failed&message=${encodeURIComponent(
          error instanceof Error ? error.message : 'Authentication failed'
        )}`,
        request.url
      )
    );
  }
}
