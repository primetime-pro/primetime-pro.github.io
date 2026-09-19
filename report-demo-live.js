(() => {
  'use strict';

  const DAY_MS = 86400000;
  const DEFAULT_SPEED = 60;
  const STATE_VERSION = 3;
  const START_MINUTE = 8 * 60;
  const LAST_MINUTE = 23 * 60 + 59;
  const HISTORY_DAYS = 90;
  const FORECAST_DAYS = 14;
  const STORAGE_PREFIX = 'minuta-demo-live-v1:';
  const TIMEZONE = 'Europe/Samara';
  const FALLBACK_TEMPLATES = [
    { performer_id:'demo-live-performer-1', service_id:'demo-live-service-1', service:{ name:'Массаж спины', price_rub:2800, duration_minutes:60 } },
    { performer_id:'demo-live-performer-2', service_id:'demo-live-service-2', service:{ name:'Расслабляющий массаж', price_rub:3200, duration_minutes:60 } },
    { performer_id:'demo-live-performer-3', service_id:'demo-live-service-3', service:{ name:'Массаж 90 минут', price_rub:4400, duration_minutes:90 } }
  ];

  function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function integer(seed, minimum, maximum) {
    return minimum + (hash(seed) % (maximum - minimum + 1));
  }

  function businessDate(timeMs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date(timeMs));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function addDays(isoDate, days) {
    const base = Date.parse(`${isoDate}T12:00:00+04:00`);
    return businessDate(base + days * DAY_MS);
  }

  function dateTime(isoDate, time) {
    return Date.parse(`${isoDate}T${time}:00+04:00`);
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function sortRows(rows) {
    return [...rows].sort((left, right) =>
      `${left.booking_date || ''}${left.booking_time || ''}${left.id || ''}`
        .localeCompare(`${right.booking_date || ''}${right.booking_time || ''}${right.id || ''}`));
  }

  function normalizeTemplates(rows) {
    const result = [];
    const seen = new Set();
    for (const row of rows) {
      if (!row?.performer_id || !row?.service_id || !row?.services?.name) continue;
      const key = `${row.performer_id}:${row.service_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const duration = Math.max(30, Number(row.duration_minutes || row.services.duration_minutes || 60) || 60);
      const price = Math.max(0, Number(row.original_price_rub ?? row.total_price_rub ?? row.services.price_rub) || 0);
      result.push({
        performer_id:String(row.performer_id),
        service_id:String(row.service_id),
        service:{
          name:String(row.services.name),
          price_rub:price,
          duration_minutes:duration
        },
        duration_minutes:duration,
        price_rub:price
      });
    }
    return result.length ? result : FALLBACK_TEMPLATES.map(template => ({
      ...template,
      duration_minutes:template.service.duration_minutes,
      price_rub:template.service.price_rub
    }));
  }

  function dailyCandidates(templates, slots, seed) {
    const candidates = [];
    const seen = new Set();
    const templateOffset = integer(`${seed}:template-offset`, 0, templates.length - 1);
    for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const time = slots[slotIndex];
        const template = templates[(templateIndex + templateOffset + slotIndex) % templates.length];
        const key = `${template.performer_id}:${time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ template, time });
      }
    }
    return candidates;
  }

  function advanceExistingRow(row, virtualNowMs) {
    const outcome = row?.booking_outcomes;
    if (!outcome || outcome.visit_status !== 'scheduled' || row.status === 'cancelled') return row;
    const time = String(row.booking_time || '').slice(0, 5);
    if (!validDate(row.booking_date) || !/^\d{2}:\d{2}$/.test(time)) return row;
    const duration = Math.max(30, Number(row.duration_minutes || row.services?.duration_minutes || 60) || 60);
    const startMs = dateTime(row.booking_date, time);
    if (startMs + duration * 60000 > virtualNowMs) return row;
    const price = Math.max(0, Number(row.original_price_rub ?? row.total_price_rub ?? row.services?.price_rub) || 0);
    const noShow = integer(`existing:${row.id}:noshow`, 1, 12) === 1;
    const completed = !noShow;
    const paymentMethod = ['cash', 'card', 'transfer'][integer(`existing:${row.id}:payment`, 0, 2)];
    const received = completed ? Math.round(price * (integer(`existing:${row.id}:payment-amount`, 1, 8) === 1 ? .75 : 1)) : 0;
    return {
      ...row,
      booking_outcomes:{
        ...outcome,
        visit_status:completed ? 'completed' : 'no_show',
        payment_method:completed ? paymentMethod : 'unpaid',
        amount_rub:received,
        actual_duration_minutes:completed ? Math.max(30, duration + (integer(`existing:${row.id}:duration`, 0, 2) - 1) * 10) : null,
        calculated_amount_rub:completed ? price : null,
        completion_source:'auto'
      },
      demo_live:true
    };
  }

  function loadState(storageKey, nowMs) {
    const initial = {
      version:STATE_VERSION,
      dayIso:businessDate(nowMs),
      virtualMinute:START_MINUTE,
      realAtMs:nowMs
    };
    try {
      const stored = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`) || 'null');
      if (!stored || stored.version !== STATE_VERSION || stored.dayIso !== initial.dayIso
        || !Number.isFinite(Number(stored.virtualMinute)) || !Number.isFinite(Number(stored.realAtMs))) return initial;
      return {
        ...initial,
        virtualMinute:Math.min(LAST_MINUTE, Math.max(START_MINUTE, Number(stored.virtualMinute))),
        realAtMs:Number(stored.realAtMs)
      };
    } catch {
      return initial;
    }
  }

  function create(options = {}) {
    const storageKey = String(options.storageKey || 'guest');
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const speed = Math.max(1, Number(options.speed) || DEFAULT_SPEED);
    let state = loadState(storageKey, now());

    function persist() {
      try { localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(state)); } catch {}
    }

    function advance() {
      const currentMs = now();
      const currentDayIso = businessDate(currentMs);
      if (state.dayIso !== currentDayIso) {
        state = { version:STATE_VERSION, dayIso:currentDayIso, virtualMinute:START_MINUTE, realAtMs:currentMs };
        persist();
        return true;
      }
      const elapsedMs = currentMs - state.realAtMs;
      if (elapsedMs < 0) {
        state.realAtMs = currentMs;
        persist();
        return false;
      }
      const previousMinute = state.virtualMinute;
      state.virtualMinute = Math.min(LAST_MINUTE, state.virtualMinute + elapsedMs * speed / 60000);
      state.realAtMs = currentMs;
      if (elapsedMs > 0) persist();
      return state.virtualMinute > previousMinute;
    }

    function materialize(baseRows = [], { organizationId = '', seed = 'minuta-demo-statistics' } = {}) {
      const changed = advance();
      const source = Array.isArray(baseRows) ? baseRows.filter(row => row && validDate(row.booking_date)) : [];
      const datesWithRows = new Set(source.map(row => row.booking_date));
      const occupiedSlots = new Set(source.map(row => `${row.performer_id}:${row.booking_date}:${String(row.booking_time || '').slice(0, 5)}`));
      const todayIso = state.dayIso;
      const virtualNowMs = dateTime(todayIso, `${String(Math.floor(state.virtualMinute / 60)).padStart(2, '0')}:${String(Math.floor(state.virtualMinute % 60)).padStart(2, '0')}`);
      const startIso = addDays(todayIso, -HISTORY_DAYS);
      const endIso = addDays(todayIso, FORECAST_DAYS);
      const templates = normalizeTemplates(source);
      const generated = [];
      const slots = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30'];

      for (let date = startIso, dayIndex = 0; date <= endIso; date = addDays(date, 1), dayIndex += 1) {
        if (date !== todayIso && datesWithRows.has(date)) continue;
        const daySeed = `${seed}:${date}`;
        const count = date === todayIso ? 4 : integer(`${daySeed}:count`, 1, 3);
        const candidates = dailyCandidates(templates, slots, daySeed)
          .filter(candidate => !occupiedSlots.has(`${candidate.template.performer_id}:${date}:${candidate.time}`));
        for (let slotIndex = 0; slotIndex < Math.min(count, candidates.length); slotIndex += 1) {
          const candidate = candidates[slotIndex];
          const template = candidate.template;
          const time = candidate.time;
          const id = `demo-live:${date}:${slotIndex + 1}`;
          const price = Math.max(0, Number(template.price_rub || template.service.price_rub) || 0);
          const duration = Math.max(30, Number(template.duration_minutes || template.service.duration_minutes) || 60);
          const startMs = dateTime(date, time);
          const completed = startMs + duration * 60000 <= virtualNowMs;
          const cancelled = integer(`${daySeed}:cancel:${slotIndex}`, 1, 19) === 1;
          const noShow = !cancelled && completed && integer(`${daySeed}:noshow:${slotIndex}`, 1, 12) === 1;
          const visitStatus = completed && !cancelled ? (noShow ? 'no_show' : 'completed') : 'scheduled';
          const clientNumber = integer(`${daySeed}:client:${slotIndex}`, 1, 28);
          const paymentMethod = ['cash', 'card', 'transfer'][integer(`${daySeed}:payment:${slotIndex}`, 0, 2)];
          const received = visitStatus === 'completed'
            ? Math.round(price * (integer(`${daySeed}:payment-amount:${slotIndex}`, 1, 8) === 1 ? .75 : 1))
            : 0;
          const actualDuration = visitStatus === 'completed'
            ? Math.max(30, duration + (integer(`${daySeed}:duration:${slotIndex}`, 0, 2) - 1) * 10)
            : null;
          generated.push({
            id,
            organization_id:organizationId || null,
            booking_code:`DEMO-L-${date.replaceAll('-', '')}-${slotIndex + 1}`,
            service_id:template.service_id,
            performer_id:template.performer_id,
            client_account_id:null,
            client_name:`Тестовый клиент ${clientNumber}`,
            client_phone:`+7999555${String(clientNumber).padStart(4, '0')}`,
            booking_date:date,
            booking_time:`${time}:00`,
            duration_minutes:duration,
            original_price_rub:price,
            total_price_rub:price,
            status:cancelled ? 'cancelled' : 'confirmed',
            created_at:new Date(startMs - 7 * DAY_MS).toISOString(),
            reschedule_count:0,
            deposit_amount_rub:0,
            payment_status:'not_required',
            booking_source:['client_online', 'provider_manual', 'admin_manual'][integer(`${daySeed}:source:${slotIndex}`, 0, 2)],
            created_by_user_id:null,
            created_by_role:null,
            services:{ ...template.service },
            booking_outcomes:{
              visit_status:visitStatus,
              payment_method:visitStatus === 'completed' ? paymentMethod : 'unpaid',
              amount_rub:received,
              actual_duration_minutes:actualDuration,
              calculated_amount_rub:visitStatus === 'completed' ? price : null,
              completion_source:visitStatus === 'completed' ? 'auto' : 'manual'
            },
            client_had_previous:clientNumber % 4 !== 0,
            demo_live:true,
            demo_live_day_index:dayIndex
          });
        }
      }

      const advancedSource = source.map(row => advanceExistingRow(row, virtualNowMs));
      return {
        rows:sortRows([...advancedSource, ...generated]),
        generatedRows:generated,
        todayIso,
        virtualNowMs,
        changed
      };
    }

    return Object.freeze({
      materialize,
      advance,
      todayIso:() => state.dayIso,
      virtualNow:() => dateTime(state.dayIso, `${String(Math.floor(state.virtualMinute / 60)).padStart(2, '0')}:${String(Math.floor(state.virtualMinute % 60)).padStart(2, '0')}`),
      speed
    });
  }

  window.MinutaDemoLive = Object.freeze({ create, DEFAULT_SPEED, HISTORY_DAYS, FORECAST_DAYS });
})();
