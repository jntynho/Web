import React, { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { Film } from 'lucide-react';
import { LinkItem, DisplaySize, ButtonStyle, Actor, Studio, AppSettings } from '../types';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { toTitleCase } from '../utils/format';
import { StreamOverlay } from './StreamOverlay';
import { IframeOverlay } from './IframeOverlay';
import { GoPlayer } from './GoPlayer';
import { TrailerCardPreview, TrailerModalPlayer } from './TrailerVideoPlayer';
import { isEpornerUrl } from '../utils/eporner';
import { isPixeldrainUrl } from '../utils/pixeldrain';
import { isBunkrUrl } from '../utils/bunkr';
import { isFilesterUrl } from '../utils/filester';
import { isGofileUrl } from '../utils/gofile';
import { isCyberfileUrl } from '../utils/cyberfile';
import { isFileditchUrl } from '../utils/fileditch';
import { isPornhubUrl, isXhamsterUrl, isPorntrexUrl } from '../utils/videoResolver';
import { hasActiveTextSelection } from '../utils/clipboard';
import { useImageFallback } from '../hooks/useImageFallback';

interface LinkCardProps {
  link: LinkItem;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  deleteLink: (id: string) => void;
  actorMap: Map<string, Actor>;
  studioMap: Map<string, Studio>;
  settings: AppSettings;
}

const getTitleFontSize = (size: DisplaySize) => {
  switch (size) {
    case 'Small': return '0.85rem';
    case 'Large': return '1.1rem';
    default: return '1rem';
  }
};

const getMetaFontSize = (size: DisplaySize) => {
  switch (size) {
    case 'Small': return '0.85rem'; 
    case 'Large': return '1.05rem';
    default: return '0.92rem'; 
  }
};

const getButtonStyle = (style: ButtonStyle, btnId: string) => {
  const semanticColors: Record<string, { bg: string, border: string, glow: string }> = {
    trash: { bg: 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(239, 68, 68, 0.5)' },
    cancel: { bg: 'linear-gradient(135deg, #4b5563 0%, #1f2937 100%)', border: 'rgba(255,255,255,0.3)', glow: 'rgba(0,0,0,0.3)' },
    'cancel-group': { bg: 'linear-gradient(135deg, #4b5563 0%, #1f2937 100%)', border: 'rgba(255,255,255,0.3)', glow: 'rgba(0,0,0,0.3)' },
    edit: { bg: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(34, 197, 94, 0.5)' },
    gallery: { bg: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(168, 85, 247, 0.5)' },
    hd: { bg: 'linear-gradient(135deg, #0ea5e9 0%, #075985 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(14, 165, 233, 0.5)' },
    'stream-hd': { bg: 'linear-gradient(135deg, #0ea5e9 0%, #075985 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(14, 165, 233, 0.5)' },
    '4k': { bg: 'linear-gradient(135deg, #eab308 0%, #854d0e 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(234, 179, 8, 0.5)' },
    'stream-4k': { bg: 'linear-gradient(135deg, #eab308 0%, #854d0e 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(234, 179, 8, 0.5)' },
    'urls-trigger': { bg: 'linear-gradient(135deg, #0ea5e9 0%, #075985 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(14, 165, 233, 0.5)' },
    'magnets-trigger': { bg: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(249, 115, 22, 0.5)' },
    trailer: { bg: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(245, 158, 11, 0.5)' },
    stream: { bg: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(249, 115, 22, 0.5)' }
  };

  const solidColors: Record<string, { bg: string, border: string, glow: string }> = {
    trash: { bg: '#ef4444', border: 'rgba(255,255,255,0.4)', glow: 'rgba(239, 68, 68, 0.5)' },
    cancel: { bg: '#4b5563', border: 'rgba(255,255,255,0.3)', glow: 'rgba(0,0,0,0.3)' },
    'cancel-group': { bg: '#4b5563', border: 'rgba(255,255,255,0.3)', glow: 'rgba(0,0,0,0.3)' },
    edit: { bg: '#22c55e', border: 'rgba(255,255,255,0.4)', glow: 'rgba(34, 197, 94, 0.5)' },
    hd: { bg: '#0ea5e9', border: 'rgba(255,255,255,0.4)', glow: 'rgba(14, 165, 233, 0.5)' },
    'stream-hd': { bg: '#0ea5e9', border: 'rgba(255,255,255,0.4)', glow: 'rgba(14, 165, 233, 0.5)' },
    '4k': { bg: '#eab308', border: 'rgba(255,255,255,0.4)', glow: 'rgba(234, 179, 8, 0.5)' },
    'stream-4k': { bg: '#eab308', border: 'rgba(255,255,255,0.4)', glow: 'rgba(234, 179, 8, 0.5)' },
    'urls-trigger': { bg: '#0ea5e9', border: 'rgba(255,255,255,0.4)', glow: 'rgba(14, 165, 233, 0.5)' },
    'magnets-trigger': { bg: '#f97316', border: 'rgba(255,255,255,0.4)', glow: 'rgba(249, 115, 22, 0.5)' },
    trailer: { bg: '#f59e0b', border: 'rgba(255,255,255,0.4)', glow: 'rgba(245, 158, 11, 0.5)' },
    stream: { bg: '#f97316', border: 'rgba(255,255,255,0.4)', glow: 'rgba(249, 115, 22, 0.5)' }
  };

  switch (style) {
    case 'ColorGlass': {
      const sc = semanticColors[btnId] || { bg: 'linear-gradient(135deg, #333 0%, #000 100%)', border: 'rgba(255,255,255,0.2)', glow: 'transparent' };
      return {
        className: "w-14 h-14 text-white rounded-full flex items-center justify-center shrink-0 active:scale-90 border-2 relative overflow-visible transition-shadow duration-300",
        style: {
          background: sc.bg,
          borderColor: sc.border,
          boxShadow: `0 0 20px ${sc.glow}, inset 0 2px 4px rgba(255,255,255,0.3)`,
        }
      };
    }
    case 'SolidColors': {
      const sc = solidColors[btnId] || { bg: '#333', border: 'rgba(255,255,255,0.2)', glow: 'transparent' };
      return {
        className: "w-14 h-14 text-white rounded-full flex items-center justify-center shrink-0 active:scale-90 border-2 relative overflow-visible transition-shadow duration-300",
        style: {
          backgroundColor: sc.bg,
          borderColor: sc.border,
          boxShadow: `inset 0 2px 4px rgba(255,255,255,0.3)`,
        }
      };
    }
    case 'Glass':
    default:
      return {
        className: "w-14 h-14 text-white rounded-full flex items-center justify-center shrink-0 active:scale-90 shadow-xl border border-white/15 relative overflow-hidden",
        style: {
          backgroundColor: 'rgba(25, 25, 25, 0.4)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }
      };
  }
};

const ActionButton = memo(({ 
  btnId, 
  icon, 
  action, 
  idx, 
  isExpanded, 
  buttonStyle, 
  handleAction,
  additionalDelay = 0
}: {
  btnId: string;
  icon: React.ReactNode;
  action: () => void;
  idx: number;
  isExpanded: boolean;
  buttonStyle: ButtonStyle;
  handleAction: (e: React.MouseEvent, action?: () => void) => void;
  additionalDelay?: number;
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame1 = requestAnimationFrame(() => {
      const frame2 = requestAnimationFrame(() => {
        setMounted(true);
      });
      return () => cancelAnimationFrame(frame2);
    });
    return () => cancelAnimationFrame(frame1);
  }, []);

  const activelyExpanded = isExpanded && mounted;
  const springBezier = "cubic-bezier(0.16, 1, 0.3, 1)";
  const btnStyle = getButtonStyle(buttonStyle, btnId);

  return (
    <button 
      onClick={(e) => handleAction(e, action)} 
      className={btnStyle.className} 
      style={{ 
        ...btnStyle.style,
        transform: activelyExpanded ? 'translateY(0) scale(1.1)' : 'translateY(40px) scale(0.2)',
        opacity: activelyExpanded ? 1 : 0,
        transition: `transform 550ms ${springBezier}, opacity 350ms ease-out`,
        transitionDelay: activelyExpanded ? `${(idx * 45) + additionalDelay}ms` : '0ms',
        willChange: 'transform, opacity',
        position: 'relative'
      }}
    >
      {buttonStyle === 'Glass' && <div className="absolute inset-0 bg-black/30 -z-10" />}
      <div className="relative z-10 w-full h-full flex items-center justify-center overflow-hidden rounded-full">{icon}</div>
    </button>
  );
});

const highlightText = (text: string, query: string, accentColor: string) => {
  if (!query || typeof query !== 'string' || !query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <span key={i} style={{ color: accentColor }}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
};

const LinkCardActorAvatar = memo(({ actor }: { actor: Actor }) => {
  const rawUrl = actor.originalImageUrl || actor.imageUrl;
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(actor.name || 'U')}&background=random`;
  const { src, handleError } = useImageFallback(rawUrl, { fallbackUrl: fallback });

  return (
    <img 
      src={src || fallback} 
      className="w-full h-full object-cover pointer-events-none" 
      style={{
        objectPosition: `${actor.imagePositionX ?? 50}% ${actor.imagePositionY ?? 50}%`,
        transform: `scale(${actor.imageZoom || 1})`,
        transformOrigin: `${actor.imagePositionX ?? 50}% ${actor.imagePositionY ?? 50}%`
      }}
      alt={actor.name}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={handleError}
    />
  );
});

export const LinkCard: React.FC<LinkCardProps> = memo(({ 
  link, 
  isExpanded, 
  onToggle, 
  deleteLink,
  actorMap,
  studioMap,
  settings
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: contextActorId } = useParams();
  const { 
    metadataSize = 'Small', 
    titleSize = 'Medium', 
    blurIntensity = 30, 
    blurCovers = false,
    buttonStyle = 'Glass', 
    actorNameColor = '#3b82f6', 
    showActorCheckmark = true, 
    accentColor = '#3b82f6' 
  } = settings || {};
  const [isConfirming, setIsConfirming] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeMagnet, setActiveMagnet] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<'urls' | 'magnets' | null>(null);
  const [pixeldrainUrl, setPixeldrainUrl] = useState<string | null>(null);
  const [pixeldrainQuality, setPixeldrainQuality] = useState<string | undefined>(undefined);
  const [iframeEmbedUrl, setIframeEmbedUrl] = useState<string | null>(null);
  const [isShowingExtraActors, setIsShowingExtraActors] = useState(false);
  const [isHoveringTrailer, setIsHoveringTrailer] = useState(false);
  const [isTouchTrailerActive, setIsTouchTrailerActive] = useState(false);
  const [isTrailerModalOpen, setIsTrailerModalOpen] = useState(false);
  const trailerHoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (link.trailerUrl && settings?.enableTrailerPreview !== false) {
      if (trailerHoverTimerRef.current) clearTimeout(trailerHoverTimerRef.current);
      trailerHoverTimerRef.current = setTimeout(() => {
        setIsHoveringTrailer(true);
      }, 350);
    }
  };

  const handleMouseLeave = () => {
    if (trailerHoverTimerRef.current) {
      clearTimeout(trailerHoverTimerRef.current);
      trailerHoverTimerRef.current = null;
    }
    setIsHoveringTrailer(false);
  };

  useEffect(() => {
    return () => {
      if (trailerHoverTimerRef.current) clearTimeout(trailerHoverTimerRef.current);
    };
  }, []);

  const {
    src: coverSrc,
    imgLoaded,
    hasError,
    handleError: handleCoverError,
    handleLoad: handleCoverLoad,
    bindImgRef: bindCoverRef,
  } = useImageFallback(link.coverImage);
  
  const actors = useMemo(() => 
    (link.actorIds || []).map(id => (actorMap || new Map<string, Actor>()).get(id)).filter((a): a is Actor => !!a),
    [link.actorIds, actorMap]
  );
  
  const studios = useMemo(() => 
    (link.studioIds || []).map(id => (studioMap || new Map<string, Studio>()).get(id)).filter((t): t is Studio => !!t),
    [link.studioIds, studioMap]
  );
  
  const { actorUsageMap, searchQuery, addNotification } = useApp();
  const primaryStudio = studios[0];
  
  const isActorPage = location.pathname.startsWith('/actor/');

  const primaryActor = useMemo(() => {
    if (!actors || actors.length === 0) return undefined;

    if (isActorPage) {
      return actors.find(a => a.id === contextActorId) || actors[0];
    } else {
      if (actors.length > 1) {
        let maxCount = -1;
        let chosenActor = actors[0];
        (actors || []).forEach(actor => {
          const count = actorUsageMap?.[actor.id] || 0;
          if (count > maxCount) {
            maxCount = count;
            chosenActor = actor;
          }
        });
        return chosenActor;
      }
      return actors[0];
    }
  }, [actors, isActorPage, contextActorId, actorUsageMap]);

  const otherActors = useMemo(() => {
    return actors.filter(a => a.id !== primaryActor?.id);
  }, [actors, primaryActor]);

  const aspectRatio = link.aspectRatio || '16:9';
  const ratioClass = aspectRatio === '3:2' ? 'aspect-[3/2]' : aspectRatio === '5:7' ? 'aspect-[5/7]' : 'aspect-video';

  const toggleExtraActors = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsShowingExtraActors(prev => !prev);
  };

  useEffect(() => {
    if (!isExpanded) {
      const timer = setTimeout(() => {
        setIsConfirming(false);
        setExpandedGroup(null);
        setIsShowingExtraActors(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    if (hasActiveTextSelection()) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  };

  const navigateWithContext = useCallback((path: string) => {
    navigate(path, { state: { from: location.pathname + location.search, returnState: location.state } });
  }, [navigate, location]);

  const easeOutExpo = "cubic-bezier(0.19, 1, 0.22, 1)";

  const handleUrlAction = useCallback((url: string, qualityHint?: string) => {
    if (isPixeldrainUrl(url) || isBunkrUrl(url) || isFilesterUrl(url) || isGofileUrl(url) || isCyberfileUrl(url) || isFileditchUrl(url) || isEpornerUrl(url) || isPornhubUrl(url) || isXhamsterUrl(url) || isPorntrexUrl(url)) {
      setPixeldrainQuality(qualityHint);
      setPixeldrainUrl(url);
    } else {
      window.open(url, '_blank');
    }
  }, []);

  const handleStreamAction = useCallback((magnet: string) => {
    setActiveMagnet(magnet);
    setIsStreaming(true);
  }, []);

  const actions = useMemo(() => {
    const mainActions = [];
    
    if (expandedGroup === 'urls') {
      if (link.urlHD) mainActions.push({ id: 'hd', icon: <Icons.HD />, action: () => handleUrlAction(link.urlHD!, '1080p') });
      if (link.url4K) mainActions.push({ id: '4k', icon: <Icons.FourK />, action: () => handleUrlAction(link.url4K!, '2160p') });
    } else if (expandedGroup === 'magnets') {
      if (link.magnet) mainActions.push({ id: 'stream-hd', icon: <Icons.HD />, action: () => handleStreamAction(link.magnet!) });
      if (link.magnet4K) mainActions.push({ id: 'stream-4k', icon: <Icons.FourK />, action: () => handleStreamAction(link.magnet4K!) });
    } else {
      // Group triggers
      const hasUrls = link.urlHD || link.url4K;
      const hasMagnets = link.magnet || link.magnet4K;

      if (hasUrls) {
        mainActions.push({ 
          id: 'urls-trigger', 
          icon: <Icons.Play />, 
          action: () => setExpandedGroup('urls')
        });
      }

      if (hasMagnets) {
        mainActions.push({ 
          id: 'magnets-trigger', 
          icon: <Icons.Stream />, 
          action: () => setExpandedGroup('magnets')
        });
      }

      if (link.trailerUrl) {
        mainActions.push({
          id: 'trailer',
          icon: <Film className="w-5 h-5 text-amber-400" />,
          action: () => setIsTrailerModalOpen(true)
        });
      }

      mainActions.push({ id: 'edit', icon: <Icons.Edit />, action: () => navigate(`/edit/${link.id}`, { state: { from: location.pathname + location.search, returnState: location.state } }) });
      mainActions.push({ id: 'trash', icon: <Icons.Trash />, action: () => setIsConfirming(true) });
    }

    return mainActions;
  }, [link, expandedGroup, navigate, location, handleUrlAction, handleStreamAction]);

  return (
    <div 
      className="flex flex-col w-full overflow-hidden gpu-accelerated group transition-[background-color] duration-500"
      style={{ backgroundColor: 'var(--bg)' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div 
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={() => {
          if (isShowingExtraActors) setIsShowingExtraActors(false);
          else if (expandedGroup) setExpandedGroup(null);
          else onToggle(link.id);
        }}
        className={`relative w-full cursor-pointer overflow-hidden bg-[var(--surface)] transition-[background-color] duration-500 ${ratioClass}`}
        style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
      >
        {coverSrc && !hasError && (
          <div className="absolute inset-0 transition-transform duration-500 ease-out" style={{ transform: (isExpanded || isShowingExtraActors) ? 'scale(1.05)' : 'scale(1)' }}>
            {aspectRatio === 'Adaptive' && (
              <img 
                src={coverSrc}
                alt="Background Blur"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                onError={handleCoverError}
                ref={bindCoverRef}
                onLoad={handleCoverLoad}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ 
                  objectPosition: `center ${link.coverOffset ?? 50}%`,
                  zIndex: 1,
                  opacity: imgLoaded ? 0.5 : 0,
                  transition: 'opacity 300ms ease-in-out',
                  filter: blurCovers ? `blur(${Math.max(20, blurIntensity)}px)` : 'blur(20px)'
                }}
              />
            )}
            <img 
              src={coverSrc}
              alt={link.title}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={handleCoverError}
              ref={bindCoverRef}
              onLoad={handleCoverLoad}
              className={`absolute inset-0 w-full h-full ${aspectRatio === 'Adaptive' ? 'object-contain' : 'object-cover'}`}
              style={{ 
                objectPosition: `center ${link.coverOffset ?? 50}%`,
                opacity: imgLoaded ? 1 : 0,
                transition: 'opacity 300ms ease-in-out',
                zIndex: 2,
                filter: blurCovers ? `blur(${blurIntensity}px)` : 'none'
              }}
            />
          </div>
        )}

        {/* Video Trailer Preview on hover / active */}
        {link.trailerUrl && (
          <TrailerCardPreview
            trailerUrl={link.trailerUrl}
            isActive={Boolean((isHoveringTrailer || isTouchTrailerActive) && !isExpanded)}
            aspectRatio={aspectRatio}
            coverOffset={link.coverOffset}
          />
        )}

        {/* Quick Mobile / Touch Trailer Play Badge */}
        {link.trailerUrl && !isExpanded && (
          <button
            type="button"
            title={isTouchTrailerActive ? "Stop Trailer Preview" : "Play Trailer Preview"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsTouchTrailerActive(prev => !prev);
            }}
            className={`absolute top-2.5 right-2.5 z-[15] flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide backdrop-blur-md transition-all duration-300 shadow-md ${
              isTouchTrailerActive 
                ? 'bg-amber-500 text-white shadow-amber-500/40 ring-2 ring-amber-400/50' 
                : 'bg-black/60 text-white/95 hover:bg-black/80 border border-white/20 hover:scale-105'
            }`}
          >
            <Film className={`w-3.5 h-3.5 ${isTouchTrailerActive ? 'text-white' : 'text-amber-400'}`} />
            <span>{isTouchTrailerActive ? 'Stop' : 'Trailer'}</span>
          </button>
        )}

        <div className="absolute inset-0 bg-black/70 transition-opacity duration-500 ease-out z-10" style={{ opacity: (isExpanded || isShowingExtraActors) ? 1 : 0, pointerEvents: 'none', backdropFilter: (isExpanded || isShowingExtraActors) ? `blur(${blurIntensity/10}px)` : 'none', WebkitBackdropFilter: (isExpanded || isShowingExtraActors) ? `blur(${blurIntensity/10}px)` : 'none' }} />
        
        <div className="absolute inset-0 flex flex-col items-center justify-center z-[20] gpu-accelerated overflow-hidden will-change-[opacity]" style={{ opacity: isExpanded ? 1 : 0, pointerEvents: isExpanded ? 'auto' : 'none', transition: `opacity 400ms ${easeOutExpo}` }}>
          <div className="flex flex-wrap items-center justify-center gap-6 px-10 max-w-full">
            {isConfirming ? (
              <>
                <ActionButton 
                  btnId="cancel"
                  icon={<Icons.X />}
                  action={() => setIsConfirming(false)}
                  idx={0}
                  isExpanded={isExpanded}
                  buttonStyle={buttonStyle}
                  handleAction={handleAction}
                  additionalDelay={0}
                />
                <ActionButton 
                  btnId="trash"
                  icon={<div className="scale-110"><Icons.Trash /></div>}
                  action={() => {
                    deleteLink(link.id);
                    addNotification("Link deleted permanently", "success");
                  }}
                  idx={1}
                  isExpanded={isExpanded}
                  buttonStyle={buttonStyle}
                  handleAction={handleAction}
                  additionalDelay={0}
                />
              </>
            ) : (
              actions.map((btn, idx) => (
                <ActionButton 
                  key={btn.id}
                  btnId={btn.id}
                  icon={btn.icon}
                  action={btn.action}
                  idx={idx}
                  isExpanded={isExpanded}
                  buttonStyle={buttonStyle}
                  handleAction={handleAction}
                  additionalDelay={0}
                />
              ))
            )}
          </div>
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center z-[100] gpu-accelerated pointer-events-none">
          <div className="flex flex-wrap items-center justify-center content-center gap-4 sm:gap-6 px-6 py-4 max-w-full h-full overflow-y-auto hide-scrollbar pointer-events-none" style={{ pointerEvents: isShowingExtraActors ? 'auto' : 'none' }}>
            {otherActors.slice(0, 8).map((actor, idx) => (
              <ActionButton
                key={actor.id}
                btnId={`extra-actor-${actor.id}`}
                icon={
                  (actor.originalImageUrl || actor.imageUrl) ? (
                    <LinkCardActorAvatar actor={actor} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-lg bg-neutral-800 text-white/70">
                      {(actor.name || 'U').slice(0, 1).toUpperCase()}
                    </div>
                  )
                }
                action={() => navigateWithContext(`/actor/${actor.id}`)}
                idx={idx}
                isExpanded={isShowingExtraActors}
                buttonStyle={buttonStyle}
                handleAction={handleAction}
              />
            ))}
          </div>
        </div>

        {isStreaming && activeMagnet && (
          <StreamOverlay 
            key={`${link.id}-stream`}
            magnet={activeMagnet} 
            torboxApiKey={settings.enableTorbox !== false ? (settings.torboxApiKey || '') : ''} 
            realDebridApiKey={settings.enableRealDebrid !== false ? (settings.realDebridApiKey || '') : ''}
            itemTitle={link.title}
            itemActors={actors.map(a => a.name)}
            itemTags={studios.map(t => t.name)}
            onClose={() => {
              setIsStreaming(false);
              setActiveMagnet(null);
            }} 
          />
        )}

        {pixeldrainUrl && (
          <GoPlayer
            url={pixeldrainUrl}
            title={link.title}
            accentColor={accentColor}
            initialQuality={pixeldrainQuality}
            isCoverEmbed={true}
            onClose={() => {
              setPixeldrainUrl(null);
              setPixeldrainQuality(undefined);
            }}
          />
        )}

        {iframeEmbedUrl && (
          <IframeOverlay 
            key={`${link.id}-iframe`}
            url={iframeEmbedUrl} 
            onClose={() => setIframeEmbedUrl(null)} 
          />
        )}
      </div>
      
      <div className="pl-3 pr-3 pt-3 pb-4 w-full transition-colors duration-500" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="flex flex-col w-full">
          <div className="flex justify-between items-end w-full mb-1 min-w-0">
            <div className="flex items-end min-w-0 pr-2 h-6">
              <div className="flex items-end gap-1.5 truncate min-w-0">
                {!primaryActor ? (
                  <span className="font-black uppercase tracking-[0.15em] leading-none py-0.5" style={{ fontSize: getMetaFontSize(metadataSize), color: 'var(--text-muted)' }}>Unlabeled</span>
                ) : (
                  <>
                    <span 
                      onClick={(e) => handleAction(e, () => navigateWithContext(`/actor/${primaryActor.id}`))}
                      className="font-black tracking-[0.05em] leading-none cursor-pointer active:opacity-60 transition-all duration-300 whitespace-nowrap py-0.5" 
                      style={{ fontSize: getMetaFontSize(metadataSize), color: actorNameColor }}
                    >
                      {toTitleCase(primaryActor.name)}
                    </span>
                    {showActorCheckmark && (<div className="shrink-0 mb-[3px]"><Icons.Verified color={actorNameColor} /></div>)}
                    {otherActors.length > 0 && (
                      <button 
                        type="button"
                        aria-label={`View ${otherActors.length} more actors`}
                        onClick={toggleExtraActors} 
                        className="shrink-0 mb-[3px] ml-0.5 transition-all outline-none flex items-center justify-center" 
                        title={`+${otherActors.length} more`}
                      >
                         <Icons.UserBadge color={actorNameColor} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-end justify-end shrink-0 pl-4 h-6">
              <div className="flex items-end gap-x-1 text-[var(--text-secondary)] font-black tracking-widest" style={{ fontSize: '0.62rem' }}>
                {link.galleryUrls && link.galleryUrls.length > 0 && (
                  <div className="shrink-0 opacity-80 mb-[3px]" style={{ color: actorNameColor }} title="Contains Gallery">
                    <Icons.GalleryIcon />
                  </div>
                )}
                {primaryStudio && (<span className="whitespace-nowrap cursor-pointer opacity-60 hover:opacity-100 active:opacity-100 transition-opacity py-0.5" onClick={(e) => handleAction(e, () => navigateWithContext(`/studio/${primaryStudio.id}`))}>{primaryStudio.name}</span>)}
              </div>
            </div>
          </div>
          <div className="flex justify-between items-end w-full min-w-0">
            <h3 
              onClick={(e) => {
                if (hasActiveTextSelection()) return;
                if (link.galleryUrls && link.galleryUrls.length > 0) {
                  handleAction(e, () => navigateWithContext(`/photoset/${link.id}`));
                }
              }}
              className={`text-[var(--text-primary)] font-bold leading-none tracking-tight text-left truncate flex-1 min-w-0 ${link.galleryUrls && link.galleryUrls.length > 0 ? 'cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity' : ''}`} 
              style={{ fontSize: getTitleFontSize(titleSize) }}
            >
              {highlightText(link.title, searchQuery, 'var(--accent)')}
            </h3>
            {link.assignedDate && link.assignedDate > 0 && (
              <div className="text-[0.65rem] font-black tracking-widest opacity-50 shrink-0 pl-4 pb-[1px]" style={{ color: 'var(--text-secondary)' }}>
                {new Date(link.assignedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        </div>
      </div>

      {isTrailerModalOpen && link.trailerUrl && (
        <TrailerModalPlayer
          trailerUrl={link.trailerUrl}
          title={link.title}
          onClose={() => setIsTrailerModalOpen(false)}
        />
      )}
    </div>
  );
});
