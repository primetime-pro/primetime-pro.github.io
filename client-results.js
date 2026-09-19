(function initMinutaClientResults(global) {
  'use strict';

  const BUCKET = 'minuta-client-records';
  const PAGE = 30;
  const INITIAL_VISIBLE = 2;
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_PIXELS = 40000000;
  const MAX_SIDE = 2400;
  const MAX_TEXT = 500;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FIELD_DEFINITIONS = [
    ['before_session', 'До сеанса', 'Самочувствие, запрос или важные наблюдения до начала'],
    ['work_done', 'Что сделали', 'Кратко опишите выполненную работу'],
    ['after_session', 'После сеанса', 'Реакция клиента и результат после завершения'],
    ['recommendations', 'Рекомендации', 'Что клиенту важно сделать или учесть после визита']
  ];

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, symbol => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[symbol]));
  const uuid = () => {
    if (!global.crypto?.randomUUID) throw new Error('secure_uuid_unavailable');
    return global.crypto.randomUUID();
  };
  const normalizePhone = value => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
    if (digits.length === 10) return `7${digits}`;
    return digits;
  };
  const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const rpcMissing = error => /PGRST202|schema cache|does not exist|undefined function/i.test(`${error?.code || ''} ${error?.message || ''}`);
  const visibleText = value => String(value ?? '').trim().slice(0, MAX_TEXT);
  const mediaPurpose = value => value === 'after' ? 'after' : 'before';

  function normalizeMedia(value) {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || '');
    const objectPath = String(value.object_path || value.objectPath || '');
    if (!UUID.test(id) || !objectPath) return null;
    return {
      id,
      purpose: mediaPurpose(value.purpose),
      object_path: objectPath,
      mime_type: String(value.mime_type || value.mimeType || 'image/webp'),
      byte_size: Math.max(0, Number(value.byte_size || value.byteSize || 0)),
      can_delete: value.can_delete === true
    };
  }

  function normalizeResult(value) {
    if (!value || typeof value !== 'object') return null;
    const media = (Array.isArray(value.media) ? value.media : Array.isArray(value.assets) ? value.assets : [])
      .map(normalizeMedia).filter(Boolean);
    return {
      id: String(value.id || ''),
      booking_id: String(value.booking_id || value.bookingId || ''),
      visit_at: String(value.visit_at || value.visitAt || value.updated_at || ''),
      visit_label: String(value.visit_label || value.visitLabel || ''),
      service_label: String(value.service_label || value.serviceLabel || ''),
      before_session: visibleText(value.before_session ?? value.beforeSession),
      work_done: visibleText(value.work_done ?? value.workDone),
      after_session: visibleText(value.after_session ?? value.afterSession),
      recommendations: visibleText(value.recommendations),
      private_storage_consent: value.private_storage_consent === true || value.privateStorageConsent === true,
      external_share_consent: value.external_share_consent === true || value.externalShareConsent === true,
      updated_at: String(value.updated_at || value.updatedAt || ''),
      media
    };
  }

  function mergeResultMedia(entries, media) {
    const grouped = new Map();
    (Array.isArray(media) ? media : []).forEach(item => {
      const resultId = String(item?.result_id || item?.resultId || '');
      const normalized = normalizeMedia(item);
      if (!resultId || !normalized) return;
      const list = grouped.get(resultId) || [];
      list.push(normalized);
      grouped.set(resultId, list);
    });
    return (Array.isArray(entries) ? entries : []).map(entry => normalizeResult({
      ...entry,
      media: [...(Array.isArray(entry?.media) ? entry.media : []), ...(grouped.get(String(entry?.id || '')) || [])]
    })).filter(Boolean);
  }

  function resultCompletion(result) {
    return FIELD_DEFINITIONS.reduce((count, [key]) => count + (visibleText(result?.[key]) ? 1 : 0), 0);
  }

  function mediaMarkup(result, purpose) {
    const label = purpose === 'after' ? 'после' : 'до';
    const item = result?.media?.find(media => media.purpose === purpose);
    if (item) return `<article class="booking-result-media-item" data-result-media-slot="${purpose}">
      <div><strong>Фото ${label}</strong><small>${item ? 'Хранится приватно' : 'Не добавлено'}</small></div>
      <button class="client-result-private-preview" type="button" data-client-result-preview="${escapeHtml(item.id)}">Открыть</button>
    </article>`;
    return `<label class="booking-result-media-item booking-result-file-picker" data-result-media-slot="${purpose}">
      <span><strong>Фото ${label}</strong><small>Не добавлено</small></span>
      <b>Добавить</b>
      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Добавить фото ${label}" data-visit-result-media-input="${purpose}">
    </label>`;
  }

  function bookingFieldsMarkup(input = {}) {
    const result = normalizeResult(input.result || input.value || (input.id || input.booking_id ? input : null)) || normalizeResult({});
    const enabled = input.enabled === true;
    const canEnable = input.can_enable === true || input.canEnable === true;
    const offline = input.offline === true;
    const unavailable = input.unavailable === true;
    const loading = input.enabled == null && !offline && !unavailable;
    if (!enabled) {
      return `<details class="booking-visit-result-fields" id="bookingVisitResultFields" data-client-results-disabled>
        <summary><span>Описание сеанса</span><small>${offline ? 'Без интернета' : loading ? 'Проверяем приватный раздел…' : unavailable ? 'Недоступно' : 'Подключить'}</small></summary>
        <div class="client-results-gate"><strong>${offline ? 'Недоступно без интернета' : loading ? 'Проверяем доступ' : unavailable ? 'Результаты пока недоступны' : 'Приватные результаты не подключены'}</strong><p>${offline ? 'Подключитесь к сети, чтобы просмотреть или изменить приватные результаты.' : loading ? 'Поля появятся после проверки прав организации.' : unavailable ? 'Проверьте соединение и повторите позже.' : 'Результаты и фото хранятся только в закрытом разделе организации.'}</p>${!loading && !offline && !unavailable && canEnable ? '<button class="secondary-button" type="button" data-client-results-enable>Подключить</button>' : ''}</div>
      </details>`;
    }
    const filled = resultCompletion(result);
    const hasPrivatePayload = filled > 0 || result.media.length > 0;
    return `<details class="booking-visit-result-fields" id="bookingVisitResultFields" data-result-id="${escapeHtml(result.id)}">
      <summary><span>Описание сеанса</span><small data-client-result-editor-summary>${filled ? `Заполнено ${filled} из 4` : 'Не заполнено'} · Приватно</small></summary>
      <fieldset class="booking-visit-result-body">
        <legend class="sr-only">Приватное описание результата визита</legend>
        <div class="booking-result-media-grid" aria-label="Фотографии результата">
          ${mediaMarkup(result, 'before')}${mediaMarkup(result, 'after')}
        </div>
        <details class="booking-result-description">
          <summary><span>${filled ? 'Описание сеанса' : 'Добавить описание'}</span><small data-client-result-description-summary>${filled ? `${filled} из 4` : 'Необязательно'}</small></summary>
          <div class="booking-visit-result-grid">
            ${FIELD_DEFINITIONS.map(([key, label, placeholder]) => `<label class="booking-visit-result-field"><span>${label}</span><textarea name="client_result_${key}" rows="2" maxlength="${MAX_TEXT}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(result[key])}</textarea></label>`).join('')}
          </div>
        </details>
        <label class="booking-result-private-consent"><input type="checkbox" name="client_result_private_consent" ${result.private_storage_consent ? 'checked' : ''} ${hasPrivatePayload ? 'required' : ''}><span><strong>Сохранить результат в карточке клиента</strong><small>Фото и описание доступны только сотрудникам организации.</small></span></label>
        <details class="booking-result-more">
          <summary><span>Дополнительно</span><small data-client-result-external-summary>${result.external_share_consent ? 'Внешнее использование разрешено' : 'Внешнее использование'}</small></summary>
          <label><input type="checkbox" name="client_result_external_consent" ${result.external_share_consent ? 'checked' : ''}><span><strong>Разрешить внешнее использование</strong><small>Необязательно. Ничего не публикуется автоматически.</small></span></label>
        </details>
        <p class="client-result-save-status" data-client-result-save-status role="status" aria-live="polite"></p>
      </fieldset>
    </details>`;
  }

  async function prepareImage(file) {
    if (!file || file.size < 1 || file.size > MAX_BYTES) throw new Error('file_size');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
    const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
    const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    if ((!jpeg && !png && !webp) || !global.createImageBitmap) throw new Error('file_format');
    const bitmap = await global.createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('image_dimensions');
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('file_format');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .88));
      if (!blob || blob.size < 1 || blob.size > MAX_BYTES) throw new Error('file_size');
      return { blob, mime_type: 'image/webp', byte_size: blob.size };
    } finally {
      bitmap.close();
    }
  }

  function createController(options = {}) {
    const db = options.db;
    const getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
    const requireWrites = typeof options.requireWrites === 'function' ? options.requireWrites : () => true;
    const notify = typeof options.notify === 'function' ? options.notify : () => {};
    const openBooking = typeof options.openBooking === 'function' ? options.openBooking : () => {};
    const isOnline = typeof options.isOnline === 'function' ? options.isOnline : () => global.navigator?.onLine !== false;
    let organization = null;
    let client = null;
    let rows = [];
    let remote = null;
    let remoteBeforeOffline = null;
    let loading = false;
    let more = false;
    let offset = 0;
    let visibleLimit = INITIAL_VISIBLE;
    let generation = 0;
    let bound = false;
    let profileHost = null;
    let previewDialog = null;
    let previewUrl = '';
    let editor = null;
    let pendingSubmit = null;
    let preparingFiles = 0;
    const pendingFiles = new Map();
    const mediaIndex = new Map();

    const connectionAvailable = () => {
      try { return isOnline() !== false; } catch { return false; }
    };
    const offlineRemote = () => ({ enabled: false, can_enable: false, unavailable: true, offline: true });

    function message(error) {
      const value = `${error?.code || ''} ${error?.message || error || ''}`;
      if (/file_size/.test(value)) return 'Выберите фото размером до 10 МБ.';
      if (/image_dimensions/.test(value)) return 'Слишком большое разрешение фотографии.';
      if (/file_format/.test(value)) return 'Поддерживаются JPG, PNG и WebP.';
      if (/access_denied|42501|permission|membership|suspended/.test(value)) return 'Нет доступа к приватным результатам.';
      if (/disabled/.test(value)) return 'Приватные результаты не подключены.';
      return 'Не удалось сохранить результат. Проверьте соединение и повторите.';
    }

    async function rpc(name, payload) {
      if (!db?.rpc) throw new Error('client_results_unavailable');
      const response = await db.rpc(name, payload);
      if (response?.error) throw response.error;
      return response?.data;
    }

    function contextToken() {
      const context = getContext() || {};
      return { generation, userId: context.userId, sessionGeneration: context.sessionGeneration, organizationId: organization?.id, phone: client?.phone };
    }

    function isCurrent(token) {
      const context = getContext() || {};
      return token.generation === generation && token.userId === context.userId && token.sessionGeneration === context.sessionGeneration
        && token.organizationId === organization?.id && token.phone === client?.phone;
    }

    function indexMedia(values = rows) {
      mediaIndex.clear();
      values.forEach(result => result?.media?.forEach(media => mediaIndex.set(media.id, media)));
      editor?.result?.media?.forEach(media => mediaIndex.set(media.id, media));
    }

    function ensureProfileHost() {
      if (profileHost?.isConnected) return profileHost;
      profileHost = document.querySelector('#clientResultsDisclosure');
      if (!profileHost) {
        const anchor = document.querySelector('#clientFavoriteServices');
        const fallback = document.querySelector('.client-preferences-disclosure');
        if (!anchor && !fallback) return null;
        profileHost = document.createElement('details');
        profileHost.className = 'client-disclosure client-results-disclosure';
        profileHost.id = 'clientResultsDisclosure';
        profileHost.innerHTML = '<summary><span>Результаты</span><small id="clientResultsSummary">Проверяем доступ…</small></summary><div class="client-results-body"><button class="client-results-add" type="button" data-client-results-add hidden>+ Добавить результат</button><div class="client-results-status" role="status" aria-live="polite"></div><div class="client-results-list" id="clientResultsList"></div><button class="client-results-more" type="button" data-client-results-more hidden>Все результаты</button></div>';
        if (anchor) anchor.insertAdjacentElement('afterend', profileHost);
        else fallback.insertAdjacentElement('beforebegin', profileHost);
      }
      return profileHost;
    }

    function ensurePreviewDialog() {
      if (previewDialog?.isConnected) return previewDialog;
      previewDialog = document.querySelector('#clientResultPreviewDialog');
      if (!previewDialog) {
        previewDialog = document.createElement('dialog');
        previewDialog.id = 'clientResultPreviewDialog';
        previewDialog.className = 'client-result-preview-dialog';
        previewDialog.setAttribute('aria-labelledby', 'clientResultPreviewTitle');
        previewDialog.innerHTML = '<div class="client-result-preview-head"><div><small>Приватное фото</small><h3 id="clientResultPreviewTitle">Результат визита</h3></div><button type="button" data-client-result-preview-close aria-label="Закрыть">×</button></div><div class="client-result-preview-stage"><p role="status">Выберите фотографию</p></div>';
        document.body.append(previewDialog);
      }
      previewDialog.addEventListener('close', revokePreview, { once: false });
      return previewDialog;
    }

    function revokePreview() {
      if (previewUrl) global.URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      const stage = previewDialog?.querySelector('.client-result-preview-stage');
      if (stage) stage.innerHTML = '<p role="status">Выберите фотографию</p>';
    }

    function closePreview() {
      if (previewDialog?.open) previewDialog.close();
      else revokePreview();
    }

    function resultCardMarkup(result) {
      const fields = FIELD_DEFINITIONS.filter(([key]) => result[key]).map(([key, label]) => `<div class="client-result-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(result[key])}</dd></div>`).join('');
      const media = result.media.map(item => `<button class="client-result-media-button" type="button" data-client-result-preview="${escapeHtml(item.id)}"><span>Фото ${item.purpose === 'after' ? 'после' : 'до'}</span><small>Открыть приватно</small></button>`).join('');
      const date = formatDate(result.visit_at || result.updated_at) || 'Дата не указана';
      const service = result.service_label || result.visit_label || 'Результат визита';
      return `<article class="client-result-card">
        <header><div><time>${escapeHtml(date)}</time><strong>${escapeHtml(service)}</strong></div><span class="client-result-private-badge" aria-label="Приватный результат">Приватно</span></header>
        ${fields ? `<dl class="client-result-grid">${fields}</dl>` : '<p class="client-result-empty">Описание пока не заполнено.</p>'}
        ${media ? `<div class="client-result-media">${media}</div>` : ''}
        ${UUID.test(result.booking_id) ? `<button class="client-result-open-booking" type="button" data-client-result-open-booking="${escapeHtml(result.booking_id)}">Открыть запись</button>` : ''}
      </article>`;
    }

    function profileSummary() {
      const summary = profileHost?.querySelector('#clientResultsSummary');
      if (!summary) return;
      if (remote?.offline) summary.textContent = 'Без интернета';
      else if (loading) summary.textContent = 'Проверяем доступ…';
      else if (remote?.unavailable) summary.textContent = 'Недоступно';
      else if (remote?.enabled === false) summary.textContent = 'Подключить';
      else if (!rows.length) summary.textContent = 'Пока нет';
      else {
        const latest = formatDate(rows[0].visit_at || rows[0].updated_at);
        summary.textContent = latest ? `Последний · ${latest} · Приватно` : `${rows.length} · Приватно`;
      }
    }

    function preferredBooking() {
      const bookings = (Array.isArray(client?.bookings) ? client.bookings : []).filter(item => UUID.test(String(item?.id || '')) && item?.status !== 'cancelled');
      if (!bookings.length) return null;
      const timestamp = item => {
        const value = new Date(`${item.booking_date || ''}T${String(item.booking_time || '00:00').slice(0, 8)}`).getTime();
        return Number.isFinite(value) ? value : 0;
      };
      const now = Date.now();
      const upcoming = bookings.filter(item => timestamp(item) >= now).sort((left, right) => timestamp(left) - timestamp(right));
      return upcoming[0] || [...bookings].sort((left, right) => timestamp(right) - timestamp(left))[0] || null;
    }

    function openPreferredBooking() {
      const booking = preferredBooking();
      if (!booking) return;
      openBooking(booking.id);
      const disclosure = document.querySelector('#bookingClientResultDisclosure');
      if (disclosure) disclosure.open = true;
      document.querySelector('#bookingVisitResultForm')?.scrollIntoView({ block: 'nearest' });
    }

    function renderProfile(reveal = profileHost?.open === true) {
      const host = ensureProfileHost();
      if (!host || !client) return;
      host.hidden = false;
      profileSummary();
      const status = host.querySelector('.client-results-status');
      const list = host.querySelector('#clientResultsList');
      const moreButton = host.querySelector('[data-client-results-more]');
      const addButton = host.querySelector('[data-client-results-add]');
      if (addButton) addButton.hidden = !reveal || remote?.enabled !== true || !preferredBooking();
      if (!reveal) {
        list.replaceChildren();
        status.textContent = '';
        moreButton.hidden = true;
        closePreview();
        return;
      }
      if (loading) {
        list.replaceChildren();
        status.textContent = 'Загружаем приватные результаты…';
        moreButton.hidden = true;
        return;
      }
      if (remote?.offline) {
        list.replaceChildren();
        status.innerHTML = '<div class="client-results-gate"><strong>Недоступно без интернета</strong><p>Подключитесь к сети, чтобы просмотреть приватные результаты.</p></div>';
        moreButton.hidden = true;
        return;
      }
      if (remote?.unavailable) {
        list.replaceChildren();
        status.innerHTML = '<div class="client-results-gate"><strong>Результаты пока недоступны</strong><p>Проверьте соединение и повторите позже.</p></div>';
        moreButton.hidden = true;
        return;
      }
      if (remote?.enabled === false) {
        list.replaceChildren();
        status.innerHTML = `<div class="client-results-gate"><strong>Приватные результаты не подключены</strong><p>Описание и фото будут доступны только сотрудникам с правом на этого клиента.</p>${remote.can_enable ? '<button class="secondary-button" type="button" data-client-results-enable>Подключить</button>' : '<small>Подключить раздел может владелец или администратор.</small>'}</div>`;
        moreButton.hidden = true;
        return;
      }
      status.textContent = '';
      const visible = rows.slice(0, visibleLimit);
      list.innerHTML = visible.map(resultCardMarkup).join('') || '<p class="client-result-empty">Результаты появятся после заполнения записи о сеансе.</p>';
      moreButton.hidden = !more && rows.length <= visibleLimit;
      moreButton.textContent = visibleLimit <= INITIAL_VISIBLE ? 'Все результаты' : 'Показать ещё';
      indexMedia();
    }

    function setEditorStatus(text, isError = false) {
      const status = editor?.form?.querySelector('[data-client-result-save-status]');
      if (!status) return;
      status.textContent = text || '';
      status.classList.toggle('is-error', isError);
    }

    function refreshEditorSummary() {
      const details = editor?.form?.querySelector('#bookingVisitResultFields');
      if (!details || details.hasAttribute('data-client-results-disabled')) return;
      const filled = FIELD_DEFINITIONS.reduce((count, [key]) => count + (visibleText(details.querySelector(`[name="client_result_${key}"]`)?.value) ? 1 : 0), 0);
      const pending = pendingFiles.size;
      const summary = details.querySelector('[data-client-result-editor-summary]');
      if (summary) summary.textContent = `${filled ? `Заполнено ${filled} из 4` : 'Не заполнено'}${pending ? ` · фото: ${pending}` : ''} · Приватно`;
      const descriptionSummary = details.querySelector('[data-client-result-description-summary]');
      if (descriptionSummary) descriptionSummary.textContent = filled ? `${filled} из 4` : 'Необязательно';
      const externalConsent = details.querySelector('[name="client_result_external_consent"]');
      const externalSummary = details.querySelector('[data-client-result-external-summary]');
      if (externalSummary) externalSummary.textContent = externalConsent?.checked ? 'Внешнее использование разрешено' : 'Внешнее использование';
      const quickSummary = editor.form.closest('.booking-client-result-disclosure')?.querySelector('[data-booking-result-summary]');
      if (quickSummary) quickSummary.textContent = pending || editor.dirty ? 'Черновик' : filled || editor.result?.media?.length ? 'Готово' : 'Не заполнено';
      const privateConsent = details.querySelector('[name="client_result_private_consent"]');
      if (privateConsent) privateConsent.required = filled > 0 || pending > 0 || Boolean(editor?.result?.media?.length);
      const hasContent = filled > 0 || pending > 0 || Boolean(editor?.result?.media?.length);
      editor.form.dataset.clientResultHasContent = hasContent ? 'true' : 'false';
    }

    function renderEditor(result = editor?.result) {
      if (!editor?.form) return;
      const current = editor.form.querySelector('#bookingVisitResultFields');
      const wasOpen = current?.open === true;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = bookingFieldsMarkup({ result, enabled: remote?.enabled, can_enable: remote?.can_enable, unavailable: remote?.unavailable, offline: remote?.offline || !connectionAvailable() });
      const replacement = wrapper.firstElementChild;
      if (current) current.replaceWith(replacement);
      else {
        const submit = editor.form.querySelector('button[type="submit"]');
        if (submit) submit.insertAdjacentElement('beforebegin', replacement);
        else editor.form.append(replacement);
      }
      replacement.open = wasOpen || editor.expandEditor === true;
      editor.result = normalizeResult(result) || normalizeResult({});
      indexMedia();
      refreshEditorSummary();
      updateEditorSubmitAvailability();
    }

    function updateEditorSubmitAvailability() {
      const submit = editor?.form?.querySelector('button[type="submit"]');
      if (!submit) return;
      const disabled = !connectionAvailable() || remote?.enabled !== true;
      submit.disabled = disabled;
      submit.setAttribute('aria-disabled', String(disabled));
      if (!connectionAvailable()) submit.title = 'Подключитесь к интернету, чтобы сохранить приватный результат';
      else submit.removeAttribute('title');
    }

    async function loadResults(append = false) {
      if (!organization?.id || !client?.phone || loading) return;
      if (!connectionAvailable()) {
        loading = false;
        remote = offlineRemote();
        renderProfile(profileHost?.open === true);
        if (editor && !editor.dirty) renderEditor(editor.result);
        return;
      }
      const token = contextToken();
      loading = true;
      renderProfile(profileHost?.open === true);
      try {
        const data = await rpc('get_minuta_client_results_v120', {
          p_organization: organization.id,
          p_phone: client.phone,
          p_offset: append ? offset : 0
        });
        if (!isCurrent(token)) return;
        remote = {
          enabled: data?.enabled === true,
          can_enable: data?.can_enable === true
        };
        const source = Array.isArray(data?.results) ? data.results : Array.isArray(data?.entries) ? data.entries : [];
        const normalized = mergeResultMedia(source, data?.media);
        more = data?.has_more === true || normalized.length > PAGE;
        const page = normalized.slice(0, PAGE);
        rows = append ? [...new Map([...rows, ...page].map(item => [item.id || item.booking_id, item])).values()] : page;
        rows.sort((left, right) => `${right.visit_at}${right.updated_at}`.localeCompare(`${left.visit_at}${left.updated_at}`));
        offset = (append ? offset : 0) + page.length;
        indexMedia();
      } catch (error) {
        if (!isCurrent(token)) return;
        remote = connectionAvailable()
          ? { enabled: false, can_enable: false, unavailable: true, error: message(error) }
          : offlineRemote();
      } finally {
        if (isCurrent(token)) {
          loading = false;
          renderProfile(profileHost?.open === true);
          if (editor && !editor.dirty) {
            const result = rows.find(item => item.booking_id === editor.bookingId) || editor.result;
            renderEditor(result);
          }
        }
      }
    }

    async function loadBookingResult() {
      if (!editor?.bookingId || !organization?.id) return;
      if (!connectionAvailable()) {
        remote = offlineRemote();
        if (!editor.dirty) renderEditor(editor.result);
        else updateEditorSubmitAvailability();
        return;
      }
      if (!UUID.test(editor.bookingId)) {
        remote = { enabled: false, can_enable: false, unavailable: true };
        renderEditor(editor.result);
        return;
      }
      const revision = editor.revision;
      try {
        const data = await rpc('get_minuta_client_result_v120', { p_organization: organization.id, p_booking: editor.bookingId });
        if (!editor || editor.revision !== revision) return;
        remote = { enabled: data?.enabled === true, can_enable: data?.can_enable === true };
        editor.result = mergeResultMedia([data?.result || data?.entry].filter(Boolean), data?.media)[0]
          || normalizeResult({ booking_id: editor.bookingId });
        if (!editor.dirty) renderEditor(editor.result);
      } catch (error) {
        if (!editor || editor.revision !== revision) return;
        if (rpcMissing(error) && client?.phone) {
          await loadResults(false);
          return;
        }
        remote = connectionAvailable()
          ? { enabled: false, can_enable: false, unavailable: true, error: message(error) }
          : offlineRemote();
        if (!editor.dirty) renderEditor(editor.result);
      }
    }

    async function enableResults() {
      if (!organization?.id || !requireWrites()) return;
      try {
        await rpc('set_minuta_client_records_enabled', { p_organization: organization.id, p_enabled: true });
        remote = { enabled: true, can_enable: true };
        notify('Приватные результаты подключены');
        if (client?.phone) await loadResults(false);
        else renderEditor(editor?.result);
      } catch (error) {
        setEditorStatus(message(error), true);
        notify(message(error));
      }
    }

    async function openPrivatePreview(id) {
      const media = mediaIndex.get(String(id || ''));
      if (!media || !db?.storage) return;
      const dialog = ensurePreviewDialog();
      const stage = dialog.querySelector('.client-result-preview-stage');
      revokePreview();
      stage.innerHTML = '<p role="status">Загружаем приватное фото…</p>';
      if (!dialog.open) dialog.showModal();
      try {
        const result = await db.storage.from(BUCKET).download(media.object_path);
        if (result?.error) throw result.error;
        if (!dialog.open) return;
        previewUrl = global.URL.createObjectURL(result.data);
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = media.purpose === 'after' ? 'Фото после сеанса' : 'Фото до сеанса';
        stage.replaceChildren(image);
      } catch (error) {
        stage.innerHTML = `<p class="is-error" role="alert">${escapeHtml(message(error))}</p>`;
      }
    }

    async function selectMedia(input) {
      const purpose = mediaPurpose(input.dataset.visitResultMediaInput);
      const file = input.files?.[0];
      if (!file) {
        pendingFiles.delete(purpose);
        refreshEditorSummary();
        return;
      }
      const revision = editor?.revision;
      preparingFiles += 1;
      setEditorStatus('Подготавливаем фото без EXIF…');
      try {
        const prepared = await prepareImage(file);
        if (!editor || editor.revision !== revision) return;
        pendingFiles.set(purpose, {
          id: uuid(), purpose, prepared,
          key: `${file.name}:${file.size}:${file.lastModified}`
        });
        editor.dirty = true;
        setEditorStatus(`Фото ${purpose === 'after' ? 'после' : 'до'} подготовлено. Сохраните результат.`);
      } catch (error) {
        if (editor?.revision === revision) {
          input.value = '';
          setEditorStatus(message(error), true);
        }
      } finally {
        preparingFiles = Math.max(0, preparingFiles - 1);
        refreshEditorSummary();
      }
    }

    async function uploadPendingMedia(resultId) {
      const uploaded = [];
      for (const [purpose, pending] of pendingFiles) {
        const prepared = pending.prepared;
        const record = await rpc('create_minuta_client_result_media_v120', {
          p_organization: organization.id,
          p_phone: editor.phone,
          p_result: resultId,
          p_id: pending.id,
          p_purpose: purpose,
          p_mime_type: prepared.mime_type,
          p_byte_size: prepared.byte_size
        });
        if (!record?.ready) {
          const response = await db.storage.from(BUCKET).upload(record.object_path, prepared.blob, {
            contentType: prepared.mime_type,
            cacheControl: '0',
            upsert: false
          });
          if (response?.error && !/already exists|duplicate/i.test(response.error.message || '')) throw response.error;
          await rpc('complete_minuta_client_result_media_v120', { p_id: pending.id });
        }
        uploaded.push(normalizeMedia({ ...record, id: pending.id, purpose, mime_type: prepared.mime_type, byte_size: prepared.byte_size }));
        pendingFiles.delete(purpose);
      }
      return uploaded.filter(Boolean);
    }

    function collectEditor() {
      const details = editor?.form?.querySelector('#bookingVisitResultFields');
      if (!details || details.hasAttribute('data-client-results-disabled')) return null;
      const values = Object.fromEntries(FIELD_DEFINITIONS.map(([key]) => [key, visibleText(details.querySelector(`[name="client_result_${key}"]`)?.value)]));
      return {
        details,
        ...values,
        private_storage_consent: details.querySelector('[name="client_result_private_consent"]')?.checked === true,
        external_share_consent: details.querySelector('[name="client_result_external_consent"]')?.checked === true
      };
    }

    async function save(input = {}) {
      if (!editor?.form || !organization?.id || !requireWrites()) return { ok: false, optional: true };
      if (!connectionAvailable() || remote?.offline) {
        setEditorStatus('Подключитесь к интернету, чтобы сохранить приватный результат.', true);
        updateEditorSubmitAvailability();
        return { ok: false, reason: 'offline' };
      }
      if (remote?.enabled !== true) return { ok: false, reason: 'access_unavailable' };
      if (preparingFiles > 0) {
        setEditorStatus('Дождитесь подготовки фотографии.', true);
        return { ok: false, reason: 'media_preparing' };
      }
      const values = collectEditor();
      if (!values) return { ok: true, skipped: true };
      const hasPayload = FIELD_DEFINITIONS.some(([key]) => values[key]) || pendingFiles.size > 0 || Boolean(editor.result?.id || editor.result?.media?.length);
      if (!hasPayload) return { ok: true, skipped: true };
      if (!values.private_storage_consent) {
        values.details.open = true;
        const consent = values.details.querySelector('[name="client_result_private_consent"]');
        consent.required = true;
        consent.focus();
        setEditorStatus('Подтвердите согласие клиента на приватное хранение.', true);
        return { ok: false, reason: 'private_consent_required' };
      }
      const bookingId = String(input.bookingId || editor.bookingId || editor.form.dataset.bookingId || '');
      const phone = normalizePhone(input.phone || editor.phone || client?.phone);
      if (!UUID.test(bookingId) || !phone) return { ok: true, skipped: true, reason: 'unsupported_booking' };
      const resultId = UUID.test(editor.result?.id) ? editor.result.id : UUID.test(pendingSubmit?.resultId) ? pendingSubmit.resultId : uuid();
      const submitKey = JSON.stringify([bookingId, phone, resultId, ...FIELD_DEFINITIONS.map(([key]) => values[key]), values.private_storage_consent, values.external_share_consent,
        [...pendingFiles].map(([purpose, pending]) => [purpose, pending.id, pending.key])]);
      if (!pendingSubmit || pendingSubmit.key !== submitKey) pendingSubmit = { key: submitKey, request: uuid(), resultId };
      setEditorStatus('Сохраняем приватный результат…');
      try {
        const data = await rpc('save_minuta_client_result_v120', {
          p_organization: organization.id,
          p_phone: phone,
          p_booking: bookingId,
          p_id: resultId,
          p_request: pendingSubmit.request,
          p_before_session: values.before_session,
          p_work_done: values.work_done,
          p_after_session: values.after_session,
          p_recommendations: values.recommendations,
          p_private_storage_consent: true,
          p_external_share_consent: values.external_share_consent
        });
        const request = pendingSubmit.request;
        const metadata = data?.result || data || {};
        const returned = normalizeResult({
          ...(editor.result || {}),
          ...values,
          id: String(metadata.id || resultId),
          booking_id: bookingId,
          private_storage_consent: metadata.private_storage_consent !== false,
          external_share_consent: metadata.external_share_consent === true,
          media: editor.result?.media || []
        });
        if (!returned.id) returned.id = resultId;
        if (!returned.booking_id) returned.booking_id = bookingId;
        pendingSubmit = null;
        editor.result = returned;
        const uploaded = await uploadPendingMedia(returned.id);
        returned.media = [...(returned.media || []), ...uploaded];
        editor.result = returned;
        editor.dirty = false;
        renderEditor(returned);
        if (client?.phone === phone) {
          const index = rows.findIndex(item => item.id === returned.id || item.booking_id === bookingId);
          if (index >= 0) rows.splice(index, 1, returned); else rows.unshift(returned);
          rows.sort((left, right) => `${right.visit_at}${right.updated_at}`.localeCompare(`${left.visit_at}${left.updated_at}`));
          renderProfile(profileHost?.open === true);
        }
        setEditorStatus('Результат сохранён приватно.');
        notify('Результат сеанса сохранён');
        return { ok: true, result: returned, request };
      } catch (error) {
        setEditorStatus(message(error), true);
        return { ok: false, error, pending: true };
      }
    }

    function mount(context = {}) {
      bind();
      ensureProfileHost();
      ensurePreviewDialog();
      const form = context.form || document.querySelector('#bookingOutcomeForm');
      const booking = context.booking || context.item || {};
      if (!form && !context.bookingId && !booking.id) return;
      const bookingId = String(context.bookingId || booking.id || form?.dataset.bookingId || '');
      const phone = normalizePhone(context.phone || booking.client_phone || booking.clientPhone || client?.phone);
      if (editor?.bookingId !== bookingId) {
        pendingSubmit = null;
        pendingFiles.clear();
        preparingFiles = 0;
      }
      editor = {
        form,
        bookingId,
        phone,
        result: normalizeResult(context.result) || normalizeResult({ booking_id: bookingId }),
        dirty: false,
        expandEditor: context.expandEditor === true,
        revision: (editor?.revision || 0) + 1
      };
      renderEditor(editor.result);
      void loadBookingResult();
    }

    function bind() {
      if (bound) return;
      bound = true;
      document.addEventListener('toggle', event => {
        if (event.target === profileHost) {
          if (profileHost.open) {
            renderProfile(true);
            if (!remote && !loading) void loadResults(false);
          } else renderProfile(false);
        }
        if (event.target?.id === 'bookingVisitResultFields' && !event.target.open) closePreview();
      }, true);
      document.addEventListener('input', event => {
        if (!event.target.closest?.('#bookingVisitResultFields')) return;
        editor.dirty = true;
        refreshEditorSummary();
      });
      document.addEventListener('change', event => {
        if (event.target.matches?.('[data-visit-result-media-input]')) void selectMedia(event.target);
      });
      document.addEventListener('click', event => {
        const preview = event.target.closest?.('[data-client-result-preview]');
        const close = event.target.closest?.('[data-client-result-preview-close]');
        const enable = event.target.closest?.('[data-client-results-enable]');
        const moreButton = event.target.closest?.('[data-client-results-more]');
        const addButton = event.target.closest?.('[data-client-results-add]');
        const bookingButton = event.target.closest?.('[data-client-result-open-booking]');
        if (preview) void openPrivatePreview(preview.dataset.clientResultPreview);
        if (close) closePreview();
        if (enable) void enableResults();
        if (moreButton) {
          visibleLimit += 10;
          if (visibleLimit >= rows.length && more) void loadResults(true); else renderProfile(true);
        }
        if (addButton) openPreferredBooking();
        if (bookingButton) openBooking(bookingButton.dataset.clientResultOpenBooking);
      });
      global.addEventListener?.('offline', () => {
        if (remote?.enabled === true && !remote?.offline) remoteBeforeOffline = remote;
        loading = false;
        remote = offlineRemote();
        renderProfile(profileHost?.open === true);
        if (editor && !editor.dirty) renderEditor(editor.result);
        else {
          updateEditorSubmitAvailability();
          setEditorStatus('Подключитесь к интернету, чтобы сохранить приватный результат.', true);
        }
      });
      global.addEventListener?.('online', () => {
        if (!remote?.offline) return;
        if (editor?.dirty && remoteBeforeOffline?.enabled === true) {
          remote = remoteBeforeOffline;
          remoteBeforeOffline = null;
          updateEditorSubmitAvailability();
          setEditorStatus('Интернет восстановлен. Сохраните результат.');
          return;
        }
        remoteBeforeOffline = null;
        remote = null;
        if (editor) {
          renderEditor(editor.result);
          void loadBookingResult();
        }
        if (profileHost?.open && client?.phone) void loadResults(false);
        else renderProfile(false);
      });
    }

    function clearClient() {
      generation += 1;
      client = null;
      rows = [];
      remote = null;
      remoteBeforeOffline = null;
      loading = false;
      more = false;
      offset = 0;
      visibleLimit = INITIAL_VISIBLE;
      pendingSubmit = null;
      pendingFiles.clear();
      preparingFiles = 0;
      editor = null;
      mediaIndex.clear();
      closePreview();
      if (profileHost) {
        profileHost.open = false;
        profileHost.hidden = true;
        profileHost.querySelector('#clientResultsList')?.replaceChildren();
      }
    }

    function setClient(value) {
      bind();
      ensureProfileHost();
      const phone = normalizePhone(value?.phone);
      if (!phone) {
        clearClient();
        return;
      }
      if (client?.phone === phone) {
        client = { ...client, ...value, phone };
        return;
      }
      clearClient();
      client = { ...(value || {}), phone };
      profileHost.hidden = false;
      profileSummary();
      void loadResults(false);
    }

    function setOrganization(value) {
      bind();
      ensureProfileHost();
      if (organization?.id === value?.id) {
        organization = value || null;
        return;
      }
      clearClient();
      organization = value || null;
    }

    function reset() {
      clearClient();
      organization = null;
    }

    const api = {
      bookingFieldsMarkup: input => bookingFieldsMarkup({ ...input, enabled: input?.enabled ?? remote?.enabled, can_enable: input?.can_enable ?? remote?.can_enable, unavailable: input?.unavailable ?? remote?.unavailable }),
      mount,
      save,
      setClient,
      setOrganization,
      reset
    };
    return api;
  }

  global.MinutaClientResults = { createController, bookingFieldsMarkup };
})(window);
