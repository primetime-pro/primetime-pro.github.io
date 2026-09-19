import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'images');
const helpDataPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'help-data.js');
const baseUrl = process.env.MINUTA_SCREENSHOT_BASE_URL || 'http://127.0.0.1:4174/minuta-online-booking';
const edgePath = process.env.MINUTA_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(outputDirectory, { recursive: true });

const individualGuideSlugs = new Set([
  'first-booking', 'block-time-in-schedule', 'confirm-or-delete-booking', 'record-visit-result-and-payment',
  'find-and-filter-bookings', 'set-regular-workweek', 'customize-workdays-and-booking-step', 'add-service',
  'organization-name', 'add-branch', 'add-staff-shift', 'payroll-plan', 'yookassa-refund',
  'adjust-redeem-loyalty', 'notification-queue', 'notification-templates', 'business-goals',
  'publish-reviews', 'settings-quick-start', 'booking-rules', 'visitor-alerts', 'settings-batch-bookings',
  'settings-group-sessions', 'account-security', 'cabinet-layout-theme', 'booking-card-appearance',
  'mobile-navigation', 'voice-assistant', 'voice-assistant-actions', 'reschedule',
  'repeat-client-booking', 'employee-rights', 'statistics-filters', 'statistics-sections'
]);
const helpContext = { window: {} };
vm.runInNewContext(readFileSync(helpDataPath, 'utf8'), helpContext);
const individualGuideArticles = helpContext.window.MINUTA_HELP_ARTICLES.filter(article => individualGuideSlugs.has(article.slug));

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
await page.route(/\.js(?:\?|$)/, route => route.abort());

