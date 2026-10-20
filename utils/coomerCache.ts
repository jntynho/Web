import { getItem, setItem, removeItem } from './storage';
import { Coomer, CoomerPost } from '../types';

// Fast in-memory cache map for instantaneous synchronous lookups
const coomerPostsMemoryCache = new Map<string, CoomerPost[]>();

/**
 * Persists coomer posts to IndexedDB and memory cache
 */
export const cacheCoomerPosts = async (id: string, posts: CoomerPost[]): Promise<void> => {
  if (!id || !Array.isArray(posts)) return;
  coomerPostsMemoryCache.set(id, posts);
  try {
    await setItem(`coomer_posts_${id}`, posts);
  } catch (err) {
    console.warn('[CoomerCache] Failed to persist posts to IndexedDB:', err);
  }
};

/**
 * Retrieves coomer posts from memory cache or IndexedDB
 */
export const getCachedCoomerPosts = async (id: string): Promise<CoomerPost[] | null> => {
  if (!id) return null;
  
  // 1. Check memory cache (0ms)
  if (coomerPostsMemoryCache.has(id)) {
    return coomerPostsMemoryCache.get(id)!;
  }

  // 2. Check IndexedDB
  try {
    const stored = await getItem(`coomer_posts_${id}`);
    if (Array.isArray(stored) && stored.length > 0) {
      coomerPostsMemoryCache.set(id, stored);
      return stored;
    }
  } catch (err) {
    console.warn('[CoomerCache] Failed to read from IndexedDB:', err);
  }

  return null;
};

/**
 * Removes cached posts when a coomer creator is permanently deleted
 */
export const removeCachedCoomerPosts = async (id: string): Promise<void> => {
  if (!id) return;
  coomerPostsMemoryCache.delete(id);
  try {
    await removeItem(`coomer_posts_${id}`);
    await removeItem(`coomer_pages_${id}`);
  } catch (err) {
    console.warn('[CoomerCache] Failed to remove from IndexedDB:', err);
  }
};

/**
 * Prepares a Coomer object for state/export/cloud storage:
 * Saves bulky posts into IndexedDB, and leaves a super-lightweight metadata object in memory.
 */
export const cleanCoomerForState = (coomer: Coomer): Coomer => {
  if (!coomer) return coomer;

  const allPosts = [
    ...(coomer.posts || []),
    ...(coomer.onlyFansPosts || []),
    ...(coomer.instagramPosts || [])
  ];

  const totalCount = coomer.totalPostsCount || allPosts.length;

  if (allPosts.length > 0) {
    // Persist full posts array to IndexedDB asynchronously
    cacheCoomerPosts(coomer.id, allPosts).catch(() => {});
  }

  // Return a lightweight Coomer object without duplicating massive post arrays in cloud state
  return {
    ...coomer,
    totalPostsCount: totalCount,
    posts: [], // Offloaded to local cache
    onlyFansPosts: [],
    instagramPosts: []
  };
};
