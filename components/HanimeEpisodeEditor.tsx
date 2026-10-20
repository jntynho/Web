import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Trash2, Calendar, Image } from 'lucide-react';
import { HanimeEpisode } from '../types';
import { InputBar } from './InputBar';
import { DateSelector } from './DateSelector';
import { formatTitle } from '../utils/format';

interface HanimeEpisodeEditorProps {
  episodes: HanimeEpisode[];
  onChange: (episodes: HanimeEpisode[]) => void;
  buttonColor?: string;
}

export const HanimeEpisodeEditor: React.FC<HanimeEpisodeEditorProps> = ({
  episodes,
  onChange,
  buttonColor = 'var(--accent)'
}) => {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [activeDateEpId, setActiveDateEpId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const updateEpisode = (id: string, updates: Partial<HanimeEpisode>) => {
    const updated = episodes.map(ep => {
      if (ep.id === id) {
        return { ...ep, ...updates };
      }
      return ep;
    });
    onChange(updated);
  };

  const removeEpisode = (id: string) => {
    const filtered = episodes.filter(ep => ep.id !== id);
    // Re-number remaining episodes
    const renumbered = filtered.map((ep, idx) => ({
      ...ep,
      episodeNumber: idx + 1
    }));
    onChange(renumbered);
  };

  if (episodes.length === 0) {
    return null;
  }

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Episodes List */}
      <div className="flex flex-col gap-3">
        {episodes.map((ep) => {
          const isExpanded = expandedIds[ep.id] ?? false;
          // Priority to Booster Cover image
          const displayBoosterImage = ep.boosterCover || ep.coverImage;

          return (
            <div
              key={ep.id}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-[20px] overflow-hidden transition-all duration-300 shadow-sm"
            >
              {/* Card Header (Always Visible) */}
              <div
                onClick={() => toggleExpand(ep.id)}
                className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.02] active:bg-white/[0.04] transition-colors select-none"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Miniature Booster Poster Preview */}
                  <div className="w-12 aspect-[5/7] rounded-[10px] overflow-hidden bg-[var(--border)]/20 border border-[var(--border)] flex-shrink-0 relative shadow-sm">
                    {displayBoosterImage ? (
                      <img
                        src={displayBoosterImage}
                        alt={`EP ${ep.episodeNumber} Booster`}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                        <Image className="w-4 h-4 opacity-40" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex flex-col min-w-0 flex-1 gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[var(--text-primary)] truncate">
                        {ep.title || `Episode ${ep.episodeNumber}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-muted)]">
                      {ep.assignedDate ? (
                        <span className="flex items-center gap-1 font-semibold text-[var(--text-secondary)]">
                          <Calendar className="w-3 h-3 text-[var(--text-muted)]" />
                          {new Date(ep.assignedDate).toLocaleDateString('en-CA')}
                        </span>
                      ) : (
                        <span className="text-opacity-50">No date</span>
                      )}
                      <span>•</span>
                      <span className="font-semibold text-[11px] text-[var(--text-secondary)]">
                        Episode {ep.episodeNumber}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Header Action Controls */}
                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => removeEpisode(ep.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-red-400/80 hover:text-red-400 hover:bg-red-500/10 active:scale-95 transition-all"
                    title="Delete Episode"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExpand(ep.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-transform"
                  >
                    <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown className="w-4 h-4" />
                    </motion.div>
                  </button>
                </div>
              </div>

              {/* Collapsible Editor Content */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden border-t border-[var(--border)]/60 bg-black/10"
                  >
                    <div className="p-4 flex flex-col gap-3.5">
                      {/* Row 1: Booster Poster URL + Episode Thumbnail URL */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <InputBar
                          label={`Booster Cover (EP ${ep.episodeNumber})`}
                          value={ep.boosterCover || ''}
                          onChange={(val) => updateEpisode(ep.id, { boosterCover: val })}
                          placeholder="Booster Poster URL..."
                          showPaste
                          compact
                        />
                        <InputBar
                          label={`Thumbnail (EP ${ep.episodeNumber})`}
                          value={ep.coverImage || ''}
                          onChange={(val) => updateEpisode(ep.id, { coverImage: val })}
                          placeholder="Episode thumbnail URL..."
                          showPaste
                          compact
                        />
                      </div>

                      {/* Row 2: Episode Title + Stream URL */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <InputBar
                          label="Title"
                          value={ep.title || ''}
                          onChange={(val) => updateEpisode(ep.id, { title: formatTitle(val) })}
                          placeholder={`Episode ${ep.episodeNumber} Title...`}
                          showPaste
                          compact
                        />
                        <InputBar
                          label="Stream URL"
                          value={ep.url || ''}
                          onChange={(val) => updateEpisode(ep.id, { url: val })}
                          placeholder="Video or HStream Link..."
                          showPaste
                          compact
                        />
                      </div>

                      {/* Row 3: Release Date & Censorship */}
                      <div className="flex flex-col sm:flex-row gap-3 items-center">
                        <div className="flex-1 w-full flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveDateEpId(activeDateEpId === ep.id ? null : ep.id)}
                            className="flex-1 h-[44px] rounded-full bg-[var(--surface)] border border-[var(--border)] px-4 flex items-center justify-between text-xs font-bold hover:border-[var(--text-muted)] transition-all"
                          >
                            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                              <Calendar className="w-3.5 h-3.5 text-[var(--accent)]" />
                              {ep.assignedDate ? new Date(ep.assignedDate).toLocaleDateString('en-CA') : 'Set Release Date'}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                              {activeDateEpId === ep.id ? 'Close' : 'Edit'}
                            </span>
                          </button>
                        </div>

                        {/* Censorship toggles */}
                        <div className="flex gap-2 w-full sm:w-auto">
                          {(['UNCENSORED', 'CENSORED'] as const).map(c => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => updateEpisode(ep.id, { censorship: c })}
                              className={`flex-1 sm:flex-initial px-4 h-[44px] rounded-full font-black text-[10px] uppercase tracking-widest transition-all border ${
                                ep.censorship === c
                                  ? 'text-[var(--surface)] border-transparent shadow-md'
                                  : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]'
                              }`}
                              style={ep.censorship === c ? { backgroundColor: buttonColor } : {}}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* DateSelector Dropdown (if toggled) */}
                      {activeDateEpId === ep.id && (
                        <div className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-[16px] animate-fade-in-fast">
                          <DateSelector
                            value={ep.assignedDate}
                            onSave={(timestamp) => {
                              updateEpisode(ep.id, { assignedDate: timestamp });
                              setActiveDateEpId(null);
                            }}
                            onCancel={() => setActiveDateEpId(null)}
                          />
                        </div>
                      )}

                      {/* Row 4: Episode Description */}
                      <InputBar
                        label="Episode Description"
                        value={ep.description || ''}
                        onChange={(val) => updateEpisode(ep.id, { description: val })}
                        placeholder="Episode synopsis / notes..."
                        showPaste
                        isTextArea
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
