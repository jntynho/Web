export const isPixeldrainUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('pixeldrain.com') ||
    trimmed.includes('pixeldrain.net') ||
    trimmed.includes('/api/pixeldrain')
  );
};

export const parsePixeldrainFileId = (url?: string | null): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const match = trimmed.match(/(?:pixeldrain\.(?:com|net)\/(?:u|file|api\/file)\/)([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];
  
  // Also check if list url
  const listMatch = trimmed.match(/(?:pixeldrain\.(?:com|net)\/(?:l|list|api\/list)\/)([a-zA-Z0-9_-]+)/i);
  if (listMatch) return listMatch[1];

  return null;
};

export const getPixeldrainDownloadUrl = (url: string): string => {
  const fileId = parsePixeldrainFileId(url);
  if (fileId) {
    return `https://pixeldrain.com/api/file/${fileId}?download`;
  }
  return url;
};

export const getPixeldrainDirectUrl = (url: string): string => {
  const fileId = parsePixeldrainFileId(url);
  if (fileId) {
    return `https://pixeldrain.com/api/file/${fileId}`;
  }
  return url;
};

export const getPixeldrainStreamProxyUrl = (url: string): string => {
  const fileId = parsePixeldrainFileId(url);
  if (fileId) {
    return `/api/pixeldrain/stream/${fileId}`;
  }
  return url;
};

export const getPixeldrainIntentUrl = (url: string): string => {
  const downloadUrl = getPixeldrainDownloadUrl(url);
  // Android intent URL scheme to trigger 1DM / VLC / MX Player or default system video player
  return `intent:${downloadUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getPixeldrainVlcUrl = (url: string): string => {
  const downloadUrl = getPixeldrainDownloadUrl(url);
  return `vlc://${downloadUrl}`;
};

export interface PixeldrainMetadata {
  id: string;
  title: string;
  size: number;
  mimeType: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl: string;
}

export const extractPixeldrainUrl = async (url: string): Promise<{
  url: string;
  downloadUrl: string;
  streamProxyUrl: string;
  title?: string;
  thumbnailUrl?: string;
  size?: number;
}> => {
  const fileId = parsePixeldrainFileId(url);
  const directUrl = fileId ? `https://pixeldrain.com/api/file/${fileId}` : url;
  const downloadUrl = fileId ? `https://pixeldrain.com/api/file/${fileId}?download` : url;
  const streamProxyUrl = fileId ? `/api/pixeldrain/stream/${fileId}` : url;

  try {
    const res = await fetch('/api/pixeldrain/extract', {
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
          url: data.url,
          downloadUrl: `${data.url}?download`,
          streamProxyUrl: data.streamProxyUrl || streamProxyUrl,
          title: data.title,
          thumbnailUrl: data.thumbnailUrl,
          size: data.size,
        };
      }
    }
  } catch (e) {
    console.warn('Backend pixeldrain extract failed, falling back to direct stream URL:', e);
  }

  return {
    url: directUrl,
    downloadUrl,
    streamProxyUrl,
    thumbnailUrl: fileId ? `https://pixeldrain.com/api/file/${fileId}/thumbnail` : undefined,
  };
};
