
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, Navigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { CoomerPost } from '../types';
import { SkeletonCoomerGrid } from '../components/SkeletonCard';
import { getThumbnailUrl, getCdnFallbackUrl } from '../utils/image';
import { PaginationBar } from '../components/Pagination';
import * as storage from '../utils/storage';
import { getCachedCoomerPosts } from '../utils/coomerCache';
import { copyTextToClipboard, hasActiveTextSelection } from '../utils/clipboard';

const POSTS_PER_PAGE = 54;
export type MediaFilter = 'all' | 'pictures' | 'video';
const currentPageCache: Record<string, number> = {};
const currentMediaFilterCache: Record<string, MediaFilter> = {};
// In-memory page store for exact 54-item pages to guarantee instant zero-gap jumps
export const pageStoreCache: Record<string, Record<number, CoomerPost[]>> = {};
const onDemandCache: Record<string, { posts: CoomerPost[]; total: number; timestamp: number }> = {};

export const invalidateCoomerCache = (id?: string) => {
  if (id) {
    delete onDemandCache[`${id}-v4-sync`];
    delete currentPageCache[id];
    delete currentMediaFilterCache[id];
    try { sessionStorage.removeItem(`coomer_filter_${id}`); } catch {}
    delete pageStoreCache[id];
    storage.setItem(`coomer_pages_${id}`, null).catch(() => {});
  } else {
    Object.keys(onDemandCache).forEach(k => delete onDemandCache[k]);
    Object.keys(currentPageCache).forEach(k => delete currentPageCache[k]);
    Object.keys(currentMediaFilterCache).forEach(k => delete currentMediaFilterCache[k]);
    Object.keys(pageStoreCache).forEach(k => delete pageStoreCache[k]);
  }
};

// Global Singleton IntersectionObserver for high-performance zero-overhead lazy loading
type ObserverCallback = (isIntersecting: boolean) => void;
const observerCallbacks = new WeakMap<Element, ObserverCallback>();

let sharedIntersectionObserver: IntersectionObserver | null = null;
const getSharedIntersectionObserver = () => {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return null;
  if (!sharedIntersectionObserver) {
    sharedIntersectionObserver = new IntersectionObserver(
      (entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.isIntersecting) {
            const cb = observerCallbacks.get(entry.target);
            if (cb) {
              cb(true);
              sharedIntersectionObserver?.unobserve(entry.target);
              observerCallbacks.delete(entry.target);
            }
          }
        }
      },
      {
        rootMargin: '450px 0px',
        threshold: 0.01
      }
    );
  }
  return sharedIntersectionObserver;
};

const renderedCardIds = new Set<string>();

