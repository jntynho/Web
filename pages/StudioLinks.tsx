import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { useParams, Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { LinkCard } from '../components/LinkCard';
import { Icons } from '../constants';
import { PaginationBar } from '../components/Pagination';
import { SkeletonLinkCard } from '../components/SkeletonCard';
import { usePaginatedLinks } from '../hooks/usePaginatedLinks';
import { copyTextToClipboard, hasActiveTextSelection } from '../utils/clipboard';
import { useImageFallback } from '../hooks/useImageFallback';

const StudioHeaderImage = React.memo(({
  studio,
  isHeaderImageLoaded,
  setIsHeaderImageLoaded
}: {
  studio: any;
  isHeaderImageLoaded: boolean;
  setIsHeaderImageLoaded: (loaded: boolean) => void;
}) => {
  const rawImg = studio.originalImageUrl || studio.imageUrl;
  const rawLogo = studio.logoUrl;

  const { src: imgSrc, hasError: imgError, handleError: handleImgError } = useImageFallback(rawImg);
  const { src: logoSrc, hasError: logoError, handleError: handleLogoError } = useImageFallback(rawLogo);

  if (imgSrc && !imgError) {
    return (
      <img 
        src={imgSrc} 
        ref={(el) => {
          if (el && el.complete && el.naturalWidth > 0 && !isHeaderImageLoaded) {
            requestAnimationFrame(() => setIsHeaderImageLoaded(true));
          }
        }}
        className="w-full h-full object-cover" 
        onLoad={() => setIsHeaderImageLoaded(true)}
        onError={handleImgError}
        alt={studio.name}
        referrerPolicy="no-referrer"
      />
    );
  }

  if (logoSrc && !logoError) {
    return (
      <img 
        src={logoSrc} 
        ref={(el) => {
          if (el && el.complete && el.naturalWidth > 0 && !isHeaderImageLoaded) {
            requestAnimationFrame(() => setIsHeaderImageLoaded(true));
          }
        }}
        className="w-[70%] h-[70%] object-contain" 
        onLoad={() => setIsHeaderImageLoaded(true)}
        onError={handleLogoError}
        alt={studio.name}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="scale-[1.5] sm:scale-[1.8]">
      <Icons.Studio />
    </div>
  );
});

export const StudioLinks: React.FC = React.memo(() => {
  const { id } = useParams();
  const location = useLocation();
  const { state, searchQuery, setSearchQuery, actorMap, studioMap, isHydrated, deleteLink } = useApp();
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const [isHeaderImageLoaded, setIsHeaderImageLoaded] = useState(false);

  useEffect(() => {
    setIsHeaderImageLoaded(false);
  }, [id]);

  const associatedLinks = useMemo(() => {
    if (!id || !isHydrated) return [];
    return state.links.filter(l => (l.studioIds || []).includes(id));
  }, [state.links, id, isHydrated]);

  const studio = useMemo(() => studioMap.get(id || ''), [studioMap, id]);
  const studioLinksSortOrder = state.settings.studioLinksSortOrder || state.settings.sortOrder;
  const {
    filteredLinks,
    paginatedLinks,
    currentPage,
    handlePageChange,
    isLoading,
    itemsPerPage
  } = usePaginatedLinks(associatedLinks, searchQuery, actorMap, studioMap, id, studioLinksSortOrder);

  const isImageVisible = !isLoading && isHeaderImageLoaded;

  useEffect(() => {
    if (!isLoading) {
      window.dispatchEvent(new CustomEvent('restore-scroll'));
    }
  }, [isLoading]);

  useEffect(() => {
    if (studio && !studio.originalImageUrl && !studio.imageUrl && !studio.logoUrl) {
      setIsHeaderImageLoaded(true);
    }
  }, [studio]);

  const handleToggle = React.useCallback((id: string) => {
    setActiveLinkId(prev => prev === id ? null : id);
  }, []);

  if (!isHydrated) return null;
  if (!studio) {
    const fallbackPath = (location.state as any)?.from || '/manage-studios';
    return <Navigate to={fallbackPath} replace state={(location.state as any)?.returnState} />;
  }

  return (
    <div className="flex flex-col gpu-accelerated w-full relative min-h-[500px]" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="flex flex-col w-full">
            <div className="px-5 mb-0 mt-0" style={{ backgroundColor: 'var(--bg)' }}>
               <div className="flex items-center gap-4 sm:gap-5 py-5 sm:py-6">
                    <>
                      <div 
                        className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center bg-[var(--surface)] border-[3px] sm:border-[4px] shrink-0 text-[var(--accent)] overflow-hidden shadow-2xl relative"
                        style={{ 
                          borderColor: (isImageVisible || (!studio.originalImageUrl && !studio.imageUrl && !studio.logoUrl && !isLoading)) ? state.settings.circleBorderColor : 'transparent',
                          transition: 'border-color 300ms ease-in-out',
                        }}
                      >
                         <div 
                           className="absolute inset-0 flex items-center justify-center"
                           style={{ 
                             backgroundColor: studio.logoUrl ? (studio.logoBgColor || '#000000') : undefined,
                             opacity: (isImageVisible || (!studio.originalImageUrl && !studio.imageUrl && !studio.logoUrl && !isLoading)) ? 1 : 0,
                             transition: 'opacity 300ms ease-in-out',
                           }}
                         >
                           <StudioHeaderImage 
                             studio={studio}
                             isHeaderImageLoaded={isHeaderImageLoaded}
                             setIsHeaderImageLoaded={setIsHeaderImageLoaded}
                           />
                         </div>
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                         {isLoading ? (
                           <>
                             <span className="font-black text-[18px] sm:text-[20px] tracking-tight leading-none py-1 text-transparent relative select-none w-max block">
                               <div className="absolute top-[10%] bottom-[10%] left-0 w-36 sm:w-44 rounded-full bg-[var(--surface)] transition-colors duration-500" />
                               InvisibleStudioName
                             </span>
                             <span className="text-[11px] font-bold text-transparent relative select-none uppercase tracking-[0.25em] mt-1.5 w-max block">
                               <div className="absolute top-[10%] bottom-[10%] left-0 w-16 rounded-full bg-[var(--surface)] transition-colors duration-500" />
                               0 links
                             </span>
                           </>
                         ) : (
                            <div className="animate-fade-in-fast flex flex-col min-w-0">
                              <h3 
                                onClick={() => {
                                  if (hasActiveTextSelection()) return;
                                  copyTextToClipboard(studio.name, {
                                    successMessage: `Copied "${studio.name}" to clipboard!`,
                                    errorMessage: 'Failed to copy studio name'
                                  });
                                }}
                                title="Click to copy name"
                                className="text-[18px] sm:text-[20px] font-black text-[var(--text-primary)] tracking-tight leading-normal py-1 truncate m-0 cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity select-text"
                              >
                                {studio.name}
                              </h3>
                              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-[0.25em] mt-1.5">
                                {filteredLinks.length} {filteredLinks.length === 1 ? 'link' : 'links'}
                              </span>
                            </div>
                         )}
                      </div>
                    </>
               </div>
            </div>

            {filteredLinks.length === 0 && !isLoading ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-center px-6">
                <h2 className="text-sm font-black text-[var(--text-primary)] opacity-20 uppercase tracking-[0.4em] mb-2">Database Standby</h2>
                <p className="text-[10px] text-[var(--text-primary)] opacity-10 uppercase tracking-[0.2em] font-medium mb-6">No matches found in records</p>
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="px-6 py-2 rounded-full bg-[var(--text-primary)]/5 text-[var(--text-primary)]/40 text-xs font-bold uppercase tracking-widest ring-1 ring-[var(--text-primary)]/10 hover:bg-[var(--text-primary)]/10 hover:text-[var(--text-primary)]/60 transition-all active:scale-95"
                  >
                    Clear Search
                  </button>
                )}
              </motion.div>
            ) : (
              <div className="flex flex-col w-full overflow-x-hidden min-h-[400px]">
                {(paginatedLinks.length > 0 ? paginatedLinks : (isLoading ? Array.from({ length: itemsPerPage }).map((_, i) => ({ id: `studio-skel-${i}`, aspectRatio: (associatedLinks[i]?.aspectRatio || '16:9') as any })) : [])).map((link) => {
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
    </div>
  );
});
