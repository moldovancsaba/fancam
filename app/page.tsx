/**
 * Camera Webapp - Homepage
 * Version: 1.0.0
 * 
 * Main landing page for photo capture with frames.
 * Shows login status and provides authentication controls.
 */

import { getSession } from '@/lib/auth/session';
import { APP_VERSION } from '@/lib/app-version';
import SocialLoginButtons from '@/components/auth/SocialLoginButtons';

// This page uses cookies, so it must be dynamic
export const dynamic = 'force-dynamic';

function oauthErrorHint(code: string | undefined): string | null {
  if (!code) return null;
  if (code === 'session_expired') {
    return 'Use a single browser tab for sign-in, or try again from the capture page.';
  }
  if (code === 'invalid_state') {
    return 'If you had multiple login tabs open, close the extras and start sign-in once.';
  }
  return null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string; error?: string; message?: string }>;
}) {
  // Get current session to show user info
  const session = await getSession();
  
  // Await searchParams (Next.js 15 requires this)
  const params = await searchParams;
  
  // Check if user just logged out
  const justLoggedOut = params.logout === 'success';

  const oauthError = params.error;
  let oauthMessage: string | null = null;
  if (params.message) {
    try {
      oauthMessage = decodeURIComponent(params.message);
    } catch {
      oauthMessage = params.message;
    }
  }
  const oauthHint = oauthErrorHint(oauthError);
  
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <main className="flex flex-col items-center justify-center px-8 py-16 text-center">
        {oauthError && !session && (
          <div
            className="mb-6 max-w-lg rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
            role="alert"
          >
            <p className="font-semibold">Sign-in did not complete</p>
            {oauthMessage && <p className="mt-2">{oauthMessage}</p>}
            {!oauthMessage && (
              <p className="mt-2 capitalize">{oauthError.replace(/_/g, ' ')}</p>
            )}
            {oauthHint && <p className="mt-2 text-red-800 dark:text-red-200">{oauthHint}</p>}
          </div>
        )}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <img 
              src="https://i.ibb.co/zTG7ztxC/camera-logo.png" 
              alt="Camera Logo" 
              className="h-16 w-auto"
            />
            <h1 className="text-6xl font-bold text-gray-900 dark:text-white">
              Camera
            </h1>
          </div>
          
          {session && (
            <div className="mt-4 inline-block bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100 px-4 py-2 rounded-lg">
              <p className="text-sm">
                ✓ Logged in as <span className="font-semibold">{session.user.email}</span>
              </p>
            </div>
          )}
        </div>


        <div className="flex flex-col sm:flex-row gap-4">
          {session ? (
            // Logged in - show admin and logout buttons only
            <>
              {/* Check appRole from SSO app permissions (not user.role from ID token) */}
              {(session.appRole === 'admin' || session.appRole === 'superadmin') && (
                <a
                  href="/admin"
                  className="px-8 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors shadow-lg"
                >
                  Admin Panel
                </a>
              )}
              
              <a
                href="/api/auth/logout"
                className="px-8 py-3 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-colors shadow-lg"
              >
                Logout
              </a>
            </>
          ) : (
            <SocialLoginButtons fromLogout={justLoggedOut} variant="home" />
          )}
        </div>

        <div className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>🔐 Google / Facebook via SSO | ☁️ MongoDB Atlas | 🖼️ imgbb</p>
          <p className="mt-2 text-xs font-mono text-gray-400 dark:text-gray-500">
            v{APP_VERSION}
          </p>
        </div>
      </main>
    </div>
  );
}
