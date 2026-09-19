(function (global) {
  'use strict';
  const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  function completed(item, outcome) { return item.status !== 'cancelled' && outcome.visit_status === 'completed'; }
  function paymentUnknown(item, outcome) {
    const method = String(outcome.payment_method || '');
    return method === 'imported' || ((item.is_imported_history || outcome.completion_source === 'imported')
      && !['cash', 'card', 'transfer', 'unpaid'].includes(method));
  }
  function amounts(item, outcome, serviceValue) {
    const value = nonnegative(serviceValue), visited = completed(item, outcome);
    const unknown = visited && paymentUnknown(item, outcome);
    const received = visited && !unknown ? nonnegative(outcome.amount_rub) : 0;
    return {
      received,
      serviceValue:value,
      importedValue:unknown ? value : 0,
      unknownPayment:unknown,
      debt:visited && !unknown ? Math.max(0, value - received) : 0
    };
  }
  function serviceValue({ perMinute, calculatedAmount, minuteRate, duration, sessionTotal }) {
    if (!perMinute) return Math.round(nonnegative(sessionTotal));
    return Math.round(nonnegative(calculatedAmount) || nonnegative(minuteRate) * nonnegative(duration));
  }
  function effectivePerformerId(item, outcome) {
    return String((completed(item, outcome) && outcome.completed_performer_id) || item.performer_id || '');
  }
  function currentTeamRows(teamState = {}, expectedTeamKey = '') {
    return typeof expectedTeamKey === 'string' && expectedTeamKey.length > 0 && teamState.status === 'ready'
      && teamState.key === expectedTeamKey && Array.isArray(teamState.rows) ? teamState.rows : [];
  }
  function teamRows(items, { outcomeFor, valueFor, durationFor, clientIdentityFor, teamState = {}, expectedTeamKey = '' }) {
    const performerRows = currentTeamRows(teamState, expectedTeamKey);
    const groups = new Map();
    const rowFor = (id, name = 'Мастер', payroll = null) => ({
      performer_id:id, performer_name:name, completed_visits:0, unique_clients:0,
      worked_minutes:0, revenue_rub:0, payroll_rub:payroll, payment_known_visits:0, clients:new Set()
    });
    // Never carry salary or staff labels across a stale actor/org/period snapshot.
    performerRows.forEach(row => {
      const id = String(row.performer_id || '');
      const payroll = row.payroll_rub == null || !Number.isFinite(Number(row.payroll_rub)) ? null : Number(row.payroll_rub);
      groups.set(id, rowFor(id, row.performer_name || 'Мастер', payroll));
    });
    items.forEach(item => {
      const outcome = outcomeFor(item);
      if (!completed(item, outcome)) return;
      const id = effectivePerformerId(item, outcome), row = groups.get(id) || rowFor(id);
      row.completed_visits += 1;
      row.worked_minutes += nonnegative(durationFor(item));
      row.revenue_rub += amounts(item, outcome, valueFor(item)).received;
      if (!paymentUnknown(item, outcome)) row.payment_known_visits += 1;
      const client = clientIdentityFor(item); if (client) row.clients.add(client);
      groups.set(id, row);
    });
    return [...groups.values()].map(({clients, ...row}) => ({...row, unique_clients:clients.size}));
  }
  global.MinutaReportReconciliation = Object.freeze({ completed, paymentUnknown, amounts, serviceValue, effectivePerformerId, currentTeamRows, teamRows });
})(globalThis);
