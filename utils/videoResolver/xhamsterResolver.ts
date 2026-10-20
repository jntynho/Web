import {
  VideoResolver,
  ResolvedVideoMedia,
  VideoResolverError,
  ResolverErrorCode,
  StreamSource,
} from './types';

const imul = Math.imul || function(a: number, b: number): number {
  const ah = (a >>> 16) & 0xffff;
  const al = a & 0xffff;
  const bh = (b >>> 16) & 0xffff;
  const bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
};

/**
 * Decodes xHamster PRNG-scrambled hex URLs according to xplayer.js specification
 */
export function decodeXhamsterUrl(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  const len = trimmed.length;
  if (len < 12 || (len & 1) !== 0 || !/^[0-9a-fA-F]+$/.test(trimmed)) {
    return null;
  }

  const bytes = new Array(len >> 1);
  for (let i = 0, b = 0; i < len; i += 2) {
    const val = parseInt(trimmed.substr(i, 2), 16);
    if (isNaN(val)) return null;
    bytes[b++] = val;
  }

  if (bytes.length < 5) return null;

  const algo = bytes[0] | 0;
  if (algo < 1 || algo > 7) return null;

  const seed = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);

  const prng = ((algoId: number, initialSeed: number) => {
    let s = initialSeed | 0;
    if (algoId === 1) return () => 255 & ((s = imul(s, 1664525) + 0x3c6ef35f | 0));
    if (algoId === 2) return () => { s |= 0; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return 255 & (s |= 0); };
    if (algoId === 3) return () => {
      let e = s = (s + 0x9e3779b9) | 0;
      e ^= e >>> 16; e = imul(e, 0x85ebca77) | 0;
      e ^= e >>> 13; e = imul(e, 0xc2b2ae3d) | 0;
      return 255 & (e ^ (e >>> 16));
    };
    if (algoId === 4) return () => {
      let e = ((s = (s + 0x6d2b79f5) | 0) << 7) | (s >>> 25);
      e = (e + 0x9e3779b9) | 0;
      e ^= e >>> 11;
      return 255 & (e = imul(e, 0x27d4eb2d) | 0);
    };
    if (algoId === 5) return () => {
      s |= 0; s ^= s << 7; s ^= s >>> 9; s ^= s << 8;
      return 255 & ((s = (s + 0xa5a5a5a5) | 0));
    };
    if (algoId === 6) return () => 255 & (((s = imul(s, 0x2c9277b5) + 0xac564b05 | 0) ^ (s >>> 18)) >>> ((s >>> 27) & 31));
    if (algoId === 7) return () => {
      let e = ((s = (s + 0x9e3779b9) | 0) ^ (s << 5));
      e = imul(e, 0x7feb352d) | 0;
      e ^= e >>> 15;
      return 255 & (e = imul(e, 0x846ca68b) | 0);
    };
    return null;
  })(algo, seed);

  if (!prng) return null;

  const outBytes = new Array(bytes.length - 5);
  for (let a = 5, l = 0; a < bytes.length; a++, l++) {
    outBytes[l] = (bytes[a] ^ prng()) & 255;
  }

  let hexEncoded = '';
  for (let i = 0; i < outBytes.length; i++) {
    let hex = outBytes[i].toString(16);
    if (hex.length < 2) hex = '0' + hex;
    hexEncoded += '%' + hex;
  }

  let decoded = '';
  try {
    decoded = decodeURIComponent(hexEncoded);
  } catch (e) {
    for (let i = 0; i < outBytes.length; i++) {
      decoded += String.fromCharCode(outBytes[i]);
    }
  }

  return typeof decoded === 'string' && decoded.length > 0 && /^[\x20-\x7E]+$/.test(decoded) ? decoded : null;
}

/**
 * Checks whether the given string is a valid xHamster video URL or stream
 */
export const isXhamsterUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.includes('xhamster.com') ||
    trimmed.includes('xhamster.desi') ||
    trimmed.includes('xhamster.one') ||
    trimmed.includes('xhamster2.com') ||
    trimmed.includes('xhcdn.com') ||
    /(?:xhamster[0-9]*\.[a-z]{2,})\/(?:videos|embed)\//i.test(trimmed)
  );
};

