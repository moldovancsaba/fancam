/**
 * Database Schemas and TypeScript Types
 * Version: 2.0.0
 * 
 * Defines the structure of all MongoDB collections and their TypeScript interfaces.
 * All dates stored as ISO 8601 strings with milliseconds in UTC: YYYY-MM-DDTHH:MM:SS.sssZ
 * 
 * Collections:
 * - partners: Organizations/brands that host events
 * - events: Events within partners that use frames and custom page flows
 * - frames: Pre-designed frame templates with three-tier ownership (global/partner/event)
 * - submissions: User photo submissions with comprehensive metadata and onboarding data
 * - users_cache: Optional cache of SSO user data for performance
 * 
 * Frame Visibility Hierarchy:
 * - Global frames: Available to all partners/events, can be deactivated per partner/event
 * - Partner frames: Available only to specific partner's events, can be deactivated per event
 * - Event frames: Available only to specific event
 * 
 * Custom Page Flows (v2.0.0):
 * - Events can have custom onboarding and thank you pages
 * - Pages are drag-and-drop reorderable including [Take Photo] step
 * - Page types: 'who-are-you' (data collection), 'accept' (consent), 'cta' (call to action), 'take-photo' (capture)
 * - Collected data (name, email, consents) stored with each submission
 */

import { ObjectId } from 'mongodb';

/**
 * Collection Names
 * Centralized constant to ensure consistency across the application
 */
export const COLLECTIONS = {
  PARTNERS: 'partners',
  EVENTS: 'events',
  FRAMES: 'frames',
  LOGOS: 'logos',
  SUBMISSIONS: 'submissions',
  USERS_CACHE: 'users_cache',
  SLIDESHOWS: 'slideshows',
  SLIDESHOW_LAYOUTS: 'slideshow_layouts',
} as const;

// ============================================================================
// PARTNERS COLLECTION
// ============================================================================

/**
 * Partner Document Interface
 * Represents an organization or brand that hosts events
 * 
 * Why partners:
 * - Organizations need to manage their own events and frames
 * - Enables white-label frame collections per partner
 * - Future: partner data will sync via external API
 * 
 * Example: AC Milan, Red Bull, Nike
 */
export interface Partner {
  _id?: ObjectId;                    // MongoDB document ID
  partnerId: string;                 // Unique partner identifier (UUID)
  name: string;                      // Partner name (e.g., "AC Milan")
  description?: string;              // Optional partner description
  isActive: boolean;                 // Whether partner is currently active
  
  // Contact and metadata
  contactEmail?: string;             // Partner contact email
  contactName?: string;              // Partner contact person
  logoUrl?: string;                  // Partner logo URL (imgbb.com)
  
  // Default styles for child events (v2.8.0)
  // These defaults cascade to all non-orphaned events under this partner
  // Events can override these to become "orphans" (independent of partner changes)
  defaultBrandColors?: {
    primary?: string;                // Default primary brand color (hex)
    secondary?: string;              // Default secondary brand color (hex)
    accent?: string;                 // Default accent brand color (hex)
  };
  defaultFrames?: string[];          // Default frame IDs to assign to new events
  defaultLogos?: Array<{             // Default logo assignments for new events
    logoId: string;                  // Reference to logo
    scenario: LogoScenario;          // Where/when to display this logo
    order: number;                   // Order for random selection
  }>;
  
  // Statistics
  eventCount?: number;               // Cached count of partner's events
  frameCount?: number;               // Cached count of partner-specific frames
  
  // Admin tracking
  createdBy: string;                 // Admin user ID from SSO who created this partner
  createdAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  updatedAt: string;                 // ISO 8601 timestamp with milliseconds UTC
}

// ============================================================================
// EVENTS COLLECTION
// ============================================================================

/**
 * Custom Page Type
 * Defines the type of page in the event flow
 * 
 * Why four types:
 * - who-are-you: Collect user information (name, email) before photo capture
 * - accept: GDPR/terms consent with required checkbox
 * - cta: Call-to-action that can redirect to URL, optional button (if no button = end page)
 * - take-photo: Represents the existing camera capture flow (special type for ordering)
 */
