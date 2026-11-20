'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const PwaContext = createContext<{
  installed: boolean;
  canPrompt: boolean;
  install: () => Promise<void>;
}>({ installed: false, canPrompt: false, install: async () => {} });

export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const updateDisplay = () => setInstalled(display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    updateDisplay();
    display.addEventListener('change', updateDisplay);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      display.removeEventListener('change', updateDisplay);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((error: unknown) => console.error('[DRM] No se pudo registrar la app instalable:', error));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  const install = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } finally {
      // A prompt can only be used once, including after dismissal or failure.
      setPrompt(null);
    }
  };
  return <PwaContext.Provider value={{ installed, canPrompt: !!prompt, install }}>{children}</PwaContext.Provider>;
}

export function usePwa() { return useContext(PwaContext); }
