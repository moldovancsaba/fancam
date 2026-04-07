/**
 * SSO Client for OAuth2/OIDC Authentication
 * Version: 1.0.0
 * 
 * Integrates with sso.doneisbetter.com for user authentication.
 * Implements Authorization Code Flow with PKCE (required for public clients).
 * 
 * SSO Service: https://sso.doneisbetter.com (v5.23.1)
 * 
 * Why PKCE:
 * - Camera is a public client (browser-based SPA)
 * - PKCE provides security without client secret exposure
 * - Required by sso.doneisbetter.com for public clients
 * 
 * Flow:
 * 1. Generate PKCE code verifier and challenge
 * 2. Redirect user to SSO authorization endpoint
 * 3. User authenticates and approves
 * 4. SSO redirects back with authorization code
 * 5. Exchange code for access token + refresh token
 * 6. Store tokens in session
 * 7. Use access token for API calls
 * 8. Refresh token when expired
 */

import crypto from 'crypto';

/**
 * Get SSO configuration with validation
 * Lazy loaded to avoid build-time errors when SSO is not configured
 */
function getSSoConfig() {
  if (!process.env.SSO_BASE_URL) {
    throw new Error('SSO_BASE_URL environment variable is not defined');
  }

  if (!process.env.SSO_CLIENT_ID) {
    throw new Error('SSO_CLIENT_ID environment variable is not defined');
  }

  if (!process.env.SSO_REDIRECT_URI) {
    throw new Error('SSO_REDIRECT_URI environment variable is not defined');
  }

  return {
    baseUrl: process.env.SSO_BASE_URL,
    clientId: process.env.SSO_CLIENT_ID,
    redirectUri: process.env.SSO_REDIRECT_URI,
    scopes: ['openid', 'profile', 'email'],
  } as const;
}

/**
 * Get SSO endpoints
 * Lazy loaded to avoid build-time errors when SSO is not configured
 */
function getSSOEndpoints() {
  const config = getSSoConfig();
  return {
    authorize: `${config.baseUrl}/api/oauth/authorize`,
    token: `${config.baseUrl}/api/oauth/token`,
    userinfo: `${config.baseUrl}/api/oauth/userinfo`,
    revoke: `${config.baseUrl}/api/oauth/revoke`,
    discovery: `${config.baseUrl}/.well-known/openid-configuration`,
  } as const;
}

// Export getters instead of constants
export const SSO_CONFIG = getSSoConfig;
export const SSO_ENDPOINTS = getSSOEndpoints;

/**
 * User information from SSO
 */
export interface SSOUser {
  id: string;
  email: string;
  name?: string;
  email_verified?: boolean;
  role?: string;
}

/**
 * OAuth2 token response from SSO
 * Includes OIDC id_token with user claims
 */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;  // OIDC ID token (JWT with user claims)
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * PKCE code verifier and challenge pair
 */
export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Generate PKCE code verifier (random string)
 * Used to prevent authorization code interception attacks
 * 
 * @returns Random base64url-encoded string (43-128 characters)
 */
export function generateCodeVerifier(): string {
  // Generate 32 random bytes (256 bits)
  const buffer = crypto.randomBytes(32);
  
  // Convert to base64url encoding (URL-safe)
  return base64URLEncode(buffer);
}

/**
 * Generate PKCE code challenge from verifier
 * Uses SHA-256 hash of the verifier
 * 
 * @param verifier - Code verifier string
 * @returns Base64url-encoded SHA-256 hash
 */
export function generateCodeChallenge(verifier: string): string {
  // SHA-256 hash
  const hash = crypto.createHash('sha256').update(verifier).digest();
  
  // Convert to base64url encoding
  return base64URLEncode(hash);
}

/**
 * Generate PKCE pair (verifier and challenge)
 * 
 * @returns Object with codeVerifier and codeChallenge
 */
export function generatePKCEPair(): PKCEPair {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  return {
    codeVerifier,
    codeChallenge,
  };
}

/**
 * Generate authorization URL for SSO login
 * Includes PKCE challenge and state for CSRF protection
 * 
 * @param codeChallenge - PKCE code challenge
 * @param state - Random state string for CSRF protection
 * @param options - Optional parameters
 * @param options.prompt - OIDC prompt parameter ('login', 'consent', 'none')
 * @returns Authorization URL to redirect user to
 */
