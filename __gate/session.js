(() => {
  'use strict';
  const CONFIG = {"version":1,"format":"sealed-pages-v1","build":"088edb365ecfd3489bb95afdc0d872c3","basepath":"/akcesoria-prescot/","cipher":"AES-256-GCM","kdf":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"Y93yGEJbmdkB8vIsU/xea23t3rSqwq59dr1vAXY0MvM=","manifest":"9a52ea52373e51ae2590796b22b2fc74720e85865f04d0c5de1eca8be9691f9e","chunkSize":4194304};
  const STORAGE = 'sealed-pages:' + CONFIG.basepath + ':' + CONFIG.build;
  const REVISION = 'sealed-pages-logout:' + CONFIG.basepath;
  let locking = false;
  const revision = () => { try { return localStorage.getItem(REVISION) || ''; } catch { return ''; } };
  const readKey = () => { try { return sessionStorage.getItem(STORAGE + ':revision') === revision() ? sessionStorage.getItem(STORAGE) : null; } catch { return null; } };
  const clear = () => { try { sessionStorage.removeItem(STORAGE); sessionStorage.removeItem(STORAGE + ':revision'); } catch {} };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('sealed-pages-lock:' + CONFIG.basepath) : null;
  const lockDocument = () => {
    if (locking) return;
    locking = true;
    clear();
    // Remove already-rendered private content before navigating back to the gate.
    document.documentElement.style.visibility = 'hidden';
    location.reload();
  };
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SEALED_KEY_REQUEST' && event.data.build === CONFIG.build) event.ports[0]?.postMessage({key: readKey()});
    if (event.data?.type === 'SEALED_LOCKED') lockDocument();
  });
  if (channel) channel.onmessage = event => { if (event.data === 'lock') lockDocument(); };
  const lock = () => {
    // Nonsecret shared generation invalidates keys held by a suspended tab or
    // an image/PDF document without executing application JavaScript there.
    try { localStorage.setItem(REVISION, crypto.randomUUID()); } catch {}
    clear();
    channel?.postMessage('lock');
    const controller = navigator.serviceWorker.controller;
    if (!controller) { lockDocument(); return; }
    const port = new MessageChannel();
    const timer = setTimeout(lockDocument, 2000);
    port.port1.onmessage = () => { clearTimeout(timer); port.port1.close(); lockDocument(); };
    controller.postMessage({type: 'SEALED_LOCK', build: CONFIG.build}, [port.port2]);
  };
  // The application may use this API for its own logout button.
  Object.defineProperty(window, 'lockProtectedSite', {value: lock, writable: false});
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && event.shiftKey) { event.preventDefault(); lock(); } });
  window.addEventListener('pageshow', event => {
    // A browser may restore a document from back/forward cache without a fetch.
    if (event.persisted && !readKey()) lockDocument();
  });
  window.addEventListener('storage', event => { if (event.key === REVISION && !readKey()) lockDocument(); });
  // An old application PWA must never replace the protecting Service Worker.
  try {
    Object.defineProperty(navigator.serviceWorker, 'register', {value: () => Promise.reject(new DOMException('The protected site manages its Service Worker.', 'NotAllowedError')), writable: false});
  } catch {}
  function addLockButton() {
    const container = document.createElement('div');
    container.setAttribute('data-sealed-lock', '');
    const shadow = container.attachShadow({mode: 'closed'});
    const style = document.createElement('style');
    style.textContent = ':host{all:initial!important;position:fixed!important;right:max(12px,env(safe-area-inset-right,0px))!important;bottom:var(--sealed-control-bottom,12px)!important;z-index:2147483647!important}button{font:12px/1.3 system-ui,sans-serif;color:#26384d;background:#fffffff2;border:1px solid #c5ced9;border-radius:7px;padding:8px 11px;box-shadow:0 2px 9px #0001;cursor:pointer}button:focus-visible{outline:3px solid #90b4e5;outline-offset:2px}';
    const button = document.createElement('button');
    button.textContent = 'Zablokuj';
    button.title = 'Zablokuj podgląd we wszystkich kartach (Shift+Esc)';
    button.addEventListener('click', lock);
    shadow.append(style, button);
    document.body.append(container);
    // Stay above existing bottom navigation and avoid covering small actions.
    // Only the public lock control moves; original app layout is untouched.
    let scheduled = false;
    const reposition = () => {
      scheduled = false;
      if (!container.isConnected || locking) return;
      const viewportHeight = innerHeight;
      const viewportWidth = innerWidth;
      const box = container.getBoundingClientRect();
      const right = viewportWidth - box.right;
      let bottom = 12;
      const candidates = document.querySelectorAll('nav,footer,aside,[role="navigation"],[class*="fixed"],[class*="bottom"],[class*="mobile"],[class*="dock"],[class*="sticky"]');
      for (const element of candidates) {
        if (element === container) continue;
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.height > 200 || rect.width < viewportWidth / 2 || rect.top < viewportHeight / 2 || rect.bottom < viewportHeight - 32 || rect.right < box.left) continue;
        let current = element, anchored = false;
        for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
          if (['fixed', 'sticky'].includes(getComputedStyle(current).position)) { anchored = true; break; }
        }
        if (anchored) bottom = Math.max(bottom, viewportHeight - rect.top + 12);
      }
      const clickable = 'a[href],button,input,select,textarea,[role="button"],[role="tab"],[onclick],[tabindex]:not([tabindex="-1"])';
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const left = viewportWidth - right - box.width;
        const top = viewportHeight - bottom - box.height;
        if (top < 12) break;
        const points = [[left + 3, top + 3], [left + box.width - 3, top + 3], [left + box.width / 2, top + box.height / 2], [left + 3, top + box.height - 3], [left + box.width - 3, top + box.height - 3]];
        let next = bottom;
        for (const [x, y] of points) {
          for (const element of document.elementsFromPoint(x, y)) {
            if (element === container) continue;
            let action = element.closest?.(clickable);
            if (!action) {
              let custom = element;
              for (let depth = 0; custom && custom !== container && depth < 5; depth += 1, custom = custom.parentElement) {
                if (getComputedStyle(custom).cursor !== 'pointer') break;
                action = custom;
              }
            }
            if (!action || action === container) continue;
            const rect = action.getBoundingClientRect();
            if (rect.height > 160 || rect.width < 1 || rect.height < 1 || getComputedStyle(action).pointerEvents === 'none') continue;
            if (rect.left < left + box.width && rect.right > left && rect.top < top + box.height && rect.bottom > top) next = Math.max(next, viewportHeight - rect.top + 10);
          }
        }
        if (next === bottom || viewportHeight - next - box.height < 12) break;
        bottom = next;
      }
      container.style.setProperty('--sealed-control-bottom', Math.ceil(bottom) + 'px');
    };
    const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(reposition); } };
    window.addEventListener('resize', schedule, {passive: true});
    window.addEventListener('scroll', schedule, {passive: true, capture: true});
    window.visualViewport?.addEventListener('resize', schedule, {passive: true});
    document.addEventListener('click', schedule, true);
    document.fonts?.addEventListener('loadingdone', schedule);
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && node !== container))) schedule();
    }).observe(document.body, {childList: true, subtree: true});
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLockButton, {once: true});
  else addLockButton();
})();
