import React from 'react';
import { AspectRatio, DisplaySize } from '../types';
import { useApp } from '../AppContext';

const getTitleFontSize = (size?: DisplaySize) => {
  switch (size) {
    case 'Small': return '0.85rem';
    case 'Large': return '1.1rem';
    default: return '1rem';
  }
};

const getMetaFontSize = (size?: DisplaySize) => {
  switch (size) {
    case 'Small': return '0.85rem';
    case 'Large': return '1.05rem';
    default: return '0.92rem';
  }
};

export const ShimmerOverlay = () => (
  <div className="absolute inset-0 bg-[var(--skeleton-bg)] transition-colors duration-500 pointer-events-none" />
);

export const SkeletonBox: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`relative overflow-hidden bg-[var(--skeleton-bg)] transition-colors duration-500 ${className || ''}`} />
);

export const SkeletonCard: React.FC = () => {
  return (
    <div className="flex flex-col w-full border-b border-[var(--border)] overflow-hidden">
      <SkeletonBox className="aspect-video rounded-none w-full" />
      <div className="pl-3 pr-4 py-3.5 w-full bg-[var(--bg)]">
        <div className="flex justify-between items-start w-full">
          <div className="flex flex-col items-start flex-1">
            <SkeletonBox className="w-24 h-3 rounded-full mb-2" />
            <SkeletonBox className="w-48 h-4 rounded-full" />
          </div>
          <div className="flex gap-2">
            <SkeletonBox className="w-8 h-2 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

export const SkeletonHanimeCard: React.FC = () => {
  return (
    <div className="flex flex-col gap-2 w-full contain-layout group">
      <div className="rounded-xl overflow-hidden aspect-[5/7] bg-[var(--skeleton-bg)] transition-colors duration-500 relative shadow-sm">
        <ShimmerOverlay />
      </div>
      <div className="px-1 mt-0.5 h-[2.75rem] flex flex-col justify-start gap-1.5 min-w-0">
        <div className="w-[85%] h-3.5 rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500" />
        <div className="w-[55%] h-3 rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500 opacity-60" />
      </div>
    </div>
  );
};

export const SkeletonHanimeGrid: React.FC<{ count?: number }> = ({ count = 20 }) => {
  return (
    <div className="grid grid-cols-2 gap-4 w-full z-0 animate-fade-in-fast">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonHanimeCard key={`hanime-skel-${i}`} />
      ))}
    </div>
  );
};

