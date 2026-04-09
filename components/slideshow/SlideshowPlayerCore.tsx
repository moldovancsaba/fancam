'use client';

/**
 * Slideshow playback: FIFO queue whose target depth is `bufferSize` (prefetch / smoothness only).
 * Loop mode never treats buffer length as “end of show”; we top the queue up asynchronously.
 */

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  type CSSProperties,
} from 'react';
import {
  slideshowStageDimensions,
  type ViewportScaleMode,
} from '@/lib/slideshow/viewport-scale';

const DEFAULT_BG_PRIMARY = '#312e81';
const DEFAULT_BG_ACCENT = '#0f172a';

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
  playMode?: 'once' | 'loop';
  orderMode?: 'fixed' | 'random';
  backgroundPrimaryColor?: string;
  backgroundAccentColor?: string;
  backgroundImageUrl?: string | null;
  viewportScale?: ViewportScaleMode;
}

export interface SlideshowPlayerCoreProps {
  slideshowId: string;
  /** When set (e.g. layout region id), random-order playlists shuffle independently per instance */
  instanceKey?: string;
  objectFit?: 'contain' | 'cover';
  /** Stagger first transition (ms); API/layout may send string from JSON */
  delayMs?: number | string;
  variant?: 'fullscreen' | 'embedded';
  className?: string;
}

function slideKey(slide: Slide): string {
  return slide.submissions.map((s) => s._id).join('-');
}

function normalizeDelayMs(raw: number | string | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(600_000, Math.floor(raw)));
  }
  if (typeof raw === 'string') {
    const n = parseInt(raw.trim(), 10);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(600_000, n));
    }
  }
  return 0;
}

