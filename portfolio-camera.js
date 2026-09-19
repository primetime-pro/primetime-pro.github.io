(function initMinutaPortfolioCamera(global) {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let stream = null;
  let generation = 0;
  let captureCallback = null;
  let fallbackCallback = null;

  function stopStream() {
    generation += 1;
    stream?.getTracks?.().forEach(track => track.stop());
    stream = null;
    const video = $('#portfolioCameraVideo');
    if (video) video.srcObject = null;
  }

  function close() {
    stopStream();
    const dialog = $('#portfolioCameraDialog');
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
    captureCallback = null;
    fallbackCallback = null;
  }

  function showFallback(message) {
    const status = $('#portfolioCameraStatus');
    const placeholder = $('#portfolioCameraPlaceholder');
    const fallback = $('[data-portfolio-camera-fallback]');
    const capture = $('[data-portfolio-camera-capture]');
    if (status) status.textContent = message;
    if (placeholder) {
      placeholder.hidden = false;
      const label = placeholder.querySelector('span');
      if (label) label.textContent = 'Камера не включилась';
    }
    if (fallback) fallback.hidden = false;
    if (capture) capture.disabled = true;
  }

  async function startCamera() {
    stopStream();
    const requestGeneration = generation;
    const dialog = $('#portfolioCameraDialog');
    const video = $('#portfolioCameraVideo');
    const status = $('#portfolioCameraStatus');
    const placeholder = $('#portfolioCameraPlaceholder');
    const fallback = $('[data-portfolio-camera-fallback]');
    const capture = $('[data-portfolio-camera-capture]');
    if (!global.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showFallback('Встроенная камера недоступна в этом браузере. Можно открыть системную камеру.');
      return;
    }
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1920 }, height:{ ideal:1080 } },
        audio:false
      });
      if (requestGeneration !== generation || dialog?.open !== true) {
        acquired.getTracks?.().forEach(track => track.stop());
        return;
      }
      stream = acquired;
      video.srcObject = stream;
      await video.play();
      if (requestGeneration !== generation || dialog?.open !== true) { stopStream(); return; }
      if (placeholder) placeholder.hidden = true;
      if (fallback) fallback.hidden = true;
      if (capture) capture.disabled = false;
      if (status) status.textContent = 'Наведите камеру и нажмите «Сделать снимок».';
    } catch (error) {
      if (requestGeneration !== generation) return;
      stopStream();
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      showFallback(denied
        ? 'Доступ к камере не разрешён. Разрешите его для сайта или откройте системную камеру.'
        : 'Не удалось включить камеру. Можно открыть системную камеру.');
    }
  }

  function open(options = {}) {
    const dialog = $('#portfolioCameraDialog');
    if (!dialog) { options.onFallback?.(); return; }
    stopStream();
    captureCallback = typeof options.onCapture === 'function' ? options.onCapture : null;
    fallbackCallback = typeof options.onFallback === 'function' ? options.onFallback : null;
    $('#portfolioCameraTitle').textContent = options.title || 'Снять фото';
    $('#portfolioCameraStatus').textContent = 'Разрешите доступ к камере, если браузер попросит.';
    const placeholder = $('#portfolioCameraPlaceholder');
    placeholder.hidden = false;
    placeholder.querySelector('span').textContent = 'Включаем камеру…';
    $('[data-portfolio-camera-fallback]').hidden = true;
    $('[data-portfolio-camera-capture]').disabled = true;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    void startCamera();
  }

  function capture() {
    const video = $('#portfolioCameraVideo');
    if (!stream || !video?.videoWidth || !video?.videoHeight || !captureCallback) {
      showFallback('Камера ещё не готова. Подождите немного или откройте системную камеру.');
      return;
    }
    const scale = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { alpha:false });
    if (!context) { showFallback('Не удалось подготовить снимок. Попробуйте системную камеру.'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const callback = captureCallback;
    const captureGeneration = generation;
    canvas.toBlob(blob => {
      if (captureGeneration !== generation) return;
      if (!blob) { showFallback('Не удалось сохранить снимок. Попробуйте системную камеру.'); return; }
      const file = new File([blob], `portfolio-${Date.now()}.jpg`, { type:'image/jpeg', lastModified:Date.now() });
      close();
      callback(file);
    }, 'image/jpeg', .92);
  }

  function useFallback() {
    const callback = fallbackCallback;
    close();
    callback?.();
  }

  $('[data-close-portfolio-camera]')?.addEventListener('click', close);
  $('[data-portfolio-camera-capture]')?.addEventListener('click', capture);
  $('[data-portfolio-camera-fallback]')?.addEventListener('click', useFallback);
  $('#portfolioCameraDialog')?.addEventListener('close', stopStream);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });

  global.MinutaPortfolioCamera = Object.freeze({ open, close });
})(window);
