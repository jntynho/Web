
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useApp } from '../AppContext';
import { LinkCard } from '../components/LinkCard';
import { SkeletonLinkCard } from '../components/SkeletonCard';
import { PaginationBar } from '../components/Pagination';
import { usePaginatedLinks } from '../hooks/usePaginatedLinks';

export const Home: React.FC = React.memo(() => {
  const { state, searchQuery, setSearchQuery, isHydrated, hydrationError, actorMap, studioMap, deleteLink } = useApp();
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);

  const allLinks = useMemo(() => state.links, [state.links]);

  
  const homeSortOrder = state.settings.homeSortOrder || state.settings.sortOrder;
  const {
    filteredLinks,
    paginatedLinks,
    currentPage,
    handlePageChange,
    isLoading,
    itemsPerPage
  } = usePaginatedLinks(allLinks, searchQuery, actorMap, studioMap, undefined, homeSortOrder);

  const handleToggle = useCallback((id: string) => {
    setActiveLinkId(prev => prev === id ? null : id);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      window.dispatchEvent(new CustomEvent('restore-scroll'));
    }
  }, [isLoading]);

  if (hydrationError) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-center px-6">
        <h2 className="text-sm font-black text-red-500 uppercase tracking-[0.4em] mb-2">Hydration Error</h2>
        <p className="text-[10px] text-white/50 uppercase tracking-[0.2em] font-medium">{hydrationError}</p>
      </div>
    );
  }

  if (!isHydrated) return null;

  const displayLinks = paginatedLinks.length > 0 
    ? paginatedLinks 
    : (isLoading ? Array.from({ length: itemsPerPage }).map((_, i) => ({ id: `initial-skel-${i}`, aspectRatio: (allLinks[i]?.aspectRatio || '16:9') as any })) : []);

  return (
    <div className="flex flex-col gpu-accelerated w-full relative min-h-[500px]">
        {filteredLinks.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-48 text-center px-6 animate-slide-in">
            <h2 className="text-sm font-black text-white/10 uppercase tracking-[0.4em] mb-2">Database Standby</h2>
            <p className="text-[10px] text-white/5 uppercase tracking-[0.2em] font-medium mb-6">No matches found in records</p>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="px-6 py-2 rounded-full bg-white/5 text-white/40 text-xs font-bold uppercase tracking-widest ring-1 ring-white/10 hover:bg-white/10 hover:text-white/60 transition-all active:scale-95"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col w-full z-10">
            {displayLinks.map((link) => {
              const itemRatio = link.aspectRatio || '16:9';
              return (
                <div key={link.id} className="gpu-accelerated">
                  {isLoading ? (
                    <SkeletonLinkCard aspectRatio={itemRatio} />
                  ) : (
                    <LinkCard 
                      link={link as any} 
                      isExpanded={activeLinkId === link.id}
                      onToggle={handleToggle}
                      noSideMargins={true}
                      deleteLink={deleteLink}
                      actorMap={actorMap}
                      studioMap={studioMap}
                      settings={state.settings}
                    />
                  )}
                </div>
              );
            })}
            
            {filteredLinks.length > 0 && (
              <PaginationBar 
                currentPage={currentPage}
                totalLinks={filteredLinks.length}
                itemsPerPage={state.settings.itemsPerPage}
                onPageChange={handlePageChange}
              />
            )}
          </div>
        )}
    </div>
  );
});
