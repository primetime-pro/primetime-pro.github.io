(function enableProviderFeatureAssets() {
  'use strict';

  const features = new Map();
  const pendingButtons = new WeakSet();
  const replayingButtons = new WeakSet();
  let warmScheduled = false;

  document.querySelectorAll('template[data-provider-feature]').forEach(template => {
    const name = template.dataset.providerFeature;
    if (!features.has(name)) features.set(name, { templates:[], promise:null, ready:false });
    features.get(name).templates.push(template);
  });

  function loadElement(source, template) {
    return new Promise((resolve, reject) => {
      const element = document.createElement(source.tagName.toLowerCase());
      for (const attribute of source.attributes) element.setAttribute(attribute.name, attribute.value);
      element.addEventListener('load', () => resolve(element), { once:true });
      element.addEventListener('error', () => {
        element.remove();
        reject(new Error('provider_feature_asset_unavailable'));
      }, { once:true });
      // Keep styles at their original cascade position. Template contents stay
      // inert until requested, including their scripts and stylesheet links.
      template.before(element);
    });
  }

  function ensure(name) {
    const feature = features.get(name);
    if (!feature) return Promise.reject(new Error('unknown_provider_feature'));
    if (feature.ready) return Promise.resolve();
    if (feature.promise) return feature.promise;
    feature.promise = (async () => {
      for (const template of feature.templates) {
        for (const source of [...template.content.children]) {
          if (source.dataset.providerAssetReady === 'true') continue;
          await loadElement(source, template);
          source.dataset.providerAssetReady = 'true';
        }
      }
      feature.ready = true;
    })().finally(() => { feature.promise = null; });
    return feature.promise;
  }

  function featureFor(button) {
    if (button.matches('[data-code-scan-target]')) return 'scanner';
    if (button.id === 'openFreeSlots') return 'share';
    return '';
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-code-scan-target], #openFreeSlots');
    if (!button || button.disabled || replayingButtons.has(button)) return;
    const name = featureFor(button);
    if (features.get(name)?.ready) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pendingButtons.has(button)) return;
    pendingButtons.add(button);
    const previousBusy = button.getAttribute('aria-busy');
    button.setAttribute('aria-busy', 'true');
    ensure(name).then(() => {
      if (!button.isConnected || button.disabled) return;
      replayingButtons.add(button);
      try { button.click(); } finally { replayingButtons.delete(button); }
    }).catch(() => {
      // Preserve a working retry and explain a cold offline cache miss.
      let notice = document.getElementById('providerFeatureAssetError');
      if (!notice) {
        notice = document.createElement('p');
        notice.id = 'providerFeatureAssetError';
        notice.setAttribute('role', 'status');
        button.after(notice);
      }
      notice.textContent = 'Не удалось загрузить инструмент. Проверьте подключение и нажмите ещё раз.';
    }).finally(() => {
      pendingButtons.delete(button);
      if (previousBusy === null) button.removeAttribute('aria-busy');
      else button.setAttribute('aria-busy', previousBusy);
      if (features.get(name)?.ready) document.getElementById('providerFeatureAssetError')?.remove();
    });
  }, true);

  async function warm() {
    warmScheduled = false;
    if (navigator.onLine === false || document.hidden) return;
    for (const name of features.keys()) {
      if (document.hidden || navigator.onLine === false) return;
      try { await ensure(name); } catch { /* An explicit click can retry. */ }
    }
    // A click can load a feature before the first worker claims this page.
    // The worker fills any missing optional cache entries after registration.
    if (navigator.serviceWorker) {
      void navigator.serviceWorker.ready.then(registration => {
        registration.active?.postMessage({ type:'warm-provider-features' });
      }).catch(() => {});
    }
  }

  function scheduleWarm() {
    if (warmScheduled) return;
    warmScheduled = true;
    window.setTimeout(() => {
      if (window.requestIdleCallback) window.requestIdleCallback(() => { void warm(); }, { timeout:5000 });
      else void warm();
    }, 2500);
  }

  window.MinutaProviderFeatureAssets = Object.freeze({ ensure });
  if (document.readyState === 'complete') scheduleWarm();
  else window.addEventListener('load', scheduleWarm, { once:true });
  window.addEventListener('online', scheduleWarm);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.readyState === 'complete') scheduleWarm();
  });
})();
