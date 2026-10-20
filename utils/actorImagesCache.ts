import { getItem, setItem } from './storage';
import { Actor } from '../types';

// In-memory quick cache for instant synchronous access
const memoryCache = new Map<string, string[]>();

/**
 * Normalizes a cache key (UUID or actor name)
 */
const normalizeKey = (key: string): string => {
  return (key || '').toLowerCase().trim().replace(/\s+/g, '_');
};

/**
 * Stores actor images in both memory cache and persistent IndexedDB.
 */
export const cacheActorImages = async (key: string, images: string[]): Promise<void> => {
  if (!key || !Array.isArray(images) || images.length === 0) return;
  const cleanKey = normalizeKey(key);
  const uniqueImages = Array.from(new Set(images.filter(Boolean)));
  
  memoryCache.set(cleanKey, uniqueImages);
  try {
    await setItem(`actor_imgs_${cleanKey}`, uniqueImages);
  } catch (e) {
    console.warn('[ActorImagesCache] Failed to persist images to IndexedDB:', e);
  }
};

/**
 * Retrieves cached actor images from memory or IndexedDB.
 */
export const getCachedActorImages = async (key: string): Promise<string[] | null> => {
  if (!key) return null;
  const cleanKey = normalizeKey(key);
  
  // Check memory cache first
  if (memoryCache.has(cleanKey)) {
    return memoryCache.get(cleanKey)!;
  }
  
  // Check IndexedDB
  try {
    const stored = await getItem(`actor_imgs_${cleanKey}`);
    if (Array.isArray(stored) && stored.length > 0) {
      memoryCache.set(cleanKey, stored);
      return stored;
    }
  } catch (e) {
    console.warn('[ActorImagesCache] Failed to read from IndexedDB:', e);
  }
  
  return null;
};

export interface ActorSocials {
  instagramUrl?: string;
  twitterUrl?: string;
  onlyFansUrl?: string;
}

/**
 * Parses performer URLs array from StashDB and extracts social links.
 */
export const extractSocialUrls = (urls?: Array<{ url: string; type?: string; site?: { name?: string } }>): ActorSocials => {
  const result: ActorSocials = {};
  if (!Array.isArray(urls)) return result;

  for (const item of urls) {
    if (!item || !item.url) continue;
    const u = item.url.trim();
    const siteName = (item.site?.name || '').toLowerCase();
    const type = (item.type || '').toLowerCase();

    // Instagram
    if (!result.instagramUrl && (u.includes('instagram.com') || siteName.includes('instagram') || type.includes('instagram'))) {
      result.instagramUrl = u;
    }
    // Twitter / X
    else if (!result.twitterUrl && (u.includes('twitter.com') || u.includes('x.com') || siteName.includes('twitter') || siteName.includes('x') || type.includes('twitter'))) {
      result.twitterUrl = u;
    }
    // OnlyFans
    else if (!result.onlyFansUrl && (u.includes('onlyfans.com') || siteName.includes('onlyfans') || type.includes('onlyfans'))) {
      result.onlyFansUrl = u;
    }
  }

  return result;
};

/**
 * Fetches performer images and social links from StashDB on-demand using either stashDbId or performer name,
 * and caches them locally in IndexedDB without polluting the main AppState.
 */
