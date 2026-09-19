(() => {
  'use strict';

  const catalog = window.MinutaServicePresetCatalog;
  if (!catalog) return;

  let dialog = null;
  let state = null;
  let context = null;
  let busy = false;
  let opening = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, symbol => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[symbol]);
  const requestId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const selectedDrafts = () => [...state.drafts.values()];
  const existingByName = () => new Map((context?.existingServices || []).map(item => [catalog.normalizeName(item.name), item]));
  const existingFor = name => existingByName().get(catalog.normalizeName(name)) || null;
  const rubles = value => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
  const setCatalogTab = value => {
    document.querySelectorAll('[data-service-catalog-tab]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.serviceCatalogTab === value));
    });
  };

  function newState(professionIds = []) {
    return {
      step: 1,
      professionIds: [...new Set(professionIds.filter(id => catalog.profession(id)))],
      drafts: new Map(),
      expanded: new Set(),
      search: '',
      requestId: requestId(),
      error: ''
    };
  }

  function mount() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'servicePresetsDialog';
    dialog.className = 'service-presets-dialog';
    dialog.setAttribute('aria-labelledby', 'servicePresetsTitle');
    dialog.addEventListener('click', handleClick);
    dialog.addEventListener('input', handleInput);
    dialog.addEventListener('change', handleInput);
    dialog.addEventListener('cancel', event => {
      if (busy) event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      setCatalogTab('services');
      context?.onClose?.();
    });
    document.body.append(dialog);
  }

  function professionStep() {
    return `
      <div class="service-presets-heading">
        <small>Быстрый старт</small>
        <h2 id="servicePresetsTitle">Чем вы занимаетесь?</h2>
        <p>Можно выбрать несколько направлений. Ничего не добавится без вашего подтверждения.</p>
      </div>
      <fieldset class="service-profession-grid">
        <legend class="sr-only">Направления работы</legend>
        ${catalog.professions.map(item => {
          const selected = state.professionIds.includes(item.id);
          return `<label class="service-profession-chip${selected ? ' is-selected' : ''}"><input type="checkbox" value="${item.id}" data-service-profession ${selected ? 'checked' : ''}><span>${escapeHtml(item.label)}</span><i aria-hidden="true">✓</i></label>`;
        }).join('')}
      </fieldset>`;
  }

  function presetButton(item) {
    const existing = existingFor(item.name);
    const selected = state.drafts.has(item.id);
    const status = existing ? 'Уже добавлено' : selected ? 'Выбрано' : `${item.defaultDuration} мин`;
    return `<button class="service-preset-option${selected ? ' is-selected' : ''}${existing ? ' is-existing' : ''}" type="button" data-service-preset="${item.id}" aria-pressed="${selected}" ${existing ? `data-existing-service="${escapeHtml(existing.id)}"` : ''}>
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)}</small></span><b>${status}</b>
    </button>`;
  }

  function presetGroups() {
    const search = state.search.trim();
    if (search) {
      const results = catalog.search(search, state.professionIds);
      return `<section class="service-preset-group"><div class="service-preset-group-head"><h3>Результаты</h3><span>${results.length}</span></div><div class="service-preset-options">${results.length ? results.map(presetButton).join('') : '<p class="service-presets-empty">Ничего не найдено. Добавьте свою услугу.</p>'}</div></section>`;
    }
    return state.professionIds.map(id => {
      const profession = catalog.profession(id);
      const expanded = state.expanded.has(id);
      const visible = expanded ? profession.services : profession.services.slice(0, 6);
      return `<section class="service-preset-group"><div class="service-preset-group-head"><h3>${escapeHtml(profession.label)}</h3><span>${profession.services.length}</span></div><div class="service-preset-options">${visible.map(presetButton).join('')}</div>${profession.services.length > 6 ? `<button class="service-presets-more" type="button" data-service-presets-more="${id}" aria-expanded="${expanded}">${expanded ? 'Скрыть дополнительные' : `Показать ещё · ${profession.services.length - 6}`}</button>` : ''}</section>`;
    }).join('');
  }

  function draftCard(item) {
    const existing = existingFor(item.name);
    return `<article class="service-preset-draft" data-service-draft="${escapeHtml(item.itemId)}">
      <div class="service-preset-draft-head"><strong>${item.presetId ? 'Черновик услуги' : 'Своя услуга'}</strong><button type="button" data-remove-service-draft="${escapeHtml(item.itemId)}" aria-label="Убрать услугу">Убрать</button></div>
      <label><span>Название</span><input maxlength="120" value="${escapeHtml(item.name)}" data-draft-name required></label>
      <div><label><span>Длительность</span><select data-draft-duration>${[20,30,45,60,75,90,120,150,180].map(value => `<option value="${value}" ${value === Number(item.duration) ? 'selected' : ''}>${value} мин</option>`).join('')}</select></label><label><span>Цена, ₽</span><input type="number" inputmode="numeric" min="0" max="1000000" step="1" placeholder="Введите свою" value="${escapeHtml(item.price)}" data-draft-price required></label></div>
      ${existing ? `<p class="service-preset-duplicate">Услуга с таким названием уже добавлена.</p>` : ''}
    </article>`;
  }

  function serviceStep() {
    const drafts = selectedDrafts();
    return `
      <div class="service-presets-heading compact">
        <small>Выберите нужное</small>
        <h2 id="servicePresetsTitle">Типичные услуги</h2>
        <p>Одно нажатие добавляет черновик. Название и длительность можно изменить, цену укажите свою.</p>
      </div>
      <label class="service-presets-search"><span class="sr-only">Поиск услуг</span><input type="search" value="${escapeHtml(state.search)}" placeholder="Найти услугу" data-service-presets-search></label>
      <div class="service-preset-groups">${presetGroups()}</div>
      <button class="service-presets-own" type="button" data-add-custom-service>+ Своя услуга</button>
      <section class="service-preset-drafts" aria-live="polite"><div class="service-preset-drafts-title"><h3>Выбрано</h3><span>${drafts.length}</span></div>${drafts.length ? drafts.map(draftCard).join('') : '<p class="service-presets-empty">Выберите одну или несколько услуг выше.</p>'}</section>`;
  }

  function reviewStep() {
    const drafts = selectedDrafts();
    return `
      <div class="service-presets-heading compact">
        <small>Проверка</small>
        <h2 id="servicePresetsTitle">Добавить ${drafts.length} ${drafts.length === 1 ? 'услугу' : drafts.length < 5 ? 'услуги' : 'услуг'}?</h2>
        <p>Они появятся у клиентов только после нажатия кнопки. Существующие услуги не изменятся.</p>
      </div>
      <div class="service-preset-review">${drafts.map(item => `<article><div><strong>${escapeHtml(item.name)}</strong><small>${item.duration} мин</small></div><b>${rubles(item.price)}</b></article>`).join('')}</div>`;
  }

  function validationMessage() {
    const drafts = selectedDrafts();
    if (!drafts.length) return 'Выберите хотя бы одну услугу или добавьте свою.';
    const names = drafts.map(item => catalog.normalizeName(item.name));
    if (names.some(name => name.length < 2)) return 'Укажите название каждой услуги.';
    if (new Set(names).size !== names.length) return 'Названия выбранных услуг должны различаться.';
    if (drafts.some(item => existingFor(item.name))) return 'Одна из услуг уже добавлена. Уберите её или измените название.';
    if (drafts.some(item => !Number.isInteger(Number(item.duration)) || Number(item.duration) < 5 || Number(item.duration) > 480)) return 'Длительность должна быть от 5 до 480 минут.';
    if (drafts.some(item => item.price === '' || !Number.isInteger(Number(item.price)) || Number(item.price) < 0 || Number(item.price) > 1000000)) return 'Укажите свою цену в целых рублях для каждой услуги.';
    return '';
  }

  function shell() {
    const first = state.step === 1;
    const last = state.step === 3;
    const nextLabel = last ? 'Добавить услуги' : 'Продолжить';
    dialog.innerHTML = `<div class="service-presets-shell">
      <header class="service-presets-top"><button type="button" data-service-presets-back ${first ? 'hidden' : ''} aria-label="Назад">←</button><span>Шаг ${state.step} из 3</span><button type="button" data-close-service-presets aria-label="Закрыть">×</button></header>
      <main>${first ? professionStep() : state.step === 2 ? serviceStep() : reviewStep()}</main>
      <footer>${state.error ? `<p role="alert" tabindex="-1">${escapeHtml(state.error)}</p>` : '<span></span>'}<button class="primary" type="button" data-service-presets-next ${busy ? 'disabled' : ''}>${busy ? 'Добавляем…' : nextLabel}</button></footer>
    </div>`;
  }

  function render(focusSelector = '') {
    if (!dialog || !state) return;
    shell();
    if (focusSelector) requestAnimationFrame(() => dialog.querySelector(focusSelector)?.focus());
  }

  function togglePreset(id) {
    const preset = catalog.preset(id);
    if (!preset) return;
    const existing = existingFor(preset.name);
    if (existing) {
      dialog.close();
      context?.onExisting?.(existing);
      return;
    }
    if (state.drafts.has(id)) state.drafts.delete(id);
    else state.drafts.set(id, { itemId:id, presetId:id, professionId:preset.professionId, name:preset.name, duration:preset.defaultDuration, price:'' });
  }

  function customDraft() {
    const itemId = `custom-${requestId()}`;
    state.drafts.set(itemId, { itemId, presetId:null, professionId:null, name:'', duration:60, price:'' });
    return itemId;
  }

  async function save() {
    const error = validationMessage();
    if (error) { state.error = error; state.step = 2; render('[data-draft-price]'); return; }
    if (!navigator.onLine) { state.error = 'Нет соединения. Черновик сохранён в этом окне — повторите после подключения.'; render(); return; }
    busy = true;
    state.error = '';
    render();
    const payload = selectedDrafts().map(item => ({
      item_id:item.itemId,
      preset_id:item.presetId,
      name:item.name.trim().replace(/\s+/g, ' '),
      duration_minutes:Number(item.duration),
      price_rub:Number(item.price)
    }));
    try {
      const result = await context.db.rpc('create_provider_services_from_presets_v160', {
        p_request:state.requestId,
        p_catalog_version:catalog.version,
        p_professions:state.professionIds,
        p_services:payload
      });
      if (result.error) throw result.error;
      try {
        await context.onSaved?.(result.data);
      } catch {
        busy = false;
        state.error = 'Услуги сохранены, но список не обновился. Закройте окно и обновите страницу.';
        render('[role="alert"]');
        return;
      }
      busy = false;
      dialog.close();
    } catch (error) {
      busy = false;
      const message = String(error?.message || error || '');
      state.error = /service_preset_request_conflict/.test(message)
        ? 'Черновик изменился после прошлой попытки. Закройте окно и откройте его снова.'
        : /duplicate_service_name/.test(message)
          ? 'Одна из услуг уже добавлена. Обновите список и проверьте названия.'
          : /invalid_service_preset|invalid_profession/.test(message)
            ? 'Каталог обновился. Закройте окно, обновите страницу и выберите услуги снова.'
            : /42501|permission|auth/i.test(message)
              ? 'Недостаточно прав. Войдите в кабинет заново.'
              : 'Не удалось добавить услуги. Данные не изменены — можно безопасно повторить.';
      render('[role="alert"]');
    }
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.matches('[data-close-service-presets]')) { dialog.close(); return; }
    if (button.matches('[data-service-presets-back]')) { state.step = Math.max(1, state.step - 1); state.error = ''; render(); return; }
    if (button.matches('[data-service-preset]')) { togglePreset(button.dataset.servicePreset); state.error = ''; render(`[data-service-preset="${button.dataset.servicePreset}"]`); return; }
    if (button.matches('[data-service-presets-more]')) {
      const id = button.dataset.servicePresetsMore;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      render(`[data-service-presets-more="${id}"]`);
      return;
    }
    if (button.matches('[data-add-custom-service]')) { const id = customDraft(); render(`[data-service-draft="${id}"] input`); return; }
    if (button.matches('[data-remove-service-draft]')) { state.drafts.delete(button.dataset.removeServiceDraft); state.error = ''; render('[data-add-custom-service]'); return; }
    if (button.matches('[data-service-presets-next]')) {
      if (state.step === 1) {
        if (!state.professionIds.length) { state.error = 'Выберите хотя бы одно направление.'; render(); return; }
        state.step = 2; state.error = ''; render('[data-service-presets-search]'); return;
      }
      if (state.step === 2) {
        const error = validationMessage();
        if (error) { state.error = error; render(); return; }
        state.step = 3; state.error = ''; render('[data-service-presets-next]'); return;
      }
      void save();
    }
  }

  function handleInput(event) {
    if (!state || busy) return;
    const target = event.target;
    if (target.matches('[data-service-profession]')) {
      state.professionIds = [...dialog.querySelectorAll('[data-service-profession]:checked')].map(input => input.value);
      for (const [id, draft] of state.drafts) {
        if (draft.professionId && !state.professionIds.includes(draft.professionId)) state.drafts.delete(id);
      }
      for (const id of state.expanded) {
        if (!state.professionIds.includes(id)) state.expanded.delete(id);
      }
      state.error = '';
      target.closest('label')?.classList.toggle('is-selected', target.checked);
      return;
    }
    if (target.matches('[data-service-presets-search]')) {
      state.search = target.value;
      const selection = [target.selectionStart, target.selectionEnd];
      render('[data-service-presets-search]');
      const input = dialog.querySelector('[data-service-presets-search]');
      input?.setSelectionRange(...selection);
      return;
    }
    const card = target.closest('[data-service-draft]');
    const draft = card ? state.drafts.get(card.dataset.serviceDraft) : null;
    if (!draft) return;
    if (target.matches('[data-draft-name]')) draft.name = target.value;
    if (target.matches('[data-draft-duration]')) draft.duration = Number(target.value);
    if (target.matches('[data-draft-price]')) draft.price = target.value;
    state.error = '';
    card.querySelector('.service-preset-duplicate')?.remove();
    if (target.matches('[data-draft-name]') && existingFor(target.value)) {
      card.insertAdjacentHTML('beforeend', '<p class="service-preset-duplicate">Услуга с таким названием уже добавлена.</p>');
    }
  }

  function open(options = {}) {
    mount();
    context = options;
    state = newState(options.professionIds || []);
    busy = false;
    setCatalogTab('presets');
    render();
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector('[data-service-profession]')?.focus());
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-open-service-presets]');
    if (!button || opening) return;
    if (typeof currentUser === 'undefined' || !currentUser?.id || typeof db === 'undefined') return;
    const user = currentUser;
    opening = true;
    button.disabled = true;
    let professionIds = Array.isArray(currentUser.user_metadata?.minuta_profession_ids) ? currentUser.user_metadata.minuta_profession_ids : [];
    try {
      const { data, error } = await db.rpc('get_provider_service_preset_state_v160');
      if (!error && data?.catalog_version && Array.isArray(data?.profession_ids)) professionIds = data.profession_ids;
    } catch {}
    opening = false;
    button.disabled = false;
    if (typeof currentUser === 'undefined' || currentUser?.id !== user.id) return;
    open({
      db,
      user,
      existingServices:typeof ownServices === 'undefined' ? [] : ownServices,
      professionIds,
      onSaved:async result => {
        if (typeof refreshAfterWrite === 'function') await refreshAfterWrite();
        if (typeof notify === 'function') notify(result?.created_count ? `Добавлено услуг: ${result.created_count}` : 'Услуги уже были добавлены');
      },
      onExisting:item => {
        if (typeof openServiceEditor === 'function' && item?.id) openServiceEditor(item.id);
      }
    });
  });

  window.MinutaServicePresets = Object.freeze({ open, validationMessage, catalog });
})();
