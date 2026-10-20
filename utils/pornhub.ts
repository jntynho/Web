export const isPornhubUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('pornhub.') ||
    trimmed.includes('phncdn.com') ||
    trimmed.includes('/api/pornhub/stream') ||
    trimmed.includes('/api/pornhub/hls') ||
    /^[a-zA-Z0-9]{10,25}$/.test(trimmed)
  );
};

export const extractPornhubVideoId = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  
  // Format: https://www.pornhub.com/view_video.php?viewkey=6811422f7964e
  const viewkeyMatch = trimmed.match(/viewkey=([a-zA-Z0-9]+)/i);
  if (viewkeyMatch) return viewkeyMatch[1];

  // Format: https://www.pornhub.com/embed/6811422f7964e
  const embedMatch = trimmed.match(/pornhub\.[a-z]+\/embed\/([a-zA-Z0-9]+)/i);
  if (embedMatch) return embedMatch[1];

  // Pure alphanumeric viewkey
  if (/^[a-zA-Z0-9]{10,25}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
};

export const getPornhubStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/pornhub/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getPornhubHlsProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/pornhub/hls?target=${encodeURIComponent(targetUrl)}`;
};

export const getPornhubIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getPornhubVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export interface PornhubFileItem {
  id: string; // '1080p', '720p', '480p', '240p'
  name: string;
  size?: number;
  mimeType: string;
  format: 'mp4' | 'hls';
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  quality: string;
  label?: string;
  isDefault?: boolean;
}

export interface PornhubMetadata {
  id: string;
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  quality: string;
  file1080?: PornhubFileItem | null;
  file720?: PornhubFileItem | null;
  file480?: PornhubFileItem | null;
  files: PornhubFileItem[];
}

export const extractPornhubUrl = async (url: string): Promise<PornhubMetadata> => {
  try {
    const res = await fetch('/api/pornhub/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (res.ok) {
      const data = await res.json();
      const rawStreams = Array.isArray(data.streams) ? data.streams : (Array.isArray(data.files) ? data.files : []);
      
      const allMapped: PornhubFileItem[] = rawStreams.map((s: any) => {
        const direct = s.directUrl || s.directStreamUrl || s.url || '';
        const proxy = s.streamProxyUrl || (direct ? getPornhubStreamProxyUrl(direct) : '');
        const cleanQuality = s.quality || '1080p';
        return {
          id: s.id || cleanQuality,
          name: cleanQuality,
          label: cleanQuality,
          size: s.size,
          mimeType: s.mimeType || 'video/mp4',
          format: (s.type === 'hls' || s.format === 'hls' || direct.includes('.m3u8')) ? 'hls' : 'mp4',
          directStreamUrl: direct,
          downloadUrl: s.downloadUrl || direct,
          streamProxyUrl: proxy,
          thumbnailUrl: s.thumbnailUrl || data.thumbnailUrl,
          quality: cleanQuality,
          isDefault: true,
        };
      });

      // Strictly isolate 1080p quality only
      const only1080 = allMapped.filter(f => f.quality === '1080p');
      const mappedFiles = only1080.length > 0 ? only1080 : (allMapped.length > 0 ? [allMapped[0]] : []);

      const defaultStream = mappedFiles[0];
      const activeUrl = data.url || data.directStreamUrl || defaultStream?.directStreamUrl || defaultStream?.streamProxyUrl;
      const activeProxy = data.streamProxyUrl || defaultStream?.streamProxyUrl || (activeUrl ? getPornhubStreamProxyUrl(activeUrl) : '');

      if (activeUrl || mappedFiles.length > 0) {
        return {
          id: data.id || '',
          title: data.title || 'Pornhub Video',
          url: activeUrl || activeProxy,
          directStreamUrl: activeUrl || activeProxy,
          downloadUrl: data.downloadUrl || activeUrl || activeProxy,
          streamProxyUrl: activeProxy,
          thumbnailUrl: data.thumbnailUrl,
          duration: data.duration,
          quality: '1080p',
          file1080: mappedFiles[0] || null,
          file720: null,
          file480: null,
          files: mappedFiles,
        };
      }
      throw new Error(data?.error || 'Valid video stream not found from Pornhub');
    } else {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Server response error (${res.status})`);
    }
  } catch (err: any) {
    console.error('Pornhub extract error:', err);
    throw err;
  }
};