try {
const screenshotCss = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
  body { min-width: 0 !important; }
  .kb-shot-ribbon { position: fixed; z-index: 2147483647; top: 14px; right: 18px; padding: 9px 13px; border-radius: 999px; color: #fff; background: #17211b; box-shadow: 0 8px 24px rgb(18 44 31 / 22%); font: 700 12px/1.2 Inter, "Segoe UI", sans-serif; letter-spacing: .02em; }
  .kb-focus { position: relative !important; z-index: 20 !important; outline: 3px solid #168454 !important; outline-offset: 4px !important; box-shadow: 0 0 0 8px rgb(22 132 84 / 13%) !important; }
  .kb-step { position: absolute; z-index: 60; top: -13px; left: -13px; display: grid; place-items: center; width: 28px; height: 28px; border: 3px solid #fff; border-radius: 50%; color: #fff; background: #168454; box-shadow: 0 5px 14px rgb(9 70 42 / 30%); font: 800 13px/1 Inter, "Segoe UI", sans-serif; }
  .report-export-button { color: #fff !important; background: #176d4d !important; }
  dialog.kb-static-dialog { display: block !important; position: fixed !important; inset: 50% auto auto 50% !important; transform: translate(-50%, -50%) !important; max-height: 86vh !important; overflow: auto !important; }
  .kb-guide-backdrop { position: fixed; z-index: 2147483600; inset: 0; background: rgb(240 246 242 / 76%); backdrop-filter: blur(3px); }
  .kb-guide-card { position: fixed; z-index: 2147483601; inset: 86px 54px 46px; display: grid; grid-template-rows: auto 1fr; overflow: hidden; border: 1px solid #c8d9cf; border-radius: 26px; color: #14251c; background: #fbfdfb; font-family: Inter, "Segoe UI", sans-serif; }
  .kb-guide-head { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: end; padding: 28px 32px 24px; border-bottom: 1px solid #dce7e0; background: linear-gradient(135deg, #f6faf7, #eef6f1); }
  .kb-guide-head small { display: block; margin-bottom: 8px; color: #547064; font-size: 13px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .kb-guide-head h1 { max-width: 880px; margin: 0; font-size: 34px; line-height: 1.08; letter-spacing: -.035em; }
  .kb-guide-path { align-self: start; padding: 10px 14px; border: 1px solid #bfd3c7; border-radius: 999px; color: #176d4d; background: #fff; font-size: 13px; font-weight: 800; white-space: nowrap; }
  .kb-guide-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); min-height: 0; }
  .kb-guide-step { position: relative; display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 32px 26px; border-right: 1px solid #dce7e0; }
  .kb-guide-step:last-child { border-right: 0; }
  .kb-guide-step b { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 15px; color: #fff; background: #176d4d; font-size: 18px; }
  .kb-guide-step strong { font-size: 21px; line-height: 1.18; }
  .kb-guide-step p { margin: 0; color: #5d7167; font-size: 15px; line-height: 1.45; }
  .kb-guide-step em { margin-top: auto; padding-top: 14px; color: #a75c39; font-size: 13px; font-style: normal; font-weight: 800; }
  .kb-guide-step.is-empty { background: #f5f9f6; }
`;

async function load(relativePath) {
  await page.goto(`${baseUrl}/${relativePath}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: screenshotCss });
  await page.evaluate(() => {
    document.querySelectorAll('.brand strong').forEach(element => { element.textContent = 'Ваш бизнес'; });
    document.querySelectorAll('.brand small').forEach(element => {
      if (/Рамиль|массажист/i.test(element.textContent || '')) element.textContent = 'онлайн-запись';
    });
    const ribbon = document.createElement('div');
    ribbon.className = 'kb-shot-ribbon';
    ribbon.textContent = 'Интерфейс PrimeTime Pro · учебные данные';
    document.body.append(ribbon);
  });
}

async function addHighlights(selectors) {
  await page.evaluate(items => {
    items.forEach((selector, index) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Не найден элемент для подсветки: ${selector}`);
      element.classList.add('kb-focus');
      const host = element.matches('input, select, textarea') ? (element.closest('label') || element.parentElement) : element;
      if (!host) throw new Error(`Не найден контейнер для подсветки: ${selector}`);
      host.style.position = 'relative';
      const badge = document.createElement('span');
      badge.className = 'kb-step';
      badge.textContent = String(index + 1);
      badge.setAttribute('aria-hidden', 'true');
      host.append(badge);
    });
  }, selectors);
}

async function save(name) {
  const temporaryPath = join(outputDirectory, `${name}.capture.png`);
  const outputPath = join(outputDirectory, `${name}.webp`);
  await page.screenshot({ path: temporaryPath, fullPage: false });
  await sharp(temporaryPath).resize(1200, 675, { fit: 'cover' }).webp({ quality: 86, effort: 6 }).toFile(outputPath);
  unlinkSync(temporaryPath);
  console.log(`${name}.webp`);
}

async function prepareProvider(view, targetSelector = '') {
  await load(`provider.html?view=${view}`);
  await page.evaluate(({ view, targetSelector }) => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.setAttribute('hidden', '');
    document.querySelector('#authCard')?.setAttribute('hidden', '');
    const dashboard = document.querySelector('#dashboard');
    dashboard?.removeAttribute('hidden');
    if (dashboard) dashboard.dataset.activeView = view;
    document.querySelectorAll('.provider-view').forEach(panel => {
      const active = panel.dataset.providerPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-provider-view]').forEach(button => button.classList.toggle('active', button.dataset.providerView === view));
    const sync = document.querySelector('#syncState');
    if (sync) { sync.className = 'sync-state is-online'; sync.innerHTML = '<i></i><span>Сохранено</span>'; }
    const clock = document.querySelector('#currentTimeLabel');
    if (clock) { clock.textContent = '10:24'; clock.setAttribute('datetime', '10:24'); }
    document.querySelectorAll('select').forEach(select => {
      if (!select.options.length) select.add(new Option('Учебный вариант', 'demo'));
    });
    if (!targetSelector) return;
    const panel = document.querySelector(`[data-provider-panel="${view}"]`);
    const target = document.querySelector(targetSelector);
    if (!panel || !target) throw new Error(`Не найден целевой блок: ${targetSelector}`);
    if (view === 'organization') {
      const roleBadge = document.querySelector('#organizationRoleBadge');
      if (roleBadge) roleBadge.textContent = 'Владелец';
    }
    const targetIds = new Set();
    let targetAncestor = target;
    while (targetAncestor && targetAncestor !== panel) {
      if (targetAncestor.id) targetIds.add(targetAncestor.id);
      targetAncestor = targetAncestor.parentElement;
    }
    document.querySelectorAll('[data-section-target]').forEach(button => {
      button.classList.toggle('active', targetIds.has(button.dataset.sectionTarget));
    });
    target.hidden = false;
    let node = target;
    while (node && node !== panel) {
      node.hidden = false;
      const parent = node.parentElement;
      if (!parent) break;
      parent.hidden = false;
      [...parent.children].forEach(sibling => {
        if (sibling === node || sibling.classList.contains('view-title') || sibling.classList.contains('provider-section-nav')) return;
        sibling.hidden = true;
      });
      node = parent;
    }
    target.scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);
  }, { view, targetSelector });
}

async function providerShot(name, view, targetSelector, mutate, highlights) {
  await prepareProvider(view, targetSelector);
  if (mutate) await page.evaluate(mutate);
  if (highlights?.length) await addHighlights(highlights);
  await save(name);
}

async function individualGuideShot(article) {
  const categoryViews = {
    'getting-started': 'bookings', bookings: 'bookings', schedule: 'schedule', services: 'services',
    clients: 'clients', team: 'organization', finance: 'organization', loyalty: 'organization',
    inventory: 'organization', notifications: 'settings', analytics: 'analytics', portfolio: 'portfolio',
    settings: 'settings', assistant: 'bookings'
  };
  if (article.audience === 'client') {
    await load('booking.html');
    await page.evaluate(() => {
      document.querySelector('#manageLoading')?.setAttribute('hidden', '');
      document.querySelector('#manageContent')?.removeAttribute('hidden');
    });
  } else {
    await prepareProvider(categoryViews[article.categorySlug] || 'bookings');
  }
  await page.evaluate(articleData => {
    const backdrop = document.createElement('div');
    backdrop.className = 'kb-guide-backdrop';
    const card = document.createElement('section');
    card.className = 'kb-guide-card';
    const steps = articleData.steps.slice(0, 4);
    while (steps.length < 4) steps.push({ title: 'Готово', text: articleData.note || articleData.excerpt });
    card.innerHTML = `
      <header class="kb-guide-head">
        <div><small>${articleData.category}</small><h1>${articleData.title}</h1></div>
        <span class="kb-guide-path">PrimeTime Pro · наглядно по шагам</span>
      </header>
      <div class="kb-guide-steps">
        ${steps.map((step, index) => `<article class="kb-guide-step${index >= articleData.steps.length ? ' is-empty' : ''}"><b>${index + 1}</b><strong>${step.title}</strong><p>${step.text}</p>${step.action ? `<em>${step.action}</em>` : ''}</article>`).join('')}
      </div>`;
    document.body.append(backdrop, card);
  }, article);
  await save(article.slug);
}

async function injectBookingEditor(kind) {
  await page.evaluate(kind => {
    const sheet = document.querySelector('#bookingSheet');
    const content = document.querySelector('#bookingSheetContent');
    sheet.hidden = false;
    sheet.classList.add('booking-sheet-wide', 'new-booking-sheet');
    document.body.classList.add('booking-sheet-open');
    const times = '<div class="booking-time-hours"><button type="button" class="active">10:00</button><button type="button">11:00</button><button type="button">14:00</button></div><div class="booking-time-slots"><button type="button" class="active">10:30</button><button type="button">10:45</button><button type="button">11:15</button></div>';
    if (kind === 'reschedule') {
      sheet.classList.remove('booking-sheet-wide', 'new-booking-sheet');
      const editTimes = '<button type="button" class="active" data-edit-booking-time="10:30">10:30</button><button type="button" data-edit-booking-time="10:45">10:45</button><button type="button" data-edit-booking-time="11:15">11:15</button><button type="button" data-edit-booking-time="14:00">14:00</button>';
      const colors = [['auto', 'Авто'], ['mint', 'Мята'], ['sky', 'Небо'], ['lavender', 'Лаванда'], ['peach', 'Персик'], ['rose', 'Роза'], ['vanilla', 'Ваниль'], ['sage', 'Шалфей'], ['teal', 'Бирюза'], ['amber', 'Янтарь'], ['cocoa', 'Какао'], ['graphite', 'Графит']];
      const colorPicker = `<fieldset class="booking-color-picker"><legend>Цвет записи</legend><div class="booking-color-options">${colors.map(([color, label], index) => `<label class="booking-color-option color-${color}" title="${label}"><input type="radio" name="editBookingColor" value="${color}" aria-label="${label}" ${index === 0 ? 'checked' : ''}><span aria-hidden="true"></span><small>${label}</small></label>`).join('')}</div></fieldset>`;
      const seriesScope = `<fieldset class="booking-series-scope"><legend>Какие записи перенести</legend><label><input type="radio" name="editBookingSeriesScope" value="one" checked><span><strong>Только эту запись</strong><small>Остальные визиты не изменятся</small></span></label><label><input type="radio" name="editBookingSeriesScope" value="following"><span><strong>Эту и последующие</strong><small>4 записи</small></span></label><label><input type="radio" name="editBookingSeriesScope" value="all"><span><strong>Все будущие записи</strong><small>6 записей; прошедшие визиты сохранятся</small></span></label></fieldset>`;
      content.innerHTML = `<div class="booking-editor-heading"><button class="booking-editor-back" type="button"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg?v=382#icon-arrow-left"></use></svg><span>К записи</span></button><small class="booking-sheet-kicker">Изменение записи</small></div><h2 id="bookingSheetTitle">Перенести или изменить</h2><form class="booking-editor-form booking-edit-form-compact" id="bookingEditForm" data-booking-id="demo"><label>Основная услуга<select id="editBookingService" required disabled><option>Классический массаж · 60 мин</option></select><small>Состав, длительность и стоимость меняются в блоке «Состав сеанса».</small></label><label>Заметка о клиенте<textarea id="editBookingNote" maxlength="1000" rows="2" placeholder="Пожелания, особенности или важная информация"></textarea></label>${colorPicker}<label>Новая дата<input id="editBookingDate" type="date" min="2026-09-05" value="2026-09-12" required></label><label>Свободное время<div class="repeat-times booking-editor-times" id="editBookingTimes">${editTimes}</div></label>${seriesScope}<p class="form-error" id="bookingEditError" hidden></p><button class="primary" type="button">Сохранить изменения</button></form>`;
      document.querySelector('#editBookingNote').closest('label').hidden = true;
      document.querySelector('#editBookingService').closest('label').hidden = true;
      document.querySelector('.booking-color-picker').hidden = true;
      document.querySelector('.booking-sheet-panel').style.zoom = '.82';
      return;
    }
    const advancedOpen = kind === 'recurring' ? ' open' : '';
    content.innerHTML = `<small class="booking-sheet-kicker">Ручное расписание</small><h2 id="bookingSheetTitle">Новый клиент</h2><form class="booking-editor-form new-booking-form" id="newBookingForm"><div class="new-booking-mode-toggle" role="group"><button class="active" type="button">Клиент</button><button type="button">Занять время</button></div><div class="new-booking-layout"><section class="new-booking-section"><div class="new-booking-section-title"><span>1</span><div><strong>Клиент и услуга</strong><small>Только необходимое для записи</small></div></div><div class="booking-client-fields"><label>Имя клиента<input placeholder="Например, Анна"></label><label>Телефон<input placeholder="+7 (___) ___-__-__"></label></div><label>Услуга<select><option>Классический массаж · 60 мин</option></select></label><details class="new-booking-advanced"${advancedOpen}><summary><span>Дополнительные параметры</span><small>Заметка, цвет и серия</small></summary><div class="new-booking-advanced-content"><label>Заметка о клиенте<textarea rows="2" placeholder="Необязательно"></textarea></label><section class="new-booking-recurrence"><div><strong>Курс или серия</strong><small>Все окна должны быть свободны, а последний визит — не дальше двух лет.</small></div><label>Количество<select><option>${kind === 'recurring' ? '6 визитов' : 'Одна запись'}</option></select></label><label>Повторять<select><option>Каждую неделю</option></select></label></section></div></details></section><section class="new-booking-section"><div class="new-booking-section-title"><span>2</span><div><strong>Дата и время</strong><small>Выберите удобное свободное окно</small></div></div><label>Дата<input type="date" value="2026-09-12"></label><label>Свободное время<div class="booking-editor-times booking-time-picker">${times}</div></label></section></div><p class="new-booking-draft-status">Данные формы сохранятся в этой вкладке · это ещё не запись</p><button class="primary new-booking-submit" type="button">${kind === 'recurring' ? 'Создать серию из 6' : 'Создать запись'}</button></form>`;
  }, kind);
}

await prepareProvider('bookings');
await injectBookingEditor('manual');
await addHighlights(['.new-booking-mode-toggle', '.booking-client-fields', '.booking-time-picker', '.new-booking-submit']);
await save('manual-booking');

await prepareProvider('bookings');
await injectBookingEditor('recurring');
await page.evaluate(() => {
  document.querySelector('.new-booking-mode-toggle').hidden = true;
  document.querySelector('.booking-client-fields').hidden = true;
  document.querySelector('.new-booking-section > label').hidden = true;
  document.querySelector('.new-booking-draft-status').hidden = true;
});
await addHighlights(['#newBookingForm .new-booking-advanced', '#newBookingForm .new-booking-recurrence', '#newBookingForm .new-booking-submit']);
await save('recurring-series');

await prepareProvider('bookings');
await injectBookingEditor('reschedule');
await addHighlights(['#editBookingDate', '#editBookingTimes', '.booking-series-scope', '#bookingEditForm .primary']);
await save('reschedule-booking');

await providerShot('team-calendar', 'bookings', '.schedule-card', () => {
  document.querySelector('#teamCalendarToolbar').hidden = false;
  document.querySelector('#teamCalendarFilters').hidden = false;
  document.querySelector('#teamCalendarResourceField').hidden = false;
  document.querySelector('#teamCalendarDensity').hidden = false;
  document.querySelectorAll('#teamCalendarFilters select').forEach((select, index) => { select.innerHTML = `<option>${['Филиал — Центр', 'Все специалисты', 'Все ресурсы'][index]}</option>`; });
}, ['#teamCalendarToolbar .team-calendar-mode', '#teamCalendarFilters', '#teamCalendarDensity']);

await providerShot('date-exceptions', 'schedule', '#monthlyScheduleEditor', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="schedule"] > .view-title').hidden = true;
  document.querySelector('#monthlyScheduleEditor').open = true;
  document.querySelector('#monthlyScheduleMonth').value = '2026-09';
  const grid = document.querySelector('#monthlyScheduleGrid');
  const leading = '<span class="monthly-schedule-blank" aria-hidden="true"></span>';
  grid.innerHTML = leading + Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    const weekday = new Date(2026, 8, day, 12).getDay();
    const weeklyClosed = weekday === 0 || weekday === 6;
    const selected = day === 15;
    const className = weeklyClosed ? 'is-weekly-closed' : 'is-working';
    const status = weeklyClosed ? 'По неделе' : selected ? 'Частично' : 'Рабочий';
    const iso = `2026-09-${String(day).padStart(2, '0')}`;
    return `<button class="monthly-schedule-day ${className}${selected ? ' is-selected' : ''}" type="button" data-monthly-schedule-date="${iso}" aria-label="${day} сентября. ${status}" aria-pressed="${selected}"><strong>${day}</strong><i aria-hidden="true"></i><span class="sr-only">${status}</span></button>`;
  }).join('');
  document.querySelector('#monthlyScheduleDetails').hidden = false;
  document.querySelector('#monthlyScheduleDetails').innerHTML = '<div class="monthly-schedule-details-head"><div><small>Выбранная дата</small><strong>вторник, 15 сентября</strong></div><span>Рабочий с закрытым временем</span></div><dl><div><dt>По неделе</dt><dd>10:00–20:00</dd></div><div><dt>Закрыто частично</dt><dd>14:00–15:00</dd></div><div><dt>Записей</dt><dd>2</dd></div></dl><p>Записи сохранятся. Изменится только доступность для новых клиентов.</p><div class="monthly-schedule-details-actions"><button class="secondary-button" type="button">Сделать выходным</button><button type="button">Закрыть часть дня</button><button type="button">Вернуть обычный график</button></div>';
}, ['#monthlyScheduleMonth', '#monthlyScheduleGrid', '#monthlyScheduleDetails']);

await prepareProvider('bookings');
await page.evaluate(() => {
  const dialog = document.querySelector('#freeSlotsDialog');
  dialog.classList.add('kb-static-dialog');
  dialog.setAttribute('open', '');
  document.querySelector('#freeSlotsFrom').value = '2026-09-12';
  document.querySelector('#freeSlotsText').value = 'Свободное время на 12 сентября: 10:30, 12:00, 16:15';
  document.querySelector('#freeSlotsBookingLink').textContent = 'primetime-pro.online/book/demo';
  document.querySelector('.free-slots-help').hidden = true;
  document.querySelector('.free-slots-text-label').hidden = true;
  document.querySelector('.free-slots-preview').hidden = true;
});
await addHighlights(['.free-slots-mode', '.free-slots-dates', '.free-slots-source', '.free-slots-actions']);
await save('share-free-slots');

await providerShot('client-card', 'clients', '.clients-layout', () => {
  document.querySelector('#clientProfileEmpty').hidden = true;
  document.querySelector('#clientProfileContent').hidden = false;
  document.querySelector('#clientName').textContent = 'Учебный клиент';
  document.querySelector('#clientPhone').textContent = 'Телефон скрыт';
  document.querySelector('#clientVisits').textContent = '4';
  document.querySelector('#clientNext').textContent = '12 сентября';
  document.querySelector('#clientsList').innerHTML = '<button class="client-item active"><span class="client-avatar">У</span><span><strong>Учебный клиент</strong><small>4 визита</small></span></button>';
}, ['#clientSearch', '#clientProfileContent .client-profile-head', '.client-labels-panel', '.client-note-label']);

await providerShot('batch-bookings', 'clients', '#batchBookingComposer', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="clients"] > .view-title').hidden = true;
  const composer = document.querySelector('#batchBookingComposer');
  composer.hidden = false;
  composer.open = true;
  composer.style.width = '900px';
  composer.style.maxWidth = 'calc(100vw - 320px)';
  const profile = composer.closest('.client-profile');
  profile.style.width = '900px';
  profile.style.maxWidth = 'calc(100vw - 320px)';
  document.querySelector('#batchBookingClientName').textContent = 'Учебный клиент';
  document.querySelector('#batchBookingLocation').innerHTML = '<option>Филиал — Центр</option>';
  document.querySelector('#batchBookingService').innerHTML = '<option>Классический массаж · 60 мин</option>';
  document.querySelector('#batchBookingForm > p').hidden = true;
  document.querySelector('#batchBookingComment').closest('label').hidden = true;
  document.querySelector('#batchBookingCount').textContent = '2 из 12';
  document.querySelector('#batchBookingRows').innerHTML = '<div class="batch-booking-row" data-batch-row data-request-id="demo-1"><span class="batch-booking-number" aria-hidden="true">1</span><label>Дата<input type="date" data-batch-date min="2026-09-05" value="2026-09-12" required></label><label>Время<input type="time" data-batch-time value="10:30" required></label><label class="batch-booking-comment">Комментарий к визиту<input type="text" data-batch-comment maxlength="500" value="Первый визит" placeholder="Необязательно"></label><button type="button" class="batch-booking-remove" data-remove-batch-row aria-label="Удалить дату">×</button></div><div class="batch-booking-row" data-batch-row data-request-id="demo-2"><span class="batch-booking-number" aria-hidden="true">2</span><label>Дата<input type="date" data-batch-date min="2026-09-05" value="2026-09-19" required></label><label>Время<input type="time" data-batch-time value="10:30" required></label><label class="batch-booking-comment">Комментарий к визиту<input type="text" data-batch-comment maxlength="500" value="" placeholder="Необязательно"></label><button type="button" class="batch-booking-remove" data-remove-batch-row aria-label="Удалить дату">×</button></div>';
}, ['#batchBookingService', '#batchBookingRows', '#addBatchBookingRow', '#createBatchBookings']);

await providerShot('client-import', 'clients', '#clientImportPanel', () => {
  document.querySelector('#clientImportPanel').hidden = false;
  document.querySelector('#clientImportPanel').open = true;
  document.querySelector('#clientImportMapping').hidden = false;
  document.querySelector('#clientImportNameColumn').innerHTML = '<option>Имя</option>';
  document.querySelector('#clientImportPhoneColumn').innerHTML = '<option>Телефон</option>';
}, ['#clientImportFile', '#clientImportMapping', '#clientImportApplyMapping']);

await providerShot('employee-access', 'organization', '#organizationPeopleSection', () => {
  document.querySelector('#organizationPeopleSection > section:first-child').hidden = true;
  document.querySelector('#memberCreator').open = true;
}, ['#memberCreator summary', '#memberRole', '#memberBookable', '#memberInviteForm .primary']);

await providerShot('service-resources', 'organization', '#resourcesPanel', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#resourcesPanel > .panel-head').hidden = true;
  document.querySelector('#resourcesPanel > .organization-invite-help').hidden = true;
  document.querySelector('#resourceWorkspace').hidden = false;
  document.querySelector('#resourceRequirementService').innerHTML = '<option>Классический массаж</option>';
  document.querySelector('#resourceRequirementsList').innerHTML = '<label>Кабинет массажа<input type="number" value="1" min="0"></label>';
  document.querySelector('#resourcesPanel').style.zoom = '.84';
}, ['#resourceGroupCreator summary', '#resourceCreator summary', '#resourceRequirementsPanel']);

await providerShot('staff-absence', 'organization', '#absenceCreator', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#shiftWorkspace').hidden = false;
  document.querySelector('#absenceCreator').open = true;
  document.querySelector('#absencePerformer').innerHTML = '<option>Специалист</option>';
  document.querySelector('#absenceStart').value = '2026-09-12';
  document.querySelector('#absenceEnd').value = '2026-09-18';
  document.querySelector('#absenceNote').closest('label').hidden = true;
  document.querySelector('#absenceCreator').style.zoom = '.88';
}, ['#absencePerformer', '#absenceStart', '#absenceKind', '#absenceForm .primary']);

await providerShot('staff-substitution', 'organization', '#shiftSubstitutionPanel', () => {
  document.querySelector('#shiftWorkspace').hidden = false;
  document.querySelector('#substitutionBooking').innerHTML = '<option>12 сентября · 10:30 · Учебный клиент</option>';
  document.querySelector('#substitutionService').innerHTML = '<option>Другой специалист · Классический массаж</option>';
}, ['#substitutionBooking', '#substitutionService', '#substitutionForm .secondary-button']);

await providerShot('payroll', 'organization', '#payrollWorkspace', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#payrollWorkspace').hidden = false;
  document.querySelector('#payrollStartDate').value = '2026-09-01';
  document.querySelector('#payrollEndDate').value = '2026-09-30';
  document.querySelector('.payroll-management-grid > section:first-child').hidden = true;
  document.querySelector('#payrollPeriodCreator').open = true;
  document.querySelector('#payrollPeriodName').value = 'Сентябрь 2026';
  document.querySelector('#payrollPeriodLocation').innerHTML = '<option>Все филиалы</option>';
  document.querySelector('#payrollEnabledField').hidden = true;
  document.querySelector('#payrollPeriodLocation').closest('label').hidden = true;
  document.querySelector('#payrollPeriodForm .organization-invite-help').hidden = true;
  document.querySelector('#payrollAdjustmentPanel').hidden = true;
  document.querySelectorAll('#payrollWorkspace > .resource-audit').forEach(element => { element.hidden = true; });
  document.querySelector('#payrollWorkspace').style.zoom = '.86';
}, ['#payrollWorkspace .payroll-toolbar', '#payrollPeriodName', '#payrollPeriodForm .primary']);

