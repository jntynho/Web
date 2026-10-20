
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { InputBar } from '../components/InputBar';
import { formatName } from '../utils/format';
import { getThumbnailUrl, compressImage } from '../utils/image';
import { CoomerPost } from '../types';
import { invalidateCoomerCache } from './CoomerDetail';

export const AddEditCoomer: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, addCoomer, updateCoomer, deleteCoomer, coomerDraft, setCoomerDraft, isHydrated, addNotification } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const isSaving = useRef(false);
  const isSaveLocked = useRef(false);
  const extractControllerRef = useRef<AbortController | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { accentColor } = state.settings;

  const existingCoomer = id ? state.coomers.find(c => c.id === id) : null;

  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [originalImageUrl, setOriginalImageUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [secondarySourceUrl, setSecondarySourceUrl] = useState('');
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [imagePositionX, setImagePositionX] = useState<number>(50);
  const [imagePositionY, setImagePositionY] = useState<number>(50);
  const [isExtractingProfile, setIsExtractingProfile] = useState(false);
  const [isExtractingSecondary, setIsExtractingSecondary] = useState(false);
  const [isCapturingAll, setIsCapturingAll] = useState(false);
  const [captureProgress, setCaptureProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    status: string;
  } | null>(null);
  const [capturedPosts, setCapturedPosts] = useState<CoomerPost[] | null>(() => {
    return existingCoomer?.posts || (coomerDraft as any)?.posts || null;
  });
  const captureAbortCtrlRef = useRef<AbortController | null>(null);

  // Clean up any ongoing fetch on unmount to prevent memory leaks and state updates on unmounted component
  useEffect(() => {
    return () => {
      if (extractControllerRef.current) {
        extractControllerRef.current.abort();
        extractControllerRef.current = null;
      }
      if (captureAbortCtrlRef.current) {
        captureAbortCtrlRef.current.abort();
        captureAbortCtrlRef.current = null;
      }
    };
  }, []);

  const handleExtractProfile = useCallback(async (urlToExtract?: string, isSecondary: boolean = false) => {
    const targetUrl = (urlToExtract || (isSecondary ? secondarySourceUrl : sourceUrl)).trim();
    if (!targetUrl) return;

    // Abort previous in-flight request to prevent race conditions
    if (extractControllerRef.current) {
      extractControllerRef.current.abort();
    }
    const controller = new AbortController();
    extractControllerRef.current = controller;

    if (isSecondary) {
      setIsExtractingSecondary(true);
    } else {
      setIsExtractingProfile(true);
    }

    try {
      const res = await fetch('/api/extract/coomer-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
        signal: controller.signal
      });

      if (controller.signal.aborted) return;

      const data = await res.json();
      if (controller.signal.aborted) return;

      if (data.success) {
        // Only override Name/Image if not already set, or if extracting primary source
        if (!name || !isSecondary) {
          if (data.name) {
            setName(data.name);
          } else if (data.displayName) {
            setName(data.displayName);
          }
        }

        // Set Coomer Image URL if missing or if extracting primary source
        if ((!originalImageUrl && !imageUrl) || !isSecondary) {
          if (data.avatarUrl) {
            setImageUrl(data.avatarUrl);
            setOriginalImageUrl(data.avatarUrl);
            setImageZoom(1);
            setImagePositionX(50);
            setImagePositionY(50);
          }
        }

        if (data.service && data.serviceId) {
          const canonicalUrl = `https://cum.st/creators/${data.service}/${data.serviceId}`;
          if (isSecondary && !secondarySourceUrl) {
            setSecondarySourceUrl(canonicalUrl);
          } else if (!isSecondary && !sourceUrl) {
            setSourceUrl(canonicalUrl);
          }
        }

        addNotification(`Extracted: ${data.name || data.displayName || 'Success'}`, 'success');
        if (navigator.vibrate) navigator.vibrate(50);
      } else {
        addNotification(data.error || 'Failed to extract creator profile', 'error');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to extract coomer profile:', err);
      addNotification(`Extraction error: ${err.message || 'Connection failed'}`, 'error');
    } finally {
      if (extractControllerRef.current === controller) {
        if (isSecondary) {
          setIsExtractingSecondary(false);
        } else {
          setIsExtractingProfile(false);
        }
      }
    }
  }, [sourceUrl, secondarySourceUrl, name, originalImageUrl, imageUrl, addNotification]);

  const handleSourceUrlPaste = useCallback((val: string) => {
    const trimmed = val.trim();
    setSourceUrl(trimmed);
    if (trimmed) {
      handleExtractProfile(trimmed, false);
    }
  }, [handleExtractProfile]);

  const handleSourceUrlChange = useCallback((val: string) => {
    setSourceUrl(val);
    const trimmed = val.trim();
    if (trimmed.startsWith('http') && (!name || !originalImageUrl)) {
      handleExtractProfile(trimmed, false);
    }
  }, [name, originalImageUrl, handleExtractProfile]);

  const handleSecondaryUrlPaste = useCallback((val: string) => {
    const trimmed = val.trim();
    setSecondarySourceUrl(trimmed);
    if (trimmed) {
      handleExtractProfile(trimmed, true);
    }
  }, [handleExtractProfile]);

  const handleSecondaryUrlChange = useCallback((val: string) => {
    setSecondarySourceUrl(val);
    const trimmed = val.trim();
    if (trimmed.startsWith('http') && (!name || !originalImageUrl)) {
      handleExtractProfile(trimmed, true);
    }
  }, [name, originalImageUrl, handleExtractProfile]);

  const formatAndMergeCoomerPosts = useCallback((
    groupedPosts: any[], 
    existing: CoomerPost[] = []
  ): CoomerPost[] => {
    const existingPostIds = new Set(existing.map(p => String(p.id)));
    const existingUrls = new Set(existing.flatMap(p => p.urls));
    const merged: CoomerPost[] = [...existing];

    for (const gp of groupedPosts) {
      if (!gp || !gp.urls || gp.urls.length === 0) continue;
      const pid = gp.postId ? String(gp.postId) : Math.random().toString(36).substr(2, 9);
      
      if (existingPostIds.has(pid)) {
        continue;
      }

      const freshUrls: string[] = [];
      const freshThumbs: string[] = [];
      const freshMediaTypes: ('image' | 'video')[] = [];
      const freshDurations: (number | undefined)[] = [];

      (gp.urls || []).forEach((u: string, uIdx: number) => {
        if (!existingUrls.has(u)) {
          freshUrls.push(u);
          freshThumbs.push(gp.thumbUrls?.[uIdx] || getThumbnailUrl(u));
          freshMediaTypes.push(gp.mediaTypes?.[uIdx] || (/\.(mp4|webm|mov)($|\?)/i.test(u) ? 'video' : 'image'));
          freshDurations.push(gp.videoDurations?.[uIdx]);
          existingUrls.add(u);
        }
      });

      if (freshUrls.length === 0) continue;
      existingPostIds.add(pid);

      const postTime = typeof gp.date === 'number' && !isNaN(gp.date) ? gp.date : Date.now();
      merged.push({
        id: pid,
        urls: freshUrls,
        thumbUrls: freshThumbs,
        caption: gp.caption || '',
        mediaTypes: freshMediaTypes,
        videoDurations: freshDurations,
        perImageDates: freshUrls.map(() => postTime),
        date: postTime,
        type: freshUrls.length > 1 ? 'Multiple' : 'Single',
        sourceService: gp.service,
        createdAt: postTime
      });
    }

    // Sort all merged posts descending by publication date (newest first)
    return merged.sort((a, b) => (b.date || b.createdAt || 0) - (a.date || a.createdAt || 0));
  }, []);

  const handleCaptureAllMedia = useCallback(async (specificTargetUrl?: string) => {
    const primaryUrl = sourceUrl.trim();
    const secondaryUrl = secondarySourceUrl.trim();
    const urlsToCapture: { url: string; label: string }[] = [];

    if (specificTargetUrl && typeof specificTargetUrl === 'string') {
      const trimmedSpecific = specificTargetUrl.trim();
      if (trimmedSpecific) {
        urlsToCapture.push({ 
          url: trimmedSpecific, 
          label: trimmedSpecific === secondaryUrl ? 'Source 2' : 'Source 1' 
        });
      }
    } else {
      if (primaryUrl) urlsToCapture.push({ url: primaryUrl, label: 'Source 1' });
      if (secondaryUrl) urlsToCapture.push({ url: secondaryUrl, label: 'Source 2' });
    }

    if (urlsToCapture.length === 0) {
      addNotification('Please enter at least one valid Source URL', 'warning');
      return;
    }

    // Toggle cancel if already capturing
    if (isCapturingAll) {
      if (captureAbortCtrlRef.current) {
        captureAbortCtrlRef.current.abort();
        captureAbortCtrlRef.current = null;
      }
      setIsCapturingAll(false);
      setCaptureProgress(prev => prev ? { ...prev, status: 'Cancelled' } : null);
      setTimeout(() => setCaptureProgress(null), 1500);
      addNotification('Capture cancelled', 'info');
      return;
    }

    const controller = new AbortController();
    captureAbortCtrlRef.current = controller;
    setIsCapturingAll(true);
    setCaptureProgress({
      current: 0,
      total: 0,
      percent: 0,
      status: 'Connecting to sources...'
    });

    // Proactively extract creator profile if name/image missing
    if (!name || !originalImageUrl) {
      handleExtractProfile(urlsToCapture[0].url, urlsToCapture[0].url === secondaryUrl);
    }

    try {
      let combinedGrouped: any[] = [];
      const MAX_BATCHES_PER_SOURCE = 300;

      for (let sIdx = 0; sIdx < urlsToCapture.length; sIdx++) {
        if (controller.signal.aborted) break;
        const currentTarget = urlsToCapture[sIdx];
        const isMulti = urlsToCapture.length > 1;

        let offset = 0;
        let hasMore = true;
        let totalReported = 0;
        let batchIndex = 0;

        while (hasMore && batchIndex < MAX_BATCHES_PER_SOURCE) {
          if (controller.signal.aborted) break;

          const prefix = isMulti ? `[${sIdx + 1}/${urlsToCapture.length}] ` : '';
          const knownSourceTotal = totalReported;
          const currentPct = knownSourceTotal > 0
            ? Math.min(99, Math.round(((sIdx * 100) + ((offset / knownSourceTotal) * 100)) / urlsToCapture.length))
            : Math.min(95, (sIdx * 50) + (batchIndex + 1) * 5);

          setCaptureProgress({
            current: combinedGrouped.length,
            total: knownSourceTotal,
            percent: currentPct,
            status: `${prefix}Capturing (${combinedGrouped.length} posts captured)...`
          });

          const res = await fetch('/api/extract/coomer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: currentTarget.url,
              offset,
              fetchAll: false
            }),
            signal: controller.signal
          });

          if (controller.signal.aborted) break;
          if (!res.ok) {
            throw new Error(`Server returned HTTP ${res.status} for ${currentTarget.label}`);
          }

          const data = await res.json();
          if (controller.signal.aborted) break;

          if (!data.success) {
            throw new Error(data.error || `Failed to fetch from ${currentTarget.label}`);
          }

          if (data.isSinglePost) {
            const singlePosts = data.groupedPosts || [];
            combinedGrouped.push(...singlePosts);
            break;
          }

          const batchGrouped: any[] = data.groupedPosts || [];
          const rawCount = typeof data.rawCount === 'number' ? data.rawCount : batchGrouped.length;
          if (typeof data.total === 'number' && data.total > 0) {
            totalReported = data.total;
          }

          if (batchGrouped.length > 0) {
            combinedGrouped.push(...batchGrouped);
          }

          // Stop ONLY when API explicitly reports no more posts or returned fewer than 50 raw posts
          if (
            data.hasMore === false ||
            rawCount === 0 ||
            rawCount < 50 ||
            (totalReported > 0 && offset + 50 >= totalReported)
          ) {
            hasMore = false;
          } else {
            offset += 50;
            batchIndex++;
            await new Promise(r => setTimeout(r, 60));
          }
        }
      }

      if (controller.signal.aborted) return;

      const mergedPosts = formatAndMergeCoomerPosts(
        combinedGrouped, 
        existingCoomer?.posts || capturedPosts || []
      );

      setCapturedPosts(mergedPosts);

      setCaptureProgress({
        current: mergedPosts.length,
        total: mergedPosts.length,
        percent: 100,
        status: `Done! ${mergedPosts.length} posts merged & sorted by date`
      });

      const sourceUrlsList = [primaryUrl, secondaryUrl].filter(Boolean);

      // Instantly persist if existing coomer
      if (id) {
        updateCoomer(id, {
          posts: mergedPosts,
          totalPostsCount: mergedPosts.length,
          isFullySynced: true,
          sourceUrl: primaryUrl || secondaryUrl,
          secondarySourceUrl: secondaryUrl || undefined,
          sourceUrls: sourceUrlsList
        });
      } else {
        setCoomerDraft(prev => ({
          ...(prev || {}),
          name: name || '',
          imageUrl: originalImageUrl || imageUrl || '',
          originalImageUrl: originalImageUrl || '',
          sourceUrl: primaryUrl || secondaryUrl,
          secondarySourceUrl: secondaryUrl || undefined,
          sourceUrls: sourceUrlsList,
          posts: mergedPosts,
          totalPostsCount: mergedPosts.length,
          isFullySynced: true
        } as any));
      }

      addNotification(`⚡ Captured all ${mergedPosts.length} posts merged chronologically!`, 'success');
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

      setTimeout(() => {
        setCaptureProgress(null);
      }, 2800);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to capture coomer media:', err);
      setCaptureProgress(prev => prev ? { ...prev, status: 'Capture failed' } : null);
      addNotification(err.message || 'Failed to capture all media links', 'error');
      setTimeout(() => setCaptureProgress(null), 2500);
    } finally {
      if (captureAbortCtrlRef.current === controller) {
        setIsCapturingAll(false);
        captureAbortCtrlRef.current = null;
      }
    }
  }, [sourceUrl, secondarySourceUrl, isCapturingAll, name, originalImageUrl, handleExtractProfile, formatAndMergeCoomerPosts, existingCoomer, capturedPosts, id, updateCoomer, setCoomerDraft, imageUrl, addNotification]);

  useEffect(() => {
    if (!isHydrated || initialized.current) return;

    if (coomerDraft && coomerDraft.id === (id || null)) {
      setName(coomerDraft.name || '');
      setImageUrl(coomerDraft.imageUrl || '');
      setOriginalImageUrl(coomerDraft.originalImageUrl || '');
      setSourceUrl((coomerDraft as any).sourceUrl || (coomerDraft as any).sourceUrls?.[0] || '');
      setSecondarySourceUrl((coomerDraft as any).secondarySourceUrl || (coomerDraft as any).sourceUrls?.[1] || '');
      setImageZoom(coomerDraft.imageZoom || 1);
      setImagePositionX(coomerDraft.imagePositionX ?? 50);
      setImagePositionY(coomerDraft.imagePositionY ?? 50);
      initialized.current = true;
    } else if (existingCoomer) {
      setName(existingCoomer.name || '');
      setImageUrl(existingCoomer.imageUrl || '');
      setOriginalImageUrl(existingCoomer.originalImageUrl || existingCoomer.imageUrl || '');
      setSourceUrl(existingCoomer.sourceUrl || existingCoomer.sourceUrls?.[0] || '');
      setSecondarySourceUrl(existingCoomer.secondarySourceUrl || existingCoomer.sourceUrls?.[1] || '');
      setImageZoom(existingCoomer.imageZoom || 1);
      setImagePositionX(existingCoomer.imagePositionX ?? 50);
      setImagePositionY(existingCoomer.imagePositionY ?? 50);
      initialized.current = true;
    } else if (!id) {
      setName('');
      setImageUrl('');
      setOriginalImageUrl('');
      setSourceUrl('');
      setSecondarySourceUrl('');
      setImageZoom(1);
      setImagePositionX(50);
      setImagePositionY(50);
      initialized.current = true;
    }
  }, [id, existingCoomer, coomerDraft, isHydrated]);

  useEffect(() => {
    return () => {
      if (!isSaving.current) {
        setCoomerDraft(null);
      }
    };
  }, [setCoomerDraft]);

  // Save draft globally when user is making changes
  useEffect(() => {
    if (initialized.current && !id && !isSaving.current) {
      setCoomerDraft(prev => ({
        ...(prev || {}),
        name,
        imageUrl,
        originalImageUrl,
        sourceUrl,
        secondarySourceUrl,
        sourceUrls: [sourceUrl, secondarySourceUrl].filter(Boolean),
        imageZoom,
        imagePositionX,
        imagePositionY,
      } as any));
    }
  }, [name, imageUrl, originalImageUrl, sourceUrl, secondarySourceUrl, imageZoom, imagePositionX, imagePositionY, id, setCoomerDraft]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file, 400, 0.75);
        setOriginalImageUrl(compressed);
        setImageUrl(compressed);
        setImageZoom(1);
        setImagePositionX(50);
        setImagePositionY(50);
      } catch (err) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          setOriginalImageUrl(result);
          setImageUrl(result);
          setImageZoom(1);
          setImagePositionX(50);
          setImagePositionY(50);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const handleSave = useCallback(() => {
    if (isSaveLocked.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const isDuplicate = state.coomers.some(c => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== id);
    if (isDuplicate) {
      addNotification(`Coomer "${trimmedName}" already exists!`, 'error');
      return;
    }
    
    isSaveLocked.current = true;
    isSaving.current = true;
    const primaryUrl = sourceUrl.trim();
    const secondaryUrl = secondarySourceUrl.trim();
    const urlsList = [primaryUrl, secondaryUrl].filter(Boolean);

    const data: any = { 
      name: trimmedName, 
      imageUrl: originalImageUrl || imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedName)}`,
      originalImageUrl: originalImageUrl || imageUrl,
      sourceUrl: primaryUrl || secondaryUrl || undefined,
      secondarySourceUrl: secondaryUrl || undefined,
      sourceUrls: urlsList,
      posts: capturedPosts || existingCoomer?.posts || undefined,
      totalPostsCount: capturedPosts ? capturedPosts.length : (existingCoomer?.totalPostsCount || undefined),
      isFullySynced: capturedPosts ? true : (existingCoomer?.isFullySynced || undefined),
      imageZoom,
      imagePositionX,
      imagePositionY,
    };
    
    let targetId = id;
    if (id) {
      updateCoomer(id, data);
      invalidateCoomerCache(id);
    } else {
      targetId = addCoomer(data);
    }
    
    setCoomerDraft(null);
    const stateFrom = (location.state as any)?.from;
    
    if (!id && stateFrom) {
      navigate(stateFrom, { replace: true, state: { ...((location.state as any) || {}), newlyAddedCoomerId: targetId } });
    } else {
      setTimeout(() => {
        const fromPath = (location.state as any)?.from || '/manage-coomers';
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      }, 0);
    }
  }, [name, imageUrl, originalImageUrl, sourceUrl, secondarySourceUrl, capturedPosts, existingCoomer, id, addCoomer, updateCoomer, navigate, setCoomerDraft, location.state, state.coomers, addNotification, imageZoom, imagePositionX, imagePositionY]);

  const handlePermanentDelete = useCallback(() => {
    if (!id || isSaveLocked.current) return;
    isSaveLocked.current = true;
    deleteCoomer(id);
    invalidateCoomerCache(id);
    setCoomerDraft(null);
    const stateObj = (location.state as any) || {};
    let target = stateObj.from;
    let targetState = stateObj.returnState;

    if (target && (target === `/coomer/${id}` || target.startsWith(`/coomer/${id}?`) || target.startsWith('/manage-coomers/edit/'))) {
      target = targetState?.from || '/';
      targetState = targetState?.returnState;
    }

    const finalPath = target || '/manage-coomers';
    navigate(finalPath, { replace: true, state: targetState });
  }, [id, deleteCoomer, setCoomerDraft, location.state, navigate]);

  useEffect(() => {
    const onSaveTrigger = () => handleSave();
    window.addEventListener('vault-save-trigger', onSaveTrigger);
    return () => window.removeEventListener('vault-save-trigger', onSaveTrigger);
  }, [handleSave]);

  if (!isHydrated) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-6 px-4 pt-4 pb-4 w-full relative animate-pulse">
        <div className="flex flex-col gap-y-4">
          <div className="h-14 bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full w-full px-6 flex flex-col justify-center gap-1">
             <div className="h-2.5 w-16 bg-[var(--border)] rounded-full opacity-50" />
             <div className="h-4 w-1/3 bg-[var(--border)] rounded-full opacity-25" />
          </div>
          <div className="h-14 bg-[var(--surface)] border border-[var(--border)] opacity-30 rounded-full w-full px-6 flex flex-col justify-center gap-1">
             <div className="h-2.5 w-24 bg-[var(--border)] rounded-full opacity-50" />
             <div className="h-4 w-1/2 bg-[var(--border)] rounded-full opacity-25" />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-6 relative">
          <div className="w-32 h-32 rounded-full border-[4px] border-[var(--border)] bg-[var(--border)] opacity-10" />
          <div className="h-2 w-12 bg-[var(--border)] rounded-full opacity-50 mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 px-4 pt-4 pb-4 w-full relative animate-fade-in-fast">
      <div className="flex flex-col gap-y-4">
        <InputBar 
          label="Coomer Name"
          value={name} 
          onChange={(val) => setName(formatName(val))} 
          placeholder="Coomer Name..." 
          showPaste
        />
        <InputBar 
          label="Coomer Image URL"
          value={originalImageUrl} 
          onChange={(val) => {
            setOriginalImageUrl(val);
            setImageUrl(val);
          }} 
          placeholder="Image URL..." 
          showPaste
          rightElement={
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              className="w-11 h-11 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--accent)] transition-all active:scale-75 touch-manipulation"
              title="Upload image"
            >
              <Icons.Plus />
            </button>
          }
        />
        <div className="flex flex-col gap-2 w-full">
          {/* Source 1 (Primary) */}
          <div className="flex items-center gap-2.5 w-full">
            <div className="flex-1 min-w-0">
              <InputBar 
                label="Source 1"
                value={sourceUrl} 
                onChange={handleSourceUrlChange}
                onPasteCapture={handleSourceUrlPaste}
                placeholder="Source 1 URL (e.g. Fansly, OnlyFans)..." 
                showPaste
                isLoading={isExtractingProfile}
                rightElement={
                  <button 
                    type="button" 
                    disabled={isExtractingProfile || isCapturingAll || !sourceUrl.trim()}
                    onClick={() => handleExtractProfile(sourceUrl, false)}
                    className={`w-11 h-11 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--accent)] transition-all active:scale-75 touch-manipulation ${isExtractingProfile || isCapturingAll || !sourceUrl.trim() ? 'opacity-40 cursor-not-allowed' : ''}`}
                    title="Extract profile details from Source 1"
                  >
                    <Icons.RotateCcw className={isExtractingProfile ? "animate-spin" : ""} />
                  </button>
                }
              />
            </div>

            {/* Source 1 Extractor Button */}
            <button 
              type="button" 
              onClick={() => handleCaptureAllMedia()}
              disabled={!sourceUrl.trim() && !secondarySourceUrl.trim()}
              title={isCapturingAll ? "Click to cancel capture" : "Capture all media from sources"}
              className={`w-[48px] h-[48px] sm:w-[52px] sm:h-[52px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none touch-manipulation ${
                isCapturingAll ? 'animate-pulse ring-2 ring-[var(--accent)]' : ''
              } ${!sourceUrl.trim() && !secondarySourceUrl.trim() ? 'opacity-40 cursor-not-allowed' : ''}`}
              style={{ backgroundColor: state.settings.buttonColor }}
            >
              {isCapturingAll ? (
                <Icons.Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
              ) : (
                <Icons.Viper className="w-5 h-5 sm:w-6 sm:h-6" />
              )}
            </button>
          </div>

          {/* Source 2 (Secondary) */}
          <div className="flex items-center gap-2.5 w-full">
            <div className="flex-1 min-w-0">
              <InputBar 
                label="Source 2"
                value={secondarySourceUrl} 
                onChange={handleSecondaryUrlChange}
                onPasteCapture={handleSecondaryUrlPaste}
                placeholder="Source 2 URL (e.g. OnlyFans, Fansly)..." 
                showPaste
                isLoading={isExtractingSecondary}
                rightElement={
                  <button 
                    type="button" 
                    disabled={isExtractingSecondary || isCapturingAll || !secondarySourceUrl.trim()}
                    onClick={() => handleExtractProfile(secondarySourceUrl, true)}
                    className={`w-11 h-11 min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--accent)] transition-all active:scale-75 touch-manipulation ${isExtractingSecondary || isCapturingAll || !secondarySourceUrl.trim() ? 'opacity-40 cursor-not-allowed' : ''}`}
                    title="Extract details from Source 2"
                  >
                    <Icons.RotateCcw className={isExtractingSecondary ? "animate-spin" : ""} />
                  </button>
                }
              />
            </div>

            {/* Source 2 Extractor Button */}
            <button 
              type="button" 
              onClick={() => handleCaptureAllMedia()}
              disabled={!sourceUrl.trim() && !secondarySourceUrl.trim()}
              title={isCapturingAll ? "Click to cancel capture" : "Capture all media from sources"}
              className={`w-[48px] h-[48px] sm:w-[52px] sm:h-[52px] rounded-full shrink-0 flex items-center justify-center shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--surface)] tap-highlight-none touch-manipulation ${
                isCapturingAll ? 'animate-pulse ring-2 ring-[var(--accent)]' : ''
              } ${!sourceUrl.trim() && !secondarySourceUrl.trim() ? 'opacity-40 cursor-not-allowed' : ''}`}
              style={{ backgroundColor: state.settings.buttonColor }}
            >
              {isCapturingAll ? (
                <Icons.Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
              ) : (
                <Icons.Viper className="w-5 h-5 sm:w-6 sm:h-6" />
              )}
            </button>
          </div>

          {/* Progress Bar under Source URLs with 100% Progress Indicator */}
          {captureProgress && (
            <div className="w-full flex flex-col gap-1 px-3 py-1 animate-fade-in-fast">
              <div className="flex items-center justify-between text-[10px] font-semibold">
                <span className="text-[var(--text-muted)] tracking-wider uppercase text-[9px] truncate max-w-[70%]">
                  {captureProgress.status}
                </span>
                <span className="text-[var(--accent)] tabular-nums font-mono text-[11px] font-bold shrink-0">
                  {captureProgress.percent}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-full overflow-hidden relative shadow-inner">
                <div 
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{ 
                    width: `${Math.min(100, Math.max(0, captureProgress.percent))}%`,
                    backgroundColor: state.settings.accentColor || 'var(--accent)'
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
      </div>

      <div className="flex flex-col items-center justify-center py-6 relative">
        <div 
          className="w-32 h-32 rounded-full border-[4px] overflow-hidden bg-neutral-800 shadow-2xl relative ring-4 ring-black/20"
          style={{ borderColor: state.settings.circleBorderColor }}
        >
          {originalImageUrl || imageUrl ? (
            <img 
              src={originalImageUrl || imageUrl} 
              className="w-full h-full object-cover pointer-events-none select-none"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()} 
              style={{
                objectPosition: `${imagePositionX}% ${imagePositionY}%`,
                transform: `scale(${imageZoom})`,
                transformOrigin: `${imagePositionX}% ${imagePositionY}%`
              }}
              alt={name}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
               <Icons.User />
            </div>
          )}
        </div>
        
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mt-4">Preview</span>

        {/* 3 Coordinate Sliders: X, Y, Zoom (Compact Inline) */}
        <div className="w-full mt-3 flex flex-col gap-2 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Coordinates
            </span>
            {(imagePositionX !== 50 || imagePositionY !== 50 || imageZoom !== 1) && (
              <button
                type="button"
                onClick={() => {
                  setImagePositionX(50);
                  setImagePositionY(50);
                  setImageZoom(1);
                }}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] hover:underline active:scale-95 transition-all touch-manipulation"
                title="Reset coordinates"
              >
                <Icons.RotateCcw size={11} />
                Reset
              </button>
            )}
          </div>

          {/* Slider X */}
          <div className="flex items-center gap-2.5 w-full">
            <svg className="w-5 h-5 shrink-0 select-none" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="10" fill="var(--accent)" fillOpacity="0.15" />
              <path
                d="M 6.5 6.5 L 13.5 13.5 M 13.5 6.5 L 6.5 13.5"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={imagePositionX}
              onChange={(e) => setImagePositionX(parseFloat(e.target.value))}
              className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer outline-none bg-[var(--border)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-md"
            />
            <span className="w-12 h-5.5 rounded-full bg-[var(--accent)]/15 flex items-center justify-center text-[10.5px] font-mono font-bold text-[var(--accent)] shrink-0 select-none">
              {Math.round(imagePositionX)}%
            </span>
          </div>

          {/* Slider Y */}
          <div className="flex items-center gap-2.5 w-full">
            <svg className="w-5 h-5 shrink-0 select-none" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="10" fill="var(--accent)" fillOpacity="0.15" />
              <path
                d="M 6.5 6.2 L 10 9.8 L 13.5 6.2 M 10 9.8 L 10 13.8"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={imagePositionY}
              onChange={(e) => setImagePositionY(parseFloat(e.target.value))}
              className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer outline-none bg-[var(--border)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-md"
            />
            <span className="w-12 h-5.5 rounded-full bg-[var(--accent)]/15 flex items-center justify-center text-[10.5px] font-mono font-bold text-[var(--accent)] shrink-0 select-none">
              {Math.round(imagePositionY)}%
            </span>
          </div>

          {/* Slider Zoom */}
          <div className="flex items-center gap-2.5 w-full">
            <svg className="w-5 h-5 shrink-0 select-none" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="10" fill="var(--accent)" fillOpacity="0.15" />
              <path
                d="M 6.5 6.5 H 13.5 L 6.5 13.5 H 13.5"
                stroke="var(--accent)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              type="range"
              min={1}
              max={4}
              step={0.05}
              value={imageZoom}
              onChange={(e) => setImageZoom(parseFloat(e.target.value))}
              className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer outline-none bg-[var(--border)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-md"
            />
            <span className="w-12 h-5.5 rounded-full bg-[var(--accent)]/15 flex items-center justify-center text-[10.5px] font-mono font-bold text-[var(--accent)] shrink-0 select-none">
              {imageZoom.toFixed(2)}x
            </span>
          </div>
        </div>
        
        {id && (
          <div className="w-full mt-8 relative h-12">
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
                onClick={handlePermanentDelete}
                className="flex-1 py-3 min-h-[44px] rounded-full font-black uppercase tracking-widest text-[10px] text-white/80 shadow-md active:scale-95 transition-transform touch-manipulation"
                style={{ backgroundColor: `${accentColor}cc` }}
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
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

