# ARCHITECTURE.md

**Project**: Camera — Photo Frame Webapp  
**Current Version**: 2.9.0 (canonical: root `package.json` → `"version"`)  
**Last Updated**: 2026-04-09

**Doc sync:** When behavior changes, update this file and **`docs/DOCUMENTATION.md`** / **`docs/SLIDESHOW_LOGIC.md`** in the same change.

This document describes the complete system architecture, technical decisions, and implementation patterns for the Camera photo frame application.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Layers](#architecture-layers)
4. [Database Schema](#database-schema)
5. [API Architecture](#api-architecture)
6. [Authentication & Authorization](#authentication--authorization)
7. [Component Architecture](#component-architecture)
8. [Data Flow](#data-flow)
9. [External Services](#external-services)
10. [Security Considerations](#security-considerations)
11. [Performance Optimizations](#performance-optimizations)
12. [Deployment Architecture](#deployment-architecture)

---

## System Overview

### Purpose
Camera is a professional web application that allows users to capture or upload photos, apply graphical frames, and share the results across social media platforms. It includes event-based slideshow functionality and comprehensive admin management.

### Key Features
- **User Features**: Photo capture/upload, frame selection, social sharing, submission history
- **Admin Features**: Partner management, event management, frame library, submission galleries, slideshow control
- **Event Features**: Public capture pages, real-time slideshows with smart playlist algorithms

### Browser Compatibility
- **Desktop**: Chrome, Firefox, Safari (macOS)
- **Mobile**: Safari (iOS 14+), Chrome (Android)
- **Camera Features**: Fully tested on Safari iOS (primary mobile platform)
- **Known Quirks**: Safari requires extended video initialization sequence (see LEARNINGS.md [FRONT-005])

### Architecture Style
- **Pattern**: Server-side rendered React with API routes (Next.js App Router)
- **Rendering**: Hybrid SSR/CSR - pages are server-rendered, interactions are client-side
- **API**: RESTful endpoints with centralized middleware
- **Database**: Document-based (MongoDB) with connection pooling

---

## Technology Stack

### Core Framework
- **Next.js 16.0.x** (App Router; exact version in `package.json` → `"next"`)
  - Why: SSR, API routes, file-based routing, built-in optimizations
  - Module system: ES Modules (`type: "module"` in package.json)
  - Node.js: 18.x, 20.x, or 22.x

### Language & Type Safety
- **TypeScript 5.9.3** (strict mode)
  - Why: Type safety, better IDE support, catch errors at compile time
  - Configuration: Strict null checks, no implicit any

### UI Framework
- **React 19.2.0** with React DOM 19.2.0
  - Why: Component-based architecture, large ecosystem, team familiarity
  - Patterns: Functional components, hooks, Server Components where applicable

### Styling
- **Tailwind CSS 4.0**
  - Why: Utility-first, no CSS file bloat, dark mode support, design consistency
  - Custom theme: Brand colors (blue-600 primary), consistent spacing scale
  - Dark mode: Full support via `dark:` prefixes

### Database
- **MongoDB 6.8.0** (Atlas hosted)
  - Why: Flexible schema, JSON-like documents, excellent Node.js support
  - Connection: Singleton pattern with connection pooling (10 max, 2 min)
  - Collections: partners, events, frames, submissions, slideshows, slideshow_layouts, users_cache

### Authentication
- **Custom SSO Integration** (e.g. sso.doneisbetter.com; **multi-app permissions from SSO v5.24+**)
  - Protocol: OAuth2/OIDC with PKCE flow
  - Session: 30-day sliding expiration in HTTP-only cookies (`camera_session`); includes **`appRole`** and **`appAccess`** for **this** app (not the global SSO `user.role`)
  - Tokens: Access token + refresh token with rotation

### External Services
- **imgbb.com**: Image CDN (upload via API, 32MB limit per image)
- **Axios 1.7.0**: HTTP client for external API calls

### Development Tools
- **ESLint 9**: Code linting with Next.js config
- **TypeScript Compiler**: Type checking (`tsc --noEmit`)

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                         │
│  Browser (Next.js Pages, React Components, Client JS)      │
└─────────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                      │
│  • Server Components (app/*/page.tsx)                       │
│  • Client Components (components/*/*)                       │
│  • Shared UI Library (components/shared/*)                 │
└─────────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────────┐
│                        API LAYER                            │
│  • Route Handlers (app/api/*/route.ts)                     │
│  • Next.js middleware (root middleware.ts — /admin/* gate) │
│  • API helpers (lib/api/middleware.ts — requireAuth, etc.)   │
│  • Response Helpers (lib/api/responses.ts)                 │
│  • Error Handling (lib/api/withErrorHandler.ts)           │
└─────────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────────┐
│                      BUSINESS LOGIC LAYER                    │
│  • Authentication (lib/auth/*)                              │
│  • Image Processing (Canvas API, imgbb upload)            │
│  • Slideshow Playlist (lib/slideshow/playlist.ts)         │
└─────────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────────┐
│                        DATA LAYER                           │
│  • MongoDB Connection (lib/db/mongodb.ts)                  │
│  • Schema Definitions (lib/db/schemas.ts)                 │
│  • Collections (partners, events, frames, submissions)    │
└─────────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                        │
│  • MongoDB Atlas (database)                                 │
│  • imgbb.com (image CDN)                                   │
│  • SSO Service (authentication)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Collections Overview
All timestamps use ISO 8601 format with milliseconds UTC: `YYYY-MM-DDTHH:MM:SS.sssZ`

### 1. Partners Collection
```typescript
{
  _id: ObjectId,                // MongoDB primary key
  partnerId: string,            // UUID for external references
  name: string,                 // Partner name (e.g., "AC Milan")
  description?: string,         // Optional description
  isActive: boolean,            // Active status
  contactEmail?: string,        // Contact information
  contactName?: string,
  logoUrl?: string,             // imgbb.com URL
  eventCount: number,           // Cached statistics
  frameCount: number,
  createdBy: string,            // Admin user ID from SSO
  createdAt: string,            // ISO 8601 timestamp
  updatedAt: string
}
```

**Indexes**: `partnerId` (unique), `isActive`, `createdAt`

### 2. Events Collection
```typescript
{
  _id: ObjectId,
  eventId: string,              // UUID
  name: string,                 // Event name
  description?: string,
  partnerId: string,            // Reference to partner.partnerId
  partnerName: string,          // Cached for queries
  eventDate?: string,           // ISO 8601
  location?: string,
  isActive: boolean,
  frames: [{                    // Frame assignments
    frameId: string,            // Reference to frame._id (as string)
    isActive: boolean,          // Event-level activation
    addedAt: string,
    addedBy?: string
  }],
  submissionCount: number,      // Cached count
  createdBy: string,
  createdAt: string,
  updatedAt: string
}
```

**Indexes**: `eventId` (unique), `partnerId`, `isActive`, `eventDate`

### 3. Frames Collection
```typescript
{
  _id: ObjectId,
  frameId: string,              // UUID
  name: string,
  description?: string,
  type: 'png' | 'svg' | 'canvas',
  fileUrl: string,              // imgbb.com URL (original)
  thumbnailUrl: string,         // imgbb.com URL (thumbnail)
  width: number,                // Pixels
  height: number,
  hashtags: string[],           // Searchable tags
  ownershipLevel: 'global' | 'partner' | 'event',
  partnerId: string | null,     // null for global frames
  partnerName: string | null,
  eventId: string | null,       // null for global/partner frames
  eventName: string | null,
  partnerActivation: {          // For global frames
    [partnerId: string]: {
      isActive: boolean,
      updatedAt: string,
      updatedBy?: string
    }
  },
  metadata: {
    tags?: string[],
    aspectRatio?: string,
    canvasConfig?: Record<string, unknown>
  },
  status: 'active' | 'inactive' | 'draft',
  isActive: boolean,            // Master switch
  createdBy: string,
  createdAt: string,
  updatedAt: string,
  usageCount?: number,
  lastUsedAt?: string
}
```

**Indexes**: `frameId` (unique), `ownershipLevel`, `partnerId`, `eventId`, `isActive`, `hashtags`

### 4. Submissions Collection
```typescript
{
  _id: ObjectId,
  submissionId: string,         // UUID
  userId: string,               // User ID from SSO or "anonymous"
  userEmail: string,
  frameId: string,              // Reference to frame._id (as string)
  partnerId: string | null,     // Event context
  partnerName: string | null,
  eventIds: string[],           // Array of event IDs (reusability)
  eventName: string | null,
  originalImageUrl: string,     // imgbb.com URL
  finalImageUrl: string,        // imgbb.com URL (with frame)
  method: 'camera_capture' | 'file_upload',
  status: 'processing' | 'completed' | 'failed' | 'deleted',
  metadata: {
    deviceType: 'mobile_ios' | 'mobile_android' | 'desktop' | 'tablet' | 'unknown',
    deviceInfo?: string,
    browserInfo?: string,
    ipAddress?: string,
    country?: string,
    city?: string,
    geolocation?: {
      latitude: number,
      longitude: number,
      accuracy: number
    },
    originalWidth: number,
    originalHeight: number,
    originalFileSize: number,
    originalMimeType: string,
    finalWidth: number,
    finalHeight: number,
    finalFileSize: number,
    processingTimeMs?: number,
    compositionEngine?: string,
    emailSent: boolean,
    emailSentAt?: string,
    emailError?: string
  },
  shareCount: number,
  downloadCount: number,
  lastSharedAt?: string,
  isArchived: boolean,          // Admin archive flag
  archivedAt?: string,
  archivedBy?: string,
  hiddenFromPartner: boolean,
  hiddenFromEvents: string[],
  slideshowPlays?: Record<string, {
    count: number,
    lastPlayedAt: string
  }>,
  playCount?: number,           // Total across all slideshows
  lastPlayedAt?: string,
  createdAt: string,
  updatedAt: string
}
```

**Indexes**: `submissionId` (unique), `userId`, `eventIds`, `partnerId`, `frameId`, `createdAt`, `playCount`

### 5. Slideshows Collection
```typescript
{
  _id: ObjectId,
  slideshowId: string,          // UUID (used in public URLs)
  eventId: string,              // Event UUID (preferred) or legacy Mongo event _id string — resolved in `findEventForSlideshow`
  eventName: string,            // Cached
  name: string,                 // e.g., "Main Screen", "VIP Lounge"
  isActive: boolean,
  transitionDurationMs: number, // ms — default 5000
  fadeDurationMs: number,       // ms — default 1000
  bufferSize: number,           // Default: 10 slides
  refreshStrategy: 'continuous' | 'batch',
  playMode?: 'once' | 'loop',
  orderMode?: 'fixed' | 'random',
  backgroundPrimaryColor?: string,
  backgroundAccentColor?: string,
  backgroundImageUrl?: string | null,
  viewportScale?: 'fit' | 'fill',
  createdBy: string,
  createdAt: string,
  updatedAt: string
}
```

**Indexes**: `slideshowId` (unique), `eventId`, `isActive`

### 6. Slideshow layouts collection (composite videowall)
```typescript
{
  _id: ObjectId,
  layoutId: string,             // UUID — public URL /slideshow-layout/[layoutId]
  eventId: string,              // Event UUID (same as slideshows.eventId)
  eventName: string,
  name: string,
  rows: number,                 // Grid size (1–24)
  cols: number,
  areas: Array<{
    id: string,
    label: string,
    tiles: string[],            // "r-c" tile ids (non-overlapping)
    slideshowId: string | null,
    delayMs: number,            // ms — added to every slide hold in this embedded cell (transition + delay)
    objectFit: 'contain' | 'cover',
    color?: string              // Admin builder preview only
  }>,
  background?: string,          // Optional CSS background-* for outer frame (over safety gradient)
  viewportScale?: 'fit' | 'fill', // Whole grid vs browser viewport
  alignVertical?: 'top' | 'middle' | 'bottom',
  alignHorizontal?: 'left' | 'center' | 'right',
  safetyPrimaryColor?: string,  // #RRGGBB or empty → default indigo
  safetyAccentColor?: string,   // #RRGGBB or empty → default slate
  isActive: boolean,
  createdBy: string,
  createdAt: string,
  updatedAt: string
}
```

**Indexes**: `layoutId` (unique), `eventId` + `createdAt` (see `lib/db/ensure-indexes.ts`)

---

## API Architecture

### Design Principles
1. **RESTful**: Resource-based URLs, standard HTTP methods
2. **Consistent**: All responses use standardized format via `lib/api/responses.ts`
3. **Secure**: Authentication/authorization via middleware
4. **Error-Safe**: Centralized error handling via `withErrorHandler`

### API Structure

**Source of truth:** every `app/api/**/route.ts` file. The tree below is a **summary**; names and methods may grow over time.

```
/api/auth
  GET  /login          Start OAuth2 flow (redirect to IdP)
  GET  /callback       OAuth2 callback
  POST /logout         Clear session
  GET  /session        Current session JSON (used by clients)
  POST /dev-login      Development-only (guarded in code)

/api/partners, /api/events, /api/frames, /api/logos, /api/submissions
  Resource CRUD + event-scoped sub-routes (frames, logos, submissions, reset-style, …)

/api/slideshows
  GET/POST/PATCH/DELETE (collection + ?id= for patch/delete on Mongo _id)
  GET  /[slideshowId]/playlist        Playlist JSON (?limit, ?exclude)
  POST /[slideshowId]/played           Increment play counts
  GET  /[slideshowId]/next-candidate   Single next slide (alternate client)
  POST /[slideshowId]/background-image Failover image upload (admin)

/api/slideshow-layouts
  GET/POST/PATCH/DELETE (admin; ?eventId= / ?id=)
  GET  /[layoutId]     Public layout JSON for /slideshow-layout/[layoutId]

/api/admin/...        Users, merges, submission archive/restore, event gallery upload, migrate helpers
/api/hashtags         GET filter support
```

### Request middleware vs API helpers

**Next.js Edge (`middleware.ts` at repo root):**
- Matcher: `/admin/:path*`
- Requires `camera_session` cookie, valid expiry, **`appRole`** `admin` or `superadmin`, and **`appAccess !== false`**
- Unauthenticated → redirect `/api/auth/login`; forbidden → `/`

**Route-handler helpers (`lib/api/`):**
- `middleware.ts`: `requireAuth`, `requireAdmin`, `optionalAuth`, … — **`requireAdmin`** uses **`session.appRole`** (`admin` \| `superadmin`) and rejects **`session.appAccess === false`** (403)
- `responses.ts`: standardized JSON helpers
- `withErrorHandler.ts`: wraps route handlers
- `index.ts`: re-exports

**Usage Pattern**:
```typescript
// OLD (before v1.7.1) - duplicated everywhere
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // ... logic
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// NEW (v1.7.1+) - clean and consistent
export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await requireAuth();
  // ... logic
  return apiSuccess(data);
});
```

### Response Format
```typescript
// Success
{
  success: true,
  data: { /* response payload */ }
}

// Error
{
  success: false,
  error: "Error message",
  details?: { /* optional debug info */ }
}

// Paginated
{
  success: true,
  data: {
    items: [...],
    pagination: {
      page: 1,
      limit: 20,
      total: 150,
      pages: 8,
      hasNext: true,
      hasPrev: false
    }
  }
}
```

---

## Authentication & Authorization

### OAuth2/OIDC Flow (PKCE)
```
1. User clicks "Login"
2. Generate code_verifier (random 128 chars)
3. Generate code_challenge = base64url(sha256(code_verifier))
4. Store code_verifier in cookie (15 min expiry)
5. Redirect to SSO: /authorize?code_challenge=...
6. User authenticates at SSO
7. SSO redirects back: /api/auth/callback?code=...&state=...
8. Verify state, retrieve code_verifier from cookie
9. Exchange code for tokens: POST /token with code_verifier
10. Receive access_token + refresh_token
11. Fetch user info: GET /userinfo with access_token
12. Create session in HTTP-only cookie (30 days)
13. Redirect to app
```

### Session Management
- **Storage**: HTTP-only cookie (`camera_session`)
- **Duration**: 30 days sliding expiration
- **Contents**: SSO user claims, access/refresh tokens, expiries, plus **`appRole`** (`none` \| `user` \| `admin` \| `superadmin`) and **`appAccess`** for this app (from SSO permission endpoint at login)
- **Security**: Secure flag in production, SameSite=Lax, HttpOnly

### Token Refresh
- Access token expires after 1 hour
- Refresh token valid for 30 days
- Automatic refresh before expiration
- Refresh token rotation (new refresh token with each refresh)

### Authorization Levels
- **Public**: No authentication required (e.g., event capture pages, public slideshow URLs)
- **User**: Authenticated SSO user (`requireAuth`) — not the same as **`appRole: 'user'`** (that is app permission from SSO)
- **Admin UI / admin APIs**: **`session.appRole`** is **`admin`** or **`superadmin`** and **`appAccess !== false`**. Do **not** use global `user.role` from the IdP for app authorization (multi-app SSO).

### API helper quick reference
```typescript
requireAuth()      // Throws 401 if not authenticated
requireAdmin()     // 401 unauthenticated; 403 if not app admin / no app access
optionalAuth()     // Returns session or null, no error
```

---

## Component Architecture

### Shared Component Library (v1.7.1)

**Location**: `components/shared/`

**Components**:
- `Button.tsx`: Standardized buttons (primary, secondary, danger, ghost variants)
- `Card.tsx`: Container component with header/footer support
- `Badge.tsx`: Status indicators (success, danger, warning, info, default)
- `LoadingSpinner.tsx`: Loading states (sm, md, lg sizes)

**Design Principles**:
- Dark mode support via Tailwind `dark:` prefixes
- Accessibility: ARIA labels, keyboard navigation
- Type-safe: Full TypeScript interfaces
- Documented: WHY comments explain design decisions

**Usage**:
```typescript
import { Button, Card, Badge, LoadingSpinner } from '@/components/shared';

<Card header={<h2>Title</h2>} footer={<Button>Action</Button>}>
  <Badge variant="success">Active</Badge>
  <LoadingSpinner size="md" text="Loading..." />
</Card>
```

### Page Components
- Server Components: Default for pages (data fetching server-side)
- Client Components: Interactive elements marked with `'use client'`

---

## Data Flow

### Photo Submission Flow
```
1. User selects frame on /capture/[eventId]
2. Camera capture or file upload (client-side)
3. Canvas API composites photo + frame (client-side)
4. Convert canvas to base64 blob
5. POST /api/submissions with image data
6. Server uploads to imgbb.com
7. Save metadata to MongoDB
8. Return submission with imgbb URLs
9. Display success, offer sharing
```

### Slideshow Playlist Algorithm

**Full detail:** `docs/SLIDESHOW_LOGIC.md` (playlist API, `SlideshowPlayerCore`, layouts).

```
1. Resolve event from slideshow (UUID or legacy Mongo event _id)
2. Query submissions for event (archived/hidden/inactive filters; optional exclude ids on playlist GET)
3. Optional: shuffle submission list when slideshow.orderMode === 'random'
4. Sort by playCount ASC, then createdAt ASC (least-played, oldest first)
5. generatePlaylist: bucket by aspect ratio, then round-robin landscape / portrait mosaic / square mosaic until limit
6. GET /api/slideshows/[id]/playlist returns slides + settings
7. SlideshowPlayerCore: FIFO queue from first fetch; loop mode prefetches GET …/playlist?limit=1; POST /played on visible slide
8. Public UI uses instant cuts (fadeDurationMs stored but not used as cross-fade)
```

---

## External Services

### imgbb.com CDN
- **Purpose**: Image hosting (frames, submissions)
- **API**: REST API with API key authentication
- **Upload**: Base64 encoded images via POST
- **Response**: Multiple URL formats (use `data.url` for original)
- **Storage**: Unlimited free tier, 32MB per image limit
- **URLs**: Permanent, no expiration

### SSO Service (e.g. sso.doneisbetter.com)
- **Notes**: App permission / multi-app roles (**v5.24+**) — see `app/api/auth/callback/route.ts` and `lib/auth/sso-permissions.ts`
- **Protocol**: OAuth2/OIDC with PKCE
- **Endpoints**: /authorize, /token, /userinfo
- **Scopes**: openid, profile, email
- **Session**: Managed externally, tokens provided to app

### Transactional email
- **Current state**: No outbound email is sent from API routes. SSO handles login only; it is not a substitute for an email provider. See `docs/AUTHORIZATION.md` (Transactional email vs SSO).

---

## Security Considerations

### Current Implementation
- ✅ OAuth2 with PKCE (prevents authorization code interception)
- ✅ HTTP-only cookies (prevents XSS token theft)
- ✅ SameSite=Lax (CSRF protection)
- ✅ Secure flag in production (HTTPS only)
- ✅ Input validation via `validateRequiredFields` middleware
- ✅ MongoDB ObjectId validation before queries
- ✅ App-scoped admin checks (`appRole`, `appAccess`) + `/admin` edge middleware
- ✅ Session expiration (30 days sliding)
- ✅ Token refresh rotation
- ✅ API rate limiting on many routes (`checkRateLimit`, `RATE_LIMITS`; optional Upstash Redis)

### Recommended Additions (Phase 7)
- ⏳ Expand rate limiting coverage on any new public write endpoints
- ⏳ Input sanitization (XSS prevention)
- ⏳ CSRF tokens for state-changing operations
- ⏳ Security headers (CSP, X-Frame-Options, etc.)
- ⏳ Request size limits
- ⏳ IP-based rate limiting for login attempts

---

## Performance Optimizations

### Current Optimizations
- ✅ MongoDB connection pooling (10 max, 2 min connections)
- ✅ Singleton pattern for database connection
- ✅ Server-side rendering (faster initial load)
- ✅ Next.js automatic code splitting
- ✅ Image optimization via Next.js Image component
- ✅ Lazy loading components where appropriate

### Recommended Additions (Phase 7)
- ⏳ HTTP caching headers for GET endpoints
- ⏳ Response compression (gzip/brotli)
- ⏳ CDN caching strategy for static assets
- ⏳ Database query optimization (indexes review)
- ⏳ Image lazy loading strategy
- ⏳ Client-side caching (React Query or SWR)

---

## Deployment Architecture

### Hosting Platform
- **Platform**: Vercel
- **Regions**: Automatic edge deployment
- **Build**: Automatic on git push to main
- **Environment**: Node.js 20.x serverless functions

### Environment Variables
```
# Database
MONGODB_URI=mongodb+srv://...
MONGODB_DB=camera

# Authentication
SSO_CLIENT_ID=...
SSO_CLIENT_SECRET=...
SSO_REDIRECT_URI=https://camera.domain.com/api/auth/callback
SSO_AUTHORIZE_URL=https://sso.doneisbetter.com/authorize
SSO_TOKEN_URL=https://sso.doneisbetter.com/token
SSO_USERINFO_URL=https://sso.doneisbetter.com/userinfo

# Image Upload
IMGBB_API_KEY=...

# Public URL (emails / links if you add mail later)
NEXT_PUBLIC_APP_URL=https://your-deployment.example

# Development
NODE_ENV=production
```

### Build Process
```
1. Git push to main
2. Vercel detects change
3. Install dependencies (npm install)
4. TypeScript compilation (type check)
5. Next.js build (npm run build)
6. Deploy to edge network
7. Update environment variables
8. Run health checks
9. Switch traffic to new deployment
```

### Monitoring & Logging
- **Logs**: Vercel function logs
- **Errors**: Console.error statements captured
- **Performance**: Vercel analytics (optional)
- **Uptime**: Vercel status monitoring

---

## MongoDB Reference Conventions

See `docs/MONGODB_CONVENTIONS.md` for complete reference guide.

**Key Rules**:
- URLs: Use `_id` as string (e.g., `/api/events/507f1f77bcf86cd799439011`)
- Database queries: `{ _id: new ObjectId(id) }`
- Foreign keys: Store `_id.toString()` as string
- Display IDs: UUID fields (eventId, partnerId) for external APIs only

---

## Version History

- **Docs sync** (2026-04-09): Aligned architecture/README/slideshow docs with **`SlideshowPlayerCore`** FIFO player, **`middleware.ts`** `/admin` gate, app **`appRole`/`appAccess`**, and expanded slideshow/layout schema fields. See **`docs/DOCUMENTATION.md`**.
- **v2.0.1** (2025-11-08): Safari camera initialization fixes - comprehensive video readiness validation
- **v2.0.0** (2025-11-07): Custom pages system implementation - onboarding/thank you pages
- **v1.7.1** (2025-11-06): Comprehensive refactoring - added middleware, shared components, fixed TypeScript errors
- **v1.5.0** (2025-04-27): Per-slideshow play tracking, mosaic generation fixes
- **v1.0.0** (2025-11-03): Initial project planning and setup

---

**Document maintenance:** Update this file when architecture or public contracts change. Follow **`docs/DOCUMENTATION.md`** so version numbers and player behavior stay aligned with `package.json` and `SlideshowPlayerCore`.
