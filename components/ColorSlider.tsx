import React, { useState, useEffect, useRef } from 'react';

const hexToHsl = (hex: string) => {
  if (!hex || typeof hex !== 'string') return [0, 0, 0];
  hex = hex.replace(/^#/, '');
  
  let r = 0, g = 0, b = 0;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else if (hex.length === 8) {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else {
    return [0, 0, 0];
  }
  
  if (isNaN(r) || isNaN(g) || isNaN(b)) return [0, 0, 0];

  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360) || 0, Math.round(s * 100) || 0, Math.round(l * 100) || 0];
};

const hslToHex = (h: number, s: number, l: number) => {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

interface ColorSliderProps {
  title: string;
  value: string;
  onChange: (color: string) => void;
  type?: 'hue' | 'grayscale' | 'theme';
  themes?: string[];
  hideTitle?: boolean;
  className?: string;
}

export const ColorSlider: React.FC<ColorSliderProps> = ({ 
  title, 
  value, 
  onChange, 
  type = 'hue', 
  themes = [], 
  hideTitle = false, 
  className = "mb-6" 
}) => {
  const [mode, setMode] = useState<'base' | 'degree'>('base');
  const [localValue, setLocalValue] = useState(value);
  
  const initialHsl = hexToHsl(value || '#000000');
  const lastHue = useRef(initialHsl[0]);
  const lastSat = useRef(initialHsl[1] > 0 ? initialHsl[1] : 100);
  
  useEffect(() => {
    setLocalValue(value);
    const [h, s, l] = hexToHsl(value);
    if (s > 0 && l > 0 && l < 100) {
      lastHue.current = h;
      lastSat.current = s;
    }
  }, [value]);

  const handleChange = (newColor: string) => {
    setLocalValue(newColor);
    onChange(newColor);
  };
  
  const renderHeader = () => {
    if (hideTitle) return null;
    return (
      <div className="flex items-center justify-between px-5 mb-2">
        <span className="text-[13px] font-semibold text-[var(--accent)] uppercase tracking-tight opacity-90">
          {title}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
          {localValue}
        </span>
      </div>
    );
  };

  if (type === 'theme') {
    const currentIndex = Math.max(0, themes.indexOf(localValue));
    const safeMax = Math.max(1, themes.length - 1);
    
    const themeColors: Record<string, string> = {
      'Dark': '#242424',
      'Grey': '#33373B',
      'Amoled': '#000000',
      'Blue': '#151F2E',
      'Light': '#E7E9EB'
    };
    
    const gradientColors = themes.length > 0 
      ? themes.map(t => themeColors[t] || '#000').join(', ') 
      : '#000, #fff';
    const gradient = `linear-gradient(to right, ${gradientColors})`;
    const activeColor = themes.length > 0 ? themeColors[themes[currentIndex]] || '#000' : '#000';

    return (
      <div className={`flex flex-col w-full ${className}`}>
        {renderHeader()}
        <div className="h-14 bg-[var(--surface)] border border-[var(--border)] rounded-full px-6 flex items-center relative group shadow-sm mx-0">
          <div 
            className="w-6 h-6 rounded-full shrink-0 mr-4 shadow-sm border border-[var(--border)]"
            style={{ backgroundColor: activeColor }}
          />
          <div className="flex-1 flex items-center">
            <input
              type="range"
              min="0"
              max={safeMax}
              value={currentIndex}
              onChange={(e) => {
                const idx = parseInt(e.target.value);
                if (themes[idx]) handleChange(themes[idx]);
              }}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
              style={{ background: gradient }}
            />
          </div>
          <button 
            className="shrink-0 ml-4 flex items-center justify-center transition-all duration-300 opacity-30 cursor-not-allowed text-[var(--text-primary)]"
            disabled
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  const [h, s, l] = hexToHsl(localValue || '#000000');
  
  const activeHue = (s === 0 || l === 0 || l === 100) ? lastHue.current : h;
  const activeSat = (s === 0 || l === 0 || l === 100) ? lastSat.current : s;

  return (
    <div className={`flex flex-col w-full ${className}`}>
      {renderHeader()}
      <div className="h-14 bg-[var(--surface)] border border-[var(--border)] rounded-full px-6 flex items-center relative group shadow-sm mx-0">
        <div 
          className="w-6 h-6 rounded-full shrink-0 mr-4 shadow-sm border border-[var(--border)]"
          style={{ backgroundColor: localValue || '#000000' }}
        />
        <div className="flex-1 flex items-center">
          {type === 'grayscale' ? (
            <input
              type="range"
              min="0"
              max="255"
              value={(() => {
                const hexVal = (localValue || '#000000').replace('#', '');
                const parsed = parseInt(hexVal.substring(0, 2), 16);
                return isNaN(parsed) ? 0 : parsed;
              })()}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                const hex = val.toString(16).padStart(2, '0');
                handleChange(`#${hex}${hex}${hex}`);
              }}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: 'linear-gradient(to right, #000000, #ffffff)'
              }}
            />
          ) : mode === 'base' ? (
            <input
              type="range"
              min="0"
              max="360"
              value={activeHue}
              onChange={(e) => {
                handleChange(hslToHex(parseInt(e.target.value), activeSat, 50));
              }}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
              }}
            />
          ) : (
            <input
              type="range"
              min="0"
              max="100"
              value={l}
              onChange={(e) => {
                handleChange(hslToHex(activeHue, activeSat, parseInt(e.target.value)));
              }}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
              style={{
                background: `linear-gradient(to right, #000000, ${hslToHex(activeHue, activeSat, 50)}, #ffffff)`
              }}
            />
          )}
        </div>
        <button 
          onClick={() => {
            if (type !== 'grayscale') {
              setMode(m => m === 'base' ? 'degree' : 'base');
            }
          }}
          className={`shrink-0 ml-4 flex items-center justify-center transition-all duration-300 active:scale-90 outline-none ${
            type === 'grayscale' 
              ? 'opacity-30 cursor-not-allowed text-[var(--text-primary)]' 
              : mode === 'degree' 
                ? 'text-[var(--accent)]' 
                : 'text-[var(--text-primary)] opacity-60 hover:opacity-100'
          }`}
          title={type === 'grayscale' ? 'Not available for grayscale' : 'Toggle Shade Control'}
          disabled={type === 'grayscale'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill={mode === 'degree' && type !== 'grayscale' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={mode === 'degree' && type !== 'grayscale' ? 'rotate-180 transition-transform duration-300' : 'transition-transform duration-300'}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
};
