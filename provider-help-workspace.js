(() => {
  'use strict';

  const dashboard = document.querySelector('#dashboard');
  if (!dashboard || document.querySelector('#providerHelpWorkspace')) return;

  const HELP_TYPES = new Set(['index', 'article', 'category']);
  const SAFE_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const SENSITIVE_PARAM = /^(?:access|refresh|id)?_?token$|^(?:code|session|password|secret)$/i;
  const HELP_BASE_PATH = new URL('help/', window.location.href).pathname;
  const HELP_LINK_SELECTOR = '.provider-help-link, .mobile-help-shortcut, .settings-help-link';
  const workspace = document.createElement('section');
  workspace.id = 'providerHelpWorkspace';
  workspace.className = 'provider-help-workspace';
  workspace.setAttribute('role', 'dialog');
  workspace.setAttribute('aria-modal', 'true');
  workspace.setAttribute('aria-labelledby', 'providerHelpWorkspaceTitle');
  workspace.hidden = true;
  workspace.innerHTML = `
    <header class="provider-help-workspace-bar">
      <button class="provider-help-workspace-back" type="button" data-provider-help-back>
        <svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-arrow-left"></use></svg>
        <span>Назад в PrimeTime Pro</span>
      </button>
      <div class="provider-help-workspace-heading">
        <small>PrimeTime Pro</small>
        <strong id="providerHelpWorkspaceTitle">База знаний</strong>
      </div>
      <a class="provider-help-workspace-external" href="help/index.html" target="_blank" rel="noopener noreferrer">
        <span>Открыть отдельно</span>
        <svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-external"></use></svg>
      </a>
    </header>
    <div class="provider-help-workspace-stage">
      <p class="provider-help-workspace-loading" role="status">Открываем инструкцию…</p>
      <iframe title="База знаний PrimeTime Pro" loading="eager" referrerpolicy="no-referrer"></iframe>
    </div>`;
  document.body.append(workspace);

  const frame = workspace.querySelector('iframe');
  const loading = workspace.querySelector('.provider-help-workspace-loading');
  const backButton = workspace.querySelector('[data-provider-help-back]');
  const externalLink = workspace.querySelector('.provider-help-workspace-external');
  const title = workspace.querySelector('#providerHelpWorkspaceTitle');
  let activeRoute = null;
  let returnFocus = null;
  let originScrollY = 0;
  let originUrl = null;
  let frameRouteUrl = '';
  let suspendedForLogin = false;

  function routeFromProviderUrl(url = new URL(window.location.href)) {
    const type = url.searchParams.get('help');
    if (!HELP_TYPES.has(type)) return null;
    if (type === 'article') {
      const slug = url.searchParams.get('slug') || '';
      return SAFE_KEY.test(slug) ? { type, slug } : { type:'index' };
    }
    if (type === 'category') {
      const category = url.searchParams.get('category') || '';
      return SAFE_KEY.test(category) ? { type, category } : { type:'index' };
    }
    return { type:'index' };
  }

  function routeFromHelpUrl(value, base = window.location.href) {
    let url;
    try { url = new URL(value, base); } catch { return null; }
    if (url.origin !== window.location.origin) return null;
    const path = url.pathname;
    if (path === HELP_BASE_PATH || path === `${HELP_BASE_PATH}index.html`) return { type:'index' };
    if (path === `${HELP_BASE_PATH}article.html`) {
      const slug = url.searchParams.get('slug') || '';
      return SAFE_KEY.test(slug) ? { type:'article', slug } : null;
    }
    if (path === `${HELP_BASE_PATH}category.html`) {
      const category = url.searchParams.get('category') || '';
      return SAFE_KEY.test(category) ? { type:'category', category } : null;
    }
    return null;
  }

  function helpUrl(route) {
    if (route.type === 'article') return `help/article.html?slug=${encodeURIComponent(route.slug)}`;
    if (route.type === 'category') return `help/category.html?category=${encodeURIComponent(route.category)}`;
    return 'help/index.html';
  }

  function cleanProviderUrl(value = window.location.href) {
    const url = new URL(value, window.location.href);
    url.searchParams.delete('help');
    url.searchParams.delete('slug');
    url.searchParams.delete('category');
    [...url.searchParams.keys()].forEach(key => { if (SENSITIVE_PARAM.test(key)) url.searchParams.delete(key); });
    if (/(?:access|refresh|id)?_?token|code|session|password|secret/i.test(url.hash)) url.hash = '';
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function providerUrlForRoute(route) {
    const url = new URL(window.location.href);
    url.searchParams.delete('slug');
    url.searchParams.delete('category');
    [...url.searchParams.keys()].forEach(key => { if (SENSITIVE_PARAM.test(key)) url.searchParams.delete(key); });
    if (/(?:access|refresh|id)?_?token|code|session|password|secret/i.test(url.hash)) url.hash = '';
    url.searchParams.set('help', route.type);
    if (route.type === 'article') url.searchParams.set('slug', route.slug);
    if (route.type === 'category') url.searchParams.set('category', route.category);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function stateForRoute(route, depth, canGoBack) {
    return {
      ...(window.history.state || {}),
      providerHelpWorkspace:true,
      providerHelpType:route.type,
      providerHelpDepth:depth,
      providerHelpCanGoBack:canGoBack,
      providerHelpOriginUrl:originUrl,
      providerHelpOriginScroll:originScrollY
    };
  }

  function updateFrame(route, { force = false } = {}) {
    const next = helpUrl(route);
    activeRoute = route;
    title.textContent = route.type === 'article' ? 'Инструкция' : route.type === 'category' ? 'Раздел базы знаний' : 'База знаний';
    externalLink.href = next;
    if (force || frameRouteUrl !== next) {
      loading.hidden = false;
      if (frameRouteUrl && frame.contentWindow) frame.contentWindow.location.replace(next);
      else frame.src = next;
      frameRouteUrl = next;
    } else loading.hidden = true;
  }

  function openWorkspace(route, { focus = true } = {}) {
    if (dashboard.hidden) {
      suspendedForLogin = true;
      return;
    }
    suspendedForLogin = false;
    const state = window.history.state || {};
    originUrl = typeof state.providerHelpOriginUrl === 'string' ? state.providerHelpOriginUrl : cleanProviderUrl();
    originScrollY = Number.isFinite(state.providerHelpOriginScroll) ? state.providerHelpOriginScroll : window.scrollY;
    if (!state.providerHelpWorkspace) {
      window.history.replaceState(cleanHelpState(state), '', originUrl);
      window.history.pushState(stateForRoute(route, 1, true), '', providerUrlForRoute(route));
    }
    workspace.hidden = false;
    document.body.classList.add('provider-help-open');
    dashboard.setAttribute('aria-hidden', 'true');
    updateFrame(route);
    if (focus) requestAnimationFrame(() => backButton.focus({ preventScroll:true }));
  }

  function hideWorkspace({ restoreFocus = true } = {}) {
    if (workspace.hidden) return;
    workspace.hidden = true;
    document.body.classList.remove('provider-help-open');
    dashboard.removeAttribute('aria-hidden');
    activeRoute = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top:originScrollY, left:0, behavior:'auto' });
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll:true });
    });
  }

  function returnToProvider() {
    const state = window.history.state || {};
    const depth = Math.max(0, Number(state.providerHelpDepth) || 0);
    if (state.providerHelpCanGoBack && depth > 0) {
      window.history.go(-depth);
      return;
    }
    const next = typeof state.providerHelpOriginUrl === 'string' ? state.providerHelpOriginUrl : cleanProviderUrl();
    window.history.replaceState(cleanHelpState(state), '', next);
    hideWorkspace();
  }

  function cleanHelpState(value = {}) {
    const state = { ...value };
    for (const key of Object.keys(state)) if (key.startsWith('providerHelp')) delete state[key];
    return state;
  }

  function navigateHelp(route, { replace = false } = {}) {
    if (!activeRoute) {
      originUrl = cleanProviderUrl();
      originScrollY = window.scrollY;
    }
    const state = window.history.state || {};
    const currentDepth = Math.max(0, Number(state.providerHelpDepth) || 0);
    const firstEntry = !state.providerHelpWorkspace;
    const depth = firstEntry ? 1 : replace ? currentDepth : currentDepth + 1;
    const canGoBack = firstEntry ? true : state.providerHelpCanGoBack !== false;
    window.history[replace ? 'replaceState' : 'pushState'](stateForRoute(route, depth, canGoBack), '', providerUrlForRoute(route));
    openWorkspace(route);
  }

  function prepareFrame() {
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc) return;
    doc.body?.setAttribute('data-provider-embedded', 'true');
    doc.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const url = new URL(link.href, frame.contentWindow.location.href);
      const route = routeFromHelpUrl(url.href, frame.contentWindow.location.href);
      if (route) {
        event.preventDefault();
        navigateHelp(route);
        return;
      }
      if (url.origin === window.location.origin && /\/provider\.html$/.test(url.pathname)) {
        event.preventDefault();
        returnToProvider();
        return;
      }
      if (['http:', 'https:'].includes(url.protocol)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }, true);
    loading.hidden = true;
  }

  document.addEventListener('click', event => {
    const link = event.target.closest?.(HELP_LINK_SELECTOR);
    if (!link) return;
    const route = routeFromHelpUrl(link.href);
    if (!route) return;
    event.preventDefault();
    returnFocus = link;
    navigateHelp(route);
  }, true);

  frame.addEventListener('load', prepareFrame);
  backButton.addEventListener('click', returnToProvider);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !workspace.hidden) {
      event.preventDefault();
      returnToProvider();
    }
  });

  window.addEventListener('popstate', () => {
    const route = routeFromProviderUrl();
    if (route) openWorkspace(route, { focus:false });
    else hideWorkspace();
  });

  const sessionObserver = new MutationObserver(() => {
    const route = routeFromProviderUrl();
    if (dashboard.hidden) {
      if (!workspace.hidden) {
        suspendedForLogin = true;
        hideWorkspace({ restoreFocus:false });
      }
      return;
    }
    if (route && (suspendedForLogin || workspace.hidden)) openWorkspace(route, { focus:false });
  });
  sessionObserver.observe(dashboard, { attributes:true, attributeFilter:['hidden'] });

  const initialRoute = routeFromProviderUrl();
  if (initialRoute) openWorkspace(initialRoute, { focus:false });

  window.MinutaProviderHelpWorkspace = Object.freeze({
    routeFromProviderUrl,
    routeFromHelpUrl,
    handlesCurrentHistory:() => !workspace.hidden || Boolean(routeFromProviderUrl()),
    navigate:route => HELP_TYPES.has(route?.type) && navigateHelp(route),
    close:returnToProvider
  });
})();
