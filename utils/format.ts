
/**
 * Transforms a string to Title Case (e.g., "JOHN DOE" -> "John Doe").
 * Preserves spaces and applies capitalization to the first letter of each word.
 */
export const toTitleCase = (str: string): string => {
  if (!str) return '';
  
  // Lowercase any word that is entirely uppercase
  let result = str.split(/\s+/).map(word => {
    if (!/[a-z]/.test(word) && /[A-Z]/.test(word)) {
      return word.toLowerCase();
    }
    return word;
  }).join(' ');

  // Title case it
  return result.replace(/\b([a-z])/g, (m, p1) => p1.toUpperCase());
};

export const formatTitle = (str: string): string => {
  if (!str) return '';
  
  // Lowercase any word that is entirely uppercase
  let result = str.split(' ').map(word => {
    if (!/[a-z]/.test(word) && /[A-Z]/.test(word)) {
      return word.toLowerCase();
    }
    return word;
  }).join(' ');

  // Capitalize first letter of string
  result = result.replace(/(^\s*)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  
  // Split by common separators (. | -)
  let parts = result.split(/(\s*\.\s*|\s*\|\s*|\s*-\s*)/);
  // Apply normal title case to the parts after first separator
  for(let i = 2; i < parts.length; i += 2) {
     parts[i] = parts[i].replace(/\b([a-z])/g, (m, p1) => p1.toUpperCase());
  }
  return parts.join('');
};

export const formatName = (str: string): string => {
  if (!str) return '';
  
  // Lowercase any word that is entirely uppercase
  let result = str.split(/\s+/).map(word => {
    if (!/[a-z]/.test(word) && /[A-Z]/.test(word)) {
      return word.toLowerCase();
    }
    return word;
  }).join(' ');

  // Natural casing
  return result.replace(/(^\s*)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
};
