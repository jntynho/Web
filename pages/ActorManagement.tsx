import React, {
  useMemo,
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { toTitleCase } from "../utils/format";
import { SkeletonListItem } from "../components/SkeletonCard";
import { hasActiveTextSelection } from "../utils/clipboard";
import { useImageFallback } from "../hooks/useImageFallback";

const ActorListItem = memo(
  ({
    actor,
    onClick,
    borderColor,
  }: {
    actor: any;
    onClick: () => void;
    borderColor?: string;
  }) => {
    const rawSrc = actor.originalImageUrl || actor.imageUrl;
    const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(actor.name)}&background=random`;
    const {
      src: imgSrc,
      imgLoaded,
      handleError,
      handleLoad,
      bindImgRef,
    } = useImageFallback(rawSrc, { fallbackUrl: avatarFallback });

    return (
      <div className="w-full relative">
        <div
          onClick={() => {
            if (hasActiveTextSelection()) return;
            onClick();
          }}
          className="flex items-center gap-4 px-2 py-4 relative active:bg-[var(--text-primary)]/[0.03] cursor-pointer group"
        >
          <div
            className="w-16 h-16 rounded-full overflow-hidden bg-[var(--surface)] border-[2px] shrink-0 shadow-md relative"
            style={{ borderColor: borderColor }}
          >
            <img
              src={imgSrc || avatarFallback}
              alt={actor.name}
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
              onError={handleError}
              ref={bindImgRef}
              onLoad={handleLoad}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ 
                objectPosition: `${actor.imagePositionX ?? 50}% ${actor.imagePositionY ?? 50}%`,
                transform: `scale(${actor.imageZoom || 1})`,
                transformOrigin: `${actor.imagePositionX ?? 50}% ${actor.imagePositionY ?? 50}%`,
                opacity: imgLoaded ? 1 : 0,
                transition: 'opacity 300ms ease-in-out'
              }}
            />
          </div>
          <div className="flex-1 flex flex-col justify-center min-w-0">
            <span className="text-[var(--text-primary)] font-bold text-[17px] tracking-normal truncate leading-relaxed">
              {toTitleCase(actor.name)}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[var(--text-muted)] text-[13px] truncate font-medium">
                {actor.linksCount || 0} Link{actor.linksCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export const ActorManagement: React.FC = React.memo(() => {
  const { state, searchQuery, isHydrated } = useApp();
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    sortOrder: globalSortOrder,
    actorSortOrder,
    circleBorderColor,
  } = state.settings;
  const sortOrder = actorSortOrder || globalSortOrder;

  const [visibleCount, setVisibleCount] = useState(100);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [isLoading, setIsLoading] = useState(true);

  // Trigger skeleton loading on entry and on search/sort change with comfortable 400ms standard duration
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [location.pathname, location.key, deferredSearchQuery, sortOrder]);

  useEffect(() => {
    if (!isLoading) {
      window.dispatchEvent(new CustomEvent("restore-scroll"));
    }
  }, [isLoading]);

  const actorLinkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (state.links || []).forEach((l) => {
      if (l?.actorIds) {
        l.actorIds.forEach((id) => {
          counts[id] = (counts[id] || 0) + 1;
        });
      }
    });
    return counts;
  }, [state.links]);

  const filteredActors = useMemo(() => {
    let actors = state.actors;

    if (deferredSearchQuery.trim()) {
      actors = actors.filter((actor) =>
        (actor.name || '').toLowerCase().includes(deferredSearchQuery.toLowerCase()),
      );
    }

    return actors
      .map((actor) => ({
        ...actor,
        linksCount: actorLinkCounts[actor.id] || 0,
      }))
      .sort((a, b) => {
        const order = sortOrder as string;
        if (order === "Newest") return (b.createdAt || 0) - (a.createdAt || 0);
        if (order === "Oldest") return (a.createdAt || 0) - (b.createdAt || 0);
        if (order === "A-Z") return (a.name || "").localeCompare(b.name || "");
        if (order === "Z-A") return (b.name || "").localeCompare(a.name || "");
        return 0;
      });
  }, [state.actors, actorLinkCounts, deferredSearchQuery, sortOrder]);

  useEffect(() => {
    setVisibleCount(100);
  }, [deferredSearchQuery, sortOrder]);

  const visibleActors = useMemo(
    () => filteredActors.slice(0, visibleCount),
    [filteredActors, visibleCount],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + 100);
        }
      },
      { rootMargin: "800px" },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [visibleActors.length]);

  const handleActorClick = useCallback(
    (id: string) => {
      navigate(`/actor/${id}`, {
        state: { from: location.pathname + location.search, searchQuery },
      });
    },
    [navigate, location.pathname, location.search, searchQuery],
  );

  if (!isHydrated) return null;

  return (
    <div
      
      
      className="max-w-2xl mx-auto px-2 pb-3.5 pt-3.5"
    >
      <div className="flex flex-col relative min-h-[500px]">
        {isLoading ? (
          <div className="flex flex-col w-full z-0 animate-fade-in-fast">
            {Array.from({ length: 15 }).map((_, i) => (
              <SkeletonListItem key={`skel-${i}`} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col w-full z-10 animate-fade-in-fast">
            {visibleActors.map((actor) => (
              <ActorListItem
                key={actor.id}
                actor={actor}
                onClick={() => handleActorClick(actor.id)}
                borderColor={circleBorderColor}
              />
            ))}
            {visibleCount < filteredActors.length && (
              <div ref={loadMoreRef} className="h-10 w-full" />
            )}
          </div>
        )}
      </div>

      {!isLoading && filteredActors.length === 0 && (
        <div
          className="py-32 text-center w-full z-20 relative"
        >
          <div className="text-[var(--text-muted)] font-black uppercase tracking-[0.4em] text-[10px] opacity-20">
            {searchQuery ? "No matching records found" : "Registry Empty"}
          </div>
        </div>
      )}
    </div>
  );
});
