/**
 * Compression and Decompression Utility for Cloud Sync & Backups.
 * Uses native browser CompressionStream (Gzip) with Base64 encoding.
 * Includes automatic detection for backward compatibility with uncompressed JSON.
 */

const COMPRESSION_PREFIX = 'gz_v1:';

/**
 * Checks if a string payload is compressed.
 */
export const isCompressedData = (str: string): boolean => {
  return typeof str === 'string' && str.startsWith(COMPRESSION_PREFIX);
};

/**
 * Compresses a JavaScript object or raw string into a compressed Gzip-Base64 string.
 */
export const compressData = async (data: object | string): Promise<string> => {
  try {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Check if CompressionStream is supported by modern browsers
    if (typeof CompressionStream === 'function') {
      const encoder = new TextEncoder();
      const rawBytes = encoder.encode(jsonStr);

      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(rawBytes);
      writer.close();

      const compressedBuffer = await new Response(cs.readable).arrayBuffer();
      const bytes = new Uint8Array(compressedBuffer);

      // Fast Base64 encoding using binary string chunks to avoid stack overflow
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      return COMPRESSION_PREFIX + base64;
    }

    // Fallback: return raw JSON if CompressionStream is not available
    return jsonStr;
  } catch (error) {
    console.warn('[Compression] Compression failed, falling back to raw JSON:', error);
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
};

/**
 * Decompresses a payload (compressed or raw JSON string/object) into a parsed JavaScript object.
 */
export const decompressData = async (input: string | object): Promise<any> => {
  if (!input) return null;
  
  if (typeof input === 'object') {
    return input;
  }

  const trimmed = input.trim();

  // If not prefixed with compression header, parse as normal JSON (backward compatibility)
  if (!isCompressedData(trimmed)) {
    return JSON.parse(trimmed);
  }

  try {
    const base64Data = trimmed.slice(COMPRESSION_PREFIX.length);
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();

      const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
      const text = new TextDecoder().decode(decompressedBuffer);
      return JSON.parse(text);
    }

    throw new Error('DecompressionStream is not supported on this device.');
  } catch (error) {
    console.error('[Compression] Decompression error:', error);
    throw error;
  }
};
