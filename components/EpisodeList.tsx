import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, Calendar } from 'lucide-react';
import { GoPlayer } from './GoPlayer';
import { useApp } from '../AppContext';
import { useImageFallback } from '../hooks/useImageFallback';
import { HanimeEpisode } from '../types';
import { copyTextToClipboard, hasActiveTextSelection } from '../utils/clipboard';
import { isHanimestreamUrl, extractHanimestreamUrl } from '../utils/hanimestream';
import { SmartEpisodeGallery } from './SmartEpisodeGallery';
import { ShimmerOverlay } from './SkeletonCard';

export interface EpisodeListProps {
  episodes: HanimeEpisode[];
  seriesTitle?: string;
  seriesCover?: string;
  secondaryCovers?: string[];
  seriesDescription?: string;
  seriesAssignedDate?: number;
  seriesCensorship?: 'UNCENSORED' | 'CENSORED';
}

// 1. Episode Booster Thumbnail (Rock-solid, 0ms latency, matching LinkCard skeleton & fade-in)
const EpisodeBoosterThumb = React.memo(({ 
  boosterCover, 
  title 
}: { 
  boosterCover: string; 
  title: string; 
}) => {
  const { 
    src, 
    imgLoaded, 
    hasError, 
    handleError, 
    handleLoad, 
    bindImgRef 
  } = useImageFallback(boosterCover);

  return (
    <div className="w-24 aspect-[5/7] flex-shrink-0 rounded-lg overflow-hidden shadow-md border border-[var(--border)] relative bg-[var(--surface)] transition-[background-color] duration-500">
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
          alt={title}
          className={`w-full h-full object-cover transition-opacity duration-300 ease-in-out ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={handleError}
          onLoad={handleLoad}
        />
      )}
    </div>
  );
});

// 2. Episode Description (Expandable with zero layout jitter)
const EpisodeDescriptionBlock = React.memo(({ text }: { text: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(true);
  const [showToggle, setShowToggle] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (textRef.current && isClamped && !isExpanded) {
      const el = textRef.current;
      const isOverflowing = el.scrollHeight > el.clientHeight + 2;
      setShowToggle(isOverflowing);
    }
  }, [text, isClamped, isExpanded]);

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setIsExpanded(false);
      setIsClamped(true);
    } else {
      setIsExpanded(true);
      setIsClamped(false);
    }
  }, [isExpanded]);

  return (
    <div className="space-y-1.5 mt-3">
      <h3 className="text-[var(--accent)] font-bold text-xs uppercase tracking-wider">Description</h3>
      <div className="relative">
        <p 
          ref={textRef}
          className={`text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-wrap select-text transition-all duration-300 ${
            isClamped ? 'line-clamp-3' : ''
          }`}
        >
          {text}
        </p>
        {showToggle && (
          <button 
            type="button"
            onClick={toggleExpand}
            className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[var(--accent)] mt-1.5 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          >
            {isExpanded ? 'Show Less' : 'Read More'}
            <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
              <ChevronDown size={14} />
            </div>
          </button>
        )}
      </div>
    </div>
  );
});

export const EpisodeList: React.FC<EpisodeListProps> = ({ 
  episodes,
  seriesTitle,
  seriesCover,
  secondaryCovers,
  seriesDescription,
  seriesAssignedDate,
  seriesCensorship
}) => {
  const [playingEpisode, setPlayingEpisode] = useState<HanimeEpisode | null>(null);
  const [extraGalleries, setExtraGalleries] = useState<Record<string, string[]>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());
  const { state } = useApp();
  const { accentColor = '#3b82f6', gradientMask = true } = state.settings;

  // Numerical sorting based on episodeNumber (1, 2, 3...)
  const sortedEpisodes = useMemo(() => {
    return [...episodes].sort((a, b) => {
      const numA = Number(a.episodeNumber) || 0;
      const numB = Number(b.episodeNumber) || 0;
      return numA - numB;
    });
  }, [episodes]);

  // Auto-fetch gallery in background if missing on any hanimestream episode (once per ID)
  useEffect(() => {
    sortedEpisodes.forEach(ep => {
      if (
        (!ep.gallery || ep.gallery.length === 0) && 
        isHanimestreamUrl(ep.url) && 
        !fetchedIdsRef.current.has(ep.id)
      ) {
        fetchedIdsRef.current.add(ep.id);
        extractHanimestreamUrl(ep.url)
          .then(meta => {
            if (meta.gallery && meta.gallery.length > 0) {
              setExtraGalleries(prev => ({ ...prev, [ep.id]: meta.gallery! }));
            }
          })
          .catch(() => {});
      }
    });
  }, [sortedEpisodes]);

  if (episodes.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--text-muted)] text-sm uppercase tracking-widest px-4">
        No episodes available.
      </div>
    );
  }

  const handlePlay = (ep: HanimeEpisode) => {
    setPlayingEpisode(ep);
  };

  return (
    <div className="flex flex-col w-full z-10 contain-layout">
      {sortedEpisodes.map((ep, index) => {
        const epTitle = ep.title || (seriesTitle ? `${seriesTitle} - ${ep.episodeNumber}` : `Episode ${ep.episodeNumber}`);
        // Resolve booster cover: explicit boosterCover -> seriesCover for Ep1 -> secondaryCovers[epNum - 2] -> seriesCover
        const booster = ep.boosterCover || 
          (ep.episodeNumber === 1 ? seriesCover : secondaryCovers?.[ep.episodeNumber - 2]) || 
          seriesCover || '';
        const epDate = ep.assignedDate || seriesAssignedDate;
        const epCensorship = ep.censorship || seriesCensorship || 'UNCENSORED';
        const description = ep.description || seriesDescription;
        const isLastEpisode = index === sortedEpisodes.length - 1;

        // Resolve gallery images: ep.gallery -> in-memory extraGalleries -> ep.coverImage
        const images = (ep.gallery && ep.gallery.length > 0)
          ? ep.gallery
          : (extraGalleries[ep.id] && extraGalleries[ep.id].length > 0)
            ? extraGalleries[ep.id]
            : ep.coverImage
              ? [ep.coverImage]
              : [];

        return (
          <div 
            key={ep.id} 
            className={`flex flex-col w-full overflow-hidden contain-layout ${isLastEpisode ? 'pb-8' : ''}`}
          >
            {/* Episode Top Card (EXACT layout matching top header of HanimeDetail) */}
            <div className="px-4 pt-4 pb-4">
              <div className="flex gap-4 mb-2">
                {/* 1. Booster Cover (Left) */}
                <EpisodeBoosterThumb boosterCover={booster} title={epTitle} />

                {/* 2. Episode Title, Date & Censorship (Right) */}
                <div className="flex flex-col justify-start pt-1 min-w-0 flex-1">
                  <h2 
                    onClick={() => {
                      if (hasActiveTextSelection()) return;
                      copyTextToClipboard(epTitle, {
                        successMessage: `Copied "${epTitle}" to clipboard!`,
                        errorMessage: 'Failed to copy title'
                      });
                    }}
                    title="Click to copy title"
                    className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-pink-100 to-rose-300 leading-normal py-1 mb-2 cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity select-text break-words"
                    style={{ fontFamily: "'Manga', 'Kalam', 'Patrick Hand', 'Comic Sans MS', cursive", letterSpacing: '0.5px' }}
                  >
                    {epTitle}
                  </h2>
                  <div className="flex items-center gap-2 text-white mt-1.5 flex-wrap">
                    <Calendar size={16} className="shrink-0" />
                    <span className="text-[13px] font-bold uppercase tracking-[0.08em] leading-normal pt-[2px] select-text">
                      {epDate ? new Date(epDate).toLocaleDateString('en-CA') : 'No date'}
                    </span>
                    <span className="text-[var(--text-muted)] opacity-50 text-[12px] pt-[1px] ml-1">|</span>
                    <span className={`text-[11px] font-black uppercase tracking-[0.15em] leading-normal pt-[2px] ml-1 select-text ${epCensorship === 'CENSORED' ? 'text-red-400' : 'text-green-400'}`}>
                      {epCensorship || 'UNCENSORED'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Description (Identical to top card) */}
              {description && (
                <EpisodeDescriptionBlock text={description} />
              )}
            </div>

            {/* 4. 16:9 Episode Player / Gallery Swiper Card (Full width side-to-side) */}
            <div 
              className="flex flex-col w-full overflow-hidden bg-black"
            >
              <div 
                className="relative w-full overflow-hidden bg-black aspect-video"
                style={{ WebkitTouchCallout: 'none' }}
              >
                {/* Stable background: Gallery stays intact underneath to completely prevent empty container flash */}
                <div className="absolute inset-0 w-full h-full">
                  <SmartEpisodeGallery
                    images={images}
                    episodeNumber={ep.episodeNumber}
                    accentColor={accentColor}
                    onPlay={() => handlePlay(ep)}
                    isFirstEpisode={index === 0}
                    showGradientMask={gradientMask !== false}
                  />
                </div>

                {playingEpisode?.id === ep.id && (
                  <div 
                    className="absolute inset-0 z-30 bg-black overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GoPlayer 
                      url={ep.url} 
                      title={epTitle}
                      poster={images[0] || booster || seriesCover}
                      accentColor={accentColor} 
                      isCoverEmbed={true}
                      onClose={() => setPlayingEpisode(null)} 
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 5. Pristine Divider Line between the end of this episode card and the subsequent booster data */}
            {!isLastEpisode && (
              <div className="w-full px-4 pt-8 pb-3">
                <div className="h-[2px] bg-[var(--border)] w-full rounded-full opacity-80" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
