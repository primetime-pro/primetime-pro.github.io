import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const worker = read('sw.js');
const provider = read('provider.js');
const config = read('config.js');

assert.match(index, /<title>PrimeTime Pro — кабинет исполнителя<\/title>/);
assert.match(index, /apple-mobile-web-app-title" content="PrimeTime Pro"/);
assert.match(index, /manifest\.webmanifest\?v=5/);
assert.doesNotMatch(index, /href="index\.html"/);
assert.equal(manifest.id, './');
assert.equal(manifest.start_url, './');
assert.equal(manifest.name, 'PrimeTime Pro');
assert.equal(manifest.short_name, 'PrimeTime Pro');
assert.match(worker, /CACHE_PREFIX = 'primetime-pro-'/);
assert.match(worker, /CACHE = `\$\{CACHE_PREFIX\}v5`/);
assert.match(index, /provider-ux\.css\?v=5/);
assert.match(index, /site-update\.js\?v=5/);
assert.match(index, /provider\.js\?v=5/);
assert.match(index, /class="provider-view mobile-more-overlay" data-provider-panel="more"/);
assert.match(worker, /provider-ux\.css\?v=5/);
assert.match(worker, /site-update\.js\?v=5/);
assert.match(worker, /provider\.js\?v=5/);
assert.match(worker, /manifest\.webmanifest\?v=5/);
assert.match(worker, /provider-feature-assets\.js\?v=5/);
assert.match(index, /id="todayBookingsLabel">сегодня</);
assert.match(index, /id="tomorrowBookingsLabel">завтра</);
assert.match(index, /id="upcomingBookingsLabel">впереди</);
assert.doesNotMatch(read('provider-schedule-minimal.css'), /--schedule-action-accent\s*:\s*#0d805c/i);
assert.match(read('provider-schedule-minimal.css'), /--schedule-active-color:#0d805c/);
assert.match(read('provider-schedule-minimal.css'), /background:var\(--schedule-active-color\)!important/);
assert.match(provider, /scheduleCreateHintVisible[\s\S]*localStorage\.setItem\(scheduleCreateHintStorageKey\(userId\), 'dismissed'\)/);
assert.match(provider, /dismissScheduleCreateHint\(\);[\s\S]*openTimelineBookingAtTime/);
assert.match(index, /https:\/\/primetime-booking\.github\.io\//);
assert.doesNotMatch(index, /anatomy-trainer\/minuta-online-booking/);
assert.match(provider, /new URL\('https:\/\/primetime-booking\.github\.io\/'\)/);
assert.match(provider, /function openProviderMobileMore\(/);
assert.match(provider, /function dismissProviderMobileMore\(/);
assert.match(provider, /providerMobileMoreHistoryDismissed/);
assert.doesNotMatch(worker, /provider\.html|massage-izhevsk/);
assert.doesNotMatch(provider, /provider\.html/);
assert.match(provider, /function dateStripSwipeStep/);
assert.doesNotMatch(provider, /timelineFullDay/);
assert.doesNotMatch(config, /service.?role|private.?key/i);

const localReferences = [...index.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"#]*)?(?:#[^"]*)?"/g)]
  .map(match => match[1])
  .filter(value => !/^(?:https?:|tel:|\.\/$)/.test(value));
for (const reference of localReferences) {
  assert.ok(fs.existsSync(path.join(root, reference)), `Missing index asset: ${reference}`);
}

const workerReferences = [...worker.matchAll(/'\.\/([^'?]+)(?:\?[^']*)?'/g)].map(match => match[1]);
for (const reference of workerReferences) {
  assert.ok(fs.existsSync(path.join(root, reference)), `Missing worker asset: ${reference}`);
}

console.log('PrimeTime Pro independent site: OK');
