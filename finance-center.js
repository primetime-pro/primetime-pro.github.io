(function (global) {
  'use strict';

  const instances = new WeakMap();
  const MONEY_TYPES = new Set(['income', 'expense', 'refund', 'adjustment']);
  const PERIOD_FALLBACK = Object.freeze([{ value:'current_month', label:'Текущий месяц' }]);
  const MASTER_FALLBACK = Object.freeze([{ value:'', label:'Все мастера' }]);

  function integer(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }

  function nonnegative(value) { return Math.max(0, integer(value)); }

  function text(value, fallback = '') {
    const normalized = String(value == null ? '' : value).trim();
    return normalized || fallback;
  }

  function formatRubles(value) {
    const minor = integer(value);
    const sign = minor < 0 ? '\u2212' : '';
    const absolute = Math.abs(minor);
    const rubles = Math.floor(absolute / 100).toLocaleString('ru-RU');
    const kopecks = absolute % 100;
    return `${sign}${rubles}${kopecks ? `,${String(kopecks).padStart(2, '0')}` : ''}\u00a0\u20bd`;
  }

  function parseRubles(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return 0;
    const [whole, fraction = ''] = normalized.split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(minor) && minor > 0 ? minor : 0;
  }

  function requestUuid() {
    if (typeof global.crypto?.randomUUID === 'function') return global.crypto.randomUUID();
    if (typeof global.crypto?.getRandomValues !== 'function') throw new Error('secure_request_id_unavailable');
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  function todayInTimezone(timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function optionRows(rows, fallback) {
    const safe = Array.isArray(rows) ? rows.map(item => ({
      value:text(item?.value ?? item?.id),
      label:text(item?.label ?? item?.name)
    })).filter(item => item.label) : [];
    return safe.length ? safe : fallback.map(item => ({ ...item }));
  }

  function normalizeDashboard(raw = {}) {
    const summary = raw.summary || {};
    const receivedMinor = integer(summary.receivedMinor ?? raw.received_minor);
    const expenseMinor = nonnegative(summary.expenseMinor ?? raw.expense_minor);
    const serviceMinor = nonnegative(summary.serviceMinor ?? raw.service_minor);
    const debtMinor = nonnegative(summary.debtMinor ?? raw.debt_minor);
    const totalVisits = nonnegative(summary.totalVisits ?? raw.total_visits);
    const paymentKnownVisits = Math.min(totalVisits, nonnegative(summary.paymentKnownVisits ?? raw.payment_known_visits));
    const movement = Array.isArray(raw.movement) ? raw.movement.slice(0, 31).map((item, index) => ({
      key:text(item?.key, String(index)),
      label:text(item?.label, '\u2014'),
      fullLabel:text(item?.fullLabel, text(item?.label, '\u2014')),
      receivedMinor:integer(item?.receivedMinor),
      expenseMinor:nonnegative(item?.expenseMinor)
    })) : [];
    const categories = Array.isArray(raw.expenseCategories) ? raw.expenseCategories.map((item, index) => ({
      id:text(item?.id, String(index)),
      name:text(item?.name, 'Без категории'),
      amountMinor:nonnegative(item?.amountMinor)
    })).filter(item => item.amountMinor > 0) : [];
    const operations = Array.isArray(raw.operations) ? raw.operations.map(normalizeOperation).filter(Boolean) : [];
    const directory = Array.isArray(raw.expenseDirectory) ? raw.expenseDirectory.map(item => ({
      id:text(item?.id), name:text(item?.name)
    })).filter(item => item.id && item.name) : [];
    const paymentAccounts = Array.isArray(raw.paymentAccounts) ? raw.paymentAccounts.map(item => ({
      id:text(item?.id), name:text(item?.name)
    })).filter(item => item.id && item.name) : [];
    return {
      available:raw.available === true,
      financeEnabled:raw.financeEnabled === true,
      resultReliable:raw.resultReliable === true,
      availabilityMessage:text(raw.availabilityMessage),
      today:text(raw.today),
      periodLabel:text(raw.periodLabel, 'Выбранный период'),
      timezone:text(raw.timezone, 'Europe/Samara'),
      summary:{ receivedMinor, expenseMinor, serviceMinor, debtMinor, totalVisits, paymentKnownVisits, netMinor:receivedMinor - expenseMinor },
      movement,
      expenseCategories:categories,
      operations,
      expenseDirectory:directory,
      paymentAccounts,
      permissions:{ canAddExpense:Boolean(raw.permissions?.canAddExpense) },
      filters:{
        periods:optionRows(raw.filters?.periods, PERIOD_FALLBACK),
        masters:optionRows(raw.filters?.masters, MASTER_FALLBACK),
        selectedPeriod:text(raw.filters?.selectedPeriod),
        selectedMaster:text(raw.filters?.selectedMaster)
      },
      completeness:{
        partial:Boolean(raw.completeness?.partial || (totalVisits > paymentKnownVisits)),
        message:text(raw.completeness?.message)
      },
      nextCursor:text(raw.nextCursor)
    };
  }

  function normalizeOperation(item) {
    if (!item || !MONEY_TYPES.has(item.type)) return null;
    const amountMinor = integer(item.amountMinor);
    if (!amountMinor) return null;
    return {
      id:text(item.id),
      occurredAt:text(item.occurredAt),
      type:item.type,
      label:text(item.label, 'Финансовая операция'),
      category:text(item.category),
      actorName:text(item.actorName),
      amountMinor
    };
  }

  function createElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = content;
    return element;
  }

  function shell() {
    return `
      <section class="finance-center" aria-labelledby="financeCenterTitle">
        <header class="finance-center__head">
          <div><p class="finance-center__eyebrow">Статистика \u00b7 Деньги</p><h2 id="financeCenterTitle">Движение денег</h2></div>
          <button class="finance-center__primary" type="button" data-finance-add>Добавить расход</button>
        </header>
        <div class="finance-center__filters" aria-label="Фильтры финансов">
          <label><span>Период</span><select data-finance-period></select></label>
          <label><span>Мастер</span><select data-finance-master></select></label>
        </div>
        <div class="finance-center__status" data-finance-status role="status" aria-live="polite"></div>
        <div class="finance-center__unavailable" data-finance-unavailable hidden><div aria-hidden="true">!</div><section><h3>Финансовый итог пока недоступен</h3><p data-finance-unavailable-message></p></section></div>
        <div data-finance-content hidden>
          <section class="finance-center__hero" aria-labelledby="financeResultTitle">
            <div class="finance-center__net"><span id="financeResultTitle">Итог за период</span><strong data-finance-net></strong><small>получено минус подтверждённые расходы</small></div>
            <dl class="finance-center__main-metrics">
              <div><dt>Получено</dt><dd data-finance-received></dd><small>фактическая отмеченная оплата</small></div>
              <div><dt>Расходы</dt><dd data-finance-expense></dd><small>подтверждённые операции</small></div>
            </dl>
          </section>
          <aside class="finance-center__completeness" data-finance-completeness hidden></aside>
          <dl class="finance-center__trust-metrics">
            <div><dt>Оказано услуг</dt><dd data-finance-services></dd><small>стоимость состоявшихся визитов</small></div>
            <div><dt>Долг</dt><dd data-finance-debt></dd><small>подтверждённая неоплата</small></div>
          </dl>
          <div class="finance-center__visuals">
            <section class="finance-center__panel finance-center__movement" aria-labelledby="financeMovementTitle">
              <div class="finance-center__section-head"><div><h3 id="financeMovementTitle">Движение денег</h3><p data-finance-period-label></p></div><div class="finance-center__legend" aria-label="Обозначения"><span class="is-income">+ Получено</span><span class="is-expense">\u2212 Расходы</span></div></div>
              <div class="finance-center__chart" data-finance-chart role="group" aria-describedby="financeChartHelp"></div>
              <p id="financeChartHelp" class="finance-center__chart-help">Выберите столбец или используйте стрелки, чтобы увидеть точные суммы.</p>
              <p class="finance-center__chart-detail" data-finance-chart-detail aria-live="polite"></p>
            </section>
            <section class="finance-center__panel finance-center__structure" aria-labelledby="financeStructureTitle">
              <div class="finance-center__section-head"><div><h3 id="financeStructureTitle">Структура расходов</h3><p>Только подтверждённые расходы</p></div></div>
              <div data-finance-ring></div>
            </section>
          </div>
          <section class="finance-center__panel finance-center__operations" aria-labelledby="financeOperationsTitle">
            <div class="finance-center__section-head"><div><h3 id="financeOperationsTitle">Операции</h3><p>Последние подтверждённые записи</p></div></div>
            <div data-finance-operations></div>
            <button class="finance-center__more" type="button" data-finance-more hidden>Показать ещё</button>
          </section>
        </div>
        <div class="finance-center__empty" data-finance-empty hidden>
          <div aria-hidden="true">\u20bd</div><h3>Пока нет подтверждённых операций</h3>
          <p>Полученная оплата появится после отметки результата визита или продажи. Расход можно добавить вручную.</p>
          <button class="finance-center__primary" type="button" data-finance-empty-action>Добавить расход</button>
        </div>
        <dialog class="finance-center__dialog" data-finance-dialog aria-labelledby="financeExpenseTitle">
          <form method="dialog" class="finance-center__dialog-card" data-finance-form>
            <div class="finance-center__dialog-head"><div><p>Новая операция</p><h3 id="financeExpenseTitle">Добавить расход</h3></div><button type="button" data-finance-close aria-label="Закрыть">\u00d7</button></div>
            <div class="finance-center__form-row">
              <label><span>Категория</span><select name="categoryId" required data-finance-category></select></label>
              <label><span>Списать с</span><select name="paymentAccountId" required data-finance-account></select></label>
            </div>
            <div class="finance-center__form-row">
              <label><span>Сумма</span><span class="finance-center__money-input"><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" required><b>\u20bd</b></span></label>
              <label><span>Дата</span><input name="occurredOn" type="date" required></label>
            </div>
            <label><span>Комментарий</span><input name="note" maxlength="160" autocomplete="off" placeholder="Например, расходные материалы"></label>
            <p class="finance-center__form-note">Операция сохранится в журнале. Исправление выполняется корректировкой, без тихого изменения истории.</p>
            <p class="finance-center__form-error" data-finance-form-error role="alert" hidden></p>
            <div class="finance-center__dialog-actions"><button type="button" data-finance-cancel>Отмена</button><button class="finance-center__primary" type="submit" data-finance-submit>Добавить расход</button></div>
          </form>
        </dialog>
      </section>`;
  }

  function init(options = {}) {
    const root = options.root;
    if (!(root instanceof Element)) throw new TypeError('finance_root_required');
    if (!options.adapter || typeof options.adapter.readDashboard !== 'function') throw new TypeError('finance_adapter_required');
    instances.get(root)?.destroy();
    root.innerHTML = shell();

    const adapter = options.adapter;
    const onNotice = typeof options.onNotice === 'function' ? options.onNotice : function () {};
    const state = {
      destroyed:false, data:null, operations:[], nextCursor:'', requestId:'', loadVersion:0,
      period:text(options.initialPeriod, 'current_month'), master:text(options.initialMaster), abort:null
    };
    const find = selector => root.querySelector(selector);
    const elements = {
      status:find('[data-finance-status]'), content:find('[data-finance-content]'), empty:find('[data-finance-empty]'),
      period:find('[data-finance-period]'), master:find('[data-finance-master]'), add:find('[data-finance-add]'), emptyAction:find('[data-finance-empty-action]'),
      dialog:find('[data-finance-dialog]'), form:find('[data-finance-form]'), category:find('[data-finance-category]'), account:find('[data-finance-account]'), formError:find('[data-finance-form-error]'), submit:find('[data-finance-submit]'),
      chart:find('[data-finance-chart]'), chartDetail:find('[data-finance-chart-detail]'), ring:find('[data-finance-ring]'), operations:find('[data-finance-operations]'), more:find('[data-finance-more]')
    };

    function fillOptions(select, rows, selected) {
      select.replaceChildren();
      rows.forEach(item => {
        const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; select.append(option);
      });
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }

    function setLoading(loading, message = '') {
      root.querySelector('.finance-center')?.setAttribute('aria-busy', String(loading));
      elements.status.textContent = message;
      elements.status.hidden = !message;
    }

    function setMoney(selector, value, known = true) {
      const element = find(selector); element.textContent = known ? formatRubles(value) : '\u2014'; element.classList.toggle('is-negative', known && value < 0);
      element.classList.toggle('is-compact', known && element.textContent.length > 13);
      element.classList.toggle('is-ultra-compact', known && element.textContent.length > 18);
    }

    function renderChart(points, expensesKnown) {
      elements.chart.replaceChildren();
      if (!points.length) {
        elements.chart.append(createElement('p', 'finance-center__inline-empty', 'Нет движения денег за выбранный период.'));
        elements.chartDetail.textContent = '';
        return;
      }
      const max = Math.max(1, ...points.flatMap(point => [Math.abs(point.receivedMinor), point.expenseMinor]));
      const grid = createElement('div', 'finance-center__chart-grid');
      grid.style.setProperty('--finance-points', String(points.length));
      points.forEach((point, index) => {
        const button = createElement('button', 'finance-center__chart-point');
        button.type = 'button'; button.dataset.chartIndex = String(index);
        button.setAttribute('aria-label', `${point.fullLabel}. Получено ${formatRubles(point.receivedMinor)}. ${expensesKnown ? `Расходы ${formatRubles(point.expenseMinor)}.` : 'Расходы не подключены.'}`);
        const bars = createElement('span', 'finance-center__bars');
        const income = createElement('i', `finance-center__bar is-income${point.receivedMinor ? '' : ' is-zero'}`); income.style.setProperty('--finance-height', `${Math.max(2, Math.round(Math.abs(point.receivedMinor) / max * 100))}%`);
        bars.append(income);
        if (expensesKnown) { const expense = createElement('i', `finance-center__bar is-expense${point.expenseMinor ? '' : ' is-zero'}`); expense.style.setProperty('--finance-height', `${Math.max(2, Math.round(point.expenseMinor / max * 100))}%`); bars.append(expense); }
        button.append(bars, createElement('span', 'finance-center__chart-label', point.label));
        button.addEventListener('click', () => selectChartPoint(index));
        button.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const last = points.length - 1;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, index + (event.key === 'ArrowRight' ? 1 : -1)));
          grid.querySelector(`[data-chart-index="${next}"]`)?.focus(); selectChartPoint(next);
        });
        grid.append(button);
      });
      elements.chart.append(grid);
      function selectChartPoint(index) {
        grid.querySelectorAll('.finance-center__chart-point').forEach((button, itemIndex) => button.classList.toggle('is-selected', itemIndex === index));
        const point = points[index];
        elements.chartDetail.textContent = `${point.fullLabel}: получено ${formatRubles(point.receivedMinor)}, ${expensesKnown ? `расходы ${formatRubles(point.expenseMinor)}` : 'расходы не подключены'}.`;
      }
      selectChartPoint(points.length - 1);
    }

    function renderRing(categories, expenseMinor, expensesKnown) {
      elements.ring.replaceChildren();
      if (!expensesKnown) {
        elements.ring.append(createElement('p', 'finance-center__inline-empty', 'Структура расходов появится после подключения финансового журнала.'));
        return;
      }
      if (!categories.length || expenseMinor <= 0) {
        elements.ring.append(createElement('p', 'finance-center__inline-empty', 'Расходов по категориям пока нет.'));
        return;
      }
      const total = categories.reduce((sum, item) => sum + item.amountMinor, 0) || expenseMinor;
      let offset = 0;
      const stops = categories.map((item, index) => {
        const start = offset; offset += item.amountMinor / total * 100;
        return `color-mix(in srgb, var(--theme-accent, #296b4b) ${Math.max(35, 92 - index * 11)}%, var(--theme-surface, #fff)) ${start}% ${offset}%`;
      });
      const layout = createElement('div', 'finance-center__ring-layout');
      const ring = createElement('div', 'finance-center__ring'); ring.style.background = `conic-gradient(${stops.join(',')})`;
      ring.setAttribute('role', 'img'); ring.setAttribute('aria-label', `Расходы по категориям, всего ${formatRubles(total)}`);
      const hole = createElement('div'); hole.append(createElement('span', '', 'Всего'), createElement('strong', '', formatRubles(total))); ring.append(hole);
      const list = createElement('ul', 'finance-center__category-list');
      categories.forEach((item, index) => {
        const row = createElement('li'); row.style.setProperty('--finance-category-tone', String(Math.max(35, 92 - index * 11)));
        const label = createElement('span'); label.append(createElement('i'), createElement('b', '', item.name));
        row.append(label, createElement('strong', '', formatRubles(item.amountMinor))); list.append(row);
      });
      layout.append(ring, list); elements.ring.append(layout);
    }

    function operationDate(value, timezone) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Дата не указана';
      return new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', timeZone:timezone }).format(date);
    }

    function renderOperations(ledgerKnown = true) {
      elements.operations.replaceChildren();
      if (!ledgerKnown) {
        elements.operations.append(createElement('p', 'finance-center__inline-empty', 'Подтверждённые операции появятся после подключения финансового журнала.'));
        elements.more.hidden = true;
        return;
      }
      if (!state.operations.length) {
        elements.operations.append(createElement('p', 'finance-center__inline-empty', 'Операций за выбранный период нет.'));
      } else {
        const list = createElement('div', 'finance-center__operation-list');
        state.operations.forEach(operation => {
          const row = createElement('article', `finance-center__operation is-${operation.type}`);
          const sign = operation.type === 'expense' || operation.type === 'refund' || operation.amountMinor < 0 ? '\u2212' : '+';
          const copy = createElement('div');
          const meta = [operationDate(operation.occurredAt, state.data.timezone), operation.category, operation.actorName ? `Внёс: ${operation.actorName}` : ''].filter(Boolean).join(' \u00b7 ');
          copy.append(createElement('strong', '', operation.label), createElement('small', '', meta));
          const amount = createElement('b', '', `${sign}${formatRubles(Math.abs(operation.amountMinor))}`); amount.setAttribute('aria-label', `${sign === '+' ? 'Поступление' : 'Списание'} ${formatRubles(Math.abs(operation.amountMinor))}`);
          row.append(copy, amount); list.append(row);
        });
        elements.operations.append(list);
      }
      elements.more.hidden = !(state.nextCursor && typeof adapter.readOperations === 'function');
    }

    function render(data) {
      state.data = data; state.operations = data.operations; state.nextCursor = data.nextCursor;
      state.period = data.filters.selectedPeriod || state.period; state.master = data.filters.selectedMaster || state.master;
      fillOptions(elements.period, data.filters.periods, state.period); fillOptions(elements.master, data.filters.masters, state.master);
      const unavailable = find('[data-finance-unavailable]');
      if (!data.available) {
        unavailable.hidden = false;
        find('[data-finance-unavailable-message]').textContent = data.availabilityMessage || 'Серверный финансовый источник не подтвердил готовность. Данные и операции не подменяются расчётом в браузере.';
        elements.content.hidden = true; elements.empty.hidden = true; elements.add.hidden = true; elements.emptyAction.hidden = true;
        return;
      }
      unavailable.hidden = true;
      const ledgerKnown = data.financeEnabled;
      const netKnown = ledgerKnown && data.resultReliable;
      setMoney('[data-finance-net]', data.summary.netMinor, netKnown); setMoney('[data-finance-received]', data.summary.receivedMinor);
      setMoney('[data-finance-expense]', data.summary.expenseMinor, ledgerKnown); setMoney('[data-finance-services]', data.summary.serviceMinor); setMoney('[data-finance-debt]', data.summary.debtMinor);
      find('[data-finance-period-label]').textContent = data.periodLabel;
      const completeness = find('[data-finance-completeness]');
      const known = data.summary.paymentKnownVisits, total = data.summary.totalVisits;
      const trustMessages = [];
      if (!ledgerKnown) trustMessages.push('Расходы ещё не подключены к финансовому журналу. Итог за период не рассчитан.');
      else if (!data.resultReliable) trustMessages.push('Не все финансовые источники сверены. Итог за период не рассчитан.');
      if (data.completeness.message) trustMessages.push(data.completeness.message);
      else if (total && known < total) trustMessages.push(`Оплата указана в ${known} из ${total} визитов. Получено учитывает только подтверждённые деньги.`);
      completeness.textContent = trustMessages.join(' ');
      completeness.hidden = !trustMessages.length;
      const hasData = data.movement.length || data.operations.length || data.summary.receivedMinor || data.summary.expenseMinor || data.summary.serviceMinor || data.summary.debtMinor;
      const showContent = Boolean(hasData || !netKnown);
      const canAddExpense = data.permissions.canAddExpense && ledgerKnown && typeof adapter.createExpense === 'function';
      elements.add.hidden = !canAddExpense || !showContent; elements.emptyAction.hidden = !canAddExpense || showContent;
      elements.content.hidden = !showContent; elements.empty.hidden = showContent;
      const expenseLegend = root.querySelector('.finance-center__legend .is-expense');
      expenseLegend.textContent = ledgerKnown ? '\u2212 Расходы' : '\u2212 Расходы не подключены';
      renderChart(data.movement, ledgerKnown); renderRing(data.expenseCategories, data.summary.expenseMinor, ledgerKnown); renderOperations(ledgerKnown); fillExpenseChoices(data.expenseDirectory, data.paymentAccounts);
    }

    function fillExpenseChoices(rows, accounts) {
      elements.category.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = rows.length ? 'Выберите категорию' : 'Категории недоступны'; elements.category.append(placeholder);
      rows.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; elements.category.append(option); });
      elements.account.replaceChildren();
      const accountPlaceholder = document.createElement('option'); accountPlaceholder.value = ''; accountPlaceholder.textContent = accounts.length ? 'Выберите счёт' : 'Счета недоступны'; elements.account.append(accountPlaceholder);
      accounts.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; elements.account.append(option); });
      if (accounts.length === 1) elements.account.value = accounts[0].id;
      elements.submit.disabled = !rows.length || !accounts.length;
    }

    async function load({ quiet = false } = {}) {
      const version = ++state.loadVersion;
      state.abort?.abort(); state.abort = new AbortController();
      if (!quiet) setLoading(true, state.data ? 'Обновляем данные\u2026' : 'Загружаем финансовые данные\u2026');
      try {
        const raw = await adapter.readDashboard({ period:state.period, masterId:state.master, signal:state.abort.signal });
        if (state.destroyed || version !== state.loadVersion) return;
        const normalized = normalizeDashboard(raw);
        if (!Array.isArray(raw?.filters?.periods)) normalized.filters.periods = optionRows(options.periods, PERIOD_FALLBACK);
        if (!Array.isArray(raw?.filters?.masters)) normalized.filters.masters = optionRows(options.masters, MASTER_FALLBACK);
        normalized.filters.selectedPeriod = normalized.filters.selectedPeriod || state.period;
        normalized.filters.selectedMaster = normalized.filters.selectedMaster || state.master;
        render(normalized); setLoading(false);
      } catch (error) {
        if (error?.name === 'AbortError' || state.destroyed || version !== state.loadVersion) return;
        setLoading(false, 'Не удалось загрузить финансовые данные.');
        if (!state.data) { elements.content.hidden = true; elements.empty.hidden = true; }
      }
    }

    async function openExpense() {
      if (!state.data?.permissions.canAddExpense) return;
      const needsPreparation = !state.data.expenseDirectory.length || !state.data.paymentAccounts.length;
      if (needsPreparation && typeof adapter.prepareExpense === 'function') {
        elements.add.disabled = true; elements.emptyAction.disabled = true;
        setLoading(true, 'Готовим справочники расходов\u2026');
        try {
          const prepared = await adapter.prepareExpense({ period:state.period, masterId:state.master });
          if (prepared?.dashboard) render(normalizeDashboard(prepared.dashboard));
          else if (prepared && (Array.isArray(prepared.expenseDirectory) || Array.isArray(prepared.paymentAccounts))) {
            render(normalizeDashboard({ ...state.data, ...prepared, summary:state.data.summary, filters:state.data.filters }));
          } else await load({ quiet:true });
        } catch (error) {
          setLoading(false, text(error?.userMessage, 'Не удалось подготовить добавление расхода.'));
          elements.add.disabled = false; elements.emptyAction.disabled = false;
          return;
        }
        elements.add.disabled = false; elements.emptyAction.disabled = false; setLoading(false);
      }
      if (!state.data?.expenseDirectory.length || !state.data?.paymentAccounts.length) {
        setLoading(false, 'Для добавления расхода нужны доступная категория и счёт списания.');
        return;
      }
      elements.formError.hidden = true; elements.formError.textContent = '';
      if (!elements.form.elements.occurredOn.value) elements.form.elements.occurredOn.value = state.data.today || (typeof options.today === 'function' ? options.today() : todayInTimezone(state.data.timezone));
      if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal(); else elements.dialog.setAttribute('open', '');
      elements.category.focus();
    }

    function closeExpense() { if (elements.dialog.open && typeof elements.dialog.close === 'function') elements.dialog.close(); else elements.dialog.removeAttribute('open'); }

    function expensePayload() {
      const fields = new FormData(elements.form); return {
        requestId:state.requestId || requestUuid(),
        categoryId:text(fields.get('categoryId')), paymentAccountId:text(fields.get('paymentAccountId')), amountMinor:parseRubles(fields.get('amount')),
        occurredOn:text(fields.get('occurredOn')), note:text(fields.get('note'))
      };
    }

    function ambiguous(error) { return Boolean(error?.ambiguous || ['AMBIGUOUS_RESULT', 'NETWORK_ERROR', 'TIMEOUT'].includes(error?.code)); }

    async function submitExpense(event) {
      event.preventDefault();
      const payload = expensePayload(); state.requestId = payload.requestId;
      if (!payload.categoryId || !payload.paymentAccountId || !payload.amountMinor || !/^\d{4}-\d{2}-\d{2}$/.test(payload.occurredOn)) {
        elements.formError.textContent = 'Проверьте категорию, счёт списания, дату и сумму расхода.'; elements.formError.hidden = false; return;
      }
      elements.submit.disabled = true; elements.submit.textContent = 'Сохраняем\u2026'; elements.formError.hidden = true;
      try {
        await adapter.createExpense(payload);
        state.requestId = ''; elements.form.reset(); closeExpense(); onNotice('Расход добавлен'); await load({ quiet:true });
      } catch (error) {
        if (ambiguous(error)) {
          let found = null;
          if (typeof adapter.findExpenseByRequestId === 'function') {
            try { found = await adapter.findExpenseByRequestId(payload.requestId); } catch (_) { found = null; }
          }
          if (found) {
            state.requestId = ''; elements.form.reset(); closeExpense(); onNotice('Расход уже сохранён'); await load({ quiet:true });
          } else {
            elements.formError.textContent = 'Не удалось подтвердить результат. Повтор использует тот же номер запроса и не создаст дубль.'; elements.formError.hidden = false;
          }
        } else {
          elements.formError.textContent = text(error?.userMessage, 'Не удалось добавить расход. Данные сохранены в форме.'); elements.formError.hidden = false;
        }
      } finally {
        elements.submit.disabled = !state.data?.expenseDirectory.length || !state.data?.paymentAccounts.length; elements.submit.textContent = state.requestId ? 'Повторить безопасно' : 'Добавить расход';
      }
    }

    async function loadMore() {
      if (!state.nextCursor || typeof adapter.readOperations !== 'function') return;
      elements.more.disabled = true; elements.more.textContent = 'Загружаем\u2026';
      try {
        const result = await adapter.readOperations({ period:state.period, masterId:state.master, cursor:state.nextCursor });
        const incoming = Array.isArray(result?.operations) ? result.operations.map(normalizeOperation).filter(Boolean) : [];
        const seen = new Set(state.operations.map(item => item.id).filter(Boolean));
        state.operations.push(...incoming.filter(item => !item.id || !seen.has(item.id)));
        state.nextCursor = text(result?.nextCursor); renderOperations();
      } catch (_) { onNotice('Не удалось загрузить следующие операции'); }
      finally { elements.more.disabled = false; elements.more.textContent = 'Показать ещё'; }
    }

    const listeners = [];
    function listen(target, type, handler) { target?.addEventListener(type, handler); listeners.push(() => target?.removeEventListener(type, handler)); }
    listen(elements.period, 'change', () => { state.period = elements.period.value; void load(); });
    listen(elements.master, 'change', () => { state.master = elements.master.value; void load(); });
    listen(elements.add, 'click', () => void openExpense()); listen(elements.emptyAction, 'click', () => void openExpense());
    listen(find('[data-finance-close]'), 'click', closeExpense); listen(find('[data-finance-cancel]'), 'click', closeExpense);
    listen(elements.form, 'submit', event => void submitExpense(event)); listen(elements.more, 'click', () => void loadMore());
    listen(elements.dialog, 'click', event => { if (event.target === elements.dialog) closeExpense(); });

    fillOptions(elements.period, optionRows(options.periods, PERIOD_FALLBACK), state.period);
    fillOptions(elements.master, optionRows(options.masters, MASTER_FALLBACK), state.master);
    const controller = {
      root,
      ready:load(),
      reload:() => load(),
      openExpense,
      getState:() => ({ period:state.period, master:state.master, nextCursor:state.nextCursor, pendingRequestId:state.requestId }),
      destroy() {
        if (state.destroyed) return;
        state.destroyed = true; state.abort?.abort(); listeners.splice(0).forEach(remove => remove());
        if (elements.dialog.open) closeExpense(); root.replaceChildren(); instances.delete(root);
      }
    };
    instances.set(root, controller);
    return controller;
  }

  function destroy(target) {
    if (target?.destroy && typeof target.destroy === 'function') target.destroy();
    else if (target instanceof Element) instances.get(target)?.destroy();
  }

  global.MinutaFinanceCenter = Object.freeze({ init, destroy, formatRubles, parseRubles, normalizeDashboard });
})(globalThis);
