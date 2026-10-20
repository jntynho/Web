import React, { useMemo, memo, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { SkeletonListItem } from '../components/SkeletonCard';
import { hasActiveTextSelection } from '../utils/clipboard';
import { useImageFallback } from '../hooks/useImageFallback';


const StudioListItem = memo(({ studio, onClick, borderColor }: { studio: any, onClick: () => void, borderColor?: string }) => {
  const rawImg = studio.originalImageUrl || studio.imageUrl;
  const rawLogo = studio.logoUrl;

  const {
    src: imgSrc,
    imgLoaded: isImgLoaded,
    hasError: hasImgError,
    handleError: handleImgError,
    handleLoad: handleImgLoad,
    bindImgRef: bindImgRef,
  } = useImageFallback(rawImg);

  const {
    src: logoSrc,
    imgLoaded: isLogoLoaded,
    hasError: hasLogoError,
    handleError: handleLogoError,
    handleLoad: handleLogoLoad,
    bindImgRef: bindLogoRef,
  } = useImageFallback(rawLogo);

  return (
    <div className="w-full relative">
      <div 
        onClick={() => {
          if (hasActiveTextSelection()) return;
          onClick();
        }}
        className="flex items-center gap-4 px-2 py-4 relative active:bg-[var(--text-primary)]/[0.03] cursor-pointer group"
      >
        <div 
          className="w-16 h-16 rounded-full flex items-center justify-center bg-[var(--surface)] text-[var(--accent)] border-[2px] shrink-0 overflow-hidden relative shadow-md"
          style={{ borderColor: borderColor }}
        >
          <div 
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundColor: studio.logoUrl ? (studio.logoBgColor || '#000000') : undefined,
            }}
          >
            {imgSrc && !hasImgError ? (
              <img 
                src={imgSrc} 
                alt={studio.name}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                onError={handleImgError}
                ref={bindImgRef}
                onLoad={handleImgLoad}
                className="w-full h-full object-cover"
                style={{ 
                  opacity: isImgLoaded ? 1 : 0,
                  transition: 'opacity 300ms ease-in-out'
                }}
              />
            ) : logoSrc && !hasLogoError ? (
              <img 
                src={logoSrc} 
                alt={studio.name}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                onError={handleLogoError}
                ref={bindLogoRef}
                onLoad={handleLogoLoad}
                className="w-[70%] h-[70%] object-contain"
                style={{ 
                  opacity: isLogoLoaded ? 1 : 0,
                  transition: 'opacity 300ms ease-in-out'
                }}
              />
            ) : (
              <div className="scale-[1.2] opacity-80">
                <Icons.Studio />
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="text-[var(--text-primary)] font-bold text-[17px] tracking-normal truncate leading-relaxed">
            {studio.name}
          </span>
          <span className="text-[var(--text-muted)] text-[13px] truncate font-medium">
            {studio.linksCount || 0} Link{studio.linksCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
});

export const StudioManagement: React.FC = React.memo(() => {
  const { state, searchQuery, isHydrated } = useApp();
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const navigate = useNavigate();
  const location = useLocation();
  const { sortOrder: globalSortOrder, studioSortOrder, circleBorderColor } = state.settings;
  const sortOrder = studioSortOrder || globalSortOrder;


  const [visibleCount, setVisibleCount] = useState(100);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [isLoading, setIsLoading] = useState(true);

  // Trigger skeleton loading on entry and on search/sort change with comfortable 400ms standard duration
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [location.pathname, location.key, deferredSearchQuery, sortOrder]);

  useEffect(() => {
    if (!isLoading) {
      window.dispatchEvent(new CustomEvent('restore-scroll'));
    }
  }, [isLoading]);

  const studioLinkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (state.links || []).forEach(l => {
      if (l?.studioIds) {
        l.studioIds.forEach(id => {
          counts[id] = (counts[id] || 0) + 1;
        });
      }
    });
    return counts;
  }, [state.links]);

  const filteredStudios = useMemo(() => {
    let studios = state.studios;
    
    if (deferredSearchQuery.trim()) {
      studios = studios.filter(studio => 
        (studio.name || '').toLowerCase().includes(deferredSearchQuery.toLowerCase())
      );
    }

    return studios.map(studio => ({
      ...studio,
      linksCount: studioLinkCounts[studio.id] || 0
    })).sort((a, b) => {
      const order = sortOrder as string;
      if (order === 'Newest') return (b.createdAt || 0) - (a.createdAt || 0);
      if (order === 'Oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      if (order === 'A-Z') return (a.name || '').localeCompare(b.name || '');
      if (order === 'Z-A') return (b.name || '').localeCompare(a.name || '');
      return 0;
    });
  }, [state.studios, studioLinkCounts, deferredSearchQuery, sortOrder]);

  useEffect(() => {
    setVisibleCount(100);
  }, [deferredSearchQuery, sortOrder]);

  const visibleStudios = useMemo(() => filteredStudios.slice(0, visibleCount), [filteredStudios, visibleCount]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + 100);
        }
      },
      { rootMargin: '800px' }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [visibleStudios.length]);

  const handleStudioClick = useCallback((id: string) => {
    navigate(`/studio/${id}`, { state: { from: location.pathname + location.search, searchQuery } });
  }, [navigate, location.pathname, location.search, searchQuery]);

  if (!isHydrated) return null;

  return (
    <div
      
      
      className="max-w-2xl mx-auto px-2 pb-3.5 pt-3.5"
    >
        <div className="flex flex-col relative min-h-[500px]">
          {isLoading ? (
            <div className="flex flex-col w-full z-0 animate-fade-in-fast">
              {Array.from({ length: 15 }).map((_, i) => (
                <SkeletonListItem key={`skel-${i}`} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col w-full z-10 animate-fade-in-fast">
              {visibleStudios.map((studio) => (
                <StudioListItem 
                  key={studio.id}
                  studio={studio} 
                  onClick={() => handleStudioClick(studio.id)}
                  borderColor={circleBorderColor}
                />
              ))}
              {visibleCount < filteredStudios.length && (
                <div ref={loadMoreRef} className="h-10 w-full" />
              )}
            </div>
          )}
        </div>
      
      {!isLoading && filteredStudios.length === 0 && (
        <div>
          <div className="text-[var(--text-muted)] font-black uppercase tracking-[0.4em] text-[10px] opacity-20">
            {searchQuery ? 'No matching records found' : 'Registry Empty'}
          </div>
        </div>
      )}
    </div>
  );
});
