/**
 * Utilities for Japanese Adult Video (JAV) identification,
 * code extraction, and Subtitlecat subtitle integration.
 */

export interface JavSubtitleTrack {
  language: string;
  srclang: string;
  url: string; // Proxy URL to our download endpoint
  directUrl: string; // Direct subtitlecat URL
  isDefault?: boolean;
}

export interface JavSubtitleSearchResult {
  success: boolean;
  code: string;
  title: string;
  pageUrl: string;
  subtitles: JavSubtitleTrack[];
  matchedTitle?: string;
  allMatchesCount?: number;
  error?: string;
}

/**
 * Extracts a standardized JAV code from a title, filename, or URL.
 * Handles patterns such as:
 * - Standard: SNOS-396, IPX-123, SSIS-001, ABP-456, MIDE-123, PRED-123, STARS-123, FSDSS-123, etc.
 * - Spaced/Underscored: SNOS 396, snos_396, snos396
 * - FC2: FC2-PPV-1234567, FC2-1234567, FC2PPV 1234567
 * - Subtitlecat URL: https://www.subtitlecat.com/subs/1689/SNOS-396.html
 * - Caribbean/Tokyo-Hot: 110121-001, 110121_001
 */
export function extractJavCode(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // 1. Direct subtitlecat URL or path
  const subCatMatch = trimmed.match(/\/subs\/\d+\/([a-zA-Z0-9_\-%]+?)(?:-en|-orig|-id|-ar|-zh|-fr|-de|-ko)?\.(?:html|srt|vtt)/i);
  if (subCatMatch) {
    try {
      const decoded = decodeURIComponent(subCatMatch[1]);
      const innerCode = extractJavCode(decoded);
      if (innerCode) return innerCode;
    } catch (e) {
      // ignore decode error
    }
  }

  // 2. FC2 format (e.g. FC2-PPV-1234567, FC2 1234567)
  const fc2Match = trimmed.match(/FC2[-_ ]?(?:PPV)?[-_ ]?(\d{5,8})/i);
  if (fc2Match) {
    return `FC2-PPV-${fc2Match[1]}`;
  }

  // 3. Caribbeancom / Tokyo Hot numeric codes (e.g. 110121-001)
  const caribMatch = trimmed.match(/\b(\d{6})[-_ ](\d{3})\b/);
  if (caribMatch) {
    return `${caribMatch[1]}-${caribMatch[2]}`;
  }

  // 4. Standard studio prefixes with hyphen or underscore: e.g. SNOS-396, IPX-123, SSIS-001
  // We match 2-8 alphabetic characters followed by hyphen/space/underscore and 2-6 digits
  const standardWithSep = trimmed.match(/\b([a-zA-Z]{2,8})[-_ ](\d{2,6})\b/i);
  if (standardWithSep) {
    return `${standardWithSep[1].toUpperCase()}-${standardWithSep[2]}`;
  }

  // 5. Studio prefixes without separator: e.g. SNOS396, IPX123, SSIS001
  const standardNoSep = trimmed.match(/\b([a-zA-Z]{2,6})(\d{3,5})\b/i);
  if (standardNoSep) {
    // Avoid common non-JAV words like mp4, mkv, h264, 1080p
    const prefix = standardNoSep[1].toUpperCase();
    if (!['MP', 'MKV', 'H', 'X', 'HEVC', 'AAC', 'EP'].includes(prefix)) {
      return `${prefix}-${standardNoSep[2]}`;
    }
  }

  return null;
}

/**
 * Checks if an input title, filename, or URL corresponds to a JAV video.
 */
export function isJavVideo(input: string | null | undefined): boolean {
  return extractJavCode(input) !== null;
}

/**
 * Converts Subtitlecat SRT or compacted text into a clean, standard WebVTT format.
 */
export function parseAndFormatVtt(raw: string): string {
  if (!raw || typeof raw !== 'string') return 'WEBVTT\n\n';

  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // If already standard WebVTT with cues separated by double newlines
  if (text.startsWith('WEBVTT') && text.includes('\n\n') && text.includes('-->')) {
    return text;
  }

  // Regex matching cue index + 00:00:00,000 --> 00:00:00,000 + cue body
  const regex = /(\d+?)(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})([\s\S]*?)(?=(?:\d+?\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->)|$)/g;

  const cues: string[] = [];
  let m: RegExpExecArray | null;
  let fallbackIndex = 1;

  while ((m = regex.exec(text)) !== null) {
    const cueIndex = m[1] || String(fallbackIndex);
    const start = m[2].replace(',', '.');
    const end = m[3].replace(',', '.');
    const cueBody = m[4].trim();
    if (cueBody) {
      cues.push(`${cueIndex}\n${start} --> ${end}\n${cueBody}`);
      fallbackIndex++;
    }
  }

  if (cues.length > 0) {
    return `WEBVTT\n\n${cues.join('\n\n')}\n`;
  }

  // Fallback conversion for standard SRT
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${text}\n`;
}

