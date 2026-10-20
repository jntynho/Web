import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { Icons } from "../constants";
import { InputBar } from "../components/InputBar";
import { PaginationBar } from "../components/Pagination";
import { AspectRatio, LinkItem } from "../types";
import { cacheActorImages, extractSocialUrls } from "../utils/actorImagesCache";
import { isNaughtyAmericaStudioOrSeries, detectCoverAspectRatio } from "../utils/naughtyAmerica";
import { hasActiveTextSelection } from "../utils/clipboard";

const generateStableSexmexId = (scene: { title?: string; date?: string; tag?: string }) => {
  const cleanTitle = (scene.title || "").toLowerCase().replace(/[^a-z0-9]/g, '_');
  const cleanDate = (scene.date || "").replace(/[^0-9]/g, '');
  return `sexmex_${cleanTitle}_${cleanDate}`;
};

// Known JAV studio names & patterns
const JAV_CODE_REGEX = /^[A-Z0-9]{2,6}[-_]\d{2,6}$/i;
const JAV_STUDIO_KEYWORDS = [
  "s1 no.1 style", "moodyz", "idea pocket", "sod", "soft on demand", "faleno",
  "attackers", "madonna", "premium", "fanza", "dmm", "prestige", "kawaii*", "wanz",
  "honnaka", "das!", "muteki", "e-body", "oppai", "beast", "dogma", "glory quest",
  "caribbeancom", "1pondo", "pacopacomama", "heyzo", "tokyohot", "fc2"
];

