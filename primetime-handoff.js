(() => {
  'use strict';

  const TARGET = 'https://primetime-booking.aladushka9180.chatgpt.site/for-masters';
  const START = `${TARGET}/start`;
  const button = document.getElementById('openPrimeTime');
  const params = new URLSearchParams(window.location.search);
  const state = (params.get('primetime_return') || '').toLowerCase();
  const returning = /^[0-9a-f]{64}$/.test(state);
  let running = false;

  function setBusy(value) {
    if (!button) return;
    button.disabled = value;
    button.setAttribute('aria-busy', value ? 'true' : 'false');
    const label = button.querySelector('span');
    if (label) label.textContent = value ? 'Открываем PrimeTime…' : 'Управлять профилем в PrimeTime';
  }

  async function createHandoff() {
    if (running) return;
    running = true;
    setBusy(true);
    try {
      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session) {
        return;
      }

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('primetime_return');
      window.history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

      const { data, error } = await db.rpc('create_primetime_handoff', { p_state: state });
      if (error) throw error;
      const ticket = typeof data?.ticket === 'string' ? data.ticket.toLowerCase() : '';
      if (!/^[0-9a-f]{64}$/.test(ticket)) throw new Error('invalid_primetime_handoff');
      window.location.assign(`${TARGET}#handoff=${ticket}`);
    } catch (error) {
      console.error('PrimeTime handoff failed', error);
      notify('Не удалось открыть PrimeTime · повторите через минуту');
    } finally {
      running = false;
      setBusy(false);
    }
  }

  button?.addEventListener('click', () => window.location.assign(START));

  if (returning) {
    void createHandoff();
    db.auth.onAuthStateChange((_event, session) => {
      if (session) void createHandoff();
    });
  }
})();
