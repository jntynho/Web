
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './src/index.css';

// Gracefully catch benign HTML5 video play interruptions (e.g. when component unmounts or switches stream URL)
if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.play) {
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args: any[]) {
    try {
      const playPromise = originalPlay.apply(this, args);
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err: any) => {
          if (
            err?.name === 'AbortError' ||
            err?.name === 'NotAllowedError' ||
            err?.message?.includes('interrupted by a new load request') ||
            err?.message?.includes('The play() request was interrupted')
          ) {
            // Benign lifecycle abort (source switched or element detached while loading)
            return;
          }
        });
      }
      return playPromise;
    } catch (err: any) {
      if (
        err?.name === 'AbortError' ||
        err?.name === 'NotAllowedError' ||
        err?.message?.includes('interrupted by a new load request')
      ) {
        return Promise.resolve();
      }
      throw err;
    }
  };
}

// Suppress known benign network and video interruption errors from spamming the preview UI
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason?.message || String(reason || '');
  if (
    msg === 'Failed to fetch' ||
    msg.includes('fetch') ||
    reason?.name === 'AbortError' ||
    reason?.name === 'NotAllowedError' ||
    msg.includes('interrupted by a new load request') ||
    msg.includes('The play() request was interrupted')
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
});

window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('interrupted by a new load request') ||
    msg.includes('The play() request was interrupted')
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
