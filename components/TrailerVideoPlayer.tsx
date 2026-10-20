import React, { useEffect, useRef, useState, memo } from 'react';
import Hls from 'hls.js';
import { Film, Play, Volume2, VolumeX, X, Maximize2, AlertCircle } from 'lucide-react';
import { AspectRatio } from '../types';

interface TrailerCardPreviewProps {
  trailerUrl: string;
  isActive: boolean;
  aspectRatio?: AspectRatio;
  coverOffset?: number;
  onReady?: () => void;
}

export const TrailerCardPreview: React.FC<TrailerCardPreviewProps> = memo(({
  trailerUrl,
  isActive,
  aspectRatio = '16:9',
  coverOffset = 50,
  onReady
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!isActive || !trailerUrl) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      setIsLoaded(false);
      setHasError(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
    setHasError(false);

    const isHls = trailerUrl.includes('.m3u8') || trailerUrl.includes('playlist.m3u8');

    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari / iOS)
        video.src = trailerUrl;
        video.play().catch(() => {});
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.loadSource(trailerUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!destroyed && video) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                setHasError(true);
                break;
            }
          }
        });
      } else {
        video.src = trailerUrl;
        video.play().catch(() => {});
      }
    } else {
      // Direct MP4 / WebM
      video.src = trailerUrl;
      video.play().catch(() => {});
    }

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      setIsLoaded(false);
    };
  }, [isActive, trailerUrl]);

  if (!isActive || hasError) return null;

  return (
    <div className="absolute inset-0 z-[5] overflow-hidden pointer-events-none">
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        onPlaying={() => {
          setIsLoaded(true);
          onReady?.();
        }}
        onError={() => setHasError(true)}
        className={`w-full h-full transition-opacity duration-500 ease-out ${
          aspectRatio === 'Adaptive' ? 'object-contain' : 'object-cover'
        }`}
        style={{
          objectPosition: `center ${coverOffset}%`,
          opacity: isLoaded ? 1 : 0,
        }}
      />
      {/* Subtle indicator badge when trailer is active */}
      <div 
        className={`absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white text-[10px] font-semibold tracking-wider transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        TRAILER
      </div>
    </div>
  );
});

interface TrailerModalPlayerProps {
  trailerUrl: string;
  title: string;
  onClose: () => void;
}

export const TrailerModalPlayer: React.FC<TrailerModalPlayerProps> = ({
  trailerUrl,
  title,
  onClose
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !trailerUrl) return;

    let destroyed = false;
    setIsLoading(true);
    setError(null);

    const isHls = trailerUrl.includes('.m3u8') || trailerUrl.includes('playlist.m3u8');

    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = trailerUrl;
        video.play().catch(() => {});
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;

        hls.loadSource(trailerUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!destroyed && video) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError('Failed to load video stream');
          }
        });
      } else {
        video.src = trailerUrl;
        video.play().catch(() => {});
      }
    } else {
      video.src = trailerUrl;
      video.play().catch(() => {});
    }

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
      }
    };
  }, [trailerUrl]);

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-4xl bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-neutral-900/90 border-b border-neutral-800 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <Film className="w-4 h-4 text-amber-400 shrink-0" />
            <h3 className="text-sm font-semibold text-white truncate max-w-md">
              {title} - Trailer
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Area */}
        <div className="relative aspect-video bg-black flex items-center justify-center">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-rose-400 z-10">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <video
            ref={videoRef}
            playsInline
            controls
            autoPlay
            muted={isMuted}
            onPlaying={() => setIsLoading(false)}
            onWaiting={() => setIsLoading(true)}
            onError={() => {
              setIsLoading(false);
              setError('Error during video playback');
            }}
            className="w-full h-full object-contain"
          />
        </div>
      </div>
    </div>
  );
};
