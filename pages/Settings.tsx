
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, Play, Film } from 'lucide-react';
import { ColorSlider } from "../components/ColorSlider";
import { ValueSlider } from "../components/ValueSlider";
import { useApp, SettingsView } from '../AppContext';
import { Icons } from '../constants';
import { ThemeMode, DisplaySize } from '../types';
import { supabase, isSupabaseConfigured } from '../supabase';
import { compressData } from '../utils/compression';
import { sanitizeStateForExport, exportBackupData, readImportBackupFile } from '../utils/exportHelper';

const TelegramGroup: React.FC<{ children?: React.ReactNode; title?: string; roundedClass?: string }> = ({ children, title, roundedClass = "rounded-[28px]" }) => (
  <div className="mb-6">
    {title && (
      <h2 className="px-5 mb-2 text-[13px] font-semibold text-[var(--accent)] uppercase tracking-tight opacity-90">
        {title}
      </h2>
    )}
    <div className={`bg-[var(--surface)] overflow-hidden border border-[var(--border)] shadow-sm ${roundedClass}`}>
      {children}
    </div>
  </div>
);

const TelegramItem: React.FC<{
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description?: string;
  rightElement?: React.ReactNode;
  onClick?: () => void;
  isDestructive?: boolean;
}> = ({ icon, iconBg, title, description, rightElement, onClick, isDestructive }) => (
  <div
    onClick={onClick}
    className={`w-full flex items-center gap-4 px-4 py-3.5 active:bg-[var(--text-primary)]/[0.05] transition-colors text-left border-b border-[var(--border)] last:border-none outline-none tap-highlight-none ${onClick ? 'cursor-pointer' : ''}`}
  >
    <div 
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm"
      style={{ backgroundColor: iconBg }}
    >
      <div className="w-5 h-5 text-white flex items-center justify-center">
        {icon}
      </div>
    </div>
    <div className="flex-1 min-w-0">
      <div className={`text-[15px] font-medium leading-tight truncate ${isDestructive ? 'text-rose-500' : 'text-[var(--text-primary)]'}`}>
        {title}
      </div>
      {description && (
        <div className={`text-[13px] mt-0.5 truncate opacity-60 ${isDestructive ? 'text-rose-500/80' : 'text-[var(--text-muted)]'}`}>
          {description}
        </div>
      )}
    </div>
    <div className="shrink-0 flex items-center gap-2">
      {rightElement}
      {!rightElement && <div className="opacity-20"><Icons.ChevronRight /></div>}
    </div>
  </div>
);

const TelegramSelectionItem: React.FC<{
  label: string;
  isSelected: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}> = ({ label, isSelected, onClick, style }) => (
  <div
    onClick={onClick}
    className="w-full flex items-center justify-between px-5 py-4 active:bg-[var(--text-primary)]/[0.05] transition-colors border-b border-[var(--border)] last:border-none outline-none tap-highlight-none cursor-pointer"
  >
    <span style={style} className={`text-[15px] transition-colors duration-200 ${isSelected ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-primary)] font-medium opacity-90'}`}>
      {label}
    </span>
    {isSelected && (
      <div className="text-[var(--accent)] flex items-center justify-center animate-slide-forward">
        <Icons.Check />
      </div>
    )}
  </div>
);

const Toggle: React.FC<{ 
  isActive: boolean; 
  onToggle: () => void 
}> = ({ isActive, onToggle }) => (
  <div
    onClick={(e) => { e.stopPropagation(); onToggle(); }}
    className={`w-12 h-6 rounded-full transition-colors relative flex items-center px-1 shrink-0 cursor-pointer ${isActive ? 'bg-[var(--accent)]' : 'bg-[var(--toggle-off-bg)]'}`}
    style={{ border: !isActive ? '1px solid var(--border)' : '1px solid transparent' }}
  >
    <div 
      className={`w-4 h-4 rounded-full bg-white transition-all duration-300 shadow-sm ${isActive ? 'translate-x-6' : 'translate-x-0'}`} 
    />
  </div>
);

const VIEW_LEVELS: Record<string, number> = {
  'main': 0,
  'profile': 1,
  'theme': 1,
  'header': 1,
  'cover': 1,
  'display': 1,
  'integrations': 1,
  'data': 1,
  'advanced': 1,
};

