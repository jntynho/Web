import React, { useEffect, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import {
  X,
  Copy,
  Check,
  AlertTriangle,
  Play,
  Loader2,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../AppContext';
import {
  getPixeldrainDownloadUrl,
  getPixeldrainDirectUrl,
  getPixeldrainStreamProxyUrl,
  getPixeldrainIntentUrl,
  extractPixeldrainUrl,
} from '../utils/pixeldrain';
import {
  isBunkrUrl,
  extractBunkrUrl,
  getBunkrIntentUrl,
  getBunkrStreamProxyUrl,
} from '../utils/bunkr';
import {
  isFilesterUrl,
  extractFilesterUrl,
  getFilesterIntentUrl,
  getFilesterStreamProxyUrl,
} from '../utils/filester';
import {
  isGofileUrl,
  extractGofileUrl,
  getGofileIntentUrl,
  getGofileStreamProxyUrl,
  GofileFileItem,
} from '../utils/gofile';
import {
  isCyberfileUrl,
  extractCyberfileUrl,
  getCyberfileIntentUrl,
  getCyberfileStreamProxyUrl,
} from '../utils/cyberfile';
import {
  isFileditchUrl,
  extractFileditchUrl,
  getFileditchIntentUrl,
  getFileditchStreamProxyUrl,
  extractFileditchWorkerUrlFromText,
  doesWorkerUrlMatchTarget,
  extractFileditchFilename,
} from '../utils/fileditch';
import {
  isEpornerUrl,
  extractEpornerUrl,
  getEpornerIntentUrl,
  getEpornerStreamProxyUrl,
} from '../utils/eporner';
import {
  isHanimestreamUrl,
  extractHanimestreamUrl,
  getHanimestreamIntentUrl,
  HanimestreamSubtitle,
} from '../utils/hanimestream';
import {
  isPornhubUrl,
  pornhubResolver,
  getPornhubStreamProxyUrl,
  getPornhubIntentUrl,
  isXhamsterUrl,
  xhamsterResolver,
  getXhamsterStreamProxyUrl,
  getXhamsterIntentUrl,
  isPorntrexUrl,
  porntrexResolver,
  getPorntrexStreamProxyUrl,
  getPorntrexIntentUrl,
} from '../utils/videoResolver';
import { extractJavCode } from '../utils/javSubtitles';
import * as dashjs from 'dashjs';
import { copyTextToClipboard } from '../utils/clipboard';

interface GoPlayerProps {
  url: string;
  title?: string;
  onClose: () => void;
  accentColor?: string;
  initialQuality?: '2160p' | '1080p' | '720p' | '480p' | string;
  isCoverEmbed?: boolean;
  poster?: string;
}

const formatPlaybackTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const sec = s % 60;
  const min = m % 60;
  if (h > 0) {
    return `${h}:${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
  }
  return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
};

const getPlaybackStorageKey = (rawUrl: string): string => {
  try {
    const clean = rawUrl.split('?')[0];
    return 'video_progress_' + clean.replace(/[^a-zA-Z0-9_-]/g, '_');
  } catch (e) {
    return 'video_progress_' + encodeURIComponent(rawUrl).slice(0, 60);
  }
};

export const GoPlayer: React.FC<GoPlayerProps> = ({
  url,
  title: initialTitle,
  onClose,
  accentColor = '#3b82f6',
  initialQuality,
  isCoverEmbed = false,
  poster,
}) => {
  const { state, addNotification, updateSettings } = useApp();
  const settings = state?.settings;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Artplayer | null>(null);
  const lastPlaybackTimeRef = useRef<number>(0);
  const lastStorageSaveRef = useRef<number>(0);
  const activeLoadedUrlRef = useRef<string>('');

  const isBunkr = isBunkrUrl(url);
  const isFilester = isFilesterUrl(url);
  const isGofile = isGofileUrl(url);
  const isCyberfile = isCyberfileUrl(url);
  const isFileditch = isFileditchUrl(url);
  const isEporner = isEpornerUrl(url);
  const isHanimestream = isHanimestreamUrl(url);
  const isPornhub = isPornhubUrl(url);
  const isXhamster = isXhamsterUrl(url);
  const isPorntrex = isPorntrexUrl(url);
  const isAsyncProvider = isBunkr || isFilester || isGofile || isCyberfile || isFileditch || isEporner || isHanimestream || isPornhub || isXhamster || isPorntrex;

  const [streamSource, setStreamSource] = useState<'proxy' | 'direct'>(isFileditch || isFilester || isCyberfile || isHanimestream || isXhamster || isPorntrex ? 'direct' : 'proxy');
  const [videoTitle, setVideoTitle] = useState(
    initialTitle || (isPorntrex ? 'Porntrex Video' : isXhamster ? 'xHamster Video' : isHanimestream ? 'Hanimestream Video' : isPornhub ? 'Pornhub Video' : isEporner ? 'Eporner Video' : isFileditch ? 'FileDitch Video' : isGofile ? 'Gofile Video' : isCyberfile ? 'CyberFile Video' : isFilester ? 'Filester Video' : isBunkr ? 'Bunkr Video' : 'Pixeldrain Video')
  );
  const [copied, setCopied] = useState(false);
  const [hasCodecError, setHasCodecError] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isExtracting, setIsExtracting] = useState(isAsyncProvider);

  const [availableFiles, setAvailableFiles] = useState<GofileFileItem[]>([]);
  const availableFilesRef = useRef<GofileFileItem[]>([]);
  useEffect(() => {
    availableFilesRef.current = availableFiles;
  }, [availableFiles]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const [extractedStreamUrls, setExtractedStreamUrls] = useState<{
    direct: string;
    proxy: string;
    poster?: string;
    downloadUrl?: string;
  } | null>(null);

  const [extractedSubtitles, setExtractedSubtitles] = useState<HanimestreamSubtitle[]>([]);
  const [activeSubtitleSrc, setActiveSubtitleSrc] = useState<string>('off');
  const activeSubtitleSrcRef = useRef<string>('off');

  // AI Subtitle Translation States
  const [isTranslatingSubtitles, setIsTranslatingSubtitles] = useState(false);
  const [translationProgressText, setTranslationProgressText] = useState('');
  const [translationPercent, setTranslationPercent] = useState<number>(0);
  const [translationElapsed, setTranslationElapsed] = useState<number>(0);
  const [arabicSubBlobUrl, setArabicSubBlobUrl] = useState<string | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const handleSelectArabicSubtitleRef = useRef<(overrideApiKey?: string) => void>(() => {});

  const [showSnifferInput, setShowSnifferInput] = useState(false);
  const lastProcessedTextRef = useRef<string>('');
  const baselineClipboardRef = useRef<string>('');

  // Reset bridge & sniffer states whenever URL changes so a new link never inherits previous link's state
  useEffect(() => {
    setShowSnifferInput(false);
    setIsBridgeRunning(false);
    lastProcessedTextRef.current = '';
    baselineClipboardRef.current = '';
    setExtractedSubtitles([]);
    setActiveSubtitleSrc('off');
    activeSubtitleSrcRef.current = 'off';
    setArabicSubBlobUrl(null);
    setIsTranslatingSubtitles(false);
    setTranslationPercent(0);
    setTranslationElapsed(0);
  }, [url]);

  // Live timer for subtitle translation
  useEffect(() => {
    if (!isTranslatingSubtitles) {
      setTranslationElapsed(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setTranslationElapsed((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isTranslatingSubtitles]);

  const activeSelectedFile = availableFiles.find(f => f.id === selectedFileId);

  // Determine direct and proxy URLs depending on provider & selected file
  const directCdnUrl = activeSelectedFile
    ? activeSelectedFile.directStreamUrl
    : isAsyncProvider
      ? (extractedStreamUrls?.direct || url)
      : getPixeldrainDirectUrl(url);

  const direct1DMUrl = activeSelectedFile
    ? (activeSelectedFile.downloadUrl || activeSelectedFile.directStreamUrl)
    : isAsyncProvider
      ? (extractedStreamUrls?.downloadUrl || extractedStreamUrls?.direct || url)
      : getPixeldrainDownloadUrl(url);

  const proxyStreamUrl = activeSelectedFile
    ? activeSelectedFile.streamProxyUrl
    : isAsyncProvider
      ? (extractedStreamUrls?.proxy || (isPorntrex ? getPorntrexStreamProxyUrl(url) : isXhamster ? getXhamsterStreamProxyUrl(url) : isPornhub ? getPornhubStreamProxyUrl(url) : isEporner ? getEpornerStreamProxyUrl(url) : isFileditch ? getFileditchStreamProxyUrl(url) : isGofile ? getGofileStreamProxyUrl(url) : isCyberfile ? getCyberfileStreamProxyUrl(url) : isFilester ? getFilesterStreamProxyUrl(url) : getBunkrStreamProxyUrl(url)))
      : getPixeldrainStreamProxyUrl(url);

  const activeVideoSrc = (isEporner || isPornhub || streamSource === 'proxy') ? proxyStreamUrl : directCdnUrl;

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Fetch metadata: Cyberfile, Gofile, Filester, Bunkr, or Pixeldrain
  useEffect(() => {
    let isMounted = true;

    if (isCyberfile) {
      setIsExtracting(true);
      extractCyberfileUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);
          setExtractedStreamUrls({
            direct: meta.directStreamUrl,
            proxy: meta.streamProxyUrl,
            poster: meta.thumbnailUrl,
            downloadUrl: meta.downloadUrl,
          });

          if (meta.title && (!initialTitle || initialTitle.includes('CyberFile') || initialTitle.includes('Gofile') || initialTitle.includes('Filester') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Bunkr'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('CyberFile extraction error:', err);
          setIsExtracting(false);
        });
    } else if (isGofile) {
      setIsExtracting(true);
      extractGofileUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);

          if (meta.files && meta.files.length > 0) {
            setAvailableFiles(meta.files);
            const defaultFile = meta.file4K || meta.fileHD || meta.files[0];
            setSelectedFileId(defaultFile.id);
            setExtractedStreamUrls({
              direct: defaultFile.directStreamUrl,
              proxy: defaultFile.streamProxyUrl,
              poster: defaultFile.thumbnailUrl || meta.thumbnailUrl,
              downloadUrl: defaultFile.downloadUrl,
            });
          } else {
            setExtractedStreamUrls({
              direct: meta.directStreamUrl,
              proxy: meta.streamProxyUrl,
              poster: meta.thumbnailUrl,
              downloadUrl: meta.downloadUrl,
            });
          }

          if (meta.title && (!initialTitle || initialTitle.includes('Gofile') || initialTitle.includes('Filester') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Bunkr'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('Gofile extraction error:', err);
          setIsExtracting(false);
        });
    } else if (isFilester) {
      setIsExtracting(true);
      extractFilesterUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);
          setExtractedStreamUrls({
            direct: meta.directStreamUrl,
            proxy: meta.streamProxyUrl,
            poster: meta.thumbnailUrl,
            downloadUrl: meta.downloadUrl,
          });

          if (meta.title && (!initialTitle || initialTitle.includes('Filester') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Bunkr'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('Filester extraction error:', err);
          setIsExtracting(false);
        });
    } else if (isFileditch) {
      setIsExtracting(true);
      extractFileditchUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);
          setExtractedStreamUrls({
            direct: meta.directStreamUrl,
            proxy: meta.streamProxyUrl,
            poster: meta.thumbnailUrl,
            downloadUrl: meta.downloadUrl,
          });

          if (!meta.isDirectWorker && meta.requiresCapture) {
            setShowSnifferInput(true);
          }

          if (meta.title && (!initialTitle || initialTitle.includes('FileDitch') || initialTitle.includes('Bunkr') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Filester') || initialTitle.includes('CyberFile') || initialTitle.includes('Gofile'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('FileDitch extraction error:', err);
          setIsExtracting(false);
          setShowSnifferInput(true);
        });
    } else if (isEporner) {
      setIsExtracting(true);
      extractEpornerUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);

          if (meta.files && meta.files.length > 0) {
            const highQualityOnly = meta.files.filter((f: any) => f.quality === '2160p' || f.quality === '1080p' || f.id === '2160p' || f.id === '1080p');
            const finalFiles = highQualityOnly.length > 0 ? highQualityOnly : meta.files;
            setAvailableFiles(finalFiles as any);
            
            // Pick quality based on button clicked (initialQuality) or hints in url
            let targetFile = null;
            if (initialQuality) {
              targetFile = finalFiles.find((f: any) => f.quality === initialQuality || f.id === initialQuality);
            }
            if (!targetFile) {
              const urlLower = url.toLowerCase();
              if (urlLower.includes('2160') || urlLower.includes('4k')) {
                targetFile = meta.file4K || finalFiles.find((f: any) => f.quality === '2160p');
              } else if (urlLower.includes('1080') || urlLower.includes('fhd') || urlLower.includes('hd')) {
                targetFile = meta.file1080 || finalFiles.find((f: any) => f.quality === '1080p');
              }
            }
            
            const defaultFile = targetFile || meta.file1080 || meta.file4K || finalFiles[0];
            setSelectedFileId(defaultFile.id);
            setExtractedStreamUrls({
              direct: defaultFile.directStreamUrl,
              proxy: defaultFile.streamProxyUrl,
              poster: defaultFile.thumbnailUrl || meta.thumbnailUrl,
              downloadUrl: defaultFile.downloadUrl,
            });
          } else {
            setExtractedStreamUrls({
              direct: meta.directStreamUrl,
              proxy: meta.streamProxyUrl,
              poster: meta.thumbnailUrl,
              downloadUrl: meta.downloadUrl,
            });
          }

          if (meta.title && (!initialTitle || initialTitle.includes('Eporner') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Bunkr') || initialTitle.includes('Filester') || initialTitle.includes('CyberFile') || initialTitle.includes('Gofile') || initialTitle.includes('FileDitch'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('Eporner extraction error:', err);
          setIsExtracting(false);
          addNotification('Could not extract video data from Eporner', 'error');
        });
    } else if (isHanimestream) {
      setIsExtracting(true);
      extractHanimestreamUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);

          if (meta.qualities && meta.qualities.length > 0) {
            const filteredQualities = meta.qualities.filter((q: any) => q.id !== '720p' && q.quality !== '720p' && !q.name?.includes('720'));
            const mappedFiles: any[] = filteredQualities.map((q: any) => {
              let cleanLabel = q.label;
              if (q.id === '2160p' || q.quality === '2160p') cleanLabel = '2160p';
              else if (q.id === '1080p' || q.quality === '1080p') cleanLabel = '1080p';
              else if (q.id === '1080p48' || q.id === '1080i' || q.quality === '1080p48') cleanLabel = '1080p48';
              else if (q.id === '2160p48' || q.id === '2160i') cleanLabel = '2160p48';

              return {
                id: q.id,
                name: cleanLabel,
                label: cleanLabel,
                quality: q.quality,
                size: q.size || 0,
                mimeType: q.mimeType,
                directStreamUrl: q.directStreamUrl,
                downloadUrl: q.downloadUrl,
                streamProxyUrl: q.proxyStreamUrl,
                mode: q.mode,
              };
            });
            setAvailableFiles(mappedFiles);

            // Default to requested quality or 1080p (best/optimal) or 2160p
            let defaultFile = null;
            if (initialQuality && initialQuality !== '720p') {
              defaultFile = mappedFiles.find(f => f.quality === initialQuality || f.id === initialQuality);
            }
            if (!defaultFile) {
              defaultFile = mappedFiles.find(f => f.id === '1080p') || mappedFiles.find(f => f.id === '2160p') || mappedFiles[0];
            }

            setSelectedFileId(defaultFile.id);
            setExtractedStreamUrls({
              direct: defaultFile.directStreamUrl,
              proxy: defaultFile.streamProxyUrl,
              poster: meta.poster,
              downloadUrl: defaultFile.downloadUrl,
            });
          } else {
            setExtractedStreamUrls({
              direct: meta.directStreamUrl,
              proxy: meta.streamProxyUrl,
              poster: meta.poster,
              downloadUrl: meta.downloadUrl,
            });
          }

          if (meta.subtitles && meta.subtitles.length > 0) {
            setExtractedSubtitles(meta.subtitles);
            const defaultSub = meta.subtitles.find(s => s.default) || meta.subtitles[0];
            if (defaultSub) {
              setActiveSubtitleSrc(defaultSub.src);
              activeSubtitleSrcRef.current = defaultSub.src;
            }
          }

          if (meta.title && (!initialTitle || initialTitle.includes('Video') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Hanimestream'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('Hanimestream extraction error:', err);
          setIsExtracting(false);
          addNotification('Could not extract video from Hanimestream', 'error');
        });
    } else if (isBunkr) {
      setIsExtracting(true);
      extractBunkrUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          setIsExtracting(false);
          setExtractedStreamUrls({
            direct: meta.directStreamUrl,
            proxy: meta.streamProxyUrl,
            poster: meta.thumbnailUrl,
            downloadUrl: meta.directStreamUrl,
          });

          if (meta.title && (!initialTitle || initialTitle.includes('Bunkr') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Filester'))) {
            setVideoTitle(meta.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = meta.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('Bunkr extraction error:', err);
          setIsExtracting(false);
        });
    } else if (isPornhub) {
      setIsExtracting(true);
      pornhubResolver.resolve(url)
        .then((media) => {
          if (!isMounted) return;
          setIsExtracting(false);

          if (media.streams && media.streams.length > 0) {
            const mappedFiles = media.streams.map((s) => ({
              id: s.id,
              name: s.label,
              label: s.label,
              quality: s.quality || '1080p',
              size: s.size || 0,
              mimeType: s.mimeType || 'video/mp4',
              directStreamUrl: s.directUrl || s.url,
              downloadUrl: s.downloadUrl || s.url,
              streamProxyUrl: s.streamProxyUrl || s.url,
              width: s.width,
              height: s.height,
              bitrate: s.bitrate,
            }));
            setAvailableFiles(mappedFiles as any);
            availableFilesRef.current = mappedFiles as any;

            let targetFile = null;
            if (initialQuality) {
              targetFile = mappedFiles.find((f: any) => f.quality === initialQuality || f.id === initialQuality || f.id.includes(initialQuality));
            }
            if (!targetFile && media.defaultStream) {
              targetFile = mappedFiles.find((f: any) => f.id === media.defaultStream?.id);
            }
            if (!targetFile) {
              targetFile = mappedFiles.find((f: any) => f.quality === '1080p' || f.id.includes('1080')) ||
                           mappedFiles.find((f: any) => f.quality === '720p' || f.id.includes('720')) ||
                           mappedFiles[0];
            }
            const defaultFile = targetFile || mappedFiles[0];
            setSelectedFileId(defaultFile.id);
            setExtractedStreamUrls({
              direct: defaultFile.directStreamUrl,
              proxy: defaultFile.streamProxyUrl,
              poster: media.thumbnailUrl,
              downloadUrl: defaultFile.downloadUrl,
            });
          }

          if (media.title && (!initialTitle || initialTitle.includes('Pornhub') || initialTitle.includes('Video') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Eporner'))) {
            setVideoTitle(media.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = media.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('[Pornhub] extraction error in GoPlayer:', err);
          setIsExtracting(false);
        });
    } else if (isXhamster) {
      setIsExtracting(true);
      xhamsterResolver.resolve(url)
        .then((media) => {
          if (!isMounted) return;
          setIsExtracting(false);

          if (media.streams && media.streams.length > 0) {
            const mappedFiles = media.streams.map((s) => {
              const simpleLabel = (s.quality === '2160p' || s.height === 2160 || s.id?.includes('2160'))
                ? '2160p'
                : (s.quality === '1080p' || s.height === 1080 || s.id?.includes('1080'))
                ? '1080p'
                : (s.label || s.quality);

              return {
                id: s.id,
                name: simpleLabel,
                label: simpleLabel,
                quality: simpleLabel,
                size: s.size || 0,
                mimeType: s.mimeType || 'application/x-mpegURL',
                directStreamUrl: s.directUrl || s.url,
                downloadUrl: s.downloadUrl || s.url,
                streamProxyUrl: s.streamProxyUrl || s.url,
                width: s.width,
                height: s.height,
                bitrate: s.bitrate,
              };
            });
            setAvailableFiles(mappedFiles as any);
            availableFilesRef.current = mappedFiles as any;

            let targetFile = null;
            if (initialQuality) {
              targetFile = mappedFiles.find((f: any) => f.quality === initialQuality || f.id === initialQuality || f.id.includes(initialQuality));
            }
            if (!targetFile && media.defaultStream) {
              targetFile = mappedFiles.find((f: any) => f.id === media.defaultStream?.id);
            }
            if (!targetFile) {
              targetFile = mappedFiles.find((f: any) => f.quality === '1080p' || f.id.includes('1080')) ||
                           mappedFiles.find((f: any) => f.quality === '2160p' || f.id.includes('2160')) ||
                           mappedFiles[0];
            }
            const defaultFile = targetFile || mappedFiles[0];
            setSelectedFileId(defaultFile.id);
            setExtractedStreamUrls({
              direct: defaultFile.directStreamUrl,
              proxy: defaultFile.streamProxyUrl,
              poster: media.thumbnailUrl,
              downloadUrl: defaultFile.downloadUrl,
            });
          }

          if (media.title && (!initialTitle || initialTitle.includes('xHamster') || initialTitle.includes('Pornhub') || initialTitle.includes('Video') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Eporner'))) {
            setVideoTitle(media.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = media.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('[xHamster] extraction error in GoPlayer:', err);
          setIsExtracting(false);
        });
    } else if (isPorntrex) {
      setIsExtracting(true);
      porntrexResolver.resolve(url)
        .then((media) => {
          if (!isMounted) return;
          setIsExtracting(false);

          if (media.streams && media.streams.length > 0) {
            const mappedFiles = media.streams.map((s) => ({
              id: s.id,
              name: s.label,
              label: s.label,
              quality: s.quality || '1080p',
              size: s.size || 0,
              mimeType: s.mimeType || 'video/mp4',
              directStreamUrl: s.directUrl || s.url,
              downloadUrl: s.downloadUrl || s.url,
              streamProxyUrl: s.streamProxyUrl || s.url,
              width: s.width,
              height: s.height,
              bitrate: s.bitrate,
            }));
            setAvailableFiles(mappedFiles as any);
            availableFilesRef.current = mappedFiles as any;

            let targetFile = null;
            if (initialQuality) {
              targetFile = mappedFiles.find((f: any) => f.quality === initialQuality || f.id === initialQuality || f.id.includes(initialQuality));
            }
            if (!targetFile && media.defaultStream) {
              targetFile = mappedFiles.find((f: any) => f.id === media.defaultStream?.id);
            }
            if (!targetFile) {
              targetFile = mappedFiles.find((f: any) => f.quality === '1080p' || f.id.includes('1080')) ||
                           mappedFiles.find((f: any) => f.quality === '2160p' || f.id.includes('2160')) ||
                           mappedFiles.find((f: any) => f.quality === '720p' || f.id.includes('720')) ||
                           mappedFiles[0];
            }
            const defaultFile = targetFile || mappedFiles[0];
            setSelectedFileId(defaultFile.id);
            setExtractedStreamUrls({
              direct: defaultFile.directStreamUrl,
              proxy: defaultFile.streamProxyUrl,
              poster: media.thumbnailUrl,
              downloadUrl: defaultFile.downloadUrl,
            });
          }

          if (media.title && (!initialTitle || initialTitle.includes('Porntrex') || initialTitle.includes('xHamster') || initialTitle.includes('Pornhub') || initialTitle.includes('Video') || initialTitle.includes('Pixeldrain') || initialTitle.includes('Eporner'))) {
            setVideoTitle(media.title);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = media.title;
            }
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error('[Porntrex] extraction error in GoPlayer:', err);
          setIsExtracting(false);
        });
    } else {
      extractPixeldrainUrl(url)
        .then((meta) => {
          if (!isMounted) return;
          if (meta.title && (!initialTitle || initialTitle === 'Pixeldrain Video')) {
            const cleanTitle = meta.title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ');
            setVideoTitle(cleanTitle);
            if (playerRef.current) {
              // @ts-ignore
              playerRef.current.title = cleanTitle;
            }
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [url, initialTitle, isBunkr, isFilester, isGofile, isCyberfile, isFileditch, isEporner, isHanimestream, isPornhub, isXhamster, isPorntrex]);

  // Auto-search subtitles from Subtitlecat if video is JAV (e.g. SNOS-396)
  useEffect(() => {
    const candidateString = `${initialTitle || ''} ${videoTitle || ''} ${url || ''}`;
    const code = extractJavCode(candidateString);
    if (!code) return;

    let isMounted = true;
    fetch(`/api/jav-subtitles/search?code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => {
        if (!isMounted || !data.success || !data.subtitles || data.subtitles.length === 0) return;

        const javSubs: HanimestreamSubtitle[] = data.subtitles.map((sub: any) => ({
          label: sub.language,
          kind: 'captions',
          srclang: sub.srclang,
          src: sub.url,
          default: sub.isDefault,
        }));

        setExtractedSubtitles(prev => {
          const nonJav = prev.filter(p => !p.src.includes('/api/jav-subtitles/'));
          return [...nonJav, ...javSubs];
        });

        const englishSub = javSubs.find(s => s.srclang === 'en' || s.default);
        if (englishSub && playerRef.current) {
          const art = playerRef.current as any;
          art.notice.show = `💬 Subtitles found: ${code} (English)`;
        }
      })
      .catch(err => {
        console.warn('[JAV Subtitles] Search error:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [url, initialTitle, videoTitle]);

  // Auto-Bridge state for FileDitch
  const [isBridgeRunning, setIsBridgeRunning] = useState(false);

  // Auto-detect clipboard & Auto-Bridge Listener for FileDitch
  useEffect(() => {
    if (!showSnifferInput || !isFileditch) return;

    let pollTimer: any = null;
    let bridgeChannel: BroadcastChannel | null = null;

    // Core function to test and capture a candidate string
    const processPotentialCandidate = (rawText: string): boolean => {
      if (!rawText || typeof rawText !== 'string') return false;
      const clean = rawText.trim();
      if (!clean || clean === lastProcessedTextRef.current) return false;

      // Extract worker url
      const extracted = extractFileditchWorkerUrlFromText(clean);
      if (!extracted) return false;

      // 1. Verify if this worker URL matches THIS specific video file
      const matchesTarget = doesWorkerUrlMatchTarget(extracted, url);

      // 2. Or if user clicked "Go to Copy" (isBridgeRunning is true)
      // and copied something new that differs from the baseline clipboard
      const isFreshCopyAfterBridge = isBridgeRunning && clean !== baselineClipboardRef.current;

      if (matchesTarget || isFreshCopyAfterBridge) {
        lastProcessedTextRef.current = extracted;
        setIsBridgeRunning(false);
        handleSnifferCapture(extracted);
        return true;
      }
      return false;
    };

    // 1. Try reading clipboard safely
    const checkClipboard = async (): Promise<boolean> => {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text && (text.includes('workers.dev') || text.includes('cloudflareditch') || text.includes('exp=') || text.includes('sig='))) {
            return processPotentialCandidate(text);
          }
        }
      } catch (e) {}
      return false;
    };

    // 2. Check clipboard & server cache whenever user refocuses the app or page becomes visible
    const handleFocusOrVisible = async () => {
      const captured = await checkClipboard();
      if (captured) return;

      // Only query server cache if bridge is actively running for this file
      if (isBridgeRunning) {
        try {
          const res = await fetch('/api/fileditch/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const meta = await res.json();
          if (meta && meta.success && meta.isDirectWorker && meta.directStreamUrl) {
            setStreamSource('direct');
            setExtractedStreamUrls({
              direct: meta.directStreamUrl,
              proxy: meta.streamProxyUrl || getFileditchStreamProxyUrl(meta.directStreamUrl),
              poster: meta.thumbnailUrl,
              downloadUrl: meta.downloadUrl || meta.directStreamUrl,
            });
            if (meta.title) setVideoTitle(meta.title);
            setShowSnifferInput(false);
            setIsExtracting(false);
            setIsBridgeRunning(false);
            addNotification('⚡ Video playback started!', 'success');
          }
        } catch (e) {}
      }
    };

    // 3. Global paste listener: user pastes anywhere on the screen
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.getData('text');
      if (pasted) {
        processPotentialCandidate(pasted);
      }
    };

    // 4. BroadcastChannel listener between tabs/windows
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bridgeChannel = new BroadcastChannel('fileditch_bridge_channel');
        bridgeChannel.onmessage = (e) => {
          if (e.data?.workerUrl || e.data?.url) {
            processPotentialCandidate(e.data.workerUrl || e.data.url);
          }
        };
      }
    } catch (err) {}

    // 5. Cross-window postMessage listener
    const handlePostMessage = (e: MessageEvent) => {
      try {
        const data = e.data;
        if (data && typeof data === 'object' && (data.type === 'FILEDITCH_LINK_RESOLVED' || data.type === 'FILEDITCH_WORKER_LINK')) {
          const workerUrl = data.workerUrl || data.url;
          if (workerUrl) {
            processPotentialCandidate(workerUrl);
          }
        }
      } catch (err) {}
    };

    // 6. Cross-tab localStorage listener
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'fileditch_captured_worker_url' && e.newValue) {
        processPotentialCandidate(e.newValue);
      }
    };

    // Only perform checkClipboard on mount if it matches this target
    checkClipboard();

    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);
    window.addEventListener('paste', handleGlobalPaste);
    window.addEventListener('message', handlePostMessage);
    window.addEventListener('storage', handleStorageChange);

    // Active polling interval: ONLY while isBridgeRunning is true (user went to copy link)
    if (isBridgeRunning) {
      pollTimer = setInterval(handleFocusOrVisible, 1200);
    }

    return () => {
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      window.removeEventListener('paste', handleGlobalPaste);
      window.removeEventListener('message', handlePostMessage);
      window.removeEventListener('storage', handleStorageChange);
      if (pollTimer) clearInterval(pollTimer);
      if (bridgeChannel) {
        bridgeChannel.close();
      }
    };
  }, [showSnifferInput, isFileditch, isBridgeRunning, url]);

  const handleGoToCopy = async () => {
    // Check if user ALREADY has a worker URL specifically for THIS file in their clipboard
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        const clean = text ? text.trim() : '';
        const extracted = extractFileditchWorkerUrlFromText(clean);
        // ONLY capture if it specifically matches THIS video!
        if (extracted && doesWorkerUrlMatchTarget(extracted, url)) {
          lastProcessedTextRef.current = extracted;
          handleSnifferCapture(extracted);
          return;
        }
        // Save current clipboard as baseline so we can detect when a fresh link is copied
        baselineClipboardRef.current = clean;
      }
    } catch (e) {
      baselineClipboardRef.current = '';
    }

    setIsBridgeRunning(true);
    addNotification('Click download on the page to copy link, then return here to play automatically!', 'info');
    
    // Open target page in a separate popup / tab
    const bridgeWindow = window.open(url, '_blank');
    if (bridgeWindow) {
      bridgeWindow.focus();
    }
  };

  const handleOpenExternal = () => {
    try {
      const intentUrl = isHanimestream
        ? getHanimestreamIntentUrl(direct1DMUrl, videoTitle)
        : isPorntrex
        ? getPorntrexIntentUrl(direct1DMUrl)
        : isXhamster
        ? getXhamsterIntentUrl(direct1DMUrl)
        : isPornhub
        ? getPornhubIntentUrl(direct1DMUrl)
        : isEporner
        ? getEpornerIntentUrl(direct1DMUrl)
        : isFileditch
        ? getFileditchIntentUrl(direct1DMUrl)
        : isGofile
        ? getGofileIntentUrl(direct1DMUrl)
        : isCyberfile
          ? getCyberfileIntentUrl(direct1DMUrl)
          : isFilester
            ? getFilesterIntentUrl(direct1DMUrl)
            : isBunkr
              ? getBunkrIntentUrl(direct1DMUrl)
              : getPixeldrainIntentUrl(url);
      window.location.href = intentUrl;
    } catch (e) {
      window.open(direct1DMUrl, '_blank');
    }
  };

  const handleSnifferCapture = (capturedText: string) => {
    const workerUrl = extractFileditchWorkerUrlFromText(capturedText);
    if (!workerUrl) {
      addNotification('Input does not contain a valid Cloudflare Workers direct link for FileDitch', 'error');
      return;
    }

    // 1. Instant Optimistic Playback (0ms Delay - starts playback immediately)
    const cleanTitle = extractFileditchFilename(workerUrl);
    setVideoTitle(cleanTitle);
    setStreamSource('direct');
    setExtractedStreamUrls({
      direct: workerUrl,
      proxy: getFileditchStreamProxyUrl(workerUrl),
      downloadUrl: workerUrl,
    });
    setShowSnifferInput(false);
    setIsExtracting(false);
    setIsBridgeRunning(false);
    addNotification('⚡ Video playback started!', 'success');

    if (playerRef.current) {
      try {
        // @ts-ignore
        playerRef.current.title = cleanTitle;
        playerRef.current.switchUrl(workerUrl).then(() => {
          playerRef.current?.play()?.catch?.(() => {});
        }).catch(() => {});
      } catch (err) {}
    }

    // 2. Non-blocking asynchronous sync with server
    fetch('/api/fileditch/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: workerUrl }),
    })
      .then((r) => r.json())
      .then((meta) => {
        if (meta && meta.title && meta.title !== 'FileDitch Video') {
          setVideoTitle(meta.title);
          if (playerRef.current) {
            // @ts-ignore
            playerRef.current.title = meta.title;
          }
        }
      })
      .catch(() => {});
  };

  const handleCopy1DMLink = async (customUrl?: string) => {
    const target = customUrl || direct1DMUrl;
    const success = await copyTextToClipboard(target);
    if (success) {
      setCopied(true);
      if (playerRef.current) {
        playerRef.current.notice.show = 'Link copied successfully!';
      }
      addNotification('Direct 1DM stream link copied successfully', 'success');
      setTimeout(() => setCopied(false), 3000);
    } else {
      addNotification('Failed to copy link to clipboard', 'error');
    }
  };

  // Terminate all audio, video, DASH, and HLS playback engines and clear DOM media elements
  const terminateAllOverlayPlayback = () => {
    if (playerRef.current) {
      try {
        const p = playerRef.current as any;
        if (p.dash) {
          try {
            p.dash.pause();
            p.dash.reset();
            p.dash.destroy();
          } catch (e) {}
          p.dash = null;
        }
        if (p.hls) {
          try {
            p.hls.stopLoad();
            p.hls.detachMedia();
            p.hls.destroy();
          } catch (e) {}
          p.hls = null;
        }
        if (p.video) {
          try {
            p.video.pause();
            p.video.removeAttribute('src');
            p.video.load();
          } catch (e) {}
        }
        playerRef.current.destroy(true);
      } catch (e) {
        console.warn('Error destroying Artplayer:', e);
      }
      playerRef.current = null;
    }

    if (containerRef.current) {
      try {
        const mediaElements = containerRef.current.querySelectorAll('video, audio');
        mediaElements.forEach((el) => {
          if (el instanceof HTMLMediaElement) {
            try {
              el.pause();
              el.removeAttribute('src');
              el.load();
            } catch (e) {}
          }
        });
        containerRef.current.innerHTML = '';
      } catch (e) {}
    }

    try {
      document.querySelectorAll('video, audio').forEach((el) => {
        if (el instanceof HTMLMediaElement) {
          try {
            el.pause();
          } catch (e) {}
        }
      });
    } catch (e) {}
  };

  // Switch stream cleanly on existing Artplayer instance without tearing down or rebuilding DOM
  const handleSwitchStream = (targetUrl: string, explicitTime?: number) => {
    const art = playerRef.current as any;
    if (!art) return;

    activeLoadedUrlRef.current = targetUrl;
    const curTime = explicitTime !== undefined
      ? explicitTime
      : (art.currentTime || (art.video ? art.video.currentTime : 0) || lastPlaybackTimeRef.current || 0);
    lastPlaybackTimeRef.current = curTime;
    const wasPlaying = art.video ? (!art.video.paused && !art.video.ended) : true;

    // 1. Halt and flush previous DASH / HLS engine to prevent dual-playback or ghost audio
    if (art.dash) {
      try {
        art.dash.pause();
        art.dash.reset();
        art.dash.destroy();
      } catch (e) {}
      art.dash = null;
    }
    if (art.hls) {
      try {
        art.hls.stopLoad();
        art.hls.detachMedia();
        art.hls.destroy();
      } catch (e) {}
      art.hls = null;
    }

    // 2. Set stream type
    const isMpd = targetUrl.includes('.mpd') || targetUrl.includes('manifest.mpd');
    const isHls = targetUrl.includes('.m3u8') || targetUrl.includes('m3u8');
    art.type = isMpd ? 'mpd' : isHls ? 'm3u8' : '';

    // 3. Switch URL on existing instance with seamless timestamp preservation
    const switchPromise = (curTime > 0 && typeof art.switchQuality === 'function')
      ? art.switchQuality(targetUrl)
      : art.switchUrl(targetUrl);

    switchPromise.then(() => {
      if (curTime > 0 && art) {
        try {
          art.currentTime = curTime;
          if (art.video) art.video.currentTime = curTime;
        } catch (e) {}
      }
      if (wasPlaying && art) {
        art.play().catch(() => {});
      }
    }).catch((err: any) => {
      console.warn('switchUrl fallback: updating video element directly', err);
      if (art && art.video) {
        art.video.src = targetUrl;
        if (curTime > 0) {
          try { art.video.currentTime = curTime; } catch (e) {}
        }
        if (wasPlaying) {
          art.video.play().catch(() => {});
        }
      }
    });
  };

  // AI-powered Arabic subtitle translator handler
  const handleSelectArabicSubtitle = async (overrideApiKey?: string) => {
    const art = playerRef.current as any;
    if (!art) return;

    // 1. Immediately pause video per user requirement
    try {
      art.pause();
      if (art.video) art.video.pause();
    } catch (e) {}

    // 2. Check if already translated in memory
    if (arabicSubBlobUrl) {
      activeSubtitleSrcRef.current = arabicSubBlobUrl;
      setActiveSubtitleSrc(arabicSubBlobUrl);
      art.subtitle.show = true;
      if (art.template?.$subtitle) art.template.$subtitle.style.display = 'flex';
      await art.subtitle.switch(arabicSubBlobUrl, { name: 'Arabic' }).catch(() => {});
      art.notice.show = 'Caption: Arabic';
      return;
    }

    // Check localStorage cache
    const cacheKey = 'gemini_arabic_vtt_' + encodeURIComponent(url.slice(0, 100));
    try {
      const cachedVtt = localStorage.getItem(cacheKey);
      if (cachedVtt) {
        const blob = new Blob([cachedVtt], { type: 'text/vtt;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        setArabicSubBlobUrl(blobUrl);
        setExtractedSubtitles(prev => {
          const filtered = prev.filter(s => s.srclang !== 'ar' && s.label !== 'Arabic');
          return [{ label: 'Arabic', kind: 'subtitles', srclang: 'ar', src: blobUrl, default: true }, ...filtered];
        });
        activeSubtitleSrcRef.current = blobUrl;
        setActiveSubtitleSrc(blobUrl);
        art.subtitle.show = true;
        if (art.template?.$subtitle) art.template.$subtitle.style.display = 'flex';
        await art.subtitle.switch(blobUrl, { name: 'Arabic' }).catch(() => {});
        art.notice.show = 'Caption: Arabic';
        return;
      }
    } catch (e) {}

    // 3. Find source English or Japanese subtitle
    let sourceSub = extractedSubtitles.find(s => (s.srclang === 'en' || s.label?.toLowerCase().includes('en') || s.default) && s.src !== 'off') ||
                    extractedSubtitles.find(s => (s.srclang === 'ja' || s.label?.toLowerCase().includes('ja') || s.label?.toLowerCase().includes('japanese')) && s.src !== 'off') ||
                    extractedSubtitles.find(s => s.src && s.src !== 'off');
    let sourceSubUrl = sourceSub ? sourceSub.src : '';
    if ((!sourceSubUrl || sourceSubUrl === 'off' || sourceSubUrl === 'en_default') && isHanimestream) {
      if (activeSubtitleSrcRef.current && activeSubtitleSrcRef.current !== 'off' && activeSubtitleSrcRef.current !== 'en_default') {
        sourceSubUrl = activeSubtitleSrcRef.current;
      } else {
        const streamDirect = (extractedStreamUrls && extractedStreamUrls.direct) || (availableFiles.length > 0 && availableFiles[0].directStreamUrl) || '';
        const match = streamDirect.match(/^(https?:\/\/[^\/]+)\/(.+?)\/(?:2160|1080|720)/);
        if (match) {
          sourceSubUrl = `${match[1]}/${match[2]}/eng.vtt`;
        }
      }
    }

    if (!sourceSubUrl || sourceSubUrl === 'off' || sourceSubUrl === 'en_default') {
      art.notice.show = '⚠️ No source English or Japanese subtitle found to translate from';
      return;
    }

    // 4. Begin translation
    setIsTranslatingSubtitles(true);
    setTranslationPercent(5);
    setTranslationProgressText('Connecting to Gemini AI...');
    art.notice.show = '🤖 Translating subtitles (IA Arabic) with Gemini AI...';

    try {
      const effectiveApiKey = (typeof overrideApiKey === 'string' && overrideApiKey.trim()) || settings?.geminiApiKey?.trim() || undefined;

      let translatedVtt = '';
      let isCompleted = false;

      // 1. Try real-time streaming SSE endpoint for parallel chunking & live progress updates
      const streamRes = await fetch('/api/gemini/translate-subtitles-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vttUrl: sourceSubUrl,
          apiKey: effectiveApiKey,
        }),
      });

      if (streamRes.ok && streamRes.body) {
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const event = JSON.parse(trimmed.slice(6));
                if (event.type === 'progress') {
                  setTranslationPercent(event.progress);
                  if (event.message) setTranslationProgressText(event.message);
                } else if (event.type === 'complete') {
                  translatedVtt = event.vttText;
                  setTranslationPercent(100);
                  isCompleted = true;
                } else if (event.type === 'error') {
                  if (event.error === 'MISSING_API_KEY') {
                    setShowApiKeyModal(true);
                    setIsTranslatingSubtitles(false);
                    art.notice.show = '⚠️ Gemini API key required';
                    return;
                  }
                  throw new Error(event.message || 'Failed to translate subtitles');
                }
              } catch (e: any) {
                if (e.message && e.message !== 'Unexpected end of JSON input') {
                  throw e;
                }
              }
            }
          }
        }
      }

      // 2. Fallback to standard endpoint if streaming didn't complete
      if (!isCompleted || !translatedVtt) {
        setTranslationPercent(50);
        setTranslationProgressText('Finalizing translation...');
        const res = await fetch('/api/gemini/translate-subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vttUrl: sourceSubUrl,
            apiKey: effectiveApiKey,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success || !data.vttText) {
          if (data?.error === 'MISSING_API_KEY') {
            setShowApiKeyModal(true);
            setIsTranslatingSubtitles(false);
            art.notice.show = '⚠️ Gemini API key required';
            return;
          }
          throw new Error(data?.message || 'Failed to translate subtitles');
        }
        translatedVtt = data.vttText;
        setTranslationPercent(100);
      }

      // Save to localStorage cache
      try {
        localStorage.setItem(cacheKey, translatedVtt);
      } catch (e) {}

      const blob = new Blob([translatedVtt], { type: 'text/vtt;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      setArabicSubBlobUrl(blobUrl);

      // Add to extractedSubtitles list
      setExtractedSubtitles(prev => {
        const filtered = prev.filter(s => s.srclang !== 'ar' && s.label !== 'Arabic');
        return [{ label: 'Arabic', kind: 'subtitles', srclang: 'ar', src: blobUrl, default: true }, ...filtered];
      });

      activeSubtitleSrcRef.current = blobUrl;
      setActiveSubtitleSrc(blobUrl);
      art.subtitle.show = true;
      if (art.template?.$subtitle) art.template.$subtitle.style.display = 'flex';
      await art.subtitle.switch(blobUrl, { name: 'Arabic' }).catch(() => {});
      art.notice.show = '✨ Subtitles translated and applied!';
      addNotification('Subtitles translated and applied successfully!', 'success');
    } catch (err: any) {
      console.error('Translation error:', err);
      art.notice.show = `❌ Translation failed: ${err.message || 'Error'}`;
      addNotification(err.message || 'Subtitle translation failed', 'error');
    } finally {
      setIsTranslatingSubtitles(false);
    }
  };

  handleSelectArabicSubtitleRef.current = handleSelectArabicSubtitle;

  // Mount real Artplayer instance once when ready
  useEffect(() => {
    let player: Artplayer | null = null;
    let wrapperDiv: HTMLDivElement | null = null;
    let updateLayoutAndOrientation: (() => void) | null = null;

    if (isExtracting || hasCodecError || playerRef.current) {
      return;
    }

    if (containerRef.current && !hasCodecError) {
      containerRef.current.innerHTML = '';
      wrapperDiv = document.createElement('div');
      wrapperDiv.style.width = '100%';
      wrapperDiv.style.height = '100%';
      wrapperDiv.style.backgroundColor = 'transparent';
      wrapperDiv.style.overflow = 'hidden';
      containerRef.current.appendChild(wrapperDiv);

      try {
        const qualityList = availableFiles.length > 0
          ? availableFiles
          : [{ id: '1080p', name: '1080p', quality: '1080p' as const, size: 0, mimeType: 'video/mp4', directStreamUrl: activeVideoSrc, downloadUrl: activeVideoSrc, streamProxyUrl: activeVideoSrc }];

        const isHlsStream = activeVideoSrc.includes('.m3u8') || activeVideoSrc.includes('m3u8');
        const isMpdStream = activeVideoSrc.includes('.mpd') || activeVideoSrc.includes('manifest.mpd');

        const artOptions: any = {
          container: wrapperDiv,
          url: activeVideoSrc,
          poster: poster || '',
          type: isHlsStream ? 'm3u8' : isMpdStream ? 'mpd' : '',
          title: videoTitle || 'Video Player',
          theme: accentColor || '#3b82f6',
          volume: 1,
          autoplay: true,
          autoSize: false,
          autoMini: false,
          loop: false,
          flip: false,
          playbackRate: false,
          aspectRatio: false,
          subtitleOffset: false,
          screenshot: true,
          setting: true,
          hotkey: true,
          pip: false,
          mutex: true,
          backdrop: true,
          playsInline: true,
          autoPlayback: true,
          airplay: true,
          fullscreen: true,
          fullscreenWeb: false,
          miniProgressBar: true,
          autoOrientation: !isCoverEmbed,
          fastForward: true,
          moreVideoAttr: {
            // @ts-ignore
            controlsList: 'nodownload',
            playsInline: true,
            'webkit-playsinline': 'true',
            'x5-video-player-type': 'h5',
            'x5-video-player-fullscreen': 'true',
            preload: 'auto',
          },
          customType: {
            mpd: function (video: HTMLVideoElement, url: string, art: any) {
              // Complete teardown of any previous Dash engine to prevent dual-playback / ghost audio
              if (art.dash) {
                try {
                  art.dash.pause();
                  art.dash.reset();
                  art.dash.destroy();
                } catch (e) {}
                art.dash = null;
              }
              if (art.hls) {
                try {
                  art.hls.stopLoad();
                  art.hls.detachMedia();
                  art.hls.destroy();
                } catch (e) {}
                art.hls = null;
              }
              // Fully reset video element and flush all previous audio/video buffers
              try {
                video.pause();
                video.removeAttribute('src');
                video.load();
              } catch (e) {}

              try {
                const dashPlayer = dashjs.MediaPlayer().create();
                dashPlayer.initialize(video, url, true);
                art.dash = dashPlayer;

                dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
                  const targetTime = lastPlaybackTimeRef.current;
                  if (targetTime && targetTime > 0) {
                    try {
                      video.currentTime = targetTime;
                      if (art) {
                        art.currentTime = targetTime;
                      }
                    } catch (e) {}
                  }
                });

                dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e: any) => {
                  console.warn('DASH playback error:', e);
                  if (streamSource === 'direct') {
                    setStreamSource('proxy');
                    if (art && art.notice) {
                      art.notice.show = 'Switching to Proxy DASH manifest...';
                    }
                  }
                });

                art.on('destroy', () => {
                  try {
                    dashPlayer.pause();
                    dashPlayer.reset();
                    dashPlayer.destroy();
                  } catch (e) {}
                });
              } catch (err) {
                console.error('Failed to initialize dashjs:', err);
                if (art && art.notice) {
                  art.notice.show = 'DASH initialization error';
                }
              }
            },
            m3u8: function (video: HTMLVideoElement, url: string, art: any) {
              if (Hls.isSupported()) {
                if (art.hls) {
                  try {
                    art.hls.stopLoad();
                    art.hls.detachMedia();
                    art.hls.destroy();
                  } catch (e) {}
                  art.hls = null;
                }

                // Prevent dual playback: reset native video source before attaching MediaSource
                try {
                  video.pause();
                  if (video.src && !video.src.startsWith('blob:')) {
                    video.removeAttribute('src');
                  }
                } catch (e) {}

                const hls = new Hls({
                  enableWorker: true,
                  lowLatencyMode: false,
                  backBufferLength: 90,
                  maxBufferLength: 60,
                  maxMaxBufferLength: 120,
                  maxBufferSize: 60 * 1000 * 1000,
                  maxBufferHole: 0.5,
                  highBufferWatchdogPeriod: 2,
                  maxStarvationDelay: 4,
                  fragLoadingTimeOut: 20000,
                  fragLoadingMaxRetry: 6,
                  fragLoadingRetryDelay: 1000,
                  manifestLoadingTimeOut: 15000,
                  manifestLoadingMaxRetry: 5,
                  levelLoadingTimeOut: 15000,
                  levelLoadingMaxRetry: 5,
                });

                hls.loadSource(url);
                hls.attachMedia(video);
                art.hls = hls;

                hls.on(Hls.Events.ERROR, (_event, data) => {
                  if (data.fatal) {
                    switch (data.type) {
                      case Hls.ErrorTypes.NETWORK_ERROR:
                        console.warn('HLS Network Error, attempting recovery...');
                        hls.startLoad();
                        break;
                      case Hls.ErrorTypes.MEDIA_ERROR:
                        console.warn('HLS Media Error, attempting recovery...');
                        hls.recoverMediaError();
                        break;
                      default:
                        console.error('Fatal unrecoverable HLS error:', data);
                        if (streamSource === 'direct') {
                          setStreamSource('proxy');
                          if (art && art.notice) {
                            art.notice.show = 'Switching to Proxy fallback...';
                          }
                        }
                        break;
                    }
                  }
                });

                art.on('destroy', () => {
                  try {
                    hls.stopLoad();
                    hls.detachMedia();
                    hls.destroy();
                  } catch (e) {}
                });
              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
              } else {
                art.notice.show = 'HLS streaming not supported';
              }
            },
          },
          subtitle: {
            url: activeSubtitleSrcRef.current !== 'off'
              ? (activeSubtitleSrcRef.current.startsWith('/api/') || activeSubtitleSrcRef.current.startsWith('blob:')
                ? activeSubtitleSrcRef.current
                : `/api/hanimestream/subtitle?url=${encodeURIComponent(activeSubtitleSrcRef.current)}`)
              : '',
            type: 'vtt',
            style: {
              color: '#ffffff',
            },
            escape: false,
          },
          settings: (() => {
            const playerSettings: any[] = [];

            // 1. Video Quality Setting (if multiple options available)
            if (qualityList.length > 0) {
              playerSettings.push({
                name: 'quality',
                html: 'Quality',
                width: 160,
                selector: qualityList
                  .filter((file) => {
                    if (isHanimestream) {
                      return file.id !== '720p' && file.quality !== '720p' && !file.name?.includes('720');
                    }
                    return true;
                  })
                  .map((file, idx) => {
                    const isSelected = file.id === (selectedFileId || qualityList[0].id);
                    let label = (file as any).label || (file as any).name;
                    if (isHanimestream) {
                      if (file.id === '2160p' || file.quality === '2160p' || file.quality === '4K') {
                        label = '2160p';
                      } else if (file.id === '1080p48' || file.id === '1080i' || file.quality === '1080p48') {
                        label = '1080p48';
                      } else if (file.id === '2160p48' || file.id === '2160i') {
                        label = '2160p48';
                      } else if (file.id === '1080p' || file.quality === '1080p') {
                        label = '1080p';
                      }
                    } else if (!label) {
                      label = (
                        (file.quality === '4K' || file.quality === '2160p')
                          ? '2160p'
                          : file.quality === '1440p'
                            ? '1440p'
                            : file.quality === '1080p'
                              ? '1080p'
                              : file.quality === '720p'
                                ? '720p'
                                : file.quality === '480p'
                                  ? '480p'
                                  : file.quality === '240p'
                                    ? '240p'
                                    : (file.quality || file.id || (idx === 0 ? '1080p' : '720p'))
                      );
                    }
                    return {
                      default: isSelected,
                      html: label,
                      value: file.id,
                    };
                  }),
                onSelect: function (item: any) {
                  const currentFiles = (availableFilesRef.current && availableFilesRef.current.length > 0)
                    ? availableFilesRef.current
                    : qualityList;
                  const targetFile = currentFiles.find(f => f.id === item.value) ||
                                     currentFiles.find(f => f.quality === item.value || (f as any).label === item.html);
                  if (targetFile && playerRef.current) {
                    const targetUrl = (isEporner || isPornhub)
                      ? targetFile.streamProxyUrl
                      : (streamSource === 'proxy' ? targetFile.streamProxyUrl : targetFile.directStreamUrl);
                    
                    const rawCurrentTime = playerRef.current.currentTime || (playerRef.current.video ? playerRef.current.video.currentTime : 0);
                    const savedTime = (rawCurrentTime && rawCurrentTime > 0)
                      ? rawCurrentTime
                      : (lastPlaybackTimeRef.current || 0);

                    setSelectedFileId(targetFile.id);
                    handleSwitchStream(targetUrl, savedTime);

                    if (playerRef.current) {
                      playerRef.current.notice.show = `⚡ ${item.html} • [${formatPlaybackTime(savedTime)}]`;
                    }
                  }
                  return item.html;
                },
              });
            }

            // 2. Caption Setting - STRICTLY ONLY for Hanime and JAV (or if subtitles extracted)
            const isJavCheck = Boolean(extractJavCode(`${initialTitle || ''} ${videoTitle || ''} ${url || ''}`));
            const hasSubtitles = isHanimestream || isJavCheck || extractedSubtitles.length > 0;

            if (hasSubtitles) {
              const isOffSelected = activeSubtitleSrcRef.current === 'off';
              const isArabicSelected = activeSubtitleSrcRef.current === arabicSubBlobUrl || (activeSubtitleSrcRef.current !== 'off' && activeSubtitleSrcRef.current.includes('arabic'));
              const activeOriginalSub = extractedSubtitles.find(s => s.src === activeSubtitleSrcRef.current);
              const captionTooltip = isOffSelected
                ? 'Off'
                : (isArabicSelected ? 'AI Arabic' : (activeOriginalSub?.label || 'English'));

              const filteredSubs = extractedSubtitles.length > 0
                ? extractedSubtitles.filter(s => s.label !== 'Arabic' && s.srclang !== 'ar')
                : (isHanimestream ? [{ label: 'English', kind: 'captions', srclang: 'en', src: 'en_default', default: true }] : []);

              playerSettings.push({
                name: 'caption',
                html: 'Caption',
                width: 220,
                tooltip: captionTooltip,
                selector: [
                  {
                    default: isOffSelected,
                    html: 'Off',
                    value: 'off',
                  },
                  ...filteredSubs.map((sub) => {
                    const isSelected = activeSubtitleSrcRef.current === sub.src || (!isOffSelected && !isArabicSelected && sub.default);
                    return {
                      default: isSelected,
                      html: sub.label || 'English',
                      value: sub.src,
                    };
                  }),
                  {
                    default: isArabicSelected,
                    html: 'IA Arabic',
                    value: 'arabic',
                  },
                ],
                onSelect: function (item: any) {
                  const val = item.value;
                  if (val === 'off') {
                    activeSubtitleSrcRef.current = 'off';
                    setActiveSubtitleSrc('off');
                    if (playerRef.current) {
                      const art = playerRef.current as any;
                      art.subtitle.show = false;
                      if (art.template?.$subtitle) {
                        art.template.$subtitle.style.display = 'none';
                        art.template.$subtitle.innerHTML = '';
                      }
                      if (art.template?.$video?.textTracks) {
                        for (let i = 0; i < art.template.$video.textTracks.length; i++) {
                          art.template.$video.textTracks[i].mode = 'disabled';
                        }
                      }
                      art.notice.show = 'Caption: Off';
                    }
                    return 'Off';
                  } else if (val === 'arabic') {
                    handleSelectArabicSubtitleRef.current();
                    return 'IA Arabic';
                  } else {
                    activeSubtitleSrcRef.current = val;
                    setActiveSubtitleSrc(val);
                    let targetSubUrl = val;
                    if (targetSubUrl === 'en_default') {
                      const found = extractedSubtitles.find(s => s.default) || extractedSubtitles[0];
                      if (found) targetSubUrl = found.src;
                    }
                    const proxiedUrl = targetSubUrl.startsWith('/api/') || targetSubUrl.startsWith('blob:')
                      ? targetSubUrl
                      : `/api/hanimestream/subtitle?url=${encodeURIComponent(targetSubUrl)}`;

                    if (playerRef.current) {
                      const art = playerRef.current as any;
                      art.subtitle.show = true;
                      if (art.template?.$subtitle) {
                        art.template.$subtitle.style.display = 'flex';
                      }
                      art.subtitle.switch(proxiedUrl, { name: item.html }).catch((err: any) => {
                        console.warn('Subtitle switch error:', err);
                      });
                      art.notice.show = `Caption: ${item.html}`;
                    }
                    return item.html;
                  }
                },
              });
            }

            return playerSettings;
          })(),
        };

        player = new Artplayer(artOptions);
        activeLoadedUrlRef.current = activeVideoSrc;
        playerRef.current = player;

        // Track layout, cover embed, and orientation for responsive subtitle & UI scaling
        updateLayoutAndOrientation = () => {
          if (!player) return;
          const playerEl = (player as any).template?.$player;
          if (!playerEl) return;

          const isFullscreen = !!(player.fullscreen || player.fullscreenWeb || document.fullscreenElement);
          const isCoverMode = !isFullscreen && (isCoverEmbed || (player.height > 0 && player.height <= 440));

          if (isFullscreen) {
            playerEl.classList.add('art-is-fullscreen');
            playerEl.classList.remove('art-is-cover-embed');
          } else if (isCoverMode) {
            playerEl.classList.add('art-is-cover-embed');
            playerEl.classList.remove('art-is-fullscreen');
          } else {
            playerEl.classList.remove('art-is-fullscreen');
            playerEl.classList.remove('art-is-cover-embed');
          }

          const isPortrait = !isFullscreen && (player.height > player.width || window.innerHeight > window.innerWidth);
          if (isPortrait) {
            playerEl.classList.add('art-is-portrait');
            playerEl.classList.remove('art-is-landscape');
          } else {
            playerEl.classList.add('art-is-landscape');
            playerEl.classList.remove('art-is-portrait');
          }
        };

        // Immediately invoke to lock in classes (art-is-cover-embed, etc.) on frame 0
        updateLayoutAndOrientation();

        player.on('resize', updateLayoutAndOrientation);
        player.on('fullscreen', updateLayoutAndOrientation);
        player.on('fullscreenWeb', updateLayoutAndOrientation);
        document.addEventListener('fullscreenchange', updateLayoutAndOrientation);

        // Ensure restored time on initial ready event and subtitle status
        player.on('ready', () => {
          updateLayoutAndOrientation();
          try {
            // Remove any conflicting default subtitle item from Artplayer setting panel
            if ((player as any).setting && typeof (player as any).setting.delete === 'function') {
              (player as any).setting.delete('subtitle');
            }
          } catch (e) {}
          if (activeSubtitleSrcRef.current !== 'off' && (player as any).subtitle) {
            (player as any).subtitle.show = true;
          }
          if (lastPlaybackTimeRef.current > 0 && player) {
            try {
              player.currentTime = lastPlaybackTimeRef.current;
            } catch (e) {}
          }
        });

        player.on('video:timeupdate', () => {
          if (player && (player as any).subtitle && (player as any).subtitle.url && (player as any).subtitle.show) {
            try {
              (player as any).subtitle.update();
            } catch (e) {}
          }
          if (player && player.currentTime && player.currentTime > 0) {
            lastPlaybackTimeRef.current = player.currentTime;

            // Save progress to localStorage (throttled every 2.5 seconds)
            const now = Date.now();
            if (now - lastStorageSaveRef.current > 2500) {
              lastStorageSaveRef.current = now;
              const dur = player.duration || 0;
              if (player.currentTime > 5 && (dur === 0 || player.currentTime < dur - 5)) {
                try {
                  localStorage.setItem(getPlaybackStorageKey(url), JSON.stringify({
                    time: Math.floor(player.currentTime),
                    duration: Math.floor(dur),
                    updated: now,
                  }));
                } catch (e) {}
              }
            }
          }
        });

        player.on('video:seeking', () => {
          if (player && player.currentTime && player.currentTime > 0) {
            lastPlaybackTimeRef.current = player.currentTime;
          }
        });

        player.on('control', (state: boolean) => {
          setShowControls(state);
        });

        player.on('error', (err: any) => {
          if (err?.name === 'NotAllowedError' || String(err).includes('NotAllowedError')) {
            return;
          }
          console.warn('Artplayer playback error:', err);
          if (isPornhub) {
            // Pornhub requires proxy streaming to avoid anti-hotlink blocks; prevent crashing on transient switch errors
            console.warn('Pornhub stream error handled:', err);
            return;
          }
          if (streamSource === 'proxy') {
            setStreamSource('direct');
            if (player) {
              player.notice.show = 'Switching to Direct CDN...';
            }
          } else if (streamSource === 'direct' && (isFilester || isGofile || isCyberfile || isFileditch || isEporner || isXhamster || isPorntrex)) {
            setStreamSource('proxy');
            if (player) {
              player.notice.show = 'Switching to Optimized Proxy...';
            }
          } else {
            setHasCodecError(true);
          }
        });
      } catch (e) {
        console.error('Error initializing Artplayer for media overlay:', e);
        setHasCodecError(true);
      }
    }

    return () => {
      if (updateLayoutAndOrientation) {
        document.removeEventListener('fullscreenchange', updateLayoutAndOrientation);
      }
      terminateAllOverlayPlayback();
    };
  }, [isExtracting, hasCodecError]);

  // Smoothly switch stream URL on the existing player when activeVideoSrc changes (e.g. proxy toggle or quality change)
  useEffect(() => {
    if (playerRef.current && activeLoadedUrlRef.current && activeLoadedUrlRef.current !== activeVideoSrc) {
      handleSwitchStream(activeVideoSrc);
    }
  }, [activeVideoSrc]);

  // Synchronize Artplayer setting menu when extractedSubtitles updates dynamically
  useEffect(() => {
    if (!playerRef.current) return;
    const art = playerRef.current as any;
    if (!art.setting) return;

    const isJavCheck = Boolean(extractJavCode(`${initialTitle || ''} ${videoTitle || ''} ${url || ''}`));
    const hasSubtitles = isHanimestream || isJavCheck || extractedSubtitles.length > 0;

    if (!hasSubtitles) {
      try {
        if (typeof art.setting.delete === 'function') {
          art.setting.delete('caption');
          art.setting.delete('subtitle');
        }
      } catch (e) {}
      return;
    }

    try {
      const isOffSelected = activeSubtitleSrcRef.current === 'off';
      const isArabicSelected = activeSubtitleSrcRef.current === arabicSubBlobUrl || (activeSubtitleSrcRef.current !== 'off' && activeSubtitleSrcRef.current.includes('arabic'));
      const activeOriginalSub = extractedSubtitles.find(s => s.src === activeSubtitleSrcRef.current);
      const captionTooltip = isOffSelected
        ? 'Off'
        : (isArabicSelected ? 'AI Arabic' : (activeOriginalSub?.label || 'English'));

      const filteredSubs = extractedSubtitles.length > 0
        ? extractedSubtitles.filter(s => s.label !== 'Arabic' && s.srclang !== 'ar')
        : (isHanimestream ? [{ label: 'English', kind: 'captions', srclang: 'en', src: 'en_default', default: true }] : []);

      const captionSettingConfig = {
        name: 'caption',
        html: 'Caption',
        width: 220,
        tooltip: captionTooltip,
        selector: [
          {
            default: isOffSelected,
            html: 'Off',
            value: 'off',
          },
          ...filteredSubs.map((sub) => {
            const isSelected = activeSubtitleSrcRef.current === sub.src || (!isOffSelected && !isArabicSelected && sub.default);
            return {
              default: isSelected,
              html: sub.label || 'English',
              value: sub.src,
            };
          }),
          {
            default: isArabicSelected,
            html: 'IA Arabic',
            value: 'arabic',
          },
        ],
        onSelect: function (item: any) {
          const val = item.value;
          if (val === 'off') {
            activeSubtitleSrcRef.current = 'off';
            setActiveSubtitleSrc('off');
            art.subtitle.show = false;
            if (art.template?.$subtitle) {
              art.template.$subtitle.style.display = 'none';
              art.template.$subtitle.innerHTML = '';
            }
            if (art.template?.$video?.textTracks) {
              for (let i = 0; i < art.template.$video.textTracks.length; i++) {
                art.template.$video.textTracks[i].mode = 'disabled';
              }
            }
            art.notice.show = 'Caption: Off';
            return 'Off';
          } else if (val === 'arabic') {
            handleSelectArabicSubtitleRef.current();
            return 'IA Arabic';
          } else {
            activeSubtitleSrcRef.current = val;
            setActiveSubtitleSrc(val);
            let targetSubUrl = val;
            if (targetSubUrl === 'en_default') {
              const found = extractedSubtitles.find(s => s.default) || extractedSubtitles[0];
              if (found) targetSubUrl = found.src;
            }
            const proxiedUrl = targetSubUrl.startsWith('/api/') || targetSubUrl.startsWith('blob:')
              ? targetSubUrl
              : `/api/hanimestream/subtitle?url=${encodeURIComponent(targetSubUrl)}`;

            art.subtitle.show = true;
            if (art.template?.$subtitle) {
              art.template.$subtitle.style.display = 'flex';
            }
            art.subtitle.switch(proxiedUrl, { name: item.html }).catch((err: any) => {
              console.warn('Subtitle switch error:', err);
            });
            art.notice.show = `Caption: ${item.html}`;
            return item.html;
          }
        },
      };

      if (typeof art.setting.update === 'function') {
        art.setting.update(captionSettingConfig);
      }
    } catch (e) {
      console.warn('Could not update Caption setting:', e);
    }
  }, [extractedSubtitles, activeSubtitleSrc, arabicSubBlobUrl, isHanimestream, initialTitle, videoTitle, url]);

  // Pause all other media on page when overlay opens
  useEffect(() => {
    try {
      const allMedia = document.querySelectorAll('video, audio');
      allMedia.forEach((el) => {
        if (el instanceof HTMLMediaElement && el !== playerRef.current?.video) {
          el.pause();
        }
      });
    } catch (e) {}

    return () => {
      terminateAllOverlayPlayback();
    };
  }, []);

  // Safe close handler that completely terminates audio, video, DASH, and HLS before closing
  const handleSafeClose = () => {
    terminateAllOverlayPlayback();
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSafeClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={async (e) => {
        e.stopPropagation();
        if (showSnifferInput && isBridgeRunning) {
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              const clean = text.trim();
              const extracted = extractFileditchWorkerUrlFromText(clean);
              if (extracted && extracted !== lastProcessedTextRef.current) {
                const matchesTarget = doesWorkerUrlMatchTarget(extracted, url);
                const isFreshCopyAfterBridge = clean !== baselineClipboardRef.current;
                if (matchesTarget || isFreshCopyAfterBridge) {
                  lastProcessedTextRef.current = extracted;
                  setIsBridgeRunning(false);
                  handleSnifferCapture(extracted);
                }
              }
            }
          } catch (err) {}
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute inset-0 z-[150] flex items-center justify-center overflow-hidden bg-black ${
        isCoverEmbed ? 'is-cover-embed-container' : ''
      }`}
    >
      <style>{`
        .artplayer-app {
          width: 100% !important;
          height: 100% !important;
          background-color: transparent !important;
        }
        .art-video-player {
          width: 100% !important;
          height: 100% !important;
          background-color: transparent !important;
        }
        .art-video-player video {
          width: 100% !important;
          height: 100% !important;
          object-position: center !important;
          object-fit: contain !important;
        }

        /* Subtitle visibility and high-contrast styling */
        .art-video-player .art-subtitle {
          z-index: 40 !important;
          pointer-events: none !important;
          text-align: center !important;
          width: 100% !important;
          padding: 0 4% !important;
          direction: auto !important;
          unicode-bidi: plaintext !important;
          transition: bottom 0.2s ease, font-size 0.2s ease !important;
        }

        .art-video-player.art-subtitle-show .art-subtitle {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
        }

        .art-video-player:not(.art-subtitle-show) .art-subtitle {
          display: none !important;
        }

        .art-video-player .art-subtitle .art-subtitle-line {
          display: inline-block !important;
          background: rgba(0, 0, 0, 0.82) !important;
          color: #ffffff !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
          padding: 4px 12px !important;
          border-radius: 6px !important;
          backdrop-filter: blur(4px) !important;
          -webkit-backdrop-filter: blur(4px) !important;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8) !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45) !important;
          margin: 2px auto !important;
          max-width: 90% !important;
          word-break: break-word !important;
        }

        /* ========================================================================= */
        /* MODE 1: Episode Cover / Compact Card Mode                                 */
        /* (When playing on episode covers in Hanime episode details or cards)       */
        /* ========================================================================= */
        .art-video-player.art-is-cover-embed:not(.art-fullscreen):not(.art-fullscreen-web):not(.art-is-fullscreen) .art-subtitle,
        .is-cover-embed-container .art-video-player:not(.art-fullscreen):not(.art-fullscreen-web):not(.art-is-fullscreen) .art-subtitle {
          bottom: 8px !important;
          padding: 0 2.5% !important;
          font-size: clamp(9.5px, 2.3vw, 12px) !important;
        }

        .art-video-player.art-is-cover-embed:not(.art-fullscreen):not(.art-fullscreen-web):not(.art-is-fullscreen).art-control-show .art-subtitle,
        .is-cover-embed-container .art-video-player:not(.art-fullscreen):not(.art-fullscreen-web):not(.art-is-fullscreen).art-control-show .art-subtitle {
          bottom: calc(var(--art-control-height, 36px) + 5px) !important;
        }

        .art-video-player.art-is-cover-embed:not(.art-fullscreen):not(.art-fullscreen-web):not(.art-is-fullscreen) .art-subtitle .art-subtitle-line,
        .is-cover-embed-container .art-video-player:not(.art-fullscreen):not(.art-fullscreen-web):not(.art-is-fullscreen) .art-subtitle .art-subtitle-line {
          font-size: clamp(9.5px, 2.3vw, 12px) !important;
          line-height: 1.25 !important;
          padding: 2px 7px !important;
          border-radius: 4px !important;
          margin: 1px auto !important;
          max-width: 95% !important;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55) !important;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95) !important;
          background: rgba(0, 0, 0, 0.84) !important;
        }

        /* ========================================================================= */
        /* MODE 2: Fullscreen Mode & Regular Full Viewport Mode                     */
        /* (Preserved exactly as designed with generous sizing and line spacing)    */
        /* ========================================================================= */

        /* Mobile Portrait Mode (Vertical Phone Screen) */
        @media (orientation: portrait) and (max-width: 768px) {
          .art-video-player:not(.art-is-cover-embed) .art-subtitle,
          .art-video-player.art-fullscreen .art-subtitle,
          .art-video-player.art-fullscreen-web .art-subtitle,
          .art-video-player.art-is-fullscreen .art-subtitle {
            bottom: max(32px, calc(50% - 25vw)) !important;
            font-size: clamp(14px, 4vw, 19px) !important;
          }
          .art-video-player:not(.art-is-cover-embed).art-control-show .art-subtitle,
          .art-video-player.art-fullscreen.art-control-show .art-subtitle,
          .art-video-player.art-fullscreen-web.art-control-show .art-subtitle,
          .art-video-player.art-is-fullscreen.art-control-show .art-subtitle {
            bottom: max(calc(var(--art-control-height, 44px) + 20px), calc(50% - 23vw)) !important;
          }
        }

        /* Mobile Landscape Mode (Horizontal Phone Screen) */
        .art-video-player.art-is-landscape:not(.art-is-cover-embed) .art-subtitle,
        .art-video-player.art-fullscreen.art-is-landscape .art-subtitle,
        .art-video-player.art-fullscreen-web.art-is-landscape .art-subtitle,
        .art-video-player.art-is-fullscreen.art-is-landscape .art-subtitle,
        @media (orientation: landscape) and (max-height: 600px) {
          .art-video-player:not(.art-is-cover-embed) .art-subtitle,
          .art-video-player.art-fullscreen .art-subtitle,
          .art-video-player.art-fullscreen-web .art-subtitle,
          .art-video-player.art-is-fullscreen .art-subtitle {
            bottom: 16px !important;
            font-size: clamp(13px, 3.2vh, 18px) !important;
          }
          .art-video-player:not(.art-is-cover-embed).art-control-show .art-subtitle,
          .art-video-player.art-fullscreen.art-control-show .art-subtitle,
          .art-video-player.art-fullscreen-web.art-control-show .art-subtitle,
          .art-video-player.art-is-fullscreen.art-control-show .art-subtitle {
            bottom: calc(var(--art-control-height, 40px) + 12px) !important;
          }
        }

        /* Standard Desktop View / Fullscreen */
        @media (min-width: 769px) and (orientation: landscape) {
          .art-video-player:not(.art-is-cover-embed) .art-subtitle,
          .art-video-player.art-fullscreen .art-subtitle,
          .art-video-player.art-fullscreen-web .art-subtitle,
          .art-video-player.art-is-fullscreen .art-subtitle {
            bottom: 24px !important;
            font-size: clamp(16px, 2vw, 22px) !important;
          }
          .art-video-player:not(.art-is-cover-embed).art-control-show .art-subtitle,
          .art-video-player.art-fullscreen.art-control-show .art-subtitle,
          .art-video-player.art-fullscreen-web.art-control-show .art-subtitle,
          .art-video-player.art-is-fullscreen.art-control-show .art-subtitle {
            bottom: calc(var(--art-control-height, 48px) + 16px) !important;
          }
        }

        /* Fullscreen Subtitle Line Padding and Size */
        .art-video-player.art-fullscreen .art-subtitle .art-subtitle-line,
        .art-video-player.art-fullscreen-web .art-subtitle .art-subtitle-line,
        .art-video-player.art-is-fullscreen .art-subtitle .art-subtitle-line,
        .art-video-player:not(.art-is-cover-embed) .art-subtitle .art-subtitle-line {
          padding: 4px 12px !important;
          border-radius: 6px !important;
          line-height: 1.35 !important;
        }
      `}</style>

      {/* Cover Aspect Ratio Container - perfectly centered to parent ratio */}
      <div
        className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
      >
        {/* Seamless poster backdrop: prevents black flicker/wink between mount and first decoded video frame */}
        {poster && !hasCodecError && (
          <img
            src={poster}
            alt=""
            className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none select-none"
            referrerPolicy="no-referrer"
          />
        )}

        {/* Top Floating Close Button */}
        <div
          className={`absolute top-4 right-4 z-[160] flex items-center transition-opacity duration-300 ${
            showSnifferInput || showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSafeClose();
            }}
            className="w-10 h-10 bg-black/50 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors shadow-lg cursor-pointer min-h-[44px] min-w-[44px]"
            title="Close"
          >
            <X size={22} />
          </button>
        </div>

        {/* Video Player Container - mounted in DOM with transparent canvas over poster */}
        <div
          ref={containerRef}
          className="absolute inset-0 w-full h-full z-10 [&>.artplayer-app]:w-full [&>.artplayer-app]:h-full overflow-hidden"
        />

        {/* Loading / Extraction Overlay */}
        {isExtracting && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/60 backdrop-blur-[2px]">
            <Loader2 className="animate-spin text-blue-500" size={32} />
            <p className="text-white text-xs font-semibold tracking-wide">
              Extracting and preparing link stream...
            </p>
          </div>
        )}

        {/* FileDitch / Sniffer Prompt Overlay */}
        {showSnifferInput && (
          <div
            id="fileditch-sniffer-controls"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-4 animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Go to Copy Button - Centered in cover container, maximum rounded corners */}
            <button
              id="btn-go-to-copy"
              onClick={handleGoToCopy}
              disabled={isExtracting}
              className="w-full max-w-[85%] sm:max-w-xs py-3.5 px-6 text-white rounded-full text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2.5 transition-all shadow-xl active:scale-95 cursor-pointer min-h-[48px]"
              style={{
                backgroundColor: accentColor || 'var(--accent, #2563eb)',
              }}
            >
              {isBridgeRunning ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>Waiting for copied link...</span>
                </>
              ) : (
                <>
                  <ExternalLink size={16} />
                  <span>Go to Copy</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Codec / Playback Error Overlay */}
        {hasCodecError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center p-6 bg-black/90 backdrop-blur-[2px]">
            <div className="text-center p-4 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-xl max-w-md mx-4">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="text-red-500" size={24} />
              </div>
              <p className="text-white text-sm font-medium mb-4">
                Could not play video directly in browser. You can play it immediately in 1DM or an external player.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button
                  onClick={handleOpenExternal}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-xl font-bold transition-all text-xs cursor-pointer min-h-[44px]"
                >
                  <Play size={15} className="fill-current" />
                  Play in 1DM / External App
                </button>
                <button
                  onClick={() => handleCopy1DMLink()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/10 hover:bg-white/20 active:scale-95 text-neutral-200 rounded-xl font-semibold transition-all text-xs cursor-pointer min-h-[44px]"
                >
                  {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                  {copied ? 'Copied!' : 'Copy 1DM Link'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Debrid-style Loading Overlay for Subtitle Translation */}
        {isTranslatingSubtitles && (
          <div className="absolute inset-0 z-[170] bg-black/75 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 select-none pointer-events-auto animate-in fade-in duration-150">
            <div className="flex flex-col items-center gap-3 text-white max-w-[80%] text-center">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shadow-[0_0_10px_var(--accent)]" />
              <div className="text-xs font-medium tracking-wide animate-pulse">
                {translationProgressText || 'Translating subtitles...'}
              </div>
              <button
                onClick={() => setIsTranslatingSubtitles(false)}
                className="mt-1 text-[11px] text-gray-400 hover:text-white underline transition-colors cursor-pointer"
              >
                Cancel Translation
              </button>
            </div>
          </div>
        )}

        {/* Gemini API Key Input Modal */}
        {showApiKeyModal && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 z-[180] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          >
            <div className="bg-[#1e1e24] border border-white/10 rounded-3xl max-w-md w-full p-6 text-left shadow-2xl text-white">
              <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                  </div>
                  <h3 className="font-bold text-base">Gemini API Key Required</h3>
                </div>
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-gray-300 mb-4 leading-relaxed">
                To translate subtitles into Arabic using AI, please provide your Gemini API key. The service is fast and free.
              </p>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-indigo-300 mb-1.5">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="Paste AIzaSy... key here"
                  className="w-full bg-[#121216] border border-white/10 rounded-2xl px-4 py-3 text-xs text-white placeholder-gray-500 font-mono outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400 mb-6">
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <span>Get free key from Google AI Studio</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span>gemini-3.5-flash-lite</span>
              </div>

              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className="flex-1 py-3 px-4 rounded-2xl border border-white/10 text-xs font-medium text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const trimmedKey = tempApiKey.trim();
                    if (trimmedKey) {
                      updateSettings({ geminiApiKey: trimmedKey, enableGemini: true });
                      setShowApiKeyModal(false);
                      addNotification('Gemini API key saved successfully', 'success');
                      handleSelectArabicSubtitleRef.current(trimmedKey);
                    }
                  }}
                  disabled={!tempApiKey.trim()}
                  className="flex-1 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-xs font-bold text-white transition-colors shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-1.5"
                >
                  <span>Save & Start Translation</span>
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
