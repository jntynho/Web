
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { InputBar } from '../components/InputBar';
import { formatName } from '../utils/format';
import { fetchAndCacheActorImages, cacheActorImages } from '../utils/actorImagesCache';
import { useImageFallback } from '../hooks/useImageFallback';

const ActorGalleryThumb = React.memo(({ 
  img, 
  isSelected, 
  onClick, 
  isLoaded, 
  onLoad 
}: { 
  img: string; 
  isSelected: boolean; 
  onClick: () => void; 
  isLoaded: boolean; 
  onLoad: () => void; 
}) => {
  const { src, handleError } = useImageFallback(img);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-shrink-0 w-20 h-20 rounded-full overflow-hidden transition-all ${
        isSelected
          ? "ring-2 ring-[var(--accent)] scale-105"
          : "opacity-70 hover:opacity-100 ring-1 ring-[var(--border)]"
      } ${!isLoaded ? "bg-[var(--surface)] border border-[var(--border)] animate-pulse" : ""}`}
    >
      <img
        src={src}
        alt="Gallery"
        className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`}
        referrerPolicy="no-referrer"
        onError={handleError}
        onLoad={onLoad}
      />
    </button>
  );
});

export const AddEditActor: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, addActor, updateActor, deleteActor, mergeActors, actorDraft, setActorDraft, isHydrated, addNotification } = useApp();
  const initialized = useRef(false);
  const isSaving = useRef(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [loadedAvailableImages, setLoadedAvailableImages] = useState<Record<string, boolean>>({});

  const searchParams = new URLSearchParams(location.search);
  const from = searchParams.get('from');
  const existingActor = id ? state.actors.find(a => a.id === id) : null;

  const [name, setName] = useState('');
  const [stashDbId, setStashDbId] = useState<string | undefined>(undefined);
  const [imageUrl, setImageUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState<string | undefined>(undefined);
  const [twitterUrl, setTwitterUrl] = useState<string | undefined>(undefined);
  const [onlyFansUrl, setOnlyFansUrl] = useState<string | undefined>(undefined);
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [isFetchingImages, setIsFetchingImages] = useState(false);
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [imagePositionX, setImagePositionX] = useState<number>(50);
  const [imagePositionY, setImagePositionY] = useState<number>(50);
  const { 
    src: effectiveImageUrl, 
    hasError: isEffectiveImageError, 
    handleError: handleEffectiveImageError 
  } = useImageFallback(imageUrl);

  // Load available images on-demand from local cache or StashDB
  const loadImagesOnDemand = useCallback(async (targetActor: { stashDbId?: string; name: string; imageUrl?: string; availableImages?: string[] }) => {
    if (!targetActor.name && !targetActor.stashDbId && !targetActor.imageUrl) return;
    setIsFetchingImages(true);
    try {
      const result = await fetchAndCacheActorImages(
        targetActor,
        state.settings.stashDbApiKey
      );
      if (result.images && result.images.length > 0) {
        setAvailableImages(result.images);
      }
      if (result.stashDbId && !stashDbId) {
        setStashDbId(result.stashDbId);
      }
      if (result.socials) {
        if (result.socials.instagramUrl && !instagramUrl) setInstagramUrl(result.socials.instagramUrl);
        if (result.socials.twitterUrl && !twitterUrl) setTwitterUrl(result.socials.twitterUrl);
        if (result.socials.onlyFansUrl && !onlyFansUrl) setOnlyFansUrl(result.socials.onlyFansUrl);
      }
    } catch (e) {
      console.warn('[AddEditActor] Failed to load images on demand:', e);
    } finally {
      setIsFetchingImages(false);
    }
  }, [state.settings.stashDbApiKey, stashDbId, instagramUrl, twitterUrl, onlyFansUrl]);

  useEffect(() => {
    if (!isHydrated || initialized.current) return;

    if (actorDraft && actorDraft.id === (id || null)) {
      setName(actorDraft.name || '');
      setImageUrl(actorDraft.imageUrl || '');
      setInstagramUrl(actorDraft.instagramUrl);
      setTwitterUrl(actorDraft.twitterUrl);
      setOnlyFansUrl(actorDraft.onlyFansUrl);
      setAvailableImages(Array.from(new Set(actorDraft.availableImages || [])));
      setImageZoom(actorDraft.imageZoom || 1);
      setImagePositionX(actorDraft.imagePositionX ?? 50);
      setImagePositionY(actorDraft.imagePositionY ?? 50);
      initialized.current = true;
      if (actorDraft.name || actorDraft.imageUrl) {
        loadImagesOnDemand({ name: actorDraft.name, imageUrl: actorDraft.imageUrl, availableImages: actorDraft.availableImages });
      }
    } else if (existingActor) {
      setName(existingActor.name || '');
      setStashDbId(existingActor.stashDbId);
      setImageUrl(existingActor.imageUrl || '');
      setInstagramUrl(existingActor.instagramUrl);
      setTwitterUrl(existingActor.twitterUrl);
      setOnlyFansUrl(existingActor.onlyFansUrl);
      setAvailableImages(Array.from(new Set(existingActor.availableImages || [])));
      setImageZoom(existingActor.imageZoom || 1);
      setImagePositionX(existingActor.imagePositionX ?? 50);
      setImagePositionY(existingActor.imagePositionY ?? 50);
      initialized.current = true;
      // Fetch and populate available images on-demand from local cache or StashDB
      loadImagesOnDemand({
        stashDbId: existingActor.stashDbId,
        name: existingActor.name,
        imageUrl: existingActor.imageUrl,
        availableImages: existingActor.availableImages
      });
    } else if (!id) {
      setName('');
      setImageUrl('');
      setInstagramUrl(undefined);
      setTwitterUrl(undefined);
      setOnlyFansUrl(undefined);
      setAvailableImages([]);
      setImageZoom(1);
      setImagePositionX(50);
      setImagePositionY(50);
      initialized.current = true;
    }
  }, [id, existingActor, actorDraft, isHydrated, loadImagesOnDemand]);

  // Cleanup draft on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (!isSaving.current) {
        setActorDraft(null);
      }
    };
  }, [setActorDraft]);

  // Save draft globally when user is making changes
  useEffect(() => {
    if (initialized.current && !id && !isSaving.current) {
      setActorDraft({
        name,
        imageUrl,
        instagramUrl,
        twitterUrl,
        onlyFansUrl,
        availableImages,
        imageZoom,
        imagePositionX,
        imagePositionY,
      });
    }
  }, [name, imageUrl, instagramUrl, twitterUrl, onlyFansUrl, availableImages, imageZoom, imagePositionX, imagePositionY, id, setActorDraft]);

  const handleManualFetchImages = async () => {
    const trimmedName = name.trim();
    if (!trimmedName && !stashDbId) {
      addNotification("Please enter an actor name first", "warning");
      return;
    }
    if (!state.settings.stashDbApiKey) {
      addNotification("StashDB API key is not configured in Settings", "warning");
    }
    addNotification("Fetching photos from StashDB...", "info");
    await loadImagesOnDemand({ stashDbId, name: trimmedName, imageUrl }, true);
  };

  const handleSave = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      addNotification("Actor name cannot be empty", "error");
      return;
    }

    const existingInState = state.actors.find(a => (a.name || '').toLowerCase() === trimmedName.toLowerCase() && a.id !== id);
    let targetId = id;
    let didMerge = false;

    // Cache available images locally so they are available anytime
    if (availableImages.length > 0) {
      if (stashDbId) cacheActorImages(stashDbId, availableImages);
      cacheActorImages(trimmedName, availableImages);
    }

    if (existingInState) {
      if (id) {
        if (!window.confirm(`An actor named "${existingInState.name}" already exists. Do you want to merge this actor into the existing one?`)) {
          return;
        }
        // Merge into existing
        mergeActors(id, existingInState.id);
        targetId = existingInState.id;
        didMerge = true;
        addNotification(`Merged "${name}" into existing actor "${existingInState.name}".`, 'success');
      } else {
        addNotification(`Actor "${trimmedName}" already exists!`, 'error');
        return;
      }
    } else {
      isSaving.current = true;
      const data = { 
        stashDbId,
        name: trimmedName, 
        imageUrl: imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedName)}`,
        imageZoom,
        imagePositionX,
        imagePositionY,
      };
      
      if (id) {
        updateActor(id, data);
      } else {
        targetId = addActor(data);
      }
    }
    
    setActorDraft(null);
    const stateFrom = (location.state as any)?.from;
    
    if (didMerge) {
      navigate(`/actor/${targetId}`, { replace: true });
    } else if (!id && stateFrom) {
      navigate(stateFrom, { replace: true, state: { ...((location.state as any) || {}), newlyAddedActorId: targetId } });
    } else if (!id && from === 'add') {
      navigate('/add', { replace: true });
    } else if (!id && from === 'vault' && targetId) {
      navigate(`/actor/${targetId}`, { replace: true });
    } else {
      setTimeout(() => {
        const fromPath = (location.state as any)?.from || '/manage-actors';
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      }, 0);
    }
  }, [name, stashDbId, imageUrl, availableImages, imageZoom, imagePositionX, imagePositionY, id, addActor, updateActor, navigate, from, setActorDraft, location.state, state.actors, addNotification, mergeActors]);

  const handlePermanentDelete = () => {
    if (!id) return;
    deleteActor(id);
    setActorDraft(null);
    const stateObj = (location.state as any) || {};
    let target = stateObj.from;
    let targetState = stateObj.returnState;

    // If 'from' points back to the now-deleted actor's vault, skip it to the original origin
    if (target && (target === `/actor/${id}` || target.startsWith(`/actor/${id}?`) || target.startsWith('/manage-actors/edit/'))) {
      target = targetState?.from || '/';
      targetState = targetState?.returnState;
    }

    const finalPath = target || '/manage-actors';
    navigate(finalPath, { replace: true, state: targetState });
  };

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
          <div className="w-48 h-48 rounded-full border-[4px] border-[var(--border)] bg-[var(--border)] opacity-10" />
          <div className="h-2 w-12 bg-[var(--border)] rounded-full opacity-50 mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 px-4 pt-4 pb-4 w-full relative animate-fade-in-fast">
      <div className="grid grid-cols-2 gap-4">
        <InputBar 
          label="Name"
          value={name} 
          onChange={(val) => setName(formatName(val))} 
          placeholder="Registry Entry Name..." 
          showPaste
        />
        <InputBar 
          label="Image"
          value={imageUrl} 
          onChange={(val) => {
            setImageUrl(val);
          }} 
          placeholder="Asset URL address..." 
          showPaste
        />
      </div>

      <div className="flex flex-col items-center justify-center py-6 relative">
        <div 
          className="w-48 h-48 rounded-full border-[4px] overflow-hidden bg-neutral-800 shadow-2xl relative ring-4 ring-black/20"
          style={{ borderColor: state.settings.circleBorderColor }}
        >
          {(effectiveImageUrl) && !isEffectiveImageError ? (
            <img 
              src={effectiveImageUrl} 
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
              onError={handleEffectiveImageError}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
               <Icons.UserGroup />
            </div>
          )}
        </div>
        
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] px-2 mt-4 text-center">Preview</span>

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
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] hover:underline active:scale-95 transition-all"
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

        {/* Available Images on-demand Section */}
        <div className="w-full mt-6 flex flex-col gap-2">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Available Images
              </span>
              {availableImages.length > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-bold">
                  {availableImages.length}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleManualFetchImages}
              disabled={isFetchingImages}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] hover:bg-[var(--accent)]/10 active:scale-95 transition-all disabled:opacity-50"
              title="Fetch latest photos from StashDB"
            >
              <Icons.RotateCcw size={11} className={isFetchingImages ? "animate-spin" : ""} />
              <span>{isFetchingImages ? "Fetching..." : "Fetch from StashDB"}</span>
            </button>
          </div>

          {isFetchingImages && availableImages.length === 0 ? (
            <div className="flex gap-4 pt-2 pb-4 px-2 overflow-x-hidden">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="w-20 h-20 rounded-full bg-[var(--surface)] border border-[var(--border)] animate-pulse shrink-0"
                />
              ))}
            </div>
          ) : availableImages && availableImages.length > 0 ? (
            <div
              className="flex overflow-x-auto gap-4 pt-2 pb-4 px-4 -mx-2 hide-scrollbar scroll-smooth"
              style={{
                WebkitOverflowScrolling: "touch",
                WebkitMaskImage: "linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)",
                maskImage: "linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)",
              }}
            >
              {availableImages.map((img) => (
                <ActorGalleryThumb
                  key={img}
                  img={img}
                  isSelected={imageUrl === img}
                  onClick={() => {
                    setImageUrl(img);
                    setImageZoom(1);
                    setImagePositionX(50);
                    setImagePositionY(50);
                  }}
                  isLoaded={!!loadedAvailableImages[img]}
                  onLoad={() => setLoadedAvailableImages((prev) => ({ ...prev, [img]: true }))}
                />
              ))}
            </div>
          ) : (
            <div className="px-2 py-3 rounded-2xl bg-[var(--surface)]/50 border border-[var(--border)]/60 text-center">
              <span className="text-[11px] text-[var(--text-muted)]">
                Click "Fetch from StashDB" to load performer photos without expanding database storage.
              </span>
            </div>
          )}
        </div>
        
        {id && (
          <div className="w-full mt-8 relative h-12">
            <div 
              className={`absolute inset-0 flex gap-3 transition-all duration-300 ease-[var(--ease-spring)] will-change-transform ${isConfirmingDelete ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}`}
            >
              <button 
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 py-3 rounded-full font-black uppercase tracking-widest text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] shadow-md active:scale-95 transition-transform"
              >
                Cancel
              </button>
              <button 
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
