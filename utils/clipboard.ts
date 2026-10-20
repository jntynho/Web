/**
 * Unified Clipboard and Text Selection Utility
 * Handles cross-browser clipboard writes, iOS/Android mobile fallbacks,
 * non-HTTPS/iframe fallbacks, and text selection collision detection.
 */

export interface CopyOptions {
  /**
   * Whether to automatically dispatch an app notification toast.
   * Defaults to true.
   */
  showNotification?: boolean;
  /**
   * Custom message to display on success.
   */
  successMessage?: string;
  /**
   * Custom message to display on failure.
   */
  errorMessage?: string;
  /**
   * Whether to trim extraneous leading/trailing whitespace before copying.
   * Defaults to true.
   */
  trim?: boolean;
}

/**
 * Checks if the user currently has an active text selection range in the DOM.
 * Useful for preventing click handlers on clickable cards from hijacking
 * manual text selection actions on mobile and desktop.
 */
export const hasActiveTextSelection = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const selection = window.getSelection();
    return Boolean(selection && selection.toString().trim().length > 0);
  } catch {
    return false;
  }
};

/**
 * Prevents execution of card clicks if the user was highlighting/selecting text.
 * Returns true if text was selected (and thus the action was aborted).
 */
export const preventClickIfTextSelected = (e?: { stopPropagation?: () => void } | Event): boolean => {
  if (hasActiveTextSelection()) {
    if (e && 'stopPropagation' in e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    return true;
  }
  return false;
};

/**
 * Robust copy function that first attempts the modern Async Clipboard API
 * (navigator.clipboard.writeText), and transparently falls back to
 * document.execCommand('copy') with a dedicated invisible textarea
 * for older browsers, non-HTTPS contexts, or restricted iframes.
 */
export const copyTextToClipboard = async (
  text: string,
  options: CopyOptions = {}
): Promise<boolean> => {
  const {
    showNotification = true,
    successMessage = 'Copied to clipboard!',
    errorMessage = 'Failed to copy to clipboard',
    trim = true
  } = options;

  if (typeof text !== 'string') {
    if (showNotification) {
      window.dispatchEvent(
        new CustomEvent('app-notification', {
          detail: { message: errorMessage, type: 'error' }
        })
      );
    }
    return false;
  }

  const textToCopy = trim ? text.trim() : text;

  let copySucceeded = false;

  // 1. Try modern navigator.clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(textToCopy);
      copySucceeded = true;
    } catch (clipboardErr) {
      // Permission denied, iframe security policy, or non-secure origin
      console.warn('navigator.clipboard.writeText failed, attempting legacy fallback:', clipboardErr);
    }
  }

  // 2. Fallback to document.execCommand('copy') if modern API failed or unavailable
  if (!copySucceeded && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      // Prevent screen jumping and zoom on mobile Safari / Chrome
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '-9999px';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.fontSize = '16px';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.setAttribute('readonly', '');
      textarea.setAttribute('aria-hidden', 'true');

      document.body.appendChild(textarea);

      const isiOS = typeof navigator !== 'undefined' && /ipad|iphone|ipod/i.test(navigator.userAgent);
      if (isiOS) {
        const range = document.createRange();
        range.selectNodeContents(textarea);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        textarea.setSelectionRange(0, 999999);
      } else {
        textarea.focus({ preventScroll: true });
        textarea.select();
      }

      copySucceeded = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (fallbackErr) {
      console.error('Legacy document.execCommand fallback failed:', fallbackErr);
    }
  }

  // 3. User feedback
  if (showNotification) {
    if (copySucceeded) {
      window.dispatchEvent(
        new CustomEvent('app-notification', {
          detail: { message: successMessage, type: 'success' }
        })
      );
    } else {
      window.dispatchEvent(
        new CustomEvent('app-notification', {
          detail: { message: errorMessage, type: 'error' }
        })
      );
    }
  }

  return copySucceeded;
};
