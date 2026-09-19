(function initializeProviderColorMode() {
  'use strict';

  const modes = Object.freeze(['light', 'dark', 'system']);
  const modeThemes = Object.freeze({ light:'sage', dark:'midnight' });
  const legacyOverrideProperties = Object.freeze([
    '--theme-bg', '--theme-surface', '--theme-surface-alt', '--theme-ink', '--theme-muted', '--theme-line',
    '--theme-accent', '--theme-accent-soft', '--theme-accent-contrast', '--theme-shadow',
    '--material-card-bg', '--material-card-border', '--signature-sidebar', '--signature-stage',
    '--signature-nav-active', '--signature-card-shadow', '--atmosphere-background', '--atmosphere-panel',
    '--atmosphere-panel-strong', '--workspace-secondary'
  ]);

  function normalizeMode(value, fallback = 'light') {
    const normalizedFallback = modes.includes(fallback) ? fallback : 'light';
    return modes.includes(String(value || '')) ? String(value) : normalizedFallback;
  }

  function resolveMode(value, prefersDark = false, fallback = 'light') {
    const requested = normalizeMode(value, fallback);
    return requested === 'system' ? (prefersDark ? 'dark' : 'light') : requested;
  }

  function themeKeyForMode(value, prefersDark = false) {
    return modeThemes[resolveMode(value, prefersDark)] || modeThemes.light;
  }

  function clearOverrides(element) {
    if (!element?.style) return;
    legacyOverrideProperties.forEach(property => element.style.removeProperty(property));
  }

  function apply(element, theme, requestedMode, prefersDark = false) {
    if (!element || !theme?.palette) return null;
    const nativeMode = theme.palette.dark ? 'dark' : 'light';
    const requested = normalizeMode(requestedMode, nativeMode);
    const resolved = requested === 'system' ? resolveMode(requested, prefersDark, nativeMode) : nativeMode;
    clearOverrides(element);
    element.dataset.providerColorMode = requested;
    element.dataset.providerResolvedColorMode = resolved;
    element.dataset.providerColorVariant = 'native';
    element.style.colorScheme = resolved;
    return Object.freeze({ requested, resolved, nativeMode, derived:false, palette:theme.palette, themeColor:theme.palette.themeColor, themeKey:theme.key });
  }

  window.MinutaProviderColorMode = Object.freeze({
    modes, modeThemes, normalizeMode, resolveMode, themeKeyForMode, apply, clearOverrides
  });
})();
