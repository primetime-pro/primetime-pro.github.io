(function () {
  'use strict';

  // Explicitly audited read-only RPCs. Never infer safety from a name prefix.
  const READ_RPCS = new Set([
    'has_minuta_provider_access', 'get_minuta_workspace', 'get_provider_booking_reviews',
    'get_minuta_team_calendar', 'get_minuta_team_calendar_v2', 'get_minuta_team_calendar_v3'
  ]);
  const TRANSIENT_STATUSES = new Set([408, 502, 503, 504, 520]);
  const abortError = () => new DOMException('Read cancelled', 'AbortError');

  function create({ baseUrl, fetcher = window.fetch.bind(window), timeoutMs = 12000, retryDelayMs = 750 } = {}) {
    const origin = new URL(baseUrl).origin;
    const pending = new Set();
    const isSafeRead = (input, init) => {
      // Supabase supplies URLs and replayable JSON strings, never consumed Request bodies.
      if (typeof input !== 'string' && !(input instanceof URL)) return false;
      const url = new URL(input, baseUrl);
      if (url.origin !== origin) return false;
      const method = String(init?.method || 'GET').toUpperCase();
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
      if (rpc) return ['GET', 'HEAD', 'POST'].includes(method) && READ_RPCS.has(rpc[1])
        && (init?.body == null || typeof init.body === 'string');
      if (/^\/rest\/v1\/[^/]+$/.test(url.pathname)) return ['GET', 'HEAD'].includes(method);
      // Signing existing image URLs does not upload, delete or modify stored objects.
      return method === 'POST' && /^\/storage\/v1\/object\/sign\/(client-avatars|portfolio-images)\/.+/.test(url.pathname)
        && typeof init?.body === 'string';
    };

    const pause = signal => new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const onAbort = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, retryDelayMs + Math.floor(Math.random() * 250));
      signal.addEventListener('abort', onAbort, { once:true });
    });

    async function readFetch(input, init = {}) {
      if (!isSafeRead(input, init) || typeof AbortController === 'undefined') return fetcher(input, init);
      const operation = new AbortController();
      const onCallerAbort = () => operation.abort();
      if (init.signal?.aborted) throw abortError();
      init.signal?.addEventListener('abort', onCallerAbort, { once:true });
      pending.add(operation);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (operation.signal.aborted || (attempt > 0 && (window.navigator?.onLine === false || document.hidden))) throw abortError();
          const controller = new AbortController();
          let timedOut = false;
          let timer;
          let rejectAttempt;
          const interrupted = new Promise((_, reject) => { rejectAttempt = reject; });
          const onAbort = () => { controller.abort(); rejectAttempt(abortError()); };
          operation.signal.addEventListener('abort', onAbort, { once:true });
          timer = setTimeout(() => { timedOut = true; onAbort(); }, timeoutMs);
          let failure = 'NETWORK';
          try {
            const response = await Promise.race([
              (async () => {
                const result = await fetcher(input, { ...init, signal:controller.signal });
                // Keep the deadline until the body arrives, not merely the HTTP headers.
                const bytes = await result.arrayBuffer();
                if (controller.signal.aborted) throw abortError();
                const noBody = String(init.method || 'GET').toUpperCase() === 'HEAD' || [204, 205, 304].includes(result.status);
                return new Response(noBody ? null : bytes, { status:result.status, statusText:result.statusText, headers:result.headers });
              })(),
              interrupted
            ]);
            if (!TRANSIENT_STATUSES.has(response.status)) return response;
            failure = 'UNAVAILABLE';
          } catch (error) {
            if (operation.signal.aborted) throw abortError();
            failure = timedOut ? 'TIMEOUT' : 'NETWORK';
          } finally {
            clearTimeout(timer);
            operation.signal.removeEventListener('abort', onAbort);
          }
          if (attempt === 1 || window.navigator?.onLine === false || document.hidden) {
            return new Response(JSON.stringify({ code:`MINUTA_READ_${failure}`, message:'Не удалось загрузить данные. Повторим после восстановления связи.', details:'', hint:'' }), {
              status:failure === 'TIMEOUT' ? 504 : 503, headers:{ 'content-type':'application/json' }
            });
          }
          await pause(operation.signal);
        }
      } finally {
        init.signal?.removeEventListener('abort', onCallerAbort);
        pending.delete(operation);
      }
    }
    readFetch.cancelPendingReads = () => { for (const operation of pending) operation.abort(); };
    return readFetch;
  }

  const isConnectionError = error => /^MINUTA_READ_/.test(error?.code || '') || /AbortError|Read cancelled/.test(error?.message || '');
  window.MinutaProviderReadFetch = Object.freeze({ create, isConnectionError });
})();
