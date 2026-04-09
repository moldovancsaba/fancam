/**
 * Event Detail Page
 * Version: 2.8.0
 * 
 * Display event details with partner info, assigned frames, and slideshows
 * v2.0.0: Filters inactive users (pseudo + cameraAccountDisabled mirror)
 * v2.8.0: Style inheritance system with parent-child relationship to partners
 */

import { connectToDatabase } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/schemas';
import { ObjectId } from 'mongodb';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SlideshowManager from '@/components/admin/SlideshowManager';
import SlideshowLayoutManager from '@/components/admin/SlideshowLayoutManager';
import EventGallery from '@/components/admin/EventGallery';
import { getInactiveUserEmails } from '@/lib/db/sso';
import StyleInheritanceIndicator from '@/components/admin/StyleInheritanceIndicator';
import DeleteEventButton from '@/components/admin/DeleteEventButton';

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  
  // Validate ObjectId format
  if (!ObjectId.isValid(id)) {
    notFound();
  }

  let event: any = null;
  let partner: any = null;
  let submissions: any[] = [];
  let slideshows: any[] = [];
  let slideshowLayouts: any[] = [];
  let dbError = null;

  try {
    const db = await connectToDatabase();
    
    // Get event details
    event = await db
      .collection(COLLECTIONS.EVENTS)
      .findOne({ _id: new ObjectId(id) });

    if (!event) {
      notFound();
    }

    // Get partner details
    partner = await db
      .collection(COLLECTIONS.PARTNERS)
      .findOne({ partnerId: event.partnerId });

    // Get inactive user emails from SSO database
    // These users' submissions will be filtered out
    const inactiveEmails = await getInactiveUserEmails();
    console.log(`[Event Gallery] Filtering out ${inactiveEmails.size} inactive users`);

    // Get submissions for this event (limit to most recent 50)
    // BACKWARD COMPATIBILITY: Support both eventId (singular, old data) and eventIds (array, new data)
    // Also exclude submissions that are hidden from this specific event
    submissions = await db
      .collection(COLLECTIONS.SUBMISSIONS)
      .find({
        $and: [
          {
            $or: [
              { eventId: event.eventId },               // Old schema: singular eventId field
              { eventIds: { $in: [event.eventId] } }    // New schema: eventIds array
            ]
          },
          { isArchived: { $ne: true } },                // Exclude archived submissions
          {
            $or: [
              { hiddenFromEvents: { $exists: false } },  // Field doesn't exist yet (old data)
              { hiddenFromEvents: { $nin: [event.eventId] } } // Field exists and event not in it
            ]
          },
          // Exclude submissions from inactive SSO users (real users)
          // Also exclude pseudo users who have been marked inactive
          {
            $and: [
              // Filter out inactive real users (SSO authenticated)
              {
                $or: [
                  // Real users: check userEmail against inactive list
                  { userEmail: { $nin: Array.from(inactiveEmails) } },
                  // Pseudo users: userId='anonymous' is always kept (not real SSO user)
                  { userId: 'anonymous' }
                ]
              },
              // Filter out inactive pseudo users (userInfo.isActive = false)
              {
                $or: [
                  { 'userInfo.isActive': { $ne: false } },  // Not inactive pseudo
                  { userInfo: { $exists: false } }          // Not a pseudo user
                ]
              }
            ]
          }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Get slideshows for this event (UUID on new docs; legacy may use Mongo event id)
    slideshows = await db
      .collection(COLLECTIONS.SLIDESHOWS)
      .find({
        $or: [{ eventId: event.eventId }, { eventId: id }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    slideshowLayouts = await db
      .collection(COLLECTIONS.SLIDESHOW_LAYOUTS)
      .find({ eventId: event.eventId })
      .sort({ createdAt: -1 })
      .toArray();

    // Populate frame details for assigned frames
    // This enriches event.frames[] with full frame data (name, thumbnailUrl, etc.)
    if (event.frames && event.frames.length > 0) {
      const frameIds = event.frames.map((f: any) => f.frameId);
      const frames = await db
        .collection(COLLECTIONS.FRAMES)
        .find({ frameId: { $in: frameIds } })
        .toArray();
      
      // Map frame details to each assignment
      event.frames = event.frames.map((assignment: any) => {
        const frameDetails = frames.find((f: any) => f.frameId === assignment.frameId);
        return {
          ...assignment,
          frameDetails: frameDetails ? {
            frameId: frameDetails.frameId,
            name: frameDetails.name,
            thumbnailUrl: frameDetails.thumbnailUrl,
            width: frameDetails.width,
            height: frameDetails.height,
            hashtags: frameDetails.hashtags,
          } : null
        };
      });
    }

  } catch (error) {
    console.error('Error fetching event details:', error);
    dbError = error instanceof Error ? error.message : 'Unknown error';
  }

  if (!event) {
    notFound();
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
          <Link href="/admin/events" className="hover:text-gray-700 dark:hover:text-gray-200">
            Events
          </Link>
          <span>→</span>
          <span>{event.name}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{event.name}</h1>
            {event.description && (
              <p className="text-gray-600 dark:text-gray-400 mt-2">{event.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/admin/events/${id}/edit`}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Edit Event
            </Link>
            <DeleteEventButton eventId={id} eventName={event.name} />
            <span className={`inline-flex px-3 py-2 text-sm font-semibold rounded-lg ${
              event.isActive
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
            }`}>
              {event.isActive ? '● Active' : '○ Inactive'}
            </span>
          </div>
        </div>
      </div>

      {dbError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200 font-medium">Error loading data</p>
          <p className="text-red-600 dark:text-red-300 text-sm mt-1">{dbError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Event Information */}
        <div className="space-y-6">
          {/* Partner Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Partner</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{event.partnerName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {partner ? (
                    <Link
                      href={`/admin/partners/${partner._id}`}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 hover:underline"
                    >
                      View Partner →
                    </Link>
                  ) : (
                    'Partner details unavailable'
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Event Info Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Event Information</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Event ID</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white font-mono">{event.eventId}</dd>
              </div>
              {event.eventDate && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Event Date</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {new Date(event.eventDate).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </dd>
                </div>
              )}
              {event.location && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Location</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">{event.location}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {new Date(event.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Updated</dt>
                <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                  {new Date(event.updatedAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>

          {/* Capture URL Card */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg shadow-sm border border-blue-200 dark:border-blue-800 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">📸 Event Capture URL</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Share this URL to let users take photos for this event
            </p>
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 p-3 mb-3">
              <code className="text-xs text-gray-900 dark:text-white break-all">
                {typeof window !== 'undefined' ? window.location.origin : ''}/capture/{id}
              </code>
            </div>
            <Link
              href={`/capture/${id}`}
              className="block w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors text-center"
            >
              Open Capture Page →
            </Link>
          </div>

          {/* Statistics Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Statistics</h2>
            <dl className="space-y-3">
              <div className="flex items-center justify-between">
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Frames</dt>
                <dd className="text-2xl font-bold text-gray-900 dark:text-white">{event.frames?.length || 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Photos</dt>
                <dd className="text-2xl font-bold text-gray-900 dark:text-white">{submissions.length}</dd>
              </div>
            </dl>
            <Link
              href={`/admin/events/${id}#gallery`}
              className="mt-4 block w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors text-center"
            >
              View Gallery →
            </Link>
          </div>
        </div>

        {/* Right Column - Brand Colors, Frames, and Logos */}
        <div className="space-y-6">
          {/* Brand Colors Section - Moved from bottom */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Brand Colors</h2>
                    <StyleInheritanceIndicator
                      styleField="brandColors"
                      isOverridden={event.brandColorsOverridden === true}
                      eventId={id}
                      partnerName={event.partnerName}
                    />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Used throughout the event experience: buttons, inputs, checkboxes, and camera interface
                  </p>
                </div>
                <Link
                  href={`/admin/events/${id}/edit`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Edit Colors
                </Link>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Primary Color */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Primary Color
                  </label>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-16 h-16 rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm"
                      style={{ backgroundColor: event.brandColor || '#3B82F6' }}
                    ></div>
                    <div>
                      <p className="text-sm font-mono text-gray-900 dark:text-white font-semibold">
                        {event.brandColor || '#3B82F6'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Buttons, camera button fill, focus states
                      </p>
                    </div>
                  </div>
                </div>

                {/* Border Color */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Border/Accent Color
                  </label>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-16 h-16 rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm"
                      style={{ backgroundColor: event.brandBorderColor || '#3B82F6' }}
                    ></div>
                    <div>
                      <p className="text-sm font-mono text-gray-900 dark:text-white font-semibold">
                        {event.brandBorderColor || '#3B82F6'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Input borders, checkboxes, camera button border
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Color Preview</p>
                <div className="flex gap-3">
                  <button
                    style={{ backgroundColor: event.brandColor || '#3B82F6' }}
                    className="px-6 py-3 text-white rounded-lg font-semibold shadow-sm"
                    disabled
                  >
                    Primary Button
                  </button>
                  <button
                    style={{ borderColor: event.brandBorderColor || '#3B82F6', color: event.brandBorderColor || '#3B82F6' }}
                    className="px-6 py-3 bg-white dark:bg-gray-800 rounded-lg font-semibold shadow-sm border-2"
                    disabled
                  >
                    Bordered Button
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Assigned Frames Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Assigned Frames</h2>
                  <StyleInheritanceIndicator
                    styleField="frames"
                    isOverridden={event.framesOverridden === true}
                    eventId={id}
                    partnerName={event.partnerName}
                  />
                </div>
                <Link
                  href={`/admin/events/${id}/frames`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Manage Frames
                </Link>
              </div>
            </div>

            {(!event.frames || event.frames.length === 0) ? (
              <div className="p-12 text-center">
                <div className="text-5xl mb-4">🖼️</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No frames assigned yet</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Assign frames to this event to make them available for users
                </p>
                <Link
                  href={`/admin/events/${id}/frames`}
                  className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Assign Frames
                </Link>
              </div>
            ) : (
              <div className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {event.frames.map((frameAssignment: any, index: number) => {
                    // Find frame details from frames collection
                    // Note: This requires frames to be populated on the event object
                    const frameDetails = frameAssignment.frameDetails || frameAssignment;
                    const thumbnailUrl = frameDetails.thumbnailUrl;
                    const frameName = frameDetails.name || 'Unnamed Frame';
                    
                    return (
                      <div
                        key={index}
                        className="relative bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
                      >
                        <div className="text-center">
                          {thumbnailUrl ? (
                            <div className="mb-2 flex items-center justify-center">
                              <img 
                                src={thumbnailUrl} 
                                alt={frameName}
                                className="max-w-full h-auto max-h-32 object-contain"
                              />
                            </div>
                          ) : (
                            <div className="text-3xl mb-2">🖼️</div>
                          )}
                          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1 truncate">
                            {frameName}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mb-2">
                            {frameAssignment.frameId}
                          </p>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            frameAssignment.isActive
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {frameAssignment.isActive ? '● Active' : '○ Inactive'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 text-center">
                  <Link
                    href={`/admin/events/${id}/frames`}
                    className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
                  >
                    Manage frame assignments →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Event Logos Section - Moved to right column */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Event Logos</h2>
                  <StyleInheritanceIndicator
                    styleField="logos"
                    isOverridden={event.logosOverridden === true}
                    eventId={id}
                    partnerName={event.partnerName}
                  />
                </div>
                <Link
                  href={`/admin/events/${id}/logos`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Manage Logos
                </Link>
              </div>
            </div>

            {(!event.logos || event.logos.length === 0) ? (
              <div className="p-12 text-center">
                <div className="text-5xl mb-4">🎨</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No logos assigned yet</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Assign logos to display on different screens (transitions, loading, custom pages)
                </p>
                <Link
                  href={`/admin/events/${id}/logos`}
                  className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Assign Logos
                </Link>
              </div>
            ) : (
              <div className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries([
                    { id: 'slideshow-transition', name: 'Slideshow Transitions', icon: '🔄' },
                    { id: 'onboarding-thankyou', name: 'Custom Pages', icon: '📝' },
                    { id: 'loading-slideshow', name: 'Loading Slideshow', icon: '⏳' },
                    { id: 'loading-capture', name: 'Loading Capture', icon: '📸' },
                  ]).map(([key, scenario]: [string, any]) => {
                    const count = (event.logos || []).filter((l: any) => l.scenario === scenario.id && l.isActive).length;
                    return (
                      <div
                        key={scenario.id}
                        className="relative bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
                      >
                        <div className="text-center">
                          <div className="text-3xl mb-2">{scenario.icon}</div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                            {scenario.name}
                          </p>
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            {count} active
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 text-center">
                  <Link
                    href={`/admin/events/${id}/logos`}
                    className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
                  >
                    Manage logo assignments →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slideshows Section */}
      <div id="slideshows" className="mt-8">
        <SlideshowManager
          eventId={id}
          initialSlideshows={JSON.parse(JSON.stringify(slideshows))}
        />
      </div>

      {/* Slideshow layouts (multi-cell videowall) */}
      <div id="slideshow-layouts" className="mt-8">
        <SlideshowLayoutManager
          eventMongoId={id}
          initialLayouts={slideshowLayouts.map((l) => ({
            _id: l._id!.toString(),
            layoutId: l.layoutId,
            name: l.name,
            isActive: l.isActive !== false,
            createdAt: l.createdAt,
          }))}
        />
      </div>

      {/* Event Gallery Section */}
      <div id="gallery" className="mt-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              📷 Event Gallery
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Photos visible in Event Slideshows ({submissions.length})
            </p>
          </div>

          <EventGallery
            eventId={id}
            eventName={event.name}
            initialSubmissions={JSON.parse(JSON.stringify(submissions))}
            slideshows={JSON.parse(JSON.stringify(slideshows))}
          />
        </div>
      </div>
    </div>
  );
}
