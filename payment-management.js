(function initMinutaPayments(global) {
  'use strict';

  const SANDBOX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SANDBOX_HASH = /^[0-9a-f]{64}$/;
  const SANDBOX_IDEMPOTENCY = /^[\x21-\x7e]{8,200}$/;
  const SANDBOX_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  const SANDBOX_MAX_AMOUNT_MINOR = 100000000;

  function sandboxFailure(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function sandboxExactKeys(value, allowed, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))) sandboxFailure(code);
  }

  function sandboxUuid(value, code) {
    if (typeof value !== 'string' || !SANDBOX_UUID.test(value)) sandboxFailure(code);
    return value.toLowerCase();
  }

  function sandboxInstant(value) {
    if (typeof value !== 'string' || !SANDBOX_INSTANT.test(value)
      || !Number.isFinite(Date.parse(value))) sandboxFailure('sandbox_invalid_instant');
    const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
    if (new Date(value).toISOString() !== normalized) sandboxFailure('sandbox_invalid_instant');
    return new Date(value).toISOString();
  }

  function sandboxAmount(value, code = 'sandbox_invalid_amount') {
    if (!Number.isSafeInteger(value) || value < 1 || value > SANDBOX_MAX_AMOUNT_MINOR) sandboxFailure(code);
    return value;
  }

  function freezeSandboxState(value) {
    value.journal.forEach(Object.freeze);
    Object.freeze(value.journal);
    return Object.freeze(value);
  }

  function validateSandboxState(state) {
    sandboxExactKeys(state, [
      'schema', 'ledgerId', 'organizationId', 'bookingId', 'purpose', 'currency', 'amountMinor',
      'authorizedMinor', 'capturedMinor', 'refundedMinor', 'status', 'version', 'journal'
    ], 'sandbox_invalid_state');
    sandboxUuid(state.ledgerId, 'sandbox_invalid_ledger');
    sandboxUuid(state.organizationId, 'sandbox_invalid_organization');
    sandboxUuid(state.bookingId, 'sandbox_invalid_booking');
    sandboxAmount(state.amountMinor);
    if (state.schema !== 'minuta.payment-sandbox.v1' || !['booking_prepayment', 'tip'].includes(state.purpose)
      || state.currency !== 'RUB' || !Number.isSafeInteger(state.version) || state.version < 1 || state.version > 10000
      || !Array.isArray(state.journal) || state.journal.length !== state.version) sandboxFailure('sandbox_invalid_state');
    for (const amount of [state.authorizedMinor, state.capturedMinor, state.refundedMinor]) {
      if (!Number.isSafeInteger(amount) || amount < 0) sandboxFailure('sandbox_invalid_state');
    }
    if (state.authorizedMinor > state.amountMinor || state.capturedMinor > state.authorizedMinor
      || state.refundedMinor > state.capturedMinor) sandboxFailure('sandbox_invalid_state');
    const validStatusAmounts =
      (state.status === 'created' && state.authorizedMinor === 0 && state.capturedMinor === 0 && state.refundedMinor === 0)
      || (state.status === 'authorized' && state.authorizedMinor === state.amountMinor && state.capturedMinor === 0 && state.refundedMinor === 0)
      || (state.status === 'captured' && state.authorizedMinor === state.amountMinor && state.capturedMinor === state.amountMinor && state.refundedMinor === 0)
      || (state.status === 'partially_refunded' && state.capturedMinor === state.amountMinor && state.refundedMinor > 0 && state.refundedMinor < state.capturedMinor)
      || (state.status === 'refunded' && state.capturedMinor === state.amountMinor && state.refundedMinor === state.capturedMinor)
      || (state.status === 'cancelled' && [0, state.amountMinor].includes(state.authorizedMinor) && state.capturedMinor === 0 && state.refundedMinor === 0);
    if (!validStatusAmounts) sandboxFailure('sandbox_invalid_state');
    const keys = new Set();
    let expectedStatus = 'created';
    let expectedAuthorizedMinor = 0;
    let expectedCapturedMinor = 0;
    let expectedRefundedMinor = 0;
    let previousOccurredAt = null;
    state.journal.forEach((entry, index) => {
      sandboxExactKeys(entry, [
        'sequence', 'action', 'idempotencyKey', 'payloadSha256', 'commandFingerprint',
        'occurredAt', 'resultingStatus', 'resultingVersion', 'amountMinor'
      ], 'sandbox_invalid_journal');
      const entryAmountMinor = entry.amountMinor;
      if (entry.sequence !== index + 1 || entry.resultingVersion !== index + 1
        || !['create', 'authorize', 'capture', 'refund', 'cancel'].includes(entry.action)
        || (index === 0) !== (entry.action === 'create')
        || !SANDBOX_IDEMPOTENCY.test(entry.idempotencyKey) || !SANDBOX_HASH.test(entry.payloadSha256)
        || !Number.isSafeInteger(entryAmountMinor) || entryAmountMinor < 0 || entryAmountMinor > SANDBOX_MAX_AMOUNT_MINOR
        || keys.has(entry.idempotencyKey)) sandboxFailure('sandbox_invalid_journal');
      const occurredAt = Date.parse(sandboxInstant(entry.occurredAt));
      if (previousOccurredAt !== null && occurredAt < previousOccurredAt) sandboxFailure('sandbox_invalid_journal');
      previousOccurredAt = occurredAt;
      if (index === 0) {
        if (entryAmountMinor !== state.amountMinor
          || entry.commandFingerprint !== `create:${state.purpose}:RUB:${state.amountMinor}`) {
          sandboxFailure('sandbox_invalid_journal');
        }
      } else {
        const expectedFingerprint = `${entry.action}:${entryAmountMinor}:${index}`;
        if (entry.commandFingerprint !== expectedFingerprint
          || (entry.action === 'refund') !== (entryAmountMinor > 0)) sandboxFailure('sandbox_invalid_journal');
        if (entry.action === 'authorize') {
          if (expectedStatus !== 'created') sandboxFailure('sandbox_invalid_journal');
          expectedStatus = 'authorized'; expectedAuthorizedMinor = state.amountMinor;
        } else if (entry.action === 'capture') {
          if (expectedStatus !== 'authorized' || expectedAuthorizedMinor !== state.amountMinor) sandboxFailure('sandbox_invalid_journal');
          expectedStatus = 'captured'; expectedCapturedMinor = expectedAuthorizedMinor;
        } else if (entry.action === 'refund') {
          if (!['captured', 'partially_refunded'].includes(expectedStatus)
            || entryAmountMinor > expectedCapturedMinor - expectedRefundedMinor) sandboxFailure('sandbox_invalid_journal');
          expectedRefundedMinor += entryAmountMinor;
          expectedStatus = expectedRefundedMinor === expectedCapturedMinor ? 'refunded' : 'partially_refunded';
        } else {
          if (!['created', 'authorized'].includes(expectedStatus)) sandboxFailure('sandbox_invalid_journal');
          expectedStatus = 'cancelled';
        }
      }
      if (entry.resultingStatus !== expectedStatus) sandboxFailure('sandbox_invalid_journal');
      keys.add(entry.idempotencyKey);
    });
    if (state.status !== expectedStatus || state.authorizedMinor !== expectedAuthorizedMinor
      || state.capturedMinor !== expectedCapturedMinor || state.refundedMinor !== expectedRefundedMinor) {
      sandboxFailure('sandbox_invalid_journal');
    }
  }

  function createSandboxPaymentState(input) {
    sandboxExactKeys(input, [
      'ledgerId', 'organizationId', 'bookingId', 'purpose', 'currency', 'amountMinor',
      'idempotencyKey', 'payloadSha256', 'occurredAt'
    ], 'sandbox_invalid_create');
    const ledgerId = sandboxUuid(input.ledgerId, 'sandbox_invalid_ledger');
    const organizationId = sandboxUuid(input.organizationId, 'sandbox_invalid_organization');
    const bookingId = sandboxUuid(input.bookingId, 'sandbox_invalid_booking');
    const amountMinor = sandboxAmount(input.amountMinor);
    if (!['booking_prepayment', 'tip'].includes(input.purpose) || input.currency !== 'RUB'
      || !SANDBOX_IDEMPOTENCY.test(input.idempotencyKey) || !SANDBOX_HASH.test(input.payloadSha256)) {
      sandboxFailure('sandbox_invalid_create');
    }
    const occurredAt = sandboxInstant(input.occurredAt);
    return freezeSandboxState({
      schema: 'minuta.payment-sandbox.v1', ledgerId, organizationId, bookingId,
      purpose: input.purpose, currency: 'RUB', amountMinor,
      authorizedMinor: 0, capturedMinor: 0, refundedMinor: 0,
      status: 'created', version: 1,
      journal: [Object.freeze({
        sequence: 1, action: 'create', idempotencyKey: input.idempotencyKey,
        payloadSha256: input.payloadSha256,
        commandFingerprint: `create:${input.purpose}:RUB:${amountMinor}`,
        occurredAt, resultingStatus: 'created', resultingVersion: 1,
        amountMinor
      })]
    });
  }

  function applySandboxPaymentCommand(state, command) {
    validateSandboxState(state);
    sandboxExactKeys(command, [
      'action', 'amountMinor', 'idempotencyKey', 'payloadSha256', 'expectedVersion', 'occurredAt'
    ], 'sandbox_invalid_command');
    if (!['authorize', 'capture', 'refund', 'cancel'].includes(command.action)
      || !SANDBOX_IDEMPOTENCY.test(command.idempotencyKey) || !SANDBOX_HASH.test(command.payloadSha256)
      || !Number.isSafeInteger(command.expectedVersion)) sandboxFailure('sandbox_invalid_command');
    const amountMinor = command.action === 'refund'
      ? sandboxAmount(command.amountMinor, 'sandbox_invalid_refund_amount') : 0;
    if (command.action !== 'refund' && command.amountMinor !== undefined) sandboxFailure('sandbox_invalid_command');
    const fingerprint = `${command.action}:${amountMinor}:${command.expectedVersion}`;
    const existing = state.journal.find(entry => entry.idempotencyKey === command.idempotencyKey);
    if (existing) {
      if (existing.payloadSha256 !== command.payloadSha256 || existing.commandFingerprint !== fingerprint) {
        sandboxFailure('sandbox_idempotency_conflict');
      }
      return Object.freeze({ state, replayed: true });
    }
    if (command.expectedVersion !== state.version) sandboxFailure('sandbox_stale_version');
    let status = state.status;
    let authorizedMinor = state.authorizedMinor;
    let capturedMinor = state.capturedMinor;
    let refundedMinor = state.refundedMinor;
    if (command.action === 'authorize') {
      if (status !== 'created') sandboxFailure('sandbox_invalid_transition');
      status = 'authorized'; authorizedMinor = state.amountMinor;
    } else if (command.action === 'capture') {
      if (status !== 'authorized' || authorizedMinor !== state.amountMinor) sandboxFailure('sandbox_invalid_transition');
      status = 'captured'; capturedMinor = authorizedMinor;
    } else if (command.action === 'refund') {
      if (!['captured', 'partially_refunded'].includes(status)
        || command.amountMinor > capturedMinor - refundedMinor) sandboxFailure('sandbox_invalid_transition');
      refundedMinor += command.amountMinor;
      status = refundedMinor === capturedMinor ? 'refunded' : 'partially_refunded';
    } else {
      if (!['created', 'authorized'].includes(status)) sandboxFailure('sandbox_invalid_transition');
      status = 'cancelled';
    }
    const occurredAt = sandboxInstant(command.occurredAt);
    const nextVersion = state.version + 1;
    const next = freezeSandboxState({
      ...state, status, authorizedMinor, capturedMinor, refundedMinor, version: nextVersion,
      journal: [...state.journal, Object.freeze({
        sequence: nextVersion, action: command.action, idempotencyKey: command.idempotencyKey,
        payloadSha256: command.payloadSha256, commandFingerprint: fingerprint,
        occurredAt, resultingStatus: status, resultingVersion: nextVersion,
        amountMinor
      })]
    });
    validateSandboxState(next);
    return Object.freeze({ state: next, replayed: false });
  }

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    const refreshNavigation = typeof options.refreshNavigation === 'function' ? options.refreshNavigation : () => {};
    const getSandboxBookings = typeof options.getSandboxBookings === 'function' ? options.getSandboxBookings : () => [];
    let organization = null;
    let payload = null;
    let available = null;
    let busy = false;
    let refundSelectionInitialized = false;
    let contextRevision = 0;
    let loadRevision = 0;
    let operationRevision = 0;
    let refundIntent = null;
    let refundVerifiedStatus = '';
    let refundStorageFailed = false;
    let sandboxState = null;
    let sandboxReference = null;
    let sandboxAvailable = true;
    let sandboxStorageFailed = false;

    function intentKey() { return `minuta_refund_intent_v1:${organization.id}`; }
    function restoreRefundIntent() {
      refundIntent = null; refundVerifiedStatus = ''; refundStorageFailed = false;
      if (!organization) return;
      try {
        const raw = global.localStorage.getItem(intentKey());
        if (!raw) return;
        const value = JSON.parse(raw);
        if (value.organization_id !== organization.id || !value.request_id || !value.attempt_id
          || !Number.isSafeInteger(value.amount_minor) || value.amount_minor < 100
          || !/^[a-f0-9]{64}$/.test(value.reason_hash)) throw new Error('invalid_refund_intent');
        refundIntent = value;
      } catch { refundStorageFailed = true; }
    }
    function persistRefundIntent(value) {
      const existing = global.localStorage.getItem(intentKey());
      if (existing && JSON.parse(existing).request_id !== value.request_id) throw new Error('another_refund_intent');
      const encoded = JSON.stringify(value);
      global.localStorage.setItem(intentKey(), encoded);
      if (global.localStorage.getItem(intentKey()) !== encoded) throw new Error('refund_intent_not_saved');
      refundIntent = value;
    }
    async function reasonHash(reason) {
      const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(reason));
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function terminalRefund() { return ['succeeded', 'canceled', 'failed'].includes(refundVerifiedStatus); }
    function renderRefundRecovery() {
      const form = $('#paymentRefundForm');
      if (!form) return;
      if (document.createElement && !document.getElementById('paymentRefundRecovery')) {
        const recovery = document.createElement('div');
        recovery.id = 'paymentRefundRecovery';
        recovery.innerHTML = '<p id="paymentRefundRecoveryStatus" role="status"></p><button id="paymentRefundNew" class="secondary-button" type="button">Новый возврат</button>';
        $('#paymentProviderWorkspace').prepend(recovery);
      }
      const active = Boolean(refundIntent || refundStorageFailed);
      if ($('#paymentRefundRecovery')) $('#paymentRefundRecovery').hidden = !active;
      // An unresolved operation is the current task; ordinary refunds remain below history.
      if(active)$('#paymentRefundRecovery')?.after?.(form);
      else $('#paymentProviderWorkspace')?.append?.(form);
      if ($('#paymentRefundRecoveryStatus')) $('#paymentRefundRecoveryStatus').textContent = refundStorageFailed
        ? 'Не удалось прочитать сохранённый возврат. Проверьте хранилище браузера перед новой операцией.'
        : terminalRefund() ? `Предыдущий возврат: ${refundStatusLabel(refundVerifiedStatus)}. Для отдельной операции нажмите «Новый возврат».`
          : 'Есть незавершённая проверка возврата. Сначала проверьте его статус. Для безопасного повтора понадобится прежняя причина.';
      if ($('#paymentRefundNew')) { $('#paymentRefundNew').hidden = !terminalRefund(); $('#paymentRefundNew').disabled = busy; }
      const submitButton = form.querySelector?.('button[type="submit"]');
      if (submitButton) { submitButton.textContent = active ? 'Проверить возврат' : 'Вернуть через ЮKassa'; submitButton.disabled = busy || refundStorageFailed; }
      if (refundIntent) {
        $('#paymentRefundAmount').value = minorInputValue(refundIntent.amount_minor);
        $('#paymentRefundAmount').max = '';
        $('#paymentRefundAmount').readOnly = true;
        $('#paymentRefundAttempt').disabled = true;
        $('#paymentRefundReason').required = false;
        form.hidden = false;
      } else {
        $('#paymentRefundAmount').readOnly = false;
        $('#paymentRefundReason').required = true;
      }
    }
    async function reconcileRefundIntent(intent, isCurrent) {
      let query = db.from('payment_provider_refunds')
        .select('id,organization_id,request_id,attempt_id,amount_minor,status')
        .eq('organization_id', intent.organization_id);
      query = intent.refund_id ? query.eq('id', intent.refund_id) : query.eq('request_id', intent.request_id);
      const result = await query.maybeSingle();
      if (!isCurrent()) return 'stale';
      if (result.error) throw new Error('refund_check_unavailable');
      const row = result.data;
      if (!row) {
        // The legacy server may reuse another in-flight refund's canonical ID.
        // If that reply was lost, absence of our ID alone cannot authorize replay.
        const possibleAlias = await db.from('payment_provider_refunds').select('id')
          .eq('organization_id', intent.organization_id).eq('attempt_id', intent.attempt_id)
          .eq('amount_minor', intent.amount_minor).in('status', ['creating','pending','succeeded']).limit(1).maybeSingle();
        if (!isCurrent()) return 'stale';
        if (possibleAlias.error || possibleAlias.data) throw new Error('refund_identity_unresolved');
        refundVerifiedStatus = ''; return 'missing';
      }
      if (row.organization_id !== intent.organization_id || row.attempt_id !== intent.attempt_id
        || Number(row.amount_minor) !== intent.amount_minor
        || (!intent.refund_id && row.request_id !== intent.request_id)
        || (intent.refund_id && row.id !== intent.refund_id)
        || !['creating', 'pending', 'succeeded', 'canceled', 'failed'].includes(row.status)) throw new Error('refund_check_mismatch');
      refundVerifiedStatus = row.status;
      renderRefundRecovery();
      return row.status;
    }
    function newRefund() {
      if (!organization || busy || !manager() || !terminalRefund()) return;
      try {
        if (JSON.parse(global.localStorage.getItem(intentKey()) || 'null')?.request_id !== refundIntent?.request_id) throw new Error('another_refund_intent');
        global.localStorage.removeItem(intentKey());
        if (global.localStorage.getItem(intentKey()) !== null) throw new Error('refund_clear_failed');
      } catch { notify('Не удалось завершить предыдущую проверку. Новый возврат пока недоступен.'); return; }
      refundIntent = null; refundVerifiedStatus = '';
      $('#paymentRefundForm').reset();
      refundSelectionInitialized = false;
      render();
    }

    // UI lifetime only: these tokens do not cancel or deduplicate server refunds.
    function currentContext() {
      const revision = contextRevision;
      const organizationId = organization?.id;
      const role = currentRole();
      return () => revision === contextRevision && organization?.id === organizationId && currentRole() === role;
    }
    function invalidateContext() {
      contextRevision += 1;
      loadRevision += 1;
      setBusy(false);
    }
    function beginOperation() {
      const contextIsCurrent = currentContext();
      const revision = ++operationRevision;
      setBusy(true);
      return () => contextIsCurrent() && revision === operationRevision;
    }

    function isMissing(error) {
      return /PGRST202|42883|get_minuta_payment_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function currentRole() { return String(payload?.current_role || organization?.current_role || ''); }
    function manager() { return ['owner', 'admin'].includes(currentRole()); }
    function owner() { return currentRole() === 'owner'; }
    function scopeMatches(data, organizationId) {
      return Boolean(data && typeof data === 'object' && String(data.organization_id || '') === String(organizationId || ''));
    }
    function moneyMinor(value) { return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(value || 0) / 100)} ₽`; }
    function parseRefundAmount(value) {
      const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(String(value ?? '').trim());
      if (!match) return null;
      // Convert decimal integer digits, never a floating-point RUB amount.
      const amount = Number(`${match[1]}${(match[2] || '').padEnd(2, '0')}`);
      return Number.isSafeInteger(amount) ? amount : null;
    }
    function minorInteger(value) {
      if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
      const amount = Number(value);
      return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
    }
    function refundRemaining() {
      const attempts = Array.isArray(payload?.recent_attempts) ? payload.recent_attempts : [];
      const attempt = attempts.find((item) => item.id === $('#paymentRefundAttempt').value);
      return attemptRemaining(attempt);
    }
    function attemptRemaining(attempt) {
      if (!attempt || attempt.status !== 'succeeded') return null;
      const captured = minorInteger(attempt.captured_amount_minor);
      const refunded = minorInteger(attempt.refunded_amount_minor);
      if (captured === null || refunded === null || refunded > captured) return null;
      const pending = (Array.isArray(payload?.recent_refunds) ? payload.recent_refunds : [])
        .filter(item => item.attempt_id === attempt.id && ['creating', 'pending'].includes(item.status))
        .reduce((sum, item) => {
          const amount = minorInteger(item.amount_minor);
          return amount === null ? sum : sum + amount;
        }, 0);
      return Math.max(0, captured - refunded - pending);
    }
    function minorInputValue(amount) {
      const digits = String(amount).padStart(3, '0');
      return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
    }
    function requestId() {
      if (!global.crypto?.randomUUID) throw new Error('secure_request_id_unavailable');
      return global.crypto.randomUUID();
    }
    function sandboxStorageKey() { return `minuta_payment_sandbox_v144:${organization?.id || ''}`; }
    function sandboxMissing(error) {
      return /PGRST202|42883|apply_minuta_payment_sandbox_v144|get_minuta_payment_sandbox_journal_v144|function .* does not exist/i
        .test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function validSandboxResult(value, reference) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.sandbox !== true
        || value.ok === false || !SANDBOX_UUID.test(String(value.ledgerId || ''))
        || !SANDBOX_UUID.test(String(value.bookingId || ''))
        || String(value.ledgerId) !== String(reference?.ledgerId || '')
        || String(value.bookingId) !== String(reference?.bookingId || '')
        || !['created','authorized','captured','partially_refunded','refunded','cancelled'].includes(value.status)
        || !['booking_prepayment','tip'].includes(value.purpose) || value.currency !== 'RUB'
        || !Number.isSafeInteger(Number(value.version)) || Number(value.version) < 1) return false;
      const amounts = ['amountMinor','authorizedMinor','capturedMinor','refundedMinor'].map(key => Number(value[key]));
      return amounts.every(amount => Number.isSafeInteger(amount) && amount >= 0)
        && amounts[1] <= amounts[0] && amounts[2] <= amounts[1] && amounts[3] <= amounts[2]
        && (!Object.hasOwn(value, 'journal') || Array.isArray(value.journal));
    }
    function persistSandboxReference(next) {
      if (!organization?.id) return false;
      try {
        const encoded = JSON.stringify({ organizationId:organization.id, ...next });
        global.localStorage.setItem(sandboxStorageKey(), encoded);
        if (global.localStorage.getItem(sandboxStorageKey()) !== encoded) throw new Error('sandbox_reference_not_saved');
        sandboxReference = { organizationId:organization.id, ...next };
        sandboxStorageFailed = false;
        return true;
      } catch {
        sandboxStorageFailed = true;
        return false;
      }
    }
    function restoreSandboxReference() {
      sandboxState = null;
      sandboxReference = null;
      sandboxAvailable = true;
      sandboxStorageFailed = false;
      if (!organization?.id) return;
      try {
        const parsed = JSON.parse(global.localStorage.getItem(sandboxStorageKey()) || 'null');
        if (!parsed) return;
        if (parsed.organizationId !== organization.id || !SANDBOX_UUID.test(String(parsed.ledgerId || ''))
          || !SANDBOX_UUID.test(String(parsed.bookingId || ''))) throw new Error('invalid_sandbox_reference');
        if (parsed.pending && (typeof parsed.pending !== 'object'
          || !['create','authorize','capture','refund','cancel'].includes(parsed.pending.action)
          || !SANDBOX_IDEMPOTENCY.test(String(parsed.pending.idempotencyKey || ''))
          || !Number.isSafeInteger(parsed.pending.expectedVersion) || parsed.pending.expectedVersion < 0
          || (parsed.pending.amountMinor !== null && (!Number.isSafeInteger(parsed.pending.amountMinor) || parsed.pending.amountMinor < 1)))) {
          throw new Error('invalid_sandbox_pending');
        }
        sandboxReference = parsed;
      } catch {
        sandboxStorageFailed = true;
      }
    }
    function clearSandboxReference() {
      try {
        global.localStorage.removeItem(sandboxStorageKey());
        if (global.localStorage.getItem(sandboxStorageKey()) !== null) throw new Error('sandbox_reference_not_cleared');
        sandboxReference = null;
        sandboxState = null;
        sandboxStorageFailed = false;
        sandboxAvailable = true;
      } catch {
        sandboxStorageFailed = true;
      }
    }
    function sandboxBookings() {
      try {
        return getSandboxBookings().filter(item => item && SANDBOX_UUID.test(String(item.id || '')));
      } catch { return []; }
    }
    function sandboxStatusLabel(value) {
      return ({ created:'Создан', authorized:'Авторизован', captured:'Списание подтверждено',
        partially_refunded:'Частично возвращён', refunded:'Полностью возвращён', cancelled:'Отменён' })[value] || 'Не запускался';
    }
    function renderSandbox() {
      const disclosure = $('#paymentSandboxDisclosure');
      if (!disclosure) return;
      disclosure.hidden = !organization || !manager() || available !== true;
      if (disclosure.hidden) return;
      const unavailable = $('#paymentSandboxUnavailable');
      const workspace = $('#paymentSandboxWorkspace');
      const usable = sandboxAvailable === true && !sandboxStorageFailed;
      if (unavailable) unavailable.hidden = usable;
      if (workspace) workspace.hidden = !usable;
      if (!usable) {
        const reload = disclosure.querySelector('[data-payment-sandbox-action="reload"]');
        if (reload) { reload.hidden = false; reload.disabled = busy; }
        if ($('#paymentSandboxUnavailableText')) $('#paymentSandboxUnavailableText').textContent = sandboxStorageFailed
          ? 'Не удалось сохранить защиту от повторного запуска. Освободите хранилище браузера и повторите.'
          : sandboxAvailable === false ? 'Контур появится после безопасного обновления базы.'
            : 'Не удалось проверить журнал. Рабочие платежи и записи продолжают работать.';
        return;
      }
      const bookings = sandboxBookings();
      const select = $('#paymentSandboxBooking');
      const chosen = select?.value || '';
      if (select) {
        select.innerHTML = bookings.map(item => `<option value="${escapeHtml(item.id)}" data-amount="${escapeHtml(String(item.totalPriceRub || 0))}">${escapeHtml(item.clientName || 'Клиент')} · ${escapeHtml(item.date || '')} ${escapeHtml(item.time || '')}</option>`).join('');
        select.value = bookings.some(item => item.id === chosen) ? chosen : bookings[0]?.id || '';
      }
      const setup = $('#paymentSandboxForm');
      const result = $('#paymentSandboxResult');
      if (setup) setup.hidden = Boolean(sandboxState);
      if (result) result.hidden = !sandboxState;
      if (!sandboxState) {
        $('#paymentSandboxState').textContent = sandboxReference?.pending ? 'Проверяем запуск' : 'Не запускался';
        const amount = $('#paymentSandboxAmount');
        const booking = bookings.find(item => item.id === select?.value);
        if (amount && !amount.value) amount.value = String(Math.max(1, booking?.totalPriceRub || 1));
        if (setup?.querySelector('button[type="submit"]')) setup.querySelector('button[type="submit"]').disabled = !bookings.length || busy;
        if ($('#paymentSandboxHelp')) $('#paymentSandboxHelp').textContent = bookings.length
          ? 'Клиент не получит уведомление, ссылка на оплату не создаётся.'
          : 'Сначала создайте хотя бы одну запись в расписании.';
        return;
      }
      const remaining = Number(sandboxState.capturedMinor) - Number(sandboxState.refundedMinor);
      $('#paymentSandboxState').textContent = sandboxStatusLabel(sandboxState.status);
      $('#paymentSandboxSummary').textContent = `${sandboxStatusLabel(sandboxState.status)} · ${moneyMinor(sandboxState.amountMinor)}`;
      $('#paymentSandboxVersion').textContent = `Шаг ${sandboxState.version}`;
      $('#paymentSandboxNote').textContent = sandboxReference?.pending
        ? 'Результат предыдущего нажатия ещё не подтверждён. Повтор использует тот же безопасный идентификатор.'
        : sandboxState.status === 'captured' || sandboxState.status === 'partially_refunded'
          ? `Можно проверить возврат до ${moneyMinor(remaining)}.`
          : ['refunded','cancelled'].includes(sandboxState.status)
            ? 'Сценарий завершён. Ни банк, ни ЮKassa не вызывались.'
            : 'Продолжите тест следующим шагом или отмените его.';
      const actions = disclosure.querySelectorAll('[data-payment-sandbox-action]');
      actions.forEach(button => { button.hidden = true; button.disabled = busy; });
      const show = action => { const button = disclosure.querySelector(`[data-payment-sandbox-action="${action}"]`); if (button) button.hidden = false; };
      if (sandboxReference?.pending) show(sandboxReference.pending.action);
      else if (sandboxState.status === 'created') { show('authorize'); show('cancel'); }
      else if (sandboxState.status === 'authorized') { show('capture'); show('cancel'); }
      else if (['captured','partially_refunded'].includes(sandboxState.status)) show('refund');
      else show('new');
      const refund = $('#paymentSandboxRefund');
      if (refund) refund.hidden = !['captured','partially_refunded'].includes(sandboxState.status);
      if (!refund?.hidden && $('#paymentSandboxRefundAmount')) {
        $('#paymentSandboxRefundAmount').max = minorInputValue(remaining);
        if (!$('#paymentSandboxRefundAmount').value) $('#paymentSandboxRefundAmount').value = minorInputValue(remaining);
      }
    }
    async function loadSandbox() {
      if (!organization?.id || !manager()) return;
      if (sandboxStorageFailed) { renderSandbox(); return; }
      if (!sandboxReference) { sandboxAvailable = true; renderSandbox(); return; }
      const organizationId = organization.id;
      const contextIsCurrent = currentContext();
      try {
        const response = await db.rpc('get_minuta_payment_sandbox_journal_v144', {
          p_organization:organizationId,
          p_ledger:sandboxReference.ledgerId
        });
        if (!contextIsCurrent()) return;
        if (response.error) {
          if (/sandbox_payment_not_found/i.test(response.error.message || '') && sandboxReference.pending?.action === 'create') {
            sandboxState = null;
            sandboxAvailable = true;
          } else {
            sandboxState = null;
            sandboxAvailable = sandboxMissing(response.error) ? false : null;
          }
          renderSandbox();
          return;
        }
        if (!validSandboxResult(response.data, sandboxReference)) {
          sandboxState = null;
          sandboxAvailable = null;
          renderSandbox();
          return;
        }
        sandboxState = response.data;
        sandboxAvailable = true;
        const pending = sandboxReference.pending;
        if (pending && Number(sandboxState.version) > pending.expectedVersion) {
          persistSandboxReference({ ledgerId:sandboxReference.ledgerId, bookingId:sandboxReference.bookingId, pending:null });
        }
        renderSandbox();
      } catch {
        if (!contextIsCurrent()) return;
        sandboxState = null;
        sandboxAvailable = null;
        renderSandbox();
      }
    }
    async function runSandboxCommand(action) {
      if (action === 'reload') { await loadSandbox(); return; }
      if (action === 'new') { clearSandboxReference(); renderSandbox(); return; }
      if (!organization?.id || !manager() || busy || !requireWrites()) return;
      const organizationId = organization.id;
      let reference = sandboxReference;
      let pending = reference?.pending || null;
      if (pending && pending.action !== action) {
        notify('Сначала подтвердите предыдущий шаг тестового платежа');
        return;
      }
      if (!pending) {
        const bookingId = action === 'create' ? $('#paymentSandboxBooking')?.value : sandboxState?.bookingId;
        if (!SANDBOX_UUID.test(String(bookingId || ''))) { notify('Выберите запись для теста'); return; }
        const expectedVersion = action === 'create' ? 0 : Number(sandboxState?.version);
        const amountMinor = action === 'create' ? parseRefundAmount($('#paymentSandboxAmount')?.value)
          : action === 'refund' ? parseRefundAmount($('#paymentSandboxRefundAmount')?.value) : null;
        if ((action === 'create' || action === 'refund') && (amountMinor === null || amountMinor < 100)) {
          notify('Укажите сумму не меньше 1 ₽ без округления');
          return;
        }
        const ledgerId = action === 'create' ? requestId() : sandboxState?.ledgerId;
        pending = { action, idempotencyKey:`sandbox:${action}:${requestId()}`, expectedVersion, amountMinor,
          purpose:action === 'create' ? 'booking_prepayment' : null };
        reference = { ledgerId, bookingId, pending };
        if (!persistSandboxReference(reference)) { renderSandbox(); return; }
      }
      const contextIsCurrent = currentContext();
      setBusy(true);
      renderSandbox();
      try {
        const response = await db.rpc('apply_minuta_payment_sandbox_v144', {
          p_organization:organizationId,
          p_ledger:reference.ledgerId,
          p_booking:reference.bookingId,
          p_idempotency_key:pending.idempotencyKey,
          p_expected_version:pending.expectedVersion,
          p_command:pending.action,
          p_amount_minor:pending.amountMinor,
          p_purpose:pending.purpose
        });
        if (!contextIsCurrent()) return;
        setBusy(false);
        if (response.error || !validSandboxResult(response.data, reference)) {
          sandboxAvailable = response.error && sandboxMissing(response.error) ? false : null;
          await loadSandbox();
          if (contextIsCurrent()) notify(sandboxState && Number(sandboxState.version) > pending.expectedVersion
            ? 'Шаг тестового платежа подтверждён' : 'Результат не подтверждён. Повторите тот же шаг после проверки связи.');
          return;
        }
        sandboxState = response.data;
        sandboxAvailable = true;
        persistSandboxReference({ ledgerId:reference.ledgerId, bookingId:reference.bookingId, pending:null });
        renderSandbox();
        notify(`${sandboxStatusLabel(sandboxState.status)} · тестовый контур`);
      } catch {
        if (!contextIsCurrent()) return;
        setBusy(false);
        await loadSandbox();
        if (contextIsCurrent()) notify(sandboxState && Number(sandboxState.version) > pending.expectedVersion
          ? 'Шаг тестового платежа подтверждён' : 'Результат не подтверждён. Повторите тот же шаг после проверки связи.');
      }
    }
    function setBusy(value) {
      busy = value;
      $('#paymentProviderPanel')?.querySelectorAll('button,input,select').forEach((item) => { item.disabled = value; });
      renderRefundRecovery();
    }
    function reset() {
      organization = null; payload = null; available = null; busy = false;
      refundIntent = null; refundVerifiedStatus = ''; refundStorageFailed = false;
      sandboxState = null; sandboxReference = null; sandboxAvailable = true; sandboxStorageFailed = false;
      invalidateContext();
      refundSelectionInitialized = false;
      if ($('#paymentProviderPanel')) $('#paymentProviderPanel').hidden = true;
      refreshNavigation();
    }
    async function load() {
      if (!organization) return { ok:false, optional:true };
      if (!manager()) { available = false; render(); return { ok:false, optional:true, denied:true }; }
      const organizationId = organization.id;
      const contextIsCurrent = currentContext();
      const revision = ++loadRevision;
      const isCurrent = () => contextIsCurrent() && revision === loadRevision;
      try {
        const result = await db.rpc('get_minuta_payment_workspace', { p_organization:organization.id });
        if (!isCurrent()) return { ok:false, optional:true, stale:true };
        if (result.error) {
          const denied = /42501|payment_access_denied/i.test(`${result.error.code || ''} ${result.error.message || ''}`);
          if (denied) invalidateContext();
          available = isMissing(result.error) || denied ? false : null;
          render(result.error);
          return { ok:false, optional:true, unavailable:true };
        }
        if (!scopeMatches(result.data, organizationId)) {
          payload = null;
          available = null;
          render({ code:'payment_workspace_scope_mismatch' });
          return { ok:false, optional:true, scopeMismatch:true };
        }
        if (String(result.data?.current_role || organization.current_role || '') !== currentRole()) invalidateContext();
        available = true;
        payload = result.data || {};
        render();
        await loadSandbox();
        return { ok:true, optional:true };
      } catch (error) {
        if (!isCurrent()) return { ok:false, optional:true, stale:true };
        available = null;
        render(error);
        return { ok:false, optional:true, unavailable:true };
      }
    }
    async function setOrganization(next) {
      const changed = (next?.id || null) !== (organization?.id || null)
        || String(next?.current_role || '') !== currentRole();
      if (changed) invalidateContext();
      organization = next?.id ? next : null;
      if (changed) { restoreRefundIntent(); restoreSandboxReference(); }
      payload = null;
      available = null;
      if (!organization) { reset(); return; }
      if (!manager()) { available = false; render(); return; }
      if (changed) render();
      await load();
    }
    function statusLabel(value) {
      return ({ creating:'создаётся', pending:'ожидает оплаты', succeeded:'оплачено', canceled:'отменено', failed:'ошибка', partially_refunded:'частично возвращено', refunded:'возвращено', matched:'сверено', mismatch:'расхождение' })[value] || value || '—';
    }
    function refundStatusLabel(value) {
      return ({ creating:'создаётся', pending:'в обработке', succeeded:'выполнено', canceled:'отменено', failed:'ошибка' })[value] || value || '—';
    }
    function render(error = null) {
      const panel = $('#paymentProviderPanel');
      if (!panel) return;
      const guide=panel.querySelector?.('.payment-technical-details');
      if(guide){
        const intro=panel.querySelector(':scope > .organization-invite-help');
        const summary=guide.querySelector('summary');
        if(summary)summary.textContent='Подробнее о подключении';
        if(intro&&summary)summary.after(intro);
        panel.append(guide);
      }
      panel.hidden = !organization || !manager() || available === false;
      if (panel.hidden) { refreshNavigation(); return; }
      $('#paymentProviderUnavailable').hidden = available !== null;
      $('#paymentProviderWorkspace').hidden = available !== true;
      if (available !== true) {
        $('#paymentProviderUnavailableText').textContent = error?.code === 'payment_workspace_scope_mismatch'
          ? 'Сервер вернул данные другой организации. Платёжные действия заблокированы.'
          : error ? 'Не удалось загрузить платёжный модуль. Записи продолжают работать без онлайн-эквайринга.' : 'Проверяем защищённые настройки и операции…';
        refreshNavigation();
        return;
      }
      const settings = payload.settings || {};
      $('#paymentProviderEnabled').checked = Boolean(settings.enabled);
      $('#paymentProviderEnvironment').value = settings.environment || 'test';
      $('#paymentFiscalizationEnabled').checked = Boolean(settings.fiscalization_enabled);
      $('#paymentTaxation').value = settings.taxation || 'usn_income';
      $('#paymentVatCode').value = String(settings.vat_code || 1);
      $('#paymentMode').value = settings.payment_mode || 'full_prepayment';
      const attempts = Array.isArray(payload.recent_attempts) ? payload.recent_attempts : [];
      const refunds = Array.isArray(payload.recent_refunds) ? payload.recent_refunds : [];
      const reconciliations = Array.isArray(payload.recent_reconciliations) ? payload.recent_reconciliations : [];
      const testPaymentSucceeded = attempts.some(item => item.environment === 'test' && item.status === 'succeeded');
      $('#paymentProviderState').textContent = settings.enabled
        ? `ЮKassa включена в режиме «${settings.environment === 'production' ? 'рабочий' : 'тестовый'}»`
        : testPaymentSucceeded ? 'ЮKassa: тест подтверждён, приём выключен' : 'ЮKassa: тест не подтверждён';
      $('#paymentProviderSettingsForm').hidden = !owner();
      $('#paymentProviderControls').hidden = !owner();
      const operationRows = [
        ...attempts.map(item => {
          const remaining = attemptRemaining(item);
          return `<article class="organization-row payment-attempt-row"><div><strong>Платёж · ${escapeHtml(moneyMinor(item.amount_minor))}</strong><small>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span>${remaining > 0 ? `доступно к возврату ${escapeHtml(moneyMinor(remaining))}` : ''}</span></article>`;
        }),
        ...refunds.map(item => `<article class="organization-row payment-attempt-row"><div><strong>Возврат · ${escapeHtml(moneyMinor(item.amount_minor))}</strong><small>${escapeHtml(refundStatusLabel(item.status))} · ${escapeHtml(item.reason || 'Без пояснения')} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span>${['creating','pending'].includes(item.status) ? 'сумма зарезервирована' : ''}</span></article>`),
        ...reconciliations.map(item => `<article class="organization-row payment-attempt-row"><div><strong>Сверка · ${escapeHtml(statusLabel(item.outcome))}</strong><small>${escapeHtml(item.object_kind || 'операция')} · ${escapeHtml(new Date(item.checked_at).toLocaleString('ru-RU'))}</small></div><span>${item.amount_minor == null ? '' : escapeHtml(moneyMinor(item.amount_minor))}</span></article>`)
      ];
      $('#paymentAttemptsList').innerHTML = operationRows.length ? operationRows.join('') : '<div class="provider-empty compact-empty"><strong>Платежей пока нет</strong><small>Операции появятся после включения ЮKassa и первой предоплаты.</small></div>';
      const refundable = attempts.filter(item => item.status === 'succeeded' && Number.isSafeInteger(attemptRemaining(item)) && attemptRemaining(item) >= 100);
      const previousAttempt = $('#paymentRefundAttempt').value;
      const maySelectInitial = !refundSelectionInitialized
        && !$('#paymentRefundAmount').value && !$('#paymentRefundReason').value;
      $('#paymentRefundAttempt').innerHTML = refundable.map((item) => {
        const remaining = attemptRemaining(item);
        return `<option value="${escapeHtml(item.id)}" data-remaining="${remaining}">${escapeHtml(moneyMinor(remaining))} · ${escapeHtml(String(item.id).slice(0, 8))}</option>`;
      }).join('');
      if (!maySelectInitial) {
        const stillRefundable = refundable.some((item) => item.id === previousAttempt);
        $('#paymentRefundAttempt').value = stillRefundable ? previousAttempt : '';
        if (previousAttempt && !stillRefundable) {
          notify('Выбранный платёж больше не доступен для возврата. Выберите платёж заново. Сумма и причина сохранены.');
        }
      }
      refundSelectionInitialized = true;
      $('#paymentRefundForm').hidden = !manager() || !refundable.length;
      if (refundIntent && !refundable.some(item => item.id === refundIntent.attempt_id)) {
        $('#paymentRefundAttempt').innerHTML += `<option value="${escapeHtml(refundIntent.attempt_id)}">Сохранённый возврат · ${escapeHtml(moneyMinor(refundIntent.amount_minor))}</option>`;
      }
      if (refundIntent) $('#paymentRefundAttempt').value = refundIntent.attempt_id;
      updateRefundAmount();
      renderSandbox();
      setBusy(busy);
      refreshNavigation();
    }
    function updateFiscalization() {
      const enabled = $('#paymentFiscalizationEnabled')?.checked;
      $('#paymentFiscalizationFields').hidden = !enabled;
    }
    function updateRefundAmount() {
      const remaining = refundRemaining();
      if ($('#paymentRefundAmount')) {
        $('#paymentRefundAmount').max = remaining === null ? '' : minorInputValue(remaining);
        if (!$('#paymentRefundAmount').value && remaining !== null) $('#paymentRefundAmount').value = minorInputValue(remaining);
      }
      updateFiscalization();
    }
    function settingsMatch(actual, expected) {
      return Boolean(actual)
        && Boolean(actual.enabled) === expected.enabled
        && String(actual.environment || 'test') === expected.environment
        && Boolean(actual.fiscalization_enabled) === expected.fiscalization_enabled
        && (!expected.fiscalization_enabled || (
          String(actual.taxation || '') === expected.taxation
          && Number(actual.vat_code) === expected.vat_code
          && String(actual.payment_mode || '') === expected.payment_mode
        ));
    }
    async function submit(event) {
      if (event.target.id === 'paymentSandboxForm') {
        event.preventDefault();
        await runSandboxCommand('create');
        return;
      }
      if (event.target.id === 'paymentProviderSettingsForm') {
        event.preventDefault();
        if (!organization || !owner() || busy || !requireWrites()) return;
        const isCurrent = beginOperation();
        const fiscal = $('#paymentFiscalizationEnabled').checked;
        const expected = {
          enabled:$('#paymentProviderEnabled').checked,
          environment:$('#paymentProviderEnvironment').value,
          fiscalization_enabled:fiscal,
          taxation:fiscal ? $('#paymentTaxation').value : null,
          vat_code:fiscal ? Number($('#paymentVatCode').value) : null,
          payment_mode:fiscal ? $('#paymentMode').value : null
        };
        try {
          const result = await db.rpc('set_minuta_yookassa_settings', {
            p_organization:organization.id,
            p_enabled:expected.enabled,
            p_environment:expected.environment,
            p_fiscalization_enabled:expected.fiscalization_enabled,
            p_taxation:expected.taxation,
            p_vat_code:expected.vat_code,
            p_payment_mode:expected.payment_mode
          });
          if (!isCurrent()) return;
          setBusy(false);
          if (result.error || !scopeMatches(result.data, organization.id)) {
            await load();
            if (isCurrent()) notify('Сохранение настроек ЮKassa не подтверждено. Показано последнее подтверждённое состояние.');
            return;
          }
          const verified = await load();
          if (!isCurrent()) return;
          if (verified?.ok && settingsMatch(payload?.settings, expected)) notify('Настройки ЮKassa сохранены и проверены');
          else notify('Сохранение настроек ЮKassa не удалось сверить. Платёжные действия заблокированы до обновления.');
        } catch {
          if (isCurrent()) {
            await load();
            if (isCurrent()) notify('Сохранение настроек ЮKassa не подтверждено. Показано последнее подтверждённое состояние.');
          }
        } finally {
          if (isCurrent()) setBusy(false);
        }
        return;
      }
      if (event.target.id !== 'paymentRefundForm') return;
      event.preventDefault();
      if (!organization || busy || !manager() || !requireWrites()) return;
      if (refundStorageFailed) { notify('Не удалось прочитать сохранённый возврат. Новая операция заблокирована.'); return; }
      if (refundIntent) {
        const intent = refundIntent;
        const isCurrent = beginOperation();
        try {
          const status = await reconcileRefundIntent(intent, isCurrent);
          if (!isCurrent()) return;
          if (['succeeded','canceled','failed','pending'].includes(status)) {
            notify(status === 'succeeded' ? 'Возврат выполнен' : status === 'pending' ? 'Возврат принят в обработку' : status === 'canceled' ? 'Возврат отменён' : 'Возврат завершился ошибкой');
            return;
          }
          const reason = $('#paymentRefundReason').value.trim();
          if (!reason || await reasonHash(reason) !== intent.reason_hash) {
            if (isCurrent()) notify('Для повтора укажите прежнюю причину возврата. Сумма и операция сохранены.');
            return;
          }
          if (!isCurrent()) return;
          if (!global.confirm?.(`Проверка не подтвердила завершение. Повторить тот же возврат ${moneyMinor(intent.amount_minor)}? Новая операция создана не будет.`)) return;
          await sendRefund(intent, reason, isCurrent);
        } catch { if (isCurrent()) notify('Не удалось сверить возврат. Новая операция заблокирована; повторите проверку позже.'); }
        finally { if (isCurrent()) setBusy(false); }
        return;
      }
      if (!$('#paymentRefundAttempt').value) {
        notify('Выберите платёж для возврата. Сумма и причина не изменены.');
        return;
      }
      const amountMinor = parseRefundAmount($('#paymentRefundAmount').value);
      const reason = $('#paymentRefundReason').value.trim();
      if (amountMinor === null) {
        notify('Укажите точную сумму в рублях: не больше двух знаков после запятой, без округления. Сумма должна быть в допустимом диапазоне.');
        return;
      }
      if (amountMinor < 100) {
        notify('Минимальная сумма возврата через ЮKassa — 1 ₽. Сумма не изменена.');
        return;
      }
      const remaining = refundRemaining();
      if (remaining === null) {
        notify('Не удалось проверить доступную сумму возврата. Обновите журнал операций.');
        return;
      }
      if (amountMinor > remaining) {
        notify(`Сумма возврата превышает доступные ${minorInputValue(remaining).replace('.', ',')} ₽. Проверьте журнал операций. Сумма не изменена.`);
        return;
      }
      const remainder = remaining - amountMinor;
      if (remainder > 0 && remainder < 100) {
        const full = `${minorInputValue(remaining).replace('.', ',')} ₽`;
        const alternative = remaining >= 200
          ? `Выберите сумму не больше ${minorInputValue(remaining - 100).replace('.', ',')} ₽ или верните весь остаток — ${full}.`
          : `Можно вернуть весь остаток — ${full}.`;
        notify(`После возврата через ЮKassa должно остаться 0 ₽ или не меньше 1 ₽. ${alternative} Сумма не изменена.`);
        return;
      }
      if (reason.length < 8) {
        notify('Укажите причину возврата не короче 8 символов');
        return;
      }
      const confirmedByUser = typeof global.confirm === 'function'
        && global.confirm(`Вернуть ${minorInputValue(amountMinor).replace('.', ',')} ₽ через ЮKassa? Отменить операцию после отправки нельзя.`);
      if (!confirmedByUser) {
        notify('Возврат не отправлен');
        return;
      }
      const isCurrent = beginOperation();
      try {
        const intent = { organization_id:organization.id, attempt_id:$('#paymentRefundAttempt').value,
          request_id:requestId(), amount_minor:amountMinor, reason_hash:await reasonHash(reason) };
        if (!isCurrent()) return;
        try { persistRefundIntent(intent); }
        catch { notify('Не удалось сохранить защиту от повторного возврата. Операция не отправлена.'); return; }
        await sendRefund(intent, reason, isCurrent);
      } catch {
        if (isCurrent()) {
          notify('Возврат не подтверждён. Проверьте настройки и журнал операций.');
          await load();
        }
      } finally {
        if (isCurrent()) setBusy(false);
      }
    }
    async function sendRefund(intent, reason, isCurrent) {
      const result = await db.functions.invoke('yookassa-refund', { body:{
        organization_id:intent.organization_id, attempt_id:intent.attempt_id,
        request_id:intent.request_id, amount_minor:intent.amount_minor, reason
      }});
      if (!isCurrent()) return;
      if (result.error || result.data?.ok !== true || typeof result.data.refund_id !== 'string'
        || !result.data.refund_id || result.data.amount_minor !== intent.amount_minor
        || !['succeeded','pending','canceled'].includes(result.data.status)) {
        notify('Возврат не подтверждён. Сохранена та же операция; проверьте её статус перед повтором.');
        await load();
        return;
      }
      try { persistRefundIntent({ ...intent, refund_id:result.data.refund_id }); } catch { /* Original request remains durable. */ }
      // Even an acknowledged request stays attached until an explicit new action.
      if (['succeeded','canceled','failed','pending'].includes(result.data.status)) refundVerifiedStatus = result.data.status;
      await load();
      if (isCurrent()) notify(result.data.status === 'succeeded' ? 'Возврат выполнен' : result.data.status === 'pending' ? 'Возврат принят в обработку' : 'Возврат отменён');
    }
    function change(event) {
      if (event.target.id === 'paymentFiscalizationEnabled' || event.target.id === 'paymentRefundAttempt') updateRefundAmount();
      if (event.target.id === 'paymentSandboxBooking') {
        const booking = sandboxBookings().find(item => item.id === event.target.value);
        if ($('#paymentSandboxAmount')) $('#paymentSandboxAmount').value = String(Math.max(1, booking?.totalPriceRub || 1));
      }
    }
    function bind() {
      document.addEventListener('submit', submit);
      document.addEventListener('change', change);
      document.addEventListener('click', event => {
        if (event.target.closest?.('#paymentRefundNew')) newRefund();
        const sandboxAction = event.target.closest?.('[data-payment-sandbox-action]')?.dataset.paymentSandboxAction;
        if (sandboxAction) void runSandboxCommand(sandboxAction);
      });
      $('#reloadPaymentProvider')?.addEventListener('click', load);
    }
    return {
      bind,
      load,
      setOrganization,
      reset,
      isCheckoutEnabled: () => available === true && Boolean(payload?.settings?.enabled)
    };
  }

  global.MinutaPayments = {
    createController,
    createSandboxPaymentState,
    applySandboxPaymentCommand
  };
})(window);