export enum CustomPageType {
  WHO_ARE_YOU = 'who-are-you',  // Data collection page
  ACCEPT = 'accept',            // Consent/terms page
  CTA = 'cta',                  // Call to action page
  TAKE_PHOTO = 'take-photo',    // Photo capture step (for ordering only)
}

/**
 * Custom Page Configuration
 * Defines a single page in the event flow
 * 
 * Why order field:
 * - Enables drag-and-drop reordering without array manipulation
 * - Survives page additions/deletions
 * - Clear sorting: customPages.sort((a, b) => a.order - b.order)
 * 
 * Why isActive field:
 * - Allows temporarily disabling pages without deleting configuration
 * - Useful for A/B testing or seasonal campaigns
 */
export interface CustomPage {
  pageId: string;              // Unique page identifier (UUID)
  pageType: CustomPageType;    // Type of page
  order: number;               // Display order (0-based, lower = earlier in flow)
  isActive: boolean;           // Whether page is currently enabled
  config: {
    title: string;             // Page heading displayed to user
    description: string;       // Explanatory text shown above form/content
    buttonText: string;        // Next/Continue button label
    // For 'who-are-you' type only (v2.9.0: SSO integration)
    enableSSOLogin?: boolean;     // Show Google + Facebook login via SSO (default: false)
    enablePseudoReg?: boolean;    // Show name/email form for guest registration (default: true)
    ssoButtonText?: string;       // Heading above Google/Facebook buttons on who-are-you page
    pseudoFormTitle?: string;     // Optional title above name/email form (e.g., "Or continue as guest")
    nameLabel?: string;        // Label for name input (e.g., "Your Name")
    emailLabel?: string;       // Label for email input (e.g., "Your Email")
    namePlaceholder?: string;  // Placeholder for name input (e.g., "Enter your name")
    emailPlaceholder?: string; // Placeholder for email input (e.g., "your.email@example.com")
    // For 'accept' type only
    checkboxText?: string;     // Text displayed next to checkbox (e.g., "I agree to...")
    // For 'cta' type only
    // checkboxText is repurposed as URL to visit
    hasButton?: boolean;       // If false, CTA is end page (no continue button, auto-continues after URL visit)
    visitButtonText?: string;  // Label for visit URL button (e.g., "Visit Now")
    redirectingText?: string;  // Text shown while redirecting (e.g., "Redirecting you shortly...")
    // For 'take-photo' type only
    captureButtonText?: string;  // Label for main capture/save button (e.g., "LOVE IT")
    retryButtonText?: string;    // Label for retry button (e.g., "TRY AGAIN")
    shareNextButtonText?: string; // Label for next button on share screen (e.g., "NEXT")
    changeButtonText?: string;   // Label for change frame button (e.g., "Change")
    successMessage?: string;     // Message shown after successful save (e.g., "Photo saved successfully! You can now share it.")
    showSharePage?: boolean;     // If false, skip share page and show thank you message instead
    skipShareMessage?: string;   // Message shown when share page is skipped (e.g., "Thank you! Your photo has been saved.")
    showFrameOnCapture?: boolean; // If true, show frame overlay during live capture; if false, frame only applied after capture (default: true)
    // Camera prompt customization
    cameraPromptTitle?: string;  // Title shown on camera start screen (e.g., "Ready to capture?")
    cameraPromptDescription?: string; // Description on camera start screen (e.g., "Click to start your camera and take a photo")
    // Error and notification messages
    errorFrameMessage?: string;  // Error when frame fails to apply (e.g., "Failed to apply frame. Please try again.")
    errorSaveMessage?: string;   // Error when save fails (e.g., "Failed to save photo: Please try again.")
    linkCopiedMessage?: string;  // Success when link copied (e.g., "Link copied to clipboard!")
    copyErrorMessage?: string;   // Error when copy fails (e.g., "Failed to copy link. Please copy it manually.")
    saveFirstMessage?: string;   // Warning when trying to share before saving (e.g., "Please save the photo first to get a shareable link.")
  };
  createdAt: string;           // ISO 8601 timestamp when page was added
  updatedAt: string;           // ISO 8601 timestamp of last modification
}

/**
 * Event Document Interface
 * Represents a specific event within a partner that uses frames
 * 
 * Why events:
 * - Events need their own frame collections
 * - Enables per-event customization and activation control
 * - Supports event-specific QR codes and sharing
 * - v2.0.0: Supports custom page flows for onboarding and thank you pages
 * 
 * Example: "Serie A - AC Milan x AS Roma", "Red Bull Racing - Monaco GP 2025"
 */
