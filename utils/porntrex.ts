export const isPorntrexUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.includes('porntrex.com') ||
    trimmed.includes('/api/porntrex/stream')
  );
};

export const extractPorntrexVideoId = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const sanitized = url.trim().replace(/[\]\)\>\"\'\s]+$/, '');

  // Format: https://www.porntrex.com/video/3304416/kari-cachonda-teacher-s-private-proposal
  // Or: https://www.porntrex.com/embed/3304416
  // Or: https://porntrex.com/video/3304416/
  const match = sanitized.match(/porntrex\.com\/(?:video|embed)\/(\d+)/i);
  if (match) return match[1];

  // Pure numeric ID
  if (/^\d{4,10}$/.test(sanitized)) {
    return sanitized;
  }

  return null;
};

export const getPorntrexStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/porntrex/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getPorntrexIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getPorntrexVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface PorntrexFileItem {
  id: string; // '2160p', '1080p', '720p', '480p', '360p', '240p'
  name: string;
  size?: number;
  mimeType: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  quality: string;
  label?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  fps?: number;
  isDefault?: boolean;
}

export interface PorntrexMetadata {
  id: string;
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  quality: string;
  file4K?: PorntrexFileItem | null;
  file1080?: PorntrexFileItem | null;
  files: PorntrexFileItem[];
  views?: number;
  rate?: number;
  date?: string;
  dateStr?: string;
  actors?: string[];
  actress?: string;
  actorImages?: Record<string, string>;
  categories?: string[];
  tags?: string[];
}

export const extractPorntrexUrl = async (url: string, signal?: AbortSignal): Promise<PorntrexMetadata> => {
  try {
    const res = await fetch('/api/porntrex/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal,
    });

    if (res.ok) {
      const data = await res.json();
      if (data && (data.url || data.directStreamUrl || (Array.isArray(data.files) && data.files.length > 0))) {
        return {
          id: data.id || '',
          title: data.title || 'Porntrex Video',
          url: data.url || data.directStreamUrl,
          directStreamUrl: data.directStreamUrl || data.url,
          downloadUrl: data.downloadUrl || data.directStreamUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getPorntrexStreamProxyUrl(data.directStreamUrl || data.url),
          thumbnailUrl: data.thumbnailUrl,
          duration: data.duration,
          quality: data.quality || '1080p',
          file4K: data.file4K || null,
          file1080: data.file1080 || null,
          files: Array.isArray(data.files) ? data.files : [],
          views: data.views,
          rate: data.rate,
          date: data.date,
          dateStr: data.dateStr || data.date,
          actors: Array.isArray(data.actors) ? data.actors : [],
          actress: data.actress,
          actorImages: data.actorImages || {},
          categories: Array.isArray(data.categories) ? data.categories : [],
          tags: Array.isArray(data.tags) ? data.tags : [],
        };
      }
      throw new Error(data?.error || 'Valid video stream qualities not found from Porntrex');
    } else {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Server response error (${res.status})`);
    }
  } catch (err: any) {
    console.error('Porntrex extract error:', err);
    throw err;
  }
};
