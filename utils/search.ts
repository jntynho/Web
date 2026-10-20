
import { LinkItem, Actor, Studio } from '../types';

export interface SearchResult<T> {
  item: T;
  score: number;
}

/**
 * Normalizes strings by removing accents, special characters, and extra whitespace.
 * Supports all languages by using Unicode property escapes.
 */
const normalize = (str: string) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove Latin diacritics
    .replace(/[\u064B-\u065F\u0670]/g, '') // Remove Arabic diacritics
    .replace(/[\u0623\u0625\u0622]/g, '\u0627') // Normalize Alef
    .replace(/\u0629/g, '\u0647') // Normalize Taa Marbuta
    .replace(/\u0649/g, '\u064A') // Normalize Alef Maksura/Yaa
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Improved fuzzy score logic with higher weights for exact inclusion.
 */
const getFuzzyScore = (target: string, query: string): number => {
  const t = normalize(target);
  const q = normalize(query);

  if (!q) return 0;
  if (!t) return 0;
  if (t === q) return 2.0; // Boost exact matches significantly
  if (t.startsWith(q)) return 1.5;
  if (t.includes(q)) return 1.2;

  // Split into words for partial matching
  const targetWords = t.split(' ');
  const queryWords = q.split(' ');
  
  let matchCount = 0;
  for (const qw of queryWords) {
    if (qw.length < 2) continue;
    if (targetWords.some(tw => tw.startsWith(qw) || tw.includes(qw))) {
      matchCount++;
    }
  }

  // Calculate Jaccard-like similarity for fuzzy resilience
  return (matchCount / queryWords.length);
};

export const filterLinks = (
  links: LinkItem[],
  query: string,
  actorMap: Map<string, Actor>,
  studioMap: Map<string, Studio>,
  contextId?: string // Optional context (Actor/Studio ID) to prioritize
): LinkItem[] => {
  if (!query || typeof query !== 'string' || !query.trim()) return links;

  const results: SearchResult<LinkItem>[] = links.map(link => {
    // If we are in a Vault, and the link belongs to that vault, it gets a baseline score
    const isContextMatch = contextId && ((link.actorIds || []).includes(contextId) || (link.studioIds || []).includes(contextId));
    const baseline = isContextMatch ? 0.5 : 0;

    const linkActors = (link.actorIds || []).map(id => actorMap.get(id)).filter((a): a is Actor => !!a);
    const linkStudios = (link.studioIds || []).map(id => studioMap.get(id)).filter((t): t is Studio => !!t);

    // Calculate scores for fields
    const titleScore = getFuzzyScore(link.title, query) * 1.5;
    
    const actorScore = linkActors.reduce((acc, actor) => {
      return Math.max(acc, getFuzzyScore(actor.name, query));
    }, 0) * 1.3;

    const studioScore = linkStudios.reduce((acc, studio) => {
      return Math.max(acc, getFuzzyScore(studio.name, query));
    }, 0) * 1.1;

    const urlScore = Math.max(
      getFuzzyScore(link.urlHD || '', query),
      getFuzzyScore(link.url4K || '', query)
    ) * 0.4;

    return {
      item: link,
      score: Math.max(baseline, titleScore, actorScore, studioScore, urlScore)
    };
  });

  return results
    .filter(r => r.score > 0.4) // Strict threshold to maintain quality
    .sort((a, b) => b.score - a.score)
    .map(r => r.item);
};
