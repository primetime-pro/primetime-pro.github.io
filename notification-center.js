(function initMinutaNotificationCenter(global) {
  'use strict';

  const CHANNEL_LABELS = { telegram:'Telegram', max:'MAX', whatsapp:'WhatsApp', sms:'SMS', vk:'VK', email:'Email', push:'Push' };
  const AUDIENCE_LABELS = { provider:'Команде', client:'Клиентам' };
  const STATUS_LABELS = { pending:'в очереди', sending:'передаётся каналу', sent:'передано каналу', failed:'ошибка', cancelled:'отменено' };
  const EVENT_LABELS = {
    booking_created:'Запись создана', booking_confirmed:'Запись подтверждена',
    booking_rescheduled:'Запись перенесена', booking_cancelled:'Запись отменена',
    booking_reminder:'Напоминание', booking_confirmation_request:'Запрос подтверждения записи'
  };
  const EVENT_GROUPS = [
    { title:'При записи', items:[
      { key:'booking_created', setting:'booking_created_enabled', title:'Новая запись', timing:'Сразу после создания', template:'Данные записи и контакты клиента', preview:'Новая запись: имя, услуга, дата и время.' },
      { key:'booking_confirmed', setting:'booking_confirmed_enabled', title:'Подтверждение', timing:'Сразу после подтверждения', template:'Шаблон подтверждения', preview:'Запись подтверждена. Клиент видит услугу, дату и время.' }
    ] },
    { title:'Перед визитом', items:[
      { key:'booking_confirmation_request', setting:'booking_confirmation_request_enabled', title:'Запрос подтверждения', timingSetting:'confirmation_request_minutes_before', template:'Запрос подтверждения', preview:'Пожалуйста, подтвердите, что запись остаётся в силе.' },
      { key:'booking_reminder', setting:'booking_reminder_enabled', title:'Напоминание', timingSetting:'reminder_minutes_before', template:'Шаблон напоминания', preview:'Напоминание о предстоящем визите.' },
      { key:'booking_rescheduled', setting:'booking_rescheduled_enabled', title:'Перенос', timing:'Сразу после изменения', template:'Новые дата и время', preview:'Дата или время записи изменены.' },
      { key:'booking_cancelled', setting:'booking_cancelled_enabled', title:'Отмена', timing:'Сразу после отмены', template:'Шаблон отмены', preview:'Запись отменена. Повторное приглашение автоматически не отправляется.' }
    ] },
    { title:'После визита', items:[
      { key:'review_request', title:'Просьба об отзыве', locked:true, badge:'Доступно в Pro', reason:'Планировщик и отдельное согласие клиента ещё не подключены.', timing:'После завершённого визита', template:'Будущий шаблон отзыва', preview:'Сейчас сообщения не создаются.' }
    ] },
    { title:'Возвращаемость', items:[
      { key:'repeat_visit', title:'Повторный визит', locked:true, badge:'Доступно в Pro', reason:'Маркетинговые события выключены до явного согласия клиента.', timing:'Только по настроенному интервалу', template:'Будущий шаблон возвращения', preview:'Сейчас сообщения не создаются.' },
      { key:'birthday', title:'День рождения', locked:true, badge:'Доступно в Pro', reason:'Нужны дата рождения и отдельное согласие на поздравления.', timing:'По расписанию и часовому поясу', template:'Будущий шаблон поздравления', preview:'Сейчас сообщения не создаются.' }
    ] }
  ];
  const CHANNEL_CATALOG = ['telegram','max','whatsapp','sms','vk','email','push'];
  const CHANNELS = new Set(Object.keys(CHANNEL_LABELS));
  const AUDIENCES = new Set(Object.keys(AUDIENCE_LABELS));
  const OUTBOX_STATUSES = new Set(Object.keys(STATUS_LABELS));
  const ORGANIZATION_ROLES = new Set(['owner', 'admin', 'specialist']);

  function record(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function nonEmptyText(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function unique(items, key) {
    const values = items.map(key);
    return new Set(values).size === values.length;
  }

  function normalizeWorkspace(value, organizationId, currentUserId) {
    // The RPC is security-definer. Never infer tenant, role, delivery state or
    // channel readiness from a partial/foreign response.
    if (!record(value)
      || !nonEmptyText(value.organization_id)
      || value.organization_id !== organizationId
      || !ORGANIZATION_ROLES.has(value.current_role)
      || !record(value.settings)
      || value.settings.organization_id !== organizationId
      || typeof value.settings.enabled !== 'boolean') return null;
    for (const field of ['channels', 'endpoints', 'outbox']) if (!Array.isArray(value[field])) return null;

    if (value.channels.some(item => !record(item)
      || item.organization_id !== organizationId
      || !AUDIENCES.has(item.audience)
      || !CHANNELS.has(item.channel)
      || typeof item.enabled !== 'boolean')
      || !unique(value.channels, item => `${item.audience}:${item.channel}`)) return null;

    if (value.endpoints.some(item => !record(item)
      || !AUDIENCES.has(item.audience)
      || !nonEmptyText(item.subject_key)
      || !CHANNELS.has(item.channel)
      || typeof item.active !== 'boolean'
      || typeof item.configured !== 'boolean')
      || !unique(value.endpoints, item => `${item.audience}:${item.subject_key}:${item.channel}`)) return null;

    if (value.outbox.some(item => !record(item)
      || !nonEmptyText(item.id)
      || !nonEmptyText(item.performer_id)
      || !nonEmptyText(item.kind)
      || !AUDIENCES.has(item.audience)
      || !CHANNELS.has(item.channel)
      || !OUTBOX_STATUSES.has(item.status)
      || !Number.isSafeInteger(item.attempts)
      || item.attempts < 0
      || (item.context != null && !record(item.context)))
      || !unique(value.outbox, item => item.id)) return null;

    if (value.current_role === 'specialist' && (!nonEmptyText(currentUserId)
      || value.endpoints.some(item => item.audience !== 'provider' || item.subject_key !== currentUserId)
      || value.outbox.some(item => item.performer_id !== currentUserId))) return null;

    return {
      ...value,
      settings:{ ...value.settings },
      channels:value.channels.map(item => ({ ...item })),
      endpoints:value.endpoints.map(item => ({ ...item })),
      outbox:value.outbox.map(item => ({ ...item, context:record(item.context) ? { ...item.context } : {} }))
    };
  }

  function formatMoment(value) {
    if (!value) return '';
    const moment = new Date(value);
    return Number.isNaN(moment.getTime()) ? '' : moment.toLocaleString('ru-RU', { dateStyle:'short', timeStyle:'short' });
  }

  function deliveryStatus(item) {
    const deliveryUnknown = item.status === 'failed' && item.last_error_code === 'telegram_delivery_unknown';
    const attempts = Math.max(0, Number(item.attempts) || 0);
    if (item.delivered_at) return {
      label:'доставлено',
      detail:`Подтверждено каналом${formatMoment(item.delivered_at) ? ` · ${formatMoment(item.delivered_at)}` : ''}`,
      deliveryUnknown:false
    };
    if (deliveryUnknown) return {
      label:'нужна проверка',
      detail:'Telegram мог принять сообщение; автоматический повтор отключён',
      deliveryUnknown:true
    };
    if (item.status === 'sent') return {
      label:'передано каналу',
      detail:`Подтверждения доставки нет${formatMoment(item.sent_at) ? ` · передано ${formatMoment(item.sent_at)}` : ''}`,
      deliveryUnknown:false
    };
    if (item.status === 'sending') return {
      label:STATUS_LABELS.sending,
      detail:`Попытка ${Math.max(1, attempts)}`,
      deliveryUnknown:false
    };
    if (item.status === 'pending') return {
      label:STATUS_LABELS.pending,
      detail:`Попыток: ${attempts}${formatMoment(item.next_attempt_at) ? ` · следующая ${formatMoment(item.next_attempt_at)}` : ''}`,
      deliveryUnknown:false
    };
    if (item.status === 'failed') return {
      label:STATUS_LABELS.failed,
      detail:`Попыток: ${attempts}${formatMoment(item.updated_at) ? ` · ${formatMoment(item.updated_at)}` : ''}`,
      deliveryUnknown:false
    };
    return { label:STATUS_LABELS[item.status] || item.status, detail:'', deliveryUnknown:false };
  }

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    let organization = null;
    let payload = null;
    let available = null;
    let deliveryHealth = null;
    let currentUserId = '';
    let busy = false;
    let revision = 0;
    let unavailableMessage = '';
    let activeTab = 'events';
    let deliveryFilter = 'attention';
    let draftMaster = false;
    let draftChannels = new Map();
    let dirty = false;

    function missing(error) {
      return /PGRST202|42883|get_minuta_notification_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function manager() { return ['owner', 'admin'].includes(String(payload?.current_role || '')); }
    function channelKey(audience, channel) { return `${audience}:${channel}`; }
    function resetDraft() {
      draftMaster = Boolean(payload?.settings?.enabled);
      draftChannels = new Map((payload?.channels || []).map(item => [channelKey(item.audience, item.channel), Boolean(item.enabled)]));
      dirty = false;
    }
    function setDirty(value = true) {
      dirty = value;
      const save = $('#saveUnifiedNotifications');
      const state = $('#unifiedNotificationSaveState');
      if (save) save.disabled = busy || !manager() || !dirty;
      if (state) state.textContent = dirty ? 'Есть несохранённые изменения' : 'Изменений нет';
    }
    function endpointConfigured(audience, channel) {
      return (payload?.endpoints || []).some((item) => item.audience === audience && item.channel === channel && item.active && item.configured);
    }
    function gatewayConfigured(channel) {
      return deliveryHealth?.configured_channels?.includes(channel) === true;
    }
    function providerFallbackConfigured(audience, channel) {
      return audience === 'provider' && channel === 'telegram' && deliveryHealth?.provider_telegram_fallback === true;
    }
    function channelState(item) {
      const recipient = endpointConfigured(item.audience, item.channel) || providerFallbackConfigured(item.audience, item.channel);
      const gateway = gatewayConfigured(item.channel);
      if (deliveryHealth === null) return { recipient, gateway:false, ready:false, note:'Проверяем шлюз канала…' };
      if (deliveryHealth.unavailable) return { recipient, gateway:false, ready:false, note:'Не удалось проверить шлюз канала' };
      if (!gateway) return { recipient, gateway:false, ready:false, note:'Шлюз канала не настроен' };
      if (!recipient) return {
        recipient:false, gateway:true, ready:false,
        note:item.audience === 'client' ? 'Клиент подключает канал сам после записи' : 'Получатель не подключён'
      };
      return { recipient:true, gateway:true, ready:true, note:item.enabled ? 'Подключён и включён' : 'Подключён · выключён' };
    }
    function channelCost(channel) {
      if (channel === 'sms') return 'Стоимость каждого SMS задаёт выбранный провайдер и подтверждает до активации.';
      if (channel === 'whatsapp') return 'Требуются WhatsApp Cloud API, бизнес-аккаунт, согласие и одобренные шаблоны; стоимость внешняя.';
      return '';
    }
    function unsupportedChannel(channel) {
      if (channel === 'whatsapp') return 'Официальный Cloud API ещё не подключён к серверной очереди.';
      if (channel === 'vk') return 'Нужны сообщество VK, разрешение клиента и проверка webhook.';
      return '';
    }
    function channelRows(channel) {
      return (payload?.channels || []).filter(item => item.channel === channel);
    }
    function channelSummary(channel) {
      const unsupported = unsupportedChannel(channel);
      if (unsupported) return { label:'Недоступен', tone:'unavailable', detail:unsupported };
      const rows = channelRows(channel);
      if (!rows.length) return { label:'Недоступен', tone:'unavailable', detail:'Канал не поддерживается текущим серверным контрактом.' };
      const states = rows.map(channelState);
      if (states.some(state => state.ready)) return {
        label:'Подключён', tone:'connected',
        detail:states.every(state => state.ready) ? 'Сервер и получатели подтверждены.' : 'Подключён не для всех получателей.'
      };
      const detail = states.find(state => state.note)?.note || 'Требуется подключение.';
      return { label:'Нужно подключить', tone:'setup', detail };
    }
    function enabledChannelNames() {
      const names = new Set();
      for (const item of payload?.channels || []) {
        const enabled = draftChannels.has(channelKey(item.audience, item.channel))
          ? draftChannels.get(channelKey(item.audience, item.channel)) : item.enabled;
        if (enabled && channelState(item).ready) names.add(CHANNEL_LABELS[item.channel] || item.channel);
      }
      return [...names];
    }
    function eventTiming(item) {
      if (item.timing) return item.timing;
      const minutes = Number(payload?.settings?.[item.timingSetting]) || 0;
      if (!minutes) return 'По серверному расписанию';
      if (minutes % 1440 === 0) return `За ${minutes / 1440} дн. до визита`;
      if (minutes % 60 === 0) return `За ${minutes / 60} ч. до визита`;
      return `За ${minutes} мин. до визита`;
    }
    function setBusy(value) {
      busy = value;
      $('#unifiedNotificationPanel')?.querySelectorAll('button,input').forEach((item) => {
        item.disabled = value || item.dataset.requiresEndpoint === 'true' || (item.dataset.managerOnly === 'true' && !manager());
      });
      setDirty(dirty);
    }
    function reset() {
      revision += 1;
      organization = null; payload = null; available = null; deliveryHealth = null; currentUserId = ''; busy = false; unavailableMessage = '';
      activeTab = 'events'; deliveryFilter = 'attention'; draftMaster = false; draftChannels = new Map(); dirty = false;
      if ($('#unifiedNotificationPanel')) $('#unifiedNotificationPanel').hidden = true;
    }
    function current(requestRevision, organizationId) {
      return requestRevision === revision && organization?.id === organizationId;
    }
    async function loadDeliveryHealth() {
      try {
        const { data } = await db.auth.getUser();
        const userId = data?.user?.id || '';
        const base = String(global.MINUTA_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
        if (!base || !userId) return { health:null, userId };
        const url = new URL(`${base}/functions/v1/notification-dispatcher`);
        url.searchParams.set('performer_id', userId);
        const response = await fetch(url, {
          headers:{ apikey:String(global.MINUTA_CONFIG?.supabaseKey || '') },
          cache:'no-store'
        });
        const result = await response.json().catch(() => null);
        return { health:response.ok && result?.ok ? result : null, userId };
      } catch { return { health:null, userId:'' }; }
    }
    async function load() {
      if (!organization) return;
      const organizationId = organization.id;
      const requestRevision = ++revision;
      let result;
      let health;
      try {
        [result, health] = await Promise.all([
          db.rpc('get_minuta_notification_workspace', { p_organization:organizationId }),
          loadDeliveryHealth()
        ]);
      } catch (error) {
        if (!current(requestRevision, organizationId)) return;
        payload = null;
        available = null;
        deliveryHealth = { unavailable:true, configured_channels:[] };
        currentUserId = '';
        unavailableMessage = 'Центр каналов временно недоступен. Старые уведомления продолжают работать.';
        render(error);
        return;
      }
      if (!current(requestRevision, organizationId)) return;
      currentUserId = health.userId;
      deliveryHealth = health.health || { unavailable:true, configured_channels:[] };
      if (!record(result)) {
        payload = null;
        available = null;
        unavailableMessage = 'Сервер вернул неполный ответ центра уведомлений. Изменения заблокированы.';
        render(new Error('notification_workspace_response_missing'));
        return;
      }
      if (result.error) {
        payload = null;
        available = missing(result.error) ? false : null;
        unavailableMessage = available === false ? '' : 'Центр каналов временно недоступен. Старые уведомления продолжают работать.';
        render(result.error);
        return;
      }
      const normalized = normalizeWorkspace(result.data, organizationId, currentUserId);
      if (!normalized) {
        payload = null;
        available = null;
        unavailableMessage = record(result.data) && Object.prototype.hasOwnProperty.call(result.data, 'organization_id')
          && String(result.data.organization_id || '') !== organizationId
          ? 'Сервер вернул данные другой организации. Изменения заблокированы.'
          : 'Сервер вернул неполные данные центра уведомлений. Изменения заблокированы.';
        render(new Error('notification_workspace_invalid'));
        return;
      }
      available = true;
      unavailableMessage = '';
      payload = normalized;
      resetDraft();
      render();
    }
    async function setOrganization(next) {
      revision += 1;
      organization = next?.id ? next : null;
      payload = null; available = null; deliveryHealth = null; currentUserId = ''; busy = false; unavailableMessage = '';
      activeTab = 'events'; deliveryFilter = 'attention'; draftMaster = false; draftChannels = new Map(); dirty = false;
      if (!organization) { reset(); return; }
      render();
      await load();
    }
    function render(error = null) {
      const panel = $('#unifiedNotificationPanel');
      if (!panel) return;
      panel.hidden = !organization || available === false;
      if (panel.hidden) { global.refreshSectionNavigation?.(); return; }
      $('#unifiedNotificationUnavailable').hidden = available !== null;
      $('#unifiedNotificationWorkspace').hidden = available !== true;
      if (available !== true) {
        $('#unifiedNotificationUnavailableText').textContent = error ? unavailableMessage : '';
        global.refreshSectionNavigation?.();
        return;
      }
      $('#unifiedNotificationPanel').querySelectorAll('[data-unified-tab]').forEach(button => {
        const selected = button.dataset.unifiedTab === activeTab;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
      });
      $('#unifiedNotificationPanel').querySelectorAll('[data-unified-page]').forEach(page => {
        page.hidden = page.dataset.unifiedPage !== activeTab;
      });
      const enabled = draftMaster;
      $('#unifiedNotificationsEnabled').checked = enabled;
      $('#unifiedNotificationsEnabled').dataset.managerOnly = 'true';
      $('#unifiedNotificationsEnabled').disabled = !manager() || busy;
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      const readyChannels = channels.filter(item => channelState(item).ready);
      const activeChannels = readyChannels.filter(item => draftChannels.get(channelKey(item.audience, item.channel)) === true);
      $('#unifiedNotificationState').textContent = enabled
        ? (activeChannels.length ? `Работает · ${activeChannels.length}` : 'Нужен канал')
        : 'Выключена';
      const routeNames = enabledChannelNames();
      $('#unifiedNotificationEvents').innerHTML = EVENT_GROUPS.map(group => `<section class="smart-event-group"><h4>${escapeHtml(group.title)}</h4><div>${group.items.map(item => {
        const eventEnabled = item.locked ? false : Boolean(payload?.settings?.[item.setting]);
        const status = item.locked ? item.badge : (eventEnabled ? 'Включено' : 'Выключено');
        const recipient = item.locked ? 'Только после отдельного согласия клиента' : 'Клиентам и команде по разрешённым правилам';
        const route = item.locked ? 'Нет активного маршрута' : (routeNames.length ? routeNames.join(' → ') : 'Подключённый канал не выбран');
        return `<details class="smart-event-row${item.locked ? ' is-locked' : ''}"><summary><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.locked ? item.reason : eventTiming(item))}</small></span><em>${escapeHtml(status)}</em><b aria-hidden="true">›</b></summary><div class="smart-event-detail"><dl><div><dt>Получатель</dt><dd>${escapeHtml(recipient)}</dd></div><div><dt>Когда</dt><dd>${escapeHtml(eventTiming(item))}</dd></div><div><dt>Каналы</dt><dd>${escapeHtml(route)}</dd></div><div><dt>Шаблон</dt><dd>${escapeHtml(item.template)}</dd></div></dl><p><small>Предпросмотр</small>${escapeHtml(item.preview)}</p></div></details>`;
      }).join('')}</div></section>`).join('');
      $('#unifiedNotificationChannels').innerHTML = CHANNEL_CATALOG.map(channel => {
        const summary = channelSummary(channel);
        const rows = channelRows(channel);
        const controls = rows.map(item => {
          const state = channelState(item);
          const canToggle = manager() && state.ready;
          const checked = draftChannels.get(channelKey(item.audience, item.channel)) === true;
          return `<label class="smart-channel-toggle"><input type="checkbox" data-manager-only="true" data-unified-audience="${escapeHtml(item.audience)}" data-unified-channel="${escapeHtml(item.channel)}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled data-requires-endpoint="true"'}><span><strong>${escapeHtml(AUDIENCE_LABELS[item.audience] || item.audience)}</strong><small>${escapeHtml(state.note)}</small></span></label>`;
        }).join('');
        const cost = channelCost(channel);
        return `<article class="smart-channel-row" data-channel-state="${escapeHtml(summary.tone)}"><div class="smart-channel-title"><span><strong>${escapeHtml(CHANNEL_LABELS[channel] || channel)}</strong><small>${escapeHtml(summary.detail)}</small></span><em>${escapeHtml(summary.label)}</em></div>${controls ? `<div class="smart-channel-controls">${controls}</div>` : ''}${cost ? `<p>${escapeHtml(cost)}</p>` : ''}</article>`;
      }).join('');
      const outbox = Array.isArray(payload.outbox) ? payload.outbox : [];
      const outboxById = new Map(outbox.map(item => [String(item.id || ''), item]));
      $('#unifiedNotificationPanel').querySelectorAll('[data-unified-delivery-filter]').forEach(button => {
        const selected = button.dataset.unifiedDeliveryFilter === deliveryFilter;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      const filteredOutbox = outbox.filter(item => {
        if (deliveryFilter === 'all') return true;
        if (deliveryFilter === 'delivered') return Boolean(item.delivered_at);
        if (deliveryFilter === 'transit') return !item.delivered_at && ['pending','sending','sent'].includes(item.status);
        return item.status === 'failed' || item.status === 'cancelled' || item.last_error_code === 'telegram_delivery_unknown';
      });
      $('#unifiedNotificationDeliveries').innerHTML = filteredOutbox.length ? filteredOutbox.map((item) => {
        const state = deliveryStatus(item);
        const context = item.context || {};
        const appointment = [context.client_name, context.service_name, context.booking_date, String(context.booking_time || '').slice(0,5)].filter(Boolean).join(' · ');
        const failureText = state.deliveryUnknown
          ? 'Проверьте чат вручную'
          : item.last_error;
        const error = ((item.status === 'failed' && failureText) || (item.status === 'cancelled' && item.last_error))
          ? ` · ${item.status === 'cancelled' ? item.last_error : failureText}`
          : '';
        const fallbackSource = item.fallback_of ? outboxById.get(String(item.fallback_of)) : null;
        const fallback = item.fallback_depth === 1 || item.fallback_of
          ? `Резервный канал${fallbackSource ? ` после ${CHANNEL_LABELS[fallbackSource.channel] || fallbackSource.channel}` : ''}`
          : '';
        const details = [appointment || formatMoment(item.created_at), state.detail, fallback].filter(Boolean).join(' · ');
        const retry = item.status === 'failed' && !state.deliveryUnknown
          ? `<button class="secondary-button" style="min-height:44px" type="button" data-unified-retry="${escapeHtml(item.id)}">Повторить</button>`
          : '';
        return `<article class="organization-audit-data-row smart-delivery-row"><div><strong>${escapeHtml(CHANNEL_LABELS[item.channel] || item.channel)} · ${escapeHtml(EVENT_LABELS[item.kind] || item.kind)}</strong><small>${escapeHtml(details)}${escapeHtml(error)}</small></div><span><em>${escapeHtml(state.label)}</em>${retry}</span></article>`;
      }).join('')
        : `<div class="provider-empty compact-empty"><strong>${deliveryFilter === 'attention' ? 'Ошибок, требующих внимания, нет' : 'В этой группе пока пусто'}</strong><small>Здесь показываются только подтверждённые сервером попытки доставки.</small></div>`;
      setBusy(busy);
      setDirty(dirty);
      global.refreshSectionNavigation?.();
    }
    function change(event) {
      if (!organization || !manager() || busy) return;
      if (event.target.id === 'unifiedNotificationsEnabled') {
        draftMaster = event.target.checked;
        setDirty();
        render();
        return;
      }
      if (!event.target.matches('[data-unified-channel]')) return;
      const audience = event.target.dataset.unifiedAudience;
      const channel = event.target.dataset.unifiedChannel;
      draftChannels.set(channelKey(audience, channel), event.target.checked);
      setDirty();
      render();
    }
    async function save() {
      if (!organization || !manager() || busy || !dirty || !requireWrites()) return;
      const organizationId = organization.id;
      const operationRevision = revision;
      const changedChannels = (payload?.channels || []).filter(item =>
        Boolean(item.enabled) !== Boolean(draftChannels.get(channelKey(item.audience, item.channel))));
      const masterChanged = Boolean(payload?.settings?.enabled) !== draftMaster;
      let normalized = payload;
      let saved = 0;
      setBusy(true);
      try {
        for (const item of changedChannels) {
          const result = await db.rpc('set_minuta_notification_channel', {
            p_organization:organizationId,
            p_audience:item.audience,
            p_channel:item.channel,
            p_enabled:Boolean(draftChannels.get(channelKey(item.audience, item.channel)))
          });
          if (result?.error) throw result.error;
          normalized = normalizeWorkspace(result?.data, organizationId, currentUserId);
          if (!normalized) throw new Error('notification_channel_ack_invalid');
          saved += 1;
        }
        if (masterChanged) {
          const result = await db.rpc('set_minuta_notification_master', { p_organization:organizationId, p_enabled:draftMaster });
          if (result?.error) throw result.error;
          normalized = normalizeWorkspace(result?.data, organizationId, currentUserId);
          if (!normalized) throw new Error('notification_master_ack_invalid');
          saved += 1;
        }
      } catch {
        if (!current(operationRevision, organizationId)) return;
        notify(saved ? 'Часть настроек не сохранена. Сверяем состояние.' : 'Не удалось сохранить настройки доставки');
        await load();
        return;
      } finally {
        if (current(operationRevision, organizationId)) setBusy(false);
      }
      if (!current(operationRevision, organizationId)) return;
      payload = normalized;
      resetDraft();
      render();
      notify(saved ? 'Настройки доставки сохранены' : 'Изменений нет');
    }
    async function click(event) {
      const tab = event.target.closest('[data-unified-tab]');
      if (tab) { activeTab = tab.dataset.unifiedTab; render(); return; }
      const filter = event.target.closest('[data-unified-delivery-filter]');
      if (filter) { deliveryFilter = filter.dataset.unifiedDeliveryFilter; render(); return; }
      if (event.target.closest('#saveUnifiedNotifications')) { await save(); return; }
      const retry = event.target.closest('[data-unified-retry]');
      if (!retry || !organization || busy || !requireWrites()) return;
      const organizationId = organization.id;
      const operationRevision = revision;
      setBusy(true);
      let result = null;
      let rejected = false;
      try {
        result = await db.rpc('retry_notification_outbox', { p_outbox:retry.dataset.unifiedRetry });
      } catch {
        rejected = true;
      } finally {
        if (current(operationRevision, organizationId)) setBusy(false);
      }
      if (!current(operationRevision, organizationId)) return;
      if (rejected || result?.error) notify('Не удалось повторить уведомление');
      else if (result?.data !== 'pending') notify('Сервер не подтвердил повтор уведомления');
      else notify('Уведомление возвращено в очередь');
      await load();
    }
    function bind() {
      document.addEventListener('change', change);
      document.addEventListener('click', click);
      $('#reloadUnifiedNotifications')?.addEventListener('click', load);
    }
    return { bind, load, setOrganization, reset };
  }

  global.MinutaNotificationCenter = { createController };
})(window);