await providerShot('yookassa', 'organization', '#paymentProviderPanel', () => {
  document.querySelector('#paymentProviderWorkspace').hidden = false;
  document.querySelector('#paymentProviderEnabled').checked = true;
  document.querySelector('#paymentProviderEnvironment').value = 'test';
}, ['#paymentProviderEnabled', '#paymentProviderEnvironment', '#paymentProviderSettingsForm .primary']);

await providerShot('loyalty-rules', 'organization', '#loyaltyWorkspace', () => {
  document.querySelector('#loyaltyWorkspace').hidden = false;
  document.querySelector('#loyaltyEnabled').checked = true;
  document.querySelector('#loyaltyEarnPercent').value = '5';
  document.querySelector('#loyaltyMinPaid').value = '1000';
  document.querySelector('#loyaltyMaxRedeemPercent').value = '30';
  document.querySelector('#loyaltyActions').hidden = true;
  document.querySelector('.loyalty-promotions').hidden = true;
  document.querySelector('#loyaltyWorkspace > .resource-audit').hidden = true;
}, ['#loyaltyEnabled', '#loyaltyRuleForm .loyalty-form-grid', '#loyaltyRuleForm .primary']);

await providerShot('promo', 'organization', '.loyalty-promotions', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#loyaltyWorkspace').hidden = false;
  const details = document.querySelectorAll('.loyalty-promotions details');
  details.forEach(element => { element.open = true; });
  document.querySelector('#loyaltyPromoCode').value = 'WELCOME10';
  document.querySelector('#loyaltyPromoValue').value = '10';
  document.querySelector('#loyaltyPromoFrom').value = '2026-09-01';
  document.querySelector('#loyaltyPromoUntil').value = '2026-09-30';
  document.querySelector('#loyaltyPromoClient').innerHTML = '<option>Учебный клиент</option>';
  document.querySelector('#loyaltyPromoBooking').innerHTML = '<option>12 сентября · 10:30</option>';
  document.querySelector('#loyaltyPromoApplyCode').value = 'WELCOME10';
  document.querySelector('#loyaltyPromoForm > .loyalty-form-help').hidden = true;
  document.querySelector('#loyaltyPromoFrom').closest('.form-row').hidden = true;
  document.querySelector('#loyaltyPromoTotalLimit').closest('.form-row').hidden = true;
  document.querySelector('#loyaltyPromoApplyForm > .loyalty-form-help').hidden = true;
  document.querySelector('.loyalty-promotions').style.zoom = '.68';
}, ['.loyalty-promotions details:first-of-type summary', '#loyaltyPromoForm .primary', '.loyalty-promotions details:last-of-type summary', '#loyaltyPromoApplyForm .secondary-button']);

