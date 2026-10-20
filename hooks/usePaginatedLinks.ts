import { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { filterLinks } from '../utils/search';

export const usePaginatedLinks = (
  items: any[],
  searchQuery: string,
  actorMap: Map<string, any>,
  studioMap: Map<string, any>,
  id?: string,
  sortOrderOverride?: string
) => {
  const location = useLocation();
  const { state, pageRegistry, setPageRegistry } = useApp();
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const pageKey = useMemo(() => location.pathname, [location.pathname]);
  const [currentPage, setCurrentPage] = useState(() => pageRegistry[pageKey] || 1);

  // Sync previous items length without triggering full page skeleton on deletions
  const [prevItemsLength, setPrevItemsLength] = useState(items.length);
  useEffect(() => {
    if (items.length !== prevItemsLength) {
      const isDeletion = items.length < prevItemsLength;
      setPrevItemsLength(items.length);
      // On item deletion, do not trigger a full blocking skeleton reload
      if (!isDeletion) {
        setIsLoading(true);
        const timer = setTimeout(() => setIsLoading(false), 400);
        return () => clearTimeout(timer);
      }
    }
  }, [items.length, prevItemsLength]);

  // Initial load skeleton - standard comfortable 400ms duration
  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 400);
    return () => clearTimeout(timer);
  }, [pageKey]);

  // Sync state with registry when pageKey changes (e.g. navigation)
  useEffect(() => {
    const registeredPage = pageRegistry[pageKey] || 1;
    if (currentPage !== registeredPage) {
      setCurrentPage(registeredPage);
    }
  }, [pageKey, pageRegistry]);

  // Handle page change
  const handlePageChange = useCallback((page: number, noSkeleton = false) => {
    setCurrentPage(page);
    setPageRegistry(prev => ({ ...prev, [pageKey]: page }));
    
    if (!noSkeleton) {
      setIsLoading(true);
      // Simulate loading to show skeleton effect
      setTimeout(() => {
        setIsLoading(false);
      }, 400); // 400ms skeleton
    }
  }, [pageKey, setPageRegistry]);

  // Reset page to 1 when search query changes
  useEffect(() => {
    if (searchQuery) {
      handlePageChange(1); // Allow skeleton when searching
    }
  }, [searchQuery, handlePageChange]);

  // Search effect
  useEffect(() => {
    setIsSearching(true);
    const timer = setTimeout(() => setIsSearching(false), 150); // Faster snappy feedback for typing
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter and sort logic
  const sortOrder = sortOrderOverride || state.settings.sortOrder;
  const prevSortOrderRef = useRef(sortOrder);
  const [isSortLoading, setIsSortLoading] = useState(false);

  useEffect(() => {
    if (sortOrder !== prevSortOrderRef.current) {
      prevSortOrderRef.current = sortOrder;
      setIsSortLoading(true);
      const timer = setTimeout(() => setIsSortLoading(false), 400);
      return () => clearTimeout(timer);
    }
  }, [sortOrder]);

  // Scroll restoration
  useEffect(() => {
    if (!isLoading && !isSearching && !isSortLoading) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('restore-scroll'));
      });
    }
  }, [location.pathname, isLoading, isSearching, isSortLoading]);

  const filteredLinks = useMemo(() => {
    let filtered = filterLinks(items, deferredSearchQuery, actorMap, studioMap, id);
    if (!deferredSearchQuery || typeof deferredSearchQuery !== 'string' || !deferredSearchQuery.trim()) {
      filtered = [...filtered].sort((a, b) => {
        if (sortOrder === 'Newest') return (b.createdAt || 0) - (a.createdAt || 0);
        if (sortOrder === 'Oldest') return (a.createdAt || 0) - (b.createdAt || 0);
        if (sortOrder === 'A-Z') return a.title.localeCompare(b.title);
        if (sortOrder === 'Z-A') return b.title.localeCompare(a.title);
        
        if (sortOrder === 'DateDesc' || sortOrder === 'DateAsc') {
          const aDate = a.assignedDate;
          const bDate = b.assignedDate;
          
          if (aDate !== undefined && bDate !== undefined) {
            return sortOrder === 'DateDesc' ? bDate - aDate : aDate - bDate;
          }
          if (aDate !== undefined) return -1;
          if (bDate !== undefined) return 1;
          
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        return 0;
      });
    }
    return filtered;
  }, [items, deferredSearchQuery, sortOrder, actorMap, studioMap, id]);

  // Pagination logic
  const paginatedLinks = useMemo(() => {
    const start = (currentPage - 1) * state.settings.itemsPerPage;
    const end = start + state.settings.itemsPerPage;
    return filteredLinks.slice(start, end);
  }, [filteredLinks, currentPage, state.settings.itemsPerPage]);

  // Reset page if out of bounds
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredLinks.length / state.settings.itemsPerPage));
    if (currentPage > maxPage) {
      setCurrentPage(maxPage);
    }
  }, [filteredLinks.length, state.settings.itemsPerPage, currentPage]);

  return {
    filteredLinks,
    paginatedLinks,
    currentPage,
    handlePageChange,
    isLoading: isLoading || isSortLoading || isSearching,
    isSearching,
    itemsPerPage: state.settings.itemsPerPage
  };
};
