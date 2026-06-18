(function () {
  var installPrompt = null;
  var installButton = null;

  function isInstalled() {
    return Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone,
    );
  }

  function hideButton() {
    if (installButton) {
      installButton.remove();
      installButton = null;
    }
  }

  function showButton() {
    if (!installPrompt || installButton || isInstalled()) return;

    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.textContent = '安装应用';
    installButton.setAttribute('aria-label', '安装到桌面');
    installButton.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'border:1px solid #bfdbfe',
      'border-radius:10px',
      'background:#2563eb',
      'color:#fff',
      'box-shadow:0 12px 30px rgba(37,99,235,.28)',
      'font:600 14px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'padding:11px 14px',
      'cursor:pointer',
    ].join(';');

    installButton.addEventListener('click', function () {
      if (!installPrompt) return;
      var promptEvent = installPrompt;
      installPrompt = null;
      hideButton();
      promptEvent.prompt();
      promptEvent.userChoice.catch(function () {});
    });

    document.body.appendChild(installButton);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    installPrompt = event;
    showButton();
  });

  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    hideButton();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showButton, { once: true });
  } else {
    showButton();
  }
})();
