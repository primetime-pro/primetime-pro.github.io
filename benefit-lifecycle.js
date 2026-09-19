(function () {
  'use strict';

  const kindLabels = { visit_pass:'Абонемент', package:'Пакет услуг', certificate:'Сертификат' };
  const statusLabels = { active:'Активен', frozen:'Заморожен', exhausted:'Использован', expired:'Истёк', cancelled:'Отменён' };
  const eventLabels = {
    issued:'Выдан клиенту', reserved:'Зарезервирован для записи', redeemed:'Погашен', released:'Баланс возвращён',
    frozen:'Заморожен', activated:'Разморожен', expired:'Срок истёк', cancelled:'Отменён'
  };

  function createClientController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent } = options;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    const storage = options.storage || window.localStorage;
    let organization = null;
    let client = null;
    let payload = null;
    let revision = 0;
    let writing = false;

    function $(selector) { return select(selector); }
    function scopeMatches(data, organizationId, clientId) {
      return Boolean(data && String(data.organization_id || '') === String(organizationId)
        && String(data.client_account_id || '') === String(clientId));
    }
    function rubles(value) { return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`; }
    function dateLabel(value) {
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleDateString('ru-RU');
    }
    function dateTimeLabel(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    }
    function requestKey(instrumentId, action) {
      return `minuta_benefit_lifecycle_v150:${getCurrentUser()?.id || ''}:${organization?.id || ''}:${instrumentId}:${action}`;
    }
    function secureUuid() {
      if (typeof options.createRequestId === 'function') return options.createRequestId();
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      throw new Error('secure_request_id_unavailable');
    }
    function loadIntent(instrumentId, action) {
      const key = requestKey(instrumentId, action);
      const raw = storage.getItem(key);
      if (!raw) return { key, requestId:secureUuid(), fresh:true };
      const value = JSON.parse(raw);
      if (value.organization_id !== organization?.id || value.instrument_id !== instrumentId || value.action !== action || !value.request_id) {
        throw new Error('invalid_lifecycle_intent');
      }
      return { key, requestId:value.request_id, fresh:false };
    }
    function persistIntent(intent, instrumentId, action) {
      const value = JSON.stringify({ organization_id:organization.id, instrument_id:instrumentId, action, request_id:intent.requestId });
      storage.setItem(intent.key, value);
      if (storage.getItem(intent.key) !== value) throw new Error('lifecycle_intent_not_saved');
    }
    function clearIntent(intent) {
      storage.removeItem(intent.key);
    }
    function eventDetails(event, kind) {
      const details = event.details || {};
      const parts = [];
      if (event.event_type === 'activated' && Number(details.extended_days || 0) > 0) parts.push(`срок продлён на ${Number(details.extended_days)} дн.`);
      if (['frozen','activated'].includes(event.event_type) && details.reason) parts.push(details.reason);
      if (event.event_type === 'expired' && details.expires_on) parts.push(`действовал до ${dateLabel(details.expires_on)}`);
      if (['reserved','released'].includes(event.event_type)) {
        const delta = kind === 'certificate' ? Math.abs(Number(event.amount_delta_rub || 0)) : Math.abs(Number(event.visits_delta || 0));
        if (delta) parts.push(kind === 'certificate' ? rubles(delta) : `${delta} посещ.`);
      }
      const balance = kind === 'certificate' ? rubles(event.amount_balance_rub) : `${Number(event.visits_balance || 0)} посещ.`;
      parts.push(`остаток ${balance}`);
      return parts.join(' · ');
    }
    function historyMarkup(item) {
      const history = Array.isArray(item.history) ? item.history : [];
      if (!history.length) return '<p class="client-benefit-history-empty">История действий пока недоступна.</p>';
      return `<details class="client-benefit-history"><summary>История действий · ${history.length}</summary><ol>${history.map(event => `
        <li><span class="client-benefit-history-marker" aria-hidden="true"></span><div><strong>${escapeHtml(eventLabels[event.event_type] || event.event_type)}</strong>
        <small>${escapeHtml(dateTimeLabel(event.created_at))} · ${escapeHtml(event.actor_name || (event.actor_id ? 'Сотрудник' : 'Система'))}</small>
        <span>${escapeHtml(eventDetails(event, item.kind))}</span></div></li>`).join('')}</ol></details>`;
    }
    function instrumentMarkup(item) {
      const balance = item.kind === 'certificate' ? rubles(item.remaining_amount_rub) : `${Number(item.remaining_visits || 0)} посещ.`;
      const allowed = new Set(Array.isArray(item.allowed_actions) ? item.allowed_actions : []);
      const actions = allowed.has('freeze')
        ? `<button class="secondary-button" type="button" data-client-benefit-action="freeze" data-client-benefit-instrument="${escapeHtml(item.id)}">Заморозить</button>`
        : allowed.has('unfreeze')
          ? `<button class="secondary-button" type="button" data-client-benefit-action="unfreeze" data-client-benefit-instrument="${escapeHtml(item.id)}">Разморозить</button>` : '';
      const freezeNote = item.status === 'frozen' && item.current_freeze?.frozen_at
        ? ` · с ${dateTimeLabel(item.current_freeze.frozen_at)}` : '';
      const freezeReason = item.status === 'frozen' && item.current_freeze?.reason ? ` · ${item.current_freeze.reason}` : '';
      const extension = Number(item.total_frozen_days || 0) > 0 ? ` · продлён на ${Number(item.total_frozen_days)} дн.` : '';
      return `<article class="client-benefit-card" data-client-benefit-id="${escapeHtml(item.id)}">
        <div class="client-benefit-card-head"><div><small>${escapeHtml(kindLabels[item.kind] || item.kind)} · ${escapeHtml(item.public_code)}</small>
        <strong>${escapeHtml(item.name || kindLabels[item.kind] || 'Продукт')}</strong></div>
        <span class="client-benefit-status is-${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}${escapeHtml(freezeNote)}${escapeHtml(freezeReason)}</span></div>
        <div class="client-benefit-balance"><span>${escapeHtml(balance)}</span><small>Действует до ${escapeHtml(dateLabel(item.expires_on))}${escapeHtml(extension)}</small></div>
        ${actions ? `<div class="client-benefit-actions">${actions}</div>` : ''}${historyMarkup(item)}
      </article>`;
    }
    function render() {
      const holder = $('#clientBenefitLifecycle');
      const list = $('#clientBenefitLifecycleList');
      if (!holder || !list || !payload) return;
      const instruments = Array.isArray(payload.instruments) ? payload.instruments : [];
      holder.hidden = false;
      $('#clientBenefitLifecycleTitle').textContent = `Абонементы и сертификаты · ${instruments.length}`;
      list.innerHTML = instruments.length ? instruments.map(instrumentMarkup).join('')
        : '<p class="report-empty-inline">Абонементов, пакетов и сертификатов пока нет.</p>';
    }
    function reset() {
      revision += 1;
      organization = null;
      client = null;
      payload = null;
      writing = false;
      const holder = $('#clientBenefitLifecycle');
      if (holder) holder.hidden = true;
    }
    async function load() {
      const holder = $('#clientBenefitLifecycle');
      const list = $('#clientBenefitLifecycleList');
      const organizationId = organization?.id;
      const clientId = client?.clientAccountId;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const current = ++revision;
      if (!holder || !list || !organizationId || !clientId || !userId || !['owner','admin'].includes(organization.current_role)) {
        reset(); return { ok:false, optional:true };
      }
      holder.hidden = false;
      list.innerHTML = '<p class="report-empty-inline">Загружаем абонементы и сертификаты…</p>';
      const { data, error } = await db.rpc('get_minuta_benefit_lifecycle_v150', { p_organization:organizationId, p_client_account:clientId });
      if (!sessionIsCurrent(userId, generation) || current !== revision || organization?.id !== organizationId || client?.clientAccountId !== clientId) return { ok:false, stale:true };
      if (error || !scopeMatches(data, organizationId, clientId)) {
        holder.hidden = true;
        return { ok:false, optional:true, unsupported:/PGRST202|42883|get_minuta_benefit_lifecycle_v150/i.test(`${error?.code || ''} ${error?.message || ''}`) };
      }
      payload = data;
      render();
      return { ok:true };
    }
    async function setClient(nextClient, nextOrganization) {
      client = nextClient?.clientAccountId ? { ...nextClient } : null;
      organization = nextOrganization?.id ? { ...nextOrganization } : null;
      payload = null;
      return load();
    }
    function lifecycleError(error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      const messages = [
        ['release_reserved_benefits_before_freeze','Сначала верните резерв по будущей записи.'],
        ['benefit_expired','Срок продукта уже истёк.'],
        ['benefit_exhausted','Продукт уже полностью использован.'],
        ['invalid_benefit_status_transition','Состояние уже изменилось. Данные обновлены.'],
        ['benefit_lifecycle_request_conflict','Сохранённая операция не совпала с запросом. Обновите карточку.']
      ];
      return messages.find(([key]) => text.includes(key))?.[1] || 'Изменение не подтверждено. Повторите действие — повторная операция не создастся.';
    }
    async function act(button) {
      if (writing || !requireWrites() || !payload || !organization?.id || !client?.clientAccountId) return;
      const action = button.dataset.clientBenefitAction;
      const instrumentId = button.dataset.clientBenefitInstrument;
      if (!['freeze','unfreeze'].includes(action) || !payload.instruments?.some(item => item.id === instrumentId)) return;
      let intent;
      try {
        intent = loadIntent(instrumentId, action);
        if (intent.fresh) persistIntent(intent, instrumentId, action);
      } catch {
        notify('Не удалось сохранить защиту от повтора. Операция не отправлена.');
        return;
      }
      const previous = button.textContent;
      writing = true;
      button.disabled = true;
      button.textContent = 'Сохраняем…';
      let data = null; let error = null;
      try {
        ({ data, error } = await db.rpc('set_minuta_benefit_lifecycle_v150', {
          p_organization:organization.id,p_instrument:instrumentId,p_action:action,p_reason:'',p_request_id:intent.requestId
        }));
      } catch (reason) { error = reason instanceof Error ? reason : { message:String(reason || '') }; }
      writing = false;
      button.textContent = previous;
      if (error) {
        if (['22023','42501','P0002','23505','55000'].includes(error.code)) clearIntent(intent);
        notify(lifecycleError(error));
        await load();
        return;
      }
      if (!data || String(data.organization_id || '') !== String(organization.id) || String(data.id || '') !== String(instrumentId)) {
        notify('Ответ сервера не подтверждён. Повторите действие для безопасной проверки.');
        button.disabled = false;
        return;
      }
      clearIntent(intent);
      notify(action === 'freeze' ? 'Продукт заморожен. Срок поставлен на паузу.' : Number(data.extended_days || 0) > 0
        ? `Продукт активен. Срок продлён на ${Number(data.extended_days)} дн.` : 'Продукт снова активен.');
      await load();
    }
    function bind() {
      $('#clientBenefitLifecycle')?.addEventListener('click', event => {
        const button = event.target.closest('[data-client-benefit-action]');
        if (button) void act(button);
      });
    }
    return { bind, load, reset, setClient, get payload() { return payload; } };
  }

  window.MinutaBenefitLifecycle = Object.freeze({ createClientController });
})();
