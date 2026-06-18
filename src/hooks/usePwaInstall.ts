import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type PwaInstallState = {
  canInstall: boolean;
  installed: boolean;
  secureContext: boolean;
};

let installPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let initialized = false;
const listeners = new Set<() => void>();

function getInstalledState() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

function getSnapshot(): PwaInstallState {
  return {
    canInstall: Boolean(installPrompt),
    installed: installed || getInstalledState(),
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
  };
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function initPwaInstallPrompt() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  installed = getInstalledState();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    installed = false;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    notifyListeners();
  });
}

export function usePwaInstall() {
  const [state, setState] = useState<PwaInstallState>(() => getSnapshot());

  useEffect(() => {
    initPwaInstallPrompt();
    const listener = () => setState(getSnapshot());
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      installed = true;
      installPrompt = null;
      notifyListeners();
      return true;
    }
    return false;
  };

  return {
    ...state,
    install,
  };
}
