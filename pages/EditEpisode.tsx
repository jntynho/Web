
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { useApp } from '../AppContext';
import { InputBar } from '../components/InputBar';
import { CoverPreview } from '../components/CoverPreview';

export const EditEpisode: React.FC = () => {
  const { hanimeId, episodeId } = useParams();
  const { state, updateHanime, hanimeDraft, setHanimeDraft } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [url, setUrl] = useState('');
  const [cover, setCover] = useState('');
  const [title, setTitle] = useState('');
  const [boosterCover, setBoosterCover] = useState('');
  const [description, setDescription] = useState('');
  const [assignedDate, setAssignedDate] = useState('');
  const [censorship, setCensorship] = useState<'UNCENSORED' | 'CENSORED'>('UNCENSORED');
  
  const hanime = hanimeDraft || state.hanime.find(h => h.id === hanimeId);
  const episode = hanime?.episodes.find(e => e.id === episodeId);

  useEffect(() => {
    if (episode) {
      setUrl(episode.url || '');
      setCover(episode.coverImage || '');
      setTitle(episode.title || '');
      setBoosterCover(episode.boosterCover || '');
      setDescription(episode.description || '');
      setAssignedDate(episode.assignedDate ? new Date(episode.assignedDate).toISOString().split('T')[0] : '');
      setCensorship(episode.censorship || 'UNCENSORED');
    }
  }, [episode]);

  const handleSave = () => {
    if (!hanime) return;
    
    const updatedEpisodes = hanime.episodes.map(ep => 
      ep.id === episodeId ? { 
        ...ep, 
        url, 
        coverImage: cover,
        title: title.trim() || undefined,
        boosterCover: boosterCover.trim() || undefined,
        description: description.trim() || undefined,
        assignedDate: assignedDate ? new Date(assignedDate).getTime() : undefined,
        censorship
      } : ep
    );
    
    const fromPath = (location.state as any)?.from || `/manage-hanime/edit/${hanimeId}`;
    if (hanimeDraft) {
      setHanimeDraft({
        ...hanimeDraft,
        episodes: updatedEpisodes
      });
      navigate('/manage-hanime/episodes', { replace: true, state: (location.state as any) });
    } else {
      updateHanime(hanime.id, { episodes: updatedEpisodes });
      navigate(fromPath, { replace: true, state: (location.state as any) });
    }
  };

  useEffect(() => {
    const trigger = () => handleSave();
    window.addEventListener('vault-save-trigger', trigger);
    return () => window.removeEventListener('vault-save-trigger', trigger);
  }, [handleSave]);

  const handleCancel = () => {
    const fromPath = (location.state as any)?.from || (hanimeDraft ? '/manage-hanime/episodes' : `/manage-hanime/edit/${hanimeId}`);
    navigate(fromPath, { replace: true, state: (location.state as any) });
  };

  if (!episode) return <div>Episode not found</div>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4"
    >
      <div className="flex flex-col gap-y-4 mb-6">
        <InputBar label="Episode Title" value={title} onChange={setTitle} placeholder="Episode Title (e.g. Series - 1)..." showPaste />
        <InputBar label="Episode URL" value={url} onChange={setUrl} placeholder="Episode URL..." showPaste />
        <InputBar label="Cover Image URL (16:9 Player)" value={cover} onChange={setCover} placeholder="Episode Cover / Thumbnail..." showPaste />
        <InputBar label="Booster Cover URL (5:7 Poster)" value={boosterCover} onChange={setBoosterCover} placeholder="Booster Cover URL..." showPaste />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 px-1">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Release Date</label>
            <input
              type="date"
              value={assignedDate}
              onChange={(e) => setAssignedDate(e.target.value)}
              className="w-full rounded-2xl p-3 bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1.5 px-1">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Censorship</label>
            <div className="flex bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-1">
              <button
                type="button"
                onClick={() => setCensorship('UNCENSORED')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${censorship === 'UNCENSORED' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'text-[var(--text-muted)] hover:text-white'}`}
              >
                UNCENSORED
              </button>
              <button
                type="button"
                onClick={() => setCensorship('CENSORED')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${censorship === 'CENSORED' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-[var(--text-muted)] hover:text-white'}`}
              >
                CENSORED
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 px-1">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Episode Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Episode specific description..."
            rows={4}
            className="w-full rounded-2xl p-3.5 bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
          />
        </div>
      </div>
      
      <div className="relative -mt-6 mb-12 w-full mx-auto">
        <CoverPreview 
          url={cover} 
          ratio={'16:9'} 
          objectFit="contain"
          offset={50} 
          onOffsetChange={() => {}} 
        />
      </div>
      <div className="flex gap-4">
        <button onClick={handleSave} className="flex-1 h-12 rounded-full text-white font-bold" style={{ backgroundColor: state.settings.buttonColor }}>Save</button>
        <button onClick={handleCancel} className="flex-1 h-12 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] font-bold">Cancel</button>
      </div>
    </motion.div>
  );
};
