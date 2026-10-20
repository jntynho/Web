// Disable SSL certificate rejection for adult scrape targets with expired certificates (e.g. viper.to)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createProxyMiddleware } from 'http-proxy-middleware';
// @ts-ignore
import cloudscraper from 'cloudscraper';
import * as cheerio from 'cheerio';
import https from 'https';
import http from 'http';
import axios from 'axios';
import { Readable } from 'stream';
import { GoogleGenAI } from '@google/genai';
import { extractJavCode, parseAndFormatVtt } from './utils/javSubtitles';

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 1000,
});

// Cache for AI translated Arabic subtitles
const subtitleTranslationCache = new Map<string, string>();

// Cache for JAV Subtitlecat search and converted VTT content
const javSubtitleSearchCache = new Map<string, any>();
const javSubtitleVttCache = new Map<string, string>();

// High-speed in-memory caches for Eporner extraction and file sizes
const epornerExtractCache = new Map<string, { data: any; expiresAt: number }>();
const epornerSizeCache = new Map<string, number>();

// High-speed in-memory caches for Video Resolver (Pornhub) extraction and file sizes
const pornhubExtractCache = new Map<string, { data: any; expiresAt: number }>();
const pornhubSizeCache = new Map<string, number>();

// High-speed in-memory caches for Video Resolver (xHamster) extraction and file sizes
const xhamsterExtractCache = new Map<string, { data: any; expiresAt: number }>();
const xhamsterSizeCache = new Map<string, number>();

function encodeEpornerHash(rawHash: string): string {
  if (!rawHash || rawHash.length !== 32) return rawHash;
  try {
    return parseInt(rawHash.substring(0, 8), 16).toString(36) +
           parseInt(rawHash.substring(8, 16), 16).toString(36) +
           parseInt(rawHash.substring(16, 24), 16).toString(36) +
           parseInt(rawHash.substring(24, 32), 16).toString(36);
  } catch (e) {
    return rawHash;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Dedicated endpoint for requestdl to avoid browser redirect/CORS issues
  app.get('/api/torbox-dl', async (req, res) => {
    const { torrent_id, file_id } = req.query;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    
    if (!token) {
      return res.status(401).json({ success: false, detail: "Missing token" });
    }

    try {
      const response = await fetch(`https://api.torbox.app/v1/api/torrents/requestdl?token=${token}&torrent_id=${torrent_id}&file_id=${file_id}&zip_link=false`, {
        headers: { 'Authorization': `Bearer ${token}` },
        redirect: 'manual'
      });
      
      // If Torbox returns a direct redirect
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          return res.json({ success: true, data: location });
        }
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('video/') || contentType.includes('application/octet-stream')) {
         return res.status(500).json({ success: false, detail: "Torbox returned a direct file stream, which is not supported by this proxy endpoint." });
      }
      
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        return res.json(json);
      } catch (e) {
        return res.status(500).json({ success: false, detail: "Invalid response from Torbox", raw: text });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, detail: error.message });
    }
  });

  // Proxy to Torbox API to bypass CORS
  app.use('/api/torbox', createProxyMiddleware({
    target: 'https://api.torbox.app/v1/api',
    changeOrigin: true,
    agent: keepAliveAgent,
    pathRewrite: {
      '^/api/torbox': '', 
    }
  }));

  // Proxy to Real Debrid API to bypass CORS
  app.use('/api/rd', createProxyMiddleware({
    target: 'https://api.real-debrid.com/rest/1.0',
    changeOrigin: true,
    agent: keepAliveAgent,
    pathRewrite: {
      '^/api/rd': '', 
    }
  }));

  app.post('/api/search/sukebei-smart', express.json(), async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: 'Missing query parameter' });

      // Use cloudscraper to bypass Cloudflare if present, or just normal fetch
      // We will try fetch first, fallback to cloudscraper if needed. Actually we already have cloudscraper from xxxclub!
      const searchUrl = `https://sukebei.nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=downloads&o=desc`;
      
      let html = "";
      try {
        // @ts-ignore
        html = await cloudscraper.get({
          url: searchUrl,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
      } catch (e: any) {
         return res.status(500).json({ error: 'Sukebei blocked the request (Cloudflare) or failed: ' + e.message });
      }

      const $ = cheerio.load(html);
      
      let hdMagnet = null;
      let hdUrl = null;
      let k4Magnet = null;
      let k4Url = null;
      let fallbackMagnet = null;
      let fallbackUrl = null;

      $('tr').each((i, el) => {
        const titleEl = $(el).find('td[colspan="2"] a:not(.comments)');
        const title = titleEl.text().trim() || titleEl.attr('title') || '';
        const magnetEl = $(el).find('td a[href^="magnet:"]');
        const magnet = magnetEl.attr('href') || '';
        const viewUrl = 'https://sukebei.nyaa.si' + (titleEl.attr('href') || '');

        if (!title || !magnet) return;
        // Verify valid magnet URI with BTIH hash
        if (!/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.test(magnet)) return;

        if (!fallbackMagnet) {
          fallbackMagnet = magnet;
          fallbackUrl = viewUrl;
        }

        const titleUpper = title.toUpperCase();
        
        if (titleUpper.includes('VP9')) return; // Ignore VP9 codec files
        
        if (!k4Magnet && (titleUpper.includes('4K') || titleUpper.includes('2160P'))) {
          k4Magnet = magnet;
          k4Url = viewUrl;
        }
        
        if (!hdMagnet && (titleUpper.includes('FHD') || titleUpper.includes('1080P') || titleUpper.includes('HD'))) {
          hdMagnet = magnet;
          hdUrl = viewUrl;
        }
      });

      if (!hdMagnet && fallbackMagnet) {
        hdMagnet = fallbackMagnet;
        hdUrl = fallbackUrl;
      }

      res.json({
        magnet1080p: hdMagnet,
        url1080p: hdUrl,
        magnet2160p: k4Magnet,
        url2160p: k4Url
      });
    } catch (e: any) {
      console.error('Sukebei Search Error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  const xxxClubHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  async function fetchXxxClubHtml(url: string, timeoutMs: number = 3500): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: xxxClubHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        if (text && !text.includes('Just a moment...') && !text.includes('cf-browser-verification')) {
          return text;
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }

    // Fallback to cloudscraper if direct fetch was blocked or timed out
    try {
      // @ts-ignore
      return await cloudscraper.get({
        url,
        headers: { 'User-Agent': xxxClubHeaders['User-Agent'] },
        timeout: 5000
      });
    } catch (scrapeErr: any) {
      throw new Error(`Failed to fetch XXXClub page (${url}): ${scrapeErr.message}`);
    }
  }

  app.post('/api/search/xxxclub-smart', express.json(), async (req, res) => {
    try {
      const { query, queries, date, dateStr, targetDateMs, actors, studios, actor, studio, title: inputTitle } = req.body;
      const rawQueryList: string[] = Array.isArray(queries) && queries.length > 0 
        ? queries.filter((q: any) => typeof q === 'string' && q.trim().length > 0)
        : (query ? [query] : []);

      // Studio Alias Mapping: If Scoreland is present, search with PornMegaLoad instead
      const queryList: string[] = rawQueryList.map((q: string) => 
        q.replace(/\bscore\s*land\b/gi, 'PornMegaLoad').replace(/\bscoreland\b/gi, 'PornMegaLoad')
      );

      if (queryList.length === 0) {
        return res.status(400).json({ error: 'Missing query or queries parameter' });
      }

      console.log('XXXCLUB SMART SEARCH Queries:', queryList);

      // Generic stop words that must not be considered unique anchors on their own
      const GENERIC_TERMS = new Set([
        'pov', 'vr', 'scene', 'episode', 'part', 'compilation', 'special', 'massage', 'casting',
        'interview', 'amateur', 'solo', 'hardcore', 'anal', 'blowjob', 'creampie', 'squirt',
        'threesome', 'interracial', 'lesbian', 'milf', 'teen', 'stepmom', 'stepsister', 'stepdaughter',
        'video', 'clip', 'trailer', 'bonus', 'xxx', 'mp4', 'mkv', 'uhd', '4k', '1080p', '2160p',
        'friends', 'vol', 'volume', 'edition', 'series', 'update', 'exclusive'
      ]);

      // Normalize string helper
      const normalizeText = (s: string) => 
        (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      // Collect raw provided actors and studios as mandatory anchors
      const rawActorsList: string[] = [
        ...(Array.isArray(actors) ? actors : (actor ? [actor] : []))
      ].filter((a: any) => typeof a === 'string' && a.trim().length > 1);

      const rawStudiosList: string[] = [
        ...(Array.isArray(studios) ? studios : (studio ? [studio] : []))
      ]
        .filter((s: any) => typeof s === 'string' && s.trim().length > 1)
        .map((s: string) => {
          const lower = s.toLowerCase().trim();
          if (lower.includes('scoreland') || lower.includes('score land')) {
            return 'PornMegaLoad';
          }
          return s;
        });

      // Build studio anchor tokens
      const studioAnchorTokens: string[] = [];
      for (const st of rawStudiosList) {
        const clean = normalizeText(st).trim();
        if (!clean) continue;
        studioAnchorTokens.push(clean);
        const compact = clean.replace(/[^a-z0-9]/g, '');
        if (compact.length >= 3) studioAnchorTokens.push(compact);

        // Remove corporate or channel suffixes
        const stripped = clean.replace(/(?:\s|-)*(?:vip|network|premium|plus|media|entertainment|films|studios|studio|site|productions)$/i, '').trim();
        if (stripped.length >= 3) {
          studioAnchorTokens.push(stripped);
          const strippedCompact = stripped.replace(/[^a-z0-9]/g, '');
          if (strippedCompact.length >= 3) studioAnchorTokens.push(strippedCompact);
        }
      }
      const uniqueStudioAnchors = [...new Set(studioAnchorTokens)];

      // Build actor anchor tokens
      const actorAnchorObjects: { full: string; compact: string; parts: string[] }[] = [];
      for (const act of rawActorsList) {
        const clean = normalizeText(act).trim();
        if (!clean) continue;
        const compact = clean.replace(/[^a-z0-9]/g, '');
        const parts = clean.split(/[^a-z0-9]+/).filter(p => p.length >= 3 && !GENERIC_TERMS.has(p));
        actorAnchorObjects.push({ full: clean, compact, parts });
      }

      console.log('XXXClub Anchors - Studios:', uniqueStudioAnchors, 'Actors:', actorAnchorObjects.map(a => a.full));

      // Build exhaustive date matching patterns
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const fullMonthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const targetDatePatterns: string[] = [];

      const addDateVariants = (yyyy: string, yy: string, mm: string, dd: string) => {
        if (!yy || !mm || !dd) return;
        const dNum = String(parseInt(dd, 10));
        const mIdx = parseInt(mm, 10) - 1;
        const mShort = monthNames[mIdx] || '';
        const mFull = fullMonthNames[mIdx] || '';

        const list = [
          `${yy} ${mm} ${dd}`,
          `${yy}.${mm}.${dd}`,
          `${yy}-${mm}-${dd}`,
          `${yy}${mm}${dd}`,
          `${yyyy}.${mm}.${dd}`,
          `${yyyy}-${mm}-${dd}`,
          `${yyyy} ${mm} ${dd}`,
          `${dd}.${mm}.${yyyy}`,
          `${dd}-${mm}-${yyyy}`,
          `${dd} ${mm} ${yyyy}`,
          `${dd}.${mm}.${yy}`,
          `${dd}-${mm}-${yy}`,
          `${dd} ${mm} ${yy}`,
          `${mm}.${dd}.${yyyy}`,
          `${mm}-${dd}-${yyyy}`,
          `${mm}.${dd}.${yy}`,
          `${mm}-${dd}-${yy}`,
          `${mShort} ${dd} ${yyyy}`,
          `${mShort} ${dNum} ${yyyy}`,
          `${dd} ${mShort} ${yyyy}`,
          `${dNum} ${mShort} ${yyyy}`,
          `${mShort} ${dd} ${yy}`,
          `${mShort} ${dNum} ${yy}`,
          `${mShort} ${dd}`,
          `${mShort} ${dNum}`,
          `${dd} ${mShort}`,
          `${dNum} ${mShort}`
        ];
        if (mFull) {
          list.push(`${mFull} ${dd} ${yyyy}`, `${mFull} ${dNum} ${yyyy}`, `${dd} ${mFull} ${yyyy}`, `${dNum} ${mFull} ${yyyy}`);
        }
        for (const item of list) {
          if (!targetDatePatterns.includes(item)) targetDatePatterns.push(item);
        }
      };

      if (date && typeof date === 'string') {
        const match = date.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (match) {
          const yyyy = match[1];
          const yy = yyyy.slice(-2);
          const mm = match[2].padStart(2, '0');
          const dd = match[3].padStart(2, '0');
          addDateVariants(yyyy, yy, mm, dd);
        }
      }

      if (dateStr && typeof dateStr === 'string') {
        const parts = dateStr.trim().split(/\s+/);
        if (parts.length === 3) {
          const rawYy = parts[0].padStart(2, '0');
          const yyyy = rawYy.length === 2 ? (parseInt(rawYy, 10) > 50 ? '19' + rawYy : '20' + rawYy) : rawYy;
          const yy = yyyy.slice(-2);
          const mm = parts[1].padStart(2, '0');
          const dd = parts[2].padStart(2, '0');
          addDateVariants(yyyy, yy, mm, dd);
        }
      }

      const effectiveDateMs = typeof targetDateMs === 'number' ? targetDateMs : (typeof date === 'number' ? date : undefined);
      if (effectiveDateMs) {
        const d = new Date(effectiveDateMs);
        if (!isNaN(d.getTime())) {
          // UTC
          const utcYyyy = String(d.getUTCFullYear());
          const utcYy = utcYyyy.slice(-2);
          const utcMm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const utcDd = String(d.getUTCDate()).padStart(2, '0');
          addDateVariants(utcYyyy, utcYy, utcMm, utcDd);

          // Local
          const locYyyy = String(d.getFullYear());
          const locYy = locYyyy.slice(-2);
          const locMm = String(d.getMonth() + 1).padStart(2, '0');
          const locDd = String(d.getDate()).padStart(2, '0');
          addDateVariants(locYyyy, locYy, locMm, locDd);
        }
      }

      let matchedQuery = '';
      let link1080p = '';
      let link2160p = '';
      let magnet1080p = '';
      let magnet2160p = '';

      // Helper function to evaluate search page HTML and return candidates + embedded magnets
      const evaluateItems = (
        html: string,
        searchQ: string,
        existingBest?: {
          candidate1080p?: string;
          candidate2160p?: string;
          embeddedMag1080?: string;
          embeddedMag2160?: string;
          best1080pScore?: number;
          best2160pScore?: number;
          fallbackCandidate?: string;
          bestFallbackScore?: number;
        }
      ) => {
        const $ = cheerio.load(html);
        const queryTerms = searchQ.toLowerCase().split(/\s+/).filter(Boolean);
        let best1080pScore = existingBest?.best1080pScore ?? -1;
        let best2160pScore = existingBest?.best2160pScore ?? -1;
        let bestFallbackScore = existingBest?.bestFallbackScore ?? -1;
        let candidate1080p = existingBest?.candidate1080p || '';
        let candidate2160p = existingBest?.candidate2160p || '';
        let fallbackCandidate = existingBest?.fallbackCandidate || '';
        let embeddedMag1080 = existingBest?.embeddedMag1080 || '';
        let embeddedMag2160 = existingBest?.embeddedMag2160 || '';

        $('ul.tsearch > li').each((_, li) => {
          const aTag = $(li).find('a[href^="/torrents/details/"]');
          if (!aTag.length) return;

          const title = aTag.text().toLowerCase();
          const href = aTag.attr('href');
          if (!href) return;

          if (title.includes('vp9')) return; // Ignore VP9 codec files

          // Strict date enforcement
          if (targetDatePatterns.length > 0) {
            const hasExactDate = targetDatePatterns.some(p => title.includes(p));
            if (!hasExactDate) return;
          }

          // Quality filters: Discard 480p, 720p, SD
          if (title.includes('480p') || title.includes('720p') || title.includes(' sd ') || title.includes('-sd') || title.match(/\bsd\b/)) {
            return;
          }

          const is4k = title.includes('2160p') || title.includes('4k') || title.includes('uhd');
          const is1080p = title.includes('1080p') || title.includes('fullhd') || title.includes('full hd') || title.includes('1080');

          if (!is4k && !is1080p) return;

          // MANDATORY ANCHOR VERIFICATION:
          // If studios or actors are specified, require at least one studio OR actor match in the torrent title.
          const normTitle = normalizeText(title);
          const compactTitle = normTitle.replace(/[^a-z0-9]/g, '');
          const wordsTitle = normTitle.replace(/[^a-z0-9]+/g, ' ');

          let hasStudioAnchor = false;
          let hasActorAnchor = false;

          if (uniqueStudioAnchors.length > 0) {
            for (const stToken of uniqueStudioAnchors) {
              const compactSt = stToken.replace(/[^a-z0-9]/g, '');
              if (compactTitle.includes(compactSt) || wordsTitle.includes(` ${stToken} `) || wordsTitle.startsWith(`${stToken} `) || wordsTitle.endsWith(` ${stToken}`)) {
                hasStudioAnchor = true;
                break;
              }
            }
          }

          if (actorAnchorObjects.length > 0) {
            for (const actObj of actorAnchorObjects) {
              if (actObj.compact.length >= 5 && compactTitle.includes(actObj.compact)) {
                hasActorAnchor = true;
                break;
              }
              const matchedParts = actObj.parts.filter(p => {
                const reg = new RegExp(`\\b${p}\\b`, 'i');
                return reg.test(normTitle);
              });
              if (matchedParts.length >= 2 || (matchedParts.length === 1 && matchedParts[0].length >= 4)) {
                hasActorAnchor = true;
                break;
              }
            }
          }

          // If anchors were provided, and neither studio nor actor matched -> REJECT!
          if (uniqueStudioAnchors.length > 0 || actorAnchorObjects.length > 0) {
            if (!hasStudioAnchor && !hasActorAnchor) {
              return;
            }
          } else {
            // No studio or actor anchors provided in request. Check if searchQ is purely generic.
            const meaningfulTerms = queryTerms.filter(t => !GENERIC_TERMS.has(t) && !t.match(/^\d+$/));
            if (meaningfulTerms.length === 0) {
              // The search query had NO distinctive words (e.g. only "POV" + numbers).
              // Do NOT accept candidates blindly without at least one non-generic word match!
              return;
            }
          }

          let matchCount = 0;
          for (const term of queryTerms) {
            if (title.includes(term)) matchCount++;
          }
          if (hasStudioAnchor) matchCount += 15;
          if (hasActorAnchor) matchCount += 15;

          const fullHref = href.startsWith('http') ? href : `https://xxxclub.to${href}`;
          const embeddedMag = $(li).find('a[href^="magnet:"]').attr('href') || '';

          if (is4k && matchCount > best2160pScore) {
            candidate2160p = fullHref;
            if (embeddedMag) embeddedMag2160 = embeddedMag;
            best2160pScore = matchCount;
          } else if (is1080p && matchCount > best1080pScore) {
            candidate1080p = fullHref;
            if (embeddedMag) embeddedMag1080 = embeddedMag;
            best1080pScore = matchCount;
          }

          if (matchCount > bestFallbackScore) {
            fallbackCandidate = fullHref;
            bestFallbackScore = matchCount;
          }
        });

        if (!candidate1080p && !candidate2160p && fallbackCandidate) {
          candidate1080p = fallbackCandidate;
        }

        return {
          candidate1080p,
          candidate2160p,
          embeddedMag1080,
          embeddedMag2160,
          best1080pScore,
          best2160pScore,
          fallbackCandidate,
          bestFallbackScore
        };
      };

      // Helper function to extract real Next Page URL (excluding honeypots)
      const extractRealNextPage = (html: string): string | null => {
        try {
          const $ = cheerio.load(html);
          let nextPage: string | null = null;
          $('a').each((_, el) => {
            const text = $(el).text().trim().toLowerCase();
            const style = $(el).attr('style') || '';
            const href = $(el).attr('href');
            if ((text.includes('next page') || text === 'next' || $(el).attr('title') === 'Next Page') && href) {
              if (!style.includes('-9999px') && !style.includes('display:none') && !style.includes('visibility:hidden')) {
                nextPage = href.startsWith('http') ? href : `https://xxxclub.to${href}`;
                return false;
              }
            }
          });
          return nextPage;
        } catch {
          return null;
        }
      };

      // Execute smart search for a single query using Category 2 (1080p) + Category 4 (4K) racing,
      // with honeypot-resistant Page 2 traversal and search/all fallback
      const searchSingleQuery = async (searchQ: string) => {
        const encQ = encodeURIComponent(searchQ);

        // 1. Race Category 2 (1080p) and Category 4 (2160p/4K) in parallel
        const [cat2Html, cat4Html] = await Promise.all([
          fetchXxxClubHtml(`https://xxxclub.to/torrents/search/2/${encQ}`, 3500).catch(() => ''),
          fetchXxxClubHtml(`https://xxxclub.to/torrents/search/4/${encQ}`, 3500).catch(() => '')
        ]);

        let state = {
          candidate1080p: '',
          candidate2160p: '',
          embeddedMag1080: '',
          embeddedMag2160: '',
          best1080pScore: -1,
          best2160pScore: -1,
          fallbackCandidate: '',
          bestFallbackScore: -1
        };

        if (cat2Html) state = evaluateItems(cat2Html, searchQ, state);
        if (cat4Html) state = evaluateItems(cat4Html, searchQ, state);

        // 2. If both found on page 1 of category search, we can proceed directly
        // If either is missing, check Page 2 of the respective category
        const need1080Page2 = !state.candidate1080p && cat2Html;
        const need2160Page2 = !state.candidate2160p && cat4Html;

        if (need1080Page2 || need2160Page2) {
          const nextCat2 = need1080Page2 ? extractRealNextPage(cat2Html) : null;
          const nextCat4 = need2160Page2 ? extractRealNextPage(cat4Html) : null;

          if (nextCat2 || nextCat4) {
            const [p2Cat2, p2Cat4] = await Promise.all([
              nextCat2 ? fetchXxxClubHtml(nextCat2, 3500).catch(() => '') : Promise.resolve(''),
              nextCat4 ? fetchXxxClubHtml(nextCat4, 3500).catch(() => '') : Promise.resolve('')
            ]);
            if (p2Cat2) state = evaluateItems(p2Cat2, searchQ, state);
            if (p2Cat4) state = evaluateItems(p2Cat4, searchQ, state);
          }
        }

        // 3. Fallback to search/all (Page 1 + Page 2) if still missing any candidate
        if (!state.candidate1080p || !state.candidate2160p) {
          const allHtml = await fetchXxxClubHtml(`https://xxxclub.to/torrents/search/all/${encQ}`, 3500).catch(() => '');
          if (allHtml) {
            state = evaluateItems(allHtml, searchQ, state);
            if (!state.candidate1080p || !state.candidate2160p) {
              const nextAll = extractRealNextPage(allHtml);
              if (nextAll) {
                const p2All = await fetchXxxClubHtml(nextAll, 3500).catch(() => '');
                if (p2All) state = evaluateItems(p2All, searchQ, state);
              }
            }
          }
        }

        return state;
      };

      // Process queries in parallel batches of 2 for fast racing
      const BATCH_SIZE = 2;
      for (let i = 0; i < queryList.length; i += BATCH_SIZE) {
        const batch = queryList.slice(i, i + BATCH_SIZE).map(q => q.trim()).filter(Boolean);
        if (batch.length === 0) continue;

        // Run smart searches for this batch concurrently
        const batchResults = await Promise.all(
          batch.map(async searchQ => {
            try {
              const evaluated = await searchSingleQuery(searchQ);
              return { searchQ, ...evaluated };
            } catch (err: any) {
              console.warn(`Query "${searchQ}" failed:`, err.message);
              return {
                searchQ,
                candidate1080p: '',
                candidate2160p: '',
                embeddedMag1080: '',
                embeddedMag2160: ''
              };
            }
          })
        );

        let matchFound = false;

        for (const item of batchResults) {
          const { candidate1080p, candidate2160p, embeddedMag1080, embeddedMag2160 } = item;

          if (candidate1080p || candidate2160p) {
            let currentMag1080 = embeddedMag1080;
            let currentMag2160 = embeddedMag2160;

            const needFetch1080 = candidate1080p && !currentMag1080;
            const needFetch2160 = candidate2160p && !currentMag2160;

            // Fetch candidate details concurrently
            if (needFetch1080 || needFetch2160) {
              const [html1080, html2160] = await Promise.all([
                needFetch1080 ? fetchXxxClubHtml(candidate1080p, 4000).catch(() => '') : Promise.resolve(''),
                needFetch2160 ? fetchXxxClubHtml(candidate2160p, 4000).catch(() => '') : Promise.resolve('')
              ]);

              if (needFetch1080 && html1080) {
                const m = html1080.match(/magnet:\?xt=urn:btih:[^"'\s<>]+/);
                if (m) currentMag1080 = m[0];
              }
              if (needFetch2160 && html2160) {
                const m = html2160.match(/magnet:\?xt=urn:btih:[^"'\s<>]+/);
                if (m) currentMag2160 = m[0];
              }
            }

            if (currentMag1080 || currentMag2160) {
              matchedQuery = item.searchQ;
              link1080p = candidate1080p;
              link2160p = candidate2160p;
              magnet1080p = currentMag1080;
              magnet2160p = currentMag2160;
              matchFound = true;
              break;
            }
          }
        }

        if (matchFound) {
          break; // Stop querying once candidate with valid magnets is secured
        }
      }

      res.json({
        magnet1080p,
        magnet2160p,
        url1080p: link1080p,
        url2160p: link2160p,
        matchedQuery
      });
    } catch (e: any) {
      console.error("Smart magnet search error:", e);
      res.status(500).json({ error: e.message || 'Internal server error' });
    }
  });

  app.post('/api/scrape/viper', express.json(), async (req, res) => {
    try {
      let { url } = req.body;
      if (!url || !url.includes('viper')) {
        return res.status(400).json({ error: 'Invalid Viper thread URL' });
      }
      
      // Fix ERR_UNESCAPED_CHARACTERS by properly encoding the URL
      try {
        url = new URL(url.trim()).href;
      } catch (e) {
        url = encodeURI(url.trim());
      }
      
      console.log(`Scraping Viper thread: ${url}`);
      // @ts-ignore
      const html = await cloudscraper.get({
        url,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      
      const $ = cheerio.load(html);
      const originalUrls: string[] = [];
      const thumbnailUrls: string[] = [];
      
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
           if (src.includes('vipr.im') && src.includes('/th/')) {
              const originalUrl = src.replace('/th/', '/i/');
              if (!originalUrls.includes(originalUrl)) {
                 originalUrls.push(originalUrl);
                 thumbnailUrls.push(src);
              }
           } else if (src.includes('imx.to') && src.includes('/u/t/')) {
              const originalUrl = src.replace('/u/t/', '/u/i/');
              if (!originalUrls.includes(originalUrl)) {
                 originalUrls.push(originalUrl);
                 thumbnailUrls.push(src);
              }
           }
        }
      });
      
      return res.json({ images: originalUrls, thumbnails: thumbnailUrls });
    } catch (err: any) {
      console.error(`Viper scraper error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to scrape Viper thread' });
    }
  });

  app.post('/api/scrape/pornhat', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || (!url.includes('pornhat.com') && !url.includes('pornstars.tube'))) {
        return res.status(400).json({ error: 'Invalid Pornhat or PornstarsTube album URL' });
      }
      
      console.log(`Scraping Pornhat/PornstarsTube album: ${url}`);
      const fetchRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      const html = await fetchRes.text();
      
      const $ = cheerio.load(html);
      const originalUrls: string[] = [];
      const thumbnailUrls: string[] = [];
      
      $('img').each((_, el) => {
        const dataOriginal = $(el).attr('data-original');
        if (dataOriginal && (dataOriginal.includes('pornhat.com') || dataOriginal.includes('pornstars.tube'))) {
          if (!originalUrls.includes(dataOriginal)) {
             originalUrls.push(dataOriginal);
             
             const src = $(el).attr('src');
             if (src && (src.includes('pornhat.com') || src.includes('pornstars.tube'))) {
                thumbnailUrls.push(src);
             } else {
                thumbnailUrls.push(dataOriginal);
             }
          }
        }
      });
      
      return res.json({ images: originalUrls, thumbnails: thumbnailUrls });
    } catch (err: any) {
      console.error(`Pornhat scraper error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to scrape Pornhat album' });
    }
  });

  app.post('/api/scrape/pornbox', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !url.includes('pornbox.com')) {
        return res.status(400).json({ error: 'Invalid PornBox URL' });
      }
      
      console.log(`Scraping PornBox gallery: ${url}`);
      
      // Extract video ID from URL
      // E.g., https://pornbox.com/application/watch-page/2089174
      const idMatch = url.match(/\/(\d+)(\?|\/|$)/);
      if (!idMatch) {
        return res.status(400).json({ error: 'Could not extract ID from PornBox URL' });
      }
      
      const videoId = idMatch[1];
      const apiUrl = `https://pornbox.com/contents/${videoId}`;
      console.log(`Fetching PornBox API: ${apiUrl}`);
      
      // Use Googlebot user-agent to bypass any potential blocks
      const fetchRes = await fetch(apiUrl, {
        headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'application/json'
        }
      });
      
      if (!fetchRes.ok) {
          throw new Error(`API returned ${fetchRes.status} ${fetchRes.statusText}`);
      }
      
      const data = await fetchRes.json();
      
      const originalUrls: string[] = [];
      const thumbnailUrls: string[] = [];
      
      // Collect from screenshots array
      if (data.screenshots && Array.isArray(data.screenshots)) {
          data.screenshots.forEach((item: any) => {
              if (item.xga_size) {
                  originalUrls.push(item.xga_size);
                  thumbnailUrls.push(item.small_thumbnail || item.xga_size);
              } else if (item.large_thumbnail) {
                  originalUrls.push(item.large_thumbnail);
                  thumbnailUrls.push(item.small_thumbnail || item.large_thumbnail);
              }
          });
      }
      
      // Collect from gallery array if available
      if (data.gallery && Array.isArray(data.gallery)) {
          data.gallery.forEach((item: any) => {
              if (item.xga_size && !originalUrls.includes(item.xga_size)) {
                  originalUrls.push(item.xga_size);
                  thumbnailUrls.push(item.small_thumbnail || item.xga_size);
              }
          });
      }
      
      if (originalUrls.length === 0) {
          // Fallback to HTML scraping just in case API fails to return images
          console.log('API returned no images, falling back to HTML scraping...');
          const htmlRes = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
          });
          const html = await htmlRes.text();
          const $ = cheerio.load(html);
          
          $('img[data-lc-href]').each((_, el) => {
             const original = $(el).attr('data-lc-href');
             const thumb = $(el).attr('src');
             if (original && !originalUrls.includes(original)) {
                 originalUrls.push(original);
                 thumbnailUrls.push(thumb || original);
             }
          });
      }
      
      return res.json({ images: originalUrls, thumbnails: thumbnailUrls });
    } catch (err: any) {
      console.error(`PornBox scraper error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to scrape PornBox gallery' });
    }
  });

  app.post('/api/scrape/freeones', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !url.includes('freeones.com')) {
        return res.status(400).json({ error: 'Invalid FreeOnes URL' });
      }
      
      console.log(`Scraping FreeOnes gallery: ${url}`);
      const fetchRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      
      if (!fetchRes.ok) {
          throw new Error(`Returned ${fetchRes.status} ${fetchRes.statusText}`);
      }
      const html = await fetchRes.text();
      
      const originalUrls: string[] = [];
      const thumbnailUrls: string[] = [];
      
      const regex = /(https:\/\/thumbs\.freeones\.com\/photo\/[^\s"']+)/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
          const imgUrl = match[1];
          if (imgUrl.includes('1440x0')) {
              if (!originalUrls.includes(imgUrl)) {
                  originalUrls.push(imgUrl);
                  const thumbUrl = imgUrl.replace('1440x0', 'fit-in/0x460/center/top/filters:upscale():quality(85)');
                  thumbnailUrls.push(thumbUrl);
              }
          }
      }
      
      return res.json({ images: originalUrls, thumbnails: thumbnailUrls });
    } catch (err: any) {
      console.error(`FreeOnes scraper error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to scrape FreeOnes gallery' });
    }
  });

  app.post('/api/scrape/goonbox', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !url.includes('goonbox.cr/a/')) {
        return res.status(400).json({ error: 'Invalid GoonBox URL' });
      }
      
      console.log(`Scraping GoonBox gallery: ${url}`);
      
      const idMatch = url.match(/\/a\/([a-zA-Z0-9_-]+)/);
      if (!idMatch) {
        return res.status(400).json({ error: 'Could not extract ID from GoonBox URL' });
      }
      const albumId = idMatch[1];
      
      let allImages: any[] = [];
      
      const firstPageRes = await fetch(`https://goonbox.cr/api/albums/${albumId}?page=1`, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (!firstPageRes.ok) {
          throw new Error(`API returned ${firstPageRes.status} ${firstPageRes.statusText}`);
      }
      
      const firstPageData = await firstPageRes.json();
      allImages = allImages.concat(firstPageData.images);
      
      const lastPage = firstPageData.pagination.last_page;
      
      if (lastPage > 1) {
          console.log(`Fetching remaining ${lastPage - 1} pages...`);
          const promises = [];
          for (let p = 2; p <= lastPage; p++) {
              promises.push(fetch(`https://goonbox.cr/api/albums/${albumId}?page=${p}`, {
                  headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
              }).then(r => r.json()));
          }
          
          const results = await Promise.all(promises);
          for (const data of results) {
              if (data && data.images) {
                  allImages = allImages.concat(data.images);
              }
          }
      }
      
      // Sort by created_at ascending (oldest first - upload order)
      allImages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      const originalUrls = allImages.map(img => img.original_url).filter(Boolean);
      const thumbnailUrls = allImages.map(img => img.medium_url || img.thumb_url || img.original_url).filter(Boolean);
      
      return res.json({ success: true, images: originalUrls, thumbnails: thumbnailUrls, count: originalUrls.length });
    } catch (err: any) {
      console.error(`GoonBox scraper error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to scrape GoonBox gallery' });
    }
  });

  app.post('/api/scrape/adultphotosets', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'Missing URL' });
      
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': 'https://adultphotosets.best/'
        }
      });
      
      if (!pageRes.ok) {
        throw new Error(`Target page returned ${pageRes.status}`);
      }
      
      const html = await pageRes.text();
      const $ = cheerio.load(html);
      
      const originalUrls: string[] = [];
      const thumbUrls: string[] = [];
      const seen = new Set<string>();
      
      $("img").each((_, el) => {
        const rawSrc = ($(el).attr("data-src") || $(el).attr("src") || "").trim();
        const parentHref = ($(el).parent("a").attr("href") || "").trim();
        
        // Exclude system / template assets
        if (!rawSrc && !parentHref) return;
        if (rawSrc.includes("counter.yadro.ru") || rawSrc.includes("captcha") || rawSrc.includes("logo") || rawSrc.includes("icon")) return;
        
        // Ignore internal blog uploads, screenshots, and cover teasers
        if (rawSrc.includes("/uploads/") || parentHref.includes("/uploads/")) return;
        
        // Check if this image belongs to a photo gallery host or anchor
        const isGalleryHost = /(pixhost\.(to|icu)|imx\.to|imgbox\.com|imagebam\.com|vipr\.im|postimg\.cc|turboimagehost\.com|fastpic\.(org|ru|net)|imagetwist\.com|acidimg\.cc|pimpandhost\.com)/i.test(rawSrc) ||
                              /(pixhost\.(to|icu)|imx\.to|imgbox\.com|imagebam\.com|vipr\.im|postimg\.cc|turboimagehost\.com|fastpic\.(org|ru|net)|imagetwist\.com|acidimg\.cc|pimpandhost\.com)/i.test(parentHref);
        
        if (!isGalleryHost) return;
        
        let hd = "";
        let thumb = rawSrc;
        
        if (rawSrc.includes("pixhost")) {
          hd = rawSrc.replace(/\/\/t(\d*)\.pixhost\.(to|icu)\/thumbs\//, "//img$1.pixhost.$2/images/");
          if (!thumb) thumb = rawSrc;
        } else if (parentHref.includes("pixhost") && parentHref.includes("/show/")) {
          hd = parentHref.replace("/show/", "/images/").replace(/pixhost\.(to|icu)/, "img.pixhost.$1");
          if (!thumb) thumb = rawSrc || parentHref;
        } else if (rawSrc.includes("imx.to")) {
          hd = rawSrc.replace("/u/t/", "/u/i/").replace("/t/", "/i/");
          if (!thumb) thumb = rawSrc;
        } else if (parentHref.includes("imx.to")) {
          if (rawSrc) {
            hd = rawSrc.replace("/u/t/", "/u/i/").replace("/t/", "/i/");
            thumb = rawSrc;
          } else {
            hd = parentHref;
            thumb = parentHref;
          }
        } else if (rawSrc.includes("vipr.im")) {
          hd = rawSrc.replace("/th/", "/i/");
        } else if (rawSrc.includes("imgbox.com")) {
          hd = rawSrc.replace("thumbs", "images").replace("_t.", "_o.");
        } else if (rawSrc.includes("turboimagehost.com")) {
          hd = rawSrc.replace("/t/", "/p/");
        } else if (rawSrc.includes("postimg.cc")) {
          hd = rawSrc.replace("t.postimg.cc/", "i.postimg.cc/");
        } else if (parentHref && (parentHref.includes("imgbox.com") || parentHref.includes("imagebam.com") || parentHref.includes("postimg.cc"))) {
          hd = parentHref;
          thumb = rawSrc || parentHref;
        } else {
          hd = rawSrc || parentHref;
          thumb = rawSrc || parentHref;
        }
        
        if (hd && !seen.has(hd)) {
          seen.add(hd);
          originalUrls.push(hd);
          thumbUrls.push(thumb || hd);
        }
      });
      
      return res.json({
        success: true,
        images: originalUrls,
        thumbnails: thumbUrls,
        count: originalUrls.length
      });
    } catch (err: any) {
      console.error(`AdultPhotoSets scraper error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to scrape AdultPhotoSets gallery' });
    }
  });

  app.post('/api/extract/xxxclub', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'Missing url parameter' });
      
      const html = await fetchXxxClubHtml(url, 4500);
      if (!html) return res.status(502).json({ error: 'Failed to access url' });
      
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      let title = titleMatch ? titleMatch[1].replace(/ - XXXCLUB(.*?)$/i, '').trim() : '';
      if (!title) {
        const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/);
        if (h1Match) title = h1Match[1].trim();
      }
      
      const magnetMatch = html.match(/magnet:\?xt=urn:btih:[^"'\s<>]+/);
      const magnet = magnetMatch ? magnetMatch[0] : '';

      // Helper function to smart-standardize date format to 'YY MM DD'
      const standardizeDateString = (dateStr: string): string => {
        const parts = dateStr.trim().split(/\s+/);
        if (parts.length !== 3) return dateStr;
        const p1 = parseInt(parts[0], 10);
        const p2 = parseInt(parts[1], 10);
        const p3 = parseInt(parts[2], 10);
        if (isNaN(p1) || isNaN(p2) || isNaN(p3)) return dateStr;

        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(p1)} ${pad(p2)} ${pad(p3)}`;
      };

      // Fallback local parsing
      let parsedData: { tag: string; date: string; actors: string[]; quality: string } | null = null;
      const partsRegex = /^([a-zA-Z0-9\s\-]+?)\s+(\d{2}\s\d{2}\s\d{2})\s+([\s\S]+?)(?:\s+XXX|\s+\d{3,4}p|\s+4K|\s+8K)/i;
      const match = title.match(partsRegex);
      if (match) {
        let tag = match[1].trim();
        let dateVal = match[2].trim();
        dateVal = standardizeDateString(dateVal);
        const qualityRegex = /(\d{3,4}p|4K|8K|2160p)/i;
        const qualityMatch = title.match(qualityRegex);
        const quality = qualityMatch ? qualityMatch[1].trim() : '';

        parsedData = { tag, date: dateVal, actors: [], quality };
      }

      res.json({ title, magnet, parsed: parsedData });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/scrape/javtrailers-gallery', express.json(), async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Missing code parameter' });
      
      const match = code.match(/^([A-Za-z]+)-?(\d+)$/);
      if (!match) return res.json({ gallery: [] });
      
      const prefix = match[1].toLowerCase();
      const num = match[2];
      
      const primaryId = `${prefix}${num.padStart(5, '0')}`;
      const possibleIds = [
        primaryId,
        `${prefix}${num}`,
        `1${prefix}${num.padStart(5, '0')}`,
        `1${prefix}${num}`
      ];
      
      const anyDmmRegex = /https:\/\/pics\.dmm\.co\.jp\/(?:digital\/video|mono\/movie\/adult)\/([a-z0-9_]+)\/\1-\d+\.jpg/gi;

      const fetchCandidate = async (videoId: string): Promise<string[]> => {
        const url = `https://javtrailers.com/video/${videoId}`;
        // @ts-ignore
        const html = await cloudscraper.get({
          url,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
          timeout: 3500
        });
        const anyMatches = html.match(anyDmmRegex);
        if (!anyMatches || anyMatches.length === 0) {
          throw new Error('No images in ' + videoId);
        }
        return [...new Set<string>(anyMatches)].sort((a, b) => {
          const numA = parseInt(a.match(/-(\d+)\.jpg$/i)?.[1] || '0', 10);
          const numB = parseInt(b.match(/-(\d+)\.jpg$/i)?.[1] || '0', 10);
          return numA - numB;
        }).map(u => u.replace(/-(\d+)\.jpg$/i, 'jp-$1.jpg'));
      };

      let gallery: string[] = [];

      try {
        // Parallel racing across all candidates - first successful one resolves immediately
        gallery = await Promise.any(possibleIds.map(id => fetchCandidate(id)));
      } catch {
        // Direct zero-scraping DMM probe fallback if JavTrailers failed or was blocked
        try {
          const testDmmUrl = `https://pics.dmm.co.jp/digital/video/${primaryId}/${primaryId}jp-1.jpg`;
          const testRes = await fetch(testDmmUrl, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
          if (testRes.ok) {
            const verified: string[] = [testDmmUrl];
            const checks = await Promise.all(
              Array.from({ length: 11 }, (_, idx) => {
                const imgNum = idx + 2;
                const checkUrl = `https://pics.dmm.co.jp/digital/video/${primaryId}/${primaryId}jp-${imgNum}.jpg`;
                return fetch(checkUrl, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
                  .then(r => r.ok ? { url: checkUrl, idx: imgNum } : null)
                  .catch(() => null);
              })
            );
            checks
              .filter((c): c is { url: string; idx: number } => c !== null)
              .sort((a, b) => a.idx - b.idx)
              .forEach(c => verified.push(c.url));
            gallery = verified;
          }
        } catch {
          // ignore fallback error
        }
      }

      return res.json({ gallery });
    } catch (error: any) {
      console.error('JavTrailers Gallery Fetch Error:', error.message);
      return res.status(200).json({ gallery: [] }); 
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Pixeldrain metadata extractor & streaming endpoint
  app.post('/api/pixeldrain/extract', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
      }

      const match = url.trim().match(/(?:pixeldrain\.(?:com|net)\/(?:u|file|api\/file)\/)([a-zA-Z0-9_-]+)/i);
      const listMatch = !match && url.trim().match(/(?:pixeldrain\.(?:com|net)\/(?:l|list|api\/list)\/)([a-zA-Z0-9_-]+)/i);
      
      const fileId = match ? match[1] : null;
      const listId = listMatch ? listMatch[1] : null;

      if (!fileId && !listId) {
        return res.status(400).json({ error: 'Invalid Pixeldrain URL. Could not parse file or list ID.' });
      }

      if (fileId) {
        let title = '';
        let size = 0;
        let mimeType = 'video/mp4';

        try {
          const infoRes = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`);
          if (infoRes.ok) {
            const info = await infoRes.json();
            if (info) {
              title = info.name || '';
              size = info.size || 0;
              mimeType = info.mime_type || 'video/mp4';
            }
          }
        } catch (e) {
          console.warn('Could not fetch Pixeldrain info endpoint:', e);
        }

        const directStreamUrl = `https://pixeldrain.com/api/file/${fileId}`;
        const streamProxyUrl = `/api/pixeldrain/stream/${fileId}`;
        const thumbnailUrl = `https://pixeldrain.com/api/file/${fileId}/thumbnail`;

        return res.json({
          success: true,
          id: fileId,
          title: title || `Pixeldrain Video (${fileId})`,
          size,
          mimeType,
          url: directStreamUrl,
          streamProxyUrl,
          thumbnailUrl,
        });
      }

      if (listId) {
        try {
          const listRes = await fetch(`https://pixeldrain.com/api/list/${listId}`);
          if (listRes.ok) {
            const listData = await listRes.json();
            const files = (listData.files || []).map((f: any) => ({
              id: f.id,
              name: f.name,
              size: f.size,
              mimeType: f.mime_type,
              url: `https://pixeldrain.com/api/file/${f.id}`,
              thumbnailUrl: `https://pixeldrain.com/api/file/${f.id}/thumbnail`,
            }));
            const firstVideo = files.find((f: any) => !f.mimeType || f.mimeType.startsWith('video/')) || files[0];
            return res.json({
              success: true,
              listId,
              title: listData.title || `Pixeldrain List (${listId})`,
              files,
              url: firstVideo ? firstVideo.url : undefined,
            });
          }
        } catch (e: any) {
          return res.status(500).json({ error: 'Failed to fetch Pixeldrain list info: ' + e.message });
        }
      }

      return res.status(400).json({ error: 'Unable to process Pixeldrain request.' });
    } catch (error: any) {
      console.error('Error extracting Pixeldrain URL:', error);
      res.status(500).json({ error: error.message || 'Internal Pixeldrain error' });
    }
  });

  // Pixeldrain direct range streaming proxy
  app.get('/api/pixeldrain/stream/:id', async (req, res) => {
    try {
      const fileId = req.params.id;
      if (!fileId) {
        return res.status(400).send('Missing file id');
      }

      const targetUrl = `https://pixeldrain.com/api/file/${fileId}`;
      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://pixeldrain.com/',
      };

      // Chunk size limit: 16MB for lightning fast initial buffer and smooth seeking
      const CHUNK_SIZE = 16 * 1024 * 1024;
      const rawRange = req.headers.range;

      if (rawRange) {
        const match = rawRange.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          let end: number | undefined = match[2] ? parseInt(match[2], 10) : undefined;

          // If range is open-ended or excessively large, cap to CHUNK_SIZE for fast response
          if (end === undefined || isNaN(end) || (end - start + 1) > CHUNK_SIZE) {
            end = start + CHUNK_SIZE - 1;
          }
          headers['Range'] = `bytes=${start}-${end}`;
        } else {
          headers['Range'] = rawRange;
        }
      } else {
        // First initial chunk if no range header provided
        headers['Range'] = `bytes=0-${CHUNK_SIZE - 1}`;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, { 
        headers,
        signal: abortController.signal
      });

      res.status(originRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      const contentType = originRes.headers.get('content-type') || 'video/mp4';
      res.setHeader('Content-Type', contentType);

      const contentLength = originRes.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = originRes.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      // Always force inline content disposition so browsers play the video rather than downloading
      res.setHeader('Content-Disposition', 'inline');

      if (originRes.body) {
        // @ts-ignore
        const nodeStream = (await import('stream')).Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming pixeldrain file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream pixeldrain file');
      }
    }
  });

  // Bunkr metadata extractor & streaming endpoints
  app.post('/api/bunkr/extract', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
      }

      const rawUrl = url.trim();
      const encodedUrl = encodeURI(rawUrl);

      // If already a signed CDN url with token and ex
      if (rawUrl.includes('token=') && rawUrl.includes('ex=')) {
        return res.json({
          success: true,
          url: rawUrl,
          directStreamUrl: rawUrl,
          streamProxyUrl: `/api/bunkr/stream?target=${encodeURIComponent(rawUrl)}`,
          title: 'Bunkr Video',
          mimeType: 'video/mp4'
        });
      }

      const pageRes = await fetch(encodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!pageRes.ok) {
        return res.status(pageRes.status).json({ error: `Failed to fetch Bunkr page: ${pageRes.status} ${pageRes.statusText}` });
      }

      const html = await pageRes.text();

      const jsCDNMatch = html.match(/var\s+jsCDN\s*=\s*"([^"]+)"/);
      const signUrlMatch = html.match(/var\s+signUrl\s*=\s*"([^"]+)"/);
      const videoCoverMatch = html.match(/var\s+videoCoverUrl\s*=\s*"([^"]+)"/);
      const jsTypeMatch = html.match(/var\s+jsType\s*=\s*"([^"]+)"/);
      const jsSlugMatch = html.match(/var\s+jsSlug\s*=\s*"([^"]+)"/);
      const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) 
        || html.match(/<title>([^<]+)<\/title>/i);

      if (!jsCDNMatch) {
        // Fallback: check if there is a direct <source src="..."> or <video src="...">
        const videoSrcMatch = html.match(/<source\s+[^>]*src=["']([^"']+)["']/i) || html.match(/<video\s+[^>]*src=["']([^"']+)["']/i);
        if (videoSrcMatch) {
          const directUrl = videoSrcMatch[1];
          return res.json({
            success: true,
            url: directUrl,
            directStreamUrl: directUrl,
            streamProxyUrl: `/api/bunkr/stream?target=${encodeURIComponent(directUrl)}`,
            title: ogTitleMatch ? ogTitleMatch[1].replace(/ - Bunkr.*$/i, '').trim() : 'Bunkr Video',
            thumbnailUrl: videoCoverMatch ? videoCoverMatch[1].replace(/\\\//g, '/') : undefined,
            mimeType: 'video/mp4'
          });
        }
        return res.status(404).json({ error: 'Could not find media source in Bunkr page.' });
      }

      const jsCDN = jsCDNMatch[1].replace(/\\\//g, '/');
      const signUrl = signUrlMatch ? signUrlMatch[1].replace(/\\\//g, '/') : 'https://glb-apisign.cdn.cr/sign';
      const videoCoverUrl = videoCoverMatch ? videoCoverMatch[1].replace(/\\\//g, '/') : undefined;
      const jsType = jsTypeMatch ? jsTypeMatch[1].replace(/\\\//g, '/') : 'video/mp4';
      const jsSlug = jsSlugMatch ? jsSlugMatch[1].replace(/\\\//g, '/') : '';

      let title = ogTitleMatch ? ogTitleMatch[1].replace(/ - Bunkr.*$/i, '').trim() : '';
      if (!title && jsSlug) {
        title = jsSlug.replace(/\.[a-zA-Z0-9]+$/, '').replace(/-[a-zA-Z0-9]{8}$/, '');
      }

      const orig = new URL(encodeURI(jsCDN));
      const path = decodeURIComponent(orig.pathname);
      const signEndpoint = `${signUrl}?path=${encodeURIComponent(path)}`;

      const signRes = await fetch(signEndpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': encodedUrl
        }
      });

      if (!signRes.ok) {
        return res.status(signRes.status).json({ error: `Failed to sign Bunkr media: ${signRes.status}` });
      }

      const signData = await signRes.json();
      if (!signData || !signData.token) {
        return res.status(500).json({ error: 'Invalid sign response from Bunkr signer' });
      }

      orig.searchParams.set('token', signData.token);
      orig.searchParams.set('ex', signData.ex);
      const signedStreamUrl = orig.toString();

      return res.json({
        success: true,
        title: title || 'Bunkr Video',
        url: signedStreamUrl,
        directStreamUrl: signedStreamUrl,
        streamProxyUrl: `/api/bunkr/stream?target=${encodeURIComponent(signedStreamUrl)}`,
        thumbnailUrl: videoCoverUrl,
        mimeType: jsType,
        slug: jsSlug
      });
    } catch (error: any) {
      console.error('Error in /api/bunkr/extract:', error);
      res.status(500).json({ error: error.message || 'Internal Bunkr extraction error' });
    }
  });

  // Bunkr video streaming proxy (supports range requests, seeking, CORS)
  app.get('/api/bunkr/stream', async (req, res) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();
      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      const CHUNK_SIZE = 16 * 1024 * 1024;
      const rawRange = req.headers.range;

      if (rawRange) {
        const match = rawRange.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          let end: number | undefined = match[2] ? parseInt(match[2], 10) : undefined;
          if (end === undefined || isNaN(end) || (end - start + 1) > CHUNK_SIZE) {
            end = start + CHUNK_SIZE - 1;
          }
          headers['Range'] = `bytes=${start}-${end}`;
        } else {
          headers['Range'] = rawRange;
        }
      } else {
        headers['Range'] = `bytes=0-${CHUNK_SIZE - 1}`;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, {
        headers,
        signal: abortController.signal
      });

      res.status(originRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      const contentType = originRes.headers.get('content-type');
      res.setHeader('Content-Type', (contentType && contentType.startsWith('video/')) ? contentType : 'video/mp4');

      const contentLength = originRes.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = originRes.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      res.setHeader('Content-Disposition', 'inline');

      if (originRes.body) {
        // @ts-ignore
        const nodeStream = (await import('stream')).Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming bunkr file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream bunkr file');
      }
    }
  });

  // Filester metadata extractor & streaming endpoints
  app.post('/api/filester/extract', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
      }

      const rawUrl = url.trim();

      // If already a direct media URL or signed CDN url
      if (rawUrl.includes('/v2/') && rawUrl.includes('token=')) {
        return res.json({
          success: true,
          url: rawUrl,
          directStreamUrl: rawUrl,
          downloadUrl: rawUrl,
          streamProxyUrl: `/api/filester/stream?target=${encodeURIComponent(rawUrl)}`,
          title: 'Filester Video',
          mimeType: 'video/mp4'
        });
      }

      // Extract slug from URL
      let slug: string | null = null;
      try {
        const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && ['d', 'v', 'f', 'file', 'watch'].includes(parts[0].toLowerCase())) {
          slug = parts[1];
        } else if (parts.length >= 1) {
          slug = parts[parts.length - 1];
        }
      } catch (e) {
        const match = rawUrl.match(/filester\.[a-z]+\/(?:d|v|f|file)?\/?([a-zA-Z0-9_-]+)/i);
        if (match) slug = match[1];
      }

      if (!slug) {
        return res.status(400).json({ error: 'Could not extract Filester file slug' });
      }

      // Detect client IP for accurate token binding
      const clientIp = (
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        (req.headers['cf-connecting-ip'] as string) ||
        (req.headers['x-real-ip'] as string) ||
        req.socket.remoteAddress ||
        ''
      ).replace(/^.*:/, '');

      const baseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://filester.sh',
        'Referer': rawUrl
      };

      if (clientIp) {
        baseHeaders['X-Forwarded-For'] = clientIp;
        baseHeaders['CF-Connecting-IP'] = clientIp;
        baseHeaders['X-Real-IP'] = clientIp;
      }

      // 1. Call Filester API for view/download token with fallback domains
      let tokenData: any = null;
      const apiEndpoints = [
        'https://filester.sh/v2/api/public/view',
        'https://filester.si/v2/api/public/view',
        'https://filester.sh/v2/api/public/download',
        'https://filester.si/v2/api/public/download',
      ];

      for (const endpoint of apiEndpoints) {
        try {
          const apiRes = await fetch(endpoint, {
            method: 'POST',
            headers: baseHeaders,
            body: JSON.stringify({ file_slug: slug })
          });
          if (apiRes.ok) {
            const data = await apiRes.json();
            if (data && data.token) {
              tokenData = data;
              break;
            }
          }
        } catch (e) {
          // try next endpoint
        }
      }

      if (!tokenData || !tokenData.token) {
        return res.status(404).json({ error: 'Could not generate Filester media stream token' });
      }

      const baseServer = tokenData.server || 'https://fsc2.cdn.cr';
      const streamUrl = `${baseServer}/v2/${tokenData.file}?token=${encodeURIComponent(tokenData.token)}`;
      const downloadUrl = `${baseServer}/v2/${tokenData.file}?token=${encodeURIComponent(tokenData.token)}&download=true&n=${encodeURIComponent(tokenData.name || '')}`;

      const fileUUID = tokenData.file ? tokenData.file.replace(/\.[a-zA-Z0-9]+$/, '') : '';
      const thumbnailUrl = fileUUID ? `https://filester.me/t/${fileUUID}` : undefined;
      const title = tokenData.name 
        ? tokenData.name.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').trim()
        : 'Filester Video';

      return res.json({
        success: true,
        title,
        url: streamUrl,
        directStreamUrl: streamUrl,
        downloadUrl,
        streamProxyUrl: `/api/filester/stream?target=${encodeURIComponent(streamUrl)}`,
        thumbnailUrl,
        mimeType: 'video/mp4',
        fileUUID,
        expiresIn: tokenData.expires_in || 1800,
        server: baseServer,
        token: tokenData.token
      });
    } catch (error: any) {
      console.error('Error in /api/filester/extract:', error);
      res.status(500).json({ error: error.message || 'Internal Filester extraction error' });
    }
  });

  // Filester video streaming proxy (supports continuous range requests, seeking, HEAD, CORS)
  const handleFilesterStream = async (req: express.Request, res: express.Response, isHead: boolean) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();
      const headers: Record<string, string> = {
        'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://filester.sh/',
      };

      // Transparent Range Pass-Through: NEVER truncate ranges artificially!
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, {
        method: isHead ? 'HEAD' : 'GET',
        headers,
        signal: abortController.signal
      });

      res.status(originRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, ETag, Last-Modified');

      const contentType = originRes.headers.get('content-type');
      res.setHeader('Content-Type', (contentType && contentType.startsWith('video/')) ? contentType : 'video/mp4');

      const contentLength = originRes.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = originRes.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      const etag = originRes.headers.get('etag');
      if (etag) res.setHeader('ETag', etag);

      const lastModified = originRes.headers.get('last-modified');
      if (lastModified) res.setHeader('Last-Modified', lastModified);

      res.setHeader('Content-Disposition', 'inline');

      if (isHead) {
        return res.end();
      }

      if (originRes.body) {
        // @ts-ignore
        const nodeStream = (await import('stream')).Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming filester file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream filester file');
      }
    }
  };

  app.head('/api/filester/stream', (req, res) => handleFilesterStream(req, res, true));
  app.get('/api/filester/stream', (req, res) => handleFilesterStream(req, res, false));

  // Gofile token & WT cache
  let cachedGofileToken: string | null = null;
  let cachedGofileTokenExpiry = 0;
  let cachedGofileWtGenerator: ((token: string) => Promise<string>) | null = null;
  let cachedGofileWtTime = 0;

  async function getGofileSession(forceRefresh = false) {
    const now = Date.now();
    const vm = await import('vm');
    const cryptoModule = await import('crypto');

    // 1. Get or refresh guest account token
    if (forceRefresh || !cachedGofileToken || now > cachedGofileTokenExpiry) {
      try {
        const accRes = await fetch('https://api.gofile.io/accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Origin': 'https://gofile.io',
            'Referer': 'https://gofile.io/'
          }
        });
        if (accRes.ok) {
          const accData = await accRes.json();
          if (accData?.status === 'ok' && accData?.data?.token) {
            cachedGofileToken = accData.data.token;
            cachedGofileTokenExpiry = now + (2 * 60 * 60 * 1000); // 2 hours
          }
        }
      } catch (err) {
        console.warn('Error fetching Gofile guest token:', err);
      }
    }

    // 2. Get or refresh WT generator from wt.obf.js
    if (forceRefresh || !cachedGofileWtGenerator || now - cachedGofileWtTime > 3 * 60 * 60 * 1000) {
      try {
        const wtRes = await fetch('https://gofile.io/js/wt.obf.js', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://gofile.io/'
          }
        });
        if (wtRes.ok) {
          const wtCode = await wtRes.text();
          const sandbox: any = {
            globalThis: {},
            window: {},
            document: {
              location: { href: 'https://gofile.io/' }
            },
            location: { href: 'https://gofile.io/', origin: 'https://gofile.io' },
            navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
            crypto: cryptoModule.webcrypto,
            performance: performance,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            fetch: fetch
          };
          sandbox.window = sandbox;
          sandbox.globalThis = sandbox;

          const context = vm.createContext(sandbox);
          vm.runInContext(wtCode, context);

          if (typeof sandbox.generateWT === 'function') {
            cachedGofileWtGenerator = sandbox.generateWT;
            cachedGofileWtTime = now;
          }
        }
      } catch (err) {
        console.warn('Error loading Gofile wt.obf.js:', err);
      }
    }

    const token = cachedGofileToken;
    let wt = '';
    if (cachedGofileWtGenerator && token) {
      try {
        wt = await cachedGofileWtGenerator(token);
      } catch (err) {
        console.warn('Error generating Gofile WT:', err);
      }
    }

    return { token, wt };
  }

  // Gofile metadata extractor endpoint
  app.post('/api/gofile/extract', express.json(), async (req, res) => {
    try {
      const { url, password } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
      }

      const rawUrl = url.trim();

      // If already a direct download link (store*.gofile.io/download/web/...)
      if (rawUrl.includes('gofile.io/download/web/')) {
        const { token } = await getGofileSession();
        return res.json({
          success: true,
          url: rawUrl,
          directStreamUrl: rawUrl,
          downloadUrl: rawUrl,
          streamProxyUrl: `/api/gofile/stream?target=${encodeURIComponent(rawUrl)}${token ? '&token=' + encodeURIComponent(token) : ''}`,
          title: 'Gofile Video',
          mimeType: 'video/mp4',
          token
        });
      }

      // Extract contentId (slug or UUID)
      let contentId: string | null = null;
      const matchD = rawUrl.match(/gofile\.io\/d\/([a-zA-Z0-9_-]+)/i);
      if (matchD) {
        contentId = matchD[1];
      } else {
        try {
          const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 2 && parts[0].toLowerCase() === 'd') {
            contentId = parts[1];
          } else if (parts.length >= 1) {
            contentId = parts[parts.length - 1];
          }
        } catch (e) {}
      }

      if (!contentId) {
        return res.status(400).json({ error: 'Could not extract Gofile content ID' });
      }

      // 1. Get Gofile session (guest token + WT)
      let session = await getGofileSession();
      if (!session.token || !session.wt) {
        session = await getGofileSession(true);
      }

      const fetchContents = async (tok: string, websiteToken: string) => {
        const query = new URLSearchParams({
          page: '1',
          pageSize: '100',
          sortField: 'name',
          sortDirection: '1'
        });
        if (password) {
          const crypto = await import('crypto');
          query.set('password', crypto.createHash('sha256').update(password).digest('hex'));
        }

        const endpoint = `https://api.gofile.io/contents/${encodeURIComponent(contentId)}?${query.toString()}`;
        return fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${tok}`,
            'X-Website-Token': websiteToken,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Origin': 'https://gofile.io',
            'Referer': `https://gofile.io/d/${contentId}`
          }
        });
      };

      let contentRes = await fetchContents(session.token || '', session.wt || '');
      let contentData = await contentRes.json().catch(() => null);

      // If token expired or rejected, retry once with fresh credentials
      if (contentData?.status === 'error-token' || contentData?.status === 'error-wrongToken' || contentData?.status === 'error-notPremium') {
        session = await getGofileSession(true);
        contentRes = await fetchContents(session.token || '', session.wt || '');
        contentData = await contentRes.json().catch(() => null);
      }

      if (!contentData || contentData.status !== 'ok' || !contentData.data) {
        return res.status(404).json({
          error: contentData?.status || 'Failed to retrieve Gofile content metadata'
        });
      }

      const data = contentData.data;
      const fileList: Array<{
        id: string;
        name: string;
        size: number;
        mimeType: string;
        url: string;
        directStreamUrl: string;
        downloadUrl: string;
        streamProxyUrl: string;
        thumbnailUrl?: string;
      }> = [];

      // Check if folder or single file
      if (data.type === 'file') {
        const fileStreamUrl = data.link || '';
        fileList.push({
          id: data.id,
          name: data.name || 'Gofile Video',
          size: data.size || 0,
          mimeType: data.mimetype || 'video/mp4',
          url: fileStreamUrl,
          directStreamUrl: fileStreamUrl,
          downloadUrl: fileStreamUrl,
          streamProxyUrl: `/api/gofile/stream?target=${encodeURIComponent(fileStreamUrl)}${session.token ? '&token=' + encodeURIComponent(session.token) : ''}`,
          thumbnailUrl: data.thumbnail || undefined
        });
      } else if (data.children) {
        for (const childId of Object.keys(data.children)) {
          const child = data.children[childId];
          if (child && child.type === 'file') {
            const childStreamUrl = child.link || '';
            fileList.push({
              id: child.id,
              name: child.name || 'Gofile File',
              size: child.size || 0,
              mimeType: child.mimetype || 'video/mp4',
              url: childStreamUrl,
              directStreamUrl: childStreamUrl,
              downloadUrl: childStreamUrl,
              streamProxyUrl: `/api/gofile/stream?target=${encodeURIComponent(childStreamUrl)}${session.token ? '&token=' + encodeURIComponent(session.token) : ''}`,
              thumbnailUrl: child.thumbnail || undefined
            });
          }
        }
      }

      if (fileList.length === 0) {
        return res.status(404).json({ error: 'No files found in Gofile folder' });
      }

      // Classify video qualities and samples
      const classifiedFiles = fileList.map(f => {
        const lowerName = f.name.toLowerCase();
        const isSample = /sample|trailer|preview/i.test(lowerName) || (f.size > 0 && f.size < 40 * 1024 * 1024 && fileList.length > 1);
        let quality: '4K' | '1080p' | '720p' | 'SD' | undefined = undefined;

        if (/2160p|4k|uhd|3840x2160/i.test(lowerName)) {
          quality = '4K';
        } else if (/1080p|fhd|1920x1080/i.test(lowerName)) {
          quality = '1080p';
        } else if (/720p|1280x720/i.test(lowerName)) {
          quality = '720p';
        } else if (/480p|540p|sd/i.test(lowerName)) {
          quality = 'SD';
        }

        return {
          ...f,
          quality,
          isSample
        };
      });

      const videoFiles = classifiedFiles.filter(f => (f.mimeType && f.mimeType.startsWith('video/')) || /\.(mp4|mkv|webm|avi|mov)$/i.test(f.name));
      const mainVideos = videoFiles.filter(f => !f.isSample).length > 0 ? videoFiles.filter(f => !f.isSample) : videoFiles;

      let file4K = mainVideos.find(f => f.quality === '4K');
      let fileHD = mainVideos.find(f => f.quality === '1080p' || f.quality === '720p');

      // If no explicit quality labels but multiple videos, classify by file size
      if (!file4K && !fileHD && mainVideos.length >= 2) {
        const sortedBySize = [...mainVideos].sort((a, b) => b.size - a.size);
        if (sortedBySize[0].size > sortedBySize[1].size * 1.3) {
          file4K = { ...sortedBySize[0], quality: '4K' };
          fileHD = { ...sortedBySize[1], quality: '1080p' };
        } else {
          fileHD = sortedBySize[0];
        }
      }

      // Default primary video to 4K if available, otherwise HD, otherwise first main video
      const primaryVideo = file4K || fileHD || mainVideos[0] || classifiedFiles[0];
      const folderTitle = data.name && data.name !== contentId ? data.name : primaryVideo.name;
      const cleanTitle = folderTitle.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').trim();

      return res.json({
        success: true,
        id: data.id || contentId,
        title: cleanTitle || 'Gofile Video',
        url: primaryVideo.url,
        directStreamUrl: primaryVideo.directStreamUrl,
        downloadUrl: primaryVideo.downloadUrl,
        streamProxyUrl: primaryVideo.streamProxyUrl,
        thumbnailUrl: primaryVideo.thumbnailUrl,
        mimeType: primaryVideo.mimeType,
        size: primaryVideo.size,
        quality: primaryVideo.quality,
        file4K: file4K || null,
        fileHD: fileHD || null,
        token: session.token,
        files: classifiedFiles
      });
    } catch (error: any) {
      console.error('Error in /api/gofile/extract:', error);
      res.status(500).json({ error: error.message || 'Internal Gofile extraction error' });
    }
  });

  // Gofile video streaming proxy (supports range requests, seeking, token auth, CORS)
  app.get('/api/gofile/stream', async (req, res) => {
    try {
      const target = req.query.target;
      let token = req.query.token as string | undefined;

      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();

      // If token not provided in query, obtain current guest token
      if (!token) {
        const session = await getGofileSession();
        token = session.token || undefined;
      }

      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://gofile.io/',
        'Origin': 'https://gofile.io'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Cookie'] = `accountToken=${token}`;
      }

      const CHUNK_SIZE = 16 * 1024 * 1024;
      const rawRange = req.headers.range;

      if (rawRange) {
        const match = rawRange.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          let end: number | undefined = match[2] ? parseInt(match[2], 10) : undefined;
          if (end === undefined || isNaN(end) || (end - start + 1) > CHUNK_SIZE) {
            end = start + CHUNK_SIZE - 1;
          }
          headers['Range'] = `bytes=${start}-${end}`;
        } else {
          headers['Range'] = rawRange;
        }
      } else {
        headers['Range'] = `bytes=0-${CHUNK_SIZE - 1}`;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, {
        headers,
        signal: abortController.signal
      });

      res.status(originRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      const contentType = originRes.headers.get('content-type');
      res.setHeader('Content-Type', (contentType && contentType.startsWith('video/')) ? contentType : 'video/mp4');

      const contentLength = originRes.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = originRes.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      res.setHeader('Content-Disposition', 'inline');

      if (originRes.body) {
        // @ts-ignore
        const nodeStream = (await import('stream')).Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming gofile file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream gofile file');
      }
    }
  });

  // CyberFile Extraction Endpoint
  app.post('/api/cyberfile/extract', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing CyberFile URL' });
      }

      const trimmed = url.trim();
      const codeMatch = trimmed.match(/cyberfile\.me\/(?:d\/|f\/|file\/)?([a-zA-Z0-9_-]+)/i);
      if (!codeMatch) {
        return res.status(400).json({ error: 'Invalid CyberFile URL structure' });
      }

      const code = codeMatch[1];
      const pageUrl = `https://cyberfile.me/${code}`;

      const pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!pageRes.ok) {
        return res.status(pageRes.status).json({ error: `CyberFile returned HTTP ${pageRes.status}` });
      }

      const cookies = pageRes.headers.get('set-cookie') || '';
      const html = await pageRes.text();

      // Extract fileId from JS functions or HTML
      const idMatch = html.match(/showFile(?:Information|Inline)?\((\d+)\)/i) ||
                      html.match(/fileId\s*=\s*['"]?(\d+)['"]?/i) ||
                      html.match(/data-file-id=['"]?(\d+)['"]?/i);

      let fileId = idMatch ? idMatch[1] : null;
      let title = '';
      let directStreamUrl = '';
      let thumbnailUrl = '';
      let fileSize: number | undefined = undefined;

      // Extract page title as fallback
      const pageTitleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (pageTitleMatch) {
        title = pageTitleMatch[1].replace(/\s*-\s*CyberFile\s*/gi, '').replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').trim();
      }

      if (fileId) {
        // Query AJAX details with session cookie and origin headers
        const detailsHeaders: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Origin': 'https://cyberfile.me',
          'Referer': pageUrl,
          'X-Requested-With': 'XMLHttpRequest'
        };
        if (cookies) {
          detailsHeaders['Cookie'] = cookies;
        }

        const detailsRes = await fetch('https://cyberfile.me/account/ajax/file_details', {
          method: 'POST',
          headers: detailsHeaders,
          body: `u=${encodeURIComponent(fileId)}`
        });

        if (detailsRes.ok) {
          const data = await detailsRes.json();
          const dHtml = data.html || '';

          if (data.page_title) {
            title = data.page_title.replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').trim();
          }

          const srcMatch = dHtml.match(/<source[^>]+src=["']([^"']+)["']/i) || 
                           dHtml.match(/<video[^>]+src=["']([^"']+)["']/i) ||
                           dHtml.match(/href=["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm)[^"']*)["']/i);
          if (srcMatch) {
            directStreamUrl = srcMatch[1].replace(/&amp;/g, '&');
          }

          const posterMatch = dHtml.match(/data-poster=["']([^"']+)["']/i) || 
                              dHtml.match(/poster=["']([^"']+)["']/i) ||
                              dHtml.match(/<img[^>]+src=["']([^"']+(?:jpg|png|webp|jpeg)[^"']*)["']/i);
          if (posterMatch) {
            thumbnailUrl = posterMatch[1].replace(/&amp;/g, '&');
          }
        }
      }

      // Fallback: search main HTML if directStreamUrl was not found in ajax
      if (!directStreamUrl) {
        const directSrcMatch = html.match(/<source[^>]+src=["']([^"']+)["']/i) || 
                               html.match(/<video[^>]+src=["']([^"']+)["']/i) ||
                               html.match(/href=["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm)[^"']*)["']/i);
        if (directSrcMatch) {
          directStreamUrl = directSrcMatch[1].replace(/&amp;/g, '&');
        }
      }

      if (!directStreamUrl) {
        return res.status(404).json({ error: 'Direct stream URL not found on CyberFile page' });
      }

      // Quick HEAD request to probe content-length with cyberfile headers
      try {
        const headRes = await fetch(directStreamUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://cyberfile.me/'
          }
        });
        const cl = headRes.headers.get('content-length');
        if (cl) {
          fileSize = parseInt(cl, 10);
        }
      } catch (e) {
        // Ignore size probe error
      }

      const streamProxyUrl = `/api/cyberfile/stream?target=${encodeURIComponent(directStreamUrl)}`;

      return res.json({
        success: true,
        id: fileId || code,
        code,
        title: title || `CyberFile Video (${code})`,
        url: directStreamUrl,
        directStreamUrl,
        downloadUrl: directStreamUrl,
        streamProxyUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        mimeType: 'video/mp4',
        size: fileSize
      });
    } catch (error: any) {
      console.error('Cyberfile extraction error:', error);
      return res.status(500).json({ error: error.message || 'Failed to extract video data from CyberFile' });
    }
  });

  // CyberFile Stream Proxy with 16MB 206 chunking and CORS bypass
  app.get('/api/cyberfile/stream', async (req, res) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();
      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://cyberfile.me/',
        'Origin': 'https://cyberfile.me'
      };

      const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB optimal chunks
      const rawRange = req.headers.range;

      if (rawRange) {
        const match = rawRange.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          let end: number | undefined = match[2] ? parseInt(match[2], 10) : undefined;
          if (end === undefined || isNaN(end) || (end - start + 1) > CHUNK_SIZE) {
            end = start + CHUNK_SIZE - 1;
          }
          headers['Range'] = `bytes=${start}-${end}`;
        } else {
          headers['Range'] = rawRange;
        }
      } else {
        headers['Range'] = `bytes=0-${CHUNK_SIZE - 1}`;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, {
        headers,
        signal: abortController.signal
      });

      res.status(originRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      const contentType = originRes.headers.get('content-type');
      res.setHeader('Content-Type', (contentType && contentType.startsWith('video/')) ? contentType : 'video/mp4');

      const contentLength = originRes.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = originRes.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      res.setHeader('Content-Disposition', 'inline');

      if (originRes.body) {
        // @ts-ignore
        const nodeStream = (await import('stream')).Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming cyberfile file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream cyberfile file');
      }
    }
  });

  // In-memory + persistent cache for FileDitch worker URLs mapped by file path
  const fileditchWorkerCache = new Map<string, { workerUrl: string; timestamp: number }>();
  
  // File for persistent disk cache
  const FILEDITCH_CACHE_FILE = path.join(process.cwd(), 'data', 'fileditch_links.json');

  const saveFileditchCacheToDisk = () => {
    try {
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const obj: Record<string, { workerUrl: string; timestamp: number }> = {};
      fileditchWorkerCache.forEach((val, key) => {
        obj[key] = val;
      });
      fs.writeFileSync(FILEDITCH_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save fileditch cache to disk:', e);
    }
  };

  const loadFileditchCacheFromDisk = () => {
    try {
      if (fs.existsSync(FILEDITCH_CACHE_FILE)) {
        const raw = fs.readFileSync(FILEDITCH_CACHE_FILE, 'utf-8');
        const obj = JSON.parse(raw);
        for (const [key, val] of Object.entries(obj)) {
          if (val && typeof val === 'object' && (val as any).workerUrl) {
            fileditchWorkerCache.set(key, val as any);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load fileditch cache from disk:', e);
    }
  };

  // Pre-seed with verified worker links
  fileditchWorkerCache.set(
    '/balpha16/87729be96387b40f7e07/gfd0182_260910_paytonpreslee_bts_4k_orig.mp4',
    {
      workerUrl: 'https://wispy-wood-2592.cloudflareditchshit0.workers.dev/balpha16/87729be96387b40f7e07/gfd0182_260910_paytonpreslee_bts_4k_orig.mp4?exp=1789295965&sig=e-0KwWB26meETZOEsWvFJUMA-nD_9ZnZphJunh4lRlg',
      timestamp: Date.now()
    }
  );
  fileditchWorkerCache.set(
    '/beta23/5d9acf4d9aa62bb99403/Spizoo.26.08.19.Busty.Payton.Preslee.Has.A.Hunger.For.Cock.XXX.4K.mp4',
    {
      workerUrl: 'https://wispy-wood-2592.cloudflareditchshit0.workers.dev/beta23/5d9acf4d9aa62bb99403/Spizoo.26.08.19.Busty.Payton.Preslee.Has.A.Hunger.For.Cock.XXX.4K.mp4?exp=1789298365&sig=cWESS64ptqX6xi1_4OyTitqlznzSf2RyD--r7EYLnkI',
      timestamp: Date.now()
    }
  );
  fileditchWorkerCache.set(
    '/balpha15/f3f6c847084ff38b3747/Raissa_Bellini_Girthmasterr_-_BrazzersExxtra_-_Respiratory_Dickstress_2160p.mp4',
    {
      workerUrl: 'https://wispy-wood-2592.cloudflareditchshit0.workers.dev/balpha15/f3f6c847084ff38b3747/Raissa_Bellini_Girthmasterr_-_BrazzersExxtra_-_Respiratory_Dickstress_2160p.mp4?exp=1789298935&sig=QEw3qyjVwIbHNBIK96DozkQ2JA6nJKgjuxVuKjM1e38',
      timestamp: Date.now()
    }
  );

  // Load any previously saved cache
  loadFileditchCacheFromDisk();
  // Save initial seed to disk
  saveFileditchCacheToDisk();

  // FileDitch Status Proxy Endpoint
  app.get('/api/fileditch/status', async (req, res) => {
    try {
      const targetPathOrUrl = (req.query.path || req.query.url) as string;
      if (!targetPathOrUrl) {
        return res.status(400).json({ error: 'Missing path or url parameter' });
      }

      let filePath = targetPathOrUrl.trim();
      try {
        if (filePath.startsWith('http')) {
          const u = new URL(filePath);
          filePath = u.pathname;
        }
      } catch (e) {}

      if (!filePath.startsWith('/')) {
        filePath = `/${filePath}`;
      }

      const statusRes = await fetch(`https://fileditchfiles.st/api${filePath}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      });

      if (!statusRes.ok) {
        return res.status(statusRes.status).json({ error: `FileDitch API returned ${statusRes.status}` });
      }

      const data = await statusRes.json();
      return res.json(data);
    } catch (e: any) {
      console.error('Error fetching FileDitch status:', e);
      return res.status(500).json({ error: e.message || 'Failed to check FileDitch status' });
    }
  });

  // FileDitch Register Worker Endpoint
  app.post('/api/fileditch/register-worker', express.json(), async (req, res) => {
    try {
      const { filePath, workerUrl } = req.body;
      if (!filePath || !workerUrl) {
        return res.status(400).json({ error: 'Missing filePath or workerUrl' });
      }

      let cleanPath = filePath.trim();
      try {
        if (cleanPath.startsWith('http')) {
          cleanPath = new URL(cleanPath).pathname;
        }
      } catch (e) {}
      if (!cleanPath.startsWith('/')) cleanPath = `/${cleanPath}`;

      fileditchWorkerCache.set(cleanPath, {
        workerUrl: workerUrl.trim(),
        timestamp: Date.now()
      });
      saveFileditchCacheToDisk();

      return res.json({ success: true, filePath: cleanPath, cached: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // FileDitch Metadata Extractor Endpoint
  app.post('/api/fileditch/extract', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing FileDitch URL' });
      }

      const trimmed = url.trim();

      // Check if URL is already a direct worker URL with exp and sig
      const isDirectWorker = trimmed.includes('workers.dev') && (trimmed.includes('exp=') || trimmed.includes('sig=') || trimmed.includes('cloudflareditch'));

      let filePath = '';
      try {
        const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
        filePath = u.pathname;
      } catch (e) {
        const match = trimmed.match(/(?:\.st|\.me|\.dev)(\/[^\s?#]+)/i);
        if (match) filePath = match[1];
      }

      if (filePath && !filePath.startsWith('/')) {
        filePath = `/${filePath}`;
      }

      // Extract a clean display title from filename
      let title = 'FileDitch Video';
      if (filePath) {
        const parts = filePath.split('/').filter(Boolean);
        if (parts.length > 0) {
          const rawName = parts[parts.length - 1];
          title = decodeURIComponent(rawName).replace(/\.(mp4|mkv|webm|avi|mov)$/i, '').replace(/_/g, ' ');
        }
      }

      // If user provided a direct worker URL, save it to cache and return IMMEDIATELY (0ms delay)
      if (isDirectWorker) {
        if (filePath) {
          fileditchWorkerCache.set(filePath, {
            workerUrl: trimmed,
            timestamp: Date.now()
          });
          saveFileditchCacheToDisk();
        }

        const streamProxyUrl = `/api/fileditch/stream?target=${encodeURIComponent(trimmed)}`;
        return res.json({
          success: true,
          title,
          url: trimmed,
          directStreamUrl: trimmed,
          downloadUrl: trimmed,
          streamProxyUrl,
          status: true,
          filePath,
          isDirectWorker: true,
          mimeType: 'video/mp4'
        });
      }

      // Check FileDitch Status API with fast timeout (max 900ms) to avoid blocking
      let fileSize: number | undefined = undefined;
      let fileStatus = true;

      if (filePath) {
        try {
          const statusRes = await fetch(`https://fileditchfiles.st/api${filePath}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(900)
          });
          if (statusRes.ok) {
            const statusJson: any = await statusRes.json();
            if (statusJson) {
              fileStatus = statusJson.status !== false;
              if (statusJson.size) {
                fileSize = statusJson.size;
              }
            }
          }
        } catch (statusErr) {
          // Status API optional, continue gracefully without blocking
        }
      }

      // If user provided a fileditchfiles.st URL, check if we have a cached/known worker URL
      const cached = filePath ? fileditchWorkerCache.get(filePath) : null;
      if (cached && cached.workerUrl) {
        const directUrl = cached.workerUrl;
        const streamProxyUrl = `/api/fileditch/stream?target=${encodeURIComponent(directUrl)}`;
        return res.json({
          success: true,
          title,
          url: directUrl,
          directStreamUrl: directUrl,
          downloadUrl: directUrl,
          streamProxyUrl,
          size: fileSize,
          status: fileStatus,
          filePath,
          isDirectWorker: true,
          mimeType: 'video/mp4'
        });
      }

      // In case no worker URL is registered yet, provide status and proxy URL
      const fallbackProxyUrl = `/api/fileditch/stream?target=${encodeURIComponent(trimmed)}`;
      return res.json({
        success: true,
        title,
        url: trimmed,
        directStreamUrl: trimmed,
        downloadUrl: trimmed,
        streamProxyUrl: fallbackProxyUrl,
        size: fileSize,
        status: fileStatus,
        filePath,
        isDirectWorker: false,
        requiresCapture: true,
        mimeType: 'video/mp4'
      });
    } catch (error: any) {
      console.error('Error in /api/fileditch/extract:', error);
      res.status(500).json({ error: error.message || 'Failed to extract FileDitch URL' });
    }
  });

  // FileDitch Stream Proxy with 206 Partial Content Range & CORS headers (High Performance Turbo Streaming)
  app.get('/api/fileditch/stream', async (req, res) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();
      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://fileditch.com/'
      };

      const rawRange = req.headers.range;
      if (rawRange) {
        headers['Range'] = rawRange;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, {
        headers,
        signal: abortController.signal
      });

      const contentLength = originRes.headers.get('content-length');
      const contentRange = originRes.headers.get('content-range');
      let status = originRes.status;

      // Normalize status to 206 if range was requested and origin returned 200 with full length
      if (rawRange && status === 200 && contentLength) {
        status = 206;
      }

      res.status(status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

      const contentType = originRes.headers.get('content-type');
      res.setHeader('Content-Type', (contentType && contentType.startsWith('video/')) ? contentType : 'video/mp4');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      } else if (rawRange && status === 206 && contentLength) {
        res.setHeader('Content-Range', `bytes 0-${parseInt(contentLength, 10) - 1}/${contentLength}`);
      }

      res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');

      if (originRes.body) {
        // @ts-ignore
        const nodeStream = (await import('stream')).Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming fileditch file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream fileditch file');
      }
    }
  });

  // Eporner Video Metadata & Quality Extraction Endpoint
  app.post('/api/eporner/extract', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing Eporner URL' });
      }

      const rawInput = url.trim();
      const idMatch = rawInput.match(/eporner\.com\/(?:video-|embed\/|hd-porn\/)?([a-zA-Z0-9]+)/i) ||
                      rawInput.match(/^video-([a-zA-Z0-9]+)$/i) ||
                      rawInput.match(/^([a-zA-Z0-9]+)$/i);
      const videoId = idMatch ? idMatch[1] : null;

      if (!videoId) {
        return res.status(400).json({ error: 'Invalid Eporner URL or Video ID' });
      }

      const cacheKey = videoId;
      const cached = epornerExtractCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      // 1. Fetch metadata from official Eporner JSON API
      let metaTitle = 'Eporner Video';
      let duration = 0;
      let thumbnailUrl = '';
      let views = 0;
      let rate = 0;
      let uploadDate: string | undefined = undefined;
      const extractedActors: string[] = [];
      const actorImages: Record<string, string> = {};

      try {
        const apiRes = await fetch(`https://www.eporner.com/api/v2/video/id/?id=${videoId}&format=json`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        if (apiRes.ok) {
          const apiJson = await apiRes.json();
          if (apiJson && apiJson.title) {
            metaTitle = apiJson.title;
          }
          if (apiJson && apiJson.length_sec) {
            duration = parseInt(apiJson.length_sec, 10);
          }
          if (apiJson && apiJson.added) {
            const parsedAdded = String(apiJson.added).trim();
            const dateMatch = parsedAdded.match(/^(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
              uploadDate = dateMatch[1];
            } else {
              const d = new Date(parsedAdded);
              if (!isNaN(d.getTime())) {
                uploadDate = d.toISOString().split('T')[0];
              }
            }
          }
          // Pick the best / highest-res thumbnail from thumbs array
          if (apiJson && Array.isArray(apiJson.thumbs) && apiJson.thumbs.length > 0) {
            const sortedThumbs = [...apiJson.thumbs].sort((a: any, b: any) => {
              const aRes = (a.width || 0) * (a.height || 0);
              const bRes = (b.width || 0) * (b.height || 0);
              return bRes - aRes;
            });
            if (sortedThumbs[0]?.src) {
              thumbnailUrl = sortedThumbs[0].src;
            }
          }
          if (!thumbnailUrl && apiJson && apiJson.default_thumb && apiJson.default_thumb.src) {
            thumbnailUrl = apiJson.default_thumb.src;
          }
          if (apiJson && apiJson.views) {
            views = apiJson.views;
          }
          if (apiJson && apiJson.rate) {
            rate = apiJson.rate;
          }
        }
      } catch (e) {
        console.warn('[Eporner] API metadata lookup failed, falling back to HTML parsing:', e);
      }

      // 2. Fetch Embed & Main Video pages to extract player hash, upload date, cover, and pornstars
      let rawHash = '';
      let pageHtml = '';

      // Try main page first or in parallel to fetch complete rich metadata (og:image, uploadDate, pornstars)
      try {
        const pageRes = await fetch(`https://www.eporner.com/video-${videoId}/-/`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.eporner.com/'
          }
        });
        if (pageRes.ok) {
          pageHtml = await pageRes.text();
          const hashMatch = pageHtml.match(/EP\.video\.player\.hash\s*=\s*[\x27"]([a-zA-Z0-9]+)[\x27"]/);
          if (hashMatch) {
            rawHash = hashMatch[1];
          }
          if (metaTitle === 'Eporner Video') {
            const titleMatch = pageHtml.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) {
              metaTitle = titleMatch[1].replace(/- EPORNER.*$/i, '').trim();
            }
          }

          // Extract og:image if higher quality cover is available
          const ogImgMatch = pageHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                             pageHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          if (ogImgMatch && ogImgMatch[1]) {
            thumbnailUrl = ogImgMatch[1].trim();
          }

          // Extract date from meta or schema tags
          if (!uploadDate) {
            const dateMetaMatch = pageHtml.match(/<meta[^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished|video:release_date)["'][^>]+content=["']([^"']+)["']/i) ||
                                  pageHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished|video:release_date)["']/i);
            if (dateMetaMatch && dateMetaMatch[1]) {
              const dStr = dateMetaMatch[1].trim();
              const m = dStr.match(/^(\d{4}-\d{2}-\d{2})/);
              if (m) {
                uploadDate = m[1];
              } else {
                const d = new Date(dStr);
                if (!isNaN(d.getTime())) uploadDate = d.toISOString().split('T')[0];
              }
            }
          }

          // Extract actors / pornstars from links (e.g. /pornstar/name or /model/name)
          const pornstarMatches = [...pageHtml.matchAll(/<a[^>]+href=["']\/(?:pornstar|model)\/([^"'/?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
          for (const pm of pornstarMatches) {
            const slug = pm[1];
            const rawTxt = pm[2].replace(/<[^>]+>/g, '').trim();
            const actorName = rawTxt || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            if (actorName && !extractedActors.some(a => a.toLowerCase() === actorName.toLowerCase())) {
              extractedActors.push(actorName);
            }
          }
        }
      } catch (e) {
        console.warn('[Eporner] Main page fetch failed:', e);
      }

      // If hash not found yet, fetch Embed page
      if (!rawHash) {
        try {
          const embedRes = await fetch(`https://www.eporner.com/embed/${videoId}/`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': `https://www.eporner.com/video-${videoId}/-/`
            }
          });

          if (embedRes.ok) {
            const embedHtml = await embedRes.text();
            const hashMatch = embedHtml.match(/EP\.video\.player\.hash\s*=\s*[\x27"]([a-zA-Z0-9]+)[\x27"]/);
            if (hashMatch) {
              rawHash = hashMatch[1];
            }
          }
        } catch (e) {
          console.warn('[Eporner] Embed fetch failed:', e);
        }
      }

      if (!rawHash) {
        return res.status(404).json({ error: 'Could not extract player authentication hash from Eporner' });
      }

      const encodedHash = encodeEpornerHash(rawHash);
      const timestamp = Date.now();
      const xhrUrl = `https://www.eporner.com/xhr/video/${videoId}?hash=${encodedHash}&device=generic&domain=www.eporner.com&fallback=false&supportedFormats=mp4%2Chls&_=${timestamp}`;

      const xhrRes = await fetch(xhrUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': `https://www.eporner.com/embed/${videoId}/`,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01'
        }
      });

      if (!xhrRes.ok) {
        return res.status(xhrRes.status).json({ error: `Eporner XHR returned HTTP ${xhrRes.status}` });
      }

      const xhrData = await xhrRes.json();
      const sourcesMp4 = xhrData.sources?.mp4 || {};

      const files: any[] = [];
      const qualityOrder: { [key: string]: number } = {
        '2160p': 100,
        '1440p': 90,
        '1080p': 80,
        '720p': 70,
        '480p': 60,
        '360p': 50,
        '240p': 40
      };

      const qualityLabels: { [key: string]: string } = {
        '2160p': '2160p (4K UHD)',
        '1440p': '1440p (2K QHD)',
        '1080p': '1080p (Full HD)',
        '720p': '720p (HD)',
        '480p': '480p (SD)',
        '360p': '360p (LQ)',
        '240p': '240p (Low)'
      };

      for (const [key, val] of Object.entries(sourcesMp4) as [string, any][]) {
        if (!val || !val.src) continue;
        const shortLabel = val.labelShort || key.split(' ')[0] || 'HD';
        const cleanQuality = shortLabel.toLowerCase().replace(/[^0-9p]/g, '');
        const fullLabel = qualityLabels[cleanQuality] || `${shortLabel} HD`;

        files.push({
          id: cleanQuality || shortLabel,
          name: `${metaTitle} - ${shortLabel}`,
          mimeType: 'video/mp4',
          quality: cleanQuality || shortLabel,
          label: fullLabel,
          directStreamUrl: val.src,
          cdnUrl: val.src,
          downloadUrl: val.src,
          streamProxyUrl: `/api/eporner/stream?target=${encodeURIComponent(val.src)}`,
          thumbnailUrl: thumbnailUrl || undefined,
          isDefault: val.default || false,
          order: qualityOrder[cleanQuality] || 50
        });
      }

      // Sort files by quality descending (2160p -> 1440p -> 1080p -> 720p -> 480p -> 360p -> 240p)
      files.sort((a, b) => b.order - a.order);

      // Strictly enable ONLY 1080p (Full HD) and 2160p (4K UHD) as requested
      const highQualityOnly = files.filter(f => f.quality === '2160p' || f.quality === '1080p');
      const finalFiles = highQualityOnly.length > 0 ? highQualityOnly : files;

      if (finalFiles.length === 0) {
        return res.status(404).json({ error: 'No playable video streams found on Eporner' });
      }

      const file4K = finalFiles.find(f => f.quality === '2160p') || null;
      const file1080 = finalFiles.find(f => f.quality === '1080p') || null;
      const defaultFile = file1080 || file4K || finalFiles[0];

      const responseData = {
        id: videoId,
        title: metaTitle,
        url: defaultFile.directStreamUrl,
        directStreamUrl: defaultFile.directStreamUrl,
        downloadUrl: defaultFile.downloadUrl,
        streamProxyUrl: defaultFile.streamProxyUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        duration: duration || undefined,
        quality: defaultFile.quality,
        file4K,
        file1080,
        files: finalFiles,
        views,
        rate,
        date: uploadDate,
        dateStr: uploadDate,
        actors: extractedActors,
        actress: extractedActors[0] || undefined,
        actorImages
      };

      epornerExtractCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + 30 * 60 * 1000 });
      return res.json(responseData);
    } catch (error: any) {
      console.error('Eporner extraction error:', error);
      return res.status(500).json({ error: error.message || 'Failed to extract video data from Eporner' });
    }
  });

  // Eporner Video Stream Proxy with High-Speed Adaptive 206 Chunking & CORS Bypass
  app.get('/api/eporner/stream', async (req, res) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();
      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.eporner.com/'
      };

      const rawRange = req.headers.range;
      const knownTotalSize = epornerSizeCache.get(targetUrl) || 0;

      // Adaptive Chunk Sizing: 16MB initial buffer / 24MB scrubbing buffer
      const CHUNK_SIZE_INIT = 16 * 1024 * 1024;
      const CHUNK_SIZE_SEEK = 24 * 1024 * 1024;

      if (rawRange) {
        const rangeMatch = rawRange.match(/^bytes=(\d+)-(\d*)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10) || 0;
          const endStr = rangeMatch[2];
          if (endStr) {
            headers['Range'] = rawRange;
          } else {
            const effectiveChunk = start === 0 ? CHUNK_SIZE_INIT : CHUNK_SIZE_SEEK;
            let chunkEnd = start + effectiveChunk - 1;
            if (knownTotalSize > 0 && chunkEnd >= knownTotalSize) {
              chunkEnd = knownTotalSize - 1;
            }
            headers['Range'] = `bytes=${start}-${chunkEnd}`;
          }
        } else {
          headers['Range'] = rawRange;
        }
      } else {
        headers['Range'] = `bytes=0-${CHUNK_SIZE_INIT - 1}`;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(targetUrl, {
        headers,
        signal: abortController.signal
      });

      const status = originRes.status;
      res.status(status);

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const contentType = originRes.headers.get('content-type');
      res.setHeader('Content-Type', (contentType && contentType.startsWith('video/')) ? contentType : 'video/mp4');

      const contentLength = originRes.headers.get('content-length');
      const contentRange = originRes.headers.get('content-range');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
        const match = contentRange.match(/\/(\d+)$/);
        if (match && match[1]) {
          const total = parseInt(match[1], 10);
          if (total > 0) {
            epornerSizeCache.set(targetUrl, total);
          }
        }
      } else if (rawRange && status === 206 && contentLength) {
        const total = knownTotalSize || parseInt(contentLength, 10);
        res.setHeader('Content-Range', `bytes 0-${parseInt(contentLength, 10) - 1}/${total}`);
      }

      res.setHeader('Content-Disposition', 'inline; filename="eporner_video.mp4"');

      if (originRes.body) {
        const nodeStream = Readable.fromWeb(originRes.body as any);
        nodeStream.on('error', () => {});
        res.on('error', () => {});
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming eporner file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream Eporner file');
      }
    }
  });

  // ==========================================
  // Video Resolver & Pornhub Extraction Engine
  // ==========================================
  const handlePornhubResolve = async (req: express.Request, res: express.Response) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing video URL', code: 'INVALID_VIDEO_PAGE' });
      }

      const rawInput = url.trim().replace(/[\]\)\>\"\'\s]+$/, '');
      const queryMatch = rawInput.match(/[?&]viewkey=([a-zA-Z0-9]+)/i);
      const embedMatch = rawInput.match(/pornhub(?:premium)?\.com\/embed\/([a-zA-Z0-9]+)/i);
      const rawMatch = /^[a-zA-Z0-9]{10,20}$/.test(rawInput) ? rawInput : null;
      const viewkey = queryMatch ? queryMatch[1] : (embedMatch ? embedMatch[1] : rawMatch);

      if (!viewkey) {
        return res.status(400).json({ error: 'Invalid Pornhub video page URL or ViewKey', code: 'INVALID_VIDEO_PAGE' });
      }

      // Check cache
      const cached = pornhubExtractCache.get(viewkey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      // 1. Fetch main video page
      const pageUrl = `https://www.pornhub.com/view_video.php?viewkey=${viewkey}`;
      const pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!pageRes.ok) {
        if (pageRes.status === 404) {
          return res.status(404).json({ error: 'Video not found or has been removed', code: 'SOURCE_NOT_FOUND' });
        }
        return res.status(pageRes.status).json({ error: `Video page returned status ${pageRes.status}`, code: 'NETWORK_ERROR' });
      }

      const setCookies = pageRes.headers.getSetCookie ? pageRes.headers.getSetCookie() : [pageRes.headers.get('set-cookie') || ''];
      const cookieStr = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');

      const html = await pageRes.text();

      // Check for unavailable / deleted video
      if (html.includes('This video has been disabled') || html.includes('video has been removed') || html.includes('Page Not Found')) {
        return res.status(404).json({ error: 'Video is disabled, removed, or unavailable', code: 'SOURCE_NOT_FOUND' });
      }

      // 2. Parse flashvars
      let flashvars: any = null;
      const flashvarsMatch = html.match(/flashvars_\d+\s*=\s*(\{.+?\});/);
      if (flashvarsMatch) {
        try {
          flashvars = JSON.parse(flashvarsMatch[1]);
        } catch (e) {}
      }

      // Fallback: check embed page if flashvars not found on main page
      if (!flashvars) {
        try {
          const embedUrl = `https://www.pornhub.com/embed/${viewkey}`;
          const embedRes = await fetch(embedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': pageUrl,
              'Cookie': cookieStr,
            },
          });
          if (embedRes.ok) {
            const embedHtml = await embedRes.text();
            const embedMatch = embedHtml.match(/flashvars_\d+\s*=\s*(\{.+?\});/);
            if (embedMatch) {
              flashvars = JSON.parse(embedMatch[1]);
            }
          }
        } catch (e) {}
      }

      if (!flashvars || !flashvars.mediaDefinitions) {
        return res.status(404).json({ error: 'Could not extract media player configuration from video page', code: 'PARSING_ERROR' });
      }

      const title = (flashvars.video_title || 'Pornhub Video').replace(/\+/g, ' ').trim();
      const duration = parseInt(flashvars.video_duration, 10) || undefined;
      const thumbnailUrl = flashvars.image_url || undefined;
      const mediaDefinitions: any[] = flashvars.mediaDefinitions || [];

      // Extract video date (JSON-LD, meta tags)
      let uploadDateStr: string | undefined;
      let dateTimestamp: number | undefined;

      // Extract actors / pornstars and photos (pornstarsWrapper, JSON-LD, meta tags, From model block)
      const extractedActors: string[] = [];
      const actorImages: Record<string, string> = {};
      const actorDetails: Array<{ name: string; slug?: string; imageUrl?: string }> = [];

      const addActorEntry = (name: string, slug?: string, img?: string) => {
        const clean = (name || '').replace(/<[^>]+>/g, ' ').replace(/avatar/gi, '').replace(/\s+/g, ' ').trim();
        if (!clean) return;
        if (/^(channels?|users?|pornhub|verified\s*model|member)$/i.test(clean)) return;

        if (!extractedActors.some(a => a.toLowerCase() === clean.toLowerCase())) {
          extractedActors.push(clean);
          actorDetails.push({ name: clean, slug, imageUrl: img || undefined });
        }
        if (img && !actorImages[clean] && !img.includes('default/pornhub')) {
          actorImages[clean] = img;
        }
      };

      // A. Extract from JSON-LD
      const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      for (const m of ldMatches) {
        try {
          const data = JSON.parse(m[1]);
          if (data['@type'] === 'VideoObject') {
            if (!uploadDateStr && (data.uploadDate || data.datePublished)) {
              uploadDateStr = data.uploadDate || data.datePublished;
            }
            if (data.actor) {
              const ldActors = Array.isArray(data.actor) ? data.actor : [data.actor];
              for (const act of ldActors) {
                const actName = typeof act === 'string' ? act : act?.name;
                if (actName && typeof actName === 'string') {
                  addActorEntry(actName.trim());
                }
              }
            }
          }
        } catch (e) {}
      }

      // B. Extract date from meta tags if not found in JSON-LD
      if (!uploadDateStr) {
        const metaDate = html.match(/<meta[^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished|video:release_date)["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished|video:release_date)["']/i);
        if (metaDate && metaDate[1]) {
          uploadDateStr = metaDate[1].trim();
        }
      }

      if (uploadDateStr) {
        const parsed = Date.parse(uploadDateStr);
        if (!isNaN(parsed)) {
          dateTimestamp = parsed;
        }
      }

      // C. Extract pornstars and photos from pornstarsWrapper
      const pWrapperMatch = html.match(/<div[^>]*class=["'][^"']*pornstarsWrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (pWrapperMatch) {
        const wrapperContent = pWrapperMatch[1];
        const linkMatches = [...wrapperContent.matchAll(/<a[^>]*href=["']\/(?:model|pornstar)\/([^"'/?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
        for (const lm of linkMatches) {
          const slug = lm[1];
          const innerHtml = lm[2];
          let innerText = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          innerText = innerText.replace(/avatar/gi, '').trim();
          const name = innerText || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          let photoUrl = '';
          const imgMatch = innerHtml.match(/<img[^>]+(?:src|data-src|data-thumb|data-image|data-original)=["']([^"']+)["']/i);
          if (imgMatch && imgMatch[1] && !imgMatch[1].includes('default/pornhub')) {
            photoUrl = imgMatch[1].trim();
          }

          addActorEntry(name, slug, photoUrl);
        }
      }

      // D. Extract from meta property="video:actor"
      const metaActors = [...html.matchAll(/<meta[^>]*property=["']video:actor["'][^>]*content=["']([^"']+)["']/gi)];
      for (const ma of metaActors) {
        const val = ma[1]?.trim();
        if (val) {
          addActorEntry(val);
        }
      }

      // E. Check From block: <div class="from"> From: ... <a href="/model/blondessa">Blondessa</a>
      if (extractedActors.length === 0) {
        const fromMatch = html.match(/<div[^>]*class=["'][^"']*from[^"']*["'][^>]*>([\s\S]{1,800}?)<\/div>/i);
        if (fromMatch) {
          const modelLink = fromMatch[1].match(/<a[^>]*href=["']\/(?:model|pornstar)\/([^"'/?]+)["'][^>]*>([\s\S]*?)<\/a>/i);
          if (modelLink) {
            const slug = modelLink[1];
            const name = modelLink[2].replace(/<[^>]+>/g, '').trim() || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            addActorEntry(name, slug);
          }
        }
      }

      // F. Fallback: check JSON-LD VideoObject author
      if (extractedActors.length === 0) {
        for (const m of ldMatches) {
          try {
            const data = JSON.parse(m[1]);
            if (data['@type'] === 'VideoObject' && data.author) {
              const authorName = typeof data.author === 'string' ? data.author : data.author?.name;
              if (authorName && typeof authorName === 'string') {
                const cleanAuthor = authorName.trim();
                if (!/^(pornhub|channels?)$/i.test(cleanAuthor)) {
                  addActorEntry(cleanAuthor);
                }
              }
            }
          } catch (e) {}
        }
      }

      // G. Check main video uploader block (only for model or pornstar, never channels)
      if (extractedActors.length === 0) {
        const uploaderMatch = html.match(/<div[^>]*class=["'][^"']*videoUploaderBlock[^"']*["'][\s\S]{1,800}?<\/div>/i);
        if (uploaderMatch) {
          const uBlock = uploaderMatch[0];
          const modelLink = uBlock.match(/<a[^>]*href=["']\/(?:model|pornstar)\/([^"'/?]+)["'][^>]*>([\s\S]*?)<\/a>/i);
          if (modelLink) {
            const slug = modelLink[1];
            let name = modelLink[2].replace(/<[^>]+>/g, ' ').trim();
            name = name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            let photoUrl = '';
            const imgMatch = uBlock.match(/<img[^>]+(?:src|data-src|data-thumb|data-image|data-original)=["']([^"']+)["']/i);
            if (imgMatch && imgMatch[1] && !imgMatch[1].includes('default/pornhub')) {
              photoUrl = imgMatch[1].trim();
            }
            addActorEntry(name, slug, photoUrl);
          }
        }
      }

      // H. If primary actor is missing photo, search for image in page or profile
      const primaryActor = actorDetails[0];
      if (primaryActor && (!primaryActor.imageUrl || !actorImages[primaryActor.name])) {
        // Search in page HTML for image with alt or title matching actor name
        const escapedName = primaryActor.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pageAvatarMatch = html.match(new RegExp(`<img[^>]+(?:alt|title)=["\']${escapedName}["\'][^>]+(?:src|data-src)=["\']([^"\']+)["\']`, 'i')) ||
                                html.match(new RegExp(`<img[^>]+(?:src|data-src)=["\']([^"\']+)["\'][^>]+(?:alt|title)=["\']${escapedName}["\']`, 'i'));
        if (pageAvatarMatch && pageAvatarMatch[1] && !pageAvatarMatch[1].includes('default/pornhub')) {
          primaryActor.imageUrl = pageAvatarMatch[1];
          actorImages[primaryActor.name] = pageAvatarMatch[1];
        } else {
          // Fetch model/pornstar profile
          const slug = primaryActor.slug || primaryActor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          try {
            const profilePaths = [`/model/${slug}`, `/pornstar/${slug}`];
            for (const path of profilePaths) {
              const pRes = await fetch(`https://www.pornhub.com${path}`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                },
                signal: AbortSignal.timeout(3000),
              });
              if (pRes.ok) {
                const pHtml = await pRes.text();
                const aImg = pHtml.match(/<img[^>]+id=["'](?:getAvatar|thumb_avatar)["'][^>]+src=["']([^"']+)["']/i) ||
                             pHtml.match(/<img[^>]+src=["']([^"']+)["'][^>]+id=["'](?:getAvatar|thumb_avatar)["']/i) ||
                             pHtml.match(/<img[^>]+class=["'](?:avatar|thumb_avatar)[^"']*["'][^>]+src=["']([^"']+)["']/i);
                if (aImg && aImg[1] && !aImg[1].includes('default/pornhub')) {
                  primaryActor.imageUrl = aImg[1];
                  actorImages[primaryActor.name] = aImg[1];
                  break;
                }
              }
            }
          } catch (e) {}
        }
      }

      const actressImage = extractedActors[0] ? actorImages[extractedActors[0]] : undefined;

      const rawStreams: any[] = [];
      let hlsMasterUrl: string | undefined;

      // 3. Check for MP4 media via get_media endpoint
      const mp4Def = mediaDefinitions.find((m: any) => m.format === 'mp4' && m.videoUrl);
      if (mp4Def && mp4Def.videoUrl) {
        try {
          const mediaRes = await fetch(mp4Def.videoUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': pageUrl,
              'Cookie': cookieStr,
            },
          });
          if (mediaRes.ok) {
            const mediaList = await mediaRes.json();
            if (Array.isArray(mediaList)) {
              for (const item of mediaList) {
                if (item.videoUrl) {
                  const qHeight = parseInt(item.quality || item.height, 10);
                  const quality = qHeight ? `${qHeight}p` : (item.quality || 'Auto');
                  const width = item.width ? parseInt(item.width, 10) : undefined;
                  const height = item.height ? parseInt(item.height, 10) : qHeight || undefined;

                  // Extract bitrate estimate from URL if available (e.g. 1080P_4000K)
                  let bitrate: number | undefined;
                  const bwMatch = item.videoUrl.match(/_(\d+)K_/i);
                  if (bwMatch) {
                    bitrate = parseInt(bwMatch[1], 10) * 1000 * 8; // in bps
                  }

                  const proxyStreamUrl = `/api/video-resolver/stream?target=${encodeURIComponent(item.videoUrl)}`;

                  rawStreams.push({
                    id: `mp4-${quality}`,
                    url: proxyStreamUrl,
                    directUrl: item.videoUrl,
                    streamProxyUrl: proxyStreamUrl,
                    downloadUrl: item.videoUrl,
                    type: 'mp4',
                    quality,
                    width,
                    height,
                    bitrate,
                    codec: 'h264/aac',
                    mimeType: 'video/mp4',
                    isDefault: Boolean(item.defaultQuality),
                  });
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Pornhub] get_media call failed:', e);
        }
      }

      // 4. Check for HLS master streams
      const hlsDefs = mediaDefinitions.filter((m: any) => m.format === 'hls' && m.videoUrl);
      for (const hlsDef of hlsDefs) {
        const qHeight = parseInt(hlsDef.quality || hlsDef.height, 10);
        const quality = qHeight ? `${qHeight}p` : (hlsDef.quality || 'Auto');
        const proxyStreamUrl = `/api/video-resolver/stream?target=${encodeURIComponent(hlsDef.videoUrl)}`;
        
        if (!hlsMasterUrl) {
          hlsMasterUrl = proxyStreamUrl;
        }

        // If no MP4 streams were found, use HLS variants
        if (rawStreams.length === 0) {
          rawStreams.push({
            id: `hls-${quality}`,
            url: proxyStreamUrl,
            directUrl: hlsDef.videoUrl,
            streamProxyUrl: proxyStreamUrl,
            downloadUrl: hlsDef.videoUrl,
            type: 'hls',
            quality,
            width: hlsDef.width,
            height: hlsDef.height || qHeight,
            mimeType: 'application/x-mpegURL',
            isDefault: Boolean(hlsDef.defaultQuality),
          });
        }
      }

      if (rawStreams.length === 0) {
        return res.status(404).json({ error: 'No playable video streams discovered', code: 'SOURCE_NOT_FOUND' });
      }

      // 5. Strictly isolate 1080p quality only, with label strictly as "1080p" without extra words
      const streams1080 = rawStreams.filter(s => s.quality === '1080p' || s.height === 1080);
      const selectedRawStreams = streams1080.length > 0 ? [streams1080[0]] : [rawStreams[0]];

      const streams = selectedRawStreams.map((s) => ({
        ...s,
        label: s.quality || '1080p',
        name: s.quality || '1080p',
        isDefault: true,
      }));

      const defaultStream = streams[0];

      // Minimum expiry timestamp from signed URLs (default 2 hours)
      let minExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
      for (const s of streams) {
        const expMatch = s.directUrl?.match(/validto=(\d+)/i) || s.directUrl?.match(/exp=(\d+)/i) || s.directUrl?.match(/e=(\d+)/i);
        if (expMatch && expMatch[1]) {
          const expSec = parseInt(expMatch[1], 10);
          if (expSec > 0 && expSec * 1000 < minExpiresAt) {
            minExpiresAt = expSec * 1000;
          }
        }
      }

      const activeStream = defaultStream || streams[0];
      const result = {
        id: viewkey,
        provider: 'pornhub',
        pageUrl,
        title,
        duration,
        thumbnailUrl,
        uploadDate: uploadDateStr,
        date: dateTimestamp,
        actors: extractedActors,
        actress: extractedActors[0] || undefined,
        actressImage,
        actorImages,
        actorDetails,
        studio: 'PrnHub',
        streams,
        defaultStream,
        hlsMasterUrl,
        // Full compatibility fields
        url: activeStream?.url || activeStream?.streamProxyUrl,
        directStreamUrl: activeStream?.directUrl,
        downloadUrl: activeStream?.downloadUrl,
        streamProxyUrl: activeStream?.streamProxyUrl,
        quality: activeStream?.quality || '1080p',
        files: streams.map((s) => ({
          id: s.id,
          name: s.label,
          label: s.label,
          quality: s.quality,
          format: s.type,
          directStreamUrl: s.directUrl,
          streamProxyUrl: s.streamProxyUrl,
          downloadUrl: s.downloadUrl,
          isDefault: s.isDefault,
          width: s.width,
          height: s.height,
          bitrate: s.bitrate,
        })),
        createdAt: Date.now(),
        expiresAt: minExpiresAt,
      };

      // Cache result for 1 hour or until expiresAt
      const ttl = Math.min(minExpiresAt - Date.now(), 60 * 60 * 1000);
      if (ttl > 60000) {
        pornhubExtractCache.set(viewkey, { data: result, expiresAt: Date.now() + ttl });
      }

      return res.json(result);
    } catch (error: any) {
      console.error('[Pornhub] Resolution error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to resolve video from Pornhub',
        code: 'NETWORK_ERROR',
      });
    }
  };

  // ==========================================
  // Video Resolver: xHamster Extraction Engine
  // ==========================================
  const decodeXhUrlServer = (raw: string): string | null => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    const len = trimmed.length;
    if (len < 12 || (len & 1) !== 0 || !/^[0-9a-fA-F]+$/.test(trimmed)) return null;

    const bytes = new Array(len >> 1);
    for (let i = 0, b = 0; i < len; i += 2) {
      const val = parseInt(trimmed.substr(i, 2), 16);
      if (isNaN(val)) return null;
      bytes[b++] = val;
    }
    if (bytes.length < 5) return null;

    const algo = bytes[0] | 0;
    if (algo < 1 || algo > 7) return null;

    const seed = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);
    const n = Math.imul;
    let s = seed | 0;

    let prng: (() => number) | null = null;
    if (algo === 1) prng = () => 255 & ((s = n(s, 1664525) + 0x3c6ef35f | 0));
    else if (algo === 2) prng = () => { s |= 0; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return 255 & (s |= 0); };
    else if (algo === 3) prng = () => {
      let e = s = (s + 0x9e3779b9) | 0;
      e ^= e >>> 16; e = n(e, 0x85ebca77) | 0;
      e ^= e >>> 13; e = n(e, 0xc2b2ae3d) | 0;
      return 255 & (e ^ (e >>> 16));
    };
    else if (algo === 4) prng = () => {
      let e = ((s = (s + 0x6d2b79f5) | 0) << 7) | (s >>> 25);
      e = (e + 0x9e3779b9) | 0;
      e ^= e >>> 11;
      return 255 & (e = n(e, 0x27d4eb2d) | 0);
    };
    else if (algo === 5) prng = () => {
      s |= 0; s ^= s << 7; s ^= s >>> 9; s ^= s << 8;
      return 255 & ((s = (s + 0xa5a5a5a5) | 0));
    };
    else if (algo === 6) prng = () => 255 & (((s = n(s, 0x2c9277b5) + 0xac564b05 | 0) ^ (s >>> 18)) >>> ((s >>> 27) & 31));
    else if (algo === 7) prng = () => {
      let e = ((s = (s + 0x9e3779b9) | 0) ^ (s << 5));
      e = n(e, 0x7feb352d) | 0;
      e ^= e >>> 15;
      return 255 & (e = n(e, 0x846ca68b) | 0);
    };

    if (!prng) return null;

    const outBytes = new Array(bytes.length - 5);
    for (let a = 5, l = 0; a < bytes.length; a++, l++) {
      outBytes[l] = (bytes[a] ^ prng()) & 255;
    }

    let hexEncoded = '';
    for (let i = 0; i < outBytes.length; i++) {
      let hex = outBytes[i].toString(16);
      if (hex.length < 2) hex = '0' + hex;
      hexEncoded += '%' + hex;
    }

    try {
      return decodeURIComponent(hexEncoded);
    } catch (e) {
      let str = '';
      for (let i = 0; i < outBytes.length; i++) str += String.fromCharCode(outBytes[i]);
      return str;
    }
  };

  const handleXhamsterResolve = async (req: express.Request, res: express.Response) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing video URL', code: 'INVALID_VIDEO_PAGE' });
      }

      const rawInput = url.trim().replace(/[\]\)\>\"\'\s]+$/, '');
      let targetUrl = rawInput;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `https://xhamster.com/videos/${rawInput}`;
      }

      const slugMatch = targetUrl.match(/(?:videos|embed)\/([a-zA-Z0-9_-]+)/i);
      const videoId = slugMatch ? slugMatch[1] : targetUrl;

      // Check in-memory cache
      const cached = xhamsterExtractCache.get(videoId);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      // Fetch xHamster video page
      const pageRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!pageRes.ok) {
        if (pageRes.status === 404) {
          return res.status(404).json({ error: 'Video not found or has been removed', code: 'SOURCE_NOT_FOUND' });
        }
        return res.status(pageRes.status).json({ error: `Video page returned status ${pageRes.status}`, code: 'NETWORK_ERROR' });
      }

      const html = await pageRes.text();

      // Check if disabled or removed
      if (html.includes('This video has been disabled') || html.includes('video has been removed') || html.includes('Page Not Found')) {
        return res.status(404).json({ error: 'Video is disabled, removed, or unavailable', code: 'SOURCE_NOT_FOUND' });
      }

      // Parse window.initials
      let initials: any = null;
      const initialsMatch = html.match(/window\.initials\s*=\s*(\{[\s\S]*?\});/);
      if (initialsMatch) {
        try {
          initials = JSON.parse(initialsMatch[1]);
        } catch (e) {}
      }

      const title = initials?.videoModel?.title ||
                    initials?.videoEntity?.title ||
                    initials?.videoTitle?.pageTitle ||
                    (html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/- xHamster.*$/i, '').trim()) ||
                    'xHamster Video';

      const duration = initials?.videoModel?.duration ||
                       initials?.videoEntity?.duration ||
                       initials?.xplayerSettings?.duration ||
                       undefined;

      const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) || html.match(/content="([^"]+)"\s+property="og:image"/i);
      const twImageMatch = html.match(/name="twitter:image"\s+content="([^"]+)"/i) || html.match(/content="([^"]+)"\s+name="twitter:image"/i);
      const thumbnailUrl = ogImageMatch?.[1] || twImageMatch?.[1] || initials?.videoModel?.spriteURL || undefined;

      // Extract upload/release date
      let uploadDateStr: string | undefined;
      let dateTimestamp: number | undefined;

      const createdSec = initials?.videoModel?.created || initials?.videoEntity?.created;
      if (typeof createdSec === 'number' && createdSec > 0) {
        dateTimestamp = createdSec * 1000;
        uploadDateStr = new Date(dateTimestamp).toISOString();
      } else if (initials?.videoModel?.uploadDate || initials?.videoEntity?.uploadDate) {
        uploadDateStr = initials?.videoModel?.uploadDate || initials?.videoEntity?.uploadDate;
        const parsed = Date.parse(uploadDateStr!);
        if (!isNaN(parsed)) dateTimestamp = parsed;
      }

      // JSON-LD fallback for date
      if (!uploadDateStr) {
        const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
        for (const m of ldMatches) {
          try {
            const data = JSON.parse(m[1]);
            if (data['@type'] === 'VideoObject') {
              const d = data.uploadDate || data.datePublished || data.dateCreated;
              if (d) {
                uploadDateStr = d;
                const parsed = Date.parse(d);
                if (!isNaN(parsed)) dateTimestamp = parsed;
                break;
              }
            }
          } catch (e) {}
        }
      }

      // Meta tags fallback for date
      if (!uploadDateStr) {
        const metaDate = html.match(/<meta[^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished|dateCreated|video:release_date)["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished|dateCreated|video:release_date)["']/i);
        if (metaDate && metaDate[1]) {
          uploadDateStr = metaDate[1].trim();
          const parsed = Date.parse(uploadDateStr);
          if (!isNaN(parsed)) dateTimestamp = parsed;
        }
      }

      const sources = initials?.xplayerSettings?.sources || {};

      // Decode HLS master playlist URL
      let hlsMasterUrl: string | undefined;
      const rawHlsUrl = sources.hls?.h264?.url || sources.hls?.av1?.url || sources.hls?.h264?.fallback || sources.hls?.av1?.fallback;
      if (rawHlsUrl) {
        hlsMasterUrl = decodeXhUrlServer(rawHlsUrl) || undefined;
      }

      // Fallback: check standard auto sources or preload links in HTML for m3u8
      if (!hlsMasterUrl) {
        const stdAutoH264 = sources.standard?.h264?.find((s: any) => s.quality === 'auto')?.url;
        const stdAutoAv1 = sources.standard?.av1?.find((s: any) => s.quality === 'auto')?.url;
        if (stdAutoH264) hlsMasterUrl = decodeXhUrlServer(stdAutoH264) || undefined;
        if (!hlsMasterUrl && stdAutoAv1) hlsMasterUrl = decodeXhUrlServer(stdAutoAv1) || undefined;
      }
      if (!hlsMasterUrl) {
        const m3u8HtmlMatch = html.match(/https?:\/\/[^\s\"']+\.m3u8[^\s\"']*/i);
        if (m3u8HtmlMatch) {
          hlsMasterUrl = m3u8HtmlMatch[0];
        }
      }

      const rawStreams: any[] = [];

      // If we have HLS master URL, fetch master playlist and extract all variant quality streams
      if (hlsMasterUrl) {
        try {
          const hlsRes = await fetch(hlsMasterUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': targetUrl,
              'Origin': 'https://xhamster.com',
            },
          });

          if (hlsRes.ok) {
            const playlistText = await hlsRes.text();
            const baseUrl = hlsMasterUrl.substring(0, hlsMasterUrl.lastIndexOf('/') + 1);
            const lines = playlistText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
                const inf = lines[i];
                const uri = lines[i + 1];
                if (!uri || uri.startsWith('#')) continue;

                const resMatch = inf.match(/RESOLUTION=(\d+)x(\d+)/i);
                const bwMatch = inf.match(/BANDWIDTH=(\d+)/i);
                const fpsMatch = inf.match(/FRAME-RATE=([0-9.]+)/i);
                const codecsMatch = inf.match(/CODECS="([^"]+)"/i);

                const width = resMatch ? parseInt(resMatch[1], 10) : undefined;
                const height = resMatch ? parseInt(resMatch[2], 10) : undefined;
                const bitrate = bwMatch ? parseInt(bwMatch[1], 10) : undefined;
                const fps = fpsMatch ? Math.round(parseFloat(fpsMatch[1])) : undefined;
                const codec = codecsMatch ? codecsMatch[1] : undefined;

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

                const variantUrl = uri.startsWith('http://') || uri.startsWith('https://') ? uri : `${baseUrl}${uri}`;
                const proxyUrl = `/api/video-resolver/stream?target=${encodeURIComponent(variantUrl)}`;

                const mbps = bitrate ? (bitrate / 1000000).toFixed(1) : null;
                const resText = width && height ? `${width}×${height}` : '';
                let label = quality;
                if (resText && mbps) label = `${quality} (${resText} • ${mbps} Mbps)`;
                else if (resText) label = `${quality} (${resText})`;
                else if (mbps) label = `${quality} (${mbps} Mbps)`;

                rawStreams.push({
                  id: `hls-${quality}`,
                  url: variantUrl, // direct stream URL (xhcdn supports Access-Control-Allow-Origin: *)
                  directUrl: variantUrl,
                  streamProxyUrl: proxyUrl,
                  downloadUrl: variantUrl,
                  type: 'hls',
                  quality,
                  label,
                  name: quality,
                  width,
                  height,
                  bitrate,
                  fps,
                  codec,
                  mimeType: 'application/x-mpegURL',
                  isDefault: quality === '1080p',
                });
              }
            }
          }
        } catch (hlsErr) {
          console.warn('[xHamster] Master playlist fetch failed:', hlsErr);
        }

        // Add master adaptive stream
        const masterProxy = `/api/video-resolver/stream?target=${encodeURIComponent(hlsMasterUrl)}`;
        rawStreams.push({
          id: 'hls-auto',
          url: hlsMasterUrl,
          directUrl: hlsMasterUrl,
          streamProxyUrl: masterProxy,
          downloadUrl: hlsMasterUrl,
          type: 'hls',
          quality: 'Auto',
          label: 'Auto (Adaptive Multi-Bitrate)',
          name: 'Auto',
          mimeType: 'application/x-mpegURL',
          isDefault: false,
        });
      }

      // Check for standard MP4 streams in sources
      if (sources.standard) {
        const stdList = [...(sources.standard.h264 || []), ...(sources.standard.av1 || [])];
        for (const item of stdList) {
          if (!item.url || item.quality === 'auto') continue;
          const decoded = decodeXhUrlServer(item.url);
          if (decoded && decoded.endsWith('.mp4')) {
            const q = item.quality || item.label || '720p';
            const proxy = `/api/video-resolver/stream?target=${encodeURIComponent(decoded)}`;
            rawStreams.push({
              id: `mp4-${q}`,
              url: proxy,
              directUrl: decoded,
              streamProxyUrl: proxy,
              downloadUrl: decoded,
              type: 'mp4',
              quality: q,
              label: `${q} (MP4 Direct)`,
              name: q,
              mimeType: 'video/mp4',
              isDefault: false,
            });
          }
        }
      }

      if (rawStreams.length === 0) {
        return res.status(404).json({ error: 'No playable video streams discovered for this xHamster video', code: 'SOURCE_NOT_FOUND' });
      }

      // Sort descending: 2160p (4K) -> 1440p -> 1080p -> 720p -> 480p -> 360p -> 240p -> 144p -> Auto
      const qualityWeights: Record<string, number> = {
        '4K': 2160, '2160p': 2160, '1440p': 1440, '1080p': 1080,
        '720p': 720, '480p': 480, '360p': 360, '240p': 240, '144p': 144, 'Auto': 50
      };

      rawStreams.sort((a, b) => {
        const weightA = qualityWeights[a.quality] || (a.height || 0);
        const weightB = qualityWeights[b.quality] || (b.height || 0);
        if (weightA !== weightB) return weightB - weightA;
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

      // Filter xHamster streams: only allow 1080 and 2160 if present, and rename simply to '1080p' and '2160p'
      let finalStreams = rawStreams;
      const stream2160 = rawStreams.find(s => s.quality === '2160p' || s.quality === '4K' || s.height === 2160 || (s.id && s.id.includes('2160')));
      const stream1080 = rawStreams.find(s => s.quality === '1080p' || s.height === 1080 || (s.id && s.id.includes('1080')));

      if (stream2160 || stream1080) {
        const filtered: typeof rawStreams = [];
        if (stream2160) {
          filtered.push({
            ...stream2160,
            quality: '2160p',
            label: '2160p',
          });
        }
        if (stream1080) {
          filtered.push({
            ...stream1080,
            quality: '1080p',
            label: '1080p',
          });
        }
        finalStreams = filtered;
      }

      // Prefer 1080p as default, else 2160p or first available
      let defaultStream = finalStreams.find(s => s.quality === '1080p');
      if (!defaultStream) defaultStream = finalStreams.find(s => s.quality === '2160p');
      if (!defaultStream) defaultStream = finalStreams[0];

      finalStreams.forEach(s => {
        s.isDefault = s.id === defaultStream.id;
      });

      const result = {
        id: videoId,
        provider: 'xhamster',
        pageUrl: targetUrl,
        title,
        duration,
        thumbnailUrl,
        uploadDate: uploadDateStr,
        date: dateTimestamp,
        streams: finalStreams,
        defaultStream,
        hlsMasterUrl,
        url: defaultStream.url,
        directStreamUrl: defaultStream.directUrl,
        downloadUrl: defaultStream.downloadUrl,
        streamProxyUrl: defaultStream.streamProxyUrl,
        quality: defaultStream.quality,
        files: finalStreams.map(s => ({
          id: s.id,
          name: s.label || s.quality,
          label: s.label || s.quality,
          quality: s.quality,
          format: s.type,
          directStreamUrl: s.directUrl,
          streamProxyUrl: s.streamProxyUrl,
          downloadUrl: s.downloadUrl,
          isDefault: s.isDefault,
          width: s.width,
          height: s.height,
          bitrate: s.bitrate,
          mimeType: s.mimeType,
        })),
        createdAt: Date.now(),
        expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      };

      // Cache for 1 hour
      xhamsterExtractCache.set(videoId, { data: result, expiresAt: Date.now() + 60 * 60 * 1000 });

      return res.json(result);
    } catch (error: any) {
      console.error('[xHamster] Resolution error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to resolve video from xHamster',
        code: 'NETWORK_ERROR',
      });
    }
  };

  const porntrexExtractCache = new Map<string, { data: any; expiresAt: number }>();
  const porntrexSizeCache = new Map<string, number>();

  const handlePorntrexResolve = async (req: express.Request, res: express.Response) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing video URL', code: 'INVALID_VIDEO_PAGE' });
      }

      const rawInput = url.trim().replace(/[\]\)\>\"\'\s]+$/, '');
      const idMatch = rawInput.match(/porntrex\.com\/(?:video|embed)\/(\d+)/i) || rawInput.match(/^(\d{4,10})$/);
      const videoId = idMatch ? idMatch[1] : null;

      if (!videoId) {
        return res.status(400).json({ error: 'Invalid Porntrex URL or Video ID', code: 'INVALID_VIDEO_PAGE' });
      }

      // Check in-memory cache
      const cached = porntrexExtractCache.get(videoId);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      // 1. Fetch main video page
      let targetUrl = rawInput.startsWith('http') ? rawInput : `https://www.porntrex.com/video/${videoId}/`;
      let pageRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!pageRes.ok && pageRes.status === 404) {
        targetUrl = `https://www.porntrex.com/video/${videoId}/`;
        pageRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        });
      }

      if (!pageRes.ok) {
        if (pageRes.status === 404) {
          return res.status(404).json({ error: 'Video not found or has been removed', code: 'SOURCE_NOT_FOUND' });
        }
        return res.status(pageRes.status).json({ error: `Video page returned status ${pageRes.status}`, code: 'NETWORK_ERROR' });
      }

      const html = await pageRes.text();

      // Check for unavailable / deleted video
      if (html.includes('This video has been disabled') || html.includes('video has been removed') || html.includes('Page Not Found')) {
        return res.status(404).json({ error: 'Video is disabled, removed, or unavailable', code: 'SOURCE_NOT_FOUND' });
      }

      // 2. Parse flashvars
      const flashvars: Record<string, string> = {};
      const flashvarsBlockMatch = html.match(/var\s+flashvars\s*=\s*\{([\s\S]+?)\};/i) || html.match(/flashvars\s*=\s*\{([\s\S]+?)\};/i);
      if (flashvarsBlockMatch) {
        const block = flashvarsBlockMatch[1];
        const propMatches = [...block.matchAll(/([a-zA-Z0-9_]+)\s*:\s*['"]([^'"]*)['"]/g)];
        for (const m of propMatches) {
          flashvars[m[1]] = m[2];
        }
      }

      // Direct fallback matching on HTML for video keys if flashvars block was tricky
      if (!flashvars.video_url && !flashvars.video_alt_url && !flashvars.video_alt_url2 && !flashvars.video_alt_url3) {
        const directKeys = [
          'video_id', 'video_title', 'video_url', 'video_url_text',
          'video_alt_url', 'video_alt_url_text',
          'video_alt_url2', 'video_alt_url2_text',
          'video_alt_url3', 'video_alt_url3_text',
          'video_alt_url4', 'video_alt_url4_text',
          'preview_url', 'preview_url1', 'preview_url2', 'preview_url3', 'preview_url4',
          'video_categories', 'video_tags'
        ];
        for (const k of directKeys) {
          const rx = new RegExp(`${k}\\s*:\\s*['"]([^'"]*)['"]`, 'i');
          const m = html.match(rx);
          if (m) {
            flashvars[k] = m[1];
          }
        }
      }

      // Embed fallback if flashvars not found
      if (!flashvars.video_url && !flashvars.video_alt_url && !flashvars.video_alt_url2 && !flashvars.video_alt_url3) {
        try {
          const embedRes = await fetch(`https://www.porntrex.com/embed/${videoId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': targetUrl,
            },
          });
          if (embedRes.ok) {
            const embedHtml = await embedRes.text();
            const embedBlockMatch = embedHtml.match(/var\s+flashvars\s*=\s*\{([\s\S]+?)\};/i) || embedHtml.match(/flashvars\s*=\s*\{([\s\S]+?)\};/i);
            if (embedBlockMatch) {
              const propMatches = [...embedBlockMatch[1].matchAll(/([a-zA-Z0-9_]+)\s*:\s*['"]([^'"]*)['"]/g)];
              for (const m of propMatches) {
                flashvars[m[1]] = m[2];
              }
            }
          }
        } catch (e) {
          console.warn('[Porntrex] Embed fallback failed:', e);
        }
      }

      // Title extraction
      let title = flashvars.video_title || '';
      if (!title) {
        const titleMatch = html.match(/<p\s+class=["']title-video["']>([^<]+)<\/p>/i) || html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].replace(/\|.*$/i, '').replace(/- Porntre.*$/i, '').trim();
        }
      }
      if (!title) title = 'Porntrex Video';

      // Duration extraction
      let duration: number | undefined = undefined;
      const durMatch = html.match(/class=["']badge["']>(\d+)min\s*(\d*)sec<\/em>/i) || html.match(/(\d+)\s*min\s*(\d*)\s*sec/i);
      if (durMatch) {
        const mins = parseInt(durMatch[1], 10) || 0;
        const secs = parseInt(durMatch[2], 10) || 0;
        duration = mins * 60 + secs;
      }

      // Thumbnail extraction (Pick highest resolution)
      let thumbnailUrl: string | undefined = undefined;
      const candidateThumbs = [
        flashvars.preview_url4, // 2160p
        flashvars.preview_url3, // 1080p
        flashvars.preview_url2, // 720p
        flashvars.preview_url1, // 480p
        flashvars.preview_url,
      ].filter(Boolean);

      if (candidateThumbs.length > 0) {
        let t = candidateThumbs[0];
        if (t.startsWith('//')) t = 'https:' + t;
        thumbnailUrl = t;
      }

      if (!thumbnailUrl) {
        const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (ogImageMatch && ogImageMatch[1]) {
          let t = ogImageMatch[1].trim();
          if (t.startsWith('//')) t = 'https:' + t;
          thumbnailUrl = t;
        }
      }

      // Date extraction
      let uploadDateStr: string | undefined = undefined;
      let dateTimestamp: number | undefined = undefined;

      const timeBadgeMatch = html.match(/<i\s+class=["']fa\s+fa-calendar["']><\/i>\s*<em\s+class=["']badge["']>([^<]+)<\/em>/i);
      if (timeBadgeMatch && timeBadgeMatch[1]) {
        const timeAgoStr = timeBadgeMatch[1].trim().toLowerCase();
        let daysAgo = 0;
        if (timeAgoStr.includes('year')) {
          const num = parseInt(timeAgoStr, 10) || 1;
          daysAgo = num * 365;
        } else if (timeAgoStr.includes('month')) {
          const num = parseInt(timeAgoStr, 10) || 1;
          daysAgo = num * 30;
        } else if (timeAgoStr.includes('week')) {
          const num = parseInt(timeAgoStr, 10) || 1;
          daysAgo = num * 7;
        } else if (timeAgoStr.includes('day')) {
          const num = parseInt(timeAgoStr, 10) || 1;
          daysAgo = num;
        }
        const calcDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        uploadDateStr = calcDate.toISOString().split('T')[0];
        dateTimestamp = calcDate.getTime();
      }

      if (!uploadDateStr) {
        const dateMeta = html.match(/<meta[^>]+(?:itemprop|property|name)=["'](?:uploadDate|datePublished)["'][^>]+content=["']([^"']+)["']/i);
        if (dateMeta && dateMeta[1]) {
          uploadDateStr = dateMeta[1].trim().split('T')[0];
          dateTimestamp = new Date(dateMeta[1]).getTime();
        }
      }

      // Actors / Models extraction
      const extractedActors: string[] = [];
      const actorImages: Record<string, string> = {};
      const modelMatches = [...html.matchAll(/<a[^>]+href=["']https?:\/\/(?:www\.)?porntrex\.com\/models\/([^"'/?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      for (const mm of modelMatches) {
        const slug = mm[1];
        const rawName = mm[2].replace(/<[^>]+>/g, '').trim();
        const actorName = rawName || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (actorName && !extractedActors.some(a => a.toLowerCase() === actorName.toLowerCase())) {
          extractedActors.push(actorName);
        }
      }

      // Categories and Tags
      const categories = flashvars.video_categories ? flashvars.video_categories.split(',').map((c: string) => c.trim()).filter(Boolean) : [];
      const tags = flashvars.video_tags ? flashvars.video_tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

      // Stream Qualities Discovery & Normalization
      const streamEntries: Array<{ url: string; quality: string; label: string; height: number; width: number }> = [];

      const qualityKeys = [
        { urlKey: 'video_alt_url4', textKey: 'video_alt_url4_text', defaultQ: '4320p', h: 4320, w: 7680 },
        { urlKey: 'video_alt_url3', textKey: 'video_alt_url3_text', defaultQ: '2160p', h: 2160, w: 3840 },
        { urlKey: 'video_alt_url2', textKey: 'video_alt_url2_text', defaultQ: '1080p', h: 1080, w: 1920 },
        { urlKey: 'video_alt_url', textKey: 'video_alt_url_text', defaultQ: '720p', h: 720, w: 1280 },
        { urlKey: 'video_url', textKey: 'video_url_text', defaultQ: '480p', h: 480, w: 854 },
      ];

      for (const qk of qualityKeys) {
        const streamUrl = flashvars[qk.urlKey];
        if (streamUrl && typeof streamUrl === 'string' && streamUrl.startsWith('http')) {
          const rawText = flashvars[qk.textKey] || qk.defaultQ;
          const heightMatch = rawText.match(/(\d{3,4})p?/i);
          const height = heightMatch ? parseInt(heightMatch[1], 10) : qk.h;
          let quality = `${height}p`;
          if (height >= 2160) quality = '2160p';
          else if (height >= 1440) quality = '1440p';
          else if (height >= 1080) quality = '1080p';
          else if (height >= 720) quality = '720p';
          else if (height >= 480) quality = '480p';
          else if (height >= 360) quality = '360p';

          let label = quality;
          if (quality === '2160p') label = '2160p (4K)';
          else if (quality === '1080p') label = '1080p (FHD)';
          else if (quality === '720p') label = '720p (HD)';
          else if (quality === '480p') label = '480p (SD)';

          if (!streamEntries.some(s => s.quality === quality)) {
            streamEntries.push({
              url: streamUrl,
              quality,
              label,
              height,
              width: qk.w,
            });
          }
        }
      }

      // HTML5 video tag fallback
      if (streamEntries.length === 0) {
        const sourceMatches = [...html.matchAll(/<source[^>]+src=["']([^"']+)["'][^>]*>/gi)];
        for (const sm of sourceMatches) {
          const sUrl = sm[1];
          if (sUrl && sUrl.startsWith('http')) {
            const hMatch = sUrl.match(/_(\d{3,4})p/i) || sm[0].match(/(\d{3,4})p/i);
            const height = hMatch ? parseInt(hMatch[1], 10) : 1080;
            const quality = `${height}p`;
            streamEntries.push({
              url: sUrl,
              quality,
              label: quality,
              height,
              width: Math.round(height * (16 / 9)),
            });
          }
        }
      }

      if (streamEntries.length === 0) {
        return res.status(404).json({ error: 'No playable video streams found on Porntrex page', code: 'SOURCE_NOT_FOUND' });
      }

      streamEntries.sort((a, b) => b.height - a.height);

      const files = streamEntries.map((s) => {
        const proxyStreamUrl = `/api/porntrex/stream?target=${encodeURIComponent(s.url)}`;
        return {
          id: s.quality,
          name: s.label,
          label: s.label,
          quality: s.quality,
          mimeType: 'video/mp4',
          directStreamUrl: s.url,
          downloadUrl: s.url,
          streamProxyUrl: proxyStreamUrl,
          thumbnailUrl,
          width: s.width,
          height: s.height,
          isDefault: s.quality === '1080p',
        };
      });

      const file4K = files.find(f => f.quality === '2160p') || null;
      const file1080 = files.find(f => f.quality === '1080p') || null;
      const defaultFile = file1080 || file4K || files.find(f => f.quality === '720p') || files[0];

      const streams = files.map((f) => ({
        id: f.id,
        url: f.directStreamUrl,
        directUrl: f.directStreamUrl,
        streamProxyUrl: f.streamProxyUrl,
        downloadUrl: f.downloadUrl,
        type: 'mp4' as const,
        quality: f.quality,
        label: f.label,
        width: f.width,
        height: f.height,
        mimeType: 'video/mp4',
        isDefault: f.isDefault,
      }));

      const defaultStream = streams.find(s => s.id === defaultFile.id) || streams[0];

      const responseData = {
        id: videoId,
        provider: 'porntrex',
        pageUrl: targetUrl,
        title,
        duration,
        thumbnailUrl,
        uploadDate: uploadDateStr,
        date: uploadDateStr,
        dateStr: uploadDateStr,
        actors: extractedActors,
        actress: extractedActors[0] || undefined,
        actorImages,
        categories,
        tags,
        url: defaultFile.directStreamUrl,
        directStreamUrl: defaultFile.directStreamUrl,
        downloadUrl: defaultFile.downloadUrl,
        streamProxyUrl: defaultFile.streamProxyUrl,
        quality: defaultFile.quality,
        file4K,
        file1080,
        files,
        streams,
        defaultStream,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000,
      };

      porntrexExtractCache.set(videoId, { data: responseData, expiresAt: Date.now() + 60 * 60 * 1000 });
      return res.json(responseData);
    } catch (error: any) {
      console.error('[Porntrex] Resolution error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to resolve video from Porntrex',
        code: 'NETWORK_ERROR',
      });
    }
  };

  // Dispatcher for Universal Video Resolver
  const handleUniversalVideoResolve = async (req: express.Request, res: express.Response) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing video URL', code: 'INVALID_VIDEO_PAGE' });
      }

      const lower = url.toLowerCase();
      if (lower.includes('porntrex') || lower.includes('cdntrex.com')) {
        return handlePorntrexResolve(req, res);
      }
      if (lower.includes('xhamster') || lower.includes('xhcdn.com') || /^xh[a-zA-Z0-9]+$/i.test(url.trim())) {
        return handleXhamsterResolve(req, res);
      }
      if (lower.includes('pornhub') || /^[a-zA-Z0-9]{10,20}$/.test(url.trim())) {
        return handlePornhubResolve(req, res);
      }

      return res.status(400).json({
        error: 'Unsupported video provider URL',
        code: 'UNSUPPORTED_STREAM',
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Resolution failed', code: 'INTERNAL_ERROR' });
    }
  };

  app.post('/api/video-resolver/resolve', express.json(), handleUniversalVideoResolve);
  app.post('/api/video/extract', express.json(), handleUniversalVideoResolve);
  app.post('/api/porntrex/extract', express.json(), handlePorntrexResolve);
  app.post('/api/pornhub/extract', express.json(), handlePornhubResolve);
  app.post('/api/xhamster/extract', express.json(), handleXhamsterResolve);
  app.get('/api/porntrex/stream', (req, res) => handleVideoResolverStream(req, res));

  // High-Speed Adaptive 206 Streaming Proxy for Video Resolver (Porntrex, Pornhub & xHamster)
  const handleVideoResolverStream = async (req: express.Request, res: express.Response) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target URL parameter');
      }

      const targetUrl = target.trim();
      const isXh = targetUrl.includes('xhcdn.com') || targetUrl.includes('xhamster');
      const isPtx = targetUrl.includes('porntrex.com') || targetUrl.includes('cdntrex.com');

      let referer = 'https://www.pornhub.com/';
      let origin = 'https://www.pornhub.com';
      if (isXh) {
        referer = 'https://xhamster.com/';
        origin = 'https://xhamster.com';
      } else if (isPtx) {
        referer = 'https://www.porntrex.com/';
        origin = 'https://www.porntrex.com';
      }

      const headers: Record<string, string> = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': referer,
        'Origin': origin,
      };

      const rawRange = req.headers.range;
      const sizeCache = isXh ? xhamsterSizeCache : (isPtx ? porntrexSizeCache : pornhubSizeCache);
      const knownTotalSize = sizeCache.get(targetUrl) || 0;

      // Adaptive Chunk Sizing for smooth streaming
      const CHUNK_SIZE_INIT = 16 * 1024 * 1024;
      const CHUNK_SIZE_SEEK = 24 * 1024 * 1024;

      if (rawRange) {
        const rangeMatch = rawRange.match(/^bytes=(\d+)-(\d*)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10) || 0;
          const endStr = rangeMatch[2];
          if (endStr) {
            headers['Range'] = rawRange;
          } else {
            const effectiveChunk = start === 0 ? CHUNK_SIZE_INIT : CHUNK_SIZE_SEEK;
            let chunkEnd = start + effectiveChunk - 1;
            if (knownTotalSize > 0 && chunkEnd >= knownTotalSize) {
              chunkEnd = knownTotalSize - 1;
            }
            headers['Range'] = `bytes=${start}-${chunkEnd}`;
          }
        } else {
          headers['Range'] = rawRange;
        }
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      let originRes = await fetch(targetUrl, {
        headers,
        signal: abortController.signal,
      });

      // If synthetic chunk returned 416 (e.g. chunkEnd exceeded actual file size), fallback to client raw range
      if (originRes.status === 416 && rawRange && headers['Range'] !== rawRange) {
        headers['Range'] = rawRange;
        originRes = await fetch(targetUrl, {
          headers,
          signal: abortController.signal,
        });
      }

      const status = originRes.status;
      res.status(status);

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const contentType = originRes.headers.get('content-type');
      const isM3u8 = targetUrl.includes('.m3u8') || (contentType && contentType.includes('mpegurl'));
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      } else if (isM3u8) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (targetUrl.includes('.ts')) {
        res.setHeader('Content-Type', 'video/MP2T');
      } else {
        res.setHeader('Content-Type', 'video/mp4');
      }

      // If this is an M3U8 playlist served through proxy, rewrite relative URLs so segments load through proxy seamlessly
      if (isM3u8 && originRes.ok) {
        const text = await originRes.text();
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const rewrittenLines = text.split(/\r?\n/).map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const absolute = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `${baseUrl}${trimmed}`;
          return `/api/video-resolver/stream?target=${encodeURIComponent(absolute)}`;
        });
        const rewritten = rewrittenLines.join('\n');
        res.setHeader('Content-Length', Buffer.byteLength(rewritten));
        return res.send(rewritten);
      }

      const contentLength = originRes.headers.get('content-length');
      const contentRange = originRes.headers.get('content-range');

      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
        const match = contentRange.match(/\/(\d+)$/);
        if (match && match[1]) {
          const total = parseInt(match[1], 10);
          if (total > 0) {
            sizeCache.set(targetUrl, total);
          }
        }
      } else if (rawRange && status === 206 && contentLength) {
        const total = knownTotalSize || parseInt(contentLength, 10);
        res.setHeader('Content-Range', `bytes 0-${parseInt(contentLength, 10) - 1}/${total}`);
      }

      res.setHeader('Content-Disposition', 'inline; filename="video.mp4"');

      if (originRes.body) {
        const nodeStream = Readable.fromWeb(originRes.body as any);
        nodeStream.on('error', () => {});
        res.on('error', () => {});
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch (e) {}
        });
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError' || req.destroyed) {
        return;
      }
      console.error('Error streaming video resolver file:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream video');
      }
    }
  };

  app.get('/api/video-resolver/stream', handleVideoResolverStream);
  app.get('/api/pornhub/stream', handleVideoResolverStream);
  app.get('/api/xhamster/stream', handleVideoResolverStream);

  // ==========================================
  // Hanimestream (HStream) Video Extraction & DASH Engine
  // ==========================================
  const hanimestreamCache = new Map<string, { data: any; expiresAt: number }>();

  // Extract video info, qualities (2160p 4K, 1080p FHD, 720p HD) and manifests
  app.post('/api/hanimestream/extract', express.json(), async (req, res) => {
    try {
      const { url: rawUrl, preferredServer } = req.body;
      if (!rawUrl || typeof rawUrl !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing target URL parameter' });
      }

      let cleanUrl = rawUrl.trim().replace(/^(hanimestream:|hstream:)/i, '').trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        if (cleanUrl.startsWith('hentai/')) {
          cleanUrl = `https://hstream.moe/${cleanUrl}`;
        } else {
          cleanUrl = `https://hstream.moe/hentai/${cleanUrl}`;
        }
      }

      const cacheKey = `${cleanUrl}_${preferredServer || 'default'}`;
      const cached = hanimestreamCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      console.log('[Hanimestream] Extracting from:', cleanUrl);

      // Step 1: Fetch hstream page to obtain cookies, CSRF token, and episode ID
      const pageRes = await fetch(cleanUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!pageRes.ok) {
        return res.status(pageRes.status).json({
          success: false,
          error: `Failed to load HStream page (HTTP ${pageRes.status})`
        });
      }

      const rawSetCookie = pageRes.headers.get('set-cookie') || '';
      const cookieHeader = rawSetCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

      // Extract XSRF-TOKEN from cookies if present
      let xsrfToken = '';
      const cookieParts = rawSetCookie.split(',');
      for (const part of cookieParts) {
        const match = part.match(/XSRF-TOKEN=([^;]+)/i);
        if (match) {
          try {
            xsrfToken = decodeURIComponent(match[1]);
          } catch (e) {
            xsrfToken = match[1];
          }
          break;
        }
      }

      const html = await pageRes.text();
      const $ = cheerio.load(html);

      const csrfToken = String($('input[name="_token"]').first().val() || $('meta[name="csrf-token"]').attr('content') || '');
      const episodeId = String($('#e_id').val() || '');

      if (!episodeId) {
        return res.status(404).json({
          success: false,
          error: 'Episode ID not found on page. Please verify the URL.'
        });
      }

      // Extract page metadata
      const rawTitle = $('title').text() || '';
      const cleanTitle = rawTitle.replace(/FacebookTwitterReddit.*$/, '').replace(/\|.*$/, '').trim();
      const poster = $('meta[property="og:image"]').attr('content') || '';
      const description = $('meta[property="og:description"]').attr('content') || '';

      let genre: string[] = [];
      let uploadDate: string = '';
      try {
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const parsed = JSON.parse($(el).text());
            if (parsed && parsed['@type'] === 'VideoObject') {
              if (Array.isArray(parsed.genre)) genre = parsed.genre;
              if (parsed.uploadDate) uploadDate = parsed.uploadDate;
            }
          } catch (e) {}
        });
      } catch (e) {}

      // Extract episode gallery images (data-te-img or gallery-ep-)
      const gallery: string[] = [];
      $('[data-te-img]').each((_, el) => {
        let img = $(el).attr('data-te-img') || '';
        if (img) {
          if (!img.startsWith('http')) img = `https://hstream.moe${img}`;
          if (!gallery.includes(img)) gallery.push(img);
        }
      });
      if (gallery.length === 0) {
        $('img').each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src') || '';
          if (src.includes('gallery-ep-')) {
            const full = src.replace('-thumbnail.webp', '.webp');
            const fullUrl = full.startsWith('http') ? full : `https://hstream.moe${full}`;
            if (!gallery.includes(fullUrl)) gallery.push(fullUrl);
          }
        });
      }

      // Step 2: Request stream manifest from /player/api
      const postHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': cleanUrl,
        'Origin': 'https://hstream.moe',
        'X-Requested-With': 'XMLHttpRequest',
      };

      if (cookieHeader) postHeaders['Cookie'] = cookieHeader;
      if (csrfToken) postHeaders['X-CSRF-TOKEN'] = csrfToken;
      if (xsrfToken) postHeaders['X-XSRF-TOKEN'] = xsrfToken;

      const playerRes = await fetch('https://hstream.moe/player/api', {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({ episode_id: episodeId })
      });

      if (!playerRes.ok) {
        const errText = await playerRes.text().catch(() => '');
        return res.status(playerRes.status).json({
          success: false,
          error: `Player API returned HTTP ${playerRes.status}: ${errText.slice(0, 100)}`
        });
      }

      const playerData = await playerRes.json();
      const {
        title: apiTitle,
        poster: apiPoster,
        interpolated = 0,
        interpolated_uhd = 0,
        stream_url = '',
        stream_domains = [],
        asia_stream_domains = [],
        extra_subtitles = {}
      } = playerData;

      if (!stream_url || (!stream_domains.length && !asia_stream_domains.length)) {
        return res.status(500).json({
          success: false,
          error: 'No active stream domains returned from HStream API.'
        });
      }

      const allDomains = [...stream_domains, ...asia_stream_domains];
      let activeDomain = preferredServer && allDomains.includes(preferredServer)
        ? preferredServer
        : (stream_domains[0] || allDomains[0]);

      // Normalize domain URL
      if (!activeDomain.startsWith('http')) {
        activeDomain = `https://${activeDomain}`;
      }

      const displayTitle = apiTitle || cleanTitle || 'Hanimestream Episode';
      const displayPoster = apiPoster ? (apiPoster.startsWith('http') ? apiPoster : `https://hstream.moe${apiPoster}`) : poster;

      // Build Multi-Quality Selection (2160p 4K, 1080p FHD, 720p HD)
      // Build Multi-Quality Selection (2160p, 1080p, 1080p48)
      // 720p is completely excluded as requested
      const qualities: any[] = [];

      // 1. 2160p
      const direct2160 = `${activeDomain}/${stream_url}/2160/manifest.mpd`;
      const proxy2160 = `/api/hanimestream/manifest.mpd?domain=${encodeURIComponent(activeDomain)}&path=${encodeURIComponent(stream_url)}&quality=2160`;
      qualities.push({
        id: '2160p',
        name: '2160p',
        label: '2160p',
        quality: '2160p',
        resolution: '3840x2160',
        codec: 'AV1 (av01.0.12M.08)',
        mode: 'mpd',
        mimeType: 'application/dash+xml',
        directStreamUrl: direct2160,
        proxyStreamUrl: proxy2160,
        streamProxyUrl: proxy2160,
        downloadUrl: direct2160,
        is4K: true,
      });

      // 1b. 2160p48 Interpolated (if available)
      if (interpolated_uhd === 1) {
        const direct2160i = `${activeDomain}/${stream_url}/2160i/manifest.mpd`;
        const proxy2160i = `/api/hanimestream/manifest.mpd?domain=${encodeURIComponent(activeDomain)}&path=${encodeURIComponent(stream_url)}&quality=2160i`;
        qualities.push({
          id: '2160p48',
          name: '2160p48',
          label: '2160p48',
          quality: '2160p',
          resolution: '3840x2160',
          codec: 'AV1 (48fps)',
          mode: 'mpd',
          mimeType: 'application/dash+xml',
          directStreamUrl: direct2160i,
          proxyStreamUrl: proxy2160i,
          streamProxyUrl: proxy2160i,
          downloadUrl: direct2160i,
          is4K: true,
        });
      }

      // 2. 1080p - The Primary / Best Quality
      const direct1080 = `${activeDomain}/${stream_url}/1080/manifest.mpd`;
      const proxy1080 = `/api/hanimestream/manifest.mpd?domain=${encodeURIComponent(activeDomain)}&path=${encodeURIComponent(stream_url)}&quality=1080`;
      qualities.push({
        id: '1080p',
        name: '1080p',
        label: '1080p',
        quality: '1080p',
        resolution: '1920x1080',
        codec: 'AV1 (av01.0.08M.08)',
        mode: 'mpd',
        mimeType: 'application/dash+xml',
        directStreamUrl: direct1080,
        proxyStreamUrl: proxy1080,
        streamProxyUrl: proxy1080,
        downloadUrl: direct1080,
        isFullHD: true,
      });

      // 2b. 1080p48 Interpolated (if available)
      if (interpolated === 1) {
        const direct1080i = `${activeDomain}/${stream_url}/1080i/manifest.mpd`;
        const proxy1080i = `/api/hanimestream/manifest.mpd?domain=${encodeURIComponent(activeDomain)}&path=${encodeURIComponent(stream_url)}&quality=1080i`;
        qualities.push({
          id: '1080p48',
          name: '1080p48',
          label: '1080p48',
          quality: '1080p48',
          resolution: '1920x1080',
          codec: 'AV1 (48fps)',
          mode: 'mpd',
          mimeType: 'application/dash+xml',
          directStreamUrl: direct1080i,
          proxyStreamUrl: proxy1080i,
          streamProxyUrl: proxy1080i,
          downloadUrl: direct1080i,
          isFullHD: true,
        });
      }

      // Note: 720p is completely excluded by design

      // Subtitles
      const subtitles: any[] = [
        {
          label: 'English',
          kind: 'captions',
          srclang: 'en',
          src: `${activeDomain}/${stream_url}/eng.vtt`,
          default: true,
        }
      ];

      if (extra_subtitles && typeof extra_subtitles === 'object') {
        for (const [langKey, langName] of Object.entries(extra_subtitles)) {
          subtitles.push({
            label: `${langName} (Auto)`,
            kind: 'captions',
            srclang: langKey,
            src: `${activeDomain}/${stream_url}/autotrans/${langKey}.vtt`,
            default: false,
          });
        }
      }

      const primaryQuality = qualities.find(q => q.id === '1080p') || qualities[0];

      const result = {
        success: true,
        title: displayTitle,
        episodeId,
        poster: displayPoster,
        streamUrl: stream_url,
        streamDomains: stream_domains,
        asiaStreamDomains: asia_stream_domains,
        activeDomain,
        qualities,
        preferredQuality: '1080p',
        directStreamUrl: primaryQuality.directStreamUrl,
        streamProxyUrl: primaryQuality.proxyStreamUrl,
        downloadUrl: primaryQuality.downloadUrl,
        subtitles,
        genre,
        uploadDate,
        description,
        rawUrl: cleanUrl,
        thumbsVtt: `${activeDomain}/${stream_url}/thumbs.vtt`,
        gallery,
      };

      hanimestreamCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 1000 * 60 * 60 * 2 // 2 hours
      });

      res.json(result);
    } catch (err: any) {
      console.error('[Hanimestream] Extraction error:', err);
      res.status(500).json({ success: false, error: err.message || 'Internal extraction failure' });
    }
  });

  // Scrape full Hanime series metadata from HStream (Title, Smallest Date, Description, Censorship, Episodes)
  app.post('/api/hanimestream/scrape', express.json(), async (req, res) => {
    try {
      const { url: rawUrl } = req.body;
      if (!rawUrl || typeof rawUrl !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing target URL parameter' });
      }

      let cleanUrl = rawUrl.trim().replace(/^(hanimestream:|hstream:)/i, '').trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        if (cleanUrl.startsWith('hentai/')) {
          cleanUrl = `https://hstream.moe/${cleanUrl}`;
        } else {
          cleanUrl = `https://hstream.moe/hentai/${cleanUrl}`;
        }
      }

      const slugMatch = cleanUrl.match(/\/hentai\/([a-zA-Z0-9_-]+)/i);
      const rawSlug = slugMatch ? slugMatch[1] : '';
      const seriesSlug = rawSlug.replace(/-\d+$/, '');
      const seriesUrl = `https://hstream.moe/hentai/${seriesSlug}`;

      console.log(`[Hanimestream Scraper] Fetching series: ${seriesUrl} (from input: ${cleanUrl})`);

      let pageRes = await fetch(seriesUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (!pageRes.ok && cleanUrl !== seriesUrl) {
        pageRes = await fetch(cleanUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          }
        });
      }

      if (!pageRes.ok) {
        return res.status(pageRes.status).json({
          success: false,
          error: `Failed to load HStream page (HTTP ${pageRes.status})`
        });
      }

      const html = await pageRes.text();
      const $ = cheerio.load(html);

      // 1. Title
      let title = $('h1').first().text().trim().replace(/\s+/g, ' ');
      if (!title) {
        const ogTitle = $('meta[property="og:title"]').attr('content') || '';
        title = ogTitle.split('-')[0].replace(/\|.*$/, '').trim();
      }
      title = title.replace(/\s*-\s*\d+$/, '').trim();

      // 2. Smallest date (e.g. 2020-03-06)
      const dateMatches = html.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
      const sortedDates = [...new Set(dateMatches)].sort();
      const smallestDate = sortedDates[0] || null;

      // 3. Description
      let description = '';
      $('h2').each((_, el) => {
        if ($(el).text().trim().toLowerCase().includes('description')) {
          description = $(el).next().text().trim().replace(/\s+/g, ' ');
        }
      });
      if (!description) {
        description = ($('meta[property="og:description"]').attr('content') || '').trim();
      }

      // 4. Censorship (CENSORED vs UNCENSORED)
      let censorship: 'UNCENSORED' | 'CENSORED' | null = null;
      const tagTexts: string[] = [];
      $('a[href*="tags"], a[href*="genre"], [class*="genre"], [class*="tag"]').each((_, el) => {
        tagTexts.push($(el).text().trim());
      });
      const hasUncensored = tagTexts.some(t => /uncensored/i.test(t)) || /\buncensored\b/i.test(html);
      const hasCensored = tagTexts.some(t => /\bcensored\b/i.test(t));
      if (hasUncensored) {
        censorship = 'UNCENSORED';
      } else if (hasCensored) {
        censorship = 'CENSORED';
      }

      // 5. Discover episodes & basic links
      interface DiscoveredEp {
        episodeNumber: number;
        url: string;
        thumb: string;
      }
      const discoveredEpisodes: DiscoveredEp[] = [];
      const seenUrls = new Set<string>();
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const epRegex = new RegExp(`(\\/hentai\\/${seriesSlug}-(\\d+))`, 'i');
        const m = href.match(epRegex);
        if (m) {
          const epNum = parseInt(m[2], 10);
          const fullUrl = href.startsWith('http') ? href : `https://hstream.moe${href}`;
          if (!seenUrls.has(fullUrl)) {
            seenUrls.add(fullUrl);
            const img = $(el).find('img').first();
            let cover = img.attr('src') || img.attr('data-src') || '';
            if (cover && !cover.startsWith('http')) cover = `https://hstream.moe${cover}`;
            discoveredEpisodes.push({
              episodeNumber: epNum,
              url: fullUrl,
              thumb: cover
            });
          }
        }
      });
      discoveredEpisodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

      // 6. Fetch each episode page in parallel to extract episode-specific title, description, and booster cover
      const detailedEpisodes = await Promise.all(
        discoveredEpisodes.map(async (item) => {
          const boosterCover = `https://hstream.moe/images/hentai/${seriesSlug}/cover-ep-${item.episodeNumber}.webp`;
          try {
            const epRes = await fetch(item.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
              signal: AbortSignal.timeout(5000)
            });
            const epHtml = await epRes.text();
            const $ep = cheerio.load(epHtml);

            // Episode Title (e.g. "Seika Jogakuin Kounin Sao Ojisan - 1")
            let epTitle = $ep('h1').first().text().trim().replace(/\s+/g, ' ');
            if (!epTitle) {
              epTitle = `${title} - ${item.episodeNumber}`;
            }

            // Episode Description
            let epDesc = '';
            $ep('h2').each((_, el) => {
              if ($ep(el).text().trim().toLowerCase().includes('description')) {
                epDesc = $ep(el).next().text().trim().replace(/\s+/g, ' ');
              }
            });
            if (!epDesc) {
              epDesc = ($ep('meta[property="og:description"]').attr('content') || '').trim();
            }

            // Episode player cover/thumbnail
            let epCover = item.thumb;
            if (!epCover) {
              $ep('img').each((_, el) => {
                const src = $ep(el).attr('src') || $ep(el).attr('data-src') || '';
                if (src.includes('gallery-ep-') && !epCover) {
                  epCover = src.startsWith('http') ? src : `https://hstream.moe${src}`;
                }
              });
            }

            // Episode date & censorship from ld+json
            let epDate: number | undefined = undefined;
            let epCensorship: 'UNCENSORED' | 'CENSORED' | undefined = undefined;
            $ep('script[type="application/ld+json"]').each((_, el) => {
              try {
                const json = JSON.parse($ep(el).html() || '{}');
                if (json.uploadDate) {
                  const d = new Date(json.uploadDate).getTime();
                  if (!isNaN(d) && d > 0) epDate = d;
                }
                if (json.genre && Array.isArray(json.genre)) {
                  if (json.genre.some((g: string) => typeof g === 'string' && g.toLowerCase() === 'uncensored')) {
                    epCensorship = 'UNCENSORED';
                  } else if (json.genre.some((g: string) => typeof g === 'string' && g.toLowerCase() === 'censored')) {
                    epCensorship = 'CENSORED';
                  }
                }
              } catch (e) {}
            });

            // Episode gallery images (e.g. data-te-img or gallery-ep-)
            const epGallery: string[] = [];
            $ep('[data-te-img]').each((_, el) => {
              let img = $ep(el).attr('data-te-img') || '';
              if (img) {
                if (!img.startsWith('http')) img = `https://hstream.moe${img}`;
                if (!epGallery.includes(img)) epGallery.push(img);
              }
            });
            if (epGallery.length === 0) {
              $ep('img').each((_, el) => {
                const src = $ep(el).attr('src') || $ep(el).attr('data-src') || '';
                if (src.includes(`gallery-ep-${item.episodeNumber}-`) || src.includes('gallery-ep-')) {
                  const full = src.replace('-thumbnail.webp', '.webp');
                  const fullUrl = full.startsWith('http') ? full : `https://hstream.moe${full}`;
                  if (!epGallery.includes(fullUrl)) epGallery.push(fullUrl);
                }
              });
            }

            return {
              episodeNumber: item.episodeNumber,
              url: item.url,
              coverImage: epCover || epGallery[0] || item.thumb,
              title: epTitle,
              description: epDesc || description,
              boosterCover,
              assignedDate: epDate || (smallestDate ? new Date(smallestDate).getTime() : undefined),
              censorship: epCensorship || (censorship as 'UNCENSORED' | 'CENSORED' | undefined) || 'UNCENSORED',
              gallery: epGallery
            };
          } catch (epErr) {
            return {
              episodeNumber: item.episodeNumber,
              url: item.url,
              coverImage: item.thumb,
              title: `${title} - ${item.episodeNumber}`,
              description,
              boosterCover,
              assignedDate: smallestDate ? new Date(smallestDate).getTime() : undefined,
              censorship: (censorship as 'UNCENSORED' | 'CENSORED' | undefined) || 'UNCENSORED',
              gallery: []
            };
          }
        })
      );

      // 7. Booster covers detection (cover-ep-1.webp, cover-ep-2.webp, ...)
      // Ep 1 booster cover -> Cover hanime (coverImage)
      // Ep 2, 3, ... booster covers -> Add Second Covers (secondaryCovers) in sequential order
      const epNumbers = detailedEpisodes.map(e => e.episodeNumber);
      const maxEp = epNumbers.length > 0 ? Math.max(...epNumbers) : 2;
      const probeCount = Math.max(maxEp + 1, 3);

      const probePromises: Promise<{ ep: number; url: string } | null>[] = [];
      for (let ep = 1; ep <= probeCount; ep++) {
        const candidate = `https://hstream.moe/images/hentai/${seriesSlug}/cover-ep-${ep}.webp`;
        probePromises.push(
          fetch(candidate, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
            .then(r => (r.status === 200 ? { ep, url: candidate } : null))
            .catch(() => null)
        );
      }

      const validProbes = (await Promise.all(probePromises)).filter(
        (item): item is { ep: number; url: string } => item !== null
      );
      validProbes.sort((a, b) => a.ep - b.ep);
      const boosterCovers = validProbes.map(c => c.url);

      // Primary cover: first booster cover if available, otherwise og:image or first episode cover
      let coverImage = boosterCovers[0] || $('meta[property="og:image"]').attr('content') || (detailedEpisodes[0]?.coverImage) || '';
      // Secondary covers: booster covers starting from the 2nd one
      const secondaryCovers = boosterCovers.slice(1);

      res.json({
        success: true,
        title,
        smallestDate,
        description,
        censorship,
        episodes: detailedEpisodes,
        coverImage,
        boosterCovers,
        secondaryCovers,
        seriesUrl
      });
    } catch (err: any) {
      console.error('[Hanimestream Scraper] Error:', err);
      res.status(500).json({ success: false, error: err.message || 'Scraping failed' });
    }
  });

  // Subtitle (VTT) Proxy for Hanimestream Subtitles
  app.get('/api/hanimestream/subtitle', async (req, res) => {
    try {
      const target = req.query.url as string;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing subtitle url parameter');
      }

      const subRes = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://hstream.moe/',
          'Origin': 'https://hstream.moe',
        }
      });

      if (!subRes.ok) {
        return res.status(subRes.status).send(`Failed to fetch subtitle: HTTP ${subRes.status}`);
      }

      const text = await subRes.text();
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(text);
    } catch (err: any) {
      console.error('[Hanimestream] Subtitle fetch error:', err);
      res.status(500).send(err.message || 'Failed to fetch subtitle');
    }
  });

  // JAV Subtitle detection endpoint
  app.get('/api/jav-subtitles/detect', (req, res) => {
    const query = (req.query.query || req.query.input || req.query.title || req.query.url || '') as string;
    const code = extractJavCode(query);
    res.json({
      isJav: !!code,
      code: code || null,
      query,
    });
  });

  // JAV Subtitlecat search endpoint (searches by code, title, or direct subtitlecat URL)
  app.get('/api/jav-subtitles/search', async (req, res) => {
    try {
      const rawInput = (req.query.code || req.query.query || req.query.title || req.query.url || '') as string;
      if (!rawInput.trim()) {
        return res.status(400).json({ success: false, error: 'Missing code or query parameter' });
      }

      // Check if direct subtitlecat URL was provided
      let directPagePath = '';
      if (rawInput.includes('subtitlecat.com/subs/')) {
        const pathMatch = rawInput.match(/subs\/\d+\/[^?#&]+/);
        if (pathMatch) {
          directPagePath = pathMatch[0];
        }
      }

      const code = extractJavCode(rawInput) || rawInput.trim();
      const cacheKey = directPagePath || code.toUpperCase();

      if (javSubtitleSearchCache.has(cacheKey)) {
        return res.json(javSubtitleSearchCache.get(cacheKey));
      }

      let targetPageUrl = '';
      let matchedTitle = '';
      let allMatchesCount = 0;

      if (directPagePath) {
        targetPageUrl = directPagePath.startsWith('http') ? directPagePath : `https://www.subtitlecat.com/${directPagePath}`;
        matchedTitle = code;
        allMatchesCount = 1;
      } else {
        // Search subtitlecat
        const searchUrl = `https://www.subtitlecat.com/index.php?search=${encodeURIComponent(code)}`;
        const searchRes = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          timeout: 10000,
        });

        const $search = cheerio.load(searchRes.data);
        const results: { href: string; text: string }[] = [];

        $search('table tr td a[href^="subs/"]').each((_i, el) => {
          const href = $search(el).attr('href');
          const text = $search(el).text().trim();
          if (href) {
            results.push({ href, text });
          }
        });

        allMatchesCount = results.length;

        if (results.length === 0) {
          const emptyResult = {
            success: false,
            code,
            error: `No subtitles found on Subtitlecat for "${code}"`,
            subtitles: [],
          };
          javSubtitleSearchCache.set(cacheKey, emptyResult);
          return res.json(emptyResult);
        }

        // Find the best matching item
        const cleanCode = code.replace(/[-_ ]/g, '').toUpperCase();
        let best = results.find(r => {
          const t = r.text.replace(/[-_ ]/g, '').toUpperCase();
          const h = r.href.replace(/[-_ ]/g, '').toUpperCase();
          return t.includes(cleanCode) || h.includes(cleanCode);
        }) || results[0];

        targetPageUrl = best.href.startsWith('http') ? best.href : `https://www.subtitlecat.com/${best.href.replace(/^\//, '')}`;
        matchedTitle = best.text;
      }

      // Fetch the subtitle page to extract download links
      const pageRes = await axios.get(targetPageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://www.subtitlecat.com/',
        },
        timeout: 10000,
      });

      const $page = cheerio.load(pageRes.data);
      const subtitles: any[] = [];

      // 1. ENGLISH: Look for English download
      const enDownloadHref = $page('#download_en').attr('href') ||
        $page('a[href*="-en.srt"]').attr('href') ||
        $page('a[href*="-en.vtt"]').attr('href');

      if (enDownloadHref) {
        subtitles.push({
          language: 'English',
          srclang: 'en',
          url: `/api/jav-subtitles/download?url=${encodeURIComponent(enDownloadHref)}`,
          directUrl: enDownloadHref.startsWith('http') ? enDownloadHref : `https://www.subtitlecat.com${enDownloadHref.startsWith('/') ? '' : '/'}${enDownloadHref}`,
          isDefault: true,
        });
      }

      // 2. ARABIC: Look for Arabic download directly on Subtitlecat
      const arDownloadHref = $page('#download_ar').attr('href') ||
        $page('a[href*="-ar.srt"]').attr('href') ||
        $page('a[href*="-ar.vtt"]').attr('href');

      // 3. JAPANESE: Look for Japanese download button or original transcript file
      const jaDownloadHref = $page('#download_ja').attr('href') ||
        $page('a[href*="-ja.srt"]').attr('href') ||
        $page('a[href*="-ja.vtt"]').attr('href');

      // Locate original Japanese subtitle file if present on Subtitlecat (for JAV, -orig.srt is Japanese)
      let origHref = '';
      const origBtn = $page('button[onclick*="-orig.srt"]').first();
      if (origBtn.length > 0) {
        const onclickText = origBtn.attr('onclick') || '';
        const matchOrig = onclickText.match(/'([^']+\.srt)'\s*,\s*'([^']+)'/);
        if (matchOrig) {
          origHref = `${matchOrig[2]}${matchOrig[1]}`;
        }
      }
      if (!origHref) {
        const matchRegex = pageRes.data.match(/translate_from_server_folder\([^\)]*,'([^']+-orig\.srt)'\s*,\s*'([^']+)'\)/);
        if (matchRegex) {
          origHref = `${matchRegex[2]}${matchRegex[1]}`;
        }
      }

      // Add ARABIC track: Use direct Arabic file if available, or generate via AI from English / Japanese source
      let arabicDownloadUrl = '';
      if (arDownloadHref) {
        arabicDownloadUrl = `/api/jav-subtitles/download?url=${encodeURIComponent(arDownloadHref)}`;
        subtitles.push({
          language: 'Arabic',
          srclang: 'ar',
          url: arabicDownloadUrl,
          directUrl: arDownloadHref.startsWith('http') ? arDownloadHref : `https://www.subtitlecat.com${arDownloadHref.startsWith('/') ? '' : '/'}${arDownloadHref}`,
          isDefault: false,
        });
      } else if (enDownloadHref || origHref) {
        const sourceForArabic = enDownloadHref || origHref;
        arabicDownloadUrl = `/api/jav-subtitles/download?url=${encodeURIComponent(sourceForArabic)}&targetLang=ar`;
        subtitles.push({
          language: 'Arabic',
          srclang: 'ar',
          url: arabicDownloadUrl,
          directUrl: sourceForArabic.startsWith('http') ? sourceForArabic : `https://www.subtitlecat.com${sourceForArabic.startsWith('/') ? '' : '/'}${sourceForArabic}`,
          isDefault: false,
        });
      }

      // Background pre-warming: If Arabic is on-demand, start translating in background now so it's instant on click
      if (arabicDownloadUrl && !arDownloadHref && process.env.GEMINI_API_KEY) {
        const sourceForArabic = enDownloadHref || origHref;
        const fullSource = sourceForArabic.startsWith('http') ? sourceForArabic : `https://www.subtitlecat.com${sourceForArabic.startsWith('/') ? '' : '/'}${sourceForArabic}`;
        const cacheKey = `${fullSource}:ar`;
        if (!javSubtitleVttCache.has(cacheKey)) {
          // Pre-fetch in background asynchronously without awaiting
          (async () => {
            try {
              const subRes = await axios.get(fullSource, {
                headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.subtitlecat.com/' },
                responseType: 'text',
                timeout: 15000,
              });
              const vtt = parseAndFormatVtt(subRes.data);
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
              const { vttText } = await translateVttWithGemini(vtt, ai, undefined, 'gemini-3.5-flash-lite');
              if (vttText && vttText.length > 20) {
                javSubtitleVttCache.set(cacheKey, vttText);
                console.log(`[JAV Subtitles] Pre-warmed Arabic translation for ${code} successfully!`);
              }
            } catch (preErr: any) {
              console.warn(`[JAV Subtitles] Background pre-warm notice for ${code}:`, preErr?.message || preErr);
            }
          })();
        }
      }

      // Add JAPANESE track: Use explicit Japanese download or original Japanese file
      if (jaDownloadHref) {
        subtitles.push({
          language: 'Japanese',
          srclang: 'ja',
          url: `/api/jav-subtitles/download?url=${encodeURIComponent(jaDownloadHref)}`,
          directUrl: jaDownloadHref.startsWith('http') ? jaDownloadHref : `https://www.subtitlecat.com${jaDownloadHref.startsWith('/') ? '' : '/'}${jaDownloadHref}`,
          isDefault: false,
        });
      } else if (origHref) {
        subtitles.push({
          language: 'Japanese',
          srclang: 'ja',
          url: `/api/jav-subtitles/download?url=${encodeURIComponent(origHref)}`,
          directUrl: origHref.startsWith('http') ? origHref : `https://www.subtitlecat.com${origHref.startsWith('/') ? '' : '/'}${origHref}`,
          isDefault: false,
        });
      }

      // Fallback: If no English was found but original exists, set Japanese as default
      if (!enDownloadHref && subtitles.length > 0 && !subtitles.some(s => s.isDefault)) {
        subtitles[0].isDefault = true;
      }

      const responsePayload = {
        success: subtitles.length > 0,
        code,
        title: matchedTitle || code,
        pageUrl: targetPageUrl,
        subtitles,
        allMatchesCount,
      };

      javSubtitleSearchCache.set(cacheKey, responsePayload);
      return res.json(responsePayload);
    } catch (err: any) {
      console.error('[JAV Subtitle Search] Error:', err);
      res.status(500).json({ success: false, error: err.message || 'Subtitle search failed' });
    }
  });

  const javInFlightTranslations = new Map<string, Promise<string>>();

  // JAV Subtitle download and WebVTT conversion endpoint
  app.get('/api/jav-subtitles/download', async (req, res) => {
    try {
      let target = req.query.url as string;
      const targetLang = (req.query.targetLang as string || '').toLowerCase();

      if (!target) {
        return res.status(400).send('Missing url parameter');
      }

      if (!target.startsWith('http')) {
        target = `https://www.subtitlecat.com${target.startsWith('/') ? '' : '/'}${target}`;
      }

      const cacheKey = targetLang ? `${target}:${targetLang}` : target;

      if (javSubtitleVttCache.has(cacheKey)) {
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(javSubtitleVttCache.get(cacheKey));
      }

      if (javInFlightTranslations.has(cacheKey)) {
        const inFlightVtt = await javInFlightTranslations.get(cacheKey)!;
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(inFlightVtt);
      }

      const translationPromise = (async () => {
        const subRes = await axios.get(target, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://www.subtitlecat.com/',
          },
          responseType: 'text',
          timeout: 15000,
        });

        let vtt = parseAndFormatVtt(subRes.data);

        // If Arabic was requested and source is not already Arabic, translate via Gemini AI
        if (targetLang === 'ar') {
          const isAlreadyArabic = /[\u0600-\u06FF]/.test(vtt);
          const apiKey = process.env.GEMINI_API_KEY;
          if (!isAlreadyArabic && apiKey) {
            try {
              const ai = new GoogleGenAI({ apiKey });
              const { vttText } = await translateVttWithGemini(vtt, ai, undefined, 'gemini-3.5-flash-lite');
              if (vttText && vttText.length > 20) {
                vtt = vttText;
              }
            } catch (tErr: any) {
              console.warn('[JAV Subtitle Download] AI translation to Arabic failed, falling back to original:', tErr?.message || tErr);
            }
          }
        }

        javSubtitleVttCache.set(cacheKey, vtt);
        return vtt;
      })();

      javInFlightTranslations.set(cacheKey, translationPromise);

      let finalVtt = '';
      try {
        finalVtt = await translationPromise;
      } finally {
        javInFlightTranslations.delete(cacheKey);
      }

      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(finalVtt);
    } catch (err: any) {
      console.error('[JAV Subtitle Download] Error:', err);
      res.status(500).send(err.message || 'Failed to download and convert subtitle');
    }
  });

  // Status check for Gemini API key
  app.get('/api/gemini/status', (req, res) => {
    res.json({
      hasServerKey: !!process.env.GEMINI_API_KEY,
      defaultModel: 'gemini-3.5-flash-lite',
      activeModels: [
        'gemini-3.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
      ],
    });
  });

  // Safe helper to generate content with fallback across modern Gemini models
  async function generateContentWithFallback(
    ai: GoogleGenAI,
    contents: string,
    systemInstruction: string,
    preferredModel?: string
  ): Promise<{ text: string; modelUsed: string }> {
    const defaultCandidates = [
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-flash-latest',
    ];

    const candidateModels = preferredModel && preferredModel.trim()
      ? [preferredModel.trim(), ...defaultCandidates.filter(m => m !== preferredModel.trim())]
      : defaultCandidates;

    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
          },
        });
        return { text: response.text || '', modelUsed: model };
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.code || (err?.error && err.error.code);
        const errMessage = (err?.message || JSON.stringify(err) || '').toLowerCase();

        const isHighDemand = status === 503 || errMessage.includes('503') || errMessage.includes('high demand') || errMessage.includes('unavailable');
        const isRateLimited = status === 429 || errMessage.includes('429') || errMessage.includes('quota') || errMessage.includes('resource_exhausted');
        const isNotFound = status === 404 || errMessage.includes('404') || errMessage.includes('not_found') || errMessage.includes('not found') || errMessage.includes('no longer available');

        // If invalid key, stop immediately
        if (status === 400 || status === 401 || status === 403 || errMessage.includes('api_key_invalid') || errMessage.includes('permission_denied')) {
          throw err;
        }

        if (isHighDemand || isRateLimited || isNotFound) {
          console.warn(`[Gemini Subtitle] Model "${model}" hit ${status || 'temporary issue'} (${errMessage.slice(0, 80)}), trying fallback candidate...`);
          continue; // Try next model immediately (different quota / availability)
        }

        console.warn(`[Gemini Subtitle] Model "${model}" error:`, errMessage.slice(0, 100));
      }
    }

    // If all models threw errors, provide friendly message if rate-limited or high-demand
    const lastMsg = (lastError?.message || JSON.stringify(lastError) || '').toLowerCase();
    if (lastMsg.includes('429') || lastMsg.includes('quota')) {
      throw new Error('Gemini API temporary quota limit exceeded. Please wait a moment and retry, or provide your own Google AI Studio API key in Settings.');
    }
    if (lastMsg.includes('503') || lastMsg.includes('high demand')) {
      throw new Error('AI servers are currently experiencing high demand. Please retry in a few moments.');
    }

    throw lastError;
  }

  // Helper function to translate WebVTT content using Gemini reliably without exceeding rate limits
  async function translateVttWithGemini(
    vttContent: string,
    ai: GoogleGenAI,
    onProgress?: (progressPercent: number, message: string) => void,
    preferredModel?: string
  ): Promise<{ vttText: string; modelUsed: string }> {
    // 1. Normalize line endings and strip BOM
    let cleanVtt = vttContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    // Convert SRT format commas to WebVTT dots if detected (e.g. 00:00:01,000 --> 00:00:04,000)
    cleanVtt = cleanVtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

    if (!cleanVtt.startsWith('WEBVTT')) {
      cleanVtt = 'WEBVTT\n\n' + cleanVtt;
    }

    const rawBlocks = cleanVtt.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
    const cueBlocks = rawBlocks.filter(b => !b.startsWith('WEBVTT') && (b.includes('-->') || /^\d+$/.test(b.split('\n')[0])));

    const systemInstruction = `You are an expert anime and media subtitle translator specializing in English to Arabic translation.
Translate dialogue and spoken captions into natural, expressive, modern standard Arabic suited to the context of the dialogue.
CRITICAL FORMAT RULES:
1. The output MUST be a valid WebVTT file starting with "WEBVTT".
2. Retain ALL timestamps, cue numbers, time intervals (-->), and timeline positioning EXACTLY as they are. DO NOT alter numbers or timings.
3. Keep all formatting tags like <i>, <b>, <c> intact.
4. Translate ONLY the dialogue lines into Arabic.
5. Return ONLY raw WebVTT content with NO markdown code blocks (\`\`\`vtt) and NO commentary.`;

    // Standard anime episode (<= 250 cues): Translate in ONE single API call for speed and context
    if (cueBlocks.length <= 250) {
      onProgress?.(15, 'Reading and analyzing dialogue...');

      let curProgress = 15;
      const progressTimer = setInterval(() => {
        curProgress = Math.min(92, curProgress + Math.floor(Math.random() * 12) + 8);
        onProgress?.(curProgress, `Translating dialogue via AI (${curProgress}%)...`);
      }, 600);

      try {
        const prompt = `Translate the following English WebVTT subtitles into natural, fluent Arabic for anime viewers.\n\n${cleanVtt}`;
        const { text: rawText, modelUsed } = await generateContentWithFallback(ai, prompt, systemInstruction, preferredModel);

        clearInterval(progressTimer);

        let translated = (rawText || '').trim();
        if (translated.startsWith('```')) {
          translated = translated.replace(/^```[a-z0-9_-]*\n?/i, '').replace(/\n?```$/i, '').trim();
        }
        if (!translated.startsWith('WEBVTT')) {
          translated = 'WEBVTT\n\n' + translated;
        }
        onProgress?.(100, 'Translation completed successfully!');
        return { vttText: translated, modelUsed };
      } catch (err) {
        clearInterval(progressTimer);
        throw err;
      }
    }

    // For longer files (> 250 cues), process in parallel chunks of ~120 cues for blazing speed
    const CHUNK_SIZE = 120;
    const chunks: string[][] = [];
    for (let i = 0; i < cueBlocks.length; i += CHUNK_SIZE) {
      chunks.push(cueBlocks.slice(i, i + CHUNK_SIZE));
    }

    onProgress?.(20, `Translating ${cueBlocks.length} dialogues in ${chunks.length} parallel batches...`);

    let completedChunks = 0;
    let lastModelUsed = 'gemini-3.5-flash-lite';

    const chunkPromises = chunks.map(async (chunkCues, index) => {
      const chunkVtt = 'WEBVTT\n\n' + chunkCues.join('\n\n');
      const { text: rawText, modelUsed } = await generateContentWithFallback(
        ai,
        `Translate the following English WebVTT subtitles into natural, fluent Arabic for anime viewers.\n\n${chunkVtt}`,
        systemInstruction,
        preferredModel
      );
      lastModelUsed = modelUsed;

      completedChunks++;
      const currentProgress = Math.min(95, Math.round((completedChunks / chunks.length) * 80) + 15);
      onProgress?.(currentProgress, `Translated batch ${completedChunks}/${chunks.length} (${currentProgress}%)...`);

      let trans = (rawText || '').trim();
      if (trans.startsWith('```')) {
        trans = trans.replace(/^```[a-z0-9_-]*\n?/i, '').replace(/\n?```$/i, '').trim();
      }
      return trans.replace(/^WEBVTT\s*/i, '').trim();
    });

    const translatedChunks = await Promise.all(chunkPromises);

    onProgress?.(100, 'Translation completed successfully!');
    return {
      vttText: 'WEBVTT\n\n' + translatedChunks.filter(Boolean).join('\n\n'),
      modelUsed: lastModelUsed,
    };
  }

  // Real-time SSE streaming endpoint for subtitle translation
  app.post('/api/gemini/translate-subtitles-stream', express.json({ limit: '10mb' }), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { vttUrl, vttText, apiKey, model } = req.body;
      const effectiveKey = (typeof apiKey === 'string' && apiKey.trim()) || process.env.GEMINI_API_KEY;

      if (!effectiveKey) {
        sendEvent({
          type: 'error',
          error: 'MISSING_API_KEY',
          message: 'Please provide a Gemini API key in Settings.',
        });
        return res.end();
      }

      sendEvent({ type: 'progress', progress: 5, message: 'Checking and preparing subtitle file...' });

      // Check in-memory cache
      const cacheKey = (vttUrl && typeof vttUrl === 'string') ? vttUrl : (vttText ? vttText.slice(0, 100) : '');
      if (cacheKey && subtitleTranslationCache.has(cacheKey)) {
        sendEvent({ type: 'progress', progress: 100, message: 'Subtitles retrieved from cache!' });
        sendEvent({
          type: 'complete',
          progress: 100,
          vttText: subtitleTranslationCache.get(cacheKey),
          cached: true,
        });
        return res.end();
      }

      let sourceText = vttText;
      if (!sourceText && vttUrl) {
        let fetchUrl = String(vttUrl).trim();
        if (fetchUrl.startsWith('/api/')) {
          fetchUrl = `http://127.0.0.1:3000${fetchUrl}`;
        }
        let headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        };
        if (fetchUrl.includes('hstream.moe') || fetchUrl.includes('/api/hanimestream/subtitle')) {
          headers['Referer'] = 'https://hstream.moe/';
          headers['Origin'] = 'https://hstream.moe';
        }

        let subRes = await fetch(fetchUrl, { headers });
        if (!subRes.ok && fetchUrl.includes('hstream.moe') && !fetchUrl.includes('/api/hanimestream/subtitle')) {
          const proxiedUrl = `http://127.0.0.1:3000/api/hanimestream/subtitle?url=${encodeURIComponent(fetchUrl)}`;
          const retryRes = await fetch(proxiedUrl, { headers }).catch(() => null);
          if (retryRes && retryRes.ok) subRes = retryRes;
        }

        if (!subRes.ok) {
          sendEvent({ type: 'error', message: `Failed to load subtitle file: HTTP ${subRes.status}` });
          return res.end();
        }
        sourceText = await subRes.text();
      }

      if (!sourceText || typeof sourceText !== 'string' || !sourceText.includes('-->')) {
        sendEvent({ type: 'error', message: 'Subtitle file content is invalid or missing timestamps' });
        return res.end();
      }

      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const { vttText: translatedVtt, modelUsed } = await translateVttWithGemini(
        sourceText,
        ai,
        (progressPercent, message) => {
          sendEvent({ type: 'progress', progress: progressPercent, message });
        },
        model
      );

      if (cacheKey) {
        subtitleTranslationCache.set(cacheKey, translatedVtt);
      }

      sendEvent({
        type: 'complete',
        progress: 100,
        message: 'Translation completed successfully!',
        vttText: translatedVtt,
        modelUsed,
        cached: false,
      });
      res.end();
    } catch (err: any) {
      console.error('[Gemini Subtitle Stream] Error:', err);
      sendEvent({
        type: 'error',
        message: err.message || 'Error occurred during translation',
      });
      res.end();
    }
  });

  // AI-powered Arabic subtitle translator endpoint
  app.post('/api/gemini/translate-subtitles', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const { vttUrl, vttText, apiKey, model } = req.body;
      const effectiveKey = (typeof apiKey === 'string' && apiKey.trim()) || process.env.GEMINI_API_KEY;

      if (!effectiveKey) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_API_KEY',
          message: 'Please provide a Gemini API key in Settings.',
        });
      }

      // Check in-memory cache if URL or text is supplied
      const cacheKey = (vttUrl && typeof vttUrl === 'string') ? vttUrl : (vttText ? vttText.slice(0, 100) : '');
      if (cacheKey && subtitleTranslationCache.has(cacheKey)) {
        return res.json({
          success: true,
          vttText: subtitleTranslationCache.get(cacheKey),
          cached: true,
        });
      }

      let sourceText = vttText;
      if (!sourceText && vttUrl) {
        let fetchUrl = String(vttUrl).trim();

        // Handle dummy placeholders
        if (fetchUrl === 'en_default' || (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://') && !fetchUrl.startsWith('/api/'))) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_URL',
            message: 'Invalid or expired subtitle URL. Please ensure video is loaded.',
          });
        }

        let headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        };

        if (fetchUrl.includes('hstream.moe') || fetchUrl.includes('/api/hanimestream/subtitle')) {
          headers['Referer'] = 'https://hstream.moe/';
          headers['Origin'] = 'https://hstream.moe';
        }

        if (fetchUrl.startsWith('/api/')) {
          fetchUrl = `http://127.0.0.1:3000${fetchUrl}`;
        }

        let subRes = await fetch(fetchUrl, { headers });
        // If direct fetch of hstream subtitle failed with 403 or 404, try internal proxy
        if (!subRes.ok && fetchUrl.includes('hstream.moe') && !fetchUrl.includes('/api/hanimestream/subtitle')) {
          const proxiedUrl = `http://127.0.0.1:3000/api/hanimestream/subtitle?url=${encodeURIComponent(fetchUrl)}`;
          const retryRes = await fetch(proxiedUrl, { headers }).catch(() => null);
          if (retryRes && retryRes.ok) {
            subRes = retryRes;
          }
        }

        if (!subRes.ok) {
          return res.status(subRes.status).json({
            success: false,
            error: 'FETCH_SUBTITLE_FAILED',
            message: `Failed to load subtitle file: HTTP ${subRes.status}`,
          });
        }
        sourceText = await subRes.text();
      }

      if (!sourceText || typeof sourceText !== 'string' || !sourceText.includes('-->')) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SUBTITLE_FORMAT',
          message: 'Subtitle content is invalid or missing timestamps',
        });
      }

      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const { vttText: translatedVtt, modelUsed } = await translateVttWithGemini(sourceText, ai, undefined, model);

      if (cacheKey) {
        subtitleTranslationCache.set(cacheKey, translatedVtt);
      }

      res.json({
        success: true,
        vttText: translatedVtt,
        modelUsed,
        cached: false,
      });
    } catch (err: any) {
      console.error('[Gemini Subtitle] Translation error:', err);
      const isQuotaError = err?.message?.includes('RESOURCE_EXHAUSTED') || err?.status === 429;
      const isAuthError = err?.message?.includes('API_KEY_INVALID') || err?.status === 400 || err?.status === 401 || err?.message?.includes('API key');
      
      let message = 'Error occurred during subtitle translation via Gemini';
      if (isQuotaError) {
        message = 'Gemini API temporary quota limit exceeded. Please try again shortly.';
      } else if (isAuthError) {
        message = 'Gemini API key is invalid or inactive.';
      }

      res.status(500).json({
        success: false,
        error: isAuthError ? 'INVALID_API_KEY' : (isQuotaError ? 'QUOTA_EXCEEDED' : 'TRANSLATION_FAILED'),
        message,
        details: err.message,
      });
    }
  });

  // Normalized DASH MPD Manifest Generator
  // Fixes backslashes in chunk paths and injects BaseURL for seamless playback
  app.get('/api/hanimestream/manifest.mpd', async (req, res) => {
    try {
      const { domain, path: streamPath, quality, proxyChunks } = req.query;
      if (!domain || !streamPath || !quality) {
        return res.status(400).send('Missing domain, path or quality query parameters');
      }

      const targetDomain = (domain as string).startsWith('http') ? (domain as string) : `https://${domain}`;
      const resolvedQuality = (quality === '1080p48' || quality === '1080i')
        ? '1080i'
        : (quality === '2160p48' || quality === '2160i')
          ? '2160i'
          : quality;
      const targetMpdUrl = `${targetDomain}/${streamPath}/${resolvedQuality}/manifest.mpd`;

      const response = await fetch(targetMpdUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Referer': 'https://hstream.moe/',
          'Origin': 'https://hstream.moe',
        }
      });

      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch upstream MPD: HTTP ${response.status}`);
      }

      let mpdText = await response.text();

      // Fix backslash paths in SegmentTemplate
      mpdText = mpdText.replace(/chunks\\/g, 'chunks/');

      // Ensure Period contains BaseURL so chunk templates resolve cleanly
      const baseChunkUrl = `${targetDomain}/${streamPath}/${quality}/`;
      if (!mpdText.includes('<BaseURL>')) {
        mpdText = mpdText.replace(
          /(<Period\s+[^>]*>)/i,
          `$1\n\t\t<BaseURL>${baseChunkUrl}</BaseURL>`
        );
      }

      res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Origin, Content-Type');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      return res.send(mpdText);
    } catch (e: any) {
      console.error('[Hanimestream] MPD Manifest Error:', e);
      res.status(500).send('Error generating DASH manifest');
    }
  });

  // Proxy for DASH segments/chunks if needed
  app.get('/api/hanimestream/chunk', async (req, res) => {
    try {
      const { base, file, target } = req.query;
      let fullUrl = '';
      if (typeof target === 'string' && target) {
        fullUrl = target;
      } else if (base && file) {
        fullUrl = `${base}${file}`;
      } else {
        return res.status(400).send('Missing base/file or target parameters');
      }

      const upstreamRes = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Referer': 'https://hstream.moe/',
        }
      });

      res.status(upstreamRes.status);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/octet-stream');
      const cl = upstreamRes.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);

      if (upstreamRes.body) {
        const nodeStream = Readable.fromWeb(upstreamRes.body as any);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (e: any) {
      res.status(500).send('Chunk proxy error');
    }
  });

  // Hanimestream High-Performance 206 Partial Content Stream Proxy
  app.get('/api/hanimestream/stream', async (req, res) => {
    try {
      const target = req.query.target;
      if (!target || typeof target !== 'string') {
        return res.status(400).send('Missing target parameter');
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Referer': 'https://hstream.moe/',
      };

      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const abortController = new AbortController();
      req.on('close', () => {
        try { abortController.abort(); } catch (e) {}
      });

      const originRes = await fetch(target.trim(), {
        headers,
        signal: abortController.signal
      });

      res.status(originRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Range, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      const contentType = originRes.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      const contentLength = originRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = originRes.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      if (originRes.body) {
        const nodeStream = Readable.fromWeb(originRes.body as any);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error: any) {
      if (!res.headersSent) res.status(500).send('Stream proxy failed');
    }
  });

  // Diagnostic Probe for all HStream mirrors
  const probeHandler = async (req: express.Request, res: express.Response) => {
    const defaultDomains = [
      'https://imoto-str.ane-h.xyz',
      'https://oppai-str.shoujo-h.org',
      'https://chibi-str.imoto-h.xyz',
      'https://koneko-str.musume-h.xyz',
      'https://shinobu-str.rorikon-h.xyz',
      'https://komako-b-str.musume-h.xyz'
    ];
    const domainsToTest: string[] = Array.isArray(req.body?.domains) && req.body.domains.length > 0
      ? req.body.domains
      : defaultDomains;

    const results = await Promise.all(
      domainsToTest.map(async (domain) => {
        const normDomain = domain.startsWith('http') ? domain : `https://${domain}`;
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const response = await fetch(normDomain, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
              'Referer': 'https://hstream.moe/'
            },
            signal: controller.signal
          });
          clearTimeout(timer);
          const latencyMs = Date.now() - start;
          const cors = response.headers.get('access-control-allow-origin') === '*';
          return {
            domain: normDomain,
            latencyMs,
            status: response.status,
            online: response.status < 500,
            cors
          };
        } catch (e: any) {
          return {
            domain: normDomain,
            latencyMs: Date.now() - start,
            status: 0,
            online: false,
            cors: false
          };
        }
      })
    );

    res.json({ success: true, results });
  };

  app.get('/api/hanimestream/probe', probeHandler);
  app.post('/api/hanimestream/probe', express.json(), probeHandler);

  app.post('/api/scrape/sexmex/search', express.json(), async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: 'Missing query parameter' });

      console.log('Searching SexMex for:', query);
      const searchUrl = `https://sexmex.xxx/tour/search.php?query=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/html',
        }
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      const modelsMap = new Map();
      
      // SexMex search page returns scenes. The scene info has a link to the model.
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/models/') && !href.includes('models.html')) {
           const name = $(el).text().trim();
           // Only add if it's a valid name and actually matches our search roughly (or we return all models involved in matching scenes)
           const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
           const normalizedQuery = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
           if (name && name.length > 1 && normalizedName.includes(normalizedQuery)) {
             let fullUrl = href;
             if (!fullUrl.startsWith('http')) {
                fullUrl = 'https://sexmex.xxx' + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
             }
             if (!modelsMap.has(name)) {
               modelsMap.set(name, {
                 id: fullUrl,
                 name: name,
                 url: fullUrl,
                 // We don't have the model image on the search page, so we leave it empty
                 imageUrl: ""
               });
             }
           }
        }
      });
      
      const performers = Array.from(modelsMap.values()).slice(0, 5); // Limit to top 5 to avoid too many requests
      
      // Fetch the individual model pages to get their images
      await Promise.all(performers.map(async (performer) => {
        try {
          const modelRes = await fetch(performer.url, {
             headers: {
               'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
               'Accept': 'text/html',
             }
          });
          if (modelRes.ok) {
            const modelHtml = await modelRes.text();
            const model$ = cheerio.load(modelHtml);
            const img = model$("img.model_bio_thumb").attr("src") || 
                        model$(".profile-pic img").attr("src") || 
                        model$(`img[alt*="${performer.name}"]`).attr("src");
            if (img) {
               const rawImgUrl = img.startsWith('http') ? img : 'https://sexmex.xxx' + (img.startsWith('/') ? '' : '/') + img;
               performer.imageUrl = `/api/sexmex/image?url=${encodeURIComponent(rawImgUrl)}`;
            }
          }
        } catch (err) {
          console.error("Error fetching model image for", performer.name, err);
        }
      }));

      res.json({ performers });
    } catch (e: any) {
      console.error("SexMex Search Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/scrape/sexmex', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'Missing url parameter' });

      console.log('Scraping SexMex Model page:', url);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        }
      });
      const html = await response.text();
      if (!html || html.length < 500) {
        return res.status(response.status || 500).json({ error: `Failed to fetch SexMex page content (HTML is too short or empty)` });
      }
      const $ = cheerio.load(html);
      
      // Determine the main model's name from URL as a fallback, e.g. EstelaOsorio -> Estela Osorio
      let modelUrlName = '';
      const urlMatch = url.match(/\/models\/([^/]+)\.html/i);
      if (urlMatch) {
        let rawName = urlMatch[1];
        // Split camelcase / pascalcase to words
        modelUrlName = rawName.replace(/([A-Z])/g, ' $1').trim();
      }

      const scenes: any[] = [];
      $('.thumb').each((i, el) => {
        const $el = $(el);

        // Strict scene update link detection to avoid picking up profile / actor cards
        let hasUpdateLink = false;
        $el.find('a').each((_i, aEl) => {
          const href = $(aEl).attr('href') || '';
          if (href.includes('/updates/') || href.includes('/tour/updates/')) {
            hasUpdateLink = true;
          }
        });

        if (!hasUpdateLink) {
          return;
        }

        let title = $el.find('h5.scene-title a').text().trim();
        if (!title) {
          title = $el.find('.videothumbnail a').attr('title')?.trim() || '';
        }

        if (!title) {
          return;
        }

        let coverUrl = $el.find('.videothumbnail img').attr('src')?.trim();
        if (!coverUrl) {
          coverUrl = $el.find('img').attr('src')?.trim() || '';
        }

        if (coverUrl && coverUrl.startsWith('//')) {
          coverUrl = 'https:' + coverUrl;
        }

        // Extract dates
        let dateStr = $el.find('.scene-date').text().trim();
        let releaseDate: number | undefined;
        if (dateStr) {
          // Parse format MM/DD/YYYY, e.g. 05/25/2026
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            const mm = parseInt(parts[0], 10);
            const dd = parseInt(parts[1], 10);
            const yyyy = parseInt(parts[2], 10);
            const parsed = new Date(yyyy, mm - 1, dd).getTime();
            if (!isNaN(parsed)) {
              releaseDate = parsed;
              const d = new Date(parsed);
              dateStr = d.toISOString().split('T')[0];
            }
          }
        }

        // Smart Title and Cast parsing
        let cleanTitle = title;
        const actors: string[] = [];

        // 1. Precise Actor Extraction via HTML Model Links
        $el.find('a').each((_idx, aEl) => {
          const href = $(aEl).attr('href') || '';
          if (href.includes('/models/')) {
            const name = $(aEl).text().trim();
            if (name && !actors.includes(name)) {
              actors.push(name);
            }
          }
        });

        // Decode basic HTML entities that might appear in title
        title = title
          .replace(/&rsquo;/g, "'")
          .replace(/&lsquo;/g, "'")
          .replace(/&rdquo;/g, '"')
          .replace(/&ldquo;/g, '"')
          .replace(/&amp;/g, '&');

        if (title.includes(' . ')) {
          const parts = title.split(' . ');
          cleanTitle = parts[0].trim();
          const actorsStr = parts[1].trim();
          if (actors.length === 0) {
            const individualActors = actorsStr.split(/, | & /);
            individualActors.forEach(act => {
              const trimmed = act.trim();
              if (trimmed && !actors.includes(trimmed)) {
                actors.push(trimmed);
              }
            });
          }
        } else if (title.includes(' .')) {
          const parts = title.split(' .');
          cleanTitle = parts[0].trim();
          const actorsStr = parts[1].trim();
          if (actors.length === 0) {
            const individualActors = actorsStr.split(/, | & /);
            individualActors.forEach(act => {
              const trimmed = act.trim();
              if (trimmed && !actors.includes(trimmed)) {
                actors.push(trimmed);
              }
            });
          }
        } else if (title.includes('.')) {
          const parts = title.split('.');
          cleanTitle = parts[0].trim();
          const actorsStr = parts.slice(1).join('.').trim();
          if (actors.length === 0 && actorsStr && actorsStr.length < 50) {
            const individualActors = actorsStr.split(/, | & /);
            individualActors.forEach(act => {
              const trimmed = act.trim();
              if (trimmed && !actors.includes(trimmed)) {
                actors.push(trimmed);
              }
            });
          }
        }

        // Fallback actors
        if (actors.length === 0 && modelUrlName) {
          actors.push(modelUrlName);
        }

        if (cleanTitle || coverUrl) {
          // Normalize and clean actor names (remove accents/diacritics like Márquez -> Marquez)
          const normalizedActors = actors.map(name =>
            name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
          );

          let proxiedCoverUrl = coverUrl;
          if (coverUrl && !coverUrl.startsWith('/api/')) {
            proxiedCoverUrl = `/api/sexmex/image?url=${encodeURIComponent(coverUrl)}`;
          }

          scenes.push({
            title: cleanTitle,
            actors: normalizedActors,
            coverUrl: proxiedCoverUrl,
            rawCoverUrl: coverUrl,
            date: dateStr,
            releaseDate: releaseDate,
            tag: 'SexMex'
          });
        }
      });

      console.log(`Extracted ${scenes.length} scenes from ${url}`);
      return res.json({ success: true, url, scenes });
    } catch (error: any) {
      console.error('SexMex Scraper Error:', error.message);
      return res.status(500).json({ error: 'Internal Server Error: ' + error.message });
    }
  });



  // Fast keep-alive HTTP headers & agent options
  const viperDefaultHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive"
  };

  // Note: Live direct scraper without caching as requested
  app.post('/api/extract/viper', express.json(), async (req, res) => {
    try {
      const { title, actorName, actors: providedActors, studioName, date, postUrl, url: directInputUrl } = req.body;
      const targetDirectUrl = (postUrl || directInputUrl || '').trim();

      const cheerio = await import('cheerio');

      const safeUrl = (u: string) => {
        try {
          return new URL(u.trim().replace(/[\r\n]/g, '')).href;
        } catch(e) {
          return encodeURI(u.trim().replace(/[\r\n]/g, ''));
        }
      };

      // 1. DIRECT URL HANDLING (Viper.to or AdultPhotoSets.best)
      if (targetDirectUrl && targetDirectUrl.includes('viper.to')) {
        try {
          console.log(`[Viper Scraper] Direct Viper.to URL provided: ${targetDirectUrl}`);
          const threadRes = await fetch(targetDirectUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://viper.to/'
            }
          });
          const threadHtml = await threadRes.text();
          const $thread = cheerio.load(threadHtml);
          const images: string[] = [];
          const thumbnails: string[] = [];

          $thread('.postcontent img, .postbody img, .post_message img, blockquote img, .content img').each((_, el) => {
            let src = $thread(el).attr('src') || $thread(el).attr('data-src') || $thread(el).attr('href') || '';
            const parentHref = $thread(el).closest('a').attr('href') || '';
            if (src) {
              if (src.includes('/th/') || src.includes('thumb')) {
                thumbnails.push(safeUrl(src));
                if (parentHref && (parentHref.includes('/i/') || parentHref.includes('/images/') || parentHref.includes('imx.to') || parentHref.includes('vipr.im'))) {
                  images.push(safeUrl(parentHref));
                } else {
                  images.push(safeUrl(src.replace('/th/', '/i/')));
                }
              } else {
                images.push(safeUrl(src));
              }
            }
          });

          if (images.length > 0) {
            return res.json({
              success: true,
              url: targetDirectUrl,
              images: Array.from(new Set(images)),
              thumbnails: Array.from(new Set(thumbnails))
            });
          }
        } catch (err: any) {
          console.error(`[Viper Scraper] Error scraping direct Viper URL:`, err.message);
        }
      }

      if (!actorName && (!providedActors || providedActors.length === 0) && !targetDirectUrl) {
        return res.status(400).json({ error: "Actor name is required to search viper.to" });
      }

      const safeActorName = actorName != null ? String(actorName).trim() : '';
      const safeTitle = title != null ? String(title).trim() : '';
      const safeStudioName = studioName != null ? String(studioName).trim() : '';
      const safeDate = date != null ? String(date).trim() : '';

      const allowedAuthorsSet = new Set([
        "pantisq_a",
        "pantisq",
        "lanny",
        "rex",
        "floflo",
        "hprnp",
        "cypher",
        "janjun",
        "colorzebra",
        "asaaaaaad",
        "teenmushi",
        "pixel",
        "glendower"
      ]);

      const tier1Authors = new Set([
        "pantisq_a",
        "pantisq",
        "lanny",
        "rex",
        "floflo",
        "hprnp",
        "cypher",
        "janjun",
        "colorzebra",
        "asaaaaaad",
        "teenmushi",
        "pixel",
        "glendower"
      ]);

      const isUserAllowed = (authorName: string) => {
        if (!authorName) return false;
        const clean = authorName.trim().toLowerCase();
        if (allowedAuthorsSet.has(clean)) return true;
        for (const a of allowedAuthorsSet) {
          if (clean === a || clean.startsWith(a + '_') || clean.startsWith(a + ' ')) return true;
        }
        return false;
      };

      // Extract all actors cleanly (supports string with delimiters like &, and, comma, or array)
      const allActorNames: string[] = [];
      if (Array.isArray(providedActors)) {
        providedActors.forEach(a => {
          if (typeof a === 'string' && a.trim()) allActorNames.push(a.trim());
        });
      }
      if (actorName && typeof actorName === 'string') {
        const splitActors = actorName.split(/\s*(?:&|and|,|\/|\+|\u0648)\s*/i).map(s => s.trim()).filter(Boolean);
        splitActors.forEach(a => {
          if (!allActorNames.some(existing => existing.toLowerCase() === a.toLowerCase())) {
            allActorNames.push(a);
          }
        });
      }
      const primaryActor = allActorNames[0] || (actorName ? String(actorName).trim() : "");

      // Safe Date parser (handles timestamp numbers like 1751673600000, string dates like "5 Jul 2025", "2025-07-05", etc.)
      const parseDateSafe = (val: any): Date | null => {
        if (!val) return null;
        if (val instanceof Date && !isNaN(val.getTime())) return val;
        const num = Number(val);
        if (!isNaN(num) && num > 10000000) {
          const d = new Date(num);
          if (!isNaN(d.getTime())) return d;
        }
        const d = new Date(String(val).trim());
        if (!isNaN(d.getTime())) return d;
        return null;
      };

      // 1. Generate comprehensive date tokens supporting names of months, various separators, and +/- 1 day timezone tolerance
      const generateDateTokens = (dateStr: string) => {
        if (!dateStr) return [];
        const tokens = new Set<string>();
        const baseD = parseDateSafe(dateStr);
        if (!baseD) return [];

        const monthNamesFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        // Check target date, plus 1 day, and minus 1 day to handle timezone publishing variances
        const datesToCheck = [
          baseD,
          new Date(baseD.getTime() - 24 * 60 * 60 * 1000),
          new Date(baseD.getTime() + 24 * 60 * 60 * 1000)
        ];

        for (const d of datesToCheck) {
          const year = d.getFullYear().toString();
          const shortYear = year.slice(-2);
          const monthIdx = d.getMonth();
          const monthPad = (monthIdx + 1).toString().padStart(2, '0');
          const monthRaw = (monthIdx + 1).toString();
          const dayPad = d.getDate().toString().padStart(2, '0');
          const dayRaw = d.getDate().toString();

          const mFull = monthNamesFull[monthIdx];
          const mShort = monthNamesShort[monthIdx];

          // Formats with month names (e.g., January-20-2026, March-18-2026, Dec 17, 2025, March 06, 2026)
          tokens.add(`${mFull}-${dayPad}-${year}`);
          tokens.add(`${mFull}-${dayRaw}-${year}`);
          tokens.add(`${mFull} ${dayPad} ${year}`);
          tokens.add(`${mFull} ${dayRaw} ${year}`);
          tokens.add(`${mFull} ${dayPad}, ${year}`);
          tokens.add(`${mFull} ${dayRaw}, ${year}`);
          tokens.add(`${mFull}-${dayPad}-${shortYear}`);
          tokens.add(`${mFull}-${dayRaw}-${shortYear}`);
          tokens.add(`${mShort}-${dayPad}-${year}`);
          tokens.add(`${mShort}-${dayRaw}-${year}`);
          tokens.add(`${mShort} ${dayPad} ${year}`);
          tokens.add(`${mShort} ${dayRaw} ${year}`);
          tokens.add(`${mShort} ${dayPad}, ${year}`);
          tokens.add(`${mShort} ${dayRaw}, ${year}`);
          tokens.add(`${mShort}-${dayPad}-${shortYear}`);
          tokens.add(`${mShort}-${dayRaw}-${shortYear}`);

          // Short Day-Month / Month-Day tokens (without year, as seen in "21 Apr", "Apr 21", "21-Apr", etc.)
          // Both Day-Month text formats for floflo (e.g., 21-Apr-2024, 21-Apr)
          tokens.add(`${dayPad} ${mShort}`);
          tokens.add(`${dayRaw} ${mShort}`);
          tokens.add(`${mShort} ${dayPad}`);
          tokens.add(`${mShort} ${dayRaw}`);
          tokens.add(`${dayPad}-${mShort}`);
          tokens.add(`${dayRaw}-${mShort}`);
          tokens.add(`${mShort}-${dayPad}`);
          tokens.add(`${mShort}-${dayRaw}`);
          tokens.add(`${dayPad}-${mShort}-${year}`);
          tokens.add(`${dayRaw}-${mShort}-${year}`);
          tokens.add(`${dayPad}-${mShort}-${shortYear}`);
          tokens.add(`${dayRaw}-${mShort}-${shortYear}`);
          tokens.add(`${dayPad}.${mShort}.${year}`);
          tokens.add(`${dayRaw}.${mShort}.${year}`);
          tokens.add(`${dayPad} ${mShort} ${year}`);
          tokens.add(`${dayRaw} ${mShort} ${year}`);
          tokens.add(`${dayPad} ${mFull}`);
          tokens.add(`${dayRaw} ${mFull}`);
          tokens.add(`${mFull} ${dayPad}`);
          tokens.add(`${mFull} ${dayRaw}`);

          // Standard numeric formats (e.g., 12-17-2025, 12/17/2025, 17-12-2025, 2025-12-17)
          tokens.add(`${monthPad}-${dayPad}-${year}`);
          tokens.add(`${monthPad}/${dayPad}/${year}`);
          tokens.add(`${monthPad}.${dayPad}.${year}`);
          tokens.add(`${monthPad}-${dayPad}-${shortYear}`);
          tokens.add(`${monthPad}/${dayPad}/${shortYear}`);
          tokens.add(`${monthPad}.${dayPad}.${shortYear}`);

          tokens.add(`${dayPad}-${monthPad}-${year}`);
          tokens.add(`${dayPad}/${monthPad}/${year}`);
          tokens.add(`${dayPad}.${monthPad}.${year}`);
          tokens.add(`${dayPad}-${monthPad}-${shortYear}`);
          tokens.add(`${dayPad} ${monthPad} ${year}`);
          tokens.add(`${dayPad} ${monthPad} ${shortYear}`);

          tokens.add(`${year}-${monthPad}-${dayPad}`);
          tokens.add(`${year}/${monthPad}/${dayPad}`);
          tokens.add(`${year}.${monthPad}.${dayPad}`);
          tokens.add(`${shortYear}-${monthPad}-${dayPad}`);
          tokens.add(`${shortYear}.${monthPad}.${dayPad}`);
          tokens.add(`${shortYear} ${monthPad} ${dayPad}`);
          tokens.add(`${shortYear}${monthPad}${dayPad}`);
          tokens.add(`${monthPad}${dayPad}${shortYear}`);

          tokens.add(`${monthPad}-${dayPad}`);
          tokens.add(`${monthPad}/${dayPad}`);
        }

        return Array.from(tokens);
      };

      const dateTokens = generateDateTokens(safeDate);

      // Generate actor variations (e.g. "Mellanie Monroe" -> "Melanie Monroe", "Devil khloe" -> "Devil khloee", "Ms London" -> "Ms. London", "Melanie", etc.)
      const generateActorVariants = (name: string): string[] => {
        if (!name) return [];
        const variants = new Set<string>();
        const clean = name.trim();
        variants.add(clean);
        
        // Handle honorifics like "Ms", "Miss", "Lady", "Dr"
        if (/^(ms|miss|mrs|lady|dr)\.?\s+/i.test(clean)) {
          variants.add(clean.replace(/^(ms|miss|mrs|lady|dr)\.?\s+/i, '').trim());
          if (/^ms\s+/i.test(clean)) {
            variants.add(clean.replace(/^ms\s+/i, 'Ms. '));
          }
        }

        // 1. Deduplicate repeated letters in the full name (e.g., "Mellanie" -> "Melanie", "Khloee" -> "Khloe", "Brittney" -> "Britney")
        const dedupLetters = clean.replace(/([a-zA-Z])\1+/g, '$1');
        if (dedupLetters !== clean && dedupLetters.length >= 3) {
          variants.add(dedupLetters);
        }

        const words = clean.split(/\s+/);
        if (words.length > 0) {
          const lastWord = words[words.length - 1];
          if (lastWord.toLowerCase().endsWith('e') && !lastWord.toLowerCase().endsWith('ee')) {
            const variantWords = [...words];
            variantWords[variantWords.length - 1] = lastWord + 'e';
            variants.add(variantWords.join(' '));
          } else if (lastWord.toLowerCase().endsWith('ee')) {
            const variantWords = [...words];
            variantWords[variantWords.length - 1] = lastWord.slice(0, -1);
            variants.add(variantWords.join(' '));
          }
        }

        // 2. Add individual first/last name variants when the actor has multiple names (e.g., "Mellanie" and "Melanie")
        if (words.length >= 2) {
          for (const w of words) {
            if (w.length >= 4) {
              variants.add(w);
              const dedupW = w.replace(/([a-zA-Z])\1+/g, '$1');
              if (dedupW !== w && dedupW.length >= 3) {
                variants.add(dedupW);
              }
            }
          }
        }

        return Array.from(variants);
      };

      const primaryVariants = generateActorVariants(primaryActor);

      // Stop words for title extraction (filtering pure grammatical words only)
      const stopWords = new Set([
        'the', 'and', 'for', 'with', 'from', 'her', 'his', 'all', 'out', 'you',
        'was', 'were', 'our', 'a', 'an', 'to', 'in', 'on', 'at', 'of', 'by', 'is', 'it', 'its',
        'into', 'up', 'their', 'lets', 'let', 's', 'how', 'much', 'can', 'must', 'also',
        'she', 'him', 'they', 'them', 'has', 'had', 'have', 'been', 'will', 'would', 'could', 'should',
        'some', 'over', 'than', 'what', 'when', 'where', 'why', 'who', 'this', 'that'
      ]);

      // Levenshtein distance for fuzzy actor token removal from title words
      const calcLevenshtein = (a: string, b: string): number => {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
          }
        }
        return dp[m][n];
      };

      // Normalize title: remove apostrophe-s (e.g. Lawson's or Lawson’s -> Lawson) before splitting
      const normalizedTitle = (title || "")
        .replace(/['’]s\b/gi, '')
        .replace(/[^a-zA-Z0-9]/g, ' ');

      // Also collect condensed and exact words for hyphenated tokens (e.g. "Me-owww" -> "Me-owww", "Meowww", "Me", "owww")
      const condensedWords: string[] = [];
      const hyphenMatches = (title || "").match(/[a-zA-Z0-9]+-[a-zA-Z0-9]+/g);
      if (hyphenMatches) {
        for (const hm of hyphenMatches) {
          condensedWords.push(hm.toLowerCase());
          const condensed = hm.replace(/-/g, '');
          if (condensed.length >= 2 && !stopWords.has(condensed.toLowerCase())) {
            condensedWords.push(condensed);
          }
          const parts = hm.split('-');
          for (const p of parts) {
            if (p.length >= 2 && !stopWords.has(p.toLowerCase())) {
              condensedWords.push(p);
            }
          }
        }
      }

      // If title is short (<= 2 words), allow words of length >= 2
      const minWordLen = normalizedTitle.trim().split(/\s+/).length <= 2 ? 2 : 3;

      const rawTitleWords = Array.from(new Set([
        ...normalizedTitle.split(/\s+/).filter((w: string) => w.length >= minWordLen && !stopWords.has(w.toLowerCase())),
        ...condensedWords
      ]));

      // Collect all actor tokens including normalized/clean variants
      const actorTokens = allActorNames
        .flatMap(a => generateActorVariants(a))
        .flatMap(a => a.toLowerCase().split(/\s+/))
        .filter(t => t.length >= 3);

      // Check if a title word belongs to the actor's name (exact or fuzzy typo like "Moroe" vs "Monroe" or "Melanie" vs "Mellanie")
      const isActorLikeWord = (w: string): boolean => {
        const wLow = w.toLowerCase();
        const wDedup = wLow.replace(/([a-zA-Z])\1+/g, '$1');
        for (const actTok of actorTokens) {
          const actDedup = actTok.replace(/([a-zA-Z])\1+/g, '$1');
          if (wLow === actTok || wDedup === actDedup) return true;
          if (Math.abs(wLow.length - actTok.length) <= 1 && calcLevenshtein(wLow, actTok) <= 1) return true;
          if (wLow.length >= 4 && actTok.length >= 4 && (wLow.startsWith(actTok.slice(0, 4)) || actTok.startsWith(wLow.slice(0, 4)))) return true;
        }
        return false;
      };

      // Pure scene content words (guaranteed free of actor names or actor typos)
      const trueSceneWords = rawTitleWords.filter(w => !isActorLikeWord(w));

      // De-duplicate stemming and hyphen variants to prevent duplicate phrases like "me-owww Meowww"
      const seenStems = new Set<string>();
      const cleanSceneWords: string[] = [];
      // Prefer longer/cleaner tokens first
      const sortedCandidates = [...trueSceneWords].sort((a: string, b: string) => b.length - a.length);
      for (const w of sortedCandidates) {
        const stem = w.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (stem.length >= 2 && !seenStems.has(stem)) {
          seenStems.add(stem);
          cleanSceneWords.push(w);
        }
      }

      // Check if original title had multiple words (to avoid combining variants of single-word titles)
      const originalTitleTokens = normalizedTitle.trim().split(/\s+/).filter((w: string) => w.length >= minWordLen && !stopWords.has(w.toLowerCase()));
      const hasMultiWordSceneTitle = originalTitleTokens.length >= 2;

      // Positional words (first 3 meaningful words from clean scene words)
      const earlyTitleWordsNoActor = cleanSceneWords.slice(0, 3);

      // Distinctive words sorted by length (longest/most specific scene descriptors first)
      const distinctiveTitleWordsNoActor = [...cleanSceneWords].sort((a: string, b: string) => b.length - a.length);

      // Extract high-priority US date formats & floflo date formats (including exact date and +/- 1 day for timezone shifts)
      const primaryUsDateFormats: string[] = [];
      const primaryFloFloDateFormats: string[] = [];
      const primaryMonthNameFormats: string[] = [];
      
      if (safeDate) {
        const baseD = parseDateSafe(safeDate);
        if (baseD) {
          const datesToCheck = [
            baseD,
            new Date(baseD.getTime() - 24 * 60 * 60 * 1000),
            new Date(baseD.getTime() + 24 * 60 * 60 * 1000)
          ];

          const monthNamesFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
          const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

          for (const d of datesToCheck) {
            const year = d.getFullYear().toString();
            const shortYear = year.slice(-2);
            const monthPad = (d.getMonth() + 1).toString().padStart(2, '0');
            const dayPad = d.getDate().toString().padStart(2, '0');
            const dayRaw = d.getDate().toString();
            const mFull = monthNamesFull[d.getMonth()];
            const mShort = monthNamesShort[d.getMonth()];

            // Both MM.DD.YYYY, MM-DD-YYYY, MM/DD/YYYY, MM.DD.YY, MM-DD-YY, and MM/DD/YY are top tier
            const fLongDot = `${monthPad}.${dayPad}.${year}`;
            const fLongHyphen = `${monthPad}-${dayPad}-${year}`;
            const fLongSlash = `${monthPad}/${dayPad}/${year}`;
            const fShortDot = `${monthPad}.${dayPad}.${shortYear}`;
            const fShortHyphen = `${monthPad}-${dayPad}-${shortYear}`;
            const fShortSlash = `${monthPad}/${dayPad}/${shortYear}`;

            if (!primaryUsDateFormats.includes(fLongDot)) primaryUsDateFormats.push(fLongDot);
            if (!primaryUsDateFormats.includes(fLongHyphen)) primaryUsDateFormats.push(fLongHyphen);
            if (!primaryUsDateFormats.includes(fLongSlash)) primaryUsDateFormats.push(fLongSlash);
            if (!primaryUsDateFormats.includes(fShortDot)) primaryUsDateFormats.push(fShortDot);
            if (!primaryUsDateFormats.includes(fShortHyphen)) primaryUsDateFormats.push(fShortHyphen);
            if (!primaryUsDateFormats.includes(fShortSlash)) primaryUsDateFormats.push(fShortSlash);

            // floflo formats (e.g. 21-Apr-2024, 21-Apr, 21 Apr, 31 May)
            const ff1 = `${dayRaw}-${mShort}-${year}`;
            const ff2 = `${dayPad}-${mShort}-${year}`;
            const ff3 = `${dayRaw}-${mShort}`;
            const ff4 = `${dayPad}-${mShort}`;
            const ff5 = `${dayRaw} ${mShort}`;
            const ff6 = `${dayPad} ${mShort}`;
            if (!primaryFloFloDateFormats.includes(ff1)) primaryFloFloDateFormats.push(ff1);
            if (!primaryFloFloDateFormats.includes(ff2)) primaryFloFloDateFormats.push(ff2);
            if (!primaryFloFloDateFormats.includes(ff3)) primaryFloFloDateFormats.push(ff3);
            if (!primaryFloFloDateFormats.includes(ff4)) primaryFloFloDateFormats.push(ff4);
            if (!primaryFloFloDateFormats.includes(ff5)) primaryFloFloDateFormats.push(ff5);
            if (!primaryFloFloDateFormats.includes(ff6)) primaryFloFloDateFormats.push(ff6);

            // asaaaaaad & Full month formats (e.g. October 29 2021, Oct 29 2021, October 2021)
            const af1 = `${mFull} ${dayRaw} ${year}`;
            const af2 = `${mFull} ${dayPad} ${year}`;
            const af3 = `${mShort} ${dayRaw} ${year}`;
            const af4 = `${mShort} ${dayPad} ${year}`;
            const af5 = `${mFull} ${dayRaw}`;
            const af6 = `${mFull} ${dayPad}`;
            if (!primaryMonthNameFormats.includes(af1)) primaryMonthNameFormats.push(af1);
            if (!primaryMonthNameFormats.includes(af2)) primaryMonthNameFormats.push(af2);
            if (!primaryMonthNameFormats.includes(af3)) primaryMonthNameFormats.push(af3);
            if (!primaryMonthNameFormats.includes(af4)) primaryMonthNameFormats.push(af4);
            if (!primaryMonthNameFormats.includes(af5)) primaryMonthNameFormats.push(af5);
            if (!primaryMonthNameFormats.includes(af6)) primaryMonthNameFormats.push(af6);
          }
        }
      }

      // 2. Build High-Precision Search Queries with the Adaptive Instant-Hit Strategy
      interface ViperSearchTarget {
        query: string;
        searchuser?: string;
        starteronly?: boolean;
        titleonly?: boolean;
        exactname?: boolean;
      }

      const searchTargets: ViperSearchTarget[] = [];
      const addedTargets = new Set<string>();

      const addTarget = (t: ViperSearchTarget) => {
        const key = `${t.query}|${t.searchuser || ''}|${t.titleonly ? '1' : '0'}`;
        if (!addedTargets.has(key)) {
          addedTargets.add(key);
          searchTargets.push(t);
        }
      };

      // Collect all distinct actor variants across all given actor names
      const allVariantsList: string[] = [];
      for (const act of allActorNames) {
        const vars = generateActorVariants(act);
        for (const v of vars) {
          if (!allVariantsList.includes(v)) allVariantsList.push(v);
        }
      }

      // Dynamically prioritize top publishers based on Studio and Scene Title signatures
      const sLower = (studioName || '').toLowerCase();
      const tLower = (title || '').toLowerCase();

      // Check if studio is SexMex & related sub-studios
      const isSexMex = !!(studioName && typeof studioName === 'string' && /sexmex|sex\s*mex|latin\s*leche|latinleche|latin\s*pervs|latinpervs|hot\s*spanish|pornostars/i.test(studioName)) ||
        /\b(?:sexmex|sex\s+mex|latinleche|latin\s+leche)\b/i.test(tLower);

      // Check if studio belongs to Kelly Madison Network & Sub-studios:
      // 1. Kelly Madison / KellyMadison
      // 2. PornFidelity
      // 3. TeenFidelity
      // 4. 5KPorn
      // 5. 5Kteens / 5K Teens
      // 6. 8K Milfs / 8KMilfs
      // 7. 8K Teens / 8KTeens
      const KELLY_MADISON_SUB_STUDIOS = [
        'kelly madison', 'kellymadison',
        'pornfidelity', 'porn fidelity',
        'teenfidelity', 'teen fidelity',
        '5kporn', '5k porn',
        '5kteens', '5k teens',
        '8k milfs', '8kmilfs', '8k milf', '8kmilf',
        '8k teens', '8kteens', '8k teen', '8kteen'
      ];

      let detectedKellyMadisonStudio = '';
      for (const km of KELLY_MADISON_SUB_STUDIOS) {
        if (sLower.includes(km) || tLower.includes(km)) {
          detectedKellyMadisonStudio = km;
          break;
        }
      }

      const isKellyMadison = !!detectedKellyMadisonStudio ||
        /kelly\s*madison|pornfidelity|porn\s*fidelity|teenfidelity|teen\s*fidelity|5k\s*porn|5kporn|5k\s*teens|5kteens|8k\s*milfs|8kmilfs|8k\s*teens|8kteens/i.test(studioName || '') ||
        /\b(?:pornfidelity|teenfidelity|5kporn|5kteens|8kmilfs|8kteens|kelly\s+madison)\b/i.test(tLower);

      const prioritizedPublishers: string[] = [];
      const addPublisher = (p: string) => {
        if (!prioritizedPublishers.includes(p)) prioritizedPublishers.push(p);
      };

      // 1. High-Precision Naughty America & Sub-studios / Sub-series Detection (routes directly to hprnp then rex/pixel)
      const NAUGHTY_SERIES_LIST = [
        'neighbor affair', 'neighboraffair',
        'my first sex teacher', 'myfirstsexteacher',
        'housewife 1on1', 'housewife 1 on 1', 'housewives 1on1', 'housewives 1 on 1',
        "tonight's girlfriend", 'tonights girlfriend', 'tonightsgirlfriend',
        'naughty bookworms', 'naughty athletics', 'naughty weddings', 'naughty rich girls',
        'naughty office', 'naughty country girls', 'naughty country club', 'naughty college', 'naughty gym', 'naughty flip phone',
        'diary of a naughty nanny', 'diary of a nanny',
        '2 chicks same time', 'two chicks same time',
        'american daydreams',
        "my wife's hot friend", 'my wifes hot friend',
        "my friend's hot mom", 'my friends hot mom',
        "my sister's hot friend", 'my sisters hot friend',
        "my daughter's hot friend", 'my daughters hot friend',
        "my girl's hot friend", 'my girls hot friend',
        "my husband's hot friend", 'my husbands hot friend',
        'wives run wild', 'i have a wife', 'dirty wives club',
        'seduced by a cougar', 'seduced by a couple',
        'single moms', 'single mom',
        'latin adultery', 'fast times at deep crack',
        'milf monster', 'the vidas',
        'pornstar wife', 'porn star wife',
        'porn star experience', 'pornstar experience', 'pse',
        'thundercock', 'funsized', 'bossy bar wench', 'glory house',
        'yes chef', 'yes, chef', 'bad ass badges'
      ];

      let detectedNaughtySeries = '';
      for (const s of NAUGHTY_SERIES_LIST) {
        if (sLower.includes(s) || tLower.includes(s)) {
          detectedNaughtySeries = s;
          break;
        }
      }

      const isNaughtyAmerica = !!detectedNaughtySeries ||
        sLower.includes('naughty') ||
        sLower.includes('naughty america') ||
        sLower.includes('naughtyamerica') ||
        sLower.includes('tonight') ||
        sLower.includes('girlfriend') ||
        sLower.includes('family strokes') ||
        tLower.includes('naughty') ||
        /boyfriend|girlfriend|friend'?s\s+|sister'?s\s+|dad'?s\s+|wife'?s\s+|neighbor|porn\s*star\s*experience|\bwebcam\b|\bbully\b|naughty\s+office|tits\s+bounce|tattooed\s+and\s+pierced|tonight'?s\s+girlfriend|tonightsgirlfriend|party\s+girls|pornstar\s+wife|funsized|thundercock|bossy\s+bar\s+wench|summer\s+vacation|glory\s+house|yes,?\s*chef|wives\s+run\s+wild|i\s+have\s+a\s+wife|seduced\s+by\s+a\s+couple|housewife\s*1on1|american\s+daydreams|diary\s+of\s+a\s+nanny|latin\s+adultery/i.test(title || '');

      if (isNaughtyAmerica) {
        addPublisher('hprnp');
        addPublisher('rex');
        addPublisher('pixel');
      }

      // 2. High-Precision HardX / DarkX / EroticaX / FantasyHD / Jules Jordan / Evil Angel / Anal Terror Signature Detection (routes directly to rex)
      const isHardXOrRex = sLower.includes('hardx') || sLower.includes('darkx') || sLower.includes('eroticax') || sLower.includes('fantasyhd') || sLower.includes('jules jordan') || sLower.includes('julesjordan') || sLower.includes('evil angel') || sLower.includes('evilangel') || sLower.includes('anal terror') || sLower.includes('analterror') || sLower.includes('anal beauty') || sLower.includes('anal angels') ||
        /gets\s+slayed|begs\s+for\s+cum|redhead\s+begs|making\s+a\s+hole|tattooed\s+redhead|stop\s+recording|say\s+no\s+knowing|anal\s+terror|analterror/i.test(tLower);

      if (isHardXOrRex) {
        addPublisher('rex');
      }

      // 3. BangBros & Sub-studios / Sub-series Detection
      const BANGBROS_SERIES_LIST = [
        'bangbros', 'bang bros',
        'dadsloveporn', 'dads love porn', 'dadslove',
        'ass parade', 'assparade',
        'bangbus', 'bang bus',
        'bangcasting', 'bang casting',
        'bang pow', 'bang real', 'bang originals', 'bang trick', 'bang boat', 'bang van',
        'big tit creampie', 'bigtitcreampie',
        'big mouthfuls',
        'big cock candy mountain',
        'big wet tits',
        'tugjobs', 'tug jobs',
        'milf soup',
        'milf lessons',
        'stepmom lessons',
        'blowjob fridays',
        'facial fest',
        'brown bunnies',
        'latina rampage',
        'latinas love big cocks',
        'monsters of cock', 'monster cock',
        'black is better', 'white is better',
        'living with anna', 'living with lexxi',
        'bake my cake',
        'can he score',
        'in the crack',
        'party of three',
        'standby for ass',
        'bang pov', 'blowjob pov', 'blowjobpov',
        'my dirty maid',
        'dorm room sex',
        'clips4sale'
      ];

      let detectedBangBrosSeries = '';
      for (const s of BANGBROS_SERIES_LIST) {
        if (sLower.includes(s) || tLower.includes(s)) {
          detectedBangBrosSeries = s;
          break;
        }
      }

      const isBangBros = !!detectedBangBrosSeries ||
        sLower.includes('bangbros') ||
        sLower.includes('bang bros') ||
        sLower.includes('dadsloveporn') ||
        sLower.includes('dads love porn') ||
        sLower.includes('dadslove') ||
        sLower.includes('bangbus') ||
        sLower.includes('bang bus') ||
        sLower.includes('bangcasting') ||
        sLower.includes('bang casting') ||
        sLower.includes('bang pow') ||
        sLower.includes('bang real') ||
        sLower.includes('bang originals') ||
        sLower.includes('bang trick') ||
        sLower.includes('bang boat') ||
        sLower.includes('bang van') ||
        sLower.includes('big tit creampie') || sLower.includes('bigtitcreampie') ||
        sLower.includes('big mouthfuls') ||
        sLower.includes('big cock candy mountain') ||
        sLower.includes('big wet tits') ||
        sLower.includes('tugjobs') || sLower.includes('tug jobs') ||
        sLower.includes('milf soup') ||
        sLower.includes('milf lessons') ||
        sLower.includes('stepmom lessons') ||
        sLower.includes('blowjob fridays') ||
        sLower.includes('facial fest') ||
        sLower.includes('brown bunnies') ||
        sLower.includes('latina rampage') ||
        sLower.includes('latinas love big cocks') ||
        sLower.includes('monsters of cock') ||
        sLower.includes('monster cock') ||
        sLower.includes('black is better') ||
        sLower.includes('white is better') ||
        sLower.includes('living with anna') ||
        sLower.includes('living with lexxi') ||
        sLower.includes('bake my cake') ||
        sLower.includes('can he score') ||
        sLower.includes('in the crack') ||
        sLower.includes('party of three') ||
        sLower.includes('standby for ass') ||
        sLower.includes('bang pov') ||
        sLower.includes('blowjob pov') ||
        sLower.includes('blowjobpov') ||
        sLower.includes('my dirty maid') ||
        sLower.includes('dorm room sex') ||
        sLower.includes('clips4sale') ||
        /dads\s*love\s*porn|craves\s+creampie|get\s+cleaned|cleaned|bangbros|bang\s+bros|creampie|monster\s+cock|monsters\s+of\s+cock|big\s+mouthfuls|tugjobs|tug\s+jobs|big\s+tit\s+creampie|bigtitcreampie|milf\s+soup|blowjob\s+fridays|facial\s+fest|brown\s+bunnies|latina\s+rampage|bang\s+bus|bangbus|bang\s+casting|bangcasting|bake\s+my\s+cake|living\s+with\s+anna|living\s+with\s+lexxi|ass\s+parade|assparade/i.test(tLower);
      
      if (isBangBros) {
        addPublisher('lanny');
        addPublisher('glendower');
        addPublisher('pantisq_a');
        addPublisher('floflo');
        addPublisher('rex');
        addPublisher('asaaaaaad');
      }

      // 3.5. Hussie Pass & Sub-studios / Sub-series Detection (Hot and Tatted, Hussie Auditions, Interracial POVs, POV Pornstars)
      const HUSSIE_SERIES_LIST = [
        'hussie pass', 'hussiepass', 'hussie models', 'hussiemodels',
        'hussie auditions', 'hussie audition', 'hussieauditions',
        'hot and tatted', 'hot & tatted', 'hotandtatted',
        'interracial povs', 'interracial pov', 'interracialpovs',
        'pov pornstars', 'pov porn stars', 'povpornstars',
        'filthy pov', 'throat pounding'
      ];

      let detectedHussieSeries = '';
      for (const s of HUSSIE_SERIES_LIST) {
        if (sLower.includes(s) || tLower.includes(s)) {
          detectedHussieSeries = s;
          break;
        }
      }

      const isHussiePass = !!detectedHussieSeries ||
        sLower.includes('hussie') ||
        sLower.includes('hot and tatted') ||
        sLower.includes('hot & tatted') ||
        sLower.includes('hotandtatted') ||
        sLower.includes('interracial pov') ||
        sLower.includes('pov pornstars') ||
        sLower.includes('pov porn stars') ||
        /hussie\s+pass|hussiepass|hussie\s+models|hussie\s+auditions?|hot\s+(?:and|&)\s+tatted|hotandtatted|interracial\s+povs?|pov\s+porn\s*stars?/i.test(tLower);

      if (isHussiePass) {
        addPublisher('pantisq_a');
        addPublisher('pantisq');
        addPublisher('floflo');
        addPublisher('lanny');
        addPublisher('rex');
      }

      // 4. Vixen Media Group (Vixen, Tushy, Blacked, Deeper, Slayed, Pure Taboo) Signature Detection (routes directly to lanny)
      const isVixenGroup = sLower.includes('vixen') || sLower.includes('tushy') || sLower.includes('blacked') || sLower.includes('deeper') || sLower.includes('slayed') || sLower.includes('pure taboo') ||
        /\b(?:vixen|tushy|blacked|deeper|slayed|pure\s+taboo)\b/i.test(tLower);
      if (isVixenGroup) {
        addPublisher('lanny');
      }

      // 4.5. Kelly Madison Network & Sub-studios (PornFidelity, TeenFidelity, 5KPorn, 5Kteens, 8K Milfs, 8K Teens, Kelly Madison)
      // (routes directly to Lanny as the #1 specialist publisher)
      if (isKellyMadison) {
        addPublisher('Lanny');
        addPublisher('lanny');
      }

      // 5. SexMex / Latin Signature Detection (routes directly to pantisq_a and pantisq)
      if (sLower.includes('sexmex') || sLower.includes('latinleche') || sLower.includes('latin') || tLower.includes('sexmex') || isSexMex) {
        addPublisher('pantisq_a');
        addPublisher('pantisq');
      }

      // 6. Brazzers & Sub-studios & RealityKings Signature Detection (routes directly to hprnp then pixel)
      const isBrazzersOrSub = sLower.includes('brazzers') || sLower.includes('zz series') || sLower.includes('doctor adventures') ||
        sLower.includes('big tits at work') || sLower.includes('big wet butts') || sLower.includes('baby got boobs') ||
        sLower.includes('pornstars like it big') || sLower.includes('teens like it big') || sLower.includes('mommy got boobs') ||
        sLower.includes('milfs like it big') || sLower.includes('real wife stories') || sLower.includes('dirty flirts') ||
        sLower.includes('brazzers exxtra') || sLower.includes('hot and mean') || sLower.includes('buttwoman') ||
        sLower.includes('street blowjobs') || sLower.includes('day with a pornstar') || sLower.includes('naughty bookworms') ||
        sLower.includes('busty bus') || sLower.includes('big tits in uniform') || sLower.includes('strap on squad') ||
        sLower.includes('hot chicks big dicks') || sLower.includes('sex & submission') || sLower.includes('rocco') ||
        sLower.includes('brazzers vault') || sLower.includes('jug fuckers') || sLower.includes('ass parade') ||
        sLower.includes('big butts like it big') || sLower.includes('lets try anal') || sLower.includes("let's try anal") ||
        sLower.includes('milf lessons') || sLower.includes('mommy') || sLower.includes('blows best') ||
        sLower.includes('realitykings') || sLower.includes('reality kings') || sLower.includes('monster curves') ||
        sLower.includes('cum fiesta') || sLower.includes('captain stabbin') || sLower.includes('round and brown') ||
        sLower.includes('big naturals') || sLower.includes('milf hunter') || sLower.includes('8th street latinas') ||
        /stepmommy|stepmom|mommy\s+blows\s+best|nerd\s+gamer|pushy\s+pussy|brazzers|doctor\s+adventures|big\s+tits\s+at\s+work|baby\s+got\s+boobs|big\s+wet\s+butts|real\s+wife\s+stories|dirty\s+flirts|pornstars\s+like\s+it\s+big|teens\s+like\s+it\s+big|mommy\s+got\s+boobs|milfs\s+like\s+it\s+big/i.test(tLower);

      if (isBrazzersOrSub) {
        addPublisher('hprnp');
        addPublisher('pixel');
        addPublisher('rex');
      }

      // 7. MYLF & Sub-studios / Sub-series Signature Detection (routes directly to floflo, rex, asaaaaaad, hprnp)
      const isMylfOrSub = sLower.includes('mylf') ||
        sLower.includes('mylfed') ||
        sLower.includes('milfty') ||
        sLower.includes('got mylf') || sLower.includes('gotmylf') ||
        sLower.includes('free use milf') || sLower.includes('freeusemilf') ||
        sLower.includes("mommy's girl") || sLower.includes("mommys girl") ||
        sLower.includes('mommy blows best') ||
        sLower.includes('mommy got boobs') ||
        sLower.includes("dad's pov") || sLower.includes("dads pov") ||
        sLower.includes('bad milfs') || sLower.includes('badmilfs') ||
        sLower.includes('milf body') ||
        sLower.includes('busty milf') ||
        sLower.includes('step siblings caught') || sLower.includes('step siblings') ||
        sLower.includes('family therapy') ||
        sLower.includes('filthy family') ||
        sLower.includes('mom swap') ||
        sLower.includes('foster mother') ||
        sLower.includes('step family secrets') ||
        sLower.includes('teacher fucks teens') ||
        sLower.includes('milf teacher') ||
        sLower.includes('pure passion') ||
        /mylf|mylfed|milfty|got\s+mylf|spotlight|free\s+use\s+milf|mommy'?s\s+girl|mommy\s+blows\s+best|dad'?s\s+pov|bad\s+milfs|step\s+siblings|family\s+therapy|filthy\s+family|mom\s+swap|foster\s+mother|step\s+family\s+secrets/i.test(tLower);

      if (isMylfOrSub) {
        addPublisher('floflo');
        addPublisher('rex');
        addPublisher('asaaaaaad');
        addPublisher('hprnp');
        addPublisher('pantisq_a');
      }

      // Dedicated MYLF Distinctive Scene Words (extract actual scene title after series prefix e.g. "July Spotlight:", "Got Mylf:")
      let mylfDistinctiveWords: string[] = [];
      if (isMylfOrSub) {
        const mylfGenericTokens = new Set([
          'spotlight', 'mylf', 'mylfed', 'milfty', 'got', 'mommy', 'moms', 'milf', 'milfs', 'swap',
          'therapy', 'secrets', 'foster', 'family', 'submissive', 'filthy', 'caught', 'lesson', 'lessons',
          'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
        ]);

        let subTitle = title || '';
        if (subTitle.includes(':')) {
          subTitle = subTitle.split(':').slice(1).join(':');
        } else if (subTitle.includes(' - ')) {
          subTitle = subTitle.split(' - ').slice(1).join(' - ');
        }

        const normSubTitle = subTitle.replace(/['’]s\b/gi, '').replace(/[^a-zA-Z0-9]/g, ' ');
        const subWords = normSubTitle.split(/\s+/)
          .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()) && !isActorLikeWord(w) && !mylfGenericTokens.has(w.toLowerCase()));

        mylfDistinctiveWords = Array.from(new Set<string>(subWords)).sort((a: string, b: string) => b.length - a.length);
      }

      // 8. ARX Bucks & Sub-studios / Sub-series Detection (POVMasters, CuckHunter, RealityLovers, CumLouder)
      const isArxBucks = sLower.includes('arx') ||
        sLower.includes('arxbucks') ||
        sLower.includes('povmasters') || sLower.includes('pov masters') ||
        sLower.includes('cuckhunter') || sLower.includes('cuck hunter') ||
        sLower.includes('realitylovers') || sLower.includes('reality lovers') ||
        sLower.includes('cumlouder') ||
        sLower.includes('momlover') || sLower.includes('milflovers') ||
        /povmasters|cuckhunter|realitylovers|cumlouder|cuckolded\s+husband/i.test(tLower);

      if (isArxBucks) {
        addPublisher('glendower');
        addPublisher('rex');
        addPublisher('floflo');
        addPublisher('asaaaaaad');
      }

      // 9. Glamour / European Art (MetArt, Viv Thomas, ALS Scan, SexArt) (routes directly to cypher)
      if (sLower.includes('metart') || sLower.includes('viv thomas') || sLower.includes('sexart') || sLower.includes('als scan')) {
        addPublisher('cypher');
      }

      // 10. Teen & Youth Networks (Nubiles, TeenMegaWorld, TeamSke, WowGirls) (routes directly to teenmushi)
      if (sLower.includes('nubiles') || sLower.includes('teenmegaworld') || sLower.includes('teamske') || sLower.includes('wowgirls')) {
        addPublisher('teenmushi');
      }

      // 11. SexSelector Studio Detection (routes directly to floflo, rex, glendower, asaaaaaad)
      const isSexSelector = sLower.includes('sexselector') ||
        sLower.includes('sex selector') ||
        /sexselector|sex\s+selector/i.test(tLower);

      if (isSexSelector) {
        addPublisher('floflo');
        addPublisher('rex');
        addPublisher('glendower');
        addPublisher('asaaaaaad');
      }

      // Unified Instant Targets (No searchuser restriction - 1 query matches ALL publishers simultaneously!)
      // PRIORITY 0 (MYLF Precision Hit): Actor + Specific Scene Keywords from after series prefix
      if (isMylfOrSub && mylfDistinctiveWords.length > 0) {
        for (const act of allActorNames) {
          if (!act || !act.trim()) continue;
          for (const sw of mylfDistinctiveWords.slice(0, 2)) {
            addTarget({
              query: `${act.trim()} ${sw}`,
              titleonly: true
            });
          }
          if (mylfDistinctiveWords.length >= 2) {
            const phrase = mylfDistinctiveWords.slice(0, 2).join(' ');
            addTarget({
              query: `${act.trim()} ${phrase}`,
              titleonly: true
            });
          }
        }
      }

      // PRIORITY 0.5 (Naughty America Precision Hit with hprnp):
      // hprnp is the primary publisher of Naughty America on ViperGirls
      if (isNaughtyAmerica) {
        for (const act of allActorNames) {
          if (!act || !act.trim()) continue;
          const cleanAct = act.trim();
          // Target 1: Actor with searchuser: 'hprnp' (Queries hprnp catalog directly - finds all Naughty America sets)
          addTarget({
            query: cleanAct,
            searchuser: 'hprnp',
            exactname: true,
            titleonly: true
          });
          // Target 2: If series detected (e.g. "Neighbor Affair", "Single Moms"), search actor + series with hprnp
          if (detectedNaughtySeries) {
            addTarget({
              query: `${cleanAct} ${detectedNaughtySeries}`,
              searchuser: 'hprnp',
              exactname: true,
              titleonly: true
            });
            addTarget({
              query: `${cleanAct} ${detectedNaughtySeries}`,
              titleonly: true
            });
          }
          // Target 3: If distinctive title words exist (e.g. HOA, President), search actor + word with hprnp
          if (distinctiveTitleWordsNoActor.length > 0) {
            for (const sw of distinctiveTitleWordsNoActor.slice(0, 2)) {
              addTarget({
                query: `${cleanAct} ${sw}`,
                searchuser: 'hprnp',
                exactname: true,
                titleonly: true
              });
            }
          }
        }
      }

      // Rule: When multiple actors are present, use the first actor name for targeted search queries
      const searchActors = allActorNames.length > 0 ? [allActorNames[0].trim()] : [];

      // PRIORITY 0.5 (BangBros Precision Hit with Lanny, glendower & pantisq_a):
      if (isBangBros) {
        const isDadsLovePorn = sLower.includes('dadsloveporn') || 
          sLower.includes('dads love porn') || 
          sLower.includes('dadslove') || 
          /dads\s*love\s*porn/i.test(tLower);

        // If specific sub-studio DadsLovePorn is detected, target pantisq_a FIRST!
        if (isDadsLovePorn) {
          for (const act of searchActors) {
            if (!act) continue;
            const cleanAct = act.trim();
            // 1. Direct actor query on pantisq_a (fastest, hits 100% of DadsLovePorn sets)
            addTarget({
              query: cleanAct,
              searchuser: 'pantisq_a',
              exactname: true,
              titleonly: true
            });
            // 2. Distinctive title word on pantisq_a
            if (distinctiveTitleWordsNoActor.length > 0) {
              for (const sw of distinctiveTitleWordsNoActor.slice(0, 2)) {
                addTarget({
                  query: `${cleanAct} ${sw}`,
                  searchuser: 'pantisq_a',
                  exactname: true,
                  titleonly: true
                });
              }
            }
          }
        } else {
          // Standard BangBros: Laser-hit strategy using the first actor
          for (const act of searchActors) {
            if (!act) continue;
            const cleanAct = act.trim();

            // 1. If date is available, [Actor + Short Date] is universally publisher-independent (matches Lanny, glendower, floflo in 1 single query!)
            const shortDates = primaryUsDateFormats.filter(d => /^\d{2}[-/]\d{2}[-/]\d{2}$/.test(d));
            if (shortDates.length > 0) {
              const hyphenDate = shortDates.find(d => d.includes('-'));
              if (hyphenDate) {
                addTarget({
                  query: `${cleanAct} ${hyphenDate}`,
                  titleonly: true
                });
              }
              const slashDate = shortDates.find(d => d.includes('/'));
              if (slashDate) {
                addTarget({
                  query: `${cleanAct} ${slashDate}`,
                  titleonly: true
                });
              }
            }

            // 2. High-precision Actor + Distinctive Title Keyword (e.g. "Cubbi Thompson Cleaned", "Lucy Lotus Lotta")
            // Filter words with length >= 3 to skip trivial 1-2 letter words
            const validWords = distinctiveTitleWordsNoActor.filter(w => w.length >= 3);
            if (validWords.length > 0) {
              for (const sw of validWords.slice(0, 2)) {
                // glendower and Lanny are top BangBros photo set posters
                addTarget({
                  query: `${cleanAct} ${sw}`,
                  searchuser: 'glendower',
                  exactname: true,
                  titleonly: true
                });
                addTarget({
                  query: `${cleanAct} ${sw}`,
                  searchuser: 'Lanny',
                  exactname: true,
                  titleonly: true
                });
                addTarget({
                  query: `${cleanAct} ${sw}`,
                  titleonly: true
                });
              }
            }

            // 3. If series detected (e.g. "Ass Parade", "BangBus", etc.):
            if (detectedBangBrosSeries) {
              addTarget({
                query: `${cleanAct} ${detectedBangBrosSeries}`,
                searchuser: 'Lanny',
                exactname: true,
                titleonly: true
              });
              addTarget({
                query: `${cleanAct} ${detectedBangBrosSeries}`,
                searchuser: 'glendower',
                exactname: true,
                titleonly: true
              });
              addTarget({
                query: `${cleanAct} ${detectedBangBrosSeries}`,
                searchuser: 'pantisq_a',
                exactname: true,
                titleonly: true
              });
            }

            // 4. Publisher catalog broad searches:
            addTarget({
              query: cleanAct,
              searchuser: 'Lanny',
              exactname: true,
              titleonly: true
            });
            addTarget({
              query: cleanAct,
              searchuser: 'glendower',
              exactname: true,
              titleonly: true
            });
            addTarget({
              query: cleanAct,
              searchuser: 'pantisq_a',
              exactname: true,
              titleonly: true
            });
          }

          // Fallback for secondary actors if present:
          if (allActorNames.length > 1) {
            for (const secondaryAct of allActorNames.slice(1)) {
              if (!secondaryAct || !secondaryAct.trim()) continue;
              const cleanSec = secondaryAct.trim();
              const validWords = distinctiveTitleWordsNoActor.filter(w => w.length >= 3);
              if (validWords.length > 0) {
                for (const sw of validWords.slice(0, 1)) {
                  addTarget({
                    query: `${cleanSec} ${sw}`,
                    searchuser: 'glendower',
                    exactname: true,
                    titleonly: true
                  });
                  addTarget({
                    query: `${cleanSec} ${sw}`,
                    searchuser: 'Lanny',
                    exactname: true,
                    titleonly: true
                  });
                }
              }
              addTarget({
                query: cleanSec,
                searchuser: 'glendower',
                exactname: true,
                titleonly: true
              });
              addTarget({
                query: cleanSec,
                searchuser: 'Lanny',
                exactname: true,
                titleonly: true
              });
            }
          }
        }
      }

      // PRIORITY 0.5 (Hussie Pass Precision Hit with pantisq_a):
      // pantisq_a is the primary publisher of Hussie Pass on ViperGirls
      if (isHussiePass) {
        // Queries pantisq_a and pantisq catalog for each actor directly
        for (const act of allActorNames) {
          if (!act || !act.trim()) continue;
          const cleanAct = act.trim();
          addTarget({
            query: cleanAct,
            searchuser: 'pantisq_a',
            exactname: true,
            titleonly: true
          });
          addTarget({
            query: cleanAct,
            searchuser: 'pantisq',
            exactname: true,
            titleonly: true
          });
        }

        // If series or sub-studio detected (e.g. "Hot and Tatted", "Hussie Auditions", "Interracial POVs", "POV Pornstars"):
        if (detectedHussieSeries) {
          for (const act of allActorNames) {
            if (!act || !act.trim()) continue;
            const cleanAct = act.trim();
            addTarget({
              query: `${cleanAct} ${detectedHussieSeries}`,
              searchuser: 'pantisq_a',
              exactname: true,
              titleonly: true
            });
            addTarget({
              query: `${cleanAct} ${detectedHussieSeries}`,
              titleonly: true
            });
          }
        }

        // Fast actor + distinctive title keyword with pantisq_a
        if (distinctiveTitleWordsNoActor.length > 0) {
          for (const act of allActorNames) {
            if (!act || !act.trim()) continue;
            for (const sw of distinctiveTitleWordsNoActor.slice(0, 2)) {
              addTarget({
                query: `${act.trim()} ${sw}`,
                searchuser: 'pantisq_a',
                titleonly: true
              });
              addTarget({
                query: `${act.trim()} ${sw}`,
                titleonly: true
              });
            }
          }
        }
      }

      // PRIORITY 0.5 (SexMex Specific Ordering: Title -> Date -> Actor Name with pantisq_a):
      // pantisq_a is the sole specialist publisher of SexMex photo sets on ViperGirls
      if (isSexMex) {
        const validTitleWords = distinctiveTitleWordsNoActor.filter(w => w.length >= 3);

        // 1. FIRST PRIORITY: Title Search on pantisq_a & general
        if (validTitleWords.length >= 2) {
          addTarget({
            query: validTitleWords.slice(0, 3).join(' '),
            searchuser: 'pantisq_a',
            exactname: true,
            titleonly: true
          });
          addTarget({
            query: validTitleWords.slice(0, 2).join(' '),
            searchuser: 'pantisq_a',
            exactname: true,
            titleonly: true
          });
          addTarget({
            query: validTitleWords.slice(0, 2).join(' '),
            titleonly: true
          });
        } else if (validTitleWords.length === 1) {
          addTarget({
            query: validTitleWords[0],
            searchuser: 'pantisq_a',
            exactname: true,
            titleonly: true
          });
          addTarget({
            query: validTitleWords[0],
            titleonly: true
          });
        }

        // 2. SECOND PRIORITY: Title + Date signatures
        if (date && validTitleWords.length > 0 && primaryUsDateFormats.length > 0) {
          const shortDates = primaryUsDateFormats.filter(d => /^\d{2}[-/]\d{2}[-/]\d{2}$/.test(d));
          const formatsToTry = shortDates.length > 0 ? shortDates : primaryUsDateFormats;
          for (const df of formatsToTry.slice(0, 2)) {
            addTarget({
              query: `${validTitleWords[0]} ${df}`,
              searchuser: 'pantisq_a',
              exactname: true,
              titleonly: true
            });
            addTarget({
              query: `${validTitleWords[0]} ${df}`,
              titleonly: true
            });
          }
        }

        // 3. THIRD PRIORITY: Actor Name (with generated variants: e.g. Khloe / Khloee) on pantisq_a & pantisq
        const sexMexActorVariants: string[] = [];
        for (const act of allActorNames) {
          if (!act || !act.trim()) continue;
          const vars = generateActorVariants(act);
          for (const v of vars) {
            if (v && v.trim() && !sexMexActorVariants.includes(v.trim())) {
              sexMexActorVariants.push(v.trim());
            }
          }
        }

        for (const cleanAct of sexMexActorVariants) {
          // Actor + Distinctive Title Keyword on pantisq_a
          if (validTitleWords.length > 0) {
            for (const sw of validTitleWords.slice(0, 2)) {
              addTarget({
                query: `${cleanAct} ${sw}`,
                searchuser: 'pantisq_a',
                exactname: true,
                titleonly: true
              });
              addTarget({
                query: `${cleanAct} ${sw}`,
                searchuser: 'pantisq',
                exactname: true,
                titleonly: true
              });
              addTarget({
                query: `${cleanAct} ${sw}`,
                titleonly: true
              });
            }
          }

          // Direct actor query on pantisq_a & pantisq
          addTarget({
            query: cleanAct,
            searchuser: 'pantisq_a',
            exactname: true,
            titleonly: true
          });
          addTarget({
            query: cleanAct,
            searchuser: 'pantisq',
            exactname: true,
            titleonly: true
          });

          // Actor + SexMex brand signature
          addTarget({
            query: `${cleanAct} SexMex`,
            searchuser: 'pantisq_a',
            exactname: true,
            titleonly: true
          });
          addTarget({
            query: `${cleanAct} SexMex`,
            titleonly: true
          });
        }
      }

      // PRIORITY 0.5 (Kelly Madison Network & Sub-studios Master Hit with Lanny):
      // Lanny is the exclusive #1 publisher of Kelly Madison, PornFidelity, TeenFidelity, 5KPorn, 5Kteens, 8K Milfs, 8K Teens
      // In ViperGirls, searching Lanny with just the primary actor returns the entire thread catalog for that actor in 1 single fast query (~700ms)
      if (isKellyMadison) {
        const primaryActor = allActorNames[0]?.trim();
        const validTitleWords = distinctiveTitleWordsNoActor.filter(w => w.length >= 3);

        if (primaryActor) {
          // Master Target 1: The actor name under Lanny (brings all Kelly Madison / sub-studio threads for this actor in 1 single shot!)
          addTarget({
            query: primaryActor,
            searchuser: 'Lanny',
            exactname: true,
            titleonly: true
          });

          // Master Target 2: If title has unique keywords, actor + title word with Lanny
          if (validTitleWords.length > 0) {
            addTarget({
              query: `${primaryActor} ${validTitleWords[0]}`,
              searchuser: 'Lanny',
              exactname: true,
              titleonly: true
            });
          }
        }
      }

      // PRIORITY 1 (Laser Hit in < 250ms): Actor + Distinctive Scene Keyword (No user constraint)
      if (distinctiveTitleWordsNoActor.length > 0) {
        for (const act of allActorNames) {
          if (!act || !act.trim()) continue;
          for (const sw of distinctiveTitleWordsNoActor.slice(0, 2)) {
            addTarget({
              query: `${act.trim()} ${sw}`,
              titleonly: true
            });
          }
          if (hasMultiWordSceneTitle && distinctiveTitleWordsNoActor.length >= 2) {
            const phrase = distinctiveTitleWordsNoActor.slice(0, 2).join(' ');
            addTarget({
              query: `${act.trim()} ${phrase}`,
              titleonly: true
            });
          }
        }
      }

      // PRIORITY 2: Actor + Top Date Formats (No user constraint)
      const topDateFormats = [
        ...primaryFloFloDateFormats.slice(0, 2),
        ...primaryUsDateFormats.slice(0, 2),
        ...primaryMonthNameFormats.slice(0, 2)
      ];
      if (topDateFormats.length > 0) {
        for (const topDateFormat of topDateFormats) {
          for (const act of allActorNames) {
            if (act && act.trim()) {
              addTarget({
                query: `${act.trim()} ${topDateFormat}`,
                titleonly: true
              });
            }
          }
        }
      }

      // PRIORITY 3: Broad Actor Catalog (brings all recent/archive threads for actor into RAM in 1 search)
      for (const act of allActorNames) {
        if (act && act.trim()) {
          addTarget({
            query: act.trim(),
            titleonly: true
          });
        }
      }

      // PRIORITY 4: (Multi-actor combinations omitted - following user rule: take first actor only)

      // PRIORITY 5: Actor Variants
      for (const av of allVariantsList) {
        addTarget({
          query: av,
          titleonly: true
        });
      }

      console.log(`[Viper Scraper] Single-hit search targets count: ${searchTargets.length}`);

      let bestMatch: any = null;
      let highestScore = -1;
      const candidateThreads: any[] = [];
      let sessionCookie = '';

      // Helper function to evaluate thread list against current scene criteria
      const evaluateThreadCandidate = (thread: { threadTitle: string; href: string; author: string; forumName: string }) => {
        const threadTitle = thread.threadTitle;
        const href = thread.href;
        const author = thread.author;
        const forumName = thread.forumName;
        const forumLower = forumName.toLowerCase();

        // STRICT FORUM FILTER
        const isForbiddenForum = forumLower.includes('video') || 
                                 forumLower.includes('videos') || 
                                 forumLower.includes('collections') || 
                                 forumLower.includes('link drop') || 
                                 forumLower.includes('requests') || 
                                 forumLower.includes('feed');
        if (isForbiddenForum) return;

        const isPhotoSetsForum = forumLower.includes('photo set') || forumLower.includes('photo sets');
        if (!isPhotoSetsForum) return;

        if (!isUserAllowed(author)) return;

        const trimmedTitle = threadTitle.trim();
        const isPureActorTitle = allActorNames.some(act => {
          const actClean = act.trim().toLowerCase();
          return trimmedTitle.toLowerCase() === actClean;
        });
        if (isPureActorTitle) return;

        const cleanThread = threadTitle.toLowerCase()
          .replace(/[\u2018\u2019`´]/g, "'") // Normalize smart curly apostrophes
          .replace(/[!?,;]+(?=[-\s\d]|$)/g, ' ') // Decouple glued punctuation like "Want!-06-20-26" -> "Want -06-20-26"
          .replace(/\.(?=\s|$)/g, ' ') // Strip trailing dots attached to dates like "10-18-25." -> "10-18-25"
          .replace(/\b\d+\s*(?:pics?|images?|photos?)\b|\b\d+x\b|\b\d+p\b|\b\d+\s*[\*x]\s*\d+\s*(?:px)?\b|\b(?:medium|high|low)[- ]resolution\b|\bscreens?\b|\bpre[- ]release!?\b|\bfull[- ]set\b|\bupdated\b/gi, ' ');
        const cleanThreadNoPunct = cleanThread.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanThreadCompressed = cleanThreadNoPunct.replace(/\s+/g, '');

        const dateInThreadRegex = /\b(\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{4}[-./]\d{1,2}[-./]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ,.]*\d{1,2}[- ,.]*\d{2,4}|\d{1,2}[- ,.]*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ,.]*\d{2,4}|\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\b/i;
        const threadDateMatch = threadTitle.match(dateInThreadRegex);

        let dateMatched = false;
        let hasConflictingDate = false;

        if (dateTokens.length > 0) {
          for (const token of dateTokens) {
            const tokenLower = token.toLowerCase();
            const tokenNoPunct = tokenLower.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
            const tokenCompressed = tokenNoPunct.replace(/\s+/g, '');
            if (
              cleanThread.includes(tokenLower) || 
              (tokenNoPunct.length >= 3 && cleanThreadNoPunct.includes(tokenNoPunct)) ||
              (tokenCompressed.length >= 4 && cleanThreadCompressed.includes(tokenCompressed))
            ) {
              dateMatched = true;
              break;
            }
          }
          if (!dateMatched && threadDateMatch) {
            hasConflictingDate = true;
          }
        }

        if (hasConflictingDate) return;

        let matchedTitleCount = 0;
        for (const word of trueSceneWords) {
          const wordLower = word.toLowerCase();
          const wordNoPunct = wordLower.replace(/[^a-z0-9]/g, '');
          if (
            cleanThread.includes(wordLower) || 
            cleanThreadNoPunct.includes(wordLower) || 
            (wordNoPunct.length >= 2 && cleanThreadCompressed.includes(wordNoPunct))
          ) {
            matchedTitleCount++;
          }
        }

        let matchedMylfDistinctiveCount = 0;
        if (isMylfOrSub && mylfDistinctiveWords.length > 0) {
          for (const word of mylfDistinctiveWords) {
            const wordLower = word.toLowerCase();
            const wordNoPunct = wordLower.replace(/[^a-z0-9]/g, '');
            if (
              cleanThread.includes(wordLower) || 
              cleanThreadNoPunct.includes(wordLower) || 
              (wordNoPunct.length >= 2 && cleanThreadCompressed.includes(wordNoPunct))
            ) {
              matchedMylfDistinctiveCount++;
            }
          }
        }

        let actorMatched = false;
        for (const act of allActorNames) {
          const actVariants = generateActorVariants(act);
          for (const av of actVariants) {
            const avClean = av.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
            const threadWords = cleanThread.replace(/[^a-z0-9]/g, ' ');
            const actorRegex = new RegExp(`(^|\\s)${avClean.replace(/\s+/g, '\\s+')}(\\s|$)`, 'i');
            if (actorRegex.test(threadWords)) {
              actorMatched = true;
              break;
            }
          }
          if (actorMatched) break;
        }

        // Specific to SexMex: Fuzzy actor match (e.g. Devil Khloe <-> Devil Khloee, or first token + close last token)
        if (!actorMatched && isSexMex) {
          const threadWords = cleanThread.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
          for (const act of allActorNames) {
            const actTokens = act.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
            if (actTokens.length >= 2) {
              // Check if first token matches and last token is within 1 edit distance or prefix match
              const firstMatch = threadWords.includes(actTokens[0]);
              const lastToken = actTokens[actTokens.length - 1];
              const lastMatch = threadWords.some(tw => 
                tw === lastToken || 
                (Math.abs(tw.length - lastToken.length) <= 2 && calcLevenshtein(tw, lastToken) <= 1) ||
                (lastToken.length >= 4 && (tw.startsWith(lastToken) || lastToken.startsWith(tw)))
              );
              if (firstMatch && lastMatch) {
                actorMatched = true;
                break;
              }
            } else if (actTokens.length === 1) {
              const singleTok = actTokens[0];
              const singleMatch = threadWords.some(tw => 
                tw === singleTok || 
                (Math.abs(tw.length - singleTok.length) <= 1 && calcLevenshtein(tw, singleTok) <= 1)
              );
              if (singleMatch) {
                actorMatched = true;
                break;
              }
            }
          }
        }

        let studioMatched = false;
        if (studioName) {
          const cleanStudio = studioName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanThreadNoPunct = cleanThread.replace(/[^a-z0-9]/g, '');
          if (cleanStudio.length >= 3 && cleanThreadNoPunct.includes(cleanStudio)) {
            studioMatched = true;
          }
        }

        const cleanAuthor = author.toLowerCase().trim();
        const isTier1 = tier1Authors.has(cleanAuthor) || Array.from(tier1Authors).some(t => cleanAuthor.startsWith(t));

        const hasTitleOrStudioAnchor = (trueSceneWords.length === 0) || (matchedTitleCount >= 1) || studioMatched;
        
        // Strict evaluation specifically for MYLF:
        // Prevent false positives from series/month names like "July Spotlight" or "Got Mylf"
        // Require date match OR at least one genuine scene title word from after series prefix
        let mylfAcceptable = false;
        if (isMylfOrSub) {
          if (dateMatched && actorMatched && hasTitleOrStudioAnchor) {
            mylfAcceptable = true;
          } else if (!hasConflictingDate && actorMatched) {
            if (mylfDistinctiveWords.length > 0) {
              mylfAcceptable = matchedMylfDistinctiveCount >= 1;
            } else {
              mylfAcceptable = matchedTitleCount >= 2;
            }
          }
        }

        // Strict evaluation specifically for Naughty America:
        let naughtyAmericaAcceptable = false;
        if (isNaughtyAmerica) {
          const isHprnp = cleanAuthor === 'hprnp';
          const threadHasNaughtySignature = cleanThread.includes('naughtyamerica') || 
            cleanThread.includes('naughty america') || 
            (!!detectedNaughtySeries && cleanThread.includes(detectedNaughtySeries)) ||
            NAUGHTY_SERIES_LIST.some(ns => cleanThread.includes(ns));

          if (dateMatched && actorMatched && (threadHasNaughtySignature || isHprnp || hasTitleOrStudioAnchor)) {
            naughtyAmericaAcceptable = true;
          } else if (!hasConflictingDate && actorMatched) {
            if (isHprnp && (threadHasNaughtySignature || matchedTitleCount >= 1)) {
              naughtyAmericaAcceptable = true;
            } else if (threadHasNaughtySignature && matchedTitleCount >= 1) {
              naughtyAmericaAcceptable = true;
            } else {
              naughtyAmericaAcceptable = matchedTitleCount >= 2;
            }
          }
        }

        // Strict evaluation specifically for BangBros:
        let bangBrosAcceptable = false;
        if (isBangBros) {
          const isLanny = cleanAuthor === 'lanny';
          const isGlendower = cleanAuthor === 'glendower';
          const isPantisq = cleanAuthor === 'pantisq_a' || cleanAuthor === 'pantisq';
          const isBangBrosAuthor = isLanny || isGlendower || isPantisq || cleanAuthor === 'floflo';
          const threadHasBangBrosSignature = cleanThread.includes('bangbros') || 
            cleanThread.includes('bang bros') || 
            cleanThread.includes('dadsloveporn') ||
            cleanThread.includes('dads love porn') ||
            cleanThread.includes('dadslove') ||
            (!!detectedBangBrosSeries && cleanThread.includes(detectedBangBrosSeries)) ||
            BANGBROS_SERIES_LIST.some(bs => cleanThread.includes(bs));

          if (dateMatched && actorMatched && (threadHasBangBrosSignature || isBangBrosAuthor || hasTitleOrStudioAnchor || matchedTitleCount >= 1)) {
            bangBrosAcceptable = true;
          } else if (!hasConflictingDate && actorMatched) {
            if (isBangBrosAuthor && (threadHasBangBrosSignature || matchedTitleCount >= 1)) {
              bangBrosAcceptable = true;
            } else if (threadHasBangBrosSignature && matchedTitleCount >= 1) {
              bangBrosAcceptable = true;
            } else {
              bangBrosAcceptable = matchedTitleCount >= 2;
            }
          }
        }

        // Strict evaluation specifically for Hussie Pass & Sub-studios:
        let hussiePassAcceptable = false;
        if (isHussiePass) {
          const isPantisq = cleanAuthor === 'pantisq_a' || cleanAuthor === 'pantisq';
          const isHussieAuthor = isPantisq || cleanAuthor === 'floflo' || cleanAuthor === 'lanny';
          const threadHasHussieSignature = cleanThread.includes('hussie') || 
            cleanThread.includes('hot and tatted') ||
            cleanThread.includes('hot & tatted') ||
            cleanThread.includes('hotandtatted') ||
            cleanThread.includes('interracial pov') ||
            cleanThread.includes('pov pornstars') ||
            cleanThread.includes('pov porn stars') ||
            (!!detectedHussieSeries && cleanThread.includes(detectedHussieSeries)) ||
            HUSSIE_SERIES_LIST.some(hs => cleanThread.includes(hs));

          if (dateMatched && actorMatched && (threadHasHussieSignature || isHussieAuthor || hasTitleOrStudioAnchor || matchedTitleCount >= 1)) {
            hussiePassAcceptable = true;
          } else if (!hasConflictingDate && actorMatched) {
            if (isHussieAuthor && (threadHasHussieSignature || matchedTitleCount >= 1)) {
              hussiePassAcceptable = true;
            } else if (threadHasHussieSignature && matchedTitleCount >= 1) {
              hussiePassAcceptable = true;
            } else {
              hussiePassAcceptable = matchedTitleCount >= 2;
            }
          }
        }

        // Strict evaluation specifically for SexMex & Sub-studios (pantisq_a is the specialized publisher):
        let sexMexAcceptable = false;
        if (isSexMex) {
          const isPantisq = cleanAuthor === 'pantisq_a' || cleanAuthor === 'pantisq';
          const threadHasSexMexSignature = cleanThread.includes('sexmex') || 
            cleanThread.includes('sex mex') || 
            cleanThread.includes('latinleche') ||
            cleanThread.includes('latin leche') ||
            cleanThread.includes('latin pervs') ||
            cleanThread.includes('latinpervs') ||
            cleanThread.includes('hot spanish') ||
            cleanThread.includes('pornostars');

          // 1. Title Priority: If 2+ title words match, or 1+ title word matches with pantisq_a / SexMex signature
          if (matchedTitleCount >= 2) {
            sexMexAcceptable = true;
          } else if (matchedTitleCount >= 1 && (isPantisq || threadHasSexMexSignature)) {
            sexMexAcceptable = true;
          } else if (dateMatched && (isPantisq || threadHasSexMexSignature || actorMatched)) {
            // 2. Date Priority: Date matches with pantisq / signature / actor
            sexMexAcceptable = true;
          } else if (!hasConflictingDate && actorMatched && (isPantisq || threadHasSexMexSignature)) {
            // 3. Actor Priority: Actor matches with specialized publisher
            sexMexAcceptable = true;
          }
        }

        // Strict evaluation specifically for Kelly Madison Network & Sub-studios (Lanny is the #1 specialized publisher):
        let kellyMadisonAcceptable = false;
        if (isKellyMadison) {
          const isLannyAuthor = cleanAuthor === 'lanny' || cleanAuthor === 'lanny';
          const threadHasKmSignature = cleanThread.includes('kelly madison') ||
            cleanThread.includes('kellymadison') ||
            cleanThread.includes('pornfidelity') ||
            cleanThread.includes('porn fidelity') ||
            cleanThread.includes('teenfidelity') ||
            cleanThread.includes('teen fidelity') ||
            cleanThread.includes('5kporn') ||
            cleanThread.includes('5k porn') ||
            cleanThread.includes('5kteens') ||
            cleanThread.includes('5k teens') ||
            cleanThread.includes('8k milfs') ||
            cleanThread.includes('8kmilfs') ||
            cleanThread.includes('8k teens') ||
            cleanThread.includes('8kteens') ||
            (!!detectedKellyMadisonStudio && cleanThread.includes(detectedKellyMadisonStudio)) ||
            KELLY_MADISON_SUB_STUDIOS.some(km => cleanThread.includes(km));

          if (dateMatched && actorMatched && (threadHasKmSignature || isLannyAuthor || hasTitleOrStudioAnchor || matchedTitleCount >= 1)) {
            kellyMadisonAcceptable = true;
          } else if (dateMatched && isLannyAuthor && (matchedTitleCount >= 1 || threadHasKmSignature)) {
            kellyMadisonAcceptable = true;
          } else if (!hasConflictingDate && actorMatched) {
            if (isLannyAuthor && (threadHasKmSignature || matchedTitleCount >= 1)) {
              kellyMadisonAcceptable = true;
            } else if (threadHasKmSignature && matchedTitleCount >= 1) {
              kellyMadisonAcceptable = true;
            } else {
              kellyMadisonAcceptable = matchedTitleCount >= 2;
            }
          } else if (!hasConflictingDate && isLannyAuthor && (threadHasKmSignature || matchedTitleCount >= 2)) {
            kellyMadisonAcceptable = true;
          }
        }

        // Allow high confidence title + actor matches for dedicated networks like MYLF, Naughty America, BangBros, Hussie Pass, SexMex, and Kelly Madison even if date format slightly shifts
        const isAcceptable = 
          (dateMatched && actorMatched && hasTitleOrStudioAnchor) ||
          (dateMatched && matchedTitleCount >= 1) ||
          (!hasConflictingDate && matchedTitleCount >= 2 && actorMatched && (!isMylfOrSub || mylfAcceptable) && (!isNaughtyAmerica || naughtyAmericaAcceptable) && (!isBangBros || bangBrosAcceptable) && (!isHussiePass || hussiePassAcceptable) && (!isSexMex || sexMexAcceptable) && (!isKellyMadison || kellyMadisonAcceptable)) ||
          (!hasConflictingDate && matchedTitleCount >= 3 && (!isMylfOrSub || mylfAcceptable) && (!isNaughtyAmerica || naughtyAmericaAcceptable) && (!isBangBros || bangBrosAcceptable) && (!isHussiePass || hussiePassAcceptable) && (!isSexMex || sexMexAcceptable) && (!isKellyMadison || kellyMadisonAcceptable)) ||
          (isMylfOrSub ? mylfAcceptable : isNaughtyAmerica ? naughtyAmericaAcceptable : isBangBros ? bangBrosAcceptable : isHussiePass ? hussiePassAcceptable : isSexMex ? sexMexAcceptable : isKellyMadison ? kellyMadisonAcceptable : ((isArxBucks || isSexSelector) && actorMatched && matchedTitleCount >= 2));

        if (!isAcceptable) return;

        let score = 0;
        if (isTier1) score += 25; else score += 10;
        if (forumLower.includes('hardcore photo sets')) score += 40;

        if (dateMatched) {
          if (matchedTitleCount >= 1 || studioMatched || trueSceneWords.length === 0) {
            score += 100;
          } else {
            score += 20;
          }
        } else if (isMylfOrSub && mylfAcceptable) {
          score += 90 + (matchedMylfDistinctiveCount * 30);
        } else if (isNaughtyAmerica && naughtyAmericaAcceptable) {
          score += 90;
        } else if (isBangBros && bangBrosAcceptable) {
          score += 90;
        } else if (isHussiePass && hussiePassAcceptable) {
          score += 90;
        } else if (isSexMex && sexMexAcceptable) {
          score += 90;
        } else if (isKellyMadison && kellyMadisonAcceptable) {
          score += 90;
        } else if ((isArxBucks || isSexSelector) && actorMatched && matchedTitleCount >= 2) {
          score += 90;
        }

        if (isMylfOrSub && matchedMylfDistinctiveCount > 0) {
          score += matchedMylfDistinctiveCount * 30;
        }

        if (isNaughtyAmerica && naughtyAmericaAcceptable) {
          if (cleanAuthor === 'hprnp') score += 60;
          if (cleanThread.includes('naughtyamerica') || cleanThread.includes('naughty america')) score += 40;
          if (detectedNaughtySeries && cleanThread.includes(detectedNaughtySeries)) score += 40;
          score += 50;
        }

        if (isBangBros && bangBrosAcceptable) {
          if (cleanAuthor === 'lanny' || cleanAuthor === 'glendower' || cleanAuthor === 'pantisq_a' || cleanAuthor === 'pantisq') score += 60;
          if (cleanThread.includes('bangbros') || cleanThread.includes('bang bros')) score += 40;
          if (detectedBangBrosSeries && cleanThread.includes(detectedBangBrosSeries)) score += 40;
          score += 50;
        }

        if (isHussiePass && hussiePassAcceptable) {
          if (cleanAuthor === 'pantisq_a' || cleanAuthor === 'pantisq') score += 60;
          if (cleanThread.includes('hussie') || cleanThread.includes('hussie pass') || cleanThread.includes('hussiepass')) score += 40;
          if (detectedHussieSeries && cleanThread.includes(detectedHussieSeries)) score += 40;
          score += 50;
        }

        if (isSexMex && sexMexAcceptable) {
          if (cleanAuthor === 'pantisq_a' || cleanAuthor === 'pantisq') score += 80;
          if (cleanThread.includes('sexmex') || cleanThread.includes('sex mex') || cleanThread.includes('latinleche')) score += 50;
          if (matchedTitleCount >= 2) score += 90; // High Title Priority
          else if (matchedTitleCount >= 1) score += 50;
          if (dateMatched) score += 80; // Second Priority: Date
          score += 50;
        }

        if (isKellyMadison && kellyMadisonAcceptable) {
          if (cleanAuthor === 'lanny') score += 85;
          if (detectedKellyMadisonStudio && cleanThread.includes(detectedKellyMadisonStudio)) score += 65;
          if (cleanThread.includes('pornfidelity') || cleanThread.includes('teenfidelity') || cleanThread.includes('5kporn') || cleanThread.includes('5kteens') || cleanThread.includes('8kmilfs') || cleanThread.includes('8kteens') || cleanThread.includes('kelly madison')) score += 50;
          if (actorMatched) score += 40;
          if (matchedTitleCount >= 1) score += 40;
          score += 50;
        }

        score += matchedTitleCount * 35;
        if (matchedTitleCount >= 3) score += 40;
        if (actorMatched) score += 35;
        if (studioMatched) score += 25;

        const candidate = {
          title: threadTitle,
          url: href.startsWith('http') ? href : 'https://viper.to/' + href,
          author,
          score,
          dateMatched,
          matchedTitleCount,
          actorMatched,
          studioMatched,
          isTier1
        };

        if (!candidateThreads.some(c => c.url === candidate.url)) {
          candidateThreads.push(candidate);
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = candidate;
        }
      };

      // Multi-Publisher Search with Smart In-Memory Caching & Rotating Client Headers (0s Delay)
      const executeSearchTarget = async (target: any) => {
        const sanitizedQuery = (target.query || '')
          .replace(/\b(?:and|the|for|with|get|gets|got|getting|from|that|this|into|about|after|before|over|under|your|you|their|them|his|her|its|hers|our|ours|are|was|were|been|being|have|has|had|does|did|will|would|shall|should|can|could|might|must|very|also|just|only|all)\b/gi, ' ')
          .replace(/[^a-zA-Z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!sanitizedQuery || sanitizedQuery.length < 3) return;

        console.log(`[Viper Scraper] Executing instant target: query="${sanitizedQuery}"`);

        try {
          const formParams: Record<string, string> = {
            do: "process",
            query: sanitizedQuery,
            securitytoken: "guest"
          };
          if (target.searchuser) {
            formParams.searchuser = target.searchuser;
            formParams.exactname = "1";
          }
          if (target.starteronly) formParams.starteronly = "1";
          if (target.titleonly) formParams.titleonly = "1";

          const randomIp = `185.${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
          const reqHeaders: Record<string, string> = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "X-Forwarded-For": randomIp,
            "Client-IP": randomIp,
            "X-Real-IP": randomIp
          };
          if (sessionCookie) reqHeaders["Cookie"] = sessionCookie;

          const postRes = await fetch("https://viper.to/search.php", {
            method: "POST",
            headers: reqHeaders,
            body: new URLSearchParams(formParams).toString(),
            redirect: 'manual'
          });

          const rawCookies = postRes?.headers?.get('set-cookie');
          if (rawCookies) {
            sessionCookie = rawCookies.split(',').map((c: string) => c.split(';')[0]).join('; ');
          }

          let location = postRes?.headers?.get('location');
          if (!location) {
            const bodyText = await postRes.text().catch(() => '');
            if (bodyText.includes('wait') && (bodyText.includes('seconds') || bodyText.includes('second'))) {
              console.log(`[Viper Scraper] Flood wait detected on query "${target.query}". Waiting 5.2s before retrying...`);
              await new Promise(r => setTimeout(r, 5200));
              const retryRes = await fetch("https://viper.to/search.php", {
                method: "POST",
                headers: reqHeaders,
                body: new URLSearchParams(formParams).toString(),
                redirect: 'manual'
              });
              location = retryRes?.headers?.get('location');
            }
          }
          if (!location) return;
          if (location.startsWith('search.php')) location = 'https://viper.to/' + location;

          const parseSearchResultsPage = (html: string) => {
            if (!html) return [];
            const $ = cheerio.load(html);
            const foundThreads: Array<{ threadTitle: string; href: string; author: string; forumName: string }> = [];
            $('a.title.thread-preview').each((i, el) => {
              const threadTitle = $(el).text().trim();
              let href = $(el).attr('href') || '';
              href = href.replace(/\?s=[a-f0-9]+&?/, '?').replace(/&s=[a-f0-9]+/, '').replace(/\?$/, '');
              const author = $(el).closest('.threadinfo').find('.author a.username').text().trim();
              const forumEl = $(el).closest('li.threadbit, tr, .threadbit').find('.threadpostedin a, a[href^="forums/"]');
              const forumName = (forumEl.first().text() || '').trim();

              const threadObj = {
                threadTitle,
                href,
                author,
                forumName
              };
              foundThreads.push(threadObj);
              evaluateThreadCandidate(threadObj);
            });
            return foundThreads;
          };

          const page1Res = await fetch(safeUrl(location), { headers: viperDefaultHeaders }).catch(() => null);
          const page1Html = page1Res ? await page1Res.text().catch(() => "") : "";
          if (!page1Html) return;

          const parsed1 = parseSearchResultsPage(page1Html);

          // If high confidence already found, return early!
          if (isHighConfidenceMatch()) return;

          // Fetch page 2 on the same searchid without flood limit
          if (location.includes('searchid=')) {
            const page2Url = location.includes('&page=') ? location.replace(/&page=\d+/, '&page=2') : `${location}&pp=25&page=2`;
            const page2Res = await fetch(safeUrl(page2Url), { headers: viperDefaultHeaders }).catch(() => null);
            const page2Html = page2Res ? await page2Res.text().catch(() => "") : "";
            if (page2Html) {
              parseSearchResultsPage(page2Html);
            }
          }
        } catch (e: any) {
          console.error(`[Viper Scraper] Error searching target "${target.query}":`, e.message);
        }
      };

      const isHighConfidenceMatch = () => bestMatch && (
        (isKellyMadison && bestMatch.score >= 110) ||
        (isSexMex && bestMatch.score >= 110) ||
        (bestMatch.actorMatched && bestMatch.matchedTitleCount >= 2 && bestMatch.score >= 80) ||
        (bestMatch.dateMatched && (bestMatch.matchedTitleCount >= 1 || bestMatch.studioMatched || trueSceneWords.length === 0) && bestMatch.score >= 90) ||
        (bestMatch.isTier1 && bestMatch.actorMatched && bestMatch.matchedTitleCount >= 1 && (bestMatch.dateMatched || bestMatch.score >= 70)) ||
        (bestMatch.matchedTitleCount >= 3 && bestMatch.score >= 75)
      );

      // Execute live prioritized search targets directly on demand (No caching)
      console.log(`[Viper Scraper] Executing prioritized live search targets (total: ${searchTargets.length})`);
      for (const target of searchTargets) {
        await executeSearchTarget(target);
        if (isHighConfidenceMatch()) {
          console.log(`[Viper Scraper] High-confidence match found! Early exiting loop.`);
          break;
        }
      }

      // Sort candidate threads descending by score
      candidateThreads.sort((a, b) => b.score - a.score);
      console.log(`[Viper Scraper] Top candidates count: ${candidateThreads.length}, Best score: ${highestScore}`);

      const photosetKeywords = ["photoset", "photo set", "photo-set", "images", "pictures", "pics", "full set", "complete set"];

      let selectedThread: any = null;
      let selectedImages: string[] = [];
      let selectedThumbnails: string[] = [];

      // Verify top 2 candidates in PARALLEL for ultra-fast verification
      const topCandidates = candidateThreads.slice(0, 2);
      const candidateResults = await Promise.all(topCandidates.map(async (candidate) => {
        const cleanUrl = candidate.url.replace(/&highlight=.*/, '').replace(/\?highlight=.*/, '');
        try {
          const threadRes = await fetch(safeUrl(cleanUrl), {
            headers: viperDefaultHeaders
          });
          const threadHtml = await threadRes.text();
          const $ = cheerio.load(threadHtml);

          const firstPost = $('.postcontent').first();
          const postText = firstPost.text().toLowerCase();

          const hasPhotosetKeyword = photosetKeywords.some(kw => postText.includes(kw));
          const candidateImages: string[] = [];
          const candidateThumbnails: string[] = [];

          firstPost.find('img').each((i, el) => {
            let src = $(el).attr('src');
            if (src && src.startsWith('http') && !src.includes('smilies') && !src.includes('progress.gif') && !src.includes('clear.gif') && !src.includes('rating')) {
              if (src.includes('vipr.im') && src.includes('/th/')) {
                const orig = src.replace('/th/', '/i/');
                if (!candidateImages.includes(orig)) { candidateImages.push(orig); candidateThumbnails.push(src); }
              } else if (src.includes('imx.to') && src.includes('/u/t/')) {
                const orig = src.replace('/u/t/', '/u/i/');
                if (!candidateImages.includes(orig)) { candidateImages.push(orig); candidateThumbnails.push(src); }
              } else {
                if (!candidateImages.includes(src)) { candidateImages.push(src); candidateThumbnails.push(src); }
              }
            }
          });

          return {
            candidate,
            hasPhotosetKeyword,
            images: candidateImages,
            thumbnails: candidateThumbnails,
            isValid: (hasPhotosetKeyword || candidateImages.length >= 5)
          };
        } catch (e: any) {
          console.error('[Viper Scraper] Error verifying candidate thread:', e.message);
          return null;
        }
      }));

      // Pick the first valid candidate (since candidates are already sorted by score)
      const validVerified = candidateResults.find(r => r && r.isValid);
      if (validVerified) {
        selectedThread = validVerified.candidate;
        selectedImages = validVerified.images;
        selectedThumbnails = validVerified.thumbnails;
      } else if (candidateResults[0]) {
        selectedThread = candidateResults[0].candidate;
        selectedImages = candidateResults[0].images;
        selectedThumbnails = candidateResults[0].thumbnails;
      }

      if (!selectedThread) {
        selectedThread = bestMatch;
      }

      if (!selectedThread || selectedThread.score < 25) {
        return res.status(404).json({ error: "Could not find a matching photoset thread on Viper.to for this title and date by approved users." });
      }

      const cleanUrl = selectedThread.url.replace(/&highlight=.*/, '').replace(/\?highlight=.*/, '');

      const responsePayload = { 
        success: true, 
        match: selectedThread, 
        url: cleanUrl, 
        images: selectedImages, 
        thumbnails: selectedThumbnails 
      };

      return res.json(responsePayload);
    } catch (e: any) {
      console.error("[Viper Scraper] Error:", e);
      res.status(500).json({ error: e.message || "Failed to extract link" });
    }
  });

  app.post('/api/extract/adultphotosets', express.json(), async (req, res) => {
    try {
      const { title, actorName, actors: providedActors, studioName, date, postUrl } = req.body;
      const cheerio = await import('cheerio');

      // Fast image extraction using regex and DOM fallback
      const extractImagesFromHtml = (html: string, cheerioLib: any) => {
        const images: string[] = [];
        const thumbnails: string[] = [];
        const seenKeys = new Set<string>();

        const addImage = (fullImg: string, thumbImg: string) => {
          if (!fullImg) return;
          // Extract base filename without query string to deduplicate
          const filename = fullImg.split('/').pop()?.split('?')[0] || fullImg;
          const key = filename.toLowerCase();
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            images.push(fullImg);
            thumbnails.push(thumbImg || fullImg);
          }
        };

        // Pixhost regex (supports nested subdirectories like /thumbs/58/213722645_0001.jpg)
        const pixhostRegex = /(?:https?:)?\/\/t(\d*)\.pixhost\.(to|icu)\/thumbs\/([a-zA-Z0-9_\-\.\/]+?\.(?:jpg|jpeg|png|webp|gif))/gi;
        let m;
        while ((m = pixhostRegex.exec(html)) !== null) {
          const fullThumb = `https://t${m[1]}.pixhost.${m[2]}/thumbs/${m[3]}`;
          const fullImg = `https://img${m[1]}.pixhost.${m[2]}/images/${m[3]}`;
          addImage(fullImg, fullThumb);
        }

        // Pixhost show links in parent <a> regex fallback
        const pixhostShowRegex = /https?:\/\/pixhost\.(to|icu)\/show\/(\d+)\/([a-zA-Z0-9_\-\.]+?\.(?:jpg|jpeg|png|webp|gif))/gi;
        while ((m = pixhostShowRegex.exec(html)) !== null) {
          const fullImg = `https://img.pixhost.${m[1]}/images/${m[2]}/${m[3]}`;
          const fullThumb = `https://t.pixhost.${m[1]}/thumbs/${m[2]}/${m[3]}`;
          addImage(fullImg, fullThumb);
        }

        // IMX.to regex
        const imxRegex = /https?:\/\/imx\.to\/u\/t\/([a-zA-Z0-9_\-\.\/]+?\.(?:jpg|jpeg|png|webp|gif))/gi;
        while ((m = imxRegex.exec(html)) !== null) {
          const fullThumb = `https://imx.to/u/t/${m[1]}`;
          const fullImg = `https://imx.to/u/i/${m[1]}`;
          addImage(fullImg, fullThumb);
        }

        // Imgbox regex
        const imgboxRegex = /https?:\/\/(?:[a-z0-9]+\.)?imgbox\.com\/([a-zA-Z0-9]+)_t\.(?:jpg|jpeg|png|webp)/gi;
        while ((m = imgboxRegex.exec(html)) !== null) {
          const fullImg = `https://images2.imgbox.com/${m[1]}_o.jpg`;
          const fullThumb = m[0];
          addImage(fullImg, fullThumb);
        }

        // TurboImageHost regex
        const turboRegex = /https?:\/\/(?:s\d+\.)?turboimagehost\.com\/t(?:b|c|d)?\/(\d+_[a-zA-Z0-9_\-\.]+?\.(?:jpg|jpeg|png|webp))/gi;
        while ((m = turboRegex.exec(html)) !== null) {
          const fullImg = `https://images.turboimagehost.com/sp/${m[1]}`;
          const fullThumb = m[0];
          addImage(fullImg, fullThumb);
        }

        // Fallback DOM Parser
        if (images.length === 0) {
          const $p = cheerioLib.load(html);
          $p("img").each((_: any, el: any) => {
            const rawSrc = ($p(el).attr("data-src") || $p(el).attr("src") || "").trim();
            const parentHref = ($p(el).parent("a").attr("href") || "").trim();
            if (!rawSrc && !parentHref) return;
            if (rawSrc.includes("counter.yadro.ru") || rawSrc.includes("captcha") || rawSrc.includes("logo") || rawSrc.includes("icon")) return;
            if (rawSrc.includes("/uploads/") || parentHref.includes("/uploads/")) return;

            let hd = "";
            let thumb = rawSrc;

            if (rawSrc.includes("pixhost")) {
              hd = rawSrc.replace(/\/\/t(\d*)\.pixhost\.(to|icu)\/thumbs\//, "//img$1.pixhost.$2/images/");
              if (!thumb) thumb = rawSrc;
            } else if (parentHref.includes("pixhost") && parentHref.includes("/show/")) {
              hd = parentHref.replace("/show/", "/images/").replace(/pixhost\.(to|icu)/, "img.pixhost.$1");
              if (!thumb) thumb = rawSrc || parentHref;
            } else if (rawSrc.includes("imx.to")) {
              hd = rawSrc.replace("/u/t/", "/u/i/").replace("/t/", "/i/");
              if (!thumb) thumb = rawSrc;
            } else if (parentHref.includes("imx.to")) {
              if (rawSrc) {
                hd = rawSrc.replace("/u/t/", "/u/i/").replace("/t/", "/i/");
                thumb = rawSrc;
              } else {
                hd = parentHref;
                thumb = parentHref;
              }
            } else if (rawSrc.includes("vipr.im")) {
              hd = rawSrc.replace("/th/", "/i/");
            } else if (rawSrc.includes("imgbox.com")) {
              hd = rawSrc.replace("thumbs", "images").replace("_t.", "_o.");
            } else if (rawSrc.includes("turboimagehost.com")) {
              hd = rawSrc.replace("/t/", "/p/");
            } else if (rawSrc.includes("postimg.cc")) {
              hd = rawSrc.replace("t.postimg.cc/", "i.postimg.cc/");
            } else {
              hd = parentHref || rawSrc;
              thumb = rawSrc || parentHref;
            }

            if (hd && !images.includes(hd)) {
              images.push(hd);
              thumbnails.push(thumb || hd);
            }
          });
        }

        return { images, thumbnails };
      };

      // Direct URL extraction (if user provided an AdultPhotoSets URL)
      if (postUrl && typeof postUrl === 'string' && postUrl.includes("adultphotosets.best")) {
        try {
          const postRes = await fetch(postUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              "Referer": "https://adultphotosets.best/"
            }
          });
          if (postRes.ok) {
            const html = await postRes.text();
            const { images, thumbnails } = extractImagesFromHtml(html, cheerio);
            if (images.length > 0) {
              return res.json({
                success: true,
                url: postUrl,
                images,
                thumbnails
              });
            }
          }
        } catch (e: any) {
          console.error("[AdultPhotoSets Direct URL error]:", e.message);
        }
      }

      if (!actorName && (!providedActors || providedActors.length === 0) && !title) {
        return res.status(400).json({ error: "Actor name or title is required to search adultphotosets.best" });
      }

      const allActorNames: string[] = [];
      if (Array.isArray(providedActors)) {
        providedActors.forEach(a => {
          if (typeof a === 'string' && a.trim()) allActorNames.push(a.trim());
        });
      }
      if (actorName && typeof actorName === 'string') {
        const splitActors = actorName.split(/\s*(?:&|and|,|\/|\+|\u0648)\s*/i).map(s => s.trim()).filter(Boolean);
        splitActors.forEach(a => {
          if (!allActorNames.some(existing => existing.toLowerCase() === a.toLowerCase())) {
            allActorNames.push(a);
          }
        });
      }
      const primaryActor = allActorNames[0] || (actorName ? String(actorName).trim() : "");

      // Comprehensive Date Tokens
      const generateDateTokens = (dateStr: string) => {
        if (!dateStr) return { exactTokens: new Set<string>(), yearOnly: "" };
        const tokens = new Set<string>();
        const baseD = new Date(dateStr);
        if (isNaN(baseD.getTime())) return { exactTokens: tokens, yearOnly: "" };

        const monthNamesFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        const year = baseD.getFullYear().toString();

        const datesToCheck = [
          baseD,
          new Date(baseD.getTime() - 24 * 60 * 60 * 1000),
          new Date(baseD.getTime() + 24 * 60 * 60 * 1000)
        ];

        for (const d of datesToCheck) {
          const y = d.getFullYear().toString();
          const shortYear = y.slice(-2);
          const monthIdx = d.getMonth();
          const monthPad = (monthIdx + 1).toString().padStart(2, '0');
          const monthRaw = (monthIdx + 1).toString();
          const dayPad = d.getDate().toString().padStart(2, '0');
          const dayRaw = d.getDate().toString();

          const mFull = monthNamesFull[monthIdx];
          const mShort = monthNamesShort[monthIdx];

          tokens.add(`${mFull}-${dayPad}-${y}`);
          tokens.add(`${mFull}-${dayRaw}-${y}`);
          tokens.add(`${mFull} ${dayPad} ${y}`);
          tokens.add(`${mFull} ${dayRaw} ${y}`);
          tokens.add(`${mFull} ${dayPad}, ${y}`);
          tokens.add(`${mFull} ${dayRaw}, ${y}`);
          tokens.add(`${mFull}-${dayPad}-${shortYear}`);
          tokens.add(`${mFull}-${dayRaw}-${shortYear}`);
          tokens.add(`${mShort}-${dayPad}-${y}`);
          tokens.add(`${mShort}-${dayRaw}-${y}`);
          tokens.add(`${mShort} ${dayPad} ${y}`);
          tokens.add(`${mShort} ${dayRaw} ${y}`);
          tokens.add(`${mShort} ${dayPad}, ${y}`);
          tokens.add(`${mShort} ${dayRaw}, ${y}`);
          tokens.add(`${mShort}-${dayPad}-${shortYear}`);
          tokens.add(`${mShort}-${dayRaw}-${shortYear}`);

          tokens.add(`${monthPad}-${dayPad}-${y}`);
          tokens.add(`${monthPad}/${dayPad}/${y}`);
          tokens.add(`${monthPad}.${dayPad}.${y}`);
          tokens.add(`${monthPad}-${dayPad}-${shortYear}`);
          tokens.add(`${monthPad}/${dayPad}/${shortYear}`);
          tokens.add(`${monthPad}.${dayPad}.${shortYear}`);

          tokens.add(`${dayPad}-${monthPad}-${y}`);
          tokens.add(`${dayPad}/${monthPad}/${y}`);
          tokens.add(`${dayPad}.${monthPad}.${y}`);
          tokens.add(`${dayPad}-${monthPad}-${shortYear}`);
          tokens.add(`${dayPad} ${monthPad} ${y}`);
          tokens.add(`${dayPad} ${monthPad} ${shortYear}`);

          tokens.add(`${y}-${monthPad}-${dayPad}`);
          tokens.add(`${y}.${monthPad}.${dayPad}`);
          tokens.add(`${y}/${monthPad}/${dayPad}`);
          tokens.add(`${monthPad}${dayPad}${y}`);
          tokens.add(`${dayPad}${monthPad}${y}`);
        }
        return { exactTokens: tokens, yearOnly: year };
      };

      const { exactTokens: dateTokens, yearOnly } = generateDateTokens(date);

      interface APSCandidate {
        title: string;
        url: string;
        score: number;
        hasDateMatch: boolean;
        photoCount: number;
        dateStr: string;
      }

      const allCandidates: APSCandidate[] = [];
      const seenUrls = new Set<string>();

      const evaluateAndAddLink = (itemTitle: string, href: string) => {
        if (!href.includes(".html") || href.includes("#") || seenUrls.has(href) || itemTitle.length < 5) {
          return;
        }
        seenUrls.add(href);

        let score = 0;
        const lowerTitle = itemTitle.toLowerCase();

        // 1. Actor Matching (Highest Priority)
        let actorMatched = false;
        for (const a of allActorNames) {
          if (lowerTitle.includes(a.toLowerCase())) {
            score += 45;
            actorMatched = true;
          }
        }
        if (allActorNames.length > 0 && !actorMatched) {
          score -= 35;
        }

        // 2. Studio Matching
        if (studioName) {
          const cleanStudio = studioName.toLowerCase().replace(/\s+/g, '');
          if (lowerTitle.includes(cleanStudio)) {
            score += 35;
          } else if (lowerTitle.includes(studioName.toLowerCase())) {
            score += 30;
          }
        }

        // 3. Title Keywords Matching
        const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'her', 'his', 'gets', 'before', 'after', 'scene', 'part', 'girl', 'friend', 'friends']);
        if (title) {
          const words = title.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
          let titleWordsMatched = 0;
          for (const w of words) {
            if (lowerTitle.includes(w)) {
              score += 15;
              titleWordsMatched++;
            }
          }
          if (titleWordsMatched >= 2) {
            score += 25;
          }
        }

        // 4. Date Tokens & Year Matching
        let hasDateMatch = false;
        if (dateTokens.size > 0) {
          for (const dt of dateTokens) {
            if (lowerTitle.includes(dt.toLowerCase())) {
              score += 65;
              hasDateMatch = true;
              break;
            }
          }
          if (!hasDateMatch && /\b\d{2}[.-]\d{2}[.-]\d{4}\b|\b\d{4}[.-]\d{2}[.-]\d{2}\b/.test(itemTitle)) {
            score -= 40;
          } else if (yearOnly && lowerTitle.includes(yearOnly)) {
            score += 15;
          }
        }

        // 5. Photoset indicator
        let photoCount = 0;
        const photoCountMatch = itemTitle.match(/\b(\d+)\s*(?:x|images|pics|photos)\b/i);
        if (photoCountMatch) {
          photoCount = parseInt(photoCountMatch[1], 10);
          score += 20;
        } else if (href.includes("photo-sets") || href.includes("photoset")) {
          score += 15;
        }

        // Extract human readable date string if found
        let postDate = "";
        const dateMatch = itemTitle.match(/\b(\d{2}[.-]\d{2}[.-]\d{4}|\d{4}[.-]\d{2}[.-]\d{2})\b/);
        if (dateMatch) {
          postDate = dateMatch[1];
        }

        allCandidates.push({
          title: itemTitle,
          url: href.startsWith("http") ? href : "https://adultphotosets.best" + href,
          score,
          hasDateMatch,
          photoCount,
          dateStr: postDate
        });
      };

      // Parallel Search & Tag Strategy
      const fetchTasks: Promise<void>[] = [];

      const queriesToTry: string[] = [];
      if (primaryActor && title) {
        const cleanT = title.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        queriesToTry.push(`${primaryActor} ${cleanT}`);
      }
      if (studioName && primaryActor) {
        queriesToTry.push(`${studioName} ${primaryActor}`);
      }
      if (primaryActor) {
        queriesToTry.push(primaryActor);
      }

      for (const query of queriesToTry.slice(0, 2)) {
        fetchTasks.push((async () => {
          try {
            const formParams = new URLSearchParams();
            formParams.append("do", "search");
            formParams.append("subaction", "search");
            formParams.append("story", query);

            const res = await fetch("https://adultphotosets.best/index.php?do=search", {
              method: "POST",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": "https://adultphotosets.best/"
              },
              body: formParams.toString()
            });

            if (res.ok) {
              const html = await res.text();
              const $s = cheerio.load(html);
              $s("a").each((_: any, el: any) => {
                evaluateAndAddLink($s(el).text().trim(), $s(el).attr("href") || "");
              });
            }
          } catch (e: any) {
            console.error("[AdultPhotoSets Search error]:", e.message);
          }
        })());
      }

      // Tag Page query for primaryActor
      if (primaryActor) {
        fetchTasks.push((async () => {
          try {
            const tagUrl = `https://adultphotosets.best/tags/${encodeURIComponent(primaryActor)}/`;
            const tagRes = await fetch(tagUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Referer": "https://adultphotosets.best/"
              }
            });
            if (tagRes.ok) {
              const tagHtml = await tagRes.text();
              const $t = cheerio.load(tagHtml);
              $t("a").each((_: any, el: any) => {
                evaluateAndAddLink($t(el).text().trim(), $t(el).attr("href") || "");
              });
            }
          } catch (e: any) {
            console.error("[AdultPhotoSets Tag error]:", e.message);
          }
        })());
      }

      // Run parallel searches
      await Promise.all(fetchTasks);

      // Filter and rank candidates
      const validCandidates = allCandidates.filter(c => c.score >= 50);
      validCandidates.sort((a, b) => b.score - a.score);

      if (validCandidates.length === 0) {
        return res.status(404).json({ error: "Could not find a reliable matching photoset on AdultPhotoSets.best for this scene" });
      }

      const topCandidates = validCandidates.slice(0, 4);

      let selectedPost: APSCandidate | null = null;
      let selectedImages: string[] = [];
      let selectedThumbnails: string[] = [];

      for (const candidate of topCandidates) {
        try {
          const postRes = await fetch(candidate.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              "Referer": "https://adultphotosets.best/"
            }
          });

          if (!postRes.ok) continue;
          const postHtml = await postRes.text();
          const { images, thumbnails } = extractImagesFromHtml(postHtml, cheerio);

          if (images.length > 0) {
            selectedPost = candidate;
            selectedImages = images;
            selectedThumbnails = thumbnails;
            break;
          }
        } catch (e: any) {
          console.error("[AdultPhotoSets Post fetch error]:", candidate.url, e.message);
        }
      }

      if (!selectedPost && topCandidates[0]) {
        selectedPost = topCandidates[0];
      }

      if (!selectedPost) {
        return res.status(404).json({ error: "No photos found inside matching posts on AdultPhotoSets.best" });
      }

      return res.json({
        success: true,
        match: selectedPost,
        url: selectedPost.url,
        images: selectedImages,
        thumbnails: selectedThumbnails,
        candidates: topCandidates.map(c => ({
          title: c.title,
          url: c.url,
          score: c.score,
          photoCount: c.photoCount,
          dateStr: c.dateStr
        }))
      });
    } catch (e: any) {
      console.error("[AdultPhotoSets Scraper] Error:", e);
      res.status(500).json({ error: e.message || "Failed to extract from AdultPhotoSets" });
    }
  });

  // Scraper & Media extractor (supports Instagram posts/reels, Goonbox profiles/albums/images)
  const handleScraperExtract = async (req: any, res: any) => {
    try {
      const { url, fetchAll = true, maxPages = 50 } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
      }

      const cleanUrl = url.trim();

      // 0. Check if Instagram post / reel: https://www.instagram.com/p/:shortcode or /reel/:shortcode
      const instagramMatch = cleanUrl.match(/(?:instagram\.com|instagr\.am)\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)/i);
      if (instagramMatch) {
        const shortcode = instagramMatch[1];
        const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
        const igRes = await fetch(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });

        if (!igRes.ok) {
          return res.status(igRes.status).json({ error: 'Failed to access Instagram post. Please verify the link is public.' });
        }

        const html = await igRes.text();
        const $ = cheerio.load(html);

        const items: any[] = [];
        const parsedDate = Date.now();

        // Find all images from Instagram post (single image or full multi-image carousel)
        // Strategy 1: Parse embedded contextJSON data (gives all carousel items and resolutions)
        $('script').each((i, el) => {
          const text = $(el).html() || '';
          if (text.includes('contextJSON')) {
            const contextMatches = text.match(/"contextJSON"\s*:\s*("(?:\\"|[^"])+")/g);
            if (contextMatches) {
              for (const cm of contextMatches) {
                try {
                  const rawVal = cm.replace(/^"contextJSON"\s*:\s*/, '');
                  const parsedStr = JSON.parse(rawVal);
                  const parsedObj = JSON.parse(parsedStr);
                  const media = parsedObj?.gql_data?.shortcode_media;
                  if (media) {
                    if (media.edge_sidecar_to_children?.edges?.length) {
                      // Multi-slide Carousel
                      media.edge_sidecar_to_children.edges.forEach((edge: any, idx: number) => {
                        const node = edge.node;
                        const originalUrl = node.display_url || node.display_resources?.[0]?.src;
                        let thumbUrl = originalUrl;
                        if (Array.isArray(node.display_resources) && node.display_resources.length > 0) {
                          const sorted = [...node.display_resources].sort((a: any, b: any) => (a.config_width || 0) - (b.config_width || 0));
                          const ideal = sorted.find((r: any) => (r.config_width || 0) >= 240 && (r.config_width || 0) <= 480) || sorted[0];
                          thumbUrl = ideal?.src || sorted[0]?.src || originalUrl;
                        }

                        if (originalUrl) {
                          items.push({
                            id: node.id || `${shortcode}-${idx}`,
                            url: originalUrl,
                            originalUrl: originalUrl,
                            thumbUrl: thumbUrl,
                            date: parsedDate,
                            title: `Instagram Slide ${idx + 1}`
                          });
                        }
                      });
                    } else {
                      // Single media item
                      const originalUrl = media.display_url || media.display_resources?.[0]?.src;
                      let thumbUrl = originalUrl;
                      if (Array.isArray(media.display_resources) && media.display_resources.length > 0) {
                        const sorted = [...media.display_resources].sort((a: any, b: any) => (a.config_width || 0) - (b.config_width || 0));
                        const ideal = sorted.find((r: any) => (r.config_width || 0) >= 240 && (r.config_width || 0) <= 480) || sorted[0];
                        thumbUrl = ideal?.src || sorted[0]?.src || originalUrl;
                      }

                      if (originalUrl) {
                        items.push({
                          id: media.id || shortcode,
                          url: originalUrl,
                          originalUrl: originalUrl,
                          thumbUrl: thumbUrl,
                          date: parsedDate,
                          title: `Instagram Post ${shortcode}`
                        });
                      }
                    }
                  }
                } catch (e) {
                  // Fallback to strategy 2
                }
              }
            }
          }
        });

        // Strategy 2: Fallback to regex and CDN groupings if strategy 1 yielded no items
        if (items.length === 0) {
          const allCdnUrls = html.match(/https?:\/\/[^"'\s\\]*(?:cdninstagram|fbcdn)[^"'\s\\]*\/v\/t51\.[0-9]+-15\/[^"'\s\\]+/gi) || [];
          const cleanUrls = [...new Set(allCdnUrls.map(u => u.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&')))];

          const photoGroups = new Map<string, string[]>();

          cleanUrls.forEach(u => {
            const idMatch = u.match(/\/t51\.[0-9]+-15\/([0-9]+_[0-9]+_[0-9]+_n\.jpg)/);
            const photoId = idMatch ? idMatch[1] : u.split('?')[0];
            
            if (!photoGroups.has(photoId)) {
              photoGroups.set(photoId, []);
            }
            photoGroups.get(photoId)!.push(u);
          });

          photoGroups.forEach((urls, photoId) => {
            const original = urls.find(u => u.includes('_e35_tt6') && !u.includes('_p') && !u.includes('_s')) || 
                             urls.find(u => u.includes('1080x1080') || u.includes('720x720')) || 
                             urls[0];

            const thumb = urls.find(u => u.includes('_p320x320') || u.includes('_s320x320') || u.includes('_p240x240') || u.includes('_s240x240')) || 
                          urls.find(u => u.includes('_s150x150')) || 
                          urls[urls.length - 1];

            items.push({
              id: photoId,
              url: original,
              originalUrl: original,
              thumbUrl: thumb,
              date: parsedDate,
              title: `Instagram Post ${shortcode}`
            });
          });
        }

        // Strategy 3: Fallback to img.EmbeddedMediaImage
        if (items.length === 0) {
          const imgEl = $('img.EmbeddedMediaImage');
          const srcset = imgEl.attr('srcset') || '';
          const src = imgEl.attr('src') || '';
          if (srcset) {
            const parts = srcset.split(',').map(s => {
              const p = s.trim().split(/\s+/);
              const u = p[0]?.replace(/&amp;/g, '&');
              const w = parseInt(p[1]?.replace('w', '') || '0', 10);
              return { url: u, width: w };
            }).filter(x => x.url && x.width > 0).sort((a, b) => b.width - a.width);

            if (parts.length > 0) {
              const original = parts[0].url;
              const thumb = parts.find(p => p.width <= 320)?.url || parts[parts.length - 1].url;
              items.push({
                id: `ig-${shortcode}-0`,
                url: original,
                originalUrl: original,
                thumbUrl: thumb,
                date: parsedDate,
                title: `Instagram Post ${shortcode}`
              });
            }
          } else if (src) {
            const cleanSrc = src.replace(/&amp;/g, '&');
            items.push({
              id: `ig-${shortcode}-0`,
              url: cleanSrc,
              originalUrl: cleanSrc,
              thumbUrl: cleanSrc,
              date: parsedDate,
              title: `Instagram Post ${shortcode}`
            });
          }
        }

        if (items.length === 0) {
          return res.status(404).json({ error: 'Could not extract images from this Instagram post. Please ensure the post is public.' });
        }

        const isMulti = items.length > 1;
        const postType = isMulti ? 'Multiple' : 'Single';

        return res.json({
          success: true,
          platform: 'instagram',
          isSinglePost: true,
          items,
          groupedPosts: [{
            postId: `ig-${shortcode}`,
            urls: items.map(it => it.originalUrl),
            thumbUrls: items.map(it => it.thumbUrl),
            perImageDates: items.map(it => it.date),
            date: parsedDate,
            type: postType,
            title: `Instagram Post ${shortcode}`
          }],
          total: items.length
        });
      }

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://goonbox.cr/'
      };

      // 1. Check if single image: https://goonbox.cr/i/:imageId or /img/:imageId or /image/:imageId
      const singleImageMatch = cleanUrl.match(/goonbox\.cr\/(?:i|img|image|images)\/([a-zA-Z0-9_-]+)/i);
      if (singleImageMatch) {
        const imageId = singleImageMatch[1];
        const apiRes = await fetch(`https://goonbox.cr/api/images/${imageId}`, { headers });
        if (!apiRes.ok) {
          return res.status(404).json({ error: 'Image not found on Goonbox' });
        }
        const data = await apiRes.json();
        const img = data.image || data;
        const parsedDate = img.created_at ? new Date(img.created_at).getTime() : Date.now();
        const originalUrl = img.original_url || '';
        const thumbUrl = img.medium_url || img.thumb_url || originalUrl;
        const item = {
          id: img.encoded_id || imageId,
          url: originalUrl,
          originalUrl: originalUrl,
          thumbUrl: thumbUrl,
          date: parsedDate,
          title: img.original_filename || ''
        };
        return res.json({
          success: true,
          isSinglePost: true,
          items: [item],
          groupedPosts: [{
            postId: item.id,
            urls: [item.originalUrl],
            thumbUrls: [item.thumbUrl],
            date: parsedDate,
            type: 'Single'
          }],
          total: 1
        });
      }

      // 2. Check if album: https://goonbox.cr/a/:albumId or /album/:albumId or /albums/:albumId
      const albumMatch = cleanUrl.match(/goonbox\.cr\/(?:a|album|albums)\/([a-zA-Z0-9_-]+)/i);
      if (albumMatch) {
        const albumId = albumMatch[1];
        const apiRes = await fetch(`https://goonbox.cr/api/albums/${albumId}`, { headers });
        if (!apiRes.ok) {
          return res.status(404).json({ error: 'Album not found on Goonbox' });
        }
        const data = await apiRes.json();
        const album = data.album || data;
        const albumTitle = album.title || 'Goonbox Album';
        let albumImages: any[] = Array.isArray(album.images) ? album.images : [];
        
        // If paginated inside album
        if (data.pagination && data.pagination.last_page > 1 && fetchAll) {
          const lastPage = Math.min(data.pagination.last_page, maxPages);
          for (let p = 2; p <= lastPage; p++) {
            try {
              const pRes = await fetch(`https://goonbox.cr/api/albums/${albumId}?page=${p}`, { headers });
              if (pRes.ok) {
                const pData = await pRes.json();
                const pImages = pData.album?.images || pData.images || [];
                if (Array.isArray(pImages)) {
                  albumImages = albumImages.concat(pImages);
                }
              }
            } catch (pErr) {
              console.warn(`[Goonbox] Failed to fetch album page ${p}:`, pErr);
            }
          }
        }

        const items = albumImages.map((img: any) => ({
          id: img.encoded_id || Math.random().toString(36).substring(2, 9),
          url: img.original_url,
          originalUrl: img.original_url,
          thumbUrl: img.medium_url || img.thumb_url || img.original_url,
          date: img.created_at ? new Date(img.created_at).getTime() : Date.now(),
          title: img.original_filename || ''
        }));

        const dates = items.map(it => it.date);
        const earliestDate = dates.length > 0 ? Math.min(...dates) : Date.now();

        return res.json({
          success: true,
          isSinglePost: false,
          items,
          groupedPosts: [{
            postId: albumId,
            urls: items.map(it => it.originalUrl),
            thumbUrls: items.map(it => it.thumbUrl),
            perImageDates: dates,
            date: earliestDate,
            type: items.length > 1 ? 'Multiple' : 'Single',
            title: albumTitle
          }],
          total: items.length
        });
      }

      // 3. Check if user profile: https://goonbox.cr/u/:username
      const userMatch = cleanUrl.match(/goonbox\.cr\/u\/([a-zA-Z0-9_-]+)/i);
      if (userMatch) {
        const username = userMatch[1];
        const isAlbumsTab = cleanUrl.includes('tab=albums');

        if (isAlbumsTab) {
          // Fetch user albums
          const albumsRes = await fetch(`https://goonbox.cr/api/users/${username}/albums?page=1&per_page=24`, { headers });
          if (!albumsRes.ok) {
            return res.status(404).json({ error: 'User albums not found on Goonbox' });
          }
          const albumsData = await albumsRes.json();
          const userAlbums = albumsData.albums || [];
          const groupedPosts: any[] = [];
          const allItems: any[] = [];

          for (const alb of userAlbums) {
            const albId = alb.encoded_id;
            if (!albId) continue;
            try {
              const albRes = await fetch(`https://goonbox.cr/api/albums/${albId}`, { headers });
              if (albRes.ok) {
                const aData = await albRes.json();
                const aImgs = aData.album?.images || aData.images || [];
                const albItems = aImgs.map((img: any) => ({
                  id: img.encoded_id || Math.random().toString(36).substring(2, 9),
                  url: img.original_url,
                  originalUrl: img.original_url,
                  thumbUrl: img.medium_url || img.thumb_url || img.original_url,
                  date: img.created_at ? new Date(img.created_at).getTime() : Date.now(),
                  title: img.original_filename || ''
                }));
                allItems.push(...albItems);
                groupedPosts.push({
                  postId: albId,
                  urls: albItems.map((it: any) => it.originalUrl),
                  thumbUrls: albItems.map((it: any) => it.thumbUrl),
                  perImageDates: albItems.map((it: any) => it.date),
                  date: albItems[0]?.date || (alb.created_at ? new Date(alb.created_at).getTime() : Date.now()),
                  type: albItems.length > 1 ? 'Multiple' : 'Single',
                  title: alb.title || ''
                });
              }
            } catch (e) {
              console.warn(`[Goonbox] Failed album ${albId}:`, e);
            }
          }

          return res.json({
            success: true,
            isSinglePost: false,
            items: allItems,
            groupedPosts,
            total: allItems.length
          });
        }

        // Standard user images tab (https://goonbox.cr/u/:username?tab=images or default)
        let allImages: any[] = [];
        const firstPageRes = await fetch(`https://goonbox.cr/api/users/${username}/images?page=1&per_page=48&sort=newest`, { headers });
        if (!firstPageRes.ok) {
          return res.status(404).json({ error: 'User profile not found or private on Goonbox' });
        }
        const firstPageData = await firstPageRes.json();
        allImages = allImages.concat(firstPageData.images || []);

        const lastPage = fetchAll ? Math.min(firstPageData.pagination?.last_page || 1, maxPages) : 1;
        for (let p = 2; p <= lastPage; p++) {
          try {
            const pageRes = await fetch(`https://goonbox.cr/api/users/${username}/images?page=${p}&per_page=48&sort=newest`, { headers });
            if (pageRes.ok) {
              const pageData = await pageRes.json();
              if (Array.isArray(pageData.images)) {
                allImages = allImages.concat(pageData.images);
              }
            }
          } catch (pErr) {
            console.warn(`[Goonbox] Page ${p} fetch failed:`, pErr);
          }
        }

        const items = allImages.map((img: any) => ({
          id: img.encoded_id || Math.random().toString(36).substring(2, 9),
          url: img.original_url,
          originalUrl: img.original_url,
          thumbUrl: img.medium_url || img.thumb_url || img.original_url,
          date: img.created_at ? new Date(img.created_at).getTime() : Date.now(),
          title: img.original_filename || ''
        }));

        // Individual grouped posts per image with its exact date
        const groupedPosts = items.map((it: any) => ({
          postId: it.id,
          urls: [it.originalUrl],
          thumbUrls: [it.thumbUrl],
          perImageDates: [it.date],
          date: it.date,
          type: 'Single',
          title: it.title
        }));

        return res.json({
          success: true,
          isSinglePost: false,
          items,
          groupedPosts,
          total: items.length,
          pagesFetched: lastPage
        });
      }

      return res.status(400).json({ error: 'Unsupported URL format. Please provide an Instagram post or Goonbox link.' });
    } catch (e: any) {
      console.error("[Media Scraper] Error:", e);
      res.status(500).json({ error: e.message || "Failed to extract media" });
    }
  };

  app.post('/api/extract/goonbox', express.json(), handleScraperExtract);
  app.post('/api/extract/scraper', express.json(), handleScraperExtract);

  // Fast Coomer / Creator Profile Extractor (extracts name, displayName and pfp avatar from creator/post URL)
  app.post('/api/extract/coomer-profile', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
      }

      let cleanUrl = url.trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '');
      const urlMatch = cleanUrl.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        cleanUrl = urlMatch[0];
      }

      let service = '';
      let serviceId = '';
      let candidateQuery = '';

      // Pattern 1: /creators/:service/:id or /creator/:service/:id (e.g. avatar or creator pages)
      const creatorPattern = cleanUrl.match(/(?:creators?)\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)/i);
      // Pattern 2: /:service/user/:id
      const userPattern = cleanUrl.match(/\/([a-zA-Z0-9_\-]+)\/user\/([a-zA-Z0-9_\-]+)/i);
      // Pattern 3: /api/v1/:service/user/:id
      const apiPattern = cleanUrl.match(/\/api\/v1\/([a-zA-Z0-9_\-]+)\/user\/([a-zA-Z0-9_\-]+)/i);
      // Pattern 4: /data/:service/.../:id
      const dataPattern = cleanUrl.match(/\/data\/([a-zA-Z0-9_\-]+)\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-zA-Z0-9_\-]+)/i);

      if (creatorPattern) {
        service = creatorPattern[1].toLowerCase();
        serviceId = creatorPattern[2];
      } else if (userPattern) {
        service = userPattern[1].toLowerCase();
        serviceId = userPattern[2];
      } else if (apiPattern) {
        service = apiPattern[1].toLowerCase();
        serviceId = apiPattern[2];
      } else if (dataPattern) {
        service = dataPattern[1].toLowerCase();
        serviceId = dataPattern[2];
      } else {
        // Pattern 5: single service or id like /creators/39740564
        const singleCreator = cleanUrl.match(/creators?\/([a-zA-Z0-9_\-]+)/i);
        if (singleCreator && !['onlyfans', 'fansly', 'patreon', 'fanbox', 'candfans', 'fantia', 'boosty'].includes(singleCreator[1].toLowerCase())) {
          service = 'onlyfans';
          serviceId = singleCreator[1];
        } else {
          // Pattern 6: social media URL (onlyfans.com/user, fansly.com/user, etc.)
          const socialMatch = cleanUrl.match(/(?:onlyfans\.com|fansly\.com|patreon\.com|candfans\.jp|fantia\.jp|boosty\.to)\/([a-zA-Z0-9_\-]+)/i);
          if (socialMatch) {
            if (cleanUrl.includes('onlyfans')) service = 'onlyfans';
            else if (cleanUrl.includes('fansly')) service = 'fansly';
            else if (cleanUrl.includes('patreon')) service = 'patreon';
            else if (cleanUrl.includes('candfans')) service = 'candfans';
            else if (cleanUrl.includes('fantia')) service = 'fantia';
            else if (cleanUrl.includes('boosty')) service = 'boosty';
            candidateQuery = socialMatch[1];
          } else {
            // Pattern 7: service/id string or just search string
            const slashMatch = cleanUrl.match(/^([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)$/);
            if (slashMatch) {
              service = slashMatch[1].toLowerCase();
              serviceId = slashMatch[2];
            } else {
              candidateQuery = cleanUrl.replace(/^https?:\/\/[^\/]+\/?/i, '').split('?')[0];
            }
          }
        }
      }

      const apiHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://cum.st/'
      };

      // If we don't have serviceId yet, or serviceId is a username rather than a numeric ID, search the creators API
      if ((!serviceId && candidateQuery) || (serviceId && !/^\d+$/.test(serviceId) && (service === 'onlyfans' || !service))) {
        const queryToSearch = candidateQuery || serviceId;
        try {
          const searchRes = await fetch(`https://cum.st/api/v1/creators?q=${encodeURIComponent(queryToSearch)}`, { headers: apiHeaders });
          if (searchRes.ok) {
            const data = await searchRes.json();
            const list: any[] = Array.isArray(data?.creators) ? data.creators : (Array.isArray(data) ? data : []);
            const found = list.find((c: any) =>
              (service ? c.service === service : true) &&
              (c.name?.toLowerCase() === queryToSearch.toLowerCase() ||
               c.id === queryToSearch ||
               c.displayName?.toLowerCase() === queryToSearch.toLowerCase())
            ) || list[0];

            if (found) {
              service = found.service || service || 'onlyfans';
              serviceId = found.id;
            }
          }
        } catch (searchErr) {
          // Search failed, fallback
        }
      }

      if (!serviceId && candidateQuery && /^\d+$/.test(candidateQuery)) {
        serviceId = candidateQuery;
        if (!service) service = 'onlyfans';
      }

      if (!service && serviceId) {
        service = 'onlyfans';
      }

      if (!service || !serviceId) {
        return res.status(400).json({ error: 'Could not detect service or creator ID from URL' });
      }

      const detectedHost = cleanUrl.includes('cum.st') 
        ? 'https://cum.st' 
        : (cleanUrl.includes('kemono') ? 'https://kemono.su' : 'https://coomer.su');

      const apiHosts = [detectedHost, ...['https://cum.st', 'https://coomer.su', 'https://kemono.su', 'https://coomer.st'].filter(h => h !== detectedHost)];

      let profileData: any = null;
      for (const host of apiHosts) {
        let attempts = 0;
        const maxHostAttempts = 2;
        while (attempts < maxHostAttempts) {
          attempts++;
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 7000);
            const r = await fetch(`${host}/api/v1/${service}/user/${serviceId}/profile`, { headers: apiHeaders, signal: controller.signal });
            clearTimeout(timeout);
            if (r.ok) {
              profileData = await r.json();
              break;
            }
            if (r.status === 429 && attempts < maxHostAttempts) {
              const retryAfter = parseInt(r.headers.get('retry-after') || '1', 10);
              await new Promise(res => setTimeout(res, Math.min(2000, isNaN(retryAfter) ? 600 : retryAfter * 1000)));
            }
          } catch (e) {
            if (attempts < maxHostAttempts) {
              await new Promise(res => setTimeout(res, 400));
            }
          }
        }
        if (profileData) break;
      }

      let name = '';
      let displayName = '';
      let avatarUrl = '';

      if (profileData) {
        name = profileData.name || profileData.displayName || '';
        displayName = profileData.displayName || profileData.name || '';
        const v = profileData.updated || profileData.indexed || '';
        avatarUrl = `https://img.cum.st/creator/${service}/${serviceId}/avatar.webp${v ? `?v=${v}` : ''}`;
      } else {
        // Fallback: Attempt direct HTML fetch & scrape
        try {
          const htmlRes = await fetch(cleanUrl, { headers: apiHeaders });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            const $ = cheerio.load(html);
            const title = $('title').text().trim();
            const titleMatch = title.match(/^([^|\-]+)/);
            if (titleMatch) {
              name = titleMatch[1].trim();
            }
            const foundAvatar = $('img[src*="avatar.webp"]').attr('src') || $('meta[property="og:image"]').attr('content') || '';
            if (foundAvatar) {
              avatarUrl = foundAvatar.startsWith('http') ? foundAvatar : `https://img.cum.st${foundAvatar}`;
            }
          }
        } catch (scrapeErr) {
          // Ignore fallback error
        }

        if (!avatarUrl) {
          avatarUrl = `https://img.cum.st/creator/${service}/${serviceId}/avatar.webp`;
        }
        if (!name) {
          name = serviceId;
        }
      }

      return res.json({
        success: true,
        service,
        serviceId,
        name: name || serviceId,
        displayName: displayName || name || serviceId,
        avatarUrl
      });
    } catch (err: any) {
      console.error('[Coomer Profile Extractor] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch creator profile' });
    }
  });

  // Coomer / Socials media extractor (supports cum.st / coomer / kemono creator & post URLs)
  app.post('/api/extract/coomer', express.json(), async (req, res) => {
    try {
      const { url, offset, limit = 50, fetchAll = false, page, pageFrom, pageTo, maxPages } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
      }

      const cleanUrl = url.trim();

      const apiHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': cleanUrl.includes('cum.st') ? 'https://cum.st/' : 'https://coomer.su/'
      };

      // Helper to clean and decode HTML captions/descriptions
      const extractCleanCaption = (post: any): string => {
        let raw = post.caption || post.captionHtml || post.content || post.title || '';
        if (!raw || typeof raw !== 'string') return '';
        raw = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
        raw = raw.replace(/<[^>]+>/g, '');
        raw = raw.replace(/&amp;/g, '&')
                 .replace(/&quot;/g, '"')
                 .replace(/&#39;/g, "'")
                 .replace(/&lt;/g, '<')
                 .replace(/&gt;/g, '>')
                 .replace(/&nbsp;/g, ' ');
        return raw.trim();
      };

      // Helper function to extract media details from file or attachment item
      const parseMediaFromObject = (obj: any): { 
        originalUrl: string; 
        thumbUrl: string; 
        fallbackUrls?: string[];
        mediaType: 'image' | 'video'; 
        duration?: number; 
        width?: number; 
        height?: number; 
        key: string 
      } | null => {
        if (!obj || typeof obj !== 'object') return null;

        const mime = (obj.mimeType || '').toLowerCase();
        const name = (obj.name || obj.variants?.[0]?.name || obj.path || '').toLowerCase();
        const kind = (obj.kind || '').toLowerCase();

        // Skip non-media files (audio, archives, docs)
        if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|zip|rar|7z|pdf|txt|docx?)$/i.test(name)) {
          return null;
        }

        const isVideo = kind === 'video' || 
                        mime.startsWith('video/') || 
                        /\.(mp4|m4v|webm|mkv|mov)$/i.test(name) ||
                        (obj.path && /\.(mp4|m4v|webm|mkv|mov)$/i.test(obj.path));

        const isImg = kind === 'image' || 
                      mime.startsWith('image/') || 
                      /\.(jpg|jpeg|png|webp|gif|avif|bmp)/i.test(name) ||
                      (obj.path && /\.(jpg|jpeg|png|webp|gif|avif)/i.test(obj.path)) ||
                      (obj.sha256 && !isVideo);

        if (!isImg && !isVideo && !obj.sha256 && !obj.path) return null;

        const sha256 = obj.sha256 || obj.storageKey;
        let originalUrl = '';
        let thumbUrl = '';
        const fallbackUrls: string[] = [];
        const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';
        const duration = typeof obj.durationMs === 'number' && obj.durationMs > 0
          ? Math.round(obj.durationMs / 1000)
          : (typeof obj.duration === 'number' && obj.duration > 0 ? Math.round(obj.duration) : undefined);

        if (sha256) {
          const defaultExt = isVideo ? 'original.mp4' : 'original.jpg';
          const variantName = obj.variants?.[0]?.name || obj.name || defaultExt;
          thumbUrl = `https://img.cum.st/thumbnail/${sha256}/preview.webp`;
          originalUrl = `https://e1.cum.st/media/${sha256}/${variantName}?response-content-disposition=inline; filename="${variantName}"`;
          fallbackUrls.push(
            `https://e2.cum.st/media/${sha256}/${variantName}?response-content-disposition=inline; filename="${variantName}"`,
            `https://img.cum.st/media/${sha256}/${variantName}`
          );
        } else if (obj.path) {
          const cleanPath = obj.path.startsWith('/') ? obj.path : `/${obj.path}`;
          originalUrl = obj.path.startsWith('http') ? obj.path : `https://c1.coomer.su/data${cleanPath}`;
          thumbUrl = obj.path.startsWith('http') ? obj.path : `https://img.coomer.su/thumbnail/data${cleanPath}`;
          if (!obj.path.startsWith('http')) {
            fallbackUrls.push(`https://c2.coomer.su/data${cleanPath}`, `https://coomer.su/data${cleanPath}`);
          }
        }

        if (!originalUrl) return null;

        const key = sha256 || obj.path || originalUrl;
        return {
          originalUrl,
          thumbUrl: thumbUrl || originalUrl,
          fallbackUrls,
          mediaType,
          duration,
          width: obj.width,
          height: obj.height,
          key
        };
      };

      const parseDateToMs = (val: any): number => {
        if (!val) return Date.now();
        if (typeof val === 'number') {
          return val > 1e11 ? val : val * 1000;
        }
        if (typeof val === 'string') {
          const trimmed = val.trim();
          if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            return num > 1e11 ? num : num * 1000;
          }
          const parsed = Date.parse(trimmed);
          if (!isNaN(parsed) && parsed > 0) {
            return parsed;
          }
        }
        return Date.now();
      };

      // Helper function to extract all media from a post (handling both post.file and post.attachments)
      const extractMediaFromPost = (post: any, postIdFallback?: string, postService?: string) => {
        const publishedMs = parseDateToMs(post.published || post.added || post.edited);
        const cleanCaption = extractCleanCaption(post);
        const serviceName = postService || post.service || undefined;

        const postUrls: string[] = [];
        const postThumbs: string[] = [];
        const postFallbackUrls: string[][] = [];
        const postMediaTypes: ('image' | 'video')[] = [];
        const postDurations: (number | undefined)[] = [];
        const items: any[] = [];
        const seenInPost = new Set<string>();

        const processItem = (mediaObj: any) => {
          const parsed = parseMediaFromObject(mediaObj);
          if (parsed && !seenInPost.has(parsed.key)) {
            seenInPost.add(parsed.key);
            postUrls.push(parsed.originalUrl);
            postThumbs.push(parsed.thumbUrl);
            postFallbackUrls.push(parsed.fallbackUrls);
            postMediaTypes.push(parsed.mediaType);
            postDurations.push(parsed.duration);
            items.push({
              id: mediaObj.id || Math.random().toString(36).substr(2, 9),
              postId: post.id || postIdFallback || '',
              caption: cleanCaption,
              mediaType: parsed.mediaType,
              duration: parsed.duration,
              thumbUrl: parsed.thumbUrl,
              originalUrl: parsed.originalUrl,
              fallbackUrls: parsed.fallbackUrls,
              url: parsed.originalUrl,
              date: publishedMs,
              width: parsed.width,
              height: parsed.height,
              service: serviceName
            });
          }
        };

        // 1. Primary file
        if (post.file) {
          processItem(post.file);
        }

        // 2. Attachments
        if (Array.isArray(post.attachments)) {
          for (const att of post.attachments) {
            processItem(att);
          }
        }

        const postType: 'Single' | 'Multiple' = postUrls.length > 1 ? 'Multiple' : 'Single';
        const groupedPost = postUrls.length > 0 ? {
          postId: post.id || postIdFallback || Math.random().toString(36).substr(2, 9),
          date: publishedMs,
          caption: cleanCaption,
          urls: postUrls,
          thumbUrls: postThumbs,
          fallbackUrls: postFallbackUrls,
          mediaTypes: postMediaTypes,
          videoDurations: postDurations,
          type: postType,
          service: serviceName
        } : null;

        return { items, postUrls, postThumbs, postFallbackUrls, postMediaTypes, postDurations, groupedPost, postType, caption: cleanCaption };
      };

      const detectedHost = cleanUrl.includes('cum.st') 
        ? 'https://cum.st' 
        : (cleanUrl.includes('kemono') ? 'https://kemono.su' : 'https://coomer.su');

      const apiHosts = [detectedHost, ...['https://cum.st', 'https://coomer.su', 'https://kemono.su', 'https://coomer.st'].filter(h => h !== detectedHost)];

      const fetchWithMirrors = async (path: string) => {
        for (const host of apiHosts) {
          let attempts = 0;
          const maxAttempts = 2;
          while (attempts < maxAttempts) {
            attempts++;
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 7000);
              const res = await fetch(`${host}${path}`, { headers: apiHeaders, signal: controller.signal });
              clearTimeout(timeout);
              if (res.ok) {
                return await res.json();
              }
              if (res.status === 429 && attempts < maxAttempts) {
                const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
                await new Promise(r => setTimeout(r, Math.min(2000, isNaN(retryAfter) ? 600 : retryAfter * 1000)));
              }
            } catch (e) {
              if (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 400));
              }
            }
          }
        }
        return null;
      };

      // 1. Check if this is a single post URL (e.g. /creators/{service}/{serviceId}/post/{postId} or /{service}/user/{serviceId}/post/{postId})
      const singlePostMatch = cleanUrl.match(/(?:cum\.st|coomer\.(?:st|su|party)|kemono\.(?:st|su|party))\/(?:creators\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)\/post\/([a-zA-Z0-9_\-]+)|([a-zA-Z0-9_\-]+)\/user\/([a-zA-Z0-9_\-]+)\/post\/([a-zA-Z0-9_\-]+))/i) ||
                             cleanUrl.match(/\/api\/v1\/([a-zA-Z0-9_\-]+)\/user\/([a-zA-Z0-9_\-]+)\/post\/([a-zA-Z0-9_\-]+)/i);

      if (singlePostMatch) {
        const service = (singlePostMatch[1] || singlePostMatch[4] || '').toLowerCase();
        const serviceId = singlePostMatch[2] || singlePostMatch[5];
        const postId = singlePostMatch[3] || singlePostMatch[6];

        if (service && serviceId && postId) {
          const post: any = await fetchWithMirrors(`/api/v1/${service}/user/${serviceId}/post/${postId}`);
          if (post) {
            const { items, postUrls, postThumbs, groupedPost, postType } = extractMediaFromPost(post, postId);

            return res.json({
              success: true,
              isSinglePost: true,
              service,
              serviceId,
              postId: post.id || postId,
              type: postType,
              count: items.length,
              items: items,
              images: postUrls,
              thumbImages: postThumbs,
              groupedPosts: groupedPost ? [groupedPost] : []
            });
          }
        }
      }

      // 2. Check if this is a creator page (e.g. /creators/{service}/{serviceId} or /{service}/user/{serviceId})
      const creatorMatch = cleanUrl.match(/(?:cum\.st|coomer\.(?:st|su|party)|kemono\.(?:st|su|party))\/(?:creators\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)|([a-zA-Z0-9_\-]+)\/user\/([a-zA-Z0-9_\-]+))/i) ||
                           cleanUrl.match(/\/api\/v1\/([a-zA-Z0-9_\-]+)\/user\/([a-zA-Z0-9_\-]+)\/posts/i);

      if (creatorMatch) {
        const service = (creatorMatch[1] || creatorMatch[3] || '').toLowerCase();
        const serviceId = creatorMatch[2] || creatorMatch[4];

        if (service && serviceId) {
          const pageSize = typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : 50;
          let parsedPage = 1;

          // Parse query parameter pppage, page, p, offset, o from URL
          try {
            const urlObj = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);
            const pppage = urlObj.searchParams.get('pppage') || urlObj.searchParams.get('page') || urlObj.searchParams.get('p');
            const oParam = urlObj.searchParams.get('offset') || urlObj.searchParams.get('o');
            
            if (pppage && !isNaN(parseInt(pppage, 10))) {
              parsedPage = Math.max(1, parseInt(pppage, 10));
            } else if (oParam && !isNaN(parseInt(oParam, 10))) {
              parsedPage = Math.floor(Math.max(0, parseInt(oParam, 10)) / pageSize) + 1;
            }
          } catch {
            const pppageMatch = cleanUrl.match(/[?&](?:pppage|page|p)=(\d+)/i);
            if (pppageMatch) {
              parsedPage = Math.max(1, parseInt(pppageMatch[1], 10));
            }
            const offsetMatch = cleanUrl.match(/[?&](?:offset|o)=(\d+)/i);
            if (offsetMatch) {
              parsedPage = Math.floor(Math.max(0, parseInt(offsetMatch[1], 10)) / pageSize) + 1;
            }
          }

          // Check for query parameter filtering (e.g. pptype=photos or type=photos)
          let filterType = '';
          try {
            const urlObj = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);
            const pptype = urlObj.searchParams.get('pptype') || urlObj.searchParams.get('type');
            if (pptype && (pptype.toLowerCase() === 'photos' || pptype.toLowerCase() === 'videos')) {
              filterType = pptype.toLowerCase();
            }
          } catch {
            if (/[?&](?:pptype|type)=photos/i.test(cleanUrl)) {
              filterType = 'photos';
            } else if (/[?&](?:pptype|type)=videos/i.test(cleanUrl)) {
              filterType = 'videos';
            }
          }

          let startPage = 1;
          let endPage = 1;

          const isExplicitSinglePage = typeof page === 'number' && page > 0;
          const isExplicitPageRange = typeof pageFrom === 'number' && typeof pageTo === 'number';
          const isExplicitOffset = typeof offset === 'number';
          const targetGroupedCount = typeof req.body.targetCount === 'number' && req.body.targetCount > 0 ? req.body.targetCount : null;

          // When fetchAll is true, OR when extracting a creator URL without explicit single page/offset constraint:
          const shouldFetchAll = fetchAll === true || (!isExplicitSinglePage && !isExplicitPageRange && !isExplicitOffset && parsedPage === 1 && !targetGroupedCount);

          if (shouldFetchAll) {
            startPage = 1;
            // Support fetching up to 50 pages (~2,500 posts) for creator media
            endPage = Math.min(50, typeof maxPages === 'number' ? maxPages : 50);
          } else if (isExplicitPageRange) {
            startPage = Math.max(1, pageFrom);
            endPage = Math.max(startPage, Math.min(startPage + 50, pageTo));
          } else if (isExplicitOffset) {
            // API works in steps of 50. Calculate initial 50-step offset
            startPage = Math.floor(offset / 50) + 1;
            // When targetCount (e.g. 54) is requested, allow fetching up to 6 batches until targetCount is satisfied
            const neededBatches = targetGroupedCount ? Math.max(3, Math.ceil((targetGroupedCount + (offset % 50)) / 50) + 2) : 1;
            endPage = startPage + neededBatches - 1;
          } else if (isExplicitSinglePage) {
            startPage = page;
            endPage = page;
          } else if (parsedPage > 1) {
            startPage = parsedPage;
            endPage = parsedPage;
          } else {
            startPage = 1;
            endPage = 1;
          }

          const allExtractedItems: any[] = [];
          const allGroupedPosts: any[] = [];
          let totalCount = 0;
          let pagesProcessed = 0;
          let lastBatchPostsCount = 0;

          for (let p = startPage; p <= endPage; p++) {
            const currOffset = (p - 1) * 50;

            try {
              let queryPath = `/api/v1/${service}/user/${serviceId}/posts?o=${currOffset}`;
              if (filterType) {
                queryPath += `&type=${filterType}`;
              }

              let data: any = await fetchWithMirrors(queryPath);

              // If filter returned no posts on page 1, fallback to unfiltered posts
              if ((!data || (data.posts && data.posts.length === 0 && p === 1)) && filterType) {
                queryPath = `/api/v1/${service}/user/${serviceId}/posts?o=${currOffset}`;
                data = await fetchWithMirrors(queryPath);
              }

              if (!data) break;

              const posts = Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []);
              totalCount = data.total || totalCount || posts.length;
              lastBatchPostsCount = posts.length;

              // Dynamically adjust endPage to actual total pages reported by API
              if (totalCount > 0 && shouldFetchAll) {
                const calculatedEndPage = Math.ceil(totalCount / 50);
                endPage = Math.min(endPage, calculatedEndPage);
              }

              if (posts.length === 0) {
                break;
              }

              pagesProcessed++;

              for (const post of posts) {
                const { items, groupedPost } = extractMediaFromPost(post, undefined, service);
                if (items.length > 0) {
                  allExtractedItems.push(...items);
                }
                if (groupedPost) {
                  allGroupedPosts.push(groupedPost);
                }
              }

              // If targetGroupedCount was specified and we have satisfied it:
              if (targetGroupedCount && allGroupedPosts.length >= targetGroupedCount) {
                break;
              }

              // If fewer posts than 50, reached end
              if (posts.length < 50) {
                break;
              }

              // Rate limit prevention delay for multi-page scraping
              if (p < endPage) {
                await new Promise(resolve => setTimeout(resolve, 80));
              }
            } catch (err) {
              console.error(`[Coomer Scraper] Page ${p} error:`, err);
              break;
            }
          }

          return res.json({
            success: true,
            isCreator: true,
            service,
            serviceId,
            pageStart: startPage,
            pageEnd: startPage + pagesProcessed - 1,
            pagesFetched: pagesProcessed,
            total: totalCount || allExtractedItems.length,
            count: allExtractedItems.length,
            rawCount: lastBatchPostsCount,
            hasMore: lastBatchPostsCount >= 50,
            items: allExtractedItems,
            images: allExtractedItems.map(item => item.originalUrl),
            thumbImages: allExtractedItems.map(item => item.thumbUrl),
            groupedPosts: targetGroupedCount && allGroupedPosts.length > targetGroupedCount 
              ? allGroupedPosts.slice(0, targetGroupedCount) 
              : allGroupedPosts
          });
        }
      }

      // Fallback to HTML cheerio scraping for individual post pages or other sites
      const cheerio = await import('cheerio');
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      };

      const response = await fetch(cleanUrl, { headers });
      if (!response.ok) {
        return res.status(response.status).json({ error: `HTTP ${response.status}: Failed to load page` });
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const images: string[] = [];

      // Look for media in post-files / attachments (coomer.party / coomer.su / kemono)
      $('a.fileThumb, a[href*="/data/"], a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".webp"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(href)) {
          const fullUrl = href.startsWith('http') ? href : new URL(href, cleanUrl).href;
          if (!images.includes(fullUrl)) images.push(fullUrl);
        }
      });

      // Also scan standard <img> tags
      $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original');
        if (src && !src.includes('avatar') && !src.includes('banner') && !src.includes('icon') && !src.includes('logo')) {
          if (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(src) || src.includes('coomer') || src.includes('cdn')) {
            const fullSrc = src.startsWith('http') ? src : new URL(src, cleanUrl).href;
            if (!images.includes(fullSrc)) images.push(fullSrc);
          }
        }
      });

      return res.json({ success: true, count: images.length, images, items: images.map(img => ({ url: img, originalUrl: img, thumbUrl: img, date: Date.now() })) });
    } catch (e: any) {
      console.error('[Coomer Extractor Error]:', e);
      return res.status(500).json({ error: e.message || 'Failed to extract coomer media' });
    }
  });
  app.post('/api/stashdb', express.json(), async (req, res) => {
    try {
      const { apiKey, query, variables } = req.body;
      if (!apiKey) {
        return res.status(401).json({ error: 'StashDB API key is required' });
      }

      const stashRes = await fetch('https://stashdb.org/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ApiKey': apiKey
        },
        body: JSON.stringify({ query, variables })
      });

      const data = await stashRes.json();
      res.status(stashRes.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/javstash', express.json(), async (req, res) => {
    try {
      const { apiKey, query, variables } = req.body;
      if (!apiKey) {
        return res.status(401).json({ error: 'JAVStash API key is required' });
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'ApiKey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      };

      const stashRes = await fetch('https://javstash.org/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables })
      });

      const data = await stashRes.json();
      res.status(stashRes.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==========================================
  // Smart Trailer Extractor & HLS/MP4 Streaming Proxy
  // ==========================================
  const trailerExtractCache = new Map<string, { trailerUrl: string; expiresAt: number }>();

  // Helper to extract JAV Code
  function extractJavCodeFromText(code?: string, title?: string): string | null {
    if (code && typeof code === 'string') {
      const trimmed = code.trim();
      const directMatch = trimmed.match(/^([a-zA-Z0-9]{2,6}[-_ ]\d{2,6}|fc2[-_ ]?ppv[-_ ]?\d{4,8})$/i);
      if (directMatch) return directMatch[1].replace(/\s+/g, '-').toUpperCase();
      const subMatch = trimmed.match(/([a-zA-Z]{2,6}[-_ ]\d{2,6})/i);
      if (subMatch) return subMatch[1].replace(/\s+/g, '-').toUpperCase();
      const caribbeanMatch = trimmed.match(/(\d{6}[-_ ]\d{2,4})/);
      if (caribbeanMatch) return caribbeanMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
    if (title && typeof title === 'string') {
      const fc2Match = title.match(/\b(fc2[-_ ]?ppv[-_ ]?\d{4,8})\b/i);
      if (fc2Match) return fc2Match[1].replace(/\s+/g, '-').toUpperCase();
      const titleMatch = title.match(/\b([a-zA-Z]{2,6}[-_ ]\d{2,6})\b/i);
      if (titleMatch) return titleMatch[1].replace(/\s+/g, '-').toUpperCase();
      const caribbeanMatch = title.match(/\b(\d{6}[-_ ]\d{2,4})\b/);
      if (caribbeanMatch) return caribbeanMatch[1].replace(/\s+/g, '-').toUpperCase();
    }
    return null;
  }

  // Helper to scrape HTML with browser headers and Cloudscraper fallback
  async function fetchPageHtml(targetUrl: string, timeoutMs: number = 4000): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': new URL(targetUrl).origin + '/'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const text = await res.text();
        if (text && !text.includes('Just a moment...') && !text.includes('cf-browser-verification')) {
          return text;
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }

    try {
      // @ts-ignore
      return await cloudscraper.get({
        url: targetUrl,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
        timeout: timeoutMs + 1500
      });
    } catch {
      return '';
    }
  }

  // Extract trailer from a scene page HTML (OpenGraph, Twitter, Video tags, JSON-LD, Script Regex)
  function extractTrailerFromHtml(html: string, pageUrl: string): string | null {
    if (!html || html.length < 50) return null;
    const $ = cheerio.load(html);

    // 1. OpenGraph Video meta tags
    const ogVideo = $('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]').attr('content');
    if (ogVideo && (ogVideo.includes('.mp4') || ogVideo.includes('.m3u8') || ogVideo.startsWith('http'))) {
      return ogVideo.trim();
    }

    // 2. Twitter player stream meta tags
    const twitterVideo = $('meta[name="twitter:player:stream"], meta[name="twitter:player"]').attr('content');
    if (twitterVideo && (twitterVideo.includes('.mp4') || twitterVideo.includes('.m3u8'))) {
      return twitterVideo.trim();
    }

    // 3. HTML5 Video / Source tags
    let foundVideoSrc: string | null = null;
    $('video source, video').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
        foundVideoSrc = src.trim();
        return false;
      }
    });
    if (foundVideoSrc) {
      if ((foundVideoSrc as string).startsWith('//')) return 'https:' + foundVideoSrc;
      if ((foundVideoSrc as string).startsWith('/')) return new URL(foundVideoSrc, pageUrl).href;
      return foundVideoSrc;
    }

    // 4. JSON-LD Structured Data
    let jsonLdVideo: string | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '{}');
        const traverse = (obj: any) => {
          if (!obj || typeof obj !== 'object' || jsonLdVideo) return;
          if (typeof obj.contentUrl === 'string' && (obj.contentUrl.includes('.mp4') || obj.contentUrl.includes('.m3u8'))) {
            jsonLdVideo = obj.contentUrl;
            return;
          }
          if (typeof obj.embedUrl === 'string' && (obj.embedUrl.includes('.mp4') || obj.embedUrl.includes('.m3u8'))) {
            jsonLdVideo = obj.embedUrl;
            return;
          }
          for (const k of Object.keys(obj)) {
            traverse(obj[k]);
          }
        };
        traverse(json);
      } catch {}
    });
    if (jsonLdVideo) return jsonLdVideo;

    // 5. Script Regex searching for mp4 or m3u8 trailer/preview/sample links
    const previewRegex = /["'](https?:\/\/[^"'\s\\]+?(?:trailer|preview|sample|teaser|short|scene)[^"'\s\\]*?\.(?:mp4|m3u8)[^"'\s\\]*?)["']/i;
    const regexMatch = html.match(previewRegex);
    if (regexMatch && regexMatch[1]) {
      return regexMatch[1].replace(/\\\//g, '/');
    }

    // 6. Generic mp4/m3u8 match in scripts
    const generalVideoRegex = /["'](https?:\/\/[^"'\s\\]+?\.(?:mp4|m3u8)[^"'\s\\]*?)["']/i;
    const generalMatch = html.match(generalVideoRegex);
    if (generalMatch && generalMatch[1] && !generalMatch[1].includes('analytics') && !generalMatch[1].includes('advert')) {
      return generalMatch[1].replace(/\\\//g, '/');
    }

    return null;
  }

  // Fast JAV Trailer Resolver via JavTrailers & Direct Sample CDNs
  async function resolveJavTrailer(javCode: string): Promise<string | null> {
    try {
      const clean = javCode.trim();

      // 1. Caribbeancom (e.g. 010123-001 or 010123_001)
      const caribbeanMatch = clean.match(/^(\d{6})[-_](\d{2,4})$/);
      if (caribbeanMatch) {
        const id = `${caribbeanMatch[1]}-${caribbeanMatch[2]}`;
        const url = `https://smovie.caribbeancom.com/sample/movies/${id}/480p.mp4`;
        try {
          const check = await fetch(url, { method: 'HEAD' });
          if (check.ok) return url;
        } catch {}
      }

      // 2. 1Pondo (e.g. 010123_001)
      const pondoMatch = clean.match(/^(\d{6})_(\d{2,4})$/);
      if (pondoMatch) {
        const id = `${pondoMatch[1]}_${pondoMatch[2]}`;
        const url = `https://smovie.1pondo.tv/sample/movies/${id}/480p.mp4`;
        try {
          const check = await fetch(url, { method: 'HEAD' });
          if (check.ok) return url;
        } catch {}
      }

      // 3. Heyzo (e.g. 1234 or HEYZO-1234)
      const heyzoMatch = clean.match(/(?:HEYZO[-_ ]?)?(\d{4})/i);
      if (heyzoMatch && clean.toLowerCase().includes('heyzo')) {
        const id = heyzoMatch[1];
        const url = `https://sample.heyzo.com/contents/3000/${id}/sample.mp4`;
        try {
          const check = await fetch(url, { method: 'HEAD' });
          if (check.ok) return url;
        } catch {}
      }

      // 4. Standard DMM / Studio Code (e.g. SSIS-123, IPX-456, MIDE-789)
      const stdMatch = clean.match(/^([A-Za-z]+)-?(\d+)$/);
      if (stdMatch) {
        const prefix = stdMatch[1].toLowerCase();
        const num = stdMatch[2];
        const primaryId = `${prefix}${num.padStart(5, '0')}`;
        const possibleIds = [
          primaryId,
          `${prefix}${num}`,
          `1${prefix}${num.padStart(5, '0')}`,
          `1${prefix}${num}`
        ];

        const tryId = async (vid: string): Promise<string> => {
          const targetUrl = `https://javtrailers.com/video/${vid}`;
          const html = await fetchPageHtml(targetUrl, 3000);
          if (!html) throw new Error('No HTML');

          const m3u8Match = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
          if (m3u8Match) {
            let m3u8Url = m3u8Match[0];
            if (m3u8Url.includes('cc3001.dmm.co.jp')) {
              m3u8Url = m3u8Url.replace('cc3001.dmm.co.jp', 'media.javtrailers.com');
            }
            return `/api/trailer/stream?url=${encodeURIComponent(m3u8Url)}`;
          }

          const mp4Match = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
          if (mp4Match) {
            return mp4Match[0];
          }

          throw new Error('Not found in ' + vid);
        };

        try {
          const found = await Promise.any(possibleIds.map(id => tryId(id)));
          if (found) return found;
        } catch {}
      }
    } catch {}

    return null;
  }

  // Gamma Network Resolver (PureTaboo, AdultTime, Girlsway, EvilAngel, 21Sextury, BurningAngel, etc.)
  async function resolveGammaTrailer(url: string, fallbackTitle?: string): Promise<string | null> {
    try {
      const lower = url.toLowerCase();
      const isGamma = lower.includes('puretaboo.com') ||
                      lower.includes('adulttime.com') ||
                      lower.includes('girlsway.com') ||
                      lower.includes('evilangel.com') ||
                      lower.includes('21sextury.com') ||
                      lower.includes('burningangel.com') ||
                      lower.includes('hardx.com') ||
                      lower.includes('lesbianx.com') ||
                      lower.includes('transangels.com') ||
                      lower.includes('fillyfilms.com') ||
                      lower.includes('gammacdn.com');

      if (url && !isGamma) return null;
      if (!url && !fallbackTitle) return null;

      // Extract ID or Slug
      const idMatch = url.match(/\/(\d{5,8})(?:$|\?|#|\/)/) || url.match(/video\/[^/]+\/[^/]+\/(\d+)/i);
      const sceneId = idMatch ? idMatch[1] : '';
      
      const slugMatch = url.match(/video\/(?:[^/]+\/)?([a-zA-Z0-9_-]+)(?:\/\d+)?(?:$|\?|#|\/)/i);
      const sceneSlug = slugMatch && !slugMatch[1].match(/^\d+$/) ? slugMatch[1].replace(/[-_]+/g, ' ') : '';

      const queryTerm = sceneId || sceneSlug || fallbackTitle;
      if (!queryTerm) return null;

      const appId = 'TSMKFA364Q';
      const apiKey = '5d92d1655fd1af6536ec90cd19c26a06';
      const algoliaRes = await fetch(`https://${appId}-dsn.algolia.net/1/indexes/*/queries`, {
        method: 'POST',
        headers: {
          'X-Algolia-Application-Id': appId,
          'X-Algolia-API-Key': apiKey,
          'Content-Type': 'application/json',
          'Referer': 'https://www.adulttime.com/'
        },
        body: JSON.stringify({
          requests: [
            { indexName: 'all_scenes', params: `query=${encodeURIComponent(queryTerm)}&hitsPerPage=3` }
          ]
        })
      });

      if (!algoliaRes.ok) return null;
      const data = await algoliaRes.json();
      const hits = data.results?.[0]?.hits || [];
      if (!hits.length) return null;

      let hit = hits[0];
      if (sceneId) {
        const exact = hits.find((h: any) => String(h.clip_id) === sceneId || String(h.id) === sceneId || String(h.objectID) === sceneId);
        if (exact) hit = exact;
      }

      const rawTrailer = hit.trailers?.['720p'] ||
                         hit.trailers?.['1080p'] ||
                         hit.trailers?.['540p'] ||
                         hit.trailers?.['480p'] ||
                         hit.trailers?.['240p'] ||
                         hit.trailers?.['4k'] ||
                         hit.trailer_url;

      if (rawTrailer && typeof rawTrailer === 'string') {
        return `/api/trailer/stream?url=${encodeURIComponent(rawTrailer.trim())}`;
      }
    } catch (e: any) {
      console.warn('resolveGammaTrailer error:', e.message);
    }
    return null;
  }

  // Cached Aylo token in memory
  let cachedAyloToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJtaW5kZ2VlayIsImF1ZCI6Im1pbmRnZWVrIiwic3ViIjoiaW5zdGFuY2UtYXBpIiwiZXhwIjoxNzkwMjk0NDAwLCJpZCI6MzU4MDMxLCJicmFuZCI6ImJyYXp6ZXJzIiwiaG9zdG5hbWUiOiJ3d3cuYnJhenplcnMuY29tIiwic3RvcmVJZCI6bnVsbH0.WRWYBAK4ax2TjgQ3r8tsAcs8mc8ZAbELgvBk8z7PExE';
  let ayloTokenExpires = Date.now() + 86400000;

  // Aylo / MindGeek Resolver (Brazzers, Reality Kings, Mofos, Digital Playground, etc.)
  async function resolveAyloTrailer(url: string, fallbackTitle?: string): Promise<string | null> {
    try {
      const lower = url.toLowerCase();
      const isAylo = lower.includes('brazzers.com') ||
                     lower.includes('realitykings.com') ||
                     lower.includes('mofos.com') ||
                     lower.includes('digitalplayground.com') ||
                     lower.includes('rk.com') ||
                     lower.includes('babes.com') ||
                     lower.includes('milehighmedia.com') ||
                     lower.includes('fakehub.com') ||
                     lower.includes('project1service.com') ||
                     lower.includes('project1content.com');

      if (url && !isAylo) return null;
      if (!url && !fallbackTitle) return null;

      // Extract release ID
      const releaseMatch = url.match(/\/video\/(\d+)/i) || url.match(/\/(?:releases|video|scene)\/(\d+)/i);
      const releaseId = releaseMatch ? releaseMatch[1] : '';

      // Refresh instance token if expired
      if (!cachedAyloToken || Date.now() > ayloTokenExpires) {
        try {
          const pageRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
          });
          const cookies = pageRes.headers.getSetCookie();
          for (const c of cookies) {
            const m = c.match(/instance_token=([^;]+)/);
            if (m) {
              cachedAyloToken = m[1];
              ayloTokenExpires = Date.now() + 86400000;
              break;
            }
          }
        } catch {}
      }

      if (releaseId && cachedAyloToken) {
        const apiRes = await fetch(`https://site-api.project1service.com/v2/releases/${releaseId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'instance': cachedAyloToken
          }
        });
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          const rel = apiData.result;
          let directTrailer: string | null = null;

          // 1. Check children for trailer object
          if (Array.isArray(rel?.children)) {
            const trailerChild = rel.children.find((c: any) => c.type === 'trailer');
            const files = trailerChild?.videos?.full?.files;
            if (Array.isArray(files) && files.length > 0) {
              const best = files.find((f: any) => f.format === '720p' || f.format === '1080p') || files[0];
              if (best?.urls?.view) directTrailer = best.urls.view;
            }
          }

          // 2. Check mediabook in release videos
          if (!directTrailer && rel?.videos?.mediabook?.files) {
            const files = rel.videos.mediabook.files;
            directTrailer = files['720p']?.urls?.view || files['320p']?.urls?.view || (Object.values(files)[0] as any)?.urls?.view;
          }

          // 3. Any video file in rel.videos
          if (!directTrailer && rel?.videos) {
            for (const vKey of Object.keys(rel.videos)) {
              const vObj = rel.videos[vKey];
              if (vObj?.files) {
                const fArr = Array.isArray(vObj.files) ? vObj.files : Object.values(vObj.files);
                const best = fArr.find((f: any) => f?.urls?.view);
                if (best?.urls?.view) {
                  directTrailer = best.urls.view;
                  break;
                }
              }
            }
          }

          if (directTrailer) {
            return directTrailer.startsWith('http')
              ? `/api/trailer/stream?url=${encodeURIComponent(directTrailer)}`
              : directTrailer;
          }
        }
      }

      // If query by title
      if (!releaseId && (fallbackTitle || url)) {
        const queryTerm = fallbackTitle || '';
        if (queryTerm && cachedAyloToken) {
          const searchRes = await fetch(`https://site-api.project1service.com/v2/releases?query=${encodeURIComponent(queryTerm)}&limit=1`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'instance': cachedAyloToken
            }
          });
          if (searchRes.ok) {
            const sData = await searchRes.json();
            const firstRel = sData.result?.[0];
            if (firstRel?.id) {
              return await resolveAyloTrailer(`https://www.brazzers.com/video/${firstRel.id}`, fallbackTitle);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('resolveAyloTrailer error:', e.message);
    }
    return null;
  }

  // TeamSkeet Resolver (40+ sites)
  async function resolveTeamSkeetTrailer(url: string, fallbackTitle?: string): Promise<string | null> {
    try {
      const lower = url.toLowerCase();
      const isTS = lower.includes('teamskeet.com') ||
                   lower.includes('sislovesme.com') ||
                   lower.includes('badmilfs.com') ||
                   lower.includes('stepsiblingscaught.com') ||
                   lower.includes('shoplyfter.com') ||
                   lower.includes('exxxtrasmall.com') ||
                   lower.includes('daughterswap.com') ||
                   lower.includes('familystrokes.com') ||
                   lower.includes('pervsonpatrol.com') ||
                   lower.includes('teamskeetselect.com');

      if (url && !isTS) return null;
      if (!url && !fallbackTitle) return null;

      if (url) {
        const html = await fetchPageHtml(url, 4000);
        if (html) {
          const direct = extractTrailerFromHtml(html, url);
          if (direct) return direct;
        }
      }
    } catch (e: any) {
      console.warn('resolveTeamSkeetTrailer error:', e.message);
    }
    return null;
  }

  // Eporner Resolver
  async function resolveEpornerTrailer(url: string): Promise<string | null> {
    try {
      const m = url.match(/eporner\.com\/(?:video-|embed\/)([a-zA-Z0-9]+)/i);
      if (!m) return null;
      const html = await fetchPageHtml(url, 4000);
      if (html) {
        const mp4Match = html.match(/https?:\/\/[^"'\s\\]+?\.mp4[^"'\s\\]*/i);
        if (mp4Match) return mp4Match[0];
      }
    } catch {}
    return null;
  }

  // Porntrex Resolver
  async function resolvePorntrexTrailer(url: string): Promise<string | null> {
    try {
      if (!url.toLowerCase().includes('porntrex.com')) return null;
      const html = await fetchPageHtml(url, 4000);
      if (html) {
        const direct = extractTrailerFromHtml(html, url);
        if (direct) return direct;
      }
    } catch {}
    return null;
  }

  // SexMex Resolver
  async function resolveSexMexTrailer(url: string, title?: string): Promise<string | null> {
    try {
      if (!url.toLowerCase().includes('sexmex.xxx')) return null;
      const html = await fetchPageHtml(url, 4000);
      if (html) {
        const direct = extractTrailerFromHtml(html, url);
        if (direct) return direct;
      }
    } catch {}
    return null;
  }

  // StashDB Scene Resolver (queries StashDB GraphQL API for scenes and delegates to studio/tube resolvers)
  async function resolveStashDbTrailer(url: string): Promise<string | null> {
    try {
      const match = url.match(/stashdb\.org\/scenes\/([0-9a-f-]{36})/i);
      if (!match) return null;
      const sceneId = match[1];

      const gqlQuery = `
        query GetScene($id: ID!) {
          findScene(id: $id) {
            title
            urls {
              url
              site {
                name
              }
            }
          }
        }
      `;

      const response = await fetch('https://stashdb.org/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gqlQuery, variables: { id: sceneId } })
      });

      if (!response.ok) return null;
      const data = await response.json();
      const scene = data.data?.findScene;
      if (!scene || !Array.isArray(scene.urls)) return null;

      const title = scene.title || '';
      for (const uObj of scene.urls) {
        const u = uObj.url;
        if (!u) continue;
        const gamma = await resolveGammaTrailer(u, title);
        if (gamma) return gamma;
        const aylo = await resolveAyloTrailer(u, title);
        if (aylo) return aylo;
        const ts = await resolveTeamSkeetTrailer(u, title);
        if (ts) return ts;
        const ep = await resolveEpornerTrailer(u);
        if (ep) return ep;
      }
    } catch (e: any) {
      console.warn('resolveStashDbTrailer error:', e.message);
    }
    return null;
  }

  // Main Trailer Extraction Endpoint
  app.post('/api/extract-trailer', express.json(), async (req, res) => {
    try {
      const { urls: rawUrls, code, title, studio } = req.body;
      const urlList: string[] = [];

      if (Array.isArray(rawUrls)) {
        for (const u of rawUrls) {
          if (typeof u === 'string' && u.trim().startsWith('http')) {
            urlList.push(u.trim());
          } else if (u && typeof u.url === 'string' && u.url.trim().startsWith('http')) {
            urlList.push(u.url.trim());
          }
        }
      } else if (typeof rawUrls === 'string' && rawUrls.trim().startsWith('http')) {
        urlList.push(rawUrls.trim());
      }

      const javCode = extractJavCodeFromText(code, title);
      const cacheKey = `${javCode || ''}_${(title || '').trim().toLowerCase()}_${urlList.slice(0, 3).join('|')}`;

      const cached = trailerExtractCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json({ success: true, trailerUrl: cached.trailerUrl, cached: true });
      }

      // Step 1: Direct video stream check in provided URLs
      for (const u of urlList) {
        if (u.match(/\.(mp4|m3u8|webm)(\?|$)/i)) {
          const finalUrl = u.includes('.m3u8') ? `/api/trailer/stream?url=${encodeURIComponent(u)}` : u;
          trailerExtractCache.set(cacheKey, { trailerUrl: finalUrl, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: finalUrl, source: 'direct' });
        }
      }

      // Step 2: Gamma Network (PureTaboo, AdultTime, Girlsway, EvilAngel, etc.)
      for (const u of urlList) {
        const gammaTrailer = await resolveGammaTrailer(u, title);
        if (gammaTrailer) {
          trailerExtractCache.set(cacheKey, { trailerUrl: gammaTrailer, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: gammaTrailer, source: 'gamma' });
        }
      }
      if (studio && (studio.toLowerCase().includes('pure') || studio.toLowerCase().includes('taboo') || studio.toLowerCase().includes('gamma') || studio.toLowerCase().includes('adult time'))) {
        const gammaByTitle = await resolveGammaTrailer('', title);
        if (gammaByTitle) {
          trailerExtractCache.set(cacheKey, { trailerUrl: gammaByTitle, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: gammaByTitle, source: 'gamma_title' });
        }
      }

      // Step 3: Aylo / MindGeek Network (Brazzers, Reality Kings, Mofos, etc.)
      for (const u of urlList) {
        const ayloTrailer = await resolveAyloTrailer(u, title);
        if (ayloTrailer) {
          trailerExtractCache.set(cacheKey, { trailerUrl: ayloTrailer, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: ayloTrailer, source: 'aylo' });
        }
      }
      if (studio && (studio.toLowerCase().includes('brazzers') || studio.toLowerCase().includes('reality') || studio.toLowerCase().includes('mofos'))) {
        const ayloByTitle = await resolveAyloTrailer('', title);
        if (ayloByTitle) {
          trailerExtractCache.set(cacheKey, { trailerUrl: ayloByTitle, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: ayloByTitle, source: 'aylo_title' });
        }
      }

      // Step 4: StashDB scene resolution
      for (const u of urlList) {
        const stashTrailer = await resolveStashDbTrailer(u);
        if (stashTrailer) {
          trailerExtractCache.set(cacheKey, { trailerUrl: stashTrailer, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: stashTrailer, source: 'stashdb' });
        }
      }

      // Step 5: JAV code resolution
      if (javCode) {
        const javTrailer = await resolveJavTrailer(javCode);
        if (javTrailer) {
          trailerExtractCache.set(cacheKey, { trailerUrl: javTrailer, expiresAt: Date.now() + 86400000 });
          return res.json({ success: true, trailerUrl: javTrailer, source: 'jav' });
        }
      }

      // Step 6: Specialized Network & Tube Resolvers (TeamSkeet, Eporner, Porntrex, SexMex, Pornhub, xHamster)
      for (const u of urlList) {
        try {
          const tsTrailer = await resolveTeamSkeetTrailer(u, title);
          if (tsTrailer) {
            const finalUrl = tsTrailer.includes('.m3u8') ? `/api/trailer/stream?url=${encodeURIComponent(tsTrailer)}` : tsTrailer;
            trailerExtractCache.set(cacheKey, { trailerUrl: finalUrl, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: finalUrl, source: 'teamskeet' });
          }

          const epTrailer = await resolveEpornerTrailer(u);
          if (epTrailer) {
            trailerExtractCache.set(cacheKey, { trailerUrl: epTrailer, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: epTrailer, source: 'eporner' });
          }

          const ptTrailer = await resolvePorntrexTrailer(u);
          if (ptTrailer) {
            const finalUrl = ptTrailer.includes('.m3u8') ? `/api/trailer/stream?url=${encodeURIComponent(ptTrailer)}` : ptTrailer;
            trailerExtractCache.set(cacheKey, { trailerUrl: finalUrl, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: finalUrl, source: 'porntrex' });
          }

          const smTrailer = await resolveSexMexTrailer(u, title);
          if (smTrailer) {
            const finalUrl = smTrailer.includes('.m3u8') ? `/api/trailer/stream?url=${encodeURIComponent(smTrailer)}` : smTrailer;
            trailerExtractCache.set(cacheKey, { trailerUrl: finalUrl, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: finalUrl, source: 'sexmex' });
          }

          const phMatch = u.match(/pornhub(?:premium)?\.com\/(?:view_video\.php\?viewkey=|embed\/)([a-zA-Z0-9]+)/i);
          if (phMatch) {
            const streamUrl = `/api/pornhub/stream?url=${encodeURIComponent(u)}`;
            trailerExtractCache.set(cacheKey, { trailerUrl: streamUrl, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: streamUrl, source: 'pornhub' });
          }

          const xhMatch = u.match(/xhamster(?:desi|one)?\.(?:com|desi|one)\/videos\/([a-zA-Z0-9_-]+)/i);
          if (xhMatch) {
            const streamUrl = `/api/xhamster/stream?url=${encodeURIComponent(u)}`;
            trailerExtractCache.set(cacheKey, { trailerUrl: streamUrl, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: streamUrl, source: 'xhamster' });
          }
        } catch {}
      }

      // Step 7: Public Studio & Scene Pages Deep Extraction (OpenGraph, Video tags, JSON-LD, Player config)
      // Filter out internal / generic search sites (keep official studio links)
      const validWebUrls = urlList.filter(u => {
        const lower = u.toLowerCase();
        return !lower.includes('stashdb.org') &&
               !lower.includes('javstash.org') &&
               !lower.includes('google.') &&
               !lower.includes('bing.') &&
               !lower.includes('sukebei.') &&
               !lower.includes('xxxclub.');
      });

      for (const targetUrl of validWebUrls) {
        try {
          const html = await fetchPageHtml(targetUrl, 4000);
          if (html) {
            const extracted = extractTrailerFromHtml(html, targetUrl);
            if (extracted) {
              const finalUrl = extracted.includes('.m3u8')
                ? `/api/trailer/stream?url=${encodeURIComponent(extracted)}`
                : extracted;

              trailerExtractCache.set(cacheKey, { trailerUrl: finalUrl, expiresAt: Date.now() + 86400000 });
              return res.json({ success: true, trailerUrl: finalUrl, source: 'web_page' });
            }
          }
        } catch {}
      }

      // Step 8: Universal Studio Title Fallback Search (if title is present, search major index databases)
      if (title && typeof title === 'string' && title.trim().length > 2) {
        try {
          const gammaFallback = await resolveGammaTrailer('', title.trim());
          if (gammaFallback) {
            trailerExtractCache.set(cacheKey, { trailerUrl: gammaFallback, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: gammaFallback, source: 'gamma_universal_title' });
          }

          const ayloFallback = await resolveAyloTrailer('', title.trim());
          if (ayloFallback) {
            trailerExtractCache.set(cacheKey, { trailerUrl: ayloFallback, expiresAt: Date.now() + 86400000 });
            return res.json({ success: true, trailerUrl: ayloFallback, source: 'aylo_universal_title' });
          }
        } catch {}
      }

      return res.json({ success: false, trailerUrl: null });
    } catch (e: any) {
      console.error('Trailer Extraction Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // HLS Manifest & Video Proxy with automatic relative URI rewriting and full CORS
  app.get('/api/trailer/stream', async (req, res) => {
    try {
      const rawUrl = req.query.url;
      if (!rawUrl || typeof rawUrl !== 'string') {
        return res.status(400).send('Missing url parameter');
      }

      let targetUrl = rawUrl.trim();
      if (targetUrl.includes('cc3001.dmm.co.jp')) {
        targetUrl = targetUrl.replace('cc3001.dmm.co.jp', 'media.javtrailers.com');
      }
      const origin = new URL(targetUrl).origin;

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': origin + '/',
        'Origin': origin,
      };

      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(targetUrl, { headers });
      const contentType = upstream.headers.get('content-type') || '';
      const isM3u8 = contentType.includes('mpegurl') || targetUrl.includes('.m3u8');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      if (isM3u8) {
        // Rewrite relative URLs inside the M3U8 manifest so they all pass through this proxy
        const manifestText = await upstream.text();
        const rewritten = manifestText.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          try {
            const resolved = new URL(trimmed, targetUrl).href;
            return `/api/trailer/stream?url=${encodeURIComponent(resolved)}`;
          } catch {
            return line;
          }
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(rewritten);
      }

      // Stream media files (MP4, TS chunks, etc.)
      res.status(upstream.status);
      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      const acceptRanges = upstream.headers.get('accept-ranges');

      if (contentType) res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      else res.setHeader('Accept-Ranges', 'bytes');

      if (upstream.body) {
        const nodeStream = Readable.fromWeb(upstream.body as any);
        nodeStream.on('error', () => {});
        res.on('error', () => {});
        nodeStream.pipe(res);
        req.on('close', () => {
          try { nodeStream.destroy(); } catch {}
        });
      } else {
        res.end();
      }
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).send('Streaming error: ' + e.message);
      }
    }
  });

  app.get('/api/file-size', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== 'string') {
        return res.status(400).send('Missing url parameter');
      }
      
      let fetchUrl = url.trim();
      let referer = 'https://sexmex.xxx/';
      if (fetchUrl.startsWith('/')) {
        fetchUrl = `http://127.0.0.1:3000${fetchUrl}`;
      } else {
        try {
          referer = new URL(fetchUrl).origin + '/';

        } catch (_) {}
      }

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': referer
      };

      const headRes = await fetch(fetchUrl, { method: 'HEAD', headers });
      let length = headRes.headers.get('content-length');
      
      if (!length || length === '0') {
         const getRes = await fetch(fetchUrl, { headers });
         length = getRes.headers.get('content-length');
         
         if (!length || length === '0') {
             if (getRes.body && typeof getRes.body.cancel === 'function') {
                 getRes.body.cancel();
             }
             return res.status(404).json({ error: 'Could not determine file size without full download' });
         } else if (getRes.body && typeof getRes.body.cancel === 'function') {
             getRes.body.cancel();
         }
      }
      
      if (length && length !== '0') {
         res.json({ size: parseInt(length, 10) });
      } else {
         res.status(404).json({ error: 'Could not determine file size' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/proxy-image', async (req, res) => {
    try {
      let { url, filename, download } = req.query;
      if (!url || typeof url !== 'string') {
        return res.status(400).send('Missing url parameter');
      }
      
      let targetUrl = url.trim();
      // Upgrade http to https for external URLs
      if (targetUrl.startsWith('http://') && !targetUrl.includes('localhost') && !targetUrl.includes('127.0.0.1')) {
        targetUrl = targetUrl.replace('http://', 'https://');
      }

      let parsedOrigin = '';
      try {
        parsedOrigin = new URL(targetUrl).origin;
      } catch {
        parsedOrigin = '';
      }

      let referer = parsedOrigin ? `${parsedOrigin}/` : 'https://stashdb.org/';
      if (targetUrl.includes('sexmex-cdn.com') || targetUrl.includes('sexmex.xxx') || targetUrl.includes('sexmex.com')) {
        referer = 'https://sexmex.xxx/';
      } else if (targetUrl.includes('project1content') || targetUrl.includes('mypervyfamily')) {
        referer = 'https://www.mypervyfamily.com/';
      } else if (targetUrl.includes('naughtycdn') || targetUrl.includes('naughtyamerica')) {
        referer = 'https://www.naughtyamerica.com/';
      } else if (targetUrl.includes('teamskeet')) {
        referer = 'https://www.teamskeet.com/';
      } else if (targetUrl.includes('realitykings')) {
        referer = 'https://www.realitykings.com/';
      } else if (targetUrl.includes('stashdb.org')) {
        referer = 'https://stashdb.org/';
      } else if (targetUrl.includes('javstash.org')) {
        referer = 'https://javstash.org/';
      } else if (targetUrl.includes('dmm.co.jp') || targetUrl.includes('fanza') || targetUrl.includes('r18')) {
        referer = 'https://www.dmm.co.jp/';
      } else if (targetUrl.includes('coomer.su') || targetUrl.includes('kemono.su')) {
        referer = 'https://coomer.su/';
      } else if (targetUrl.includes('eporner.com')) {
        referer = 'https://www.eporner.com/';
      }

      let imgRes: Response | null = null;
      try {
        imgRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': referer,
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        });
      } catch (err) {
        // Retry with original url if upgraded https failed
        if (targetUrl !== url) {
          imgRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': referer,
              'Accept': 'image/*,*/*'
            }
          });
        } else {
          throw err;
        }
      }

      if (!imgRes || !imgRes.ok) {
        // Fallback retry without custom Referer
        try {
          imgRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'image/*,*/*'
            }
          });
        } catch {
          // ignore
        }
      }

      if (!imgRes || !imgRes.ok) {
        return res.status(imgRes ? imgRes.status : 502).send(`Failed to fetch image from source`);
      }

      const buffer = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      
      const safeFilename = typeof filename === 'string' ? filename : 'image.jpg';
      const asciiFilename = safeFilename.replace(/[^\x00-\x7F]/g, '_');
      const encodedFilename = encodeURIComponent(safeFilename)
        .replace(/['()]/g, escape)
        .replace(/\*/g, '%2A');
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const isDownload = download === 'true' || download === '1';
      const dispositionType = isDownload ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${dispositionType}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
      
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error(`[ProxyImage] Error: ${e.message}`);
      res.status(500).send(e.message);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
