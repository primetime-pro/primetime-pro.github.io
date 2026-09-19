(function captureInstallPromptEarly() {
  'use strict';

  let installPrompt = null;

  window.MinutaPwaInstall = {
    hasPrompt() {
      return Boolean(installPrompt);
    },
    currentPrompt() {
      return installPrompt;
    },
    takePrompt() {
      const prompt = installPrompt;
      installPrompt = null;
      return prompt;
    },
    clearPrompt() {
      installPrompt = null;
    }
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    window.dispatchEvent(new CustomEvent('minuta-install-ready'));
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
  });
})();