await providerShot('benefit-product', 'organization', '#benefitProductCreator', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#benefitsWorkspace').hidden = false;
  document.querySelector('#benefitProductCreator').open = true;
  document.querySelector('#benefitProductKind').value = 'visit_pass';
  document.querySelector('#benefitProductName').value = '5 сеансов массажа';
  document.querySelector('#benefitProductPrice').value = '10000';
  document.querySelector('#benefitProductVisits').value = '5';
  document.querySelector('#benefitProductServices').innerHTML = '<label><input type="checkbox" checked> Классический массаж</label><label><input type="checkbox"> Массаж спины</label>';
  document.querySelector('#benefitProductForm > .benefit-form-help').hidden = true;
  document.querySelector('#benefitProductVisitsField small').hidden = true;
  document.querySelector('#benefitProductServicesHint').hidden = true;
  document.querySelector('#benefitProductCreator').style.zoom = '.67';
}, ['#benefitProductKind', '#benefitProductName', '.benefit-service-fieldset', '#benefitProductForm .primary']);

await providerShot('benefit', 'organization', '#benefitsWorkspace', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#benefitsWorkspace').hidden = false;
  document.querySelector('.benefits-enable-field').hidden = true;
  document.querySelector('.benefits-management-grid > section:first-child').hidden = true;
  document.querySelector('#benefitIssueCreator').open = true;
  document.querySelector('#benefitIssueProduct').innerHTML = '<option>5 сеансов массажа</option>';
  document.querySelector('#benefitIssueClient').innerHTML = '<option>Учебный клиент</option>';
  document.querySelector('#benefitIssueExpiry').value = '2026-12-31';
  document.querySelector('#benefitApplyCreator').open = true;
  document.querySelector('#benefitApplyInstrument').innerHTML = '<option>5 сеансов массажа · Учебный клиент</option>';
  document.querySelector('#benefitApplyBooking').innerHTML = '<option>12 сентября · 10:30 · Классический массаж</option>';
  document.querySelector('#benefitIssueForm > .benefit-form-help').hidden = true;
  document.querySelector('#benefitApplyForm > .benefit-form-help').hidden = true;
  document.querySelector('#benefitApplyAmount').closest('label').hidden = true;
  document.querySelector('#benefitRedemptionsList').innerHTML = '<article class="organization-row"><div class="organization-row-main"><strong>Классический массаж · 1 посещ.</strong><small>Учебный клиент · Зарезервировано</small></div><span class="organization-tags"><button class="primary-button" type="button">Погасить</button><button class="secondary-button" type="button">Вернуть</button></span></article>';
  const redemptions = document.querySelector('.benefit-redemptions');
  document.querySelector('.benefits-management-grid').append(redemptions);
  document.querySelector('#benefitsWorkspace').style.zoom = '.72';
}, ['#benefitIssueForm', '#benefitApplyForm', '#benefitRedemptionsList .organization-tags']);

