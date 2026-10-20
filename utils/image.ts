export const compressImage = (file: File, maxWidth = 600, quality = 0.72): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(img.src);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Try modern WebP format first (30-50% smaller than JPEG with superior clarity)
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Derives a thumbnail URL from an original image URL for various popular image hosting platforms
 */
export function getThumbnailUrl(originalUrl: string): string {
  if (!originalUrl) return '';
  
  // vipr.im: /i/ -> /th/
  if (originalUrl.includes('vipr.im/i/')) {
    return originalUrl.replace('/i/', '/th/');
  }
  
  // imx.to: /u/i/ -> /u/t/ or /i/ -> /t/
  if (originalUrl.includes('imx.to/u/i/')) {
    return originalUrl.replace('/u/i/', '/u/t/');
  }
  if (originalUrl.includes('imx.to/i/')) {
    return originalUrl.replace('/i/', '/t/');
  }

  // pixhost.to / pixhost.icu
  if (originalUrl.includes('img') && originalUrl.includes('pixhost') && originalUrl.includes('/images/')) {
    return originalUrl.replace('img', 't').replace('/images/', '/thumbs/');
  }

  // imgbox.com
  if (originalUrl.includes('images') && originalUrl.includes('imgbox.com') && originalUrl.includes('_o.')) {
    return originalUrl.replace('images', 'thumbs').replace('_o.', '_t.');
  }

  // turboimagehost.com
  if (originalUrl.includes('turboimagehost.com/p/')) {
    return originalUrl.replace('/p/', '/t/');
  }

  // postimg.cc
  if (originalUrl.includes('i.postimg.cc/')) {
    return originalUrl.replace('i.postimg.cc/', 't.postimg.cc/');
  }

  // cum.st: /media/{hash}/original.jpg -> /thumbnail/{hash}/preview.webp
  const cumstMediaMatch = originalUrl.match(/https?:\/\/[^/]*cum\.st\/media\/([a-f0-9]{64})\/[^?]+/i);
  if (cumstMediaMatch) {
    return `https://img.cum.st/thumbnail/${cumstMediaMatch[1]}/preview.webp`;
  }

  // coomer.su / kemono.su: /data/ -> /thumbnail/data/
  if (originalUrl.includes('coomer.su/data/') || originalUrl.includes('kemono.su/data/')) {
    return originalUrl.replace('/data/', '/thumbnail/data/');
  }

  // cuckcapital.cr / goonbox: .th.jpg or .md.jpg
  if (originalUrl.includes('cuckcapital.cr') && !originalUrl.includes('.th.') && !originalUrl.includes('.md.')) {
    return originalUrl.replace(/\.(jpg|jpeg|png|webp)/i, '.th.$1');
  }

  return originalUrl;
}

/**
 * Derives an original/HD URL from a thumbnail image URL for various popular image hosting platforms
 */