export function getAuthorizationUrl(
  codeChallenge: string,
  state: string,
  options?: {
    prompt?: 'login' | 'consent' | 'none' | 'select_account';
    /** Routes user straight to Google or Facebook at the SSO layer (sso.doneisbetter.com). */
    provider?: 'google' | 'facebook';
  }
): string {
  const config = SSO_CONFIG();
  const endpoints = SSO_ENDPOINTS();
  
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  // Add prompt parameter if provided (OIDC standard)
  // prompt=login forces re-authentication even if user has SSO session
  if (options?.prompt) {
    params.set('prompt', options.prompt);
  }

  if (options?.provider) {
    params.set('provider', options.provider);
  }

  return `${endpoints.authorize}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 * Uses PKCE code verifier for security
 * 
 * @param code - Authorization code from SSO
 * @param codeVerifier - PKCE code verifier
 * @returns Token response with access_token and refresh_token
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const config = SSO_CONFIG();
  const endpoints = SSO_ENDPOINTS();
  
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });

  const response = await fetch(endpoints.token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Refresh access token using refresh token
 * Called when access token expires
 * 
 * @param refreshToken - Current refresh token
 * @returns New token response
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const config = SSO_CONFIG();
  const endpoints = SSO_ENDPOINTS();
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  const response = await fetch(endpoints.token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Decode ID token (JWT) to extract user information
 * ID tokens are JWTs containing user identity claims per OpenID Connect spec
 * 
 * Why decode instead of calling userinfo endpoint:
 * - SSO v5.23.1 includes all user claims in the id_token (email, name, role)
 * - Avoids extra HTTP round trip
 * - More efficient and reliable
 * 
 * @param idToken - JWT ID token from token response
 * @returns User information extracted from token
 */
export function decodeIdToken(idToken: string): SSOUser {
  if (!idToken) {
    throw new Error('ID token is required');
  }

  try {
    // JWT format: header.payload.signature
    // We only need to decode the payload (base64url encoded)
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // Decode payload (middle part)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    );

    // Extract user claims from payload
    // ID token includes: sub, email, name, role, user_type
    // Note: Facebook federated login may have different claim structure
    const userEmail = payload.email || payload.preferred_username || payload.upn || 'unknown@unknown.com';
    const userName = payload.name || payload.given_name || payload.display_name || undefined;
    
    return {
      id: payload.sub,
      email: userEmail,
      name: userName,
      email_verified: payload.email_verified,
      role: payload.role,
    };
  } catch (error) {
    throw new Error(`Failed to decode ID token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * OIDC UserInfo (`/api/oauth/userinfo`). Use when ID token lacks email (e.g. federated login).
 */
export async function getUserInfo(accessToken: string): Promise<SSOUser> {
  const endpoints = SSO_ENDPOINTS();

  const response = await fetch(endpoints.userinfo, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get user info: ${response.status} ${error}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const email =
    (typeof payload.email === 'string' && payload.email) ||
    (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
    '';

  return {
    id: sub,
    email,
    name:
      (typeof payload.name === 'string' && payload.name) ||
      (typeof payload.given_name === 'string' && payload.given_name) ||
      undefined,
    email_verified:
      typeof payload.email_verified === 'boolean'
        ? payload.email_verified
        : undefined,
    role: typeof payload.role === 'string' ? payload.role : undefined,
  };
}

/**
 * Revoke access token or refresh token
 * Called during logout
 * 
 * @param token - Token to revoke
 * @param tokenTypeHint - Type of token ('access_token' or 'refresh_token')
 */
export async function revokeToken(
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token' = 'access_token'
): Promise<void> {
  const config = SSO_CONFIG();
  const endpoints = SSO_ENDPOINTS();
  
  const params = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
    client_id: config.clientId,
  });

  const response = await fetch(endpoints.revoke, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    console.error('Token revocation failed:', response.status);
    // Don't throw - revocation failure shouldn't block logout
  }
}

/**
 * Generate random state string for CSRF protection
 * Used in OAuth flow to prevent cross-site request forgery
 * 
 * @returns Random base64url-encoded string
 */
export function generateState(): string {
  const buffer = crypto.randomBytes(32);
  return base64URLEncode(buffer);
}

/**
 * Helper: Convert buffer to base64url encoding
 * Base64url is URL-safe (no +, /, = characters)
 * 
 * @param buffer - Buffer to encode
 * @returns Base64url-encoded string
 */
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