await providerShot('inventory', 'organization', '#inventoryPanel', () => {
  document.querySelector('#inventoryWorkspace').hidden = false;
  document.querySelector('#inventoryControls').hidden = false;
  document.querySelector('#inventoryEnabled').checked = true;
  document.querySelector('#inventoryItemCreator').open = true;
  document.querySelector('#inventoryWarehouseCreator').open = true;
}, ['#inventoryEnabled', '#inventoryItemCreator', '#inventoryWarehouseCreator']);

await providerShot('inventory-operations', 'organization', '#inventoryMovementForm', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="organization"] > .view-title').hidden = true;
  document.querySelector('#inventoryWorkspace').hidden = false;
  document.querySelector('#inventoryControls').hidden = false;
  document.querySelector('#inventoryMovementWarehouse').innerHTML = '<option>Учебный склад</option>';
  document.querySelector('#inventoryMovementItem').innerHTML = '<option>Массажное масло</option>';
  document.querySelector('#inventoryMovementKind').value = 'receipt';
  document.querySelector('#inventoryMovementQuantity').value = '500';
  document.querySelector('#inventoryMovementReason').value = 'Поставка материалов';
  document.querySelector('#inventoryMovementForm').style.zoom = '.88';
}, ['#inventoryMovementWarehouse', '#inventoryMovementItem', '#inventoryMovementKind', '#inventoryMovementForm .primary']);

