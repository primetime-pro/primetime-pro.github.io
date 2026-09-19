import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providerSource = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const shareHelperStart = providerSource.indexOf('async function shareProviderClientPage()');
const shareHelperEnd = providerSource.indexOf('\nfunction clientAppearanceDraftFromForm', shareHelperStart);
assert.ok(shareHelperStart >= 0 && shareHelperEnd > shareHelperStart, 'Client-page share helper is missing');
const shareHelper = providerSource.slice(shareHelperStart, shareHelperEnd);
const hintHelperStart = providerSource.indexOf("const SCHEDULE_CREATE_HINT_STORAGE_PREFIX");
const hintHelperEnd = providerSource.indexOf('\nfunction renderTimeline(', hintHelperStart);
assert.ok(hintHelperStart >= 0 && hintHelperEnd > hintHelperStart, 'Schedule create hint helper is missing');
const hintHelper = providerSource.slice(hintHelperStart, hintHelperEnd);
const openTimelineHelperStart = providerSource.indexOf('function openTimelineBooking(stage, event)');
const openTimelineHelperEnd = providerSource.indexOf('\nfunction openTimelineBookingAtTime', openTimelineHelperStart);
assert.ok(openTimelineHelperStart >= 0 && openTimelineHelperEnd > openTimelineHelperStart, 'Timeline click helper is missing');
const openTimelineHelper = providerSource.slice(openTimelineHelperStart, openTimelineHelperEnd);
const output = process.env.MINUTA_SCHEDULE_COMPACT_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    content = content.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  }
  const contentType = file.endsWith('.css')
    ? 'text/css'
    : file.endsWith('.svg')
      ? 'image/svg+xml'
      : 'text/html; charset=utf-8';
  response.setHeader('Content-Type', contentType);
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'sage';
    document.body.dataset.providerLayout = 'soft';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'bookings';
      view.classList.toggle('active', view.dataset.providerPanel === 'bookings');
    });
    document.querySelector('[data-calendar-view="day"]').classList.add('active');
    document.querySelector('#scheduleDatePicker').value = '2026-09-15';
    const strip = document.querySelector('#dateStrip');
    strip.innerHTML = Array.from({ length:31 }, (_, index) => {
      const day = index + 1;
      const active = day === 15 ? 'active' : '';
      const today = day === 14 ? 'is-today' : '';
      const weekday = new Intl.DateTimeFormat('ru-RU', { weekday:'short' }).format(new Date(2026, 8, day)).replace('.', '');
      const distance = Math.min(3, Math.abs(day - 15));
      return `<button type="button" class="${active} ${today}" data-date-distance="${distance}" data-booking-date="2026-09-${String(day).padStart(2, '0')}"><span>${day === 14 ? 'Сегодня' : weekday}</span><strong>${day}</strong><small>сент</small></button>`;
    }).join('');
    document.querySelector('#selectedDateTitle').textContent = 'Вторник, 15 сентября';
    document.querySelector('#selectedDateSummary').textContent = '2 записи · 2 перерыва';
    document.querySelector('#todayBookingsCount').textContent = '0';
    document.querySelector('#tomorrowBookingsCount').textContent = '2';
    document.querySelector('#newBookingsCount').textContent = '5';
    document.querySelector('.booking-filters').hidden = true;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings timeline-view';
    bookings.innerHTML = '<div class="day-timeline" style="--timeline-height:720px;height:720px"><div class="timeline-hours"><span class="timeline-hour" style="top:0">10:00</span><span class="timeline-hour" data-last-hour style="top:700px">20:00</span></div><div class="timeline-stage"><i class="timeline-grid-line" style="top:0"></i><i class="timeline-grid-line" style="top:719px"></i><button class="timeline-booking status-confirmed" type="button" style="top:56px;height:72px">Запись</button><button class="timeline-booking status-block automatic-break" type="button" style="top:144px;height:52px">Перерыв</button></div></div>';
    const activeDate = strip.querySelector('.active');
    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeDate.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, activeRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - activeRect.width) / 2);
  });

  await page.addScriptTag({ content:`window.uiIcon=()=>'<svg></svg>';window.currentUser={id:'new-provider'};window.allBookings=[];window.requireBookingWrites=()=>true;window.timelineTimeFromClick=()=> '10:30';window.openTimelineBookingAtTime=(time,date)=>{window.__openedTimelineSlot={time,date};};${hintHelper}\n${openTimelineHelper}` });
  const hintResult = await page.evaluate(() => {
    localStorage.clear();
    const stage = document.createElement('div');
    stage.className = 'timeline-stage schedule-hint-test-stage';
    stage.dataset.timelineDate = '2026-09-15';
    document.body.append(stage);
    stage.innerHTML = scheduleCreateHintMarkup({ userId:'new-provider', hasExistingBookings:false });
    const visibleBefore = Boolean(stage.querySelector('.timeline-create-hint'));
    stage.addEventListener('click', event => openTimelineBooking(stage, event), { once:true });
    stage.dispatchEvent(new MouseEvent('click', { bubbles:true, clientY:20 }));
    const visibleAfter = Boolean(stage.querySelector('.timeline-create-hint'));
    const storedAfter = localStorage.getItem(scheduleCreateHintStorageKey('new-provider'));
    const returningMarkup = scheduleCreateHintMarkup({ userId:'new-provider', hasExistingBookings:false });
    scheduleCreateHintMarkup({ userId:'existing-provider', hasExistingBookings:false });
    const existingMarkup = scheduleCreateHintMarkup({ userId:'existing-provider', hasExistingBookings:true });
    const existingStored = localStorage.getItem(scheduleCreateHintStorageKey('existing-provider'));
    stage.remove();
    return { visibleBefore, visibleAfter, storedAfter, returningMarkup, existingMarkup, existingStored, opened:window.__openedTimelineSlot };
  });
  assert.equal(hintResult.visibleBefore, true, 'first-time provider must see the free-time hint');
  assert.equal(hintResult.visibleAfter, false, 'a real free-time click must remove the hint immediately');
  assert.equal(hintResult.storedAfter, 'dismissed', 'free-time hint dismissal must persist for the provider');
  assert.equal(hintResult.returningMarkup, '', 'dismissed hint returned for the same provider');
  assert.equal(hintResult.existingMarkup, '', 'existing provider with bookings received the onboarding hint');
  assert.equal(hintResult.existingStored, 'dismissed', 'existing provider pending state was not migrated to dismissed');
  assert.deepEqual(hintResult.opened, { time:'10:30', date:'2026-09-15' }, 'hint dismissal changed the actual free-time action');

  const timelineGridTops = new Map();
  const timelineToolbarTops = new Map();
  const timelineCopyTops = new Map();
  const timelineToggleTops = new Map();
  const timelineClientWidths = new Map();
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:430, height:900 }, { width:760, height:1000 }, { width:1440, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const strip = document.querySelector('#dateStrip');
      const activeDate = strip.querySelector('.active');
      strip.style.scrollBehavior = 'auto';
      const stripRect = strip.getBoundingClientRect();
      const activeRect = activeDate.getBoundingClientRect();
      strip.scrollLeft = Math.max(0, activeRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - activeRect.width) / 2);
    });
    await page.waitForTimeout(80);
    const result = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const strip = rect('#dateStrip');
      const stripFrame = rect('.date-strip-frame');
      const previous = rect('.date-strip-shift[data-date-shift="-1"]');
      const next = rect('.date-strip-shift[data-date-shift="1"]');
      const previousStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="-1"]'));
      const nextStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="1"]'));
      const previousIconStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="-1"] .ui-icon'));
      const previousMarkStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="-1"]'), '::before');
      const nextMarkStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="1"]'), '::before');
      const stripFadeBefore = getComputedStyle(document.querySelector('.date-strip-frame'), '::before');
      const stripFadeAfter = getComputedStyle(document.querySelector('.date-strip-frame'), '::after');
      const dateButtons = [...document.querySelectorAll('#dateStrip>button')];
      const fullyVisibleDates = dateButtons.filter(button => {
        const item = button.getBoundingClientRect();
        return item.left >= strip.left - 1 && item.right <= strip.right + 1;
      }).length;
      const intersectingDates = dateButtons.filter(button => {
        const item = button.getBoundingClientRect();
        return item.right > strip.left + 1 && item.left < strip.right - 1;
      }).length;
      const tab = document.querySelector('[data-calendar-view="day"]');
      const tabs = [...document.querySelectorAll('[data-calendar-view]')].map(item => item.getBoundingClientRect().height);
      const tabAccent = getComputedStyle(tab, '::after');
      const activeButton = document.querySelector('#dateStrip>button.active');
      const activeDate = activeButton.getBoundingClientRect();
      const activeDateMarker = getComputedStyle(activeButton, '::after');
      const quietTodayButton = document.querySelector('#dateStrip>button.is-today:not(.active)');
      const quietTodayStyle = getComputedStyle(quietTodayButton);
      const ordinaryDateStyle = getComputedStyle(document.querySelector('#dateStrip>button:not(.active):not(.is-today)'));
      const todayButtonStyle = getComputedStyle(document.querySelector('[data-date-today]'));
      const pickerStyle = getComputedStyle(document.querySelector('.schedule-date-picker'));
      const summary = document.querySelector('.schedule-title-line .dashboard-summary');
      const summaryRect = summary.getBoundingClientRect();
      const summaryChildrenInside = [...summary.children].filter(child => getComputedStyle(child).display !== 'none').every(child => {
        const item = child.getBoundingClientRect();
        return item.left >= summaryRect.left - 1 && item.right <= summaryRect.right + 1;
      });
      const summaryLabelsInside = [...summary.querySelectorAll('strong,span')].filter(label => getComputedStyle(label).position !== 'absolute').every(label => {
        const item = label.getBoundingClientRect();
        return item.left >= summaryRect.left - 1 && item.right <= summaryRect.right + 1;
      });
      const summaryItemCenterDeltas = [...summary.querySelectorAll(':scope>div')].map(item => {
        const itemRect = item.getBoundingClientRect();
        const labels = [...item.querySelectorAll('strong,span')].map(label => label.getBoundingClientRect());
        const contentLeft = Math.min(...labels.map(label => label.left));
        const contentRight = Math.max(...labels.map(label => label.right));
        return Math.abs((contentLeft + contentRight) / 2 - (itemRect.left + itemRect.right) / 2);
      });
      const summaryItems = [...summary.querySelectorAll(':scope>div')].map(item => item.getBoundingClientRect());
      const summaryTotalPrefix = getComputedStyle(summary.querySelector(':scope>div:nth-of-type(3)'), '::before').content;
      const newBookingButton = document.querySelector('#newBookingButton');
      const newBookingRect = newBookingButton.getBoundingClientRect();
      const newBookingHitTarget = document.elementFromPoint(
        (newBookingRect.left + newBookingRect.right) / 2,
        (newBookingRect.top + newBookingRect.bottom) / 2
      );
      const toolbar = rect('.schedule-toolbar');
      const toolbarCopy = rect('.schedule-toolbar>div:first-child');
      const journalToggle = rect('.journal-mode-toggle');
      const titleHeading = rect('.schedule-view-title h2');
      const newBookingLabel = newBookingButton.querySelector('span');
      const newBookingLabelStyle = getComputedStyle(newBookingLabel);
      const timelineStage = document.querySelector('.timeline-stage');
      const timelineStageRect = timelineStage.getBoundingClientRect();
      const timelineViewRect = document.querySelector('#providerBookings').getBoundingClientRect();
      const firstHourRect = document.querySelector('.timeline-hour').getBoundingClientRect();
      const lastHourRect = document.querySelector('[data-last-hour]').getBoundingClientRect();
      const breakRect = document.querySelector('.timeline-booking.automatic-break').getBoundingClientRect();
      const timelineStageStyle = getComputedStyle(timelineStage);
      const timelineLines = [...timelineStage.querySelectorAll('.timeline-grid-line')].map(line => line.getBoundingClientRect());
      const mobileNav = document.querySelector('.provider-mobile-nav');
      const workspace = document.querySelector('.provider-workspace');
      const timelineBooking = timelineStage.querySelector('.timeline-booking');
      timelineBooking.focus({ preventScroll:true });
      const timelineFocusWidth = parseFloat(getComputedStyle(timelineBooking).outlineWidth);
      const activeDateRhythm = () => {
        const rows = [...activeButton.querySelectorAll('span,strong,small')].map(item => item.getBoundingClientRect());
        const card = activeButton.getBoundingClientRect();
        return {
          numberCenterDelta:Math.abs((rows[1].top + rows[1].bottom) / 2 - (card.top + card.bottom) / 2),
          gapDelta:Math.abs((rows[1].top - rows[0].bottom) - (rows[2].top - rows[1].bottom))
        };
      };
      const twoDigitRhythm = activeDateRhythm();
      const activeNumber = activeButton.querySelector('strong');
      const originalNumber = activeNumber.textContent;
      activeNumber.textContent = '7';
      const singleDigitRhythm = activeDateRhythm();
      activeNumber.textContent = originalNumber;
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        clientWidth:document.documentElement.clientWidth,
        body:document.body.getBoundingClientRect(),
        providerView:rect('.provider-view[data-provider-panel="bookings"]'),
        scheduleCard:rect('.schedule-card'),
        workspace:rect('.provider-workspace'),
        scheduleTop:rect('#providerBookings').top,
        timelineTop:rect('.day-timeline').top,
        topbar:rect('.provider-topbar'),
        title:rect('.schedule-view-title'),
        navigation:rect('.date-navigation'),
        strip:stripFrame,
        stripViewport:strip,
        toolbar,
        toolbarCopy,
        journalToggle,
        newBooking:rect('#newBookingButton'),
        today:rect('[data-date-today]'),
        picker:rect('.schedule-date-picker'),
        previous,
        next,
        previousBackgroundImage:previousStyle.backgroundImage,
        nextBackgroundImage:nextStyle.backgroundImage,
        previousIconColor:previousIconStyle.color,
        previousIconWidth:parseFloat(previousIconStyle.width),
        previousIconDisplay:previousIconStyle.display,
        chevronSizes:[parseFloat(previousMarkStyle.width), parseFloat(previousMarkStyle.height), parseFloat(nextMarkStyle.width), parseFloat(nextMarkStyle.height)],
        stripFadeBefore:{ backgroundImage:stripFadeBefore.backgroundImage, pointerEvents:stripFadeBefore.pointerEvents, width:parseFloat(stripFadeBefore.width) },
        stripFadeAfter:{ backgroundImage:stripFadeAfter.backgroundImage, pointerEvents:stripFadeAfter.pointerEvents, width:parseFloat(stripFadeAfter.width) },
        fullyVisibleDates,
        intersectingDates,
        activeDate,
        activeDateCssWidth:getComputedStyle(activeButton).width,
        activeDateFlexBasis:getComputedStyle(activeButton).flexBasis,
        activeDateCustomWidth:getComputedStyle(activeButton).getPropertyValue('--date-card-width').trim(),
        activeDateBoxSizing:getComputedStyle(activeButton).boxSizing,
        twoDigitRhythm,
        singleDigitRhythm,
        activeDateValue:activeButton.dataset.bookingDate,
        activeDateBackground:getComputedStyle(activeButton).backgroundColor,
        activeDateMarkerContent:activeDateMarker.content,
        activeDateMarkerDisplay:activeDateMarker.display,
        activeDateVisible:activeDate.left >= strip.left - 1 && activeDate.right <= strip.right + 1,
        stripScrollLeft:document.querySelector('#dateStrip').scrollLeft,
        stripScrollWidth:document.querySelector('#dateStrip').scrollWidth,
        tabBackground:getComputedStyle(tab).backgroundColor,
        tabAccentHeight:tabAccent.height,
        tabHeights:tabs,
        summary:summaryRect,
        summaryScrollWidth:summary.scrollWidth,
        summaryClientWidth:summary.clientWidth,
        summaryChildrenInside,
        summaryLabelsInside,
        summaryItemCenterDeltas,
        summaryItems,
        summaryTotalPrefix,
        summaryText:[...summary.querySelectorAll('strong,span')].map(item => item.textContent.trim()),
        newBookingHitTarget:newBookingHitTarget === newBookingButton || newBookingButton.contains(newBookingHitTarget),
        newBookingLabel:newBookingLabel.textContent.trim(),
        newBookingLabelVisible:newBookingLabelStyle.position === 'static' && newBookingLabel.getBoundingClientRect().width > 0,
        newBookingPseudo:getComputedStyle(newBookingButton, '::after').content,
        titleToNewBookingGap:newBookingRect.left - titleHeading.right,
        timelineStageOverflow:[timelineStageStyle.overflowX,timelineStageStyle.overflowY],
        timelineLinesInside:timelineLines.every(line => line.left >= timelineStageRect.left - .5 && line.right <= timelineStageRect.right + .5 && line.top >= timelineStageRect.top - .5 && line.bottom <= timelineStageRect.bottom + .5),
        firstHourVisible:firstHourRect.top >= timelineViewRect.top - .5 && firstHourRect.bottom <= timelineViewRect.bottom + .5,
        breakInside:breakRect.top >= timelineStageRect.top && breakRect.bottom <= timelineStageRect.bottom,
        lastHourInside:lastHourRect.top >= timelineViewRect.top && lastHourRect.bottom <= timelineViewRect.bottom + 1,
        focus:{ timeline:timelineFocusWidth },
        toolbarContentCenterDelta:Math.abs((toolbarCopy.top + toolbarCopy.bottom) / 2 - (journalToggle.top + journalToggle.bottom) / 2),
        journalGridGap:rect('#providerBookings').top - journalToggle.bottom,
        quietTodayBackground:quietTodayStyle.backgroundColor,
        quietTodayBackgroundImage:quietTodayStyle.backgroundImage,
        quietTodayShadow:quietTodayStyle.boxShadow,
        dateNumberSize:parseFloat(getComputedStyle(activeButton.querySelector('strong')).fontSize),
        dateCenterDelta:Math.abs((activeDate.top + activeDate.bottom) / 2 - (stripFrame.top + stripFrame.bottom) / 2),
        ordinaryDateBackground:ordinaryDateStyle.backgroundColor,
        ordinaryDateBackgroundImage:ordinaryDateStyle.backgroundImage,
        ordinaryDateShadow:ordinaryDateStyle.boxShadow,
        todayButtonBackground:todayButtonStyle.backgroundColor,
        todayButtonBackgroundImage:todayButtonStyle.backgroundImage,
        todayButtonShadow:todayButtonStyle.boxShadow,
        pickerBackground:pickerStyle.backgroundColor,
        scheduleWorkspace:rect('.schedule-workspace'),
        newBookingBackground:getComputedStyle(newBookingButton).backgroundColor,
        journalActiveBackground:getComputedStyle(document.querySelector('.journal-mode-toggle button.active')).backgroundColor,
        nav:rect('.provider-mobile-nav'),
        navTargets:[...mobileNav.querySelectorAll(':scope>button')].map(button => {
          const item = button.getBoundingClientRect();
          return { height:item.height, width:item.width };
        }),
        workspacePaddingBottom:parseFloat(getComputedStyle(workspace).paddingBottom),
        viewportHeight:innerHeight
      };
    });
    assert.equal(result.overflow, false, `${width}px horizontal overflow`);
    assert.ok(result.newBooking.height >= 44 && result.newBooking.width >= 44, `${width}px New booking target`);
    assert.ok(width <= 760
      ? result.timelineStageOverflow.every(value => value === 'visible')
      : result.timelineStageOverflow.every(value => value === 'clip' || value === 'hidden'), `${width}px timeline overflow contract changed: ${JSON.stringify(result)}`);
      assert.equal(result.timelineLinesInside, true, `${width}px timeline divider leaves its rounded owner: ${JSON.stringify(result)}`);
      assert.equal(result.firstHourVisible, true, `${width}px first timeline label is clipped: ${JSON.stringify(result)}`);
      assert.equal(result.lastHourInside, true, `${width}px full working range is not rendered inside the schedule: ${JSON.stringify(result)}`);
      assert.equal(result.breakInside, true, `${width}px automatic break escapes the schedule card: ${JSON.stringify(result)}`);
      assert.ok(result.focus.timeline >= 2, `${width}px keyboard focus is not visible: ${JSON.stringify(result)}`);
      if (width <= 760) {
        const expectedCardGap = width <= 420 ? 12 : 16;
        assert.ok(Math.abs(result.navigation.left - expectedCardGap) <= 1, `${width}px date card keeps a double outer inset: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.toolbar.left - expectedCardGap) <= 1, `${width}px journal card keeps a double outer inset: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.scheduleWorkspace.left - expectedCardGap) <= 1, `${width}px schedule table is not aligned with its header: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.navigation.right - (result.body.right - expectedCardGap)) <= 1, `${width}px date card right inset changed: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.scheduleWorkspace.right - (result.body.right - expectedCardGap)) <= 1, `${width}px schedule table right inset changed: ${JSON.stringify(result)}`);
      assert.ok(result.today.height >= 44 && result.today.width >= 44, `${width}px Today target`);
      assert.equal(result.newBookingHitTarget, true, `${width}px New booking button is covered by another layer: ${JSON.stringify(result)}`);
      assert.equal(result.newBookingLabel, 'Новая запись', `${width}px New booking label changed`);
      assert.equal(result.newBookingLabelVisible, true, `${width}px full New booking label is hidden: ${JSON.stringify(result)}`);
      assert.ok(result.newBookingPseudo === 'none' || result.newBookingPseudo === 'normal', `${width}px ambiguous compact label is still rendered: ${JSON.stringify(result)}`);
      assert.ok(result.titleToNewBookingGap >= 8, `${width}px full New booking label collides with the schedule title: ${JSON.stringify(result)}`);
      assert.ok(result.newBooking.width >= 108 && result.newBooking.height >= 44, `${width}px New booking button changed height or is too narrow: ${JSON.stringify(result)}`);
      assert.ok(result.picker.height >= 44, `${width}px date picker target`);
      assert.ok(result.previous.height >= 44 && result.next.height >= 44, `${width}px date strip arrows`);
      assert.ok(result.nav.height <= 50, `${width}px mobile navigation is still too tall: ${JSON.stringify(result.nav)}`);
      assert.ok(result.navTargets.length === 5 && result.navTargets.every(target => target.height >= 44 && target.width >= 44), `${width}px mobile navigation targets are not accessible: ${JSON.stringify(result.navTargets)}`);
      assert.ok(result.workspacePaddingBottom >= result.nav.height + (height - result.nav.bottom) + 16, `${width}px compact mobile navigation lacks safe clearance: ${JSON.stringify(result)}`);
      assert.equal(result.previousBackgroundImage, 'none', `${width}px previous chevron regained a heavy background`);
      assert.equal(result.nextBackgroundImage, 'none', `${width}px next chevron regained a heavy background`);
      assert.ok(result.previousIconColor, `${width}px previous arrow icon lost its quiet color`);
      assert.equal(result.previousIconDisplay, 'none', `${width}px long arrow icon is still visible: ${JSON.stringify(result)}`);
      assert.ok(result.chevronSizes.every(size => size >= 9 && size <= 12), `${width}px date strip chevrons are not compact: ${JSON.stringify(result)}`);
      assert.ok(result.fullyVisibleDates >= (width >= 600 ? 5 : 3), `${width}px exposes too few dates between arrows: ${JSON.stringify(result)}`);
      assert.ok(result.intersectingDates >= result.fullyVisibleDates && result.intersectingDates <= result.fullyVisibleDates + 2, `${width}px exposes too many cropped edge dates: ${JSON.stringify(result)}`);
      assert.equal(result.stripFadeBefore.pointerEvents, 'none', `${width}px previous edge fade intercepts date gestures`);
      assert.equal(result.stripFadeAfter.pointerEvents, 'none', `${width}px next edge fade intercepts date gestures`);
      assert.ok(result.previous.right - result.stripViewport.left >= 11 && result.previous.right - result.stripViewport.left <= 13, `${width}px previous 44px target must overlap only the date edge gutter: ${JSON.stringify(result)}`);
      assert.ok(result.stripViewport.right - result.next.left >= 11 && result.stripViewport.right - result.next.left <= 13, `${width}px next 44px target must overlap only the date edge gutter: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateVisible, true, `${width}px selected date must remain visible: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateValue, '2026-09-15', `${width}px fixture selected date changed`);
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its accent`);
      assert.equal(result.activeDateBackground, 'rgb(13, 128, 92)', `${width}px selected date does not use the schedule accent token`);
      assert.equal(result.newBookingBackground, 'rgb(13, 128, 92)', `${width}px New booking does not use the schedule accent token`);
      assert.equal(result.journalActiveBackground, 'rgb(13, 128, 92)', `${width}px active journal mode does not use the schedule accent token`);
      assert.ok(result.activeDate.width >= 46 && result.activeDate.width <= 56, `${width}px selected date is still oversized: ${JSON.stringify(result)}`);
      assert.ok(result.activeDate.height >= 53 && result.activeDate.height <= 55, `${width}px selected date height is still oversized: ${JSON.stringify(result)}`);
      assert.ok(result.twoDigitRhythm.numberCenterDelta <= 1 && result.twoDigitRhythm.gapDelta <= 2, `${width}px two-digit selected date lost its vertical rhythm: ${JSON.stringify(result)}`);
      assert.ok(result.singleDigitRhythm.numberCenterDelta <= 1 && result.singleDigitRhythm.gapDelta <= 2, `${width}px single-digit selected date lost its vertical rhythm: ${JSON.stringify(result)}`);
      assert.ok(result.activeDateMarkerContent === 'none' || result.activeDateMarkerDisplay === 'none', `${width}px selected date regained a second lower marker: ${JSON.stringify(result)}`);
      assert.ok(result.scheduleTop >= 390 && result.scheduleTop <= 520, `${width}px schedule begins: ${JSON.stringify(result)}`);
      assert.ok(result.toolbarContentCenterDelta <= 2, `${width}px day heading and journal toggle are not aligned: ${JSON.stringify(result)}`);
      assert.ok(result.journalGridGap >= 8, `${width}px timeline grid touches the journal toggle: ${JSON.stringify(result)}`);
      assert.ok(result.strip.top - result.navigation.bottom >= -1 && result.strip.top - result.navigation.bottom <= 1, `${width}px date controls and strip no longer form one card: ${JSON.stringify(result)}`);
      assert.ok(result.toolbar.top - result.strip.bottom >= 5 && result.toolbar.top - result.strip.bottom <= 8, `${width}px date card and journal card lost their compact separation: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.viewportHeight - result.nav.bottom) <= 1, `${width}px compact navigation must use the viewport edge while preserving safe-area`);
      assert.equal(result.tabBackground, 'rgba(0, 0, 0, 0)', `${width}px period tabs are not flat`);
      assert.equal(result.tabAccentHeight, '3px', `${width}px selected period needs a clear thin accent`);
      assert.ok(result.tabHeights.every(tabHeight => tabHeight >= 44), `${width}px period touch targets must remain at least 44px`);
      assert.equal(result.quietTodayBackground, 'rgba(0, 0, 0, 0)', `${width}px unselected Today date competes with the selected date`);
      assert.equal(result.quietTodayBackgroundImage, 'none', `${width}px unselected Today date gained a decorative fill`);
      assert.notEqual(result.quietTodayShadow, 'none', `${width}px unselected Today date lost its secondary outline`);
      assert.ok(result.dateCenterDelta <= 1, `${width}px date labels lost their vertical rhythm: ${JSON.stringify(result)}`);
      assert.equal(result.ordinaryDateBackground, 'rgba(0, 0, 0, 0)', `${width}px ordinary date gained a fill`);
      assert.equal(result.ordinaryDateBackgroundImage, 'none', `${width}px ordinary date gained a decorative fill`);
      assert.equal(result.ordinaryDateShadow, 'none', `${width}px ordinary dates must stay quiet`);
      assert.notEqual(result.todayButtonBackground, 'rgba(0, 0, 0, 0)', `${width}px separate Today action must have a readable themed fill`);
      assert.equal(result.todayButtonBackgroundImage, 'none', `${width}px separate Today action gained a decorative fill`);
      assert.equal(result.todayButtonShadow, 'none', `${width}px separate Today action gained an extra accent`);
      assert.notEqual(result.pickerBackground, 'rgba(0, 0, 0, 0)', `${width}px date field lost its surface`);
      if (width <= 760) {
        assert.equal(result.summaryTotalPrefix, '"Всего впереди —"', `${width}px upcoming total caption changed: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.summaryItems[0].top - result.summaryItems[1].top) <= 1, `${width}px today and tomorrow are not on one compact row: ${JSON.stringify(result)}`);
        assert.ok(result.summaryItems[2].top >= result.summaryItems[0].bottom, `${width}px upcoming total is not on the second row: ${JSON.stringify(result)}`);
        assert.ok(result.summary.right <= result.newBooking.left - 7, `${width}px compact summary collides with New booking: ${JSON.stringify(result)}`);
      }
      if (width <= 430) {
        assert.ok(result.dateNumberSize <= 26 && result.dateNumberSize >= 22, `${width}px selected date is not a compact readable accent: ${JSON.stringify(result)}`);
        assert.ok(result.summaryScrollWidth <= result.summaryClientWidth + 1, `${width}px title summary is clipped: ${JSON.stringify(result)}`);
        assert.equal(result.summaryChildrenInside, true, `${width}px title summary children escape their row: ${JSON.stringify(result)}`);
        assert.deepEqual(result.summaryText, ['0', 'сегодня', '2', 'завтра', '5', 'впереди'], `${width}px title summary fixture changed`);
      }
      timelineGridTops.set(width, result.timelineTop);
      timelineToolbarTops.set(width, result.toolbar.top);
      timelineCopyTops.set(width, result.toolbarCopy.top);
      timelineToggleTops.set(width, result.journalToggle.top);
      timelineClientWidths.set(width, result.clientWidth);
    }
    if (width > 760) {
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its solid accent`);
      assert.equal(result.quietTodayBackground, 'rgba(0, 0, 0, 0)', `${width}px Today date competes with the selected date`);
      assert.notEqual(result.quietTodayShadow, 'none', `${width}px Today date lost its secondary outline`);
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-compact-${width}.png`), fullPage:false });
  }

  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    [...strip.children].forEach(button => {
      const day = Number(button.querySelector('strong')?.textContent || 0);
      button.classList.toggle('active', day === 19);
      button.dataset.dateDistance = String(Math.min(3, Math.abs(day - 19)));
    });
    const selected = strip.querySelector('[data-booking-date="2026-09-19"]');
    const stripRect = strip.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, selectedRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - selectedRect.width) / 2);
  });
  await page.waitForTimeout(220);
  const rightEdgeDate = await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    const selected = strip.querySelector('[data-booking-date="2026-09-19"]');
    const button = strip.querySelector('[data-booking-date="2026-09-22"]');
    const label = button.querySelector('small');
    const buttonRect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const viewport = strip.getBoundingClientRect();
    return {
      fullyVisible:buttonRect.left >= viewport.left - 1 && buttonRect.right <= viewport.right + 1,
      labelInside:labelRect.left >= buttonRect.left - 1 && labelRect.right <= buttonRect.right + 1 && labelRect.bottom <= buttonRect.bottom + 1,
      label:label.textContent.trim(),
      selectedBackground:getComputedStyle(selected).backgroundColor,
      selectedBackgroundImage:getComputedStyle(selected).backgroundImage
    };
  });
  assert.equal(rightEdgeDate.fullyVisible, true, `390px date 22 is cropped: ${JSON.stringify(rightEdgeDate)}`);
  assert.equal(rightEdgeDate.labelInside, true, `390px date 22 month label is clipped: ${JSON.stringify(rightEdgeDate)}`);
  assert.equal(rightEdgeDate.label, 'сент', 'date 22 month label changed');
  assert.equal(rightEdgeDate.selectedBackground, 'rgb(13, 128, 92)', `390px selected date 19 lost the solid brand green: ${JSON.stringify(rightEdgeDate)}`);
  assert.equal(rightEdgeDate.selectedBackgroundImage, 'none', `390px selected date 19 gained a gradient: ${JSON.stringify(rightEdgeDate)}`);

  await page.setViewportSize({ width:360, height:720 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(50);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(50);
  const shortDayFold = await page.evaluate(() => {
    const lastHour = document.querySelector('[data-last-hour]').getBoundingClientRect();
    const nav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
    return {
      lastHour:{ top:lastHour.top, bottom:lastHour.bottom, height:lastHour.height },
      nav:{ top:nav.top, bottom:nav.bottom, height:nav.height },
      visibleAboveNav:Math.min(lastHour.bottom, nav.top) - lastHour.top
    };
  });
  assert.ok(shortDayFold.visibleAboveNav >= shortDayFold.lastHour.height - 1, `360x720 final working hour is covered by navigation: ${JSON.stringify(shortDayFold)}`);
  if (output) await page.screenshot({ path:path.join(output, 'schedule-full-day-360x720.png'), fullPage:false });

  await page.evaluate(() => {
    const filters = document.querySelector('.booking-filters');
    filters.hidden = false;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.innerHTML = '<div class="provider-empty schedule-empty"><strong>Записей нет</strong><small>На выбранный период всё свободно.</small></div>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:430, height:900 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const listResult = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const toolbar = rect('.schedule-toolbar');
      const copy = rect('.schedule-toolbar>div:first-child');
      const toggle = rect('.journal-mode-toggle');
      const filters = rect('.booking-filters');
      const bookings = rect('#providerBookings');
      const nav = rect('.provider-mobile-nav');
      const workspace = document.querySelector('.provider-workspace');
      const navLabels = [...document.querySelectorAll('.provider-mobile-nav>button span')];
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        clientWidth:document.documentElement.clientWidth,
        toolbar, copy, toggle, filters, bookings, nav, workspace:rect('.schedule-workspace'),
        firstRowFits:copy.right <= toggle.left - 6,
        controlsToFiltersGap:filters.top - Math.max(copy.bottom, toggle.bottom),
        filterOuterBorder:getComputedStyle(document.querySelector('.booking-filters')).borderTopWidth,
        workspacePaddingBottom:parseFloat(getComputedStyle(workspace).paddingBottom),
        navLabelsFit:navLabels.every(label => label.scrollWidth <= label.clientWidth + 1),
        filterButtons:[...document.querySelectorAll('.booking-filters button')].map(button => ({
          height:button.getBoundingClientRect().height,
          scrollWidth:button.scrollWidth,
          clientWidth:button.clientWidth
        }))
      };
    });
    assert.equal(listResult.overflow, false, `${width}px list has horizontal overflow: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.toolbar.height >= 96 && listResult.toolbar.height <= 145, `${width}px list toolbar is not compact: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.firstRowFits, true, `${width}px list heading overlaps the mode toggle: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.controlsToFiltersGap >= 10, `${width}px list filters crowd the journal toggle: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.filterOuterBorder, '0px', `${width}px duplicate filter frame returned`);
    assert.ok(listResult.filters.top >= listResult.toolbar.top && listResult.filters.bottom <= listResult.toolbar.bottom + 1, `${width}px tabs escape toolbar: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.bookings.top >= listResult.toolbar.bottom - 1, `${width}px list content is covered by controls: ${JSON.stringify(listResult)}`);
    const timelineInsetFromFilters = timelineGridTops.get(width) - listResult.filters.top;
    assert.ok(timelineInsetFromFilters >= 0 && timelineInsetFromFilters <= 36, `${width}px timeline grid does not begin near list content: ${JSON.stringify({ timelineGridTop:timelineGridTops.get(width), filtersTop:listResult.filters.top, timelineInsetFromFilters })}`);
    assert.ok(Math.abs(listResult.toolbar.top - timelineToolbarTops.get(width)) <= 1, `${width}px timeline/list toolbar top jumps: ${JSON.stringify(listResult)}`);
    assert.ok(Math.abs(listResult.copy.top - timelineCopyTops.get(width)) <= 10, `${width}px timeline/list day heading jumps: ${JSON.stringify(listResult)}`);
    assert.ok(Math.abs(listResult.toggle.top - timelineToggleTops.get(width)) <= 10, `${width}px timeline/list mode toggle jumps: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.clientWidth, timelineClientWidths.get(width), `${width}px scrollbar changes the schedule width`);
    assert.ok(listResult.filterButtons.every(button => button.height >= 44 && button.scrollWidth <= button.clientWidth + 1), `${width}px list tabs are clipped: ${JSON.stringify(listResult)}`);
    if (width >= 390) assert.equal(listResult.navLabelsFit, true, `${width}px mobile navigation labels are clipped: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.workspacePaddingBottom >= listResult.nav.height + (height - listResult.nav.bottom) + 16, `${width}px mobile navigation lacks safe clearance: ${JSON.stringify(listResult)}`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-list-${width}.png`), fullPage:false });

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(80);
    const bottomGap = await page.evaluate(() => {
      const last = document.querySelector('#providerBookings>:last-child').getBoundingClientRect();
      const nav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
      return nav.top - last.bottom;
    });
    assert.ok(bottomGap >= 16, `${width}px final list card reaches the fixed navigation after scroll: ${bottomGap}px`);
  }

  await page.setViewportSize({ width:390, height:3000 });
  const scrollbarGutter = await page.evaluate(() => {
    const bookings = document.querySelector('#providerBookings');
    const originalMarkup = bookings.innerHTML;
    const originalMinHeight = bookings.style.minHeight;
    bookings.replaceChildren();
    bookings.style.minHeight = '0px';
    void bookings.getBoundingClientRect();
    const short = { clientWidth:document.documentElement.clientWidth, toolbarTop:document.querySelector('.schedule-toolbar').getBoundingClientRect().top };
    bookings.style.minHeight = '5000px';
    void bookings.getBoundingClientRect();
    const long = { clientWidth:document.documentElement.clientWidth, toolbarTop:document.querySelector('.schedule-toolbar').getBoundingClientRect().top };
    bookings.innerHTML = originalMarkup;
    bookings.style.minHeight = originalMinHeight;
    return { short, long, overflow:document.documentElement.scrollWidth > innerWidth + 2 };
  });
  assert.equal(scrollbarGutter.short.clientWidth, scrollbarGutter.long.clientWidth, `390px short/long list changed viewport width: ${JSON.stringify(scrollbarGutter)}`);
  assert.equal(scrollbarGutter.short.toolbarTop, scrollbarGutter.long.toolbarTop, `390px short/long list shifted schedule controls: ${JSON.stringify(scrollbarGutter)}`);
  assert.equal(scrollbarGutter.overflow, false, `390px gutter created horizontal overflow: ${JSON.stringify(scrollbarGutter)}`);
  const dateStripStability = await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    const frame = document.querySelector('.date-strip-frame');
    strip.hidden = false;
    const visible = frame.getBoundingClientRect();
    strip.hidden = true;
    const hidden = frame.getBoundingClientRect();
    strip.hidden = false;
    const restored = frame.getBoundingClientRect();
    return { visible:{ top:visible.top, height:visible.height }, hidden:{ top:hidden.top, height:hidden.height }, restored:{ top:restored.top, height:restored.height } };
  });
  assert.deepEqual(dateStripStability.restored, dateStripStability.visible, `390px restored date strip changed geometry: ${JSON.stringify(dateStripStability)}`);
  assert.ok(dateStripStability.hidden.height === 0 || dateStripStability.hidden.height === dateStripStability.visible.height, `390px hidden date strip left partial geometry: ${JSON.stringify(dateStripStability)}`);

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'week');
    });
    document.querySelector('#selectedDateTitle').textContent = '31 августа — 6 сентября 2026 г.';
    document.querySelector('#selectedDateSummary').textContent = '2 записи · 3 перерыва';
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings calendar-overview calendar-overview-week';
    bookings.innerHTML = '<div class="calendar-overview-grid"><article class="calendar-overview-day"><button class="calendar-overview-date" type="button"><span>Пн</span><strong>31</strong><small>авг</small></button><div class="calendar-overview-items"><button class="calendar-overview-booking" type="button"><time>10:00</time><span><strong>Перерыв</strong><small>Занятое время</small></span></button></div></article></div>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const weekResult = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const nav = rect('.date-navigation');
      const tabs = rect('.calendar-view-toggle');
      const toolbar = rect('.schedule-toolbar');
      const titleElement = document.querySelector('#selectedDateTitle');
      const title = titleElement.getBoundingClientRect();
      const day = rect('.calendar-overview-week .calendar-overview-day');
      const date = rect('.calendar-overview-week .calendar-overview-date');
      const booking = rect('.calendar-overview-week .calendar-overview-booking');
      const time = rect('.calendar-overview-week .calendar-overview-booking time');
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        navArrowDisplays:[...document.querySelectorAll('.date-navigation>.date-nav-button')].map(button => getComputedStyle(button).display),
        tabsRightDelta:Math.abs(nav.right - tabs.right),
        titleInset:title.left - toolbar.left,
        titleFits:titleElement.scrollWidth <= titleElement.clientWidth + 1 && titleElement.scrollHeight <= titleElement.clientHeight + 1,
        titleBox:{ clientWidth:titleElement.clientWidth, scrollWidth:titleElement.scrollWidth, clientHeight:titleElement.clientHeight, scrollHeight:titleElement.scrollHeight, whiteSpace:getComputedStyle(titleElement).whiteSpace },
        dateInset:date.left - day.left,
        timeInset:time.left - booking.left
      };
    });
    assert.equal(weekResult.overflow, false, `${width}px week view has horizontal overflow: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.navArrowDisplays.every(display => display === 'none'), `${width}px week view duplicates navigation arrows: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.tabsRightDelta <= 1, `${width}px week tabs do not span the navigation row: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.titleInset >= 8, `${width}px week range title touches the outer edge: ${JSON.stringify(weekResult)}`);
    assert.equal(weekResult.titleFits, true, `${width}px week range title is clipped: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.dateInset >= 11, `${width}px week day title touches its card edge: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.timeInset >= 11, `${width}px week booking time touches its card edge: ${JSON.stringify(weekResult)}`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-week-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'month');
    });
    document.querySelector('#selectedDateTitle').textContent = 'Сентябрь 2026 г.';
    document.querySelector('#selectedDateSummary').textContent = '5 записей · 3 перерыва';
    document.querySelector('.journal-mode-toggle').hidden = true;
    document.querySelector('.booking-filters').hidden = true;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings calendar-overview calendar-overview-month';
    const monthDays = Array.from({ length:35 }, (_, index) => `<article class="calendar-overview-day ${index === 0 ? 'is-selected' : ''}"><button class="calendar-overview-date" type="button"><strong>${index + 1}</strong><small class="calendar-overview-count">${index % 3 ? 'Свободно' : '2 записи'}</small></button></article>`).join('');
    bookings.innerHTML = `<div class="calendar-overview-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="calendar-overview-grid">${monthDays}</div><div class="calendar-month-mobile-agenda"><section class="calendar-month-agenda-day"><button class="calendar-month-agenda-date" type="button">вторник, 1 сентября</button><div><button class="calendar-overview-booking" type="button"><time>10:30</time><span class="calendar-overview-booking-copy"><strong>Очень длинное название услуги для проверки безопасной ширины</strong><span class="calendar-overview-booking-details"><span class="calendar-overview-client-row"><b>Евгения Белышева с длинным именем</b><span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span></span><small class="calendar-overview-phone">79120000000</small><small class="calendar-overview-visit">Постоянный · 12-й визит</small></span></span></button></div></section></div>`;
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const monthResult = await page.evaluate(() => {
      const nav = document.querySelector('.date-navigation').getBoundingClientRect();
      const tabs = document.querySelector('.calendar-view-toggle').getBoundingClientRect();
      const card = document.querySelector('.calendar-month-mobile-agenda .calendar-overview-booking');
      const cardRect = card.getBoundingClientRect();
      const time = card.querySelector('time').getBoundingClientRect();
      const badge = card.querySelector('.badge-vip').getBoundingClientRect();
      const copy = card.querySelector('.calendar-overview-booking-copy');
      const copyRect = copy.getBoundingClientRect();
      const toolbarTitle = document.querySelector('.schedule-toolbar>div:first-child').getBoundingClientRect();
      const monthGrid = document.querySelector('.calendar-overview-month .calendar-overview-grid').getBoundingClientRect();
      const monthStyle = getComputedStyle(document.querySelector('#providerBookings'));
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        navArrowDisplays:[...document.querySelectorAll('.date-navigation>.date-nav-button')].map(button => getComputedStyle(button).display),
        stripArrowDisplays:[...document.querySelectorAll('.date-strip-shift')].map(button => getComputedStyle(button).display),
        tabsRightDelta:Math.abs(nav.right - tabs.right),
        toggleDisplay:getComputedStyle(document.querySelector('.journal-mode-toggle')).display,
        agendaInset:time.left - cardRect.left,
        agendaRightInset:cardRect.right - badge.right,
        vipCenterDelta:Math.abs((badge.top + badge.bottom) / 2 - (cardRect.top + cardRect.bottom) / 2),
        vipReserve:parseFloat(getComputedStyle(copy).paddingRight),
        copyFits:copy.scrollWidth <= copy.clientWidth + 1 && copyRect.right <= cardRect.right + 1,
        titleInset:toolbarTitle.left - monthGrid.left,
        monthPaddingBottom:parseFloat(monthStyle.paddingBottom)
      };
    });
    assert.equal(monthResult.overflow, false, `${width}px month view has horizontal overflow: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.navArrowDisplays.every(display => display === 'none'), `${width}px month view duplicates navigation arrows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.stripArrowDisplays.every(display => display !== 'none'), `${width}px month view loses the date-strip arrows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.tabsRightDelta <= 1, `${width}px month tabs do not span the navigation row: ${JSON.stringify(monthResult)}`);
    assert.equal(monthResult.toggleDisplay, 'none', `${width}px month view exposes the day-only journal toggle`);
    assert.ok(monthResult.agendaInset >= 9, `${width}px month agenda text touches the card edge: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.agendaRightInset >= 9, `${width}px VIP badge touches the card edge: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.vipCenterDelta <= 1, `${width}px VIP badge is not vertically centered: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.vipReserve >= 50 && monthResult.vipReserve <= 56, `${width}px VIP safe reserve changed: ${JSON.stringify(monthResult)}`);
    assert.equal(monthResult.copyFits, true, `${width}px long agenda copy overflows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.titleInset >= 8 && monthResult.titleInset <= 16, `${width}px month heading lacks the journal card inset: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.monthPaddingBottom >= 24, `${width}px month content lacks fixed-navigation clearance: ${JSON.stringify(monthResult)}`);
    if (width >= 360 && width <= 760) {
      const reachableLastWeek = await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, document.documentElement.scrollHeight);
        document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
        const scrollers = [document.scrollingElement, ...document.querySelectorAll('*')].filter((node, index, items) => node
          && items.indexOf(node) === index
          && node.scrollHeight > node.clientHeight + 1
          && ['auto','scroll'].includes(getComputedStyle(node).overflowY));
        scrollers.forEach(node => { node.scrollTop = node.scrollHeight; });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const days = [...document.querySelectorAll('.calendar-overview-month .calendar-overview-grid>.calendar-overview-day')];
        const last = days.at(-1).getBoundingClientRect();
        const nav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
        return {
          gap:nav.top - last.bottom,
          scrollY,
          maxScroll:document.documentElement.scrollHeight - innerHeight,
          rootScrollTop:document.scrollingElement.scrollTop,
          rootOverflow:getComputedStyle(document.documentElement).overflowY,
          bodyOverflow:getComputedStyle(document.body).overflowY,
          scrollers:scrollers.map(node => `${node.tagName}.${node.className}:${node.scrollTop}`)
        };
      });
      assert.ok(reachableLastWeek.gap >= -1, `${width}px final month week remains under fixed navigation: ${JSON.stringify(reachableLastWeek)}`);
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-month-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'day');
    });
    document.querySelector('.journal-mode-toggle').hidden = false;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.innerHTML = '<article class="provider-booking status-confirmed color-auto client-vip"><button class="provider-booking-open" type="button"><span class="booking-time-column"><strong>10:30<small>до 11:30</small></strong><span>Вт, 4 авг.</span></span><span class="booking-main"><span class="provider-booking-top"><h3>Общий массаж задней поверхности</h3></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Евгения Белышева</strong><span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span></span><span class="provider-booking-phone">79120000000</span></span></span><span class="provider-booking-chevron">›</span></button></article>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const cardResult = await page.evaluate(() => {
      const open = document.querySelector('.provider-booking-open');
      const openRect = open.getBoundingClientRect();
      const timeRect = open.querySelector('.booking-time-column strong').getBoundingClientRect();
      const rowRect = open.querySelector('.booking-client-name-row').getBoundingClientRect();
      const badgeRect = open.querySelector('.client-badges').getBoundingClientRect();
      const phone = open.querySelector('.provider-booking-phone');
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        timeInset:timeRect.left - openRect.left,
        vipRightGap:rowRect.right - badgeRect.right,
        phoneVisible:phone.getBoundingClientRect().width > 0,
        phoneFits:phone.scrollWidth <= phone.clientWidth + 1
      };
    });
    assert.equal(cardResult.overflow, false, `${width}px record card has horizontal overflow: ${JSON.stringify(cardResult)}`);
    assert.ok(cardResult.timeInset >= 8, `${width}px record time touches the card edge: ${JSON.stringify(cardResult)}`);
    assert.ok(cardResult.vipRightGap <= 1, `${width}px VIP badge is not aligned to the right: ${JSON.stringify(cardResult)}`);
    assert.equal(cardResult.phoneVisible, true, `${width}px record phone is missing`);
    assert.equal(cardResult.phoneFits, true, `${width}px record phone is clipped`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-list-card-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => { document.querySelector('.provider-topbar-tools').open = true; });
  const share = await page.locator('#openFreeSlots').boundingBox();
  assert.ok(share && share.height >= 44, 'Share remains available inside More');
  assert.equal(await page.locator('.schedule-view-title #openFreeSlots').count(), 0, 'Share must not return beside New booking');
  assert.equal(await page.getByRole('button', { name:'Новая запись' }).count(), 1, 'New booking needs its stable accessible name');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('title'), 'Лента');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('title'), 'Список');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('aria-pressed'), 'false');
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:844 });
    const clientShareMenu = await page.evaluate(() => {
      const button = document.querySelector('#shareProviderClientPage');
      const details = button.closest('details');
      button.hidden = false;
      details.open = true;
      const menu = details.querySelector(':scope>div').getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const pseudo = getComputedStyle(button, '::after');
      return {
        label:button.dataset.compactLabel,
        pseudo:pseudo.content,
        height:rect.height,
        leftGap:rect.left - menu.left,
        rightGap:menu.right - rect.right,
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    assert.equal(clientShareMenu.label, 'Поделиться ссылкой для записи');
    assert.equal(clientShareMenu.pseudo, '"Поделиться ссылкой для записи"');
    assert.ok(clientShareMenu.height >= 44, `${width}px client-page share target is too small`);
    assert.ok(clientShareMenu.leftGap >= 0 && clientShareMenu.rightGap >= 0, `${width}px client-page share leaves the More menu`);
    assert.equal(clientShareMenu.overflow, false, `${width}px client-page share adds horizontal overflow`);
  }
  await page.addScriptTag({ content:`window.$=selector=>document.querySelector(selector);window.shareNotices=[];window.notify=message=>shareNotices.push(message);${shareHelper}` });
  const shareResult = await page.evaluate(async () => {
    const button = document.querySelector('#shareProviderClientPage');
    button.hidden = false;
    button.dataset.clientPageUrl = 'https://example.test/public-master';
    const native=[];
    Object.defineProperty(navigator, 'share', { configurable:true, value:async payload => native.push(payload) });
    const nativeOk = await shareProviderClientPage();
    Object.defineProperty(navigator, 'share', { configurable:true, value:undefined });
    const copied=[];
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async value => copied.push(value) } });
    const fallbackOk = await shareProviderClientPage();
    return { nativeOk, fallbackOk, native, copied, notices:shareNotices };
  });
  assert.equal(shareResult.nativeOk, true, 'Native client-page share failed');
  assert.equal(shareResult.fallbackOk, true, 'Client-page copy fallback failed');
  assert.equal(shareResult.native[0].url, 'https://example.test/public-master');
  assert.deepEqual(shareResult.copied, ['https://example.test/public-master']);
  assert.ok(shareResult.notices.includes('Ссылка на страницу клиента скопирована'));
  console.log('PrimeTime Pro independent compact schedule: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
