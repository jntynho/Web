
import { AppState, LinkItem, Actor, Studio, Coomer, CoomerPost, AppSettings, SortOrder, HanimeItem, HanimeEpisode, AspectRatio, FontFamily } from './types';
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';

export const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  'Plus Jakarta Sans': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'Inter': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'Outfit': "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'Manrope': "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'Poppins': "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'Sora': "'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'System': "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
};
import * as storage from './utils/storage';
import { supabase } from './supabase';
import { cacheActorImages, cleanActorForState } from './utils/actorImagesCache';
import { cacheCoomerPosts, removeCachedCoomerPosts } from './utils/coomerCache';
import { compressData, decompressData } from './utils/compression';
import { sanitizeStateForExport, computeDataHash } from './utils/exportHelper';
export type SettingsView = 'main' | 'theme' | 'display' | 'interaction' | 'header' | 'cover' | 'statistics' | 'statistics-detail' | 'missing-data' | 'integrations' | 'profile' | 'data' | 'advanced';

interface FormDraft {
  id: string | null; 
  title: string;
  urlHD: string;
  url4K: string;
  magnet: string;
  magnet4K: string;
  coverImage: string;
  coverOffset: number;
  aspectRatio: AspectRatio;
  actorIds: string[];
  studioIds: string[];
  galleryUrls: string[];
  originalGalleryUrls?: string[];
  qualityPreference?: 'thumbnail' | 'original';
  galleryScraperUrl?: string;
  scraperUrl?: string;
  assignedDate?: number;
}

interface ActorDraft {
  id: string | null;
  name: string;
  imageUrl: string;
  originalImageUrl?: string;
  availableImages?: string[];
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
  instagramUrl?: string;
  twitterUrl?: string;
  onlyFansUrl?: string;
}

interface StudioDraft {
  id: string | null;
  name: string;
  imageUrl: string;
  originalImageUrl: string;
  logoUrl?: string;
  logoBgColor?: string;
}

interface CoomerDraft {
  id: string | null;
  name: string;
  imageUrl: string;
  originalImageUrl: string;
  posts?: CoomerPost[];
  sourceUrl?: string;
  secondarySourceUrl?: string;
  sourceUrls?: string[];
  instagramPosts?: CoomerPost[];
  onlyFansPosts?: CoomerPost[];
  instagramLinks?: string[];
  onlyFansLinks?: string[];
  imagePositionX?: number;
  imagePositionY?: number;
  imageZoom?: number;
}

interface HanimeDraft {
  id: string | null;
  title: string;
  coverImage: string;
  coverOffset: number;
  secondaryCovers: string[];
  description: string;
  assignedDate?: number;
  censorship?: 'UNCENSORED' | 'CENSORED';
  episodes: HanimeEpisode[];
  hanimeScraperUrl?: string;
}