await providerShot('inventory-auto-deduct', 'organization', '#inventoryUsageForm', () => {
  document.querySelector('#inventoryWorkspace').hidden = false;
  document.querySelector('#inventoryControls').hidden = false;
  document.querySelector('#inventoryAutoDeduct').checked = true;
  document.querySelector('#inventoryUsageService').innerHTML = '<option>Классический массаж</option>';
  document.querySelector('#inventoryUsageItem').innerHTML = '<option>Массажное масло</option>';
  document.querySelector('#inventoryUsageQuantity').value = '30';
}, ['#inventoryUsageService', '#inventoryUsageItem', '#inventoryUsageQuantity', '#inventoryUsageForm .secondary-button']);

await providerShot('statistics-report', 'analytics', '#analyticsView', () => {
  const values = {
    reportHeroRevenue: '82 500 ₽', reportPlanProgress: '83%', reportForecast: '99 000 ₽', reportHeroUtilization: '76%',
    reportHealthScore: '82', reportHealthLabel: 'Хороший темп', reportRevenue: '82 500 ₽', reportCompletedValue: '89 000 ₽',
    reportDebt: '6 500 ₽', reportCompleted: '34', reportAverage: '2 426 ₽', reportPending: '2'
  };
  Object.entries(values).forEach(([id, value]) => { const element = document.querySelector(`#${id}`); if (element) element.textContent = value; });
  document.querySelector('#reportCommandNarrative').textContent = 'Выручка и загрузка растут относительно прошлого периода.';
  document.querySelector('#reportRevenueTrend').textContent = '+12% к прошлому периоду';
  document.querySelector('#reportWorkload').textContent = '34 часа работы';
  document.querySelector('#reportFilterContent').hidden = false;
  document.querySelector('#reportFilterToggle').setAttribute('aria-expanded', 'true');
}, ['.report-filters', '.report-view-tabs', '#reportCommandCenter', '#exportBookings']);