const PostCard = React.memo(({ 
  post, 
  index,
  mediaFilter,
  onClick, 
  onLongPress 
}: { 
  post: CoomerPost; 
  index: number;
  mediaFilter?: MediaFilter;
  onClick: (post: CoomerPost, postIndex: number, imageIndex: number) => void;
  onLongPress: (postId: string) => void;
}) => {
  const postKey = `${post.id || (post.urls && post.urls[0]) || `post-${index}`}-${mediaFilter || 'all'}`;
  const isAlreadyRendered = useRef(renderedCardIds.has(postKey));

  const displayIndex = useMemo(() => {
    if (mediaFilter === 'video') {
      const vIdx = post.urls.findIndex((u, i) => 
        post.mediaTypes?.[i] === 'video' || /\.(mp4|webm|mov)($|\?)/i.test(u)
      );
      return vIdx !== -1 ? vIdx : 0;
    }
    if (mediaFilter === 'pictures') {
      const pIdx = post.urls.findIndex((u, i) => 
        post.mediaTypes?.[i] === 'image' || !/\.(mp4|webm|mov)($|\?)/i.test(u)
      );
      return pIdx !== -1 ? pIdx : 0;
    }
    return 0;
  }, [post.urls, post.mediaTypes, mediaFilter]);
  
  const initialThumb = post.thumbUrls?.[displayIndex] || getThumbnailUrl(post.urls[displayIndex]) || post.urls[displayIndex] || '';
  const [src, setSrc] = useState(initialThumb);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [fallbackAttempted, setFallbackAttempted] = useState(false);
  const [cdnFallbackAttempted, setCdnFallbackAttempted] = useState(false);
  // First 12 items or already rendered items are immediately visible
  const [isVisible, setIsVisible] = useState(() => index < 12 || isAlreadyRendered.current);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const touchStartPos = useRef({ x: 0, y: 0 });
  const longPressTimer = useRef<number | null>(null);
  const wasLongPressed = useRef(false);

  useEffect(() => {
    renderedCardIds.add(postKey);
  }, [postKey]);

  // High performance lazy load using the single shared observer
  useEffect(() => {
    if (isVisible) return;
    const el = cardRef.current;
    if (!el) return;

    const observer = getSharedIntersectionObserver();
    if (!observer) {
      setIsVisible(true);
      return;
    }

    observerCallbacks.set(el, (isIntersecting) => {
      if (isIntersecting) {
        setIsVisible(true);
      }
    });

    observer.observe(el);

    return () => {
      observer.unobserve(el);
      observerCallbacks.delete(el);
    };
  }, [isVisible]);

  useEffect(() => {
    const newThumb = post.thumbUrls?.[displayIndex] || getThumbnailUrl(post.urls[displayIndex]) || post.urls[displayIndex] || '';
    if (newThumb && newThumb !== src) {
      setSrc(newThumb);
      setImgLoaded(false);
      setHasError(false);
      setFallbackAttempted(false);
      setCdnFallbackAttempted(false);
    }
  }, [post.thumbUrls, post.urls, displayIndex, src]);

  const clearTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    wasLongPressed.current = false;
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    clearTimer();
    longPressTimer.current = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);
      wasLongPressed.current = true;
      onLongPress(post.id);
      longPressTimer.current = null;
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (longPressTimer.current) {
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPos.current.x);
      const dy = Math.abs(touch.clientY - touchStartPos.current.y);
      if (dx > 12 || dy > 12) {
        clearTimer();
      }
    }
  };

  // Staggered micro delay (capped at 160ms) for smooth wave appearance only on initial entrance
  const animDelayMs = isAlreadyRendered.current ? 0 : Math.min((index % 54) * 6, 160);
  const animClass = isAlreadyRendered.current ? '' : 'animate-grid-card';

  const isVideo = post.mediaTypes?.[displayIndex] === 'video' || (Boolean(post.urls[displayIndex]) && /\.(mp4|webm|mov)($|\?)/i.test(post.urls[displayIndex]));
  const duration = post.videoDurations?.[displayIndex];

  return (
    <div 
      ref={cardRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={clearTimer}
      onTouchCancel={clearTimer}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        if (wasLongPressed.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick(post, index, displayIndex);
      }}
      style={animDelayMs > 0 ? { animationDelay: `${animDelayMs}ms` } : undefined}
      className={`${animClass} coomer-grid-cell aspect-[3/4] bg-[var(--surface)] overflow-hidden relative active:scale-[0.98] transition-transform duration-150 cursor-pointer select-none tap-highlight-none touch-manipulation contain-layout`}
    >
      {/* Solid background skeleton */}
      <div 
        className={`absolute inset-0 bg-[var(--skeleton-bg)] animate-pulse pointer-events-none transition-opacity duration-300 ease-out ${
          imgLoaded ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ zIndex: 0 }}
      />

      {isVisible && src && !hasError && (
        <img 
          src={src} 
          loading="lazy"
          decoding="async"
          draggable="false"
          referrerPolicy="no-referrer"
          ref={(el) => {
            if (el) {
              if (el.complete && el.naturalWidth > 0) {
                setImgLoaded(true);
              } else if (typeof el.decode === 'function') {
                el.decode().then(() => setImgLoaded(true)).catch(() => {});
              }
            }
          }}
          onError={() => {
            if (!fallbackAttempted && post.urls[displayIndex] && post.urls[displayIndex] !== src) {
              setFallbackAttempted(true);
              setSrc(post.urls[displayIndex]);
            } else if (!cdnFallbackAttempted) {
              const cdnAlt = getCdnFallbackUrl(src);
              if (cdnAlt && cdnAlt !== src) {
                setCdnFallbackAttempted(true);
                setSrc(cdnAlt);
              } else {
                setHasError(true);
                setImgLoaded(true);
              }
            } else {
              setHasError(true);
              setImgLoaded(true);
            }
          }}
          onLoad={() => {
            setImgLoaded(true);
          }}
          className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ease-out ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ zIndex: 1 }}
          alt=""
        />
      )}

      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface)] text-[var(--text-muted)] text-[10px] font-bold z-[2]">
          Failed to load
        </div>
      )}

      {/* Video Indicator */}
      {isVideo && (
        <div className="absolute top-2 right-2 z-10 pointer-events-none flex items-center gap-1 text-white select-none">
          <Icons.Play size={13} className="fill-white text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
          {typeof duration === 'number' && duration > 0 && (
            <span className="text-[10px] font-mono font-medium tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      )}

      {/* Multiple Post Indicator */}
      {post.type === 'Multiple' && !isVideo && (
        <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none drop-shadow-md">
          <div className="relative w-4 h-4">
            {/* Back Layer */}
            <div className="absolute top-0 right-0 w-[13px] h-[13px] border-[1.5px] border-white rounded-[2px] opacity-60" />
            {/* Front Layer */}
            <div className="absolute bottom-0 left-0 w-[13px] h-[13px] bg-white rounded-[2px]" />
          </div>
        </div>
      )}

      {/* Service Source Floating Icon (Fansly / OnlyFans) */}
      {(() => {
        const rawSvc = post.sourceService;
        const firstUrl = post.urls?.[0] || '';
        const isFansly = rawSvc === 'Fansly' || rawSvc === 'fansly' || firstUrl.includes('fansly') || firstUrl.includes('/fa/');
        const isOnlyFans = rawSvc === 'OnlyFans' || rawSvc === 'onlyfans' || firstUrl.includes('onlyfans') || firstUrl.includes('/of/');
        
        if (!isFansly && !isOnlyFans) return null;

        return (
          <div className="absolute bottom-2 left-2 z-10 pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.95)]">
            {isFansly ? (
              <Icons.Fansly size={21} className="text-[#1ea1f3] block" />
            ) : (
              <Icons.OnlyFans size={21} className="text-[#00aff0] block" />
            )}
          </div>
        );
      })()}
    </div>
  );
}, (prev, next) => {
  return (
    prev.index === next.index &&
    prev.mediaFilter === next.mediaFilter &&
    prev.post.id === next.post.id &&
    prev.post.type === next.post.type &&
    prev.post.caption === next.post.caption &&
    (prev.post.urls?.[0] || '') === (next.post.urls?.[0] || '') &&
    (prev.post.thumbUrls?.[0] || '') === (next.post.thumbUrls?.[0] || '') &&
    (prev.post.mediaTypes?.[0] || '') === (next.post.mediaTypes?.[0] || '') &&
    prev.post.sourceService === next.post.sourceService
  );
});

export const CoomerDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, updateCoomer, isHydrated, addNotification } = useApp();

  // Always default strictly to 'all' whenever entering Coomer details
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');

  // Reset to 'all' on every entry or creator id change
  useEffect(() => {
    setMediaFilter('all');
    if (id) {
      delete currentMediaFilterCache[id];
      try {
        sessionStorage.removeItem(`coomer_filter_${id}`);
      } catch {}
    }
    if (searchParams.get('filter')) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('filter');
        return next;
      }, { replace: true });
    }
  }, [id]);

  const [isFilterLoading, setIsFilterLoading] = useState<boolean>(false);
  const filterTimeoutRef = useRef<number | null>(null);
  const [isPageTransitioning, setIsPageTransitioning] = useState<boolean>(false);
  const pageTransitionTimerRef = useRef<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(() => {
    return currentPageCache[id || ''] || 1;
  });
  const [pageStore, setPageStore] = useState<Record<number, CoomerPost[]>>(() => {
    return (id && pageStoreCache[id]) || {};
  });

  const updatePageStore = useCallback((pageNumber: number, pagePosts: CoomerPost[]) => {
    if (!id) return;
    if (!pageStoreCache[id]) {
      pageStoreCache[id] = {};
    }
    pageStoreCache[id][pageNumber] = pagePosts;
    setPageStore(prev => ({
      ...prev,
      [pageNumber]: pagePosts
    }));
    // Persist completed page chunk to IndexedDB in the background
    storage.setItem(`coomer_pages_${id}`, pageStoreCache[id]).catch(() => {});
  }, [id]);

  const [cachedPosts, setCachedPosts] = useState<CoomerPost[]>([]);

  // Restore cached page chunks and posts from IndexedDB on component mount for instant 0ms restoration
  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    
    // 1. Restore page chunks
    storage.getItem(`coomer_pages_${id}`).then((persisted: any) => {
      if (isMounted && persisted && typeof persisted === 'object') {
        if (!pageStoreCache[id]) pageStoreCache[id] = {};
        pageStoreCache[id] = { ...persisted, ...pageStoreCache[id] };
        setPageStore(prev => ({ ...persisted, ...prev }));
      }
    }).catch(() => {});

    // 2. Restore full posts array if not currently in state
    getCachedCoomerPosts(id).then((cached) => {
      if (isMounted && Array.isArray(cached) && cached.length > 0) {
        setCachedPosts(cached);
        if (coomerRef.current && (!coomerRef.current.posts || coomerRef.current.posts.length === 0)) {
          coomerRef.current = {
            ...coomerRef.current,
            posts: cached
          };
        }
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [id]);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsProfileLoaded(false);
  }, [id]);
  const [isLiveFetching, setIsLiveFetching] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ fetched: number; total: number } | null>(null);

  const updateCoomerRef = useRef(updateCoomer);
  updateCoomerRef.current = updateCoomer;

  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  const pageAbortControllerRef = useRef<AbortController | null>(null);
  const migratedIdsRef = useRef<Set<string>>(new Set());

  // Scroll detection to pause background sync state dispatches during active scrolling/swiping
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handleScrollActivity = () => {
      isUserScrollingRef.current = true;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 350);
    };

    window.addEventListener('scroll', handleScrollActivity, { passive: true });
    const scrollContainer = document.getElementById('scroll-area');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScrollActivity, { passive: true });
    }

    return () => {
      window.removeEventListener('scroll', handleScrollActivity);
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScrollActivity);
      }
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  // Pre-flight image cache preloader (decodes first 12-18 images in memory during skeleton phase)
  const predecodeImages = useCallback((targetPosts: CoomerPost[]) => {
    if (typeof window === 'undefined') return;
    const initialBatch = targetPosts.slice(0, 18);
    for (let i = 0; i < initialBatch.length; i++) {
      const p = initialBatch[i];
      const thumb = p.thumbUrls?.[0] || getThumbnailUrl(p.urls[0]) || p.urls[0];
      if (thumb) {
        const img = new Image();
        img.src = thumb;
        if ('decode' in img) {
          img.decode().catch(() => {});
        }
      }
    }
  }, []);

  // Skeleton Loading gate: 400ms standard duration on entry to guarantee smooth layout & predecode
  useEffect(() => {
    setIsLoading(true);
    let isMounted = true;
    const timer = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
        const currentPosts = coomerRef.current?.posts || [];
        if (currentPosts.length > 0) {
          predecodeImages(currentPosts);
        }
      }
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [id, predecodeImages]);

  const coomer = useMemo(() => state.coomers.find(c => c.id === id), [state.coomers, id]);

  // Source URLs for live fetching (primary, secondary, or array)
  const currentSourceUrls = useMemo(() => {
    if (!coomer) return [];
    const list: string[] = [];
    if (coomer.sourceUrls && Array.isArray(coomer.sourceUrls)) {
      list.push(...coomer.sourceUrls);
    }
    if (coomer.sourceUrl && !list.includes(coomer.sourceUrl)) {
      list.push(coomer.sourceUrl);
    }
    if (coomer.secondarySourceUrl && !list.includes(coomer.secondarySourceUrl)) {
      list.push(coomer.secondarySourceUrl);
    }
    if (coomer.onlyFansSourceUrl && !list.includes(coomer.onlyFansSourceUrl)) {
      list.push(coomer.onlyFansSourceUrl);
    }
    if (coomer.instagramSourceUrl && !list.includes(coomer.instagramSourceUrl)) {
      list.push(coomer.instagramSourceUrl);
    }
    return list.filter(Boolean);
  }, [coomer]);

  const currentSourceUrl = currentSourceUrls[0];

  const coomerRef = useRef(coomer);
  useEffect(() => {
    coomerRef.current = coomer;
  }, [coomer]);

  // Speculative prefetch for neighboring page (e.g. Page 2 while user is on Page 1)
  useEffect(() => {
    if (!id || !currentSourceUrl || isLoading) return;

    const nextPage = currentPage + 1;
    const serverTotal = coomerRef.current?.totalPostsCount || 0;
    const maxPages = Math.max(1, Math.ceil(serverTotal / POSTS_PER_PAGE));
    if (nextPage > maxPages) return;

    const startIndex = (nextPage - 1) * POSTS_PER_PAGE;
    const hasCachedDirectPage = pageStoreCache[id]?.[nextPage]?.length >= POSTS_PER_PAGE;
    const existingSlice = (coomerRef.current?.posts || []).slice(startIndex, startIndex + POSTS_PER_PAGE);

    if (hasCachedDirectPage || existingSlice.length >= POSTS_PER_PAGE) return;

    const abortController = new AbortController();
    const prefetchTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/extract/coomer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            url: currentSourceUrl,
            offset: startIndex,
            targetCount: POSTS_PER_PAGE,
            limit: 50
          })
        });
        if (abortController.signal.aborted) return;
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.groupedPosts)) {
            const formatted: CoomerPost[] = data.groupedPosts.map((gp: any) => {
              const postTime = typeof gp.date === 'number' && !isNaN(gp.date) ? gp.date : Date.now();
              return {
                id: gp.postId ? String(gp.postId) : Math.random().toString(36).substr(2, 9),
                urls: gp.urls || [],
                thumbUrls: gp.thumbUrls || gp.urls?.map((u: string) => getThumbnailUrl(u)) || [],
                caption: gp.caption || '',
                mediaTypes: gp.mediaTypes || [],
                videoDurations: gp.videoDurations || [],
                perImageDates: (gp.urls || []).map(() => postTime),
                date: postTime,
                type: (gp.urls || []).length > 1 ? 'Multiple' : 'Single',
                createdAt: postTime
              };
            });
            if (formatted.length > 0) {
              if (!pageStoreCache[id]) pageStoreCache[id] = {};
              pageStoreCache[id][nextPage] = formatted;
              predecodeImages(formatted.slice(0, 12));
            }
          }
        }
      } catch (err) {
        // silent fail on speculative prefetch
      }
    }, 1200);

    return () => {
      clearTimeout(prefetchTimer);
      abortController.abort();
    };
  }, [currentPage, id, currentSourceUrl, isLoading, predecodeImages]);

  useEffect(() => {
    if (id) {
      currentPageCache[id] = currentPage;
    }
  }, [currentPage, id]);

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('restore-scroll'));
    });
  }, [location.pathname]);

  // Helper to deduplicate, merge and store extracted posts
  const mergeExtractedGroupedPosts = useCallback((groupedPosts: any[], serverTotal?: number) => {
    const latestCoomer = coomerRef.current;
    if (!latestCoomer) return 0;

    const existingPosts: CoomerPost[] = [
      ...(latestCoomer.posts || []),
      ...(latestCoomer.instagramPosts || []),
      ...(latestCoomer.onlyFansPosts || [])
    ];
    const existingPostIds = new Set(existingPosts.map(p => String(p.id)));
    const existingUrls = new Set(existingPosts.flatMap(p => p.urls));

    const newPosts: CoomerPost[] = [];
    let hasUpdatedExistingCaptions = false;

    for (const gp of groupedPosts) {
      const pid = gp.postId ? String(gp.postId) : Math.random().toString(36).substr(2, 9);
      
      // Backfill caption and mediaTypes on existing posts if previously missing
      if (existingPostIds.has(pid)) {
        const exPost = existingPosts.find(p => String(p.id) === pid);
        if (exPost) {
          let changed = false;
          if (gp.caption && !exPost.caption) {
            exPost.caption = gp.caption;
            changed = true;
          }
          if (gp.mediaTypes && (!exPost.mediaTypes || exPost.mediaTypes.length === 0)) {
            exPost.mediaTypes = gp.mediaTypes;
            changed = true;
          }
          if (gp.videoDurations && (!exPost.videoDurations || exPost.videoDurations.length === 0)) {
            exPost.videoDurations = gp.videoDurations;
            changed = true;
          }
          if (changed) hasUpdatedExistingCaptions = true;
        }
        continue;
      }

      const freshUrls: string[] = [];
      const freshThumbs: string[] = [];
      const freshMediaTypes: ('image' | 'video')[] = [];
      const freshDurations: (number | undefined)[] = [];

      (gp.urls || []).forEach((u: string, uIdx: number) => {
        if (!existingUrls.has(u)) {
          freshUrls.push(u);
          freshThumbs.push(gp.thumbUrls?.[uIdx] || getThumbnailUrl(u));
          freshMediaTypes.push(gp.mediaTypes?.[uIdx] || (/\.(mp4|webm|mov)($|\?)/i.test(u) ? 'video' : 'image'));
          freshDurations.push(gp.videoDurations?.[uIdx]);
          existingUrls.add(u);
        }
      });

      if (freshUrls.length === 0) continue;
      existingPostIds.add(pid);

      const postTime = typeof gp.date === 'number' && !isNaN(gp.date) ? gp.date : Date.now();
      newPosts.push({
        id: pid,
        urls: freshUrls,
        thumbUrls: freshThumbs,
        caption: gp.caption || '',
        mediaTypes: freshMediaTypes,
        videoDurations: freshDurations,
        perImageDates: freshUrls.map(() => postTime),
        date: postTime,
        type: freshUrls.length > 1 ? 'Multiple' : 'Single',
        sourceService: gp.service,
        createdAt: postTime
      });
    }

    const currentTotal = typeof serverTotal === 'number' && serverTotal > 0 ? serverTotal : (latestCoomer.totalPostsCount || (existingPosts.length + newPosts.length));

    if (newPosts.length > 0 || hasUpdatedExistingCaptions || (serverTotal && serverTotal !== latestCoomer.totalPostsCount)) {
      const updated = [...existingPosts, ...newPosts].sort((a, b) => (b.date || b.createdAt || 0) - (a.date || a.createdAt || 0));
      const updatePayload: any = { 
        posts: updated,
        totalPostsCount: currentTotal,
        instagramPosts: [],
        onlyFansPosts: []
      };
      if ((!latestCoomer.imageUrl || latestCoomer.imageUrl.includes('ui-avatars.com')) && (groupedPosts[0]?.thumbUrls?.[0] || groupedPosts[0]?.urls?.[0])) {
        updatePayload.imageUrl = groupedPosts[0]?.thumbUrls?.[0] || groupedPosts[0]?.urls?.[0];
        updatePayload.originalImageUrl = groupedPosts[0]?.urls?.[0];
      }
      updateCoomerRef.current(latestCoomer.id, updatePayload);
      coomerRef.current = { ...latestCoomer, ...updatePayload };
    }

    return newPosts.length;
  }, []);

  // Progressive Sequential Background Queue with smooth batching
  const syncLiveProgressively = useCallback(async (force: boolean = false, signal?: AbortSignal) => {
    const currentCoomer = coomerRef.current;
    if (!currentCoomer || currentSourceUrls.length === 0) return;

    const cacheKey = `${currentCoomer.id}-v5-multisync`;
    const cached = onDemandCache[cacheKey];

    const isFullySynced = currentCoomer.totalPostsCount && (currentCoomer.posts?.length || 0) >= currentCoomer.totalPostsCount;
    if (cached && isFullySynced && !force && Date.now() - cached.timestamp < 300000) {
      return;
    }

    setIsLiveFetching(true);

    try {
      let totalNewPostsCount = 0;

      for (let sIdx = 0; sIdx < currentSourceUrls.length; sIdx++) {
        if (signal?.aborted) break;
        const targetUrl = currentSourceUrls[sIdx];

        let page = 1;
        let totalPages = 1;
        let serverTotal = currentCoomer.totalPostsCount || 0;
        let pendingBatches: any[] = [];

        while (page <= totalPages && !signal?.aborted) {
          let data: any = null;
          let attempts = 0;
          const maxAttempts = 2;

          while (attempts < maxAttempts && !signal?.aborted) {
            attempts++;
            const pageController = new AbortController();
            const pageTimeout = setTimeout(() => pageController.abort(), 15000);
            
            const onParentAbort = () => pageController.abort();
            if (signal) signal.addEventListener('abort', onParentAbort);

            try {
              const res = await fetch('/api/extract/coomer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: targetUrl,
                  page,
                  limit: 50
                }),
                signal: pageController.signal
              });
              if (res.ok) {
                data = await res.json();
                break;
              }
              if (res.status === 429 && attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 800));
              }
            } catch (err: any) {
              if (signal?.aborted) break;
              if (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 600));
              } else {
                console.warn(`[Sync Queue] Notice fetching page ${page}:`, err);
              }
            } finally {
              clearTimeout(pageTimeout);
              if (signal) signal.removeEventListener('abort', onParentAbort);
            }
          }

          if (signal?.aborted) break;
          if (!data || !data.success || !Array.isArray(data.groupedPosts)) {
            break;
          }

          // Only terminate if server explicitly returns 0 raw posts or indicates no more items
          if ((typeof data.rawCount === 'number' && data.rawCount === 0) || (data.groupedPosts.length === 0 && (data.hasMore === false || page >= totalPages))) {
            break;
          }

          if (typeof data.total === 'number' && data.total > 0) {
            serverTotal = data.total;
            totalPages = Math.min(50, Math.ceil(data.total / 50));
          }

          if (data.groupedPosts.length > 0) {
            pendingBatches.push(...data.groupedPosts);
          }

          // Wait if user is currently scrolling so that state merges never interrupt touch scrolling
          while (isUserScrollingRef.current && !signal?.aborted) {
            await new Promise(r => setTimeout(r, 120));
          }

          const isLastPageBatch = data.hasMore === false || (typeof data.rawCount === 'number' && data.rawCount < 50) || page >= totalPages;

          // Apply on initial page (page 1) immediately for fast content, then batch every 3 pages or upon completion to avoid locking scroll thread
          if (page === 1 || page % 3 === 0 || isLastPageBatch) {
            const newCount = mergeExtractedGroupedPosts(pendingBatches, serverTotal);
            totalNewPostsCount += newCount;
            pendingBatches = [];

            const currentTotalLoaded = coomerRef.current?.posts?.length || 0;
            setSyncStatus({ fetched: currentTotalLoaded, total: serverTotal || currentTotalLoaded });
          }

          if (isLastPageBatch) {
            break;
          }

          page++;

          if (page <= totalPages && !signal?.aborted) {
            // Yield to browser UI thread and wait for idle period (avoids frame drops on 60Hz/120Hz screens)
            await new Promise(r => {
              if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                (window as any).requestIdleCallback(r, { timeout: 350 });
              } else {
                setTimeout(r, 250);
              }
            });
          }
        }

        // Flush any remaining batch from this source
        if (pendingBatches.length > 0 && !signal?.aborted) {
          const newCount = mergeExtractedGroupedPosts(pendingBatches, serverTotal);
          totalNewPostsCount += newCount;
        }
      }

      // When sync finishes the full creator profile, record exact media posts count and isFullySynced
      if (!signal?.aborted) {
        const finalPosts = coomerRef.current?.posts || [];
        const finalCount = finalPosts.length;
        if (finalCount > 0 && currentCoomer) {
          updateCoomerRef.current(currentCoomer.id, {
            posts: finalPosts,
            totalPostsCount: finalCount,
            isFullySynced: true
          });
        }
      }

      onDemandCache[cacheKey] = {
        posts: [],
        total: totalNewPostsCount,
        timestamp: Date.now()
      };

      if (totalNewPostsCount > 0 && !signal?.aborted) {
        addNotificationRef.current?.(`Synced ${totalNewPostsCount} new posts successfully across sources`, 'success');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[Sync Queue] Notice:', err.message || err);
      }
    } finally {
      setIsLiveFetching(false);
      setSyncStatus(null);
    }
  }, [currentSourceUrls, mergeExtractedGroupedPosts]);

  // Trigger live on-demand fetch on mount or source change with clean abort controller
  useEffect(() => {
    if (!currentSourceUrl || !id) return;
    const controller = new AbortController();
    syncLiveProgressively(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [currentSourceUrl, id, syncLiveProgressively]);

  const posts = useMemo(() => {
    if (!coomer) return [];
    const sourcePosts = (coomer.posts && coomer.posts.length > 0) ? coomer.posts : cachedPosts;
    const rawPosts = [
      ...sourcePosts,
      ...(coomer.instagramPosts || []),
      ...(coomer.onlyFansPosts || [])
    ];
    
    const seenPostIds = new Set<string>();
    const uniquePosts: CoomerPost[] = [];

    for (const p of rawPosts) {
      const uniqueKey = p.id ? String(p.id) : (p.urls && p.urls.length > 0 ? p.urls.join('|') : Math.random().toString(36).substr(2, 9));
      if (!seenPostIds.has(uniqueKey)) {
        seenPostIds.add(uniqueKey);
        uniquePosts.push(p);
      }
    }

    return uniquePosts.sort((a, b) => {
      const dateA = Number(a.date || a.createdAt || 0);
      const safeDateA = isNaN(dateA) ? 0 : dateA;
      const dateB = Number(b.date || b.createdAt || 0);
      const safeDateB = isNaN(dateB) ? 0 : dateB;
      return safeDateB - safeDateA;
    });
  }, [coomer, cachedPosts]);

  const isVideoPost = useCallback((p: CoomerPost) => {
    return Boolean(
      p.mediaTypes?.includes('video') ||
      p.urls.some(u => /\.(mp4|webm|mov)($|\?)/i.test(u))
    );
  }, []);

  const isPicturePost = useCallback((p: CoomerPost) => {
    const hasImageExt = p.urls.some(u => !/\.(mp4|webm|mov)($|\?)/i.test(u));
    const hasImageMediaType = p.mediaTypes?.includes('image');
    const isNotExclusivelyVideo = !p.mediaTypes || p.mediaTypes.length === 0 || p.mediaTypes.some(t => t === 'image');
    return Boolean(hasImageMediaType || hasImageExt || isNotExclusivelyVideo);
  }, []);

  const filteredPosts = useMemo(() => {
    if (mediaFilter === 'pictures') return posts.filter(isPicturePost);
    if (mediaFilter === 'video') return posts.filter(isVideoPost);
    return posts;
  }, [posts, mediaFilter, isPicturePost, isVideoPost]);

  const serverTotalPosts = coomer?.totalPostsCount || 0;
  // If profile is fully synced or all media posts have been gathered, use posts.length directly to eliminate phantom empty pages
  const isProfileComplete = Boolean(
    coomer?.isFullySynced || 
    (posts.length > 0 && !isLiveFetching && serverTotalPosts > 0 && (posts.length >= serverTotalPosts || Math.abs(serverTotalPosts - posts.length) <= 50))
  );
  const baseTotalPosts = isProfileComplete ? posts.length : Math.max(posts.length, serverTotalPosts);
  const effectiveTotalPosts = mediaFilter === 'all' ? baseTotalPosts : filteredPosts.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotalPosts / POSTS_PER_PAGE));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  // Cleanup filter timeout on unmount
  useEffect(() => {
    return () => {
      if (filterTimeoutRef.current) {
        clearTimeout(filterTimeoutRef.current);
      }
    };
  }, []);

  const handleFilterChange = useCallback((newFilter: MediaFilter) => {
    if (newFilter === mediaFilter && !isFilterLoading) return;

    // Trigger skeleton loading immediately to provide visual feedback and allow smooth DOM restructuring
    setIsFilterLoading(true);
    setMediaFilter(newFilter);
    setCurrentPage(1);

    const scrollContainer = document.getElementById('scroll-area');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    if (filterTimeoutRef.current) {
      clearTimeout(filterTimeoutRef.current);
    }

    filterTimeoutRef.current = window.setTimeout(() => {
      setIsFilterLoading(false);
      filterTimeoutRef.current = null;
    }, 280);
  }, [mediaFilter, isFilterLoading]);

  const paginatedPosts = useMemo(() => {
    if (mediaFilter !== 'all') {
      const startIndex = (safeCurrentPage - 1) * POSTS_PER_PAGE;
      return filteredPosts.slice(startIndex, startIndex + POSTS_PER_PAGE);
    }

    const isLastPage = safeCurrentPage === totalPages;
    const startIndex = (safeCurrentPage - 1) * POSTS_PER_PAGE;
    const sequentialSlice = posts.slice(startIndex, startIndex + POSTS_PER_PAGE);

    // 1. If sequential slice has full 54 items, use it
    if (sequentialSlice.length >= POSTS_PER_PAGE || (isLastPage && sequentialSlice.length > 0)) {
      return sequentialSlice;
    }

    // 2. If direct pageStore has 54 items, use it
    if (pageStore[safeCurrentPage] && (pageStore[safeCurrentPage].length >= POSTS_PER_PAGE || isLastPage)) {
      return pageStore[safeCurrentPage];
    }

    // 3. Fallback: combine existing pageStore and sequential slice with deduplication
    const map = new Map<string, CoomerPost>();
    (pageStore[safeCurrentPage] || []).forEach(p => {
      const key = p.id || (p.urls && p.urls[0]);
      if (key) map.set(key, p);
    });
    sequentialSlice.forEach(p => {
      const key = p.id || (p.urls && p.urls[0]);
      if (key) map.set(key, p);
    });

    return Array.from(map.values()).slice(0, POSTS_PER_PAGE);
  }, [mediaFilter, filteredPosts, posts, safeCurrentPage, totalPages, pageStore]);

  // Cleanup in-flight page change requests and transition timers on unmount
  useEffect(() => {
    return () => {
      if (pageAbortControllerRef.current) {
        pageAbortControllerRef.current.abort();
        pageAbortControllerRef.current = null;
      }
      if (pageTransitionTimerRef.current) {
        clearTimeout(pageTransitionTimerRef.current);
        pageTransitionTimerRef.current = null;
      }
    };
  }, []);

  const handlePageChange = useCallback(async (newPage: number) => {
    if (newPage === safeCurrentPage) return;

    // Start transition immediately and exploit the effect duration to process & predecode images
    setIsPageTransitioning(true);
    setCurrentPage(newPage);

    const scrollContainer = document.getElementById('scroll-area');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    // Exploit transition window: proactively grab target page posts and predecode thumbnails in browser memory
    const startIndex = (newPage - 1) * POSTS_PER_PAGE;
    const targetEndIndex = startIndex + POSTS_PER_PAGE;
    const currentPosts = coomerRef.current?.posts || [];
    const directCached = pageStoreCache[id || '']?.[newPage];
    const targetSlice = directCached || currentPosts.slice(startIndex, targetEndIndex);
    if (targetSlice && targetSlice.length > 0) {
      predecodeImages(targetSlice.slice(0, 24));
    }

    if (pageTransitionTimerRef.current) {
      clearTimeout(pageTransitionTimerRef.current);
    }
    pageTransitionTimerRef.current = window.setTimeout(() => {
      setIsPageTransitioning(false);
      pageTransitionTimerRef.current = null;
    }, 220);

    if (mediaFilter !== 'all') {
      return;
    }

    if (pageAbortControllerRef.current) {
      pageAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    pageAbortControllerRef.current = controller;

    const currentPostsCount = currentPosts.length;
    const existingPageSlice = currentPosts.slice(startIndex, targetEndIndex);

    // If target page items have not been fully loaded in memory/pageStore:
    const hasCachedDirectPage = pageStoreCache[id || '']?.[newPage]?.length >= Math.min(POSTS_PER_PAGE, (coomerRef.current?.totalPostsCount || POSTS_PER_PAGE) - startIndex);
    const hasSufficientSequentialSlice = existingPageSlice.length >= POSTS_PER_PAGE || (currentPostsCount >= (coomerRef.current?.totalPostsCount || 0) && existingPageSlice.length > 0);

    if (!hasCachedDirectPage && !hasSufficientSequentialSlice && currentSourceUrl) {
      try {
        // Query API with exact offset and targetCount: 54
        const res = await fetch('/api/extract/coomer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: currentSourceUrl,
            offset: startIndex,
            targetCount: POSTS_PER_PAGE,
            limit: 50
          }),
          signal: controller.signal
        });

        if (res.ok && !controller.signal.aborted) {
          const data = await res.json();
          if (data.success && Array.isArray(data.groupedPosts) && !controller.signal.aborted) {
            mergeExtractedGroupedPosts(data.groupedPosts, data.total);
            
            // Format fresh posts for direct page caching
            const formattedPagePosts: CoomerPost[] = data.groupedPosts.map((gp: any) => {
              const postTime = typeof gp.date === 'number' && !isNaN(gp.date) ? gp.date : Date.now();
              return {
                id: gp.postId ? String(gp.postId) : Math.random().toString(36).substr(2, 9),
                urls: gp.urls || [],
                thumbUrls: gp.thumbUrls || gp.urls?.map((u: string) => getThumbnailUrl(u)) || [],
                caption: gp.caption || '',
                mediaTypes: gp.mediaTypes || [],
                videoDurations: gp.videoDurations || [],
                perImageDates: (gp.urls || []).map(() => postTime),
                date: postTime,
                type: (gp.urls || []).length > 1 ? 'Multiple' : 'Single',
                createdAt: postTime
              };
            });

            if (formattedPagePosts.length > 0) {
              updatePageStore(newPage, formattedPagePosts);
              predecodeImages(formattedPagePosts.slice(0, 18));
            } else if (data.hasMore === false || (typeof data.rawCount === 'number' && data.rawCount === 0) || data.groupedPosts.length === 0) {
              // Reached the true end of the creator's media feed! Align page to actual last page
              const actualTotal = coomerRef.current?.posts?.length || currentPostsCount;
              if (actualTotal > 0) {
                const actualMaxPage = Math.max(1, Math.ceil(actualTotal / POSTS_PER_PAGE));
                if (newPage > actualMaxPage) {
                  setCurrentPage(actualMaxPage);
                }
              }
            }
          }
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.warn('Failed on-demand page fetch:', e);
        }
      }
    }
  }, [safeCurrentPage, id, currentSourceUrl, mediaFilter, predecodeImages, mergeExtractedGroupedPosts, updatePageStore]);

  // Automatic migration logic to consolidate legacy instagram/onlyfans links into unified posts safely
  useEffect(() => {
    if (!coomer || migratedIdsRef.current.has(coomer.id)) return;

    if (coomer.instagramLinks?.length || coomer.onlyFansLinks?.length || coomer.instagramPosts?.length || coomer.onlyFansPosts?.length) {
      migratedIdsRef.current.add(coomer.id);
      const updates: any = {};
      const consolidatedPosts = [...(coomer.posts || [])];

      if (coomer.instagramPosts?.length) {
        consolidatedPosts.push(...coomer.instagramPosts);
        updates.instagramPosts = [];
      }
      if (coomer.onlyFansPosts?.length) {
        consolidatedPosts.push(...coomer.onlyFansPosts);
        updates.onlyFansPosts = [];
      }
      
      if (coomer.instagramLinks?.length) {
        (coomer.instagramLinks || []).forEach(url => {
          consolidatedPosts.push({
            id: Math.random().toString(36).substr(2, 9),
            urls: [url],
            type: 'Single',
            createdAt: Date.now()
          });
        });
        updates.instagramLinks = [];
      }

      if (coomer.onlyFansLinks?.length) {
        (coomer.onlyFansLinks || []).forEach(url => {
          consolidatedPosts.push({
            id: Math.random().toString(36).substr(2, 9),
            urls: [url],
            type: 'Single',
            createdAt: Date.now()
          });
        });
        updates.onlyFansLinks = [];
      }

      if (coomer.onlyFansSourceUrl && !coomer.sourceUrl) {
        updates.sourceUrl = coomer.onlyFansSourceUrl;
      } else if (coomer.instagramSourceUrl && !coomer.sourceUrl) {
        updates.sourceUrl = coomer.instagramSourceUrl;
      }

      if (consolidatedPosts.length !== (coomer.posts || []).length || Object.keys(updates).length > 0) {
        updates.posts = consolidatedPosts;
        updateCoomer(coomer.id, updates);
      }
    }
  }, [coomer, updateCoomer]);

  const handlePostClick = useCallback((post: CoomerPost, indexInPage: number, imageIndex: number) => {
    const globalPostIndex = (safeCurrentPage - 1) * POSTS_PER_PAGE + indexInPage;
    const targetUrl = post.urls[imageIndex] || post.urls[0] || '';
    const targetThumbUrl = post.thumbUrls?.[imageIndex] || getThumbnailUrl(targetUrl) || post.thumbUrls?.[0] || '';
    const postId = post.id || '';
    
    // Construct clean return path
    const fromUrl = location.pathname;

    navigate(
      `/coomer/${id}/media/${globalPostIndex}?img=${imageIndex}&postId=${encodeURIComponent(postId)}`, 
      { 
        state: { 
          from: fromUrl, 
          returnState: { ...(location.state || {}) },
          targetPost: post,
          targetPostId: postId,
          targetUrl,
          targetThumbUrl,
          pagePosts: paginatedPosts,
          currentPage: safeCurrentPage
        } 
      }
    );
  }, [navigate, id, safeCurrentPage, location.pathname, location.state, paginatedPosts]);

  const handlePostLongPress = useCallback((postId: string) => {
    navigate(`/coomer/${id}/add-socials/${postId}`, { state: { from: location.pathname + location.search, returnState: location.state } });
  }, [navigate, id, location.state]);

  const syncTargetPage = useCallback(async (targetPage: number, showNotif: boolean = true) => {
    if (!currentSourceUrl || !id) return false;

    const startIndex = (targetPage - 1) * POSTS_PER_PAGE;

    // Invalidate cached page store for this page to force a clean full fetch
    if (pageStoreCache[id]) {
      delete pageStoreCache[id][targetPage];
    }
    setPageStore(prev => {
      const copy = { ...prev };
      delete copy[targetPage];
      return copy;
    });

    setIsLiveFetching(true);
    if (showNotif) {
      addNotification(`Syncing page ${targetPage}...`, 'info');
    }

    try {
      const res = await fetch('/api/extract/coomer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentSourceUrl,
          offset: startIndex,
          targetCount: POSTS_PER_PAGE,
          limit: 50
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.groupedPosts)) {
          mergeExtractedGroupedPosts(data.groupedPosts, data.total);

          const formattedPagePosts: CoomerPost[] = data.groupedPosts.map((gp: any) => {
            const postTime = typeof gp.date === 'number' && !isNaN(gp.date) ? gp.date : Date.now();
            return {
              id: gp.postId ? String(gp.postId) : Math.random().toString(36).substr(2, 9),
              urls: gp.urls || [],
              thumbUrls: gp.thumbUrls || gp.urls?.map((u: string) => getThumbnailUrl(u)) || [],
              caption: gp.caption || '',
              mediaTypes: gp.mediaTypes || [],
              videoDurations: gp.videoDurations || [],
              perImageDates: (gp.urls || []).map(() => postTime),
              date: postTime,
              type: (gp.urls || []).length > 1 ? 'Multiple' : 'Single',
              createdAt: postTime
            };
          });

          if (formattedPagePosts.length > 0) {
            updatePageStore(targetPage, formattedPagePosts);
            predecodeImages(formattedPagePosts.slice(0, 15));
            if (showNotif) {
              addNotification(`Page ${targetPage} synced successfully (${formattedPagePosts.length} posts)!`, 'success');
            }
            return true;
          } else if (data.hasMore === false || (typeof data.rawCount === 'number' && data.rawCount === 0) || data.groupedPosts.length === 0) {
            // Target page is beyond the actual posts; align to true last page
            const actualTotal = coomerRef.current?.posts?.length || 0;
            if (actualTotal > 0) {
              const actualMaxPage = Math.max(1, Math.ceil(actualTotal / POSTS_PER_PAGE));
              if (targetPage > actualMaxPage) {
                setCurrentPage(actualMaxPage);
              }
              if (showNotif) {
                addNotification(`Reached end of posts (Page ${actualMaxPage})`, 'info');
              }
            }
            return true;
          }
        }
      }
    } catch (e: any) {
      console.warn(`Failed direct sync for page ${targetPage}:`, e);
      if (showNotif) {
        addNotification(`Failed to sync page ${targetPage}, please try again`, 'error');
      }
    } finally {
      setIsLiveFetching(false);
    }
    return false;
  }, [currentSourceUrl, id, mergeExtractedGroupedPosts, updatePageStore, predecodeImages, addNotification]);

  const handleManualSync = useCallback(async () => {
    if (isLiveFetching) {
      addNotification('Sync is already running in background...', 'info');
      return;
    }

    if (id) {
      delete onDemandCache[`${id}-v4-sync`];
    }

    // Check if current page is incomplete or user is on a specific page > 1
    const isCurrentPageIncomplete = paginatedPosts.length < POSTS_PER_PAGE && (safeCurrentPage < totalPages || paginatedPosts.length === 0);

    if (safeCurrentPage > 1 || isCurrentPageIncomplete) {
      // Prioritize immediate completion of active page first
      const success = await syncTargetPage(safeCurrentPage, true);
      // Then kick off background sync progressively
      setTimeout(() => {
        syncLiveProgressively(true);
      }, 800);
    } else {
      addNotification('Starting post synchronization...', 'info');
      syncLiveProgressively(true);
    }
  }, [isLiveFetching, id, safeCurrentPage, totalPages, paginatedPosts.length, syncTargetPage, syncLiveProgressively, addNotification]);

  // Auto-complete incomplete pages when user is viewing them
  useEffect(() => {
    if (!isHydrated || isLoading || isLiveFetching || !currentSourceUrl) return;
    const isIntermediateIncomplete = safeCurrentPage < totalPages && paginatedPosts.length < POSTS_PER_PAGE;
    const isLastPageEmpty = safeCurrentPage === totalPages && paginatedPosts.length === 0 && posts.length < effectiveTotalPosts;

    if (safeCurrentPage > 1 && (isIntermediateIncomplete || isLastPageEmpty)) {
      const timer = setTimeout(() => {
        syncTargetPage(safeCurrentPage, false);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [safeCurrentPage, paginatedPosts.length, totalPages, isHydrated, isLoading, isLiveFetching, currentSourceUrl, syncTargetPage, posts.length, effectiveTotalPosts]);

  // Synchronize with top fixed header button
  useEffect(() => {
    const handleTrigger = () => {
      handleManualSync();
    };
    window.addEventListener('coomer-sync-trigger', handleTrigger);
    return () => window.removeEventListener('coomer-sync-trigger', handleTrigger);
  }, [handleManualSync]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('coomer-sync-status', {
      detail: { isSyncing: isLiveFetching, count: posts.length, total: syncStatus?.total }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('coomer-sync-status', { detail: { isSyncing: false } }));
    };
  }, [isLiveFetching, posts.length, syncStatus?.total]);

  if (!isHydrated) return null;

  if (!coomer) {
    const fallbackPath = (location.state as any)?.from || '/manage-coomers';
    return <Navigate to={fallbackPath} replace state={(location.state as any)?.returnState} />;
  }

  const imgSrc = coomer.originalImageUrl || coomer.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(coomer.name)}&background=random`;

  return (
    <div className="max-w-2xl mx-auto flex flex-col pb-0 animate-fade-in-fast relative">
      {/* Header Profile Section */}
      <div className="flex flex-col items-center pt-3 animate-fade-in-fast">
        <div 
          className="w-24 h-24 rounded-full border-[3px] overflow-hidden bg-[var(--skeleton-bg)] shadow-2xl relative ring-4 ring-black/20 transition-colors duration-500 contain-layout"
          style={{ borderColor: state.settings.circleBorderColor }}
        >
          <img 
            src={imgSrc} 
            className={`w-full h-full object-cover relative z-0 transition-opacity duration-300 ease-out ${
              (!isLoading && isProfileLoaded) ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              objectPosition: `${coomer.imagePositionX ?? 50}% ${coomer.imagePositionY ?? 50}%`,
              transform: `scale(${coomer.imageZoom || 1})`,
              transformOrigin: `${coomer.imagePositionX ?? 50}% ${coomer.imagePositionY ?? 50}%`
            }}
            alt={coomer.name}
            referrerPolicy="no-referrer"
            ref={(el) => {
              if (el && el.complete && el.naturalWidth > 0 && !isProfileLoaded) {
                setIsProfileLoaded(true);
              }
            }}
            onLoad={() => setIsProfileLoaded(true)}
            onError={() => { setIsProfileLoaded(true); }}
          />
          <div 
            className={`absolute inset-0 bg-[var(--skeleton-bg)] pointer-events-none transition-opacity duration-300 ease-out z-10 ${
              (!isLoading && isProfileLoaded) ? 'opacity-0' : 'opacity-100 animate-pulse'
            }`} 
          />
        </div>
        <h1 
          onClick={() => {
            if (isLoading || hasActiveTextSelection()) return;
            copyTextToClipboard(coomer.name, {
              successMessage: `Copied "${coomer.name}" to clipboard!`,
              errorMessage: 'Failed to copy creator name'
            });
          }}
          title={isLoading ? undefined : "Click to copy name"}
          className="mt-3 h-[38px] flex items-center justify-center text-[20px] font-black tracking-tight text-[var(--text-primary)] leading-[30px] cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity select-text relative"
        >
          {isLoading ? (
            <div className="w-36 h-[20px] rounded-full bg-[var(--skeleton-bg)] animate-pulse transition-colors duration-500" />
          ) : (
            <span className="animate-fade-in-fast">{coomer.name}</span>
          )}
        </h1>
      </div>

      {/* Media Type Filter Tabs (All, Pictures, Video) */}
      <div className="w-full mt-3 border-b border-[var(--border)] grid grid-cols-3 gap-[2px] h-11 select-none relative">
        <button
          type="button"
          onClick={() => handleFilterChange('all')}
          className={`w-full h-full flex items-center justify-center text-[13.5px] font-bold tracking-wide transition-colors relative tap-highlight-none ${
            mediaFilter === 'all'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-70 hover:opacity-100'
          }`}
        >
          <span>All</span>
          {mediaFilter === 'all' && (
            <div 
              className="absolute bottom-0 inset-x-0 h-[2.5px] z-10"
              style={{ backgroundColor: state.settings.accentColor || 'var(--accent)' }}
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => handleFilterChange('pictures')}
          className={`w-full h-full flex items-center justify-center text-[13.5px] font-bold tracking-wide transition-colors relative tap-highlight-none ${
            mediaFilter === 'pictures'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-70 hover:opacity-100'
          }`}
        >
          <span>Pictures</span>
          {mediaFilter === 'pictures' && (
            <div 
              className="absolute bottom-0 inset-x-0 h-[2.5px] z-10"
              style={{ backgroundColor: state.settings.accentColor || 'var(--accent)' }}
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => handleFilterChange('video')}
          className={`w-full h-full flex items-center justify-center text-[13.5px] font-bold tracking-wide transition-colors relative tap-highlight-none ${
            mediaFilter === 'video'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-70 hover:opacity-100'
          }`}
        >
          <span>Video</span>
          {mediaFilter === 'video' && (
            <div 
              className="absolute bottom-0 inset-x-0 h-[2.5px] z-10"
              style={{ backgroundColor: state.settings.accentColor || 'var(--accent)' }}
            />
          )}
        </button>
      </div>

      {/* Media Grid Section (54 Grids per Page) */}
      <div className="pt-[2px]">
        {isLoading || isFilterLoading || (isLiveFetching && posts.length === 0) ? (
          <SkeletonCoomerGrid count={POSTS_PER_PAGE} />
        ) : paginatedPosts.length > 0 ? (
          <div 
            key={`grid-page-${safeCurrentPage}`}
            className={`grid grid-cols-3 gap-[2px] contain-layout animate-fade-in-fast transition-opacity duration-200 ${
              isPageTransitioning ? 'opacity-70' : 'opacity-100'
            }`}
          >
            {paginatedPosts.map((post, idx) => (
              <PostCard 
                key={post.id || (post.urls && post.urls[0]) || `post-${idx}`} 
                post={post} 
                index={idx}
                mediaFilter={mediaFilter}
                onClick={handlePostClick} 
                onLongPress={handlePostLongPress}
              />
            ))}
            {/* Clean subtle end-of-posts marker on the actual last page */}
            {safeCurrentPage === totalPages && paginatedPosts.length > 0 && (
              <div className="col-span-3 py-6 flex items-center justify-center gap-2 text-[var(--text-muted)] opacity-50 select-none">
                <span className="w-8 h-[1px] bg-[var(--border)]" />
                <span className="text-[11px] font-medium tracking-wider">End of Posts</span>
                <span className="w-8 h-[1px] bg-[var(--border)]" />
              </div>
            )}
          </div>
        ) : (
          <div className="py-20 flex flex-col items-center justify-center text-[var(--text-muted)] animate-fade-in-fast">
            {isLiveFetching ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                <span className="text-[12px] font-medium opacity-60">Loading page {safeCurrentPage}...</span>
              </div>
            ) : (
              <>
                <div className="mb-4 scale-150 opacity-30">
                  <Icons.Coomer />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">No Media Found</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom Pagination Bar */}
      {totalPages > 1 && (
        <PaginationBar
          currentPage={safeCurrentPage}
          totalLinks={effectiveTotalPosts}
          itemsPerPage={POSTS_PER_PAGE}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
};

