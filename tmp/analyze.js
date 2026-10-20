const fs = require("fs");

console.log("=== BRAZZERS ===");
const bHtml = fs.readFileSync("/tmp/brazzers.html", "utf8");

// Search for mp4, m3u8
const bMatches = bHtml.match(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/gi) || [];
console.log("Direct mp4/m3u8:", bMatches.length, bMatches.slice(0, 5));

const bEscaped = bHtml.match(/https?:\\\/\\\/[^\s"'<>]+\.(?:mp4|m3u8)(?:[^\s"'<>]*)?/gi) || [];
console.log("Escaped mp4/m3u8:", bEscaped.length, bEscaped.slice(0, 5).map(s => s.replace(/\\\//g, "/")));

// Search for window.__INITIAL_STATE__ or similar state objects
const scripts = bHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
for (const s of scripts) {
  if (s.includes("11522571") || s.includes("mega-perv") || s.includes("trailer") || s.includes("video")) {
    if (s.length > 500 && s.length < 5000000) {
      // Find occurrences of trailer or video stream
      const tr = s.match(/"(?:trailer|video|stream|preview|previewUrl|trailerUrl|teaser)"\s*:\s*("[^"]+"|\{[^}]+\})/gi);
      if (tr) {
        console.log("Found script keys:", tr.slice(0, 5));
      }
    }
  }
}

console.log("\n=== PURETABOO ===");
const pHtml = fs.readFileSync("/tmp/puretaboo.html", "utf8");

const pMatches = pHtml.match(/https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/gi) || [];
console.log("Direct mp4/m3u8:", pMatches.length, pMatches.slice(0, 5));

const pEscaped = pHtml.match(/https?:\\\/\\\/[^\s"'<>]+\.(?:mp4|m3u8)(?:[^\s"'<>]*)?/gi) || [];
console.log("Escaped mp4/m3u8:", pEscaped.length, pEscaped.slice(0, 5).map(s => s.replace(/\\\//g, "/")));

const pScripts = pHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
for (const s of pScripts) {
  if (s.includes("289773") || s.includes("Messy-Detention") || s.includes("trailer") || s.includes("gamma")) {
    const tr = s.match(/"(?:trailer|video|stream|preview|previewUrl|trailerUrl|teaser|videoUrl|hlsUrl)"\s*:\s*("[^"]+"|\{[^}]+\})/gi);
    if (tr) {
      console.log("Found puretaboo script keys:", tr.slice(0, 5));
    }
  }
}
