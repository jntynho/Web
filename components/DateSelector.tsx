
import React, { useState, useEffect } from 'react';
import { Icons } from '../constants';
import { useApp } from '../AppContext';
import { InputBar } from './InputBar';

interface DateSelectorProps {
  value?: number; // timestamp
  onSave: (value: number) => void;
  onCancel: () => void;
  className?: string;
}

export const DateSelector: React.FC<DateSelectorProps> = ({ value, onSave, onCancel, className = "" }) => {
  const { addNotification } = useApp();
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (value) {
      const date = new Date(value);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      setInputValue(`${y}/${m}/${d}`);
    }
  }, [value]);

  const parseDate = (str: string): number | null => {
    const s = str.trim().toLowerCase();
    if (!s) return null;

    // Support: YYYY/MM/DD, YY/MM/DD, YYYY.MM.DD, YY.MM.DD
    const numericMatch = s.match(/^(\d{2,4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
    if (numericMatch) {
      let y = parseInt(numericMatch[1]);
      let m = parseInt(numericMatch[2]) - 1;
      let d = parseInt(numericMatch[3]);
      
      if (y < 100) y += 2000;
      const date = new Date(y, m, d, 12, 0, 0);
      if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
        return date.getTime();
      }
    }

    // Support: YYYY MMM DD, YY MMM DD (e.g., 2026 jan 23, 26 jan 23)
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const alphaMatch = s.match(/^(\d{2,4})\s+([a-z]{3,})\s+(\d{1,2})$/);
    if (alphaMatch) {
      let y = parseInt(alphaMatch[1]);
      const mStr = alphaMatch[2].substring(0, 3);
      let d = parseInt(alphaMatch[3]);
      
      const m = monthNames.indexOf(mStr);
      if (m !== -1) {
        if (y < 100) y += 2000;
        const date = new Date(y, m, d, 12, 0, 0);
        if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
          return date.getTime();
        }
      }
    }

    // Fallback to native Date.parse
    const cleanStr = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');
    const fallback = Date.parse(cleanStr);
    if (!isNaN(fallback)) return fallback;

    return null;
  };

  const handleConfirm = () => {
    const timestamp = parseDate(inputValue);
    if (timestamp) {
      onSave(timestamp);
    } else {
      addNotification("Invalid date format. Try YYYY/MM/DD, YYYY MMM DD", "error");
    }
  };

  return (
    <div className={`grid grid-cols-2 gap-3 w-full ${className}`}>
      <div className="min-w-0">
        <InputBar
          label="Date"
          value={inputValue}
          onChange={setInputValue}
          placeholder="YYYY/MM/DD"
          showPaste={false}
          compact
        />
      </div>
      
      <div className="flex items-center justify-between w-full">
        <button
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              setInputValue(text);
            } catch (err) {
              addNotification("Failed to paste", "error");
            }
          }}
          className="w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--text-primary)] tap-highlight-none"
          title="Paste Date"
        >
          <Icons.Paste className="w-6 h-6 text-blue-400" />
        </button>
        <button
          onClick={handleConfirm}
          className="w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--text-primary)] tap-highlight-none"
          title="Confirm"
        >
          <Icons.Check className="w-6 h-6 text-emerald-400" />
        </button>
        <button
          onClick={onCancel}
          className="w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--text-primary)] tap-highlight-none"
          title="Cancel"
        >
          <Icons.X className="w-6 h-6 text-rose-400" />
        </button>
      </div>
    </div>
  );
};