export interface Event {
  _id?: ObjectId;                    // MongoDB document ID
  eventId: string;                   // Unique event identifier (UUID)
  name: string;                      // Event name (e.g., "Serie A - AC Milan x AS Roma")
  description?: string;              // Optional event description
  
  // Partner relationship
  partnerId: string;                 // Reference to parent partner
  partnerName: string;               // Cached partner name for display and filtering
  
  // Event details
  eventDate?: string;                // Optional event date (ISO 8601 timestamp)
  location?: string;                 // Optional event location
  isActive: boolean;                 // Whether event is currently active
  
  // Frame assignments
  // This array tracks which frames are assigned to this event and their activation status
  // Global and partner frames can be overridden here at event level
  frames: Array<{
    frameId: string;                 // Reference to frame
    isActive: boolean;               // Frame active status at event level (overrides global/partner)
    addedAt: string;                 // ISO 8601 timestamp when frame was added to event
    addedBy?: string;                // Admin user ID who added this frame
  }>;
  
  // Logo assignments (v2.1.0)
  // Multiple logos can be assigned per scenario
  // If multiple logos for same scenario: random selection on each display
  // If no logos for scenario: no logo shown
  logos: Array<{
    logoId: string;                  // Reference to logo
    scenario: LogoScenario;          // Where/when to display this logo
    order: number;                   // Order for random selection (lower = higher priority)
    isActive: boolean;               // Whether this logo assignment is active
    addedAt: string;                 // ISO 8601 timestamp when logo was added
    addedBy?: string;                // Admin user ID who added this logo
  }>;
  
  // Custom page flow (v2.0.0)
  // Defines onboarding and thank you pages shown before/after photo capture
  // Pages with order < [Take Photo] order = onboarding pages
  // Pages with order > [Take Photo] order = thank you pages
  // Empty array = default behavior (go straight to photo capture)
  customPages: CustomPage[];         // Array of custom pages (ordered by order field)
  
  // Customization
  loadingText?: string;              // Text shown while event is loading (e.g., "Loading event...")
  logoUrl?: string;                  // Optional event logo URL (imgbb.com) - displayed on capture pages
  showLogo: boolean;                 // Whether to display logo on event pages (default: false)
  
  // Brand colors (v2.1.0)
  // Used throughout the event experience for consistent branding
  brandColor?: string;               // Primary brand color (hex, e.g., "#3B82F6") - used for buttons, focus states
  brandBorderColor?: string;         // Border/accent color (hex, e.g., "#3B82F6") - used for borders, outlines
  
  // Style inheritance from partner (v2.8.0)
  // Override flags track whether this event uses partner defaults (child) or custom values (orphan)
  // false/undefined = child (inherits from partner, updates when partner changes)
  // true = orphan (custom values, independent of partner changes)
  brandColorsOverridden?: boolean;   // Whether event has custom brand colors
  framesOverridden?: boolean;        // Whether event has custom frame assignments
  logosOverridden?: boolean;         // Whether event has custom logo assignments
  
  // Statistics
  submissionCount?: number;          // Cached count of submissions for this event
  
  // Admin tracking
  createdBy: string;                 // Admin user ID from SSO who created this event
  createdAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  updatedAt: string;                 // ISO 8601 timestamp with milliseconds UTC
}

// ============================================================================
// LOGOS COLLECTION
// ============================================================================

/**
 * Logo Scenario Type
 * Defines where/when a logo should be displayed
 * 
 * Why four scenarios:
 * - slideshow-transition: Logo shown during slide transitions with fade in/out
 * - onboarding-thankyou: Logo displayed on custom pages (top center above title)
 * - loading-slideshow: Logo shown while slideshow is loading
 * - loading-capture: Logo shown while capture app is loading
 */
export enum LogoScenario {
  SLIDESHOW_TRANSITION = 'slideshow-transition',
  ONBOARDING_THANKYOU = 'onboarding-thankyou',
  LOADING_SLIDESHOW = 'loading-slideshow',
  LOADING_CAPTURE = 'loading-capture',
}

