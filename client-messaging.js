(function initClientMessaging() {
  'use strict';

  const dialog = document.querySelector('#clientMessagingDialog');
  if (!dialog) return;
  const defaults = Object.freeze({
    reminder:'Здравствуйте, {имя}! Напоминаем о записи на услугу «{услуга}» {дата} в {время}. Адрес: {адрес}.',
    reschedule:'Здравствуйте, {имя}! Ваша запись на услугу «{услуга}» перенесена на {дата} в {время}. Адрес: {адрес}.',
    cancellation:'Здравствуйте, {имя}! Ваша запись на услугу «{услуга}» {дата} в {время} отменена.'
  });
  const persistentKinds = Object.keys(defaults);
  const textArea = dialog.querySelector('#clientMessagingText');
  const preview = dialog.querySelector('#clientMessagingPreview');
  const status = dialog.querySelector('#clientMessagingStatus');
  const templateStatus = dialog.querySelector('#clientMessagingTemplateStatus');
  const nameNode = dialog.querySelector('#clientMessagingName');
  const phoneNode = dialog.querySelector('#clientMessagingPhone');
  const saveButton = dialog.querySelector('#saveClientMessageTemplate');
  const resetButton = dialog.querySelector('#resetClientMessageTemplate');
  const sendChooser = dialog.querySelector('#clientMessagingSendChooser');
  const channels = dialog.querySelector('#clientMessagingChannels');
  const emailButton = dialog.querySelector('[data-message-channel="email"]');
  let dependencies = { db:null, getOrganization:() => null, getCurrentUser:() => null, requireWrites:() => false };
  let recipient = { name:'Клиент', phone:'', email:'', values:{} };
  let selectedKind = 'reminder';
  let templates = new Map();
  let drafts = {};
  let availability = 'idle';
  let openRevision = 0;
  let pendingSave = null;

  function configure(options = {}) { dependencies = { ...dependencies, ...options }; }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    return digits;
  }

  function scope() {
    return { organizationId:String(dependencies.getOrganization?.()?.id || ''), performerId:String(dependencies.getCurrentUser?.()?.id || '') };
  }
  function currentBase(kind = selectedKind) { return templates.get(kind)?.body || defaults[kind] || ''; }
  function renderMessage(source = textArea.value) {
    return Object.entries(recipient.values).reduce((message, [token, value]) => message.split(token).join(value), String(source || ''));
  }
  function setStatus(message) { status.textContent = message; }
  function setTemplateStatus(message) { templateStatus.textContent = message; }

  function renderEditorState() {
    dialog.querySelectorAll('[data-message-preset]').forEach(button => button.classList.toggle('active', button.dataset.messagePreset === selectedKind));
    const persistent = persistentKinds.includes(selectedKind);
    const dirty = persistent && textArea.value !== currentBase();
    saveButton.hidden = !persistent;
    saveButton.disabled = !dirty || availability !== 'ready' || !textArea.value.trim();
    resetButton.hidden = !persistent;
    resetButton.disabled = textArea.value === defaults[selectedKind];
    preview.textContent = renderMessage();
  }

  function selectPreset(kind) {
    if (![...persistentKinds, 'custom'].includes(kind)) return;
    drafts[selectedKind] = textArea.value;
    selectedKind = kind;
    if (!(kind in drafts)) drafts[kind] = kind === 'custom' ? 'Здравствуйте, {имя}!' : currentBase(kind);
    textArea.value = drafts[kind];
    pendingSave = null;
    setTemplateStatus(kind === 'custom'
      ? 'Свой текст используется один раз и не меняет сохранённые шаблоны.'
      : availability === 'loading' ? 'Загружаем личный шаблон…' : availability === 'ready' ? '' : 'Сохранение шаблонов сейчас недоступно.');
    renderEditorState();
    if (kind === 'custom') textArea.focus();
  }

  function validTemplatePayload(data, expectedScope) {
    return data && String(data.organization_id || '') === expectedScope.organizationId
      && String(data.performer_id || '') === expectedScope.performerId && Array.isArray(data.templates);
  }

  async function loadTemplates(revision = openRevision) {
    const expectedScope = scope();
    if (!expectedScope.organizationId || !expectedScope.performerId || !dependencies.db?.rpc) {
      availability = 'unavailable';
      setTemplateStatus('Сохранение шаблонов сейчас недоступно. Текст можно отправить разово.');
      renderEditorState();
      return false;
    }
    availability = 'loading';
    setTemplateStatus('Загружаем личный шаблон…');
    renderEditorState();
    let result;
    try { result = await dependencies.db.rpc('get_provider_message_templates_v161', { p_organization:expectedScope.organizationId }); }
    catch (error) { result = { data:null, error }; }
    const { data, error } = result || {};
    if (revision !== openRevision || scope().organizationId !== expectedScope.organizationId || scope().performerId !== expectedScope.performerId) return false;
    if (error || !validTemplatePayload(data, expectedScope)) {
      availability = 'unavailable';
      setTemplateStatus('Сохранение шаблонов сейчас недоступно. Текст можно отправить разово.');
      renderEditorState();
      return false;
    }
    templates = new Map(data.templates.filter(item => persistentKinds.includes(item?.kind) && typeof item.body === 'string')
      .map(item => [item.kind, { body:item.body, version:Number(item.version) || 1, updatedAt:item.updated_at || '' }]));
    drafts = Object.fromEntries(persistentKinds.map(kind => [kind, currentBase(kind)]));
    availability = 'ready';
    textArea.value = drafts[selectedKind] || '';
    setTemplateStatus(selectedKind === 'custom' ? 'Свой текст используется один раз и не меняет сохранённые шаблоны.' : '');
    renderEditorState();
    return true;
  }

  function makeIdempotencyKey() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function saveTemplate() {
    if (!persistentKinds.includes(selectedKind) || availability !== 'ready' || !dependencies.requireWrites?.()) return false;
    const expectedScope = scope();
    const body = textArea.value.trim();
    if (!body || body.length > 4000) { setTemplateStatus('Шаблон должен содержать от 1 до 4000 знаков.'); return false; }
    const version = templates.get(selectedKind)?.version || 0;
    if (!pendingSave || pendingSave.organizationId !== expectedScope.organizationId || pendingSave.performerId !== expectedScope.performerId
      || pendingSave.kind !== selectedKind || pendingSave.body !== body || pendingSave.version !== version) {
      pendingSave = { ...expectedScope, kind:selectedKind, body, version, idempotencyKey:makeIdempotencyKey() };
    }
    const attempt = pendingSave;
    saveButton.disabled = true;
    setTemplateStatus('Сохраняем шаблон…');
    let result;
    try {
      result = await dependencies.db.rpc('save_provider_message_template_v161', {
        p_organization:attempt.organizationId, p_kind:attempt.kind, p_body:attempt.body,
        p_expected_version:attempt.version, p_idempotency_key:attempt.idempotencyKey
      });
    } catch (error) { result = { data:null, error }; }
    const { data, error } = result || {};
    if (attempt !== pendingSave || scope().organizationId !== attempt.organizationId || scope().performerId !== attempt.performerId) return false;
    if (error) {
      if (String(error.message || '').includes('message_template_version_conflict')) {
        pendingSave = null;
        setTemplateStatus('Шаблон изменился в другой сессии. Загружаем свежую версию…');
        await loadTemplates(openRevision);
      } else {
        setTemplateStatus('Ответ о сохранении не получен. Нажмите ещё раз — повтор безопасен.');
        renderEditorState();
      }
      return false;
    }
    const valid = data && data.saved === true && data.kind === attempt.kind && data.body === attempt.body
      && String(data.organization_id || '') === attempt.organizationId && String(data.performer_id || '') === attempt.performerId
      && Number(data.version) === attempt.version + 1;
    if (!valid) {
      setTemplateStatus('Сервер не подтвердил сохранение. Нажмите ещё раз — повтор безопасен.');
      renderEditorState();
      return false;
    }
    templates.set(attempt.kind, { body:data.body, version:Number(data.version), updatedAt:data.updated_at || '' });
    drafts[attempt.kind] = data.body;
    pendingSave = null;
    setTemplateStatus('Шаблон сохранён для этого мастера на всех устройствах.');
    renderEditorState();
    return true;
  }

  function resetTemplate() {
    if (!persistentKinds.includes(selectedKind)) return;
    const hasCustomChanges = textArea.value !== currentBase();
    if (hasCustomChanges && typeof globalThis.confirm === 'function' && !globalThis.confirm('Заменить текущий текст стандартным?')) return;
    textArea.value = defaults[selectedKind];
    drafts[selectedKind] = textArea.value;
    pendingSave = null;
    setTemplateStatus('Стандартный текст подготовлен. Сохраните его как шаблон.');
    renderEditorState();
  }

  function insertVariable(token) {
    const start = Number.isInteger(textArea.selectionStart) ? textArea.selectionStart : textArea.value.length;
    const end = Number.isInteger(textArea.selectionEnd) ? textArea.selectionEnd : start;
    textArea.value = `${textArea.value.slice(0, start)}${token}${textArea.value.slice(end)}`.slice(0, 4000);
    const caret = Math.min(start + token.length, textArea.value.length);
    textArea.focus();
    textArea.setSelectionRange?.(caret, caret);
    pendingSave = null;
    drafts[selectedKind] = textArea.value;
    renderEditorState();
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch {
      const field = document.createElement('textarea');
      field.value = value; field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.append(field); field.select();
      const copied = document.execCommand('copy');
      field.remove(); return copied;
    }
  }

  function openWebLink(url) {
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    document.body.appendChild(link); link.click(); link.remove();
  }

  function open(button) {
    const phone = normalizePhone(button.dataset.clientPhone);
    if (!phone) return;
    openRevision += 1;
    recipient = {
      name:button.dataset.clientName || 'Клиент', phone, email:String(button.dataset.clientEmail || '').trim(),
      values:{
        '{имя}':button.dataset.clientName || 'клиент', '{услуга}':button.dataset.messageService || 'Услуга',
        '{дата}':button.dataset.messageDate || 'дата не указана', '{время}':button.dataset.messageTime || 'время не указано',
        '{адрес}':button.dataset.messageAddress || 'адрес не указан'
      }
    };
    selectedKind = 'reminder'; templates = new Map(); drafts = {}; pendingSave = null; availability = 'idle';
    nameNode.textContent = recipient.name;
    phoneNode.textContent = `+${recipient.phone}`;
    emailButton.disabled = !recipient.email;
    const emailNote = emailButton.querySelector('[data-message-channel-note]');
    if (emailNote) emailNote.textContent = recipient.email ? recipient.email : 'Нет email клиента';
    channels.hidden = true; sendChooser.setAttribute('aria-expanded', 'false');
    textArea.value = defaults.reminder;
    dialog.showModal();
    setStatus('Выберите приложение только когда текст готов.');
    selectPreset('reminder');
    void loadTemplates(openRevision);
  }

  async function openChannel(channel) {
    const message = renderMessage().trim();
    const phone = recipient.phone;
    if (!phone || !message) { setStatus('Сначала подготовьте сообщение.'); return; }
    if (channel === 'whatsapp') openWebLink(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
    if (channel === 'telegram') openWebLink(`https://t.me/+${phone}?text=${encodeURIComponent(message)}`);
    if (channel === 'sms') {
      const separator = /iPad|iPhone|iPod/.test(navigator.userAgent) ? '&' : '?';
      window.location.assign(`sms:+${phone}${separator}body=${encodeURIComponent(message)}`);
    }
    if (channel === 'email') {
      if (!recipient.email) { setStatus('У клиента не указан email.'); return; }
      openWebLink(`mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent('Сообщение о записи')}&body=${encodeURIComponent(message)}`);
    }
    if (channel === 'max') openWebLink(`https://max.ru/:share?text=${encodeURIComponent(message)}`);
    if (channel === 'vk') {
      const copied = await copyText(message);
      openWebLink('https://vk.com/im');
      setStatus(copied ? 'VK открыт, текст скопирован. Выберите получателя и отправьте сообщение.' : 'VK открыт. Выберите получателя, вставьте текст и отправьте сообщение.');
      return;
    }
    setStatus(`${channel === 'whatsapp' ? 'WhatsApp' : channel === 'telegram' ? 'Telegram' : channel === 'max' ? 'MAX' : channel === 'sms' ? 'SMS' : 'Почта'} открыто. Проверьте получателя и нажмите отправку в приложении.`);
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-message-client]');
    if (trigger) { event.preventDefault(); open(trigger); return; }
    if (event.target.closest('[data-close-client-messaging]')) { dialog.close(); return; }
    const preset = event.target.closest('[data-message-preset]');
    if (preset) { selectPreset(preset.dataset.messagePreset); return; }
    const variable = event.target.closest('[data-message-variable]');
    if (variable) { insertVariable(variable.dataset.messageVariable); return; }
    if (event.target.closest('#saveClientMessageTemplate')) { void saveTemplate(); return; }
    if (event.target.closest('#resetClientMessageTemplate')) { resetTemplate(); return; }
    if (event.target.closest('#clientMessagingSendChooser')) {
      channels.hidden = !channels.hidden;
      sendChooser.setAttribute('aria-expanded', String(!channels.hidden));
      if (!channels.hidden) channels.querySelector('button:not(:disabled)')?.focus();
      return;
    }
    const channel = event.target.closest('[data-message-channel]');
    if (channel && !channel.disabled) void openChannel(channel.dataset.messageChannel);
  });

  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  textArea.addEventListener('input', () => {
    drafts[selectedKind] = textArea.value; pendingSave = null;
    setTemplateStatus(selectedKind === 'custom' ? 'Свой текст используется один раз и не меняет сохранённые шаблоны.' : 'Есть несохранённые изменения.');
    renderEditorState();
  });
  dialog.querySelector('#copyClientMessage').addEventListener('click', async () => setStatus(await copyText(renderMessage()) ? 'Текст скопирован.' : 'Не удалось скопировать текст.'));
  dialog.querySelector('#copyClientPhone').addEventListener('click', async () => setStatus(await copyText(`+${recipient.phone}`) ? 'Номер скопирован.' : 'Не удалось скопировать номер.'));

  window.MinutaClientMessaging = Object.freeze({ configure });
})();
