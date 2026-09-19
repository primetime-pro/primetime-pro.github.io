(function () {
  'use strict';

  function uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function localIso(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function missingRpc(error, name) {
    const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
    return /PGRST202|42883/i.test(text) || new RegExp(`function\\s+[^\\n]*${name}[^\\n]*does not exist`, 'i').test(text);
  }

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability, onCreated } = options;
    let organization = null;
    let client = null;
    let workspace = null;
    let availability = null;
    let revision = 0;
    let settingsSaveTimer = null;
    let requestId = uuid();
    let bound = false;

    function newDraftIdentity() {
      requestId = uuid();
      $('#batchBookingRows')?.querySelectorAll('[data-batch-row]').forEach(row => { row.dataset.requestId = uuid(); });
    }

    function dateAfter(days) {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return localIso(date);
    }

    function rowMarkup(position, item = {}) {
      const date = item.date || dateAfter(position * 7);
      return `<div class="batch-booking-row" data-batch-row data-request-id="${escapeHtml(item.request_id || uuid())}">
        <span class="batch-booking-number" aria-hidden="true">${position}</span>
        <label>Дата<input type="date" data-batch-date min="${escapeHtml(localIso(new Date()))}" value="${escapeHtml(date)}" required></label>
        <label>Время<input type="time" data-batch-time value="${escapeHtml(String(item.time || '10:00').slice(0,5))}" required></label>
        <label class="batch-booking-comment">Комментарий к визиту<input type="text" data-batch-comment maxlength="500" value="${escapeHtml(item.comment || '')}" placeholder="Необязательно"></label>
        <button type="button" class="batch-booking-remove" data-remove-batch-row aria-label="Удалить дату">×</button>
      </div>`;
    }

    function renumberRows() {
      const rows = [...$('#batchBookingRows').querySelectorAll('[data-batch-row]')];
      rows.forEach((row, index) => { row.querySelector('.batch-booking-number').textContent = String(index + 1); });
      rows.forEach(row => { row.querySelector('[data-remove-batch-row]').disabled = rows.length <= 2; });
      $('#batchBookingCount').textContent = `${rows.length} из ${Number(workspace?.max_items || 12)}`;
      $('#addBatchBookingRow').disabled = rows.length >= Number(workspace?.max_items || 12);
      applyWriteAvailability?.();
    }

    function resetRows() {
      const holder = $('#batchBookingRows');
      if (!holder) return;
      holder.innerHTML = rowMarkup(1) + rowMarkup(2);
      requestId = uuid();
      renumberRows();
    }

    function renderRecent() {
      const holder = $('#batchBookingRecentList');
      if (!holder) return;
      const batches = Array.isArray(workspace?.recent_batches) ? workspace.recent_batches : [];
      holder.innerHTML = batches.length ? batches.map(batch => {
        const created = new Date(batch.created_at).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        const items = Array.isArray(batch.items) ? batch.items : [];
        return `<article class="batch-booking-history"><div><strong>${escapeHtml(batch.client_name)}</strong><small>${escapeHtml(created)} · ${Number(batch.item_count || items.length)} записей</small></div><ul>${items.map(item => `<li>${escapeHtml(new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}))}, ${escapeHtml(String(item.time).slice(0,5))}${item.comment ? ` — ${escapeHtml(item.comment)}` : ''}</li>`).join('')}</ul></article>`;
      }).join('') : '<p class="batch-booking-empty">Пакетов пока нет.</p>';
    }

    function render() {
      const settings = $('#batchBookingSettingsCard');
      const composer = $('#batchBookingComposer');
      if (!settings || !composer) return;
      const supported = Boolean(organization && ['loading','ready','error'].includes(availability));
      settings.hidden = !supported;
      const settingsNav = $('#batchBookingSettingsNav');
      if (settingsNav) settingsNav.hidden = !supported;
      composer.hidden = !(supported && availability === 'ready' && workspace?.enabled && client);
      if (!supported) return;
      const loading = availability === 'loading';
      const enabled = workspace?.enabled === true;
      $('#batchBookingsEnabled').checked = enabled;
      $('#batchBookingsEnabled').disabled = loading || workspace?.current_role !== 'owner';
      $('#batchBookingsMaxItems').value = String(workspace?.max_items || 12);
      $('#batchBookingsMaxItems').disabled = loading || workspace?.current_role !== 'owner' || !enabled;
      const saveStatus = $('#batchBookingSaveStatus');
      if (saveStatus) saveStatus.textContent = loading ? 'Загружаем настройки…'
        : workspace?.current_role !== 'owner' ? 'Изменять настройки может только владелец'
          : 'Изменения сохраняются автоматически';
      $('#batchBookingSettingNote').textContent = loading ? 'Проверяем доступность…'
        : availability === 'error' ? 'Не удалось загрузить пакетные записи. Обычные записи продолжают работать.'
          : enabled ? 'Можно создавать несколько визитов на произвольные даты одной атомарной операцией.'
            : 'Функция выключена. Обычные и повторяющиеся записи не изменяются.';
      if (availability !== 'ready') return;
      const locations = Array.isArray(workspace.locations) ? workspace.locations : [];
      const services = Array.isArray(workspace.services) ? workspace.services : [];
      const locationSelect = $('#batchBookingLocation');
      const serviceSelect = $('#batchBookingService');
      const previousLocation = locationSelect.value;
      const previousService = serviceSelect.value;
      locationSelect.innerHTML = locations.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
      serviceSelect.innerHTML = services.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.performer_name)} · ${Number(item.duration_minutes)} мин</option>`).join('');
      if (locations.some(item => item.id === previousLocation)) locationSelect.value = previousLocation;
      if (services.some(item => item.id === previousService)) serviceSelect.value = previousService;
      $('#createBatchBookings').disabled = !locations.length || !services.length;
      if (!$('#batchBookingRows').children.length) resetRows();
      else renumberRows();
      renderRecent();
    }

    async function load() {
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const currentRevision = ++revision;
      if (!userId || !organization?.id) return { ok:false, optional:true };
      availability = 'loading';
      render();
      const { data, error } = await db.rpc('get_minuta_batch_booking_workspace', { p_organization:organization.id });
      if (!sessionIsCurrent(userId,generation) || currentRevision !== revision) return { ok:false, optional:true, stale:true };
      if (error) {
        workspace = null;
        availability = missingRpc(error,'get_minuta_batch_booking_workspace') ? 'unsupported' : 'error';
        render();
        return { ok:false, optional:true, unsupported:availability === 'unsupported' };
      }
      workspace = data || {};
      availability = 'ready';
      render();
      return { ok:true, optional:true };
    }

    function setOrganization(next) {
      const changed = next?.id !== organization?.id;
      organization = next || null;
      if (!organization) {
        revision += 1;
        workspace = null;
        availability = null;
        return render();
      }
      if (changed) {
        workspace = null;
        availability = null;
        resetRows();
      }
      load();
    }

    function setClient(next) {
      const changed = (next?.phone || '') !== (client?.phone || '');
      client = next || null;
      if (changed) {
        $('#batchBookingResult').hidden = true;
        $('#batchBookingResult').innerHTML = '';
        $('#batchBookingError').hidden = true;
        resetRows();
      }
      $('#batchBookingClientName').textContent = client?.name || 'Клиент';
      render();
    }

    async function saveSettings(event) {
      event?.preventDefault();
      if (!requireWrites() || !organization) return;
      const enabledInput = $('#batchBookingsEnabled');
      const maxItemsInput = $('#batchBookingsMaxItems');
      if (!maxItemsInput.reportValidity()) return;
      const saveStatus = $('#batchBookingSaveStatus');
      enabledInput.disabled = true;
      maxItemsInput.disabled = true;
      if (saveStatus) saveStatus.textContent = 'Сохраняем…';
      const { error } = await db.rpc('set_minuta_batch_bookings_enabled', {
        p_organization:organization.id,
        p_enabled:enabledInput.checked,
        p_max_items:Number(maxItemsInput.value)
      });
      enabledInput.disabled = false;
      maxItemsInput.disabled = !enabledInput.checked;
      if (error) {
        if (saveStatus) saveStatus.textContent = 'Не удалось сохранить — повторите изменение';
        notify('Не удалось сохранить пакетные записи');
        return;
      }
      await load();
      if (saveStatus) saveStatus.textContent = 'Сохранено автоматически';
    }

    function scheduleSettingsSave() {
      clearTimeout(settingsSaveTimer);
      const saveStatus = $('#batchBookingSaveStatus');
      if (saveStatus) saveStatus.textContent = 'Ожидает сохранения…';
      settingsSaveTimer = setTimeout(() => saveSettings(), 350);
    }

    function addRow() {
      const holder = $('#batchBookingRows');
      const count = holder.querySelectorAll('[data-batch-row]').length;
      if (count >= Number(workspace?.max_items || 12)) return;
      holder.insertAdjacentHTML('beforeend',rowMarkup(count + 1));
      newDraftIdentity();
      renumberRows();
    }

    function errorMessage(error) {
      const reason = `${error?.message || ''} ${error?.details || ''}`;
      if (/slot_unavailable|overlap|resource_unavailable|shift_required|reserved_for_group_event/i.test(reason)) return 'Одно из времён недоступно. Ничего не создано — измените дату или время.';
      if (/duplicate_batch_booking_item/i.test(reason)) return 'В пакете есть одинаковые или пересекающиеся строки.';
      if (/batch_booking_size_invalid/i.test(reason)) return `Добавьте от 2 до ${Number(workspace?.max_items || 12)} записей.`;
      if (/batch_bookings_disabled/i.test(reason)) return 'Пакетные записи выключены в настройках организации.';
      if (/idempotency_mismatch|request_conflict/i.test(reason)) return 'Черновик изменился после отправки. Обновите раздел и повторите.';
      return 'Не удалось создать пакет. Ни одна запись не была добавлена.';
    }

    async function createBatch(event) {
      event.preventDefault();
      if (!requireWrites() || !organization || !client) return;
      const errorNode = $('#batchBookingError');
      errorNode.hidden = true;
      const rows = [...$('#batchBookingRows').querySelectorAll('[data-batch-row]')];
      const items = rows.map(row => ({
        request_id:row.dataset.requestId,
        date:row.querySelector('[data-batch-date]').value,
        time:`${row.querySelector('[data-batch-time]').value}:00`,
        comment:row.querySelector('[data-batch-comment]').value.trim()
      }));
      const button = event.submitter || $('#createBatchBookings');
      button.disabled = true;
      button.textContent = 'Проверяем все окна…';
      const { data, error } = await db.rpc('create_minuta_batch_bookings', {
        p_organization:organization.id,
        p_location:$('#batchBookingLocation').value,
        p_service:$('#batchBookingService').value,
        p_client_name:client.name,
        p_client_phone:client.displayPhone || client.phone,
        p_items:items,
        p_request_id:requestId,
        p_comment:$('#batchBookingComment').value.trim()
      });
      button.disabled = false;
      button.textContent = 'Создать весь пакет';
      if (error) {
        errorNode.textContent = errorMessage(error);
        errorNode.hidden = false;
        return;
      }
      const created = Array.isArray(data?.created) ? data.created : [];
      $('#batchBookingResult').hidden = false;
      $('#batchBookingResult').innerHTML = `<strong>${Number(data?.created_count || created.length)} записей создано</strong><ul>${created.map(item => `<li>${escapeHtml(new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}, ${escapeHtml(String(item.time).slice(0,5))}</li>`).join('')}</ul>`;
      notify(`Пакет из ${Number(data?.created_count || created.length)} записей создан`);
      await onCreated?.(data);
      $('#batchBookingComment').value = '';
      resetRows();
      await load();
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#batchBookingSettingsForm')?.addEventListener('submit',saveSettings);
      $('#batchBookingsEnabled')?.addEventListener('change',event=>{
        const limit=$('#batchBookingsMaxItems');
        if(limit) limit.disabled=event.target.disabled||!event.target.checked;
        scheduleSettingsSave();
      });
      $('#batchBookingsMaxItems')?.addEventListener('change',scheduleSettingsSave);
      $('#addBatchBookingRow')?.addEventListener('click',addRow);
      $('#batchBookingRows')?.addEventListener('click',event => {
        const remove = event.target.closest('[data-remove-batch-row]');
        if (!remove) return;
        const rows = $('#batchBookingRows').querySelectorAll('[data-batch-row]');
        if (rows.length <= 2) return;
        remove.closest('[data-batch-row]').remove();
        newDraftIdentity();
        renumberRows();
      });
      $('#batchBookingForm')?.addEventListener('input',newDraftIdentity);
      $('#batchBookingForm')?.addEventListener('submit',createBatch);
    }

    return { bind,load,setOrganization,setClient };
  }

  window.MinutaBatchBookings = Object.freeze({ createController });
})();