await providerShot('portfolio', 'portfolio', '', () => {
  const dialog = document.querySelector('#portfolioEditorDialog');
  dialog.classList.add('kb-static-dialog');
  dialog.setAttribute('open', '');
  document.querySelector('#portfolioProcedure').value = 'Учебный пример';
  document.querySelector('#portfolioSessions').value = '6';
  document.querySelector('#portfolioDescription').closest('label').hidden = true;
  document.querySelector('#portfolioSessions').closest('label').querySelector('small').hidden = true;
  document.querySelector('.portfolio-photo-help').hidden = true;
  document.querySelector('#portfolioConsent').checked = true;
  document.querySelector('#portfolioPublished').checked = true;
  dialog.style.zoom = '.61';
  dialog.style.setProperty('max-height', 'none', 'important');
  dialog.style.setProperty('overflow', 'visible', 'important');
}, ['.portfolio-photo-fields', '.portfolio-consent', '#portfolioPublished', '.portfolio-form-actions .primary']);

await providerShot('portfolio-manage', 'portfolio', '#portfolioManageList', () => {
  document.querySelector('#portfolioCount').textContent = '2 работы';
  document.querySelector('#portfolioManageList').innerHTML = '<article class="portfolio-card" draggable="true" data-portfolio-card="demo-1"><div class="portfolio-card-photos"><div class="portfolio-photo"><div class="portfolio-photo-empty">Фото «До»</div><span>До</span></div><div class="portfolio-photo"><div class="portfolio-photo-empty">Фото «После»</div><span>После 6 сеансов</span></div></div><div class="portfolio-card-body"><h3>Учебный пример</h3><small>Работа · 6 сеансов</small><span class="portfolio-card-status published">Опубликовано</span></div><div class="portfolio-card-actions"><button type="button" data-portfolio-move="up" disabled>↑ Выше</button><button type="button" data-portfolio-move="down">↓ Ниже</button><button class="portfolio-edit" type="button">Изменить</button><button class="danger" type="button">Удалить</button></div></article><article class="portfolio-card" draggable="true" data-portfolio-card="demo-2"><div class="portfolio-card-photos"><div class="portfolio-photo"><div class="portfolio-photo-empty">Фото «До»</div><span>До</span></div><div class="portfolio-photo"><div class="portfolio-photo-empty">Фото «После»</div><span>После</span></div></div><div class="portfolio-card-body"><h3>Второй пример</h3><small>Работа · 3 сеанса</small><span class="portfolio-card-status">Черновик</span></div><div class="portfolio-card-actions"><button type="button" data-portfolio-move="up">↑ Выше</button><button type="button" data-portfolio-move="down" disabled>↓ Ниже</button><button class="portfolio-edit" type="button">Изменить</button><button class="danger" type="button">Удалить</button></div></article>';
}, ['[data-portfolio-card="demo-1"] .portfolio-card-status', '[data-portfolio-card="demo-1"] .portfolio-card-actions', '[data-portfolio-card="demo-2"] .portfolio-card-actions']);

