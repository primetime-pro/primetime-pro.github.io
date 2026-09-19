const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = __dirname;
const output = process.env.MINUTA_DESKTOP_SCHEDULE_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
  response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  response.end(content);
});

function timelineMarkup() {
  const labels = [];
  const lines = [];
  for (let index = 0; index <= 17; index += 1) {
    const hour = 10 + Math.floor(index / 2);
    const minute = index % 2 ? '30' : '00';
    labels.push(`<span class="timeline-hour${minute === '30' ? ' timeline-half-hour' : ''}" style="top:${index * 38}px">${String(hour).padStart(2, '0')}:${minute}</span>`);
    if (minute === '00') lines.push(`<i class="timeline-grid-line" style="top:${index * 38}px"></i>`);
  }
  return `<div class="day-timeline" style="--timeline-height:684px;--half-hour-offset:38px">
    <div class="timeline-hours">${labels.join('')}</div>
    <div class="timeline-stage" style="--timeline-height:684px">
      ${lines.join('')}
      <button class="timeline-booking status-confirmed color-auto" style="top:458px;height:72px"><span class="timeline-booking-time"><b>16:00</b><small>–17:00</small></span><span class="timeline-booking-copy"><strong>Массаж спины + ШВЗ — углублённый <span class="timeline-service-duration">· 60 мин</span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-client-name">Марина</span><span class="timeline-client-visit-wrap"> · <span class="timeline-client-visit">Постоянный · 2-й визит</span></span></small></span></span><span class="timeline-booking-status">Подтверждена</span></button>
      <button class="timeline-booking status-block automatic-break" style="top:382px;height:72px"><span class="timeline-booking-time"><b>15:00</b><small>–16:00</small></span><span class="timeline-booking-copy"><strong>Автоперерыв<span class="timeline-automatic-break-source">Автоматический · из правил записи</span></strong></span></button>
      <button class="timeline-booking status-block" style="top:534px;height:72px"><span class="timeline-booking-time"><b>17:00</b><small>–18:00</small></span><span class="timeline-booking-copy"><strong>Перерыв</strong></span></button>
    </div>
  </div>`;
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
    const page = await browser.newPage({ viewport:{ width:1440, height:1080 }, deviceScaleFactor:1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.evaluate(markup => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      const dashboard = document.querySelector('#dashboard');
      dashboard.hidden = false;
      dashboard.dataset.activeView = 'bookings';
      document.body.dataset.providerTheme = 'sage';
      document.body.dataset.providerLayout = 'soft';
      document.body.dataset.providerTextScale = 'default';
      document.querySelector('#providerBusinessName').textContent = 'Массаж в Ижевске';
      document.querySelector('#todayLabel').textContent = 'Суббота, 19 сентября';
      document.querySelector('#currentTimeLabel').textContent = '20:41:14';
      document.querySelector('#syncState').className = 'sync-state';
      document.querySelector('#syncState span').textContent = 'Синхронизировано';
      document.querySelector('#syncVerifiedAt').textContent = 'Сверено сегодня в 12:56';
      document.querySelector('#todayBookingsCount').textContent = '1';
      document.querySelector('#tomorrowBookingsCount').textContent = '0';
      document.querySelector('#newBookingsCount').textContent = '3';
      document.querySelector('#selectedDateTitle').textContent = 'Сегодня';
      document.querySelector('#selectedDateSummary').textContent = '1 запись · 2 перерыва';
      const strip = document.querySelector('#dateStrip');
      strip.innerHTML = ['Ср|16','Чт|17','Пт|18','Сегодня|19','Вс|20','Пн|21','Вт|22'].map((value, index) => {
        const [day, number] = value.split('|');
        return `<button class="${index === 3 ? 'active' : ''}" data-booking-date="2026-09-${number}" data-date-distance="${Math.abs(index - 3)}"><span>${day}</span><strong>${number}</strong><small>сент</small></button>`;
      }).join('');
      const holder = document.querySelector('#providerBookings');
      holder.className = 'provider-bookings timeline-view';
      holder.innerHTML = markup;
      document.querySelector('#bookingDemoNotice').hidden = true;
      document.querySelector('#providerDayFocus').hidden = true;
    }, timelineMarkup());
    await page.waitForTimeout(250);

    for (const theme of ['sage', 'midnight']) {
      await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
      const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const style = selector => getComputedStyle(document.querySelector(selector));
        const sidebar = box('.provider-sidebar');
        const workspace = box('.provider-workspace');
        const brand = box('.provider-product-signature-link');
        const active = style('.provider-nav button.active');
        const activeDate = style('#dateStrip>button.active');
        const booking = style('.timeline-booking:not(.status-block)');
        const breakIcon = getComputedStyle(document.querySelector('.timeline-booking.status-block .timeline-booking-copy>strong'), '::before');
        const visit = style('.timeline-client-visit');
        const name = style('.timeline-client-name');
        return {
          sidebarWidth:sidebar.width,
          sidebarRadius:style('.provider-sidebar').borderRadius,
          shellGap:workspace.left - sidebar.right,
          brandCenterDelta:Math.abs((brand.left + brand.right - sidebar.left - sidebar.right) / 2),
          businessDisplay:style('.provider-business-name-action').display,
          topbarHeight:box('.provider-topbar').height,
          activeBackground:active.backgroundColor,
          activeImage:active.backgroundImage,
          activeDateBackground:activeDate.backgroundColor,
          titleBorderRadius:style('.schedule-view-title').borderRadius,
          summaryBorder:style('.dashboard-summary').borderTopWidth,
          bookingImage:booking.backgroundImage,
          bookingRadius:booking.borderRadius,
          breakIconImage:breakIcon.backgroundImage,
          breakIconShadow:breakIcon.boxShadow,
          visitBackground:visit.backgroundColor,
          visitBorder:visit.borderTopWidth,
          visitWeight:visit.fontWeight,
          nameWeight:name.fontWeight,
          overflow:document.documentElement.scrollWidth > innerWidth + 2
        };
      });
      assert.equal(Math.round(geometry.sidebarWidth), 220, `${theme}: ширина сайдбара`);
      assert.equal(geometry.sidebarRadius, '30px', `${theme}: радиус сайдбара`);
      assert.ok(geometry.shellGap >= 72, `${theme}: нет адаптивного воздуха перед рабочей областью`);
      assert.ok(geometry.brandCenterDelta <= 1, `${theme}: PrimeTime Pro не центрирован`);
      assert.equal(geometry.businessDisplay, 'none', `${theme}: название бизнеса не убрано`);
      assert.equal(Math.round(geometry.topbarHeight), 58, `${theme}: верхняя строка некомпактна`);
      assert.equal(geometry.activeBackground, 'rgb(18, 147, 95)', `${theme}: активное меню не сплошное зелёное`);
      assert.equal(geometry.activeDateBackground, 'rgb(18, 147, 95)', `${theme}: дата не сплошная зелёная`);
      assert.equal(geometry.activeImage, 'none', `${theme}: у активного меню остался градиент`);
      assert.equal(geometry.titleBorderRadius, '0px', `${theme}: заголовок остался отдельной карточкой`);
      assert.equal(geometry.summaryBorder, '0px', `${theme}: сводка осталась плашкой`);
      assert.equal(geometry.bookingImage, 'none', `${theme}: у записи остался градиент`);
      assert.equal(geometry.bookingRadius, '16px', `${theme}: неверный радиус записи`);
      assert.equal(geometry.breakIconImage, 'none', `${theme}: значок паузы не сплошной`);
      assert.notEqual(geometry.breakIconShadow, 'none', `${theme}: у значка паузы нет второй полосы`);
      assert.equal(geometry.visitBackground, 'rgba(0, 0, 0, 0)', `${theme}: визит остался плашкой`);
      assert.equal(geometry.visitBorder, '0px', `${theme}: у визита осталась рамка`);
      assert.ok(Number(geometry.nameWeight) > Number(geometry.visitWeight), `${theme}: имя клиента не отделено по весу`);
      assert.equal(geometry.overflow, false, `${theme}: горизонтальный overflow`);
      if (output) await page.screenshot({ path:path.join(output, `desktop-${theme}-1440.png`), fullPage:true });
    }
    console.log('Provider desktop reference: sage/midnight × 1440px OK');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
