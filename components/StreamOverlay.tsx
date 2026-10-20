import React, { useState, useEffect, useRef } from 'react';
import { Icons } from '../constants';
import Artplayer from 'artplayer';
import { motion } from 'motion/react';
import { copyTextToClipboard } from '../utils/clipboard';
import { extractJavCode, JavSubtitleTrack } from '../utils/javSubtitles';

interface StreamOverlayProps {
  magnet: string;
  torboxApiKey?: string;
  realDebridApiKey?: string;
  itemTitle?: string;
  itemActors?: string[];
  itemTags?: string[];
  onClose: () => void;
}

export const isVideo = (name: string) => /\.(mp4|mkv|webm|avi|mov)$/i.test(name);

export const scoreFile = (name: string, itemTitle?: string, itemActors?: string[], itemTags?: string[]) => {
  let score = 0;
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  
  if (itemTitle) {
    const titleParts = itemTitle.toLowerCase().split(/[ \-]+/);
    (titleParts || []).forEach(part => {
        if (part && part.length > 2 && normalizedName.includes(part.replace(/[^a-z0-9]/g, ' '))) score += 10;
    });
  }
  
  if (itemActors && Array.isArray(itemActors)) {
    itemActors.forEach(actor => {
      if (actor && typeof actor === 'string') {
        const parts = actor.toLowerCase().split(/[ \-]+/);
        (parts || []).forEach(part => {
          if (part && part.length > 2 && normalizedName.includes(part.replace(/[^a-z0-9]/g, ' '))) score += 15;
        });
      }
    });
  }
  
  if (itemTags && Array.isArray(itemTags)) {
     itemTags.forEach(tag => {
        if (tag && typeof tag === 'string') {
          const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]/g, ' ');
          if (normalizedTag.length > 2 && normalizedName.includes(normalizedTag)) {
             score += 5;
          }
        }
     });
  }
  
  return score;
};

export const getBestFile = (videoFiles: any[], itemTitle?: string, itemActors?: string[], itemTags?: string[]) => {
   if (!videoFiles || videoFiles.length === 0) return null;
   if (videoFiles.length === 1) return videoFiles[0];
   
   let maxScore = -1;
   let bestMatchFiles = [];
   
   for (const f of videoFiles) {
       const fileName = f.name || f.path || '';
       const score = scoreFile(fileName, itemTitle, itemActors, itemTags);
       if (score > maxScore) {
           maxScore = score;
           bestMatchFiles = [f];
       } else if (score === maxScore) {
           bestMatchFiles.push(f);
       }
   }
   
   // If no meaningful match, or tied, return the largest file among the top scorers
   return bestMatchFiles.sort((a, b) => (b.size || b.bytes || 0) - (a.size || a.bytes || 0))[0];
};