/**
 * Logo Document Interface
 * Represents an uploaded logo that can be assigned to events
 * 
 * Why separate from frames:
 * - Logos have different display rules (scenarios vs overlay)
 * - Logos support multiple per scenario with random selection
 * - Logos have different dimensions and aspect ratios
 * - Simpler management and assignment logic
 */
export interface Logo {
  _id?: ObjectId;                    // MongoDB document ID
  logoId: string;                    // Unique logo identifier (UUID)
  name: string;                      // Human-readable logo name
  description?: string;              // Optional logo description
  imageUrl: string;                  // imgbb.com URL for logo image
  thumbnailUrl: string;              // imgbb.com URL for thumbnail
  width: number;                     // Logo width in pixels
  height: number;                    // Logo height in pixels
  fileSize: number;                  // File size in bytes
  mimeType: string;                  // MIME type (e.g., "image/png")
  
  // Status
  isActive: boolean;                 // Whether logo is available for assignment
  
  // Admin tracking
  createdBy: string;                 // Admin user ID from SSO
  createdAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  updatedAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  
  // Usage statistics
  usageCount?: number;               // Number of events using this logo
  lastUsedAt?: string;               // ISO 8601 timestamp of last use
}

// ============================================================================
// FRAMES COLLECTION
// ============================================================================

/**
 * Frame Ownership Level
 * Determines the scope and visibility of a frame
 * 
 * Why three levels:
 * - Global: Platform-wide frames available to everyone
 * - Partner: Branded frames specific to an organization
 * - Event: Custom frames for a specific event
 * 
 * Visibility cascade:
 * 1. Global frames visible to all, can be deactivated per partner/event
 * 2. Partner frames visible only to that partner's events, can be deactivated per event
 * 3. Event frames visible only to that specific event
 */
export enum FrameOwnershipLevel {
  GLOBAL = 'global',       // Available to all partners and events
  PARTNER = 'partner',     // Available only to specific partner's events
  EVENT = 'event',         // Available only to specific event
}

/**
 * Frame Type
 * Defines the format/technology used for the frame
 */
export enum FrameType {
  PNG = 'png',           // PNG image overlay
  SVG = 'svg',           // SVG vector graphic
  CANVAS = 'canvas',     // HTML Canvas-based frame
}

/**
 * Frame Status
 * Controls whether frame is available for user selection
 */
export enum FrameStatus {
  ACTIVE = 'active',     // Available for selection
  INACTIVE = 'inactive', // Hidden from users
  DRAFT = 'draft',       // Work in progress
}

/**
 * Frame Document Interface
 * Represents a graphical frame template in the database
 * 
 * Frame Visibility Rules:
 * 1. Global frames (ownershipLevel: 'global'):
 *    - No partnerId/eventId
 *    - Visible to all by default
 *    - Can be deactivated per partner via partnerActivation map
 *    - Can be deactivated per event via event.frames[].isActive
 * 
 * 2. Partner frames (ownershipLevel: 'partner'):
 *    - Has partnerId, no eventId
 *    - Visible only to that partner's events
 *    - Can be deactivated per event via event.frames[].isActive
 * 
 * 3. Event frames (ownershipLevel: 'event'):
 *    - Has both partnerId and eventId
 *    - Visible only to that specific event
 *    - Controlled by frame.isActive
 */
export interface Frame {
  _id?: ObjectId;                    // MongoDB document ID
  frameId: string;                   // Unique frame identifier (UUID)
  name: string;                      // Human-readable frame name
  description?: string;              // Optional frame description
  type: FrameType;                   // Frame format (png, svg, canvas)
  fileUrl: string;                   // imgbb.com URL for frame asset
  thumbnailUrl: string;              // imgbb.com URL for frame thumbnail
  width: number;                     // Frame width in pixels
  height: number;                    // Frame height in pixels
  
  // Hashtags replace the old single category field
  // Multiple hashtags enable better filtering and searchability
  hashtags: string[];                // Searchable hashtags (e.g., ['sports', 'football', 'milan'])
  
  // Ownership and hierarchy
  ownershipLevel: FrameOwnershipLevel; // Global, partner-specific, or event-specific
  partnerId: string | null;          // Partner ID if ownershipLevel is 'partner' or 'event', null for global
  partnerName: string | null;        // Cached partner name for display (null for global frames)
  eventId: string | null;            // Event ID if ownershipLevel is 'event', null otherwise
  eventName: string | null;          // Cached event name for display (null for global/partner frames)
  
