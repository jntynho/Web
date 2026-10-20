import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icons } from '../constants';

export const InputBar = React.memo<{
  label: string;
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPasteCapture?: (text: string) => void;
  placeholder: string;
  showPaste?: boolean;
  rightElement?: React.ReactNode;
  isLoading?: boolean;
  isDuplicate?: boolean;
  isTextArea?: boolean;
  compact?: boolean;
}>(({ label, value, onChange, onBlur, onKeyDown, onPasteCapture, placeholder, showPaste, rightElement, isLoading, isDuplicate, isTextArea = false, compact = false }) => {
  const id = React.useId();
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  
  const [localValue, setLocalValue] = useState(value);
  const isTyping = useRef(false);
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!isTyping.current) {
      setLocalValue(value);
    }
  }, [value]);

  const flushNow = useCallback(() => {
    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (isTyping.current) {
      isTyping.current = false;
      onChange(localValue);
    }
  }, [localValue, onChange]);

  useEffect(() => {
    const handleGlobalSaveTrigger = () => {
      flushNow();
    };
    window.addEventListener('vault-save-trigger', handleGlobalSaveTrigger);
    return () => {
      window.removeEventListener('vault-save-trigger', handleGlobalSaveTrigger);
    };
  }, [flushNow]);

  const handleChange = useCallback((newVal: string, immediate = false) => {
    const isImageField = label.toLowerCase().includes('cover') || label.toLowerCase().includes('image') || label.toLowerCase().includes('gallery') || label.toLowerCase().includes('profile');
    
    if (isImageField) {
      // Regex to detect common temporary link parameters
      if (/(\?|&)(ex|expires|expire|ttl|token|signature|policy|oh|hm|sig)=/i.test(newVal)) {
        window.dispatchEvent(new CustomEvent('app-notification', {
          detail: { message: 'Temporary image links are not allowed. Please use a permanent URL.', type: 'error' }
        }));
        return; // Prevent state update
      }
    }

    setLocalValue(newVal);
    isTyping.current = true;
    
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    
    const delay = immediate ? 0 : 150;
    
    if (delay === 0) {
      isTyping.current = false;
      onChange(newVal);
    } else {
      flushTimer.current = window.setTimeout(() => {
        isTyping.current = false;
        onChange(newVal);
      }, delay);
    }
  }, [label, onChange]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    isTyping.current = false;
    onChange(localValue);
    if (onBlur) onBlur();
  }, [localValue, onChange, onBlur]);

  const handleManualPaste = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          handleChange(text, true);
          if (onPasteCapture) onPasteCapture(text);
        }
      } else {
        throw new Error('Clipboard API not available');
      }
    } catch (err) {
      console.warn('Clipboard access failed', err);
      window.dispatchEvent(new CustomEvent('app-notification', {
        detail: { message: 'Clipboard access denied. Please use Ctrl+V or Cmd+V to paste.', type: 'error' }
      }));
    }
  };

  const handleNativePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData?.getData('text');
    if (pastedText) {
      e.preventDefault();
      handleChange(pastedText, true);
      if (onPasteCapture) onPasteCapture(pastedText);
    }
  };

  return (
    <div 
      className={`group flex flex-col w-full relative pointer-events-auto bg-[var(--surface)] rounded-full transition-[border-color,shadow] duration-200 ${isFocused ? 'shadow-[inset_0_0_0_1px_var(--accent),0_0_0_1px_var(--accent)]' : 'shadow-[inset_0_0_0_1px_var(--border)]'}`} 
    >
      <div className={`flex items-center w-full min-h-[48px] ${compact ? 'px-4 gap-2' : 'px-6 gap-3'}`}>
        {showPaste && (
          <button 
            type="button" 
            aria-label="Paste from clipboard"
            onClick={handleManualPaste} 
            className={`${compact ? 'w-8 h-8 -ml-1' : 'w-10 h-10 -ml-2'} flex items-center justify-center text-[var(--text-primary)] shrink-0 active:scale-75 transition-transform tap-highlight-none`}
          >
            <Icons.Paste />
          </button>
        )}
        <div className="flex-1 flex flex-col py-1.5 min-w-0">
          <label htmlFor={id} className={`text-[9px] font-black uppercase tracking-[0.25em] transition-colors duration-300 group-focus-within:text-[var(--accent)] ${isFocused ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{label}</label>
          {isTextArea ? (
            <textarea
              id={id}
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={localValue}
              onFocus={() => setIsFocused(true)}
              onBlur={handleBlur}
              onPaste={handleNativePaste}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-medium tracking-tight select-text resize-none max-h-40 overflow-y-auto"
              rows={1}
              style={{ minHeight: '22px' }}
            />
          ) : (
            <input 
              id={id}
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={localValue}
              onFocus={() => setIsFocused(true)}
              onBlur={handleBlur}
              onKeyDown={onKeyDown}
              onPaste={handleNativePaste}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-medium tracking-tight h-5 select-text"
            />
          )}
        </div>
        {isLoading && <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />}
        {isDuplicate && (
          <div className="w-8 h-8 flex items-center justify-center text-rose-500 animate-pulse" title="Duplicate value detected">
            <Icons.AlertTriangle />
          </div>
        )}
        {rightElement && <div className="flex items-center justify-center shrink-0">{rightElement}</div>}
      </div>
    </div>
  );
});
