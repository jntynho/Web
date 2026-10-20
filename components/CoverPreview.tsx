import React, { useState, useRef, useEffect } from 'react';
import { Icons } from '../constants';
import { DateSelector } from '../components/DateSelector';
import { useApp } from '../AppContext';
import { useImageFallback } from '../hooks/useImageFallback';

export const CoverPreview = React.memo(({ url, ratio, offset, onOffsetChange, assignedDate, onDateChange, isLocked = false, onToggleLock, episodes, objectFit = 'cover', onCopy }: any) => {
  const { state } = useApp();
  const { settings } = state;
  const { src: effectiveUrl, handleError: handleImgError } = useImageFallback(url);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const [isSelectingDate, setIsSelectingDate] = useState(false);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCopy) {
      try {
        const result = await onCopy();
        if (result !== false) {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        }
      } catch (err) {
        console.error("Copy error in CoverPreview:", err);
      }
    }
  };
  useEffect(() => {
    if (!url) {
      setFileSize(null);
      return;
    }
    const abortController = new AbortController();
    let isMounted = true;
    const fetchSize = async () => {
      try {
        const response = await fetch(`/api/file-size?url=${encodeURIComponent(url)}`, {
          signal: abortController.signal
        });
        const data = await response.json();
        if (data.size && isMounted) {
          const bytes = data.size;
          if (bytes > 1024 * 1024) {
            setFileSize((bytes / (1024 * 1024)).toFixed(1) + ' MB');
          } else {
            setFileSize((bytes / 1024).toFixed(0) + ' KB');
          }
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) setFileSize(null);
      }
    };
    fetchSize();
    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [url]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'cover-image.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cover-image.jpg';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const canDrag = !isSelectingDate && !isLocked && objectFit !== 'contain';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!canDrag) return;
      
      // Only prevent default and adjust offset if we are actually interacting with the preview
      e.preventDefault();
      const delta = e.deltaY;
      // Adjust sensitivity: divide by 15 for a smooth feel
      const newOffset = Math.max(0, Math.min(100, offsetRef.current + (delta / 15)));
      onOffsetChange(newOffset);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [canDrag, onOffsetChange]);

  const handleStart = (y: number) => {
    if (!canDrag) return;
    isDragging.current = true;
    startY.current = y;
    startOffset.current = offset;
  };

  const handleMove = (y: number) => {
    if (!isDragging.current || !containerRef.current || !canDrag) return;
    const deltaY = y - startY.current;
    const newOffset = Math.max(0, Math.min(100, startOffset.current - (deltaY / 2)));
    onOffsetChange(newOffset);
  };

  const handleEnd = () => {
    isDragging.current = false;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full h-[48px]">
        <div
          className={`absolute inset-y-0 left-0 right-0 flex items-center transition-all duration-100 ease-out ${isSelectingDate ? 'opacity-100 pointer-events-auto scale-100 translate-y-0' : 'opacity-0 pointer-events-none scale-98 translate-y-1'}`}
        >
          <DateSelector 
            value={assignedDate}
            onSave={(date) => {
              onDateChange(date);
              setIsSelectingDate(false);
            }}
            onCancel={() => setIsSelectingDate(false)}
            className="w-full"
          />
        </div>
        <div
          className={`absolute inset-y-0 left-0 right-0 flex items-center justify-between transition-all duration-100 ease-out ${!isSelectingDate ? 'opacity-100 pointer-events-auto scale-100 translate-y-0' : 'opacity-0 pointer-events-none scale-98 -translate-y-1'}`}
        >
          <div className="flex items-center gap-3">
            <label className="text-[9px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)]">Cover Preview</label>
            <div className="px-3 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded-full flex items-center justify-center min-w-[50px] min-h-[20px] shadow-sm">
              {fileSize ? (
                <span className="text-[9.5px] font-bold text-[var(--text-primary)] opacity-80 font-mono tracking-wider">{fileSize}</span>
              ) : (
                <div className="w-8 h-1.5 bg-[var(--text-muted)]/30 rounded-full animate-pulse" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onCopy && (
              <button 
                type="button" 
                onClick={handleCopyClick}
                className={`w-8 h-8 flex items-center justify-center transition-transform active:scale-75 ${isCopied ? 'text-green-400' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'}`}
                title={isCopied ? "Copied!" : "Copy info (Title, Actor, Date, Viper URL)"}
              >
                {isCopied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}
              </button>
            )}
            <button 
              type="button" 
              onClick={handleDownload}
              className={`w-8 h-8 flex items-center justify-center transition-transform active:scale-75 ${!url ? 'text-[var(--text-muted)] opacity-50' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'}`}
              title="Download image"
              disabled={!url}
            >
              <Icons.Download size={16} />
            </button>
            {onToggleLock && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
                className={`w-8 h-8 flex items-center justify-center transition-transform active:scale-75 ${isLocked ? 'text-[var(--text-muted)]' : 'text-[var(--accent)]'}`}
                title={isLocked ? "Unlock to adjust" : "Lock to scroll"}
              >
                {isLocked ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M17 11V7a5 5 0 0 0-10 0"/></svg>
                )}
              </button>
            )}
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsSelectingDate(true); }}
              className="w-8 h-8 flex items-center justify-center text-[var(--text-muted)] active:scale-75 transition-transform"
              title="Assign Date"
            >
              <Icons.Calendar size={16} />
            </button>
          </div>
        </div>
      </div>
      <div 
        ref={containerRef}
        onMouseDown={(e: any) => !isLocked && handleStart(e.clientY)}
        onMouseMove={(e: any) => !isLocked && handleMove(e.clientY)}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={(e: any) => !isLocked && handleStart(e.touches[0].clientY)}
        onTouchMove={(e: any) => !isLocked && handleMove(e.touches[0].clientY)}
        onTouchEnd={handleEnd}
        className={`relative w-full overflow-hidden bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border),0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,0,0,0.05)] rounded-[24px] ${canDrag ? 'cursor-ns-resize touch-none' : ''}`}
        style={{
          aspectRatio: ratio === '5:7' ? '5/7' : ratio === '3:2' ? '800/538' : '16/9',
          transition: 'aspect-ratio 0.45s cubic-bezier(0.25, 1, 0.5, 1)'
        }}
      >
        {effectiveUrl ? (
          <>
            {ratio === 'Adaptive' && (
              <img 
                src={effectiveUrl}
                alt="Background Blur"
                referrerPolicy="no-referrer"
                onError={handleImgError}
                className="absolute inset-0 w-full h-full object-cover opacity-50"
                style={{ 
                  objectPosition: `center ${offset}%`,
                  pointerEvents: 'none',
                  filter: 'blur(20px)'
                }}
              />
            )}
            <img 
              src={effectiveUrl}
              alt="Cover Preview"
              referrerPolicy="no-referrer"
              onError={handleImgError}
              className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${ratio === 'Adaptive' ? 'object-contain' : (objectFit === 'contain' ? 'object-contain' : 'object-cover')}`}
              style={{ 
                objectPosition: `center ${offset}%`,
                pointerEvents: 'none',
                filter: settings.blurCovers ? `blur(${settings.blurIntensity}px)` : 'none'
              }}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <span className="text-[10px] font-black uppercase tracking-[0.3em]">No Image Provided</span>
          </div>
        )}

        {(assignedDate || (episodes && episodes.length > 0)) && !isSelectingDate && (
          <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full flex items-center gap-3 animate-slide-in z-20 pointer-events-none">
            {assignedDate && (
              <div className="flex items-center gap-1.5">
                <Icons.Calendar size={12} className="text-blue-400" />
                <span className="text-[10px] font-black text-white/90">
                  {new Date(assignedDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </div>
            )}
            {episodes && episodes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Icons.Play size={12} className="text-green-400" />
                <span className="text-[10px] font-black text-white/90">
                  {episodes.length} Episodes
                </span>
              </div>
            )}
          </div>
        )}

        {canDrag && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none opacity-40 z-20">
             <div className="w-8 h-1 bg-white/30 rounded-full" />
          </div>
        )}
        <div className="absolute inset-0 rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] pointer-events-none z-30" />
      </div>
    </div>
  );
});