export const StreamOverlay: React.FC<StreamOverlayProps> = ({ 
  magnet, torboxApiKey, realDebridApiKey, 
  itemTitle, itemActors, itemTags,
  onClose 
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Starting stream...");
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [copied, setCopied] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Artplayer | null>(null);
  const [subtitles, setSubtitles] = useState<JavSubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<string>('off');
  const activeSubtitleRef = useRef<string>('off');

  // Search Subtitlecat if itemTitle or magnet indicates JAV video
  useEffect(() => {
    const code = extractJavCode(itemTitle) || extractJavCode(magnet);
    if (!code) return;

    let isMounted = true;
    fetch(`/api/jav-subtitles/search?code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => {
        if (!isMounted || !data.success || !data.subtitles || data.subtitles.length === 0) return;
        setSubtitles(data.subtitles);
        if (playerRef.current) {
          const art = playerRef.current as any;
          art.notice.show = `💬 Subtitles found: ${code}`;
        }
      })
      .catch(err => {
        console.warn('[StreamOverlay] Subtitle fetch error:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [itemTitle, magnet]);

  const handleCopy = async () => {
    if (!streamUrl) return;
    const success = await copyTextToClipboard(streamUrl, {
      successMessage: "Stream link copied to clipboard!",
      errorMessage: "Failed to copy stream link"
    });
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    let player: Artplayer | null = null;
    let wrapperDiv: HTMLDivElement | null = null;

    if (streamUrl && containerRef.current) {
      wrapperDiv = document.createElement('div');
      wrapperDiv.style.width = '100%';
      wrapperDiv.style.height = '100%';
      containerRef.current.appendChild(wrapperDiv);
      
      try {
        player = new Artplayer({
          container: wrapperDiv,
          url: streamUrl,
          // @ts-ignore
          title: 'Torbox Stream',
          volume: 1,
          autoplay: true,
          pip: false,
          autoSize: true,
          autoMini: true,
          screenshot: true,
          setting: true,
          settings: [
            {
              html: 'Caption',
              width: 200,
              tooltip: activeSubtitleRef.current === 'off'
                ? 'Off'
                : (subtitles.find(s => s.url === activeSubtitleRef.current)?.language || 'English'),
              selector: [
                {
                  default: activeSubtitleRef.current === 'off',
                  html: 'Off',
                  value: 'off',
                },
                ...subtitles.map(sub => ({
                  default: activeSubtitleRef.current === sub.url || (activeSubtitleRef.current !== 'off' && sub.isDefault),
                  html: sub.language,
                  value: sub.url,
                })),
              ],
              onSelect: function (item: any) {
                const val = item.value;
                if (val === 'off') {
                  activeSubtitleRef.current = 'off';
                  setActiveSubtitle('off');
                  if (playerRef.current) {
                    const art = playerRef.current as any;
                    art.subtitle.show = false;
                    art.notice.show = 'Caption: Off';
                  }
                  return 'Off';
                } else {
                  activeSubtitleRef.current = val;
                  setActiveSubtitle(val);
                  if (playerRef.current) {
                    const art = playerRef.current as any;
                    art.subtitle.show = true;
                    if (val.includes('targetLang=ar') || item.html === 'Arabic') {
                      art.notice.show = '⏳ Loading Arabic subtitles...';
                    } else {
                      art.notice.show = `Loading ${item.html}...`;
                    }
                    art.subtitle.switch(val, { name: item.html })
                      .then(() => {
                        art.notice.show = `✨ Caption: ${item.html}`;
                      })
                      .catch((err: any) => {
                        art.notice.show = `❌ Failed to load ${item.html}`;
                      });
                  }
                  return item.html;
                }
              },
            },
          ],
          loop: false,
          flip: false,
          playbackRate: false,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: false,
          subtitleOffset: false,
          miniProgressBar: true,
          mutex: true,
          backdrop: true,
          playsInline: true,
          autoPlayback: true,
          airplay: true,
          theme: '#3b82f6',
          subtitle: {
            url: activeSubtitleRef.current !== 'off' ? activeSubtitleRef.current : '',
            type: 'vtt',
            style: {
              color: '#ffffff',
              fontSize: '22px',
              textShadow: '0 2px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)',
              fontWeight: 'bold',
            },
          },
          // @ts-ignore
          controls: [
            {
              name: 'copy-link',
              position: 'right',
              index: 44,
              html: `
                <div class="art-control-copy">
                  <div class="copy-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </div>
                  <div class="check-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                </div>
              `,
              tooltip: 'Copy Stream Link',
              click: async function (art: any) {
                if (streamUrl) {
                  const success = await copyTextToClipboard(streamUrl, {
                    successMessage: "Stream link copied to clipboard!",
                    errorMessage: "Failed to copy stream link"
                  });
                  if (success) {
                    const btn = (art && art.template && art.template.$player)
                      ? art.template.$player.querySelector('.art-control-copy')
                      : document.querySelector('.art-control-copy');
                    if (btn) {
                      btn.classList.add('copied');
                      setTimeout(() => {
                        if (btn) btn.classList.remove('copied');
                      }, 2000);
                    }
                  }
                }
              }
            },
            {
              name: 'open-external',
              position: 'right',
              index: 45,
              html: `
                <div class="art-control-open">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="7" y1="17" x2="17" y2="7"></line>
                    <polyline points="7 7 17 7 17 17"></polyline>
                  </svg>
                </div>
              `,
              tooltip: 'Open with External Player',
              click: function () {
                if (!streamUrl) return;
                const ua = navigator.userAgent.toLowerCase();
                const isAndroid = ua.includes('android');

                if (isAndroid) {
                  try {
                    const urlObj = new URL(streamUrl, window.location.href);
                    const scheme = urlObj.protocol.replace(':', '');
                    const pathAndQuery = urlObj.host + urlObj.pathname + urlObj.search;
                    const intentUrl = `intent://${pathAndQuery}#Intent;scheme=${scheme};type=video/*;action=android.intent.action.VIEW;end;`;
                    window.location.href = intentUrl;
                    return;
                  } catch (err) {
                    console.error("URL formatting error", err);
                  }
                }
                
                // Fallback for iOS or desktop
                window.open(streamUrl, '_blank');
              }
            }
          ],
        });
        playerRef.current = player;

        player.on('control', (state: boolean) => {
          setShowControls(state);
        });

        player.on('ready', () => {
          const playPromise = player?.video?.play();
          if (playPromise !== undefined) {
             playPromise.catch(() => {
                if (player) {
                   player.muted = true;
                   player.video.play().catch(() => {});
                   if (player.notice) {
                      player.notice.show = "Autoplay blocked. Video muted.";
                   }
                }
             });
          }
        });

        player.on('error', (err: any) => {
          console.error("Artplayer streaming error:", err);
          setError("Unable to play the video via built-in player automatically. The video format (like MKV) or audio codec might be unsupported over HTTP. Please copy the link and play it in VLC.");
        });
      } catch (e) {
        console.error("Error initializing Artplayer", e);
      }
    }

    return () => {
      if (player) {
        try {
          player.destroy(false);
        } catch(e) {}
        playerRef.current = null;
      }
      if (wrapperDiv && containerRef.current) {
        try {
          containerRef.current.removeChild(wrapperDiv);
        } catch(e) {}
      }
    };
  }, [streamUrl]);

  useEffect(() => {
    // Safety timeout for fetch
    const fetchWithTimeout = async (resource: string, options: any = {}) => {
      const { timeout = 15000 } = options;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(resource, {
          ...options,
          signal: controller.signal  
        });
        clearTimeout(id);
        return response;
      } catch (err: any) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
          throw new Error("Request timed out. Please check your internet connection.");
        }
        if (err.message && err.message.toLowerCase().includes('fetch')) {
          throw new Error("Network Error: Failed to fetch. Please check if your API keys are correct, or if an AdBlocker is interfering.");
        }
        throw err;
      }
    };

    let isCancelled = false;

    const resolveStream = async () => {
      try {
        if (isCancelled) return;
        setLoading(true);
        setError(null);
        setStreamUrl(null);
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        if (!torboxApiKey?.trim() && !realDebridApiKey?.trim()) {
          throw new Error("No API Key provided. Please set Torbox or Real Debrid API Key in Settings.");
        }

        const magnetHashMatch = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
        const hash = magnetHashMatch ? magnetHashMatch[1].toLowerCase() : null;
        if (!hash) {
          throw new Error("Invalid Magnet Link.");
        }

        setStatusText("Searching in Cache...");

        // Race the caching checks
        const checkPromises = [];

        if (torboxApiKey?.trim()) {
          checkPromises.push(
            (async () => {
              try {
                const res = await fetchWithTimeout(`/api/torbox/torrents/checkcached?hash=${hash}&format=list`, {
                  headers: { Authorization: `Bearer ${torboxApiKey.trim()}` },
                  timeout: 10000
                });
                const data = await res.json();
                const isCached = Array.isArray(data.data) ? data.data.length > 0 : (data.data && typeof data.data === 'object' && Object.keys(data.data).length > 0);
                if (data.success && isCached) return { provider: 'torbox' };
              } catch(e) {}
              return null;
            })()
          );
        }

        if (realDebridApiKey?.trim()) {
          checkPromises.push(
            (async () => {
              try {
                const res = await fetchWithTimeout(`/api/rd/torrents/instantAvailability/${hash}`, {
                  headers: { Authorization: `Bearer ${realDebridApiKey.trim()}` },
                  timeout: 10000
                });
                const data = await res.json();
                const hashData = data[hash.toLowerCase()];
                if (hashData && hashData.rd && hashData.rd.length > 0) {
                    let bestVariant = hashData.rd[0];
                    let maxScore = -1;
                    for (const variant of hashData.rd) {
                        for (const fileInfo of Object.values(variant)) {
                            if (isVideo((fileInfo as any).filename)) {
                                const score = scoreFile((fileInfo as any).filename, itemTitle, itemActors, itemTags);
                                if (score > maxScore) {
                                    maxScore = score;
                                    bestVariant = variant;
                                }
                            }
                        }
                    }
                    return { provider: 'rd', cachedVariant: bestVariant };
                }
              } catch(e) {}
              return null;
            })()
          );
        }

        let rdCacheResult: any = null;
        let torboxCacheResult: any = null;
        
        await new Promise<void>((resolve) => {
           if (checkPromises.length === 0) return resolve();
           let completed = 0;
           for (const p of checkPromises) {
              p.then(res => {
                 if (res?.provider === 'rd') {
                    rdCacheResult = res;
                    resolve(); // RD is priority, resolve immediately!
                 } else if (res?.provider === 'torbox') {
                    torboxCacheResult = res;
                 }
              }).catch(() => {}).finally(() => {
                 completed++;
                 if (completed === checkPromises.length) resolve();
              });
           }
        });

        const cachedProvider = rdCacheResult?.provider || torboxCacheResult?.provider;
        const rdCachedVariant = rdCacheResult?.cachedVariant;

        const resolveWithTorbox = async () => {
          setStatusText("Checking existing Torbox torrents...");
          let torrentId = null;
          let createData: any = null;
          try {
             const checkRes = await fetchWithTimeout(`/api/torbox/torrents/mylist?limit=20`, {
               headers: { Authorization: `Bearer ${torboxApiKey?.trim()}` },
               timeout: 10000
             });
             let checkData = await checkRes.json().catch(() => null);
             if (checkRes.ok && checkData?.success && checkData.data) {
                const dataArray = Array.isArray(checkData.data) ? checkData.data : [checkData.data];
                const existing = dataArray.find((t: any) => (t.hash || t.info_hash || t.torrent_hash || '').toLowerCase() === hash.toLowerCase());
                if (existing && existing.id) {
                    torrentId = existing.id;
                }
             }
          } catch (e) {}

          if (!torrentId) {
            setStatusText("Adding to Torbox...");
            const formData = new FormData();
            formData.append("magnet", magnet);
            formData.append("seed", "1");
            formData.append("allow_zip", "false");
            
            const createRes = await fetchWithTimeout("/api/torbox/torrents/createtorrent", {
              method: "POST",
              headers: { 
                "Authorization": `Bearer ${torboxApiKey?.trim()}`
              },
              body: formData,
              timeout: 15000
            });
            
            createData = await createRes.json().catch(() => null);
            
            if (!createRes.ok || !createData?.success) {
              const errDetail = typeof createData?.detail === 'string' ? createData.detail : createData?.detail ? JSON.stringify(createData.detail) : null;
              const fallbackMsg = createRes.status === 429 ? "Rate limit exceeded (Too many requests/torrents)." 
                : createRes.status === 401 ? "Unauthorized. Check API Key." 
                : createRes.status === 403 ? "Forbidden. You may have hit your plan limit."
                : `Error ${createRes.status}: Failed to add magnet to Torbox.`;
              throw new Error(errDetail || createData?.error || fallbackMsg);
            }

            torrentId = createData.data?.torrent_id;
          }
          
          setStatusText("Waiting for file readiness (Torbox)...");
          await sleep(2000); // Allow Torbox DB propagation
          
          let isPolling = true;
          let delay = 2000;
          const startTime = Date.now();
          const MAX_POLL_TIME = 10 * 60 * 1000; // 10 minutes

          while (isPolling && !isCancelled) {
             if (Date.now() - startTime > MAX_POLL_TIME) {
                 throw new Error("Timeout: Torbox took too long to download the file.");
             }
             try {
               const fetchUrl = torrentId ? `/api/torbox/torrents/mylist?id=${torrentId}` : `/api/torbox/torrents/mylist`;
               const listRes = await fetchWithTimeout(fetchUrl, {
                 headers: { "Authorization": `Bearer ${torboxApiKey?.trim()}` }
               });
               const listText = await listRes.text();
               let listData;
               try {
                 listData = JSON.parse(listText);
               } catch (e) {
                 if (!listRes.ok) {
                    if (listRes.status === 401 || listRes.status === 403) {
                       throw new Error("Torbox API Key Invalid or Unauthorized.");
                    }
                    throw new Error(`Torbox Error ${listRes.status}`);
                 }
                 console.warn("Transient Torbox error, invalid JSON", e);
                 await sleep(5000);
                 continue;
               }
               
               if (!listRes.ok || !listData?.success) {
                  const errDetail = typeof listData?.detail === 'string' ? listData.detail : JSON.stringify(listData?.detail);
                  throw new Error(errDetail || "Failed to fetch Torbox list.");
               }
               
               const dataArray = Array.isArray(listData.data) ? listData.data : (listData.data ? [listData.data] : []);
               let torrent = dataArray.find((t: any) => {
                 const tHash = (t.hash || t.info_hash || t.torrent_hash || '').toLowerCase();
                 const targetHash = hash ? hash.toLowerCase() : '';
                 const tId = t.id !== undefined && t.id !== null ? String(t.id) : '';
                 const targetIdStr = torrentId !== undefined && torrentId !== null ? String(torrentId) : '';
                 
                 return (targetHash && tHash === targetHash) || (targetIdStr && tId === targetIdStr);
               });
               if (!torrent && createData?.data?.name) {
                 torrent = dataArray.find((t: any) => t.name === createData.data.name);
               }
               
               if (torrent) {
                 if (torrent.download_state === "finished" || torrent.download_state === "cached" || torrent.download_state === "completed") {
                   isPolling = false;
                   setStatusText("Fetching video link...");
                   
                   let bestFile = null;
                   if (torrent.files && torrent.files.length > 0) {
                      const videoFiles = torrent.files.filter((f: any) => isVideo(f.name));
                      if (videoFiles.length > 0) {
                        bestFile = getBestFile(videoFiles, itemTitle, itemActors, itemTags);
                      } else {
                        bestFile = torrent.files[0];
                      }
                   }
                   
                   if (!bestFile) {
                      throw new Error("No media files found in this torrent, or file list is empty/blind.");
                   }
                   
                   const fileId = bestFile.id; 

                   let dlData;
                   let reqDlRes;
                   try {
                     reqDlRes = await fetchWithTimeout(`/api/torbox-dl?torrent_id=${torrent.id}&file_id=${fileId}`, {
                       headers: { "Authorization": `Bearer ${torboxApiKey?.trim()}` }
                     });
                     dlData = await reqDlRes.json().catch(() => null);
                   } catch (e: any) {
                     console.error("GET requestdl error", e);
                   }
                   
                   if (!reqDlRes || !reqDlRes.ok || !dlData?.success || !dlData?.data) {
                     const getErrorDetail = typeof dlData?.detail === 'string' ? dlData.detail : (dlData?.detail ? JSON.stringify(dlData.detail) : "Unknown GET error");
                     console.error("GET requestdl failed with:", getErrorDetail, dlData);
                     throw new Error(getErrorDetail || "Failed to request torbox link");
                   }

                   if (dlData?.data) {
                      setStreamUrl(dlData.data);
                      setLoading(false);
                   } else {
                      throw new Error("No URL returned from torbox");
                   }
                 } else if (["download_error", "error", "failed", "paused", "stalled", "archived", "dead"].includes(torrent.download_state)) {
                   isPolling = false;
                   try { await fetchWithTimeout(`/api/torbox/torrents/controltorrent`, { method: "POST", headers: { Authorization: `Bearer ${torboxApiKey?.trim()}`, "Content-Type": "application/json" }, body: JSON.stringify({ torrent_id: torrentId, operation: "delete" }) }); } catch(e) {}
                   throw new Error(`Failed to download on Torbox (Status: ${torrent.download_state})`);
                 } else {
                   let prog = torrent.progress;
                   let progressTxt = '';
                   if (prog !== undefined) {
                     if (prog <= 1) prog = prog * 100;
                     if (prog > 100) prog = 100;
                     progressTxt = ` ${prog.toFixed(1)}%`;
                   }
                   setStatusText(`Downloading... (${torrent.download_state})${progressTxt}`);
                   delay = Math.min(5000, delay + 1000);
                 }
               }
             } catch (pollErr: any) {
               if (pollErr.name === 'AbortError') break;
               const msg = pollErr?.message || String(pollErr);
               if (msg.includes("Request timed out") || msg.toLowerCase().includes("fetch") || msg.includes("Network Error")) {
                   console.warn("Torbox Network/Timeout error, retrying...", pollErr);
                   setStatusText("Network issue, retrying poll...");
               } else {
                   isPolling = false;
                   throw pollErr;
               }
             }
             if (isPolling) await sleep(delay);
          }
        };

        const resolveWithRealDebrid = async () => {
          setStatusText("Checking existing Real Debrid torrents...");
          let torrentId: string | null = null;
          try {
            const listRes = await fetchWithTimeout(`/api/rd/torrents?limit=20`, {
               headers: { Authorization: `Bearer ${realDebridApiKey?.trim()}` },
               timeout: 10000
            });
            const listData = await listRes.json();
            if (Array.isArray(listData)) {
                const existing = listData.find((t: any) => (t.hash || '').toLowerCase() === hash.toLowerCase());
                if (existing && existing.id) {
                    if (["error", "magnet_error", "virus", "dead"].includes(existing.status)) {
                        console.warn("Found stale failed torrent on RD, removing:", existing.id);
                        try {
                            await fetchWithTimeout(`/api/rd/torrents/delete/${existing.id}`, {
                                method: "DELETE",
                                headers: { Authorization: `Bearer ${realDebridApiKey?.trim()}` }
                            });
                        } catch(e) {}
                        torrentId = null;
                    } else {
                        torrentId = existing.id;
                    }
                }
            }
          } catch (e) {}

          const addNewMagnet = async (): Promise<string> => {
            setStatusText("Adding to Real Debrid...");
            const rdForm = new URLSearchParams();
            rdForm.append("magnet", magnet);
            const addRes = await fetchWithTimeout(`/api/rd/torrents/addMagnet`, {
              method: "POST",
              headers: { 
                  Authorization: `Bearer ${realDebridApiKey?.trim()}`,
                  "Content-Type": "application/x-www-form-urlencoded"
              },
              body: rdForm
            });
            
            const addText = await addRes.text();
            let addData: any = {};
            try { addData = JSON.parse(addText); } catch(e) {}
            
            if (!addRes.ok || !addData.id) {
                const errorMsg = typeof addData.error === 'string' 
                   ? addData.error 
                   : (addData.error ? JSON.stringify(addData.error) : `Error ${addRes.status}: Failed to add magnet to Real Debrid`);
                throw new Error(errorMsg);
            }
            return addData.id;
          };

          if (!torrentId) {
            torrentId = await addNewMagnet();
          }
          
          setStatusText("Waiting for file readiness (Real Debrid)...");
          let isPolling = true;
          let delay = 0;
          let hasRetriedAfterError = false;
          const startTime = Date.now();
          const MAX_POLL_TIME = 10 * 60 * 1000; // 10 minutes

          while (isPolling && !isCancelled) {
             if (Date.now() - startTime > MAX_POLL_TIME) {
                 if (torrentId) {
                   try { await fetchWithTimeout(`/api/rd/torrents/delete/${torrentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${realDebridApiKey?.trim()}` } }); } catch(e) {}
                 }
                 throw new Error("Timeout: Real Debrid took too long to download the file.");
             }
             try {
                const infoRes = await fetchWithTimeout(`/api/rd/torrents/info/${torrentId}`, {
                   headers: { Authorization: `Bearer ${realDebridApiKey?.trim()}` }
                });
                const infoText = await infoRes.text();
                let infoData;
                try {
                    infoData = JSON.parse(infoText);
                } catch (e) {
                    if (!infoRes.ok) {
                        if (infoRes.status === 401 || infoRes.status === 403) {
                            throw new Error("Real Debrid API Key Invalid or Unauthorized.");
                        }
                        throw new Error(`Real Debrid Error ${infoRes.status}`);
                    }
                    console.warn("Transient RD error, invalid JSON", e);
                    await sleep(5000);
                    continue;
                }
                
                if (infoData.status === "waiting_files_selection") {
                    let filesToSelect = "";
                    const availableFiles = infoData.files || [];
                    const availableIds = new Set(availableFiles.map((f: any) => String(f.id)));

                    if (rdCachedVariant) {
                        const variantKeys = Object.keys(rdCachedVariant).filter(k => availableIds.has(String(k)));
                        if (variantKeys.length > 0) {
                            filesToSelect = variantKeys.join(',');
                        }
                    } 
                    
                    if (!filesToSelect) {
                        const videoFiles = availableFiles.filter((f: any) => isVideo(f.path));
                        let bestFile = null;
                        if (videoFiles.length > 0) {
                            bestFile = getBestFile(videoFiles, itemTitle, itemActors, itemTags);
                        } else if (availableFiles.length > 0) {
                            bestFile = availableFiles[0];
                        }
                        
                        if (bestFile) {
                            filesToSelect = String(bestFile.id);
                        } else {
                            filesToSelect = "all";
                        }
                    }
                    
                    const selForm = new URLSearchParams();
                    selForm.append("files", filesToSelect);
                    const selRes = await fetchWithTimeout(`/api/rd/torrents/selectFiles/${torrentId}`, {
                        method: "POST",
                        headers: { 
                            Authorization: `Bearer ${realDebridApiKey?.trim()}`,
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        body: selForm
                    });
                    if (!selRes.ok) {
                        isPolling = false;
                        throw new Error(`Failed to select files in Real Debrid. (Status: ${selRes.status})`);
                    }
                    delay = 500;
                } else if (infoData.status === "downloaded") {
                    isPolling = false;
                    setStatusText("Generating streaming link...");
                    
                    let link = infoData.links && infoData.links[0]; 
                    if (infoData.files && infoData.files.length > 0) {
                        const selectedFiles = infoData.files.filter((f: any) => f.selected === 1);
                        const videoFiles = selectedFiles.filter((f: any) => isVideo(f.path));
                        let bestFile = null;
                        if (videoFiles.length > 0) {
                            bestFile = getBestFile(videoFiles, itemTitle, itemActors, itemTags);
                        } else if (selectedFiles.length > 0) {
                            bestFile = selectedFiles[0];
                        }
                        if (bestFile) {
                            const bestIndex = selectedFiles.findIndex((f: any) => f.id === bestFile.id);
                            if (bestIndex !== -1 && infoData.links && infoData.links[bestIndex]) {
                                link = infoData.links[bestIndex];
                            }
                        }
                    }
                    if (!link) throw new Error("No download links available from Real Debrid");

                    const unrestrictForm = new URLSearchParams();
                    unrestrictForm.append("link", link);
                    const unres = await fetchWithTimeout(`/api/rd/unrestrict/link`, {
                        method: "POST",
                        headers: { 
                            Authorization: `Bearer ${realDebridApiKey?.trim()}`,
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        body: unrestrictForm
                    });
                    
                    const unresText = await unres.text();
                    let unresData: any = {};
                    try { unresData = JSON.parse(unresText); } catch(e) {}
                    
                    if (unresData.download) {
                        setStreamUrl(unresData.download);
                        setLoading(false);
                    } else {
                        const errMsg = unresData.error || unresData.error_code || `Could not Unrestrict link in Real Debrid (Status: ${unres.status})`;
                        throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
                    }
                } else if (["magnet_error", "virus", "error", "dead"].includes(infoData.status)) {
                    try { 
                      await fetchWithTimeout(`/api/rd/torrents/delete/${torrentId}`, { 
                        method: "DELETE", 
                        headers: { Authorization: `Bearer ${realDebridApiKey?.trim()}` } 
                      }); 
                    } catch(e) {}
                    
                    if (!hasRetriedAfterError) {
                        hasRetriedAfterError = true;
                        console.warn(`RD torrent status was '${infoData.status}'. Retrying with fresh add...`);
                        setStatusText("Retrying on Real Debrid...");
                        await sleep(1500);
                        torrentId = await addNewMagnet();
                        delay = 1000;
                        continue;
                    }

                    isPolling = false;
                    throw new Error(`Failed to download on Real Debrid (Status: ${infoData.status} - torrent may be dead or missing active seeders)`);
                } else if (["magnet_conversion", "queued", "compressing", "uploading"].includes(infoData.status)) {
                    setStatusText(`Processing... (${infoData.status})`);
                    delay = Math.max(5000, delay);
                } else {
                    const progressTxt = typeof infoData.progress === 'number' ? ` ${infoData.progress}%` : '';
                    setStatusText(`Downloading... (${infoData.status})${progressTxt}`);
                    delay = Math.max(5000, delay);
                }
             } catch(pollErr: any) {
                 if (pollErr.name === 'AbortError') break;
                 const msg = pollErr?.message || String(pollErr);
                 if (msg.includes("Request timed out") || msg.toLowerCase().includes("fetch") || msg.includes("Network Error")) {
                     console.warn("RD Network/Timeout error, retrying...", pollErr);
                     setStatusText("Network issue, retrying poll...");
                 } else {
                     isPolling = false;
                     throw pollErr;
                 }
             }
             if (isPolling) {
                await sleep(delay);
             }
          }
        };

        // Priority: Cached provider -> Real Debrid (if configured) -> Torbox
        const providerToUse = cachedProvider || (realDebridApiKey?.trim() ? 'rd' : 'torbox');

        if (providerToUse === 'torbox') {
          await resolveWithTorbox();
        } else {
          try {
            await resolveWithRealDebrid();
          } catch (rdErr: any) {
            // If Real Debrid fails and Torbox is available, fall back to Torbox!
            if (torboxApiKey?.trim()) {
              console.warn("Real Debrid failed, falling back to Torbox...", rdErr);
              setStatusText("Real Debrid unavailable. Trying Torbox...");
              await sleep(1000);
              await resolveWithTorbox();
            } else {
              throw rdErr;
            }
          }
        }

      } catch (err: any) {
         if (isCancelled) return;
         console.error("Stream resolution failed:", err);
         setError(err.message || "An unknown error occurred");
         setLoading(false);
      }
    };

    resolveStream();

    return () => {
      isCancelled = true;
    };
  }, [magnet, torboxApiKey, realDebridApiKey, retryTrigger]);

  return (
    <div 
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute inset-0 z-[50] flex flex-col justify-end overflow-hidden"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <style>{`
        /* Custom Artplayer UI styling for popup menus */
        .artplayer-app {
          background-color: transparent !important;
        }
        .art-video-player {
          background-color: transparent !important;
        }
        .art-video-player video {
          object-position: center !important;
        }
        .art-selector-list {
           background: rgba(20, 20, 20, 0.9) !important;
           backdrop-filter: blur(8px) !important;
           border-radius: 8px !important;
           border: 1px solid rgba(255,255,255,0.1) !important;
           box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important;
           animation: art-scale-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
           transform-origin: bottom center;
           padding: 4px !important;
        }
        .art-selector-list .art-selector-item {
           border-radius: 6px !important;
           margin: 2px !important;
           transition: background 0.2s;
           font-weight: 500 !important;
           font-size: 13px !important;
        }
        .art-selector-list .art-selector-item:hover {
           background: rgba(255,255,255,0.15) !important;
           color: white !important;
        }
        @keyframes art-scale-up {
           0% { transform: scale(0.95) translateY(10px); opacity: 0; }
           100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        /* Copied copy-link and open-external control custom styles */
        .art-control-copy {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 100%;
          cursor: pointer;
        }
        /* Override Artplayer's global styling rules that force fills on control bar SVGs */
        .art-control-copy svg,
        .art-control-open svg,
        .art-control-copy svg *,
        .art-control-open svg * {
          fill: none !important;
          stroke-linecap: round !important;
          stroke-linejoin: round !important;
        }
        .art-control-copy .copy-icon svg,
        .art-control-open svg {
          stroke: currentColor !important;
        }
        .art-control-copy .check-icon svg {
          stroke: #10b981 !important;
        }
        .art-control-copy .copy-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .art-control-copy .check-icon {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          transform: scale(0.5);
          opacity: 0;
          pointer-events: none;
        }
        .art-control-copy.copied .copy-icon {
          transform: scale(0.3) rotate(90deg);
          opacity: 0;
        }
        .art-control-copy.copied .check-icon {
          transform: scale(1);
          opacity: 1;
        }
        .art-control-open {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 100%;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .art-control-open:active {
          transform: scale(0.85);
        }
      `}</style>

      <div className="relative w-full max-h-full aspect-video flex flex-col items-center justify-center shadow-2xl" style={{ backgroundColor: 'var(--bg)' }}>
        <div className={`absolute top-4 right-4 z-[160] transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-10 h-10 bg-black/60 hover:bg-black/80 border border-white/10 rounded-full flex items-center justify-center text-white transition-colors duration-300 shadow"
            title="Close Player"
          >
            <Icons.X size={20} />
          </button>
        </div>

        {loading && (
          <div className="flex flex-col items-center gap-3 text-white max-w-[80%] text-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shadow-[0_0_10px_var(--accent)]" />
            <div className="text-xs font-medium tracking-wide animate-pulse">{statusText}</div>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-4 bg-neutral-900/95 border border-white/10 p-6 rounded-2xl max-w-[90%] md:max-w-md text-center shadow-2xl text-white scale-90">
            <div className="w-12 h-12 bg-rose-500/20 rounded-full flex items-center justify-center text-rose-500 mx-auto">
              <Icons.AlertTriangle size={24} />
            </div>
            <div className="font-bold text-[15px] text-rose-400">Stream playback failed</div>
            <p className="text-[12px] text-gray-300 leading-relaxed break-words">{error}</p>
            
            <div className="w-full mt-2 flex flex-col gap-2.5">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setRetryTrigger(prev => prev + 1);
                }}
                className="w-full py-2.5 px-4 bg-[var(--accent)] hover:opacity-90 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[var(--accent)]/20"
              >
                <Icons.Refresh size={14} />
                <span>Retry Stream</span>
              </motion.button>

              {streamUrl && (
                <div className="w-full space-y-2 pt-2">
                  <div className="flex items-center bg-black/40 rounded-lg p-2 border border-white/10">
                    <input 
                      type="text" 
                      readOnly 
                      value={streamUrl} 
                      className="bg-transparent flex-1 text-[11px] text-gray-300 outline-none px-2 font-mono whitespace-nowrap overflow-hidden text-ellipsis"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCopy}
                    className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                  >
                    {copied ? (
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-emerald-400 flex items-center gap-2 justify-center">
                        <Icons.Check />
                        <span>Copied!</span>
                      </motion.div>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                        <span>Copy link</span>
                      </>
                    )}
                  </motion.button>
                </div>
              )}
            </div>
          </div>
        )}

        {streamUrl && !loading && !error && (
          <div 
            ref={containerRef}
            className="absolute inset-0 w-full h-full flex items-center justify-center [&>.artplayer-app]:w-full [&>.artplayer-app]:h-full"
          />
        )}
      </div>
    </div>
  );
};
