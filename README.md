# PrimeTime Pro

Независимый кабинет исполнителя PrimeTime Pro для публикации на `https://primetime-pro.github.io/`.

- Публичный клиентский PrimeTime остаётся на прежнем сайте и открывается из кабинета по внешней ссылке.
- Кабинет использует общий Supabase backend только через публичный publishable key и действующие серверные права.
- PWA имеет собственные manifest, service worker, cache namespace и GitHub Pages workflow.

Проверка перед выпуском:

```bash
node verify-site.mjs
```
