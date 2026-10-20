import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { Icons } from "../constants";
import { AspectRatio, Studio } from "../types";
import { ActorSelector } from "../components/ActorSelector";
import { StudioSelector } from "../components/StudioSelector";
import { CoverPreview } from "../components/CoverPreview";
import { InputBar } from "../components/InputBar";
import { useLinkDetection } from "../hooks/useLinkDetection";

import { formatTitle } from "../utils/format";
import { Film, Loader2 } from "lucide-react";
import { isNaughtyAmericaStudioOrSeries, detectCoverAspectRatio } from "../utils/naughtyAmerica";
import { copyTextToClipboard } from "../utils/clipboard";
import { isPixeldrainUrl, extractPixeldrainUrl } from "../utils/pixeldrain";
import { isBunkrUrl, extractBunkrUrl } from "../utils/bunkr";
import { isFilesterUrl, extractFilesterUrl } from "../utils/filester";
import { isGofileUrl, extractGofileUrl } from "../utils/gofile";
import { isCyberfileUrl, extractCyberfileUrl } from "../utils/cyberfile";
import { isFileditchUrl, extractFileditchUrl } from "../utils/fileditch";
import { isEpornerUrl, extractEpornerUrl } from "../utils/eporner";
import { isPornhubUrl, pornhubResolver, isXhamsterUrl, xhamsterResolver, isPorntrexUrl, porntrexResolver } from "../utils/videoResolver";

