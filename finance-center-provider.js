(function (global) {
  'use strict';

  const PERIODS = Object.freeze([
    { value:'current_month', label:'Текущий месяц' },
    { value:'last30', label:'Последние 30 дней' },
    { value:'quarter', label:'Текущий квартал' },
    { value:'year', label:'Текущий год' }
  ]);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isoDate(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function addDays(date, days) {
    const value = new Date(date.getTime());
    value.setUTCDate(value.getUTCDate() + days);
    return value;
  }

  function periodBounds(period = 'current_month', today = new Date()) {
    const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12));
    let start;
    if (period === 'last30') start = addDays(current, -29);
    else if (period === 'quarter') start = new Date(Date.UTC(current.getUTCFullYear(), Math.floor(current.getUTCMonth() / 3) * 3, 1, 12));
    else if (period === 'year') start = new Date(Date.UTC(current.getUTCFullYear(), 0, 1, 12));
    else start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1, 12));
    return { start:isoDate(start), end:isoDate(current) };
  }

  function periodTitle(start, end) {
    const format = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
    if (start === end) return format.format(new Date(`${start}T12:00:00Z`));
    return `${format.format(new Date(`${start}T12:00:00Z`))} — ${format.format(new Date(`${end}T12:00:00Z`))}`;
  }

  function bucketLabel(value, grain, full = false) {
    const date = new Date(`${value}T12:00:00Z`);
    const options = full
      ? { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }
      : grain === 'week'
        ? { day:'numeric', month:'short', timeZone:'UTC' }
        : { day:'numeric', month:'short', timeZone:'UTC' };
    return new Intl.DateTimeFormat('ru-RU', options).format(date).replace('.', '');
  }

  function safeInteger(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }

  function operationType(row) {
    if (row?.kind === 'refund') return 'refund';
    if (row?.kind === 'correction') return 'adjustment';
    return safeInteger(row?.amount_minor) < 0 ? 'expense' : 'income';
  }

  function completenessMessage(confidence = {}) {
    const total = Math.max(0, safeInteger(confidence.completed_visits));
    const marked = Math.max(0, safeInteger(confidence.payment_marked_visits));
    const unposted = Math.max(0, safeInteger(confidence.unposted_payment_visits));
    const messages = [];
    if (total && marked < total) messages.push(`Оплата указана в ${marked} из ${total} визитов. Получено учитывает только подтверждённые деньги.`);
    if (unposted) messages.push(`${unposted} ${unposted === 1 ? 'визит учтён' : 'визитов учтены'} по подтверждённым результатам, но ещё не проведены в журнале.`);
    return messages.join(' ');
  }

  function normalizeFinanceScreen(raw, context = {}) {
    if (!raw || raw.schema !== 'minuta-finance-screen-v1' || raw.ledger_version !== 163
      || raw.organization_id !== context.organizationId || raw.currency !== 'RUB') {
      return { available:false, financeEnabled:false, resultReliable:false, availabilityMessage:'Сервер вернул неподтверждённый финансовый контекст.' };
    }
    const bounds = context.bounds || { start:raw.period?.start, end:raw.period?.end };
    const confidence = raw.confidence || {};
    const readiness = raw.expense_readiness || {};
    const grain = raw.period?.bucket_grain || 'day';
    const categories = Array.isArray(raw.categories) ? raw.categories : [];
    const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    const operations = (Array.isArray(raw.operations) ? raw.operations : []).map(row => ({
      id:String(row.event_key || row.transaction_id || ''),
      occurredAt:String(row.occurred_at || ''),
      type:operationType(row),
      label:String(row.label || 'Финансовая операция'),
      category:String(row.category_name || ''),
      actorName:String(row.entered_by_name || ''),
      amountMinor:safeInteger(row.amount_minor)
    }));
    const totalVisits = Math.max(0, safeInteger(confidence.completed_visits));
    const paymentKnownVisits = Math.min(totalVisits, Math.max(0, safeInteger(confidence.payment_marked_visits)));
    return {
      available:true,
      financeEnabled:raw.finance_enabled === true,
      resultReliable:confidence.result_reliable === true,
      timezone:String(raw.timezone || 'Europe/Samara'),
      today:bounds.end,
      periodLabel:periodTitle(bounds.start, bounds.end),
      summary:{
        receivedMinor:safeInteger(raw.summary?.received_minor),
        expenseMinor:Math.max(0, safeInteger(raw.summary?.expense_minor)),
        serviceMinor:Math.max(0, safeInteger(raw.summary?.services_minor)),
        debtMinor:Math.max(0, safeInteger(raw.summary?.debt_minor)),
        totalVisits,
        paymentKnownVisits
      },
      movement:(Array.isArray(raw.series) ? raw.series : []).map(row => ({
        key:String(row.bucket_start || ''),
        label:bucketLabel(row.bucket_start, grain),
        fullLabel:bucketLabel(row.bucket_start, grain, true),
        receivedMinor:safeInteger(row.received_minor),
        expenseMinor:Math.max(0, safeInteger(row.expense_minor))
      })),
      expenseCategories:(Array.isArray(raw.expense_structure) ? raw.expense_structure : []).map(row => ({
        id:String(row.category_id || row.name || ''), name:String(row.name || 'Без категории'), amountMinor:Math.max(0, safeInteger(row.amount_minor))
      })),
      operations,
      expenseDirectory:categories.filter(row => row.active === true && UUID.test(String(row.id || ''))).map(row => ({ id:String(row.id), name:String(row.name || '') })),
      paymentAccounts:accounts.filter(row => UUID.test(String(row.id || ''))).map(row => ({ id:String(row.id), name:String(row.name || '') })),
      permissions:{ canAddExpense:raw.finance_enabled === true && (readiness.has_payment_account === true || accounts.length > 0) },
      filters:{
        periods:PERIODS,
        masters:[{ value:'', label:'Все мастера' }, ...(Array.isArray(raw.performers) ? raw.performers : []).filter(row => UUID.test(String(row.id || ''))).map(row => ({ value:String(row.id), label:String(row.name || 'Сотрудник') }))],
        selectedPeriod:String(context.period || 'current_month'),
        selectedMaster:String(raw.selected_performer_id || '')
      },
      completeness:{ partial:confidence.is_complete !== true, message:completenessMessage(confidence) },
      nextCursor:raw.has_more && raw.next_cursor ? JSON.stringify(raw.next_cursor) : ''
    };
  }

  function userError(error, fallback) {
    const message = String(error?.message || '');
    const known = {
      finance_disabled:'Сначала включите единый финансовый учёт в разделе «Продажи».',
      cash_or_bank_account_required:'Сначала добавьте кассу или банковский счёт в разделе «Продажи».',
      active_finance_category_not_found:'Выбранная категория расхода больше недоступна.',
      financial_manager_role_required:'Финансы доступны только владельцу и администратору.',
      manual_expense_future_date:'Дата расхода не может быть в будущем.'
    };
    const result = new Error(known[message] || fallback);
    result.userMessage = result.message;
    result.code = error?.code;
    result.ambiguous = !error?.code || ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code);
    return result;
  }

  function createController({ db, $, notify, requireWrites } = {}) {
    let organization = null;
    let center = null;
    let lastDirectory = new Map();
    let lastSelectedMaster = '';
    let generation = 0;
    const root = () => $('#financeCenterRoot');
    const analytics = () => root()?.closest('#analyticsView');
    const isManager = () => Boolean(organization?.id && ['owner', 'admin'].includes(organization.current_role));

    function setManagerVisibility() {
      const tab = $('#reportTabMoney');
      if (tab) tab.hidden = !isManager();
      if (root()) root().hidden = !isManager();
      if (!isManager() && $('#analyticsView')?.dataset.reportTab === 'money') $('#reportTabOverview')?.click();
    }

    async function rpc(name, params, fallback) {
      const expectedOrganization = organization?.id;
      const result = await db.rpc(name, params);
      if (expectedOrganization !== organization?.id) throw Object.assign(new Error('stale_finance_context'), { name:'AbortError' });
      if (result.error) throw userError(result.error, fallback);
      return result.data;
    }

    async function readScreen({ period = 'current_month', masterId = '', cursor = '' } = {}) {
      if (!isManager()) return { available:false, financeEnabled:false, resultReliable:false, availabilityMessage:'Финансы доступны только владельцу и администратору.' };
      const bounds = periodBounds(period);
      let parsedCursor = null;
      try { parsedCursor = cursor ? JSON.parse(cursor) : null; } catch (_) { parsedCursor = null; }
      const raw = await rpc('get_minuta_finance_screen_v163', {
        p_organization:organization.id,
        p_start:bounds.start,
        p_end:bounds.end,
        p_performer:masterId || null,
        p_limit:30,
        p_before_occurred_at:parsedCursor?.occurred_at || null,
        p_before_key:parsedCursor?.event_key || null
      }, 'Не удалось загрузить финансовые данные.');
      const normalized = normalizeFinanceScreen(raw, { organizationId:organization.id, period, bounds });
      lastDirectory = new Map((normalized.expenseDirectory || []).map(item => [item.id, item.name]));
      lastSelectedMaster = masterId || '';
      return normalized;
    }

    const adapter = {
      readDashboard:readScreen,
      async readOperations({ period, masterId, cursor }) {
        const result = await readScreen({ period, masterId, cursor });
        return { operations:result.operations || [], nextCursor:result.nextCursor || '' };
      },
      async prepareExpense({ period, masterId }) {
        if (!requireWrites?.()) throw userError({ message:'writes_disabled', code:'WRITE_DISABLED' }, 'Изменения сейчас недоступны.');
        await rpc('initialize_minuta_finance_screen_v163', { p_organization:organization.id }, 'Не удалось подготовить справочник расходов.');
        return { dashboard:await readScreen({ period, masterId }) };
      },
      async createExpense(payload) {
        if (!requireWrites?.()) throw userError({ message:'writes_disabled', code:'WRITE_DISABLED' }, 'Изменения сейчас недоступны.');
        const categoryName = lastDirectory.get(payload.categoryId) || 'Расход';
        const note = String(payload.note || '').trim();
        const title = (note ? `${categoryName}: ${note}` : categoryName).slice(0, 160);
        return rpc('record_minuta_manual_expense_v163', {
          p_organization:organization.id,
          p_category:payload.categoryId,
          p_source_label:categoryName.slice(0, 160),
          p_title:title,
          p_amount_minor:payload.amountMinor,
          p_payment_account:payload.paymentAccountId,
          p_occurred_on:payload.occurredOn,
          p_performer:lastSelectedMaster || null,
          p_request_id:payload.requestId
        }, 'Не удалось добавить расход.');
      }
    };

    function reset() {
      generation += 1;
      if (center) global.MinutaFinanceCenter?.destroy(center);
      center = null;
      analytics()?.classList.remove('finance-center-mounted');
      lastDirectory = new Map();
      lastSelectedMaster = '';
    }

    function setOrganization(next) {
      if (organization?.id !== next?.id || organization?.current_role !== next?.current_role) reset();
      organization = next || null;
      setManagerVisibility();
    }

    async function load(_range, { force = false } = {}) {
      setManagerVisibility();
      if (!isManager() || !root() || !global.MinutaFinanceCenter) return;
      if (center) {
        if (force) await center.reload();
        return center.ready;
      }
      const currentGeneration = generation;
      center = global.MinutaFinanceCenter.init({ root:root(), adapter, periods:PERIODS, onNotice:message => notify?.(message) });
      analytics()?.classList.add('finance-center-mounted');
      await center.ready;
      if (currentGeneration !== generation) return;
    }

    return { load, setOrganization, reset };
  }

  global.MinutaFinanceProvider = Object.freeze({ PERIODS, periodBounds, normalizeFinanceScreen, createController });
})(globalThis);
