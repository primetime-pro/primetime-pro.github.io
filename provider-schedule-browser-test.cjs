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
const helperEnd = providerSource.indexOf('function renderDateStrip()', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Помощники адаптивной ленты дат не найдены');
const dateStripResizeHelpers = providerSource.slice(helperStart, helperEnd);
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
        assert.equal(result.stripScrollable, true, `${width}px: лента дат не прокручивается`);
        assert.equal(result.stripOverflowX, 'auto', `${width}px: горизонтальная прокрутка ленты отключена`);
        assert.match(result.stripTouchAction, /pan-x/, `${width}px: горизонтальный жест ленты перехватывается`);
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
      assert.ok(transitions.states.every(state => state.width >= 46 && state.width <= 56 && state.height >= 57 && state.height <= 59), `${width}px: размер выбранной даты меняется при последовательных переходах (${JSON.stringify(transitions)})`);
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
      document.querySelector('#dateStrip>button')?.classList.add('active');
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
          const activeDate = getComputedStyle(document.querySelector('#dateStrip>button.active'));
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
          return {
            normal,
            rest,
            activeDateBackground:activeDate.backgroundColor,
            accentBackground,
            accentBorderColor,
            monthAutoBackground,
            restIconContent:restIcon.content,
            restIconImage:restIcon.backgroundImage,
            overflow:document.documentElement.scrollWidth > innerWidth + 2
          };
        }, theme);
        assert.equal(cards.normal.length, 4, `${theme} ${width}px: проверены не все режимы записей`);
        assert.equal(cards.rest.length, 4, `${theme} ${width}px: проверены не все режимы перерывов`);
        cards.normal.forEach((card, index) => {
          assert.equal(card.image, 'none', `${theme} ${width}px: лишний рисунок у записи ${index + 1}`);
          assert.ok(card.contrast >= 4.5, `${theme} ${width}px: низкий контраст записи ${index + 1} (${card.contrast.toFixed(2)})`);
          if (index === 2) {
            assert.equal(card.background, cards.monthAutoBackground, `${theme} ${width}px: компактная месячная запись потеряла нейтральный фон`);
            assert.equal(card.shadow, 'none', `${theme} ${width}px: месячная запись получила лишнюю постоянную тень`);
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
        assert.notEqual(cards.restIconImage, 'none', `${theme} ${width}px: значок паузы не отображается`);
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
