export const isGofileUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('gofile.io') ||
    trimmed.includes('/api/gofile')
  );
};

export const extractGofileContentId = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  
  // Format 1: https://gofile.io/d/msx08MF8 or https://gofile.io/d/1dcd7cfa-6839-4300-b98f-8fcaedb813ff
  const matchD = trimmed.match(/gofile\.io\/d\/([a-zA-Z0-9_-]+)/i);
  if (matchD) return matchD[1];

  // Format 2: Direct web download link https://store9.gofile.io/download/web/3bc97af0-f1d8-4774-b64f-44165ad09aa9/...
  const matchDirect = trimmed.match(/gofile\.io\/download\/web\/([a-zA-Z0-9_-]+)/i);
  if (matchDirect) return matchDirect[1];

  // Format 3: Raw UUID or shortcode
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0].toLowerCase() === 'd') {
      return parts[1];
    }
    if (parts.length === 1 && parts[0].length >= 5) {
      return parts[0];
    }
  } catch (e) {}

  return null;
};

export const getGofileStreamProxyUrl = (targetUrl: string, token?: string): string => {
  if (!targetUrl) return '';
  let query = `target=${encodeURIComponent(targetUrl)}`;
  if (token) {
    query += `&token=${encodeURIComponent(token)}`;
  }
  return `/api/gofile/stream?${query}`;
};

export const getGofileIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getGofileVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface GofileFileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  quality?: '4K' | '1440p' | '1080p' | '720p' | '480p' | '240p' | 'SD' | string;
  isSample?: boolean;
}

export interface GofileMetadata {
  id: string;
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  size?: number;
  token?: string;
  quality?: '4K' | '1080p' | '720p' | 'SD';
  file4K?: GofileFileItem | null;
  fileHD?: GofileFileItem | null;
  files?: GofileFileItem[];
}

export const extractGofileUrl = async (url: string, password?: string): Promise<GofileMetadata> => {
  try {
    const res = await fetch('/api/gofile/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, password }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && (data.url || data.directStreamUrl)) {
        return {
          id: data.id || '',
          title: data.title || 'Gofile Video',
          url: data.url || data.directStreamUrl,
          directStreamUrl: data.directStreamUrl || data.url,
          downloadUrl: data.downloadUrl || data.directStreamUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getGofileStreamProxyUrl(data.directStreamUrl || data.url, data.token),
          thumbnailUrl: data.thumbnailUrl,
          mimeType: data.mimeType || 'video/mp4',
          size: data.size,
          token: data.token,
          quality: data.quality,
          file4K: data.file4K || null,
          fileHD: data.fileHD || null,
          files: data.files,
        };
      }
    }
  } catch (e) {
    console.warn('Backend Gofile extract failed:', e);
  }

  const isDirectMedia = /\.(mp4|mkv|webm|mov)($|\?)/i.test(url);
  return {
    id: '',
    title: 'Gofile Video',
    url: url,
    directStreamUrl: url,
    downloadUrl: url,
    streamProxyUrl: isDirectMedia ? getGofileStreamProxyUrl(url) : url,
    mimeType: 'video/mp4',
  };
};
