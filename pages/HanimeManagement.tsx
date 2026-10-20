import React, { useMemo, memo, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { toTitleCase } from '../utils/format';
import { Icons } from '../constants';
import { motion } from 'motion/react';
import { PaginationBar } from '../components/Pagination';
import { HanimeCoverSlider } from '../components/HanimeCoverSlider';
import { SkeletonHanimeGrid } from '../components/SkeletonCard';
import { hasActiveTextSelection } from '../utils/clipboard';

const HanimeGridItem = memo(({ 
  hanime, 
  onClick, 
  onDelete 
}: { 
  hanime: any; 
  onClick: () => void; 
  onDelete: (id: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  
  const pressTimer = useRef<number | null>(null);
  const pressFeedbackTimer = useRef<number | null>(null);
  const isLongPressActive = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isMovedRef = useRef(false);
  
  const navigate = useNavigate();
  const location = useLocation();

  const cancelPressTimers = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (pressFeedbackTimer.current) {
      clearTimeout(pressFeedbackTimer.current);
      pressFeedbackTimer.current = null;
    }
    setIsPressing(false);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    
    isLongPressActive.current = false;
    isMovedRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    
    cancelPressTimers();

    // Visual press feedback only starts if the finger stays still for >160ms (avoids flicker during fast scrolling)
    pressFeedbackTimer.current = window.setTimeout(() => {
      if (!isMovedRef.current) {
        setIsPressing(true);
      }
    }, 160);
    
    // Long press trigger at 500ms
    pressTimer.current = window.setTimeout(() => {
      if (!isMovedRef.current) {
        isLongPressActive.current = true;
        setIsExpanded(true);
        setIsPressing(false);
        if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
          window.navigator.vibrate(50);
        }
      }
      pressTimer.current = null;
    }, 500);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 8 || dy > 8) {
      isMovedRef.current = true;
      cancelPressTimers();
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    cancelPressTimers();

    if (isLongPressActive.current) {
      isLongPressActive.current = false;
      return;
    }

    if (isExpanded) {
      if (!isConfirming) setIsExpanded(false);
      return;
    }

    // Tap detection: minimal movement + short duration
    if (start && !isMovedRef.current) {
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      if (dx < 10 && dy < 10 && !hasActiveTextSelection()) {
        onClick();
      }
    }
  };

  const handlePointerCancel = () => {
    pointerStartRef.current = null;
    cancelPressTimers();
  };

  return (
    <div className="flex flex-col gap-2 group contain-layout">
      <div 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerCancel}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className={`rounded-xl cursor-pointer shadow-md relative overflow-hidden aspect-[5/7] select-none bg-[var(--surface)] transition-transform duration-200 ease-out ${
          isPressing ? 'scale-[0.97]' : 'scale-100 hover:shadow-xl'
        }`}
        style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      >
        {/* Full cover slider (zero jitter) */}
        <HanimeCoverSlider hanime={hanime} />

        {/* Long-press Edit/Delete Menu */}
        <div 
          className="absolute inset-0 z-30 bg-black/90 flex flex-col items-center justify-center gap-6 transition-opacity duration-200" 
          style={{ opacity: isExpanded ? 1 : 0, pointerEvents: isExpanded ? 'auto' : 'none' }}
          onClick={(e) => {
            e.stopPropagation();
            if (!isConfirming) setIsExpanded(false);
          }}
        >
          {isConfirming ? (
            <motion.div 
              initial={{ opacity: 0, y: 8 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="flex flex-col items-center justify-center gap-4 p-4 w-full" 
              onClick={e => e.stopPropagation()}
            >
              <span className="text-white text-base font-bold tracking-wide text-center mb-1">Are you sure?</span>
              <div className="flex flex-col gap-2.5 w-full max-w-[160px]">
                <button 
                  type="button"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onDelete(hanime.id); 
                    setIsExpanded(false); 
                    setIsConfirming(false); 
                  }} 
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-red-600 text-white text-xs font-bold uppercase tracking-wider active:scale-95 transition-transform"
                >
                  <Icons.Trash size={15} /> Delete
                </button>
                <button 
                  type="button"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setIsConfirming(false); 
                  }} 
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-neutral-700 text-white text-xs font-bold uppercase tracking-wider active:scale-95 transition-transform"
                >
                  <Icons.X size={15} /> Cancel
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, y: 8 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="flex flex-col items-center gap-3 p-4 w-full" 
              onClick={e => e.stopPropagation()}
            >
              <div className="flex flex-col gap-2.5 w-full max-w-[160px]">
                <button 
                  type="button"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    navigate(`/manage-hanime/edit/${hanime.id}`, { state: { from: location.pathname + location.search }, replace: true }); 
                  }} 
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 text-white text-xs font-bold uppercase tracking-wider active:scale-95 transition-transform"
                >
                  <Icons.Edit size={15} /> Edit
                </button>
                <button 
                  type="button"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setIsConfirming(true); 
                  }} 
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-red-600 text-white text-xs font-bold uppercase tracking-wider active:scale-95 transition-transform"
                >
                  <Icons.Trash size={15} /> Delete
                </button>
              </div>
              <button 
                type="button"
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setIsExpanded(false); 
                }} 
                className="text-white/50 text-xs font-medium tracking-widest uppercase mt-1 hover:text-white"
              >
                Cancel
              </button>
            </motion.div>
          )}
        </div>
      </div>
      
      <div className="px-1 mt-0.5 h-[2.75rem] flex items-start">
        <h3 
          className="text-transparent bg-clip-text bg-gradient-to-b from-pink-100 to-rose-300 font-bold text-[13px] tracking-tight line-clamp-2 leading-snug cursor-pointer"
          title={toTitleCase(hanime.title)}
          onClick={onClick}
          style={{ fontFamily: "'Manga', 'Kalam', 'Patrick Hand', 'Comic Sans MS', cursive", letterSpacing: '0.5px' }}
        >
          {toTitleCase(hanime.title)}
        </h3>
      </div>
    </div>
  );
});

