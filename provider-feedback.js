(function (global) {
  'use strict';

  const BUCKET = 'product-feedback';
  const INPUT_LIMIT = 12 * 1024 * 1024;
  const OUTPUT_LIMIT = 4 * 1024 * 1024;
  const MAX_EDGE = 1600;
  const UNCONFIRMED_MESSAGE = 'Результат отправки не подтверждён. Не отправляйте сообщение повторно — обновите страницу и сначала проверьте результат.';

  function createId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function decodeImage(file) {
    if ('createImageBitmap' in global) {
      try { return await createImageBitmap(file, { imageOrientation:'from-image' }); } catch {}
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
      image.src = url;
    });
  }

  async function prepareScreenshot(file) {
    const image = await decodeImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha:false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    image.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
    if (!blob || blob.size > OUTPUT_LIMIT) throw new Error('image_too_large');
    return blob;
  }

  function clientVersion() {
    const asset = document.querySelector('link[href*="styles.css?v="]')?.getAttribute('href') || '';
    return new URL(asset, location.href).searchParams.get('v') || 'unknown';
  }

  function deviceSummary() {
    const device = matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
    const platform = navigator.userAgentData?.platform || navigator.platform || 'unknown';
    return `${device}; ${String(platform).slice(0, 80)}; ${innerWidth}x${innerHeight}`.slice(0, 300);
  }

  function createController({ db, $, notify, requireWrites, getCurrentUser, getOrganization }) {
    let available = false;
    let bound = false;
    let submitting = false;
    let submissionUnresolved = false;
    let availabilityRevision = 0;

    function setAvailable(value) {
      available = Boolean(value);
      document.querySelectorAll('[data-open-product-feedback]').forEach(button => { button.hidden = !available; });
    }

    function setError(message = '') {
      const error = $('#productFeedbackError');
      error.textContent = message;
      error.hidden = !message;
    }

    function updateType() {
      const problem = $('#productFeedbackKindProblem').checked;
      $('#productFeedbackExpectedField').hidden = !problem;
      $('#productFeedbackMessageLabel').textContent = problem ? 'Что произошло?' : 'Что хотите предложить?';
      $('#productFeedbackMessage').placeholder = problem
        ? 'Коротко опишите действие и что пошло не так'
        : 'Расскажите, что сделало бы работу удобнее';
    }

    function resetForm() {
      if (submissionUnresolved) {
        $('#productFeedbackForm').hidden = false;
        $('#productFeedbackSuccess').hidden = true;
        $('#productFeedbackSubmit').disabled = true;
        setError(UNCONFIRMED_MESSAGE);
        return;
      }
      $('#productFeedbackForm').reset();
      $('#productFeedbackKindProblem').checked = true;
      $('#productFeedbackForm').hidden = false;
      $('#productFeedbackSuccess').hidden = true;
      $('#productFeedbackAttachmentNotice').hidden = true;
      $('#productFeedbackAttachmentNotice').textContent = '';
      $('#productFeedbackFileStatus').textContent = 'Необязательно · PNG, JPEG или WebP до 12 МБ';
      setError();
      updateType();
    }

    function open() {
      if (!available || !getCurrentUser()) return;
      resetForm();
      $('#productFeedbackDialog').showModal();
      setTimeout(() => $('#productFeedbackMessage').focus(), 0);
    }

    function close() {
      $('#productFeedbackDialog').close();
    }

    async function refreshAvailability() {
      const revision = ++availabilityRevision;
      if (!getCurrentUser() || !navigator.onLine) { setAvailable(false); return; }
      const { data, error } = await db.rpc('get_minuta_feedback_capability');
      if (revision !== availabilityRevision) return;
      setAvailable(!error && data === true);
    }

    async function submit(event) {
      event.preventDefault();
      if (submitting || submissionUnresolved || !available || !getCurrentUser() || !requireWrites()) return;
      const kind = $('#productFeedbackKindProblem').checked ? 'problem' : 'suggestion';
      const message = $('#productFeedbackMessage').value.trim();
      const expected = kind === 'problem' ? $('#productFeedbackExpected').value.trim() : '';
      const file = $('#productFeedbackScreenshot').files?.[0] || null;
      if (message.length < 10) { setError('Добавьте немного подробностей — хотя бы 10 символов.'); return; }
      if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > INPUT_LIMIT)) {
        setError('Выберите PNG, JPEG или WebP размером до 12 МБ.');
        return;
      }

      const button = $('#productFeedbackSubmit');
      const original = button.textContent;
      let screenshotPath = '';
      let attachmentSkipped = false;
      let feedbackRejected = false;
      let feedbackRequestStarted = false;
      submitting = true;
      button.disabled = true;
      button.textContent = 'Отправляем…';
      setError();
      try {
        if (file) {
          try {
            const blob = await prepareScreenshot(file);
            screenshotPath = `${getCurrentUser().id}/${createId()}.webp`;
            const { error } = await db.storage.from(BUCKET).upload(screenshotPath, blob, { contentType:'image/webp', cacheControl:'31536000', upsert:false });
            if (error) throw error;
          } catch (error) {
            console.warn('product_feedback_attachment_skipped', error?.code || error?.statusCode || 'unavailable');
            screenshotPath = '';
            attachmentSkipped = true;
          }
        }
        const organization = getOrganization?.();
        const payload = {
          p_organization:organization?.id || null,
          p_kind:kind,
          p_message:message,
          p_expected_result:expected || null,
          p_page_path:location.pathname,
          p_client_version:clientVersion(),
          p_device_summary:deviceSummary(),
          p_screenshot_path:screenshotPath || null
        };
        feedbackRequestStarted = true;
        let { data, error } = await db.rpc('create_minuta_feedback', payload);
        if (error && screenshotPath) {
          try { await db.storage.from(BUCKET).remove([screenshotPath]); } catch {}
          screenshotPath = '';
          attachmentSkipped = true;
          ({ data, error } = await db.rpc('create_minuta_feedback', { ...payload, p_screenshot_path:null }));
        }
        if (error) { feedbackRejected = true; throw error; }
        const requestNumber = data?.request_number;
        if (!/^[1-9][0-9]*$/.test(String(requestNumber || ''))) throw new Error('feedback_ack_invalid');
        $('#productFeedbackRequestNumber').textContent = String(requestNumber);
        $('#productFeedbackForm').hidden = true;
        $('#productFeedbackSuccess').hidden = false;
        const attachmentNotice = $('#productFeedbackAttachmentNotice');
        attachmentNotice.hidden = !attachmentSkipped;
        attachmentNotice.textContent = attachmentSkipped
          ? 'Сообщение отправлено без снимка: файл не удалось загрузить. Сам текст обращения уже получен.'
          : '';
        notify(attachmentSkipped ? 'Сообщение отправлено без снимка' : 'Сообщение отправлено');
      } catch (error) {
        if (screenshotPath && feedbackRejected) await db.storage.from(BUCKET).remove([screenshotPath]);
        const code = `${error?.code || ''} ${error?.message || ''}`;
        const unconfirmed = feedbackRequestStarted && !feedbackRejected;
        if (unconfirmed) submissionUnresolved = true;
        setError(unconfirmed || /feedback_ack_invalid/.test(code)
          ? UNCONFIRMED_MESSAGE
          : /42501|authentication_required|feedback_organization_denied/i.test(code)
            ? 'Сессия или доступ к организации изменились. Обновите страницу и войдите снова.'
            : /22023|invalid_feedback/i.test(code)
              ? 'Сервер отклонил данные обращения. Проверьте текст и попробуйте ещё раз.'
              : navigator.onLine === false
                ? 'Нет подключения к интернету. Текст сохранён в форме — отправьте его после восстановления связи.'
                : 'Сервис обратной связи временно не принял сообщение. Текст сохранён в форме — попробуйте ещё раз позже.');
      } finally {
        submitting = false;
        button.disabled = submissionUnresolved;
        button.textContent = original;
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      document.addEventListener('click', event => {
        if (event.target.closest('[data-open-product-feedback]')) open();
        if (event.target.closest('[data-close-product-feedback]')) close();
        if (event.target.closest('[data-new-product-feedback]')) resetForm();
      });
      document.querySelectorAll('input[name="productFeedbackKind"]').forEach(input => input.addEventListener('change', updateType));
      $('#productFeedbackScreenshot').addEventListener('change', event => {
        const file = event.target.files?.[0];
        $('#productFeedbackFileStatus').textContent = file ? file.name : 'Необязательно · PNG, JPEG или WebP до 12 МБ';
        setError();
      });
      $('#productFeedbackForm').addEventListener('submit', submit);
      $('#productFeedbackDialog').addEventListener('click', event => {
        if (event.target === $('#productFeedbackDialog')) close();
      });
      global.addEventListener('online', refreshAvailability);
      global.addEventListener('offline', () => setAvailable(false));
    }

    return {
      bind,
      refreshAvailability,
      reset() {
        ++availabilityRevision;
        setAvailable(false);
        if ($('#productFeedbackDialog').open) close();
      }
    };
  }

  global.MinutaProviderFeedback = Object.freeze({ createController });
})(window);
