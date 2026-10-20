import { useState, useEffect, useCallback, useRef } from 'react';
import { sanitizeImageUrl, getImageProxyUrl, isLocalOrDataUrl } from '../utils/image';

export interface UseImageFallbackOptions {
  fallbackUrl?: string;
  autoProxyOnError?: boolean;
}

// Global session cache for URLs that have been successfully loaded
const loadedImagesCache = new Set<string>();

export function isImageInCache(url?: string | null): boolean {
  if (!url) return false;
  const clean = sanitizeImageUrl(url);
  return clean ? loadedImagesCache.has(clean) || isLocalOrDataUrl(clean) : false;
}

export function markImageAsLoaded(url?: string | null): void {
  if (!url) return;
  const clean = sanitizeImageUrl(url);
  if (clean) loadedImagesCache.add(clean);
}

export function useImageFallback(
  initialUrl?: string | null,
  options: UseImageFallbackOptions = {}
) {
  const { fallbackUrl, autoProxyOnError = true } = options;
  const cleanInitial = sanitizeImageUrl(initialUrl);

  const [currentSrc, setCurrentSrc] = useState<string>(cleanInitial);
  const [imgLoaded, setImgLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isUsingProxy, setIsUsingProxy] = useState<boolean>(false);

  const triedProxyRef = useRef<boolean>(false);
  const currentSrcRef = useRef<string>(currentSrc);
  currentSrcRef.current = currentSrc;

  useEffect(() => {
    const clean = sanitizeImageUrl(initialUrl);
    setCurrentSrc(clean);
    setImgLoaded(false);
    setHasError(false);
    setIsUsingProxy(false);
    triedProxyRef.current = false;
  }, [initialUrl]);

  const handleLoad = useCallback(() => {
    const src = currentSrcRef.current;
    if (src) loadedImagesCache.add(src);
    if (cleanInitial) loadedImagesCache.add(cleanInitial);
    setImgLoaded(true);
    setHasError(false);
  }, [cleanInitial]);

  const handleError = useCallback(() => {
    const src = currentSrcRef.current;
    // If not tried proxy yet, and URL is an external web URL, retry via backend proxy
    if (
      autoProxyOnError &&
      !triedProxyRef.current &&
      src &&
      !isLocalOrDataUrl(src) &&
      !src.startsWith('/api/proxy-image')
    ) {
      triedProxyRef.current = true;
      setIsUsingProxy(true);
      setImgLoaded(false);
      const proxied = getImageProxyUrl(src);
      setCurrentSrc(proxied);
      return;
    }

    // If proxy also failed, or fallback url provided
    if (fallbackUrl && src !== fallbackUrl) {
      setCurrentSrc(fallbackUrl);
      setImgLoaded(false);
      return;
    }

    setHasError(true);
  }, [autoProxyOnError, fallbackUrl]);

  // Actively check if image is already cached / decoded by the browser
  useEffect(() => {
    if (!currentSrc || imgLoaded || hasError) return;

    let isMounted = true;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = currentSrc;

    if (img.complete && img.naturalWidth > 0) {
      loadedImagesCache.add(currentSrc);
      if (cleanInitial) loadedImagesCache.add(cleanInitial);
      requestAnimationFrame(() => {
        if (isMounted) setImgLoaded(true);
      });
      return;
    }

    img.onload = () => {
      if (isMounted) {
        loadedImagesCache.add(currentSrc);
        if (cleanInitial) loadedImagesCache.add(cleanInitial);
        requestAnimationFrame(() => {
          if (isMounted) setImgLoaded(true);
        });
      }
    };

    if (typeof img.decode === 'function') {
      img.decode().then(() => {
        if (isMounted) {
          loadedImagesCache.add(currentSrc);
          if (cleanInitial) loadedImagesCache.add(cleanInitial);
          requestAnimationFrame(() => {
            if (isMounted) setImgLoaded(true);
          });
        }
      }).catch(() => {
        // ignore decode error on background check
      });
    }

    return () => {
      isMounted = false;
      img.onload = null;
    };
  }, [currentSrc, imgLoaded, hasError, cleanInitial]);

  const bindImgRef = useCallback((el: HTMLImageElement | null) => {
    if (!el) return;
    if (el.complete && el.naturalWidth > 0) {
      requestAnimationFrame(() => handleLoad());
    } else if (typeof el.decode === 'function') {
      el.decode().then(() => {
        requestAnimationFrame(() => handleLoad());
      }).catch(() => {});
    }
  }, [handleLoad]);

  return {
    src: currentSrc,
    imgLoaded,
    hasError,
    isUsingProxy,
    handleError,
    handleLoad,
    bindImgRef,
  };
}
