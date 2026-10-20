export const isCyberfileUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('cyberfile.me') ||
    trimmed.includes('/api/cyberfile')
  );
};

export const extractCyberfileCode = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  
  // Format 1: https://cyberfile.me/ncxW or https://cyberfile.me/d/ncxW or /file/ncxW
  const match = trimmed.match(/cyberfile\.me\/(?:d\/|f\/|file\/)?([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];

  // Direct shortcode
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      return parts[parts.length - 1];
    }
  } catch (e) {}

  return null;
};

export const getCyberfileStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/cyberfile/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getCyberfileIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getCyberfileVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface CyberfileMetadata {
  id: string;
  code: string;
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  size?: number;
}

export const extractCyberfileUrl = async (url: string): Promise<CyberfileMetadata> => {
  try {
    const res = await fetch('/api/cyberfile/extract', {
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
          code: data.code || '',
          title: data.title || 'CyberFile Video',
          url: data.url || data.directStreamUrl,
          directStreamUrl: data.directStreamUrl || data.url,
          downloadUrl: data.downloadUrl || data.directStreamUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getCyberfileStreamProxyUrl(data.directStreamUrl || data.url),
          thumbnailUrl: data.thumbnailUrl,
          mimeType: data.mimeType || 'video/mp4',
          size: data.size,
        };
      }
      throw new Error(data?.error || 'Direct stream URL not found for CyberFile file');
    }

    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server response error (${res.status})`);
  } catch (err: any) {
    console.error('Failed to extract CyberFile video URL:', err);
    throw err;
  }
};
