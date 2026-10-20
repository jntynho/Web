export const isFilesterUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('filester.') ||
    trimmed.includes('/api/filester')
  );
};

export const extractFilesterSlug = (url: string): string | null => {
  try {
    const trimmed = url.trim();
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && ['d', 'v', 'f', 'file', 'watch'].includes(parts[0].toLowerCase())) {
      return parts[1];
    }
    if (parts.length >= 1) {
      return parts[parts.length - 1];
    }
  } catch (e) {
    const match = url.match(/filester\.[a-z]+\/(?:d|v|f|file)?\/?([a-zA-Z0-9_-]+)/i);
    if (match) return match[1];
  }
  return null;
};

export const getFilesterStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/filester/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getFilesterIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getFilesterVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface FilesterMetadata {
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  server?: string;
  token?: string;
  expiresIn?: number;
  fileUUID?: string;
}

export const extractFilesterUrl = async (url: string): Promise<FilesterMetadata> => {
  try {
    const res = await fetch('/api/filester/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        return {
          title: data.title || 'Filester Video',
          url: data.url,
          directStreamUrl: data.directStreamUrl || data.url,
          downloadUrl: data.downloadUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getFilesterStreamProxyUrl(data.url),
          thumbnailUrl: data.thumbnailUrl,
          mimeType: data.mimeType || 'video/mp4',
          server: data.server,
          token: data.token,
          expiresIn: data.expiresIn,
          fileUUID: data.fileUUID,
        };
      }
    }
  } catch (e) {
    console.warn('Backend Filester extract failed:', e);
  }

  const isDirectMedia = /\.(mp4|mkv|webm|mov)($|\?)/i.test(url);
  return {
    title: 'Filester Video',
    url: url,
    directStreamUrl: url,
    downloadUrl: url,
    streamProxyUrl: isDirectMedia ? getFilesterStreamProxyUrl(url) : url,
    mimeType: 'video/mp4',
  };
};
