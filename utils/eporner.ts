export const isEpornerUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('eporner.com') ||
    trimmed.includes('/api/eporner/stream')
  );
};

export const extractEpornerVideoId = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  
  // Format: https://fr.eporner.com/video-MVD3dDOcFYk/-/
  // Or: https://www.eporner.com/embed/MVD3dDOcFYk/
  // Or: https://www.eporner.com/video-MVD3dDOcFYk/
  // Or: https://www.eporner.com/hd-porn/MVD3dDOcFYk/
  const match = trimmed.match(/eporner\.com\/(?:video-|embed\/|hd-porn\/)?([a-zA-Z0-9]+)/i);
  if (match) return match[1];

  if (/^video-([a-zA-Z0-9]+)$/i.test(trimmed)) {
    const m = trimmed.match(/^video-([a-zA-Z0-9]+)$/i);
    return m ? m[1] : null;
  }

  // Pure alphanumeric ID
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
};

export const getEpornerStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/eporner/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getEpornerIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getEpornerVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface EpornerFileItem {
  id: string; // '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'
  name: string;
  size?: number;
  mimeType: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  quality: string;
  label?: string;
  isDefault?: boolean;
}

export interface EpornerMetadata {
  id: string;
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  quality: string;
  file4K?: EpornerFileItem | null;
  file1080?: EpornerFileItem | null;
  files: EpornerFileItem[];
  views?: number;
  rate?: number;
  date?: string;
  dateStr?: string;
  actors?: string[];
  actress?: string;
  actorImages?: Record<string, string>;
}

export const extractEpornerUrl = async (url: string): Promise<EpornerMetadata> => {
  try {
    const res = await fetch('/api/eporner/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && (data.url || data.directStreamUrl)) {
        return {
          id: data.id || '',
          title: data.title || 'Eporner Video',
          url: data.url || data.directStreamUrl,
          directStreamUrl: data.directStreamUrl || data.url,
          downloadUrl: data.downloadUrl || data.directStreamUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getEpornerStreamProxyUrl(data.directStreamUrl || data.url),
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
        };
      }
      throw new Error(data?.error || 'Valid video stream qualities not found from Eporner');
    } else {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Server response error (${res.status})`);
    }
  } catch (err: any) {
    console.error('Eporner extract error:', err);
    throw err;
  }
};