export const extractJavCode = (code?: string, title?: string): string | null => {
  if (code && typeof code === 'string') {
    const trimmed = code.trim();
    const directMatch = trimmed.match(/^([a-zA-Z0-9]{2,6}[-_ ]\d{2,6}|fc2[-_ ]?ppv[-_ ]?\d{4,8})$/i);
    if (directMatch) {
      return directMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
    const subMatch = trimmed.match(/([a-zA-Z]{2,6}[-_ ]\d{2,6})/i);
    if (subMatch) {
      return subMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
    const caribbeanMatch = trimmed.match(/(\d{6}[-_ ]\d{2,4})/);
    if (caribbeanMatch) {
      return caribbeanMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
  }

  if (title && typeof title === 'string') {
    const fc2Match = title.match(/\b(fc2[-_ ]?ppv[-_ ]?\d{4,8})\b/i);
    if (fc2Match) {
      return fc2Match[1].replace(/\s+/g, '-').toUpperCase();
    }
    const titleMatch = title.match(/\b([a-zA-Z]{2,6}[-_ ]\d{2,6})\b/i);
    if (titleMatch) {
      return titleMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
    const caribbeanMatch = title.match(/\b(\d{6}[-_ ]\d{2,4})\b/);
    if (caribbeanMatch) {
      return caribbeanMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
  }

  return null;
};

const isJavScene = (scene: { code?: string; studio?: string; parentNetwork?: string; title?: string }): boolean => {
  if (extractJavCode(scene.code, scene.title)) return true;
  const studioName = (scene.studio || "").toLowerCase();
  const parentName = (scene.parentNetwork || "").toLowerCase();
  if (JAV_STUDIO_KEYWORDS.some(k => studioName.includes(k) || parentName.includes(k))) return true;
  return false;
};

const shouldSkipJavSceneExcessPerformers = (rawPerformers: any[], sceneInfo: { code?: string; studio?: string; parentNetwork?: string; title?: string }): boolean => {
  if (!isJavScene(sceneInfo)) return false;
  // If it's confirmed as JAV, skip if it has more than 2 performers
  const count = Array.isArray(rawPerformers) ? rawPerformers.length : 0;
  return count > 2;
};

// Check if title has pattern like "Word #6", "BDSM #3", "Anal #2" (word followed by # and number)
const HAS_HASH_NUMBER_REGEX = /#\s*\d+/;
const hasNumberedVolumePattern = (title?: string): boolean => {
  if (!title) return false;
  return HAS_HASH_NUMBER_REGEX.test(title);
};

// Helper to extract all matching variations of an actor's name
export const getActorMatchingKeys = (name?: string, stashDbId?: string): string[] => {
  const keys = new Set<string>();
  if (stashDbId) {
    keys.add(stashDbId.toLowerCase().trim());
  }
  if (!name || typeof name !== 'string') return Array.from(keys);

  const clean = name.toLowerCase().trim();
  if (clean) keys.add(clean);

  const norm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (norm) keys.add(norm);

  const noPunct = norm.replace(/[^a-z0-9]/g, "");
  if (noPunct) keys.add(noPunct);

  // Split into words (for name inversions like Japanese "Mikami Yua" <-> "Yua Mikami")
  const parts = clean.split(/[\s,.'’\-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const reversed = [...parts].reverse().join(" ");
    keys.add(reversed);
    const reversedNorm = reversed.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (reversedNorm) keys.add(reversedNorm);
    const reversedNoPunct = reversedNorm.replace(/[^a-z0-9]/g, "");
    if (reversedNoPunct) keys.add(reversedNoPunct);
  }

  return Array.from(keys);
};

// Helper to extract all matching variations of a studio's name
export const getStudioMatchingKeys = (name?: string, stashDbId?: string): string[] => {
  const keys = new Set<string>();
  if (stashDbId) {
    keys.add(stashDbId.toLowerCase().trim());
  }
  if (!name || typeof name !== 'string') return Array.from(keys);

  const clean = name.toLowerCase().trim();
  if (clean) keys.add(clean);

  const norm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (norm) keys.add(norm);

  const noPunct = norm.replace(/[^a-z0-9]/g, "");
  if (noPunct) keys.add(noPunct);

  // Suffix stripped version (e.g. "Brazzers Network" -> "Brazzers", "Passion-HD" -> "Passion HD")
  const withoutSuffix = clean.replace(/(?:\s|-)*(?:vip|network|premium|plus|media|entertainment|films|studios|studio|site|hd)$/i, '').trim();
  if (withoutSuffix && withoutSuffix !== clean) {
    keys.add(withoutSuffix);
    const withoutSuffixNorm = withoutSuffix.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (withoutSuffixNorm) keys.add(withoutSuffixNorm);
    const withoutSuffixNoPunct = withoutSuffixNorm.replace(/[^a-z0-9]/g, "");
    if (withoutSuffixNoPunct) keys.add(withoutSuffixNoPunct);
  }

  return Array.from(keys);
};

// Strict female filtering helper (strictly excludes male and transgender male actors)
export const isFemalePerformer = (gender: any): boolean => {
  if (!gender) return true; // Keep if unspecified in female-centric queries
  const g = String(gender).toUpperCase().trim();
  if (g === "MALE" || g === "TRANSGENDER_MALE") return false;
  return true;
};

// Strict blocked studio checking
export const isStudioBlocked = (studioName?: string, parentNetwork?: string, blockedList?: string[]): boolean => {
  if (!blockedList || blockedList.length === 0) return false;
  const blockedKeys = new Set(
    blockedList.flatMap(b => getStudioMatchingKeys(b))
  );

  const studioKeys = getStudioMatchingKeys(studioName);
  for (const k of studioKeys) {
    if (blockedKeys.has(k)) return true;
  }

  if (parentNetwork) {
    const parentKeys = getStudioMatchingKeys(parentNetwork);
    for (const k of parentKeys) {
      if (blockedKeys.has(k)) return true;
    }
  }

  return false;
};

const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
const LATIN_NAME_REGEX = /^[A-Za-z\s\.\-'\(\)]+$/;

export const resolveEnglishPerformerName = (name?: string, aliases?: string[]): string => {
  const trimmedName = (name || "").trim();

  // 1. If primary name contains Latin letters and no Japanese characters, it's already in English/Romaji
  if (trimmedName && !JAPANESE_CHAR_REGEX.test(trimmedName) && /[A-Za-z]/.test(trimmedName)) {
    return trimmedName;
  }

  // 2. Search aliases for a pure Latin English/Romaji name
  if (Array.isArray(aliases) && aliases.length > 0) {
    const cleanAliases = aliases.map(a => (typeof a === 'string' ? a.trim() : '')).filter(Boolean);

    // Exact pure Latin alphabet match
    const pureLatin = cleanAliases.find(a => LATIN_NAME_REGEX.test(a) && /[A-Za-z]/.test(a));
    if (pureLatin) return pureLatin;

    // Any alias with Latin letters and no Japanese characters
    const noJap = cleanAliases.find(a => !JAPANESE_CHAR_REGEX.test(a) && /[A-Za-z]/.test(a));
    if (noJap) return noJap;
  }

  // 3. Fallback to original name
  return trimmedName;
};

export const extractMagnetHash = (magnet?: string | null): string | null => {
  if (!magnet || typeof magnet !== 'string') return null;
  const match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return match ? match[1].toLowerCase() : null;
};

export const isValidMagnetUri = (magnet?: string | null): boolean => {
  return extractMagnetHash(magnet) !== null;
};

export const sanitizeGalleryUrls = (urls: any[], maxLimit = 24): string[] => {
  if (!Array.isArray(urls)) return [];
  const unique = new Set<string>();
  const sanitized: string[] = [];
  for (const url of urls) {
    if (typeof url === 'string') {
      const clean = url.trim();
      if (clean.startsWith('http://') || clean.startsWith('https://')) {
        if (!unique.has(clean)) {
          unique.add(clean);
          sanitized.push(clean);
        }
      }
    }
  }
  return sanitized.slice(0, maxLimit);
};

const LazyImage = React.memo(({ src, className, alt, referrerPolicy, wrapperClassName = "", availableImages = [], style = {} }: any) => {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hasIntersected, setHasIntersected] = useState(false);
  const [currentSrcIndex, setCurrentSrcIndex] = useState(0);
  const [useProxy, setUseProxy] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  const allSources = useMemo(() => Array.from(new Set([src, ...(availableImages || [])])).filter(Boolean), [src, availableImages]);
  const currentSrc = allSources[currentSrcIndex] || src;
  const finalSrc = useProxy ? `/api/proxy-image?url=${encodeURIComponent(currentSrc)}` : currentSrc;

  const handleError = useCallback(() => {
    if (!useProxy) {
      setUseProxy(true);
    } else {
      if (currentSrcIndex < allSources.length - 1) {
        setCurrentSrcIndex(prev => prev + 1);
        setUseProxy(false);
      }
    }
  }, [useProxy, currentSrcIndex, allSources.length]);

  useEffect(() => {
    if (hasIntersected) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasIntersected(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [hasIntersected]);

  const isRoundedFull = wrapperClassName.includes('rounded-full');

  return (
    <div 
      ref={imgRef} 
      className={`relative overflow-hidden w-full h-full pointer-events-none ${wrapperClassName}`} 
      style={{ 
        WebkitTouchCallout: 'none', 
        userSelect: 'none', 
        contain: 'paint',
        WebkitMaskImage: isRoundedFull ? '-webkit-radial-gradient(white, black)' : undefined
      }}
    >
      <div 
        className={`absolute inset-0 bg-[var(--skeleton-bg)] animate-pulse transition-opacity duration-500 ease-in-out ${isRoundedFull ? 'rounded-full' : ''}`} 
        style={{ opacity: imgLoaded ? 0 : 1, zIndex: 1 }}
      />
      {hasIntersected && (
        <img
          src={finalSrc}
          alt={alt}
          referrerPolicy={referrerPolicy}
          loading="lazy"
          decoding="async"
          ref={(el) => {
            if (el) {
              if (el.complete && el.naturalWidth > 0) {
                setImgLoaded(true);
              } else if (typeof el.decode === 'function') {
                el.decode().then(() => setImgLoaded(true)).catch(() => {});
              }
            }
          }}
          onLoad={() => {
            setImgLoaded(true);
          }}
          onError={handleError}
          className={`${className} absolute inset-0 w-full h-full ${isRoundedFull ? 'rounded-full' : ''}`}
          style={{
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 500ms ease-in-out',
            zIndex: 2,
            ...style
          }}
        />
      )}
    </div>
  );
});

interface StashScene {
  id: string;
  title: string;
  date: string;
  studio: string;
  parentNetwork?: string;
  parentStudioId?: string;
  studioLogoUrl?: string;
  actors: { 
    id?: string;
    stashDbId?: string;
    name: string; 
    imageUrl: string; 
    availableImages?: string[];
    instagramUrl?: string;
    twitterUrl?: string;
    onlyFansUrl?: string;
  }[];
  coverUrl: string;
  code?: string;
  urls?: { url: string; type?: string; site?: { name: string } }[];
  trailerUrl?: string;
}

interface StashPerformer {
  id: string;
  name: string;
  aliases?: string[];
  imageUrl: string;
  availableImages?: string[];
  child_studios?: string[];
  sceneCount?: number;
  disambiguation?: string;
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
  instagramUrl?: string;
  twitterUrl?: string;
  onlyFansUrl?: string;
}

export const StashDb: React.FC = () => {
  const { state, addLink, addLinks, addActor, updateActor, addStudio, updateStudio, addNotification, updateSettings, stashDbSearchMode, setStashDbSearchMode } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const currentModeRef = useRef<"actor" | "studio" | "sexmex" | "jav">(stashDbSearchMode);
  const [isSearching, setIsSearching] = useState(false);
  const [performers, setPerformers] = useState<StashPerformer[]>([]);
  const [selectedPerformerId, setSelectedPerformerId] = useState<string | null>(null);
  const [isFetchingScenes, setIsFetchingScenes] = useState(false);
  const [scenes, setScenes] = useState<StashScene[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalScenes, setTotalScenes] = useState(0);
  const itemsPerPage = 20;
  const [studioToBlock, setStudioToBlock] = useState<string | null>(null);
  const [selectedScenesMap, setSelectedScenesMap] = useState<Map<string, StashScene>>(new Map());
  const [saveProgress, setSaveProgress] = useState<{ current: number, total: number, title: string } | null>(null);
  const abortSaveRef = useRef(false);
  const isSavingRef = useRef(false);
  const saveAbortControllerRef = useRef<AbortController | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const fetchScenesAbortControllerRef = useRef<AbortController | null>(null);
  const fetchScenesRequestIdRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
      if (saveAbortControllerRef.current) {
        saveAbortControllerRef.current.abort();
      }
      if (fetchScenesAbortControllerRef.current) {
        fetchScenesAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Fast O(1) multi-key lookup maps for actors
  const existingActorMap = useMemo(() => {
    const map = new Map<string, typeof state.actors[0]>();
    for (const a of state.actors) {
      const keys = getActorMatchingKeys(a.name, a.stashDbId);
      for (const k of keys) {
        if (k) map.set(k, a);
      }
    }
    return map;
  }, [state.actors]);

  // Fast O(1) multi-key lookup maps for studio logos
  const studioLogoMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of state.studios) {
      const logo = s.logoUrl || s.imageUrl;
      if (s.name && logo) {
        const keys = getStudioMatchingKeys(s.name, s.stashDbId);
        for (const k of keys) {
          if (k) map.set(k, logo);
        }
      }
    }
    return map;
  }, [state.studios]);

  // Fast O(1) multi-key lookup maps for existing studios
  const existingStudioMap = useMemo(() => {
    const map = new Map<string, typeof state.studios[0]>();
    for (const s of state.studios) {
      if (s.name) {
        const keys = getStudioMatchingKeys(s.name, s.stashDbId);
        for (const k of keys) {
          if (k) map.set(k, s);
        }
      }
    }
    return map;
  }, [state.studios]);

  type CacheState = {
    query: string;
    performers: StashPerformer[];
    selectedPerformerId: string | null;
    scenes: StashScene[];
    currentPage: number;
    totalScenes: number;
    selectedScenesMap: Map<string, StashScene>;
  };
  
  const stateCache = useRef<Record<string, CacheState>>({
    actor: { query: "", performers: [], selectedPerformerId: null, scenes: [], currentPage: 1, totalScenes: 0, selectedScenesMap: new Map() },
    studio: { query: "", performers: [], selectedPerformerId: null, scenes: [], currentPage: 1, totalScenes: 0, selectedScenesMap: new Map() },
    sexmex: { query: "", performers: [], selectedPerformerId: null, scenes: [], currentPage: 1, totalScenes: 0, selectedScenesMap: new Map() },
    jav: { query: "", performers: [], selectedPerformerId: null, scenes: [], currentPage: 1, totalScenes: 0, selectedScenesMap: new Map() },
  });

  const stateValuesRef = useRef({
    query,
    performers,
    selectedPerformerId,
    scenes,
    currentPage,
    totalScenes,
    selectedScenesMap
  });

  useEffect(() => {
    stateValuesRef.current = {
      query,
      performers,
      selectedPerformerId,
      scenes,
      currentPage,
      totalScenes,
      selectedScenesMap
    };
  }, [query, performers, selectedPerformerId, scenes, currentPage, totalScenes, selectedScenesMap]);

  useEffect(() => {
    if (currentModeRef.current !== stashDbSearchMode) {
      const prevMode = currentModeRef.current;
      stateCache.current[prevMode] = { ...stateValuesRef.current };
      
      const cached = stateCache.current[stashDbSearchMode];
      // Keep typed query if user has entered text, so switching modes does not clear it
      setQuery(prev => (prev && prev.trim().length > 0) ? prev : (cached.query || ""));
      setPerformers(cached.performers || []);
      setSelectedPerformerId(cached.selectedPerformerId || null);
      setScenes(cached.scenes || []);
      setCurrentPage(cached.currentPage || 1);
      setTotalScenes(cached.totalScenes || 0);
      setSelectedScenesMap(cached.selectedScenesMap || new Map());
      
      currentModeRef.current = stashDbSearchMode;
    }
  }, [stashDbSearchMode]);

  const scrollToTop = () => {
    const scrollArea = document.getElementById('scroll-area');
    if (scrollArea) {
      scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const accentColor = state.settings.accentColor || "#fbca27";

  useEffect(() => {
    const handleSave = async () => {
      if (isSavingRef.current || selectedScenesMap.size === 0) return;
      isSavingRef.current = true;
      abortSaveRef.current = false;
      const masterAbortCtrl = new AbortController();
      saveAbortControllerRef.current = masterAbortCtrl;
      
      const saveBtn = document.getElementById("stashdb-save-btn");
      const originalHTML = saveBtn?.innerHTML;
      if (saveBtn) {
        saveBtn.style.opacity = '0.5';
        saveBtn.style.pointerEvents = 'none';
        saveBtn.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>`;
      }
      
      setSaveProgress({ current: 0, total: selectedScenesMap.size, title: "Initializing..." });
      await new Promise(r => setTimeout(r, 200));

      try {
        const selectedScenes: StashScene[] = Array.from(selectedScenesMap.values());
        const newlyCreatedActors = new Map<string, string>();
        const newlyCreatedStudios = new Map<string, string>();
        const parentStudioCache = new Map<string, string[]>();

        const resolveActorId = (actor: { 
          id?: string; 
          stashDbId?: string; 
          name: string; 
          imageUrl?: string; 
          availableImages?: string[];
          instagramUrl?: string;
          twitterUrl?: string;
          onlyFansUrl?: string;
        }): string => {
          try {
            const actorName = (actor.name || "").trim();
            if (!actorName) return "";

            const keys = getActorMatchingKeys(actorName, actor.stashDbId || actor.id);

            // Check in-flight newly created actors first
            for (const k of keys) {
              if (newlyCreatedActors.has(k)) {
                return newlyCreatedActors.get(k)!;
              }
            }

            // Check existing library actors
            let existing: typeof state.actors[0] | undefined = undefined;
            for (const k of keys) {
              if (existingActorMap.has(k)) {
                existing = existingActorMap.get(k);
                break;
              }
            }

            const sDbId = actor.stashDbId || actor.id;
            const allImages = Array.from(new Set([actor.imageUrl, ...(actor.availableImages || [])].filter(Boolean) as string[]));

            if (existing) {
              // Cache updated images in memory and indexedDB
              if (allImages.length > 0) {
                if (sDbId) cacheActorImages(sDbId, allImages);
                cacheActorImages(existing.name, allImages);
              }

              // Enrich missing fields in existing actor
              const updates: Partial<typeof existing> = {};
              if (!existing.stashDbId && sDbId) updates.stashDbId = sDbId;
              if (!existing.imageUrl && actor.imageUrl) updates.imageUrl = actor.imageUrl;
              if (!existing.instagramUrl && actor.instagramUrl) updates.instagramUrl = actor.instagramUrl;
              if (!existing.twitterUrl && actor.twitterUrl) updates.twitterUrl = actor.twitterUrl;
              if (!existing.onlyFansUrl && actor.onlyFansUrl) updates.onlyFansUrl = actor.onlyFansUrl;

              if (Object.keys(updates).length > 0) {
                try {
                  updateActor(existing.id, updates);
                } catch (e) {
                  console.warn("Could not enrich existing actor metadata:", e);
                }
              }

              for (const k of keys) {
                newlyCreatedActors.set(k, existing.id);
              }
              return existing.id;
            }

            // Create new actor
            if (allImages.length > 0) {
              if (sDbId) cacheActorImages(sDbId, allImages);
              cacheActorImages(actorName, allImages);
            }

            const newId = addActor({
              stashDbId: sDbId,
              name: actorName,
              imageUrl: actor.imageUrl || "",
              instagramUrl: actor.instagramUrl,
              twitterUrl: actor.twitterUrl,
              onlyFansUrl: actor.onlyFansUrl,
            });

            for (const k of keys) {
              newlyCreatedActors.set(k, newId);
            }
            return newId;
          } catch (err) {
            console.error("resolveActorId error:", err);
            return "";
          }
        };

        const resolveStudioId = (
          studioName?: string, 
          studioLogoUrl?: string, 
          parentNetwork?: string, 
          parentStudioId?: string
        ): string | null => {
          try {
            if (!studioName && !parentNetwork) return null;
            const targetName = (studioName || parentNetwork || "").trim();
            if (!targetName) return null;

            const keys = getStudioMatchingKeys(targetName);

            // Check newly created studios first
            for (const k of keys) {
              if (newlyCreatedStudios.has(k)) {
                return newlyCreatedStudios.get(k)!;
              }
            }

            // Check existing studios
            let existing: typeof state.studios[0] | undefined = undefined;
            for (const k of keys) {
              if (existingStudioMap.has(k)) {
                existing = existingStudioMap.get(k);
                break;
              }
            }

            // Also check parent network if sub-studio wasn't found
            if (!existing && parentNetwork) {
              const parentKeys = getStudioMatchingKeys(parentNetwork);
              for (const pk of parentKeys) {
                if (existingStudioMap.has(pk)) {
                  existing = existingStudioMap.get(pk);
                  break;
                }
              }
            }

            // Fallback logo: if no logo given, check parent network logo from cache or props
            const parentLogo = parentNetwork ? (studioLogoMap.get(parentNetwork.toLowerCase().trim()) || studioLogoMap.get(parentNetwork.toLowerCase().replace(/[^a-z0-9]/g, ""))) : undefined;
            const effectiveLogoUrl = studioLogoUrl || parentLogo || "";

            if (existing) {
              // Enrich existing studio with logo if missing
              if (!existing.logoUrl && effectiveLogoUrl) {
                try {
                  updateStudio(existing.id, { logoUrl: effectiveLogoUrl });
                } catch (e) {
                  console.warn("Could not enrich existing studio logo:", e);
                }
              }
              for (const k of keys) {
                newlyCreatedStudios.set(k, existing.id);
              }
              return existing.id;
            }

            // Create new studio
            const newId = addStudio({
              name: targetName,
              logoUrl: effectiveLogoUrl,
            });

            for (const k of keys) {
              newlyCreatedStudios.set(k, newId);
            }
            return newId;
          } catch (err) {
            console.error("resolveStudioId error:", err);
            return null;
          }
        };

        const createSubController = (timeoutMs: number) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          const onAbort = () => controller.abort();
          if (masterAbortCtrl.signal.aborted) {
            controller.abort();
          } else {
            masterAbortCtrl.signal.addEventListener('abort', onAbort, { once: true });
          }
          return {
            signal: controller.signal,
            cleanup: () => {
              clearTimeout(timeoutId);
              masterAbortCtrl.signal.removeEventListener('abort', onAbort);
            }
          };
        };

        const fetchJavGallery = async (code: string): Promise<string[]> => {
          const sub = createSubController(8000);
          try {
            const res = await fetch('/api/scrape/javtrailers-gallery', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code }),
              signal: sub.signal
            });
            sub.cleanup();
            if (!res.ok) return [];
            const data = await res.json();
            return sanitizeGalleryUrls(data.gallery || []);
          } catch {
            sub.cleanup();
            return [];
          }
        };

        const fetchTorrentForScene = async (scene: any) => {
          if (abortSaveRef.current || masterAbortCtrl.signal.aborted) return null;

          const isJavMode = stashDbSearchMode === 'jav';
          const detectedJavCode = extractJavCode(scene.code, scene.title);
          const isDetectedJav = Boolean(detectedJavCode) || isJavScene(scene);
          const isJav = isJavMode || isDetectedJav;
          const javCode = detectedJavCode || (scene.code ? scene.code.trim().toUpperCase() : null);
          const isNaughtyAmerica = !isJav && isNaughtyAmericaStudioOrSeries(scene.studio, scene.parentNetwork, scene.title);
          
          const isJavTarget = isJav && Boolean(javCode);
          const javQuery = javCode || '';

          const mapScoreland = (stName?: string) => {
            if (!stName) return '';
            const lower = stName.toLowerCase().trim();
            if (lower.includes('scoreland') || lower.includes('score land')) {
              return 'PornMegaLoad';
            }
            return stName;
          };

          const rawStudio = mapScoreland(scene.studio);
          const rawParentNetwork = mapScoreland(scene.parentNetwork);

          const actor = scene.actors.map((a: any) => a.name.replace(/[,.'’\-]/g, '')).join(' ');
          const studio = rawStudio ? rawStudio.replace(/(?:\s|-)*(?:VIP|Network|Premium|Plus|Media|Entertainment|Films|Studios|Studio|Site)$/i, '').replace(/&/g, 'and').replace(/[\s,.'’\-]+/g, '') : '';
          const studioNoSpaces = studio.replace(/\s+/g, '');
          const parentNetwork = rawParentNetwork ? rawParentNetwork.replace(/(?:\s|-)*(?:VIP|Network|Premium|Plus|Media|Entertainment|Films|Studios|Studio|Site)$/i, '').replace(/&/g, 'and').replace(/[\s,.'’\-]+/g, '') : '';
          const parentNetworkNoSpaces = parentNetwork.replace(/\s+/g, '');
          
          let dateStr = '';
          let targetDateMs: number | undefined = undefined;
          if (scene.date) {
            const d = new Date(scene.date + 'T12:00:00Z');
            if (!isNaN(d.getTime())) {
              targetDateMs = d.getTime();
              const parts = scene.date.split('-');
              if (parts.length === 3) {
                  const yy = parts[0].slice(-2);
                  const mm = parts[1];
                  const dd = parts[2];
                  dateStr = `${yy} ${mm} ${dd}`;
              }
            }
          }
          
          const baseQuery = `${actor} ${studio} ${dateStr}`.replace(/[,.'’]/g, '').trim();
          const queryNoSpaces = `${actor} ${studioNoSpaces} ${dateStr}`.replace(/[,.'’]/g, '').trim();
          const queryWithoutDate = `${actor} ${studio}`.replace(/[,.'’]/g, '').trim();
          const queryWithoutDateNoSpaces = `${actor} ${studioNoSpaces}`.replace(/[,.'’]/g, '').trim();

          const queriesToTry = [baseQuery];
          if (studioNoSpaces !== studio) queriesToTry.push(queryNoSpaces);
          if (queryWithoutDate && queryWithoutDate !== baseQuery) queriesToTry.push(queryWithoutDate);
          if (queryWithoutDateNoSpaces && studioNoSpaces !== studio) queriesToTry.push(queryWithoutDateNoSpaces);

          let alternateStudios: string[] = [];
          const apiKey = isJavMode ? (state.settings.javstashApiKey || state.settings.stashDbApiKey) : state.settings.stashDbApiKey;
          const endpoint = isJavMode ? "/api/javstash" : "/api/stashdb";

          if (apiKey && !abortSaveRef.current) {
             if (scene.parentNetwork) {
                alternateStudios.push(scene.parentNetwork);
             }
             if (scene.parentStudioId) {
                if (parentStudioCache.has(scene.parentStudioId)) {
                    alternateStudios.push(...parentStudioCache.get(scene.parentStudioId)!);
                } else {
                    const sub = createSubController(8000);
                    try {
                       const res2 = await fetch(endpoint, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                             apiKey,
                             query: `
                                query FindStudioParent($id: ID!) {
                                  findStudio(id: $id) {
                                    sub_studios {
                                      studios {
                                        name
                                      }
                                    }
                                  }
                                }
                             `,
                             variables: { id: scene.parentStudioId }
                          }),
                          signal: sub.signal
                       });
                       sub.cleanup();
                       const data2 = await res2.json();
                       const childStudios = data2?.data?.findStudio?.sub_studios?.studios;
                       if (childStudios && Array.isArray(childStudios)) {
                          const childNames: string[] = [];
                          childStudios.forEach((child: any) => {
                             if (child.name !== scene.studio) {
                                childNames.push(child.name);
                                alternateStudios.push(child.name);
                             }
                          });
                          parentStudioCache.set(scene.parentStudioId, childNames);
                       }
                    } catch(err) {
                       sub.cleanup();
                       console.error("StashDB children fetch error:", err);
                    }
                }
             }
          }

          alternateStudios = [...new Set(alternateStudios.map(s => mapScoreland(s)))];
          for (const altStudio of alternateStudios) {
             const formattedAltStudio = altStudio.replace(/(?:\s|-)*(?:VIP|Network|Premium|Plus|Media|Entertainment|Films|Studios|Studio|Site)$/i, '').replace(/&/g, 'and').replace(/[\s,.'’\-]+/g, '');
             const altQuery = `${actor} ${formattedAltStudio} ${dateStr}`.replace(/[,.'’\-]/g, '').trim();
             const altQueryWithoutDate = `${actor} ${formattedAltStudio}`.replace(/[,.'’\-]/g, '').trim();
             
             if (altQuery && !queriesToTry.includes(altQuery)) queriesToTry.push(altQuery);
             if (altQueryWithoutDate && altQueryWithoutDate !== altQuery && !queriesToTry.includes(altQueryWithoutDate)) queriesToTry.push(altQueryWithoutDate);
          }

          const sceneStudios = [rawStudio, rawParentNetwork, ...alternateStudios].filter(Boolean);
          const sceneActors = scene.performers ? scene.performers.map((p: any) => typeof p === 'string' ? p : p.name).filter(Boolean) : (actor ? [actor] : []);

          const executeSearch = async (queryToUse: string, isJavFallback: boolean = false) => {
            const endpoint = isJavFallback ? '/api/search/sukebei-smart' : '/api/search/xxxclub-smart';
            const payload = isJavFallback ? { query: javQuery } : { 
              query: queryToUse, 
              targetDateMs,
              actors: sceneActors,
              studios: sceneStudios,
              title: scene.title
            };
            
            const sub = createSubController(12000);
            try {
              const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: sub.signal
              });
              sub.cleanup();
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              const valid1080p = isValidMagnetUri(data.magnet1080p) ? data.magnet1080p : undefined;
              const valid2160p = isValidMagnetUri(data.magnet2160p) ? data.magnet2160p : undefined;
              if (valid1080p || valid2160p) {
                 return {
                    url1080p: data.url1080p,
                    url2160p: data.url2160p,
                    magnet1080p: valid1080p,
                    magnet2160p: valid2160p,
                    sourceSite: isJavFallback ? 'sukebei.nyaa.si' : 'xxxclub.to'
                 };
              }
            } catch (err) {
              sub.cleanup();
            }
            return null;
          };

          try {
            if (isJavTarget && javQuery) {
               const res = await executeSearch(javQuery, true);
               if (res) return res;
            }
            
            if (queriesToTry.length > 0) {
               const uniqueQueries = [...new Set(queriesToTry)].filter(Boolean);
               if (!abortSaveRef.current && uniqueQueries.length > 0) {
                  const sub = createSubController(14000);
                  try {
                    const res = await fetch('/api/search/xxxclub-smart', {
                       method: 'POST',
                       headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify({ 
                          queries: uniqueQueries, 
                          targetDateMs,
                          actors: sceneActors,
                          studios: sceneStudios,
                          title: scene.title
                       }),
                       signal: sub.signal
                    });
                    sub.cleanup();
                    if (res && res.ok) {
                       const data = await res.json().catch(() => null);
                       if (data) {
                          const valid1080p = isValidMagnetUri(data.magnet1080p) ? data.magnet1080p : undefined;
                          const valid2160p = isValidMagnetUri(data.magnet2160p) ? data.magnet2160p : undefined;
                          if (valid1080p || valid2160p) {
                             return {
                                url1080p: data.url1080p,
                                url2160p: data.url2160p,
                                magnet1080p: valid1080p,
                                magnet2160p: valid2160p,
                                sourceSite: 'xxxclub.to'
                             };
                          }
                       }
                    }
                  } catch {
                    sub.cleanup();
                  }
               }
            }
          } catch(e) {
            console.error("Torrent fetch failed for", scene.title, e);
          }
          return null;
        };

        const resolvedLinks: Array<Omit<LinkItem, 'id'> | null> = new Array(selectedScenes.length).fill(null);
        let failedMagnetCount = 0;
        let skippedJavNoMagnetCount = 0;
        let completedCount = 0;
        let nextIndex = 0;

        const processScene = async (scene: StashScene, index: number) => {
          if (abortSaveRef.current || masterAbortCtrl.signal.aborted) return;

          try {
            const isJavMode = stashDbSearchMode === 'jav';
            const detectedJavCode = extractJavCode(scene.code, scene.title);
            const isDetectedJav = Boolean(detectedJavCode) || isJavScene(scene);
            const isJav = isJavMode || isDetectedJav;
            const javCode = detectedJavCode || (scene.code ? scene.code.trim().toUpperCase() : null);
            const isNaughtyAmerica = !isJav && isNaughtyAmericaStudioOrSeries(scene.studio, scene.parentNetwork, scene.title);

            // Concurrently run torrent search, JAV gallery (if applicable), and Naughty America cover ratio detection
            const [torrentData, rawGalleryUrls, measuredNaRatio] = await Promise.all([
              fetchTorrentForScene(scene).catch(err => {
                console.error("Torrent fetch error for", scene.title, err);
                return null;
              }),
              (isJav && javCode) ? fetchJavGallery(javCode).catch(() => []) : Promise.resolve([]),
              (isNaughtyAmerica && scene.coverUrl) ? detectCoverAspectRatio(scene.coverUrl) : Promise.resolve(null)
            ]);

            if (abortSaveRef.current || masterAbortCtrl.signal.aborted) return;

            const hasMagnet = Boolean(torrentData?.magnet1080p || torrentData?.magnet2160p);

            // Rule: JAV scenes MUST have a valid magnet/stream. If no magnet found, skip saving to prevent dead links.
            if (isJav && !hasMagnet) {
              skippedJavNoMagnetCount++;
              return;
            }

            if (!hasMagnet) {
              failedMagnetCount++;
            }

            // Fast O(1) actor and studio resolution
            const actorIds: string[] = Array.from(
              new Set(
                (scene.actors || [])
                  .map(actor => resolveActorId(actor))
                  .filter((aid): aid is string => Boolean(aid) && typeof aid === 'string' && aid.trim().length > 0)
              )
            );

            const studioIds: string[] = [];
            if (scene.studio || scene.parentNetwork) {
              const sid = resolveStudioId(
                scene.studio, 
                scene.studioLogoUrl, 
                scene.parentNetwork, 
                scene.parentStudioId
              );
              if (sid && sid.trim().length > 0 && !studioIds.includes(sid)) {
                studioIds.push(sid);
              }
            }

            // Determine aspect ratio
            let computedAspectRatio: AspectRatio = "16:9";
            if (isJav) {
              computedAspectRatio = "3:2";
            } else if (isNaughtyAmerica) {
              computedAspectRatio = (measuredNaRatio === "16:9" ? "16:9" : "3:2") as AspectRatio;
            }

            // Title resolution
            let resolvedTitle: string;
            if (isJav && javCode) {
              resolvedTitle = javCode;
            } else if (isJavMode) {
              const studioCode = javCode || (scene.code && typeof scene.code === 'string' ? scene.code.trim().toUpperCase() : '');
              resolvedTitle = studioCode || scene.title?.trim() || (scene.studio ? `${scene.studio} - ${scene.actors.map(a => a.name).join(", ")}` : "Untitled JAV");
            } else {
              resolvedTitle = scene.title?.trim() || (scene.studio ? `${scene.studio} - ${scene.actors.map(a => a.name).join(", ")}` : (scene.code?.trim() || "Untitled Scene"));
            }

            // Smart Trailer Extraction from scene URLs and JAV code
            let resolvedTrailerUrl: string | undefined = scene.trailerUrl;
            if (!resolvedTrailerUrl) {
              try {
                const trailerRes = await fetch('/api/extract-trailer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    urls: (scene.urls || []).map((u: any) => u.url || u),
                    code: scene.code || javCode,
                    title: scene.title,
                    studio: scene.studio
                  })
                });
                if (trailerRes.ok) {
                  const trailerData = await trailerRes.json();
                  if (trailerData.success && trailerData.trailerUrl) {
                    resolvedTrailerUrl = trailerData.trailerUrl;
                  }
                }
              } catch (e) {
                console.warn('Trailer extraction error:', e);
              }
            }

            const newLink: Omit<LinkItem, 'id'> = {
              title: resolvedTitle,
              coverImage: scene.coverUrl,
              galleryUrls: sanitizeGalleryUrls(rawGalleryUrls || []),
              aspectRatio: computedAspectRatio,
              actorIds,
              studioIds,
              assignedDate: scene.date && !isNaN(new Date(scene.date + 'T12:00:00Z').getTime()) ? new Date(scene.date + 'T12:00:00Z').getTime() : undefined,
              stashDbId: scene.id,
              magnet: torrentData?.magnet1080p,
              magnet4K: torrentData?.magnet2160p,
              torrentUrlHD: torrentData?.url1080p,
              torrentUrl4K: torrentData?.url2160p,
              torrentSiteName: torrentData?.sourceSite,
              trailerUrl: resolvedTrailerUrl,
            };

            resolvedLinks[index] = newLink;
          } catch (sceneErr) {
            console.error("Error processing scene:", scene.title, sceneErr);
          } finally {
            completedCount++;
            setSaveProgress({
              current: completedCount,
              total: selectedScenes.length,
              title: scene.title || "Processing..."
            });
          }
        };

        const CONCURRENCY = 4;
        const worker = async () => {
          while (nextIndex < selectedScenes.length && !abortSaveRef.current && !masterAbortCtrl.signal.aborted) {
            const currentIndex = nextIndex++;
            await processScene(selectedScenes[currentIndex], currentIndex);
          }
        };

        const workerCount = Math.min(CONCURRENCY, selectedScenes.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        if (abortSaveRef.current || masterAbortCtrl.signal.aborted) {
          addNotification("Batch save operation cancelled.", "warning");
        } else {
          const linksToAdd = resolvedLinks.filter((l): l is Omit<LinkItem, 'id'> => l !== null);
          if (linksToAdd.length > 0) {
            setSaveProgress({ current: selectedScenes.length, total: selectedScenes.length, title: "Persisting to storage..." });

            // Deduplication against existing state.links
            const existingStashDbIds = new Set(state.links.map(l => l.stashDbId).filter(Boolean));
            const existingMagnetHashes = new Set(
              state.links.flatMap(l => [extractMagnetHash(l.magnet), extractMagnetHash(l.magnet4K)]).filter(Boolean) as string[]
            );

            const validLinksToAdd: Omit<LinkItem, 'id'>[] = [];
            let duplicateCount = 0;
            for (const link of linksToAdd) {
              const h1 = extractMagnetHash(link.magnet);
              const h2 = extractMagnetHash(link.magnet4K);
              const isDuplicateStashId = Boolean(link.stashDbId && existingStashDbIds.has(link.stashDbId));
              const isDuplicateHash = Boolean((h1 && existingMagnetHashes.has(h1)) || (h2 && existingMagnetHashes.has(h2)));

              if (isDuplicateStashId || isDuplicateHash) {
                duplicateCount++;
              } else {
                validLinksToAdd.push(link);
                if (link.stashDbId) existingStashDbIds.add(link.stashDbId);
                if (h1) existingMagnetHashes.add(h1);
                if (h2) existingMagnetHashes.add(h2);
              }
            }

            if (validLinksToAdd.length > 0) {
              await addLinks(validLinksToAdd);
              setSelectedScenesMap(new Map());

              let msg = `Added ${validLinksToAdd.length} link(s)`;
              const extras: string[] = [];
              if (duplicateCount > 0) extras.push(`${duplicateCount} duplicate(s) skipped`);
              if (skippedJavNoMagnetCount > 0) extras.push(`${skippedJavNoMagnetCount} JAV item(s) skipped (no magnet found)`);
              if (failedMagnetCount > 0) extras.push(`${failedMagnetCount} item(s) missing magnet`);

              if (extras.length > 0) {
                msg += ` (${extras.join(', ')}).`;
                addNotification(msg, skippedJavNoMagnetCount > 0 ? "warning" : "success");
              } else {
                msg += " successfully!";
                addNotification(msg, "success");
              }
              const targetDestination = (location.state as any)?.from || "/";
              navigate(targetDestination, { replace: true, state: (location.state as any)?.returnState });
            } else {
              setSelectedScenesMap(new Map());
              addNotification(`All ${linksToAdd.length} link(s) are already in your collection.`, "warning");
            }
          } else {
            setSelectedScenesMap(new Map());
            if (skippedJavNoMagnetCount > 0) {
              addNotification(`No links added: ${skippedJavNoMagnetCount} JAV item(s) were skipped because no valid magnet/stream was found.`, "warning");
            } else {
              addNotification("No valid links were processed for saving.", "warning");
            }
          }
        }
      } catch (error: any) {
        console.error("Batch save error:", error);
        addNotification("An unexpected error occurred during batch save. Please try again.", "error");
      } finally {
        isSavingRef.current = false;
        saveAbortControllerRef.current = null;
        if (saveBtn) {
          saveBtn.style.opacity = '1';
          saveBtn.style.pointerEvents = 'auto';
          if (originalHTML) saveBtn.innerHTML = originalHTML;
        }
        setSaveProgress(null);
      }
    };

    window.addEventListener("stashdb-save-trigger", handleSave);
    return () => window.removeEventListener("stashdb-save-trigger", handleSave);
  }, [
    selectedScenesMap,
    scenes,
    addLink,
    addLinks,
    addNotification,
    addActor,
    updateActor,
    addStudio,
    updateStudio,
    state.actors,
    state.studios,
    state.links,
    navigate,
    location.state,
    state.settings.stashDbApiKey,
    state.settings.javstashApiKey,
    stashDbSearchMode,
  ]);

  const handleSearch = async () => {
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    if (!stashDbSearchMode) {
      addNotification("Please select a search type first.", "error");
      return;
    }
    const isJavMode = stashDbSearchMode === 'jav';
    const apiKey = isJavMode 
      ? (state.settings.javstashApiKey || state.settings.stashDbApiKey)
      : state.settings.stashDbApiKey;
    const endpoint = isJavMode ? "/api/javstash" : "/api/stashdb";

    if (stashDbSearchMode === 'sexmex') {
        const inputVal = query.trim();
        if (!inputVal) return;
        setIsSearching(true);
        setPerformers([]);
        setScenes([]);
        setSelectedScenesMap(new Map());
        setSelectedPerformerId(null);
        
        const isUrl = inputVal.startsWith('http') && inputVal.includes('sexmex');

        try {
            if (!isUrl) {
                const res = await fetch('/api/scrape/sexmex/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: inputVal }),
                });
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
                const data = await res.json();
                if (data.performers && data.performers.length > 0) {
                    const formatted = data.performers.map((p: any) => {
                        const cleanName = (p.name || "").toLowerCase().trim();
                        const normName = (p.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                        const noSpacesName = cleanName.replace(/\s+/g, "");
                        const matched = existingActorMap.get(p.url) || existingActorMap.get(cleanName) || existingActorMap.get(normName) || existingActorMap.get(noSpacesName);
                        return {
                            id: p.url, 
                            name: p.name,
                            imageUrl: matched?.originalImageUrl || matched?.imageUrl || p.imageUrl,
                            availableImages: matched?.availableImages,
                            gender: 'FEMALE',
                            imagePositionX: matched?.imagePositionX,
                            imagePositionY: matched?.imagePositionY,
                            imageZoom: matched?.imageZoom,
                        };
                    });
                    setPerformers(formatted);
                    if (formatted.length > 0) {
                        setSelectedPerformerId(formatted[0].id);
                        await fetchSexMexScenes(formatted[0].id);
                        if (formatted.length > 1) {
                            addNotification(`Found ${formatted.length} actors. Auto-selected ${formatted[0].name}.`, "success");
                        }
                    }
                } else {
                    addNotification("No actors found matching that name.", "error");
                }
            } else {
                setSelectedPerformerId(inputVal);
                await fetchSexMexScenes(inputVal);
            }
        } catch (err: any) {
            addNotification(err.message || "Failed to search SexMex.", "error");
        } finally {
            setIsSearching(false);
        }
        return;
    }

    if (!apiKey) {
      addNotification(
        isJavMode
          ? "Please configure your JAVStash API Key in Settings > Integrations first."
          : "Please configure your StashDB API Key in Settings > Integrations first.",
        "error",
      );
      return;
    }
    if (!query.trim()) return;

    setIsSearching(true);
    setPerformers([]);
    setScenes([]);
    setSelectedScenesMap(new Map());
    setSelectedPerformerId(null);

    try {
      let entityId = query.trim();
      let searchType = (stashDbSearchMode === 'actor' || stashDbSearchMode === 'jav') ? 'performer' : 'studio';
      
      if (entityId.includes("javstash.org/scenes/")) {
        const match = entityId.match(/scenes\/([a-f0-9\-]+)/i);
        if (match) {
           entityId = match[1];
           searchType = 'scene';
        }
      } else if (entityId.includes("javstash.org/performers/")) {
        const match = entityId.match(/performers\/([a-f0-9\-]+)/i);
        if (match) {
           entityId = match[1];
           searchType = 'performer';
           if (stashDbSearchMode !== 'jav') {
             stateCache.current[stashDbSearchMode] = { ...stateValuesRef.current };
             setStashDbSearchMode('jav');
           }
        }
      } else if (entityId.includes("stashdb.org/scenes/")) {
        const match = entityId.match(/scenes\/([a-f0-9\-]+)/i);
        if (match) {
           entityId = match[1];
           searchType = 'scene';
        }
      } else if (entityId.includes("stashdb.org/performers/")) {
        const match = entityId.match(/performers\/([a-f0-9\-]+)/i);
        if (match) {
           entityId = match[1];
           searchType = 'performer';
           if (stashDbSearchMode !== 'actor') {
             stateCache.current[stashDbSearchMode] = { ...stateValuesRef.current };
             setStashDbSearchMode('actor');
           }
        }
      } else if (entityId.includes("stashdb.org/studios/")) {
        const match = entityId.match(/studios\/([a-f0-9\-]+)/i);
        if (match) {
           entityId = match[1];
           searchType = 'studio';
           if (stashDbSearchMode !== 'studio') {
             stateCache.current[stashDbSearchMode] = { ...stateValuesRef.current };
             setStashDbSearchMode('studio');
           }
        }
      }

      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          entityId,
        );

      if (searchType === 'scene' || isUUID) {
        try {
            const sceneQuery = `query FindScene($id: ID!) {
              findScene(id: $id) {
                id
                title
                code
                release_date
                date
                studio { id name images { url } parent { id name images { url } } }
                images { url }
                urls { url type site { name } }
                performers { performer { id name aliases gender images { url } urls { url type site { name } } } }
              }
            }`;
            const sceneRes = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apiKey,
                query: sceneQuery,
                variables: { id: entityId },
              }),
            });
            const sceneData = await sceneRes.json();
            const scene = sceneData.data?.findScene;
            if (scene) {
                const isJavMode = stashDbSearchMode === 'jav';
                let resolvedTitle: string;
                let studioCode = '';

                if (isJavMode) {
                  const detectedCode = extractJavCode(scene.code, scene.title);
                  studioCode = detectedCode || (scene.code ? scene.code.trim().toUpperCase() : '');
                  resolvedTitle = studioCode || scene.title?.trim() || "";
                } else {
                  // StashDB (Actor, Studio): Always capture the scene Title, NOT Studio Code
                  resolvedTitle = scene.title?.trim() || "";
                  studioCode = scene.code ? scene.code.trim() : "";
                }

                const sceneInfo = {
                  code: studioCode || scene.code || "",
                  studio: scene.studio?.name || "",
                  parentNetwork: scene.studio?.parent?.name || "",
                  title: scene.title || ""
                };

                // If JAV and has more than 2 performers, skip / block
                const isJavExcess = isJavMode && shouldSkipJavSceneExcessPerformers(scene.performers || [], sceneInfo);
                const isNumberedVol = !isJavMode && hasNumberedVolumePattern(scene.title);

                const formattedScene = {
                  id: scene.id,
                  title: resolvedTitle,
                  code: studioCode || scene.code || "",
                  date: scene.release_date || scene.date || "",
                  studio: scene.studio?.name || "",
                  parentNetwork: scene.studio?.parent?.name || undefined,
                  parentStudioId: scene.studio?.parent?.id || undefined,
                  studioLogoUrl: scene.studio?.images && scene.studio.images.length > 0 ? scene.studio.images[0].url : undefined,
                  actors: (scene.performers || [])
                  .filter((p: any) => isFemalePerformer(p.performer?.gender))
                  .map((p: any) => {
                    const rawName = p.performer?.name;
                    const aliases = p.performer?.aliases || [];
                    const resolvedName = resolveEnglishPerformerName(rawName, aliases);
                    return { 
                      name: resolvedName || rawName, 
                      imageUrl: p.performer?.images?.[0]?.url || "", 
                      availableImages: Array.from(new Set(p.performer?.images?.map((img: any) => img.url) || [])) 
                    };
                  })
                  .filter((a: any) => Boolean(a.name)),
                coverUrl: scene.images && scene.images.length > 0 ? scene.images[0].url : "",
                urls: scene.urls || [],
              };
      
              const isSceneBlocked = isJavExcess ||
                                    isNumberedVol ||
                                    isStudioBlocked(formattedScene.studio, formattedScene.parentNetwork, state.settings.hiddenStashDbStudios);
      
              if (isSceneBlocked) {
                setScenes([]);
                if (isJavExcess) {
                  addNotification("JAV scene skipped (exceeds 2 performers limit).", "warning");
                } else if (isNumberedVol) {
                  addNotification("Scene skipped (contains volume pattern #number).", "warning");
                } else {
                  addNotification("Scene is from a blocked studio.", "error");
                }
              } else {
                setScenes(formattedScene.coverUrl ? [formattedScene] : []);
                setTotalScenes(formattedScene.coverUrl ? 1 : 0);
                addNotification("Scene found.", "success");
              }
              setIsSearching(false);
              return;
            }
        } catch {}
        
        if (searchType === 'scene') {
            addNotification("Scene not found.", "error");
            setIsSearching(false);
            return;
        }
      }

      const actualMode = stashDbSearchMode === 'jav' ? 'jav' : (searchType === 'performer' ? 'actor' : searchType === 'studio' ? 'studio' : stashDbSearchMode);
      if (isUUID) {
        setSelectedPerformerId(entityId);
        await fetchScenesForEntity(entityId, actualMode === 'studio' ? 'studio' : 'actor', apiKey);
      } else {
        if (actualMode === 'actor' || actualMode === 'jav') {
          const perfQuery = `query SearchPerformers($term: String!, $limit: Int) {
            searchPerformer(term: $term, limit: $limit) {
              id name aliases disambiguation scene_count gender images { url } urls { url type site { name } }
            }
          }`;
          const perfRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              apiKey,
              query: perfQuery,
              variables: { 
                term: entityId,
                limit: 50
              },
            }),
          });
          const perfData = await perfRes.json();
          if (perfData.errors && !perfData.data?.searchPerformer) throw new Error(perfData.errors[0].message);

          // Strictly filter only female / transgender female performers (user mandate: no male performers)
          const fetchedPerformers = (perfData.data?.searchPerformer || []).filter((p: any) => isFemalePerformer(p.gender));
          
          if (fetchedPerformers.length === 0) {
            addNotification(isJavMode ? "No JAV actor found with that name." : "No female actor found with that name.", "error");
            setIsSearching(false);
            return;
          }

          const cleanSearchTerm = entityId.trim().toLowerCase();

          // Intelligent ranking / scoring algorithm
          const scoredPerformers = fetchedPerformers.map((p: any) => {
            const resolvedName = resolveEnglishPerformerName(p.name, p.aliases);
            const displayName = resolvedName || p.name;
            const pName = displayName.trim().toLowerCase();
            const rawPName = (p.name || "").trim().toLowerCase();
            const sceneCount = Number(p.scene_count) || 0;
            const hasImages = (p.images && p.images.length > 0) || false;
            
            // Check if actor is already added in user's library using comprehensive multi-key matching
            const pKeys = getActorMatchingKeys(displayName, p.id);
            if (rawPName !== pName) {
              for (const k of getActorMatchingKeys(p.name)) {
                pKeys.push(k);
              }
            }
            const isAlreadyInLibrary = pKeys.some(k => existingActorMap.has(k));

            let score = 0;
            // 1. In user's library priority - Absolute top priority (+1,000,000)
            if (isAlreadyInLibrary) {
              score += 1000000;
            }

            // 2. Exact match with search term boost (+10,000)
            const aliasMatch = (p.aliases || []).some((al: string) => typeof al === 'string' && al.trim().toLowerCase() === cleanSearchTerm);
            if (pName === cleanSearchTerm || rawPName === cleanSearchTerm || aliasMatch) {
              score += 10000;
            } else if (pName.startsWith(cleanSearchTerm) || rawPName.startsWith(cleanSearchTerm)) {
              score += 1000;
            }

            // 3. StashDB scene count (popularity / activity weight)
            score += sceneCount * 5;

            // 4. Has profile images (+50)
            if (hasImages) {
              score += 50;
            }

            const imagesList: string[] = Array.from(new Set((p.images?.map((img: any) => img.url) || []).filter(Boolean))) as string[];
            if (imagesList.length > 0) {
              cacheActorImages(p.id, imagesList);
              if (displayName) cacheActorImages(displayName, imagesList);
              if (p.name && p.name !== displayName) cacheActorImages(p.name, imagesList);
            }

            const socials = extractSocialUrls(p.urls);

            return {
              id: p.id,
              name: displayName,
              aliases: p.aliases,
              disambiguation: p.disambiguation,
              sceneCount,
              imageUrl: p.images?.[0]?.url || "",
              availableImages: imagesList,
              isAlreadyInLibrary,
              instagramUrl: socials.instagramUrl,
              twitterUrl: socials.twitterUrl,
              onlyFansUrl: socials.onlyFansUrl,
              score
            };
          });

          // Sort descending by calculated score (Library actors will always come first)
          scoredPerformers.sort((a, b) => b.score - a.score);

          const formattedPerformers: StashPerformer[] = scoredPerformers.map(({ score, ...item }) => item);

          setPerformers(formattedPerformers);
          
          if (formattedPerformers.length > 0) {
            // Automatically select and fetch scenes for the best/top ranked performer
            const topPerformer = formattedPerformers[0];
            setSelectedPerformerId(topPerformer.id);
            await fetchScenesForEntity(topPerformer.id, 'actor', apiKey);
            if (formattedPerformers.length > 1) {
              addNotification(`Found ${formattedPerformers.length} actors (Top: ${topPerformer.name}).`, "success");
            }
          }
        } else if (actualMode === 'studio') {
          const studioQuery = `query SearchStudios($term: String!, $limit: Int) {
            searchStudio(term: $term, limit: $limit) {
              id name images { url } sub_studios { studios { id name } }
            }
          }`;
          const studioRes = await fetch("/api/stashdb", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              apiKey,
              query: studioQuery,
              variables: { 
                term: entityId,
                limit: 50
              },
            }),
          });
          const studioData = await studioRes.json();
          if (studioData.errors && !studioData.data?.searchStudio) throw new Error(studioData.errors[0].message);

          const fetchedStudios = studioData.data?.searchStudio || [];
          
          if (fetchedStudios.length === 0) {
            addNotification("No studio found with that name.", "error");
            setIsSearching(false);
            return;
          }

          const formattedStudios: StashPerformer[] = fetchedStudios
            .map((s: any) => ({
              id: s.id,
              name: s.name,
              imageUrl: s.images?.[0]?.url || "",
              child_studios: s.sub_studios?.studios?.map((c: any) => c.id) || []
            }));

          setPerformers(formattedStudios);
          
          if (formattedStudios.length > 0) {
            let bestMatch = formattedStudios.find(
              (s) => s.name.toLowerCase() === entityId.toLowerCase() && (s.child_studios?.length || 0) > 0
            );
            
            if (!bestMatch) {
              bestMatch = formattedStudios.find(
                (s) => s.name.toLowerCase() === `${entityId.toLowerCase()} (network)`
              );
            }

            if (!bestMatch) {
              bestMatch = formattedStudios.find(
                (s) => s.name.toLowerCase().includes(entityId.toLowerCase()) && (s.child_studios?.length || 0) > 0
              );
            }
            
            if (!bestMatch) {
              bestMatch = formattedStudios.find((s) => s.name.toLowerCase() === entityId.toLowerCase());
            }
            
            if (!bestMatch) {
              bestMatch = [...formattedStudios].sort((a, b) => (b.child_studios?.length || 0) - (a.child_studios?.length || 0))[0];
            }

            setSelectedPerformerId(bestMatch.id);
            await fetchScenesForEntity(bestMatch.id, 'studio', apiKey);
            
            if (formattedStudios.length > 1) {
              addNotification(`Found ${formattedStudios.length} studios. Auto-selected ${bestMatch.name}.`, "success");
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      console.error(e);
      addNotification(e.message || "An error occurred during search.", "error");
    } finally {
      setIsSearching(false);
    }
  };

  const fetchSexMexScenes = async (url: string) => {
    setIsFetchingScenes(true);
    setScenes([]);
    try {
      const res = await fetch('/api/scrape/sexmex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        let errMessage = `Server request error: ${res.status}`;
        try {
          const errData = await res.json();
          if (errData.error) errMessage = errData.error;
        } catch {}
        throw new Error(errMessage);
      }
      const data = await res.json();
      if (data.success && data.scenes) {
        const mapped: StashScene[] = data.scenes.map((s: any) => ({
          id: generateStableSexmexId(s), 
          title: s.title || "",
          date: s.date || "",
          studio: s.tag || "SexMex", 
          actors: (s.actors || []).map((name: string) => ({ name, imageUrl: "" })),
          coverUrl: s.coverUrl
            ? (s.coverUrl.startsWith('/api/')
                ? s.coverUrl
                : (s.coverUrl.includes('sexmex') || s.coverUrl.includes('sexmex-cdn.com'))
                ? `/api/sexmex/image?url=${encodeURIComponent(s.coverUrl)}`
                : s.coverUrl)
            : "",
        })).filter((s: StashScene) => !isStudioBlocked(s.studio, undefined, state.settings.hiddenStashDbStudios));
        
        setScenes(mapped);
        setTotalScenes(mapped.length);
        setCurrentPage(1);
      } else {
        throw new Error(data.error || "Failed to fetch scenes");
      }
    } catch (e: any) {
      addNotification(e.message || "An error occurred fetching SexMex scenes.", "error");
    } finally {
      setIsFetchingScenes(false);
    }
  };

  const fetchScenesForEntity = async (
    entityId: string | string[],
    entityType: "actor" | "studio",
    apiKey: string,
    page: number = 1
  ) => {
    // Abort previous in-flight scene requests to avoid race conditions
    if (fetchScenesAbortControllerRef.current) {
      fetchScenesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchScenesAbortControllerRef.current = controller;
    const currentRequestId = ++fetchScenesRequestIdRef.current;

    setIsFetchingScenes(true);
    setScenes([]);

    const isJavMode = stashDbSearchMode === 'jav';
    const endpoint = isJavMode ? "/api/javstash" : "/api/stashdb";

    try {
      const sceneQuery = `query Scenes($input: SceneQueryInput!) {
        queryScenes(input: $input) {
          count
          scenes {
            id
            title
            code
            release_date
            date
            studio { id name images { url } parent { id name images { url } } }
            images { url }
            urls { url type site { name } }
            performers { performer { id name aliases gender images { url } urls { url type site { name } } } }
          }
        }
      }`;
      const modifierValue = Array.isArray(entityId) ? entityId : [entityId];
      const sceneRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          apiKey,
          query: sceneQuery,
          variables: {
            input: {
              ...(entityType === "actor" 
                  ? { performers: { modifier: "INCLUDES", value: modifierValue } } 
                  : { parentStudio: Array.isArray(entityId) ? entityId[0] : entityId }),
              sort: "DATE",
              direction: "DESC",
              per_page: itemsPerPage,
              page: page
            },
          },
        }),
      });
      const sceneData = await sceneRes.json();
      if (sceneData.errors && !sceneData.data?.queryScenes?.scenes) throw new Error(sceneData.errors[0].message);

      // Check if request is still the newest one
      if (currentRequestId !== fetchScenesRequestIdRef.current) return;

      const fetchedScenes = sceneData.data?.queryScenes?.scenes || [];
      const totalCount = sceneData.data?.queryScenes?.count || 0;

      const formattedScenes: StashScene[] = fetchedScenes
        .filter((s: any) => {
          const isJavMode = stashDbSearchMode === 'jav';
          // Filter out compilation / volume patterns like "Anal #6", "BDSM #3", etc. for StashDB
          if (!isJavMode && hasNumberedVolumePattern(s.title)) return false;

          if (isJavMode) {
            const detectedCode = extractJavCode(s.code, s.title);
            const sceneInfo = {
              code: detectedCode || s.code || "",
              studio: s.studio?.name || "",
              parentNetwork: s.studio?.parent?.name || "",
              title: s.title || ""
            };
            // Filter out JAV scenes that have more than 2 performers
            return !shouldSkipJavSceneExcessPerformers(s.performers || [], sceneInfo);
          }
          return true;
        })
        .map((s: any) => {
          const isJavMode = stashDbSearchMode === 'jav';
          let resolvedTitle: string;
          let studioCode = '';

          if (isJavMode) {
            // JAVStash: Studio Code is captured
            const detectedCode = extractJavCode(s.code, s.title);
            studioCode = detectedCode || (s.code ? s.code.trim().toUpperCase() : '');
            resolvedTitle = studioCode || s.title?.trim() || "";
          } else {
            // StashDB (Actor, Studio): Capture the Title, NOT Studio Code!
            resolvedTitle = s.title?.trim() || "";
            studioCode = s.code ? s.code.trim() : "";
          }

          // Fallback studio logo from parent if sub-studio has no images
          const studioLogo = s.studio?.images && s.studio.images.length > 0 
            ? s.studio.images[0].url 
            : (s.studio?.parent?.images && s.studio.parent.images.length > 0 ? s.studio.parent.images[0].url : undefined);

          return {
            id: s.id,
            title: resolvedTitle,
            code: studioCode || s.code || "",
            date: s.release_date || s.date || "",
            studio: s.studio?.name || "",
            parentNetwork: s.studio?.parent?.name || undefined,
            parentStudioId: s.studio?.parent?.id || undefined,
            studioLogoUrl: studioLogo,
            // Strictly exclude male and transgender male actors (user mandate)
            actors: (s.performers || [])
              .filter((p: any) => isFemalePerformer(p.performer?.gender))
              .map((p: any) => {
                const performerSocials = extractSocialUrls(p.performer?.urls);
                const rawName = p.performer?.name;
                const aliases = p.performer?.aliases || [];
                const resolvedName = resolveEnglishPerformerName(rawName, aliases);
                const displayName = resolvedName || rawName;

                return { 
                  id: p.performer?.id,
                  stashDbId: p.performer?.id,
                  name: displayName, 
                  imageUrl: p.performer?.images?.[0]?.url || "", 
                  availableImages: Array.from(new Set(p.performer?.images?.map((img: any) => img.url) || [])),
                  instagramUrl: performerSocials.instagramUrl,
                  twitterUrl: performerSocials.twitterUrl,
                  onlyFansUrl: performerSocials.onlyFansUrl,
                };
              })
              .filter((a: any) => Boolean(a.name)),
            coverUrl: s.images && s.images.length > 0 ? s.images[0].url : "",
            urls: s.urls || [],
          };
        })
        .filter((s: StashScene) => !isStudioBlocked(s.studio, s.parentNetwork, state.settings.hiddenStashDbStudios));

      if (currentRequestId === fetchScenesRequestIdRef.current) {
        setScenes(formattedScenes);
        setTotalScenes(totalCount);
        setCurrentPage(page);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      if (currentRequestId === fetchScenesRequestIdRef.current) {
        addNotification(`Failed to fetch scenes: ${e.message}`, "error");
      }
    } finally {
      if (currentRequestId === fetchScenesRequestIdRef.current) {
        setIsFetchingScenes(false);
      }
    }
  };

  const toggleSelection = useCallback((scene: StashScene) => {
    setSelectedScenesMap(prev => {
      const next = new Map(prev);
      if (next.has(scene.id)) next.delete(scene.id);
      else next.set(scene.id, scene);
      return next;
    });
  }, []);

  const handlePageChange = (page: number) => {
    if (stashDbSearchMode === "sexmex") {
        setCurrentPage(page);
        scrollToTop();
        return;
    }
    const currentKey = stashDbSearchMode === "jav"
      ? (state.settings.javstashApiKey || state.settings.stashDbApiKey)
      : state.settings.stashDbApiKey;
    if (!selectedPerformerId || !currentKey) return;
    
    fetchScenesForEntity(selectedPerformerId, stashDbSearchMode === "studio" ? "studio" : "actor", currentKey, page);
    scrollToTop();
  };

  // Dispatch an event so layout can show/hide the header check button
  useEffect(() => {
    const btn = document.getElementById("stashdb-save-btn");
    if (btn) {
      if (selectedScenesMap.size > 0) btn.classList.remove("hidden");
      else btn.classList.add("hidden");
    }
  }, [selectedScenesMap]);

  const visibleScenes = useMemo(() => {
    if (stashDbSearchMode === "sexmex") {
      return scenes.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    }
    return scenes;
  }, [scenes, stashDbSearchMode, currentPage, itemsPerPage]);

  const isAllVisibleSelected = useMemo(() => {
    if (visibleScenes.length === 0) return false;
    return visibleScenes.every(s => selectedScenesMap.has(s.id));
  }, [visibleScenes, selectedScenesMap]);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedScenesMap(prev => {
      const next = new Map(prev);
      if (isAllVisibleSelected) {
        visibleScenes.forEach(s => next.delete(s.id));
      } else {
        visibleScenes.forEach(s => {
          const isAdded = state.links.some(
            (l) => l.stashDbId === s.id || (l.coverImage && l.coverImage === s.coverUrl)
          );
          if (!isAdded) next.set(s.id, s);
        });
      }
      return next;
    });
  }, [isAllVisibleSelected, visibleScenes, state.links]);

  return (
    <>
      <div className="w-full flex flex-col gap-5 animate-fade-in pb-4">
        
        {/* Search Input Bar & Trigger */}
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 min-w-0">
            <InputBar
              label={
                stashDbSearchMode === "sexmex" 
                  ? "URL" 
                  : stashDbSearchMode === "studio" 
                  ? "Studio" 
                  : stashDbSearchMode === "jav"
                  ? "JAV Actor"
                  : "Actor"
              }
              showPaste
              value={query}
              onChange={setQuery}
              placeholder={
                stashDbSearchMode === "sexmex" 
                  ? "Paste SexMex Scene URL or Model..." 
                  : stashDbSearchMode === "studio" 
                  ? "Studio Name, UUID, or StashDB Scene URL..." 
                  : stashDbSearchMode === "jav"
                  ? "JAV Actor Name, UUID, or JAVStash URL..."
                  : "Actor Name, UUID, or StashDB Scene URL..."
              }
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              compact
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching || !query.trim() || !stashDbSearchMode}
            className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border),0_4px_6px_-1px_rgba(0,0,0,0.1)] active:scale-95 transition-all text-black disabled:opacity-50 self-end"
            style={{ backgroundColor: state.settings.buttonColor || accentColor }}
            title="Search"
          >
            {isSearching ? (
              <Icons.Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Icons.SearchIcon className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Horizontal Performers/Studios Bar */}
        {!isSearching && performers.length > 0 && (
          <div className="w-full flex flex-col gap-2">
            <div className="px-1 h-[18px] flex items-center">
              <span className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                {stashDbSearchMode === "actor" ? "Actors" : stashDbSearchMode === "studio" ? "Studios" : stashDbSearchMode === "jav" ? "JAV Actors" : "Actors"}
              </span>
            </div>
            <div 
              className="w-full flex overflow-x-auto gap-3 pb-3 pt-2 snap-x hide-scrollbar px-2"
              style={{
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-x',
                overscrollBehaviorX: 'contain',
                contain: 'paint layout',
                transform: 'translateZ(0)',
                willChange: 'scroll-position'
              }}
            >
              {performers.map((performer) => {
                const isSelected = performer.id === selectedPerformerId;
                
                let existingActor: typeof state.actors[0] | undefined = undefined;
                if (stashDbSearchMode !== "studio") {
                  const keys = getActorMatchingKeys(performer.name, performer.id);
                  for (const k of keys) {
                    if (existingActorMap.has(k)) {
                      existingActor = existingActorMap.get(k);
                      break;
                    }
                  }
                }

                let displayImageUrl = performer.imageUrl;
                let imageStyle: React.CSSProperties | undefined = undefined;

                if (stashDbSearchMode === "studio") {
                  const sKeys = getStudioMatchingKeys(performer.name, performer.id);
                  for (const sk of sKeys) {
                    const cachedLogo = studioLogoMap.get(sk);
                    if (cachedLogo) {
                      displayImageUrl = cachedLogo;
                      break;
                    }
                  }
                } else if (existingActor) {
                  displayImageUrl = existingActor.originalImageUrl || existingActor.imageUrl || performer.imageUrl;
                  imageStyle = {
                    objectPosition: `${existingActor.imagePositionX ?? 50}% ${existingActor.imagePositionY ?? 50}%`,
                    transform: `scale(${existingActor.imageZoom || 1})`,
                    transformOrigin: `${existingActor.imagePositionX ?? 50}% ${existingActor.imagePositionY ?? 50}%`
                  };
                } else if (performer.imagePositionX !== undefined || performer.imagePositionY !== undefined || performer.imageZoom !== undefined) {
                  imageStyle = {
                    objectPosition: `${performer.imagePositionX ?? 50}% ${performer.imagePositionY ?? 50}%`,
                    transform: `scale(${performer.imageZoom || 1})`,
                    transformOrigin: `${performer.imagePositionX ?? 50}% ${performer.imagePositionY ?? 50}%`
                  };
                }

                return (
                  <div
                    key={performer.id}
                    onClick={() => {
                      if (hasActiveTextSelection()) return;
                      if (performer.id !== selectedPerformerId) {
                        setSelectedPerformerId(performer.id);
                        if (stashDbSearchMode === "sexmex") {
                          fetchSexMexScenes(performer.id);
                        } else {
                          const currentKey = stashDbSearchMode === "jav"
                            ? (state.settings.javstashApiKey || state.settings.stashDbApiKey)
                            : state.settings.stashDbApiKey;
                          if (currentKey) {
                            fetchScenesForEntity(performer.id, stashDbSearchMode === "studio" ? "studio" : "actor", currentKey);
                          }
                        }
                      }
                    }}
                    className="snap-start shrink-0 flex flex-col items-center gap-2.5 cursor-pointer w-[84px] py-1"
                    style={{
                      transform: 'translateZ(0)',
                      willChange: 'transform'
                    }}
                  >
                    <div
                      className={`w-16 h-16 rounded-full overflow-hidden relative flex items-center justify-center transition-all duration-200 ease-out shrink-0 ${isSelected ? "scale-105" : "opacity-75 hover:opacity-100"}`}
                      style={{
                        backgroundColor: stashDbSearchMode === "studio" ? "#000000" : "var(--surface)",
                        boxShadow: isSelected 
                          ? `0 0 0 2px var(--background), 0 0 0 4.5px ${accentColor}, 0 6px 14px -2px rgba(0,0,0,0.35)` 
                          : "0 1px 3px rgba(0,0,0,0.15)",
                        transform: 'translateZ(0)',
                        WebkitMaskImage: '-webkit-radial-gradient(white, black)',
                      }}
                    >
                      {displayImageUrl ? (
                        <LazyImage
                          src={displayImageUrl}
                          availableImages={existingActor?.availableImages || performer.availableImages}
                          className={stashDbSearchMode === "studio" ? "object-contain p-2" : "object-cover"}
                          wrapperClassName="w-full h-full rounded-full"
                          style={imageStyle}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full bg-[var(--surface)] flex items-center justify-center border border-[var(--border)]">
                          {stashDbSearchMode === "studio" ? (
                            <Icons.Video className="w-6 h-6 text-[var(--text-muted)]" />
                          ) : (
                            <Icons.User className="w-6 h-6 text-[var(--text-muted)]" />
                          )}
                        </div>
                      )}
                      {isSelected && (
                        <>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent z-10 pointer-events-none" />
                          <div 
                            className="absolute inset-0 rounded-full border-2 z-20 pointer-events-none" 
                            style={{ borderColor: accentColor }} 
                          />
                        </>
                      )}
                    </div>
                    <div className="w-full px-1 min-h-[18px] py-0.5 flex items-center justify-center">
                      <span
                        className="text-[11.5px] font-medium text-center truncate leading-normal w-full select-text"
                        style={{ color: isSelected ? accentColor : 'var(--text-secondary)' }}
                      >
                        {performer.name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Skeletons during Performer Search */}
        {isSearching && (
          <div className="w-full flex flex-col gap-2 animate-pulse">
            <div className="px-1 h-[18px] flex items-center">
              <div className="w-16 h-3 rounded-full bg-[var(--skeleton-bg)]" />
            </div>
            <div 
              className="w-full flex overflow-x-auto gap-3 pb-3 pt-2 snap-x hide-scrollbar px-2"
              style={{
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-x',
                overscrollBehaviorX: 'contain',
                contain: 'paint layout',
                transform: 'translateZ(0)',
                willChange: 'scroll-position'
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div 
                  key={i} 
                  className="snap-start shrink-0 flex flex-col items-center gap-2.5 w-[84px] py-1"
                  style={{
                    transform: 'translateZ(0)',
                    willChange: 'transform'
                  }}
                >
                  <div
                    className={`w-16 h-16 rounded-full overflow-hidden relative flex items-center justify-center shrink-0 transition-all duration-200 ${i === 1 ? "scale-105" : "opacity-75"}`}
                    style={{
                      backgroundColor: 'var(--skeleton-bg)',
                      boxShadow: i === 1 
                        ? `0 0 0 2px var(--background), 0 0 0 4.5px var(--skeleton-bg), 0 6px 14px -2px rgba(0,0,0,0.2)` 
                        : "0 1px 3px rgba(0,0,0,0.15)",
                      transform: 'translateZ(0)',
                      WebkitMaskImage: '-webkit-radial-gradient(white, black)',
                    }}
                  />
                  <div className="w-full px-1 h-[15px] flex items-center justify-center">
                    <div className="w-14 h-2.5 rounded-full bg-[var(--skeleton-bg)]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skeletons during Scene Fetching */}
        {(isSearching || isFetchingScenes) && (
          <div className="flex flex-col gap-2.5 animate-pulse">
            <div className="flex justify-between items-center px-1 h-[18px]">
              <div className="w-20 h-3 rounded-full bg-[var(--skeleton-bg)]" />
              <div className="w-24 h-3 rounded-full bg-[var(--skeleton-bg)]" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="relative flex flex-col rounded-2xl overflow-hidden shadow-sm bg-[var(--surface)] border border-[var(--border)]">
                  <div className="aspect-video w-full relative overflow-hidden bg-[var(--skeleton-bg)]" />
                  <div className="p-3 flex flex-col gap-2 flex-1 justify-between bg-[var(--surface)]">
                    <h3 className="text-[12px] font-semibold leading-snug line-clamp-1 text-transparent relative select-none">
                      Title
                      <div className="absolute top-[15%] bottom-[15%] left-0 w-[80%] rounded-full bg-[var(--skeleton-bg)]" />
                    </h3>
                    <div className="flex flex-col gap-1.5 mt-auto pt-2.5 border-t border-[var(--border)]">
                      <div className="flex items-center gap-2 text-[11px] text-transparent relative select-none">
                        <Icons.User size={12} className="shrink-0 opacity-0" />
                        <span className="line-clamp-1 font-medium">Actor</span>
                        <div className="absolute top-[15%] bottom-[15%] left-0 w-[90%] rounded-full bg-[var(--skeleton-bg)]" />
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-transparent relative select-none">
                        <Icons.Video size={12} className="shrink-0 opacity-0" />
                        <span className="line-clamp-1 font-medium">Studio</span>
                        <div className="absolute top-[15%] bottom-[15%] left-0 w-[70%] rounded-full bg-[var(--skeleton-bg)]" />
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-transparent relative select-none">
                        <Icons.Calendar size={12} className="shrink-0 opacity-0" />
                        <span className="font-medium">Date</span>
                        <div className="absolute top-[15%] bottom-[15%] left-0 w-[50%] rounded-full bg-[var(--skeleton-bg)]" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* Scenes Grid */}
        {!isSearching && !isFetchingScenes && scenes.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between items-center px-1">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="text-[11.5px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors active:scale-95 select-none"
              >
                {isAllVisibleSelected ? "Deselect Page" : "Select Page"}
              </button>
              <span className="text-[11px] text-[var(--text-muted)]">
                Showing {Math.min((currentPage - 1) * itemsPerPage + 1, totalScenes)}-{Math.min(currentPage * itemsPerPage, totalScenes)} of {totalScenes}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {visibleScenes.map((scene) => {
                const isAdded = state.links.some(
                  (l) => (
                    l.stashDbId === scene.id || 
                    (l.coverImage && l.coverImage === scene.coverUrl) ||
                    (scene.title && l.title.trim().toLowerCase() === scene.title.trim().toLowerCase()) ||
                    (scene.code && l.title.trim().toLowerCase() === scene.code.trim().toLowerCase())
                  )
                );
                const isBlocked = (state.settings.hiddenStashDbStudios || [])
                  .map(s => s.toLowerCase())
                  .includes(scene.studio?.toLowerCase() || "");
                const isSelected = selectedScenesMap.has(scene.id) || isAdded;
                
                return (
                  <div
                    key={scene.id}
                    onClick={() => {
                      if (hasActiveTextSelection()) return;
                      if (!isAdded && !isBlocked) toggleSelection(scene);
                    }}
                    className={`relative flex flex-col rounded-2xl overflow-hidden transition-all duration-150 ease-out shadow-sm group ${
                      isBlocked 
                        ? "cursor-default ring-1 ring-red-500/50 bg-red-950/10" 
                        : isAdded 
                        ? "opacity-40 grayscale pointer-events-none bg-[var(--surface)]" 
                        : "cursor-pointer bg-[var(--surface)] hover:shadow-md hover:-translate-y-0.5"
                    }`}
                    style={{
                      boxShadow: isSelected && !isAdded && !isBlocked 
                        ? `0 0 0 2px ${accentColor} inset, 0 4px 12px rgba(0,0,0,0.15)` 
                        : 'inset 0 0 0 1px var(--border)',
                    }}
                  >
                    <div className="aspect-video w-full relative overflow-hidden group bg-[var(--card-bg)]">
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, var(--text) 0%, transparent 100%)', opacity: 0.08 }} />
                      {scene.coverUrl ? (
                        <LazyImage
                          src={scene.coverUrl}
                          className="object-cover object-center group-hover:scale-105 transition-transform duration-300"
                          wrapperClassName="w-full h-full bg-[var(--surface)]"
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-[var(--border)] opacity-30">
                          <Icons.Video size={32} />
                        </div>
                      )}
                      
                      {/* Selection Check Badge */}
                      <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end z-10">
                        {isSelected && (
                          <div 
                            className="w-6 h-6 rounded-full flex items-center justify-center text-black shadow-lg animate-scale-in"
                            style={{ backgroundColor: accentColor }}
                          >
                            <Icons.Check size={14} strokeWidth={3.5} />
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-3 flex flex-col gap-2 flex-1 justify-between bg-gradient-to-b from-[var(--surface)] to-[var(--bg)]/50">
                      <h3 className="text-[12px] font-semibold text-[var(--text-primary)] leading-snug line-clamp-1">
                        {scene.title || "Untitled Scene"}
                      </h3>
                      
                      <div className="flex flex-col gap-1.5 mt-auto pt-2 border-t border-[var(--border)]">
                        {scene.actors.length > 0 && (
                          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                            <Icons.User size={12} className="shrink-0 opacity-70" />
                            <span className="line-clamp-1 font-medium">{scene.actors.map(a => a.name).join(", ")}</span>
                          </div>
                        )}
                        {scene.studio && (
                          <div 
                            className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-red-400 transition-colors z-10 cursor-pointer w-fit p-1 -m-1 rounded-md"
                            title="Click to block studio"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isBlocked) {
                                setStudioToBlock(scene.studio);
                              }
                            }}
                          >
                            <Icons.Video size={12} className="shrink-0 opacity-70" />
                            <span className="line-clamp-1 font-medium">{scene.studio}</span>
                          </div>
                        )}
                        {scene.date && (
                          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                            <Icons.Calendar size={12} className="shrink-0 opacity-70" />
                            <span className="font-medium">{scene.date}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {isBlocked && (
                      <div className="absolute inset-0 bg-red-950/70 flex flex-col items-center justify-center backdrop-blur-[2px] z-20 gap-3">
                        <span className="text-[13px] font-bold text-red-400 drop-shadow-md tracking-wider text-center px-4">
                          {scene.studio}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const current = state.settings.hiddenStashDbStudios || [];
                            updateSettings({ hiddenStashDbStudios: current.filter(x => x.toLowerCase() !== scene.studio.toLowerCase()) });
                          }}
                          className="px-4 py-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold uppercase tracking-wider shadow-lg hover:bg-red-600 transition-colors active:scale-95"
                        >
                          Unblock
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Pagination Bar */}
        {!isFetchingScenes && scenes.length > 0 && totalScenes > itemsPerPage && (
          <div className="-mt-2">
            <PaginationBar
              currentPage={currentPage}
              totalLinks={totalScenes}
              itemsPerPage={itemsPerPage}
              onPageChange={handlePageChange}
            />
          </div>
        )}

      </div>


      {/* Save Progress Overlay Modal with Cancel Option */}
      <div
        className="fixed inset-0 z-[150] flex flex-col items-center justify-center p-8 transition-opacity duration-300"
        style={{
          opacity: saveProgress ? 1 : 0,
          pointerEvents: saveProgress ? "auto" : "none",
        }}
      >
        <div 
          className="absolute inset-0" 
          style={{ backgroundColor: 'var(--bg)', opacity: 0.98 }}
        />
        
        <div
          className="relative z-10 flex flex-col gap-6 w-full max-w-[400px] text-[var(--text-primary)] transition-transform duration-300"
          style={{
            transform: saveProgress ? "translateY(0)" : "translateY(15px)",
          }}
        >
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <span className="text-6xl font-extrabold tracking-tight drop-shadow-md">
              {saveProgress?.current || 0} <span className="text-[var(--text-muted)] text-4xl font-semibold">/ {saveProgress?.total || 0}</span>
            </span>
            <span className="text-base font-medium text-[var(--text-secondary)] truncate w-full drop-shadow-sm px-4">
              {saveProgress?.title || "Initializing..."}
            </span>
          </div>

          <div className="w-full h-3 bg-[var(--border)] rounded-full overflow-hidden relative shadow-inner">
            <div 
              className="absolute top-0 left-0 bottom-0 rounded-full transition-all duration-300 ease-out"
              style={{ 
                backgroundColor: accentColor, 
                boxShadow: `0 0 15px ${accentColor}60`,
                width: saveProgress && saveProgress.total > 0 ? `${(saveProgress.current / saveProgress.total) * 100}%` : "0%"
              }}
            />
          </div>

          <div className="flex justify-center mt-2">
            <button
              onClick={() => {
                abortSaveRef.current = true;
                if (saveAbortControllerRef.current) {
                  saveAbortControllerRef.current.abort();
                }
              }}
              className="px-6 py-2.5 min-h-[44px] min-w-[140px] flex items-center justify-center rounded-full bg-red-500/15 hover:bg-red-500/25 active:scale-95 text-red-400 font-semibold text-xs transition-all border border-red-500/30"
            >
              Cancel Saving
            </button>
          </div>
        </div>
      </div>

      {/* Block Studio Dialog */}
      <AnimatePresence>
        {studioToBlock && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setStudioToBlock(null);
              }
            }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-[32px] w-full max-w-sm p-6 shadow-2xl relative"
            >
              <h3 className="text-xl font-bold mb-2">Block Studio?</h3>
              <p className="text-[var(--text-secondary)] mb-6 leading-relaxed text-sm">
                You will no longer see scenes from <strong className="text-[var(--text-primary)]">{studioToBlock}</strong>.
              </p>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setStudioToBlock(null)}
                  className="flex-1 py-3.5 px-4 bg-[var(--border)] hover:bg-neutral-500/20 active:bg-neutral-500/30 font-semibold rounded-[28px] transition-colors text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    const current = state.settings.hiddenStashDbStudios || [];
                    updateSettings({ hiddenStashDbStudios: [...current, studioToBlock] });
                    setStudioToBlock(null);
                  }}
                  className="flex-1 py-3.5 px-4 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold rounded-[28px] transition-colors text-sm"
                >
                  Block
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
