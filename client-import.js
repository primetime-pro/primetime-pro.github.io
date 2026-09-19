(function initMinutaClientImport(global) {
  'use strict';

  const FIELD_ALIASES = Object.freeze({
    name:['имя','фио','клиент','имя клиента','client','client name','name','full name'],
    surname:['фамилия','фамилия клиента','surname','last name','family name'],
    phone:['телефон','номер телефона','мобильный телефон','мобильный номер','phone','phone number','mobile','mobile number','client phone'],
    email:['email','e-mail','электронная почта','почта'],
    note:['комментарий','заметка','примечание','комментарий о клиенте','comment','note','notes'],
    birthday:['дата рождения','день рождения','birthday','birth date','date of birth'],
    visit_count:['визиты','количество визитов','количество записей','число визитов','посещения','visits','visit count','booking count'],
    total_spent_rub:['потратил','потрачено','оплатил','сумма оплат','всего оплачено','выручка','total spent','paid'],
    last_visit_on:['последний визит','дата последнего визита','last visit','last visit date'],
    external_id:['id клиента','client id','ид клиента','идентификатор клиента','id'],
    marketing_consent:['согласен на получение рассылок','согласие на рассылку','marketing consent','newsletter consent'],
    personal_data_consent:['согласен на обработку персональных данных','согласие на обработку персональных данных','personal data consent']
  });
  const IMPORT_BATCH_SIZE = 500;
  const IMPORT_MAX_ROWS = 20000;
  const HISTORY_MAX_ROWS = 20000;
  const XLSX_SOURCE = 'vendor/xlsx-0.20.3.full.min.js';
  const XLSX_INTEGRITY = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
  let xlsxLoadPromise = null;

  function loadXlsx() {
    if (global.XLSX?.read && global.XLSX?.utils?.sheet_to_json) return Promise.resolve(global.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;
    xlsxLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-minuta-xlsx]');
      if (existing) existing.remove();
      const script = document.createElement('script');
      let settled = false;
      const finish = callback => { if (settled) return; settled = true; clearTimeout(timeout); callback(); };
      const fail = message => finish(() => { script.remove(); reject(new Error(message)); });
      const complete = () => finish(() => global.XLSX?.read && global.XLSX?.utils?.sheet_to_json ? resolve(global.XLSX) : reject(new Error('Модуль чтения Excel не загрузился. Обновите страницу и попробуйте снова.')));
      const timeout = setTimeout(() => fail('Модуль чтения Excel не ответил. Проверьте соединение и повторите попытку.'), 15000);
      script.addEventListener('load', complete, { once:true });
      script.addEventListener('error', () => fail('Не удалось загрузить модуль Excel. Проверьте соединение и повторите попытку.'), { once:true });
      script.src = XLSX_SOURCE;
      script.integrity = XLSX_INTEGRITY;
      script.dataset.minutaXlsx = 'true';
      document.head.append(script);
    }).catch(error => { xlsxLoadPromise = null; throw error; });
    return xlsxLoadPromise;
  }

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function missingRpc(error, name) {
    return Boolean(error && (error.code === 'PGRST202' || new RegExp(`could not find.*${name}|function .*${name}.*does not exist`, 'i').test(error.message || '')));
  }

  async function executeProviderTransferBatch(db, input) {
    const previewResponse = await db.rpc('preview_minuta_provider_transfer_v144', {
      p_organization:input.organizationId,
      p_kind:input.kind,
      p_source_system:input.sourceSystem || 'other',
      p_rows:input.rows,
      p_request_id:input.requestId,
      p_source_file:input.kind === 'history' ? input.sourceFile || 'journal.xls' : null
    });
    if (previewResponse.error) {
      if (missingRpc(previewResponse.error, 'preview_minuta_provider_transfer_v144')) return { supported:false };
      throw previewResponse.error;
    }
    const planned = previewResponse.data || {};
    if (!planned.batch_id) throw new Error('Сервер не вернул номер предварительной проверки.');
    if (Number(planned.conflict_count || 0) > 0) {
      throw new Error('Импорт остановлен: внешний идентификатор уже связан с другим клиентом.');
    }
    if (!['previewed','applied'].includes(planned.status)) {
      throw new Error('Предварительная проверка импорта больше не действует. Повторите выбор файла.');
    }
    const applyResponse = await db.rpc('apply_minuta_provider_transfer_v144', {
      p_organization:input.organizationId,
      p_batch:planned.batch_id
    });
    if (applyResponse.error) throw applyResponse.error;
    const applied = applyResponse.data || {};
    if (applied.status !== 'applied') {
      throw new Error('Предварительная проверка импорта больше не действует. Повторите выбор файла.');
    }
    return { supported:true, preview:planned, data:applied };
  }

  const TRANSFER_EXPORT_COLUMNS = Object.freeze({
    clients:Object.freeze([
      ['name','Имя'],['display_phone','Телефон'],['email','Email'],['birthday','Дата рождения'],
      ['note','Комментарий'],['source_system','Источник'],['external_id','ID клиента'],
      ['visit_count','Количество визитов'],['total_spent_rub','Всего оплачено'],
      ['last_visit_on','Последний визит'],['marketing_consent','Согласие на рассылку'],
      ['personal_data_consent','Согласие на обработку персональных данных']
    ]),
    history:Object.freeze([
      ['booking_date','Дата'],['booking_time','Время'],['duration_minutes','Длительность, мин'],
      ['client_name','Имя клиента'],['display_phone','Телефон'],['service_name','Услуга'],
      ['source_provider_name','Мастер'],['price_rub','Стоимость'],['source_note','Комментарий'],
      ['source_sheet','Лист'],['source_file_name','Исходный файл']
    ])
  });

  function safeCsvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value).replace(/\0/g, '');
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildProviderTransferExport(payload, format) {
    const kind = String(payload?.kind || '').toLowerCase();
    if (!Object.hasOwn(TRANSFER_EXPORT_COLUMNS, kind)) throw new Error('Неизвестный раздел выгрузки.');
    if (!['csv','json'].includes(format)) throw new Error('Поддерживаются CSV и JSON.');
    const columns = TRANSFER_EXPORT_COLUMNS[kind];
    const rows = (Array.isArray(payload?.rows) ? payload.rows : []).map(row => Object.fromEntries(
      columns.map(([key]) => [key, ['string','number','boolean'].includes(typeof row?.[key]) ? row[key] : null])
    ));
    const exportedAt = String(payload?.exported_at || new Date().toISOString());
    const datasetRevision = /^[0-9a-f]{64}$/.test(String(payload?.dataset_revision || ''))
      ? String(payload.dataset_revision) : '';
    const day = /^\d{4}-\d{2}-\d{2}/.exec(exportedAt)?.[0] || new Date().toLocaleDateString('en-CA');
    let content;
    let mediaType;
    if (format === 'json') {
      content = `${JSON.stringify({ schema_version:1,kind,exported_at:exportedAt,dataset_revision:datasetRevision,rows }, null, 2)
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')}\n`;
      mediaType = 'application/json;charset=utf-8';
    } else {
      const lines = [columns.map(([,label]) => safeCsvCell(label)).join(',')];
      rows.forEach(row => lines.push(columns.map(([key]) => safeCsvCell(row?.[key])).join(',')));
      content = `\ufeff${lines.join('\r\n')}\r\n`;
      mediaType = 'text/csv;charset=utf-8';
    }
    return {
      kind,format,content,mediaType,rowCount:rows.length,datasetRevision,containsPersonalData:true,
      filename:`primetime-pro-${kind}-${day}.${format}`
    };
  }

  async function fetchProviderTransferExport(db, organizationId, kind) {
    const pageSize = 1000;
    const maxRows = 100000;
    const rows = [];
    let offset = 0;
    let exportedAt = '';
    let datasetRevision = '';
    while (offset < maxRows) {
      const response = await db.rpc('export_minuta_provider_transfer_data_v144', {
        p_organization:organizationId,p_kind:kind,p_limit:pageSize,p_offset:offset
      });
      if (response.error) throw response.error;
      const page = response.data || {};
      if (!exportedAt) exportedAt = page.exported_at || '';
      const pageRevision = String(page.dataset_revision || '');
      if (!/^[0-9a-f]{64}$/.test(pageRevision)) {
        throw new Error('Сервер не подтвердил целостность выгрузки.');
      }
      if (datasetRevision && datasetRevision !== pageRevision) {
        throw new Error('Данные изменились во время выгрузки. Повторите её.');
      }
      datasetRevision = pageRevision;
      const pageRows = Array.isArray(page.rows) ? page.rows : [];
      if (pageRows.length > pageSize || rows.length+pageRows.length>maxRows) {
        throw new Error('Сервер вернул неверную страницу выгрузки.');
      }
      rows.push(...pageRows);
      if (!page.has_more) return { schema_version:1,kind,exported_at:exportedAt,dataset_revision:datasetRevision,rows };
      const nextOffset = Number(page.next_offset);
      if (!Number.isSafeInteger(nextOffset) || nextOffset !== offset+pageSize || pageRows.length !== pageSize) {
        throw new Error('Сервер вернул неверную страницу выгрузки.');
      }
      offset = nextOffset;
    }
    throw new Error('Выгрузка превышает безопасный предел в 100 000 строк.');
  }

  function downloadProviderTransferExport(artifact) {
    if (!global.URL?.createObjectURL || !global.Blob || !global.document?.createElement) return false;
    const url = global.URL.createObjectURL(new global.Blob([artifact.content], { type:artifact.mediaType }));
    const link = global.document.createElement('a');
    link.href = url;
    link.download = artifact.filename;
    link.rel = 'noopener';
    link.click();
    setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    return true;
  }

  function normalizedHeader(value) {
    return String(value || '').replace(/^\ufeff/, '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function delimiterFor(text) {
    const first = String(text || '').split(/\r?\n/, 1)[0] || '';
    const counts = { ';':0, ',':0, '\t':0 };
    let quoted = false;
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] === '"') quoted = !quoted;
      else if (!quoted && Object.hasOwn(counts, first[index])) counts[first[index]] += 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseDelimited(text) {
    const delimiter = delimiterFor(text);
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    const source = String(text || '').replace(/^\ufeff/, '');
    for (let index = 0; index <= source.length; index += 1) {
      const character = source[index] ?? '\n';
      if (character === '"') {
        if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (!quoted && character === delimiter) {
        row.push(value.trim()); value = '';
      } else if (!quoted && (character === '\n' || character === '\r')) {
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        row.push(value.trim()); value = '';
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
      } else value += character;
    }
    return rows;
  }

  function isoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
    if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
    return match ? `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}` : '';
  }

  function integer(value) {
    const parsed = Number(String(value || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  function consent(value) {
    const normalized = normalizedHeader(value);
    if (['да','yes','true','1','согласен','согласна'].includes(normalized)) return true;
    if (['нет','no','false','0','не согласен','не согласна'].includes(normalized)) return false;
    return null;
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `7${digits}`;
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    return /^7\d{10}$/.test(digits) ? digits : '';
  }

  function detectedIndexes(table) {
    const headers = (table[0] || []).map(normalizedHeader);
    return {
      headers,
      indexes:Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, headers.findIndex(header => aliases.includes(header))]))
    };
  }

  function mapRows(table, overrides = {}) {
    if (table.length < 2) throw new Error('В файле нет строк клиентов.');
    const { headers, indexes } = detectedIndexes(table);
    for (const field of ['name','phone']) {
      const selected = Number(overrides[field]);
      if (Number.isInteger(selected) && selected >= 0 && selected < headers.length) indexes[field] = selected;
    }
    if (indexes.name < 0 || indexes.phone < 0) throw new Error('Не найдены обязательные столбцы «Имя» и «Телефон».');
    const invalid = [];
    const clients = new Map();
    table.slice(1).forEach((row, offset) => {
      const get = field => indexes[field] >= 0 ? String(row[indexes[field]] || '').trim() : '';
      const phone = normalizePhone(get('phone'));
      const name = [get('name'), get('surname')].filter(Boolean).join(' ').trim().slice(0, 80);
      if (!phone || !name) { invalid.push(offset + 2); return; }
      clients.set(phone, {
        phone, display_phone:get('phone').slice(0,24), name,
        email:get('email').slice(0,254), note:get('note').slice(0,1000),
        birthday:isoDate(get('birthday')), visit_count:integer(get('visit_count')),
        total_spent_rub:integer(get('total_spent_rub')), last_visit_on:isoDate(get('last_visit_on')),
        external_id:get('external_id').slice(0,120), marketing_consent:consent(get('marketing_consent')),
        personal_data_consent:consent(get('personal_data_consent'))
      });
    });
    const rows = [...clients.values()];
    if (!rows.length) throw new Error('Не найдено ни одного клиента с корректным именем и телефоном.');
    if (rows.length > IMPORT_MAX_ROWS) throw new Error(`За один раз можно импортировать не больше ${IMPORT_MAX_ROWS} уникальных клиентов.`);
    return { rows, invalid, duplicateCount:Math.max(0, table.length - 1 - invalid.length - rows.length), headers };
  }

  function readWorkbook(bytes) {
    if (!global.XLSX?.read || !global.XLSX?.utils?.sheet_to_json) {
      throw new Error('Модуль чтения Excel не загрузился. Обновите страницу и попробуйте снова.');
    }
    try { return global.XLSX.read(bytes, { type:'array', dense:false, cellDates:false }); }
    catch { throw new Error('Не удалось прочитать файл Excel. Возможно, файл повреждён или защищён паролем.'); }
  }

  function parseSpreadsheet(bytes) {
    const workbook = readWorkbook(bytes);
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName || !workbook.Sheets?.[sheetName]) throw new Error('В файле Excel нет доступных листов.');
    const rows = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header:1, raw:false, defval:'', blankrows:false
    });
    return rows.map(row => row.map(value => String(value ?? '').trim()));
  }

  function journalDate(sheetName) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(sheetName || '').trim());
    if (!match) return '';
    const value = `${match[3]}-${match[2]}-${match[1]}`;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) || date.getFullYear() !== Number(match[3]) || date.getMonth() + 1 !== Number(match[2]) || date.getDate() !== Number(match[1]) ? '' : value;
  }

  function minutesFromClock(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return -1;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : -1;
  }

  function splitJournalService(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    const match = /^(.*?)(?:\s+((?:по|по подарочному|подарочный)\s+сертификат(?:у)?(?:\s+\S+)?|беру\s+.+))$/i.exec(raw);
    return { service:(match?.[1] || raw).trim().slice(0, 400), note:(match?.[2] || '').trim().slice(0, 1000) };
  }

  function parseBookingJournalWorkbook(workbook, options = {}) {
    const today = String(options.today || new Date().toLocaleDateString('en-CA'));
    const nowMinutes = Number.isInteger(options.nowMinutes) ? options.nowMinutes : new Date().getHours() * 60 + new Date().getMinutes();
    const records = new Map();
    let candidateCount = 0;
    let futureCount = 0;
    let invalidCount = 0;
    const providers = new Set();
    (workbook.SheetNames || []).forEach(sheetName => {
      const date = journalDate(sheetName);
      if (!date) return;
      const sheet = workbook.Sheets?.[sheetName];
      if (!sheet) return;
      Object.entries(sheet).forEach(([address, cell]) => {
        if (address.startsWith('!') || /^[A-Z]+1$/.test(address) || /^A\d+$/.test(address)) return;
        const lines = String(cell?.w ?? cell?.v ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        if (lines.length < 4) return;
        candidateCount += 1;
        const timeMatch = /^(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})(?:\s*\(([\d\s]+)\s*(?:RUB|РУБ\.?|₽)\))?/i.exec(lines[0]);
        const startMinutes = minutesFromClock(timeMatch?.[1]);
        const endMinutes = minutesFromClock(timeMatch?.[2]);
        const phone = normalizePhone(lines[2]);
        const name = String(lines[1] || '').trim().slice(0, 80);
        if (!timeMatch || startMinutes < 0 || endMinutes <= startMinutes || endMinutes - startMinutes > 480 || !phone || name.length < 2) { invalidCount += 1; return; }
        if (date > today || date === today && endMinutes > nowMinutes) { futureCount += 1; return; }
        const column = /^[A-Z]+/.exec(address)?.[0] || 'B';
        const provider = String(sheet[`${column}1`]?.w ?? sheet[`${column}1`]?.v ?? '').trim().slice(0, 120);
        const serviceParts = splitJournalService(lines.slice(3).join(' '));
        if (!serviceParts.service) { invalidCount += 1; return; }
        if (provider) providers.add(provider);
        const price = Math.max(0, Math.min(10000000, Number(String(timeMatch[3] || '0').replace(/\s/g, '')) || 0));
        const key = [date,timeMatch[1],endMinutes - startMinutes,phone,serviceParts.service.toLowerCase(),provider.toLowerCase()].join('|');
        records.set(key, {
          booking_date:date,booking_time:`${timeMatch[1].padStart(5, '0')}:00`,duration_minutes:endMinutes - startMinutes,
          client_name:name,phone,display_phone:lines[2].slice(0, 24),service_name:serviceParts.service,
          source_note:serviceParts.note,source_provider_name:provider,price_rub:price,source_sheet:String(sheetName).slice(0, 80)
        });
      });
    });
    const rows = [...records.values()].sort((a, b) => `${a.booking_date}${a.booking_time}${a.phone}`.localeCompare(`${b.booking_date}${b.booking_time}${b.phone}`));
    if (!candidateCount) return null;
    if (!rows.length) throw new Error(futureCount ? 'В журнале нет завершённых записей: найденные записи ещё не состоялись.' : 'В журнале не найдено записей с корректными датой, именем и телефоном.');
    if (rows.length > HISTORY_MAX_ROWS) throw new Error(`За один раз можно импортировать не больше ${HISTORY_MAX_ROWS} записей.`);
    return { kind:'history',rows,futureCount,invalidCount,duplicateCount:Math.max(0,candidateCount - futureCount - invalidCount - rows.length),providers:[...providers] };
  }

  async function decodeFile(file) {
    if (!file || file.size < 1) throw new Error('Выберите непустой файл с клиентами.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Файл должен быть не больше 12 МБ.');
    if (!/\.(csv|tsv|txt|xls|xlsx)$/i.test(file.name)) throw new Error('Поддерживаются XLS, XLSX, CSV, TSV и TXT.');
    if (/\.xlsx?$/i.test(file.name)) await loadXlsx();
    const bytes = await file.arrayBuffer();
    if (/\.xlsx?$/i.test(file.name)) {
      const workbook = readWorkbook(new Uint8Array(bytes));
      const history = parseBookingJournalWorkbook(workbook);
      if (history) return { ...history, fileName:file.name };
      const sheetName = workbook.SheetNames?.[0];
      if (!sheetName || !workbook.Sheets?.[sheetName]) throw new Error('В файле Excel нет доступных листов.');
      const table = global.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header:1,raw:false,defval:'',blankrows:false })
        .map(row => row.map(value => String(value ?? '').trim()));
      return { kind:'clients',table,fileName:file.name };
    }
    let text = new TextDecoder('utf-8', { fatal:false }).decode(bytes);
    if (text.includes('\ufffd')) text = new TextDecoder('windows-1251').decode(bytes);
    return { kind:'clients',table:parseDelimited(text),fileName:file.name };
  }

  function createController(options = {}) {
    const { db, $, escapeHtml, notify, requireWrites, onLoaded, getExistingPhones = () => [] } = options;
    let organization = null;
    let workspace = null;
    let preview = null;
    let pendingTable = null;
    let bound = false;
    let revision = 0;
    let transferBusy = false;

    function supported() { return Boolean(workspace && workspace.can_import); }
    function contactsSupported() { return Boolean(navigator.contacts?.select && navigator.contacts?.getProperties); }
    function render() {
      const panel = $('#clientImportPanel');
      if (!panel) return;
      panel.hidden = !supported();
      const contactsButton = $('#clientContactsImport');
      if (contactsButton) contactsButton.hidden = !supported() || !contactsSupported();
      const history = $('#clientImportHistory');
      if (history && supported()) {
        const batches = Array.isArray(workspace.recent_batches) ? workspace.recent_batches : [];
        const transferBatches = Array.isArray(workspace.transfer_batches) ? workspace.transfer_batches : [];
        const importedSummary = workspace.history_summary;
        history.textContent = Number(importedSummary?.visit_count || 0)
          ? `История загружена: ${Number(importedSummary.visit_count).toLocaleString('ru-RU')} записей · ${Number(importedSummary.total_price_rub || 0).toLocaleString('ru-RU')} ₽ по журналу`
          : transferBatches.length ? `Последний перенос: ${new Date(transferBatches[0].created_at).toLocaleString('ru-RU')} · ${transferBatches[0].input_count} строк · ${transferBatches[0].status === 'rolled_back' ? 'отменён' : transferBatches[0].status === 'applied' ? 'применён' : transferBatches[0].status === 'expired' ? 'истёк' : 'ожидает'}`
            : batches.length ? `Последний импорт: ${new Date(batches[0].created_at).toLocaleString('ru-RU')} · ${batches[0].input_count} клиентов` : 'Импортов пока не было';
      }
      const tools = $('#clientTransferTools');
      if (tools) tools.hidden = !supported();
      if (supported()) {
        const transferBatches = Array.isArray(workspace.transfer_batches) ? workspace.transfer_batches : [];
        const latest = transferBatches[0] || null;
        const latestApplied = transferBatches.find(item => item?.status === 'applied') || null;
        if ($('#clientTransferState')) $('#clientTransferState').textContent = latest
          ? latest.status === 'rolled_back' ? 'Последний отменён' : latest.status === 'applied' ? 'Последний применён'
            : latest.status === 'expired' ? 'Предпросмотр истёк' : 'Предпросмотр готов'
          : 'Нет операций';
        if ($('#clientTransferExport')) $('#clientTransferExport').hidden = workspace.current_role !== 'owner';
        if ($('#clientTransferRollback')) $('#clientTransferRollback').hidden = !latestApplied;
        if ($('#clientTransferRollbackButton')) {
          $('#clientTransferRollbackButton').dataset.batchId = latestApplied?.id || latestApplied?.batch_id || '';
          $('#clientTransferRollbackButton').disabled = transferBusy;
        }
        if ($('#clientTransferRollbackTitle') && latestApplied) {
          const kind = latestApplied.transfer_kind === 'history' ? 'истории визитов' : 'клиентов';
          $('#clientTransferRollbackTitle').textContent = `Отменить перенос ${kind} · ${Number(latestApplied.input_count || 0)} строк`;
        }
        tools?.querySelectorAll('button,select').forEach(control => { control.disabled = transferBusy; });
      }
    }

    function contactsPreview(contacts) {
      const currentPhones = getExistingPhones();
      const existing = new Set([
        ...(workspace?.clients || []).map(item => normalizePhone(item.phone)),
        ...(Array.isArray(currentPhones) ? currentPhones : []).map(normalizePhone)
      ].filter(Boolean));
      const rows = new Map();
      let invalidCount = 0;
      let existingCount = 0;
      for (const contact of Array.isArray(contacts) ? contacts : []) {
        const name = String(contact?.name?.[0] || '').trim().slice(0, 80);
        const phones = Array.isArray(contact?.tel) ? contact.tel : [];
        const rawPhone = phones.find(value => normalizePhone(value)) || '';
        const phone = normalizePhone(rawPhone);
        if (!name || !phone) { invalidCount += 1; continue; }
        if (existing.has(phone)) { existingCount += 1; continue; }
        rows.set(phone, { phone, display_phone:String(rawPhone).slice(0,24), name, email:'', note:'', birthday:'', visit_count:0,
          total_spent_rub:0, last_visit_on:'', external_id:'', marketing_consent:null, personal_data_consent:null });
      }
      if (!rows.size) throw new Error(existingCount ? 'Все выбранные контакты уже есть в клиентской базе.' : 'В выбранных контактах нет полного имени и российского номера телефона.');
      return { kind:'clients', rows:[...rows.values()], invalid:[], duplicateCount:invalidCount + existingCount, fileName:'phone-contacts' };
    }

    async function choosePhoneContacts() {
      if (!supported() || !contactsSupported()) return;
      const currentRevision = revision;
      const organizationId = organization?.id || '';
      const button = $('#clientContactsImport');
      button.disabled = true;
      try {
        const contacts = await navigator.contacts.select(['name','tel'], { multiple:true });
        if (currentRevision !== revision || organization?.id !== organizationId || !contacts?.length) return;
        pendingTable = null;
        renderPreview(contactsPreview(contacts));
      } catch (error) {
        if (currentRevision === revision && organization?.id === organizationId && error?.name !== 'AbortError') notify(error?.message || 'Не удалось открыть телефонную книгу');
      } finally {
        button.disabled = false;
      }
    }

    async function load() {
      const currentRevision = ++revision;
      const organizationId = organization?.id || '';
      const requestIsCurrent = () => currentRevision === revision && organization?.id === organizationId;
      preview = null;
      pendingTable = null;
      $('#clientImportPreview')?.setAttribute('hidden','');
      $('#clientImportMapping')?.setAttribute('hidden','');
      if (!organizationId || !navigator.onLine) { workspace = null; onLoaded?.([], []); render(); return { ok:true,optional:true,skipped:true }; }
      const clients = [];
      const pageSize = 1000;
      const maxClients = 100000;
      let payload = null;
      let error = null;
      for (let offset = 0; offset <= maxClients; offset += pageSize) {
        let response = await db.rpc('get_minuta_imported_clients', { p_organization:organizationId, p_limit:pageSize, p_offset:offset });
        if (offset === 0 && response.error && (response.error.code === 'PGRST202' || /could not find.*get_minuta_imported_clients|function .* does not exist/i.test(response.error.message || ''))) {
          response = await db.rpc('get_minuta_imported_clients', { p_organization:organizationId });
        }
        ({ data:payload, error } = response);
        if (!requestIsCurrent()) return { ok:false,optional:true,stale:true };
        if (error) break;
        clients.push(...(Array.isArray(payload?.clients) ? payload.clients : []));
        if (!payload?.has_more) break;
        if (clients.length >= maxClients) { error = new Error('Слишком большой объём клиентской базы'); break; }
      }
      if (error) { workspace = null; onLoaded?.([], []); render(); return { ok:false,optional:true }; }
      let historyPayload = null;
      const historyRows = [];
      for (let offset = 0; offset <= 100000; offset += pageSize) {
        const response = await db.rpc('get_minuta_imported_booking_history', { p_organization:organizationId,p_limit:pageSize,p_offset:offset });
        if (!requestIsCurrent()) return { ok:false,optional:true,stale:true };
        if (response.error) {
          if (response.error.code === 'PGRST202' || /could not find.*get_minuta_imported_booking_history|function .* does not exist/i.test(response.error.message || '')) break;
          historyPayload = null; historyRows.length = 0; break;
        }
        historyPayload = response.data || {};
        historyRows.push(...(Array.isArray(historyPayload.rows) ? historyPayload.rows : []));
        if (!historyPayload.has_more) break;
      }
      if (!requestIsCurrent()) return { ok:false,optional:true,stale:true };
      let transferBatches = [];
      const journalResponse = await db.rpc('get_minuta_provider_transfer_journal_v144', { p_organization:organizationId,p_limit:20 });
      if (!requestIsCurrent()) return { ok:false,optional:true,stale:true };
      if (!journalResponse.error) transferBatches = Array.isArray(journalResponse.data?.batches) ? journalResponse.data.batches : [];
      else if (!missingRpc(journalResponse.error, 'get_minuta_provider_transfer_journal_v144')) transferBatches = [];
      workspace = { ...(payload || {}), clients,history_rows:historyRows,history_summary:historyPayload?.summary || null,transfer_batches:transferBatches };
      onLoaded?.(clients, historyRows, workspace.history_summary);
      render();
      return { ok:true,optional:true };
    }

    function hideMapping() {
      const mapping = $('#clientImportMapping');
      if (mapping) mapping.hidden = true;
    }

    function renderPreview(nextPreview) {
      preview = {
        ...nextPreview,
        transferRequestIds:nextPreview.transferRequestIds || Object.create(null),
        transferBaseOffset:Number.isSafeInteger(nextPreview.transferBaseOffset) ? nextPreview.transferBaseOffset : 0
      };
      const sample = preview.rows.slice(0, 5);
      if (preview.kind === 'history') {
        const price = preview.rows.reduce((sum, item) => sum + Number(item.price_rub || 0), 0);
        const first = preview.rows[0]?.booking_date;
        const last = preview.rows.at(-1)?.booking_date;
        $('#clientImportPreviewList').innerHTML = sample.map(item => `<li><strong>${escapeHtml(item.client_name)} · ${escapeHtml(item.service_name)}</strong><span>${escapeHtml(new Date(`${item.booking_date}T12:00:00`).toLocaleDateString('ru-RU'))} · ${escapeHtml(String(item.booking_time).slice(0,5))}</span></li>`).join('');
        $('#clientImportPreviewSummary').textContent = `${preview.rows.length} записей готово · ${price.toLocaleString('ru-RU')} ₽ по журналу${first && last ? ` · ${new Date(`${first}T12:00:00`).toLocaleDateString('ru-RU')}–${new Date(`${last}T12:00:00`).toLocaleDateString('ru-RU')}` : ''}${preview.duplicateCount ? ` · дублей пропущено: ${preview.duplicateCount}` : ''}${preview.futureCount ? ` · будущих записей не перенесено: ${preview.futureCount}` : ''}`;
        $('#clientImportSubmit').textContent = 'Импортировать историю';
      } else {
        $('#clientImportPreviewList').innerHTML = sample.map(item => `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.display_phone)}</span></li>`).join('');
        const skipped = preview.fileName === 'phone-contacts' ? 'пропущено контактов' : 'дублей в файле';
        $('#clientImportPreviewSummary').textContent = `${preview.rows.length} клиентов готово${preview.duplicateCount ? ` · ${skipped}: ${preview.duplicateCount}` : ''}${preview.invalid.length ? ` · пропущено строк: ${preview.invalid.length}` : ''}`;
        $('#clientImportSubmit').textContent = 'Импортировать клиентов';
      }
      $('#clientImportPreview').hidden = false;
      hideMapping();
    }

    function showMapping(table) {
      const { indexes } = detectedIndexes(table);
      const labels = (table[0] || []).map((value, index) => String(value || '').trim() || `Столбец ${index + 1}`);
      const options = `<option value="">Не выбрано</option>${labels.map((label, index) => `<option value="${index}">${escapeHtml(label)}</option>`).join('')}`;
      const nameSelect = $('#clientImportNameColumn');
      const phoneSelect = $('#clientImportPhoneColumn');
      nameSelect.innerHTML = options;
      phoneSelect.innerHTML = options;
      nameSelect.value = indexes.name >= 0 ? String(indexes.name) : '';
      phoneSelect.value = indexes.phone >= 0 ? String(indexes.phone) : '';
      $('#clientImportMapping').hidden = false;
    }

    function applyManualMapping() {
      if (!pendingTable) return;
      const name = $('#clientImportNameColumn').value;
      const phone = $('#clientImportPhoneColumn').value;
      if (name === '' || phone === '') { notify('Выберите столбцы с именем и телефоном'); return; }
      if (name === phone) { notify('Имя и телефон должны находиться в разных столбцах'); return; }
      try { renderPreview(mapRows(pendingTable, { name, phone })); }
      catch (error) { notify(error?.message || 'Не удалось сопоставить столбцы'); }
    }

    async function chooseFile(file) {
      const currentRevision = revision;
      const organizationId = organization?.id || '';
      try {
        const decoded = await decodeFile(file);
        if (currentRevision !== revision || organization?.id !== organizationId) return;
        preview = null;
        $('#clientImportPreview').hidden = true;
        if (decoded.kind === 'history') { pendingTable = null; renderPreview(decoded); return; }
        pendingTable = decoded.table;
        const { indexes } = detectedIndexes(pendingTable);
        if (pendingTable.length < 2) throw new Error('В файле нет строк клиентов.');
        if (indexes.name < 0 || indexes.phone < 0) { showMapping(pendingTable); return; }
        renderPreview(mapRows(pendingTable));
      } catch (error) {
        if (currentRevision !== revision || organization?.id !== organizationId) return;
        pendingTable = null;
        preview = null;
        $('#clientImportPreview').hidden = true;
        hideMapping();
        notify(error?.message || 'Не удалось прочитать файл');
      }
    }

    async function submit(event) {
      event.preventDefault();
      if (!preview?.rows?.length || !organization?.id || !requireWrites()) return;
      const importPreview = preview;
      const organizationId = organization.id;
      const currentRevision = ++revision;
      const requestIsCurrent = () => currentRevision === revision && organization?.id === organizationId;
      const button = $('#clientImportSubmit');
      const originalCaption = button.textContent;
      const totalCount = importPreview.rows.length;
      button.disabled = true;
      let processedCount = 0;
      let createdCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;
      try {
        for (let offset = 0; offset < totalCount; offset += IMPORT_BATCH_SIZE) {
          if (!requestIsCurrent()) return;
          const batch = importPreview.rows.slice(offset, offset + IMPORT_BATCH_SIZE);
          const absoluteOffset = importPreview.transferBaseOffset + offset;
          const requestId = importPreview.transferRequestIds[absoluteOffset] || uuid();
          importPreview.transferRequestIds[absoluteOffset] = requestId;
          button.textContent = `Импортируем ${Math.min(offset + batch.length, totalCount)} из ${totalCount}`;
          const transfer = await executeProviderTransferBatch(db, {
            organizationId,kind:importPreview.kind,sourceSystem:'other',rows:batch,
            requestId,sourceFile:importPreview.fileName || 'journal.xls'
          });
          let data;
          let error;
          if (transfer.supported) data = transfer.data;
          else ({ data,error } = importPreview.kind === 'history'
            ? await db.rpc('import_minuta_booking_history', { p_organization:organizationId,p_rows:batch,p_request_id:requestId,p_source_file:importPreview.fileName || 'journal.xls' })
            : await db.rpc('import_minuta_clients', { p_organization:organizationId,p_source_system:'other',p_rows:batch,p_request_id:requestId }));
          if (!requestIsCurrent()) return;
          if (error) throw error;
          processedCount += batch.length;
          createdCount += Number(data?.created_count || 0);
          updatedCount += Number(data?.updated_count || data?.duplicate_count || 0);
          unchangedCount += Number(data?.unchanged_count || 0);
        }
        notify(importPreview.kind === 'history'
          ? `История загружена: ${createdCount} записей${updatedCount ? `, ${updatedCount} дублей пропущено` : ''}`
          : `Клиенты загружены: ${createdCount} новых, ${updatedCount} обновлено${unchangedCount ? `, без изменений: ${unchangedCount}` : ''}. Чтобы восстановить прошлый график, отдельно загрузите журнал записей Excel.`);
        $('#clientImportForm').reset();
        pendingTable = null;
        preview = null;
        $('#clientImportPreview').hidden = true;
        hideMapping();
        await load();
      } catch (error) {
        if (!requestIsCurrent()) return;
        const retryPreview = processedCount ? {
          ...importPreview,rows:importPreview.rows.slice(processedCount),
          transferBaseOffset:importPreview.transferBaseOffset+processedCount
        } : importPreview;
        const prefix = processedCount ? `Успешно перенесено ${processedCount} из ${totalCount}. ` : '';
        notify(`${prefix}${error?.message || 'Импорт не выполнен'}`);
        if (retryPreview?.rows.length) {
          await load();
          if (organization?.id !== organizationId) return;
          renderPreview(retryPreview);
        }
      }
      finally { button.disabled = false; button.textContent = originalCaption; }
    }

    async function exportTransfer(format, kind = 'clients') {
      if (!organization?.id || workspace?.current_role !== 'owner' || transferBusy) return null;
      const organizationId = organization.id;
      transferBusy = true;
      render();
      try {
        const payload = await fetchProviderTransferExport(db, organizationId, kind);
        if (organization?.id !== organizationId) return null;
        const artifact = buildProviderTransferExport(payload, format);
        if (!downloadProviderTransferExport(artifact)) throw new Error('download_unavailable');
        notify(`Скачана защищаемая копия: ${artifact.rowCount} строк`);
        return artifact;
      } catch (error) {
        if (organization?.id === organizationId) notify(error?.message === 'download_unavailable'
          ? 'Браузер не разрешил скачать файл' : 'Не удалось подготовить выгрузку');
        throw error;
      } finally {
        if (organization?.id === organizationId) { transferBusy = false; render(); }
      }
    }

    async function rollbackTransfer(batchId) {
      if (!organization?.id || !batchId || transferBusy || !requireWrites()) return null;
      if (typeof global.confirm === 'function'
        && !global.confirm('Отменить этот перенос? Более поздние изменения клиентов или истории не будут затронуты.')) return null;
      const organizationId = organization.id;
      transferBusy = true;
      render();
      try {
        const { data,error } = await db.rpc('rollback_minuta_provider_transfer_v144', {
          p_organization:organizationId,p_batch:batchId
        });
        if (organization?.id !== organizationId) return null;
        if (error || data?.status !== 'rolled_back') throw error || new Error('rollback_not_confirmed');
        notify('Перенос отменён и проверен');
        await load();
        return data;
      } catch (error) {
        if (organization?.id === organizationId) notify(/modified|blocked|conflict|измен/i.test(`${error?.message || ''} ${error?.details || ''}`)
          ? 'Перенос уже нельзя отменить: связанные данные изменились позже' : 'Не удалось подтвердить отмену переноса');
        throw error;
      } finally {
        if (organization?.id === organizationId) { transferBusy = false; render(); }
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#clientImportFile')?.addEventListener('change', event => chooseFile(event.target.files?.[0]));
      $('#clientContactsImport')?.addEventListener('click', choosePhoneContacts);
      $('#clientImportApplyMapping')?.addEventListener('click', applyManualMapping);
      $('#clientImportForm')?.addEventListener('submit', submit);
      $('#clientTransferExportButton')?.addEventListener('click', () => {
        void exportTransfer($('#clientTransferExportFormat')?.value || 'csv', $('#clientTransferExportKind')?.value || 'clients').catch(() => {});
      });
      $('#clientTransferRollbackButton')?.addEventListener('click', event => {
        void rollbackTransfer(event.currentTarget.dataset.batchId).catch(() => {});
      });
    }

    return {
      bind, load,
      async rollback(batchId) {
        return rollbackTransfer(batchId);
      },
      async exportData(format, kind = 'clients') {
        if (!organization?.id) throw new Error('Сначала выберите организацию.');
        return exportTransfer(format, kind);
      },
      getTransferBatches() {
        return Array.isArray(workspace?.transfer_batches) ? [...workspace.transfer_batches] : [];
      },
      setOrganization(next) {
        const normalized = next || null;
        const currentOrganizationId = organization?.id || '';
        const nextOrganizationId = normalized?.id || '';
        organization = normalized;
        if (currentOrganizationId && currentOrganizationId === nextOrganizationId) return;
        workspace = null;
        onLoaded?.([], []);
        const contactsButton = $('#clientContactsImport');
        if (contactsButton) contactsButton.disabled = false;
        render();
        void load();
      }
    };
  }

  global.MinutaClientImport = Object.freeze({
    createController,parseDelimited,parseSpreadsheet,parseBookingJournalWorkbook,mapRows,normalizePhone,loadXlsx,
    executeProviderTransferBatch,fetchProviderTransferExport,buildProviderTransferExport
  });
})(window);
