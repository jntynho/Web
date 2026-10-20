export const isFileditchUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('fileditchfiles.st') ||
    trimmed.includes('fileditchfiles.me') ||
    trimmed.includes('fileditch.com') ||
    trimmed.includes('cloudflareditch') ||
    (trimmed.includes('workers.dev') && (trimmed.includes('exp=') || trimmed.includes('cloudflareditch'))) ||
    trimmed.includes('/api/fileditch')
  );
};

export const isFileditchWorkerUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.includes('workers.dev') &&
    (trimmed.includes('exp=') || trimmed.includes('sig=') || trimmed.includes('cloudflareditch'))
  );
};

export const extractFileditchWorkerUrlFromText = (text: string): string | null => {
  if (!text || typeof text !== 'string') return null;
  let trimmed = text.trim();

  // Normalize if copied without protocol scheme
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && trimmed.includes('workers.dev')) {
    trimmed = 'https://' + trimmed;
  }

  // Pattern 1: https://*.cloudflareditch*.workers.dev/...
  const match1 = trimmed.match(/https?:\/\/[a-zA-Z0-9_-]+\.cloudflareditch[a-zA-Z0-9_-]*\.workers\.dev\/[^\s"'<>]+/i);
  if (match1) return match1[0];

  // Pattern 2: any workers.dev with exp and sig
  const match2 = trimmed.match(/https?:\/\/[a-zA-Z0-9_.-]+\.workers\.dev\/[^\s"'<>]+\?(?:[^\s"'<>]*&)?(?:exp=\d+|sig=[a-zA-Z0-9_-]+)[^\s"'<>]*/i);
  if (match2) return match2[0];

  // Pattern 3: URL inside quotes or markdown
  const match3 = trimmed.match(/https?:\/\/[^\s"'<>]+\.workers\.dev\/[^\s"'<>]+/i);
  if (match3) return match3[0];

  return null;
};

export interface WorkerUrlAnalysis {
  isValidWorker: boolean;
  workerHost: string;
  filePath: string;
  fileName: string;
  expTimestamp?: number;
  expDateFormatted?: string;
  isExpired: boolean;
  timeLeftFormatted?: string;
  sig?: string;
}

export const parseFileditchWorkerComponents = (url: string): WorkerUrlAnalysis => {
  const result: WorkerUrlAnalysis = {
    isValidWorker: false,
    workerHost: '',
    filePath: '',
    fileName: '',
    isExpired: false,
  };

  if (!url || typeof url !== 'string') return result;

  try {
    const parsed = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    result.workerHost = parsed.hostname;
    result.filePath = parsed.pathname;
    result.isValidWorker = parsed.hostname.includes('workers.dev');

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      result.fileName = decodeURIComponent(segments[segments.length - 1]);
    }

    const expParam = parsed.searchParams.get('exp');
    if (expParam) {
      const expNum = parseInt(expParam, 10);
      if (!isNaN(expNum)) {
        result.expTimestamp = expNum;
        const expDate = new Date(expNum * 1000);
        result.expDateFormatted = expDate.toLocaleString();

        const now = Math.floor(Date.now() / 1000);
        const diffSec = expNum - now;
        if (diffSec <= 0) {
          result.isExpired = true;
          result.timeLeftFormatted = 'Expired';
        } else {
          result.isExpired = false;
          const hours = Math.floor(diffSec / 3600);
          const minutes = Math.floor((diffSec % 3600) / 60);
          result.timeLeftFormatted = `${hours}h ${minutes}m remaining`;
        }
      }
    }

    const sigParam = parsed.searchParams.get('sig');
    if (sigParam) {
      result.sig = sigParam;
    }
  } catch (e) {}

  return result;
};

export const extractFileditchPath = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  try {
    const trimmed = url.trim();
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const pathname = u.pathname;
    if (pathname && pathname !== '/' && pathname.length > 2) {
      return pathname.startsWith('/') ? pathname : `/${pathname}`;
    }
  } catch (e) {
    const match = url.match(/fileditchfiles\.(?:st|me)\/(.+)$/i);
    if (match) return `/${match[1].split('?')[0]}`;
  }
  return null;
};

export const extractFileditchFilename = (url: string): string => {
  try {
    const path = extractFileditchPath(url);
    if (path) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length > 0) {
        const last = segments[segments.length - 1];
        return decodeURIComponent(last).replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ');
      }
    }
  } catch (e) {}
  return 'FileDitch Video';
};

