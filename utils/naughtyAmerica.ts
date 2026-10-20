import { AspectRatio } from "../types";

export const NAUGHTY_AMERICA_STUDIOS_AND_SERIES = [
  'naughty america',
  'naughtyamerica',
  'neighbor affair',
  'neighboraffair',
  'my first sex teacher',
  'myfirstsexteacher',
  'housewife 1on1',
  'housewife 1 on 1',
  'housewives 1on1',
  'housewives 1 on 1',
  "tonight's girlfriend",
  'tonights girlfriend',
  'tonightsgirlfriend',
  'naughty bookworms',
  'naughty athletics',
  'naughty weddings',
  'naughty rich girls',
  'naughty office',
  'naughty country girls',
  'naughty country club',
  'naughty college',
  'naughty gym',
  'naughty flip phone',
  'diary of a naughty nanny',
  'diary of a nanny',
  '2 chicks same time',
  'two chicks same time',
  'american daydreams',
  "my wife's hot friend",
  'my wifes hot friend',
  "my friend's hot mom",
  'my friends hot mom',
  "my sister's hot friend",
  'my sisters hot friend',
  "my daughter's hot friend",
  'my daughters hot friend',
  "my girl's hot friend",
  'my girls hot friend',
  "my husband's hot friend",
  'my husbands hot friend',
  'wives run wild',
  'i have a wife',
  'dirty wives club',
  'seduced by a cougar',
  'seduced by a couple',
  'single moms',
  'single mom',
  'latin adultery',
  'fast times at deep crack',
  'milf monster',
  'the vidas',
  'pornstar wife',
  'porn star wife',
  'porn star experience',
  'pornstar experience',
  'pse',
  'thundercock',
  'funsized',
  'bossy bar wench',
  'glory house',
  'yes chef',
  'yes, chef',
  'bad ass badges',
  'family strokes',
  'naughty cdn',
  'naughtycdn'
];

/**
 * Checks whether the given string or studio names match Naughty America or any of its sub-studios/series.
 */
export function isNaughtyAmericaStudioOrSeries(
  ...candidates: Array<string | undefined | null>
): boolean {
  for (const text of candidates) {
    if (!text) continue;
    const lower = text.toLowerCase().trim();
    if (!lower) continue;
    
    if (lower.includes('naughty')) return true;
    if (lower.includes('tonight') && lower.includes('girlfriend')) return true;
    
    for (const pattern of NAUGHTY_AMERICA_STUDIOS_AND_SERIES) {
      if (lower === pattern || lower.includes(pattern)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Measures the image dimensions at a given URL and determines whether it is 16:9 (Standard) or 3:2 (DVD).
 * If ratio >= 1.5, returns "16:9", otherwise "3:2".
 */
export function detectCoverAspectRatio(url?: string): Promise<AspectRatio> {
  return new Promise((resolve) => {
    if (!url) return resolve("3:2");
    
    const img = new Image();
    // Allow cross-origin probing
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    
    let resolved = false;
    const finish = (result: AspectRatio) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => finish("3:2"), 3000);

    img.onload = () => {
      clearTimeout(timer);
      if (img.naturalWidth && img.naturalHeight) {
        const ratio = img.naturalWidth / img.naturalHeight;
        // 16:9 is ~1.778, 3:2 is 1.5. A threshold of 1.55+ accurately distinguishes 16:9 landscape from 3:2 or poster covers.
        if (ratio >= 1.55) {
          finish("16:9");
        } else {
          finish("3:2");
        }
      } else {
        finish("3:2");
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      finish("3:2");
    };

    img.src = url;
  });
}