export function getOriginalUrl(thumbnailUrl: string): string {
  if (!thumbnailUrl) return '';

  // cuckcapital.cr: .th.jpg / .md.jpg -> .jpg
  if (thumbnailUrl.includes('cuckcapital.cr')) {
    return thumbnailUrl.replace(/\.(?:th|md)\./i, '.');
  }

  // cum.st: /thumbnail/{hash}/preview.webp -> /media/{hash}/original.jpg
  const cumstThumbMatch = thumbnailUrl.match(/https?:\/\/[^/]*cum\.st\/thumbnail\/([a-f0-9]{64})\/[^?]+/i);
  if (cumstThumbMatch) {
    return `https://e1.cum.st/media/${cumstThumbMatch[1]}/original.jpg?response-content-disposition=inline; filename="original.jpg"`;
  }

  // coomer.su / kemono.su: /thumbnail/data/ -> /data/
  if (thumbnailUrl.includes('coomer.su/thumbnail/data/') || thumbnailUrl.includes('kemono.su/thumbnail/data/')) {
    return thumbnailUrl.replace('/thumbnail/data/', '/data/');
  }

  // vipr.im: /th/ -> /i/
  if (thumbnailUrl.includes('vipr.im/th/')) {
    return thumbnailUrl.replace('/th/', '/i/');
  }

  // imx.to: /u/t/ -> /u/i/ or /t/ -> /i/
  if (thumbnailUrl.includes('imx.to/u/t/')) {
    return thumbnailUrl.replace('/u/t/', '/u/i/');
  }
  if (thumbnailUrl.includes('imx.to/t/')) {
    return thumbnailUrl.replace('/t/', '/i/');
  }

  // pixhost.to / pixhost.icu
  if (thumbnailUrl.includes('t') && thumbnailUrl.includes('pixhost') && thumbnailUrl.includes('/thumbs/')) {
    return thumbnailUrl.replace(/^https?:\/\/t(\d*)\./, 'https://img$1.').replace('/thumbs/', '/images/');
  }

  // imgbox.com
  if (thumbnailUrl.includes('thumbs') && thumbnailUrl.includes('imgbox.com') && thumbnailUrl.includes('_t.')) {
    return thumbnailUrl.replace('thumbs', 'images').replace('_t.', '_o.');
  }

  // turboimagehost.com
  if (thumbnailUrl.includes('turboimagehost.com/t/')) {
    return thumbnailUrl.replace('/t/', '/p/');
  }

  // postimg.cc
  if (thumbnailUrl.includes('t.postimg.cc/')) {
    return thumbnailUrl.replace('t.postimg.cc/', 'i.postimg.cc/');
  }

  return thumbnailUrl;
}

/**
 * Returns a secondary mirror/CDN URL if the primary media host fails or is throttled
 */
export function getCdnFallbackUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  // cum.st media: e1 <-> e2
  if (url.includes('https://e1.cum.st/')) {
    return url.replace('https://e1.cum.st/', 'https://e2.cum.st/');
  }
  if (url.includes('https://e2.cum.st/')) {
    return url.replace('https://e2.cum.st/', 'https://e1.cum.st/');
  }

  // coomer.su media: c1 <-> c2
  if (url.includes('https://c1.coomer.su/')) {
    return url.replace('https://c1.coomer.su/', 'https://c2.coomer.su/');
  }
  if (url.includes('https://c2.coomer.su/')) {
    return url.replace('https://c2.coomer.su/', 'https://c1.coomer.su/');
  }

  // thumbnails: img.cum.st <-> img.coomer.su
  if (url.includes('https://img.cum.st/thumbnail/')) {
    return url.replace('https://img.cum.st/thumbnail/', 'https://img.coomer.su/thumbnail/');
  }
  if (url.includes('https://img.coomer.su/thumbnail/')) {
    return url.replace('https://img.coomer.su/thumbnail/', 'https://img.cum.st/thumbnail/');
  }

  return null;
}

/**
 * Ensures image URLs are safe, clean, and upgrades insecure http:// to https://
 */
export function sanitizeImageUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') && !trimmed.includes('localhost') && !trimmed.includes('127.0.0.1')) {
    return trimmed.replace('http://', 'https://');
  }
  return trimmed;
}

/**
 * Returns proxied URL via /api/proxy-image for blocked/cross-origin images
 */
export function getImageProxyUrl(url?: string | null): string {
  const clean = sanitizeImageUrl(url);
  if (!clean) return '';
  if (clean.startsWith('/api/proxy-image') || clean.startsWith('data:') || clean.startsWith('blob:')) {
    return clean;
  }
  return `/api/proxy-image?url=${encodeURIComponent(clean)}`;
}

/**
 * Checks if URL is a local, data, or blob URL
 */
export function isLocalOrDataUrl(url?: string | null): boolean {
  if (!url) return false;
  return url.startsWith('data:') || url.startsWith('blob:') || (url.startsWith('/') && !url.startsWith('//'));
}
