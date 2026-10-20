import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icons } from '../constants';
import { InputBar } from './InputBar';

interface ActorSelectorProps {
  actorSearch: string;
  setActorSearch: (search: string) => void;
  selectedActorIds: string[];
  setSelectedActorIds: React.Dispatch<React.SetStateAction<string[]>>;
  currentPath: string;
  onAddClick?: () => void;
}

export const ActorSelector: React.FC<ActorSelectorProps> = ({
  actorSearch,
  setActorSearch,
  selectedActorIds,
  setSelectedActorIds,
  currentPath,
  onAddClick
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, actorUsageMap, actorStudioAffinityMap } = useApp();

  const filteredActors = useMemo(() => {
    const isSearching = actorSearch.trim().length > 0;
    let pool = state.actors;
    
    if (isSearching) {
      const search = actorSearch.toLowerCase().replace(/\s+/g, '');
      pool = pool.filter(a => a.name.toLowerCase().replace(/\s+/g, '').includes(search));
    }

    const sorted = pool.sort((a, b) => {
      const aSel = selectedActorIds.includes(a.id) ? 1 : 0;
      const bSel = selectedActorIds.includes(b.id) ? 1 : 0;
      if (aSel !== bSel) return bSel - aSel;
      
      const aUse = actorUsageMap[a.id] || 0;
      const bUse = actorUsageMap[b.id] || 0;
      return bUse - aUse;
    });

    return isSearching ? sorted : sorted.slice(0, 10);
  }, [state.actors, state.studios, actorSearch, selectedActorIds, actorUsageMap, actorStudioAffinityMap]);

  return (
    <div className="flex flex-col mb-10">
      <div className="flex w-full gap-3">
        <InputBar 
          label="Actor" 
          value={actorSearch} 
          onChange={setActorSearch} 
          placeholder="Filter actors..." 
          showPaste
          compact
        />
        <button
          type="button"
          onClick={() => {
            if (onAddClick) onAddClick();
            navigate('/manage-actors/add?from=add', { state: { ...((location.state as any) || {}), from: currentPath, originalFrom: (location.state as any)?.originalFrom || (location.state as any)?.from }, replace: true });
          }}
          className="w-[48px] h-[48px] rounded-full shrink-0 flex items-center justify-center bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border)] active:scale-95 transition-all text-[var(--text-primary)] tap-highlight-none"
          title="Add Actor"
        >
          <Icons.Plus className="w-6 h-6" />
        </button>
      </div>
      <div className="flex flex-wrap gap-4 mt-5 px-1 min-h-[40px] items-center">
        {filteredActors.length === 0 && (
          <span className="text-[12px] font-black tracking-widest text-[var(--text-muted)] opacity-40 uppercase">
            {actorSearch ? "No actors found" : "No actors available"}
          </span>
        )}
        {filteredActors.map(a => (
          <button 
            key={a.id} 
            onClick={() => setSelectedActorIds(prev => prev.includes(a.id) ? prev.filter(i => i !== a.id) : [...prev, a.id])} 
            className={`text-[12px] font-black tracking-widest transition-all ${selectedActorIds.includes(a.id) ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
          >
            {a.name}
          </button>
        ))}
        {!actorSearch && state.actors.length > filteredActors.length && (
          <div className="flex items-center justify-center text-[var(--text-muted)] opacity-50 px-2 select-none"><Icons.MoreHorizontal className="w-5 h-5"/></div>
        )}
      </div>
    </div>
  );
};
