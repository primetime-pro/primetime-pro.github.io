const CACHE_PREFIX = 'primetime-pro-';
const CACHE = `${CACHE_PREFIX}v6`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './index.html',
  './offline.html',
  './offline.js',
  './manifest.webmanifest?v=6',
  './provider-icon-192.png?v=6',
  './provider-icon-512.png?v=6',
  './provider-icon-maskable-512.png?v=6',
  './provider-icon.svg?v=6',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=821',
  './utm-funnel.css?v=811',
  './onboarding.css?v=811',
  './visitor-presence.css?v=811',
  './subscription-pricing.css?v=811',
  './provider-theme-loft-modern.css?v=811',
  './provider-themes-signature.css?v=811',
  './provider-themes-calm.css?v=811',
  './provider-layout-responsive.css?v=811',
  './provider-ux.css?v=6',
  './provider-service-actions.css?v=811',
  './provider-header.css?v=811',
  './client-themes.css?v=811',
  './provider-themes-wildlife.css?v=811',
  './client-records.css?v=811',
  './client-results.css?v=811',
  './client-directory.css?v=811',
  './provider-ui-refinements.css?v=811',
  './provider-schedule-minimal.css?v=6',
  './provider-themes-distinct.css?v=821',
  './provider-theme-families.css?v=821',
  './provider-theme-backgrounds-tema1.css?v=811',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=811',
  './pwa-install.js?v=811',
  './site-update.js?v=6',
  './reliability.js?v=811',
  './phone-auth.js?v=811',
  './social-auth.js?v=811',
  './organization.js?v=811',
  './payment-management.js?v=811',
  './commerce-management.js?v=811',
  './client-fields.js?v=811',
  './client-import.js?v=811',
  './batch-bookings.js?v=811',
  './booking-policy-management.js?v=811',
  './team-calendar.js?v=811',
  './free-slots-share.js?v=811',
  './group-bookings.js?v=811',
  './booking-widgets.js?v=811',
  './onboarding.js?v=811',
  './provider-read-fetch.js?v=811',
  './data-governance.js?v=811',
  './report-reconciliation.js?v=811',
  './report-demo-live.js?v=811',
  './theme-catalog.js?v=821',
  './provider-color-mode.js?v=811',
  './client-directory.js?v=811',
  './client-results.js?v=811',
  './provider-service-actions.js?v=811',
  './provider.js?v=6',
  './provider-help-workspace.js?v=811',
  './provider-feature-assets.js?v=6',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './provider-schedule-desktop-reference.css?v=6',
  './provider-theme-noir-safari.css?v=811',
  './settings-nav-scroll.css?v=811',
  './settings-smart-search.css?v=811',
  './provider-help-workspace.css?v=811',
  './contextual-help.css?v=811',
  './settings-mobile-minimalism.css?v=811',
  './provider-integrations.css?v=811',
  './finance-center.css?v=811',
  './finance-center.js?v=811',
  './finance-center-provider.js?v=811',
  './client-records.js?v=811',
  './index.html',
  './messages-center.css?v=811',
  './messages-core.js?v=811',
  './provider-messages-center.js?v=811',
  './provider-portfolio-responsive.css?v=811',
  './service-presets-catalog.js?v=811',
  './service-presets.css?v=811',
  './service-presets.js?v=811',
  './report-worker.js?v=811',
  './benefit-lifecycle.css?v=811',
  './benefit-lifecycle.js?v=811',
  './provider-feedback-inbox.js?v=811',
  './client-messaging.js?v=811',
  './free-slots-compact.css?v=811',
  './vendor/qrcodegen.js?v=811',
  './code-scanner.css?v=811',
  './code-scanner.js?v=811',
  './portfolio-camera.js?v=811',
];
let optionalWarmup = null;

self.addEventListener('message', event => {
  if (event.data?.type !== 'warm-provider-features') return;
  if (!optionalWarmup) {
    optionalWarmup = (async () => {
      const cache = await caches.open(CACHE);
      for (const asset of OPTIONAL_ASSETS) {
        if (await cache.match(asset)) continue;
        await cache.add(asset);
      }
    })().finally(() => { optionalWarmup = null; });
  }
  event.waitUntil(optionalWarmup.catch(() => {}));
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map(asset => new Request(asset, { cache:'reload' })));
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') event.respondWith(navigationResponse(event));
  else event.respondWith(assetResponse(event.request));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedView = event.notification.data?.view;
  const view = ['bookings', 'clients', 'messages', 'notifications', 'waitlist', 'analytics', 'schedule', 'services', 'organization', 'portfolio', 'settings', 'more'].includes(requestedView) ? requestedView : 'notifications';
  const targetUrl = new URL(event.notification.data?.url || `./?view=${view}`, self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const providerWindow = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (providerWindow) {
      await providerWindow.focus();
      providerWindow.postMessage({ type:'open-provider-view', view });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});

function navigationShell(request) {
  const path = new URL(request.url).pathname;
  if (path.endsWith('/help/article.html')) return './help/article.html';
  if (path.endsWith('/help/category.html')) return './help/category.html';
  if (path.endsWith('/help/') || path.endsWith('/help/index.html')) return './help/index.html';
  if (path.endsWith('/privacy.html')) return './privacy.html';
  if (path.endsWith('/terms.html')) return './terms.html';
  return './index.html';
}

async function navigationResponse(event) {
  const request = event.request;
  const shell = navigationShell(request);
  const cached = await caches.match(shell);
  const update = fetch(request).then(async response => {
    if (response.ok) await (await caches.open(CACHE)).put(shell, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  try { return await update; }
  catch { return (await caches.match('./offline.html')) || (await caches.match('./index.html')); }
}

async function assetResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}
