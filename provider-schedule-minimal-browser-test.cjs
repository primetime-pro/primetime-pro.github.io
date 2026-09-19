// Read-only geometry fixture. Run with Playwright available in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = __dirname;
const themeCatalog = fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8');
const providerSource = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const helperStart = providerSource.indexOf('function updateDateStripEmphasis(');
const helperEnd = providerSource.indexOf('function bookingCountWord(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Помощники адаптивной ленты дат не найдены');
const dateStripResizeHelpers = providerSource.slice(helperStart, helperEnd);
const titleHelperStart = providerSource.indexOf('function renderSelectedDateTitle(');
const titleHelperEnd = providerSource.indexOf('function calendarOverviewBookingMarkup(', titleHelperStart);
assert.ok(titleHelperStart >= 0 && titleHelperEnd > titleHelperStart, 'Помощник мобильного заголовка дня не найден');
const selectedDateTitleHelper = providerSource.slice(titleHelperStart, titleHelperEnd);
const shiftHelperStart = providerSource.indexOf('function shiftScheduleDate(');
const shiftHelperEnd = providerSource.indexOf('function refreshBusinessDay(', shiftHelperStart);
assert.ok(shiftHelperStart >= 0 && shiftHelperEnd > shiftHelperStart, 'Помощник перехода по неделям не найден');
const shiftScheduleDateHelper = providerSource.slice(shiftHelperStart, shiftHelperEnd);
const themeKeys = [...themeCatalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
assert.ok(themeKeys.length >= 20, 'Каталог тем не прочитан');
const output = process.env.MINUTA_SCHEDULE_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.addStyleTag({ path:path.join(root, 'provider-schedule-minimal.css') });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#dashboard').hidden = false;
      document.querySelector('#dashboard').dataset.activeView = 'bookings';
      document.body.dataset.providerTheme = 'sage';
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('[data-calendar-view="day"]')?.classList.add('active');
      const strip = document.querySelector('#dateStrip');
      strip.innerHTML = Array.from({ length:7 }, (_, index) => `<button type="button" class="${index === 3 ? 'active' : ''}" data-booking-date="2026-09-0${index + 1}" data-date-distance="${Math.abs(index - 3)}"><span>день</span><strong>${index + 1}</strong><small>сент</small></button>`).join('');
      if (!strip.closest('.date-strip-frame')) {
        const frame = document.createElement('div');
        frame.className = 'date-strip-frame';
        frame.innerHTML = '<button class="date-strip-shift" type="button" data-date-shift="-1" aria-label="Предыдущий день">‹</button><button class="date-strip-shift" type="button" data-date-shift="1" aria-label="Следующий день">›</button>';
        strip.before(frame);
        frame.insertBefore(strip, frame.lastElementChild);
      }
      document.querySelector('#bookingSheet').hidden = false;
      document.body.classList.add('booking-sheet-open');
    });

    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height:900 });
      await page.waitForTimeout(450);
      const result = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const panel = box('.booking-sheet-panel');
        const frame = box('.date-strip-frame');
        const previous = box('.date-strip-shift[data-date-shift="-1"]');
        const next = box('.date-strip-shift[data-date-shift="1"]');
        const dates = [...document.querySelectorAll('#dateStrip>button')].map(button => button.getBoundingClientRect());
        const navigationStyle = getComputedStyle(document.querySelector('.date-navigation'));
        const strip = document.querySelector('#dateStrip');
        const stripStyle = getComputedStyle(strip);
        const frameStyle = getComputedStyle(document.querySelector('.date-strip-frame'));
        const toolbarStyle = getComputedStyle(document.querySelector('.schedule-toolbar'));
        const bookingsStyle = getComputedStyle(document.querySelector('#providerBookings'));
        return {
          panelCenterDelta:Math.abs(panel.top + panel.height / 2 - innerHeight / 2),
          panelBottomDelta:Math.abs(innerHeight - panel.bottom),
          previousInside:previous.left >= frame.left && previous.right <= frame.right,
          nextInside:next.left >= frame.left && next.right <= frame.right,
          previousGap:dates[0].left - previous.right,
          nextGap:next.left - dates.at(-1).right,
          oldControlsHidden:[...document.querySelectorAll('.date-navigation>.date-nav-button')].every(button => getComputedStyle(button).display === 'none'),
          overflow:document.documentElement.scrollWidth > innerWidth + 2,
          quietSurfaces:innerWidth <= 760
            ? [navigationStyle,frameStyle,toolbarStyle].every(style => parseFloat(style.borderTopWidth) <= 1 && parseFloat(style.borderRightWidth) <= 1)
              && navigationStyle.borderTopLeftRadius === '22px'
              && frameStyle.borderBottomLeftRadius === '22px'
              && toolbarStyle.borderTopLeftRadius === '22px'
            : [navigationStyle,stripStyle,toolbarStyle].every(style => style.borderRadius === '0px' && style.boxShadow === 'none'),
          surfaceGeometry:[navigationStyle,frameStyle,toolbarStyle].map(style => ({ radius:style.borderRadius, topLeft:style.borderTopLeftRadius, bottomLeft:style.borderBottomLeftRadius, borderTop:style.borderTopWidth, borderRight:style.borderRightWidth, shadow:style.boxShadow })),
          bookingsRadius:bookingsStyle.borderRadius,
          stripScrollable:strip.scrollWidth > strip.clientWidth,
          stripOverflowX:stripStyle.overflowX,
          stripTouchAction:stripStyle.touchAction
        };
      });
      assert.equal(result.previousInside, true, `${width}px: левая стрелка вышла за ленту`);
      assert.equal(result.nextInside, true, `${width}px: правая стрелка вышла за ленту`);
      if (width > 760) {
        assert.ok(result.previousGap >= 0, `${width}px: левая стрелка перекрывает первую дату (${result.previousGap}px)`);
        assert.ok(result.nextGap >= 0, `${width}px: правая стрелка перекрывает последнюю дату (${result.nextGap}px)`);
      } else {
        assert.equal(result.stripOverflowX, 'auto', `${width}px: лента дат не получила нативную инерционную прокрутку`);
        assert.match(result.stripTouchAction, /pan-x/, `${width}px: лента дат не принимает горизонтальный жест`);
        assert.match(result.stripTouchAction, /pan-y/, `${width}px: карусель дат блокирует вертикальный скролл`);
      }
      assert.equal(result.oldControlsHidden, true, `${width}px: старые стрелки остались видимы`);
      assert.equal(result.overflow, false, `${width}px: появился горизонтальный overflow`);
      assert.equal(result.quietSurfaces, true, `${width}px: поверхности расписания потеряли спокойную геометрию ${JSON.stringify(result.surfaceGeometry)}`);
      assert.equal(result.bookingsRadius, '0px', `${width}px: рабочая область осталась вложенной карточкой`);
      if (width > 760) assert.ok(result.panelCenterDelta <= 2, 'На ПК карточка записи не центрирована');
      else assert.ok(result.panelBottomDelta <= 2, 'На телефоне карточка должна оставаться у нижнего края');
    }

    await page.addScriptTag({ content:dateStripResizeHelpers });
    await page.setViewportSize({ width:1440, height:900 });
    await page.evaluate(() => {
      const strip = document.querySelector('#dateStrip');
      strip.innerHTML = Array.from({ length:91 }, (_, index) => `<button type="button" data-booking-date="2026-10-${String(index + 1).padStart(2, '0')}" class="${index === 70 ? 'active' : ''}"><span>день</span><strong>${index + 1}</strong><small>окт</small></button>`).join('');
      updateDateStripEmphasis(strip);
      centerDateStripSelection(strip);
      bindDateStripResizeCentering(strip);
    });
    for (const width of [760, 390, 360, 1440]) {
      await page.setViewportSize({ width, height:900 });
      await page.waitForTimeout(300);
      const activeState = await page.evaluate(() => {
        const strip = document.querySelector('#dateStrip').getBoundingClientRect();
        const active = document.querySelector('#dateStrip .active').getBoundingClientRect();
        const node = document.querySelector('#dateStrip');
        return { visible:active.left >= strip.left - 1 && active.right <= strip.right + 1, strip, active, scrollLeft:node.scrollLeft, clientWidth:node.clientWidth, scrollWidth:node.scrollWidth, bound:node.dataset.resizeObserverBound };
      });
      assert.equal(activeState.visible, true, `${width}px: выбранная дата ушла из видимой области после смены ширины (${JSON.stringify(activeState)})`);
    }

    await page.setViewportSize({ width:390, height:900 });
    const movingEmphasis = await page.evaluate(async () => {
      const strip = document.querySelector('#dateStrip');
      const measure = () => [...strip.querySelectorAll('button')].map(button => ({
        active:button.classList.contains('active'),
        distance:button.dataset.dateDistance,
        width:button.getBoundingClientRect().width,
        height:button.getBoundingClientRect().height
      }));
      const before = measure();
      const next = strip.querySelectorAll('button')[72];
      strip.querySelector('.active').classList.remove('active');
      next.classList.add('active');
      updateDateStripEmphasis(strip);
      centerDateStripSelection(strip);
      await new Promise(resolve => setTimeout(resolve, 240));
      return { before, after:measure() };
    });
    const beforeActive = movingEmphasis.before.find(item => item.active);
    const afterActive = movingEmphasis.after.find(item => item.active);
    assert.equal(beforeActive.distance, '0', 'Выбранная дата не получила нулевую дистанцию');
    assert.equal(afterActive.distance, '0', 'Акцент не переехал на новую выбранную дату');
    assert.ok(afterActive.width > movingEmphasis.after.find(item => item.distance === '1').width, 'Выбранная дата не крупнее соседней');
    assert.ok(movingEmphasis.after.find(item => item.distance === '1').width > movingEmphasis.after.find(item => item.distance === '2').width, 'Ближайшая дата не крупнее дальней');
    assert.ok(movingEmphasis.after.find(item => item.distance === '2').width > movingEmphasis.after.find(item => item.distance === '3').width, 'Крайняя дата не слабее средней');

    for (const width of [390, 760]) {
      await page.setViewportSize({ width, height:900 });
      const transitions = await page.evaluate(async () => {
        const strip = document.querySelector('#dateStrip');
        const move = async step => {
          const buttons = [...strip.querySelectorAll('button')];
          const current = buttons.findIndex(button => button.classList.contains('active'));
          buttons[current].classList.remove('active');
          buttons[current + step].classList.add('active');
          updateDateStripEmphasis(strip);
          centerDateStripSelection(strip, { smooth:true });
          await new Promise(resolve => setTimeout(resolve, 280));
          centerDateStripSelection(strip, { smooth:true });
          await new Promise(resolve => setTimeout(resolve, 280));
          const active = strip.querySelector('.active').getBoundingClientRect();
          const viewport = strip.getBoundingClientRect();
          return {
            index:buttons.findIndex(button => button.classList.contains('active')),
            centerDelta:Math.abs((active.left + active.right) / 2 - (viewport.left + viewport.right) / 2),
            width:active.width,
            height:active.height
          };
        };
        const states=[];
        for (const step of [1, 1, 1, -1, -1]) states.push(await move(step));
        return {
          states,
          swipeForward:dateStripSwipeStep(280, 120, 190, 124),
          swipeBack:dateStripSwipeStep(120, 120, 210, 124),
          verticalIgnored:dateStripSwipeStep(200, 100, 190, 190)
        };
      });
      assert.equal(transitions.swipeForward, 1, `${width}px: свайп влево не выбирает следующий день`);
      assert.equal(transitions.swipeBack, -1, `${width}px: свайп вправо не выбирает предыдущий день`);
      assert.equal(transitions.verticalIgnored, 0, `${width}px: вертикальный жест ошибочно листает даты`);
      assert.ok(transitions.states.every(state => state.centerDelta <= 1.5), `${width}px: выбранная дата дёргается или не остаётся по центру (${JSON.stringify(transitions)})`);
      assert.ok(transitions.states.every(state => state.width >= 46 && state.width <= 56 && state.height >= 53 && state.height <= 55), `${width}px: размер выбранной даты меняется при последовательных переходах (${JSON.stringify(transitions)})`);
    }

    await page.evaluate(() => {
      window.$ = selector => document.querySelector(selector);
      window.$$ = selector => [...document.querySelectorAll(selector)];
      window.businessTodayIso = () => '2026-09-19';
      window.parseLocalIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T12:00:00`) : null;
      window.localIsoDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
      window.calendarRangeTitle = () => selectedDate === businessTodayIso()
        ? 'Сегодня'
        : parseLocalIsoDate(selectedDate).toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' });
      window.weekStartFor = value => {
        const result = new Date(value);
        result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
        return result;
      };
      window.currentFilter = 'day';
      window.calendarView = 'day';
      window.journalMode = 'timeline';
      window.teamCalendarController = null;
      window.updateCalendarViewControls = () => {};
      window.selectedDate = '2026-09-19';
      const strip = document.querySelector('#dateStrip');
      strip.replaceChildren();
      Object.keys(strip.dataset).forEach(key => delete strip.dataset[key]);
    });
    await page.addScriptTag({ content:selectedDateTitleHelper });
    await page.addScriptTag({ content:shiftScheduleDateHelper });

    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:900 });
      const weekArrows = await page.evaluate(() => {
        const originalSelect = window.selectScheduleDate;
        const destinations = [];
        window.selectScheduleDate = value => {
          destinations.push(value);
          selectedDate = value;
          document.querySelector('#scheduleDatePicker').value = value;
          renderDateStrip();
          renderSelectedDateTitle('day');
        };
        calendarView = 'day';
        selectedDate = '2026-12-29';
        shiftScheduleDate(1, { weekStep:innerWidth <= 760 });
        const forward = {
          selectedDate,
          activeDate:document.querySelector('#dateStrip .active')?.dataset.bookingDate,
          title:document.querySelector('#selectedDateTitle .selected-date-title-mobile')?.textContent
        };
        selectedDate = '2027-01-05';
        shiftScheduleDate(-1, { weekStep:innerWidth <= 760 });
        const back = {
          selectedDate,
          activeDate:document.querySelector('#dateStrip .active')?.dataset.bookingDate,
          title:document.querySelector('#selectedDateTitle .selected-date-title-mobile')?.textContent
        };
        window.selectScheduleDate = originalSelect;
        return { destinations, forward, back };
      });
      const stepDays = width <= 760 ? 7 : 1;
      const expectedForward = width <= 760 ? '2027-01-05' : '2026-12-30';
      const expectedBack = width <= 760 ? '2026-12-29' : '2027-01-04';
      assert.equal(weekArrows.forward.selectedDate, expectedForward, `${width}px: правая стрелка сместила дату не на ${stepDays} дней`);
      assert.equal(weekArrows.back.selectedDate, expectedBack, `${width}px: левая стрелка сместила дату не на ${stepDays} дней`);
      assert.equal(weekArrows.forward.activeDate, expectedForward, `${width}px: правая стрелка не обновила выбранную дату`);
      assert.equal(weekArrows.back.activeDate, expectedBack, `${width}px: левая стрелка не обновила выбранную дату`);
      assert.match(weekArrows.forward.title || '', /^[А-ЯЁ][а-яё]+$/, `${width}px: переход не обновил полный день недели`);
    }

    for (const width of [360, 390, 760]) {
      await page.setViewportSize({ width, height:900 });
      for (const theme of ['sage', 'midnight']) {
        const mobileCentering = await page.evaluate(async themeKey => {
          document.body.dataset.providerTheme = themeKey;
          const strip = document.querySelector('#dateStrip');
          const measure = () => {
            const buttons = [...strip.querySelectorAll('[data-booking-date]')];
            const active = strip.querySelector('[data-booking-date].active');
            const stripRect = strip.getBoundingClientRect();
            const activeRect = active?.getBoundingClientRect();
            const summary = document.querySelector('.schedule-title-line .dashboard-summary');
            const future = summary.querySelector('div:nth-of-type(3)');
            const futureStyle = getComputedStyle(future);
            const summaryStyle = getComputedStyle(summary);
            const futureLabel = getComputedStyle(future, '::before');
            const title = document.querySelector('#selectedDateTitle');
            const titleStyle = getComputedStyle(title);
            const visibleTitle = title.querySelector('.selected-date-title-mobile');
            const scheduleHeading = document.querySelector('.schedule-view-title h2').getBoundingClientRect();
            const action = document.querySelector('#newBookingButton').getBoundingClientRect();
            return {
              count:buttons.length,
              activeIndex:buttons.indexOf(active),
              activeDate:active?.dataset.bookingDate,
              picker:document.querySelector('#scheduleDatePicker').value,
              rangeStart:strip.dataset.rangeStart,
              rangeEnd:strip.dataset.rangeEnd,
              centerDelta:activeRect ? Math.abs((activeRect.left + activeRect.right - stripRect.left - stripRect.right) / 2) : 999,
              futureLabel:futureLabel.content,
              futureOverflow:futureStyle.overflow,
              summaryOverflow:summaryStyle.overflow,
              summaryBorder:[summaryStyle.borderTopWidth,summaryStyle.borderRightWidth,summaryStyle.borderBottomWidth,summaryStyle.borderLeftWidth],
              summaryOutline:summaryStyle.outlineStyle,
              summaryShadow:summaryStyle.boxShadow,
              summaryBackground:summaryStyle.backgroundColor,
              futurePaddingLeft:parseFloat(futureStyle.paddingLeft),
              futureLineHeight:parseFloat(futureLabel.lineHeight),
              futureLeft:future.getBoundingClientRect().left,
              summaryLeft:summary.getBoundingClientRect().left,
              futureBottom:future.getBoundingClientRect().bottom,
              summaryBottom:summary.getBoundingClientRect().bottom,
              tabsTop:document.querySelector('.date-navigation').getBoundingClientRect().top,
              headingBottom:scheduleHeading.bottom,
              summaryTop:summary.getBoundingClientRect().top,
              actionBottom:action.bottom,
              actionCenter:(action.top + action.bottom) / 2,
              summaryCenter:(summary.getBoundingClientRect().top + summary.getBoundingClientRect().bottom) / 2,
              titleText:visibleTitle?.textContent || title.textContent,
              titleTextOverflow:titleStyle.textOverflow,
              titleFits:title.scrollWidth <= title.clientWidth + 1,
              dayState:document.querySelector('#selectedDateSummary').textContent,
              overflow:document.documentElement.scrollWidth > innerWidth + 2
            };
          };
          selectedDate = '2026-09-19';
          renderDateStrip();
          document.querySelector('#selectedDateSummary').textContent = '1 запись · 2 перерыва';
          renderSelectedDateTitle('day');
          await new Promise(resolve => setTimeout(resolve, 820));
          const start = measure();
          selectedDate = '2026-10-06';
          renderDateStrip();
          document.querySelector('#selectedDateSummary').textContent = 'Свободный день';
          renderSelectedDateTitle('day');
          await new Promise(resolve => setTimeout(resolve, 820));
          const far = measure();
          selectedDate = '2026-09-19';
          renderDateStrip();
          document.querySelector('#selectedDateSummary').textContent = '1 запись · 2 перерыва';
          renderSelectedDateTitle('day');
          await new Promise(resolve => setTimeout(resolve, 820));
          const returned = measure();
          return { start, far, returned };
        }, theme);
        for (const [stateName, state] of Object.entries({ start:mobileCentering.start, far:mobileCentering.far, returned:mobileCentering.returned })) {
          assert.ok(state.count >= 200, `${theme} ${width}px ${stateName}: мобильной ленте не хватае запаса для сильного flick`);
          assert.equal(state.activeDate, state.picker, `${theme} ${width}px ${stateName}: календарь и активная дата рассинхронизированы`);
          assert.ok(state.centerDelta <= 2.5, `${theme} ${width}px ${stateName}: центр выбранной даты смещён на ${state.centerDelta}px`);
          assert.equal(state.overflow, false, `${theme} ${width}px ${stateName}: появился горизонтальный overflow`);
          assert.deepEqual(state.summaryBorder, ['0px','0px','0px','0px'], `${theme} ${width}px ${stateName}: у сводки осталась декоративная рамка`);
          assert.equal(state.summaryOutline, 'none', `${theme} ${width}px ${stateName}: у сводки осталась обводка`);
          assert.equal(state.summaryShadow, 'none', `${theme} ${width}px ${stateName}: у сводки осталась теневая обводка`);
          assert.equal(state.summaryBackground, 'rgba(0, 0, 0, 0)', `${theme} ${width}px ${stateName}: у сводки осталась цветная подложка`);
          assert.ok(state.futureBottom <= state.summaryBottom + 1, `${theme} ${width}px ${stateName}: строка «Всего впереди» вышла из сводки`);
          assert.ok(state.tabsTop - state.summaryBottom >= 8, `${theme} ${width}px ${stateName}: вкладки «День / Неделя» перекрывают сводку`);
          assert.ok(state.headingBottom <= state.summaryTop, `${theme} ${width}px ${stateName}: заголовок «Расписание» не поднят над сводкой`);
          assert.ok(Math.abs(state.actionCenter - state.summaryCenter) <= 2, `${theme} ${width}px ${stateName}: сводка и «Новая запись» не выровнены по центру`);
          assert.ok(state.tabsTop - Math.max(state.summaryBottom, state.actionBottom) >= 8, `${theme} ${width}px ${stateName}: вкладки заходят на кнопку или сводку`);
          assert.equal(state.titleFits, true, `${theme} ${width}px ${stateName}: полный день недели обрезан`);
          assert.equal(state.titleTextOverflow, 'clip', `${theme} ${width}px ${stateName}: заголовок вновь использует многоточие`);
          if (width <= 390) {
            assert.match(state.futureLabel, /Всего впереди/, `${theme} ${width}px ${stateName}: пропал полный мобильный лейбл «Всего впереди»`);
            assert.equal(state.futureOverflow, 'visible', `${theme} ${width}px ${stateName}: строка «Всего впереди» обрезается собственным контейнером`);
            assert.equal(state.summaryOverflow, 'visible', `${theme} ${width}px ${stateName}: строка «Всего впереди» обрезается сводкой`);
            assert.ok(state.futurePaddingLeft >= 2, `${theme} ${width}px ${stateName}: у первой буквы «В» нет безопасного отступа`);
            assert.ok(state.futureLineHeight >= 13, `${theme} ${width}px ${stateName}: строке «Всего впереди» не хватает высоты`);
            assert.ok(state.futureLeft >= state.summaryLeft, `${theme} ${width}px ${stateName}: строка «Всего впереди» ушла за левую границу сводки`);
          }
        }
        assert.equal(mobileCentering.far.activeDate, '2026-10-06', `${theme} ${width}px: дальний переход не выбрал 06.10`);
        assert.equal(mobileCentering.start.titleText, 'Суббота', `${theme} ${width}px: заголовок не показал полный день недели`);
        assert.equal(mobileCentering.start.dayState, '1 запись · 2 перерыва', `${theme} ${width}px: счётчики занятого дня потеряны`);
        assert.equal(mobileCentering.far.titleText, 'Вторник', `${theme} ${width}px: перелистывание не обновило день недели`);
        assert.equal(mobileCentering.far.dayState, 'Свободный день', `${theme} ${width}px: свободное состояние дня потеряно`);
        assert.ok(mobileCentering.far.rangeStart < mobileCentering.far.activeDate && mobileCentering.far.activeDate < mobileCentering.far.rangeEnd, `${theme} ${width}px: сильному flick некуда двигаться`);
        assert.equal(mobileCentering.returned.activeDate, '2026-09-19', `${theme} ${width}px: возврат к сегодня не сработал`);
      }
    }

    for (const width of [390, 760]) {
      await page.setViewportSize({ width, height:900 });
      const inertialSelection = await page.evaluate(async () => {
        selectedDate = '2026-12-29';
        renderDateStrip({ forceCenter:true });
        await new Promise(resolve => setTimeout(resolve, 520));
        const strip = document.querySelector('#dateStrip');
        const originalSelect = window.selectScheduleDate;
        const selected = [];
        window.selectScheduleDate = value => {
          selected.push(value);
          selectedDate = value;
          renderDateStrip();
          renderSelectedDateTitle('day');
        };
        const settleAt = async offset => {
          const buttons = [...strip.querySelectorAll('[data-booking-date]')];
          const activeIndex = buttons.findIndex(button => button.dataset.bookingDate === selectedDate);
          const target = buttons[Math.max(0, Math.min(buttons.length - 1, activeIndex + offset))];
          const stripRect = strip.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          strip.dataset.programmaticCenterUntil = '0';
          strip.scrollLeft += (targetRect.left + targetRect.right - stripRect.left - stripRect.right) / 2;
          strip.dispatchEvent(new Event('scroll'));
          await new Promise(resolve => setTimeout(resolve, 240));
          await new Promise(resolve => setTimeout(resolve, 520));
          return { date:selectedDate, active:strip.querySelector('.active')?.dataset.bookingDate };
        };
        const weak = await settleAt(2);
        const medium = await settleAt(8);
        const strong = await settleAt(18);
        const beforeRepeat = selected.length;
        strip.dataset.programmaticCenterUntil = '0';
        strip.style.scrollBehavior = 'auto';
        strip.scrollLeft -= 5 * 42;
        strip.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => setTimeout(resolve, 60));
        strip.scrollLeft -= 7 * 42;
        strip.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => setTimeout(resolve, 760));
        strip.style.removeProperty('scroll-behavior');
        const repeatedCalls = selected.length - beforeRepeat;
        window.selectScheduleDate = originalSelect;
        return { weak, medium, strong, repeatedCalls, selected };
      });
      assert.equal(inertialSelection.weak.date, '2026-12-31', `${width}px: слабый жест не выбрал ближайшую дату`);
      assert.ok(inertialSelection.medium.date > inertialSelection.weak.date, `${width}px: средний flick не пролистал дальше слабого`);
      assert.ok(inertialSelection.strong.date > inertialSelection.medium.date, `${width}px: сильный flick не пролистал дальше недели`);
      assert.equal(inertialSelection.strong.active, inertialSelection.strong.date, `${width}px: финальная дата не центрирована`);
      assert.equal(inertialSelection.repeatedCalls, 1, `${width}px: повторный жест во время замедления вызвал несколько загрузок`);
    }

    await page.emulateMedia({ reducedMotion:'reduce' });
    const reducedMotionAnimation = await page.evaluate(() => {
      selectedDate = '2026-09-20';
      renderDateStrip();
      return document.querySelector('#dateStrip').getAnimations().some(animation => animation.playState === 'running');
    });
    assert.equal(reducedMotionAnimation, false, 'prefers-reduced-motion должен отключать анимацию перестройки дат');
    await page.emulateMedia({ reducedMotion:'no-preference' });

    for (const width of [360, 390, 760]) {
      await page.setViewportSize({ width, height:900 });
      for (const timelineHeight of [144, 720]) {
        const tail = await page.evaluate(height => {
          const bookings = document.querySelector('#providerBookings');
          bookings.className = 'provider-bookings timeline-view';
          bookings.innerHTML = `<div class="day-timeline" style="--timeline-height:${height}px"><div class="timeline-hours"></div><div class="timeline-stage" style="--timeline-height:${height}px"><button class="timeline-booking status-confirmed" style="top:${height - 72}px;height:68px"><span class="timeline-booking-time"><b>19:00</b><small>–20:00</small></span><span class="timeline-booking-copy"><strong>Последняя запись</strong></span></button></div></div>`;
          const stage = bookings.querySelector('.timeline-stage').getBoundingClientRect();
          const card = bookings.querySelector('.timeline-booking').getBoundingClientRect();
          const holder = bookings.getBoundingClientRect();
          const scheduleWorkspace = document.querySelector('.schedule-workspace').getBoundingClientRect();
          const providerView = document.querySelector('[data-provider-panel="bookings"]').getBoundingClientRect();
          const providerWorkspace = document.querySelector('.provider-workspace').getBoundingClientRect();
          const dashboard = document.querySelector('#dashboard').getBoundingClientRect();
          const clearance = parseFloat(getComputedStyle(document.body).getPropertyValue('--provider-mobile-nav-clearance')) || 80;
          return {
            holderTail:holder.bottom - stage.bottom,
            documentTail:document.documentElement.scrollHeight - stage.bottom,
            scrollHeight:document.documentElement.scrollHeight,
            viewportHeight:innerHeight,
            scheduleWorkspaceTail:scheduleWorkspace.bottom - stage.bottom,
            providerViewTail:providerView.bottom - stage.bottom,
            providerWorkspaceTail:providerWorkspace.bottom - stage.bottom,
            dashboardTail:dashboard.bottom - stage.bottom,
            clearance,
            cardInside:card.bottom <= stage.bottom + 1,
            overflow:document.documentElement.scrollWidth > innerWidth + 2
          };
        }, timelineHeight);
        assert.ok(tail.holderTail <= 20, `${width}px ${timelineHeight}px: внутри расписания остался пустой хвост ${tail.holderTail}px`);
        assert.ok(tail.scrollHeight <= Math.max(tail.viewportHeight, tail.scrollHeight - tail.documentTail + tail.clearance + 36), `${width}px ${timelineHeight}px: после расписания осталось лишних ${JSON.stringify(tail)}`);
        assert.equal(tail.cardInside, true, `${width}px ${timelineHeight}px: последняя карточка обрезана`);
        assert.equal(tail.overflow, false, `${width}px ${timelineHeight}px: появился горизонтальный overflow`);
      }
    }

    const alternateView = await page.evaluate(() => {
      document.querySelector('[data-calendar-view="day"]')?.classList.remove('active');
      document.querySelector('[data-calendar-view="week"]')?.classList.add('active');
      document.querySelector('#dateStrip').hidden = true;
      return {
        topControlsHidden:[...document.querySelectorAll('.date-navigation>.date-nav-button')].every(button => getComputedStyle(button).display === 'none'),
        stripControlsHidden:getComputedStyle(document.querySelector('.date-strip-frame')).display === 'none'
      };
    });
    assert.equal(alternateView.topControlsHidden, true, 'В режиме недели верхние дублирующие стрелки должны быть скрыты');
    assert.equal(alternateView.stripControlsHidden, true, 'Стрелки скрытой дневной ленты не должны оставаться на экране');

    await page.setViewportSize({ width:1440, height:900 });
    const splitView = await page.evaluate(() => {
      document.body.dataset.providerLayout = 'split';
      document.querySelector('[data-calendar-view="week"]')?.classList.remove('active');
      document.querySelector('[data-calendar-view="day"]')?.classList.add('active');
      document.querySelector('#dateStrip').hidden = false;
      const schedule = getComputedStyle(document.querySelector('.schedule-card'));
      const context = getComputedStyle(document.querySelector('.schedule-context'));
      return { scheduleBorder:schedule.borderTopWidth, contextBorder:context.borderTopWidth };
    });
    assert.equal(splitView.scheduleBorder, '0px', 'Разделённой компоновке не нужна третья внешняя рамка');
    assert.notEqual(splitView.contextBorder, '0px', 'Контекст разделённой компоновки должен остаться отдельной панелью');

    await page.evaluate(() => {
      document.body.dataset.providerLayout = 'soft';
      if (!document.querySelector('#dateStrip>button.active')) document.querySelector('#dateStrip>button')?.classList.add('active');
      const fixtureStyle = document.createElement('style');
      fixtureStyle.textContent = '#scheduleThemeFixture,#scheduleThemeFixture *,#weeklyReadabilityFixture,#weeklyReadabilityFixture *{transition:none!important;animation:none!important}#scheduleThemeFixture>.timeline-view{display:block!important}#scheduleThemeFixture>.timeline-view,#scheduleThemeFixture>.calendar-overview-booking,#scheduleThemeFixture>.calendar-week-booking{position:absolute!important;left:-9999px!important}#weeklyReadabilityFixture{position:fixed;left:-9999px;top:0;width:127px;height:62px}#weeklyReadabilityFixture>.calendar-week-booking{position:relative!important;inset:auto!important;width:127px;height:62px}';
      document.head.append(fixtureStyle);
      const fixture = document.createElement('div');
      fixture.id = 'scheduleThemeFixture';
      fixture.innerHTML = `
        <div class="timeline-view">
          <button class="timeline-booking status-confirmed color-sage" style="--booking-tone:#00ff00"><span class="timeline-booking-copy"><strong>Запись</strong></span></button>
          <button class="timeline-booking status-block automatic-break"><span class="timeline-booking-copy"><strong>Перерыв</strong></span></button>
        </div>
        <div class="schedule-list">
          <article class="provider-booking status-confirmed color-sage" style="--booking-tone:#00ff00"><h3>Запись</h3></article>
          <article class="provider-booking status-block automatic-break"><h3>Перерыв</h3></article>
        </div>
        <button class="calendar-overview-booking status-confirmed color-auto" style="--booking-tone:#00ff00"><strong>Запись</strong></button>
        <button class="calendar-overview-booking status-block"><strong>Перерыв</strong></button>
        <button class="calendar-week-booking status-confirmed color-sage" style="--booking-tone:#00ff00"><strong>Запись</strong></button>
        <button class="calendar-week-booking is-block status-block"><strong>Перерыв</strong></button>`;
      const bookings = document.querySelector('#providerBookings');
      bookings.classList.add('calendar-overview', 'calendar-overview-month');
      bookings.replaceChildren(fixture);
      const readability = document.createElement('div');
      readability.id = 'weeklyReadabilityFixture';
      readability.innerHTML = '<button class="calendar-week-booking status-confirmed color-auto"><time>14:00–15:00</time><strong>Массаж спины + ШВЗ — углублённый (с акцентом на проблемные зоны) — 60 мин</strong><small>Константин</small></button>';
      document.body.append(readability);
    });

    for (const width of [360, 390, 760, 1440]) {
      await page.setViewportSize({ width, height:900 });
      for (const textScale of ['default', 'comfortable', 'large']) {
        const readability = await page.evaluate(scale => {
          document.body.dataset.providerTextScale = scale;
          const card = document.querySelector('#weeklyReadabilityFixture>.calendar-week-booking');
          const rows = [...card.children];
          const cardRect = card.getBoundingClientRect();
          const cardStyle = getComputedStyle(card);
          const geometry = rows.map(row => {
            const rect = row.getBoundingClientRect();
            const style = getComputedStyle(row);
            return {
              top:rect.top,
              bottom:rect.bottom,
              height:rect.height,
              lineHeight:parseFloat(style.lineHeight),
              flexShrink:style.flexShrink,
              lineClamp:style.webkitLineClamp
            };
          });
          return {
            cardBottom:cardRect.bottom - parseFloat(cardStyle.borderBottomWidth) - parseFloat(cardStyle.paddingBottom),
            geometry
          };
        }, textScale);
        const [time, title, client] = readability.geometry;
        const titleLines = textScale === 'default' ? 2 : 1;
        assert.equal(time.flexShrink, '0', `${width}px ${textScale}: время сжимается по высоте`);
        assert.equal(title.flexShrink, '0', `${width}px ${textScale}: название сжимается по высоте`);
        assert.equal(client.flexShrink, '0', `${width}px ${textScale}: имя клиента сжимается по высоте`);
        assert.ok(title.height + .5 >= title.lineHeight * titleLines, `${width}px ${textScale}: строка услуги обрезается по высоте`);
        assert.equal(title.lineClamp, String(titleLines), `${width}px ${textScale}: неверное число строк услуги`);
        assert.ok(time.bottom <= title.top + .5 && title.bottom <= client.top + .5, `${width}px ${textScale}: строки недельной записи перекрываются`);
        assert.ok(client.bottom <= readability.cardBottom + .5, `${width}px ${textScale}: имя клиента выходит за карточку`);
      }
      for (const theme of themeKeys) {
        const cards = await page.evaluate(themeKey => {
          document.body.dataset.providerTheme = themeKey;
          const fixture = document.querySelector('#scheduleThemeFixture');
          const normals = [...fixture.querySelectorAll('.timeline-booking:not(.status-block),.provider-booking:not(.status-block),.calendar-overview-booking:not(.status-block),.calendar-week-booking:not(.is-block)')];
          const rests = [...fixture.querySelectorAll('.timeline-booking.status-block,.provider-booking.status-block,.calendar-overview-booking.status-block,.calendar-week-booking.is-block')];
          const activeDate = getComputedStyle(document.querySelector('#dateStrip>button[aria-pressed="true"]'));
          const activeTab = document.querySelector('.calendar-view-toggle button.active');
          const activeTabStyle = getComputedStyle(activeTab);
          const activeTabMarker = getComputedStyle(activeTab, '::after');
          const summaryStrong = getComputedStyle(document.querySelector('.dashboard-summary strong'));
          const colorCanvas = document.createElement('canvas');
          colorCanvas.width = colorCanvas.height = 1;
          const colorContext = colorCanvas.getContext('2d', { willReadFrequently:true });
          const rgb = value => {
            colorContext.clearRect(0, 0, 1, 1);
            colorContext.fillStyle = value;
            colorContext.fillRect(0, 0, 1, 1);
            return [...colorContext.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const luminance = value => {
            const channels = rgb(value).map(channel => {
              const normalized = channel / 255;
              return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
            });
            return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
          };
          const contrast = (foreground, background) => {
            const first = luminance(foreground), second = luminance(background);
            return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
          };
          const themeSurface = getComputedStyle(document.body).getPropertyValue('--theme-surface').trim();
          const normal = normals.map(node => {
            const style = getComputedStyle(node);
            return { background:style.backgroundColor, borderColor:style.borderColor, image:style.backgroundImage, shadow:style.boxShadow, contrast:contrast(style.color, style.backgroundColor), surfaceContrast:contrast(style.backgroundColor, themeSurface) };
          });
          const rest = rests.map(node => {
            const style = getComputedStyle(node);
            return { background:style.backgroundColor, image:style.backgroundImage, shadow:style.boxShadow, contrast:contrast(style.color, style.backgroundColor) };
          });
          const restIcon = getComputedStyle(fixture.querySelector('.timeline-booking.status-block strong'), '::before');
          const monthProbe = document.createElement('span');
          monthProbe.style.background = 'color-mix(in srgb,var(--theme-surface) 90%,var(--theme-ink))';
          fixture.append(monthProbe);
          const monthAutoBackground = getComputedStyle(monthProbe).backgroundColor;
          monthProbe.remove();
          const accentProbe = document.createElement('span');
          accentProbe.style.background = 'color-mix(in srgb,var(--theme-accent) var(--schedule-entry-fill-weight),var(--theme-surface))';
          accentProbe.style.border = '1px solid color-mix(in srgb,var(--theme-accent) var(--schedule-entry-border-weight),var(--theme-line))';
          fixture.append(accentProbe);
          const accentProbeStyle = getComputedStyle(accentProbe);
          const accentBackground = accentProbeStyle.backgroundColor;
          const accentBorderColor = accentProbeStyle.borderColor;
          accentProbe.remove();
          const themeAccentProbe = document.createElement('span');
          themeAccentProbe.style.background = 'var(--theme-accent)';
          fixture.append(themeAccentProbe);
          const themeAccent = getComputedStyle(themeAccentProbe).backgroundColor;
          themeAccentProbe.remove();
          return {
            normal,
            rest,
            activeDateBackground:activeDate.backgroundColor,
            activeTabColor:activeTabStyle.color,
            activeTabMarker:activeTabMarker.backgroundColor,
            summaryStrongColor:summaryStrong.color,
            themeAccent,
            accentBackground,
            accentBorderColor,
            monthAutoBackground,
            restIconContent:restIcon.content,
            restIconImage:restIcon.backgroundImage,
            restIconShadow:restIcon.boxShadow,
            overflow:document.documentElement.scrollWidth > innerWidth + 2
          };
        }, theme);
        assert.equal(cards.normal.length, 4, `${theme} ${width}px: проверены не все режимы записей`);
        assert.equal(cards.rest.length, 4, `${theme} ${width}px: проверены не все режимы перерывов`);
        if (width <= 760) {
          assert.equal(cards.activeTabColor, cards.themeAccent, `${theme} ${width}px: активная вкладка не использует акцент темы`);
          assert.equal(cards.activeTabMarker, cards.themeAccent, `${theme} ${width}px: линия активной вкладки не использует акцент темы`);
          assert.equal(cards.summaryStrongColor, cards.themeAccent, `${theme} ${width}px: цифры сводки не используют акцент темы`);
        }
        cards.normal.forEach((card, index) => {
          assert.equal(card.image, 'none', `${theme} ${width}px: лишний рисунок у записи ${index + 1}`);
          assert.ok(card.contrast >= 4.5, `${theme} ${width}px: низкий контраст записи ${index + 1} (${card.contrast.toFixed(2)})`);
          if (index === 2) {
            assert.equal(card.background, cards.monthAutoBackground, `${theme} ${width}px: компактная месячная запись потеряла нейтральный фон`);
            assert.equal(card.shadow, 'none', `${theme} ${width}px: месячная запись получила лишнюю постоянную тень`);
          } else if (width > 760 && index === 0) {
            assert.equal(card.shadow, 'none', `${theme} ${width}px: ПК-записи не нужна декоративная тень`);
            assert.ok(card.surfaceContrast >= 1.04, `${theme} ${width}px: ПК-запись сливается с поверхностью (${card.surfaceContrast.toFixed(2)})`);
          } else {
            assert.equal(card.background, cards.accentBackground, `${theme} ${width}px: запись ${index + 1} не использует акцент выбранной темы`);
            assert.equal(card.borderColor, cards.accentBorderColor, `${theme} ${width}px: рамка записи ${index + 1} не использует акцент выбранной темы`);
            assert.match(card.shadow, /inset/, `${theme} ${width}px: нет акцента выбранной темы у записи ${index + 1}`);
            assert.ok(card.surfaceContrast >= 1.04, `${theme} ${width}px: запись ${index + 1} сливается с поверхностью (${card.surfaceContrast.toFixed(2)})`);
          }
          assert.notEqual(card.background, cards.activeDateBackground, `${theme} ${width}px: запись конкурирует с выбранной датой`);
        });
        cards.rest.forEach((card, index) => {
          assert.equal(card.image, 'none', `${theme} ${width}px: у перерыва ${index + 1} остались полосы`);
          assert.equal(card.shadow, 'none', `${theme} ${width}px: перерыв ${index + 1} не должен быть акцентным`);
          assert.ok(card.contrast >= 4.5, `${theme} ${width}px: низкий контраст перерыва ${index + 1} (${card.contrast.toFixed(2)})`);
        });
        assert.notEqual(cards.normal[0].background, cards.rest[0].background, `${theme} ${width}px: запись и перерыв не различаются`);
        assert.equal(cards.restIconContent, '""', `${theme} ${width}px: у перерыва нет значка паузы`);
        if (width > 760) {
          assert.equal(cards.restIconImage, 'none', `${theme} ${width}px: ПК-значок паузы должен быть сплошным`);
          assert.notEqual(cards.restIconShadow, 'none', `${theme} ${width}px: вторая полоса ПК-значка паузы не отображается`);
        } else assert.notEqual(cards.restIconImage, 'none', `${theme} ${width}px: значок паузы не отображается`);
        assert.equal(cards.overflow, false, `${theme} ${width}px: появился горизонтальный overflow`);
      }
    }

    if (output) {
      await page.evaluate(() => {
        document.body.dataset.providerLayout = 'soft';
        document.querySelector('#bookingSheet').hidden = true;
      });
      for (const theme of ['sage','graphite','midnight','butter','snow-leopard','noir-safari','oled-mono','volt-graphite']) {
        await page.evaluate(themeKey => { document.body.dataset.providerTheme = themeKey; }, theme);
        for (const width of [360, 390, 760, 1440]) {
          await page.setViewportSize({ width, height:900 });
          await page.screenshot({ path:path.join(output, `${theme}-soft-${width}.png`), fullPage:false });
        }
      }
    }
    console.log(`Provider schedule theme matrix: ${themeKeys.length} themes × 360/390/760/1440px OK`);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
