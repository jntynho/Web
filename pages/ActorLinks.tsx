
import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { useParams, Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { LinkCard } from '../components/LinkCard';
import { PaginationBar } from '../components/Pagination';
import { SkeletonLinkCard } from '../components/SkeletonCard';
import { toTitleCase } from '../utils/format';
import { usePaginatedLinks } from '../hooks/usePaginatedLinks';
import { copyTextToClipboard, hasActiveTextSelection } from '../utils/clipboard';
import { useImageFallback } from '../hooks/useImageFallback';

const ActorHeaderImage = React.memo(({ 
  actor, 
  isImageVisible, 
  isHeaderImageLoaded, 
  setIsHeaderImageLoaded 
}: { 
  actor: any; 
  isImageVisible: boolean; 
  isHeaderImageLoaded: boolean; 
  setIsHeaderImageLoaded: (loaded: boolean) => void;
}) => {
  const rawSrc = actor.originalImageUrl || actor.imageUrl;
  const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(actor.name)}&background=random`;
  const { src: imgSrc, handleError } = useImageFallback(rawSrc, { fallbackUrl: avatarFallback });

  return (
    <img 
      src={imgSrc || avatarFallback} 
      ref={(el) => {
        if (el && el.complete && el.naturalWidth > 0 && !isHeaderImageLoaded) {
          requestAnimationFrame(() => setIsHeaderImageLoaded(true));
        }
      }}
      className="w-full h-full object-cover" 
      style={{
        objectPosition: `${actor.imagePositionX ?? 50}% ${actor.imagePositionY ?? 50}%`,
        transform: `scale(${actor.imageZoom || 1})`,
        transformOrigin: `${actor.imagePositionX ?? 50}% ${actor.imagePositionY ?? 50}%`,
        opacity: isImageVisible ? 1 : 0,
        transition: 'opacity 300ms ease-in-out',
      }}
      onLoad={() => setIsHeaderImageLoaded(true)}
      onError={handleError}
      alt={actor.name}
      referrerPolicy="no-referrer"
    />
  );
});

export const ActorLinks: React.FC = React.memo(() => {
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
    return state.links.filter(l => (l.actorIds || []).includes(id));
  }, [state.links, id, isHydrated]);

  const actorLinksSortOrder = state.settings.actorLinksSortOrder || state.settings.sortOrder;
  const {
    filteredLinks,
    paginatedLinks,
    currentPage,
    handlePageChange,
    isLoading,
    itemsPerPage
  } = usePaginatedLinks(associatedLinks, searchQuery, actorMap, studioMap, id, actorLinksSortOrder);

  const isImageVisible = !isLoading && isHeaderImageLoaded;

  useEffect(() => {
    if (!isLoading) {
      window.dispatchEvent(new CustomEvent('restore-scroll'));
    }
  }, [isLoading]);

  const actor = useMemo(() => actorMap.get(id || ''), [actorMap, id]);

  const handleToggle = React.useCallback((id: string) => {
    setActiveLinkId(prev => prev === id ? null : id);
  }, []);

  if (!isHydrated) return null;
  if (!actor) {
    const fallbackPath = (location.state as any)?.from || '/manage-actors';
    return <Navigate to={fallbackPath} replace state={(location.state as any)?.returnState} />;
  }

  return (
    <div className="flex flex-col gpu-accelerated w-full relative min-h-[500px]" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="flex flex-col w-full">
            <div className="px-5 mb-0 mt-0" style={{ backgroundColor: 'var(--bg)' }}>
               <div className="flex items-center gap-4 sm:gap-5 py-5 sm:py-6">
                    <>
                      <div 
                        className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-[3px] sm:border-[4px] shrink-0 bg-[var(--surface)] shadow-2xl relative"
                        style={{ 
                          borderColor: isImageVisible ? state.settings.circleBorderColor : 'transparent',
                          transition: 'border-color 300ms ease-in-out',
                        }}
                      >
                         <ActorHeaderImage 
                           actor={actor}
                           isImageVisible={isImageVisible}
                           isHeaderImageLoaded={isHeaderImageLoaded}
                           setIsHeaderImageLoaded={setIsHeaderImageLoaded}
                         />
                      </div>

                      <div className="flex flex-col justify-center min-w-0 flex-1">
                         {isLoading ? (
                           <div className="flex items-center min-w-0">
                             <span className="font-black text-[18px] sm:text-[20px] tracking-tight leading-none py-1 text-transparent relative select-none w-max block">
                               <div className="absolute top-[10%] bottom-[10%] left-0 w-36 sm:w-44 rounded-full bg-[var(--surface)] transition-colors duration-500" />
                               InvisibleActorName
                             </span>
                           </div>
                         ) : (
                           <div className="animate-fade-in-fast flex items-center gap-2 min-w-0">
                             <h3 
                               onClick={() => {
                                 if (hasActiveTextSelection()) return;
                                 copyTextToClipboard(actor.name, {
                                   successMessage: `Copied "${toTitleCase(actor.name)}" to clipboard!`,
                                   errorMessage: 'Failed to copy actor name'
                                 });
                               }}
                               title="Click to copy name"
                               className="text-[18px] sm:text-[20px] font-black text-[var(--text-primary)] tracking-tight leading-normal py-1 truncate m-0 cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity select-text"
                             >
                               {toTitleCase(actor.name)}
                             </h3>
                             {state.settings.showActorCheckmark !== false && (
                               <div className="shrink-0 flex items-center justify-center leading-none">
                                 <Icons.Verified 
                                   size={20} 
                                   color={state.settings.actorNameColor || '#60a5fa'} 
                                   className="drop-shadow-xs"
                                 />
                               </div>
                             )}
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
                {(paginatedLinks.length > 0 ? paginatedLinks : (isLoading ? Array.from({ length: itemsPerPage }).map((_, i) => ({ id: `actor-skel-${i}`, aspectRatio: (associatedLinks[i]?.aspectRatio || '16:9') as any })) : [])).map((link) => {
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
