import React, { useState, useEffect } from 'react';

interface ValueSliderProps {
  title: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  className?: string;
}

export const ValueSlider: React.FC<ValueSliderProps> = ({ 
  title, 
  value, 
  onChange, 
  min = 0,
  max = 100,
  unit = '%',
  className = "mb-6"
}) => {
  const [localValue, setLocalValue] = useState(value);
  
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newVal: number) => {
    setLocalValue(newVal);
    onChange(newVal);
  };
  
  return (
    <div className={`flex flex-col w-full ${className}`}>
      <div className="flex items-center justify-between px-5 mb-2">
        <span className="text-[13px] font-semibold text-[var(--accent)] uppercase tracking-tight opacity-90">
          {title}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
          {localValue}{unit}
        </span>
      </div>
      <div className="h-14 bg-[var(--surface)] border border-[var(--border)] rounded-full px-6 flex items-center relative group shadow-sm mx-0">
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min={min}
            max={max}
            value={localValue}
            onChange={(e) => handleChange(parseInt(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md"
            style={{ 
              background: 'linear-gradient(to right, rgba(0,0,0,0.1), rgba(0,0,0,0.5))'
            }}
          />
        </div>
      </div>
    </div>
  );
};
