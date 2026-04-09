/**
 * Development Mock Login
 * Version: 1.0.1
 * 
 * Temporary bypass for SSO authentication during development.
 * This creates a mock session without requiring SSO.
 * 
 * WARNING: This should be removed or disabled in production.
 */

import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { createSession } from '@/lib/auth/session';
import type { TokenResponse } from '@/lib/auth/sso';
import { blockDangerousApiInProduction } from '@/lib/api/production-guard';

export async function GET(request: NextRequest) {
  const blocked = blockDangerousApiInProduction();
  if (blocked) {
    return blocked;
  }

  // Create a mock user session for development
  const mockUser = {
    id: 'dev-user-001',
    email: 'dev@camera.local',
    name: 'Development User',
    role: 'admin' as const,
  };

  // Create mock tokens for development
  // Generate a fake ID token (JWT) with user claims
  const mockIdTokenPayload = {
    sub: mockUser.id,
    email: mockUser.email,
    name: mockUser.name,
    role: mockUser.role,
    email_verified: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const mockIdToken = `mock.${Buffer.from(JSON.stringify(mockIdTokenPayload)).toString('base64url')}.mock`;

  const mockTokens: TokenResponse = {
    access_token: 'dev-access-token',
    refresh_token: 'dev-refresh-token',
    id_token: mockIdToken,
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'openid profile email',
  };

  const origin = request.nextUrl.origin;
  const response = NextResponse.redirect(new URL('/', origin));
  await createSession(mockUser, mockTokens, undefined, response);
  return response;
}
