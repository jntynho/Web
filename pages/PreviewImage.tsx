
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { useImageFallback } from '../hooks/useImageFallback';

interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const ZoomableImage: React.FC<{ 
  url: string; 
  isActive: boolean; 
  onInteraction: (isZoomed: boolean) => void 
}> = ({ url, isActive, onInteraction }) => {
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const { src: effectiveUrl, handleError: handleImgError } = useImageFallback(url);
  const imgRef = useRef<HTMLImageElement>(null);
  
  const lastTouch = useRef({ x: 0, y: 0, dist: 0 });
  const lastScale = useRef(1);
  const lastTap = useRef(0);

  // Reset zoom when image becomes inactive
  useEffect(() => {
    if (!isActive) {
      setZoom({ scale: 1, x: 0, y: 0 });
      onInteraction(false);
    }
  }, [isActive, onInteraction]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0 };
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouch.current.dist = dist;
      lastScale.current = zoom.scale;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Priority 1: Pinch to Zoom (Always allowed)
    if (e.touches.length === 2) {
      e.preventDefault(); 
      e.stopPropagation(); 
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = Math.max(1, Math.min(5, lastScale.current * (dist / lastTouch.current.dist)));
      setZoom(prev => ({ ...prev, scale }));
      onInteraction(scale > 1.05);
      return;
    }

    // Priority 2: Pan (Only if zoomed)
    if (e.touches.length === 1 && zoom.scale > 1.05) {
      e.preventDefault(); 
      e.stopPropagation(); 
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      
      setZoom(prev => ({
        ...prev,
        x: prev.x + dx / prev.scale,
        y: prev.y + dy / prev.scale
      }));
      
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0 };
    }
  };

  const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (zoom.scale > 1.05) {
        setZoom({ scale: 1, x: 0, y: 0 });
        onInteraction(false);
      } else {
        setZoom({ scale: 3, x: 0, y: 0 });
        onInteraction(true);
      }
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  return (
    <div 
      className="w-full h-full flex items-center justify-center overflow-hidden touch-pan-x touch-pan-y"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onClick={handleDoubleTap}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
        </div>
      )}
      {loaded && effectiveUrl && (
        <img
          ref={imgRef}
          src={effectiveUrl}
          referrerPolicy="no-referrer"
          onError={handleImgError}
          onLoad={() => { setTimeout(() => setLoaded(true), 250); }}
          style={{
            transform: `scale(${zoom.scale}) translate(${zoom.x}px, ${zoom.y}px)`,
            transition: zoom.scale === 1 ? 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1)' : 'none',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain'
          }}
          className={`select-none pointer-events-none transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          alt=""
        />
      )}
      {!loaded && effectiveUrl && (
        <img
          ref={imgRef}
          src={effectiveUrl}
          referrerPolicy="no-referrer"
          onError={handleImgError}
          onLoad={() => { setTimeout(() => setLoaded(true), 250); }}
          style={{
            display: 'none'
          }}
          alt=""
        />
      )}
    </div>
  );
};

export const PreviewImage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useApp();
  const { galleryBgColor } = state.settings;

  const searchParams = new URLSearchParams(location.search);
  const initialIndex = parseInt(searchParams.get('index') || '0');

  const link = state.links.find(l => l.id === id);
  const urls = link?.galleryUrls || [];
  const [index, setIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && initialIndex > 0) {
      requestAnimationFrame(() => {
        el.scrollLeft = initialIndex * el.clientWidth;
      });
    }
  }, [initialIndex]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const newIndex = Math.round(el.scrollLeft / el.clientWidth);
    if (newIndex !== index && newIndex >= 0 && newIndex < urls.length) {
      setIndex(newIndex);
    }
  };

  const onClose = () => {
    if (location.state?.from) {
      navigate(location.state.from, { replace: true, state: location.state?.returnState });
    } else if (window.history.length > 1 && location.key !== "default") {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
  };

  if (!link || urls.length === 0) return null;

  return (
    <div 
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center animate-fade-in-fast overflow-hidden"
      style={{ backgroundColor: galleryBgColor }}
    >
      <div className="absolute inset-0 backdrop-blur-3xl opacity-30 pointer-events-none" />

      <div className={`absolute top-4 left-5 z-[1010] pointer-events-none transition-opacity duration-300 ${isZoomed ? 'opacity-0' : 'opacity-100'}`}>
        <span className="text-[12px] font-black text-white/70 tracking-[0.12em] select-none pointer-events-auto leading-none">
          {index + 1}/{urls.length}
        </span>
      </div>

      <button 
        onClick={onClose}
        className={`absolute top-4 right-5 z-[1010] w-10 h-10 rounded-full bg-black/40 backdrop-blur-[32px] border border-white/15 flex items-center justify-center text-white active:scale-90 transition-all pointer-events-auto shadow-md ${isZoomed ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100 scale-100'}`}
      >
        <Icons.X />
      </button>

      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="w-full h-full flex overflow-x-auto snap-x snap-mandatory hide-scrollbar gpu-accelerated overscroll-x-contain"
        style={{ scrollBehavior: 'auto' }}
      >
        {urls.map((url, i) => (
          <div 
            key={`${url}-${i}`} 
            className="w-full h-full shrink-0 snap-center snap-always relative flex items-center justify-center"
          >
            <ZoomableImage 
              url={url} 
              isActive={index === i} 
              onInteraction={setIsZoomed}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
