/**
 * Slideshow Playlist Generation
 * Version: 1.0.0
 * 
 * Generates smart playlists for event slideshows with aspect ratio detection
 * and mosaic layouts for non-16:9 images.
 * 
 * Playlist Logic:
 * - Always select the 5 least-played submissions (sorted by playCount ASC, createdAt ASC)
 * - Detect aspect ratio from image dimensions
 * - Group by aspect ratio: 16:9, 1:1, 9:16
 * - Create mosaics: 1:1 → 2x1 layout, 9:16 → 3x1 layout
 * - Skip 1:1 and 9:16 if insufficient images for complete mosaic
 */

import { Submission } from '@/lib/db/schemas';

/** Fisher–Yates shuffle (mutates array). */
export function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** FNV-1a 32-bit — stable hash for layout instance keys (server playlist route). */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function mulberryNext() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates with a deterministic PRNG (mutates array).
 * Used with `seed = hash(instanceKey) ^ perRequestSalt` so layout cells get independent streams.
 */
export function shuffleInPlaceSeeded<T>(arr: T[], seed: number): void {
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Cyclic left-rotate in place so layout regions with the same fairness-sorted list
 * do not all start on the same first submission (fixed orderMode + instanceKey).
 */
export function rotateLeftBy<T>(arr: T[], k: number): void {
  const n = arr.length;
  if (n <= 1) return;
  let offset = k % n;
  if (offset < 0) offset += n;
  if (offset === 0) return;
  const head = arr.splice(0, offset);
  arr.push(...head);
}

function cloneSlide(s: Slide): Slide {
  return {
    type: s.type,
    aspectRatio: s.aspectRatio,
    submissions: s.submissions.map((sub) => ({ ...sub })),
  };
}

/**
 * Repeat a base playlist cyclically until it has exactly targetLen slides (deep-cloned entries).
 * Used to keep a full prefetch queue when the event has very few distinct slides.
 */
export function expandPlaylistToLength(base: Slide[], targetLen: number): Slide[] {
  if (base.length === 0 || targetLen <= 0) return [];
  const out: Slide[] = [];
  for (let i = 0; i < targetLen; i++) {
    out.push(cloneSlide(base[i % base.length]));
  }
  return out;
}

/**
 * Aspect Ratio Categories
 */
export enum AspectRatio {
  LANDSCAPE = '16:9',  // Horizontal images (full screen)
  SQUARE = '1:1',      // Square images (2x1 mosaic)
  PORTRAIT = '9:16',   // Vertical images (3x1 mosaic)
  UNKNOWN = 'unknown', // Cannot determine or unsupported
}

/**
 * Slide Type - represents what will be displayed
 */
export interface Slide {
  type: 'single' | 'mosaic';
  aspectRatio: AspectRatio;
  submissions: Array<{
    _id: string;
    imageUrl: string;
    width: number;
    height: number;
  }>;
}

/**
 * Detect aspect ratio from image dimensions
 * Uses WIDE tolerance to accept more images as valid
 * 
 * CRITICAL: Many images have slightly non-standard aspect ratios (e.g. 2160x1440 = 1.5)
 * We must accept these as landscape to ensure ALL images can be displayed
 * Otherwise, images get skipped and the same few images play repeatedly
 */
export function detectAspectRatio(width: number, height: number): AspectRatio {
  const ratio = width / height;
  
  // Portrait: ratio < 0.7 (anything narrower than portrait-ish)
  // 9:16 = 0.5625, so accept 0.4 to 0.7 as portrait
  if (ratio >= 0.4 && ratio <= 0.7) {
    return AspectRatio.PORTRAIT;
  }
  
  // Square: ratio between 0.8 and 1.2 (roughly square-ish)
  // 1:1 = 1.0, so accept 0.8 to 1.2 as square
  if (ratio >= 0.8 && ratio <= 1.2) {
    return AspectRatio.SQUARE;
  }
  
  // Landscape: ratio > 1.2 (anything wider than square)
  // 16:9 = 1.777, 3:2 = 1.5, 4:3 = 1.333 - ALL should be landscape
  // This includes 2160x1440 (1.5), 2048x1365 (1.5), 1920x1080 (1.777)
  if (ratio > 1.2) {
    return AspectRatio.LANDSCAPE;
  }
  
  // Fallback: If somehow outside all ranges, treat as landscape
  // This ensures NO images are skipped
  return AspectRatio.LANDSCAPE;
}

/**
 * Generate playlist of next N slides from submissions
 * 
 * @param submissions - Array of submissions sorted by playCount ASC, createdAt ASC
 * @param limit - Maximum number of slides to generate (default: 10)
 * @returns Array of Slide objects ready for display
 */
export function generatePlaylist(submissions: any[], limit: number = 10): Slide[] {
  const playlist: Slide[] = [];
  
  // CRITICAL: Group by aspect ratio FIRST, then sort each group by playCount
  // This ensures we can find enough images of same aspect ratio to create mosaics
  
  const landscape: any[] = [];
  const square: any[] = [];
  const portrait: any[] = [];
  
  // First pass: Categorize by aspect ratio
  for (const submission of submissions) {
    const width = submission.metadata?.finalWidth || submission.metadata?.originalWidth || 1920;
    const height = submission.metadata?.finalHeight || submission.metadata?.originalHeight || 1080;
    const aspectRatio = detectAspectRatio(width, height);
    
    console.log(`[Playlist] ${submission._id}: ${width}x${height} → ${aspectRatio} (ratio: ${(width/height).toFixed(3)})`);
    
    switch (aspectRatio) {
      case AspectRatio.LANDSCAPE:
        landscape.push(submission);
        break;
      case AspectRatio.SQUARE:
        square.push(submission);
        break;
      case AspectRatio.PORTRAIT:
        portrait.push(submission);
        break;
      default:
        console.warn(`[Playlist] Skipping submission ${submission._id}: unknown aspect ratio ${aspectRatio}`);
        break;
    }
  }
  
  // Sort each group by playCount (least played first), then createdAt (OLDEST first)
  // CRITICAL: This must match the API sorting to maintain consistency
  const sortByPlayCount = (a: any, b: any) => {
    const aCount = a.playCount || 0;
    const bCount = b.playCount || 0;
    if (aCount !== bCount) return aCount - bCount; // Ascending playCount (0, 1, 2, ... lowest first)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); // Ascending createdAt (oldest first)
  };
  
  landscape.sort(sortByPlayCount);
  square.sort(sortByPlayCount);
  portrait.sort(sortByPlayCount);
  
  // Build playlist: prioritize 16:9, then mosaics
  // Generate up to limit slides
  console.log(`[Playlist] Building playlist from: ${landscape.length} landscape, ${square.length} square, ${portrait.length} portrait`);
  
  let slideCount = 0;
  let landscapeIdx = 0;
  let squareIdx = 0;
  let portraitIdx = 0;
  
  // Build playlist by Round-robin: prioritize least-played regardless of aspect ratio
  // This ensures mosaics are properly interleaved with landscape images
  while (slideCount < limit) {
    let added = false;
    
    // Determine what types are still available
    const hasLandscape = landscapeIdx < landscape.length;
    const hasSquareMosaic = squareIdx + 5 < square.length; // Need 6 images for 3×2 grid
    const hasPortraitMosaic = portraitIdx + 2 < portrait.length;
    
    // Strategy: Add one of each type in rotation, skipping unavailable types
    // This ensures fair distribution and proper mosaic creation
    
    // 1. Try landscape first (if available)
    if (hasLandscape && slideCount < limit) {
      const sub = landscape[landscapeIdx];
      playlist.push({
        type: 'single',
        aspectRatio: AspectRatio.LANDSCAPE,
        submissions: [{
          _id: sub._id.toString(),
          imageUrl: sub.imageUrl || sub.finalImageUrl,
          width: sub.metadata?.finalWidth || sub.metadata?.originalWidth || 1920,
          height: sub.metadata?.finalHeight || sub.metadata?.originalHeight || 1080,
        }],
      });
      landscapeIdx++;
      slideCount++;
      added = true;
      console.log(`[Playlist] Added landscape slide (${slideCount}/${limit})`);
    }
    
    // 2. Try portrait mosaic (if available and space remaining)
    if (hasPortraitMosaic && slideCount < limit) {
      const sub1 = portrait[portraitIdx];
      const sub2 = portrait[portraitIdx + 1];
      const sub3 = portrait[portraitIdx + 2];
      playlist.push({
        type: 'mosaic',
        aspectRatio: AspectRatio.PORTRAIT,
        submissions: [
          {
            _id: sub1._id.toString(),
            imageUrl: sub1.imageUrl || sub1.finalImageUrl,
            width: sub1.metadata?.finalWidth || sub1.metadata?.originalWidth || 540,
            height: sub1.metadata?.finalHeight || sub1.metadata?.originalHeight || 960,
          },
          {
            _id: sub2._id.toString(),
            imageUrl: sub2.imageUrl || sub2.finalImageUrl,
            width: sub2.metadata?.finalWidth || sub2.metadata?.originalWidth || 540,
            height: sub2.metadata?.finalHeight || sub2.metadata?.originalHeight || 960,
          },
          {
            _id: sub3._id.toString(),
            imageUrl: sub3.imageUrl || sub3.finalImageUrl,
            width: sub3.metadata?.finalWidth || sub3.metadata?.originalWidth || 540,
            height: sub3.metadata?.finalHeight || sub3.metadata?.originalHeight || 960,
          },
        ],
      });
      portraitIdx += 3;
      slideCount++;
      added = true;
      console.log(`[Playlist] Added portrait mosaic (${slideCount}/${limit})`);
    }
    
    // 3. Try square mosaic (if available and space remaining)
    if (hasSquareMosaic && slideCount < limit) {
      // 3×2 grid requires 6 square images
      const submissions = [];
      for (let i = 0; i < 6; i++) {
        const sub = square[squareIdx + i];
        submissions.push({
          _id: sub._id.toString(),
          imageUrl: sub.imageUrl || sub.finalImageUrl,
          width: sub.metadata?.finalWidth || sub.metadata?.originalWidth || 540,
          height: sub.metadata?.finalHeight || sub.metadata?.originalHeight || 540,
        });
      }
      
      playlist.push({
        type: 'mosaic',
        aspectRatio: AspectRatio.SQUARE,
        submissions,
      });
      squareIdx += 6;
      slideCount++;
      added = true;
      console.log(`[Playlist] Added square mosaic 3×2 (${slideCount}/${limit})`);
    }
    
    // If nothing was added this iteration, we've exhausted all options
    if (!added) {
      console.log(`[Playlist] No more slides available, stopping at ${slideCount}/${limit}`);
      break;
    }
  }
  
  return playlist;
}

/**
 * Extract all submission IDs from a playlist
 * Used to update play counts after display
 */
export function extractSubmissionIds(playlist: Slide[]): string[] {
  const ids: string[] = [];
  for (const slide of playlist) {
    for (const submission of slide.submissions) {
      ids.push(submission._id);
    }
  }
  return ids;
}
