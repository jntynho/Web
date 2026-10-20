import { StreamSource } from './types';

/**
 * HLS Playlist Parser and Resolver
 * Analyzes M3U8 Master Playlists to extract all variant streams, resolutions, bitrates, and codecs
 */
export function parseHlsMasterPlaylist(
  playlistText: string,
  baseUrl: string,
  proxyUrlBuilder?: (url: string) => string
): StreamSource[] {
  const streams: StreamSource[] = [];
  if (!playlistText || typeof playlistText !== 'string') return streams;

  const lines = playlistText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let currentStreamInf: {
    bandwidth?: number;
    resolution?: string;
    width?: number;
    height?: number;
    fps?: number;
    codecs?: string;
    audio?: string;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attributes = line.substring('#EXT-X-STREAM-INF:'.length);
      currentStreamInf = {};

      // Match BANDWIDTH
      const bwMatch = attributes.match(/BANDWIDTH=(\d+)/i);
      if (bwMatch) {
        currentStreamInf.bandwidth = parseInt(bwMatch[1], 10);
      }

      // Match RESOLUTION (e.g. 1920x1080)
      const resMatch = attributes.match(/RESOLUTION=(\d+)x(\d+)/i);
      if (resMatch) {
        currentStreamInf.width = parseInt(resMatch[1], 10);
        currentStreamInf.height = parseInt(resMatch[2], 10);
        currentStreamInf.resolution = `${resMatch[1]}x${resMatch[2]}`;
      }

      // Match FRAME-RATE (e.g. 30.000 or 60.000)
      const fpsMatch = attributes.match(/FRAME-RATE=([0-9.]+)/i);
      if (fpsMatch) {
        currentStreamInf.fps = Math.round(parseFloat(fpsMatch[1]));
      }

      // Match CODECS
      const codecsMatch = attributes.match(/CODECS="([^"]+)"/i);
      if (codecsMatch) {
        currentStreamInf.codecs = codecsMatch[1];
      }

      // Match AUDIO
      const audioMatch = attributes.match(/AUDIO="([^"]+)"/i);
      if (audioMatch) {
        currentStreamInf.audio = audioMatch[1];
      }
    } else if (!line.startsWith('#') && currentStreamInf) {
      // This line is the URI for the current variant
      let variantUrl = line;
      try {
        if (!variantUrl.startsWith('http://') && !variantUrl.startsWith('https://')) {
          variantUrl = new URL(variantUrl, baseUrl).href;
        }
      } catch (e) {
        // Fallback to simple concatenation if URL constructor fails
        if (!variantUrl.startsWith('http')) {
          const slash = baseUrl.endsWith('/') ? '' : '/';
          variantUrl = `${baseUrl}${slash}${variantUrl}`;
        }
      }

      const height = currentStreamInf.height || 0;
      let quality = 'Auto';
      if (height >= 2160) quality = '2160p';
      else if (height >= 1440) quality = '1440p';
      else if (height >= 1080) quality = '1080p';
      else if (height >= 720) quality = '720p';
      else if (height >= 480) quality = '480p';
      else if (height >= 360) quality = '360p';
      else if (height >= 240) quality = '240p';
      else if (currentStreamInf.resolution) quality = `${currentStreamInf.height}p`;

      const bitrateBps = currentStreamInf.bandwidth || 0;
      const bitrateMbps = bitrateBps > 0 ? (bitrateBps / 1000000).toFixed(1) : null;
      const resStr = currentStreamInf.width && currentStreamInf.height ? `${currentStreamInf.width}×${currentStreamInf.height}` : '';
      
      let label = quality;
      if (resStr && bitrateMbps) {
        label = `${quality} (${resStr} • ${bitrateMbps} Mbps)`;
      } else if (resStr) {
        label = `${quality} (${resStr})`;
      } else if (bitrateMbps) {
        label = `${quality} (${bitrateMbps} Mbps)`;
      }

      const proxyUrl = proxyUrlBuilder ? proxyUrlBuilder(variantUrl) : variantUrl;

      streams.push({
        id: `hls-${quality}-${streams.length}`,
        url: proxyUrl,
        directUrl: variantUrl,
        streamProxyUrl: proxyUrl,
        downloadUrl: variantUrl,
        type: 'hls',
        quality,
        label,
        width: currentStreamInf.width,
        height: currentStreamInf.height,
        bitrate: bitrateBps,
        fps: currentStreamInf.fps,
        codec: currentStreamInf.codecs,
        mimeType: 'application/x-mpegURL',
        video: {
          codec: currentStreamInf.codecs?.split(',')[0]?.trim(),
          fps: currentStreamInf.fps,
        },
        audio: {
          codec: currentStreamInf.codecs?.split(',')[1]?.trim(),
        },
      });

      currentStreamInf = null;
    }
  }

  return streams;
}
