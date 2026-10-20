import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons, THEME_CONFIGS } from '../constants';
import { getThumbnailUrl, getOriginalUrl } from '../utils/image';

const scrollCache: Record<string, number> = {};

const hexToRgba = (hex: string, opacity: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

const CompactIcon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 21 }) => (
  <div style={{ transform: `scale(${size / 24})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

const ImageCard = React.memo(({ thumbUrl, onClick, index, dimension, isGridReady = true, onDimensionLoaded }: { 
  thumbUrl: string; 
  onClick: () => void; 
  index: number;
  dimension?: { width: number; height: number };
  isGridReady?: boolean;
  onDimensionLoaded?: (index: number, w: number, h: number) => void;
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isSwiping = useRef(false);
  
  const hasDimension = Boolean(dimension && dimension.width > 0 && dimension.height > 0);
  const aspectRatioStyle = hasDimension 
    ? { aspectRatio: `${dimension!.width} / ${dimension!.height}` } 
    : { aspectRatio: '2 / 3' };

  const isActuallyVisible = isGridReady && loaded;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isSwiping.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartPos.current && e.touches[0]) {
      const dx = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
      const dy = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
      if (dx > 8 || dy > 8) {
        isSwiping.current = true;
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isSwiping.current) {
      isSwiping.current = false;
      return;
    }
    onClick();
  };

  return (
    <div 
      id={`photo-${index}`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      className="relative w-full rounded-lg overflow-hidden cursor-pointer group transition-[background-color] duration-500 gpu-accelerated bg-[var(--surface)] flex items-center justify-center select-none active:opacity-90"
      style={aspectRatioStyle}
    >
      {/* Synchronized Skeleton Shimmer layer */}
      <div 
        className="absolute inset-0 bg-[var(--skeleton-bg)] animate-pulse pointer-events-none transition-opacity duration-300"
        style={{
          opacity: isActuallyVisible ? 0 : 1,
          zIndex: 0
        }}
      />

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-secondary)] opacity-50 z-20 gap-1">
          <Icons.X className="w-5 h-5" />
          <span className="text-[10px] font-medium">Failed</span>
        </div>
      ) : (
        <img 
          src={thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0 && !loaded) {
              requestAnimationFrame(() => setLoaded(true));
            }
          }}
          onLoad={(e) => { 
            const nw = e.currentTarget.naturalWidth;
            const nh = e.currentTarget.naturalHeight;
            if (nw && nh && (!dimension || dimension.width !== nw || dimension.height !== nh) && onDimensionLoaded) {
              onDimensionLoaded(index, nw, nh);
            }
            setLoaded(true);
          }}
          onError={() => {
            setError(true);
            setLoaded(true);
          }}
          className="w-full h-full object-cover rounded-lg pointer-events-none"
          style={{
            opacity: isActuallyVisible ? 1 : 0,
            transition: 'opacity 300ms ease-in-out',
            zIndex: 1
          }}
        />
      )}
    </div>
  );
});

export const Photoset: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, updateLink } = useApp();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { theme, accentColor, headerTheme } = state.settings;
  const colors = (THEME_CONFIGS as any)[theme] || THEME_CONFIGS.Dark;
  const activeHeaderTheme = headerTheme === 'Default' ? theme : headerTheme;
  const hColors = (THEME_CONFIGS as any)[activeHeaderTheme] || colors;
  const activeBgColor = colors.bg;

  const link = useMemo(() => state.links.find(l => l.id === id), [state.links, id]);
  const galleryUrls = link?.galleryUrls || [];
  const originalGalleryUrls = link?.originalGalleryUrls || [];
  const qualityPreference = link?.qualityPreference || 'thumbnail';
  
  const hasOriginalUrls = originalGalleryUrls.length > 0;
  const useOriginalQuality = qualityPreference === 'original' && hasOriginalUrls;

  // Unified items count & URLs matching PhotosetPreview exactly
  const displayUrls = useMemo(() => {
    const totalCount = Math.max(galleryUrls.length, originalGalleryUrls.length);
    const urls: string[] = [];
    for (let i = 0; i < totalCount; i++) {
      const rawThumb = galleryUrls[i] || '';
      const rawHd = originalGalleryUrls[i] || '';
      if (useOriginalQuality) {
        urls.push(rawHd || getOriginalUrl(rawThumb) || rawThumb || '');
      } else {
        urls.push(rawThumb || getThumbnailUrl(rawHd) || rawHd || '');
      }
    }
    return urls;
  }, [galleryUrls, originalGalleryUrls, useOriginalQuality]);

  const [visibleCount, setVisibleCount] = useState(() => {
    const cachedIndex = sessionStorage.getItem(`photoset_return_${id}`);
    if (location.state?.returningIndex !== undefined) {
      return Math.max(20, location.state.returningIndex + 20);
    } else if (cachedIndex) {
      return Math.max(20, parseInt(cachedIndex, 10) + 20);
    }
    return 20;
  });

  const pendingDimensionUpdates = useRef<{ [key: number]: { width: number; height: number } }>({});
  const syncTimeout = useRef<NodeJS.Timeout | null>(null);
  const localDimensionsRef = useRef<{ width: number; height: number }[]>(link?.galleryDimensions || []);
  const dimensionsUpdateTimeout = useRef<NodeJS.Timeout | null>(null);
  const [localDimensions, setLocalDimensions] = useState<{ width: number; height: number }[]>(link?.galleryDimensions || []);
  const [isGridReady, setIsGridReady] = useState(false);
  const linkRef = useRef(link);

  useEffect(() => {
    setIsGridReady(false);
    const frameId = requestAnimationFrame(() => {
      const timer = setTimeout(() => {
        setIsGridReady(true);
      }, 70);
      return () => clearTimeout(timer);
    });
    return () => cancelAnimationFrame(frameId);
  }, [id, qualityPreference]);
  
  useEffect(() => {
    linkRef.current = link;
  }, [link]);

  const flushDimensions = useCallback(() => {
    if (!linkRef.current || Object.keys(pendingDimensionUpdates.current).length === 0) return;
    
    const currentLink = linkRef.current;
    const currentDims = [...(currentLink.galleryDimensions || [])];
    let hasChanges = false;
    
    Object.entries(pendingDimensionUpdates.current).forEach(([idx, dim]: [string, { width: number; height: number }]) => {
      const i = parseInt(idx);
      if (!currentDims[i] || currentDims[i].width !== dim.width || currentDims[i].height !== dim.height) {
        currentDims[i] = dim;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      updateLink(currentLink.id, { galleryDimensions: currentDims });
    }
    pendingDimensionUpdates.current = {};
  }, [updateLink]);

  useEffect(() => {
    return () => {
      if (syncTimeout.current) clearTimeout(syncTimeout.current);
      if (dimensionsUpdateTimeout.current) clearTimeout(dimensionsUpdateTimeout.current);
      flushDimensions();
    };
  }, [flushDimensions]);

  const handleDimensionLoaded = useCallback((index: number, w: number, h: number) => {
    if (w && h) {
      pendingDimensionUpdates.current[index] = { width: w, height: h };
      
      const next = [...localDimensionsRef.current];
      next[index] = { width: w, height: h };
      localDimensionsRef.current = next;

      if (dimensionsUpdateTimeout.current) clearTimeout(dimensionsUpdateTimeout.current);
      dimensionsUpdateTimeout.current = setTimeout(() => {
        setLocalDimensions(localDimensionsRef.current);
      }, 50);

      if (syncTimeout.current) clearTimeout(syncTimeout.current);
      syncTimeout.current = setTimeout(() => {
        const currentLink = linkRef.current;
        if (!currentLink) return;
        
        const currentDims = [...(currentLink.galleryDimensions || [])];
        let hasChanges = false;
        Object.entries(pendingDimensionUpdates.current).forEach(([idx, dim]) => {
          currentDims[parseInt(idx, 10)] = dim;
          hasChanges = true;
        });
        if (hasChanges) {
          updateLink(currentLink.id, { galleryDimensions: currentDims });
          pendingDimensionUpdates.current = {};
        }
      }, 2000);
    }
  }, [updateLink]);

  useEffect(() => {
    return () => {
      if (syncTimeout.current) clearTimeout(syncTimeout.current);
    };
  }, []);

  useEffect(() => {
    const cachedIndex = sessionStorage.getItem(`photoset_return_${id}`);
    const returningIdx = location.state?.returningIndex ?? (cachedIndex ? parseInt(cachedIndex, 10) : undefined);
    
    if (returningIdx !== undefined && !isNaN(returningIdx)) {
      setVisibleCount(prev => Math.max(prev, returningIdx + 20));
      const idx = returningIdx;
      let attempts = 0;
      const tryScroll = () => {
        const el = document.getElementById(`photo-${idx}`);
        if (el && scrollContainerRef.current) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
          if (id) scrollCache[id] = scrollContainerRef.current.scrollTop;
        } else if (attempts < 25) {
          attempts++;
          requestAnimationFrame(tryScroll);
        }
      };
      requestAnimationFrame(tryScroll);
      sessionStorage.removeItem(`photoset_return_${id}`);
    } else if (scrollContainerRef.current && id && scrollCache[id] !== undefined) {
      scrollContainerRef.current.scrollTop = scrollCache[id];
    }
  }, [id, location.state?.returningIndex]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (id) {
      scrollCache[id] = e.currentTarget.scrollTop;
    }
    
    // Load more images as user scrolls down
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 800) { // 800px buffer
      if (visibleCount < displayUrls.length) {
        setVisibleCount(prev => Math.min(prev + 20, displayUrls.length));
      }
    }
  };

  const visibleUrls = useMemo(() => displayUrls.slice(0, visibleCount), [displayUrls, visibleCount]);

  const { col1, col2 } = useMemo(() => {
    const c1: { url: string; index: number }[] = [];
    const c2: { url: string; index: number }[] = [];
    let h1 = 0;
    let h2 = 0;

    visibleUrls.forEach((url, i) => {
      const dim = localDimensions[i];
      const ratio = dim && dim.width > 0 ? (dim.height / dim.width) : 1.5;
      
      if (h1 <= h2) {
        c1.push({ url, index: i });
        h1 += ratio;
      } else {
        c2.push({ url, index: i });
        h2 += ratio;
      }
    });

    return { col1: c1, col2: c2 };
  }, [visibleUrls, localDimensions]);

  const goBack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (location.state?.from) {
      navigate(location.state.from, { replace: true, state: location.state?.returnState });
    } else if (window.history.length > 1 && location.key !== "default") {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
  };

  if (!link) {
    return (
      <div className="fixed inset-0 z-[100] bg-[var(--bg)] flex flex-col items-center justify-center gap-4 text-[var(--text-secondary)]">
        <Icons.X className="w-12 h-12" />
        <p>Photoset not found</p>
        <button onClick={goBack} className="mt-4 px-6 py-2 rounded-full font-bold text-sm bg-[var(--surface)] border border-[var(--border)] shadow-md active:scale-95 transition-transform text-[var(--primary)]">Go Back</button>
      </div>
    );
  }

  const isTransparentHeader = state.settings.transparentHeader === true;
  const showHeaderBottomBorder = state.settings.headerBottomBorder !== false && !isTransparentHeader;
  const btnClass = "w-10 h-10 flex items-center justify-center rounded-full transition-transform bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 active:scale-90 relative isolate solid-bg-layer";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden gpu-accelerated transition-colors duration-300"
      style={{ 
        backgroundColor: colors.bg, 
        color: colors.textPrimary,
        ['--accent' as any]: accentColor, 
        ['--bg' as any]: colors.bg,
        ['--surface' as any]: colors.surface, 
        ['--text-primary' as any]: colors.textPrimary,
        ['--text-secondary' as any]: colors.textSecondary, 
        ['--text-muted' as any]: colors.textMuted,
        ['--border' as any]: colors.border,
        ['--skeleton-bg' as any]: colors.skeletonBg || colors.surface,
        ['--card-bg' as any]: colors.cardBg || colors.surface,
        ['--toggle-off-bg' as any]: colors.toggleOffBg || 'rgba(255, 255, 255, 0.15)',
      }}
    >
      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 h-16 z-[170] flex items-center px-4 gpu-accelerated ${showHeaderBottomBorder ? 'border-b' : 'border-b-transparent'}`} 
        style={{ 
          backgroundColor: isTransparentHeader ? 'transparent' : hexToRgba(colors.bg, 100),
          borderColor: showHeaderBottomBorder ? hColors.border : 'transparent',
          color: hColors.textPrimary,
          ['--header-solid-bg' as any]: isTransparentHeader ? colors.bg : 'transparent',
          ['--header-backdrop' as any]: 'none',
          ['--header-shadow' as any]: isTransparentHeader ? '0 4px 16px rgba(0, 0, 0, 0.25)' : 'none',
          ['--header-element-border' as any]: state.settings.headerElementBorder !== false ? hexToRgba(accentColor || '#ffffff', 100) : 'transparent',
        }}>
        <div className="w-full max-w-2xl mx-auto flex items-center h-full relative">
          <div className="flex items-center w-full h-full relative">
            <button onClick={goBack} className={`${btnClass} shrink-0`} style={{ color: accentColor }}>
              <CompactIcon size={20}><Icons.ChevronLeft /></CompactIcon>
            </button>
            <div className="flex-1 flex min-w-0 mx-2">
              <div className="h-10 w-full flex items-center justify-center rounded-full bg-[var(--accent)]/15 px-4 relative isolate solid-bg-layer" style={{ color: accentColor }}>
                <span className="text-[15px] font-bold tracking-tight leading-normal py-0.5 truncate block w-full text-center select-text" style={{ color: accentColor }}>{link.title || "Photoset"}</span>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <div className={`${btnClass} shrink-0`} style={{ color: accentColor }}>
                <span className="text-[13px] font-bold" style={{ color: accentColor }}>{displayUrls.length}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Vertical List */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-6 pt-18 md:pt-20 pb-6 hide-scrollbar gpu-accelerated relative"
      >
        <div className="grid grid-cols-2 gap-2 md:gap-4 max-w-3xl mx-auto w-full z-10 items-start">
          <div className="flex flex-col gap-2 md:gap-4">
            {col1.map((item) => {
              const thumbUrl = useOriginalQuality ? item.url : getThumbnailUrl(item.url);
              return (
                <ImageCard 
                  key={item.index}
                  index={item.index}
                  thumbUrl={thumbUrl} 
                  dimension={localDimensions[item.index]}
                  isGridReady={isGridReady}
                  onDimensionLoaded={handleDimensionLoaded}
                  onClick={() => navigate(`/photoset/${link.id}/preview/${item.index}`, { state: location.state })} 
                />
              );
            })}
          </div>
          <div className="flex flex-col gap-2 md:gap-4">
            {col2.map((item) => {
              const thumbUrl = useOriginalQuality ? item.url : getThumbnailUrl(item.url);
              return (
                <ImageCard 
                  key={item.index}
                  index={item.index}
                  thumbUrl={thumbUrl} 
                  dimension={localDimensions[item.index]}
                  isGridReady={isGridReady}
                  onDimensionLoaded={handleDimensionLoaded}
                  onClick={() => navigate(`/photoset/${link.id}/preview/${item.index}`, { state: location.state })} 
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
