/**
 * Hanimestream (HStream) Extractor and Streaming Utilities
 * Handles extracting video manifests, multi-quality DASH streams (1080p, 2160p 4K, 720p),
 * server mirror fallbacks, and integration with GoPlayer.
 */

export interface HanimestreamQualityOption {
  id: string; // '2160p' | '1080p' | '720p' | '2160i' | '1080i'
  name: string;
  label: string;
  quality: '2160p' | '1080p' | '720p' | string;
  size?: number;
  codec: string;
  resolution: string;
  mode: 'mpd' | 'mp4';
  mimeType: string;
  directStreamUrl: string;
  proxyStreamUrl: string;
  streamProxyUrl: string;
  downloadUrl: string;
  is4K?: boolean;
  isFullHD?: boolean;
}

export interface HanimestreamSubtitle {
  label: string;
  kind: string;
  srclang: string;
  src: string;
  default?: boolean;
}

export interface HanimestreamMetadata {
  success: boolean;
  title: string;
  episodeId: string;
  poster: string;
  streamUrl: string;
  streamDomains: string[];
  asiaStreamDomains: string[];
  activeDomain: string;
  qualities: HanimestreamQualityOption[];
  preferredQuality: string;
  directStreamUrl: string;
  streamProxyUrl: string;
  downloadUrl: string;
  subtitles?: HanimestreamSubtitle[];
  genre?: string[];
  uploadDate?: string;
  description?: string;
  rawUrl: string;
  thumbsVtt?: string;
  gallery?: string[];
  error?: string;
}

export interface ServerProbeResult {
  domain: string;
  latencyMs: number;
  status: number;
  online: boolean;
  cors: boolean;
}

/**
 * Checks if a URL or input string is a valid HStream / Hanimestream target
 */
export function isHanimestreamUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const clean = rawUrl.trim().toLowerCase();
  return (
    clean.includes('hstream.moe') ||
    clean.startsWith('hanimestream:') ||
    clean.startsWith('hstream:') ||
    clean.includes('/hentai/') && clean.includes('hstream')
  );
}

/**
 * Extracts normalized target URL or slug
 */
export function normalizeHanimestreamUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let clean = rawUrl.trim();
  clean = clean.replace(/^(hanimestream:|hstream:)/i, '').trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    if (clean.startsWith('hentai/')) {
      clean = `https://hstream.moe/${clean}`;
    } else {
      clean = `https://hstream.moe/hentai/${clean}`;
    }
  }
  return clean;
}

/**
 * Calls the backend to extract Hanimestream video data, qualities, and manifests
 */
export async function extractHanimestreamUrl(
  rawUrl: string,
  preferredServer?: string
): Promise<HanimestreamMetadata> {
  const normalized = normalizeHanimestreamUrl(rawUrl);
  
  const response = await fetch('/api/hanimestream/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: normalized,
      preferredServer,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status} while extracting Hanimestream data`);
  }

  const data: HanimestreamMetadata = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to extract video stream from Hanimestream');
  }

  return data;
}

export interface HanimeScrapedEpisode {
  episodeNumber: number;
  url: string;
  coverImage: string;
  title?: string;
  description?: string;
  boosterCover?: string;
  assignedDate?: number;
  censorship?: 'UNCENSORED' | 'CENSORED';
  gallery?: string[];
}

export interface HanimeScrapedSeries {
  success: boolean;
  title: string;
  smallestDate: string | null;
  description: string;
  censorship: 'UNCENSORED' | 'CENSORED' | null;
  episodes: HanimeScrapedEpisode[];
  coverImage: string;
  boosterCovers?: string[];
  secondaryCovers?: string[];
  seriesUrl: string;
}

/**
 * Scrapes full series info from HStream page (Title, Date, Description, Censorship, Episodes)
 */
export async function scrapeHanimeSeries(rawUrl: string): Promise<HanimeScrapedSeries> {
  const normalized = normalizeHanimestreamUrl(rawUrl);

  const response = await fetch('/api/hanimestream/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: normalized }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status} while scraping Hanime series`);
  }

  const data: HanimeScrapedSeries = await response.json();
  if (!data.success) {
    throw new Error('Failed to scrape series metadata from HStream');
  }

  return data;
}

/**
 * Probes servers for speed & availability
 */
export async function probeHanimestreamServers(domains: string[]): Promise<ServerProbeResult[]> {
  try {
    const res = await fetch('/api/hanimestream/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.error('Failed to probe servers:', e);
    return [];
  }
}

/**
 * Generates Android Intent URL for external player launching (1DM, VLC, MX Player)
 */
export function getHanimestreamIntentUrl(streamUrl: string, title?: string): string {
  const cleanTitle = encodeURIComponent(title || 'Hanimestream Video');
  const cleanUrl = encodeURIComponent(streamUrl);
  const type = streamUrl.includes('.mpd') ? 'application/dash+xml' : 'video/mp4';
  return `intent:${cleanUrl}#Intent;type=${type};action=android.intent.action.VIEW;S.title=${cleanTitle};end`;
}

/**
 * Generates VLC deep link
 */
export function getHanimestreamVlcUrl(streamUrl: string): string {
  return `vlc://${streamUrl}`;
}

/**
 * Generates 1DM deep link
 */
export function getHanimestream1dmUrl(streamUrl: string, title?: string): string {
  const encodedUrl = encodeURIComponent(streamUrl);
  const encodedTitle = encodeURIComponent(title || 'Hanimestream_Stream');
  return `intent:${encodedUrl}#Intent;type=video/*;action=android.intent.action.VIEW;S.title=${encodedTitle};package=idm.internet.download.manager;end`;
}