/**
 * Sanitizes input and extracts the xHamster video slug / ID
 */
export const extractXhamsterId = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const sanitized = url.trim().replace(/[\]\)\>\"\'\s]+$/, '');

  // 1. Check for standard /videos/hot-nurse-gaby-xhX29Dd or /videos/xhX29Dd
  const slugMatch = sanitized.match(/(?:videos|embed)\/([a-zA-Z0-9_-]+)/i);
  if (slugMatch && slugMatch[1]) {
    return slugMatch[1];
  }

  // 2. Check for hash slug (e.g. xhX29Dd)
  const hashMatch = sanitized.match(/\b(xh[a-zA-Z0-9]+)\b/i);
  if (hashMatch && hashMatch[1]) {
    return hashMatch[1];
  }

  return null;
};

/**
 * Builds the server proxy streaming URL for xHamster
 */
export const getXhamsterStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/video-resolver/stream?target=${encodeURIComponent(targetUrl)}`;
};

/**
 * Generates an Android Intent URL for external players (1DM, VLC, MX Player)
 */
export const getXhamsterIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

/**
 * Generates a VLC URL scheme
 */
export const getXhamsterVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

/**
 * xHamster Video Resolver Implementation
 */
export const xhamsterResolver: VideoResolver = {
  name: 'xHamster',

  canResolve(url: string): boolean {
    return isXhamsterUrl(url);
  },

  extractId(url: string): string | null {
    return extractXhamsterId(url);
  },

  getStreamProxyUrl(targetUrl: string): string {
    return getXhamsterStreamProxyUrl(targetUrl);
  },

  getIntentUrl(streamUrl: string): string {
    return getXhamsterIntentUrl(streamUrl);
  },

  getVlcUrl(streamUrl: string): string {
    return getXhamsterVlcUrl(streamUrl);
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedVideoMedia> {
    const videoId = extractXhamsterId(url);
    if (!videoId) {
      throw new VideoResolverError(
        'Invalid or unsupported xHamster video page URL',
        'INVALID_VIDEO_PAGE',
        { url }
      );
    }

    try {
      const res = await fetch('/api/video-resolver/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
      });

      if (!res.ok) {
        let errJson: any = null;
        try {
          errJson = await res.json();
        } catch (e) {}

        const errorCode: ResolverErrorCode = errJson?.code || (res.status === 404 ? 'SOURCE_NOT_FOUND' : 'NETWORK_ERROR');
        throw new VideoResolverError(
          errJson?.error || `Failed to resolve video (${res.status})`,
          errorCode,
          errJson
        );
      }

      const media: ResolvedVideoMedia = await res.json();
      if (!media || !media.streams || media.streams.length === 0) {
        throw new VideoResolverError(
          'No playable stream sources found for this video',
          'SOURCE_NOT_FOUND',
          { videoId }
        );
      }

      // Filter and rename to only 1080p and 2160p if they exist
      const stream2160 = media.streams.find(s => s.quality === '2160p' || s.quality === '4K' || s.height === 2160 || (s.id && s.id.includes('2160')));
      const stream1080 = media.streams.find(s => s.quality === '1080p' || s.height === 1080 || (s.id && s.id.includes('1080')));

      if (stream2160 || stream1080) {
        const filtered: typeof media.streams = [];
        if (stream2160) {
          filtered.push({
            ...stream2160,
            quality: '2160p',
            label: '2160p',
          });
        }
        if (stream1080) {
          filtered.push({
            ...stream1080,
            quality: '1080p',
            label: '1080p',
          });
        }
        media.streams = filtered;
        const defaultStream = filtered.find(s => s.quality === '1080p') || filtered[0];
        media.defaultStream = defaultStream;
      }

      return media;
    } catch (err: any) {
      if (err instanceof VideoResolverError) {
        throw err;
      }
      if (err?.name === 'AbortError') {
        throw new VideoResolverError('Video resolution aborted', 'TIMEOUT');
      }
      throw new VideoResolverError(
        err?.message || 'Failed to connect to video resolver service',
        'NETWORK_ERROR',
        err
      );
    }
  },
};
