import {
  VideoResolver,
  ResolvedVideoMedia,
  StreamSource,
  VideoResolverError,
  ResolverErrorCode,
} from './types';
import {
  pornhubResolver,
  isPornhubUrl,
  extractPornhubViewkey,
  getPornhubStreamProxyUrl,
  getPornhubIntentUrl,
  getPornhubVlcUrl,
} from './pornhubResolver';
import {
  xhamsterResolver,
  isXhamsterUrl,
  extractXhamsterId,
  getXhamsterStreamProxyUrl,
  getXhamsterIntentUrl,
  getXhamsterVlcUrl,
  decodeXhamsterUrl,
} from './xhamsterResolver';
import {
  porntrexResolver,
  isPorntrexUrl,
  extractPorntrexVideoId,
  getPorntrexStreamProxyUrl,
  getPorntrexIntentUrl,
  getPorntrexVlcUrl,
} from './porntrexResolver';
import { normalizeStreams } from './streamNormalizer';
import { parseHlsMasterPlaylist } from './hlsResolver';
import { parseDashManifest } from './dashResolver';

// Global Resolver Registry
const resolvers: VideoResolver[] = [
  pornhubResolver,
  xhamsterResolver,
  porntrexResolver,
];

/**
 * Register an additional video resolver
 */
export function registerResolver(resolver: VideoResolver): void {
  const existingIdx = resolvers.findIndex(r => r.name === resolver.name);
  if (existingIdx >= 0) {
    resolvers[existingIdx] = resolver;
  } else {
    resolvers.push(resolver);
  }
}

/**
 * Finds the appropriate resolver for a given URL
 */
export function findResolver(url: string): VideoResolver | null {
  if (!url || typeof url !== 'string') return null;
  for (const resolver of resolvers) {
    if (resolver.canResolve(url)) {
      return resolver;
    }
  }
  return null;
}

/**
 * Checks if a given URL is supported by any registered video resolver
 */
export function canResolveVideoUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return Boolean(findResolver(url));
}

/**
 * Resolves a video page URL into unified streams and metadata
 */
export async function resolveVideoUrl(
  url: string,
  signal?: AbortSignal
): Promise<ResolvedVideoMedia> {
  const resolver = findResolver(url);
  if (!resolver) {
    throw new VideoResolverError(
      'No registered resolver for this video URL',
      'UNSUPPORTED_STREAM',
      { url }
    );
  }

  return resolver.resolve(url, signal);
}

// Re-exports
export * from './types';
export * from './hlsResolver';
export * from './dashResolver';
export * from './streamNormalizer';
export {
  pornhubResolver,
  isPornhubUrl,
  extractPornhubViewkey,
  getPornhubStreamProxyUrl,
  getPornhubIntentUrl,
  getPornhubVlcUrl,
  xhamsterResolver,
  isXhamsterUrl,
  extractXhamsterId,
  getXhamsterStreamProxyUrl,
  getXhamsterIntentUrl,
  getXhamsterVlcUrl,
  decodeXhamsterUrl,
  porntrexResolver,
  isPorntrexUrl,
  extractPorntrexVideoId,
  getPorntrexStreamProxyUrl,
  getPorntrexIntentUrl,
  getPorntrexVlcUrl,
};
