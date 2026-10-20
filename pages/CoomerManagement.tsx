
import React, { useMemo, memo, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { toTitleCase } from '../utils/format';
import { SkeletonListItem } from '../components/SkeletonCard';
import { hasActiveTextSelection } from '../utils/clipboard';

const CoomerListItem = memo(({ coomer, onClick, borderColor, isLast }: { coomer: any, onClick: (id: string) => void, borderColor: string, isLast: boolean }) => {
  const imgSrc = coomer.originalImageUrl || coomer.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(coomer.name)}&background=random`;
  const [isLoaded, setIsLoaded] = useState(false);

  const postsCount = useMemo(() => {
    if (typeof coomer.totalPostsCount === 'number' && coomer.totalPostsCount > 0) {
      return coomer.totalPostsCount;
    }
    return (coomer.posts?.length || 0) + (coomer.instagramPosts?.length || 0) + (coomer.onlyFansPosts?.length || 0);
  }, [coomer]);

  return (
    <div className="w-full relative">
      <div 
        onClick={() => {
          if (hasActiveTextSelection()) return;
          onClick(coomer.id);
        }}
        className={`flex items-center gap-4 px-2 py-4 relative transition-all duration-200 active:bg-[var(--text-primary)]/[0.03] cursor-pointer group ${!isLast ? 'border-b border-[var(--border)]' : ''}`}
      >
        <div 
          className="w-16 h-16 rounded-full overflow-hidden bg-[var(--surface)] border-[2px] shrink-0 shadow-md relative transition-colors duration-500"
          style={{ borderColor: borderColor }}
        >
          {!isLoaded && <div className="absolute inset-0 bg-[var(--skeleton-bg)] animate-pulse" />}
          <img 
            src={imgSrc} 
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`} 
            style={{
              objectPosition: `${coomer.imagePositionX ?? 50}% ${coomer.imagePositionY ?? 50}%`,
              transform: `scale(${coomer.imageZoom || 1})`,
              transformOrigin: `${coomer.imagePositionX ?? 50}% ${coomer.imagePositionY ?? 50}%`
            }}
            alt={coomer.name}
            referrerPolicy="no-referrer"
            onLoad={() => { setIsLoaded(true); }}
            onError={() => { setIsLoaded(true); }}
          />
        </div>
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="text-[var(--text-primary)] font-bold text-[17px] tracking-normal truncate leading-relaxed">
            {toTitleCase(coomer.name)}
          </span>
          <span className="text-[13px] font-medium text-[var(--text-muted)] opacity-70">
            {postsCount} {postsCount === 1 ? 'post' : 'posts'}
          </span>
        </div>
      </div>
    </div>
  );
});

export const CoomerManagement: React.FC = React.memo(() => {
  const { state, searchQuery, isHydrated } = useApp();
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const navigate = useNavigate();
  const location = useLocation();
  const { sortOrder: globalSortOrder, coomerSortOrder, circleBorderColor } = state.settings;
  const sortOrder = coomerSortOrder || globalSortOrder;

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
  
  const filteredCoomers = useMemo(() => {
    let coomers = [...state.coomers];
    
    if (deferredSearchQuery.trim()) {
      coomers = coomers.filter(coomer => 
        (coomer.name || '').toLowerCase().includes(deferredSearchQuery.toLowerCase())
      );
    }

    return coomers.sort((a, b) => {
      const order = sortOrder as string;
      if (order === 'Newest') return (b.createdAt || 0) - (a.createdAt || 0);
      if (order === 'Oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      if (order === 'A-Z') return (a.name || '').localeCompare(b.name || '');
      if (order === 'Z-A') return (b.name || '').localeCompare(a.name || '');
      return 0;
    });
  }, [state.coomers, deferredSearchQuery, sortOrder]);

  useEffect(() => {
    setVisibleCount(100);
  }, [deferredSearchQuery, sortOrder]);

  const visibleCoomers = useMemo(() => filteredCoomers.slice(0, visibleCount), [filteredCoomers, visibleCount]);

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
  }, [visibleCoomers.length]);

  const handleCoomerClick = useCallback((id: string) => {
    navigate(`/coomer/${id}`, { state: { from: location.pathname + location.search, searchQuery } });
  }, [navigate, location.pathname, location.search, searchQuery]);

  if (!isHydrated) return null;

  return (
    <div className="max-w-2xl mx-auto px-2 pb-3.5 pt-3.5">
      <div className="flex flex-col relative min-h-[500px]">
        {isLoading ? (
          <div className="flex flex-col w-full z-0 animate-fade-in-fast">
            {Array.from({ length: 15 }).map((_, i) => (
              <SkeletonListItem key={`skel-${i}`} isLast={i === 14} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col w-full z-10 animate-fade-in-fast">
            {visibleCoomers.map((coomer, index) => (
              <CoomerListItem 
                key={coomer.id}
                coomer={coomer} 
                onClick={handleCoomerClick}
                borderColor={circleBorderColor}
                isLast={index === visibleCoomers.length - 1}
              />
            ))}
            {visibleCount < filteredCoomers.length && (
              <div ref={loadMoreRef} className="h-10 w-full" />
            )}
          </div>
        )}
      </div>
      
      {!isLoading && filteredCoomers.length === 0 && (
        <div className="py-32 text-center w-full z-20 relative animate-slide-in">
          <div className="text-[var(--text-muted)] font-black uppercase tracking-[0.4em] text-[10px] opacity-20">
            {searchQuery ? 'No matching records found' : 'Registry Empty'}
          </div>
        </div>
      )}
    </div>
  );
});
