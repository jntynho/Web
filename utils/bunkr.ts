export const isBunkrUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('bunkr.') ||
    trimmed.includes('bunkrr.') ||
    trimmed.includes('cdn.cr/storage/media') ||
    trimmed.includes('/api/bunkr')
  );
};

export const getBunkrStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/bunkr/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getBunkrIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getBunkrVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface BunkrMetadata {
  title: string;
  url: string;
  directStreamUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
}

export const extractBunkrUrl = async (url: string): Promise<BunkrMetadata> => {
  try {
    const res = await fetch('/api/bunkr/extract', {
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
          title: data.title || 'Bunkr Video',
          url: data.url,
          directStreamUrl: data.directStreamUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getBunkrStreamProxyUrl(data.url),
          thumbnailUrl: data.thumbnailUrl,
          mimeType: data.mimeType || 'video/mp4',
        };
      }
    }
  } catch (e) {
    console.warn('Backend Bunkr extract failed:', e);
  }

  // Fallback if backend extraction could not be reached
  const isDirectMedia = /\.(mp4|mkv|webm|mov)($|\?)/i.test(url);
  return {
    title: 'Bunkr Video',
    url: url,
    directStreamUrl: url,
    streamProxyUrl: isDirectMedia ? getBunkrStreamProxyUrl(url) : url,
    mimeType: 'video/mp4',
  };
};
