import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';

import { InputBar } from '../components/InputBar';
import { ColorSlider } from '../components/ColorSlider';
import { formatName } from '../utils/format';
import { useImageFallback } from '../hooks/useImageFallback';

export const AddEditStudio: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, addStudio, updateStudio, deleteStudio, mergeStudios, studioDraft, setStudioDraft, isHydrated, addNotification } = useApp();
  const initialized = useRef(false);
  const isSaving = useRef(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const searchParams = new URLSearchParams(location.search);
  const from = searchParams.get('from');
  const existingStudio = id ? state.studios.find(t => t.id === id) : null;

  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoBgColor, setLogoBgColor] = useState('#000000');

  const { 
    src: effectiveImageUrl, 
    hasError: isEffectiveImageError, 
    handleError: handleEffectiveImageError 
  } = useImageFallback(imageUrl);

  const { 
    src: effectiveLogoUrl, 
    hasError: isEffectiveLogoError, 
    handleError: handleEffectiveLogoError 
  } = useImageFallback(logoUrl);

  useEffect(() => {
    if (!isHydrated || initialized.current) return;

    if (studioDraft && studioDraft.id === (id || null)) {
      setName(studioDraft.name || '');
      setImageUrl(studioDraft.imageUrl || '');
      setLogoUrl(studioDraft.logoUrl || '');
      setLogoBgColor(studioDraft.logoBgColor || '#000000');
      initialized.current = true;
    } else if (existingStudio) {
      setName(existingStudio.name || '');
      setImageUrl(existingStudio.imageUrl || '');
      setLogoUrl(existingStudio.logoUrl || '');
      setLogoBgColor(existingStudio.logoBgColor || '#000000');
      initialized.current = true;
    } else if (!id) {
      setName('');
      setImageUrl('');
      setLogoUrl('');
      setLogoBgColor('#000000');
      initialized.current = true;
    }
  }, [id, existingStudio, studioDraft, isHydrated]);

  const draftRef = useRef({
    id: id || null,
    name,
    imageUrl,
    
    logoUrl,
    logoBgColor,
  });

  useEffect(() => {
    draftRef.current = {
      id: id || null,
      name,
      imageUrl,
      logoUrl,
      logoBgColor,
    };
    if (initialized.current) {
      setStudioDraft(draftRef.current);
    }
  }, [name, imageUrl, logoUrl, logoBgColor, id, setStudioDraft]);

  useEffect(() => {
    return () => {
      if (!isSaving.current) {
        setStudioDraft(null);
      }
    };
  }, [setStudioDraft]);

  const handleSave = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      addNotification("Studio name cannot be empty", "error");
      return;
    }

    const existingStudio = state.studios.find(t => (t.name || '').toLowerCase() === trimmedName.toLowerCase() && t.id !== id);
    let targetId = id;
    let didMerge = false;

    if (existingStudio) {
      if (id) {
        // Merge into existing
        mergeStudios(id, existingStudio.id);
        targetId = existingStudio.id;
        didMerge = true;
        addNotification(`Merged "${name}" into existing studio "${existingStudio.name}".`, 'success');
      } else {
        addNotification(`Studio "${trimmedName}" already exists!`, 'error');
        return;
      }
    } else {
      isSaving.current = true;
      const data = { 
        name: trimmedName, 
        imageUrl: imageUrl,
        
        logoUrl,
        logoBgColor,
        
      };
      
      if (id) {
        updateStudio(id, data);
      } else {
        targetId = addStudio(data);
      }
    }

    setStudioDraft(null);
    const stateFrom = (location.state as any)?.from;

    if (didMerge) {
      navigate(`/studio/${targetId}`, { replace: true });
    } else if (!id && stateFrom) {
      navigate(stateFrom, { replace: true, state: { ...((location.state as any) || {}), newlyAddedStudioId: targetId } });
    } else if (!id && from === 'add') {
      navigate('/add', { replace: true });
    } else if (!id && from === 'vault' && targetId) {
      navigate(`/studio/${targetId}`, { replace: true });
    } else {
      setTimeout(() => {
        const fromPath = (location.state as any)?.from || '/manage-studios';
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      }, 0);
    }
  }, [name, imageUrl,  logoUrl, logoBgColor, id, addStudio, updateStudio, navigate, from, setStudioDraft, location.state, state.studios, addNotification, mergeStudios]);

  const handlePermanentDelete = () => {
    if (!id) return;
    deleteStudio(id);
    setStudioDraft(null);
    const stateObj = (location.state as any) || {};
    let target = stateObj.from;
    let targetState = stateObj.returnState;

    // If 'from' points back to the now-deleted studio's vault, skip it to the original origin
    if (target && (target === `/studio/${id}` || target.startsWith(`/studio/${id}?`) || target.startsWith('/manage-studios/edit/'))) {
      target = targetState?.from || '/';
      targetState = targetState?.returnState;
    }

    const finalPath = target || '/manage-studios';
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
          label="Name"
          value={name} 
          onChange={(val) => setName(formatName(val))} 
          placeholder="Registry Entry Name..." 
          showPaste
        />
        <div className="flex gap-4">
          <div className="flex-1">
            <InputBar 
              label="Image"
              value={imageUrl} 
              onChange={(val) => {
                setImageUrl(val);
              }} 
              placeholder="Asset URL address (optional)..." 
              showPaste
              
            />
          </div>
          <div className="flex-1">
            <InputBar 
              label="Logo"
              value={logoUrl} 
              onChange={setLogoUrl} 
              placeholder="Logo URL address (optional)..." 
              showPaste
              
            />
          </div>
        </div>
        {logoUrl && (
          <ColorSlider 
            type="grayscale"
            title="Logo Background Color" 
            value={logoBgColor} 
            onChange={setLogoBgColor} 
            className="mt-2"
          />
        )}
        
        
      </div>

      <div className="flex flex-col items-center justify-center py-6 relative">
        <div 
          className="w-32 h-32 rounded-full border-[4px] flex items-center justify-center overflow-hidden bg-neutral-800 shadow-2xl relative ring-4 ring-black/20"
          style={{ borderColor: state.settings.circleBorderColor, backgroundColor: effectiveLogoUrl && !isEffectiveLogoError ? logoBgColor : undefined }}
        >
          {effectiveImageUrl && !isEffectiveImageError && (
            <img 
              src={effectiveImageUrl} 
              className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none select-none"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()} 
              alt={name}
              referrerPolicy="no-referrer"
              onError={handleEffectiveImageError}
            />
          )}
          {effectiveLogoUrl && !isEffectiveLogoError && (
            <img 
              src={effectiveLogoUrl} 
              className="absolute inset-0 m-auto w-[70%] h-[70%] object-contain drop-shadow-md z-10 pointer-events-none select-none"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()} 
              alt={name}
              referrerPolicy="no-referrer"
              onError={handleEffectiveLogoError}
            />
          )}
          {(!effectiveImageUrl || isEffectiveImageError) && (!effectiveLogoUrl || isEffectiveLogoError) && (
            <div className="scale-[2.5] opacity-20 text-yellow-400 z-0">
              <Icons.Studio />
            </div>
          )}
        </div>

        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mt-4">Preview</span>
        
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
