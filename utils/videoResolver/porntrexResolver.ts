import {
  VideoResolver,
  ResolvedVideoMedia,
  StreamSource,
  VideoResolverError,
  ResolverErrorCode,
} from './types';
import {
  isPorntrexUrl,
  extractPorntrexVideoId,
  getPorntrexStreamProxyUrl,
  getPorntrexIntentUrl,
  getPorntrexVlcUrl,
  extractPorntrexUrl,
} from '../porntrex';

export {
  isPorntrexUrl,
  extractPorntrexVideoId,
  getPorntrexStreamProxyUrl,
  getPorntrexIntentUrl,
  getPorntrexVlcUrl,
};

/**
 * Porntrex Video Resolver Implementation
 */
export const porntrexResolver: VideoResolver = {
  name: 'Porntrex',

  canResolve(url: string): boolean {
    return isPorntrexUrl(url);
  },

  extractId(url: string): string | null {
    return extractPorntrexVideoId(url);
  },

  getStreamProxyUrl(targetUrl: string): string {
    return getPorntrexStreamProxyUrl(targetUrl);
  },

  getIntentUrl(streamUrl: string): string {
    return getPorntrexIntentUrl(streamUrl);
  },

  getVlcUrl(streamUrl: string): string {
    return getPorntrexVlcUrl(streamUrl);
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedVideoMedia> {
    const videoId = extractPorntrexVideoId(url);
    if (!videoId) {
      throw new VideoResolverError(
        'Invalid Porntrex video page URL or Video ID',
        'INVALID_VIDEO_PAGE',
        { url }
      );
    }

    try {
      const meta = await extractPorntrexUrl(url, signal);

      const streams: StreamSource[] = (meta.files || []).map((f) => {
        let label = f.label || `${f.quality.toUpperCase()}`;
        if (!label.includes(f.quality)) {
          label = `${f.quality} (${label})`;
        }

        return {
          id: f.id || f.quality,
          url: f.directStreamUrl || f.streamProxyUrl,
          directUrl: f.directStreamUrl,
          streamProxyUrl: f.streamProxyUrl,
          downloadUrl: f.downloadUrl,
          type: 'mp4',
          quality: f.quality,
          label,
          width: f.width,
          height: f.height,
          bitrate: f.bitrate,
          fps: f.fps,
          size: f.size,
          mimeType: f.mimeType || 'video/mp4',
          isDefault: f.isDefault,
        };
      });

      // Find default stream: prefer 1080p, then 4K / 2160p, then 720p, then first available
      const defaultStream =
        streams.find((s) => s.quality === '1080p' || s.id === '1080p') ||
        streams.find((s) => s.quality === '2160p' || s.id === '2160p') ||
        streams.find((s) => s.quality === '720p' || s.id === '720p') ||
        streams[0];

      return {
        id: meta.id || videoId,
        provider: 'porntrex',
        pageUrl: url,
        title: meta.title,
        duration: meta.duration,
        thumbnailUrl: meta.thumbnailUrl,
        uploadDate: meta.dateStr || meta.date,
        date: meta.date ? new Date(meta.date).getTime() : undefined,
        actors: meta.actors,
        actress: meta.actress,
        actorImages: meta.actorImages,
        streams,
        defaultStream,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    } catch (err: any) {
      if (err instanceof VideoResolverError) {
        throw err;
      }
      throw new VideoResolverError(
        err.message || 'Failed to resolve Porntrex video media',
        'NETWORK_ERROR',
        { originalError: err, url }
      );
    }
  },
};
