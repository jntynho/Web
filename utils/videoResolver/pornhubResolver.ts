import {
  VideoResolver,
  ResolvedVideoMedia,
  VideoResolverError,
  ResolverErrorCode,
} from './types';

/**
 * Checks whether the given string is a valid Pornhub video URL or stream
 */
export const isPornhubUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.includes('pornhub.com') ||
    trimmed.includes('pornhubpremium.com') ||
    trimmed.includes('/api/video-resolver/stream') ||
    trimmed.includes('/api/pornhub/stream')
  );
};

/**
 * Sanitizes input and extracts the Pornhub ViewKey
 */
export const extractPornhubViewkey = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  // Clean trailing brackets, quotes, parentheses or whitespace
  const sanitized = url.trim().replace(/[\]\)\>\"\'\s]+$/, '');

  // 1. Check for ?viewkey= or &viewkey=
  const queryMatch = sanitized.match(/[?&]viewkey=([a-zA-Z0-9]+)/i);
  if (queryMatch && queryMatch[1]) {
    return queryMatch[1];
  }

  // 2. Check for /embed/
  const embedMatch = sanitized.match(/pornhub(?:premium)?\.com\/embed\/([a-zA-Z0-9]+)/i);
  if (embedMatch && embedMatch[1]) {
    return embedMatch[1];
  }

  // 3. Check if raw viewkey was passed
  if (/^(?:ph)?[a-zA-Z0-9]{10,20}$/.test(sanitized)) {
    return sanitized;
  }

  return null;
};

/**
 * Builds the server proxy streaming URL for Pornhub
 */
export const getPornhubStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/video-resolver/stream?target=${encodeURIComponent(targetUrl)}`;
};

/**
 * Generates an Android Intent URL for external players (1DM, VLC, MX Player)
 */
export const getPornhubIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

/**
 * Generates a VLC URL scheme
 */
export const getPornhubVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

/**
 * Pornhub Video Resolver Implementation
 */
export const pornhubResolver: VideoResolver = {
  name: 'Pornhub',

  canResolve(url: string): boolean {
    return isPornhubUrl(url);
  },

  extractId(url: string): string | null {
    return extractPornhubViewkey(url);
  },

  getStreamProxyUrl(targetUrl: string): string {
    return getPornhubStreamProxyUrl(targetUrl);
  },

  getIntentUrl(streamUrl: string): string {
    return getPornhubIntentUrl(streamUrl);
  },

  getVlcUrl(streamUrl: string): string {
    return getPornhubVlcUrl(streamUrl);
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedVideoMedia> {
    const viewkey = extractPornhubViewkey(url);
    if (!viewkey) {
      throw new VideoResolverError(
        'Invalid or unsupported Pornhub video page URL',
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
          { viewkey }
        );
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
