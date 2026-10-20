import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { CoomerPost } from '../types';
import { DateSelector } from '../components/DateSelector';
import { InputBar } from '../components/InputBar';
import { motion, AnimatePresence } from 'motion/react';
import { compressImage, getThumbnailUrl, getOriginalUrl } from '../utils/image';
import { invalidateCoomerCache } from './CoomerDetail';

export const AddCoomerSocials: React.FC = () => {
  const { id, postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, updateCoomer, addNotification, isHydrated } = useApp();

  const coomer = state.coomers.find(c => c.id === id);
  const isEditMode = !!postId;
  
  const [mode, setMode] = useState<'Single' | 'Multiple'>('Single');
  const [input, setInput] = useState('');
  const [goonboxUrl, setGoonboxUrl] = useState(() => coomer?.goonboxUrl || '');
  const [isGoonboxExtracting, setIsGoonboxExtracting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [stagedItems, setStagedItems] = useState<{ id: string; url: string; thumbUrl?: string; date?: number }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showDateSelector, setShowDateSelector] = useState(false);
  const [backupItems, setBackupItems] = useState<{ id: string; url: string; thumbUrl?: string; date?: number }[] | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const isSaveLockedRef = useRef(false);
  const activeExtractControllerRef = useRef<AbortController | null>(null);
  const activeGoonboxControllerRef = useRef<AbortController | null>(null);

  // Clean up any ongoing extraction requests on component unmount
  useEffect(() => {
    return () => {
      if (activeExtractControllerRef.current) {
        activeExtractControllerRef.current.abort();
        activeExtractControllerRef.current = null;
      }
      if (activeGoonboxControllerRef.current) {
        activeGoonboxControllerRef.current.abort();
        activeGoonboxControllerRef.current = null;
      }
    };
  }, []);

  // Sync saved goonboxUrl if present
  useEffect(() => {
    if (coomer?.goonboxUrl && !goonboxUrl) {
      setGoonboxUrl(coomer.goonboxUrl);
    }
  }, [coomer?.goonboxUrl, goonboxUrl]);

  const handleOpenDateSelector = () => {
    setBackupItems([...stagedItems]);
    setShowDateSelector(true);
  };

  const handleCancelDateSelector = () => {
    if (backupItems) {
      setStagedItems(backupItems);
    }
    setBackupItems(null);
    setShowDateSelector(false);
  };

  const handleConfirmDateSelector = (timestamp: number) => {
    handleDateChange(timestamp);
    setBackupItems(null);
    setShowDateSelector(false);
  };

  const handleDateChange = (newDate: number) => {
    setStagedItems(prev => prev.map((item, i) => 
      i === activeIndex ? { ...item, date: newDate } : item
    ));
  };

  useEffect(() => {
    if (isEditMode && coomer) {
      const allPosts = [
        ...(coomer.posts || []),
        ...(coomer.instagramPosts || []),
        ...(coomer.onlyFansPosts || [])
      ];
      const postToEdit = allPosts.find(p => p.id === postId);
      if (postToEdit) {
        setMode(postToEdit.type);
        setStagedItems(postToEdit.urls.map((url, idx) => ({ 
          id: Math.random().toString(36).substring(2, 11), 
          url,
          thumbUrl: postToEdit.thumbUrls?.[idx] || getThumbnailUrl(url),
          date: postToEdit.perImageDates?.[idx] || postToEdit.date
        })));
      }
    }
  }, [isEditMode, coomer, postId]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const parseUrls = (text: string): string[] => {
    const urlRegex = /https?:\/\/[^\s\n\t]+/gi;
    return (text.match(urlRegex) || []) as string[];
  };

  const handleAddUrls = async (textToAdd?: string) => {
    const raw = typeof textToAdd === 'string' ? textToAdd : input;
    const urls = parseUrls(raw);
    if (urls.length === 0) return;
    
    const directImages: { url: string; thumbUrl?: string; date?: number }[] = [];
    const webPagesToExtract: string[] = [];

    (urls || []).forEach(u => {
      if (u.includes('goonbox.cr')) {
        webPagesToExtract.push(u);
      } else if (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(u)) {
        directImages.push({ url: getOriginalUrl(u) || u, thumbUrl: getThumbnailUrl(u) });
      } else if (u.includes('coomer.') || u.includes('kemono.') || u.includes('bunkr.') || u.includes('simpcity.') || u.includes('cum.st')) {
        webPagesToExtract.push(u);
      } else {
        directImages.push({ url: getOriginalUrl(u) || u, thumbUrl: getThumbnailUrl(u) });
      }
    });

    if (webPagesToExtract.length > 0) {
      if (activeExtractControllerRef.current) {
        activeExtractControllerRef.current.abort();
      }
      const controller = new AbortController();
      activeExtractControllerRef.current = controller;

      setIsExtracting(true);
      try {
        for (const pageUrl of webPagesToExtract) {
          if (controller.signal.aborted) break;
          const endpoint = pageUrl.includes('goonbox.cr') ? '/api/extract/goonbox' : '/api/extract/coomer';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: pageUrl, fetchAll: true }),
            signal: controller.signal
          });
          if (controller.signal.aborted) break;
          const data = await res.json();
          if (controller.signal.aborted) break;

          if (data.success) {
            if (data.isSinglePost || (Array.isArray(data.groupedPosts) && data.groupedPosts.length === 1)) {
              const singleGroup = data.groupedPosts?.[0];
              if (singleGroup?.type) {
                setMode(singleGroup.type);
              }
            }

            if (Array.isArray(data.items) && data.items.length > 0) {
              data.items.forEach((item: any) => {
                directImages.push({
                  url: item.originalUrl || item.url,
                  thumbUrl: item.thumbUrl || getThumbnailUrl(item.originalUrl || item.url),
                  date: item.date
                });
              });
              addNotification(`Extracted ${data.items.length} Goonbox / media images with thumbnails and dates`, 'success');
            } else if (Array.isArray(data.images) && data.images.length > 0) {
              data.images.forEach((img: string) => {
                directImages.push({
                  url: getOriginalUrl(img) || img,
                  thumbUrl: getThumbnailUrl(img)
                });
              });
              addNotification(`Extracted ${data.images.length} images from page`, 'success');
            }
          } else {
            directImages.push({ url: pageUrl, thumbUrl: pageUrl });
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Extraction error:', err);
        }
      } finally {
        if (activeExtractControllerRef.current === controller) {
          setIsExtracting(false);
          activeExtractControllerRef.current = null;
        }
      }
    }

    const newItems = directImages.map(item => ({
      id: Math.random().toString(36).substr(2, 9),
      url: item.url,
      thumbUrl: item.thumbUrl || getThumbnailUrl(item.url),
      date: item.date
    }));
    
    setStagedItems(prev => [...prev, ...newItems]);
    setInput('');
  };

  // Save Scraper URL immediately upon pasting or clicking the save button
  const handleSaveGoonbox = (urlToSave?: string) => {
    const target = (urlToSave || goonboxUrl).trim();
    if (!target || !coomer) return;
    updateCoomer(coomer.id, { goonboxUrl: target });
    addNotification('Scraper URL saved successfully!', 'success');
    if (navigator.vibrate) navigator.vibrate(50);
  };

  const handleGoonboxUrlPaste = (val: string) => {
    const trimmed = val.trim();
    setGoonboxUrl(trimmed);
    if (trimmed) {
      if (coomer) {
        handleSaveGoonbox(trimmed);
      }
      if (trimmed.includes('instagram.com/') || trimmed.includes('instagr.am/') || trimmed.includes('goonbox.cr/')) {
        handleExtractGoonbox(trimmed);
      }
    }
  };

  // Extract media with original and thumbnail URLs
  const handleExtractGoonbox = async (urlToExtract?: string) => {
    const targetUrl = (urlToExtract || goonboxUrl).trim();
    if (!targetUrl) return;

    if (coomer) {
      updateCoomer(coomer.id, { goonboxUrl: targetUrl });
    }

    if (activeGoonboxControllerRef.current) {
      activeGoonboxControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeGoonboxControllerRef.current = controller;

    setIsGoonboxExtracting(true);

    try {
      const res = await fetch('/api/extract/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, fetchAll: true, maxPages: 50 }),
        signal: controller.signal
      });

      if (controller.signal.aborted) return;
      const data = await res.json();
      if (controller.signal.aborted) return;

      if (data.success && Array.isArray(data.items) && data.items.length > 0) {
        const platformName = data.platform === 'instagram' ? 'Instagram' : 'media';

        if (data.isSinglePost || (Array.isArray(data.groupedPosts) && data.groupedPosts.length === 1)) {
          const singleGroup = data.groupedPosts?.[0];
          const postType: 'Single' | 'Multiple' = singleGroup?.type || (data.items.length > 1 ? 'Multiple' : 'Single');
          setMode(postType);

          const newStaged = data.items.map((item: any) => ({
            id: item.id || Math.random().toString(36).substr(2, 9),
            url: item.originalUrl || item.url,
            thumbUrl: item.thumbUrl || getThumbnailUrl(item.originalUrl || item.url),
            date: item.date || Date.now()
          }));

          setStagedItems(newStaged);
          setActiveIndex(0);
          addNotification(`Extracted ${newStaged.length} ${platformName} ${newStaged.length > 1 ? 'images' : 'image'} with thumbnails!`, 'success');
        } 
        else if (Array.isArray(data.groupedPosts) && data.groupedPosts.length > 1 && coomer) {
          const existingPosts: CoomerPost[] = [
            ...(coomer.posts || []),
            ...(coomer.instagramPosts || []),
            ...(coomer.onlyFansPosts || [])
          ];
          const existingPostIds = new Set(existingPosts.map(p => String(p.id)));
          const existingUrls = new Set(existingPosts.flatMap(p => p.urls));

          const createdPosts: CoomerPost[] = [];
          for (const gp of data.groupedPosts) {
            const pid = gp.postId ? String(gp.postId) : Math.random().toString(36).substr(2, 9);
            
            if (existingPostIds.has(pid)) {
              continue;
            }

            const freshUrls: string[] = [];
            const freshThumbs: string[] = [];
            const freshDates: number[] = [];
            
            (gp.urls || []).forEach((u: string, uIdx: number) => {
              if (!existingUrls.has(u)) {
                freshUrls.push(u);
                freshThumbs.push(gp.thumbUrls?.[uIdx] || getThumbnailUrl(u));
                freshDates.push(gp.perImageDates?.[uIdx] || gp.date || Date.now());
                existingUrls.add(u);
              }
            });

            if (freshUrls.length === 0) {
              continue;
            }

            existingPostIds.add(pid);

            createdPosts.push({
              id: pid,
              urls: freshUrls,
              thumbUrls: freshThumbs,
              perImageDates: freshDates,
              date: gp.date || freshDates[0] || Date.now(),
              type: freshUrls.length > 1 ? 'Multiple' : 'Single',
              createdAt: gp.date || Date.now()
            });
          }

          if (createdPosts.length > 0) {
            const updatedPosts = [...existingPosts, ...createdPosts];
            updateCoomer(coomer.id, {
              posts: updatedPosts,
              totalPostsCount: typeof data.total === 'number' && data.total > 0 ? data.total : (coomer.totalPostsCount || updatedPosts.length),
              goonboxUrl: targetUrl,
              instagramPosts: [],
              onlyFansPosts: []
            });
            invalidateCoomerCache(coomer.id);

            const multiCount = createdPosts.filter(p => p.type === 'Multiple').length;
            const singleCount = createdPosts.filter(p => p.type === 'Single').length;
            const pagesInfo = data.pagesFetched ? ` across ${data.pagesFetched} pages` : '';
            addNotification(`Imported ${createdPosts.length} posts (${multiCount} albums & ${singleCount} singles)${pagesInfo} with thumbnails!`, 'success');
            
            setTimeout(() => {
              const fromPath = (location.state as any)?.from || `/coomer/${id}`;
              navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
            }, 600);
          } else {
            const staged = data.items.map((item: any) => ({
              id: item.id || Math.random().toString(36).substr(2, 9),
              url: item.originalUrl || item.url,
              thumbUrl: item.thumbUrl || getThumbnailUrl(item.originalUrl || item.url),
              date: item.date || Date.now()
            }));
            setStagedItems(staged);
            addNotification(`Staged ${staged.length} ${platformName} images with thumbnails!`, 'info');
          }
        } else {
          const staged = data.items.map((item: any) => ({
            id: item.id || Math.random().toString(36).substr(2, 9),
            url: item.originalUrl || item.url,
            thumbUrl: item.thumbUrl || getThumbnailUrl(item.originalUrl || item.url),
            date: item.date || Date.now()
          }));
          setStagedItems(staged);
          addNotification(`Extracted ${staged.length} images from ${platformName} with thumbnails!`, 'success');
        }
      } else {
        addNotification(data.error || 'No images found for this URL.', 'error');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Extraction error:', err);
        addNotification(`Extraction error: ${err.message || 'Connection failed'}`, 'error');
      }
    } finally {
      if (activeGoonboxControllerRef.current === controller) {
        setIsGoonboxExtracting(false);
        activeGoonboxControllerRef.current = null;
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files) as File[];
    const newItems: { id: string; url: string; thumbUrl?: string; date?: number }[] = [];

    for (const file of fileArray) {
      try {
        const compressedBase64 = await compressImage(file, 900, 0.75);
        newItems.push({
          id: Math.random().toString(36).substring(2, 11),
          url: compressedBase64,
          thumbUrl: compressedBase64,
          date: Date.now()
        });
      } catch {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        newItems.push({
          id: Math.random().toString(36).substring(2, 11),
          url: base64,
          thumbUrl: base64,
          date: Date.now()
        });
      }
    }
    
    setStagedItems(prev => [...prev, ...newItems]);
    e.target.value = '';
  };

  const handleRemoveItem = (itemId: string) => {
    setStagedItems(prev => {
      const newItems = prev.filter(item => item.id !== itemId);
      if (activeIndex >= newItems.length && newItems.length > 0) {
        setActiveIndex(newItems.length - 1);
      }
      return newItems;
    });
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      const width = el.clientWidth;
      if (width === 0) return;
      const idx = Math.round(el.scrollLeft / width);
      if (idx !== activeIndex && idx >= 0 && idx < stagedItems.length) {
        setActiveIndex(idx);
      }
    }
  };

  const handleDeletePost = useCallback(() => {
    if (!coomer || !postId || isSaveLockedRef.current) return;
    isSaveLockedRef.current = true;
    const remainingPosts = (coomer.posts || []).filter(p => p.id !== postId);
    updateCoomer(coomer.id, {
      posts: remainingPosts,
      instagramPosts: (coomer.instagramPosts || []).filter(p => p.id !== postId),
      onlyFansPosts: (coomer.onlyFansPosts || []).filter(p => p.id !== postId)
    });
    invalidateCoomerCache(coomer.id);
    const fromPath = (location.state as any)?.from || `/coomer/${id}`;
    navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
  }, [coomer, postId, updateCoomer, navigate, id, location.state]);

  const handleSave = useCallback((shouldNavigate = true) => {
    if (!coomer || isSaveLockedRef.current) return;

    const urls = stagedItems.map(item => item.url);
    const thumbUrls = stagedItems.map(item => item.thumbUrl || getThumbnailUrl(item.url));
    const dates = stagedItems.map(item => item.date);
    
    if (urls.length === 0) {
      if (isEditMode) {
        handleDeletePost();
        return;
      }
      if (shouldNavigate) {
        const fromPath = (location.state as any)?.from || `/coomer/${id}`;
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      }
      return;
    }

    isSaveLockedRef.current = true;

    const existingPosts: CoomerPost[] = [
      ...(coomer.posts || []),
      ...(coomer.instagramPosts || []),
      ...(coomer.onlyFansPosts || [])
    ];
    
    if (isEditMode) {
      const postToEdit = existingPosts.find(p => p.id === postId);
      const remainingPosts = existingPosts.filter(p => p.id !== postId);
      
      const newPost: CoomerPost = {
        id: postId!,
        urls: urls,
        thumbUrls: thumbUrls,
        perImageDates: dates,
        date: dates[0] || Date.now(),
        type: mode,
        createdAt: postToEdit?.createdAt || Date.now()
      };

      updateCoomer(coomer.id, {
        posts: [...remainingPosts, newPost],
        instagramPosts: [],
        onlyFansPosts: []
      });
    } else {
      const newPosts: CoomerPost[] = [];
      if (mode === 'Single') {
        stagedItems.forEach((item, idx) => {
          newPosts.push({
            id: Math.random().toString(36).substr(2, 9),
            urls: [item.url],
            thumbUrls: [thumbUrls[idx] || item.thumbUrl || getThumbnailUrl(item.url)],
            date: item.date || Date.now(),
            type: 'Single',
            createdAt: Date.now()
          });
        });
      } else {
        newPosts.push({
          id: Math.random().toString(36).substr(2, 9),
          urls: urls,
          thumbUrls: thumbUrls,
          perImageDates: dates,
          date: dates[0] || Date.now(),
          type: 'Multiple',
          createdAt: Date.now()
        });
      }
      
      updateCoomer(coomer.id, {
        posts: [...existingPosts, ...newPosts],
        instagramPosts: [],
        onlyFansPosts: []
      });
    }

    invalidateCoomerCache(coomer.id);

    if (shouldNavigate) {
      const fromPath = (location.state as any)?.from || `/coomer/${id}`;
      navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
    } else {
      setStagedItems([]);
      setActiveIndex(0);
      setInput('');
      isSaveLockedRef.current = false;
      if (navigator.vibrate) navigator.vibrate(50);
    }
  }, [coomer, mode, stagedItems, updateCoomer, navigate, isEditMode, postId, handleDeletePost, id, location.state]);

  useEffect(() => {
    const trigger = () => handleSave(true);
    window.addEventListener('vault-save-trigger', trigger);
    return () => window.removeEventListener('vault-save-trigger', trigger);
  }, [handleSave]);

  if (!isHydrated || !coomer) return null;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 px-4 pt-4 pb-24 w-full relative animate-fade-in-fast">
      {/* 1. Scraper URL Input */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            SCRAPER
          </span>
          {isGoonboxExtracting && (
            <span className="text-[9px] font-bold text-[var(--accent)] animate-pulse uppercase tracking-wider">
              Scraping Media...
            </span>
          )}
        </div>

        <div className="flex w-full gap-2 sm:gap-3 items-center">
          <div className="flex-1 min-w-0">
            <InputBar 
              label="SCRAPER" 
              value={goonboxUrl} 
              onChange={(val) => {
                setGoonboxUrl(val);
                if (coomer && val.trim()) {
                  updateCoomer(coomer.id, { goonboxUrl: val.trim() });
                }
              }} 
              onPasteCapture={handleGoonboxUrlPaste}
              placeholder="Paste scraper URL..." 
              showPaste
            />
          </div>
          <button 
            type="button" 
            disabled={isGoonboxExtracting || !goonboxUrl.trim()}
            onClick={() => handleExtractGoonbox()} 
            className={`w-[48px] h-[48px] min-h-[44px] min-w-[44px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none touch-manipulation ${isGoonboxExtracting || !goonboxUrl.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
            style={{ backgroundColor: state.settings.buttonColor }}
            title="Extract all media"
          >
            {isGoonboxExtracting ? (
              <div className="w-5 h-5 border-2 border-[var(--surface)] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Icons.Download className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      {/* 2. Direct Media Input & Upload */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Media Links / Upload
          </span>
        </div>
        <InputBar 
          label="Media Links" 
          value={input} 
          onChange={setInput} 
          onPasteCapture={setInput}
          placeholder="Paste image URLs..." 
          showPaste
          rightElement={
            <button 
              type="button" 
              onClick={input.trim() ? () => handleAddUrls() : () => fileInputRef.current?.click()} 
              className="w-11 h-11 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--accent)] shrink-0 active:scale-75 transition-transform tap-highlight-none touch-manipulation"
              title={input.trim() ? "Add links" : "Upload image file"}
            >
              {input.trim() ? <Icons.Check /> : <Icons.Plus />}
            </button>
          }
        />
        <input 
          type="file" 
          multiple 
          hidden 
          ref={fileInputRef} 
          onChange={handleFileSelect} 
          accept="image/*" 
        />
        
        {/* Post Mode Selection */}
        <div className="flex flex-col gap-2 mt-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] px-2">
            Post Format
          </span>
          <div className="flex gap-3 w-full">
            {(['Single', 'Multiple'] as const).map(m => {
              const isActive = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 h-[48px] min-h-[44px] rounded-full font-black text-[10px] uppercase tracking-widest transition-all border touch-manipulation ${
                    isActive 
                      ? 'text-[var(--surface)] border-transparent shadow-lg' 
                      : 'bg-[var(--surface)] text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)] active:scale-95'
                  }`}
                  style={isActive ? { backgroundColor: state.settings.buttonColor } : {}}
                >
                  {m === 'Single' ? 'SINGLE' : 'MULTIPLE'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Staged Media Preview Card */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-2 min-h-[36px]">
          <AnimatePresence mode="wait">
            {showDateSelector ? (
              <motion.div
                key="date-selector"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="flex-1"
              >
                <DateSelector 
                  value={stagedItems[activeIndex]?.date}
                  onSave={handleConfirmDateSelector}
                  onCancel={handleCancelDateSelector}
                />
              </motion.div>
            ) : (
              <motion.div
                key="header-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="flex items-center justify-between w-full"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Staged Media
                  </span>
                  {stagedItems.length > 0 && (
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-bold border border-[var(--accent)]/20 animate-slide-in">
                      {activeIndex + 1} / {stagedItems.length}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {stagedItems.length > 0 && (
                    <button 
                      type="button"
                      onClick={handleOpenDateSelector}
                      className="w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] active:scale-75 transition-transform touch-manipulation"
                      title="Assign Date"
                    >
                      <Icons.Calendar size={18} />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <div className="relative w-full aspect-[4/3] bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-lg group flex flex-col">
          {stagedItems.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30">
              <div className="mb-3 scale-125 text-[var(--text-muted)]">
                <Icons.Upload />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                No Media Staged
              </span>
            </div>
          ) : (
            <>
              {/* Remove Current Item Button */}
              {stagedItems.length > 0 && !showDateSelector && (
                <button 
                  type="button"
                  onClick={() => handleRemoveItem(stagedItems[activeIndex].id)}
                  className="absolute top-3 right-3 w-9 h-9 min-h-[44px] min-w-[44px] rounded-full bg-[var(--surface)]/80 backdrop-blur-md border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] hover:text-red-500 active:scale-75 transition-all shadow-md z-20 touch-manipulation"
                  title="Remove image"
                >
                  <Icons.X size={16} />
                </button>
              )}

              <div 
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 flex w-full h-full overflow-x-auto snap-x snap-mandatory hide-scrollbar gpu-accelerated overscroll-x-contain"
                style={{ scrollSnapType: 'x mandatory' }}
              >
                {stagedItems.map((item, i) => {
                  const isNear = Math.abs(i - activeIndex) <= 1;
                  return (
                    <div key={item.id} className="w-full h-full shrink-0 snap-center snap-always relative flex items-center justify-center bg-black/10">
                      {isNear && item.url ? (
                        <img 
                          src={item.thumbUrl || item.url} 
                          className="max-w-full max-h-full object-contain select-none pointer-events-none animate-slide-in"
                          alt="" 
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 5. Action / Save / Delete Buttons */}
      <div className="flex flex-col gap-3 mt-2">
        <button
          type="button"
          disabled={stagedItems.length === 0 || showDateSelector || isExtracting || isGoonboxExtracting}
          onClick={() => handleSave(false)}
          className={`w-full py-3.5 min-h-[44px] rounded-full font-black uppercase tracking-widest text-[10px] transition-all duration-200 active:scale-[0.98] text-[var(--surface)] shadow-md touch-manipulation ${stagedItems.length === 0 || showDateSelector || isExtracting || isGoonboxExtracting ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
          style={{ backgroundColor: state.settings.buttonColor }}
        >
          {isExtracting || isGoonboxExtracting ? 'Extracting Media...' : isEditMode ? 'Update Media' : 'Save Staged Media'}
        </button>
        
        {/* Consistent Animated Two-Step Delete Pattern */}
        {isEditMode && (
          <div className="w-full relative h-12 mt-1">
            <div 
              className={`absolute inset-0 flex gap-3 transition-all duration-300 ease-[var(--ease-spring)] will-change-transform ${isConfirmingDelete ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}`}
            >
              <button 
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 py-3 min-h-[44px] rounded-full font-black uppercase tracking-widest text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] shadow-md active:scale-95 transition-transform touch-manipulation"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleDeletePost}
                className="flex-1 py-3 min-h-[44px] rounded-full font-black uppercase tracking-widest text-[10px] bg-red-600 text-white shadow-md hover:bg-red-500 active:scale-95 transition-all touch-manipulation"
              >
                Delete
              </button>
            </div>

            <button 
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className={`absolute inset-0 w-full py-3 min-h-[44px] rounded-full font-black uppercase tracking-widest text-[10px] transition-all active:scale-[0.98] text-[var(--surface)] shadow-md touch-manipulation ${isConfirmingDelete ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100 scale-100'}`}
              style={{ backgroundColor: state.settings.buttonColor }}
            >
              Delete Media
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

