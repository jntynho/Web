
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { InputBar } from '../components/InputBar';
import { isNaughtyAmericaStudioOrSeries, detectCoverAspectRatio } from '../utils/naughtyAmerica';

export const AddGalleryLinks: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, formDraft, setFormDraft, addNotification } = useApp();
  const initialScraperUrl = (location.state as any)?.scraperUrl || formDraft?.galleryScraperUrl || (formDraft as any)?.scraperUrl || '';
  const [inputVal, setInputVal] = useState(initialScraperUrl);
  const [isClearing, setIsClearing] = useState(false);
  const [hasScrolledDeep, setHasScrolledDeep] = useState(false);
  const { blurIntensity, buttonStyle } = state.settings;
  
  const [galleryUrls, setGalleryUrls] = useState<string[]>(formDraft?.galleryUrls || []);
  const [originalGalleryUrls, setOriginalGalleryUrls] = useState<string[]>(formDraft?.originalGalleryUrls || []);
  const [activeTab, setActiveTab] = useState<'thumbnail' | 'original'>(formDraft?.qualityPreference || 'thumbnail');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const currentUrls = activeTab === 'thumbnail' ? galleryUrls : originalGalleryUrls;
  const setCurrentUrls = activeTab === 'thumbnail' ? setGalleryUrls : setOriginalGalleryUrls;

  const [isExtracting, setIsExtracting] = useState(false);

  const latestDraftRef = useRef(formDraft);
  const galleryRef = useRef(galleryUrls);
  const originalGalleryRef = useRef(originalGalleryUrls);
  const tabRef = useRef(activeTab);
  const inputValRef = useRef(inputVal);

  const isMountedRef = useRef(true);
  const extractAbortCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    latestDraftRef.current = formDraft;
    galleryRef.current = galleryUrls;
    originalGalleryRef.current = originalGalleryUrls;
    tabRef.current = activeTab;
    inputValRef.current = inputVal;
  }, [formDraft, galleryUrls, originalGalleryUrls, activeTab, inputVal]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
       isMountedRef.current = false;
       if (extractAbortCtrlRef.current) {
         try { extractAbortCtrlRef.current.abort(); } catch (e) {}
         extractAbortCtrlRef.current = null;
       }
       if (latestDraftRef.current) {
          setFormDraft({
             ...latestDraftRef.current,
             galleryUrls: galleryRef.current,
             originalGalleryUrls: originalGalleryRef.current,
             qualityPreference: tabRef.current,
             galleryScraperUrl: inputValRef.current || (latestDraftRef.current as any)?.galleryScraperUrl,
             scraperUrl: inputValRef.current || (latestDraftRef.current as any)?.scraperUrl
          });
       }
    };
  }, [setFormDraft]);

  const isViperDomain = (url: string) => /^https?:\/\/(www\.)?viper(girls)?\.to\/threads\//i.test(url.trim());
  const isPornhatDomain = (url: string) => /^https?:\/\/(www\.)?(pornhat\.com|pornstars\.tube)\/albums\//i.test(url.trim());
  const isPornboxDomain = (url: string) => /^https?:\/\/(www\.)?pornbox\.com\/application\/watch-page\//i.test(url.trim());
  const isFreeonesDomain = (url: string) => /^https?:\/\/(www\.)?freeones\.com\/(.*\/)?photos\//i.test(url.trim());
  const isGoonboxDomain = (url: string) => /^https?:\/\/(www\.)?goonbox\.cr\/a\//i.test(url.trim());
  const isAdultphotosetsDomain = (url: string) => /^https?:\/\/(www\.)?adultphotosets\.(best|com|net|org)\//i.test(url.trim());

  const isSupportedScraperDomain = (url: string) => 
    isViperDomain(url) || isPornhatDomain(url) || isPornboxDomain(url) || isFreeonesDomain(url) || isGoonboxDomain(url) || isAdultphotosetsDomain(url);

  const handleExtract = async (overrideUrl?: string) => {
    const inputClean = (overrideUrl || inputVal).trim();
    if (!isSupportedScraperDomain(inputClean)) {
      addNotification("Please enter a valid supported link (viper, pornhat, adultphotosets, pornbox, freeones, goonbox)", "error");
      return;
    }

    if (extractAbortCtrlRef.current) {
      try { extractAbortCtrlRef.current.abort(); } catch (e) {}
    }
    const abortCtrl = new AbortController();
    extractAbortCtrlRef.current = abortCtrl;

    setIsExtracting(true);
    try {
      let endpoint = '/api/scrape/viper';
      if (isPornhatDomain(inputClean)) endpoint = '/api/scrape/pornhat';
      if (isPornboxDomain(inputClean)) endpoint = '/api/scrape/pornbox';
      if (isFreeonesDomain(inputClean)) endpoint = '/api/scrape/freeones';
      if (isGoonboxDomain(inputClean)) endpoint = '/api/scrape/goonbox';
      if (isAdultphotosetsDomain(inputClean)) endpoint = '/api/scrape/adultphotosets';
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputClean }),
        signal: abortCtrl.signal
      });
      if (!isMountedRef.current || abortCtrl.signal.aborted) return;

      const data = await res.json();
      if (!isMountedRef.current || abortCtrl.signal.aborted) return;
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to extract');

      const originalUrls: string[] = Array.from(new Set((data.images || []) as string[]));
      const thumbUrls: string[] = Array.from(new Set((data.thumbnails || originalUrls) as string[]));
      
      if (originalUrls.length === 0 && thumbUrls.length === 0) {
         addNotification("No images found in that thread.", "error");
      } else {
         const finalOriginal = originalUrls;
         const finalThumbs = thumbUrls.length > 0 ? thumbUrls : originalUrls;
         setOriginalGalleryUrls(finalOriginal);
         setGalleryUrls(finalThumbs);
         
         // Immediately persist to formDraft to guarantee zero data loss if user navigates back
         if (formDraft) {
           const draftStudios = (formDraft.studioIds || [])
             .map((sId: string) => state.studios.find(s => s.id === sId)?.name)
             .filter((name: any): name is string => Boolean(name));
           const isNA = isNaughtyAmericaStudioOrSeries(formDraft.title, ...draftStudios, inputClean);

           if (isNA && formDraft.coverImage) {
             detectCoverAspectRatio(formDraft.coverImage).then((computedRatio) => {
               setFormDraft({
                 ...formDraft,
                 aspectRatio: computedRatio,
                 galleryUrls: finalThumbs,
                 originalGalleryUrls: finalOriginal,
                 qualityPreference: activeTab,
                 galleryScraperUrl: inputClean,
                 scraperUrl: inputClean
               });
             });
           } else {
             setFormDraft({
               ...formDraft,
               galleryUrls: finalThumbs,
               originalGalleryUrls: finalOriginal,
               qualityPreference: activeTab,
               galleryScraperUrl: inputClean,
               scraperUrl: inputClean
             });
           }
         }

         addNotification(`Extracted ${originalUrls.length || thumbUrls.length} images!`, "success");
         setInputVal(inputClean);
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || !isMountedRef.current || abortCtrl.signal.aborted) {
        return;
      }
      addNotification(error.message, "error");
    } finally {
      if (extractAbortCtrlRef.current === abortCtrl) {
        extractAbortCtrlRef.current = null;
      }
      if (isMountedRef.current) {
        setIsExtracting(false);
      }
    }
  };

  const handleDeleteActive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentUrls.length === 0) return;

    // Synchronously delete the image from both thumbnail (galleryUrls) and original (originalGalleryUrls)
    const newGallery = [...galleryUrls];
    const newOriginal = [...originalGalleryUrls];

    if (activeIndex < newGallery.length) {
      newGallery.splice(activeIndex, 1);
    }
    if (activeIndex < newOriginal.length) {
      newOriginal.splice(activeIndex, 1);
    }

    setGalleryUrls(newGallery);
    setOriginalGalleryUrls(newOriginal);

    if (formDraft) {
      setFormDraft({
        ...formDraft,
        galleryUrls: newGallery,
        originalGalleryUrls: newOriginal,
        qualityPreference: activeTab,
        galleryScraperUrl: inputVal || (formDraft as any)?.galleryScraperUrl,
        scraperUrl: inputVal || (formDraft as any)?.scraperUrl
      });
    }

    const nextLength = activeTab === 'thumbnail' ? newGallery.length : newOriginal.length;
    if (activeIndex >= nextLength && nextLength > 0) {
      setActiveIndex(nextLength - 1);
    } else if (nextLength === 0) {
      setActiveIndex(0);
    }
  };

  useEffect(() => {
    const locState = location.state as any;
    if (locState?.scraperUrl && locState?.autoExtract) {
      navigate(location.pathname, { replace: true, state: { ...locState, autoExtract: false } });
      handleExtract(locState.scraperUrl);
    }
  }, [location.state, location.pathname, navigate]);

  const performClear = () => {
    setGalleryUrls([]);
    setOriginalGalleryUrls([]);
    setActiveIndex(0);
    if (formDraft) {
      setFormDraft({ ...formDraft, galleryUrls: [], originalGalleryUrls: [] });
    }
    setIsClearing(false);
  };

  const handleFinalConfirm = useCallback(() => {
    if (formDraft) {
      const draftStudios = (formDraft.studioIds || [])
        .map((sId: string) => state.studios.find(s => s.id === sId)?.name)
        .filter((name: any): name is string => Boolean(name));
      const isNA = isNaughtyAmericaStudioOrSeries(formDraft.title, ...draftStudios, inputValRef.current);

      if (isNA && formDraft.coverImage) {
        detectCoverAspectRatio(formDraft.coverImage).then((computedRatio) => {
          setFormDraft(prev => prev ? ({
            ...prev,
            aspectRatio: computedRatio,
            galleryUrls,
            originalGalleryUrls,
            qualityPreference: activeTab,
            galleryScraperUrl: inputValRef.current || (prev as any)?.galleryScraperUrl,
            scraperUrl: inputValRef.current || (prev as any)?.scraperUrl
          }) : null);
        });
      } else {
        setFormDraft(prev => prev ? ({
          ...prev,
          galleryUrls,
          originalGalleryUrls,
          qualityPreference: activeTab,
          galleryScraperUrl: inputValRef.current || (prev as any)?.galleryScraperUrl,
          scraperUrl: inputValRef.current || (prev as any)?.scraperUrl
        }) : null);
      }
    }
    setTimeout(() => {
      const fromPath = (location.state as any)?.from || '/add';
      navigate(fromPath, {
        replace: true,
        state: {
          ...((location.state as any) || {}),
          scraperUrl: inputValRef.current || (location.state as any)?.scraperUrl
        }
      });
    }, 0);
  }, [galleryUrls, originalGalleryUrls, activeTab, formDraft, setFormDraft, navigate, location]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      if (idx !== activeIndex && idx >= 0 && idx < currentUrls.length) {
        setActiveIndex(idx);
        if (idx >= 4) setHasScrolledDeep(true);
      }
    }
  };

  useEffect(() => {
    const trigger = () => handleFinalConfirm();
    window.addEventListener('vault-save-trigger', trigger);
    return () => window.removeEventListener('vault-save-trigger', trigger);
  }, [handleFinalConfirm]);

  const springBezier = "cubic-bezier(0.16, 1, 0.3, 1)";

  const getButtonStyle = (style: 'Glass' | 'ColorGlass' | 'SolidColors', btnId: string) => {
    const semanticColors: Record<string, { bg: string; border: string; glow: string }> = {
      trash: { bg: 'linear-gradient(135deg, #ef4444 0%, #991b1b 100%)', border: 'rgba(255,255,255,0.4)', glow: 'rgba(239, 68, 68, 0.5)' },
      cancel: { bg: 'linear-gradient(135deg, #4b5563 0%, #1f2937 100%)', border: 'rgba(255,255,255,0.3)', glow: 'rgba(0,0,0,0.3)' },
    };

    const solidColors: Record<string, { bg: string; border: string; glow: string }> = {
      trash: { bg: '#ef4444', border: 'rgba(255,255,255,0.4)', glow: 'rgba(239, 68, 68, 0.5)' },
      cancel: { bg: '#4b5563', border: 'rgba(255,255,255,0.3)', glow: 'rgba(0,0,0,0.3)' },
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

  return (
    <div className="max-w-2xl mx-auto flex flex-col p-4 animate-slide-in h-full pt-4 gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex w-full gap-3">
          <InputBar 
            label="Scraper" 
            value={inputVal} 
            onChange={setInputVal} 
            placeholder="Paste viper, pornhat, adultphotosets, pornbox, freeones, or goonbox link..." 
            showPaste 
            compact
          />
          <button
            type="button"
            onClick={() => {
              const inputClean = inputVal.trim();
              if (isSupportedScraperDomain(inputClean)) {
                handleExtract();
              } else {
                addNotification("Please enter a valid supported link (viper, pornhat, adultphotosets, pornbox, freeones, goonbox)", "error");
              }
            }}
            disabled={isExtracting}
            className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--text-primary)] tap-highlight-none ${isExtracting ? 'opacity-50' : ''}`}
          >
            {isExtracting ? (
              <Icons.Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Icons.Download className={`w-6 h-6 ${
                isSupportedScraperDomain(inputVal.trim()) 
                  ? 'text-green-400' 
                  : 'text-[var(--text-secondary)]'
              }`} />
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <label className="text-[9px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)]">Assets Staged</label>
          {currentUrls.length > 0 && (
            <span className="text-[10px] font-black text-[var(--accent)] uppercase tracking-widest transition-all">
              {activeIndex + 1} / {currentUrls.length}
            </span>
          )}
        </div>

        {/* Thumbnail / Original Toggle */}
        <div className="flex gap-3 w-full">
          {(['thumbnail', 'original'] as const).map(c => (
            <button
              key={c}
              onClick={() => { setActiveTab(c); setActiveIndex(0); }}
              className={`flex-1 h-[48px] rounded-full font-black text-[10px] uppercase tracking-widest transition-all border ${activeTab === c ? 'text-[var(--surface)] border-transparent shadow-lg' : 'bg-[var(--surface)] text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]'}`}
              style={activeTab === c ? { backgroundColor: state.settings.buttonColor } : {}}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="relative w-full aspect-video bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-lg group">
          {currentUrls.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)]">No assets staged</span>
            </div>
          ) : (
            <>
              <div 
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex w-full h-full overflow-x-auto snap-x snap-mandatory hide-scrollbar gpu-accelerated overscroll-x-contain"
                style={{ scrollSnapType: 'x mandatory' }}
              >
                {currentUrls.map((url, i) => {
                  const shouldLoad = hasScrolledDeep || (i < 2) || (Math.abs(i - activeIndex) <= 1);
                  return (
                    <div key={url + i} className="w-full h-full shrink-0 snap-center snap-always relative flex items-center justify-center bg-black/20">
                      {shouldLoad && url ? (
                        <img 
                          src={url} 
                          className="max-w-full max-h-full object-contain select-none pointer-events-none"
                          alt="" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://via.placeholder.com/600x338?text=Invalid+Source';
                          }}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full border-2 border-white/5 border-t-white/10 animate-spin" />
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Left side: Trash button to clear all staged items */}
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsClearing(true);
                }}
                className={`absolute top-3 left-3 z-[30] w-9 h-9 rounded-full bg-black/40 backdrop-blur-[32px] border border-white/15 flex items-center justify-center text-rose-400 active:scale-75 hover:bg-black/60 transition-all shadow-md ${isClearing ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100'}`}
                title="Delete all images"
                aria-label="Clear all images"
              >
                <div className="scale-90"><Icons.Trash /></div>
              </button>

              {/* Right side: Delete active image */}
              <button 
                type="button"
                onClick={handleDeleteActive}
                className={`absolute top-3 right-3 z-[30] w-9 h-9 rounded-full bg-black/40 backdrop-blur-[32px] border border-white/15 flex items-center justify-center text-white active:scale-75 hover:bg-black/60 transition-all shadow-md ${isClearing ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100'}`}
                title="Delete this image"
                aria-label="Remove this image"
              >
                <Icons.X />
              </button>

              <div 
                className="absolute inset-0 bg-black/70 flex items-center justify-center gap-6 z-[40] transition-opacity duration-300"
                style={{ 
                  opacity: isClearing ? 1 : 0,
                  pointerEvents: isClearing ? 'auto' : 'none',
                  backdropFilter: isClearing ? `blur(${blurIntensity/10}px)` : 'none'
                }}
              >
                <button 
                  onClick={() => setIsClearing(false)}
                  className={getButtonStyle(buttonStyle, 'cancel').className}
                  style={{
                    ...getButtonStyle(buttonStyle, 'cancel').style,
                    transform: isClearing ? 'translateY(0) scale(1.1)' : 'translateY(40px) scale(0.2)',
                    opacity: isClearing ? 1 : 0,
                    transition: `transform 550ms ${springBezier}, opacity 350ms ease-out`,
                  }}
                  title="Cancel"
                >
                  {buttonStyle === 'Glass' && <div className="absolute inset-0 bg-black/30 -z-10" />}
                  <div className="relative z-10 w-full h-full flex items-center justify-center overflow-hidden rounded-full">
                    <Icons.X />
                  </div>
                </button>
                <button 
                  onClick={performClear}
                  className={getButtonStyle(buttonStyle, 'trash').className}
                  style={{
                    ...getButtonStyle(buttonStyle, 'trash').style,
                    transform: isClearing ? 'translateY(0) scale(1.1)' : 'translateY(40px) scale(0.2)',
                    opacity: isClearing ? 1 : 0,
                    transition: `transform 550ms ${springBezier}, opacity 350ms ease-out`,
                    transitionDelay: isClearing ? '45ms' : '0ms',
                  }}
                  title="Confirm delete"
                >
                  {buttonStyle === 'Glass' && <div className="absolute inset-0 bg-black/30 -z-10" />}
                  <div className="relative z-10 w-full h-full flex items-center justify-center overflow-hidden rounded-full scale-110">
                    <Icons.Trash />
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pb-10" />
    </div>
  );
};