function clampTimingMs(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/**
 * Fullscreen: use slideshow.viewportScale (fit letterbox vs fill crop in browser).
 * Embedded (layout tile): use region Photo scaling — cover = 16:9 stage fills the cell (crop overflow),
 * contain = full stage visible in cell. Slideshow viewportScale is ignored in tiles so layout wins.
 */
function viewportModeForStage(
  variant: 'fullscreen' | 'embedded',
  objectFit: 'contain' | 'cover',
  slideshowViewportScale: ViewportScaleMode | undefined
): ViewportScaleMode {
  if (variant === 'embedded') {
    return objectFit === 'cover' ? 'fill' : 'fit';
  }
  return slideshowViewportScale === 'fill' ? 'fill' : 'fit';
}

export function SlideshowPlayerCore({
  slideshowId,
  instanceKey,
  objectFit = 'contain',
  delayMs: delayMsProp = 0,
  variant = 'fullscreen',
  className = '',
}: SlideshowPlayerCoreProps) {
  const delayMs = normalizeDelayMs(delayMsProp);
  const [settings, setSettings] = useState<SlideshowSettings | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [slideQueue, setSlideQueue] = useState<Slide[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackEnded, setPlaybackEnded] = useState(false);
  const [displayEpoch, setDisplayEpoch] = useState(0);
  const [fadeOpaque, setFadeOpaque] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const preloadedImages = useRef<Map<string, HTMLImageElement>>(new Map());
  const pendingInitialDelayRef = useRef(delayMs > 0);
  const onceInitialRef = useRef<Slide[] | null>(null);
  const settingsRef = useRef<SlideshowSettings | null>(null);
  const transitionMsRef = useRef(8000);
  const fadeMsRef = useRef(0);
  const bufferTargetRef = useRef(10);
  const slideQueueRef = useRef<Slide[]>([]);
  const refillBusyRef = useRef(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  /** Black stage floor until configured failover background image is preloaded / painted */
  const [failoverBgImageReady, setFailoverBgImageReady] = useState(true);

  useEffect(() => {
    settingsRef.current = settings;
    if (!settings) return;
    transitionMsRef.current = clampTimingMs(
      settings.transitionDurationMs,
      8000,
      600_000
    );
    fadeMsRef.current = clampTimingMs(settings.fadeDurationMs, 0, 60_000);
    bufferTargetRef.current = Math.max(
      1,
      Math.min(100, Math.floor(Number(settings.bufferSize) || 10))
    );
  }, [settings]);

  useEffect(() => {
    slideQueueRef.current = slideQueue;
  }, [slideQueue]);

  useEffect(() => {
    pendingInitialDelayRef.current = delayMs > 0;
  }, [slideshowId, delayMs, instanceKey]);

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

  const fetchPlaylistChunk = useCallback(
    async (limit: number): Promise<Slide[]> => {
      const lim = Math.max(1, Math.min(50, Math.floor(limit)));
      try {
        const qs = new URLSearchParams({ limit: String(lim) });
        if (instanceKey?.trim()) {
          qs.set('instanceKey', instanceKey.trim().slice(0, 256));
        }
        const response = await fetch(
          `/api/slideshows/${slideshowId}/playlist?${qs.toString()}`,
          { cache: 'no-store' }
        );
        if (!response.ok) return [];
        const data = await response.json();
        return (data.playlist || []) as Slide[];
      } catch {
        return [];
      }
    },
    [slideshowId, instanceKey]
  );

  /** Keep loop queue near `bufferSize`; does not define how long the show runs. */
  const maintainLoopBuffer = useCallback(async () => {
    const s = settingsRef.current;
    if (!s || s.playMode === 'once') return;
    if (refillBusyRef.current) return;
    refillBusyRef.current = true;
    try {
      const target = bufferTargetRef.current;
      for (let round = 0; round < 8; round++) {
        const len = slideQueueRef.current.length;
        if (len >= target) break;
        const need = target - len;
        const chunk = await fetchPlaylistChunk(Math.min(need, 25));
        if (chunk.length === 0) break;
        await Promise.all(chunk.map((sl) => preloadSlide(sl)));
        setSlideQueue((curr) => {
          if (curr.length >= target) return curr;
          const stillNeed = target - curr.length;
          const take = chunk.slice(0, Math.max(stillNeed, 1));
          return [...curr, ...take];
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      refillBusyRef.current = false;
    }
  }, [fetchPlaylistChunk, preloadSlide]);

  const loadInitialBuffer = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setPlaybackEnded(false);
      pendingInitialDelayRef.current = delayMs > 0;
      onceInitialRef.current = null;

      const initialQs = new URLSearchParams();
      if (instanceKey?.trim()) {
        initialQs.set('instanceKey', instanceKey.trim().slice(0, 256));
      }
      const initialQuery = initialQs.toString();
      const playlistUrl =
        initialQuery.length > 0
          ? `/api/slideshows/${slideshowId}/playlist?${initialQuery}`
          : `/api/slideshows/${slideshowId}/playlist`;
      const response = await fetch(playlistUrl, { cache: 'no-store' });
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

      const failoverBgUrl = (data.slideshow.backgroundImageUrl || '').trim();
      setFailoverBgImageReady(!failoverBgUrl);
      if (failoverBgUrl) {
        try {
          await preloadImage(failoverBgUrl);
        } catch {
          /* show gradient fallback below image layer */
        }
        setFailoverBgImageReady(true);
      }

      const playlist = (data.playlist || []) as Slide[];
      if (playlist.length > 0) {
        await Promise.all(playlist.map(preloadSlide));
        setDisplayEpoch(0);
        setSlideQueue(playlist);
        if (data.slideshow.playMode === 'once') {
          onceInitialRef.current = playlist.map((sl) => ({
            ...sl,
            submissions: sl.submissions.map((s) => ({ ...s })),
          }));
        }
        if (data.slideshow.playMode !== 'once') {
          void maintainLoopBuffer();
        }
      } else {
        setDisplayEpoch(0);
        setSlideQueue([]);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load initial buffer:', err);
      setError(err instanceof Error ? err.message : 'Failed to load slideshow');
      setIsLoading(false);
    }
  }, [slideshowId, instanceKey, preloadSlide, maintainLoopBuffer, delayMs]);

  useLayoutEffect(() => {
    if (!settings) return;
    const mode = viewportModeForStage(
      variant,
      objectFit,
      settings.viewportScale
    );

    if (variant === 'fullscreen') {
      const measure = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        setStageSize(slideshowStageDimensions(w, h, mode));
      };
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setStageSize(slideshowStageDimensions(r.width, r.height, mode));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant, objectFit, settings, slideshowId]);

  useEffect(() => {
    loadInitialBuffer();
  }, [loadInitialBuffer]);

  useEffect(() => {
    if (slideQueue.length === 0) return;
    void Promise.all(slideQueue.map((s) => preloadSlide(s)));
  }, [slideQueue, preloadSlide]);

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

  const headSlide = slideQueue[0];
  const queueLen = slideQueue.length;

  useEffect(() => {
    if (!settings || !isPlaying || !headSlide) return;

    updatePlayCounts(headSlide);

    const applyInitialStagger =
      displayEpoch === 0 && pendingInitialDelayRef.current && delayMs > 0;
    const delayExtra = applyInitialStagger ? delayMs : 0;
    const holdMs = transitionMsRef.current + delayExtra;

    const advanceTimer = setTimeout(() => {
      if (applyInitialStagger) {
        pendingInitialDelayRef.current = false;
      }

      const sNow = settingsRef.current;
      const playMode = sNow?.playMode === 'once' ? 'once' : 'loop';

      if (playMode === 'once') {
        let advanced = false;
        let ended = false;
        setSlideQueue((q) => {
          if (q.length <= 1) {
            ended = true;
            return q;
          }
          advanced = true;
          return q.slice(1);
        });
        if (ended) {
          setPlaybackEnded(true);
          setIsPlaying(false);
        }
        if (advanced) setDisplayEpoch((e) => e + 1);
        return;
      }

      let advanced = false;
      setSlideQueue((q) => {
        if (q.length === 0) return q;
        advanced = true;
        return q.slice(1);
      });
      if (advanced) setDisplayEpoch((e) => e + 1);
      void maintainLoopBuffer();
    }, holdMs);

    return () => {
      clearTimeout(advanceTimer);
    };
  }, [
    settings,
    headSlide,
    isPlaying,
    delayMs,
    displayEpoch,
    updatePlayCounts,
    maintainLoopBuffer,
  ]);

  useEffect(() => {
    if (!settings || settings.playMode === 'once' || !isPlaying) return;
    const id = window.setInterval(() => {
      void maintainLoopBuffer();
    }, 2500);
    return () => clearInterval(id);
  }, [settings, isPlaying, maintainLoopBuffer, slideshowId]);

  const fadeMsForUi =
    settings == null
      ? 0
      : clampTimingMs(settings.fadeDurationMs, 0, 60_000);
  const headFadeKey =
    settings && headSlide ? `${displayEpoch}:${slideKey(headSlide)}` : '';

  useLayoutEffect(() => {
    if (!headFadeKey) {
      setFadeOpaque(true);
      return;
    }
    if (fadeMsForUi <= 0) {
      setFadeOpaque(true);
      return;
    }
    if (displayEpoch === 0) {
      setFadeOpaque(true);
      return;
    }
    setFadeOpaque(false);
    const raf = requestAnimationFrame(() => {
      setFadeOpaque(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [headFadeKey, fadeMsForUi, displayEpoch]);

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

  const manualAdvance = useCallback(() => {
    pendingInitialDelayRef.current = false;
    const s = settingsRef.current;
    const playMode = s?.playMode === 'once' ? 'once' : 'loop';
    setPlaybackEnded(false);

    if (playMode === 'once') {
      let advanced = false;
      setSlideQueue((q) => {
        if (q.length <= 1) return q;
        advanced = true;
        return q.slice(1);
      });
      if (advanced) setDisplayEpoch((e) => e + 1);
      return;
    }

    let advanced = false;
    setSlideQueue((q) => {
      if (q.length === 0) return q;
      advanced = true;
      return q.slice(1);
    });
    if (advanced) setDisplayEpoch((e) => e + 1);
    void maintainLoopBuffer();
  }, [maintainLoopBuffer]);

  const manualBack = useCallback(() => {
    pendingInitialDelayRef.current = false;
    setPlaybackEnded(false);
    setSlideQueue((q) => {
      if (q.length < 2) return q;
      const last = q[q.length - 1];
      return [last, ...q.slice(0, -1)];
    });
    setDisplayEpoch((e) => e + 1);
    const s = settingsRef.current;
    if (s && s.playMode !== 'once') {
      void maintainLoopBuffer();
    }
  }, [maintainLoopBuffer]);

  useEffect(() => {
    if (variant !== 'fullscreen') return;
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'ArrowRight' && slideQueue.length > 0) {
        manualAdvance();
      } else if (e.key === 'ArrowLeft' && slideQueue.length > 0) {
        manualBack();
      }
    };
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [variant, slideQueue.length, manualAdvance, manualBack]);

  const primary = settings?.backgroundPrimaryColor?.trim() || DEFAULT_BG_PRIMARY;
  const accent = settings?.backgroundAccentColor?.trim() || DEFAULT_BG_ACCENT;
  const bgImageUrl = settings?.backgroundImageUrl?.trim() || '';

  const failoverBackgroundStyle: CSSProperties = {
    background: `linear-gradient(to bottom left, ${primary}, ${accent})`,
  };

  const stageBackdropStyle: CSSProperties =
    bgImageUrl && !failoverBgImageReady
      ? { background: '#000000' }
      : failoverBackgroundStyle;

  const outerStateClass =
    variant === 'fullscreen' ? 'w-screen h-screen' : 'w-full h-full min-h-0 min-w-0';

  if (isLoading) {
    return (
      <div
        className={`${outerStateClass} flex flex-col items-center justify-center overflow-hidden bg-black ${className}`}
        aria-busy="true"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="relative z-10 max-h-64 max-w-md object-contain"
          />
        ) : null}
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div
        className={`${outerStateClass} flex items-center justify-center overflow-hidden bg-black p-2 ${className}`}
      >
        <div className="text-red-200 text-center text-sm md:text-xl z-10 relative px-2">
          {error || 'Slideshow not found'}
        </div>
      </div>
    );
  }

  const currentSlide = headSlide;

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

  const sw = stageSize.width;
  const sh = stageSize.height;
  const hasStage = sw > 0 && sh > 0;

  const canvasInner = (
    <div
      className={
        variant === 'fullscreen'
          ? 'relative overflow-hidden'
          : hasStage
            ? 'relative overflow-hidden'
            : 'relative overflow-hidden w-full max-h-full max-w-full aspect-video'
      }
      style={
        variant === 'fullscreen'
          ? hasStage
            ? {
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: sw,
                height: sh,
              }
            : {
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '100vw',
                height: '56.25vw',
                maxWidth: '177.78vh',
                maxHeight: '100vh',
              }
          : hasStage
            ? {
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: sw,
                height: sh,
              }
            : {}
      }
    >
      <div className="absolute inset-0 z-0" style={stageBackdropStyle} aria-hidden />
      {bgImageUrl ? (
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 z-[1] h-full w-full object-cover pointer-events-none"
          onLoad={() => setFailoverBgImageReady(true)}
          onError={() => setFailoverBgImageReady(true)}
        />
      ) : null}

      <div className="absolute inset-0 z-[2] flex items-center justify-center">
        {currentSlide ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              opacity: fadeOpaque ? 1 : 0,
              transition:
                fadeMsForUi > 0
                  ? `opacity ${fadeMsForUi}ms ease-in-out`
                  : undefined,
            }}
          >
            {renderSlide(currentSlide)}
          </div>
        ) : (
          <div className="text-white text-center px-4 max-w-lg">
            <div className="text-2xl md:text-4xl mb-2 md:mb-4">📸</div>
            <div className="text-lg md:text-2xl">{settings.name}</div>
            <div className="text-white/80 mt-1 md:mt-2 text-xs md:text-base">No submissions yet</div>
          </div>
        )}
      </div>

      {playbackEnded && currentSlide && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white px-4 text-center">
          <p className="text-lg md:text-2xl font-semibold">Playback complete</p>
          <p className="text-sm text-gray-300 mt-2">Press play to start again</p>
        </div>
      )}

      {variant === 'fullscreen' && (!isFullscreen || showControls) && (
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent p-6 transition-opacity">
          <div className="max-w-7xl mx-auto">
            <div className="mb-4">
              <h1 className="text-white text-2xl font-bold">{settings.name}</h1>
              <p className="text-gray-300 text-sm">{settings.eventName}</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  if (playbackEnded && onceInitialRef.current?.length) {
                    pendingInitialDelayRef.current = delayMs > 0;
                    setSlideQueue(
                      onceInitialRef.current.map((sl) => ({
                        ...sl,
                        submissions: sl.submissions.map((s) => ({ ...s })),
                      }))
                    );
                    setPlaybackEnded(false);
                    setIsPlaying(true);
                    setDisplayEpoch(0);
                    return;
                  }
                  setIsPlaying(!isPlaying);
                }}
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
                Queue {queueLen > 0 ? `1 / ${queueLen}` : '0'} • Buffer depth{' '}
                {settings.bufferSize}
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
      className={`${outerStateClass} overflow-hidden flex items-center justify-center relative ${className}`}
      style={failoverBackgroundStyle}
      onMouseMove={handleMouseMove}
    >
      {variant === 'fullscreen' ? (
        canvasInner
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={failoverBackgroundStyle}>
          {canvasInner}
        </div>
      )}
    </div>
  );
}
