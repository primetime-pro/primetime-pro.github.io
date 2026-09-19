(() => {
  'use strict';

  const rubles = minor => `${new Intl.NumberFormat('ru-RU').format((Number(minor) || 0) / 100)} ₽`;
  const number = value => Number(String(value ?? '').replace(',', '.')) || 0;
  const minor = value => Math.round(number(value) * 100);
  const uuid = () => crypto.randomUUID();
  const dateText = value => value ? new Date(value).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' }) : '—';
  const operationNames = {
    visit_service:'Визит', commercial_sale:'Продажа', commercial_refund:'Возврат',
    supplier_expense_accrual:'Расход', supplier_expense_payment:'Оплата расхода',
    customer_debt_settlement:'Погашение долга', payroll_accrual:'Начисление зарплаты',
    payroll_payment:'Выплата зарплаты', payroll_advance:'Аванс', payroll_advance_offset:'Зачёт аванса', reversal:'Сторно'
  };
  const commerceActionNames = {
    commercial_sale_created:'Продажа проведена', commercial_sale_refunded:'Возврат проведён',
    recurring_expense_created:'Регулярный расход создан', recurring_expense_recorded:'Регулярный расход учтён'
  };

  function requestIntent(scope, payload) {
    const key = `minuta-commerce-intent:${scope}`;
    const fingerprint = JSON.stringify(payload);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved?.fingerprint === fingerprint && saved?.requestId) return { key, requestId:saved.requestId };
      const requestId = uuid();
      localStorage.setItem(key, JSON.stringify({ fingerprint, requestId, createdAt:new Date().toISOString() }));
      return { key, requestId };
    } catch {
      return { key, requestId:uuid() };
    }
  }

  function clearIntent(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function errorMessage(error) {
    const source = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    if (source.includes('finance_disabled')) return 'Сначала включите единый финансовый учёт.';
    if (source.includes('benefits_disabled')) return 'Сначала включите абонементы и сертификаты.';
    if (source.includes('inventory_disabled')) return 'Сначала включите складской учёт.';
    if (source.includes('insufficient') || source.includes('negative')) return 'На выбранном складе недостаточно товара.';
    if (source.includes('used_benefit')) return 'Использованный или зарезервированный продукт вернуть нельзя.';
    if (source.includes('unallocatable')) return 'Для этой суммы возможен только полный возврат.';
    if (source.includes('amount_mismatch')) return 'Сумма возврата должна соответствовать выбранному количеству.';
    if (source.includes('exceeds_remaining')) return 'Количество или сумма превышает доступный остаток возврата.';
    if (source.includes('cash_account_required')) return 'Для наличной оплаты выберите кассу.';
    if (source.includes('cash_or_bank_account_required')) return 'Выберите действующую кассу или счёт.';
    if (source.includes('seller_not_active_member')) return 'Выберите активного сотрудника-продавца.';
    if (source.includes('permission') || source.includes('42501')) return 'Недостаточно прав для финансовой операции.';
    return 'Операция не выполнена. Данные не изменены; можно безопасно повторить.';
  }

  function setError(element, error) {
    if (!element) return;
    element.textContent = typeof error === 'string' ? error : errorMessage(error);
    element.hidden = !element.textContent;
  }

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    let organization = null;
    let state = null;
    let loading = false;
    let bound = false;
    let pendingSaleClaim = null;
    let saleClaimSecret = '';
    let saleClaimExpiryTimer = 0;
    const activeWrites = new Set();

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function clearSaleClaimResult({ forgetRequest = true } = {}) {
      saleClaimSecret = '';
      clearTimeout(saleClaimExpiryTimer);
      saleClaimExpiryTimer = 0;
      if (forgetRequest && pendingSaleClaim?.intentKey) clearIntent(pendingSaleClaim.intentKey);
      if (forgetRequest) pendingSaleClaim = null;
      const holder = $('#commerceClientAccessResult');
      if (!holder) return;
      holder.hidden = true;
      holder.classList.remove('is-loading', 'is-error');
      $('#commerceClientAccessTitle').textContent = 'Передайте код клиенту';
      $('#commerceClientAccessCode').textContent = '';
      $('#commerceClientAccessCode').hidden = true;
      $('#commerceClientAccessExpiry').textContent = '';
      $('#commerceClientAccessExpiry').hidden = true;
      $('#commerceClientAccessNote').textContent = 'Код одноразовый и открывает только покупки этой организации.';
      $('#commerceClientAccessCopy').hidden = true;
      $('#commerceClientAccessCopy').disabled = false;
      $('#commerceClientAccessRetry').hidden = true;
      $('#commerceClientAccessRetry').disabled = false;
      $('#commerceClientAccessRetry').textContent = 'Повторить выдачу кода';
    }

    function normalizedSaleClaim(data) {
      if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') return null;
      const token = data[0].claim_token;
      const expiresAt = data[0].claim_expires_at;
      if (typeof token !== 'string' || typeof expiresAt !== 'string') return null;
      const expiresTime = Date.parse(expiresAt);
      const now = Date.now();
      if (!/^PTS1-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/.test(token) || !Number.isFinite(expiresTime)
        || expiresTime <= now || expiresTime > now + 10 * 60_000) return null;
      return { token, expiresAt, expiresTime };
    }

    function renderSaleClaimPending() {
      clearSaleClaimResult({ forgetRequest:false });
      const holder = $('#commerceClientAccessResult');
      holder.hidden = false;
      holder.classList.add('is-loading');
      $('#commerceClientAccessTitle').textContent = 'Создаём код доступа…';
      $('#commerceClientAccessNote').textContent = 'Продажа уже проведена. Повторная продажа не создаётся.';
    }

    function renderSaleClaimError(message, { retry = true, retryLabel = 'Повторить выдачу кода' } = {}) {
      saleClaimSecret = '';
      clearTimeout(saleClaimExpiryTimer);
      saleClaimExpiryTimer = 0;
      const holder = $('#commerceClientAccessResult');
      holder.hidden = false;
      holder.classList.remove('is-loading');
      holder.classList.add('is-error');
      $('#commerceClientAccessTitle').textContent = 'Продажа проведена, код не создан';
      $('#commerceClientAccessCode').textContent = '';
      $('#commerceClientAccessCode').hidden = true;
      $('#commerceClientAccessExpiry').textContent = '';
      $('#commerceClientAccessExpiry').hidden = true;
      $('#commerceClientAccessNote').textContent = message;
      $('#commerceClientAccessCopy').hidden = true;
      $('#commerceClientAccessRetry').hidden = !retry;
      $('#commerceClientAccessRetry').textContent = retryLabel;
      applyWriteAvailability?.(holder);
    }

    function renderSaleClaimSuccess(claim) {
      saleClaimSecret = claim.token;
      const holder = $('#commerceClientAccessResult');
      holder.hidden = false;
      holder.classList.remove('is-loading', 'is-error');
      $('#commerceClientAccessTitle').textContent = pendingSaleClaim?.clientName
        ? `Код для ${pendingSaleClaim.clientName}` : 'Передайте код клиенту';
      $('#commerceClientAccessCode').textContent = claim.token;
      $('#commerceClientAccessCode').hidden = false;
      $('#commerceClientAccessExpiry').textContent = `Действует до ${new Date(claim.expiresAt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}`;
      $('#commerceClientAccessExpiry').hidden = false;
      $('#commerceClientAccessNote').textContent = 'Код одноразовый и открывает только покупки этой организации.';
      $('#commerceClientAccessCopy').hidden = false;
      $('#commerceClientAccessRetry').hidden = true;
      clearTimeout(saleClaimExpiryTimer);
      saleClaimExpiryTimer = setTimeout(() => {
        if (saleClaimSecret === claim.token) renderSaleClaimError(
          'Срок кода истёк. Продажа сохранена — можно безопасно выдать новый код.',
          { retryLabel:'Выдать новый код' }
        );
      }, Math.max(0, claim.expiresTime - Date.now()));
    }

    function saleClaimFailure(error) {
      const source = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
      if (source.includes('client_claim_already_consumed')) {
        return {
          message:'Предыдущий код уже использован. Продажа сохранена — при необходимости выдайте новый код.',
          renew:true,
          retryLabel:'Выдать новый код'
        };
      }
      if (source.includes('client_claim_superseded')) {
        return {
          message:'Предыдущий код уже заменён. Продажа сохранена — при необходимости выдайте новый код.',
          renew:true,
          retryLabel:'Выдать новый код'
        };
      }
      if (source.includes('client_sale_claim_denied') || source.includes('permission') || source.includes('42501')) {
        return { message:'Нет прав на выдачу кода для этой продажи. Продажу повторять не нужно.', retry:false };
      }
      if (source.includes('issue_client_identity_sale_claim_v155') || source.includes('function') || source.includes('schema cache')) {
        return { message:'Сервер ещё не поддерживает выдачу кода. Продажу повторять не нужно.', retry:false };
      }
      if (source.includes('invalid_client_sale_claim_response')) {
        return { message:'Сервер не подтвердил безопасный код. Повторите только выдачу кода.' };
      }
      return { message:'Повторите только выдачу кода — сама продажа уже сохранена.' };
    }

    async function issueSaleClaim(target) {
      if (!organization?.id || target?.organizationId !== organization.id
        || !uuidPattern.test(String(target?.saleId || '')) || !uuidPattern.test(String(target?.clientId || ''))) {
        renderSaleClaimError('Сервер не подтвердил продажу с выбранным клиентом. Продажу повторять не нужно.', { retry:false });
        return false;
      }
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const intent = uuidPattern.test(String(target.requestId || ''))
        ? { key:String(target.intentKey || ''), requestId:target.requestId }
        : requestIntent(`${organization.id}:sale-claim`, { sale:target.saleId, client:target.clientId });
      pendingSaleClaim = { ...target, intentKey:intent.key, requestId:intent.requestId };
      renderSaleClaimPending();
      try {
        const result = await db.rpc('issue_client_identity_sale_claim_v155', {
          p_organization:organization.id,
          p_sale:target.saleId,
          p_request_id:intent.requestId,
          p_expires_minutes:10
        });
        if (!sessionIsCurrent(userId, generation) || organization?.id !== target.organizationId
          || pendingSaleClaim?.saleId !== target.saleId || pendingSaleClaim?.clientId !== target.clientId) return false;
        if (result.error) throw result.error;
        const claim = normalizedSaleClaim(result.data);
        if (!claim) throw new Error('invalid_client_sale_claim_response');
        clearIntent(intent.key);
        pendingSaleClaim.intentKey = '';
        renderSaleClaimSuccess(claim);
        return true;
      } catch (error) {
        if (sessionIsCurrent(userId, generation) && organization?.id === target.organizationId
          && pendingSaleClaim?.saleId === target.saleId && pendingSaleClaim?.clientId === target.clientId) {
          const failure = saleClaimFailure(error);
          if (failure.renew) {
            if (pendingSaleClaim.intentKey) clearIntent(pendingSaleClaim.intentKey);
            pendingSaleClaim.intentKey = '';
            pendingSaleClaim.requestId = '';
          }
          renderSaleClaimError(failure.message, failure);
        }
        return false;
      }
    }

    async function copySaleClaim() {
      if (!saleClaimSecret) return;
      const button = $('#commerceClientAccessCopy');
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(saleClaimSecret);
        notify('Код доступа скопирован');
      } catch {
        notify('Не удалось скопировать код');
      } finally {
        button.disabled = false;
      }
    }

    function syncSaleFocusMode() {
      document.body.classList.toggle('commerce-sale-open', Boolean($('#commerceSaleCreator')?.open));
    }

    const eligibleAccounts = (method = $('#commercePaymentMethod')?.value || 'cash') => (state?.accounts || [])
      .filter(item => item.system_key === null && ['cash', 'bank'].includes(item.account_type))
      .filter(item => method !== 'cash' || item.account_type === 'cash');

    const accountOptions = (selected = '', method = $('#commercePaymentMethod')?.value || 'cash') => eligibleAccounts(method)
      .map(item => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');

    function selectOptions(items, label, selected = '') {
      return items.map(item => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(label(item))}</option>`).join('');
    }

    function currentItems() {
      return $('#commerceItemKind')?.value === 'benefit_product' ? state?.benefit_products || [] : state?.inventory_items || [];
    }

    function renderItemControls() {
      const benefits = $('#commerceItemKind')?.value === 'benefit_product';
      const items = currentItems();
      const itemSelect = $('#commerceItem');
      const selectedItemId = itemSelect?.value || '';
      if ($('#commerceWarehouseField')) $('#commerceWarehouseField').hidden = benefits;
      if ($('#commerceQuantityField')) $('#commerceQuantityField').hidden = benefits;
      $('#commerceSaleForm')?.classList.toggle('is-benefit-sale', benefits);
      if ($('#commerceClient')) $('#commerceClient').required = benefits;
      if ($('#commerceWarehouse')) $('#commerceWarehouse').required = !benefits;
      if ($('#commerceQuantity')) {
        $('#commerceQuantity').disabled = benefits;
        if (benefits) $('#commerceQuantity').value = '1';
      }
      if (itemSelect) itemSelect.innerHTML = items.length
        ? selectOptions(items, item => item.kind ? `${item.name} · ${item.kind === 'certificate' ? 'сертификат' : item.kind === 'package' ? 'пакет' : 'абонемент'}` : `${item.name}${item.sku ? ` · ${item.sku}` : ''}`, selectedItemId)
        : '<option value="">Сначала создайте позицию</option>';
      const selected = items.find(item => item.id === selectedItemId) || items[0];
      if (itemSelect && selected) itemSelect.value = selected.id;
      if (benefits && selected && $('#commerceUnitPrice')) $('#commerceUnitPrice').value = String((Number(selected.sale_price_minor) || 0) / 100);
    }

    function renderBookings() {
      const select = $('#commerceBooking');
      if (!select) return;
      const clientId = $('#commerceClient')?.value || '';
      const rows = (state?.bookings || []).filter(item => !clientId || item.client_account_id === clientId);
      select.innerHTML = '<option value="">Отдельная продажа</option>' + selectOptions(rows, item => `${dateText(item.booking_date)} ${String(item.booking_time || '').slice(0, 5)} · ${item.client_name} · ${item.service_name}`);
    }

    function selectSaleSeller(sellerId = '') {
      const select = $('#commerceSeller');
      if (!select) return;
      const target = sellerId || getCurrentUser()?.id || '';
      if ([...select.options].some(option => option.value === target)) select.value = target;
    }

    function renderPaymentAccounts(selected = $('#commercePaymentAccount')?.value || '') {
      const select = $('#commercePaymentAccount');
      if (!select) return;
      const accounts = eligibleAccounts();
      const target = accounts.some(item => item.id === selected) ? selected : accounts[0]?.id || '';
      select.innerHTML = accounts.length ? accountOptions(target) : '<option value="">Нет доступной кассы</option>';
      select.value = target;
      select.disabled = accounts.length === 0;
      renderAccountSetup(accounts);
    }

    function canCreateFinancialAccount() {
      return ['owner', 'admin'].includes(organization?.current_role);
    }

    function renderAccountSetup(accounts = eligibleAccounts()) {
      const allowed = canCreateFinancialAccount();
      const missing = accounts.length === 0;
      const setup = $('#commerceAccountSetup');
      const trigger = $('#commerceAccountCreateOpen');
      const hint = $('#commercePaymentAccountHint');
      if (hint) {
        hint.hidden = !missing;
        hint.textContent = $('#commercePaymentMethod')?.value === 'cash'
          ? 'Для наличной оплаты сначала создайте кассу.'
          : 'Для ручной оплаты сначала создайте кассу или банковский счёт.';
      }
      if (!allowed) {
        if (trigger) trigger.hidden = true;
        if (setup) setup.hidden = true;
        return;
      }
      if (missing) {
        if ($('#commerceSaleOptions')) $('#commerceSaleOptions').open = true;
        if (setup) setup.hidden = false;
        if (trigger) trigger.hidden = true;
        const type = $('#commerceAccountType');
        const name = $('#commerceAccountName');
        if (type && $('#commercePaymentMethod')?.value === 'cash') type.value = 'cash';
        if (name && !name.value) name.value = type?.value === 'bank' ? 'Расчётный счёт' : 'Основная касса';
      } else if (trigger) {
        trigger.hidden = !setup?.hidden;
      }
    }

    function toggleAccountSetup(force) {
      const setup = $('#commerceAccountSetup');
      if (!setup || !canCreateFinancialAccount()) return;
      setup.hidden = typeof force === 'boolean' ? !force : !setup.hidden;
      const trigger = $('#commerceAccountCreateOpen');
      if (trigger) trigger.hidden = !setup.hidden;
      if (!setup.hidden) {
        setError($('#commerceAccountError'), '');
        const type = $('#commerceAccountType');
        const name = $('#commerceAccountName');
        if (type && $('#commercePaymentMethod')?.value === 'cash') type.value = 'cash';
        if (name && !name.value) name.value = type?.value === 'bank' ? 'Расчётный счёт' : 'Основная касса';
        name?.focus({ preventScroll:true });
      }
    }

    async function createFinancialAccount() {
      if (!canCreateFinancialAccount() || !requireWrites() || !organization?.id) return false;
      const name = $('#commerceAccountName')?.value.trim() || '';
      const accountType = $('#commerceAccountType')?.value || '';
      const errorElement = $('#commerceAccountError');
      if (name.length < 2 || name.length > 120 || !['cash', 'bank'].includes(accountType)) {
        setError(errorElement, 'Укажите название от 2 до 120 символов и выберите тип.');
        return false;
      }
      const writeKey = `${organization.id}:financial-account`;
      if (activeWrites.has(writeKey)) return false;
      const payload = { name, accountType };
      const intent = requestIntent(`${organization.id}:financial-account`, payload);
      const button = $('#commerceAccountSubmit');
      const originalLabel = button.textContent;
      const organizationId = organization.id;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      activeWrites.add(writeKey);
      button.disabled = true;
      button.textContent = 'Создаём…';
      setError(errorElement, '');
      try {
        const result = await db.rpc('create_minuta_financial_account_v129', {
          p_organization:organizationId,
          p_request_id:intent.requestId,
          p_name:name,
          p_account_type:accountType
        });
        if (result.error) throw result.error;
        const created = result.data;
        if (!created || !uuidPattern.test(String(created.id || '')) || created.organization_id !== organizationId
          || created.name !== name || created.account_type !== accountType) throw new Error('invalid_financial_account_response');
        clearIntent(intent.key);
        if (!sessionIsCurrent(userId, generation) || organization?.id !== organizationId) return true;
        try {
          await load();
          if (eligibleAccounts().some(item => item.id === created.id)) {
            $('#commercePaymentAccount').value = created.id;
            toggleAccountSetup(false);
          }
          $('#commerceAccountName').value = '';
          updateSaleValidity();
          notify(created.replayed ? 'Касса или счёт уже были созданы — повтор не добавлен' : 'Касса или счёт созданы');
        } catch {
          notify('Касса или счёт созданы. Список обновится после восстановления связи');
        }
        return true;
      } catch (error) {
        if (sessionIsCurrent(userId, generation) && organization?.id === organizationId) setError(errorElement, error);
        return false;
      } finally {
        activeWrites.delete(writeKey);
        button.textContent = originalLabel;
        button.disabled = false;
        applyWriteAvailability?.($('#commerceAccountSetup'));
      }
    }

    function updateSaleOptionsSummary() {
      const summary = $('#commerceSaleOptionsSummary');
      if (!summary) return;
      const warehouse = (state?.warehouses || []).find(item => item.id === $('#commerceWarehouse')?.value)?.name;
      const seller = (state?.sellers || []).find(item => item.id === $('#commerceSeller')?.value)?.name;
      const account = (state?.accounts || []).find(item => item.id === $('#commercePaymentAccount')?.value)?.name;
      const payment = $('#commercePaymentMethod')?.value === 'manual' ? 'вручную' : 'наличные';
      summary.textContent = [$('#commerceItemKind')?.value === 'inventory_item' ? warehouse : null, seller, `${payment}${account ? ` · ${account}` : ''}`]
        .filter(Boolean).join(' · ') || 'Заполните детали операции';
    }

    function updateSaleValidity() {
      const submit = $('#commerceSaleSubmit');
      const total = $('#commerceSaleTotal');
      if (!submit || !total) return false;
      const benefit = $('#commerceItemKind')?.value === 'benefit_product';
      const quantity = benefit ? 1 : number($('#commerceQuantity')?.value);
      const price = minor($('#commerceUnitPrice')?.value);
      const discount = minor($('#commerceDiscount')?.value);
      const subtotal = Math.round(quantity * price);
      const result = subtotal - discount;
      const finiteNumbers = [quantity, price, discount, subtotal, result].every(Number.isFinite);
      const valid = Boolean(
        finiteNumbers && $('#commerceItem')?.value && $('#commerceSeller')?.value && $('#commercePaymentAccount')?.value
        && quantity > 0 && price > 0 && discount >= 0 && result > 0
        && (benefit ? $('#commerceClient')?.value : $('#commerceWarehouse')?.value)
      );
      total.textContent = finiteNumbers && result > 0 ? rubles(result) : '—';
      submit.disabled = !valid || activeWrites.has(`${organization?.id}:sale`);
      updateSaleOptionsSummary();
      return valid;
    }

    function renderSales() {
      const sales = state?.sales || [];
      const gross = sales.reduce((sum, item) => sum + Number(item.total_minor || 0), 0);
      const refunded = sales.reduce((sum, item) => sum + Number(item.refunded_minor || 0), 0);
      $('#commerceSalesCount').textContent = String(sales.length);
      $('#commerceGross').textContent = rubles(gross);
      $('#commerceRefunded').textContent = rubles(refunded);
      $('#commerceNet').textContent = rubles(gross - refunded);
      $('#commerceSalesList').innerHTML = sales.length ? sales.map(sale => {
        const remainingAmount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
        const remainingQuantity = number(sale.line?.quantity) - number(sale.line?.refunded_quantity);
        const status = sale.status === 'refunded' ? 'Возвращено' : sale.status === 'partially_refunded' ? 'Частичный возврат' : 'Оплачено';
        return `<article class="commerce-sale-row"><div><small>${escapeHtml(dateText(sale.occurred_at))} · ${escapeHtml(status)}</small><strong>${escapeHtml(sale.line?.item_name || 'Продажа')}</strong><span>${sale.client_name ? `${escapeHtml(sale.client_name)} · ` : ''}${escapeHtml(String(sale.line?.quantity || 1))} × ${escapeHtml(rubles(sale.line?.unit_price_minor))}${sale.booking_id ? ' · внутри визита' : ' · отдельно'}</span><span>Продавец: ${escapeHtml(sale.seller_name || 'Сотрудник')}</span></div><div><strong>${escapeHtml(rubles(Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0)))}</strong>${remainingAmount > 0 && remainingQuantity > 0 ? `<button class="secondary-button compact-button" type="button" data-commerce-refund="${escapeHtml(sale.id)}">Возврат</button>` : ''}</div></article>`;
      }).join('') : '<p class="report-empty-inline">Продаж пока нет.</p>';
    }

    function renderAudit() {
      const rows = state?.audit || [];
      const count = $('#commerceAuditCount');
      const list = $('#commerceAuditList');
      if (!count || !list) return;
      count.textContent = String(rows.length);
      list.innerHTML = rows.length ? rows.map(entry => {
        const details = entry.details || {};
        const seller = (state?.sellers || []).find(item => item.id === details.seller_id)?.name;
        const amount = Number(details.total_minor ?? details.amount_minor);
        const detailText = [details.name, seller ? `Продавец: ${seller}` : '', Number.isFinite(amount) ? rubles(amount) : '', details.quantity ? `${details.quantity} шт.` : '', details.occurred_on]
          .filter(Boolean).join(' · ');
        return `<article class="commerce-audit-row"><div><small>${escapeHtml(dateText(entry.created_at))}</small><strong>${escapeHtml(commerceActionNames[entry.action] || 'Операция')}</strong>${detailText ? `<span>${escapeHtml(detailText)}</span>` : ''}</div></article>`;
      }).join('') : '<p class="report-empty-inline">История появится после первой операции.</p>';
    }

    function refundableSales() {
      return (state?.sales || []).filter(sale => (
        Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0) > 0
        && number(sale.line?.quantity) - number(sale.line?.refunded_quantity) > 0
      ));
    }

    function selectedRefundSale() {
      const saleId = $('#commerceRefundSale')?.value || '';
      return refundableSales().find(sale => sale.id === saleId) || null;
    }

    function expectedRefundAmount(sale, quantity) {
      if (!sale || quantity <= 0) return 0;
      const units = value => {
        const scaled = number(value) * 1000;
        return Number.isFinite(scaled) && scaled > 0 && Math.abs(scaled - Math.round(scaled)) < 1e-7 ? BigInt(Math.round(scaled)) : 0n;
      };
      const totalQuantity = units(sale.line?.quantity);
      const refundedQuantity = number(sale.line?.refunded_quantity) > 0 ? units(sale.line.refunded_quantity) : 0n;
      const refundQuantity = units(quantity);
      if (totalQuantity <= 0n || refundQuantity <= 0n || refundQuantity > totalQuantity - refundedQuantity) return 0;
      const remainingAmount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
      if (refundQuantity === totalQuantity - refundedQuantity) return remainingAmount;
      const numerator = BigInt(Math.trunc(Number(sale.total_minor || 0))) * (refundedQuantity + refundQuantity);
      const cumulativeAmount = (2n * numerator + totalQuantity) / (2n * totalQuantity);
      const expected = Number(cumulativeAmount) - Number(sale.refunded_minor || 0);
      return expected > 0 && expected < remainingAmount ? expected : 0;
    }

    function syncRefundAmount() {
      const amount = $('#commerceRefundAmount');
      if (!amount) return;
      const expected = expectedRefundAmount(selectedRefundSale(), number($('#commerceRefundQuantity')?.value));
      amount.value = expected > 0 ? String(expected / 100) : '';
    }

    function updateRefundValidity() {
      const submit = $('#commerceRefundSubmit');
      if (!submit) return false;
      const sale = selectedRefundSale();
      const quantity = number($('#commerceRefundQuantity')?.value);
      const amount = minor($('#commerceRefundAmount')?.value);
      const reason = $('#commerceRefundReason')?.value.trim() || '';
      const remainingQuantity = sale ? number(sale.line?.quantity) - number(sale.line?.refunded_quantity) : 0;
      const remainingAmount = sale ? Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0) : 0;
      const valid = Boolean(sale && quantity > 0 && quantity <= remainingQuantity && amount > 0 && amount <= remainingAmount && amount === expectedRefundAmount(sale, quantity) && reason.length >= 3);
      submit.disabled = !valid;
      return valid;
    }

    function renderRefundControls() {
      const sales = state?.sales || [];
      const candidates = refundableSales();
      const creator = $('#commerceRefundCreator');
      const empty = $('#commerceRefundEmpty');
      const select = $('#commerceRefundSale');
      if (!creator || !empty || !select) return;
      const selected = candidates.some(sale => sale.id === select.value) ? select.value : '';
      select.innerHTML = '<option value="">Выберите продажу</option>' + selectOptions(candidates, sale => {
        const remainingAmount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
        return `${dateText(sale.occurred_at)} · ${sale.line?.item_name || 'Продажа'}${sale.client_name ? ` · ${sale.client_name}` : ''} · осталось ${rubles(remainingAmount)}`;
      }, selected);
      creator.hidden = candidates.length === 0;
      if (!candidates.length) creator.open = false;
      empty.hidden = candidates.length > 0 || sales.length === 0;
      empty.textContent = 'Все продажи полностью возвращены.';
      updateRefundValidity();
    }

    function renderRecurring() {
      const rows = state?.recurring_expenses || [];
      $('#commerceRecurringCount').textContent = String(rows.length);
      $('#commerceRecurringList').innerHTML = rows.length ? rows.map(item => {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const recorded = String(item.last_occurred_on || '').startsWith(currentMonth);
        return `<article class="commerce-recurring-row"><div><small>Ежемесячно, ${escapeHtml(String(item.day_of_month))}-го числа</small><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.supplier_name)} · ${escapeHtml(rubles(item.amount_minor))}</span></div><button class="secondary-button compact-button" type="button" data-commerce-record-expense="${escapeHtml(item.id)}"${recorded ? ' disabled' : ''}>${recorded ? 'Учтено' : 'Учесть сейчас'}</button></article>`;
      }).join('') : '<p class="report-empty-inline">Добавьте аренду или другой регулярный платёж.</p>';
    }

    function render() {
      if (!state) return;
      $('#commerceWorkspace').hidden = false;
      $('#commerceUnavailable').hidden = true;
      $('#commerceFinanceEnabled').checked = state.finance_enabled === true;
      $('#commerceClient').innerHTML = '<option value="">Без клиента</option>' + selectOptions(state.clients || [], item => `${item.name}${item.phone ? ` · ${item.phone}` : ''}`);
      const currentSeller = $('#commerceSeller')?.value || '';
      $('#commerceSeller').innerHTML = selectOptions(state.sellers || [], item => `${item.name}${item.role ? ` · ${item.role}` : ''}`, currentSeller);
      selectSaleSeller(currentSeller);
      $('#commerceWarehouse').innerHTML = selectOptions(state.warehouses || [], item => item.name);
      renderPaymentAccounts();
      $('#commerceRecurringAccount').innerHTML = accountOptions('', 'manual');
      renderItemControls();
      renderBookings();
      renderSales();
      renderAudit();
      renderRefundControls();
      renderRecurring();
      updateSaleValidity();
      applyWriteAvailability?.($('#commercePanel'));
    }

    async function load() {
      if (!organization?.id || loading) return;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      loading = true;
      $('#commerceLoading').hidden = false;
      $('#commerceUnavailable').hidden = true;
      try {
        const result = await db.rpc('get_minuta_commerce_workspace_v151', { p_organization:organization.id });
        if (result.error) throw result.error;
        if (!sessionIsCurrent(userId, generation) || organization?.id !== result.data?.organization_id) return;
        state = result.data;
        render();
      } catch (error) {
        $('#commerceWorkspace').hidden = true;
        $('#commerceUnavailable').hidden = false;
        $('#commerceUnavailableText').textContent = errorMessage(error);
        throw error;
      } finally {
        loading = false;
        $('#commerceLoading').hidden = true;
      }
    }

    async function write(form, errorElement, scope, payload, rpc, params) {
      if (!requireWrites()) return;
      const writeKey = `${organization.id}:${scope}`;
      if (activeWrites.has(writeKey)) return false;
      activeWrites.add(writeKey);
      const intent = requestIntent(`${organization.id}:${scope}`, payload);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const originalLabel = submit.textContent;
      if (scope === 'sale') submit.textContent = 'Проводим…';
      setError(errorElement, '');
      try {
        let result;
        try {
          result = await db.rpc(rpc, { ...params, p_request_id:intent.requestId });
          if (result.error) throw result.error;
        } catch (error) {
          setError(errorElement, error);
          return false;
        }
        clearIntent(intent.key);
        try {
          await load();
        } catch {
          notify(result.data?.replayed
            ? `${scope === 'sale' ? 'Продажа' : 'Операция'} уже была проведена — повтор не создан`
            : `${scope === 'sale' ? 'Продажа' : 'Операция'} проведена. Список обновится после восстановления связи`);
          return { ok:true, data:result.data };
        }
        notify(result.data?.replayed
          ? `${scope === 'sale' ? 'Продажа' : 'Операция'} уже была проведена — повтор не создан`
          : `${scope === 'sale' ? 'Продажа' : 'Операция'} проведена`);
        return { ok:true, data:result.data };
      } finally {
        activeWrites.delete(writeKey);
        submit.textContent = originalLabel;
        submit.disabled = false;
        if (scope === 'sale') updateSaleValidity();
      }
    }

    async function submitSale(event) {
      event.preventDefault();
      const form = event.currentTarget;
      if (!updateSaleValidity()) return;
      const kind = $('#commerceItemKind').value;
      const quantity = kind === 'benefit_product' ? 1 : number($('#commerceQuantity').value);
      const payload = { kind, item:$('#commerceItem').value, client:$('#commerceClient').value || null, booking:$('#commerceBooking').value || null, seller:$('#commerceSeller').value, warehouse:kind === 'inventory_item' ? $('#commerceWarehouse').value : null, quantity, price:minor($('#commerceUnitPrice').value), discount:minor($('#commerceDiscount').value), method:$('#commercePaymentMethod').value, account:$('#commercePaymentAccount').value };
      const outcome = await write(form, $('#commerceSaleError'), 'sale', payload, 'sell_minuta_commercial_product_v151', {
        p_organization:organization.id, p_booking:payload.booking, p_client_account:payload.client, p_seller:payload.seller,
        p_item_kind:kind, p_benefit_product:kind === 'benefit_product' ? payload.item : null,
        p_inventory_item:kind === 'inventory_item' ? payload.item : null, p_warehouse:payload.warehouse,
        p_quantity:quantity, p_unit_price_minor:payload.price, p_discount_minor:payload.discount,
        p_payment_method:payload.method, p_payment_account:payload.account
      });
      if (outcome?.ok) {
        const paidSale = outcome.data?.status === 'paid'
          && outcome.data?.organization_id === organization.id
          && uuidPattern.test(String(outcome.data?.id || ''));
        const claimTarget = paidSale && payload.client && ['cash', 'manual'].includes(payload.method)
          ? {
              organizationId:organization.id,
              saleId:String(outcome.data?.id || ''),
              clientId:payload.client,
              clientName:(state?.clients || []).find(item => item.id === payload.client)?.name || ''
            }
          : null;
        form.reset();
        $('#commerceQuantity').value = '1';
        $('#commerceDiscount').value = '0';
        selectSaleSeller();
        $('#commerceSaleCreator').open = Boolean(claimTarget);
        syncSaleFocusMode();
        render();
        if (claimTarget) await issueSaleClaim(claimTarget);
      }
    }

    function selectRefundSale(saleId, { focusReason = false } = {}) {
      const sale = refundableSales().find(item => item.id === saleId);
      if (!sale) return;
      const quantity = number(sale.line?.quantity) - number(sale.line?.refunded_quantity);
      const amount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
      $('#commerceRefundSale').value = sale.id;
      $('#commerceRefundQuantity').value = String(quantity);
      $('#commerceRefundQuantity').max = String(quantity);
      $('#commerceRefundQuantity').readOnly = sale.line?.item_kind === 'benefit_product';
      $('#commerceRefundAmount').value = String(amount / 100);
      $('#commerceRefundReason').value = '';
      updateRefundValidity();
      if (focusReason) $('#commerceRefundReason').focus();
    }

    function openRefund(saleId) {
      const creator = $('#commerceRefundCreator');
      if (!creator || creator.hidden) return;
      creator.open = true;
      selectRefundSale(saleId, { focusReason:true });
    }

    async function submitRefund(event) {
      event.preventDefault();
      const form = event.currentTarget;
      if (!updateRefundValidity()) return;
      const payload = { sale:$('#commerceRefundSale').value, quantity:number($('#commerceRefundQuantity').value), amount:minor($('#commerceRefundAmount').value), reason:$('#commerceRefundReason').value.trim() };
      const ok = await write(form, $('#commerceRefundError'), 'refund', payload, 'refund_minuta_commercial_sale_v147', { p_organization:organization.id, p_sale:payload.sale, p_quantity:payload.quantity, p_amount_minor:payload.amount, p_reason:payload.reason });
      if (ok) { form.reset(); $('#commerceRefundCreator').open = false; }
      updateRefundValidity();
    }

    async function submitRecurring(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const expenseAccount = (state?.accounts || []).find(item => item.system_key === 'operating_expense');
      const payload = { name:$('#commerceRecurringName').value.trim(), supplier:$('#commerceRecurringSupplier').value.trim(), amount:minor($('#commerceRecurringAmount').value), day:Math.trunc(number($('#commerceRecurringDay').value)), paymentAccount:$('#commerceRecurringAccount').value, expenseAccount:expenseAccount?.id || '' };
      const ok = await write(form, $('#commerceRecurringError'), 'recurring-create', payload, 'create_minuta_recurring_expense_v147', { p_organization:organization.id, p_name:payload.name, p_supplier_name:payload.supplier, p_amount_minor:payload.amount, p_expense_account:payload.expenseAccount, p_payment_account:payload.paymentAccount, p_day_of_month:payload.day });
      if (ok) { form.reset(); $('#commerceRecurringName').value = 'Аренда'; $('#commerceRecurringDay').value = '1'; }
    }

    async function recordExpense(ruleId, button) {
      if (!requireWrites()) return;
      const today = new Date();
      const occurredOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const payload = { ruleId, occurredOn };
      const intent = requestIntent(`${organization.id}:recurring-record`, payload);
      button.disabled = true;
      try {
        const result = await db.rpc('record_minuta_recurring_expense_v147', { p_organization:organization.id, p_rule:ruleId, p_occurred_on:occurredOn, p_request_id:intent.requestId });
        if (result.error) throw result.error;
        clearIntent(intent.key);
        await load();
        notify(result.data?.replayed ? 'Расход уже учтён в этом месяце' : 'Расход добавлен в денежный журнал');
      } catch (error) {
        notify(errorMessage(error));
        button.disabled = false;
      }
    }

    async function toggleFinance(event) {
      const enabled = event.currentTarget.checked;
      event.currentTarget.disabled = true;
      try {
        if (!requireWrites()) throw new Error('writes_disabled');
        const result = await db.rpc('set_minuta_finance_enabled_v133', { p_organization:organization.id, p_enabled:enabled });
        if (result.error) throw result.error;
        await load();
        notify(enabled ? 'Единый финансовый учёт включён' : 'Финансовый учёт выключен');
      } catch (error) {
        event.currentTarget.checked = !enabled;
        notify(errorMessage(error));
      } finally { event.currentTarget.disabled = false; }
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#reloadCommerce')?.addEventListener('click', () => void load());
      $('#commerceFinanceEnabled')?.addEventListener('change', event => void toggleFinance(event));
      $('#commerceItemKind')?.addEventListener('change', () => { renderItemControls(); updateSaleValidity(); });
      $('#commerceItem')?.addEventListener('change', () => { renderItemControls(); updateSaleValidity(); });
      $('#commerceClient')?.addEventListener('change', () => { clearSaleClaimResult(); renderBookings(); updateSaleValidity(); });
      $('#commerceBooking')?.addEventListener('change', event => {
        const booking = (state?.bookings || []).find(item => item.id === event.currentTarget.value);
        if (booking?.client_account_id) { $('#commerceClient').value = booking.client_account_id; renderBookings(); $('#commerceBooking').value = booking.id; selectSaleSeller(booking.performer_id); }
        updateSaleValidity();
      });
      $('#commercePaymentMethod')?.addEventListener('change', () => { renderPaymentAccounts(); updateSaleValidity(); });
      $('#commerceAccountCreateOpen')?.addEventListener('click', () => toggleAccountSetup());
      $('#commerceAccountSubmit')?.addEventListener('click', () => void createFinancialAccount());
      $('#commerceAccountName')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); void createFinancialAccount(); }
      });
      $('#commerceSaleForm')?.addEventListener('submit', event => void submitSale(event));
      $('#commerceSaleForm')?.addEventListener('input', updateSaleValidity);
      $('#commerceSaleForm')?.addEventListener('change', updateSaleValidity);
      $('#commerceSaleCreator')?.addEventListener('toggle', event => {
        syncSaleFocusMode();
        if (!event.currentTarget.open) clearSaleClaimResult();
      });
      $('#commerceClientAccessCopy')?.addEventListener('click', () => void copySaleClaim());
      $('#commerceClientAccessRetry')?.addEventListener('click', () => {
        if (pendingSaleClaim) void issueSaleClaim(pendingSaleClaim);
      });
      $('#commerceRefundForm')?.addEventListener('submit', event => void submitRefund(event));
      $('#commerceRefundSale')?.addEventListener('change', event => {
        if (event.currentTarget.value) selectRefundSale(event.currentTarget.value);
        else {
          $('#commerceRefundQuantity').value = '';
          $('#commerceRefundAmount').value = '';
          $('#commerceRefundReason').value = '';
          updateRefundValidity();
        }
      });
      $('#commerceRefundQuantity')?.addEventListener('input', () => {
        syncRefundAmount();
        updateRefundValidity();
      });
      $('#commerceRefundForm')?.addEventListener('input', updateRefundValidity);
      $('#commerceRecurringForm')?.addEventListener('submit', event => void submitRecurring(event));
      $('#commercePanel')?.addEventListener('click', event => {
        const refund = event.target.closest('[data-commerce-refund]');
        const record = event.target.closest('[data-commerce-record-expense]');
        if (refund) openRefund(refund.dataset.commerceRefund);
        if (record) void recordExpense(record.dataset.commerceRecordExpense, record);
      });
    }

    return {
      bind,
      load,
      startSale({ bookingId = '', clientId = '' } = {}) {
        clearSaleClaimResult();
        $('#commerceSaleCreator').open = true;
        syncSaleFocusMode();
        if (clientId && [...$('#commerceClient').options].some(option => option.value === clientId)) $('#commerceClient').value = clientId;
        renderBookings();
        if (bookingId && [...$('#commerceBooking').options].some(option => option.value === bookingId)) {
          $('#commerceBooking').value = bookingId;
          selectSaleSeller((state?.bookings || []).find(item => item.id === bookingId)?.performer_id);
        } else selectSaleSeller();
        updateSaleValidity();
        $('#commerceItem').focus({ preventScroll:true });
      },
      async setOrganization(next) {
        if (organization?.id === next?.id && organization?.current_role === next?.current_role && state) return;
        clearSaleClaimResult();
        organization = next || null;
        state = null;
        $('#commerceWorkspace').hidden = true;
        if (organization?.id) await load();
      },
      reset() {
        clearSaleClaimResult();
        organization = null;
        state = null;
        $('#commerceWorkspace').hidden = true;
        $('#commerceSaleCreator').open = false;
        $('#commerceAccountSetup').hidden = true;
        setError($('#commerceAccountError'), '');
        syncSaleFocusMode();
      }
    };
  }

  function createFinanceController(options) {
    const { db, $, escapeHtml, notify } = options;
    let organization = null;
    let lastKey = '';
    let loading = false;

    function render(data) {
      $('#moneyDashboardWorkspace').hidden = false;
      $('#moneyDashboardUnavailable').hidden = true;
      $('#moneyIncome').textContent = rubles(data.income_minor);
      $('#moneyExpenses').textContent = rubles(data.expense_minor);
      $('#moneyProfit').textContent = rubles(Number(data.income_minor || 0) - Number(data.expense_minor || 0));
      const expenses = data.expense_structure || [];
      const max = Math.max(1, ...expenses.map(item => Math.abs(Number(item.amount_minor || 0))));
      $('#moneyExpenseStructure').innerHTML = expenses.length ? expenses.map(item => `<div class="money-expense-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(rubles(item.amount_minor))}</small></span><i style="--money-share:${Math.max(2, Math.round(Math.abs(Number(item.amount_minor || 0)) / max * 100))}%"></i></div>`).join('') : '<p class="report-empty-inline">Расходов за период нет.</p>';
      const operations = data.recent_operations || [];
      $('#moneyRecentOperations').innerHTML = operations.length ? operations.map(item => `<article class="money-operation-row"><div><small>${escapeHtml(dateText(item.occurred_at))}</small><strong>${escapeHtml(operationNames[item.operation_type] || 'Операция')}</strong></div><span>${escapeHtml(rubles(item.amount_minor))}</span></article>`).join('') : '<p class="report-empty-inline">Операций за период нет.</p>';
    }

    async function load(range, { force = false } = {}) {
      if (!organization?.id || !range?.start || !range?.end || loading) return;
      const key = `${organization.id}:${range.start}:${range.end}`;
      if (!force && key === lastKey) return;
      loading = true;
      $('#moneyDashboardLoading').hidden = false;
      $('#moneyDashboardUnavailable').hidden = true;
      try {
        const result = await db.rpc('get_minuta_money_dashboard_v147', { p_organization:organization.id, p_start:range.start, p_end:range.end });
        if (result.error) throw result.error;
        if (organization?.id !== result.data?.organization_id) return;
        lastKey = key;
        render(result.data);
      } catch (error) {
        $('#moneyDashboardWorkspace').hidden = true;
        $('#moneyDashboardUnavailable').hidden = false;
      } finally {
        loading = false;
        $('#moneyDashboardLoading').hidden = true;
      }
    }

    $('#reloadMoneyDashboard')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('minuta:reload-money-dashboard'));
      notify('Финансовый результат обновляется');
    });

    return {
      load,
      setOrganization(next) { organization = next || null; lastKey = ''; $('#moneyDashboardWorkspace').hidden = true; },
      reset() { organization = null; lastKey = ''; $('#moneyDashboardWorkspace').hidden = true; }
    };
  }

  window.MinutaCommerce = Object.freeze({ createController, createFinanceController });
})();
