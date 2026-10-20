import React, { useState, useMemo, useRef, memo, useCallback } from 'react';
import { useImageFallback } from '../hooks/useImageFallback';
import { ShimmerOverlay } from './SkeletonCard';
import { useApp } from '../AppContext';

interface HanimeCoverSliderProps {
  hanime: any;
}

const HanimeSlideImg = memo(({ 
  cover, 
  index, 
  title, 
  coverOffset,
  blurCovers,
  blurIntensity
}: { 
  cover: string; 
  index: number; 
  title: string; 
  coverOffset?: number; 
  blurCovers?: boolean;
  blurIntensity?: number;
}) => {
  const { 
    src, 
    imgLoaded, 
    hasError, 
    handleError, 
    handleLoad, 
    bindImgRef 
  } = useImageFallback(cover);

  return (
    <div className="w-full h-full shrink-0 snap-center relative bg-[var(--surface)] transition-[background-color] duration-500 overflow-hidden">
      {/* Background skeleton layer with Shimmer matching LinkCard */}
      <div 
        className={`absolute inset-0 bg-[var(--skeleton-bg)] transition-opacity duration-300 pointer-events-none overflow-hidden ${
          imgLoaded ? 'opacity-0' : 'opacity-100'
        }`} 
      >
        <ShimmerOverlay />
      </div>

      {src && !hasError && (
        <img
          ref={bindImgRef}
          src={src}
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          style={{ 
            objectPosition: `center ${index === 0 ? (coverOffset ?? 50) : 50}%`,
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 300ms ease-in-out',
            zIndex: 2,
            filter: blurCovers ? `blur(${blurIntensity || 30}px)` : 'none'
          }}
          alt={`${title} cover ${index + 1}`}
          referrerPolicy="no-referrer"
          draggable="false"
          loading={index === 0 ? "eager" : "lazy"}
          decoding="async"
          onError={handleError}
          onLoad={handleLoad}
        />
      )}
    </div>
  );
});

export const HanimeCoverSlider = memo(({ hanime }: HanimeCoverSliderProps) => {
  const { state } = useApp();
  const { blurCovers = false, blurIntensity = 30 } = state?.settings || {};
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const allCovers = useMemo(() => {
    const covers = [hanime.coverImage];
    if (hanime.secondaryCovers && hanime.secondaryCovers.length > 0) {
      covers.push(...hanime.secondaryCovers);
    }
    return covers.filter(Boolean);
  }, [hanime.coverImage, hanime.secondaryCovers]);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || allCovers.length <= 1) return;
    const el = scrollContainerRef.current;
    const width = el.clientWidth;
    if (width > 0) {
      const newIndex = Math.round(el.scrollLeft / width);
      if (newIndex >= 0 && newIndex < allCovers.length && newIndex !== currentIndex) {
        setCurrentIndex(newIndex);
      }
    }
  }, [allCovers.length, currentIndex]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-[var(--surface)] transition-[background-color] duration-500">
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {allCovers.map((cover, i) => (
          <HanimeSlideImg 
            key={`${cover}-${i}`}
            cover={cover}
            index={i}
            title={hanime.title}
            coverOffset={hanime.coverOffset}
            blurCovers={blurCovers}
            blurIntensity={blurIntensity}
          />
        ))}
      </div>
      
      {allCovers.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10 pointer-events-none drop-shadow-md">
          {allCovers.map((_, i) => (
            <div 
              key={i} 
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentIndex ? 'w-3.5 bg-white' : 'w-1.5 bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});
