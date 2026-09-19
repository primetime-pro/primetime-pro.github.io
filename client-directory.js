(() => {
  'use strict';
  const defaults = () => ({ sort:'recent', services:[], labels:[], min:'', max:'', from:'', to:'', absent:'', upcoming:'' });
  const sorts = { recent:'Недавно посещали', oldest:'Давно не приходили', most:'Больше сеансов', least:'Меньше сеансов', next:'Ближайшая запись', name:'Имя: А–Я' };
  const labels = { favorite:'Любимый', vip:'VIP', attention:'Внимание' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = booking => `${booking.booking_date || ''}T${String(booking.booking_time || '00:00').slice(0,8)}`;
  function facts(client, outcome, services, nameKey, now) {
    const completed = client.bookings.filter(b => b.status !== 'cancelled' && outcome(b).visit_status === 'completed');
    const imported = completed.filter(b => b.is_imported_history).length;
    const count = completed.length - imported + Math.max(imported, Number(client.imported?.visit_count) || 0);
    const dates = completed.map(b => b.booking_date).filter(Boolean);
    if (client.imported?.last_visit_on) dates.push(client.imported.last_visit_on);
    const last = dates.slice().sort().at(-1) || '';
    const future = client.bookings.filter(b => !b.is_imported_history && b.status !== 'cancelled' && outcome(b).visit_status === 'scheduled' && new Date(stamp(b)) >= now).sort((a,b) => stamp(a).localeCompare(stamp(b)))[0];
    const visited = new Map();
    for (const b of completed) {
      const raw = b.services?.name || '';
      const matched = services.find(s => String(s.id) === String(b.service_id));
      const sameNames = services.filter(s => nameKey(s.name) === nameKey(raw));
      const service = matched || (sameNames.length === 1 ? sameNames[0] : null);
      const key = service ? `id:${service.id}` : `name:${nameKey(raw)}`;
      if (service || nameKey(raw)) visited.set(key, service?.name || raw);
    }
    return { client, count, dates, last, next:future ? stamp(future) : '', visited };
  }
  function matches(row, state, getLabels, today) {
    if (state.min !== '' && row.count < Number(state.min)) return false;
    if (state.max !== '' && row.count > Number(state.max)) return false;
    if (state.services.length && !state.services.some(key => row.visited.has(key))) return false;
    if (state.labels.length && !state.labels.every(key => getLabels(row.client.phone)[key])) return false;
    if ((state.from || state.to) && !row.dates.some(date => (!state.from || date >= state.from) && (!state.to || date <= state.to))) return false;
    if (state.absent !== '') {
      const days = row.last ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${row.last}T12:00:00Z`)) / 86400000) : -1;
      if (days < Number(state.absent)) return false;
    }
    return !state.upcoming || Boolean(row.next) === (state.upcoming === 'yes');
  }
  window.MinutaClientDirectory = {
    facts, matches,
    create({ root, refresh, outcome, getLabels, services, nameKey, today }) {
      let state = defaults(), rows = [], scope = '', query = '';
      root.innerHTML = `<div class="client-directory-toolbar"><button type="button" class="secondary-button" data-client-filters>Фильтры</button><span data-client-found role="status" aria-live="polite" hidden></span></div><div class="client-directory-chips"></div><dialog class="client-directory-dialog"><form><header><h3>Фильтры клиентов</h3><button type="button" class="secondary-button" data-client-close aria-label="Закрыть фильтры">×</button></header><label class="client-directory-sort">Сортировка<select data-client-sort>${Object.entries(sorts).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><div class="client-directory-fields"></div><footer><button type="button" class="secondary-button" data-client-reset>Сбросить</button><button type="submit" class="primary" data-client-apply>Показать клиентов</button></footer></form></dialog>`;
      const dialog = root.querySelector('dialog');
      const form = root.querySelector('form');
      const filtered = draft => rows.filter(row => `${row.client.name} ${row.client.displayPhone} ${row.client.phone}`.toLowerCase().includes(query) && matches(row,draft,getLabels,today()));
      function draft() {
        const result = { ...state, services:[], labels:[] };
        new FormData(form).forEach((value,key) => { if (key === 'services' || key === 'labels') result[key].push(value); else result[key] = value; });
        return result;
      }
      function preview() {
        const next = draft();
        const invalid = (next.min !== '' && next.max !== '' && Number(next.min) > Number(next.max)) || (next.from && next.to && next.from > next.to);
        form.querySelector('[name="max"]').setCustomValidity(next.min !== '' && next.max !== '' && Number(next.min) > Number(next.max) ? 'Максимум должен быть не меньше минимума' : '');
        form.querySelector('[name="to"]').setCustomValidity(next.from && next.to && next.from > next.to ? 'Конец периода должен быть не раньше начала' : '');
        const count = filtered(next).length;
        const noun = count % 10 >= 1 && count % 10 <= 4 && !(count % 100 >= 11 && count % 100 <= 14) ? 'клиента' : 'клиентов';
        root.querySelector('[data-client-apply]').textContent = invalid ? 'Проверьте диапазон' : `Показать ${count} ${noun}`;
        root.querySelector('[data-service-count]').textContent = next.services.length ? `Выбрано: ${next.services.length}` : 'Любую';
      }
      function open() {
        const options = new Map(rows.flatMap(row => [...row.visited]));
        const checks = (name, values, selected) => [...values].map(([key,label]) => `<label class="client-directory-check"><input type="checkbox" name="${name}" value="${escape(key)}" ${selected.includes(key) ? 'checked' : ''}><span>${escape(label)}</span></label>`).join('');
        root.querySelector('.client-directory-fields').innerHTML = `<details class="client-service-picker"><summary>Посещал услугу <span data-service-count>Любую</span></summary><label><span class="sr-only">Найти услугу</span><input type="search" data-service-search placeholder="Найти услугу" autocomplete="off"></label><small>Любая из выбранных услуг</small><div class="client-directory-options">${checks('services', [...options].sort((a,b)=>a[1].localeCompare(b[1],'ru')), state.services) || '<p>Пока нет состоявшихся посещений</p>'}</div><p data-service-empty hidden>Услуги не найдены</p></details><fieldset><legend>Метки <small>Все выбранные</small></legend><div class="client-label-options">${checks('labels',Object.entries(labels),state.labels)}</div></fieldset><fieldset><legend>Сеансы</legend><div class="client-directory-range"><label>От<input type="number" min="0" step="1" name="min" value="${escape(state.min)}"></label><label>До<input type="number" min="0" step="1" name="max" value="${escape(state.max)}"></label></div><small>Состоявшиеся, включая импорт.</small></fieldset><fieldset><legend>Дата посещения</legend><div class="client-directory-range"><label>С<input type="date" name="from" value="${escape(state.from)}"></label><label>По<input type="date" name="to" value="${escape(state.to)}"></label></div></fieldset><label>Не приходили, дней<input type="number" name="absent" min="1" step="1" placeholder="Например, 60" value="${escape(state.absent)}"><small>Только клиенты с известной датой посещения.</small></label><label>Будущая запись<select name="upcoming"><option value="">Любая</option><option value="yes" ${state.upcoming==='yes'?'selected':''}>Есть</option><option value="no" ${state.upcoming==='no'?'selected':''}>Нет</option></select></label>`;
        preview();
        if (!dialog.open) dialog.showModal();
        root.querySelector('.client-directory-fields').scrollTop = 0;
      }
      root.querySelector('[data-client-sort]').addEventListener('change', event => { state.sort = event.target.value; refresh(); });
      root.querySelector('[data-client-filters]').addEventListener('click',open);
      root.querySelector('[data-client-close]').addEventListener('click',()=>dialog.close());
      root.querySelector('[data-client-reset]').addEventListener('click',()=>{ state={...defaults(),sort:state.sort}; open(); refresh(); });
      form.addEventListener('input',event=>{
        if (event.target.matches('[data-service-search]')) {
          const search = nameKey(event.target.value);
          let visible = 0;
          root.querySelectorAll('.client-directory-options label').forEach(label=>{
            label.hidden = !nameKey(label.textContent).includes(search);
            if (!label.hidden) visible++;
          });
          root.querySelector('[data-service-empty]').hidden = visible > 0;
        }
        preview();
      });
      form.addEventListener('change',preview);
      form.addEventListener('submit',event=>{event.preventDefault();state=draft();dialog.close();refresh();});
      root.querySelector('.client-directory-chips').addEventListener('click',event=>{
        const button=event.target.closest('[data-clear-client-filter]'); if(!button)return;
        const key=button.dataset.clearClientFilter;
        if(key==='all') state={...defaults(),sort:state.sort};
        else if(key==='services'||key==='labels') state[key]=state[key].filter(value=>value!==button.dataset.value);
        else state[key]='';
        refresh();
      });
      return {
        apply(clients, search, context) {
          if(scope!==context){scope=context;state=defaults();dialog.close();root.querySelector('[data-client-sort]').value=state.sort;}
          query=search; const now=new Date(); const catalog=services();
          rows=clients.map(client=>facts(client,outcome,catalog,nameKey,now));
          const result=filtered(state);
          result.sort((a,b)=>{
            let order=0;
            if(state.sort==='most'||state.sort==='least')order=(a.count-b.count)*(state.sort==='most'?-1:1);
            if(state.sort==='recent'||state.sort==='oldest')order=!a.last?(!b.last?0:1):!b.last?-1:a.last.localeCompare(b.last)*(state.sort==='recent'?-1:1);
            if(state.sort==='next')order=(a.next||'9999').localeCompare(b.next||'9999');
            return order||a.client.name.localeCompare(b.client.name,'ru')||a.client.phone.localeCompare(b.client.phone);
          });
          const found=root.querySelector('[data-client-found]');
          found.textContent=`Найдено: ${result.length}`;
          const serviceNames=new Map(rows.flatMap(row=>[...row.visited]));
          const chips=[];
          const chip=(key,value,label)=>chips.push(`<button type="button" data-clear-client-filter="${key}" data-value="${escape(value)}" aria-label="Убрать фильтр: ${escape(label)}">${escape(label)} ×</button>`);
          state.services.forEach(key=>chip('services',key,serviceNames.get(key)||'Услуга'));
          state.labels.forEach(key=>chip('labels',key,labels[key]));
          for(const [key,label] of Object.entries({min:'Сеансов от',max:'Сеансов до',from:'Были с',to:'Были по',absent:'Не приходили, дней'}))if(state[key]!=='')chip(key,'',`${label}: ${state[key]}`);
          if(state.upcoming)chip('upcoming','',state.upcoming==='yes'?'Есть будущая запись':'Нет будущей записи');
          root.querySelector('[data-client-filters]').textContent=`Фильтры${chips.length?` · ${chips.length}`:''}`;
          root.querySelector('.client-directory-chips').innerHTML=chips.join('')+(chips.length?'<button type="button" data-clear-client-filter="all">Сбросить</button>':'');
          found.hidden=!query&&!chips.length;
          return result.map(row=>({...row.client,directoryVisitCount:row.count}));
        }
      };
    }
  };
})();