export const HanimeManagement: React.FC = React.memo(() => {
  const { state, searchQuery, isHydrated, deleteHanime, pageRegistry, setPageRegistry } = useApp();
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const navigate = useNavigate();
  const location = useLocation();
  const { sortOrder: globalSortOrder, hanimeSortOrder, itemsPerPage = 20 } = state.settings;
  const sortOrder = hanimeSortOrder || globalSortOrder;

  const pageKey = useMemo(() => location.pathname, [location.pathname]);
  const [currentPage, setCurrentPage] = useState(() => pageRegistry[pageKey] || 1);
  const [isLoading, setIsLoading] = useState(true);

  // Initial load & navigation skeleton loading with standard 400ms duration
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [location.pathname, location.key, sortOrder]);

  // Search skeleton transition with snappy feedback
  useEffect(() => {
    setCurrentPage(1);
    if (searchQuery) {
      setIsLoading(true);
      const timer = setTimeout(() => setIsLoading(false), 200);
      return () => clearTimeout(timer);
    }
  }, [searchQuery]);

  useEffect(() => {
    setPageRegistry(prev => ({ ...prev, [pageKey]: currentPage }));
  }, [currentPage, pageKey, setPageRegistry]);

  // Scroll restoration on loading finish
  useEffect(() => {
    if (!isLoading) {
      window.dispatchEvent(new CustomEvent('restore-scroll'));
    }
  }, [isLoading]);
  
  const filteredHanime = useMemo(() => {
    let list = state.hanime;
    
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter(h => h.title.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      if (sortOrder === 'Newest') return (b.createdAt || 0) - (a.createdAt || 0);
      if (sortOrder === 'Oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      if (sortOrder === 'DateDesc') return (b.assignedDate || b.createdAt || 0) - (a.assignedDate || a.createdAt || 0);
      if (sortOrder === 'DateAsc') return (a.assignedDate || a.createdAt || 0) - (b.assignedDate || b.createdAt || 0);
      if (sortOrder === 'A-Z') return a.title.localeCompare(b.title);
      if (sortOrder === 'Z-A') return b.title.localeCompare(a.title);
      return 0;
    });
  }, [state.hanime, deferredSearchQuery, sortOrder]);

  const paginatedHanime = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredHanime.slice(start, end);
  }, [filteredHanime, currentPage, itemsPerPage]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredHanime.length / itemsPerPage));
    if (currentPage > maxPage) {
      setCurrentPage(maxPage);
    }
  }, [filteredHanime.length, itemsPerPage, currentPage]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    setIsLoading(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  const handleHanimeClick = useCallback((id: string) => {
    navigate(`/hanime/${id}`, { state: { from: location.pathname + location.search, searchQuery } });
  }, [navigate, location.pathname, location.search, searchQuery]);

  if (!isHydrated) return null;

  return (
    <div className="w-full px-1 pb-6 pt-3.5 relative min-h-[500px]">
      {isLoading ? (
        <SkeletonHanimeGrid count={Math.min(itemsPerPage, Math.max(6, filteredHanime.length || 12))} />
      ) : filteredHanime.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 w-full z-10 animate-fade-in-fast">
          {paginatedHanime.map((hanime) => (
            <HanimeGridItem 
              key={hanime.id} 
              hanime={hanime} 
              onClick={() => handleHanimeClick(hanime.id)}
              onDelete={deleteHanime}
            />
          ))}
        </div>
      ) : (
        <div className="py-24 text-center w-full z-20 relative animate-fade-in-fast flex flex-col items-center justify-center">
          <div className="text-[var(--text-muted)] font-black uppercase tracking-[0.4em] text-[10px] opacity-25">
            {searchQuery ? 'No matching records found' : 'Registry Empty'}
          </div>
        </div>
      )}
      
      {!isLoading && filteredHanime.length > 0 && (
        <div className="mt-4 animate-fade-in-fast">
          <PaginationBar 
            currentPage={currentPage}
            totalLinks={filteredHanime.length}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
});