  // Partner-level activation overrides for global frames
  // Only applicable when ownershipLevel is 'global'
  // Maps partnerId to activation status
  // If partner is not in map, frame is active for that partner by default
  // If partner is in map with isActive: false, frame is hidden from that partner
  partnerActivation: {
    [partnerId: string]: {
      isActive: boolean;             // Whether frame is active for this partner
      updatedAt: string;             // ISO 8601 timestamp of last activation change
      updatedBy?: string;            // Admin user ID who changed activation
    };
  };
  
  // Metadata
  metadata: {
    tags?: string[];                 // Additional tags for internal organization (deprecated, use hashtags)
    aspectRatio?: string;            // e.g., "16:9", "4:3", "1:1"
    canvasConfig?: Record<string, unknown>; // Canvas-specific configuration if type is 'canvas'
  };
  
  status: FrameStatus;               // Frame availability status (active/inactive/draft)
  isActive: boolean;                 // Global active status (master switch)
  
  // Admin tracking
  createdBy: string;                 // Admin user ID from SSO
  createdAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  updatedAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  
  // Usage statistics
  usageCount?: number;               // Number of times frame has been used
  lastUsedAt?: string;               // ISO 8601 timestamp of last use
}

// ============================================================================
// SUBMISSIONS COLLECTION
// ============================================================================

/**
 * Device Type
 * Identifies the device used for photo capture/upload
 */
export enum DeviceType {
  MOBILE_IOS = 'mobile_ios',
  MOBILE_ANDROID = 'mobile_android',
  DESKTOP = 'desktop',
  TABLET = 'tablet',
  UNKNOWN = 'unknown',
}

/**
 * Submission Method
 * How the photo was provided by the user
 */
export enum SubmissionMethod {
  CAMERA_CAPTURE = 'camera_capture',  // Live camera capture
  FILE_UPLOAD = 'file_upload',        // File uploaded from device
}

/**
 * Submission Status
 * Lifecycle status of the submission
 */
export enum SubmissionStatus {
  PROCESSING = 'processing',    // Image composition in progress
  COMPLETED = 'completed',      // Successfully processed
  FAILED = 'failed',            // Processing failed
  DELETED = 'deleted',          // Soft deleted by user
}

/**
 * User Consent Record
 * Tracks acceptance of terms, GDPR consents, or marketing opt-ins
 * 
 * Why stored per submission:
 * - Legal requirement to track exactly what user agreed to and when
 * - Supports audit trails for GDPR compliance
 * - Links consent to specific submission context
 */
export interface UserConsent {
  pageId: string;              // Reference to customPage that generated this consent
  pageType: 'accept' | 'cta';  // Type of page (for categorization)
  checkboxText: string;        // Exact text user agreed to (immutable record)
  accepted: boolean;           // Always true (required to proceed)
  acceptedAt: string;          // ISO 8601 timestamp when user checked the box
}

/**
 * Submission Document Interface
 * Represents a user photo submission with complete metadata
 * 
 * v2.0.0 additions:
 * - userInfo: Name and email collected from 'who-are-you' pages
 * - consents: Array of acceptances from 'accept' and 'cta' pages
 * 
 * Why store in submission:
 * - All capture session data kept together for easy retrieval
 * - Single query gets complete context
 * - Supports GDPR data export requirements
 * - Maintains audit trail of what user agreed to per submission
 */
export interface Submission {
  _id?: ObjectId;                    // MongoDB document ID
  submissionId: string;              // Unique submission identifier (UUID)
  userId: string;                    // User ID from SSO
  userEmail: string;                 // User email from SSO
  frameId: string;                   // Reference to frame used
  
  // Partner/Event context for gallery organization
  partnerId: string | null;          // Partner ID if submission is from event capture, null for general
  partnerName: string | null;        // Cached partner name for display
  eventIds: string[];                // Array of event IDs where this submission appears (supports reusability)
  eventName: string | null;          // Cached event name for display (primary event)
  
  // Image URLs (all hosted on imgbb.com)
  originalImageUrl: string;          // User's original photo
  finalImageUrl: string;             // Composed photo with frame
  
