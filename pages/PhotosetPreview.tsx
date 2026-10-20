import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { getOriginalUrl } from '../utils/image';

const CompactIcon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 21 }) => (
  <div style={{ transform: `scale(${size / 24})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

interface LazyImageProps {
  hdUrl: string;
  index: number;
  currentIndex: number;
  onZoomChange: (zoomed: boolean) => void;
}

const LazyImage: React.FC<LazyImageProps> = ({ hdUrl, index, currentIndex, onZoomChange }) => {
  const [currentSrc, setCurrentSrc] = useState(hdUrl);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [scale, setScale] = useState(1);
  const autoRetryCount = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const transformRef = useRef<any>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const hasEverBeenNear = useRef(false);

  // Distance from active slide
  const distance = Math.abs(currentIndex - index);
  const isNear = distance <= 2;
  if (isNear) {
    hasEverBeenNear.current = true;
  }

  // Download HD payload for active or adjacent slides
  const shouldLoad = distance <= 1;

  // Update src if hdUrl changes
  useEffect(() => {
    autoRetryCount.current = 0;
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    setCurrentSrc(hdUrl);
    setError(false);
    setLoaded(false);
  }, [hdUrl]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  // Auto-reset zoom when sliding away
  useEffect(() => {
    if (distance > 0 && scale > 1 && transformRef.current) {
      transformRef.current.resetTransform();
      setScale(1);
      onZoomChange(false);
    }
  }, [distance, scale, onZoomChange]);

  // Check if image is already cached in memory
  useEffect(() => {
    if (hasEverBeenNear.current && imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [hasEverBeenNear.current, currentSrc, shouldLoad]);

  const handleImageError = () => {
    if (hdUrl && autoRetryCount.current < 1) {
      autoRetryCount.current += 1;
      retryTimeoutRef.current = setTimeout(() => {
        setCurrentSrc(`${hdUrl}${hdUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
      }, 350);
      return;
    }
    setError(true);
    setLoaded(true);
  };

  const handleRetryHD = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    setError(false);
    setLoaded(false);
    autoRetryCount.current = 0;
    setCurrentSrc(`${hdUrl}${hdUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`);
  };

  if (!hasEverBeenNear.current) {
    return <div className="w-full h-full relative flex items-center justify-center shrink-0" />;
  }

  return (
    <div className="w-full h-full relative flex items-center justify-center shrink-0 select-none">
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none p-4">
          <div className="w-9 h-9 rounded-full border-2 border-white/15 border-t-white/80 animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60 z-20 gap-3 p-4">
          <Icons.X className="w-8 h-8 opacity-40" />
          <span className="text-xs font-medium text-white/70">Failed to load image</span>
          <button 
            onClick={handleRetryHD}
            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-white/15 hover:bg-white/25 active:scale-95 transition-all text-white border border-white/10"
          >
            Retry
          </button>
        </div>
      )}

      <TransformWrapper 
         ref={transformRef}
         initialScale={1}
         minScale={1}
         maxScale={4}
         centerZoomedOut={true}
         doubleClick={{ disabled: false, mode: "toggle", step: 1.8 }}
         pinch={{ step: 5 }}
         wheel={{ step: 0.1 }}
         panning={{ disabled: scale <= 1.02 }}
         onTransform={(ref) => {
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
          {shouldLoad && (
            <img 
               ref={imgRef}
               src={currentSrc}
               loading={distance === 0 ? "eager" : "lazy"}
               // @ts-ignore
               fetchPriority={distance === 0 ? "high" : "low"}
               decoding="async"
               referrerPolicy="no-referrer"
               onLoad={() => { 
                 setLoaded(true);
                 setError(false);
               }}
               onError={handleImageError}
               className={`max-w-full max-h-full object-contain transition-opacity duration-200 z-10 relative pointer-events-auto ${loaded && !error ? 'opacity-100' : 'opacity-0'}`}
               alt="" 
             />
          )}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
};

export const PhotosetPreview: React.FC = () => {
  const { id, index } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);

  const link = useMemo(() => state.links.find(l => l.id === id), [state.links, id]);
  const originalGalleryUrls = link?.originalGalleryUrls || [];
  const baseGalleryUrls = link?.galleryUrls || [];
  
  // Safe unified items builder with pure HD derivation
  const galleryItems = useMemo(() => {
    const totalCount = Math.max(baseGalleryUrls.length, originalGalleryUrls.length);
    const items: string[] = [];
    for (let i = 0; i < totalCount; i++) {
      const rawHd = originalGalleryUrls[i] || '';
      const rawThumb = baseGalleryUrls[i] || '';
      const hd = rawHd || getOriginalUrl(rawThumb) || rawThumb || '';
      items.push(hd);
    }
    return items;
  }, [baseGalleryUrls, originalGalleryUrls]);
  
  const initialIndex = Math.max(0, Math.min(parseInt(index || '0', 10), Math.max(0, galleryItems.length - 1)));
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const isExiting = useRef(false);
  const scrollDebounce = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    sessionStorage.setItem(`photoset_return_${id}`, currentIndex.toString());
  }, [currentIndex, id]);

  useEffect(() => {
    if (!isInitialized && galleryItems.length > 0) {
      if (scrollRef.current && scrollRef.current.clientWidth > 0) {
        const targetX = initialIndex * scrollRef.current.clientWidth;
        scrollRef.current.scrollLeft = targetX;
        setIsInitialized(true);
      } else if (scrollRef.current) {
        const observer = new ResizeObserver((entries) => {
          if (entries[0].contentRect.width > 0 && scrollRef.current) {
            const targetX = initialIndex * entries[0].contentRect.width;
            scrollRef.current.scrollLeft = targetX;
            setIsInitialized(true);
            observer.disconnect();
          }
        });
        observer.observe(scrollRef.current);
        return () => observer.disconnect();
      }
    }
  }, [initialIndex, isInitialized, galleryItems.length]);

  // Re-center on screen rotation or resize
  useEffect(() => {
    const handleResize = () => {
      if (scrollRef.current && isInitialized && !isZoomed) {
        scrollRef.current.scrollLeft = currentIndex * scrollRef.current.clientWidth;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentIndex, isInitialized, isZoomed]);

  const handleScroll = () => {
    if (isExiting.current || isZoomed || !isInitialized) return;
    if (scrollRef.current) {
      const width = scrollRef.current.clientWidth;
      if (width === 0) return;
      const newIndex = Math.round(scrollRef.current.scrollLeft / width);
      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < galleryItems.length) {
        setCurrentIndex(newIndex);
        sessionStorage.setItem(`photoset_return_${id}`, newIndex.toString());
        
        if (scrollDebounce.current) clearTimeout(scrollDebounce.current);
        scrollDebounce.current = setTimeout(() => {
          window.history.replaceState(null, '', `#/photoset/${id}/preview/${newIndex}`);
        }, 80);
      }
    }
  };

  const goBack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isExiting.current = true;
    navigate(`/photoset/${id}`, { replace: true, state: { ...location.state, returningFromPreview: true, returningIndex: currentIndex } });
  };

  if (!link || galleryItems.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-[var(--bg)] flex flex-col items-center justify-center gap-4">
        <Icons.X className="w-10 h-10 text-[var(--text-secondary)]" />
        <button onClick={goBack} className="px-6 py-2 rounded-full font-bold text-sm bg-[var(--surface)] border border-[var(--border)] shadow-md active:scale-95 transition-transform text-[var(--primary)]">Go Back</button>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden gpu-accelerated bg-black"
    >
      {/* Floating Header UI */}
      <div className={`absolute top-0 left-0 right-0 h-16 px-4 z-[170] flex items-center pointer-events-none transition-opacity duration-300 ${isZoomed ? 'opacity-0' : 'bg-transparent'}`}>
        <div className="w-full max-w-2xl mx-auto flex items-center justify-between h-full relative">
          <button onClick={goBack} className={`w-10 h-10 flex items-center justify-center rounded-full bg-[#1c1c1e]/80 backdrop-blur-xl border border-white/10 text-white outline-none transition-all ${isZoomed ? 'pointer-events-none' : 'pointer-events-auto active:scale-90'}`}>
            <CompactIcon size={20}><Icons.ChevronLeft /></CompactIcon>
          </button>
          <div className={`h-10 px-4 flex items-center justify-center rounded-full bg-[#1c1c1e]/80 backdrop-blur-xl border border-white/10 text-white ${isZoomed ? 'pointer-events-none' : 'pointer-events-auto'}`}>
            <span className="text-[13px] font-bold tracking-widest">{currentIndex + 1} / {galleryItems.length}</span>
          </div>
        </div>
      </div>

      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className={`flex-1 flex snap-x snap-mandatory hide-scrollbar gpu-accelerated w-full h-full z-10 ${isZoomed ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
      >
        {galleryItems.map((hdUrl, i) => (
          <div key={i} className="w-full h-full shrink-0 snap-center relative flex items-center justify-center">
            <LazyImage 
              hdUrl={hdUrl}
              index={i}
              currentIndex={currentIndex}
              onZoomChange={setIsZoomed}
            />
          </div>
        ))}
      </div>
    </motion.div>
  );
};
