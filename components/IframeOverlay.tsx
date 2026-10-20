import React, { useState, useEffect } from 'react';
import { Icons } from '../constants';

interface IframeOverlayProps {
  url: string;
  onClose: () => void;
}

export const IframeOverlay: React.FC<IframeOverlayProps> = ({ url, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    // Auto-hide controls after a delay, similar to video players, 
    // but here we just leave them or handle mouse movement.
    // For simplicity, let's keep them visible initially, then hide after 3 seconds of inactivity.
    let timer: any;
    const handleActivity = () => {
      setShowControls(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowControls(false), 3000);
    };

    document.addEventListener('mousemove', handleActivity);
    document.addEventListener('pointerdown', handleActivity);
    timer = setTimeout(() => setShowControls(false), 3000);

    return () => {
      document.removeEventListener('mousemove', handleActivity);
      document.removeEventListener('pointerdown', handleActivity);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div 
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute inset-0 z-[50] flex items-center justify-center overflow-hidden"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className={`absolute top-4 right-4 z-[60] transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-10 h-10 bg-black/60 hover:bg-black/80 border border-white/10 rounded-full flex items-center justify-center text-white transition-colors duration-300 shadow-md"
          title="Close Player"
        >
          <Icons.X size={20} />
        </button>
      </div>

      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white z-[40]">
          <div className="w-8 h-8 border-2 border-[var(--accent, #3b82f6)] border-t-transparent rounded-full animate-spin shadow-[0_0_10px_var(--accent, #3b82f6)]" />
          <div className="text-xs font-medium tracking-wide animate-pulse">Loading player...</div>
        </div>
      )}

      <div className="relative w-full h-full flex items-center justify-center z-[45]">
        <iframe 
          src={url}
          className="w-full h-full border-0 relative"
          frameBorder="0"
          allowFullScreen
          allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
};