export const AddEditLink: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    state,
    addLink,
    updateLink,
    addActor,
    updateActor,
    addStudio,
    formDraft,
    setFormDraft,
    addNotification,
    isHydrated,
  } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSaving = useRef(false);
  const isNavigatingToSubPage = useRef(false);

  const [isLocked, setIsLocked] = useState(true);
  const [torrentPopupData, setTorrentPopupData] = useState<{ url1080p: string, url2160p: string, sourceSite?: string } | null>(null);
  const [showTorrentPopup, setShowTorrentPopup] = useState(false);
  const toggleLock = useCallback(() => setIsLocked((prev) => !prev), []);

  const existing = useMemo(
    () => (id ? state.links.find((l) => l.id === id) : null),
    [state.links, id],
  );

  const [title, setTitle] = useState(
    () =>
      (formDraft?.id === (id || null) ? formDraft?.title : existing?.title) ||
      "",
  );
  const [urlHD, setUrlHD] = useState(
    () =>
      (formDraft?.id === (id || null) ? formDraft?.urlHD : existing?.urlHD) ||
      "",
  );
  const [url4K, setUrl4K] = useState(
    () =>
      (formDraft?.id === (id || null) ? formDraft?.url4K : existing?.url4K) ||
      "",
  );
  const [magnet, setMagnet] = useState(
    () =>
      (formDraft?.id === (id || null)
        ? (formDraft as any)?.magnet
        : existing?.magnet) || "",
  );
  const [magnet4K, setMagnet4K] = useState(
    () =>
      (formDraft?.id === (id || null)
        ? (formDraft as any)?.magnet4K
        : existing?.magnet4K) || "",
  );
  const [coverImage, setCoverImage] = useState(
    () =>
      (formDraft?.id === (id || null)
        ? formDraft?.coverImage
        : existing?.coverImage) || "",
  );
  const [coverOffset, setCoverOffset] = useState(
    () =>
      (formDraft?.id === (id || null)
        ? (formDraft as any)?.coverOffset
        : existing?.coverOffset) ?? 50,
  );
  const [trailerUrl, setTrailerUrl] = useState(
    () =>
      (formDraft?.id === (id || null)
        ? (formDraft as any)?.trailerUrl
        : existing?.trailerUrl) || "",
  );
  const [isExtractingTrailer, setIsExtractingTrailer] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    () =>
      (formDraft?.id === (id || null)
        ? formDraft?.aspectRatio
        : existing?.aspectRatio) || "16:9",
  );
  const [assignedDate, setAssignedDate] = useState<number | undefined>(() =>
    formDraft?.id === (id || null)
      ? formDraft?.assignedDate
      : existing?.assignedDate,
  );
  const [selectedActorIds, setSelectedActorIds] = useState<string[]>(() => {
    if (formDraft?.id === (id || null)) return formDraft?.actorIds || [];
    if (existing) return existing.actorIds || [];

    // Check query params for new link
    const params = new URLSearchParams(location.search);
    const actorId = params.get("actor");
    return actorId ? [actorId] : [];
  });
  const [selectedStudioIds, setSelectedStudioIds] = useState<string[]>(() => {
    if (formDraft?.id === (id || null))
      return (formDraft as any)?.studioIds || [];
    if (existing) return existing.studioIds || [];

    // Check query params for new link
    const params = new URLSearchParams(location.search);
    const studioId = params.get("studio");
    return studioId ? [studioId] : [];
  });
  const [galleryUrls, setGalleryUrls] = useState<string[]>(
    () =>
      (formDraft?.id === (id || null)
        ? formDraft?.galleryUrls
        : existing?.galleryUrls) || [],
  );
  const [originalGalleryUrls, setOriginalGalleryUrls] = useState<string[]>(
    () =>
      (formDraft?.id === (id || null)
        ? formDraft?.originalGalleryUrls
        : existing?.originalGalleryUrls) || [],
  );
  const [qualityPreference, setQualityPreference] = useState<
    "thumbnail" | "original"
  >(
    () =>
      (formDraft?.id === (id || null)
        ? formDraft?.qualityPreference
        : existing?.qualityPreference) || "thumbnail",
  );

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (isHydrated && id && existing && !hasInitialized.current) {
      // Only populate if we don't have a matching draft or if the draft is empty
      const useExisting = !formDraft || formDraft.id !== id;

      if (useExisting) {
        setTitle(existing.title || "");
        setUrlHD(existing.urlHD || "");
        setUrl4K(existing.url4K || "");
        setMagnet(existing.magnet || "");
        setMagnet4K(existing.magnet4K || "");
        setCoverImage(existing.coverImage || "");
        setCoverOffset(existing.coverOffset ?? 50);
        setTrailerUrl(existing.trailerUrl || "");
        setAspectRatio(existing.aspectRatio || "16:9");
        setAssignedDate(existing.assignedDate);
        setSelectedActorIds(existing.actorIds || []);
        setSelectedStudioIds(existing.studioIds || []);
        setGalleryUrls(existing.galleryUrls || []);
        setOriginalGalleryUrls(existing.originalGalleryUrls || []);
        setQualityPreference(existing.qualityPreference || "thumbnail");
        if ((existing as any).galleryScraperUrl) {
          setScraperUrl((existing as any).galleryScraperUrl);
        }
        if (existing.torrentUrlHD || existing.torrentUrl4K) {
           setTorrentPopupData({ 
             url1080p: existing.torrentUrlHD || '', 
             url2160p: existing.torrentUrl4K || '', 
             sourceSite: existing.torrentSiteName 
           });
        }
      } else if (formDraft) {
        if (formDraft.torrentUrlHD || formDraft.torrentUrl4K) {
           setTorrentPopupData({ 
             url1080p: formDraft.torrentUrlHD || '', 
             url2160p: formDraft.torrentUrl4K || '', 
             sourceSite: formDraft.torrentSiteName 
           });
        }
      }
      hasInitialized.current = true;
    }
  }, [isHydrated, id, existing, formDraft]);

  useEffect(() => {
    const locState = location.state as any;
    if (locState?.newlyAddedActorId || locState?.newlyAddedStudioId) {
      if (locState.newlyAddedActorId) {
        setSelectedActorIds((prev) =>
          prev.includes(locState.newlyAddedActorId)
            ? prev
            : [...prev, locState.newlyAddedActorId],
        );
      }
      if (locState.newlyAddedStudioId) {
        setSelectedStudioIds((prev) =>
          prev.includes(locState.newlyAddedStudioId)
            ? prev
            : [...prev, locState.newlyAddedStudioId],
        );
      }

      const newState = { ...locState };
      delete newState.newlyAddedActorId;
      delete newState.newlyAddedStudioId;
      navigate(location.pathname + location.search, {
        replace: true,
        state: newState,
      });
    }
  }, [location.state, navigate, location.pathname, location.search]);

  const [actorSearch, setActorSearch] = useState("");
  const [studioSearch, setStudioSearch] = useState("");
  const [isFetchingThumb, setIsFetchingThumb] = useState(false);
  const [isAutoSelecting, setIsAutoSelecting] = useState(false);

  const { performIntelligentDetection } = useLinkDetection(
    state.actors,
    state.studios,
    setSelectedActorIds,
    setSelectedStudioIds,
    setAspectRatio,
  );

  const [scraperUrl, setScraperUrl] = useState<string>(
    () =>
      (formDraft?.id === (id || null)
        ? (formDraft as any)?.galleryScraperUrl || (formDraft as any)?.scraperUrl
        : (existing as any)?.galleryScraperUrl) || (location.state as any)?.scraperUrl || "",
  );

  const isJavLink = useMemo(() => {
    const javMatch = title.match(/([a-zA-Z]{2,5}-\d{3,4})/i);
    const isJavByUrl = [urlHD, url4K, coverImage].some(u => typeof u === 'string' && /jav|dmm|r18|fanza|javlibrary|javbus|sukebei/i.test(u));
    return !!(javMatch || isJavByUrl);
  }, [title, urlHD, url4K, coverImage]);

  const [apsCandidates, setApsCandidates] = useState<Array<{
    title: string;
    url: string;
    score: number;
    photoCount?: number;
    dateStr?: string;
  }> | null>(null);

  const draftRef = useRef({
    id: id || null,
    title,
    urlHD,
    url4K,
    magnet,
    magnet4K,
    coverImage,
    aspectRatio,
    actorIds: selectedActorIds,
    studioIds: selectedStudioIds,
    galleryUrls,
    originalGalleryUrls,
    qualityPreference,
    galleryScraperUrl: scraperUrl,
    scraperUrl,
    coverOffset,
    assignedDate,
    trailerUrl,
    torrentUrlHD: torrentPopupData?.url1080p || '',
    torrentUrl4K: torrentPopupData?.url2160p || '',
    torrentSiteName: torrentPopupData?.sourceSite || '',
  });

  useEffect(() => {
    draftRef.current = {
      id: id || null,
      title,
      urlHD,
      url4K,
      magnet,
      magnet4K,
      coverImage,
      aspectRatio,
      actorIds: selectedActorIds,
      studioIds: selectedStudioIds,
      galleryUrls,
      originalGalleryUrls,
      qualityPreference,
      galleryScraperUrl: scraperUrl,
      scraperUrl,
      coverOffset,
      assignedDate,
      trailerUrl,
      torrentUrlHD: torrentPopupData?.url1080p,
      torrentUrl4K: torrentPopupData?.url2160p,
      torrentSiteName: torrentPopupData?.sourceSite,
    };
  }, [
    title,
    urlHD,
    url4K,
    magnet,
    magnet4K,
    coverImage,
    coverOffset,
    trailerUrl,
    aspectRatio,
    selectedActorIds,
    selectedStudioIds,
    galleryUrls,
    originalGalleryUrls,
    qualityPreference,
    scraperUrl,
    id,
    assignedDate,
    torrentPopupData,
  ]);

  useEffect(() => {
    const locState = location.state as any;
    if (locState?.scraperUrl) {
      setScraperUrl(locState.scraperUrl);
    }
  }, [location.state]);

  // Automatically detect and adjust Aspect Ratio for Naughty America & sub-studios
  useEffect(() => {
    if (!coverImage) return;

    const currentStudios = selectedStudioIds
      .map(sId => state.studios.find(s => s.id === sId)?.name)
      .filter((name): name is string => Boolean(name));

    const isNA = isNaughtyAmericaStudioOrSeries(title, ...currentStudios);
    if (isNA) {
      let isCancelled = false;
      detectCoverAspectRatio(coverImage).then((measuredRatio) => {
        if (!isCancelled && isMountedRef.current) {
          setAspectRatio(measuredRatio);
        }
      });
      return () => {
        isCancelled = true;
      };
    }
  }, [coverImage, selectedStudioIds, title, state.studios]);

  const isMountedRef = useRef(true);
  const extractAbortCtrlRef = useRef<AbortController | null>(null);
  const torrentAbortCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any ongoing network operations immediately on unmount or back navigation
      if (extractAbortCtrlRef.current) {
        try { extractAbortCtrlRef.current.abort(); } catch (e) {}
        extractAbortCtrlRef.current = null;
      }
      if (torrentAbortCtrlRef.current) {
        try { torrentAbortCtrlRef.current.abort(); } catch (e) {}
        torrentAbortCtrlRef.current = null;
      }
      if (isNavigatingToSubPage.current) {
        setFormDraft(draftRef.current as any);
      } else if (!isSaving.current) {
        setFormDraft(null);
      }
    };
  }, [setFormDraft]);

  const [isExtractorMode, setIsExtractorMode] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractTarget, setExtractTarget] = useState<'viper' | 'adultphotosets' | null>(null);
  const [isSearchingTorrent, setIsSearchingTorrent] = useState(false);

  const handleSmartTorrentSearch = async () => {
    const rawActors = selectedActorIds
      .map(id => state.actors.find(a => a.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    
    const studioListRaw = selectedStudioIds
      .map(id => state.studios.find(s => s.id === id))
      .filter((s): s is Studio => Boolean(s));

    let dateStr = '';
    let targetDateMs: number | undefined = undefined;
    if (assignedDate) {
      const d = new Date(assignedDate);
      targetDateMs = d.getTime();
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dateStr = `${yy} ${mm} ${dd}`;
    }
    
    const titleClean = (title && !title.match(/^https?:\/\//)) ? title.replace(/[,.'’\-]/g, ' ').replace(/\s+/g, ' ').trim() : '';

    const javMatch = title.match(/([a-zA-Z]{2,5}-\d{3,4})/i);
    const isJavTarget = !!javMatch;
    const javQuery = javMatch ? javMatch[1].toUpperCase() : titleClean;

    if (!rawActors.length && !studioListRaw.length && !titleClean && !assignedDate && !javMatch) {
       addNotification("Please select a studio, actor, date, or enter a title to search", "error");
       return;
    }
    
    if (torrentAbortCtrlRef.current) {
      try { torrentAbortCtrlRef.current.abort(); } catch (e) {}
    }
    const abortCtrl = new AbortController();
    torrentAbortCtrlRef.current = abortCtrl;

    setIsSearchingTorrent(true);
    try {
      let foundData: any = null;
      let sourceSite = isJavTarget ? "sukebei.nyaa.si" : "xxxclub.to";

      // Direct Extraction from URLs if provided (Bypass Search)
      const xxxclubUrl = [urlHD, url4K, title].find(u => typeof u === 'string' && u.includes('xxxclub.to/torrents/details/'));
      if (xxxclubUrl) {
        try {
          const res = await fetch('/api/extract/xxxclub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: xxxclubUrl }),
            signal: abortCtrl.signal
          });
          if (!isMountedRef.current || abortCtrl.signal.aborted) return;
          const data = await res.json();
          if (res.ok && data.magnet) {
            const is4k = data.parsed?.quality === '2160p';
            if (!isMountedRef.current || abortCtrl.signal.aborted) return;
            setTorrentPopupData({
               magnet1080p: is4k ? null : data.magnet,
               magnet2160p: is4k ? data.magnet : null,
               url1080p: is4k ? null : xxxclubUrl,
               url2160p: is4k ? xxxclubUrl : null,
               sourceSite: "xxxclub.to (Direct Extract)"
            });
            setShowTorrentPopup(true);
            setIsSearchingTorrent(false);
            return;
          }
        } catch (e: any) {
          if (e.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) return;
          console.error("Direct extract failed:", e);
        }
      }

      if (!isMountedRef.current || abortCtrl.signal.aborted) return;

      if (isJavTarget) {
        // JAV Sukebei Search
        const res = await fetch('/api/search/sukebei-smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: javQuery }),
          signal: abortCtrl.signal
        });
        if (!isMountedRef.current || abortCtrl.signal.aborted) return;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to search sukebei');
        foundData = data;
      } else {
        // Western / XXXClub Smart Search: Build cascading queries
        const queries: string[] = [];

        // Studio Aliases Mapping (e.g. Scoreland -> PornMegaLoad)
        const STUDIO_ALIASES: Record<string, string[]> = {
          'dadsloveporn': ['DadsLovePorn', 'Bangbros', 'Bang Bros'],
          'dads love porn': ['DadsLovePorn', 'Bangbros', 'Bang Bros'],
          'scoreland': ['PornMegaLoad'],
          'score land': ['PornMegaLoad'],
          'hot and tatted': ['Hot and Tatted', 'Hussie Pass'],
          'hot & tatted': ['Hot and Tatted', 'Hussie Pass'],
          'hussie auditions': ['Hussie Auditions', 'Hussie Pass'],
          'interracial povs': ['Interracial POVs', 'Hussie Pass'],
          'pov pornstars': ['POV Pornstars', 'Hussie Pass'],
          'hussie pass': ['Hussie Pass', 'Hot and Tatted'],
        };

        // Format studios:
        // 1. Known Aliases (e.g. Scoreland -> PornMegaLoad)
        // 2. Compact without suffix / space: BrazzersExxtra
        // 3. Normal clean with spaces: Brazzers Exxtra
        // 4. First word: Brazzers
        const studioVariants: string[] = [];
        for (const s of studioListRaw) {
          const lower = s.name.toLowerCase().trim();
          if (lower.includes('scoreland') || lower.includes('score land')) {
            if (!studioVariants.includes('PornMegaLoad')) studioVariants.push('PornMegaLoad');
            continue;
          }
          for (const [key, aliases] of Object.entries(STUDIO_ALIASES)) {
            if (lower.includes(key)) {
              for (const alias of aliases) {
                if (!studioVariants.includes(alias)) studioVariants.push(alias);
              }
            }
          }

          const stripped = s.name.replace(/(?:\s|-)*(?:VIP|Network|Premium|Plus|Media|Entertainment|Films|Studios|Studio|Site)$/i, '').replace(/&/g, 'and').trim();
          const noSpace = stripped.replace(/[\s,.'’\-]+/g, '');
          const withSpace = stripped.replace(/[,.'’\-]/g, ' ').replace(/\s+/g, ' ').trim();
          const firstWord = withSpace.split(' ')[0];

          if (noSpace && !studioVariants.includes(noSpace)) studioVariants.push(noSpace);
          if (withSpace && !studioVariants.includes(withSpace)) studioVariants.push(withSpace);
          if (firstWord && firstWord.length > 2 && !studioVariants.includes(firstWord)) studioVariants.push(firstWord);
        }

        // If no studio was selected directly, but title or URLs mention Scoreland
        const rawContent = `${title} ${urlHD} ${url4K}`.toLowerCase();
        if (studioVariants.length === 0 && (rawContent.includes('scoreland') || rawContent.includes('score land'))) {
          studioVariants.push('PornMegaLoad');
        }

        // Format actors:
        // 1. Normal clean name: Nia Bleu, Luxe LaFox
        // 2. CamelCase split: Luxe La Fox
        const actorVariantsList: string[][] = [];
        for (const act of rawActors) {
          const cleanAct = act.replace(/[,.'’\-]/g, ' ').replace(/\s+/g, ' ').trim();
          const splitCamel = act.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[,.'’\-]/g, ' ').replace(/\s+/g, ' ').trim();
          const variants = [cleanAct];
          if (splitCamel && splitCamel !== cleanAct) variants.push(splitCamel);
          actorVariantsList.push(variants);
        }

        const primaryActorVariants = actorVariantsList[0] || [];

        // 1. Primary Actor + Studio Variants + Date
        for (const act of primaryActorVariants) {
          for (const st of studioVariants) {
            const q = `${act} ${st} ${dateStr}`.replace(/\s+/g, ' ').trim();
            if (q && !queries.includes(q)) queries.push(q);
          }
        }

        // Helper to check if a title is too generic to be used alone with date
        const GENERIC_TITLES = new Set([
          'pov', 'vr', 'scene', 'episode', 'part', 'part 1', 'part 2', 'part 3',
          'compilation', 'special', 'massage', 'casting', 'interview', 'amateur',
          'solo', 'hardcore', 'anal', 'blowjob', 'creampie', 'squirt', 'threesome',
          'interracial', 'lesbian', 'milf', 'teen', 'stepmom', 'stepsister', 'stepdaughter'
        ]);
        const isGenericTitle = (t: string) => {
          const norm = (t || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
          return GENERIC_TITLES.has(norm) || norm.length <= 3;
        };

        // 2. Title + Date (if title exists and is not generic)
        if (titleClean) {
          for (const act of primaryActorVariants) {
            const q = `${act} ${titleClean} ${dateStr}`.replace(/\s+/g, ' ').trim();
            if (q && !queries.includes(q)) queries.push(q);
          }
          if (!isGenericTitle(titleClean)) {
            const qTitle = `${titleClean} ${dateStr}`.replace(/\s+/g, ' ').trim();
            if (qTitle && !queries.includes(qTitle)) queries.push(qTitle);
          }
        }

        // 3. Other individual actors + Studio Variants + Date
        for (let i = 1; i < actorVariantsList.length; i++) {
          for (const act of actorVariantsList[i]) {
            for (const st of studioVariants) {
              const q = `${act} ${st} ${dateStr}`.replace(/\s+/g, ' ').trim();
              if (q && !queries.includes(q)) queries.push(q);
            }
          }
        }

        // 4. All actors joined (if 2 actors) + Studio + Date
        if (rawActors.length === 2 && studioVariants.length > 0) {
          const actJoined = rawActors.map(a => a.replace(/[,.'’\-]/g, ' ').trim()).join(' ');
          const q = `${actJoined} ${studioVariants[0]} ${dateStr}`.replace(/\s+/g, ' ').trim();
          if (q && !queries.includes(q)) queries.push(q);
        }

        // 5. Primary Actor + Date only
        for (const act of primaryActorVariants) {
          const q = `${act} ${dateStr}`.replace(/\s+/g, ' ').trim();
          if (q && !queries.includes(q)) queries.push(q);
        }

        // 6. Other Actors + Date only
        for (let i = 1; i < actorVariantsList.length; i++) {
          for (const act of actorVariantsList[i]) {
            const q = `${act} ${dateStr}`.replace(/\s+/g, ' ').trim();
            if (q && !queries.includes(q)) queries.push(q);
          }
        }

        // 7. Studio + Date only
        for (const st of studioVariants) {
          const q = `${st} ${dateStr}`.replace(/\s+/g, ' ').trim();
          if (q && !queries.includes(q)) queries.push(q);
        }

        // Send to xxxclub-smart endpoint
        const res = await fetch('/api/search/xxxclub-smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            queries, 
            date: assignedDate,
            dateStr,
            targetDateMs,
            actors: rawActors,
            studios: studioListRaw.map(s => {
              const lower = s.name.toLowerCase().trim();
              return (lower.includes('scoreland') || lower.includes('score land')) ? 'PornMegaLoad' : s.name;
            }),
            title: titleClean
          }),
          signal: abortCtrl.signal
        });
        if (!isMountedRef.current || abortCtrl.signal.aborted) return;
        const data = await res.json();
        if (res.ok && (data.magnet1080p || data.magnet2160p)) {
          foundData = data;
        }

        // Fallback: StashDB Parent/Child studio search if still not found
        if ((!foundData || (!foundData.magnet1080p && !foundData.magnet2160p)) && state.settings.stashDbApiKey && studioListRaw.length > 0) {
          const apiKey = state.settings.stashDbApiKey;
          let alternateStudios: string[] = [];
          
          for (const s of studioListRaw) {
            if (!isMountedRef.current || abortCtrl.signal.aborted) return;
            let studioNode: any = null;
            try {
               if (s.stashDbId) {
                  const sRes = await fetch('/api/stashdb', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                        apiKey,
                        query: `query FindStudio($id: ID!) { findStudio(id: $id) { id name parent { id name } } }`,
                        variables: { id: s.stashDbId }
                     }),
                     signal: abortCtrl.signal
                  });
                  if (!isMountedRef.current || abortCtrl.signal.aborted) return;
                  const sData = await sRes.json();
                  studioNode = sData?.data?.findStudio;
               } else {
                  const sRes = await fetch('/api/stashdb', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                        apiKey,
                        query: `query QueryStudios($name: String!) { queryStudios(input: { name: $name }) { studios { id name parent { id name } } } }`,
                        variables: { name: s.name }
                     }),
                     signal: abortCtrl.signal
                  });
                  if (!isMountedRef.current || abortCtrl.signal.aborted) return;
                  const sData = await sRes.json();
                  studioNode = sData?.data?.queryStudios?.studios?.[0];
               }
            } catch(err: any) {
               if (err.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) return;
            }

            if (studioNode && studioNode.parent) {
               const parentStudio = studioNode.parent;
               alternateStudios.push(parentStudio.name);
               try {
                  const pRes = await fetch('/api/stashdb', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                        apiKey,
                        query: `query FindStudioParent($id: ID!) { findStudio(id: $id) { sub_studios { studios { name } } } }`,
                        variables: { id: parentStudio.id }
                     }),
                     signal: abortCtrl.signal
                  });
                  if (!isMountedRef.current || abortCtrl.signal.aborted) return;
                  const pData = await pRes.json();
                  const childStudios = pData?.data?.findStudio?.sub_studios?.studios;
                  if (childStudios && Array.isArray(childStudios)) {
                     childStudios.forEach((child: any) => {
                        if (child.name !== s.name) alternateStudios.push(child.name);
                     });
                  }
               } catch(err: any) {
                  if (err.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) return;
               }
            }
          }
          
          alternateStudios = [...new Set(alternateStudios)];
          const stashDbQueries: string[] = [];
          for (const altStudio of alternateStudios) {
             const formattedAltStudio = altStudio.replace(/(?:\s|-)*(?:VIP|Network|Premium|Plus|Media|Entertainment|Films|Studios|Studio|Site)$/i, '').replace(/&/g, 'and').replace(/[\s,.'’\-]+/g, '');
             for (const act of primaryActorVariants) {
               const q = `${act} ${formattedAltStudio} ${dateStr}`.replace(/\s+/g, ' ').trim();
               if (q && !stashDbQueries.includes(q)) stashDbQueries.push(q);
             }
          }

           if (stashDbQueries.length > 0) {
            const res2 = await fetch('/api/search/xxxclub-smart', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                queries: stashDbQueries, 
                date: assignedDate,
                dateStr,
                targetDateMs,
                actors: rawActors,
                studios: [...studioListRaw.map(s => s.name), ...alternateStudios].map(s => {
                  const lower = (s || '').toLowerCase().trim();
                  return (lower.includes('scoreland') || lower.includes('score land')) ? 'PornMegaLoad' : s;
                }),
                title: titleClean
              }),
              signal: abortCtrl.signal
            });
            if (!isMountedRef.current || abortCtrl.signal.aborted) return;
            const data2 = await res2.json();
            if (res2.ok && (data2.magnet1080p || data2.magnet2160p)) {
              foundData = data2;
            }
          }
        }
      }

      if (!isMountedRef.current || abortCtrl.signal.aborted) return;

      if (foundData && (foundData.magnet1080p || foundData.magnet2160p)) {
        if (foundData.magnet1080p) setMagnet(foundData.magnet1080p);
        if (foundData.magnet2160p) setMagnet4K(foundData.magnet2160p);
        
        // Haptic feedback for mobile responsiveness
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate([40, 30, 40]); } catch(e) {}
        }

        addNotification("Magnet links retrieved successfully!", "success");
        setTorrentPopupData({ url1080p: foundData.url1080p, url2160p: foundData.url2160p, sourceSite });
      } else {
        addNotification("No verified torrent found for this actor/studio on this date.", "info");
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) return;
      addNotification(`Torrent search failed: ${e.message}`, "error");
    } finally {
      if (torrentAbortCtrlRef.current === abortCtrl) {
        torrentAbortCtrlRef.current = null;
      }
      if (isMountedRef.current) {
        setIsSearchingTorrent(false);
      }
    }
  };

  const handleExtractViper = async () => {
    // Check if the link / title is JAV
    const javMatch = title.match(/([a-zA-Z]{2,5}-\d{3,4})/i);
    const isJavByUrl = [urlHD, url4K, coverImage].some(u => typeof u === 'string' && /jav|dmm|r18|fanza|javlibrary|javbus/i.test(u));
    if (javMatch || isJavByUrl) {
      addNotification("Vipergirls extractor is not available for JAV links", "warning");
      return;
    }

    const selectedActors = state.actors.filter(a => selectedActorIds.includes(a.id));
    const selectedStudios = state.studios.filter(s => selectedStudioIds.includes(s.id));
    if (selectedActors.length === 0) {
      addNotification("Please select an actor first", "error");
      return;
    }
    
    if (extractAbortCtrlRef.current) {
      try { extractAbortCtrlRef.current.abort(); } catch (e) {}
    }
    const abortCtrl = new AbortController();
    extractAbortCtrlRef.current = abortCtrl;

    setIsExtracting(true);
    setExtractTarget('viper');
    try {
      const safeDirectUrl = [scraperUrl, urlHD, url4K].find(u => typeof u === 'string' && u.includes('viper.to'));
      const res = await fetch("/api/extract/viper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          title, 
          actorName: selectedActors[0].name,
          actors: selectedActors.map(a => a.name),
          studioName: selectedStudios[0]?.name || "",
          date: assignedDate,
          postUrl: safeDirectUrl || (scraperUrl.includes("viper.to") ? scraperUrl : undefined)
        }),
        signal: abortCtrl.signal
      });
      if (!isMountedRef.current || abortCtrl.signal.aborted) return;

      const data = await res.json();
      if (!isMountedRef.current || abortCtrl.signal.aborted) return;
      
      if (data.error) {
        addNotification(data.error, "error");
        return;
      }
      
      if (data.url) {
        setScraperUrl(data.url);
      }
      
      if (data.images && data.images.length > 0) {
        if (data.thumbnails && data.thumbnails.length > 0) {
          setGalleryUrls((prev) => {
            const newUrls = [...prev];
            data.thumbnails.forEach((img: string) => {
              if (!newUrls.includes(img)) newUrls.push(img);
            });
            return newUrls;
          });
        } else {
          setGalleryUrls((prev) => {
            const newUrls = [...prev];
            data.images.forEach((img: string) => {
              if (!newUrls.includes(img)) newUrls.push(img);
            });
            return newUrls;
          });
        }
        
        setOriginalGalleryUrls((prev) => {
          const newUrls = [...prev];
          data.images.forEach((img: string) => {
            if (!newUrls.includes(img)) newUrls.push(img);
          });
          return newUrls;
        });
        
        // Haptic feedback on mobile devices
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(40); } catch(e) {}
        }
        addNotification(`⚡ Extracted ${data.images.length} images directly from Viper.to`, "success");
      } else if (data.url) {
        // Fallback if no images are returned directly
        setFormDraft(draftRef.current as any);
        isNavigatingToSubPage.current = true;
        
        addNotification("Thread found but no images. Navigating to gallery...", "warning");
        
        navigate("/add-gallery", {
          state: {
            ...((location.state as any) || {}),
            from: currentPath,
            originalFrom:
              (location.state as any)?.originalFrom ||
              (location.state as any)?.from,
            scraperUrl: data.url,
            autoExtract: true
          },
          replace: true,
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) {
        return;
      }
      addNotification(e.message || "Failed to extract from viper.to", "error");
    } finally {
      if (extractAbortCtrlRef.current === abortCtrl) {
        extractAbortCtrlRef.current = null;
      }
      if (isMountedRef.current) {
        setIsExtracting(false);
        setExtractTarget(null);
      }
    }
  };

  const handleExtractAdultPhotoSets = async (directPostUrl?: string | any) => {
    const safeDirectUrl = typeof directPostUrl === 'string' ? directPostUrl.trim() : undefined;
    // Check if the link / title is JAV
    const javMatch = title.match(/([a-zA-Z]{2,5}-\d{3,4})/i);
    const isJavByUrl = [urlHD, url4K, coverImage].some(u => typeof u === 'string' && /jav|dmm|r18|fanza|javlibrary|javbus/i.test(u));
    if (javMatch || isJavByUrl) {
      addNotification("AdultPhotoSets extractor is not available for JAV links", "warning");
      return;
    }

    const selectedActors = state.actors.filter(a => selectedActorIds.includes(a.id));
    const selectedStudios = state.studios.filter(s => selectedStudioIds.includes(s.id));
    if (!safeDirectUrl && selectedActors.length === 0 && !title) {
      addNotification("Please select an actor or enter a title first", "error");
      return;
    }
    
    if (extractAbortCtrlRef.current) {
      try { extractAbortCtrlRef.current.abort(); } catch (e) {}
    }
    const abortCtrl = new AbortController();
    extractAbortCtrlRef.current = abortCtrl;

    setIsExtracting(true);
    setExtractTarget('adultphotosets');
    try {
      const res = await fetch("/api/extract/adultphotosets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          title, 
          actorName: selectedActors[0]?.name || "",
          actors: selectedActors.map(a => a.name),
          studioName: selectedStudios[0]?.name || "",
          date: assignedDate,
          postUrl: safeDirectUrl || (scraperUrl.includes("adultphotosets.best") ? scraperUrl : undefined)
        }),
        signal: abortCtrl.signal
      });
      if (!isMountedRef.current || abortCtrl.signal.aborted) return;

      const data = await res.json();
      if (!isMountedRef.current || abortCtrl.signal.aborted) return;
      
      if (data.error) {
        addNotification(data.error, "error");
        return;
      }
      
      if (data.url) {
        setScraperUrl(data.url);
      }

      // If multiple candidates are returned and no specific direct URL was clicked, save them for candidate picker
      if (data.candidates && data.candidates.length > 1 && !safeDirectUrl) {
        setApsCandidates(data.candidates);
      } else {
        setApsCandidates(null);
      }
      
      if (data.images && data.images.length > 0) {
        if (data.thumbnails && data.thumbnails.length > 0) {
          setGalleryUrls((prev) => {
            const newUrls = [...prev];
            data.thumbnails.forEach((img: string) => {
              if (!newUrls.includes(img)) newUrls.push(img);
            });
            return newUrls;
          });
        } else {
          setGalleryUrls((prev) => {
            const newUrls = [...prev];
            data.images.forEach((img: string) => {
              if (!newUrls.includes(img)) newUrls.push(img);
            });
            return newUrls;
          });
        }
        
        setOriginalGalleryUrls((prev) => {
          const newUrls = [...prev];
          data.images.forEach((img: string) => {
            if (!newUrls.includes(img)) newUrls.push(img);
          });
          return newUrls;
        });
        
        // Haptic feedback on mobile devices
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(40); } catch(e) {}
        }
        addNotification(`⚡ Extracted ${data.images.length} images from AdultPhotoSets.best`, "success");
      } else if (data.url) {
        setFormDraft(draftRef.current as any);
        isNavigatingToSubPage.current = true;
        
        addNotification("Post found but no images. Navigating to gallery...", "warning");
        
        navigate("/add-gallery", {
          state: {
            ...((location.state as any) || {}),
            from: currentPath,
            originalFrom:
              (location.state as any)?.originalFrom ||
              (location.state as any)?.from,
            scraperUrl: data.url,
            autoExtract: true
          },
          replace: true,
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) {
        return;
      }
      addNotification(e.message || "Failed to extract from AdultPhotoSets", "error");
    } finally {
      if (extractAbortCtrlRef.current === abortCtrl) {
        extractAbortCtrlRef.current = null;
      }
      if (isMountedRef.current) {
        setIsExtracting(false);
        setExtractTarget(null);
      }
    }
  };

  const handleAutoSelect = useCallback(() => {
    if (galleryUrls.length === 0) {
      addNotification(
        "No staged gallery images found to select from.",
        "error",
      );
      return;
    }

    setIsAutoSelecting(true);

    const analyzeImages = async () => {
      const candidates: { url: string; ratio: number; priority: number }[] = [];
      // Limit evaluation to the first 25 items to prevent RAM spikes on mobile devices
      const targetUrls = galleryUrls.slice(0, 25);
      const chunkSize = 4;

      for (let i = 0; i < targetUrls.length; i += chunkSize) {
        if (!isMountedRef.current) break;
        const currentBatch = targetUrls.slice(i, i + chunkSize);

        const batchPromises = currentBatch.map((url) => {
          return new Promise<void>((resolve) => {
            const img = new Image();
            let timer: any = null;

            const cleanup = () => {
              if (timer) clearTimeout(timer);
              img.onload = null;
              img.onerror = null;
            };

            timer = setTimeout(() => {
              cleanup();
              resolve();
            }, 3000); // 3s timeout per image

            img.onload = () => {
              cleanup();
              if (img.width >= img.height) {
                const ratio = img.width / img.height;
                let priority = 3;

                if (Math.abs(ratio - 16 / 9) < 0.1) {
                  priority = 1;
                } else if (Math.abs(ratio - 3 / 2) < 0.1) {
                  priority = 2;
                }

                candidates.push({ url, ratio, priority });
              }
              resolve();
            };

            img.onerror = () => {
              cleanup();
              resolve();
            };

            img.src = url;
          });
        });

        await Promise.all(batchPromises);
      }

      if (!isMountedRef.current) return;

      candidates.sort((a, b) => a.priority - b.priority);
      const selected = candidates.slice(0, 5).map((c) => c.url);

      if (selected.length > 0) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50);
        addNotification(`Found ${selected.length} optimal landscape photos!`, "success");
      } else {
        addNotification(
          "No landscape-oriented images found in the gallery buffer.",
          "error",
        );
      }
      if (isMountedRef.current) {
        setIsAutoSelecting(false);
      }
    };
    analyzeImages();
  }, [galleryUrls, addNotification]);

  const existingTitles = useMemo(
    () =>
      new Set(
        state.links
          .filter((l) => l.id !== id && l.title)
          .map((l) => l.title.trim().toLowerCase()),
      ),
    [state.links, id],
  );
  const existingHds = useMemo(
    () =>
      new Set(
        state.links
          .filter((l) => l.id !== id && l.urlHD)
          .map((l) => String(l.urlHD).trim().toLowerCase()),
      ),
    [state.links, id],
  );
  const existingCovers = useMemo(
    () =>
      new Set(
        state.links
          .filter((l) => l.id !== id && l.coverImage)
          .map((l) => String(l.coverImage).trim().toLowerCase()),
      ),
    [state.links, id],
  );

  const isTitleDup = useMemo(
    () => title.trim() !== "" && existingTitles.has(title.trim().toLowerCase()),
    [title, existingTitles],
  );
  const isHdDup = useMemo(
    () => urlHD.trim() !== "" && existingHds.has(String(urlHD).trim().toLowerCase()),
    [urlHD, existingHds],
  );
  const isCoverDup = useMemo(
    () => coverImage.trim() !== "" && existingCovers.has(String(coverImage).trim().toLowerCase()),
    [coverImage, existingCovers],
  );

  const existingMagnets = useMemo(
    () =>
      new Set(
        state.links
          .filter((l) => l.id !== id && l.magnet)
          .map((l) => String(l.magnet).trim().toLowerCase()),
      ),
    [state.links, id],
  );
  const existingMagnet4Ks = useMemo(
    () =>
      new Set(
        state.links
          .filter((l) => l.id !== id && l.magnet4K)
          .map((l) => String(l.magnet4K).trim().toLowerCase()),
      ),
    [state.links, id],
  );

  const isMagnetDup = useMemo(
    () => magnet.trim() !== "" && existingMagnets.has(String(magnet).trim().toLowerCase()),
    [magnet, existingMagnets],
  );
  const isMagnet4KDup = useMemo(
    () => magnet4K.trim() !== "" && existingMagnet4Ks.has(String(magnet4K).trim().toLowerCase()),
    [magnet4K, existingMagnet4Ks],
  );

  const prevTitleRef = useRef("");
  useEffect(() => {
    if (id) return;

    const trimmedTitle = title.trim();
    if (trimmedTitle === prevTitleRef.current || !trimmedTitle) return;
    prevTitleRef.current = trimmedTitle;

    const timer = setTimeout(() => {
      performIntelligentDetection(trimmedTitle, selectedStudioIds);
    }, 800);
    return () => clearTimeout(timer);
  }, [title, id, performIntelligentDetection, selectedStudioIds]);

  const isValidUrl = (urlString: string) => {
    if (!urlString.trim()) return true;
    if (urlString.startsWith('/') || urlString.startsWith('data:')) return true;
    try {
      new URL(urlString, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      return true;
    } catch (e) {
      return false;
    }
  };

  const handleSave = useCallback(() => {
    if (isSaving.current) return;
    isSaving.current = true;
    
    // Always pull freshest values from draftRef to avoid any React state-batching lag
    const curTitle = (draftRef.current.title ?? title).trim();
    const curUrlHD = (draftRef.current.urlHD ?? urlHD).trim();
    const curUrl4K = (draftRef.current.url4K ?? url4K).trim();
    const curMagnet = (draftRef.current.magnet ?? magnet).trim();
    const curMagnet4K = (draftRef.current.magnet4K ?? magnet4K).trim();
    const curCoverImage = (draftRef.current.coverImage ?? coverImage).trim();
    const curScraperUrl = (draftRef.current.galleryScraperUrl ?? scraperUrl).trim();
    const curDate = draftRef.current.assignedDate ?? assignedDate;
    const curActorIds = draftRef.current.actorIds ?? selectedActorIds;
    const curStudioIds = draftRef.current.studioIds ?? selectedStudioIds;
    const curGalleryUrls = draftRef.current.galleryUrls ?? galleryUrls;
    const curOriginalGalleryUrls = draftRef.current.originalGalleryUrls ?? originalGalleryUrls;
    const curQualityPreference = draftRef.current.qualityPreference ?? qualityPreference;
    const curCoverOffset = draftRef.current.coverOffset ?? coverOffset;
    const curAspectRatio = draftRef.current.aspectRatio ?? aspectRatio;

    if (!curTitle) {
      addNotification("Please provide a title.", "error");
      isSaving.current = false;
      return;
    }

    if (!isValidUrl(curUrlHD) || !isValidUrl(curUrl4K) || !isValidUrl(curCoverImage)) {
      addNotification("Please provide valid URLs.", "error");
      isSaving.current = false;
      return;
    }

    if (isTitleDup || isHdDup || isCoverDup || isMagnetDup || isMagnet4KDup) {
      addNotification(
        "Duplicate values detected. Please resolve them.",
        "error",
      );
      isSaving.current = false;
      return;
    }

    const data = {
      title: curTitle,
      urlHD: curUrlHD,
      url4K: curUrl4K,
      magnet: curMagnet,
      magnet4K: curMagnet4K,
      torrentUrlHD: torrentPopupData?.url1080p || '',
      torrentUrl4K: torrentPopupData?.url2160p || '',
      torrentSiteName: torrentPopupData?.sourceSite || '',
      coverImage: curCoverImage,
      coverOffset: curCoverOffset,
      aspectRatio: curAspectRatio,
      actorIds: curActorIds,
      studioIds: curStudioIds,
      galleryUrls: curGalleryUrls,
      originalGalleryUrls: curOriginalGalleryUrls,
      qualityPreference: curQualityPreference,
      galleryScraperUrl: curScraperUrl,
      assignedDate: curDate,
      trailerUrl: (draftRef.current.trailerUrl ?? trailerUrl)?.trim() || undefined,
    };

    if (id) {
      updateLink(id, data);
    } else {
      addLink(data);
    }

    setFormDraft(null);
    addNotification("Link saved successfully.", "success");
    const finalFrom =
      (location.state as any)?.originalFrom ||
      (location.state as any)?.from ||
      "/";
    navigate(finalFrom, { replace: true, state: (location.state as any)?.returnState });
  }, [
    title,
    urlHD,
    url4K,
    magnet,
    magnet4K,
    coverImage,
    coverOffset,
    aspectRatio,
    selectedActorIds,
    selectedStudioIds,
    galleryUrls,
    originalGalleryUrls,
    qualityPreference,
    scraperUrl,
    id,
    addLink,
    updateLink,
    navigate,
    setFormDraft,
    addNotification,
    isTitleDup,
    isHdDup,
    isCoverDup,
    isMagnetDup,
    isMagnet4KDup,
    assignedDate,
    location.state,
    torrentPopupData,
  ]);

  useEffect(() => {
    const trigger = () => handleSave();
    window.addEventListener("vault-save-trigger", trigger);
    return () => window.removeEventListener("vault-save-trigger", trigger);
  }, [handleSave]);

  const handleAutoDetectTrailer = async () => {
    const rawTitle = (draftRef.current.title ?? title).trim();
    const rawTrailerInput = (draftRef.current.trailerUrl ?? trailerUrl).trim();
    const urls = [
      rawTrailerInput,
      (draftRef.current.urlHD ?? urlHD).trim(),
      (draftRef.current.url4K ?? url4K).trim(),
    ].filter(Boolean);

    const studioNames = selectedStudioIds
      .map(id => state.studios.find(s => s.id === id)?.name)
      .filter(Boolean) as string[];

    if (!rawTitle && urls.length === 0) {
      addNotification("Please enter a title, code, or URL first.", "warning");
      return;
    }

    try {
      setIsExtractingTrailer(true);
      const res = await fetch("/api/extract-trailer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          code: rawTitle,
          title: rawTitle,
          studio: studioNames.join(", "),
        }),
      });
      const data = await res.json();
      if (data.success && data.trailerUrl) {
        setTrailerUrl(data.trailerUrl);
        (draftRef.current as any).trailerUrl = data.trailerUrl;
        addNotification("Trailer stream detected!", "success");
      } else {
        addNotification("No trailer found for this title/links.", "warning");
      }
    } catch (e: any) {
      addNotification("Trailer detection failed: " + e.message, "error");
    } finally {
      setIsExtractingTrailer(false);
    }
  };

  const currentPath = location.pathname + location.search;

  const handleUrlChange = (
    val: string,
    setter: (v: string) => void,
    is4k: boolean,
  ) => {
    const trimmed = val.trim();
    const magnetMatch = trimmed.match(
      /magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,}/i,
    );
    if (magnetMatch) {
      if (is4k) {
        setMagnet4K(magnetMatch[0]);
        draftRef.current.magnet4K = magnetMatch[0];
      } else {
        setMagnet(magnetMatch[0]);
        draftRef.current.magnet = magnetMatch[0];
      }
      addNotification(
        "Magnet link extracted and moved to correct field",
        "success",
      );
      const cleaned = trimmed.replace(magnetMatch[0], "").trim();
      if (cleaned) {
        setter(cleaned);
        if (is4k) draftRef.current.url4K = cleaned;
        else draftRef.current.urlHD = cleaned;
      }
      return;
    }
    setter(trimmed);
    if (is4k) draftRef.current.url4K = trimmed;
    else draftRef.current.urlHD = trimmed;

    if (isPixeldrainUrl(trimmed)) {
      // Auto fetch title/metadata from Pixeldrain if title or cover is not set
      extractPixeldrainUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          // Clean filename extension if any
          const cleanName = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (meta.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(meta.thumbnailUrl);
          draftRef.current.coverImage = meta.thumbnailUrl;
        }
      }).catch(() => {});
    } else if (isBunkrUrl(trimmed)) {
      // Auto fetch title/metadata from Bunkr
      extractBunkrUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          const cleanName = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (meta.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(meta.thumbnailUrl);
          draftRef.current.coverImage = meta.thumbnailUrl;
        }
      }).catch(() => {});
    } else if (isFilesterUrl(trimmed)) {
      // Auto fetch title/metadata from Filester
      extractFilesterUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          const cleanName = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (meta.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(meta.thumbnailUrl);
          draftRef.current.coverImage = meta.thumbnailUrl;
        }
      }).catch(() => {});
    } else if (isGofileUrl(trimmed)) {
      // Auto fetch title/metadata and smart 4K / HD quality splitting from Gofile
      extractGofileUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          const cleanName = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (meta.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(meta.thumbnailUrl);
          draftRef.current.coverImage = meta.thumbnailUrl;
        }

        // Smart Quality Assignment when folder has both 4K and 1080p versions
        if (meta.file4K && meta.fileHD) {
          if (is4k) {
            if (!draftRef.current.urlHD && !urlHD) {
              setUrlHD(trimmed);
              draftRef.current.urlHD = trimmed;
              addNotification('Detected both 1080p and 4K versions, auto-assigned both', 'success');
            }
          } else {
            if (!draftRef.current.url4K && !url4K) {
              setUrl4K(trimmed);
              draftRef.current.url4K = trimmed;
              addNotification('Detected both 1080p and 4K versions, auto-assigned both', 'success');
            }
          }
        }
      }).catch(() => {});
    } else if (isCyberfileUrl(trimmed)) {
      // Auto fetch title/metadata from CyberFile
      extractCyberfileUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          const cleanName = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (meta.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(meta.thumbnailUrl);
          draftRef.current.coverImage = meta.thumbnailUrl;
        }
      }).catch(() => {});
    } else if (isFileditchUrl(trimmed)) {
      // Auto fetch title/metadata from FileDitch
      extractFileditchUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          const cleanName = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
      }).catch(() => {});
    } else if (isEpornerUrl(trimmed)) {
      // Auto fetch title, cover, date, actors, and smart 4K / HD quality assignment from Eporner
      extractEpornerUrl(trimmed).then((meta) => {
        if (meta.title && !draftRef.current.title && !title) {
          const cleanName = meta.title.replace(/- EPORNER.*$/i, '').replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ').trim();
          const formatted = formatTitle(cleanName);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (meta.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(meta.thumbnailUrl);
          draftRef.current.coverImage = meta.thumbnailUrl;
        }

        // Capture Date
        if (meta.date && (!draftRef.current.assignedDate || !assignedDate)) {
          setAssignedDate(meta.date);
          draftRef.current.assignedDate = meta.date;
        }

        // Capture Actors if found
        if (meta.actors && meta.actors.length > 0) {
          const actorIdsToAdd: string[] = [];
          for (const rawName of meta.actors) {
            const cleanName = rawName.trim();
            if (!cleanName) continue;

            const photoUrl = meta.actorImages?.[cleanName] || meta.actorImages?.[cleanName.toLowerCase()] || '';

            const existingActor = state.actors.find(
              (a) => a.name.toLowerCase() === cleanName.toLowerCase()
            );

            if (existingActor) {
              actorIdsToAdd.push(existingActor.id);
              if ((!existingActor.imageUrl || existingActor.imageUrl.trim() === '') && photoUrl) {
                updateActor(existingActor.id, {
                  imageUrl: photoUrl,
                  originalImageUrl: photoUrl,
                });
              }
            } else {
              const newActorId = addActor({
                name: cleanName,
                imageUrl: photoUrl,
                originalImageUrl: photoUrl,
              });
              if (newActorId) {
                actorIdsToAdd.push(newActorId);
              }
            }
          }

          if (actorIdsToAdd.length > 0) {
            setSelectedActorIds((prev) => {
              const merged = Array.from(new Set([...prev, ...actorIdsToAdd]));
              draftRef.current.actorIds = merged;
              return merged;
            });
          }
        }

        // Smart Quality Assignment when Eporner provides both 4K and 1080p
        if (meta.file4K && meta.file1080) {
          if (is4k) {
            if (!draftRef.current.urlHD && !urlHD) {
              setUrlHD(trimmed);
              draftRef.current.urlHD = trimmed;
              addNotification('Eporner: Detected 1080p & 4K streams, auto-assigned both', 'success');
            }
          } else {
            if (!draftRef.current.url4K && !url4K) {
              setUrl4K(trimmed);
              draftRef.current.url4K = trimmed;
              addNotification('Eporner: Detected 1080p & 4K streams, auto-assigned both', 'success');
            }
          }
        }

        addNotification('Eporner: Extracted Title, Cover & Date', 'success');
      }).catch((err) => {
        console.warn('Eporner auto extraction failed:', err);
      });
    } else if (isPornhubUrl(trimmed)) {
      // Auto fetch title/metadata from Pornhub Video Resolver
      pornhubResolver.resolve(trimmed).then((media) => {
        if (media.title && !draftRef.current.title && !title) {
          const formatted = formatTitle(media.title);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (media.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(media.thumbnailUrl);
          draftRef.current.coverImage = media.thumbnailUrl;
        }

        // 1. Capture video date
        if (media.date && (!draftRef.current.assignedDate || !assignedDate)) {
          setAssignedDate(media.date);
          draftRef.current.assignedDate = media.date;
        }

        // 2. Capture actress / actor name and photo
        const rawActors = media.actors && media.actors.length > 0
          ? media.actors
          : (media.actress ? [media.actress] : []);

        const actorImages = media.actorImages || {};

        if (rawActors.length > 0) {
          const actorIdsToAdd: string[] = [];
          for (const rawName of rawActors) {
            const cleanName = rawName.trim();
            if (!cleanName) continue;

            const photoUrl = actorImages[cleanName] || actorImages[cleanName.toLowerCase()] || media.actressImage || '';

            const existingActor = state.actors.find(
              (a) => a.name.toLowerCase() === cleanName.toLowerCase()
            );

            if (existingActor) {
              actorIdsToAdd.push(existingActor.id);
              // If existing actor doesn't have a photo yet, update them with the captured photo
              if ((!existingActor.imageUrl || existingActor.imageUrl.trim() === '') && photoUrl) {
                updateActor(existingActor.id, {
                  imageUrl: photoUrl,
                  originalImageUrl: photoUrl,
                });
              }
            } else {
              const newActorId = addActor({
                name: cleanName,
                imageUrl: photoUrl,
                originalImageUrl: photoUrl,
              });
              if (newActorId) {
                actorIdsToAdd.push(newActorId);
              }
            }
          }

          if (actorIdsToAdd.length > 0) {
            setSelectedActorIds((prev) => {
              const merged = Array.from(new Set([...prev, ...actorIdsToAdd]));
              draftRef.current.actorIds = merged;
              return merged;
            });
          }
        }

        // 3. Studio: PrnHub
        const targetStudioName = media.studio || 'PrnHub';
        const existingStudio = state.studios.find(
          (s) => s.name.toLowerCase() === targetStudioName.toLowerCase() || s.name.toLowerCase() === 'pornhub'
        );
        let studioId = existingStudio?.id;
        if (!studioId) {
          studioId = addStudio({ name: targetStudioName });
        }
        if (studioId) {
          const assignedStudioId = studioId;
          setSelectedStudioIds((prev) => {
            if (prev.length === 0 || !prev.includes(assignedStudioId)) {
              const merged = prev.length === 0 ? [assignedStudioId] : Array.from(new Set([...prev, assignedStudioId]));
              draftRef.current.studioIds = merged;
              return merged;
            }
            return prev;
          });
        }

        addNotification('PornHub: Extracted Date, Actress with Photo & Studio (PrnHub)', 'success');
      }).catch(() => {});
    } else if (isXhamsterUrl(trimmed)) {
      // Auto fetch title/metadata from xHamster Video Resolver
      xhamsterResolver.resolve(trimmed).then((media) => {
        if (media.title && !draftRef.current.title && !title) {
          const formatted = formatTitle(media.title);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (media.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(media.thumbnailUrl);
          draftRef.current.coverImage = media.thumbnailUrl;
        }

        // Capture video date from xHamster
        if (media.date && (!draftRef.current.assignedDate || !assignedDate)) {
          setAssignedDate(media.date);
          draftRef.current.assignedDate = media.date;
        }

        if (media.date) {
          addNotification('xHamster: Extracted Date', 'success');
        }
      }).catch(() => {});
    } else if (isPorntrexUrl(trimmed)) {
      // Auto fetch title, cover, date, actors & qualities from Porntrex Video Resolver
      porntrexResolver.resolve(trimmed).then((media) => {
        if (media.title && !draftRef.current.title && !title) {
          const formatted = formatTitle(media.title);
          setTitle(formatted);
          draftRef.current.title = formatted;
        }
        if (media.thumbnailUrl && !draftRef.current.coverImage && !coverImage) {
          setCoverImage(media.thumbnailUrl);
          draftRef.current.coverImage = media.thumbnailUrl;
        }

        // Capture video date
        if (media.date && (!draftRef.current.assignedDate || !assignedDate)) {
          setAssignedDate(media.date);
          draftRef.current.assignedDate = media.date;
        }

        // Capture actors if any
        if (media.actors && media.actors.length > 0) {
          const actorIdsToAdd: string[] = [];
          for (const rawName of media.actors) {
            const cleanName = rawName.trim();
            if (!cleanName) continue;
            const existingActor = state.actors.find(
              (a) => a.name.toLowerCase() === cleanName.toLowerCase()
            );
            if (existingActor) {
              actorIdsToAdd.push(existingActor.id);
            } else {
              const newActorId = addActor({
                name: cleanName,
                imageUrl: '',
                originalImageUrl: '',
              });
              if (newActorId) {
                actorIdsToAdd.push(newActorId);
              }
            }
          }

          if (actorIdsToAdd.length > 0) {
            setSelectedActorIds((prev) => {
              const merged = Array.from(new Set([...prev, ...actorIdsToAdd]));
              draftRef.current.actorIds = merged;
              return merged;
            });
          }
        }

        // Check if 4K is present in streams
        const has4K = media.streams && media.streams.some(s => s.quality === '2160p' || s.label.includes('4K') || s.label.includes('2160'));
        const has1080 = media.streams && media.streams.some(s => s.quality === '1080p' || s.label.includes('1080'));

        if (has4K && has1080) {
          if (is4k) {
            if (!draftRef.current.urlHD && !urlHD) {
              setUrlHD(trimmed);
              draftRef.current.urlHD = trimmed;
              addNotification('Porntrex: Detected 1080p & 4K streams, auto-assigned both', 'success');
            }
          } else {
            if (!draftRef.current.url4K && !url4K) {
              setUrl4K(trimmed);
              draftRef.current.url4K = trimmed;
              addNotification('Porntrex: Detected 1080p & 4K streams, auto-assigned both', 'success');
            }
          }
        }

        addNotification('Porntrex: Extracted Title, Cover & Date', 'success');
      }).catch((err) => {
        console.warn('Porntrex auto extraction failed:', err);
      });
    }
  };

  const handleTitleChange = (val: string) => {
    const trimmed = val.trim();
    const magnetMatch = trimmed.match(
      /magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,}/i,
    );
    if (magnetMatch) {
      setMagnet(magnetMatch[0]);
      draftRef.current.magnet = magnetMatch[0];
      addNotification("Magnet link extracted from title", "success");
      const cleaned = trimmed.replace(magnetMatch[0], "").trim();
      const formatted = formatTitle(cleaned);
      setTitle(formatted);
      draftRef.current.title = formatted;
      return;
    }

    const isUrl = /^https?:\/\//i.test(trimmed);
    const finalVal = isUrl ? trimmed : formatTitle(val);
    setTitle(finalVal);
    draftRef.current.title = finalVal;
  };

  const handleCopyLinkInfo = useCallback(async () => {
    // 1. Title
    const titleText = (title || draftRef.current.title || "").trim();

    // 2. Actors
    const actorNames = selectedActorIds
      .map((aId) => state.actors.find((a) => a.id === aId)?.name)
      .filter(Boolean)
      .join(", ");

    // 3. Date
    let dateText = "";
    const effectiveDate = assignedDate ?? draftRef.current.assignedDate;
    if (effectiveDate) {
      const d = new Date(effectiveDate);
      if (!isNaN(d.getTime())) {
        dateText = d.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    }

    // 4. Url Vipergirls / scraperUrl
    const viperUrl = (scraperUrl || draftRef.current.scraperUrl || "").trim();

    const textToCopy = `Title :\n${titleText}\n\nActor :\n${actorNames}\n\nDate :\n${dateText}\n\nUrl vipergirls :\n${viperUrl}`;

    return await copyTextToClipboard(textToCopy, {
      successMessage: "Link info copied to clipboard!",
      errorMessage: "Failed to copy link info to clipboard",
      trim: false,
    });
  }, [title, selectedActorIds, state.actors, assignedDate, scraperUrl]);

  if (!isHydrated) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col pb-48 px-4 pt-4 w-full animate-pulse">
        <div className="flex flex-col mb-4 gap-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-10 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-1/2 bg-[var(--border)] rounded-full opacity-25" />
            </div>
            <div className="flex gap-2 sm:gap-3 justify-between sm:justify-end items-center">
              <div className="w-[48px] h-[48px] rounded-full bg-[var(--border)] opacity-20 shrink-0" />
              <div className="w-[48px] h-[48px] rounded-full bg-[var(--border)] opacity-20 shrink-0" />
              <div className="w-[48px] h-[48px] rounded-full bg-[var(--border)] opacity-20 shrink-0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-10 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-1/2 bg-[var(--border)] rounded-full opacity-25" />
            </div>
            <div className="h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-10 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-1/2 bg-[var(--border)] rounded-full opacity-25" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-14 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-2/3 bg-[var(--border)] rounded-full opacity-25" />
            </div>
            <div className="h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-14 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-2/3 bg-[var(--border)] rounded-full opacity-25" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-10 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-1/2 bg-[var(--border)] rounded-full opacity-25" />
            </div>
            <div className="h-[48px] bg-[var(--border)] opacity-20 rounded-full flex items-center justify-center">
              <div className="h-3.5 w-20 bg-[var(--surface)] rounded-full opacity-30" />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="w-full h-[48px]" />
            <div className="w-full aspect-[16/9] bg-[var(--surface)] border border-[var(--border)] rounded-[24px] opacity-30 relative flex items-center justify-center" />
          </div>

          <div className="flex gap-3 w-full">
            <div className="flex-1 h-[48px] rounded-full bg-[var(--border)] opacity-20" />
            <div className="flex-1 h-[48px] rounded-full bg-[var(--surface)] border border-[var(--border)] opacity-30" />
            <div className="flex-1 h-[48px] rounded-full bg-[var(--surface)] border border-[var(--border)] opacity-30" />
          </div>
        </div>

        <div className="flex flex-col mb-10">
          <div className="flex w-full gap-3">
            <div className="h-[48px] flex-1 bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-10 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-1/3 bg-[var(--border)] rounded-full opacity-25" />
            </div>
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--border)] opacity-20 shrink-0 flex justify-center items-center" />
          </div>
          <div className="flex gap-4 mt-5 px-1 h-[40px] items-center">
             <div className="h-2.5 w-12 bg-[var(--border)] rounded-full opacity-30" />
             <div className="h-2.5 w-16 bg-[var(--border)] rounded-full opacity-30" />
             <div className="h-2.5 w-10 bg-[var(--border)] rounded-full opacity-30" />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex w-full gap-3">
            <div className="h-[48px] flex-1 bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
              <div className="h-2 w-10 bg-[var(--border)] rounded-full opacity-50" />
              <div className="h-3.5 w-1/3 bg-[var(--border)] rounded-full opacity-25" />
            </div>
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--border)] opacity-20 shrink-0 flex justify-center items-center" />
          </div>
          <div className="flex gap-4 mt-5 px-1 h-[40px] items-center">
             <div className="h-2.5 w-16 bg-[var(--border)] rounded-full opacity-30" />
             <div className="h-2.5 w-14 bg-[var(--border)] rounded-full opacity-30" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col pb-48 px-4 pt-4 w-full animate-fade-in-fast">
      <div className="flex flex-col mb-4 gap-y-4">
        <div className="grid grid-cols-2 gap-3">
          <InputBar
            label="Title"
            value={title}
            onChange={handleTitleChange}
            placeholder="Link description..."
            showPaste

            isDuplicate={isTitleDup}
            compact
          />
          <div className="flex gap-2 sm:gap-3 justify-between sm:justify-end items-center transition-all duration-200">
            {!isExtractorMode ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    isNavigatingToSubPage.current = true;
                    setFormDraft(draftRef.current as any);
                    navigate('/stashdb', { state: { from: location.pathname + location.search } });
                  }}
                  className="w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none"
                  style={{ backgroundColor: state.settings.buttonColor }}
                  title="Search StashDB"
                >
                  <Icons.Database className="w-6 h-6" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (torrentPopupData) {
                      setShowTorrentPopup(true);
                    } else {
                      handleSmartTorrentSearch();
                    }
                  }}
                  disabled={isSearchingTorrent}
                  className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none ${isSearchingTorrent ? "opacity-50" : ""}`}
                  style={{ backgroundColor: state.settings.buttonColor }}
                  title={torrentPopupData ? "View Search Results" : "Torrent Search"}
                >
                  {isSearchingTorrent ? (
                    <Icons.Loader2 className="w-6 h-6 animate-spin" />
                  ) : torrentPopupData ? (
                    <Icons.ArrowUpRight className="w-6 h-6" />
                  ) : (
                    <Icons.Magnet className="w-6 h-6" />
                  )}
                </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isJavLink) {
                        addNotification("Extractors are not available for JAV links", "warning");
                        return;
                      }
                      setIsExtractorMode(true);
                      if (typeof navigator !== 'undefined' && navigator.vibrate) {
                        try { navigator.vibrate(20); } catch (e) {}
                      }
                    }}
                    title="Photoset Extractors Mode (Vipergirls & AdultPhotoSets)"
                    className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none ${isJavLink ? "opacity-50 cursor-not-allowed" : ""}`}
                    style={{ backgroundColor: state.settings.buttonColor }}
                  >
                    <Icons.SearchIcon className="w-6 h-6" />
                  </button>
              </>
            ) : (
              <>
                {!isJavLink && (
                  <>
                    {/* AdultPhotoSets Extractor Button */}
                    <button
                      type="button"
                      onClick={() => handleExtractAdultPhotoSets()}
                      disabled={isExtracting || isSearchingTorrent}
                      title="Extract from AdultPhotoSets.best"
                      className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none ${isExtracting ? "opacity-50" : ""}`}
                      style={{ backgroundColor: state.settings.buttonColor }}
                    >
                      {isExtracting && extractTarget === 'adultphotosets' ? (
                        <Icons.Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <Icons.AdultPhotoSets className="w-6 h-6" />
                      )}
                    </button>
    
                    {/* Vipergirls Extractor Button */}
                    <button
                      type="button"
                      onClick={handleExtractViper}
                      disabled={isExtracting || isSearchingTorrent}
                      title="Extract from Viper.to"
                      className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none ${isExtracting ? "opacity-50" : ""}`}
                      style={{ backgroundColor: state.settings.buttonColor }}
                    >
                      {isExtracting && extractTarget === 'viper' ? (
                        <Icons.Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <Icons.Viper className="w-6 h-6" />
                      )}
                    </button>
                  </>
                )}

                {/* Close / Abort Extractor Mode Button */}
                <button
                  type="button"
                  onClick={() => {
                    // 1. Hard Abort any active extraction request
                    if (extractAbortCtrlRef.current) {
                      try {
                        extractAbortCtrlRef.current.abort();
                      } catch (e) {}
                      extractAbortCtrlRef.current = null;
                    }
                    if (isExtracting) {
                      setIsExtracting(false);
                      setExtractTarget(null);
                      addNotification("Extraction cancelled", "info");
                    }
                    // 2. Exit extractor mode
                    setIsExtractorMode(false);
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                      try { navigator.vibrate(20); } catch (e) {}
                    }
                  }}
                  title={isExtracting ? "Cancel extraction & return" : "Close Extractor Mode (Return to StashDB & Torrent)"}
                  className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none ${isExtracting ? "ring-2 ring-red-500 bg-opacity-95" : "bg-opacity-80"}`}
                  style={{ backgroundColor: state.settings.buttonColor }}
                >
                  <Icons.X className="w-6 h-6" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InputBar
            label="HD URL"
            value={urlHD}
            onChange={(v) => handleUrlChange(v, setUrlHD, false)}
            placeholder="Standard link..."
            showPaste
            isDuplicate={isHdDup}
            compact
          />
          <InputBar
            label="4K URL"
            value={url4K}
            onChange={(v) => handleUrlChange(v, setUrl4K, true)}
            placeholder="Ultra HD link..."
            showPaste
            compact
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputBar
            label="HD Magnet"
            value={magnet}
            onChange={(v) => {
              setMagnet(v);
              draftRef.current.magnet = v;
            }}
            placeholder="Magnet link..."
            showPaste
            isDuplicate={isMagnetDup}
            compact
          />
          <InputBar
            label="4K Magnet"
            value={magnet4K}
            onChange={(v) => {
              setMagnet4K(v);
              draftRef.current.magnet4K = v;
            }}
            placeholder="4K Magnet link..."
            showPaste
            isDuplicate={isMagnet4KDup}
            compact
          />
        </div>

        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <InputBar
              label="Trailer URL"
              value={trailerUrl}
              onChange={(v) => {
                setTrailerUrl(v);
                draftRef.current.trailerUrl = v;
              }}
              placeholder="Stream (.m3u8) or MP4 preview link..."
              showPaste
              compact
            />
          </div>
          <button
            type="button"
            title="Auto-detect Trailer stream"
            disabled={isExtractingTrailer}
            onClick={handleAutoDetectTrailer}
            className="h-[48px] px-3.5 rounded-full font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 transition-all bg-[var(--surface)] text-[var(--accent)] border border-[var(--border)] hover:bg-[var(--border)] active:scale-95 shrink-0"
          >
            {isExtractingTrailer ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
            ) : (
              <Film className="w-4 h-4 text-amber-400" />
            )}
            <span>Auto</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InputBar
            label="Cover"
            value={coverImage}
            onChange={(v) => {
              setCoverImage(v);
              draftRef.current.coverImage = v;
            }}
            placeholder="Image URL..."
            showPaste
            isLoading={isFetchingThumb}
            isDuplicate={isCoverDup}
            compact
          />

          <button
            type="button"
            onClick={() => {
              setFormDraft(draftRef.current as any);
              isNavigatingToSubPage.current = true;
              navigate("/add-gallery", {
                state: {
                  ...((location.state as any) || {}),
                  from: currentPath,
                  originalFrom:
                    (location.state as any)?.originalFrom ||
                    (location.state as any)?.from,
                  scraperUrl: scraperUrl || (draftRef.current as any)?.galleryScraperUrl || (draftRef.current as any)?.scraperUrl || "",
                },
                replace: true,
              });
            }}
            className="w-full h-full min-h-[48px] rounded-full font-black uppercase tracking-widest text-[10px] transition-all active:scale-[0.98] text-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border),0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] flex items-center justify-center gap-2"
            style={{ backgroundColor: state.settings.buttonColor }}
          >
            Gallery{" "}
            {Math.max(galleryUrls.length, originalGalleryUrls.length) > 0 && (
              <span className="opacity-90">({Math.max(galleryUrls.length, originalGalleryUrls.length)})</span>
            )}
          </button>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const { compressImage } = await import("../utils/image");
              const compressed = await compressImage(f);
              setCoverImage(compressed);
            }
          }}
        />

        <CoverPreview
          url={coverImage}
          ratio={aspectRatio}
          offset={coverOffset}
          onOffsetChange={setCoverOffset}
          onAutoSelect={handleAutoSelect}
          isProcessing={isAutoSelecting}
          assignedDate={assignedDate}
          onDateChange={setAssignedDate}
          isLocked={isLocked}
          onToggleLock={toggleLock}
          episodes={[]}
          onCopy={handleCopyLinkInfo}
        />

        <div className="flex gap-3 w-full">
          {(["16:9", "3:2", "Adaptive"] as AspectRatio[]).map((ratio) => (
            <button
              key={ratio}
              onClick={() => setAspectRatio(ratio)}
              className={`flex-1 h-[48px] rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${aspectRatio === ratio ? "text-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border),0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,0,0,0.05)]" : "bg-[var(--surface)] text-[var(--text-muted)] shadow-[inset_0_0_0_1px_var(--border)] active:scale-95"}`}
              style={
                aspectRatio === ratio
                  ? { backgroundColor: state.settings.buttonColor }
                  : {}
              }
            >
              {ratio === "16:9" ? "Standard" : ratio === "3:2" ? "DVD" : ratio}
            </button>
          ))}
        </div>
      </div>

      <ActorSelector
        actorSearch={actorSearch}
        setActorSearch={setActorSearch}
        selectedActorIds={selectedActorIds}
        setSelectedActorIds={setSelectedActorIds}
        currentPath={currentPath}
        onAddClick={() => {
          isNavigatingToSubPage.current = true;
        }}
      />

      <StudioSelector
        studioSearch={studioSearch}
        setStudioSearch={setStudioSearch}
        selectedStudioIds={selectedStudioIds}
        setSelectedStudioIds={setSelectedStudioIds}
        currentPath={currentPath}
        onAddClick={() => {
          isNavigatingToSubPage.current = true;
        }}
      />
      <AnimatePresence>
        {showTorrentPopup && torrentPopupData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-[2rem] p-5 shadow-2xl z-50 flex flex-col gap-4"
          >
            <div className="flex justify-between items-center px-2">
              <h3 className="font-bold text-[15px] tracking-tight">Extracted Torrents</h3>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    setMagnet("");
                    setMagnet4K("");
                    setTorrentPopupData(null);
                    setShowTorrentPopup(false);
                    addNotification("Torrent extraction undone", "success");
                  }} 
                  title="Undo Magnet Extraction"
                  className="flex items-center justify-center p-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 active:scale-95 transition-transform"
                >
                  <Icons.RotateCcw className="w-4 h-4" />
                </button>
                <button onClick={() => setShowTorrentPopup(false)} className="flex items-center justify-center p-2 rounded-full bg-[var(--text-muted)]/15 hover:bg-[var(--text-muted)]/25 active:scale-95 transition-transform">
                  <Icons.X className="w-4 h-4 text-[var(--text)]" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {torrentPopupData.url2160p ? (
                <a href={torrentPopupData.url2160p} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-[var(--accent)] bg-[var(--accent)]/10 py-3 px-4 rounded-full hover:bg-[var(--accent)]/20 transition-colors">
                  <Icons.ExternalLink className="w-5 h-5 shrink-0" />
                  <span className="truncate font-semibold text-xs tracking-wide uppercase">4K Result on {torrentPopupData.sourceSite || "xxxclub.to"}</span>
                </a>
              ) : (
                <div className="text-xs text-[var(--text-muted)] italic px-2">No 4K result found</div>
              )}
              {torrentPopupData.url1080p ? (
                <a href={torrentPopupData.url1080p} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm text-[var(--accent)] bg-[var(--accent)]/10 py-3 px-4 rounded-full hover:bg-[var(--accent)]/20 transition-colors">
                  <Icons.ExternalLink className="w-5 h-5 shrink-0" />
                  <span className="truncate font-semibold text-xs tracking-wide uppercase">HD Result on {torrentPopupData.sourceSite || "xxxclub.to"}</span>
                </a>
              ) : (
                <div className="text-xs text-[var(--text-muted)] italic px-2">No HD result found</div>
              )}
            </div>
          </motion.div>
        )}

        {/* AdultPhotoSets Smart Match Disambiguation Sheet for Mobile */}
        {apsCandidates && apsCandidates.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 w-[94%] max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[2rem] p-5 shadow-2xl z-50 flex flex-col gap-3 pb-safe backdrop-blur-xl"
          >
            <div className="flex justify-between items-center px-1">
              <div>
                <h3 className="font-bold text-[15px] tracking-tight flex items-center gap-1.5">
                  <Icons.AdultPhotoSets className="w-4 h-4 text-[var(--accent)]" />
                  <span>Matching Photosets</span>
                </h3>
                <p className="text-[11px] text-[var(--text-muted)]">Multiple sets found. Tap to switch to another:</p>
              </div>
              <button
                onClick={() => setApsCandidates(null)}
                className="flex items-center justify-center p-2 rounded-full bg-[var(--text-muted)]/15 hover:bg-[var(--text-muted)]/25 active:scale-95 transition-transform"
              >
                <Icons.X className="w-4 h-4 text-[var(--text)]" />
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1 overscroll-contain">
              {apsCandidates.map((candidate) => (
                <button
                  key={candidate.url}
                  type="button"
                  onClick={() => {
                    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                    handleExtractAdultPhotoSets(candidate.url);
                    setApsCandidates(null);
                  }}
                  className={`flex flex-col text-left p-3 rounded-2xl border transition-all active:scale-[0.98] ${
                    scraperUrl === candidate.url 
                      ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--text)]'
                      : 'bg-[var(--background)]/60 border-[var(--border)] hover:bg-[var(--background)] text-[var(--text)]'
                  }`}
                >
                  <div className="font-medium text-xs line-clamp-2 leading-relaxed">
                    {candidate.title}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-muted)] font-mono">
                    {candidate.photoCount ? (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] font-semibold">
                        {candidate.photoCount} Photos
                      </span>
                    ) : null}
                    {candidate.dateStr ? (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)]">
                        {candidate.dateStr}
                      </span>
                    ) : null}
                    {scraperUrl === candidate.url && (
                      <span className="ml-auto text-[var(--accent)] font-bold">✓ Active</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
