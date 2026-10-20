
import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../AppContext';
import { Icons, THEME_CONFIGS } from '../constants';
import { Notification } from './Notification';

const globalScrollRegistry: Record<string, number> = {};

const CompactIcon: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 21 }) => (
  <div style={{ transform: `scale(${size / 24})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

const MorphingSortIcon: React.FC<{ order: string }> = ({ order }) => {
  const paths: Record<string, string> = {
    'N': "M6 18V6L18 18V6",
    'O': "M12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6",
    'D': "M8 6V18H12C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6H8",
    'V': "M6 6L12 18L18 6",
    'A': "M7 18L12 5L17 18 M9 13H15",
    'Z': "M6 6H18L6 18H18"
  };
  let letter = 'N';
  if (order === 'Newest') letter = 'N';
  else if (order === 'Oldest') letter = 'O';
  else if (order === 'DateDesc') letter = 'D';
  else if (order === 'DateAsc') letter = 'V';
  else if (order === 'A-Z') letter = 'A';
  else if (order === 'Z-A') letter = 'Z';
  
  const currentPath = paths[letter] || paths['N'];
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-in-out">
      <path d={currentPath} className="transition-all duration-500 ease-in-out" style={{ transitionProperty: 'd' }} />
    </svg>
  );
};

const SimplePencilIcon = Icons.Edit;

const hexToRgba = (hex: string, opacity: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

const SearchInput = React.memo(({ 
  value, 
  onChange, 
  placeholder, 
  hColors, 
  accentColor,
  onFocus
}: any) => {
  return (
    <div className="flex-1 h-10 flex items-center mx-3 min-w-0 relative bg-[var(--accent)]/15 rounded-full isolate solid-bg-layer">
      <div 
        className="absolute left-[15px] inset-y-0 flex items-center justify-center pointer-events-none" 
        style={{ color: accentColor }}
      >
        <Icons.SearchIcon size={21} />
      </div>
      <input 
        type="text" 
        placeholder={placeholder || ""} 
        value={value} 
        onFocus={() => { if (onFocus) onFocus(); }}
        onChange={(e) => onChange(e.target.value)} 
        className="bg-transparent border-none outline-none flex-1 text-[16px] font-semibold tracking-tight w-full text-center px-10 rounded-full placeholder:text-[var(--text-muted)] placeholder:opacity-35 placeholder:font-normal" 
        style={{ color: hColors.textPrimary }} 
      />
      {value && (
        <button 
          onClick={() => { onChange(''); }} 
          className="w-6 h-6 flex items-center justify-center rounded-full transition-transform tap-highlight-none pointer-events-auto absolute right-3 hover:bg-[var(--accent)]/10 active:scale-90" 
          style={{ color: accentColor }}
        >
          <CompactIcon size={16}><Icons.X /></CompactIcon>
        </button>
      )}
    </div>
  );
});

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, searchQuery, setSearchQuery, settingsView, setSettingsView, isMenuOpen, setIsMenuOpen, toggleSort, setFormDraft, stashDbSearchMode, cycleStashDbSearchMode } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const { theme, accentColor, headerTheme } = state.settings;
  const { sortOrder: globalSortOrder, homeSortOrder, actorSortOrder, studioSortOrder, coomerSortOrder, hanimeSortOrder, actorLinksSortOrder, studioLinksSortOrder } = state.settings;
  const colors = (THEME_CONFIGS as any)[theme];

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const isHome = location.pathname === '/';
  const isSettings = location.pathname === '/settings';
  const isActorVault = location.pathname.startsWith('/actor/');
  const isStudioVault = location.pathname.startsWith('/studio/');
  const isManageActors = location.pathname === '/manage-actors';
  const isManageStudios = location.pathname === '/manage-studios';
  const isManageCoomers = location.pathname === '/manage-coomers';
  const isManageHanime = location.pathname === '/manage-hanime';
  const isStashDb = location.pathname === '/stashdb';
  
  let currentSortOrder = globalSortOrder;
  let viewType = 'global';
  if (isHome) {
    currentSortOrder = homeSortOrder || globalSortOrder;
    viewType = 'home';
  } else if (isManageActors) {
    currentSortOrder = actorSortOrder || globalSortOrder;
    viewType = 'actors';
  } else if (isManageStudios) {
    currentSortOrder = studioSortOrder || globalSortOrder;
    viewType = 'studios';
  } else if (isManageCoomers) {
    currentSortOrder = coomerSortOrder || globalSortOrder;
    viewType = 'coomers';
  } else if (isManageHanime) {
    currentSortOrder = hanimeSortOrder || globalSortOrder;
    viewType = 'hanime';
  } else if (isActorVault) {
    currentSortOrder = actorLinksSortOrder || globalSortOrder;
    viewType = 'actorLinks';
  } else if (isStudioVault) {
    currentSortOrder = studioLinksSortOrder || globalSortOrder;
    viewType = 'studioLinks';
  }
  const isCoomerDetail = location.pathname.startsWith('/coomer/') && !location.pathname.endsWith('/add-socials') && !location.pathname.includes('/media/');
  const isHanimeDetail = location.pathname.startsWith('/hanime/');
  const isAddCoomerSocials = location.pathname.includes('/add-socials');
  
  const isEditPage = location.pathname === '/add' || 
                    location.pathname.startsWith('/edit/') || 
                    location.pathname === '/add-gallery' ||
                    location.pathname.startsWith('/manage-actors/edit/') || 
                    location.pathname === '/manage-actors/add' ||
                    location.pathname.startsWith('/manage-studios/edit/') ||
                    location.pathname === '/manage-studios/add' ||
                    location.pathname.startsWith('/manage-coomers/edit/') ||
                    location.pathname === '/manage-coomers/add' ||
                    location.pathname.startsWith('/manage-hanime/edit/') ||
                    location.pathname.startsWith('/edit-episode/') ||
                    location.pathname === '/manage-hanime/add' ||
                    location.pathname === '/manage-hanime/second-covers' ||
                    location.pathname === '/manage-hanime/episodes' ||
                    isAddCoomerSocials;

  const isImmersivePage = isHome || isActorVault || isStudioVault || isCoomerDetail || isHanimeDetail || (location.pathname === '/settings' && settingsView === 'missing-data');
  const activeHeaderTheme = headerTheme === 'Default' ? theme : headerTheme;
  const hColors = (THEME_CONFIGS as any)[activeHeaderTheme];

  const totalLinkCount = useMemo(() => state.links.length, [state.links]);

  const actorVaultLinkCount = useMemo(() => {
    if (!isActorVault) return 0;
    const parts = location.pathname.split('/');
    const aId = parts[2];
    if (!aId) return 0;
    return state.links.filter(l => (l.actorIds || []).includes(aId)).length;
  }, [isActorVault, location.pathname, state.links]);

  const studioVaultLinkCount = useMemo(() => {
    if (!isStudioVault) return 0;
    const parts = location.pathname.split('/');
    const sId = parts[2];
    if (!sId) return 0;
    return state.links.filter(l => (l.studioIds || []).includes(sId)).length;
  }, [isStudioVault, location.pathname, state.links]);

  const getScrollKey = useCallback((specificPath?: string, specificSearch?: string) => {
    const path = specificPath || location.pathname;
    // Only include search query in scroll key for home and vault pages to avoid unnecessary re-renders in edit pages
    const isSearchable = path === '/' || path.startsWith('/actor/') || path.startsWith('/studio/') || path.startsWith('/manage-');
    const search = isSearchable ? (specificSearch !== undefined ? specificSearch : searchQuery) : '';
    
    if (path === '/settings') return `settings:${settingsView}`;
    
    if (path.startsWith('/coomer/') && !path.includes('/media/') && !path.includes('/add-socials')) {
      return path;
    }
    
    return `${path}:${search}`;
  }, [location.pathname, settingsView, searchQuery]);

  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRestoringRef = useRef<boolean>(false);
  const activeKeyRef = useRef<string>(getScrollKey());
  const currentKey = getScrollKey();

  if (activeKeyRef.current !== currentKey) {
    // Synchronously activate restoration shield during render to block any DOM-shrink reflow scroll events
    isRestoringRef.current = true;
    activeKeyRef.current = currentKey;
  }

  // Set manual history scroll restoration for mobile browsers (iOS Safari / Android Chrome)
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  const saveCurrentScroll = useCallback((isSyncParam?: boolean | React.UIEvent) => {
    if (isRestoringRef.current) return;
    if (!scrollAreaRef.current) return;

    const container = scrollAreaRef.current;
    const currentScroll = container.scrollTop;
    const key = getScrollKey();

    // Spurious 0 protection: If currentScroll is 0 while a recorded scroll position > 50 exists
    // and isRestoringRef.current is active, ignore this synthetic reset event!
    if (currentScroll === 0 && (globalScrollRegistry[key] || 0) > 50 && isRestoringRef.current) {
      return;
    }

    if (currentScroll >= 0) {
      globalScrollRegistry[key] = currentScroll;
    }
  }, [getScrollKey]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      saveCurrentScroll(true);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [saveCurrentScroll]);

  useLayoutEffect(() => {
    const container = scrollAreaRef.current;
    if (!container) return;

    // Immediately ensure restoration shield is active on route change
    isRestoringRef.current = true;

    let rAF_id: number;
    let attempts = 0;
    let shieldTimer: NodeJS.Timeout | null = null;
    
    const performScroll = () => {
      if (!scrollAreaRef.current) return;
      const key = getScrollKey();
      const targetY = globalScrollRegistry[key] || 0;
      
      // If we don't need to scroll, reset to top under shield
      if (targetY === 0) {
        isRestoringRef.current = true;
        container.scrollTo({ top: 0, behavior: 'instant' });
        if (shieldTimer) clearTimeout(shieldTimer);
        shieldTimer = setTimeout(() => {
          isRestoringRef.current = false;
        }, 50);
        return;
      }

      isRestoringRef.current = true;
      container.scrollTo({ top: targetY, behavior: 'instant' });
      
      // If the container hasn't expanded enough to reach targetY, try again, up to 120 frames
      if (Math.abs(container.scrollTop - targetY) > 1 && attempts < 120) {
        attempts++;
        rAF_id = requestAnimationFrame(performScroll);
      } else {
        // Reached target or completed - keep shield active for 200ms to absorb trailing reflow/skeleton-swap events
        if (shieldTimer) clearTimeout(shieldTimer);
        shieldTimer = setTimeout(() => {
          isRestoringRef.current = false;
        }, 200);
      }
    };

    const handleRestore = () => {
      attempts = 0;
      rAF_id = requestAnimationFrame(performScroll);
    };

    window.addEventListener('restore-scroll', handleRestore);
    
    // Initial restore on path/search/tab change
    handleRestore();

    return () => {
      window.removeEventListener('restore-scroll', handleRestore);
      cancelAnimationFrame(rAF_id);
      if (shieldTimer) clearTimeout(shieldTimer);
    };
  }, [location.pathname, location.search, getScrollKey]);

  const headerTitle = useMemo(() => {
    let title = '';
    if (location.pathname.startsWith('/edit')) title = 'Edit Link';
    else if (location.pathname === '/add') title = 'Add Link';
    else if (location.pathname === '/add-gallery') title = 'Gallery';
    else if (location.pathname.startsWith('/manage-actors/edit')) title = 'Edit Actor';
    else if (location.pathname === '/manage-actors/add') title = 'Add Actor';
    else if (location.pathname.startsWith('/manage-studios/edit')) title = 'Edit Studio';
    else if (location.pathname === '/manage-studios/add') title = 'Add Studio';
    else if (location.pathname.startsWith('/manage-coomers/edit')) title = 'Edit Coomer';
    else if (location.pathname === '/manage-coomers/add') title = 'Add Coomer';
    else if (location.pathname.startsWith('/manage-hanime/edit')) title = 'Edit Hanime';
    else if (location.pathname === '/manage-hanime/add') title = 'Add Hanime';
    else if (location.pathname.startsWith('/edit-episode/')) title = 'Edit Episode';
    else if (location.pathname === '/manage-hanime/episodes') title = 'Episodes';
    else if (location.pathname === '/manage-hanime/second-covers') title = 'Second Covers';
    else if (isAddCoomerSocials) title = 'Add Socials';
    else if (location.pathname === '/stashdb') title = 'Extractor';
    else if (isActorVault) title = 'Actor Vault';
    else if (isStudioVault) title = 'Studio Vault';
    else if (isCoomerDetail) title = '';
    else if (isManageActors) title = 'Actors';
    else if (isManageStudios) title = 'Studios';
    else if (isManageCoomers) title = 'Coomers';
    else if (isManageHanime) title = 'Hanime';
    else if (location.pathname.startsWith('/hanime/')) {
      const parts = location.pathname.split('/');
      const hId = parts[2];
      const h = state.hanime.find(item => item.id === hId);
      title = h ? h.title : 'Episodes';
    }
    else if (isSettings) {
      switch (settingsView as any) {
        case 'theme': title = 'Theme'; break;
        case 'header': title = 'Header Setting'; break;
        case 'cover': title = 'Effects'; break;
        case 'display': title = 'Layout'; break;
        case 'interaction': title = 'Interaction'; break;
        case 'data': title = 'Data & Backup'; break;
        case 'integrations': title = 'Integrations'; break;
        case 'advanced': title = 'Filters'; break;
        case 'profile': title = 'Profile'; break;
        case 'statistics': title = 'Statistics'; break;
        case 'statistics-detail': title = 'Asset Browser'; break;
        case 'missing-data': title = (location.state as any)?.missingDataTitle || 'Missing Data'; break;
        default: title = 'Settings'; break;
      }
    }
    return title;
  }, [location.pathname, settingsView, isActorVault, isStudioVault, isManageActors, isManageStudios, isManageCoomers, isManageHanime, isCoomerDetail, isSettings, isAddCoomerSocials, state.hanime]);

  const [localSearch, setLocalSearch] = useState(searchQuery);

  // Sync local search when global searchQuery changes from elsewhere (e.g. navigation)
  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  // Debounce local search to global searchQuery
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== searchQuery) {
        setSearchQuery(localSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, searchQuery, setSearchQuery]);

  const [isCoomerSyncing, setIsCoomerSyncing] = useState(false);

  useEffect(() => {
    const handleSyncStatus = (e: any) => {
      setIsCoomerSyncing(Boolean(e.detail?.isSyncing));
    };
    window.addEventListener('coomer-sync-status', handleSyncStatus);
    return () => window.removeEventListener('coomer-sync-status', handleSyncStatus);
  }, []);

  useEffect(() => {
    setIsMenuOpen(false); 
    setIsCoomerSyncing(false);
    const stateQuery = (location.state as any)?.searchQuery;
    if (typeof stateQuery === 'string') {
      setSearchQuery(stateQuery);
      setLocalSearch(stateQuery);
    } else {
      setSearchQuery('');
      setLocalSearch('');
    }
  }, [location.pathname, location.state, setSearchQuery, setIsMenuOpen]);

  useEffect(() => {
    if (location.pathname === '/settings') {
      const view = (location.state as any)?.settingsView || 'main';
      if (settingsView !== view) {
        setSettingsView(view);
      }
    } else {
      setSettingsView('main');
    }
  }, [location.pathname, location.state, setSettingsView, settingsView]);

  const handleBack = useCallback(() => {
    saveCurrentScroll(true);

    if (isSettings && settingsView !== 'main') {
      if (settingsView === 'statistics-detail' || settingsView === 'missing-data') {
        const _state = location.state as any;
        if (_state && _state.prevSettingsView) {
          navigate('/settings', { state: { settingsView: _state.prevSettingsView }, replace: true });
        } else {
          navigate('/settings', { state: { settingsView: 'statistics' }, replace: true });
        }
      } else {
        navigate('/settings', { replace: true });
      }
      return;
    }

    if (isAddCoomerSocials) {
      const state = location.state as any;
      if (state && state.from && typeof state.from === 'string' && state.from !== location.pathname) {
        navigate(state.from, { replace: true, state: state.returnState });
        return;
      }
      const parts = location.pathname.split('/');
      if (parts[2]) navigate(`/coomer/${parts[2]}`, { replace: true });
      else navigate('/', { replace: true });
      return;
    }

    // Clear draft if leaving a main add/edit page
    if (location.pathname === '/add' || location.pathname.startsWith('/edit/')) {
      setFormDraft(null);
    }
    
    const state = location.state as any;
    if (state && state.from && typeof state.from === 'string') {
      const currentFullPath = location.pathname + location.search;
      if (state.from !== currentFullPath && state.from !== location.pathname) {
        navigate(state.from, { replace: true, state: state.returnState });
        return;
      }
    }

    // --- Explicit Navigation Fallbacks ---
    
    // Hanime sub-pages
    if (location.pathname === '/manage-hanime/second-covers' || location.pathname === '/manage-hanime/episodes') {
      const _state = location.state as any;
      if (_state?.from && _state.from !== location.pathname) {
        navigate(_state.from, { replace: true, state: _state.returnState });
      } else if (_state && _state.hanimeId) {
        navigate(`/manage-hanime/edit/${_state.hanimeId}`, { replace: true });
      } else {
        navigate('/manage-hanime/add', { replace: true });
      }
      return;
    }
    
    if (location.pathname.startsWith('/edit-episode/')) {
      const _state = location.state as any;
      if (_state?.from && _state.from !== location.pathname) {
        navigate(_state.from, { replace: true, state: _state.returnState });
      } else {
        const parts = location.pathname.split('/');
        if (parts[2] && parts[2] !== 'new') {
          navigate(`/manage-hanime/edit/${parts[2]}`, { replace: true });
        } else {
          navigate('/manage-hanime/add', { replace: true });
        }
      }
      return;
    }

    // Edit and Detail pages backing to their previous origin if provided, otherwise management views
    if (location.pathname.startsWith('/manage-actors/')) {
      const fromPath = (location.state as any)?.from;
      if (fromPath && fromPath !== location.pathname) {
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      } else {
        navigate('/manage-actors', { replace: true });
      }
      return;
    }
    if (location.pathname.startsWith('/manage-studios/')) {
      const fromPath = (location.state as any)?.from;
      if (fromPath && fromPath !== location.pathname) {
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      } else {
        navigate('/manage-studios', { replace: true });
      }
      return;
    }
    if (location.pathname.startsWith('/manage-coomers/')) {
      const fromPath = (location.state as any)?.from;
      if (fromPath && fromPath !== location.pathname) {
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      } else {
        navigate('/manage-coomers', { replace: true });
      }
      return;
    }
    if (location.pathname.startsWith('/manage-hanime/')) {
      const fromPath = (location.state as any)?.from;
      if (fromPath && fromPath !== location.pathname) {
        navigate(fromPath, { replace: true, state: (location.state as any)?.returnState });
      } else {
        navigate('/manage-hanime', { replace: true });
      }
      return;
    }
    
    if (isActorVault || isStudioVault || isCoomerDetail || isHanimeDetail) {
      if (location.state && (location.state as any).from) {
        navigate((location.state as any).from, { state: (location.state as any).returnState, replace: true });
      } else {
        if (isActorVault) navigate('/manage-actors', { replace: true });
        else if (isStudioVault) navigate('/manage-studios', { replace: true });
        else if (isCoomerDetail) navigate('/manage-coomers', { replace: true });
        else if (isHanimeDetail) navigate('/manage-hanime', { replace: true });
      }
      return;
    }

    // Top management views backing to Home
    if (location.pathname === '/manage-actors' || 
        location.pathname === '/manage-studios' || 
        location.pathname === '/manage-coomers' || 
        location.pathname === '/manage-hanime' ||
        location.pathname === '/add' ||
        location.pathname.startsWith('/edit/') ||
        location.pathname === '/add-gallery' ||
        location.pathname === '/stashdb' ||
        location.pathname === '/settings') {
      if (location.state && (location.state as any).from && (location.state as any).from !== location.pathname) {
        navigate((location.state as any).from, { state: (location.state as any).returnState, replace: true });
      } else {
        navigate('/', { replace: true });
      }
      return;
    }

    // Universal fallback
    if (location.state && (location.state as any).from && (location.state as any).from !== location.pathname) {
      navigate((location.state as any).from, { state: (location.state as any).returnState, replace: true });
    } else if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
  }, [isSettings, settingsView, navigate, location, setFormDraft, isActorVault, isStudioVault, isCoomerDetail, isHanimeDetail, isEditPage, saveCurrentScroll, isAddCoomerSocials]);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isMenuOpen) {
        e.preventDefault();
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMenuOpen, setIsMenuOpen, location.pathname]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('#menu-trigger-btn') || target.closest('#header-menu-dropdown')) {
        return;
      }
      setIsMenuOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen, setIsMenuOpen]);

  const isNavigatingRef = useRef(false);

  const handleMenuNavigate = useCallback((path: string) => {
    isNavigatingRef.current = true;
    setIsMenuOpen(false);
    setSearchQuery('');
    navigate(path, { replace: true });
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 100);
  }, [setSearchQuery, navigate, setIsMenuOpen]);

  const btnClass = "w-10 h-10 flex items-center justify-center rounded-full transition-transform bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 active:scale-90 relative isolate solid-bg-layer";
  
  const isSearchablePage = isHome || isActorVault || isStudioVault;
  const isTransparentHeader = state.settings.transparentHeader === true;
  const showHeaderBottomBorder = state.settings.headerBottomBorder !== false && !isTransparentHeader;

  const Header = useMemo(() => {
    return (
      <header className={`fixed top-0 left-0 right-0 h-16 z-[170] flex items-center px-4 gpu-accelerated ${showHeaderBottomBorder ? 'border-b' : 'border-b-transparent'}`} 
        style={{ 
          backgroundColor: isTransparentHeader ? 'transparent' : hexToRgba(colors.bg, 100),
          borderColor: showHeaderBottomBorder ? hColors.border : 'transparent',
          color: hColors.textPrimary,
          '--header-solid-bg': isTransparentHeader ? colors.bg : 'transparent',
          '--header-backdrop': 'none',
          '--header-shadow': isTransparentHeader ? '0 4px 16px rgba(0, 0, 0, 0.25)' : 'none',
          '--header-element-border': state.settings.headerElementBorder !== false ? hexToRgba(accentColor || '#ffffff', 100) : 'transparent',
        } as React.CSSProperties}>
        <div className="w-full max-w-2xl mx-auto flex items-center h-full relative">
          {isSearchablePage ? (
            <>
              {isHome ? (
                <button id="menu-trigger-btn" onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }} className={`${btnClass} z-[210] tap-highlight-none shrink-0`} style={{ color: accentColor }}>
                  <div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-full">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={isMenuOpen ? 'x' : 'menu'}
                        initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                        transition={{ duration: 0.15, ease: "easeInOut" }}
                        className="absolute flex items-center justify-center"
                      >
                        <CompactIcon size={22}>{isMenuOpen ? <Icons.X /> : <Icons.Menu />}</CompactIcon>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </button>
              ) : (
                <button onClick={handleBack} className={btnClass} style={{ color: accentColor }}>
                  <CompactIcon size={20}><Icons.ChevronLeft /></CompactIcon>
                </button>
              )}
              
              <div className="flex-1 flex items-center h-full">
                <div className="flex items-center w-full">
                  <button onClick={() => toggleSort(viewType, currentSortOrder)} className={`${btnClass} ml-2 shrink-0`} style={{ color: accentColor }}><div className="scale-[0.8]"><MorphingSortIcon order={currentSortOrder} /></div></button>
                  
                  <SearchInput 
                    value={localSearch} 
                    onChange={setLocalSearch} 
                    placeholder={
                      isActorVault 
                        ? `${actorVaultLinkCount}` 
                        : isStudioVault
                        ? `${studioVaultLinkCount}`
                        : "Search"
                    } 
                    hColors={hColors} 
                    accentColor={accentColor} 
                    onFocus={() => {
                      if (scrollAreaRef.current) {
                        scrollAreaRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                  />
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={() => {
                        if (isHome) {
                          navigate('/add', { state: { from: location.pathname + location.search, returnState: location.state } });
                        } else {
                          const parts = location.pathname.split('/');
                          const id = parts[parts.length - 1];
                          const type = isActorVault ? 'actor' : 'studio';
                          navigate(`/add?${type}=${id}`, { state: { from: location.pathname + location.search, returnState: location.state } });
                        }
                      }} 
                      className={btnClass} 
                      style={{ color: accentColor }}
                    >
                      <CompactIcon size={22}><Icons.Plus /></CompactIcon>
                    </button>
                    
                    {isHome ? (
                      <button onClick={() => navigate('/settings', { state: { from: location.pathname + location.search, returnState: location.state } })} className={btnClass} style={{ color: accentColor }}><CompactIcon size={18}><Icons.Settings /></CompactIcon></button>
                    ) : (
                      <button onClick={() => {
                        const parts = location.pathname.split('/');
                        const id = parts[parts.length - 1];
                        const currentPath = location.pathname + location.search;
                        navigate(`/manage-${isActorVault ? 'actors' : 'studios'}/edit/${id}?from=vault`, { state: { from: currentPath, returnState: location.state } });
                      }} className={btnClass} style={{ color: accentColor }}>
                        <CompactIcon size={18}><SimplePencilIcon /></CompactIcon>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between w-full h-full relative">
              <button onClick={handleBack} className={btnClass} style={{ color: accentColor }}>
                <CompactIcon size={20}><Icons.ChevronLeft /></CompactIcon>
              </button>
              {isStashDb ? (
                <button
                  id="stashdb-mode-btn"
                  type="button"
                  onClick={cycleStashDbSearchMode}
                  className="h-10 w-[90px] flex items-center justify-center rounded-full bg-[var(--accent)]/15 text-[15px] font-bold tracking-tight hover:bg-[var(--accent)]/25 active:scale-95 transition-all relative isolate solid-bg-layer tap-highlight-none select-none cursor-pointer text-center"
                  style={{ color: accentColor }}
                  title="Click to toggle search mode"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={stashDbSearchMode}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.12 }}
                      className="text-center font-bold select-none whitespace-nowrap"
                    >
                      {stashDbSearchMode === 'actor' ? 'Actors' : stashDbSearchMode === 'studio' ? 'Studios' : stashDbSearchMode === 'sexmex' ? 'SexMex' : 'JAV'}
                    </motion.span>
                  </AnimatePresence>
                </button>
              ) : !isHanimeDetail && headerTitle !== '' && !(isManageActors || isManageStudios || isManageCoomers || isManageHanime) && (
                <div className="h-10 flex items-center justify-center rounded-full bg-[var(--accent)]/15 px-4 relative isolate solid-bg-layer max-w-[65%]" style={{ color: accentColor }}>
                  <h1 className="text-[15px] font-bold tracking-tight leading-normal py-0.5 truncate block text-center select-text" style={{ color: accentColor, fontFamily: headerTitle === 'Hanime' ? "'Manga', 'Kalam', 'Patrick Hand', 'Comic Sans MS', cursive" : undefined, letterSpacing: headerTitle === 'Hanime' ? '1px' : undefined }}>{headerTitle}</h1>
                </div>
              )}
              {(isManageActors || isManageStudios || isManageCoomers || isManageHanime) && (
                <SearchInput 
                  value={localSearch} 
                  onChange={setLocalSearch} 
                  placeholder={headerTitle || "Search"} 
                  hColors={hColors} 
                  accentColor={accentColor} 
                  onFocus={() => {
                    if (scrollAreaRef.current) {
                      scrollAreaRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                />
              )}
                <div className="min-w-[40px] flex justify-end items-center gap-2 shrink-0">
                  {isStashDb ? (
                    <button id="stashdb-save-btn" onClick={() => window.dispatchEvent(new CustomEvent('stashdb-save-trigger'))} className={`${btnClass} hidden`} style={{ color: accentColor }}>
                      <CompactIcon size={22}>
                        <Icons.Check />
                      </CompactIcon>
                    </button>
                  ) : isEditPage ? (
                    <button onClick={() => window.dispatchEvent(new CustomEvent('vault-save-trigger'))} className={btnClass} style={{ color: accentColor }}>
                      <CompactIcon size={22}><Icons.Check /></CompactIcon>
                    </button>
                  ) : (
                    <>
                      {isCoomerDetail && (
                        <>
                          <button 
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('coomer-sync-trigger'))} 
                            className={`${btnClass} ${isCoomerSyncing ? 'cursor-wait opacity-90' : ''}`} 
                            style={{ color: accentColor }}
                            title={isCoomerSyncing ? 'Syncing...' : 'Sync Posts'}
                            aria-label="Sync Posts"
                          >
                            <div className={isCoomerSyncing ? 'animate-spin' : ''}>
                              <CompactIcon size={19}><Icons.Refresh /></CompactIcon>
                            </div>
                          </button>
                          <button onClick={() => {
                            const parts = location.pathname.split('/');
                            const id = parts[parts.length - 1];
                            navigate(`/coomer/${id}/add-socials`, { state: { from: location.pathname, returnState: location.state } });
                          }} className={btnClass} style={{ color: accentColor }}>
                            <CompactIcon size={22}><Icons.Plus /></CompactIcon>
                          </button>
                        </>
                      )}
                      {(isActorVault || isStudioVault || isCoomerDetail || isHanimeDetail) && (
                        <button onClick={() => {
                          const parts = location.pathname.split('/');
                          const id = parts[parts.length - 1];
                          const currentPath = location.pathname + location.search;
                          if (isCoomerDetail) {
                            navigate(`/manage-coomers/edit/${id}?from=vault`, { state: { from: currentPath, returnState: location.state } });
                          } else if (isHanimeDetail) {
                            navigate(`/manage-hanime/edit/${id}?from=vault`, { state: { from: currentPath, returnState: location.state } });
                          } else {
                            navigate(`/manage-${isActorVault ? 'actors' : 'studios'}/edit/${id}?from=vault`, { state: { from: currentPath, returnState: location.state } });
                          }
                        }} className={btnClass} style={{ color: accentColor }}>
                          <CompactIcon size={18}><SimplePencilIcon /></CompactIcon>
                        </button>
                      )}
                      {(isManageActors || isManageStudios || isManageCoomers || isManageHanime) && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleSort(viewType, currentSortOrder)} className={btnClass} style={{ color: accentColor }}>
                            <div className="scale-[0.8]"><MorphingSortIcon order={currentSortOrder} /></div>
                          </button>
                          <button onClick={() => {
                            const currentPath = location.pathname + location.search;
                            navigate(`/manage-${isManageActors ? 'actors' : (isManageStudios ? 'studios' : (isManageCoomers ? 'coomers' : 'hanime'))}/add`, { state: { from: currentPath, returnState: location.state } });
                          }} className={btnClass} style={{ color: accentColor }}>
                            <CompactIcon size={22}><Icons.Plus /></CompactIcon>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
            </div>
          )}
        </div>
      </header>
    );
  }, [isHome, isMenuOpen, hColors, colors, accentColor, totalLinkCount, actorVaultLinkCount, studioVaultLinkCount, localSearch, searchQuery, currentSortOrder, viewType, headerTitle, isEditPage, isStashDb, stashDbSearchMode, cycleStashDbSearchMode, isCoomerDetail, isActorVault, isStudioVault, isManageActors, isManageStudios, isManageCoomers, isManageHanime, navigate, handleBack, toggleSort, setIsMenuOpen, setSearchQuery, btnClass, state.settings.transparentHeader, state.settings.headerElementBorder, state.settings.headerBottomBorder, showHeaderBottomBorder]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative" style={{ 
        backgroundColor: 'var(--bg)', color: 'var(--text-primary)',
        ['--accent' as any]: accentColor, ['--bg' as any]: colors.bg,
        ['--surface' as any]: colors.surface, ['--text-primary' as any]: colors.textPrimary,
        ['--text-secondary' as any]: colors.textSecondary, ['--text-muted' as any]: colors.textMuted,
        ['--border' as any]: colors.border,
        ['--skeleton-bg' as any]: colors.skeletonBg || colors.surface,
        ['--card-bg' as any]: colors.cardBg || colors.surface,
        ['--toggle-off-bg' as any]: colors.toggleOffBg || 'rgba(255, 255, 255, 0.15)',
      }}>
      {Header}
      <AnimatePresence>
        {isHome && isMenuOpen && (
          <motion.div
            id="header-menu-dropdown"
            key="header-dropdown-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={isNavigatingRef.current ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -8, transition: { duration: 0.15 } }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={`fixed top-16 left-0 right-0 z-[165] pointer-events-auto ${!isTransparentHeader ? 'shadow-lg' : ''}`}
            style={{
              backgroundColor: !isTransparentHeader ? colors.bg : undefined,
              '--header-solid-bg': isTransparentHeader ? colors.bg : 'transparent',
              '--header-backdrop': 'none',
              '--header-shadow': isTransparentHeader ? '0 4px 16px rgba(0, 0, 0, 0.25)' : 'none',
              '--header-element-border': state.settings.headerElementBorder !== false ? hexToRgba(accentColor || '#ffffff', 100) : 'transparent',
            } as React.CSSProperties}
          >
            <div className={`w-full ${isTransparentHeader ? 'max-w-2xl mx-auto px-4 pt-3 pb-2 grid grid-cols-2 gap-x-2.5 gap-y-3' : 'flex flex-col'}`}>
              {[
                { icon: Icons.UserGroup, title: "Actors", path: "/manage-actors" },
                { icon: Icons.Studio, title: "Studios", path: "/manage-studios" },
                { icon: Icons.Coomer, title: "Coomers", path: "/manage-coomers" },
                { icon: Icons.Hanime, title: "Hanime", path: "/manage-hanime" },
              ].map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleMenuNavigate(item.path)}
                  className={
                    isTransparentHeader
                      ? "w-full h-10 flex items-center justify-between px-4 rounded-full bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 active:scale-[0.985] select-none tap-highlight-none transition-all relative isolate solid-bg-layer"
                      : `w-full h-16 flex items-center justify-between px-6 hover:bg-[var(--accent)]/10 active:bg-[var(--accent)]/20 select-none tap-highlight-none transition-colors border-b ${
                          showHeaderBottomBorder ? 'border-b' : 'border-b-transparent'
                        }`
                  }
                  style={{ 
                    backgroundColor: isTransparentHeader ? undefined : colors.bg,
                    borderColor: showHeaderBottomBorder ? hColors.border : 'transparent',
                    color: accentColor,
                  }}
                >
                  <div className={`w-full flex items-center justify-between ${!isTransparentHeader ? 'max-w-2xl mx-auto' : ''}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CompactIcon size={isTransparentHeader ? 18 : 22}><item.icon /></CompactIcon>
                      <span 
                        className={`${isTransparentHeader ? 'text-[14px]' : 'text-[17px]'} font-semibold tracking-tight truncate`}
                        style={{ color: hColors.textPrimary }}
                      >
                        {item.title}
                      </span>
                    </div>
                    <CompactIcon size={isTransparentHeader ? 16 : 20}><Icons.ChevronRight /></CompactIcon>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <main 
        ref={scrollAreaRef} 
        id="scroll-area" 
        onScroll={saveCurrentScroll}
        onTouchStart={(e) => {
          const activeEl = document.activeElement;
          if (activeEl && 
              (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
              activeEl !== e.target) {
            (activeEl as HTMLElement).blur();
          }
        }}
        className="h-full w-full overflow-y-auto overflow-x-hidden pt-16 overscroll-contain" 
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className={`w-full max-w-2xl mx-auto ${isImmersivePage ? 'px-0' : 'px-4 pt-4 pb-0'}`}>
          {children}
        </div>
        <Notification />
      </main>
    </div>
  );
};
