import { StreamSource } from './types';

const QUALITY_PRIORITY_ORDER: Record<string, number> = {
  '4K': 2160,
  '2160p': 2160,
  '1440p': 1440,
  '2K': 1440,
  '1080p': 1080,
  '1080p48': 1080,
  '720p': 720,
  '480p': 480,
  '360p': 360,
  '240p': 240,
  'Auto': 9999,
};

function getQualityScore(quality: string, height?: number): number {
  if (height && height > 0) return height;
  return QUALITY_PRIORITY_ORDER[quality] || 0;
}

/**
 * Normalizes an array of stream sources:
 * 1. Deduplicates streams with identical quality & resolution
 * 2. Formats informative labels (e.g. "1080p (1920×1080 • 4.0 Mbps)")
 * 3. Sorts in descending order of quality (highest resolution first)
 * 4. Determines the optimal default stream
 */
export function normalizeStreams(streams: StreamSource[]): {
  normalized: StreamSource[];
  defaultStream?: StreamSource;
} {
  if (!streams || streams.length === 0) {
    return { normalized: [] };
  }

  // Deduplicate streams
  const seenMap = new Map<string, StreamSource>();
  for (const s of streams) {
    const key = `${s.quality}_${s.width || 0}x${s.height || 0}_${s.type}`;
    if (!seenMap.has(key)) {
      seenMap.set(key, s);
    } else {
      const existing = seenMap.get(key)!;
      // Prefer stream with bitrate or directUrl
      if (!existing.bitrate && s.bitrate) {
        seenMap.set(key, s);
      }
    }
  }

  const unique = Array.from(seenMap.values());

  // Sort descending: highest resolution first, then highest bitrate
  unique.sort((a, b) => {
    const scoreA = getQualityScore(a.quality, a.height);
    const scoreB = getQualityScore(b.quality, b.height);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  // Ensure human-friendly labels
  const formatted = unique.map((stream) => {
    let cleanLabel = stream.label;
    if (!cleanLabel || cleanLabel === stream.quality) {
      const parts: string[] = [];
      if (stream.width && stream.height) {
        parts.push(`${stream.width}×${stream.height}`);
      }
      if (stream.bitrate && stream.bitrate > 0) {
        const mbps = (stream.bitrate / 1000000).toFixed(1);
        parts.push(`${mbps} Mbps`);
      }
      if (parts.length > 0) {
        cleanLabel = `${stream.quality} (${parts.join(' • ')})`;
      } else {
        cleanLabel = stream.quality;
      }
    }
    return {
      ...stream,
      label: cleanLabel,
    };
  });

  // Pick default stream:
  // Prefer explicitly flagged default, then 1080p, then 720p, then the highest available
  let defaultStream = formatted.find(s => s.isDefault);
  if (!defaultStream) {
    defaultStream = formatted.find(s => s.quality === '1080p');
  }
  if (!defaultStream) {
    defaultStream = formatted.find(s => s.quality === '720p');
  }
  if (!defaultStream && formatted.length > 0) {
    defaultStream = formatted[0];
  }

  return {
    normalized: formatted,
    defaultStream,
  };
}
