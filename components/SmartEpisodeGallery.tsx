import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useImageFallback } from '../hooks/useImageFallback';

export interface SmartEpisodeGalleryProps {
  images: string[];
  episodeNumber: number;
  onPlay: () => void;
  isFirstEpisode?: boolean;
  showGradientMask?: boolean;
  accentColor?: string;
  autoPlayInterval?: number; // Custom interval in ms, or auto-calculated
  enableSmartAutoScroll?: boolean;
  onTelemetryUpdate?: (data: GalleryTelemetryData) => void;
}

export interface GalleryTelemetryData {
  activeIndex: number;
  totalImages: number;
  intersectionRatio: number;
  engineState: 'PLAYING' | 'USER_INTERACTING' | 'COOLDOWN' | 'OFFSCREEN' | 'TAB_HIDDEN' | 'PAGE_SCROLLING' | 'DISABLED';
  remainingMs: number;
  lastEvent: string;
}

const GallerySlide = React.memo(({
  imgUrl,
  alt,
  eager = false
}: {
  imgUrl: string;
  alt: string;
  eager?: boolean;
}) => {
  const [loaded, setLoaded] = useState(false);
  const { src, handleError } = useImageFallback(imgUrl);

  return (
    <div className="min-w-full w-full h-full snap-center shrink-0 relative bg-[var(--surface)] overflow-hidden">
      {/* Subtle skeleton placeholder */}
      <div 
        className={`absolute inset-0 bg-white/[0.03] z-0 transition-opacity duration-300 pointer-events-none ${
          loaded ? 'opacity-0' : 'opacity-100'
        }`} 
      />
      {src && (
        <img 
          src={src} 
          alt={alt}
          className={`w-full h-full object-cover select-none pointer-events-none transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          referrerPolicy="no-referrer"
          loading={eager ? "eager" : "lazy"}
          onError={handleError}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
});

export const SmartEpisodeGallery: React.FC<SmartEpisodeGalleryProps> = React.memo(({
  images,
  episodeNumber,
  onPlay,
  isFirstEpisode = false,
  showGradientMask = true,
  accentColor = 'var(--accent)',
  autoPlayInterval,
  enableSmartAutoScroll = true,
  onTelemetryUpdate
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  
  // State refs for zero-overhead performance
  const isVisibleRef = useRef(false);
  const isUserInteractingRef = useRef(false);
  const userCooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const autoPlayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAdvanceTimeRef = useRef(Date.now());

  // Dynamic pacing based on image count:
  const resolvedInterval = useMemo(() => {
    if (autoPlayInterval && autoPlayInterval > 0) return autoPlayInterval;
    if (images.length <= 1) return 0;
    if (images.length <= 3) return 4200; // Longer reading time for few slides
    if (images.length <= 8) return 3500; // Standard pace
    return 2900; // Faster glide for dense screenshot sets
  }, [autoPlayInterval, images.length]);

  // Keep active index ref synced
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const emitTelemetry = useCallback((event: string, stateOverride?: any) => {
    if (!onTelemetryUpdate) return;
    const currentState = stateOverride || (
      !enableSmartAutoScroll || images.length <= 1
        ? 'DISABLED'
        : typeof document !== 'undefined' && document.hidden
        ? 'TAB_HIDDEN'
        : isUserInteractingRef.current
        ? 'USER_INTERACTING'
        : userCooldownTimerRef.current
        ? 'COOLDOWN'
        : !isVisibleRef.current
        ? 'OFFSCREEN'
        : 'PLAYING'
    );
    const elapsed = Date.now() - lastAdvanceTimeRef.current;
    const remaining = Math.max(0, resolvedInterval - elapsed);

    onTelemetryUpdate({
      activeIndex: activeIndexRef.current,
      totalImages: images.length,
      intersectionRatio: isVisibleRef.current ? 1.0 : 0,
      engineState: currentState,
      remainingMs: remaining,
      lastEvent: event
    });
  }, [onTelemetryUpdate, enableSmartAutoScroll, images.length, resolvedInterval]);

  // Advance to next slide smoothly
  const advanceSlide = useCallback((targetIndex?: number) => {
    if (!scrollRef.current || images.length <= 1) return;
    const container = scrollRef.current;
    const width = container.clientWidth;
    if (width <= 0) return;

    const nextIndex = typeof targetIndex === 'number' 
      ? targetIndex 
      : (activeIndexRef.current + 1) % images.length;

    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    lastAdvanceTimeRef.current = Date.now();

    container.scrollTo({
      left: nextIndex * width,
      behavior: 'smooth'
    });
  }, [images.length]);

  // Restart auto-play timer efficiently ONLY when visible and allowed
  const resetTimer = useCallback(() => {
    if (autoPlayTimerRef.current) {
      clearInterval(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }

    if (
      !enableSmartAutoScroll || 
      images.length <= 1 || 
      resolvedInterval <= 0 || 
      !isVisibleRef.current || 
      isUserInteractingRef.current || 
      userCooldownTimerRef.current ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }

    lastAdvanceTimeRef.current = Date.now();
    autoPlayTimerRef.current = setInterval(() => {
      advanceSlide();
      emitTelemetry('Auto-advanced slide', 'PLAYING');
    }, resolvedInterval);
  }, [enableSmartAutoScroll, images.length, resolvedInterval, advanceSlide, emitTelemetry]);

  // 1. Zero-Cost Intersection Observer (No setState during scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || images.length <= 1 || !enableSmartAutoScroll) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const isNowVisible = entry.isIntersecting && entry.intersectionRatio >= 0.45;
          if (isVisibleRef.current !== isNowVisible) {
            isVisibleRef.current = isNowVisible;
            if (isNowVisible) {
              resetTimer();
              emitTelemetry('Became visible in viewport', 'PLAYING');
            } else {
              if (autoPlayTimerRef.current) {
                clearInterval(autoPlayTimerRef.current);
                autoPlayTimerRef.current = null;
              }
              emitTelemetry('Scrolled out of viewport', 'OFFSCREEN');
            }
          }
        }
      },
      {
        threshold: [0, 0.45],
        rootMargin: '0px'
      }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (autoPlayTimerRef.current) {
        clearInterval(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
      }
    };
  }, [images.length, enableSmartAutoScroll, resetTimer, emitTelemetry]);

  // 2. Tab Visibility (Pause on background tab)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (autoPlayTimerRef.current) {
          clearInterval(autoPlayTimerRef.current);
          autoPlayTimerRef.current = null;
        }
        emitTelemetry('Browser tab hidden', 'TAB_HIDDEN');
      } else {
        resetTimer();
        emitTelemetry('Browser tab focused', 'PLAYING');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [resetTimer, emitTelemetry]);

  // 3. User Touch / Pointer Handling
  const handlePointerDown = (e: React.PointerEvent) => {
    isUserInteractingRef.current = true;
    if (autoPlayTimerRef.current) {
      clearInterval(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    if (userCooldownTimerRef.current) {
      clearTimeout(userCooldownTimerRef.current);
      userCooldownTimerRef.current = null;
    }
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    };
    emitTelemetry('User touch began', 'USER_INTERACTING');
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!pointerStartRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    const duration = Date.now() - pointerStartRef.current.time;
    pointerStartRef.current = null;

    isUserInteractingRef.current = false;

    // Tap detection: short duration + minimal movement -> Play video
    if (dx < 10 && dy < 10 && duration < 350) {
      onPlay();
      return;
    }

    // Cooldown timer before auto-advance resumes
    emitTelemetry('User touch released -> Cooldown', 'COOLDOWN');
    userCooldownTimerRef.current = setTimeout(() => {
      userCooldownTimerRef.current = null;
      resetTimer();
      emitTelemetry('Cooldown ended -> AutoPlay resumed', 'PLAYING');
    }, 4000);
  };

  // Sync index from manual scrolling
  const handleContainerScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const width = el.clientWidth;
    if (width <= 0) return;

    const exactIndex = Math.round(el.scrollLeft / width);
    if (exactIndex >= 0 && exactIndex < images.length && exactIndex !== activeIndexRef.current) {
      activeIndexRef.current = exactIndex;
      setActiveIndex(exactIndex);
      lastAdvanceTimeRef.current = Date.now();
      emitTelemetry(`Snapped to slide ${exactIndex + 1}`);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video overflow-hidden bg-[var(--surface)] group select-none cursor-pointer"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ touchAction: 'pan-x' }}
    >
      {/* 1. Horizontal Snap Container */}
      <div
        ref={scrollRef}
        onScroll={handleContainerScroll}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {images.map((img, idx) => (
          <GallerySlide
            key={idx}
            imgUrl={img}
            alt={`Episode ${episodeNumber} slide ${idx + 1}`}
            eager={isFirstEpisode && idx === 0}
          />
        ))}
      </div>

      {/* 2. Top & Bottom Gradient Masks */}
      {showGradientMask && (
        <>
          <div 
            className="absolute top-0 inset-x-0 z-10 pointer-events-none transition-opacity duration-300 overflow-hidden"
            style={{ height: '26%' }}
          >
            <div 
              className="w-full h-full"
              style={{
                background: 'linear-gradient(to bottom, var(--bg) 0%, transparent 100%)'
              }}
            />
          </div>

          <div 
            className="absolute bottom-0 inset-x-0 z-10 pointer-events-none transition-opacity duration-300 overflow-hidden"
            style={{ height: '28%' }}
          >
            <div 
              className="w-full h-full"
              style={{
                background: 'linear-gradient(to top, var(--bg) 0%, transparent 100%)'
              }}
            />
          </div>
        </>
      )}

      {/* 3. Multi-cover Dash Indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20 pointer-events-none drop-shadow-md">
          {images.map((_, i) => (
            <div 
              key={i} 
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === activeIndex 
                  ? 'w-4 bg-white shadow-sm' 
                  : 'w-1.5 bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});