  // Submission details
  method: SubmissionMethod;          // Camera capture or file upload
  status: SubmissionStatus;          // Processing status
  
  // User information collected from onboarding pages (v2.0.0)
  // Only present if event has 'who-are-you' pages
  // Stored here for GDPR compliance and easy data export
  userInfo?: {
    name?: string;                   // User's name from onboarding form
    email?: string;                  // User's email from onboarding form
    collectedAt: string;             // ISO 8601 timestamp when data was collected
  };
  
  // Consent records from accept/CTA pages (v2.0.0)
  // Empty array if no consent pages in event flow
  // Each consent is immutable record of what user agreed to
  consents: UserConsent[];           // Array of user consent acceptances
  
  // Comprehensive metadata for tracking and analytics
  metadata: {
    // Device information
    deviceType: DeviceType;
    deviceInfo?: string;             // User agent string
    browserInfo?: string;            // Browser name and version
    
    // Location data (if available and user consented)
    ipAddress?: string;              // User's IP address
    country?: string;                // Derived from IP
    city?: string;                   // Derived from IP
    geolocation?: {                  // GPS coordinates if available
      latitude: number;
      longitude: number;
      accuracy: number;
    };
    
    // Image technical details
    originalWidth: number;           // Original photo width
    originalHeight: number;          // Original photo height
    originalFileSize: number;        // Original file size in bytes
    originalMimeType: string;        // e.g., "image/jpeg"
    finalWidth: number;              // Final composed image width
    finalHeight: number;             // Final composed image height
    finalFileSize: number;           // Final file size in bytes
    
    // Processing details
    processingTimeMs?: number;       // Time taken to process (milliseconds)
    compositionEngine?: string;      // "canvas-api" or other
    
    // Email delivery
    emailSent: boolean;              // Whether email was sent
    emailSentAt?: string;            // ISO 8601 timestamp
    emailError?: string;             // Error message if email failed
  };
  
  // Sharing and engagement
  shareCount: number;                // Number of times shared
  downloadCount: number;             // Number of times downloaded
  lastSharedAt?: string;             // ISO 8601 timestamp
  
  // Archive and visibility control (replaces soft delete)
  isArchived: boolean;               // Admin-level archive flag (hidden from all views except archived page)
  archivedAt?: string;               // ISO 8601 timestamp when archived
  archivedBy?: string;               // Admin user ID who archived this submission
  
  hiddenFromPartner: boolean;        // Hidden from partner-level views (but not deleted)
  hiddenFromEvents: string[];        // Array of event IDs where this submission is hidden
  
  // Slideshow tracking for playlist generation
  // Tracks how many times this submission has been displayed in each slideshow
  // Key = slideshowId, Value = { count, lastPlayedAt }
  slideshowPlays?: Record<string, {
    count: number;                   // Number of times shown in this specific slideshow
    lastPlayedAt: string;            // ISO 8601 timestamp of last play in this slideshow
  }>;
  
  // Global aggregates (computed from slideshowPlays for backward compatibility)
  playCount?: number;                // Total plays across all slideshows (default: 0)
  lastPlayedAt?: string;             // ISO 8601 timestamp of most recent play
  
  // Timestamps
  createdAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  updatedAt: string;                 // ISO 8601 timestamp with milliseconds UTC
}

// ============================================================================
// SLIDESHOWS COLLECTION
// ============================================================================

/**
 * Slideshow Document Interface
 * Represents a 16:9 slideshow configuration for an event
 * 
 * Why slideshows:
 * - Event organizers need to display submissions on screens during events
 * - Smart playlist algorithm ensures all submissions get displayed fairly
 * - Supports multiple slideshow instances per event for different screens
 * 
 * Playlist Logic:
 * - Always selects the 5 least-played submissions (by playCount, then createdAt)
 * - Groups submissions by aspect ratio: 16:9 (full screen), 1:1 (2x1 mosaic), 9:16 (3x1 mosaic)
 * - Skips 1:1 and 9:16 images if not enough to create complete mosaics
 * - Updates playCount and lastPlayedAt after each display
 * 
 * Display Format:
 * - 16:9 canvas at 1920x1080px
 * - 16:9 images: Full screen display
 * - 1:1 images: 2 images side-by-side (800x800px each) with equal padding
 * - 9:16 images: 3 images side-by-side (540x960px each) with equal padding
 */
