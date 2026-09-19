(() => {
  'use strict';

  const VERSION = 2;
  const catalog = window.MinutaServicePresetCatalog;
  const DAY_LABELS = [['1', 'Пн'], ['2', 'Вт'], ['3', 'Ср'], ['4', 'Чт'], ['5', 'Пт'], ['6', 'Сб'], ['7', 'Вс']];

  let context = null;
  let root = null;
  let step = 1;
  let state = null;
  let busy = false;
  let generation = 0;

  const escapeHtml = value => `${value ?? ''}`.replace(/[&<>'"]/g, symbol => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[symbol]);
  const draftKey = userId => `minuta-onboarding-v${VERSION}:${userId}`;
  const newRequestId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const defaultState = () => ({
    version:VERSION,
    requestId:newRequestId(),
    format:'solo',
    professionIds:[],
    services:[],
    expanded:[],
    search:'',
    days:['1', '2', '3', '4', '5'],
    start:'10:00',
    end:'19:00'
  });

  function sanitizeDraft(saved) {
    const fallback = defaultState();
    if (!saved || saved.version !== VERSION || !saved.data) return fallback;
    const draft = { ...fallback, ...saved.data };
    draft.requestId = /^[0-9a-f-]{36}$/i.test(draft.requestId || '') ? draft.requestId : newRequestId();
    draft.professionIds = [...new Set((Array.isArray(draft.professionIds) ? draft.professionIds : []).filter(id => catalog?.profession(id)))];
    draft.services = (Array.isArray(draft.services) ? draft.services : []).filter(item => item && typeof item === 'object').map(item => ({
      itemId:String(item.itemId || `custom-${newRequestId()}`),
      presetId:item.presetId && catalog?.preset(item.presetId) ? String(item.presetId) : null,
      professionId:item.presetId && catalog?.preset(item.presetId) ? catalog.preset(item.presetId).professionId : null,
      name:String(item.name || '').slice(0, 120),
      duration:Math.max(5, Math.min(480, Math.round(Number(item.duration) || 60))),
      price:item.price === '' || !Number.isInteger(Number(item.price)) || Number(item.price) < 0 || Number(item.price) > 1000000 ? '' : String(Number(item.price))
    }));
    draft.expanded = (Array.isArray(draft.expanded) ? draft.expanded : []).filter(id => draft.professionIds.includes(id));
    draft.days = [...new Set((Array.isArray(draft.days) ? draft.days : fallback.days).map(day => String(day) === '0' ? '7' : String(day)).filter(day => /^[1-7]$/.test(day)))];
    return draft;
  }

  function readDraft(userId) {
    try { return sanitizeDraft(JSON.parse(localStorage.getItem(draftKey(userId)) || 'null')); }
    catch { return defaultState(); }
  }

  function saveDraft() {
    if (!context?.user?.id || !state) return;
    try { localStorage.setItem(draftKey(context.user.id), JSON.stringify({ version:VERSION, data:state })); } catch {}
  }

  function mount() {
    if (root) return;
    root = document.createElement('dialog');
    root.id = 'providerOnboarding';
    root.className = 'provider-onboarding';
    root.setAttribute('aria-labelledby', 'providerOnboardingTitle');
    root.addEventListener('cancel', event => event.preventDefault());
    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleInput);
    document.body.append(root);
  }

  function progress() {
    return `<div class="onboarding-progress" aria-label="Шаг ${step} из 4"><i style="--progress:${step * 25}%"></i></div>`;
  }

  function shell(content, options = {}) {
    const back = step > 1 ? '<button class="onboarding-icon-button" type="button" data-onboarding-back aria-label="Назад">←</button>' : '<span></span>';
    const nextLabel = options.nextLabel || 'Продолжить';
    root.innerHTML = `
      <div class="onboarding-shell">
        <header class="onboarding-topbar">${back}<span>Первичная настройка</span><button class="onboarding-later" type="button" data-onboarding-later>Настроить позже</button></header>
        ${progress()}
        <main class="onboarding-content">${content}</main>
        <footer class="onboarding-footer"><span>Шаг ${step} из 4</span><button class="onboarding-primary" type="button" data-onboarding-next ${busy ? 'disabled' : ''}>${busy ? 'Сохраняем…' : nextLabel}</button></footer>
      </div>`;
  }

  function renderStepOne() {
    const formats = [
      ['solo', 'Работаю один', 'Только ваше расписание и клиенты'],
      ['team', 'Работаем командой', 'Сотрудников и роли можно настроить позже']
    ];
    shell(`
      <section class="onboarding-hero"><small>Начнём с главного</small><h1 id="providerOnboardingTitle">Чем вы занимаетесь?</h1><p>Выберите одно или несколько направлений. Это только быстрый подбор — список можно изменить.</p></section>
      <fieldset class="onboarding-fieldset"><legend>Формат работы</legend><div class="onboarding-choice-grid">${formats.map(([value, title, caption]) => `<label class="onboarding-choice ${state.format === value ? 'is-selected' : ''}"><input type="radio" name="onboardingFormat" value="${value}" ${state.format === value ? 'checked' : ''}><span><strong>${title}</strong><small>${caption}</small></span><b aria-hidden="true">✓</b></label>`).join('')}</div></fieldset>
      <fieldset class="onboarding-fieldset"><legend>Направления</legend><div class="onboarding-chips">${catalog.professions.map(item => `<label class="${state.professionIds.includes(item.id) ? 'is-selected' : ''}"><input type="checkbox" data-onboarding-profession value="${item.id}" ${state.professionIds.includes(item.id) ? 'checked' : ''}><span>${escapeHtml(item.label)}</span></label>`).join('')}</div></fieldset>`);
  }

  function presetSelected(id) { return state.services.some(item => item.presetId === id); }

  function presetMarkup(item) {
    const selected = presetSelected(item.id);
    return `<button class="onboarding-preset${selected ? ' is-selected' : ''}" type="button" data-onboarding-preset="${item.id}" aria-pressed="${selected}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)}</small></span><b>${selected ? 'Выбрано' : `${item.defaultDuration} мин`}</b></button>`;
  }

  function presetGroups() {
    const search = state.search.trim();
    if (search) {
      const services = catalog.search(search, state.professionIds);
      return `<section class="onboarding-preset-group"><div><h2>Результаты</h2><span>${services.length}</span></div><div class="onboarding-preset-grid">${services.length ? services.map(presetMarkup).join('') : '<p class="onboarding-empty">Ничего не найдено. Добавьте свою услугу.</p>'}</div></section>`;
    }
    return state.professionIds.map(id => {
      const profession = catalog.profession(id);
      const expanded = state.expanded.includes(id);
      const services = expanded ? profession.services : profession.services.slice(0, 6);
      return `<section class="onboarding-preset-group"><div><h2>${escapeHtml(profession.label)}</h2><span>${profession.services.length}</span></div><div class="onboarding-preset-grid">${services.map(presetMarkup).join('')}</div>${profession.services.length > 6 ? `<button class="onboarding-text-button" type="button" data-onboarding-show-more="${id}" aria-expanded="${expanded}">${expanded ? 'Скрыть дополнительные' : `Показать ещё · ${profession.services.length - 6}`}</button>` : ''}</section>`;
    }).join('');
  }

  function serviceDraftMarkup(item) {
    return `<article class="onboarding-service" data-onboarding-service="${escapeHtml(item.itemId)}"><div class="onboarding-service-head"><strong>${item.presetId ? 'Черновик услуги' : 'Своя услуга'}</strong><button type="button" data-onboarding-remove-service="${escapeHtml(item.itemId)}">Убрать</button></div><label><span>Название</span><input type="text" maxlength="120" value="${escapeHtml(item.name)}" data-service-name></label><div><label><span>Минут</span><input type="number" min="5" max="480" step="5" value="${item.duration}" data-service-duration></label><label><span>Цена, ₽</span><input type="number" inputmode="numeric" min="0" max="1000000" step="1" placeholder="Введите свою" value="${escapeHtml(item.price)}" data-service-price></label></div></article>`;
  }

  function renderStepTwo() {
    shell(`
      <section class="onboarding-hero onboarding-hero-compact"><small>Ваше предложение</small><h1 id="providerOnboardingTitle">Выберите типичные услуги</h1><p>Нажмите на нужные. Название и длительность уже заполнены, цену задаёте только вы.</p></section>
      <label class="onboarding-search"><span class="sr-only">Поиск услуг</span><input type="search" placeholder="Найти услугу" value="${escapeHtml(state.search)}" data-onboarding-search></label>
      <div class="onboarding-preset-groups">${presetGroups()}</div>
      <button class="onboarding-text-button onboarding-own-service" type="button" data-onboarding-add-service>+ Своя услуга</button>
      <section class="onboarding-selected-services" aria-live="polite"><div><h2>Выбрано</h2><span>${state.services.length}</span></div>${state.services.length ? `<div class="onboarding-service-list">${state.services.map(serviceDraftMarkup).join('')}</div>` : '<p class="onboarding-empty">Можно пропустить и добавить услуги позже.</p>'}</section>`);
  }

  function renderStepThree() {
    shell(`
      <section class="onboarding-hero"><small>Рабочее время</small><h1 id="providerOnboardingTitle">Когда вас можно записывать?</h1><p>Это основа доступных окон. Перерывы и отдельные выходные добавите позже.</p></section>
      <div class="onboarding-presets"><button type="button" data-schedule-preset="weekdays">Будни</button><button type="button" data-schedule-preset="six-days">Пн–Сб</button><button type="button" data-schedule-preset="daily">Каждый день</button></div>
      <fieldset class="onboarding-fieldset"><legend>Рабочие дни</legend><div class="onboarding-days">${DAY_LABELS.map(([value, label]) => `<label class="${state.days.includes(value) ? 'is-selected' : ''}"><input type="checkbox" value="${value}" data-schedule-day ${state.days.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
      <div class="onboarding-time-grid"><label><span>Начало</span><input type="time" value="${state.start}" data-schedule-start></label><span aria-hidden="true">—</span><label><span>Конец</span><input type="time" value="${state.end}" data-schedule-end></label></div>
      <aside class="onboarding-note"><strong>Онлайн-запись будет учитывать этот график.</strong><span>Вы сможете вручную создать запись вне рабочего времени.</span></aside>`);
  }

  function renderStepFour() {
    const professions = state.professionIds.map(id => catalog.profession(id)?.label).filter(Boolean).join(' · ');
    shell(`
      <section class="onboarding-hero onboarding-hero-final"><small>Проверьте настройки</small><h1 id="providerOnboardingTitle">Всё готово к добавлению</h1><p>Только эта кнопка создаст выбранные услуги. Существующие данные не изменятся.</p></section>
      <div class="onboarding-preview"><div class="onboarding-preview-brand"><i>${escapeHtml((context.user.user_metadata?.display_name || 'М').slice(0, 1).toUpperCase())}</i><span><small>${escapeHtml(professions || 'Направление не выбрано')}</small><strong>${escapeHtml(context.user.user_metadata?.display_name || 'Ваш кабинет')}</strong></span></div><h2>${state.services.length ? 'Выбранные услуги' : 'Без новых услуг'}</h2><div class="onboarding-preview-services">${state.services.length ? state.services.map(service => `<div><span><strong>${escapeHtml(service.name)}</strong><small>${service.duration} мин</small></span><b>${Number(service.price).toLocaleString('ru-RU')} ₽</b></div>`).join('') : '<p>Услуги можно добавить позже в разделе «Услуги».</p>'}</div></div>
      <aside class="onboarding-summary"><span>Ваш график</span><strong>${state.days.length} дн. в неделю · ${state.start}–${state.end}</strong></aside>`, { nextLabel:state.services.length ? 'Добавить услуги и открыть мой день' : 'Сохранить и открыть мой день' });
  }

  function render(focusSelector = '') {
    if (!root || !state) return;
    if (step === 1) renderStepOne();
    if (step === 2) renderStepTwo();
    if (step === 3) renderStepThree();
    if (step === 4) renderStepFour();
    if (focusSelector) requestAnimationFrame(() => root.querySelector(focusSelector)?.focus());
  }

  function updateChoiceClasses(input) {
    input.closest('.onboarding-choice-grid, .onboarding-chips, .onboarding-days')?.querySelectorAll('label').forEach(label => label.classList.toggle('is-selected', Boolean(label.querySelector('input')?.checked)));
  }

  function serviceFromTarget(target) {
    const card = target.closest('[data-onboarding-service]');
    return card ? state.services.find(item => item.itemId === card.dataset.onboardingService) : null;
  }

  function handleInput(event) {
    if (busy || !state) return;
    const target = event.target;
    if (target.name === 'onboardingFormat') state.format = target.value;
    if (target.matches('[data-onboarding-profession]')) {
      state.professionIds = [...root.querySelectorAll('[data-onboarding-profession]:checked')].map(input => input.value);
      state.services = state.services.filter(service => !service.professionId || state.professionIds.includes(service.professionId));
      state.expanded = state.expanded.filter(id => state.professionIds.includes(id));
    }
    if (target.matches('[data-onboarding-search]')) {
      state.search = target.value;
      const selection = [target.selectionStart, target.selectionEnd];
      render('[data-onboarding-search]');
      root.querySelector('[data-onboarding-search]')?.setSelectionRange(...selection);
      saveDraft();
      return;
    }
    const service = serviceFromTarget(target);
    if (service && target.matches('[data-service-name]')) service.name = target.value;
    if (service && target.matches('[data-service-price]')) service.price = target.value;
    if (service && target.matches('[data-service-duration]')) service.duration = Math.max(5, Math.round(Number(target.value) || 5));
    if (target.matches('[data-schedule-day]')) state.days = [...root.querySelectorAll('[data-schedule-day]:checked')].map(input => input.value);
    if (target.matches('[data-schedule-start]')) state.start = target.value;
    if (target.matches('[data-schedule-end]')) state.end = target.value;
    updateChoiceClasses(target);
    saveDraft();
  }

  function serviceValidation() {
    if (!state.services.length) return '';
    const names = state.services.map(service => catalog.normalizeName(service.name));
    if (names.some(name => name.length < 2)) return 'Укажите название каждой выбранной услуги.';
    if (new Set(names).size !== names.length) return 'Названия выбранных услуг должны различаться.';
    if (state.services.some(service => service.price === '' || !Number.isInteger(Number(service.price)) || Number(service.price) < 0 || Number(service.price) > 1000000)) return 'Укажите свою цену для каждой выбранной услуги.';
    if (state.services.some(service => !Number.isInteger(Number(service.duration)) || Number(service.duration) < 5 || Number(service.duration) > 480)) return 'Длительность должна быть от 5 до 480 минут.';
    return '';
  }

  function validStep() {
    if (step === 1 && !state.professionIds.length) return 'Выберите хотя бы одно направление.';
    if (step === 2) return serviceValidation();
    if (step === 3 && !state.days.length) return 'Выберите хотя бы один рабочий день.';
    if (step === 3 && state.start >= state.end) return 'Время окончания должно быть позже начала.';
    return '';
  }

  function showError(message) {
    let error = root.querySelector('.onboarding-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'onboarding-error';
      error.setAttribute('role', 'alert');
      error.tabIndex = -1;
      root.querySelector('.onboarding-footer').prepend(error);
    }
    error.textContent = message;
    error.focus?.();
  }

  function errorMessage(error) {
    if (!navigator.onLine) return 'Нет соединения. Настройки сохранены в черновике — повторите после подключения.';
    const text = `${error?.code || ''} ${error?.message || ''}`;
    if (/service_preset_(?:request|idempotency)_conflict/.test(text)) return 'Сервер уже обработал прошлый вариант. Проверьте текущий список и подтвердите его ещё раз.';
    if (/duplicate_service_name/.test(text)) return 'Услуга с таким названием уже существует. Существующая услуга не изменена.';
    if (/invalid_service_preset|invalid_profession/.test(text)) return 'Каталог обновился. Обновите страницу и выберите услуги снова.';
    if (/42501|permission|row.level|forbidden/i.test(text)) return 'Недостаточно прав для сохранения. Войдите заново; черновик останется на устройстве.';
    if (/PGRST20[024]|42P01|42703|schema|column|relation|function/i.test(text)) return 'Сервер ещё не поддерживает быстрый подбор. Обновите страницу через несколько минут.';
    if (/23514|22023|invalid_settings/i.test(text)) return 'Проверьте услуги и график: цена, длительность, рабочие дни и время.';
    return 'Не удалось подтвердить сохранение. Данные не изменены или уже защищённо сохранены — можно повторить.';
  }

  async function markStatus(status, operationContext = context, settings = state) {
    let writeError;
    try {
      const { error } = await operationContext.db.auth.updateUser({ data:{
        minuta_onboarding_status:status,
        minuta_onboarding_version:VERSION,
        minuta_onboarding_finished_at:new Date().toISOString(),
        minuta_work_format:settings.format,
        minuta_business_category:settings.professionIds[0] || 'other',
        minuta_profession_ids:settings.professionIds,
        minuta_service_preset_catalog_version:catalog.version
      }});
      writeError = error;
    } catch (error) { writeError = error; }
    const { data, error } = await operationContext.db.auth.getUser();
    const user = data?.user;
    if (error || user?.id !== operationContext.user.id || user.user_metadata?.minuta_onboarding_status !== status) throw writeError || error || new Error('onboarding_status_unconfirmed');
    operationContext.user.user_metadata = user.user_metadata;
  }

  async function finish() {
    if (busy) return;
    if (!navigator.onLine) { showError(errorMessage()); return; }
    const operationContext = context;
    const operationGeneration = generation;
    const settings = structuredClone(state);
    const assertCurrent = () => { if (generation !== operationGeneration || context?.user?.id !== operationContext.user.id) throw new Error('stale_session'); };
    busy = true;
    render();
    try {
      const invalid = serviceValidation();
      if (invalid || !settings.professionIds.length || !settings.days.length || settings.start >= settings.end) throw new Error('invalid_settings');
      const payload = settings.services.map(service => ({
        item_id:service.itemId,
        preset_id:service.presetId,
        name:service.name.trim().replace(/\s+/g, ' '),
        duration_minutes:Number(service.duration),
        price_rub:Number(service.price)
      }));
      const { error:servicesError } = await operationContext.db.rpc('create_provider_services_from_presets_v160', {
        p_request:settings.requestId,
        p_catalog_version:catalog.version,
        p_professions:settings.professionIds,
        p_services:payload
      });
      assertCurrent();
      if (servicesError) throw servicesError;
      const rows = DAY_LABELS.map(([weekday]) => ({ performer_id:operationContext.user.id, weekday:Number(weekday), enabled:settings.days.includes(weekday), start_time:settings.start, end_time:settings.end, break_start:null, break_end:null, slot_interval_minutes:30 }));
      const { error:scheduleError } = await operationContext.db.from('provider_schedule').upsert(rows, { onConflict:'performer_id,weekday' });
      assertCurrent();
      if (scheduleError) throw scheduleError;
      await markStatus('completed', operationContext, settings);
      assertCurrent();
      try { localStorage.removeItem(draftKey(operationContext.user.id)); } catch {}
      close();
      if (typeof operationContext.refresh === 'function') { try { await operationContext.refresh(); } catch {} }
      assertCurrent();
      busy = false;
      operationContext.onComplete?.();
    } catch (error) {
      if (generation !== operationGeneration || context?.user?.id !== operationContext.user.id) return;
      busy = false;
      const errorText = `${error?.code || ''} ${error?.message || ''}`;
      if (/service_preset_(?:request|idempotency)_conflict/.test(errorText)) {
        state.requestId = newRequestId();
        step = 2;
        saveDraft();
      }
      render();
      showError(errorMessage(error));
    }
  }

  async function postpone() {
    if (busy) return;
    busy = true;
    try {
      await markStatus('skipped');
      try { localStorage.removeItem(draftKey(context.user.id)); } catch {}
      close();
    } catch {
      busy = false;
      render();
      showError('Не удалось сохранить выбор. Попробуйте ещё раз.');
    }
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.matches('[data-onboarding-back]')) { step = Math.max(1, step - 1); render(); return; }
    if (button.matches('[data-onboarding-later]')) { void postpone(); return; }
    if (button.matches('[data-onboarding-preset]')) {
      const preset = catalog.preset(button.dataset.onboardingPreset);
      if (!preset) return;
      const index = state.services.findIndex(item => item.presetId === preset.id);
      if (index >= 0) state.services.splice(index, 1);
      else state.services.push({ itemId:preset.id, presetId:preset.id, professionId:preset.professionId, name:preset.name, duration:preset.defaultDuration, price:'' });
      saveDraft();
      render(`[data-onboarding-preset="${preset.id}"]`);
      return;
    }
    if (button.matches('[data-onboarding-show-more]')) {
      const id = button.dataset.onboardingShowMore;
      state.expanded = state.expanded.includes(id) ? state.expanded.filter(item => item !== id) : [...state.expanded, id];
      saveDraft();
      render(`[data-onboarding-show-more="${id}"]`);
      return;
    }
    if (button.matches('[data-onboarding-add-service]')) {
      const itemId = `custom-${newRequestId()}`;
      state.services.push({ itemId, presetId:null, name:'', price:'', duration:60 });
      saveDraft();
      render(`[data-onboarding-service="${itemId}"] input`);
      return;
    }
    if (button.matches('[data-onboarding-remove-service]')) {
      state.services = state.services.filter(item => item.itemId !== button.dataset.onboardingRemoveService);
      saveDraft();
      render('[data-onboarding-add-service]');
      return;
    }
    if (button.matches('[data-schedule-preset]')) {
      const preset = button.dataset.schedulePreset;
      state.days = preset === 'weekdays' ? ['1','2','3','4','5'] : preset === 'six-days' ? ['1','2','3','4','5','6'] : ['1','2','3','4','5','6','7'];
      saveDraft();
      render(`[data-schedule-preset="${preset}"]`);
      return;
    }
    if (button.matches('[data-onboarding-next]')) {
      const error = validStep();
      if (error) { showError(error); return; }
      if (step < 4) { step += 1; saveDraft(); render(); }
      else void finish();
    }
  }

  function close() {
    if (!root) return;
    if (root.open && typeof root.close === 'function') root.close();
    else root.removeAttribute('open');
    document.documentElement.classList.remove('onboarding-open');
  }

  async function handleSession(nextContext) {
    if (busy && context?.user?.id === nextContext?.user?.id) { context = nextContext; return; }
    generation += 1;
    context = nextContext;
    const status = context?.user?.user_metadata?.minuta_onboarding_status;
    if (!context?.user?.id || status !== 'pending') { close(); return; }
    if (!catalog) return;
    mount();
    state = readDraft(context.user.id);
    step = 1;
    busy = false;
    render();
    document.documentElement.classList.add('onboarding-open');
    if (!root.open) root.showModal?.();
  }

  function reset() {
    generation += 1;
    close();
    context = null;
    state = null;
    step = 1;
    busy = false;
  }

  window.MinutaProviderOnboarding = { handleSession, reset };
})();
