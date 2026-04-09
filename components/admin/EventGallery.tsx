/**
 * Event Gallery Client Component
 * Version: 1.0.0
 * 
 * Client-side wrapper for event submission gallery with remove functionality.
 * Enables removing submissions from events without full page reload.
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';
import RemoveSubmissionButton from './RemoveSubmissionButton';
import EventGalleryUpload from './EventGalleryUpload';

interface EventGalleryProps {
  eventId: string;
  eventName: string;
  initialSubmissions: any[];
  slideshows: any[];
}

export default function EventGallery({
  eventId,
  eventName,
  initialSubmissions,
  slideshows
}: EventGalleryProps) {
  const [submissions, setSubmissions] = useState(initialSubmissions);

  const handleRemoveSuccess = (submissionId: string) => {
    // Optimistically remove from UI
    setSubmissions(prev => prev.filter(s => s._id.toString() !== submissionId));
  };

  const handleUploaded = (submission: Record<string, unknown>) => {
    setSubmissions((prev) => [submission as any, ...prev].slice(0, 50));
  };

  if (submissions.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <EventGalleryUpload
          eventMongoId={eventId}
          onUploaded={handleUploaded}
        />
        <div className="p-12 text-center border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="text-5xl mb-4">📸</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No submissions yet
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Upload images above or open the public capture page for guests
          </p>
          <Link
            href={`/capture/${eventId}`}
            className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            📸 Start Capturing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <EventGalleryUpload
        eventMongoId={eventId}
        onUploaded={handleUploaded}
      />
      {/* Pinterest-style masonry grid */}
      <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
        {submissions.map((submission: any) => (
          <div
            key={submission._id.toString()}
            className="group relative bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all mb-4 break-inside-avoid"
          >
            <Link href={`/share/${submission._id}`}>
              <img
                src={submission.imageUrl || submission.finalImageUrl}
                alt={`Photo by ${submission.userName || submission.userEmail}`}
                className="w-full h-auto"
              />
            </Link>
            
            {/* Play Count Badge - Always Visible */}
            {(typeof submission.playCount === 'number' && submission.playCount > 0) && (
              <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm px-2 py-1 rounded-full">
                <span className="text-white text-xs font-bold">▶ {submission.playCount}×</span>
              </div>
            )}
            
            {/* Hover Overlay with Details and Actions */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <p className="text-white text-xs font-medium truncate">
                  {submission.userName || submission.userEmail}
                </p>
                <p className="text-white/80 text-xs">
                  {new Date(submission.createdAt).toLocaleDateString()}
                </p>
                
                {/* Slideshow Play Stats */}
                {submission.slideshowPlays && Object.keys(submission.slideshowPlays).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {slideshows.map((slideshow: any) => {
                      const plays = submission.slideshowPlays?.[slideshow.slideshowId];
                      if (!plays || plays.count === 0) return null;
                      return (
                        <p key={slideshow.slideshowId} className="text-white/90 text-xs font-semibold">
                          🎬 {slideshow.name}: {plays.count}× 
                        </p>
                      );
                    })}
                  </div>
                )}
                
                {/* Remove Button */}
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/share/${submission._id}`}
                    className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors text-center"
                  >
                    View
                  </Link>
                  <RemoveSubmissionButton
                    submissionId={submission._id.toString()}
                    level="event"
                    contextId={eventId}
                    contextName={eventName}
                    onSuccess={() => handleRemoveSuccess(submission._id.toString())}
                    className="flex-1 px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors text-center"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {submissions.length >= 50 && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
          Showing the 50 most recent submissions
        </p>
      )}
    </div>
  );
}
