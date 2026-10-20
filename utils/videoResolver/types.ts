export type StreamType = 'mp4' | 'hls' | 'dash' | 'webm';

export type ResolverErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'INVALID_VIDEO_PAGE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNSUPPORTED_STREAM'
  | 'AUTH_REQUIRED'
  | 'PLAYBACK_ERROR'
  | 'PARSING_ERROR';

export interface AudioStreamInfo {
  codec?: string;
  channels?: number;
  sampleRate?: number;
  bitrate?: number;
}

export interface VideoStreamInfo {
  codec?: string;
  fps?: number;
  aspectRatio?: string;
  profile?: string;
}

export interface StreamSubtitle {
  label: string;
  srclang: string;
  src: string;
  default?: boolean;
}

export interface StreamSource {
  id: string; // e.g. '1080p', '720p', 'auto'
  url: string; // Primary playable stream URL (proxy or direct)
  directUrl?: string; // Direct origin CDN URL
  streamProxyUrl?: string; // Proxy stream URL for CORS and headers bypass
  downloadUrl?: string; // URL suitable for 1DM or external downloader
  type: StreamType;
  quality: string; // '2160p' | '1440p' | '1080p' | '720p' | '480p' | '360p' | '240p' | 'Auto'
  label: string; // Display label, e.g. '1080p (FHD • 4.0 Mbps)'
  width?: number;
  height?: number;
  bitrate?: number; // In bps or kbps
  fps?: number;
  codec?: string;
  size?: number; // Approximate size in bytes if known
  mimeType?: string;
  audio?: AudioStreamInfo;
  video?: VideoStreamInfo;
  subtitles?: StreamSubtitle[];
  headers?: Record<string, string>;
  expiresAt?: number;
  isDefault?: boolean;
}

export interface ResolvedVideoMedia {
  id: string; // Video ID or ViewKey
  provider: string; // 'pornhub', 'eporner', etc.
  pageUrl: string;
  title: string;
  duration?: number;
  thumbnailUrl?: string;
  uploadDate?: string;
  date?: number; // timestamp in ms
  actors?: string[];
  actress?: string;
  actressImage?: string;
  actorImages?: Record<string, string>;
  actorDetails?: Array<{ name: string; slug?: string; imageUrl?: string }>;
  studio?: string;
  streams: StreamSource[]; // All discovered and normalized qualities
  defaultStream?: StreamSource;
  hlsMasterUrl?: string;
  dashMpdUrl?: string;
  headers?: Record<string, string>;
  createdAt: number;
  expiresAt?: number;
}

export class VideoResolverError extends Error {
  code: ResolverErrorCode;
  details?: any;

  constructor(message: string, code: ResolverErrorCode, details?: any) {
    super(message);
    this.name = 'VideoResolverError';
    this.code = code;
    this.details = details;
  }
}

export interface VideoResolver {
  readonly name: string;
  canResolve(url: string): boolean;
  extractId(url: string): string | null;
  resolve(url: string, signal?: AbortSignal): Promise<ResolvedVideoMedia>;
  getStreamProxyUrl?(targetUrl: string): string;
  getIntentUrl?(streamUrl: string): string;
  getVlcUrl?(streamUrl: string): string;
}
