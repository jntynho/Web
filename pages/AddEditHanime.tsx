import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { HanimeEpisode } from '../types';
import { InputBar } from '../components/InputBar';
import { HanimeEpisodeEditor } from '../components/HanimeEpisodeEditor';
import { Icons } from '../constants';
import { formatTitle } from '../utils/format';
import { scrapeHanimeSeries } from '../utils/hanimestream';

export const AddEditHanime: React.FC = () => {
  const { id } = useParams();
  const { state, addHanime, updateHanime, deleteHanime, isHydrated, hanimeDraft, setHanimeDraft, addNotification } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [title, setTitle] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [coverOffset, setCoverOffset] = useState(50);
  const [description, setDescription] = useState('');
  const [episodes, setEpisodes] = useState<HanimeEpisode[]>([]);
  const [assignedDate, setAssignedDate] = useState<number | undefined>();
  const [censorship, setCensorship] = useState<'UNCENSORED' | 'CENSORED'>('CENSORED');
  const [secondaryCovers, setSecondaryCovers] = useState<string[]>([]);
  const [scraperUrl, setScraperUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  
  const initialized = useRef(false);
  const isSaving = useRef(false);

  useEffect(() => {
    if (!isHydrated || initialized.current) return;

    // Helper to enrich episodes with full fields & booster covers
    const enrichEpisodes = (rawEpisodes: HanimeEpisode[], parentTitle: string, parentCover: string, parentSecCovers: string[], parentDesc: string, parentDate?: number, parentCensorship?: 'UNCENSORED' | 'CENSORED') => {
      return (rawEpisodes || []).map((ep, idx) => {
        let booster = ep.boosterCover;
        if (!booster) {
          if (idx === 0) booster = parentCover;
          else if (parentSecCovers && parentSecCovers[idx - 1]) {
            booster = parentSecCovers[idx - 1];
          }
        }
        return {
          ...ep,
          title: ep.title || (parentTitle ? `${formatTitle(parentTitle)} - ${ep.episodeNumber}` : `Episode ${ep.episodeNumber}`),
          boosterCover: booster || ep.coverImage || parentCover || '',
          coverImage: ep.coverImage || booster || parentCover || '',
          assignedDate: ep.assignedDate || parentDate,
          censorship: ep.censorship || parentCensorship || 'CENSORED',
          description: ep.description || parentDesc || ''
        };
      });
    };

    // If there's a draft for THIS specific ID, use it
    if (hanimeDraft && hanimeDraft.id === (id || null)) {
      setTitle(hanimeDraft.title);
      setCoverImage(hanimeDraft.coverImage);
      setCoverOffset(hanimeDraft.coverOffset ?? 50);
      setDescription(hanimeDraft.description);
      setEpisodes(enrichEpisodes(hanimeDraft.episodes, hanimeDraft.title, hanimeDraft.coverImage, hanimeDraft.secondaryCovers, hanimeDraft.description, hanimeDraft.assignedDate, hanimeDraft.censorship));
      setAssignedDate(hanimeDraft.assignedDate);
      setCensorship(hanimeDraft.censorship || 'UNCENSORED');
      setSecondaryCovers(hanimeDraft.secondaryCovers);
      setScraperUrl(hanimeDraft.hanimeScraperUrl || '');
      initialized.current = true;
    } else if (id) {
      const hanime = state.hanime.find(h => h.id === id);
      if (hanime) {
        setTitle(hanime.title);
        setCoverImage(hanime.coverImage);
        setCoverOffset(hanime.coverOffset ?? 50);
        setDescription(hanime.description || '');
        setEpisodes(enrichEpisodes(hanime.episodes, hanime.title, hanime.coverImage, hanime.secondaryCovers || [], hanime.description || '', hanime.assignedDate, hanime.censorship));
        setAssignedDate(hanime.assignedDate);
        setCensorship(hanime.censorship || 'UNCENSORED');
        setSecondaryCovers(hanime.secondaryCovers || []);
        initialized.current = true;
      }
    } else {
      initialized.current = true;
    }
  }, [id, state.hanime, isHydrated, hanimeDraft]);

  const draftRef = useRef({
    id: id || null,
    title,
    coverImage,
    coverOffset,
    description,
    episodes,
    assignedDate,
    censorship,
    secondaryCovers,
    hanimeScraperUrl: scraperUrl
  });

  useEffect(() => {
    draftRef.current = {
      id: id || null,
      title,
      coverImage,
      coverOffset,
      description,
      episodes,
      assignedDate,
      censorship,
      secondaryCovers,
      hanimeScraperUrl: scraperUrl
    };
  }, [id, title, coverImage, coverOffset, description, episodes, assignedDate, censorship, secondaryCovers, scraperUrl]);

  // Clear draft when leaving the page
  useEffect(() => {
    return () => {
      if (!isSaving.current) {
        setHanimeDraft(null);
      }
    };
  }, [setHanimeDraft]);

  const handleEpisodesChange = useCallback((updatedEpisodes: HanimeEpisode[]) => {
    setEpisodes(updatedEpisodes);

    // Keep primary cover in sync with episode 1 booster / cover
    if (updatedEpisodes.length > 0) {
      const ep1 = updatedEpisodes[0];
      if (ep1.boosterCover) {
        setCoverImage(ep1.boosterCover);
      } else if (ep1.coverImage && !coverImage) {
        setCoverImage(ep1.coverImage);
      }
      if (ep1.title && !title) {
        setTitle(ep1.title);
      }
      if (ep1.assignedDate && !assignedDate) {
        setAssignedDate(ep1.assignedDate);
      }
      if (ep1.censorship) {
        setCensorship(ep1.censorship);
      }

      // Keep secondary covers in sync
      const nextSecondary = updatedEpisodes
        .slice(1)
        .map(e => e.boosterCover || e.coverImage)
        .filter(Boolean) as string[];
      if (nextSecondary.length > 0) {
        setSecondaryCovers(nextSecondary);
      }
    }
  }, [coverImage, title, assignedDate]);

  const handleSave = useCallback(() => {
    // Resolve final title and coverImage from episodes if not explicitly set
    let finalTitle = title.trim();
    let finalCover = coverImage.trim();

    if (!finalTitle && episodes.length > 0 && episodes[0]?.title) {
      finalTitle = episodes[0].title;
    }
    if (!finalCover && episodes.length > 0) {
      finalCover = episodes[0].boosterCover || episodes[0].coverImage || '';
    }

    if (!finalTitle || !finalCover) {
      addNotification("Please enter or scrape a Hanime link first.", "error");
      return;
    }

    const isDuplicateTitle = state.hanime.some(h => h.id !== id && h.title.toLowerCase() === finalTitle.toLowerCase());
    if (isDuplicateTitle) {
      addNotification("Hanime Name: A Hanime with this title already exists.", "error");
      return;
    }

    const newEpisodeUrls = episodes.map(e => e.url).filter(Boolean);
    if (newEpisodeUrls.length > 0) {
      const duplicateHanime = state.hanime.find(h => h.id !== id && h.episodes.some(e => newEpisodeUrls.includes(e.url)));
      const duplicateEpisode = duplicateHanime?.episodes.find(e => newEpisodeUrls.includes(e.url));
      
      if (duplicateEpisode) {
        addNotification(`Episode Link: The link ${duplicateEpisode.url} already exists in another Hanime (${duplicateHanime?.title}).`, "error");
        return;
      }
    }

    const isDuplicateCover = state.hanime.some(h => h.id !== id && h.coverImage === finalCover);
    if (isDuplicateCover) {
      addNotification("Cover Image URL: This cover image is already used in another Hanime.", "error");
      return;
    }

    isSaving.current = true;
    if (id) {
      updateHanime(id, { title: finalTitle, coverImage: finalCover, coverOffset, description, episodes, assignedDate, censorship, secondaryCovers });
    } else {
      addHanime({ title: finalTitle, coverImage: finalCover, coverOffset, description, episodes, assignedDate, censorship, secondaryCovers });
    }
    setHanimeDraft(null);
    const from = location.state?.originalFrom || location.state?.from;
    if (!id && from) {
      navigate(from, { replace: true });
    } else {
      setTimeout(() => {
        const fromPath = (location.state as any)?.originalFrom || (location.state as any)?.from || '/manage-hanime';
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      }, 0);
    }
  }, [id, title, coverImage, coverOffset, description, episodes, assignedDate, censorship, secondaryCovers, updateHanime, addHanime, navigate, location.state?.from, setHanimeDraft, state.hanime, addNotification]);

  // Handler for scraping HStream series link
  const handleScrape = useCallback(async (urlToScrape: string) => {
    const clean = urlToScrape.trim();
    if (!clean) return;

    setIsScraping(true);
    addNotification('Capturing Hanime series data from HStream...', 'info');

    try {
      const data = await scrapeHanimeSeries(clean);

      // 1. Extract Title
      if (data.title) {
        const formatted = formatTitle(data.title);
        setTitle(formatted);
      }

      // 2. Extract smallest date and set assignedDate timestamp
      if (data.smallestDate) {
        const dateObj = new Date(data.smallestDate);
        if (!isNaN(dateObj.getTime())) {
          setAssignedDate(dateObj.getTime());
        }
      }

      // 3. Extract Description
      if (data.description) {
        setDescription(data.description);
      }

      // 4. Extract Censorship (UNCENSORED / CENSORED)
      if (data.censorship) {
        setCensorship(data.censorship);
      }

      // 5. Extract Episodes (URLs & Covers, Titles, Descriptions, Booster Covers)
      if (data.episodes && data.episodes.length > 0) {
        const seriesSmallestDate = data.smallestDate ? new Date(data.smallestDate).getTime() : undefined;
        const mappedEpisodes: HanimeEpisode[] = data.episodes.map((ep, idx) => {
          let booster = ep.boosterCover;
          if (!booster) {
            if (data.boosterCovers && data.boosterCovers[idx]) {
              booster = data.boosterCovers[idx];
            } else if (idx === 0 && data.coverImage) {
              booster = data.coverImage;
            } else if (idx > 0 && data.secondaryCovers && data.secondaryCovers[idx - 1]) {
              booster = data.secondaryCovers[idx - 1];
            }
          }

          let epTitle = ep.title ? formatTitle(ep.title) : '';
          if (!epTitle && data.title) {
            epTitle = `${formatTitle(data.title)} - ${ep.episodeNumber}`;
          }

          const epDesc = ep.description || data.description || '';
          const epDate = ep.assignedDate || seriesSmallestDate;
          const epCensorship = ep.censorship || data.censorship || 'CENSORED';

          return {
            id: Math.random().toString(36).substring(2, 11),
            url: ep.url,
            coverImage: ep.coverImage || booster || data.coverImage || '',
            episodeNumber: ep.episodeNumber,
            title: epTitle || `Episode ${ep.episodeNumber}`,
            description: epDesc,
            boosterCover: booster || ep.coverImage || data.coverImage || '',
            assignedDate: epDate,
            censorship: epCensorship,
            gallery: ep.gallery || []
          };
        });
        setEpisodes(mappedEpisodes);
      }

      // 6. Booster Covers:
      // First booster cover -> Cover hanime (coverImage)
      if (data.coverImage) {
        setCoverImage(data.coverImage);
      }

      // Second, third, etc. booster covers -> Add Second Covers (secondaryCovers) in order
      if (data.secondaryCovers && data.secondaryCovers.length > 0) {
        setSecondaryCovers(data.secondaryCovers);
      }

      const coversCount = data.boosterCovers?.length || (data.coverImage ? 1 : 0);
      addNotification(`Data captured successfully! (${data.episodes.length} episodes${coversCount > 0 ? `, ${coversCount} booster covers` : ''})`, 'success');
    } catch (err: any) {
      console.error('Hanime scraping failed:', err);
      addNotification(`Failed to capture data: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setIsScraping(false);
    }
  }, [addNotification]);

  const handlePermanentDelete = () => {
    if (!id) return;
    deleteHanime(id);
    setHanimeDraft(null);
    addNotification("Hanime deleted successfully", "success");
    const stateObj = (location.state as any) || {};
    let target = stateObj.originalFrom || stateObj.from;
    let targetState = stateObj.returnState;

    // If 'from' points back to the now-deleted hanime's detail view, redirect to manage-hanime
    if (target && (target === `/hanime/${id}` || target.startsWith(`/hanime/${id}?`) || target.startsWith('/manage-hanime/edit/'))) {
      target = targetState?.from || '/manage-hanime';
      targetState = targetState?.returnState;
    }

    const finalPath = target || '/manage-hanime';
    navigate(finalPath, { replace: true, state: targetState });
  };

  useEffect(() => {
    const trigger = () => handleSave();
    window.addEventListener('vault-save-trigger', trigger);
    return () => window.removeEventListener('vault-save-trigger', trigger);
  }, [handleSave]);


  if (!isHydrated) {
    return (
      <div className="max-w-xl mx-auto flex flex-col gap-6 px-4 pt-4 pb-4 w-full relative animate-pulse">
        <div className="flex gap-3 items-center">
          <div className="flex-1 h-[48px] bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full px-4 flex flex-col justify-center gap-0.5">
            <div className="h-2 w-16 bg-[var(--border)] rounded-full opacity-50" />
            <div className="h-3.5 w-1/2 bg-[var(--border)] rounded-full opacity-25" />
          </div>
          <div className="w-[48px] h-[48px] bg-[var(--border)] opacity-20 rounded-full shrink-0" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 pb-48 pt-4 w-full flex flex-col gap-y-6 animate-fade-in-fast">
      <div className="flex flex-col gap-y-4">
        {/* Hanime Scraper Input + Distinctive Hanime Action Button (Only in Add mode) */}
        {!id && (
          <div className="flex gap-3 items-center">
            <div className="flex-1 min-w-0">
              <InputBar 
                label="Hanime Scraper"
                value={scraperUrl}
                onChange={(val) => {
                  setScraperUrl(val);
                }}
                onPasteCapture={(text) => {
                  setScraperUrl(text);
                  if (text.trim()) {
                    handleScrape(text);
                  }
                }}
                placeholder="Paste HStream URL..."
                showPaste
                isLoading={isScraping}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                if (!scraperUrl.trim()) {
                  addNotification("Please enter an HStream / Hanime URL first", "warning");
                  return;
                }
                handleScrape(scraperUrl);
              }}
              disabled={isScraping}
              title="Scrape Hanime"
              className={`w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none ${isScraping ? "opacity-50" : ""}`}
              style={{ backgroundColor: state.settings.buttonColor }}
            >
              {isScraping ? (
                <Icons.Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Icons.Hanime size={24} className="w-6 h-6" />
              )}
            </button>
          </div>
        )}

        {/* Detailed Booster & Episode Editor List */}
        <div className="w-full mt-1">
          <HanimeEpisodeEditor
            episodes={episodes}
            onChange={handleEpisodesChange}
            buttonColor={state.settings.buttonColor}
          />
        </div>

        {id && (
          <div className="w-full mt-4 relative h-12">
            <div 
              className={`absolute inset-0 flex gap-3 transition-all duration-300 ease-[var(--ease-spring)] will-change-transform ${isConfirmingDelete ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}`}
            >
              <button 
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 py-3 rounded-full font-black uppercase tracking-widest text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] shadow-md active:scale-95 transition-transform"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handlePermanentDelete}
                className="flex-1 py-3 rounded-full font-black uppercase tracking-widest text-[10px] bg-red-600 text-white shadow-md hover:bg-red-500 active:scale-95 transition-all"
              >
                Delete
              </button>
            </div>
            <button 
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className={`absolute inset-0 w-full py-3 rounded-full font-black uppercase tracking-widest text-[10px] transition-all active:scale-[0.98] text-[var(--surface)] shadow-md ${isConfirmingDelete ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100 scale-100'}`}
              style={{ backgroundColor: state.settings.buttonColor }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
