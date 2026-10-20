import { decompressData } from './compression';

export interface SanitizeOptions {
  includeApiKeys?: boolean;
  stripCoomerPosts?: boolean;
}

/**
 * Recursively removes null, undefined, empty string "", and empty array []
 * to significantly reduce payload size without losing any meaningful data.
 * Also offloads bulky coomer post lists to preserve cloud storage quota.
 */
export function sanitizeStateForExport(obj: any, options: SanitizeOptions = { stripCoomerPosts: true }): any {
  const { includeApiKeys = true, stripCoomerPosts = true } = options;

  if (Array.isArray(obj)) {
    return obj
      .map(item => sanitizeStateForExport(item, options))
      .filter(val => val !== undefined && val !== null);
  }

  if (obj !== null && typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      // Exclude API keys if requested for secure/privacy sharing
      if (!includeApiKeys && ['torboxApiKey', 'realDebridApiKey', 'stashDbApiKey'].includes(key)) {
        continue;
      }
      // Offload massive coomer post lists from cloud payloads (sourceUrl and metadata are preserved)
      if (stripCoomerPosts && (key === 'posts' || key === 'onlyFansPosts' || key === 'instagramPosts') && Array.isArray(val)) {
        continue;
      }
      if (val === null || val === undefined || val === '') continue;
      if (Array.isArray(val) && val.length === 0) continue;
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && Object.keys(val).length === 0) continue;

      cleaned[key] = sanitizeStateForExport(val, options);
    }
    return cleaned;
  }

  return obj;
}

/**
 * Computes a fast SHA-256 hash string for checksum comparisons
 */
export async function computeDataHash(dataStr: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(dataStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }
  // Simple fast hash fallback
  let hash = 0;
  for (let i = 0; i < dataStr.length; i++) {
    const char = dataStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * Exports data either as ultra-compact Gzip binary (.json.gz) or minified JSON (.json)
 */
export async function exportBackupData(
  data: object,
  format: 'gzip' | 'json' = 'gzip',
  filenamePrefix: string = 'Vault_Backup'
): Promise<{ fileName: string; originalSize: number; exportedSize: number }> {
  const jsonStr = JSON.stringify(data);
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(jsonStr);
  const originalSize = rawBytes.byteLength;

  let blob: Blob;
  let ext: string;

  if (format === 'gzip' && typeof CompressionStream === 'function') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(rawBytes);
    writer.close();
    const compressedBuffer = await new Response(cs.readable).arrayBuffer();
    blob = new Blob([compressedBuffer], { type: 'application/gzip' });
    ext = 'json.gz';
  } else {
    blob = new Blob([rawBytes], { type: 'application/json' });
    ext = 'json';
  }

  const fileName = `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.${ext}`;
  const exportedSize = blob.size;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { fileName, originalSize, exportedSize };
}

/**
 * Intelligently reads any imported backup file:
 * - Detects binary Gzip (.json.gz, magic bytes 0x1F 0x8B) and decompresses natively
 * - Detects string-compressed backups (gz_v1:...)
 * - Detects regular minified or indented JSON (.json)
 */
export async function readImportBackupFile(file: File): Promise<any> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check Gzip magic numbers: 0x1f, 0x8b
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (isGzip && typeof DecompressionStream === 'function') {
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text);
    } catch (err) {
      console.warn('Native DecompressionStream failed, attempting fallback', err);
    }
  }

  // Otherwise read as text
  const text = new TextDecoder().decode(bytes);
  return decompressData(text);
}
