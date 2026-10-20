import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useLocation, Navigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { EpisodeList } from '../components/EpisodeList';
import { copyTextToClipboard, hasActiveTextSelection } from '../utils/clipboard';
import { useImageFallback } from '../hooks/useImageFallback';
import { ShimmerOverlay } from '../components/SkeletonCard';

export const HanimeDetail: React.FC = () => {
  const { id } = useParams();
  const { state } = useApp();
  const location = useLocation();
  const hanime = state.hanime.find(h => h.id === id);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(true);
  const [showToggle, setShowToggle] = useState(false);
  const { 
    src: coverSrc, 
    imgLoaded, 
    hasError, 
    handleError: handleCoverError, 
    handleLoad: handleCoverLoad, 
    bindImgRef: bindCoverRef 
  } = useImageFallback(hanime?.coverImage);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (textRef.current && isClamped && !isExpanded) {
      const el = textRef.current;
      const isOverflowing = el.scrollHeight > el.clientHeight + 2;
      setShowToggle(isOverflowing);
    }
  }, [hanime?.description, isClamped, isExpanded]);

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setIsExpanded(false);
      setIsClamped(true);
    } else {
      setIsExpanded(true);
      setIsClamped(false);
    }
  }, [isExpanded]);

  if (!hanime) {
    const fallbackPath = (location.state as any)?.from || '/manage-hanime';
    return <Navigate to={fallbackPath} replace state={(location.state as any)?.returnState} />;
  }

  return (
    <div className="max-w-2xl mx-auto pb-10">
      {/* Header Section - Only shown if no episodes exist */}
      {(!hanime.episodes || hanime.episodes.length === 0) && (
        <div className="px-4 pt-6 pb-8">
          <div className="flex gap-4 mb-6">
            <div className="w-24 aspect-[5/7] flex-shrink-0 rounded-lg overflow-hidden shadow-lg border border-[var(--border)] relative bg-[var(--surface)] transition-[background-color] duration-500">
              <div 
                className={`absolute inset-0 bg-[var(--skeleton-bg)] transition-opacity duration-300 pointer-events-none overflow-hidden ${imgLoaded ? 'opacity-0' : 'opacity-100'}`} 
              >
                <ShimmerOverlay />
              </div>
              {coverSrc && !hasError && (
                <img 
                  ref={bindCoverRef}
                  src={coverSrc} 
                  className={`w-full h-full object-cover transition-opacity duration-300 ease-in-out ${imgLoaded ? 'opacity-100' : 'opacity-0'}`} 
                  alt={hanime.title} 
                  referrerPolicy="no-referrer" 
                  onError={handleCoverError}
                  onLoad={handleCoverLoad}
                />
              )}
            </div>
            <div className="flex flex-col justify-start pt-1 min-w-0 flex-1">
              <h1 
                onClick={() => {
                  if (hasActiveTextSelection()) return;
                  copyTextToClipboard(hanime.title, {
                    successMessage: `Copied "${hanime.title}" to clipboard!`,
                    errorMessage: 'Failed to copy title'
                  });
                }}
                title="Click to copy title"
                className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-pink-100 to-rose-300 leading-normal py-1 mb-2 cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity select-text break-words"
                style={{ fontFamily: "'Manga', 'Kalam', 'Patrick Hand', 'Comic Sans MS', cursive", letterSpacing: '0.5px' }}
              >
                {hanime.title}
              </h1>
              <div className="flex items-center gap-2 text-white mt-1.5 flex-wrap">
                <Icons.Calendar size={16} className="shrink-0" />
                <span className="text-[13px] font-bold uppercase tracking-[0.08em] leading-normal pt-[2px] select-text">
                  {hanime.assignedDate ? new Date(hanime.assignedDate).toLocaleDateString('en-CA') : 'No date'}
                </span>
                <span className="text-[var(--text-muted)] opacity-50 text-[12px] pt-[1px] ml-1">|</span>
                <span className={`text-[11px] font-black uppercase tracking-[0.15em] leading-normal pt-[2px] ml-1 select-text ${hanime.censorship === 'CENSORED' ? 'text-red-400' : 'text-green-400'}`}>
                  {hanime.censorship || 'UNCENSORED'}
                </span>
              </div>
            </div>
          </div>

          {hanime.description && (
            <div className="space-y-1.5">
              <h2 className="text-[var(--accent)] font-bold text-xs uppercase tracking-wider">Description</h2>
              <div className="relative">
                <p 
                  ref={textRef}
                  className={`text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-wrap select-text transition-all duration-300 ${isClamped ? 'line-clamp-3' : ''}`}
                >
                  {hanime.description}
                </p>
                {showToggle && (
                  <button 
                    type="button"
                    onClick={toggleExpand}
                    className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[var(--accent)] mt-1.5 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    {isExpanded ? 'Show Less' : 'Read More'}
                    <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                      <Icons.ChevronDown size={14} />
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
          
          <div className="h-[1px] bg-[var(--border)] w-full mt-6" />
        </div>
      )}

      <div className="flex flex-col w-full">
        <EpisodeList 
          episodes={hanime.episodes} 
          seriesTitle={hanime.title}
          seriesCover={hanime.coverImage}
          secondaryCovers={hanime.secondaryCovers}
          seriesDescription={hanime.description}
          seriesAssignedDate={hanime.assignedDate}
          seriesCensorship={hanime.censorship}
        />
      </div>
    </div>
  );
};
