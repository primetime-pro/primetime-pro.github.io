(function () {
  const articles = Array.isArray(window.MINUTA_HELP_ARTICLES) ? window.MINUTA_HELP_ARTICLES : [];
  const categories = Array.isArray(window.MINUTA_HELP_CATEGORIES) ? window.MINUTA_HELP_CATEGORIES : [];
  const slug = new URLSearchParams(location.search).get('category') || '';
  const category = categories.find(item => item.slug === slug);

  const pluralize = (count, forms) => {
    const remainder100 = count % 100;
    const remainder10 = count % 10;
    if (remainder100 >= 11 && remainder100 <= 19) return forms[2];
    if (remainder10 === 1) return forms[0];
    if (remainder10 >= 2 && remainder10 <= 4) return forms[1];
    return forms[2];
  };

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };

  if (!category) {
    document.title = 'Раздел не найден — PrimeTime Pro';
    setText('#categoryTitle', 'Раздел не найден');
    setText('#categoryDescription', 'Возможно, ссылка устарела. Вернитесь к списку разделов базы знаний.');
    document.querySelector('.category-articles')?.setAttribute('hidden', '');
    document.querySelector('#categoryIcon')?.setAttribute('hidden', '');
    return;
  }

  const categoryArticles = articles.filter(article => article.audience === category.audience && article.categorySlug === category.slug);
  document.title = `${category.title} — помощь PrimeTime Pro`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', category.description);
  setText('#categoryTitle', category.title);
  setText('#categoryDescription', category.description);
  setText('#categoryCount', `${categoryArticles.length} ${pluralize(categoryArticles.length, ['инструкция', 'инструкции', 'инструкций'])}`);

  const iconUse = document.querySelector('#categoryIcon use');
  if (iconUse) iconUse.setAttribute('href', `../ui-icons.svg#${category.icon || 'icon-list'}`);

  const productLink = document.querySelector('#productLink');
  const footerProductLink = document.querySelector('#footerProductLink');
  const isClient = category.audience === 'client';
  setText('#categoryAudience', isClient ? 'Помощь клиенту' : 'Помощь специалисту');
  const categoryBackLink = document.querySelector('#categoryBackLink');
  if (categoryBackLink) categoryBackLink.href = `index.html?audience=${category.audience}#sections`;
  const brandLink = document.querySelector('.help-brand');
  if (brandLink) brandLink.href = `index.html?audience=${category.audience}`;
  if (productLink) {
    productLink.href = isClient ? '../index.html' : '../provider.html';
    const label = productLink.querySelector('span');
    if (label) label.textContent = isClient ? 'К онлайн-записи' : 'Открыть PrimeTime Pro';
  }
  if (footerProductLink) {
    footerProductLink.href = isClient ? '../index.html' : '../provider.html';
    footerProductLink.textContent = isClient ? 'К онлайн-записи' : 'Вернуться в кабинет';
  }
  try { sessionStorage.setItem('minuta-help-audience', category.audience); } catch { /* Navigation still works. */ }

  const list = document.querySelector('#categoryList');
  categoryArticles.forEach((article, index) => {
    const link = document.createElement('a');
    link.href = `article.html?slug=${encodeURIComponent(article.slug)}`;
    const number = document.createElement('span');
    number.className = 'category-article-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = article.title;
    const excerpt = document.createElement('small');
    excerpt.textContent = article.excerpt;
    copy.append(title, excerpt);
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '../ui-icons.svg#icon-arrow-right');
    arrow.append(use);
    link.append(number, copy, arrow);
    list?.append(link);
  });
}());