interface AppContextType {
  state: AppState;
  addLink: (link: Omit<LinkItem, 'id'>) => void;
  addLinks: (links: Array<Omit<LinkItem, 'id'>>) => Promise<LinkItem[]>;
  updateLink: (id: string, updates: Partial<LinkItem>) => void;
  deleteLink: (id: string) => void;
  clearAllData: (options?: {
    actors?: boolean;
    studios?: boolean;
    settings?: boolean;
    hanime?: boolean;
    links?: boolean;
    coomers?: boolean;
  }) => void;
  addActor: (actor: Omit<Actor, 'id'>) => string;
  updateActor: (id: string, updates: Partial<Actor>) => void;
  deleteActor: (id: string) => void;
  mergeActors: (sourceId: string, targetId: string) => void;
  addCoomer: (coomer: Omit<Coomer, 'id'>) => string;
  updateCoomer: (id: string, updates: Partial<Coomer>) => void;
  deleteCoomer: (id: string) => void;
  restoreCoomer: (id: string) => void;
  permDeleteCoomer: (id: string) => void;
  addStudio: (studio: Omit<Studio, 'id'>) => string;
  updateStudio: (id: string, updates: Partial<Studio>) => void;
  deleteStudio: (id: string) => void;
  mergeStudios: (sourceId: string, targetId: string) => void;
  addHanime: (hanime: Omit<HanimeItem, 'id'>) => string;
  updateHanime: (id: string, updates: Partial<HanimeItem>) => void;
  deleteHanime: (id: string) => void;
  restoreHanime: (id: string) => void;
  permDeleteHanime: (id: string) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  toggleSort: (viewType: string, currentSortOrder: SortOrder) => void;
  importData: (data: string | object, isFromCloud?: boolean) => Promise<boolean>;
  runSystemCheck: () => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  settingsView: SettingsView;
  setSettingsView: (view: SettingsView) => void;
  isMenuOpen: boolean;
  setIsMenuOpen: (isOpen: boolean) => void;
  formDraft: FormDraft | null;
  setFormDraft: (draft: FormDraft | null) => void;
  hanimeDraft: HanimeDraft | null;
  setHanimeDraft: (draft: HanimeDraft | null) => void;
  actorDraft: ActorDraft | null;
  setActorDraft: (draft: ActorDraft | null) => void;
  studioDraft: StudioDraft | null;
  setStudioDraft: (draft: StudioDraft | null) => void;
  coomerDraft: CoomerDraft | null;
  setCoomerDraft: (draft: CoomerDraft | null) => void;
  coomerActiveTab: 'Instagram' | 'OnlyFans';
  setCoomerActiveTab: (tab: 'Instagram' | 'OnlyFans') => void;
  stashDbSearchMode: 'actor' | 'studio' | 'sexmex' | 'jav';
  setStashDbSearchMode: React.Dispatch<React.SetStateAction<'actor' | 'studio' | 'sexmex' | 'jav'>>;
  cycleStashDbSearchMode: () => void;
  pageRegistry: Record<string, number>;
  setPageRegistry: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  isHydrated: boolean;
  hydrationError: string | null;
  actorMap: Map<string, Actor>;
  studioMap: Map<string, Studio>;
  actorUsageMap: Record<string, number>;
  studioUsageMap: Record<string, number>;
  actorStudioAffinityMap: Record<string, Record<string, number>>;
  notifications: { id: string; message: string; type: 'success' | 'error' }[];
  addNotification: (message: string, type: 'success' | 'error') => void;
  removeNotification: (id: string) => void;
}

const STORAGE_KEY = 'linkvault_state_v18_final';

const defaultSettings: AppSettings = {
  theme: 'Dark',
  accentColor: '#3b82f6',
  actorNameColor: '#3b82f6',
  circleBorderColor: '#ffffff',
  torboxApiKey: '',
  enableTorbox: true,
  realDebridApiKey: '',
  enableRealDebrid: true,
  geminiApiKey: '',
  enableGemini: true,
  autoSync: false,
  titleSize: 'Medium',
  metadataSize: 'Small',
  showActorCheckmark: true,
  enableGalleryPreview: true,
  sortOrder: 'Newest',
  itemsPerPage: 20,
  blurIntensity: 30,
  blurCovers: false,
  gradientMask: true,
  transparentHeader: false,
  headerElementBorder: true,
  headerBottomBorder: true,
  buttonStyle: 'Glass',
  buttonColor: '#3b82f6',
  hiddenStashDbStudios: [],
  galleryBgColor: '#1a1a1acc',
  headerOpacity: 100,
  headerTheme: 'Default',
  fontFamily: 'Plus Jakarta Sans',
};