export const SkeletonLinkCard: React.FC<{ aspectRatio?: AspectRatio }> = ({ aspectRatio = '16:9' }) => {
  const { state } = useApp();
  const titleSize = state?.settings?.titleSize;
  const metadataSize = state?.settings?.metadataSize;

  const ratioClass = aspectRatio === '3:2' ? 'aspect-[3/2]' : aspectRatio === '5:7' ? 'aspect-[5/7]' : 'aspect-video';
  return (
    <div className="flex flex-col w-full overflow-hidden gpu-accelerated group transition-[background-color] duration-500" style={{ backgroundColor: 'var(--bg)' }}>
      <div className={`relative w-full overflow-hidden bg-[var(--skeleton-bg)] transition-colors duration-500 ${ratioClass}`} />
      <div className="pl-3 pr-3 pt-3 pb-4 w-full transition-colors duration-500" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="flex flex-col w-full">
          <div className="flex justify-between items-end w-full mb-1 min-w-0">
            <div className="flex items-end min-w-0 pr-2 h-6">
              <div className="flex items-end gap-1.5 truncate min-w-0">
                  <span 
                    className="font-black tracking-[0.05em] leading-none whitespace-nowrap py-0.5 text-transparent relative select-none" 
                    style={{ fontSize: getMetaFontSize(metadataSize) }}
                  >
                    <div className="absolute top-[10%] bottom-[10%] left-0 w-24 rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500" />
                    InvisibleActorName
                  </span>
              </div>
            </div>
            <div className="flex items-end justify-end shrink-0 pl-4 h-6">
              <div className="flex items-end gap-x-1 font-black tracking-widest text-transparent relative" style={{ fontSize: '0.62rem' }}>
                <div className="absolute top-[20%] bottom-[20%] right-0 w-12 rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500" />
                InvisStudio
              </div>
            </div>
          </div>
          <div className="flex justify-between items-end w-full min-w-0">
            <h3 
              className={`text-transparent font-bold leading-none tracking-tight text-left truncate flex-1 min-w-0 relative select-none`} 
              style={{ fontSize: getTitleFontSize(titleSize) }}
            >
              <div className="absolute top-[15%] bottom-[15%] left-0 w-[70%] rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500" />
              InvisibleTitleThatTakesUpSpace
            </h3>
            <div className="text-[0.65rem] font-black tracking-widest text-transparent shrink-0 pl-4 pb-[1px] relative select-none">
              <div className="absolute top-[10%] bottom-[20%] right-0 w-12 rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500" />
              InvisibleDate
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SkeletonActorHeader: React.FC = () => {
  return (
    <div className="px-5 mb-0 mt-0" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="flex items-center gap-4 sm:gap-5 py-5 sm:py-6">
        <div 
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-[3px] sm:border-[4px] border-transparent shrink-0 bg-[var(--skeleton-bg)] shadow-2xl transition-colors duration-500"
        />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="w-36 sm:w-44 h-5 rounded-full bg-[var(--skeleton-bg)] mb-2 transition-colors duration-500" />
          <div className="w-16 h-3 rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500" />
        </div>
      </div>
    </div>
  );
};

export const SkeletonCoomerHeader: React.FC = () => {
  return (
    <div className="flex flex-col items-center pt-3 animate-fade-in-fast">
      <div className="w-24 h-24 rounded-full border-[3px] border-transparent overflow-hidden bg-[var(--skeleton-bg)] shadow-2xl relative ring-4 ring-black/20 transition-colors duration-500 animate-pulse" />
      <div className="mt-3 min-h-[32px] py-1 flex items-center justify-center">
        <div className="w-36 h-[22px] rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500 animate-pulse" />
      </div>
    </div>
  );
};

export const SkeletonListItem: React.FC<{ isLast?: boolean }> = ({ isLast = false }) => {
  return (
    <div className="w-full relative">
      <div className={`flex items-center gap-4 px-2 py-4 relative pointer-events-none ${!isLast ? 'border-b border-[var(--border)]' : ''}`}>
        <div className="w-16 h-16 rounded-full overflow-hidden bg-[var(--skeleton-bg)] border-[2px] border-transparent shrink-0 shadow-md relative transition-colors duration-500 animate-pulse" />
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <div className="w-36 sm:w-48 h-[17px] rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500 my-[3px] animate-pulse" />
          <div className="w-16 h-[13px] rounded-full bg-[var(--skeleton-bg)] transition-colors duration-500 my-[2px] opacity-70 animate-pulse" />
        </div>
      </div>
    </div>
  );
};

export const SkeletonCircle: React.FC = () => {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[20px] flex flex-col items-center justify-center py-4 px-2 min-h-[140px] overflow-hidden">
      <SkeletonBox className="w-[88%] aspect-square rounded-full animate-pulse" />
      <SkeletonBox className="w-16 h-3 rounded-full mt-4 animate-pulse" />
    </div>
  );
};

export const SkeletonCoomerGrid: React.FC<{ count?: number }> = ({ count = 54 }) => {
  return (
    <div className="grid grid-cols-3 gap-[2px] w-full animate-fade-in-fast contain-layout">
      {Array.from({ length: Math.min(count, 54) }).map((_, idx) => (
        <div 
          key={idx} 
          className="aspect-[3/4] bg-[var(--skeleton-bg)] animate-pulse transition-colors duration-500 overflow-hidden relative" 
        />
      ))}
    </div>
  );
};

export const LoadingSpinner: React.FC = () => {
  return (
    <div className="flex items-center justify-center py-40 w-full animate-in fade-in duration-500">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-white/5" />
        <div className="absolute inset-0 rounded-full border-2 border-t-[var(--accent)] animate-spin shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]" />
      </div>
    </div>
  );
};
