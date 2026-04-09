'use client';

/**
 * Shared slideshow playback (rolling A/B/C buffers). Used by full-page player and layout cells.
 */

import { useEffect, useState, useRef, useCallback } from 'react';

interface Submission {
  _id: string;
  imageUrl: string;
  width: number;
  height: number;
}

interface Slide {
  type: 'single' | 'mosaic';
  aspectRatio: '16:9' | '1:1' | '9:16';
  submissions: Submission[];
}

interface SlideshowSettings {
  _id: string;
  name: string;
  eventName: string;
  transitionDurationMs: number;
  fadeDurationMs: number;
  bufferSize: number;
  refreshStrategy: 'continuous' | 'batch';
}

export interface SlideshowPlayerCoreProps {
  slideshowId: string;
  /** FIT = contain (letterbox), FILL = cover (crop); aspect always preserved */
  objectFit?: 'contain' | 'cover';
  /** Extra ms before the first transition from slide 0 → 1 (stagger duplicate slideshows) */
  delayMs?: number;
  variant?: 'fullscreen' | 'embedded';
  className?: string;
}

export function SlideshowPlayerCore({
  slideshowId,
  objectFit = 'contain',
  delayMs = 0,
  variant = 'fullscreen',
  className = '',
}: SlideshowPlayerCoreProps) {
  const [settings, setSettings] = useState<SlideshowSettings | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [playlistA, setPlaylistA] = useState<Slide[]>([]);
  const [playlistB, setPlaylistB] = useState<Slide[]>([]);
  const [playlistC, setPlaylistC] = useState<Slide[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<'A' | 'B' | 'C'>('A');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getCurrentPlaylist = () => {
    switch (activePlaylist) {
      case 'A':
        return playlistA;
      case 'B':
        return playlistB;
      case 'C':
        return playlistC;
    }
  };

  const buffer = getCurrentPlaylist();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const preloadedImages = useRef<Map<string, HTMLImageElement>>(new Map());
  const isFetchingCandidate = useRef(false);
  const pendingInitialDelayRef = useRef(delayMs > 0);

  useEffect(() => {
    pendingInitialDelayRef.current = delayMs > 0;
  }, [slideshowId, delayMs]);

  const preloadImage = useCallback((url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (preloadedImages.current.has(url)) {
        resolve();
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        preloadedImages.current.set(url, img);
        resolve();
      };
      img.onerror = () => {
        console.warn(`Failed to preload image: ${url}`);
        reject();
      };
      img.src = url;
    });
  }, []);

  const preloadSlide = useCallback(
    async (slide: Slide): Promise<void> => {
      await Promise.allSettled(
        slide.submissions.map(async (sub) => {
          try {
            await preloadImage(sub.imageUrl);
          } catch {
            console.warn(`[Preload] Failed to preload ${sub._id}`);
          }
        })
      );
    },
    [preloadImage]
  );

  const fetchAndBuildPlaylistWithExclusions = useCallback(
    async (targetPlaylist: 'A' | 'B' | 'C', excludeIds: string[] = []): Promise<Slide[]> => {
      if (isFetchingCandidate.current) return [];

      isFetchingCandidate.current = true;

      try {
        const url =
          excludeIds.length > 0
            ? `/api/slideshows/${slideshowId}/playlist?exclude=${excludeIds.join(',')}`
            : `/api/slideshows/${slideshowId}/playlist`;

        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`Failed to fetch playlist ${targetPlaylist}:`, response.status);
          return [];
        }

        const data = await response.json();
        if (!data.playlist || data.playlist.length === 0) {
          return [];
        }

        await Promise.all(data.playlist.map(preloadSlide));

        switch (targetPlaylist) {
          case 'A':
            setPlaylistA(data.playlist);
            break;
          case 'B':
            setPlaylistB(data.playlist);
            break;
          case 'C':
            setPlaylistC(data.playlist);
            break;
        }

        return data.playlist;
      } catch (err) {
        console.error(`Error building playlist ${targetPlaylist}:`, err);
        return [];
      } finally {
        isFetchingCandidate.current = false;
      }
    },
    [slideshowId, preloadSlide]
  );

  const loadInitialBuffer = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/slideshows/${slideshowId}/playlist`);
      if (!response.ok) {
        throw new Error(`Failed to load slideshow: ${response.status}`);
      }

      const data = await response.json();

      if (!data.slideshow || !data.playlist) {
        throw new Error('Invalid slideshow data');
      }

      setSettings(data.slideshow);

      if (data.slideshow.eventId) {
        try {
          const logoResponse = await fetch(`/api/events/${data.slideshow.eventId}/logos`);
          if (logoResponse.ok) {
            const logoData = await logoResponse.json();
            const loadingLogos =
              logoData.data?.logos?.['loading-slideshow'] ||
              logoData.logos?.['loading-slideshow'] ||
              [];
            const activeLogo = loadingLogos.find((l: { isActive?: boolean }) => l.isActive);
            if (activeLogo?.imageUrl) {
              setLogoUrl(activeLogo.imageUrl);
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (data.playlist.length > 0) {
        await Promise.all(data.playlist.map(preloadSlide));
        setPlaylistA(data.playlist);

        const idsInA: string[] = [];
        data.playlist.forEach((slide: Slide) => {
          slide.submissions.forEach((sub) => idsInA.push(sub._id));
        });

        const playlistBData = await fetchAndBuildPlaylistWithExclusions('B', idsInA);

        const idsInB: string[] = [];
        playlistBData.forEach((slide: Slide) => {
          slide.submissions.forEach((sub) => idsInB.push(sub._id));
        });
        const excludeForC = [...idsInA, ...idsInB];

        await fetchAndBuildPlaylistWithExclusions('C', excludeForC);
        setActivePlaylist('A');
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load initial buffer:', err);
      setError(err instanceof Error ? err.message : 'Failed to load slideshow');
      setIsLoading(false);
    }
  }, [slideshowId, preloadSlide, fetchAndBuildPlaylistWithExclusions]);

  useEffect(() => {
    loadInitialBuffer();
  }, [loadInitialBuffer]);

  const updatePlayCounts = useCallback(
    async (slide: Slide) => {
      try {
        const submissionIds = slide.submissions.map((s) => s._id);
        const response = await fetch(`/api/slideshows/${slideshowId}/played`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionIds }),
        });
        if (!response.ok) {
          console.warn(`[PlayCount] API returned ${response.status}`);
        }
      } catch (err) {
        console.error('[PlayCount] ERROR:', err);
      }
    },
    [slideshowId]
  );

  useEffect(() => {
    if (!settings || !isPlaying || buffer.length === 0) return;

    const currentSlide = buffer[currentIndex];

    if (currentSlide) {
      updatePlayCounts(currentSlide);
    }

    const delayExtra =
      pendingInitialDelayRef.current && currentIndex === 0 ? delayMs : 0;

    const advanceTimer = setTimeout(() => {
      if (pendingInitialDelayRef.current && currentIndex === 0) {
        pendingInitialDelayRef.current = false;
      }

      const nextIndex = currentIndex + 1;

      if (nextIndex >= buffer.length) {
        let nextPlaylist: 'A' | 'B' | 'C';
        let playlistToRebuild: 'A' | 'B' | 'C';

        switch (activePlaylist) {
          case 'A':
            nextPlaylist = 'B';
            playlistToRebuild = 'A';
            break;
          case 'B':
            nextPlaylist = 'C';
            playlistToRebuild = 'B';
            break;
          case 'C':
            nextPlaylist = 'A';
            playlistToRebuild = 'C';
            break;
        }

        setActivePlaylist(nextPlaylist);
        setCurrentIndex(0);

        if (settings.refreshStrategy === 'continuous') {
          const excludeIds: string[] = [];
          const remainingPlaylists = ['A', 'B', 'C'].filter(
            (p) => p !== playlistToRebuild
          ) as ('A' | 'B' | 'C')[];
          remainingPlaylists.forEach((p) => {
            const playlist = p === 'A' ? playlistA : p === 'B' ? playlistB : playlistC;
            playlist.forEach((slide) => {
              slide.submissions.forEach((sub) => excludeIds.push(sub._id));
            });
          });
          fetchAndBuildPlaylistWithExclusions(playlistToRebuild, excludeIds);
        }
      } else {
        setCurrentIndex(nextIndex);
      }
    }, settings.transitionDurationMs + delayExtra);

    return () => {
      clearTimeout(advanceTimer);
    };
  }, [
    settings,
    currentIndex,
    isPlaying,
    buffer,
    activePlaylist,
    playlistA,
    playlistB,
    playlistC,
    slideshowId,
    delayMs,
    updatePlayCounts,
    fetchAndBuildPlaylistWithExclusions,
  ]);

  const toggleFullscreen = () => {
    if (variant !== 'fullscreen' || !containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleMouseMove = () => {
    if (variant !== 'fullscreen' || !isFullscreen) return;
    setShowControls(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  useEffect(() => {
    if (variant !== 'fullscreen') return;
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'ArrowRight' && buffer.length > 0) {
        setCurrentIndex((prev) => (prev + 1) % buffer.length);
      } else if (e.key === 'ArrowLeft' && buffer.length > 0) {
        setCurrentIndex((prev) => (prev - 1 + buffer.length) % buffer.length);
      }
    };
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [variant, buffer.length]);

  const outerStateClass =
    variant === 'fullscreen' ? 'w-screen h-screen' : 'w-full h-full min-h-0 min-w-0';

  if (isLoading) {
    return (
      <div
        className={`${outerStateClass} flex flex-col items-center justify-center bg-black ${className}`}
      >
        {logoUrl && (
          <img
            src={logoUrl}
            alt="Event logo"
            className="max-w-md max-h-64 mb-8 object-contain"
          />
        )}
        <div className="text-white text-sm md:text-2xl">Loading slideshow...</div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div
        className={`${outerStateClass} flex items-center justify-center bg-black p-2 ${className}`}
      >
        <div className="text-red-500 text-center text-sm md:text-xl">
          {error || 'Slideshow not found'}
        </div>
      </div>
    );
  }

  if (buffer.length === 0) {
    return (
      <div
        className={`${outerStateClass} flex items-center justify-center bg-black ${className}`}
      >
        <div className="text-white text-center px-2">
          <div className="text-2xl md:text-4xl mb-2 md:mb-4">📸</div>
          <div className="text-lg md:text-2xl">{settings.name}</div>
          <div className="text-gray-400 mt-1 md:mt-2 text-xs md:text-base">No submissions yet</div>
        </div>
      </div>
    );
  }

  const currentSlide = buffer[currentIndex];
  const currentSlideKey = currentSlide
    ? currentSlide.submissions.map((s) => s._id).join('-')
    : 'loading';

  const fit = objectFit;

  const renderSlide = (slide: Slide) => {
    if (slide.type === 'single') {
      return (
        <img
          src={slide.submissions[0].imageUrl}
          alt="Slideshow"
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            padding: 0,
            margin: 0,
          }}
        />
      );
    }
    if (slide.aspectRatio === '1:1') {
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {[
            ['0%', '0%', '33.333%', '50%', 'flex-start', 'flex-start'],
            ['33.333%', '0%', '33.333%', '50%', 'flex-start', 'center'],
            ['66.666%', '0%', '33.333%', '50%', 'flex-start', 'flex-end'],
            ['0%', '50%', '33.333%', '50%', 'flex-end', 'flex-start'],
            ['33.333%', '50%', '33.333%', '50%', 'flex-end', 'center'],
            ['66.666%', '50%', '33.333%', '50%', 'flex-end', 'flex-end'],
          ].map(([left, top, w, h, ai, jc], i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left,
                top,
                width: w,
                height: h,
                display: 'flex',
                alignItems: ai as 'flex-start' | 'flex-end',
                justifyContent: jc as 'flex-start' | 'flex-end' | 'center',
                overflow: 'hidden',
              }}
            >
              <img
                src={slide.submissions[i].imageUrl}
                alt=""
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: fit }}
              />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {[
          ['0%', 'flex-start'],
          ['33.333%', 'center'],
          ['66.666%', 'flex-end'],
        ].map(([left, jc], i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left,
              top: '0%',
              width: '33.333%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: jc as 'flex-start' | 'flex-end' | 'center',
              overflow: 'hidden',
            }}
          >
            <img
              src={slide.submissions[i].imageUrl}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: fit }}
            />
          </div>
        ))}
      </div>
    );
  };

  const canvasInner = (
    <div
      className={
        variant === 'fullscreen'
          ? 'relative bg-black'
          : 'relative bg-black w-full max-h-full max-w-full aspect-video'
      }
      style={
        variant === 'fullscreen'
          ? {
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '100vw',
              height: '56.25vw',
              maxWidth: '177.78vh',
              maxHeight: '100vh',
              backgroundColor: 'black',
            }
          : { backgroundColor: 'black' }
      }
    >
      <div
        key={currentSlideKey}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {renderSlide(currentSlide)}
      </div>

      {variant === 'fullscreen' && (!isFullscreen || showControls) && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 transition-opacity">
          <div className="max-w-7xl mx-auto">
            <div className="mb-4">
              <h1 className="text-white text-2xl font-bold">{settings.name}</h1>
              <p className="text-gray-300 text-sm">{settings.eventName}</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="text-white hover:text-gray-300 transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <div className="flex-1 text-white text-sm">
                Slide {currentIndex + 1} of {buffer.length} • Buffer: {settings.bufferSize}
              </div>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="text-white hover:text-gray-300 transition-colors"
                title="Fullscreen (F)"
              >
                {isFullscreen ? (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`${outerStateClass} bg-black overflow-hidden flex items-center justify-center relative ${className}`}
      onMouseMove={handleMouseMove}
    >
      {variant === 'fullscreen' ? (
        canvasInner
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          {canvasInner}
        </div>
      )}
    </div>
  );
}