export interface Slideshow {
  _id?: ObjectId;                    // MongoDB document ID
  slideshowId: string;               // Unique slideshow identifier (UUID)
  eventId: string;                   // Reference to parent event
  eventName: string;                 // Cached event name for display
  name: string;                      // User-defined slideshow name (e.g., "Main Screen", "VIP Lounge")
  
  // Slideshow settings
  isActive: boolean;                 // Whether slideshow is currently active
  transitionDurationMs: number;      // Duration each slide is displayed (milliseconds, default: 5000)
  fadeDurationMs: number;            // Duration of fade transition (milliseconds, default: 1000)
  
  // Rolling buffer settings for infinite smooth playback
  bufferSize: number;                // Number of slides to maintain in buffer (default: 10)
  refreshStrategy: 'continuous' | 'batch'; // How to refresh playlist (default: 'continuous')
  
  // Admin tracking
  createdBy: string;                 // Admin user ID from SSO who created this slideshow
  createdAt: string;                 // ISO 8601 timestamp with milliseconds UTC
  updatedAt: string;                 // ISO 8601 timestamp with milliseconds UTC
}

// ============================================================================
// SLIDESHOW LAYOUTS COLLECTION
// ============================================================================

/**
 * One region on a grid (CardMass-style tile union). Each area plays one slideshow.
 */
export interface SlideshowLayoutArea {
  id: string;
  label: string;
  /** Tile ids "r-c" covering this region; must not overlap other areas */
  tiles: string[];
  /** Preview color in admin builder (optional) */
  color?: string;
  slideshowId: string | null;
  /** Phase offset so duplicate slideshowIds in one layout show different slides */
  delayMs: number;
  /** FIT = contain, FILL = cover; aspect ratio always preserved */
  objectFit: 'contain' | 'cover';
}

/**
 * Composite videowall: multiple cells, each hosting an existing slideshow config.
 */
export interface SlideshowLayout {
  _id?: ObjectId;
  layoutId: string;
  eventId: string;
  eventName: string;
  name: string;
  rows: number;
  cols: number;
  areas: SlideshowLayoutArea[];
  /** Optional outer frame CSS (background-* only), same idea as CardMass boards */
  background?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type NewSlideshowLayout = Omit<SlideshowLayout, '_id'>;

// ============================================================================
// USERS CACHE COLLECTION (Optional)
// ============================================================================

/**
 * User Cache Document Interface
 * Optional cache of SSO user data to reduce API calls to SSO service
 * 
 * Why cache:
 * - Reduces load on SSO service
 * - Improves response time for user profile pages
 * - Provides data availability if SSO service is temporarily unavailable
 * 
 * Cache strategy:
 * - TTL: 24 hours (refresh daily)
 * - Update on user login
 * - Fallback to SSO API if cache miss
 */
export interface UserCache {
  _id?: ObjectId;                    // MongoDB document ID
  userId: string;                    // User ID from SSO (unique index)
  email: string;                     // User email
  name?: string;                     // User display name
  role?: string;                     // User role (e.g., "admin", "user")
  
  // SSO session info
  lastLoginAt?: string;              // ISO 8601 timestamp
  
  // Cache metadata
  cachedAt: string;                  // ISO 8601 timestamp when cached
  lastSyncAt: string;                // ISO 8601 timestamp of last SSO sync
  syncCount: number;                 // Number of times synced
}

// ============================================================================
// HELPER TYPES AND UTILITIES
// ============================================================================

/**
 * Omit MongoDB _id for insert operations
 */
export type NewPartner = Omit<Partner, '_id'>;
export type NewEvent = Omit<Event, '_id'>;
export type NewFrame = Omit<Frame, '_id'>;
export type NewSubmission = Omit<Submission, '_id'>;
export type NewUserCache = Omit<UserCache, '_id'>;
export type NewSlideshow = Omit<Slideshow, '_id'>;

/**
 * Generate ISO 8601 timestamp with milliseconds in UTC
 * Format: YYYY-MM-DDTHH:MM:SS.sssZ
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a simple unique ID (UUID v4 alternative)
 * Uses crypto.randomUUID() if available, falls back to timestamp-based ID
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random string
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
