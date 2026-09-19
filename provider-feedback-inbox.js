(function (global) {
  'use strict';

  const STATUS_LABELS = Object.freeze({
    new:'Новое',
    in_review:'В работе',
    planned:'Запланировано',
    resolved:'Решено',
    closed:'Закрыто'
  });

  function createController({ db, $, notify, getCurrentUser, getOrganization }) {
    let bound = false;
    let loading = false;
    let revision = 0;
    let organizationId = '';
    let items = [];
    let canManage = false;
    let filter = 'all';

    const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[character]);

    function dateLabel(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('ru-RU', { day:'numeric',month:'short',hour:'2-digit',minute:'2-digit' });
    }

    function setState(name, message = '') {
      const loadingState = $('#feedbackInboxLoading');
      const emptyState = $('#feedbackInboxEmpty');
      const errorState = $('#feedbackInboxError');
      loadingState.hidden = name !== 'loading';
      emptyState.hidden = name !== 'empty';
      errorState.hidden = name !== 'error';
      if (message) $('#feedbackInboxErrorText').textContent = message;
    }

    function visibleItems() {
      if (filter === 'all') return items;
      if (filter === 'active') return items.filter(item => ['new','in_review','planned'].includes(item.status));
      return items.filter(item => ['resolved','closed'].includes(item.status));
    }

    function render() {
      document.querySelectorAll('[data-feedback-inbox-filter]').forEach(button => {
        const active = button.dataset.feedbackInboxFilter === filter;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      const list = $('#feedbackInboxList');
      const visible = visibleItems();
      $('#feedbackInboxCount').textContent = `${items.length}`;
      if (!visible.length) {
        list.innerHTML = '';
        setState('empty');
        $('#feedbackInboxEmptyText').textContent = items.length
          ? 'В этой группе пока нет обращений.'
          : 'Здесь появятся проблемы и предложения, отправленные через обратную связь.';
        return;
      }
      setState('ready');
      list.innerHTML = visible.map(item => {
        const expected = item.expected_result
          ? `<div class="feedback-inbox-expected"><small>Ожидалось</small><p>${escape(item.expected_result)}</p></div>`
          : '';
        const details = [item.page_path, item.client_version && `версия ${item.client_version}`, item.device_summary]
          .filter(Boolean).map(escape).join(' · ');
        const statusControl = canManage
          ? `<label class="feedback-inbox-status"><span>Статус</span><select data-feedback-status="${escape(item.id)}" aria-label="Статус обращения №${escape(item.request_number)}">${Object.entries(STATUS_LABELS).map(([value,label]) => `<option value="${value}"${item.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`
          : `<span class="feedback-inbox-status-label" data-status="${escape(item.status)}">${escape(STATUS_LABELS[item.status] || item.status)}</span>`;
        return `<article class="feedback-inbox-card" data-feedback-id="${escape(item.id)}">
          <header><div><small>№${escape(item.request_number)} · ${item.kind === 'suggestion' ? 'Предложение' : 'Проблема'}</small><time datetime="${escape(item.created_at)}">${escape(dateLabel(item.created_at))}</time></div>${statusControl}</header>
          <p class="feedback-inbox-message">${escape(item.message)}</p>${expected}
          <footer>${item.has_screenshot ? '<span class="feedback-inbox-attachment">Снимок приложен</span>' : ''}${details ? `<details><summary>Технические сведения</summary><p>${details}</p></details>` : ''}</footer>
        </article>`;
      }).join('');
    }

    async function load({ force = false } = {}) {
      const organization = getOrganization?.();
      const nextOrganizationId = organization?.id || '';
      if (!getCurrentUser?.() || !nextOrganizationId || !navigator.onLine) {
        items = [];
        organizationId = nextOrganizationId;
        render();
        return { ok:false, skipped:true };
      }
      if (loading && !force) return { ok:false, pending:true };
      const requestRevision = ++revision;
      organizationId = nextOrganizationId;
      loading = true;
      setState('loading');
      try {
        const { data, error } = await db.rpc('get_minuta_feedback_inbox_v146', { p_organization:nextOrganizationId });
        if (requestRevision !== revision || organizationId !== nextOrganizationId) return { ok:false, stale:true };
        if (error) throw error;
        items = Array.isArray(data?.items) ? data.items : [];
        canManage = data?.can_manage === true;
        render();
        return { ok:true };
      } catch (error) {
        if (requestRevision !== revision) return { ok:false, stale:true };
        items = [];
        canManage = false;
        setState('error', /42501|access_denied/i.test(`${error?.code || ''} ${error?.message || ''}`)
          ? 'У вас нет доступа к обращениям этой организации.'
          : 'Не удалось загрузить обращения. Проверьте интернет и повторите попытку.');
        return { ok:false, error };
      } finally {
        if (requestRevision === revision) loading = false;
      }
    }

    async function updateStatus(select) {
      if (!canManage || select.disabled) return;
      const item = items.find(entry => entry.id === select.dataset.feedbackStatus);
      if (!item || item.status === select.value) return;
      const previous = item.status;
      select.disabled = true;
      try {
        const { data, error } = await db.rpc('set_minuta_feedback_status_v146', {
          p_organization:organizationId,
          p_feedback:item.id,
          p_status:select.value
        });
        if (error) throw error;
        item.status = data?.status || select.value;
        item.updated_at = data?.updated_at || item.updated_at;
        notify?.('Статус обращения обновлён');
        render();
      } catch {
        select.value = previous;
        notify?.('Не удалось изменить статус');
      } finally {
        select.disabled = false;
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      document.addEventListener('click', event => {
        const filterButton = event.target.closest('[data-feedback-inbox-filter]');
        if (filterButton) { filter = filterButton.dataset.feedbackInboxFilter; render(); }
        if (event.target.closest('[data-feedback-inbox-reload]')) void load({ force:true });
      });
      document.addEventListener('change', event => {
        const select = event.target.closest('[data-feedback-status]');
        if (select) void updateStatus(select);
      });
      global.addEventListener('online', () => {
        if ($('#dashboard')?.dataset.activeView === 'feedback-inbox') void load({ force:true });
      });
    }

    return {
      bind,
      load,
      setOrganization(organization) {
        const nextId = organization?.id || '';
        if (nextId === organizationId) return;
        ++revision;
        organizationId = nextId;
        items = [];
        canManage = false;
        filter = 'all';
        render();
        if (nextId && $('#dashboard')?.dataset.activeView === 'feedback-inbox') void load({ force:true });
      },
      reset() {
        ++revision;
        organizationId = '';
        items = [];
        canManage = false;
        filter = 'all';
        render();
      }
    };
  }

  global.MinutaFeedbackInbox = Object.freeze({ createController });
})(window);