export const fetchAndCacheActorImages = async (
  actor: { id?: string; stashDbId?: string; name: string; imageUrl?: string; availableImages?: string[]; instagramUrl?: string; twitterUrl?: string; onlyFansUrl?: string },
  apiKey?: string
): Promise<{ images: string[]; stashDbId?: string; socials?: ActorSocials }> => {
  const fallbackImages = Array.from(
    new Set([
      ...(actor.availableImages || []),
      actor.imageUrl
    ].filter(Boolean) as string[])
  );

  const initialSocials: ActorSocials = {
    instagramUrl: actor.instagramUrl,
    twitterUrl: actor.twitterUrl,
    onlyFansUrl: actor.onlyFansUrl
  };

  // 1. Try to get from local cache first by stashDbId or name
  if (actor.stashDbId) {
    const cached = await getCachedActorImages(actor.stashDbId);
    if (cached && cached.length > 0 && (initialSocials.instagramUrl || initialSocials.twitterUrl || initialSocials.onlyFansUrl)) {
      return { images: cached, stashDbId: actor.stashDbId, socials: initialSocials };
    }
  }
  
  if (actor.name) {
    const cached = await getCachedActorImages(actor.name);
    if (cached && cached.length > 0 && (initialSocials.instagramUrl || initialSocials.twitterUrl || initialSocials.onlyFansUrl)) {
      return { images: cached, stashDbId: actor.stashDbId, socials: initialSocials };
    }
  }

  // If no API key, return fallback
  if (!apiKey) {
    return { images: fallbackImages, stashDbId: actor.stashDbId, socials: initialSocials };
  }

  // 3. Query StashDB GraphQL API via proxy
  try {
    let images: string[] = [];
    let foundStashDbId = actor.stashDbId;
    let foundSocials: ActorSocials = { ...initialSocials };

    if (actor.stashDbId) {
      const query = `
        query FindPerformerImagesAndSocials($id: ID!) {
          findPerformer(id: $id) {
            id
            name
            images {
              url
            }
            urls {
              url
              type
              site {
                name
              }
            }
          }
        }
      `;
      const res = await fetch('/api/stashdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          query,
          variables: { id: actor.stashDbId },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const performer = json.data?.findPerformer;
        if (performer) {
          if (Array.isArray(performer.images)) {
            images = performer.images.map((img: any) => img.url).filter(Boolean);
          }
          if (Array.isArray(performer.urls)) {
            const parsed = extractSocialUrls(performer.urls);
            foundSocials = {
              instagramUrl: parsed.instagramUrl || foundSocials.instagramUrl,
              twitterUrl: parsed.twitterUrl || foundSocials.twitterUrl,
              onlyFansUrl: parsed.onlyFansUrl || foundSocials.onlyFansUrl,
            };
          }
        }
      }
    }

    // If stashDbId fetch yielded no images or we had no stashDbId, search by name
    if (images.length === 0 && actor.name && actor.name.trim().length > 0) {
      const cleanName = actor.name.trim();
      const searchQuery = `
        query SearchPerformerImagesAndSocials($term: String!) {
          searchPerformer(term: $term, limit: 5) {
            id
            name
            disambiguation
            images {
              url
            }
            urls {
              url
              type
              site {
                name
              }
            }
          }
        }
      `;
      const res = await fetch('/api/stashdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          query: searchQuery,
          variables: { term: cleanName },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const results = json.data?.searchPerformer || [];
        // Find exact or closest match
        const exactMatch = results.find(
          (p: any) => (p.name || '').trim().toLowerCase() === cleanName.toLowerCase()
        ) || results[0];

        if (exactMatch) {
          foundStashDbId = exactMatch.id;
          if (Array.isArray(exactMatch.images)) {
            images = exactMatch.images.map((img: any) => img.url).filter(Boolean);
          }
          if (Array.isArray(exactMatch.urls)) {
            const parsed = extractSocialUrls(exactMatch.urls);
            foundSocials = {
              instagramUrl: parsed.instagramUrl || foundSocials.instagramUrl,
              twitterUrl: parsed.twitterUrl || foundSocials.twitterUrl,
              onlyFansUrl: parsed.onlyFansUrl || foundSocials.onlyFansUrl,
            };
          }
        }
      }
    }

    // Deduplicate and combine with existing image URL
    const combined = Array.from(
      new Set([actor.imageUrl, ...images, ...fallbackImages].filter(Boolean) as string[])
    );

    if (combined.length > 0) {
      if (foundStashDbId) await cacheActorImages(foundStashDbId, combined);
      if (actor.name) await cacheActorImages(actor.name, combined);
      return { images: combined, stashDbId: foundStashDbId, socials: foundSocials };
    }
  } catch (e) {
    console.warn('[ActorImagesCache] Error fetching from StashDB:', e);
  }

  return { images: fallbackImages, stashDbId: actor.stashDbId, socials: initialSocials };
};

/**
 * Cleans an Actor object before saving to AppState, caching its availableImages into local storage
 * and stripping the large array from the state payload.
 */
export const cleanActorForState = (actor: Actor): Actor => {
  if (actor.availableImages && actor.availableImages.length > 0) {
    // Cache in local IndexedDB asynchronously
    if (actor.stashDbId) cacheActorImages(actor.stashDbId, actor.availableImages).catch(e => console.warn('[ActorImagesCache] cache failed:', e));
    if (actor.name) cacheActorImages(actor.name, actor.availableImages).catch(e => console.warn('[ActorImagesCache] cache failed:', e));
  }

  const { availableImages, ...cleanActor } = actor;
  return cleanActor as Actor;
};
