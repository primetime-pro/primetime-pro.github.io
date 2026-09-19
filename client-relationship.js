(function () {
  'use strict';

  const LEVELS = Object.freeze([
    Object.freeze({ level:0, min:0, title:'Новый клиент', next:1 }),
    Object.freeze({ level:1, min:1, title:'Первый визит', next:3 }),
    Object.freeze({ level:2, min:3, title:'Возвращается', next:8 }),
    Object.freeze({ level:3, min:8, title:'Постоянный клиент', next:12 }),
    Object.freeze({ level:4, min:12, title:'С нами давно', next:null })
  ]);

  function integer(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function visitWord(value) {
    const number = Math.abs(integer(value));
    const lastTwo = number % 100;
    const last = number % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'визитов';
    if (last === 1) return 'визит';
    if (last >= 2 && last <= 4) return 'визита';
    return 'визитов';
  }

  function levelFor(visits) {
    const count = integer(visits);
    return [...LEVELS].reverse().find(item => count >= item.min) || LEVELS[0];
  }

  function relationship({ completedVisits = 0, importedVisits = 0 } = {}) {
    const visits = Math.max(integer(completedVisits), integer(importedVisits));
    const current = levelFor(visits);
    const next = current.next == null ? null : LEVELS.find(item => item.min === current.next);
    const remaining = next ? Math.max(0, next.min - visits) : 0;
    const levelProgress = current.level / 4;
    const intervalProgress = next && next.min > current.min ? (visits - current.min) / (next.min - current.min) / 4 : 0;
    const progress = Math.max(visits ? .08 : 0, Math.min(1, levelProgress + intervalProgress));
    return Object.freeze({
      visits,
      level:current.level,
      title:current.title,
      progress,
      nextTitle:next?.title || '',
      remaining,
      status:current.level ? `${current.title} · ${current.level} уровень` : current.title,
      milestone:next
        ? `До уровня «${next.title}» — ${remaining} ${visitWord(remaining)}`
        : 'Максимальный уровень — спасибо, что вы с нами'
    });
  }

  function normalizedDate(item) {
    return `${String(item?.bookingDate || '')}${String(item?.bookingTime || '')}`;
  }

  function reliability(bookings = [], limit = 8) {
    const resolved = (Array.isArray(bookings) ? bookings : [])
      .filter(item => item && (
        item.status === 'cancelled'
        || item.visitStatus === 'completed'
        || item.visitStatus === 'no_show'
      ))
      .sort((a, b) => normalizedDate(b).localeCompare(normalizedDate(a)))
      .slice(0, Math.max(1, integer(limit) || 8));
    const clientCancellations = resolved.filter(item => item.status === 'cancelled' && item.cancellationReason === 'client').length;
    const noShows = resolved.filter(item => item.status !== 'cancelled' && item.visitStatus === 'no_show').length;
    const totalCancellations = resolved.filter(item => item.status === 'cancelled').length;
    const unknownCancellations = resolved.filter(item => item.status === 'cancelled' && !item.cancellationReason).length;
    const signals = clientCancellations + noShows;
    const parts = [];
    if (clientCancellations) parts.push(`${clientCancellations} ${clientCancellations === 1 ? 'отмена клиентом' : clientCancellations < 5 ? 'отмены клиентом' : 'отмен клиентом'}`);
    if (noShows) parts.push(`${noShows} ${noShows === 1 ? 'неявка' : noShows < 5 ? 'неявки' : 'неявок'}`);
    const confirmedRisk = signals >= 2;
    const cancellationNotice = totalCancellations >= 2;
    return Object.freeze({
      checked:resolved.length,
      clientCancellations,
      noShows,
      totalCancellations,
      unknownCancellations,
      signals,
      needsAttention:confirmedRisk || cancellationNotice,
      severity:confirmedRisk ? 'risk' : cancellationNotice ? 'notice' : '',
      title:confirmedRisk ? 'Подтвердите запись заранее' : cancellationNotice ? 'В истории есть отмены' : '',
      label:confirmedRisk
        ? `${parts.join(' и ')} из последних ${resolved.length} записей`
        : cancellationNotice
          ? `${totalCancellations} ${totalCancellations < 5 ? 'отмены' : 'отмен'} из последних ${resolved.length} записей — проверьте причины перед новой записью`
          : ''
    });
  }

  window.PrimeTimeClientRelationship = Object.freeze({ LEVELS, relationship, reliability, visitWord });
})();
