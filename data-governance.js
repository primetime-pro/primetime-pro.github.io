(function () {
  'use strict';
  const MAX_REPORT_DAYS = 31;
  const DAY_MS = 86400000;

  function localIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function safeCell(value) {
    if (value == null) return '';
    const text = String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const directory = [];
    let offset = 0;
    const u16 = value => [value & 255, (value >>> 8) & 255];
    const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
    const append = bytes => { chunks.push(Uint8Array.from(bytes)); offset += bytes.length; };
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      const checksum = crc32(data);
      const fileOffset = offset;
      append([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(checksum), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name]);
      append(data);
      directory.push({ name, dataLength: data.length, checksum, fileOffset });
    }
    const directoryOffset = offset;
    for (const entry of directory) {
      append([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(entry.checksum), ...u32(entry.dataLength), ...u32(entry.dataLength), ...u16(entry.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(entry.fileOffset), ...entry.name]);
    }
    const directoryLength = offset - directoryOffset;
    append([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(directory.length), ...u16(directory.length), ...u32(directoryLength), ...u32(directoryOffset), ...u16(0)]);
    return new Blob(chunks, { type: 'application/zip' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function ensureXlsx() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/xlsx-0.20.3.full.min.js', window.location.href).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Не удалось загрузить модуль Excel.'));
      document.head.appendChild(script);
    });
    if (!window.XLSX) throw new Error('Модуль Excel недоступен.');
    return window.XLSX;
  }

  window.MinutaDataGovernance = {
    createController({ db, $, escapeHtml, notify }) {
      let organization = null;
      let workspace = null;
      const card = $('#dataGovernanceCard');
      if (!card) return { bind() {}, setOrganization() {} };
      const status = $('#dataGovernanceStatus');
      const exportFrom = $('#dataExportFrom');
      const exportTo = $('#dataExportTo');
      const rangeHint = $('#dataExportRangeHint');
      const exportDialog = $('#fullDataExportDialog');
      const exportConfirm = $('#fullDataExportConfirm');
      const fullExportButton = $('#exportOrganizationDataBtn');
      const excelExportButton = $('#exportBookingsExcelBtn');
      const setStatus = (message, tone = '') => { status.textContent = message; status.dataset.tone = tone; };
      const call = async (name, params) => { const { data, error } = await db.rpc(name, params); if (error) throw error; return data; };
      const requireOwner = () => { if (!organization?.id || workspace?.role !== 'owner') throw new Error('Экспорт доступен только владельцу организации.'); };
      const setBusy = (button, busy, busyText, readyText) => { if (!button) return; button.textContent = busy ? busyText : readyText; button.disabled = busy || (button === fullExportButton && !exportConfirm?.checked); };

      function setDefaultRange() {
        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - (MAX_REPORT_DAYS - 1));
        exportFrom.value = localIsoDate(from);
        exportTo.value = localIsoDate(to);
        validateRange();
      }

      function validateRange() {
        const from = exportFrom?.value;
        const to = exportTo?.value;
        if (!from || !to) {
          rangeHint.textContent = 'Укажите начало и конец периода.';
          rangeHint.dataset.tone = 'warning';
          excelExportButton.disabled = true;
          return null;
        }
        const days = Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / DAY_MS) + 1;
        const valid = days > 0 && days <= MAX_REPORT_DAYS;
        const dayWord = days % 100 >= 11 && days % 100 <= 14 ? 'дней' : days % 10 === 1 ? 'день' : days % 10 >= 2 && days % 10 <= 4 ? 'дня' : 'дней';
        rangeHint.textContent = days <= 0 ? 'Дата окончания должна быть не раньше начала.' : days > MAX_REPORT_DAYS ? `Выбрано ${days} дней. Максимум — ${MAX_REPORT_DAYS}.` : `Выбрано ${days} ${dayWord}.`;
        rangeHint.dataset.tone = valid ? 'success' : 'warning';
        excelExportButton.disabled = !valid || workspace?.role !== 'owner';
        return valid ? { from, to, days } : null;
      }

      function renderLastExport() {
        const output = $('#dataLastExport');
        const items = workspace?.recent_access || [];
        const item = items.find(entry => String(entry.action_type || entry.action || '').toLowerCase().includes('export'));
        output.textContent = item?.created_at ? `Последняя выгрузка: ${new Date(item.created_at).toLocaleString('ru-RU')}.` : 'Последних выгрузок в журнале нет.';
      }

      const render = () => {
        const settings = workspace?.settings || {};
        ['bookingRetentionMonths', 'visitorRetentionDays', 'auditRetentionMonths', 'deletionGraceDays'].forEach(id => {
          const element = $(`#${id}`);
          const key = id.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
          element.value = settings[key] ?? element.value;
          element.disabled = workspace?.role !== 'owner';
        });
        card.dataset.owner = workspace?.role === 'owner' ? 'true' : 'false';
        validateRange();
        renderLastExport();
        const list = $('#dataGovernanceRequests');
        const requests = workspace?.requests || [];
        list.innerHTML = requests.length ? requests.map(item => `<div class="data-request-row"><span><strong>${escapeHtml(item.request_type)}</strong><small>${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></span><span class="data-request-status">${escapeHtml(item.status)}</span>${workspace.role === 'owner' && item.status === 'pending' ? `<button type="button" class="text-button" data-cancel-data-request="${escapeHtml(item.id)}">Отменить</button>` : ''}</div>`).join('') : '<p class="settings-hint">Активных запросов нет.</p>';
      };

      const load = async () => {
        if (!organization?.id) return;
        setStatus('Загружаем настройки...');
        try {
          workspace = await call('get_minuta_data_governance_workspace_v110', { p_organization: organization.id });
          render();
          setStatus(workspace?.role === 'owner' ? 'Настройки и журнал запросов загружены.' : 'Просмотр доступен. Экспортом и сроками управляет владелец.', 'success');
        } catch (error) { setStatus('Раздел станет доступен после обновления базы данных.', 'warning'); }
      };

      const save = async () => {
        requireOwner();
        workspace.settings = await call('save_minuta_data_governance_v110', {
          p_organization: organization.id,
          p_booking_retention_months: Number($('#bookingRetentionMonths').value),
          p_visitor_retention_days: Number($('#visitorRetentionDays').value),
          p_audit_retention_months: Number($('#auditRetentionMonths').value),
          p_deletion_grace_days: Number($('#deletionGraceDays').value)
        });
        render();
        notify('Правила хранения сохранены.');
      };

      const exportBookings = async () => {
        requireOwner();
        const range = validateRange();
        if (!range) throw new Error('Исправьте период выгрузки.');
        setBusy(excelExportButton, true, 'Готовим Excel...', 'Скачать Excel');
        try {
          const payload = await call('export_minuta_organization_data_v110', { p_organization: organization.id });
          const locations = new Map((payload.locations || []).map(item => [item.id, item.name]));
          const services = new Map((payload.services || []).map(item => [item.id, item.name]));
          const bookings = (payload.bookings || []).filter(item => item.booking_date >= range.from && item.booking_date <= range.to);
          const rows = bookings.map(item => ({
            'Дата': safeCell(item.booking_date),
            'Время': safeCell(item.booking_time || item.slot_start || ''),
            'Клиент': safeCell(item.client_name || ''),
            'Телефон': safeCell(item.client_phone || ''),
            'Услуга': safeCell(services.get(item.service_id) || item.service_name || ''),
            'Филиал': safeCell(locations.get(item.location_id) || item.location_name || ''),
            'Статус': safeCell(item.status || ''),
            'Стоимость': Number(item.final_price_rub ?? item.original_price_rub ?? item.price ?? 0),
            'Комментарий': safeCell(item.client_note || item.provider_note || '')
          }));
          const XLSX = await ensureXlsx();
          const workbook = XLSX.utils.book_new();
          const headers = ['Дата', 'Время', 'Клиент', 'Телефон', 'Услуга', 'Филиал', 'Статус', 'Стоимость', 'Комментарий'];
          const bookingsSheet = XLSX.utils.json_to_sheet(rows, { header: headers });
          bookingsSheet['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 32 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 38 }];
          const summarySheet = XLSX.utils.aoa_to_sheet([['Отчёт PrimeTime Pro', 'Записи'], ['Организация', safeCell(organization.name || '')], ['Период', `${range.from} — ${range.to}`], ['Количество записей', rows.length], ['Сформирован', new Date().toLocaleString('ru-RU')]]);
          XLSX.utils.book_append_sheet(workbook, bookingsSheet, 'Записи');
          XLSX.utils.book_append_sheet(workbook, summarySheet, 'Сводка');
          const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
          downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `primetime-pro-bookings-${range.from}-${range.to}.xlsx`);
          setStatus(`Excel готов: ${rows.length} записей за ${range.days} дней. Выгрузка добавлена в журнал.`, 'success');
          await load();
        } finally { setBusy(excelExportButton, false, '', 'Скачать Excel'); }
      };

      const exportFullBackup = async () => {
        requireOwner();
        if (!exportConfirm?.checked) throw new Error('Подтвердите безопасное хранение архива.');
        setBusy(fullExportButton, true, 'Готовим ZIP...', 'Скачать ZIP');
        try {
          const payload = await call('export_minuta_organization_data_v110', { p_organization: organization.id });
          const date = localIsoDate(new Date());
          const readme = `Резервная копия PrimeTime Pro\nОрганизация: ${organization.name || organization.id}\nСоздана: ${new Date().toLocaleString('ru-RU')}\n\nАрхив содержит персональные данные. Храните его в защищённом месте.\n`;
          const archive = zipStore([{ name: `primetime-pro-data-${date}.json`, data: JSON.stringify(payload, null, 2) }, { name: 'README.txt', data: readme }]);
          downloadBlob(archive, `primetime-pro-backup-${date}.zip`);
          exportDialog.close();
          exportConfirm.checked = false;
          setStatus('Полная резервная копия скачана. Выгрузка добавлена в журнал.', 'success');
          await load();
        } finally { setBusy(fullExportButton, false, '', 'Скачать ZIP'); }
      };

      function bind() {
        setDefaultRange();
        exportFrom?.addEventListener('change', validateRange);
        exportTo?.addEventListener('change', validateRange);
        excelExportButton?.addEventListener('click', () => exportBookings().catch(error => notify(error.message || 'Не удалось подготовить Excel.')));
        $('#openFullDataExportBtn')?.addEventListener('click', () => {
          try { requireOwner(); exportConfirm.checked = false; fullExportButton.disabled = true; exportDialog.showModal(); }
          catch (error) { notify(error.message); }
        });
        exportConfirm?.addEventListener('change', () => { fullExportButton.disabled = !exportConfirm.checked; });
        fullExportButton?.addEventListener('click', () => exportFullBackup().catch(error => notify(error.message || 'Не удалось подготовить архив.')));
        $('#saveDataGovernanceBtn')?.addEventListener('click', () => save().catch(error => notify(error.message || 'Не удалось сохранить.')));
        $('#previewPrivacyCleanupBtn')?.addEventListener('click', async () => {
          try { requireOwner(); const data = await call('run_minuta_privacy_cleanup_v110', { p_organization: organization.id, p_execute: false }); setStatus(`К очистке: посещения ${data.visitor_events}, отменённые записи ${data.cancelled_bookings}, журнал ${data.access_log}.`, 'success'); }
          catch (error) { notify(error.message || 'Не удалось выполнить проверку.'); }
        });
        $('#runPrivacyCleanupBtn')?.addEventListener('click', async () => {
          if (!confirm('Удалить устаревшие технические события и обезличить старые отменённые записи?')) return;
          try { requireOwner(); const data = await call('run_minuta_privacy_cleanup_v110', { p_organization: organization.id, p_execute: true }); setStatus(`Очищено: посещения ${data.visitor_events}, отменённые записи ${data.cancelled_bookings}, журнал ${data.access_log}.`, 'success'); }
          catch (error) { notify(error.message || 'Очистка не выполнена.'); }
        });
        card.addEventListener('click', async event => {
          const request = event.target.closest('[data-data-request]');
          const cancel = event.target.closest('[data-cancel-data-request]');
          if (request) {
            if (!confirm('Создать запрос? Его можно отменить до даты исполнения.')) return;
            try { await call('request_minuta_data_action_v110', { p_organization: organization.id, p_request_type: request.dataset.dataRequest }); await load(); notify('Запрос создан.'); }
            catch (error) { notify(error.message || 'Не удалось создать запрос.'); }
          }
          if (cancel) {
            try { await call('cancel_minuta_data_request_v110', { p_request: cancel.dataset.cancelDataRequest }); await load(); notify('Запрос отменён.'); }
            catch (error) { notify(error.message || 'Не удалось отменить запрос.'); }
          }
        });
      }

      return { bind, setOrganization(next) { organization = next || null; workspace = null; card.dataset.owner = 'false'; if (organization?.id) void load(); } };
    }
  };
})();