const initialState: AppState = {
  links: [],
   hanime: [],
  actors: [],
  coomers: [],
  studios: [],
  settings: defaultSettings,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const hasLocalChangesRef = useRef(false);
  const addedActorsSyncRef = useRef<Map<string, string>>(new Map());
  const addedStudiosSyncRef = useRef<Map<string, string>>(new Map());
  const [state, setRawState] = useState<AppState>(initialState);
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;
  
  const setState = useCallback((value: React.SetStateAction<AppState>) => {
    hasLocalChangesRef.current = true;
    setRawState(prev => {
      const next = typeof value === 'function' ? (value as (p: AppState) => AppState)(prev) : value;
      stateRef.current = next;
      return next;
    });
  }, []);

  const [isHydrated, setIsHydrated] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsView, setSettingsView] = useState<SettingsView>('main');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
    }).catch(err => {
      console.error("Supabase auth error:", err);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const [formDraft, setFormDraft] = useState<FormDraft | null>(null);
  const [hanimeDraft, setHanimeDraft] = useState<HanimeDraft | null>(null);
  const [actorDraft, setActorDraft] = useState<ActorDraft | null>(null);
  const [studioDraft, setStudioDraft] = useState<StudioDraft | null>(null);
  const [coomerDraft, setCoomerDraft] = useState<CoomerDraft | null>(null);
  const [coomerActiveTab, setCoomerActiveTab] = useState<'Instagram' | 'OnlyFans'>('Instagram');
  const [stashDbSearchMode, setStashDbSearchMode] = useState<'actor' | 'studio' | 'sexmex' | 'jav'>('actor');

  const cycleStashDbSearchMode = useCallback(() => {
    setStashDbSearchMode(prev => {
      if (prev === 'actor') return 'studio';
      if (prev === 'studio') return 'sexmex';
      if (prev === 'sexmex') return 'jav';
      return 'actor';
    });
  }, []);

  const [pageRegistry, setPageRegistry] = useState<Record<string, number>>({});
  const [notifications, setNotifications] = useState<{ id: string; message: string; type: 'success' | 'error' }[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const addNotification = useCallback((message: string, type: 'success' | 'error') => {
    const id = Math.random().toString(36).substring(2, 11);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeNotification(id), 3000);
  }, [removeNotification]);

  useEffect(() => {
    const handleNotification = (e: Event) => {
      const customEvent = e as CustomEvent;
      addNotification(customEvent.detail.message, customEvent.detail.type);
    };
    window.addEventListener('app-notification', handleNotification);
    return () => window.removeEventListener('app-notification', handleNotification);
  }, [addNotification]);

  useEffect(() => {
    const font = state.settings.fontFamily || 'Plus Jakarta Sans';
    const fontCss = FONT_FAMILY_MAP[font] || FONT_FAMILY_MAP['Plus Jakarta Sans'];
    document.documentElement.style.setProperty('--system-font', fontCss);
    document.body.style.fontFamily = fontCss;
  }, [state.settings.fontFamily]);

  const actorMap = useMemo(() => new Map(state.actors.map(a => [a.id, a])), [state.actors]);
  const studioMap = useMemo(() => new Map(state.studios.map(t => [t.id, t])), [state.studios]);

  const actorUsageMap = useMemo(() => {
    const map: Record<string, number> = {};
    (state.links || []).forEach(l => (l?.actorIds || []).forEach(aid => map[aid] = (map[aid] || 0) + 1));
    return map;
  }, [state.links]);

  const studioUsageMap = useMemo(() => {
    const map: Record<string, number> = {};
    (state.links || []).forEach(l => (l?.studioIds || []).forEach(sid => map[sid] = (map[sid] || 0) + 1));
    return map;
  }, [state.links]);

  const actorStudioAffinityMap = useMemo(() => {
    const affinity: Record<string, Record<string, number>> = {};
    (state.links || []).forEach(link => {
      (link?.actorIds || []).forEach(actorId => {
        if (!affinity[actorId]) affinity[actorId] = {};
        (link?.studioIds || []).forEach(studioId => {
          affinity[actorId][studioId] = (affinity[actorId][studioId] || 0) + 1;
        });
      });
    });
    return affinity;
  }, [state.links]);

  // Initial load from IndexedDB with migration fallback from localStorage
  useEffect(() => {
    const hydrate = async () => {
      try {
        const saved = await storage.getItem(STORAGE_KEY);
        if (saved) {
          const loadedStudios = saved.studios || saved.tags || [];
          const loadedLinks = (saved.links || []).map((l: any) => ({
            ...l,
            actorIds: l.actorIds || [],
            studioIds: l.studioIds || l.tagIds || []
          }));

          // Automatically cache and prune legacy availableImages arrays from actors
          const loadedActors = (saved.actors || []).map((a: Actor) => cleanActorForState(a));

          setRawState({
            ...initialState,
            ...saved,
            actors: loadedActors,
            studios: loadedStudios,
            links: loadedLinks,
            settings: { ...defaultSettings, ...(saved.settings || {}) }
          });
        } else {
          // Fallback to localStorage migration for legacy users
          const legacy = localStorage.getItem(STORAGE_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy);
            const loadedStudios = parsed.studios || parsed.tags || [];
            const loadedLinks = (parsed.links || []).map((l: any) => ({
              ...l,
              actorIds: l.actorIds || [],
              studioIds: l.studioIds || l.tagIds || []
            }));
            const loadedActors = (parsed.actors || []).map((a: Actor) => cleanActorForState(a));

            const migratedState = {
              ...initialState,
              ...parsed,
              actors: loadedActors,
              studios: loadedStudios,
              links: loadedLinks,
              settings: { ...defaultSettings, ...(parsed.settings || {}) }
            };
            setRawState(migratedState);
            await storage.setItem(STORAGE_KEY, migratedState);
            // Optional: clean up localStorage after successful migration
            // localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (e) {
        console.error("Hydration failed", e);
        setHydrationError(e instanceof Error ? e.message : 'Unknown hydration error');
      } finally {
        setIsHydrated(true);
      }
    };
    hydrate();
  }, []);

  // Persist state to IndexedDB on changes
  useEffect(() => {
    if (!isHydrated) return;
    const handler = setTimeout(async () => {
      try {
        await storage.setItem(STORAGE_KEY, state);
        if (hasLocalChangesRef.current) {
          localStorage.setItem('local_state_updated_at', Date.now().toString());
        }
      } catch (e) {
        console.error("Save to IndexedDB failed", e);
      }
    }, 500);

    const handleFlush = () => {
      if (hasLocalChangesRef.current) {
        storage.setItem(STORAGE_KEY, state).catch(() => {});
        localStorage.setItem('local_state_updated_at', Date.now().toString());
      }
    };

    window.addEventListener('beforeunload', handleFlush);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleFlush();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(handler);
      window.removeEventListener('beforeunload', handleFlush);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [state, isHydrated]);

  // Auto-Pull from Supabase on load/login
  useEffect(() => {
    if (!isHydrated || !state.settings.autoSync || !currentUser) return;

    const pullIfNewer = async () => {
      try {
        const { data: cloudMetadata, error: fetchError } = await supabase
          .from('user_data')
          .select('updated_at')
          .eq('id', currentUser.id)
          .single();

        if (fetchError || !cloudMetadata) return;

        const cloudTime = new Date(cloudMetadata.updated_at).getTime();
        const localTimeStr = localStorage.getItem('local_state_updated_at');
        const localTime = localTimeStr ? parseInt(localTimeStr, 10) : 0;

        if (cloudTime > localTime) {
          console.log("Cloud data is newer, pulling...");
          const { data: cloudData, error: dataError } = await supabase
            .from('user_data')
            .select('data')
            .eq('id', currentUser.id)
            .single();

          if (!dataError && cloudData?.data) {
            await importData(cloudData.data, true);
            addNotification("Auto-synced latest changes from cloud", "success");
            localStorage.setItem('local_state_updated_at', cloudTime.toString());
          }
        }
      } catch (e) {
        console.error("Auto-pull check failed", e);
      }
    };

    pullIfNewer();
  }, [isHydrated, currentUser, state.settings.autoSync]);

  const isAutoSyncingRef = useRef(false);
  const autoSyncFailuresRef = useRef(0);
  const lastSyncedHashRef = useRef<string>('');

  // Auto-Sync (Push) to Supabase
  useEffect(() => {
    if (!isHydrated || !state.settings.autoSync || !currentUser || !hasLocalChangesRef.current) return;

    const handler = setTimeout(async () => {
      if (isAutoSyncingRef.current) return;
      isAutoSyncingRef.current = true;
      let dataPayload = '';
      try {
        const sanitized = sanitizeStateForExport(state);
        const serialized = JSON.stringify(sanitized);
        const currentHash = await computeDataHash(serialized);

        // Skip upload if data has not changed since last successful sync
        if (currentHash === lastSyncedHashRef.current) {
          hasLocalChangesRef.current = false;
          return;
        }

        dataPayload = await compressData(sanitized);
        const { error } = await supabase
          .from('user_data')
          .upsert({ id: currentUser.id, data: dataPayload, updated_at: new Date().toISOString() });
        
        if (error) throw error;
        
        lastSyncedHashRef.current = currentHash;
        // Update local timestamp so we don't accidentally pull what we just pushed
        localStorage.setItem('local_state_updated_at', Date.now().toString());
        hasLocalChangesRef.current = false;
        autoSyncFailuresRef.current = 0; // Reset failures on success
      } catch (e: any) {
        console.error("Auto-sync failed", e);
        autoSyncFailuresRef.current += 1;
        
        if (autoSyncFailuresRef.current === 1) {
           const sizeMb = (new Blob([dataPayload]).size / (1024 * 1024)).toFixed(2);
           const errorMsg = e?.message || e?.details || 'Network error';
           if (errorMsg.includes('413') || errorMsg.toLowerCase().includes('too large') || Number(sizeMb) > 1.5) {
             addNotification(`Auto-sync failed: Data size (${sizeMb}MB) exceeds limit. Please use image URLs instead of uploading files.`, "error");
           } else {
             addNotification(`Auto-sync failed: ${errorMsg}`, "error");
           }
        }
      } finally {
        isAutoSyncingRef.current = false;
      }
    }, 5000); // 5s debounce

    return () => clearTimeout(handler);
  }, [state, isHydrated, currentUser, addNotification]);

  const addLink = (link: Omit<LinkItem, 'id'>) => {
    const newLink: LinkItem = {
      ...link,
      id: Math.random().toString(36).substr(2, 9),
      createdAt: Date.now(),
    };
    const nextState: AppState = {
      ...stateRef.current,
      links: [newLink, ...stateRef.current.links],
    };
    stateRef.current = nextState;
    setState(prev => ({ ...prev, links: [newLink, ...prev.links] }));
    storage.setItem(STORAGE_KEY, nextState).catch(e => {
      console.error("Direct IndexedDB save in addLink failed", e);
    });
    localStorage.setItem('local_state_updated_at', Date.now().toString());
  };

  const addLinks = async (links: Array<Omit<LinkItem, 'id'>>): Promise<LinkItem[]> => {
    if (!links || links.length === 0) return [];
    const newLinks: LinkItem[] = links.map(link => ({
      ...link,
      id: Math.random().toString(36).substr(2, 9),
      createdAt: Date.now(),
    }));
    const nextState: AppState = {
      ...stateRef.current,
      links: [...newLinks, ...stateRef.current.links],
    };
    stateRef.current = nextState;
    setState(prev => ({ ...prev, links: [...newLinks, ...prev.links] }));
    try {
      await storage.setItem(STORAGE_KEY, nextState);
      localStorage.setItem('local_state_updated_at', Date.now().toString());
    } catch (e) {
      console.error("Direct IndexedDB save in addLinks failed", e);
    }
    return newLinks;
  };

  const updateLink = (id: string, updates: Partial<LinkItem>) => {
    setState(prev => ({
      ...prev,
      links: prev.links.map(l => l.id === id ? { ...l, ...updates } : l),
    }));
  };

  const deleteLink = useCallback((id: string) => {
    setState(prev => {
      const item = prev.links.find(l => l.id === id);
      if (!item) return prev;
      return {
        ...prev,
        links: prev.links.filter(l => l.id !== id),
      };
    });
  }, []);

  const clearAllData = useCallback((options?: {
    actors?: boolean;
    studios?: boolean;
    settings?: boolean;
    hanime?: boolean;
    links?: boolean;
    coomers?: boolean;
  }) => {
    setState(prev => {
      const clearAll = !options;
      return {
        ...prev,
        links: (clearAll || options?.links) ? [] : prev.links,
        actors: (clearAll || options?.actors) ? [] : prev.actors,
        studios: (clearAll || options?.studios) ? [] : prev.studios,
        hanime: (clearAll || options?.hanime) ? [] : prev.hanime,
        coomers: (clearAll || options?.coomers) ? [] : prev.coomers,
        settings: (clearAll || options?.settings) ? defaultSettings : prev.settings,
      };
    });
  }, []);

  const addActor = (actor: Omit<Actor, 'id'>): string => {
    const lowerName = actor.name.toLowerCase();
    
    // Check if it already exists in the current state
    const existingInState = state.actors.find(a => a.name.toLowerCase() === lowerName && true);
    if (existingInState) return existingInState.id;
    
    // Check if it was added synchronously in this render cycle
    if (addedActorsSyncRef.current.has(lowerName)) {
      return addedActorsSyncRef.current.get(lowerName)!;
    }
    
    const id = Math.random().toString(36).substr(2, 9);
    addedActorsSyncRef.current.set(lowerName, id);

    // Cache available images locally if provided and strip from state
    if (actor.availableImages && actor.availableImages.length > 0) {
      if (actor.stashDbId) cacheActorImages(actor.stashDbId, actor.availableImages);
      cacheActorImages(actor.name, actor.availableImages);
    }
    const cleanActor = cleanActorForState(actor as Actor);
    
    setState(prev => {
      // Double check in prev just to be absolutely sure we don't duplicate on flush
      const existingInPrev = prev.actors.find(a => a.name.toLowerCase() === lowerName && true);
      if (existingInPrev) return prev;
      
      return {
        ...prev,
        actors: [...prev.actors, { ...cleanActor, id, createdAt: Date.now() }]
      };
    });
    return id;
  };

  const updateActor = (id: string, updates: Partial<Actor>) => {
    if (updates.availableImages && updates.availableImages.length > 0) {
      if (updates.stashDbId) cacheActorImages(updates.stashDbId, updates.availableImages);
      if (updates.name) cacheActorImages(updates.name, updates.availableImages);
    }
    const { availableImages, ...cleanUpdates } = updates;
    setState(prev => ({
      ...prev,
      actors: prev.actors.map(a => a.id === id ? { ...a, ...cleanUpdates } : a)
    }));
  };

  const deleteActor = (id: string) => {
    setState(prev => {
      const keptLinks = prev.links.filter(l => !(l.actorIds.includes(id) && l.actorIds.length === 1));
      return {
        ...prev,
        actors: prev.actors.filter(a => a.id !== id),
        links: keptLinks.map(l => ({ ...l, actorIds: l.actorIds.filter(aid => aid !== id) })),
      };
    });
  };

  const mergeActors = (sourceId: string, targetId: string) => {
    setState(prev => {
      return {
        ...prev,
        actors: prev.actors.filter(a => a.id !== sourceId),
        links: prev.links.map(l => {
          if (l.actorIds.includes(sourceId)) {
            const updatedActorIds = l.actorIds.filter(aid => aid !== sourceId);
            if (!updatedActorIds.includes(targetId)) {
              updatedActorIds.push(targetId);
            }
            return { ...l, actorIds: updatedActorIds };
          }
          return l;
        })
      };
    });
  };

  const addCoomer = useCallback((coomer: Omit<Coomer, 'id'>): string => {
    const id = Math.random().toString(36).substr(2, 9);
    setState(prev => ({
      ...prev,
      coomers: [...prev.coomers, { ...coomer, id, createdAt: Date.now() }]
    }));
    return id;
  }, []);

  const updateCoomer = useCallback((id: string, updates: Partial<Coomer>) => {
    if (updates.posts && Array.isArray(updates.posts) && updates.posts.length > 0) {
      cacheCoomerPosts(id, updates.posts).catch(() => {});
    }
    setState(prev => ({
      ...prev,
      coomers: prev.coomers.map(c => c.id === id ? { ...c, ...updates } : c)
    }));
  }, []);

  const deleteCoomer = useCallback((id: string) => {
    removeCachedCoomerPosts(id).catch(() => {});
    setState(prev => ({
      ...prev,
      coomers: prev.coomers.filter(c => c.id !== id),
    }));
  }, []);

  const restoreCoomer = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      coomers: prev.coomers.map(c => c.id === id ? { ...c } : c)
    }));
  }, []);

  const permDeleteCoomer = useCallback((id: string) => {
    removeCachedCoomerPosts(id).catch(() => {});
    setState(prev => ({ 
      ...prev, 
      coomers: prev.coomers.filter(c => c.id !== id),
    }));
  }, []);

  const addStudio = (studio: Omit<Studio, 'id'>): string => {
    const lowerName = studio.name.toLowerCase();
    
    const existingInState = state.studios.find(s => s.name.toLowerCase() === lowerName && true);
    if (existingInState) return existingInState.id;
    
    if (addedStudiosSyncRef.current.has(lowerName)) {
      return addedStudiosSyncRef.current.get(lowerName)!;
    }
    
    const id = Math.random().toString(36).substr(2, 9);
    addedStudiosSyncRef.current.set(lowerName, id);
    
    setState(prev => {
      const existingInPrev = prev.studios.find(s => s.name.toLowerCase() === lowerName && true);
      if (existingInPrev) return prev;
      
      return {
        ...prev,
        studios: [...prev.studios, { ...studio, id, createdAt: Date.now() }]
      };
    });
    return id;
  };

  const updateStudio = (id: string, updates: Partial<Studio>) => {
    setState(prev => ({
      ...prev,
      studios: prev.studios.map(t => t.id === id ? { ...t, ...updates } : t)
    }));
  };

  const deleteStudio = (id: string) => {
    setState(prev => {
      const keptLinks = prev.links.filter(l => !(l.studioIds.includes(id) && l.studioIds.length === 1));
      return {
        ...prev,
        studios: prev.studios.filter(t => t.id !== id),
        links: keptLinks.map(l => ({ ...l, studioIds: l.studioIds.filter(sid => sid !== id) })),
      };
    });
  };

  const mergeStudios = (sourceId: string, targetId: string) => {
    setState(prev => {
      return {
        ...prev,
        studios: prev.studios.filter(t => t.id !== sourceId),
        links: prev.links.map(l => {
          if (l.studioIds.includes(sourceId)) {
            const updatedStudioIds = l.studioIds.filter(sid => sid !== sourceId);
            if (!updatedStudioIds.includes(targetId)) {
              updatedStudioIds.push(targetId);
            }
            return { ...l, studioIds: updatedStudioIds };
          }
          return l;
        })
      };
    });
  };

  const addHanime = (hanime: Omit<HanimeItem, 'id'>): string => {
    const id = Math.random().toString(36).substr(2, 9);
    setState(prev => ({
      ...prev,
      hanime: [...prev.hanime, { ...hanime, id, createdAt: Date.now() }]
    }));
    return id;
  };

  const updateHanime = (id: string, updates: Partial<HanimeItem>) => {
    setState(prev => ({
      ...prev,
      hanime: prev.hanime.map(h => h.id === id ? { ...h, ...updates } : h)
    }));
  };

  const deleteHanime = (id: string) => {
    setState(prev => ({
      ...prev,
      hanime: prev.hanime.filter(h => h.id !== id),
    }));
  };

  const restoreHanime = (id: string) => {
    setState(prev => ({
      ...prev,
      hanime: prev.hanime.map(h => h.id === id ? { ...h } : h)
    }));
  };

  const permDeleteHanime = (id: string) => {
    setState(prev => ({ 
      ...prev, 
      hanime: prev.hanime.filter(h => h.id !== id),
    }));
  };

  const updateSettings = (updates: Partial<AppSettings>) => {
    setState(prev => ({ ...prev, settings: { ...prev.settings, ...updates } }));
  };

  const toggleSort = (viewType: string, currentSortOrder: SortOrder) => {
    const defaultOrders: SortOrder[] = ['Newest', 'Oldest', 'DateDesc', 'DateAsc'];
    const azOrders: SortOrder[] = ['Newest', 'Oldest', 'A-Z', 'Z-A'];
    
    let orders = defaultOrders;
    if (viewType === 'hanime') {
        orders = ['Newest', 'Oldest', 'DateDesc', 'DateAsc', 'A-Z', 'Z-A'];
    } else if (viewType === 'actors' || viewType === 'studios' || viewType === 'coomers') {
        orders = azOrders;
    }

    const currentIndex = orders.indexOf(currentSortOrder);
    const nextIndex = (currentIndex + 1) % orders.length;
    const nextOrder = orders[nextIndex];

    const updates: Partial<AppSettings> = {};
    if (viewType === 'home') updates.homeSortOrder = nextOrder;
    else if (viewType === 'actors') updates.actorSortOrder = nextOrder;
    else if (viewType === 'studios') updates.studioSortOrder = nextOrder;
    else if (viewType === 'coomers') updates.coomerSortOrder = nextOrder;
    else if (viewType === 'hanime') updates.hanimeSortOrder = nextOrder;
    else if (viewType === 'actorLinks') updates.actorLinksSortOrder = nextOrder;
    else if (viewType === 'studioLinks') updates.studioLinksSortOrder = nextOrder;
    else updates.sortOrder = nextOrder;

    updateSettings(updates);
  };

  const runSystemCheck = useCallback(async () => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    setState(prev => {
      const missavStudio = prev.studios.find(t => t.name.toUpperCase() === 'MISSAV' && true);
      const codeRegex = /[A-Z0-9]{2,10}-\d{2,10}/i;
      
      const updateLinkSet = (linkSet: any[]) => linkSet.map(link => {
        const target = link.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const currentActorIds = new Set(link.actorIds || []);
        const currentStudioIds = new Set(link.studioIds || []);
        
        (prev.actors || []).forEach(actor => {
          
          const cleanActor = actor.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanActor.length > 2 && target.includes(cleanActor)) currentActorIds.add(actor.id);
        });

        (prev.studios || []).forEach(studio => {
          
          const cleanStudio = studio.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanStudio.length > 1 && target.includes(cleanStudio)) currentStudioIds.add(studio.id);
        });

        if (missavStudio && codeRegex.test(link.title)) currentStudioIds.add(missavStudio.id);

        return {
          ...link,
          actorIds: Array.from(currentActorIds),
          studioIds: Array.from(currentStudioIds)
        };
      });

      return { 
        ...prev, 
        links: updateLinkSet(prev.links), 
      };
    });
  }, []);

  const importData = async (dataInput: string | object, isFromCloud: boolean = false): Promise<boolean> => {
    try {
      const data = await decompressData(dataInput);
      if (data && typeof data === 'object') {
        const newState: AppState = {
          links: (Array.isArray(data.links) ? data.links : []).map((l: any) => ({
            ...l,
            studioIds: l.studioIds || l.tagIds || []
          })),
          hanime: Array.isArray(data.hanime) ? data.hanime : [],
          actors: (Array.isArray(data.actors) ? data.actors : []).map((a: Actor) => cleanActorForState(a)),
          coomers: Array.isArray(data.coomers) ? data.coomers : [],
          studios: Array.isArray(data.studios) ? data.studios : (Array.isArray(data.tags) ? data.tags : []),
          settings: { ...defaultSettings, ...(data.settings || {}) }
        };
        console.log(`[ImportData] Decoded state has ${newState.links.length} links and ${newState.actors.length} actors.`);
        
        if (isFromCloud) {
          setRawState(newState);
        } else {
          setState(newState);
        }
        
        addNotification(`Data imported successfully (${newState.links.length} links).`, "success");
        return true;
      }
      return false;
    } catch (e) {
      console.error("Import failed", e);
      addNotification("Failed to parse import data.", "error");
      return false;
    }
  };

  const contextValue = useMemo(() => ({
    state, addLink, addLinks, updateLink, deleteLink, clearAllData,
    addActor, updateActor, deleteActor, mergeActors,
    addCoomer, updateCoomer, deleteCoomer, restoreCoomer, permDeleteCoomer,
    addStudio, updateStudio, deleteStudio, mergeStudios,
    addHanime, updateHanime, deleteHanime, restoreHanime, permDeleteHanime,
    updateSettings, toggleSort, importData, runSystemCheck, searchQuery, setSearchQuery,
    settingsView, setSettingsView,
    isMenuOpen, setIsMenuOpen,
    formDraft, setFormDraft,
    hanimeDraft, setHanimeDraft,
    actorDraft, setActorDraft,
    studioDraft, setStudioDraft,
    coomerDraft, setCoomerDraft,
    coomerActiveTab, setCoomerActiveTab,
    stashDbSearchMode, setStashDbSearchMode, cycleStashDbSearchMode,
    pageRegistry, setPageRegistry,
    isHydrated,
    hydrationError,
    actorMap,
    studioMap,
    actorUsageMap,
    studioUsageMap,
    actorStudioAffinityMap,
    notifications, addNotification, removeNotification,
  }), [
    state, searchQuery, settingsView, isMenuOpen, formDraft, hanimeDraft, actorDraft, studioDraft, coomerDraft, 
    coomerActiveTab, stashDbSearchMode, cycleStashDbSearchMode, pageRegistry, isHydrated, hydrationError, actorMap, studioMap, actorUsageMap, studioUsageMap, actorStudioAffinityMap, clearAllData, runSystemCheck, notifications,
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
