
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useApp } from '../AppContext';
import { Icons, THEME_CONFIGS } from '../constants';
import { CoomerPost } from '../types';
import { getOriginalUrl, getThumbnailUrl, getCdnFallbackUrl } from '../utils/image';
import { pageStoreCache, MediaFilter } from './CoomerDetail';

const CompactIcon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 20 }) => (
  <div style={{ transform: `scale(${size / 24})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

const hexToRgba = (hex: string, opacity: number) => {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return `rgba(255, 255, 255, ${opacity / 100})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

interface CoomerImageItem {
  url: string;
  originalUrl: string;
  fallbackUrls: string[];
  thumbnail?: string;
  caption?: string;
  mediaType?: 'image' | 'video';
  duration?: number;
  postId?: string;
  postIndex?: number;
  subIndex?: number;
}

export const CoomerImageViewer: React.FC = () => {
  const { id, tab, index } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const queryParams = new URLSearchParams(location.search);
  const imgParam = queryParams.get('img');
  const initialImgIndex = parseInt(imgParam || '0');
  const initialPostIndex = parseInt(index || '0');

  const coomer = state.coomers.find(c => c.id === id);
  const locationState = location.state as any;

  const activeFilter: MediaFilter = useMemo(() => {
    const queryFilter = queryParams.get('filter') as MediaFilter | null;
    if (queryFilter && (queryFilter === 'all' || queryFilter === 'pictures' || queryFilter === 'video')) {
      return queryFilter;
    }
    if (locationState?.mediaFilter && (locationState.mediaFilter === 'all' || locationState.mediaFilter === 'pictures' || locationState.mediaFilter === 'video')) {
      return locationState.mediaFilter;
    }
    if (id) {
      try {
        const saved = sessionStorage.getItem(`coomer_filter_${id}`) as MediaFilter | null;
        if (saved && (saved === 'all' || saved === 'pictures' || saved === 'video')) {
          return saved;
        }
      } catch {}
    }
    return 'all';
  }, [queryParams, locationState, id]);

  const posts = useMemo(() => {
    if (!coomer) return [];
    
    // Gather posts from profile
    const rawPosts: CoomerPost[] = [
      ...(coomer.posts || []),
      ...(coomer.instagramPosts || []),
      ...(coomer.onlyFansPosts || [])
    ];

    // Merge cached pages from CoomerDetail for this creator
    if (id && pageStoreCache[id]) {
      Object.values(pageStoreCache[id]).forEach(pageList => {
        if (Array.isArray(pageList)) {
          rawPosts.push(...pageList);
        }
      });
    }

    // Merge posts passed directly via router navigation state
    if (Array.isArray(locationState?.pagePosts)) {
      rawPosts.push(...locationState.pagePosts);
    }
    if (locationState?.targetPost && typeof locationState.targetPost === 'object') {
      rawPosts.push(locationState.targetPost);
    }

    // Deduplicate posts by unique id or composite content signature matching CoomerDetail
    const seenPostIds = new Set<string>();
    const uniquePosts: CoomerPost[] = [];

    for (const p of rawPosts) {
      const uniqueKey = p.id ? String(p.id) : (p.urls && p.urls.length > 0 ? p.urls.join('|') : Math.random().toString(36).substring(2, 11));
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
      return safeDateB - safeDateA; // Newest first matching CoomerDetail
    });
  }, [coomer, id, locationState]);
  
  const allImages = useMemo<CoomerImageItem[]>(() => {
    const list = posts.flatMap((p, pIdx) => 
      p.urls.map((url, uIdx) => {
        const isVideo = p.mediaTypes?.[uIdx] === 'video' || 
          (uIdx === 0 && p.mediaTypes?.[0] === 'video') ||
          /\.(mp4|m4v|webm|mkv|mov)($|\?)/i.test(url) ||
          /\.(mp4|m4v|webm|mkv|mov)($|\?)/i.test(p.thumbUrls?.[uIdx] || '');

        // Preserve video url intact without transforming into .jpg
        const original = isVideo ? url : (getOriginalUrl(url) || url);
        const thumb = p.thumbUrls?.[uIdx] || getThumbnailUrl(url) || '';
        
        // Build an array of candidate fallback URLs if the primary URL fails
        const fallbacks: string[] = [];
        if (url && url !== original && !fallbacks.includes(url)) {
          fallbacks.push(url);
        }
        if (!isVideo && thumb && thumb !== original && !fallbacks.includes(thumb)) {
          fallbacks.push(thumb);
        }

        // Host-specific CDN mirrors & fallback previews
        if (!isVideo && original.includes('cum.st/media/')) {
          const shaMatch = original.match(/\/media\/([a-f0-9]{64})\//i);
          if (shaMatch) {
            const cumThumb = `https://img.cum.st/thumbnail/${shaMatch[1]}/preview.webp`;
            if (!fallbacks.includes(cumThumb)) fallbacks.push(cumThumb);
          }
        }
        if (original.includes('coomer.su/data/')) {
          const c2 = original.replace(/c\d*\.coomer\.su/, 'c2.coomer.su');
          if (!fallbacks.includes(c2) && c2 !== original) fallbacks.push(c2);
          if (!isVideo) {
            const cThumb = original.replace(/c\d*\.coomer\.su\/data\//, 'img.coomer.su/thumbnail/data/');
            if (!fallbacks.includes(cThumb)) fallbacks.push(cThumb);
          }
        }
        if (original.includes('kemono.su/data/')) {
          const k2 = original.replace(/c\d*\.kemono\.su/, 'c2.kemono.su');
          if (!fallbacks.includes(k2) && k2 !== original) fallbacks.push(k2);
          if (!isVideo) {
            const kThumb = original.replace(/c\d*\.kemono\.su\/data\//, 'img.kemono.su/thumbnail/data/');
            if (!fallbacks.includes(kThumb)) fallbacks.push(kThumb);
          }
        }

        return {
          url: original,
          originalUrl: original,
          fallbackUrls: fallbacks,
          thumbnail: thumb,
          caption: p.caption,
          mediaType: isVideo ? ('video' as const) : ('image' as const),
          duration: p.videoDurations?.[uIdx],
          postId: p.id,
          postIndex: pIdx,
          subIndex: uIdx
        };
      })
    );

    if (activeFilter === 'video') {
      return list.filter(item => item.mediaType === 'video');
    }
    if (activeFilter === 'pictures') {
      return list.filter(item => item.mediaType === 'image');
    }
    return list;
  }, [posts, activeFilter]);

  const targetIndex = useMemo(() => {
    if (allImages.length === 0) return 0;

    // 1. Direct search by postId from state or query parameter
    const targetPostId = (location.state as any)?.targetPostId || queryParams.get('postId');
    const targetUrl = (location.state as any)?.targetUrl;

    if (targetPostId) {
      // Find matching slide by postId and subIndex / targetUrl
      const exactMatch = allImages.findIndex(img => 
        String(img.postId) === String(targetPostId) && 
        (img.subIndex === initialImgIndex || !targetUrl || img.url === targetUrl || img.originalUrl === targetUrl)
      );
      if (exactMatch !== -1) return exactMatch;

      // Find first slide of that post
      const postMatch = allImages.findIndex(img => String(img.postId) === String(targetPostId));
      if (postMatch !== -1) return postMatch;
    }

    // 2. Direct search by target media URL
    if (targetUrl) {
      const urlMatch = allImages.findIndex(img => 
        img.url === targetUrl || 
        img.originalUrl === targetUrl || 
        img.fallbackUrls?.includes(targetUrl)
      );
      if (urlMatch !== -1) return urlMatch;
    }

    // 3. Fallback: match by postIndex
    const postIdxMatch = allImages.findIndex(img => img.postIndex === initialPostIndex);
    if (postIdxMatch !== -1) return postIdxMatch;

    return 0;
  }, [allImages, location.state, queryParams, initialImgIndex, initialPostIndex]);

  const [currentIndex, setCurrentIndex] = useState(targetIndex);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isViewerOpened, setIsViewerOpened] = useState(false);
  const [readyToLoadMedia, setReadyToLoadMedia] = useState(false);
  const [isCurrentLoaded, setIsCurrentLoaded] = useState(true); // Default true so preloaded slides don't stall
  const [showCaption, setShowCaption] = useState(true);
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
  const isNavigatingRef = useRef(false);

  // Transition condition:
  // Step 1: Smoothly mount and transition into Coomer View interface on mobile/desktop
  // Step 2: Do NOT load or process heavy original images or videos during the transition
  // Step 3: Only after the viewer interface is open and settled, activate media loading & processing
  useEffect(() => {
    let timer: any;
    const rafId = requestAnimationFrame(() => {
      setIsViewerOpened(true);
      // Settle transition cleanly before kicking off heavy media decodes or video streams
      timer = setTimeout(() => {
        setReadyToLoadMedia(true);
      }, 240);
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Initialize and handle resize/orientation change
  const scrollToCurrentIndex = useCallback((idx: number, behavior: ScrollBehavior = 'instant') => {
    if (scrollRef.current) {
      const targetX = idx * scrollRef.current.clientWidth;
      scrollRef.current.scrollTo({ left: targetX, behavior });
    }
  }, []);

  const appliedTargetIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (scrollRef.current && !isInitialized && allImages.length > 0) {
      setCurrentIndex(targetIndex);
      scrollToCurrentIndex(targetIndex, 'instant');
      appliedTargetIndexRef.current = targetIndex;
      setIsInitialized(true);
    }
  }, [targetIndex, isInitialized, allImages.length, scrollToCurrentIndex]);

  useEffect(() => {
    if (isInitialized && allImages.length > 0 && targetIndex !== appliedTargetIndexRef.current && targetIndex >= 0 && targetIndex < allImages.length) {
      appliedTargetIndexRef.current = targetIndex;
      setCurrentIndex(targetIndex);
      scrollToCurrentIndex(targetIndex, 'instant');
    }
  }, [targetIndex, isInitialized, allImages.length, scrollToCurrentIndex]);

  useEffect(() => {
    const handleResize = () => {
      scrollToCurrentIndex(currentIndex, 'instant');
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [currentIndex, scrollToCurrentIndex]);

  const navigateToImage = useCallback((targetIndex: number, behavior: ScrollBehavior = 'smooth') => {
    if (targetIndex < 0 || targetIndex >= allImages.length) return;
    isNavigatingRef.current = true;
    setCurrentIndex(targetIndex);
    scrollToCurrentIndex(targetIndex, behavior);

    // Release programmatic navigation flag after scroll animation settles
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 350);

    const item = allImages[targetIndex];
    if (item) {
      const targetPath = tab ? `/coomer/${id}/media/${tab}/${item.postIndex}` : `/coomer/${id}/media/${item.postIndex}`;
      const filterQuery = activeFilter !== 'all' ? `&filter=${encodeURIComponent(activeFilter)}` : '';
      const newHash = `#${targetPath}?img=${item.subIndex}&postId=${encodeURIComponent(item.postId || '')}${filterQuery}`;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', newHash);
      }
    }
  }, [allImages, id, tab, activeFilter, scrollToCurrentIndex]);

  // Keyboard navigation
  const handleBack = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (location.state?.from) {
      navigate(location.state.from, { replace: true, state: location.state?.returnState });
    } else if (window.history.length > 1 && location.key !== "default") {
      navigate(-1);
    } else {
      navigate(`/coomer/${id}`, { replace: true, state: location.state?.returnState });
    }
  }, [location.state, location.key, navigate, id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleBack();
      } else if (e.key === 'ArrowRight') {
        navigateToImage(currentIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        navigateToImage(currentIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, handleBack, navigateToImage]);

  const handleScroll = () => {
    // Ignore scroll events during programmatic autoplay or button navigation
    if (isNavigatingRef.current) return;

    if (scrollRef.current && !isZoomed) {
      const width = scrollRef.current.clientWidth;
      if (width === 0) return;
      const newIndex = Math.round(scrollRef.current.scrollLeft / width);
      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < allImages.length) {
        setCurrentIndex(newIndex);
        
        const item = allImages[newIndex];
        if (item) {
          const targetPath = tab ? `/coomer/${id}/media/${tab}/${item.postIndex}` : `/coomer/${id}/media/${item.postIndex}`;
          const filterQuery = activeFilter !== 'all' ? `&filter=${encodeURIComponent(activeFilter)}` : '';
          const newHash = `#${targetPath}?img=${item.subIndex}&postId=${encodeURIComponent(item.postId || '')}${filterQuery}`;
          if (window.location.hash !== newHash) {
            window.history.replaceState(null, '', newHash);
          }
        }
      }
    }
  };

  const currentItem = allImages[currentIndex];
  const currentPost = useMemo(() => {
    if (!currentItem) return null;
    return posts.find(p => p.id === currentItem.postId) || posts[currentItem.postIndex] || null;
  }, [posts, currentItem]);
  const subIndex = currentItem?.subIndex ?? 0;

  const currentIsVideo = currentPost?.mediaTypes?.[subIndex] === 'video' || allImages[currentIndex]?.mediaType === 'video' || currentPost?.urls?.[subIndex]?.includes('.mp4');
  const rawCaption = currentPost?.caption || allImages[currentIndex]?.caption;
  // If video: do not pick up or show description at all
  const currentCaption = currentIsVideo ? undefined : rawCaption;

  const { isLongCaption, previewCaption } = useMemo(() => {
    if (!currentCaption) return { isLongCaption: false, previewCaption: '' };
    const lines = currentCaption.split('\n');
    const maxChars = 85;

    if (lines.length > 2) {
      const firstTwo = lines.slice(0, 2).join('\n');
      if (firstTwo.length > maxChars) {
        const trimmed = firstTwo.slice(0, maxChars);
        const lastSpace = trimmed.lastIndexOf(' ');
        const finalCut = (lastSpace > 45 ? trimmed.slice(0, lastSpace) : trimmed).trim();
        return { isLongCaption: true, previewCaption: finalCut };
      }
      return { isLongCaption: true, previewCaption: firstTwo.trim() };
    }

    if (currentCaption.length > maxChars) {
      const trimmed = currentCaption.slice(0, maxChars);
      const lastSpace = trimmed.lastIndexOf(' ');
      const finalCut = (lastSpace > 45 ? trimmed.slice(0, lastSpace) : trimmed).trim();
      return { isLongCaption: true, previewCaption: finalCut };
    }

    return { isLongCaption: false, previewCaption: currentCaption };
  }, [currentCaption]);

  const { theme, accentColor } = state.settings;
  const colors = (THEME_CONFIGS as any)[theme] || THEME_CONFIGS.Dark;

  // Reset caption expansion when moving to a different image
  useEffect(() => {
    setIsCaptionExpanded(false);
  }, [currentIndex]);

  // Background Prefetch next image in browser cache for instantaneous display
  useEffect(() => {
    if (allImages.length > 1) {
      const nextIdx = (currentIndex + 1) % allImages.length;
      const nextItem = allImages[nextIdx];
      if (nextItem && nextItem.mediaType !== 'video' && nextItem.url) {
        const preloadImg = new Image();
        preloadImg.referrerPolicy = 'no-referrer';
        preloadImg.src = nextItem.url;
      }
    }
  }, [currentIndex, allImages]);

  if (!coomer || allImages.length === 0) return null;

  const currentItemDate = currentPost?.perImageDates?.[subIndex] || currentPost?.date;

  // Format date to 00/00/00 (MM/DD/YY)
  const formattedDate = (() => {
    if (!currentItemDate) return '';
    const d = new Date(currentItemDate);
    if (isNaN(d.getTime())) return '';
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  })();

  const handleLongPress = () => {
    if (currentPost && !isZoomed) {
      navigate(`/coomer/${id}/add-socials/${currentPost.id}`, { state: { from: location.pathname + location.search, returnState: location.state?.returnState }, replace: true });
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[500] bg-black flex flex-col overflow-hidden animate-fade-in-fast select-none gpu-accelerated"
      onClick={() => {
        if (!currentIsVideo && currentCaption) {
          setShowCaption(prev => !prev);
        }
      }}
    >
      {/* Transparent Header with Back Button (alone) and Floating Counter */}
      <header 
        className="fixed top-0 left-0 right-0 h-16 z-[510] flex items-center px-4 pointer-events-none"
        style={{ 
          backgroundColor: 'transparent',
          ['--header-solid-bg' as any]: colors.bg,
          ['--header-backdrop' as any]: 'none',
          ['--header-shadow' as any]: '0 4px 16px rgba(0, 0, 0, 0.25)',
          ['--header-element-border' as any]: state.settings.headerElementBorder !== false ? hexToRgba(accentColor || '#ffffff', 100) : 'transparent',
          ['--accent' as any]: accentColor,
        }}
      >
        <div className="w-full max-w-2xl mx-auto flex items-center justify-between h-full relative">
          <button 
            onClick={handleBack}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-transform bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 active:scale-90 relative isolate solid-bg-layer pointer-events-auto tap-highlight-none select-none"
            style={{ color: accentColor }}
            aria-label="Back"
          >
            <CompactIcon size={20}><Icons.ChevronLeft /></CompactIcon>
          </button>

          {/* Clean Counter on the top right - no shape underneath */}
          <div className="pointer-events-none select-none">
            <span className="text-white text-[13px] font-mono font-bold tracking-wider drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]">
              {currentPost?.type === 'Multiple' ? (
                `${subIndex + 1}/${currentPost.urls.length}`
              ) : (
                `${currentIndex + 1}/${allImages.length}`
              )}
            </span>
          </div>
        </div>
      </header>

      {/* Bottom Left: Description with inline formatted Date 00/00/00 (never on video) */}
      {showCaption && !currentIsVideo && (currentCaption || formattedDate) && !isZoomed && (
        <div 
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="absolute bottom-[max(1.2rem,env(safe-area-inset-bottom,1.2rem))] left-4 right-4 sm:right-auto sm:max-w-lg z-[510] transition-opacity duration-200 pointer-events-auto"
        >
          <div className="text-white select-text">
            {currentCaption && (
              <div className="text-start">
                {!isCaptionExpanded ? (
                  <p 
                    className="text-[13px] leading-snug text-white font-normal drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] whitespace-pre-line line-clamp-2 overflow-hidden"
                  >
                    {isLongCaption ? (
                      <>
                        {previewCaption}
                        {' '}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsCaptionExpanded(true);
                          }}
                          className="inline font-bold cursor-pointer drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] hover:underline active:opacity-75 transition-opacity"
                          style={{ color: accentColor || '#ffffff' }}
                        >
                          ... see more
                        </button>
                      </>
                    ) : (
                      currentCaption
                    )}
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto pr-1">
                    <p className="text-[13px] leading-snug text-white font-normal drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] whitespace-pre-line">
                      {currentCaption}
                      {' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsCaptionExpanded(false);
                        }}
                        className="inline font-bold cursor-pointer drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] hover:underline active:opacity-75 transition-opacity ml-1.5"
                        style={{ color: accentColor || '#ffffff' }}
                      >
                        see less
                      </button>
                    </p>
                  </div>
                )}
              </div>
            )}
            {formattedDate && (
              <span className={`inline-block text-[11px] font-mono font-medium text-white/75 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] ${currentCaption ? 'mt-1' : ''}`}>
                {formattedDate}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Desktop / Large Screen Next and Prev buttons */}
      {currentIndex > 0 && !isZoomed && (
        <button 
          onClick={() => navigateToImage(currentIndex - 1)}
          className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md items-center justify-center text-white z-[510] transition-all"
        >
          <Icons.ChevronLeft size={24} />
        </button>
      )}

      {currentIndex < allImages.length - 1 && !isZoomed && (
        <button 
          onClick={() => navigateToImage(currentIndex + 1)}
          className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md items-center justify-center text-white z-[510] transition-all"
        >
          <Icons.ChevronRight size={24} />
        </button>
      )}

      {/* Swipeable Container */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className={`flex-1 flex overflow-x-auto snap-x snap-mandatory hide-scrollbar gpu-accelerated ${isZoomed ? 'overflow-hidden' : ''}`}
        style={{ 
          scrollSnapType: isZoomed ? 'none' : 'x mandatory', 
          WebkitOverflowScrolling: 'touch', 
          touchAction: isZoomed ? 'none' : 'pan-x' 
        }}
      >
        {allImages.map((item, i) => {
          const distance = Math.abs(i - currentIndex);
          const isNear = distance <= 2; // Pre-render active & adjacent slides in DOM for zero-flicker autoplay
          
          return (
            <div key={i} className="w-screen h-full shrink-0 snap-center snap-always flex items-center justify-center relative">
              {isNear ? (
                <ZoomableImage 
                  item={item} 
                  isActive={distance === 0} 
                  readyToLoad={readyToLoadMedia && (distance === 0 || isCurrentLoaded)}
                  onZoomChange={setIsZoomed} 
                  onLongPress={handleLongPress} 
                  onLoadChange={(loaded) => {
                    if (distance === 0) {
                      setIsCurrentLoaded(loaded);
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full bg-black" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ZoomableImage: React.FC<{ 
  item: CoomerImageItem; 
  isActive: boolean;
  readyToLoad: boolean;
  onZoomChange: (zoomed: boolean) => void; 
  onLongPress: () => void;
  onLoadChange?: (loaded: boolean) => void;
}> = ({ item, isActive, readyToLoad, onZoomChange, onLongPress, onLoadChange }) => {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const [currentSrc, setCurrentSrc] = useState(item.originalUrl || item.url);
  const [fallbackIndex, setFallbackIndex] = useState(-1);
  const [cdnFallbackAttempted, setCdnFallbackAttempted] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);
  const [scale, setScale] = useState(1);
  const pointerDownPos = useRef({ x: 0, y: 0 });
  const longPressTimer = useRef<number | null>(null);

  // Clear long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  const isVideo = item.mediaType === 'video';

  // Video play/pause on slide active change
  useEffect(() => {
    if (isVideo && videoElementRef.current) {
      if (isActive && readyToLoad) {
        videoElementRef.current.play().catch(() => {});
      } else {
        videoElementRef.current.pause();
      }
    }
  }, [isActive, isVideo, readyToLoad]);

  // When item changes, reset state to primary original URL
  useEffect(() => {
    setCurrentSrc(item.originalUrl || item.url);
    setFallbackIndex(-1);
    setCdnFallbackAttempted(false);
    setIsLoaded(false);
    setError(false);
    setScale(1);
    transformRef.current?.resetTransform(0);
    onZoomChange(false);
  }, [item.originalUrl, item.url, onZoomChange]);

  // Check if image is already completed in browser memory / cache
  const checkImageComplete = useCallback(() => {
    if (isVideo) return;
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        setIsLoaded(true);
        setError(false);
      }
    }
  }, [isVideo]);

  useEffect(() => {
    if (readyToLoad && !isVideo) {
      checkImageComplete();
    }
  }, [readyToLoad, isVideo, currentSrc, checkImageComplete]);

  // Periodic safety check during first 1.2s to immediately catch cached images without delay
  useEffect(() => {
    if (isVideo || !readyToLoad || isLoaded || error) return;
    const interval = setInterval(() => {
      if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
        setIsLoaded(true);
        setError(false);
        clearInterval(interval);
      }
    }, 60);
    const timeout = setTimeout(() => clearInterval(interval), 1200);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isVideo, readyToLoad, isLoaded, error, currentSrc]);

  // Debounce spinner display so cached/fast-loading images never flash the spinner
  useEffect(() => {
    let timer: any;
    if (!isLoaded && !error && isActive && readyToLoad) {
      timer = setTimeout(() => setShowSpinner(true), 250);
    } else {
      setShowSpinner(false);
    }
    return () => clearTimeout(timer);
  }, [isLoaded, error, isActive, readyToLoad]);

  useEffect(() => {
    if (isActive) {
      onLoadChange?.(isLoaded || error);
    }
  }, [isActive, isLoaded, error, onLoadChange]);

  useEffect(() => {
    if (!isActive && scale > 1) {
      transformRef.current?.resetTransform(0);
      setScale(1);
      onZoomChange(false);
    }
  }, [isActive, scale, onZoomChange]);

  const handleImageError = () => {
    // Attempt fallback candidate if available
    const nextIdx = fallbackIndex + 1;
    if (item.fallbackUrls && nextIdx < item.fallbackUrls.length) {
      setFallbackIndex(nextIdx);
      setCurrentSrc(item.fallbackUrls[nextIdx]);
      setIsLoaded(false);
      setError(false);
    } else if (!cdnFallbackAttempted) {
      const alt = getCdnFallbackUrl(currentSrc);
      if (alt && alt !== currentSrc) {
        setCdnFallbackAttempted(true);
        setCurrentSrc(alt);
        setIsLoaded(false);
        setError(false);
      } else {
        setError(true);
        setIsLoaded(false);
      }
    } else {
      setError(true);
      setIsLoaded(false);
    }
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setError(false);
    setIsLoaded(false);
    setFallbackIndex(-1);
    setCdnFallbackAttempted(false);
    const base = item.originalUrl || item.url;
    const separator = base.includes('?') ? '&' : '?';
    setCurrentSrc(`${base}${separator}retry=${Date.now()}`);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (scale > 1.02) return; // Disable long press during zoom & pan
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    
    longPressTimer.current = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);
      onLongPress();
      longPressTimer.current = null;
    }, 500);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (longPressTimer.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);
      if (dx > 10 || dy > 10) {
        handlePointerUp();
      }
    }
  };

  // Video playback view
  if (isVideo) {
    return (
      <div 
        className="w-full h-full flex items-center justify-center overflow-hidden relative select-none"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerMove={handlePointerMove}
      >
        {!isLoaded && !error && isActive && showSpinner && readyToLoad && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
          </div>
        )}

        {error ? (
          <div className="flex flex-col items-center gap-3 opacity-90 z-10 text-white select-none px-4 text-center">
            <Icons.X size={36} className="text-red-400" />
            <span className="text-[12px] font-bold text-neutral-300">Failed to play video</span>
            <button
              onClick={handleRetry}
              className="mt-1 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] font-medium transition-all border border-white/20 active:scale-95 flex items-center gap-2"
            >
              <Icons.RotateCcw size={14} />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          readyToLoad ? (
            <video
              ref={videoElementRef}
              key={currentSrc}
              src={currentSrc}
              controls
              playsInline
              webkit-playsinline="true"
              autoPlay={isActive}
              loop
              preload="metadata"
              onLoadedData={() => {
                setIsLoaded(true);
                setError(false);
              }}
              onCanPlay={() => {
                setIsLoaded(true);
                setError(false);
              }}
              onError={handleImageError}
              className="w-full h-full max-w-full max-h-full object-contain z-10 pointer-events-auto"
            />
          ) : null
        )}
      </div>
    );
  }

  return (
    <div 
      className="w-full h-full flex items-center justify-center overflow-hidden relative select-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerMove={handlePointerMove}
    >
      {/* Loading Spinner for Original HD Image - only shown if loading takes >250ms and readyToLoad is active */}
      {!isLoaded && !error && isActive && showSpinner && readyToLoad && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
        </div>
      )}

      {error ? (
        <div className="flex flex-col items-center gap-3 opacity-90 z-10 text-white select-none px-4 text-center">
          <Icons.X size={36} className="text-red-400" />
          <span className="text-[12px] font-bold text-neutral-300">Failed to load image</span>
          <button
            onClick={handleRetry}
            className="mt-1 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] font-medium transition-all border border-white/20 active:scale-95 flex items-center gap-2"
          >
            <Icons.RotateCcw size={14} />
            <span>Retry</span>
          </button>
        </div>
      ) : (
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          minScale={1}
          maxScale={5}
          centerZoomedOut={true}
          doubleClick={{ disabled: false, mode: 'toggle', step: 2.4 }}
          pinch={{ step: 5 }}
          wheel={{ step: 0.15 }}
          panning={{ disabled: scale <= 1.02 }}
          onTransformed={(ref) => {
            const newScale = ref.state.scale;
            setScale(newScale);
            onZoomChange(newScale > 1.02);
          }}
        >
          <TransformComponent
            wrapperStyle={{
              width: '100%',
              height: '100%',
              touchAction: scale <= 1.02 ? 'pan-x pan-y' : 'none'
            }}
            contentStyle={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              touchAction: scale <= 1.02 ? 'pan-x pan-y' : 'none'
            }}
          >
            {/* Original image rendered and processed ONLY when readyToLoad condition is met */}
            {readyToLoad && (
              <img 
                ref={imgRef}
                src={currentSrc} 
                loading="eager"
                decoding="async"
                className={`max-w-full max-h-full object-contain select-none z-10 transition-opacity duration-200 pointer-events-auto ${
                  isLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                alt=""
                onLoad={() => {
                  setIsLoaded(true);
                  setError(false);
                }}
                onError={handleImageError}
                referrerPolicy="no-referrer"
              />
            )}
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  );
};