const CloudSyncItem: React.FC = () => {
  const { state, importData, addNotification, updateSettings } = useApp();
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingUp, setIsSyncingUp] = useState(false);
  const [isSyncingDown, setIsSyncingDown] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    }).catch(err => {
      console.error("Supabase auth error:", err);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          skipBrowserRedirect: true,
        }
      });
      if (error) throw error;
      
      if (data?.url) {
        const popup = window.open(data.url, 'oauth_popup', 'width=600,height=700');
        
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed);
            if (isLoading) setIsLoading(false);
          }
        }, 1000);

        // Listen for message from popup
        const handleMessage = async (event: MessageEvent) => {
          if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            if (popup && !popup.closed) popup.close();
            clearInterval(checkClosed);
            
            const hash = event.data.hash;
            if (hash && hash.includes('access_token')) {
              const hashStr = hash.startsWith('#') ? hash.substring(1) : hash;
              const hashParams = new URLSearchParams(hashStr);
              const accessToken = hashParams.get('access_token');
              const refreshToken = hashParams.get('refresh_token');
              if (accessToken && refreshToken) {
                await supabase.auth.setSession({
                  access_token: accessToken,
                  refresh_token: refreshToken
                });
              }
            }

            supabase.auth.getSession().then(({ data: { session } }) => {
              if (session) {
                // state update will happen via subscription, but we can stop loading
              }
              setIsLoading(false);
            }).catch(err => {
              console.error("Supabase auth error:", err);
              setIsLoading(false);
            });
          }
        };
        window.addEventListener('message', handleMessage);
      }
    } catch (e: any) {
      addNotification("Login failed: " + e.message, "error");
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      addNotification("Please enter email and password", "error");
      return;
    }
    try {
      setIsLoading(true);
      
      let res;
      if (authMode === 'signUp') {
        res = await supabase.auth.signUp({
          email,
          password,
        });
      } else {
        res = await supabase.auth.signInWithPassword({
          email,
          password,
        });
      }

      if (res.error) throw res.error;
      
      // If it's sign up and no session, tell user to confirm email
      if (authMode === 'signUp' && !res.data.session) {
        addNotification("Registration successful! You may need to verify your email.", "success");
      }
      
      // Note: On success, onAuthStateChange handles setting the user.
    } catch (e: any) {
      addNotification(`Auth failed: ${e.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      localStorage.removeItem('local_state_updated_at');
      addNotification("Successfully logged out", "success");
    } catch (e: any) {
      addNotification("Logout failed", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncToCloud = async () => {
    if (!user) return;
    try {
      setIsSyncingUp(true);
      const sanitized = sanitizeStateForExport(state);
      const compressedData = await compressData(sanitized);
      
      const { error } = await supabase
        .from('user_data')
        .upsert({ id: user.id, data: compressedData, updated_at: new Date().toISOString() });
        
      if (error) throw error;
      localStorage.setItem('local_state_updated_at', Date.now().toString());
      addNotification("Data successfully synced to cloud (compressed)!", "success");
    } catch (e: any) {
      addNotification("Sync failed: " + e.message, "error");
    } finally {
      setIsSyncingUp(false);
    }
  };

  const handleDownloadFromCloud = async () => {
    if (!user) return;
    try {
      setIsSyncingDown(true);
      const { data, error } = await supabase
        .from('user_data')
        .select('data')
        .eq('id', user.id)
        .single();
        
      if (error && error.code !== 'PGRST116') throw error;
      
      if (data?.data) {
        await importData(data.data, true);
        localStorage.setItem('local_state_updated_at', Date.now().toString());
      } else {
        addNotification("No backup found in cloud.", "error");
      }
    } catch (e: any) {
      addNotification("Failed to fetch cloud data: " + e.message, "error");
    } finally {
      setIsSyncingDown(false);
    }
  };

  if (isLoading) {
    return <div className="p-4 text-center text-gray-400 font-medium">Loading auth...</div>;
  }

  if (user) {
    return (
      <div className="flex flex-col w-full">
        <div className="flex flex-col gap-2 p-5 border-b border-[var(--border)]">
          <p className="text-[13px] text-[var(--accent)] font-semibold">LOGGED IN AS</p>
          <p className="text-[15px] text-[var(--text-primary)] break-all">{user.email}</p>
        </div>
        <TelegramItem 
          icon={<div className={`flex items-center justify-center ${state.settings.autoSync ? 'text-white' : 'text-gray-400'}`}><Icons.Check /></div>}
          iconBg={state.settings.autoSync ? "#3b82f6" : "#4b5563"}
          title="Automatic Cloud Sync" 
          description={state.settings.autoSync ? "Enabled: Syncs changes automatically" : "Disabled"}
          onClick={() => updateSettings({ autoSync: !state.settings.autoSync })}
          rightElement={<div className={`w-12 h-6 rounded-full flex items-center p-1 cursor-pointer transition-colors ${state.settings.autoSync ? 'bg-[var(--accent)]' : 'bg-[var(--card-bg-highlight)]'}`}><div className={`w-4 h-4 bg-white rounded-full transition-transform ${state.settings.autoSync ? 'translate-x-6' : 'translate-x-0'}`} /></div>}
        />
        <TelegramItem 
          icon={isSyncingUp ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Icons.Upload />} iconBg="#f59e0b"
          title="Push Local Data to Cloud" description="Upload current data to Supabase"
          onClick={isSyncingUp || isSyncingDown ? undefined : handleSyncToCloud}
        />
        <TelegramItem 
          icon={isSyncingDown ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Icons.Download />} iconBg="#10b981"
          title="Pull Cloud Data to Local" description="Replace local data with Cloud backup"
          onClick={isSyncingUp || isSyncingDown ? undefined : handleDownloadFromCloud}
        />
        <TelegramItem 
          icon={<Icons.Trash />} iconBg="#ef4444"
          title="Logout" description="Sign out from your account"
          onClick={isLoading ? undefined : handleLogout}
          isDestructive={true}
        />
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col items-center">
      <div className="w-full max-w-sm flex flex-col gap-4">
        {!isSupabaseConfigured && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-[28px] p-5 text-[13px] text-[var(--text-primary)] leading-relaxed shadow-sm">
            <div className="font-semibold mb-2 flex items-center gap-2 text-amber-500">
              <Icons.AlertTriangle size={18} className="shrink-0" />
              Supabase Configuration Required
            </div>
            <p className="opacity-85 mb-3">
              This app uses <strong>Supabase</strong> for accounts and cloud sync. The current keys are missing or unconfigured.
            </p>
            <div className="bg-[var(--surface)] p-3 rounded-2xl border border-[var(--border)] text-[12px] font-mono select-all">
              VITE_SUPABASE_URL<br/>
              VITE_SUPABASE_ANON_KEY
            </div>
            <p className="opacity-75 mt-3 text-[12px]">
              Please add these variables in the <strong>Secrets</strong> panel of your <strong>AI Studio</strong> settings to enable cloud authentication.
            </p>
          </div>
        )}
        <form onSubmit={handleEmailAuth} className="flex flex-col gap-3">
          <input 
            type="email" 
            placeholder="Email address"
            className="px-4 py-3 bg-[var(--card-bg)] border border-[var(--border)] rounded-[28px] outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            required
          />
          <input 
            type="password" 
            placeholder="Password"
            className="px-4 py-3 bg-[var(--card-bg)] border border-[var(--border)] rounded-[28px] outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            required
          />
          <button 
            type="submit" 
            disabled={isLoading}
            className="bg-[var(--accent)] text-white font-medium py-3 rounded-[28px] mt-2 disabled:opacity-50"
          >
            {isLoading ? 'Please wait...' : (authMode === 'signIn' ? 'Sign In' : 'Sign Up')}
          </button>
        </form>
        
        <button 
          onClick={() => setAuthMode(m => m === 'signIn' ? 'signUp' : 'signIn')}
          disabled={isLoading}
          className="text-sm text-[var(--accent)] opacity-80 hover:opacity-100 mt-2"
        >
          {authMode === 'signIn' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
        </button>

        <div className="flex items-center gap-4 my-2">
          <div className="h-px bg-[var(--border)] flex-1"></div>
          <span className="text-[12px] text-[var(--text-muted)] font-medium">OR</span>
          <div className="h-px bg-[var(--border)] flex-1"></div>
        </div>

        <button 
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="flex items-center justify-center gap-3 bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] font-medium py-3 rounded-[28px] disabled:opacity-50 hover:bg-[var(--card-bg-highlight)] transition-colors"
        >
          <img src="https://www.google.com/s2/favicons?domain=google.com&sz=128" alt="Google" className="w-5 h-5 rounded-full" />
          Continue with Google
        </button>
      </div>
    </div>
  );
};

export const Settings: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    state, updateSettings, 
    importData, runSystemCheck, clearAllData,
    settingsView, setSettingsView,
    addNotification
  } = useApp();
  const { settings } = state;
  const [transitionDir, setTransitionDir] = useState<'forward' | 'backward'>('forward');
  const prevViewRef = React.useRef<SettingsView>('main');

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearTimer, setClearTimer] = useState(5);
  const [deleteOptions, setDeleteOptions] = useState({
    actors: true,
    studios: true,
    settings: true,
    hanime: true,
    links: true,
    coomers: true
  });
  
  const [customPagination, setCustomPagination] = useState<string>('');
  
  const [studioSearchQuery, setStudioSearchQuery] = useState("");
  const [isSearchingStudios, setIsSearchingStudios] = useState(false);
  const [studioResults, setStudioResults] = useState<{id: string, name: string}[]>([]);
  const searchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = React.useRef<AbortController | null>(null);

  const searchStudios = async (query: string) => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    if (!query.trim()) {
      setStudioResults([]);
      return;
    }
    setIsSearchingStudios(true);
    try {
      const res = await fetch("/api/stashdb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          apiKey: settings.stashDbApiKey,
          query: `query Studios($input: StudioQueryInput!) {
            queryStudios(input: $input) {
              studios { id name }
            }
          }`,
          variables: { input: { name: query, per_page: 20, sort: "NAME", direction: "ASC" } }
        })
      });
      const data = await res.json();
      if (!controller.signal.aborted && data.data?.queryStudios?.studios) {
        setStudioResults(data.data.queryStudios.studios);
      }
    } catch (err: any) {
      // Silently ignore search errors in settings
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingStudios(false);
      }
    }
  };
  const [isEditingPagination, setIsEditingPagination] = useState(false);

  useEffect(() => {
    let timer: any;
    if (showClearConfirm && clearTimer > 0) {
      timer = setTimeout(() => setClearTimer(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [showClearConfirm, clearTimer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showClearConfirm) {
        setShowClearConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showClearConfirm]);

  const navigateTo = useCallback((view: SettingsView, extraState?: any) => {
    setTransitionDir('forward');
    navigate('/settings', { state: { settingsView: view, ...extraState }, replace: true });
  }, [navigate]);

  useEffect(() => {
    const prevLevel = VIEW_LEVELS[prevViewRef.current] || 0;
    const currentLevel = VIEW_LEVELS[settingsView] || 0;
    if (currentLevel < prevLevel) {
      setTransitionDir('backward');
    } else if (currentLevel > prevLevel) {
      setTransitionDir('forward');
    }
    prevViewRef.current = settingsView;
  }, [settingsView]);

  const animationClass = transitionDir === 'forward' ? 'animate-slide-forward' : 'animate-slide-backward';

  const themes: ThemeMode[] = ['Dark', 'Grey', 'Amoled', 'Blue', 'Light'];
  const pageSizes = [10, 20, 30, 50];
  const accentColors = ['#3b82f6', '#a855f7', '#ec4899', '#ef4444', '#22c55e', '#f59e0b', '#06b6d4', '#f97316'];
  const strongAccentColors = ['#2563eb', '#9333ea', '#db2777', '#dc2626', '#16a34a', '#d97706', '#0891b2', '#ea580c'];
  const circleColors = ['#ffffff', '#e0e0e0', '#c0c0c0', '#a0a0a0', '#808080', '#606060', '#404040', '#000000'];

  const renderContent = () => {
    switch (settingsView) {
      case 'main':
        return (
          <>
            <TelegramGroup title="Account">
              <TelegramItem 
                icon={<Icons.User />} iconBg="#f43f5e"
                title="Profile" description="Cloud backup and authentication"
                onClick={() => navigateTo('profile')}
              />
            </TelegramGroup>

            <TelegramGroup title="Preferences">
              <TelegramItem 
                icon={<Icons.Palette />} iconBg="#3b82f6"
                title="Theme" description="Colors, themes, and typography fonts"
                onClick={() => navigateTo('theme')}
              />
              <TelegramItem 
                icon={<Icons.Eye />} iconBg="#ec4899"
                title="Effects" description="Blurs, borders and button styles"
                onClick={() => navigateTo('cover')}
              />
              <TelegramItem 
                icon={<Icons.Type />} iconBg="#94a3b8"
                title="Layout" description="Scaling, previews and pagination"
                onClick={() => navigateTo('display')}
              />
              <TelegramItem 
                icon={<Icons.Radio />} iconBg="#8b5cf6"
                title="Integrations" description="StashDB, Real Debrid, Torbox"
                onClick={() => navigateTo('integrations')}
              />
            </TelegramGroup>

            <TelegramGroup title="System">
              <TelegramItem 
                icon={<Icons.DataIcon />} iconBg="#22c55e"
                title="Data & Backup" description="Backup, restore and delete data"
                onClick={() => navigateTo('data')}
              />
              <TelegramItem 
                icon={<Icons.Settings />} iconBg="#64748b"
                title="Filters" description="Blocked studios and search rules"
                onClick={() => navigateTo('advanced')}
              />
            </TelegramGroup>
          </>
        );

      case 'theme':
        return (
          <>
            <ColorSlider 
              type="theme"
              title="Color Theme" 
              value={settings.theme || 'Dark'} 
              onChange={(t) => updateSettings({ theme: t })} 
              themes={themes as string[]}
            />

            <ColorSlider 
              type="hue"
              title="Primary Accent Color" 
              value={settings.accentColor || '#3b82f6'} 
              onChange={(c) => updateSettings({ accentColor: c })} 
            />

            <ColorSlider 
              type="grayscale"
              title="Progress Ring Color" 
              value={settings.circleBorderColor || '#ffffff'} 
              onChange={(c) => updateSettings({ circleBorderColor: c })} 
            />

            <ColorSlider 
              type="hue"
              title="Action Button Color" 
              value={settings.buttonColor || '#3b82f6'} 
              onChange={(c) => updateSettings({ buttonColor: c })} 
            />

            <TelegramGroup title="Typography & Font">
              <TelegramSelectionItem 
                label="Plus Jakarta Sans" 
                isSelected={(settings.fontFamily || 'Plus Jakarta Sans') === 'Plus Jakarta Sans'} 
                onClick={() => updateSettings({ fontFamily: 'Plus Jakarta Sans' })} 
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              />
              <TelegramSelectionItem 
                label="Inter" 
                isSelected={settings.fontFamily === 'Inter'} 
                onClick={() => updateSettings({ fontFamily: 'Inter' })} 
                style={{ fontFamily: "'Inter', sans-serif" }}
              />
              <TelegramSelectionItem 
                label="Outfit" 
                isSelected={settings.fontFamily === 'Outfit'} 
                onClick={() => updateSettings({ fontFamily: 'Outfit' })} 
                style={{ fontFamily: "'Outfit', sans-serif" }}
              />
              <TelegramSelectionItem 
                label="Manrope" 
                isSelected={settings.fontFamily === 'Manrope'} 
                onClick={() => updateSettings({ fontFamily: 'Manrope' })} 
                style={{ fontFamily: "'Manrope', sans-serif" }}
              />
              <TelegramSelectionItem 
                label="Poppins" 
                isSelected={settings.fontFamily === 'Poppins'} 
                onClick={() => updateSettings({ fontFamily: 'Poppins' })} 
                style={{ fontFamily: "'Poppins', sans-serif" }}
              />
              <TelegramSelectionItem 
                label="Sora" 
                isSelected={settings.fontFamily === 'Sora'} 
                onClick={() => updateSettings({ fontFamily: 'Sora' })} 
                style={{ fontFamily: "'Sora', sans-serif" }}
              />
              <TelegramSelectionItem 
                label="System Native (SF Pro / Segoe)" 
                isSelected={settings.fontFamily === 'System'} 
                onClick={() => updateSettings({ fontFamily: 'System' })} 
                style={{ fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}
              />
            </TelegramGroup>
          </>
        );

      case 'cover':
        return (
          <>
            <ValueSlider
              title="Global Blur Intensity"
              value={settings.blurIntensity || 0}
              onChange={(v) => updateSettings({ blurIntensity: v })}
            />

            <TelegramGroup title="Obscured Elements & Borders">
              <TelegramItem 
                icon={<Icons.Eye />} iconBg="#ec4899"
                title="Blur Image Covers" description="Hide thumbnails globally"
                rightElement={<Toggle isActive={settings.blurCovers !== false} onToggle={() => updateSettings({ blurCovers: settings.blurCovers === false ? true : false })} />}
              />
              <TelegramItem 
                icon={<Film className="w-5 h-5 text-white" />} iconBg="#f59e0b"
                title="Trailer Hover Previews" description="Play video teaser on hover and show preview badge"
                rightElement={<Toggle isActive={settings.enableTrailerPreview !== false} onToggle={() => updateSettings({ enableTrailerPreview: settings.enableTrailerPreview === false ? true : false })} />}
              />
              <TelegramItem 
                icon={<Icons.Palette />} iconBg="#8b5cf6"
                title="Gradient Mask" description="Top & bottom theme gradient on episode cards"
                rightElement={<Toggle isActive={settings.gradientMask !== false} onToggle={() => updateSettings({ gradientMask: settings.gradientMask === false ? true : false })} />}
              />
              <TelegramItem 
                icon={<div className="opacity-80"><Icons.Eye /></div>} iconBg="#10b981"
                title="Transparent Header" description="Make top bar fully transparent"
                rightElement={<Toggle isActive={settings.transparentHeader === true} onToggle={() => updateSettings({ transparentHeader: settings.transparentHeader === true ? false : true })} />}
              />
              <TelegramItem 
                icon={<div className="opacity-80"><Icons.Square /></div>} iconBg="#8b5cf6"
                title="Show Header Outline" description="Display borders around header items"
                rightElement={<Toggle isActive={settings.headerElementBorder !== false} onToggle={() => updateSettings({ headerElementBorder: settings.headerElementBorder === false ? true : false })} />}
              />
              <TelegramItem 
                icon={<div className="opacity-80"><Icons.Minus /></div>} iconBg="#f59e0b"
                title="Show Header Divider" description="Display bottom line on header"
                rightElement={<Toggle isActive={settings.headerBottomBorder !== false} onToggle={() => updateSettings({ headerBottomBorder: settings.headerBottomBorder === false ? true : false })} />}
              />
            </TelegramGroup>

            <ColorSlider 
              type="hue"
              title="Actor Name Color" 
              value={settings.actorNameColor || '#ffffff'} 
              onChange={(c) => updateSettings({ actorNameColor: c })} 
            />

            <TelegramGroup title="Button Appearance">
              <TelegramSelectionItem label="Glassmorphism" isSelected={settings.buttonStyle === 'Glass'} onClick={() => updateSettings({ buttonStyle: 'Glass' })} />
              <TelegramSelectionItem label="Vibrant Glass" isSelected={settings.buttonStyle === 'ColorGlass'} onClick={() => updateSettings({ buttonStyle: 'ColorGlass' })} />
              <TelegramSelectionItem label="Solid Colors" isSelected={settings.buttonStyle === 'SolidColors'} onClick={() => updateSettings({ buttonStyle: 'SolidColors' })} />
            </TelegramGroup>
          </>
        );

      case 'display':
        return (
          <>
            <TelegramGroup title="Interactive Elements">
              <TelegramItem 
                icon={<Icons.Check />} iconBg="#3b82f6"
                title="Actor Verification Badge" description="Display checkmark on verified profiles"
                rightElement={<Toggle isActive={settings.showActorCheckmark !== false} onToggle={() => updateSettings({ showActorCheckmark: settings.showActorCheckmark === false ? true : false })} />}
              />
              <TelegramItem 
                icon={<Icons.GalleryIcon />} iconBg="#10b981"
                title="Gallery Hover Preview" description="Preview images on hover"
                rightElement={<Toggle isActive={settings.enableGalleryPreview !== false} onToggle={() => updateSettings({ enableGalleryPreview: settings.enableGalleryPreview === false ? true : false })} />}
              />
            </TelegramGroup>

            <TelegramGroup title="Typography Scaling">
              <div className="w-full flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
                <span className="text-[15px] text-[var(--text-primary)] opacity-90">Title Size</span>
                <div className="flex items-center bg-[var(--text-primary)]/[0.06] p-[3px] rounded-full relative">
                  {(['Small', 'Medium', 'Large'] as DisplaySize[]).map(s => {
                    const label = s === 'Small' ? 'S' : s === 'Medium' ? 'M' : 'L';
                    const isSelected = (settings.titleSize || 'Medium') === s;
                    return (
                      <button
                        key={s}
                        onClick={() => updateSettings({ titleSize: s })}
                        className={`relative w-[42px] h-[30px] flex justify-center items-center text-[13px] font-bold rounded-full transition-colors z-10 ${
                          isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)] opacity-50 hover:opacity-100'
                        }`}
                      >
                        {isSelected && (
                          <motion.div
                            layoutId="titleSizeBg"
                            className="absolute inset-0 bg-[var(--surface)] border border-[var(--border)] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.1)] z-[-1]"
                            transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                          />
                        )}
                        <span className="relative z-10 leading-none inline-flex items-center justify-center translate-y-[1px]">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="w-full flex items-center justify-between px-5 py-3">
                <span className="text-[15px] text-[var(--text-primary)] opacity-90">Metadata Size</span>
                <div className="flex items-center bg-[var(--text-primary)]/[0.06] p-[3px] rounded-full relative">
                  {(['Small', 'Medium', 'Large'] as DisplaySize[]).map(s => {
                    const label = s === 'Small' ? 'S' : s === 'Medium' ? 'M' : 'L';
                    const isSelected = (settings.metadataSize || 'Small') === s;
                    return (
                      <button
                        key={s}
                        onClick={() => updateSettings({ metadataSize: s })}
                        className={`relative w-[42px] h-[30px] flex justify-center items-center text-[13px] font-bold rounded-full transition-colors z-10 ${
                          isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)] opacity-50 hover:opacity-100'
                        }`}
                      >
                        {isSelected && (
                          <motion.div
                            layoutId="metadataSizeBg"
                            className="absolute inset-0 bg-[var(--surface)] border border-[var(--border)] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.1)] z-[-1]"
                            transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                          />
                        )}
                        <span className="relative z-10 leading-none inline-flex items-center justify-center translate-y-[1px]">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </TelegramGroup>

            <TelegramGroup title="Content Pagination">
              <div className="w-full flex items-center justify-between px-5 py-3">
                <span className="text-[15px] text-[var(--text-primary)] opacity-90">Items per page</span>
                <div className="flex items-center bg-[var(--text-primary)]/[0.06] p-[3px] rounded-full gap-1">
                  <button
                    onClick={() => {
                      const current = settings.itemsPerPage || 20;
                      if (current > 5) updateSettings({ itemsPerPage: current - 5 });
                    }}
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.05] active:scale-95 transition-all"
                  >
                    <div className="scale-[0.6]"><Icons.ChevronDown /></div>
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={isEditingPagination ? customPagination : (settings.itemsPerPage || 20).toString()}
                    onFocus={() => {
                      setIsEditingPagination(true);
                      setCustomPagination((settings.itemsPerPage || 20).toString());
                    }}
                    onBlur={() => {
                      setIsEditingPagination(false);
                      const parsed = parseInt(customPagination, 10);
                      if (isNaN(parsed) || parsed <= 0) {
                        setCustomPagination((settings.itemsPerPage || 20).toString());
                      } else {
                        updateSettings({ itemsPerPage: parsed });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setCustomPagination(val);
                    }}
                    className="w-[50px] h-[30px] text-center text-[14px] font-bold rounded-full outline-none transition-all duration-200 border border-transparent bg-[var(--surface)] text-[var(--accent)] shadow-[0_1px_3px_rgba(0,0,0,0.1)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => {
                      const current = settings.itemsPerPage || 20;
                      updateSettings({ itemsPerPage: current + 5 });
                    }}
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.05] active:scale-95 transition-all"
                  >
                    <div className="scale-[0.6] rotate-180"><Icons.ChevronDown /></div>
                  </button>
                </div>
              </div>
            </TelegramGroup>
          </>
        );
      case 'profile':
        return (
          <>
            <TelegramGroup title="Account & Sync">
              <CloudSyncItem />
            </TelegramGroup>
          </>
        );

      case 'data':
        return (
          <>
            <TelegramGroup title="Local Database Backup">
              <TelegramItem 
                icon={<Icons.Download />} iconBg="#3b82f6"
                title="Export Compressed Backup" 
                description="Ultra-compact .json.gz file (~85% smaller)"
                onClick={async () => {
                  try {
                    const sanitized = sanitizeStateForExport(state);
                    const { fileName, originalSize, exportedSize } = await exportBackupData(sanitized, 'gzip');
                    const savedPct = Math.round((1 - exportedSize / originalSize) * 100);
                    addNotification(`Exported ${fileName} (${savedPct}% size reduction)`, "success");
                  } catch (e: any) {
                    addNotification("Export failed: " + e.message, "error");
                  }
                }}
              />
              <TelegramItem 
                icon={<Icons.Download />} iconBg="#6366f1"
                title="Export Standard JSON" 
                description="Clean, minified plain text .json file"
                onClick={async () => {
                  try {
                    const sanitized = sanitizeStateForExport(state);
                    const { fileName } = await exportBackupData(sanitized, 'json');
                    addNotification(`Exported ${fileName}`, "success");
                  } catch (e: any) {
                    addNotification("Export failed: " + e.message, "error");
                  }
                }}
              />
              <TelegramItem 
                icon={<Icons.Upload />} iconBg="#22c55e"
                title="Import Backup" 
                description="Restore from .json or .json.gz file"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; 
                  input.accept = '.json,.gz,.json.gz';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      try {
                        const parsedData = await readImportBackupFile(file);
                        if (parsedData) {
                          await importData(parsedData);
                        } else {
                          addNotification("Could not read backup file.", "error");
                        }
                      } catch (err: any) {
                        addNotification("Import failed: " + (err.message || 'Invalid format'), "error");
                      }
                    }
                  };
                  input.click();
                }}
              />
            </TelegramGroup>

            <TelegramGroup title="Danger Zone">
               <TelegramItem 
                 icon={<Icons.Trash />} iconBg="#ef4444"
                 title="Delete All Local Data" description="Permanently erase all data from this device"
                 onClick={() => {
                   setClearTimer(5);
                   setShowClearConfirm(true);
                 }}
                 isDestructive
               />
            </TelegramGroup>
          </>
        );

      case 'integrations':
        return (
          <>
            <TelegramGroup title="StashDB">
              <TelegramItem 
                icon={<img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRrnru166PCBEwHbs21gaRjGMgntYsWM3_SbfENMYTTbA&s" alt="StashDB" className="w-full h-full object-contain rounded-full" />} iconBg="#0f172a"
                title="StashDB" description="Connect to StashDB for metadata"
                rightElement={<Toggle isActive={settings.enableStashDB !== false} onToggle={() => updateSettings({ enableStashDB: settings.enableStashDB === false ? true : false })} />}
              />
              <div className="px-5 py-4 border-t border-[var(--border)]">
                <label className="block text-[13px] font-medium text-[var(--accent)] mb-2 uppercase tracking-wide">
                  API Key
                </label>
                <input
                  type="password"
                  defaultValue={settings.stashDbApiKey || ''}
                  onBlur={(e) => updateSettings({ stashDbApiKey: e.target.value })}
                  placeholder="Paste your StashDB API key here..."
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[28px] px-4 py-3 text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors shadow-inner"
                />
              </div>
            </TelegramGroup>

            <TelegramGroup title="JAVStash">
              <TelegramItem 
                icon={<img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRrnru166PCBEwHbs21gaRjGMgntYsWM3_SbfENMYTTbA&s" alt="JAVStash" className="w-full h-full object-contain rounded-full" />} iconBg="#0f172a"
                title="JAVStash.org" description="Connect to JAVStash for JAV performers & scenes"
                rightElement={<Toggle isActive={settings.enableJavstash !== false} onToggle={() => updateSettings({ enableJavstash: settings.enableJavstash === false ? true : false })} />}
              />
              <div className="px-5 py-4 border-t border-[var(--border)]">
                <label className="block text-[13px] font-medium text-[var(--accent)] mb-2 uppercase tracking-wide">
                  API Key
                </label>
                <input
                  type="password"
                  defaultValue={settings.javstashApiKey || ''}
                  onBlur={(e) => updateSettings({ javstashApiKey: e.target.value })}
                  placeholder="Paste your JAVStash API key here..."
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[28px] px-4 py-3 text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors shadow-inner"
                />
              </div>
            </TelegramGroup>
            
            <TelegramGroup title="Real Debrid">
              <TelegramItem 
                icon={<img src="https://www.google.com/s2/favicons?domain=real-debrid.com&sz=128" alt="Real Debrid" className="w-full h-full scale-[1.6] object-contain rounded-full" />} iconBg="#ffffff"
                title="Real Debrid" description="Use Real Debrid for secure streaming"
                rightElement={<Toggle isActive={settings.enableRealDebrid !== false} onToggle={() => updateSettings({ enableRealDebrid: settings.enableRealDebrid === false ? true : false })} />}
              />
              <div className="px-5 py-4 border-t border-[var(--border)]">
                <label className="block text-[13px] font-medium text-[var(--accent)] mb-2 uppercase tracking-wide">
                  API Key
                </label>
                <input
                  type="password"
                  defaultValue={settings.realDebridApiKey || ''}
                  onBlur={(e) => updateSettings({ realDebridApiKey: e.target.value })}
                  placeholder="Paste your Real Debrid API key here..."
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[28px] px-4 py-3 text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors shadow-inner"
                />
              </div>
            </TelegramGroup>
            
            <TelegramGroup title="Torbox">
              <TelegramItem 
                icon={<img src="https://www.google.com/s2/favicons?domain=torbox.app&sz=128" alt="Torbox" className="w-full h-full scale-[1.6] object-contain rounded-full" />} iconBg="#ffffff"
                title="Torbox" description="Use Torbox for secure streaming"
                rightElement={<Toggle isActive={settings.enableTorbox !== false} onToggle={() => updateSettings({ enableTorbox: settings.enableTorbox === false ? true : false })} />}
              />
              <div className="px-5 py-4 border-t border-[var(--border)]">
                <label className="block text-[13px] font-medium text-[var(--accent)] mb-2 uppercase tracking-wide">
                  API Key
                </label>
                <input
                  type="password"
                  defaultValue={settings.torboxApiKey || ''}
                  onBlur={(e) => updateSettings({ torboxApiKey: e.target.value })}
                  placeholder="Paste your Torbox API key here..."
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[28px] px-4 py-3 text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors shadow-inner"
                />
              </div>
            </TelegramGroup>

            <TelegramGroup title="Google Gemini AI">
              <TelegramItem 
                icon={<Sparkles className="w-5 h-5 text-indigo-300" />} iconBg="#4f46e5"
                title="Gemini AI (Subtitles)" description="Translate anime English subtitles to Arabic with Gemini"
                rightElement={<Toggle isActive={settings.enableGemini !== false} onToggle={() => updateSettings({ enableGemini: settings.enableGemini === false ? true : false })} />}
              />
              <div className="px-5 py-4 border-t border-[var(--border)]">
                <label className="block text-[13px] font-medium text-[var(--accent)] mb-2 uppercase tracking-wide">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  defaultValue={settings.geminiApiKey || ''}
                  onBlur={(e) => updateSettings({ geminiApiKey: e.target.value })}
                  placeholder="Paste your Gemini API key here..."
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[28px] px-4 py-3 text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors shadow-inner font-mono text-[13px]"
                />
                <div className="mt-2.5 text-[12px] text-[var(--text-muted)] leading-relaxed">
                  Uses the ultra-fast, high-availability model <span className="text-[var(--accent)] font-semibold">gemini-3.5-flash-lite</span> with automatic multi-model failover to translate subtitles inside the video player into Arabic in sub-second time. You can get a free API key at{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline hover:opacity-80">
                    Google AI Studio
                  </a>.
                </div>
              </div>
            </TelegramGroup>
          </>
        );

      case 'advanced':
        return (
          <>
            <TelegramGroup title="StashDB Studio Filter">
              <div className="px-5 py-4 flex flex-col gap-4">
                <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                  Search for studios to block. Blocked studios will not appear in StashDB search results.
                </p>
                <div className="relative">
                  <input 
                    type="text"
                    value={studioSearchQuery}
                    onChange={(e) => {
                      setStudioSearchQuery(e.target.value);
                      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                      searchTimeoutRef.current = setTimeout(() => searchStudios(e.target.value), 500);
                    }}
                    placeholder="Search StashDB studios..."
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[28px] py-3 px-4 text-[14px] outline-none focus:border-[var(--accent)] transition-all shadow-inner"
                  />
                  {isSearchingStudios && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
                
                {studioResults.length > 0 && (
                  <div className="flex flex-col gap-2 mt-2 bg-[var(--surface-light)] rounded-[28px] border border-[var(--border)] overflow-hidden">
                    {studioResults.map(s => {
                      const isBlocked = (settings.hiddenStashDbStudios || []).includes(s.name);
                      return (
                        <div key={s.id} className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] last:border-none">
                          <span className="text-[14px] font-medium">{s.name}</span>
                          <button 
                            onClick={() => {
                              const current = settings.hiddenStashDbStudios || [];
                              if (isBlocked) {
                                updateSettings({ hiddenStashDbStudios: current.filter(x => x !== s.name) });
                              } else {
                                updateSettings({ hiddenStashDbStudios: [...current, s.name] });
                              }
                            }}
                            className={`px-3 py-1.5 text-[12px] rounded-full font-bold uppercase tracking-wider transition-all ${isBlocked ? 'bg-red-500/20 text-red-500' : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'}`}
                          >
                            {isBlocked ? 'Unblock' : 'Block'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TelegramGroup>
            
            {(settings.hiddenStashDbStudios || []).length > 0 && (
              <TelegramGroup title="Blocked Studios List">
                <div 
                  className="flex flex-col max-h-[250px] overflow-y-auto hide-scrollbar relative"
                  style={{
                    maskImage: 'linear-gradient(to bottom, black calc(100% - 32px), transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 32px), transparent 100%)'
                  }}
                >
                  {(settings.hiddenStashDbStudios || []).map(studioName => (
                    <div key={studioName} className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] last:border-none shrink-0">
                      <span className="text-[14px] font-medium">{studioName}</span>
                      <button 
                        onClick={() => {
                          const current = settings.hiddenStashDbStudios || [];
                          updateSettings({ hiddenStashDbStudios: current.filter(x => x !== studioName) });
                        }}
                        className="w-8 h-8 flex items-center justify-center text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-full transition-all shrink-0"
                      >
                        <Icons.Trash />
                      </button>
                    </div>
                  ))}
                </div>
              </TelegramGroup>
            )}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div key={settingsView} className={`w-full flex flex-col ${settingsView === 'missing-data' ? 'pb-0 px-0 pt-0' : 'pb-32 px-2 pt-2'} ${animationClass} gpu-accelerated contain-layout`}>
        {renderContent()}
        {settingsView === 'main' && (
          <div className="w-full flex justify-center py-6">
            <span className="text-[12px] font-medium text-[var(--text-muted)] opacity-60 font-mono tracking-wider">
              0.0.17
            </span>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showClearConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowClearConfirm(false);
              }
            }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-[32px] w-full max-w-sm p-6 shadow-2xl relative"
            >
              <h3 className="text-xl font-bold mb-2">Delete Local Data?</h3>
              <p className="text-[var(--text-secondary)] mb-4 text-sm leading-relaxed">
                Select the types of data you want to permanently erase. This action cannot be undone.
              </p>
              
              <div className="flex flex-col gap-3 mb-6 bg-[var(--card-bg-highlight)] p-4 rounded-[20px]">
                 {[
                    { key: 'actors', label: 'Actors' },
                    { key: 'studios', label: 'Studios' },
                    { key: 'hanime', label: 'Hanime' },
                    { key: 'settings', label: 'Settings' },
                    { key: 'links', label: 'Links' },
                    { key: 'coomers', label: 'Coomers' }
                 ].map(opt => (
                    <label key={opt.key} className="flex items-center gap-3 cursor-pointer">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            (deleteOptions as any)[opt.key] 
                            ? 'border-red-500 bg-red-500' 
                            : 'border-neutral-400 bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-800'
                        }`}>
                            {(deleteOptions as any)[opt.key] && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <input 
                            type="checkbox"
                            className="hidden"
                            checked={(deleteOptions as any)[opt.key]}
                            onChange={(e) => setDeleteOptions(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                        />
                        <span className="text-[var(--text-primary)] font-medium text-sm">{opt.label}</span>
                    </label>
                 ))}
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3.5 px-4 bg-[var(--border)] hover:bg-neutral-500/20 active:bg-neutral-500/30 font-semibold rounded-[28px] transition-colors"
                >
                  Cancel
                </button>
                <button 
                  disabled={clearTimer > 0 || !Object.values(deleteOptions).some(Boolean)}
                  onClick={() => {
                    clearAllData(deleteOptions);
                    setShowClearConfirm(false);
                    addNotification("Selected data has been deleted", "success");
                  }}
                  className="flex-1 py-3.5 px-4 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold rounded-[28px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {clearTimer > 0 ? `Confirm (${clearTimer})` : "Confirm"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