await providerShot('telegram-settings', 'settings', '#telegramClientSettingsCard', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="settings"] > .view-title').hidden = true;
  document.querySelector('#telegramContactUsername').value = '';
  document.querySelector('#telegramNotifyConfirmation').checked = true;
  document.querySelector('#telegramNotifyReminder').checked = true;
}, ['.telegram-event-settings', '.telegram-client-settings-actions .primary']);

await providerShot('install-app', 'settings', '#installAppCard', () => {
  document.querySelector('.provider-topbar').hidden = true;
  document.querySelector('[data-provider-panel="settings"] > .view-title').hidden = true;
  document.querySelector('#installAppStatus').textContent = 'Выберите инструкцию для своего устройства';
  document.querySelector('#desktopInstallGuide').hidden = false;
  document.querySelector('#androidInstallGuide').hidden = false;
  document.querySelector('#iosInstallGuide').hidden = false;
  document.querySelector('#installAppCard').style.zoom = '.84';
}, ['#installAppButton', '#desktopInstallGuide', '#androidInstallGuide', '#iosInstallGuide']);

await prepareProvider('analytics');
await page.evaluate(() => {
  const dialog = document.querySelector('#reportExportDialog');
  dialog.showModal();
  document.querySelector('#reportExportPrivacy').value = 'masked';
});
await addHighlights(['#reportExportPrivacy', '[data-report-export="xlsx"]', '[data-report-export="csv"]', '[data-report-export="pdf"]']);
await save('export-report');

await load('index.html');
await page.evaluate(() => {
  document.querySelector('#bookingStatus').innerHTML = '<i></i><span>Онлайн-запись доступна</span>';
  document.querySelector('#services').innerHTML = '<button class="option selected" type="button" data-service="demo-1" aria-pressed="true"><span class="option-main"><strong>Классический массаж</strong><small>60 мин · Специалист</small></span><span class="option-price">2 500 ₽</span></button><button class="option" type="button" data-service="demo-2" aria-pressed="false"><span class="option-main"><strong>Массаж спины</strong><small>45 мин · Специалист</small></span><span class="option-price">2 000 ₽</span></button>';
  document.querySelector('#toDate').disabled = false;
});
await addHighlights(['#services', '#toDate']);
await save('online-booking');

await load('my-bookings.html');
await page.evaluate(() => {
  document.querySelector('.client-social-auth-buttons').hidden = true;
  document.querySelector('#clientLoginCard > p').hidden = true;
  document.querySelector('#clientSmsButton').disabled = false;
  document.querySelector('#clientSmsButton').textContent = 'Получить код';
  document.querySelector('#clientSmsStatus').textContent = 'Код придёт на подтверждённый номер телефона.';
  document.querySelector('#legacyClientLogin').open = true;
  document.querySelector('#clientLoginCard').style.zoom = '.82';
});
await addHighlights(['#clientSmsPhone', '#clientSmsButton', '#legacyClientLogin']);
await save('my-bookings');

await load('index.html');
await page.evaluate(() => {
  document.querySelector('#bookingFlow').hidden = false;
  const dialog = document.querySelector('#waitlistDialog');
  dialog.classList.add('kb-static-dialog');
  dialog.setAttribute('open', '');
  document.querySelector('#waitlistService').textContent = 'Классический массаж';
  document.querySelector('#waitlistDate').textContent = '12 сентября';
});
await addHighlights(['#waitlistName', '#waitlistPhone', '#waitlistPeriod', '#submitWaitlist']);
await save('waitlist');

await load('booking.html');
await page.evaluate(() => {
  document.querySelector('#manageLoading').hidden = true;
  document.querySelector('#manageContent').hidden = false;
  document.querySelector('#manageService').textContent = 'Классический массаж';
  document.querySelector('#manageDay').textContent = '12';
  document.querySelector('#manageMonth').textContent = 'сент';
  document.querySelector('#manageDate').textContent = 'Суббота, 12 сентября';
  document.querySelector('#manageTime').textContent = '10:30';
  document.querySelector('#managePerformer').textContent = 'Специалист';
  document.querySelector('#manageDuration').textContent = '60 минут';
  document.querySelector('#managePrice').textContent = '2 500 ₽';
  document.querySelector('#manageTelegramConnect').disabled = false;
});
await addHighlights(['#manageTelegramConnect']);
await save('client-telegram');

for (const article of individualGuideArticles) await individualGuideShot(article);

console.log(`Готово: ${32 + individualGuideArticles.length} снимков интерфейса`);
} finally {
  await browser.close();
}