export const doesWorkerUrlMatchTarget = (workerUrl: string, targetUrl: string): boolean => {
  if (!workerUrl || !targetUrl) return false;
  try {
    const targetPath = extractFileditchPath(targetUrl);
    const workerPath = extractFileditchPath(workerUrl);

    if (targetPath && workerPath) {
      const cleanTarget = targetPath.toLowerCase().trim();
      const cleanWorker = workerPath.toLowerCase().trim();
      if (cleanTarget === cleanWorker) return true;

      const targetSegments = cleanTarget.split('/').filter(Boolean);
      const workerSegments = cleanWorker.split('/').filter(Boolean);
      const targetFile = targetSegments[targetSegments.length - 1];
      const workerFile = workerSegments[workerSegments.length - 1];

      if (targetFile && workerFile) {
        if (targetFile === workerFile) return true;

        const tDec = decodeURIComponent(targetFile).replace(/\.[a-z0-9]+$/i, '').replace(/[_\s-]+/g, '');
        const wDec = decodeURIComponent(workerFile).replace(/\.[a-z0-9]+$/i, '').replace(/[_\s-]+/g, '');
        if (tDec && wDec && (tDec === wDec || tDec.includes(wDec) || wDec.includes(tDec))) {
          return true;
        }
      }
    }

    const targetName = extractFileditchFilename(targetUrl).toLowerCase().replace(/[^a-z0-9]/g, '');
    const workerName = extractFileditchFilename(workerUrl).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (targetName && workerName && targetName !== 'fileditchvideo' && workerName !== 'fileditchvideo') {
      if (targetName === workerName || targetName.includes(workerName) || workerName.includes(targetName)) {
        return true;
      }
    }
  } catch (e) {}
  return false;
};

export const getFileditchStreamProxyUrl = (targetUrl: string): string => {
  if (!targetUrl) return '';
  return `/api/fileditch/stream?target=${encodeURIComponent(targetUrl)}`;
};

export const getFileditchIntentUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;action=android.intent.action.VIEW;end`;
};

export const getFileditch1dmUrl = (streamUrl: string): string => {
  return `intent:${streamUrl}#Intent;type=video/*;package=idm.internet.download.manager;action=android.intent.action.VIEW;end`;
};

export const getFileditchVlcUrl = (streamUrl: string): string => {
  return `vlc://${streamUrl}`;
};

export const registerFileditchWorker = async (filePath: string, workerUrl: string): Promise<boolean> => {
  try {
    const res = await fetch('/api/fileditch/register-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, workerUrl })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
};

export const generateFileditchBookmarklet = (returnUrlBase?: string): string => {
  const targetAppUrl = returnUrlBase || (typeof window !== 'undefined' ? window.location.origin : '');
  const code = `javascript:(function(){
    var found = null;
    var links = Array.from(document.querySelectorAll('a[href*="workers.dev"], video source[src*="workers.dev"], video[src*="workers.dev"]'));
    for (var el of links) {
      var href = el.src || el.href;
      if (href && (href.indexOf('workers.dev') !== -1 || href.indexOf('cloudflareditch') !== -1)) {
        found = href;
        break;
      }
    }
    if (!found) {
      var matches = document.documentElement.innerHTML.match(/https?:\\/\\/[a-zA-Z0-9_.-]+\\.workers\\.dev\\/[^\\s"'<>]+/i);
      if (matches) found = matches[0];
    }
    if (found) {
      navigator.clipboard.writeText(found).then(function(){
        alert('✅ Direct stream URL copied successfully! Redirecting...');
        window.location.href = '${targetAppUrl}/fileditch-lab?captured=' + encodeURIComponent(found);
      }).catch(function(){
        window.location.href = '${targetAppUrl}/fileditch-lab?captured=' + encodeURIComponent(found);
      });
    } else {
      alert('⚠️ Direct stream URL not found yet. Please wait for the page to finish loading or click download.');
    }
  })();`;
  return code.replace(/\n\s*/g, ' ');
};

export interface FileditchMetadata {
  id: string;
  title: string;
  url: string;
  directStreamUrl: string;
  downloadUrl: string;
  streamProxyUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  size?: number;
  status?: boolean;
  filePath?: string;
  isDirectWorker: boolean;
  requiresCapture?: boolean;
}

export const extractFileditchUrl = async (url: string): Promise<FileditchMetadata> => {
  try {
    const res = await fetch('/api/fileditch/extract', {
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
          id: data.id || data.filePath || '',
          title: data.title || extractFileditchFilename(url),
          url: data.url || data.directStreamUrl,
          directStreamUrl: data.directStreamUrl || data.url,
          downloadUrl: data.downloadUrl || data.directStreamUrl || data.url,
          streamProxyUrl: data.streamProxyUrl || getFileditchStreamProxyUrl(data.directStreamUrl || data.url),
          thumbnailUrl: data.thumbnailUrl,
          mimeType: data.mimeType || 'video/mp4',
          size: data.size,
          status: data.status,
          filePath: data.filePath,
          isDirectWorker: !!data.isDirectWorker,
          requiresCapture: !!data.requiresCapture,
        };
      }
      throw new Error(data?.error || 'Direct stream URL not found for FileDitch file');
    }

    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server response error (${res.status})`);
  } catch (err: any) {
    console.error('Failed to extract FileDitch video URL:', err);
    throw err;
  }
};
