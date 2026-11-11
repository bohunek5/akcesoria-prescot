(() => {
  'use strict';
  const CONFIG = {"version":1,"format":"sealed-pages-v1","build":"088edb365ecfd3489bb95afdc0d872c3","basepath":"/akcesoria-prescot/","cipher":"AES-256-GCM","kdf":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"Y93yGEJbmdkB8vIsU/xea23t3rSqwq59dr1vAXY0MvM=","manifest":"9a52ea52373e51ae2590796b22b2fc74720e85865f04d0c5de1eca8be9691f9e","chunkSize":4194304};
  const BASE = new URL(CONFIG.basepath, location.origin);
  const STORAGE = 'sealed-pages:' + CONFIG.basepath + ':' + CONFIG.build;
  const REVISION = 'sealed-pages-logout:' + CONFIG.basepath;
  const form = document.getElementById('gate-form');
  const field = document.getElementById('gate-password');
  const button = document.getElementById('gate-submit');
  const status = document.getElementById('gate-status');
  let worker;
  const show = (message, error = false) => { status.textContent = message; status.dataset.error = String(error); };
  const revision = () => { try { return localStorage.getItem(REVISION) || ''; } catch { return ''; } };
  const savedKey = () => { try { return sessionStorage.getItem(STORAGE + ':revision') === revision() ? sessionStorage.getItem(STORAGE) : null; } catch { return null; } };
  const forgetKey = () => { try { sessionStorage.removeItem(STORAGE); sessionStorage.removeItem(STORAGE + ':revision'); } catch {} };
  function request(message) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('timeout')); }, 30000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage(message, [channel.port2]);
    });
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'SEALED_KEY_REQUEST' && event.data.build === CONFIG.build) event.ports[0]?.postMessage({key: savedKey()});
    if (event.data?.type === 'SEALED_LOCKED') forgetKey();
  });
  async function prepare() {
    if (!isSecureContext || !crypto.subtle || !navigator.serviceWorker) throw new Error('unsupported');
    // Remove only registrations contained in this site; other projects share the origin.
    for (const existing of await navigator.serviceWorker.getRegistrations()) {
      const scope = new URL(existing.scope);
      if (scope.origin === BASE.origin && scope.pathname.startsWith(BASE.pathname) && scope.pathname !== BASE.pathname) await existing.unregister();
    }
    const registration = await navigator.serviceWorker.register(new URL('sw.js', BASE), {scope: BASE.pathname, updateViaCache: 'none'});
    worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw new Error('worker');
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('activation')), 30000);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
        else if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('worker')); }
      });
    });
    if (!navigator.serviceWorker.controller || navigator.serviceWorker.controller.scriptURL !== new URL('sw.js', BASE).href) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('controller')), 15000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, {once: true});
      });
    }
    worker = navigator.serviceWorker.controller;
    const hello = await request({type: 'SEALED_HELLO'});
    if (hello.build !== CONFIG.build) { await registration.update(); throw new Error('updated'); }
  }
  async function unlock(raw) {
    const reply = await request({type: 'SEALED_UNLOCK', build: CONFIG.build, key: raw});
    if (!reply.ok) throw new Error(reply.reason || 'password');
    try { sessionStorage.setItem(STORAGE, raw); sessionStorage.setItem(STORAGE + ':revision', revision()); } catch {}
    field.value = '';
    location.reload();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled || !field.value) return;
    button.disabled = true;
    show('Otwieranie strony…');
    try {
      await ready;
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(field.value), 'PBKDF2', false, ['deriveBits']);
      field.value = '';
      const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt: Uint8Array.from(atob(CONFIG.salt), c => c.charCodeAt(0)), iterations: CONFIG.iterations, hash: 'SHA-256'}, material, 256);
      await unlock(btoa(String.fromCharCode(...new Uint8Array(bits))));
    } catch (error) {
      show(error.message === 'password' ? 'Nieprawidłowe hasło. Spróbuj ponownie.' : 'Nie udało się otworzyć strony. Odśwież i spróbuj ponownie.', true);
      button.disabled = false;
      field.focus();
    }
  });
  const ready = prepare();
  ready.then(async () => {
    // Remove old keys for this exact scope after a new build.
    try {
      const prefix = 'sealed-pages:' + CONFIG.basepath + ':';
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix) && key !== STORAGE && key !== STORAGE + ':revision') sessionStorage.removeItem(key);
    } catch {}
    const saved = savedKey();
    if (saved) {
      show('Przywracanie dostępu w tej karcie…');
      try { await unlock(saved); return; } catch { forgetKey(); }
    }
    button.disabled = false;
    show('');
  }).catch(error => {
    show(error.message === 'unsupported' ? 'Otwórz stronę przez HTTPS w aktualnej przeglądarce z włączoną pamięcią witryn.' : 'Nie udało się przygotować podglądu. Odśwież stronę i spróbuj ponownie.', true);
  });
})();
