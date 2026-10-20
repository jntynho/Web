import { StreamSource } from './types';

/**
 * MPEG-DASH Manifest Parser and Resolver
 * Analyzes MPD XML manifests to extract video representations and qualities
 */
export function parseDashManifest(
  manifestXml: string,
  baseUrl: string,
  proxyUrlBuilder?: (url: string) => string
): StreamSource[] {
  const streams: StreamSource[] = [];
  if (!manifestXml || typeof manifestXml !== 'string') return streams;

  // Extract <Representation> nodes
  const representationRegex = /<Representation\b([^>]*)>(.*?)<\/Representation>|<Representation\b([^>]*)\/>/gis;
  let match: RegExpExecArray | null;

  while ((match = representationRegex.exec(manifestXml)) !== null) {
    const attrs = match[1] || match[3] || '';
    const innerContent = match[2] || '';

    // Extract attributes
    const idMatch = attrs.match(/id="([^"]+)"/i);
    const widthMatch = attrs.match(/width="(\d+)"/i);
    const heightMatch = attrs.match(/height="(\d+)"/i);
    const bandwidthMatch = attrs.match(/bandwidth="(\d+)"/i);
    const frameRateMatch = attrs.match(/frameRate="([0-9./]+)"/i);
    const codecsMatch = attrs.match(/codecs="([^"]+)"/i);
    const mimeTypeMatch = attrs.match(/mimeType="([^"]+)"/i);

    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : '';
    // Only process video representations
    if (mimeType && !mimeType.startsWith('video/')) {
      continue;
    }

    const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;
    const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : undefined;
    
    let fps: number | undefined;
    if (frameRateMatch) {
      const parts = frameRateMatch[1].split('/');
      if (parts.length === 2) {
        fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
      } else {
        fps = Math.round(parseFloat(frameRateMatch[1]));
      }
    }

    let quality = 'Auto';
    if (height) {
      if (height >= 2160) quality = '2160p';
      else if (height >= 1440) quality = '1440p';
      else if (height >= 1080) quality = '1080p';
      else if (height >= 720) quality = '720p';
      else if (height >= 480) quality = '480p';
      else if (height >= 360) quality = '360p';
      else if (height >= 240) quality = '240p';
      else quality = `${height}p`;
    }

    // Extract BaseURL if available inside Representation
    const baseUrlMatch = innerContent.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
    let streamUrl = baseUrl;
    if (baseUrlMatch) {
      const subUrl = baseUrlMatch[1].trim();
      try {
        streamUrl = new URL(subUrl, baseUrl).href;
      } catch (e) {
        streamUrl = `${baseUrl}/${subUrl}`;
      }
    }

    const proxyUrl = proxyUrlBuilder ? proxyUrlBuilder(streamUrl) : streamUrl;
    const bitrateMbps = bandwidth && bandwidth > 0 ? (bandwidth / 1000000).toFixed(1) : null;
    const resStr = width && height ? `${width}×${height}` : '';
    let label = quality;
    if (resStr && bitrateMbps) {
      label = `${quality} (${resStr} • ${bitrateMbps} Mbps)`;
    } else if (resStr) {
      label = `${quality} (${resStr})`;
    } else if (bitrateMbps) {
      label = `${quality} (${bitrateMbps} Mbps)`;
    }

    streams.push({
      id: `dash-${idMatch ? idMatch[1] : quality}-${streams.length}`,
      url: proxyUrl,
      directUrl: streamUrl,
      streamProxyUrl: proxyUrl,
      downloadUrl: streamUrl,
      type: 'dash',
      quality,
      label,
      width,
      height,
      bitrate: bandwidth,
      fps,
      codec: codecsMatch ? codecsMatch[1] : undefined,
      mimeType: mimeType || 'application/dash+xml',
    });
  }

  return streams;
}
