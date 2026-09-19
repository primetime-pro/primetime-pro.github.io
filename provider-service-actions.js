(() => {
  const PANEL_SELECTOR = '[data-provider-panel="services"]';
  const LIST_SELECTOR = `${PANEL_SELECTOR} #serviceManageList`;
  const DETAILS_SELECTOR = '.managed-service .service-more';
  const MOBILE_MAX_WIDTH = 760;
  const VIEWPORT_GAP = 12;
  const POPOVER_GAP = 8;
  let activeDetails = null;
  let layer = null;
  let sequence = 0;
  const owners = new WeakMap();

  function menuFor(details) {
    return details?.querySelector(':scope > .service-actions-menu, :scope > div')
      || [...(layer?.querySelectorAll(':scope > .service-actions-menu') || [])].find(candidate => owners.get(candidate) === details)
      || null;
  }

  function backdropFor(details) {
    return details?.querySelector(':scope > .service-actions-backdrop')
      || [...(layer?.querySelectorAll(':scope > .service-actions-backdrop') || [])].find(candidate => owners.get(candidate) === details)
      || null;
  }

  function summaryFor(details) {
    return details?.querySelector(':scope > summary') || null;
  }

  function visibleActions(details) {
    return [...(menuFor(details)?.querySelectorAll('button:not([hidden]), a:not([hidden])') || [])]
      .filter(item => item.getClientRects().length && !item.disabled);
  }

  function ensureLayer() {
    if (layer?.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'service-actions-layer';
    layer.setAttribute('aria-live', 'off');
    document.body.append(layer);
    return layer;
  }

  function ownerForNode(node) {
    return owners.get(node?.closest?.('.service-actions-menu, .service-actions-backdrop'))
      || node?.closest?.(DETAILS_SELECTOR)
      || null;
  }

  function prepareDetails(details) {
    if (!(details instanceof HTMLDetailsElement) || !details.matches(DETAILS_SELECTOR)) return null;
    const summary = summaryFor(details);
    const menu = menuFor(details);
    if (!summary || !menu) return null;
    menu.classList.add('service-actions-menu');
    if (!menu.id) {
      const serviceId = menu.querySelector('[data-delete-service]')?.dataset.deleteService || `item-${++sequence}`;
      const safeId = serviceId.replace(/[^a-zA-Z0-9_-]/g, '-');
      menu.id = `service-actions-${safeId}`;
    }
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Действия с услугой');
    summary.setAttribute('aria-haspopup', 'menu');
    summary.setAttribute('aria-controls', menu.id);
    summary.setAttribute('aria-expanded', String(details.open));
    menu.querySelector('[data-delete-service]')?.setAttribute('role', 'menuitem');
    if (!menu.querySelector('[data-close-service-actions]')) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'service-actions-cancel';
      cancel.dataset.closeServiceActions = '';
      cancel.setAttribute('role', 'menuitem');
      cancel.textContent = 'Отмена';
      menu.append(cancel);
    }
    if (!backdropFor(details)) {
      const backdrop = document.createElement('span');
      backdrop.className = 'service-actions-backdrop';
      backdrop.dataset.closeServiceActions = '';
      backdrop.setAttribute('aria-hidden', 'true');
      details.insertBefore(backdrop, menu);
    }
    owners.set(menu, details);
    owners.set(backdropFor(details), details);
    return details;
  }

  function mount(details) {
    const menu = menuFor(details);
    const backdrop = backdropFor(details);
    if (!menu || !backdrop) return;
    const host = ensureLayer();
    host.append(backdrop, menu);
    menu.classList.add('is-open');
  }

  function unmount(details) {
    const menu = [...document.querySelectorAll('.service-actions-layer > .service-actions-menu')]
      .find(candidate => owners.get(candidate) === details) || menuFor(details);
    const backdrop = [...document.querySelectorAll('.service-actions-layer > .service-actions-backdrop')]
      .find(candidate => owners.get(candidate) === details) || details.querySelector(':scope > .service-actions-backdrop');
    menu?.classList.remove('is-open');
    if (!details.isConnected) {
      backdrop?.remove();
      menu?.remove();
      return;
    }
    if (backdrop) details.append(backdrop);
    if (menu) details.append(menu);
  }

  function clearPosition(details) {
    const menu = menuFor(details);
    if (!menu) return;
    menu.style.removeProperty('--service-actions-left');
    menu.style.removeProperty('--service-actions-top');
    menu.style.removeProperty('--service-actions-width');
    menu.style.removeProperty('--service-actions-nav-offset');
    details.removeAttribute('data-service-actions-placement');
  }

  function close(details = activeDetails, { returnFocus = false } = {}) {
    if (!details) return;
    const summary = summaryFor(details);
    details.open = false;
    summary?.setAttribute('aria-expanded', 'false');
    clearPosition(details);
    unmount(details);
    if (activeDetails === details) activeDetails = null;
    if (returnFocus && summary?.isConnected) requestAnimationFrame(() => summary.focus());
  }

  function viewportBounds() {
    const visual = window.visualViewport;
    const left = visual?.offsetLeft || 0;
    const top = visual?.offsetTop || 0;
    return {
      left,
      top,
      width: visual?.width || window.innerWidth,
      height: visual?.height || window.innerHeight,
      right: left + (visual?.width || window.innerWidth),
      bottom: top + (visual?.height || window.innerHeight)
    };
  }

  function visibleBottomNavTop(bounds) {
    const nav = document.querySelector('.provider-mobile-nav, .provider-bottom-nav');
    if (!nav || getComputedStyle(nav).display === 'none') return bounds.bottom;
    const rect = nav.getBoundingClientRect();
    if (rect.height < 1 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) return bounds.bottom;
    return Math.max(bounds.top, rect.top);
  }

  function position(details = activeDetails) {
    if (!details?.open) return;
    const summary = summaryFor(details);
    const menu = menuFor(details);
    if (!summary || !menu) return;
    const bounds = viewportBounds();
    const navTop = visibleBottomNavTop(bounds);
    if (bounds.width <= MOBILE_MAX_WIDTH) {
      const navOffset = Math.max(VIEWPORT_GAP, bounds.bottom - navTop + VIEWPORT_GAP);
      menu.style.setProperty('--service-actions-nav-offset', `${navOffset}px`);
      details.dataset.serviceActionsPlacement = 'sheet';
      return;
    }
    menu.style.removeProperty('--service-actions-nav-offset');
    const summaryRect = summary.getBoundingClientRect();
    const measured = menu.getBoundingClientRect();
    const width = Math.min(Math.max(measured.width, 176), Math.max(176, bounds.width - VIEWPORT_GAP * 2));
    menu.style.setProperty('--service-actions-width', `${width}px`);
    const height = menu.getBoundingClientRect().height;
    const bottomLimit = Math.min(bounds.bottom - VIEWPORT_GAP, navTop - VIEWPORT_GAP);
    const roomBelow = bottomLimit - summaryRect.bottom - POPOVER_GAP;
    const roomAbove = summaryRect.top - bounds.top - VIEWPORT_GAP;
    const placeAbove = roomBelow < height && roomAbove >= height + POPOVER_GAP;
    const idealTop = placeAbove ? summaryRect.top - height - POPOVER_GAP : summaryRect.bottom + POPOVER_GAP;
    const maxTop = Math.max(bounds.top + VIEWPORT_GAP, bottomLimit - height);
    const top = Math.min(Math.max(idealTop, bounds.top + VIEWPORT_GAP), maxTop);
    const maxLeft = Math.max(bounds.left + VIEWPORT_GAP, bounds.right - width - VIEWPORT_GAP);
    const left = Math.min(Math.max(summaryRect.right - width, bounds.left + VIEWPORT_GAP), maxLeft);
    menu.style.setProperty('--service-actions-left', `${left}px`);
    menu.style.setProperty('--service-actions-top', `${top}px`);
    details.dataset.serviceActionsPlacement = placeAbove ? 'top' : 'bottom';
  }

  function open(details, { focus = true } = {}) {
    details = prepareDetails(details);
    if (!details) return;
    if (activeDetails && activeDetails !== details) close(activeDetails);
    activeDetails = details;
    details.open = true;
    mount(details);
    summaryFor(details)?.setAttribute('aria-expanded', 'true');
    position(details);
    if (focus) requestAnimationFrame(() => visibleActions(details)[0]?.focus());
  }

  function handleToggle(event) {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.matches(DETAILS_SELECTOR)) return;
    prepareDetails(details);
    if (!details.open) {
      summaryFor(details)?.setAttribute('aria-expanded', 'false');
      clearPosition(details);
      if (activeDetails === details) activeDetails = null;
      return;
    }
    open(details);
  }

  function handleClick(event) {
    const summary = event.target.closest(`${DETAILS_SELECTOR} > summary`);
    if (summary) {
      const details = prepareDetails(summary.parentElement);
      if (details && !details.open && activeDetails && activeDetails !== details) close(activeDetails);
      return;
    }
    const closeButton = event.target.closest('[data-close-service-actions]');
    if (closeButton) {
      event.preventDefault();
      event.stopPropagation();
      close(ownerForNode(closeButton), { returnFocus: true });
      return;
    }
    const deleteButton = event.target.closest(`${DETAILS_SELECTOR} [data-delete-service], .service-actions-layer [data-delete-service]`);
    if (deleteButton) close(ownerForNode(deleteButton), { returnFocus: true });
  }

  function handlePointerDown(event) {
    if (!activeDetails?.open) return;
    if (event.target.closest('.service-actions-backdrop')) {
      event.preventDefault();
      event.stopPropagation();
      close(activeDetails, { returnFocus: true });
      return;
    }
    const activeMenu = [...document.querySelectorAll('.service-actions-layer > .service-actions-menu')]
      .find(candidate => owners.get(candidate) === activeDetails);
    if (!activeDetails.contains(event.target) && !activeMenu?.contains(event.target)) close(activeDetails, { returnFocus: true });
  }

  function handleKeydown(event) {
    if (!activeDetails?.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(activeDetails, { returnFocus: true });
      return;
    }
    const actions = visibleActions(activeDetails);
    const activeMenu = menuFor(activeDetails) || [...document.querySelectorAll('.service-actions-layer > .service-actions-menu')]
      .find(candidate => owners.get(candidate) === activeDetails);
    if (!actions.length || (!activeDetails.contains(event.target) && !activeMenu?.contains(event.target))) return;
    let next = -1;
    const current = actions.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') next = (current + 1 + actions.length) % actions.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + actions.length) % actions.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = actions.length - 1;
    else if (event.key === 'Tab' && window.innerWidth <= MOBILE_MAX_WIDTH) {
      next = event.shiftKey ? (current - 1 + actions.length) % actions.length : (current + 1 + actions.length) % actions.length;
    }
    if (next < 0) return;
    event.preventDefault();
    actions[next].focus();
  }

  function bind() {
    const list = document.querySelector(LIST_SELECTOR);
    if (!list || list.dataset.serviceActionsBound === 'true') return false;
    list.dataset.serviceActionsBound = 'true';
    list.querySelectorAll(DETAILS_SELECTOR).forEach(prepareDetails);
    list.addEventListener('toggle', handleToggle, true);
    document.addEventListener('click', handleClick);
    const observer = new MutationObserver(() => {
      list.querySelectorAll(DETAILS_SELECTOR).forEach(prepareDetails);
      if (activeDetails && !activeDetails.isConnected) {
        unmount(activeDetails);
        activeDetails = null;
      }
    });
    observer.observe(list, { childList: true, subtree: true });
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('resize', () => position(), { passive: true });
    window.addEventListener('scroll', () => position(), { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', () => position(), { passive: true });
    window.visualViewport?.addEventListener('scroll', () => position(), { passive: true });
    return true;
  }

  window.MinutaServiceActions = { bind, close, open, position };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
