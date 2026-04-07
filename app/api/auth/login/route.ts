/**
 * Login API Route
 * Version: 1.0.0
 * 
 * Initiates OAuth2 authentication flow with SSO.
 * 
 * Flow:
 * 1. Generate PKCE code verifier and challenge
 * 2. Generate state for CSRF protection
 * 3. Store verifier and state in pending session cookie
 * 4. Redirect user to SSO authorization endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { generatePKCEPair, generateState, getAuthorizationUrl } from '@/lib/auth/sso';
import { setPendingSessionCookie } from '@/lib/auth/session';
import { parseLoginProvider } from '@/lib/auth/social-login';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api';

export async function GET(request: NextRequest) {
  try {
    await checkRateLimit(request, RATE_LIMITS.LOGIN_INIT);

    // Generate PKCE pair for security
    const { codeVerifier, codeChallenge } = generatePKCEPair();
    
    // Generate state for CSRF protection
    const state = generateState();

    // Check if user just logged out (from query param or referer)
    const { searchParams } = new URL(request.url);
    const fromLogout = searchParams.get('from_logout') === 'true';
    const provider = parseLoginProvider(searchParams.get('provider'));

    // Build authorization URL with PKCE challenge
    // If user just logged out, force re-authentication with prompt=login
    const authUrl = getAuthorizationUrl(codeChallenge, state, {
      prompt: fromLogout ? 'login' : undefined,
      provider,
    });

    console.log(
      `✓ Initiating OAuth flow${fromLogout ? ' (force re-auth after logout)' : ''}${provider ? ` (provider=${provider})` : ''}, redirecting to SSO`
    );

    // Set pending cookie on the same response as the redirect so Set-Cookie is not dropped
    // (cookies().set + NextResponse.redirect is unreliable in App Router route handlers)
    const response = NextResponse.redirect(authUrl);
    setPendingSessionCookie(response, { codeVerifier, state });
    return response;
    
  } catch (error) {
    if (error instanceof NextResponse) {
      return error;
    }
    console.error('✗ Login initiation failed:', error);

    return NextResponse.json(
      {
        error: 'Failed to initiate login',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
