'use strict';
const CONFIG = {"version":1,"format":"sealed-pages-v1","build":"088edb365ecfd3489bb95afdc0d872c3","basepath":"/akcesoria-prescot/","cipher":"AES-256-GCM","kdf":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"Y93yGEJbmdkB8vIsU/xea23t3rSqwq59dr1vAXY0MvM=","manifest":"9a52ea52373e51ae2590796b22b2fc74720e85865f04d0c5de1eca8be9691f9e","chunkSize":4194304};
const BASE = new URL(CONFIG.basepath, self.location.origin);
const encoder = new TextEncoder();
const sessions = new Map();
const recovering = new Map();
let epoch = 0;
let explicitlyLocked = false;
const headers = {'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff'};
const isScoped = url => url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname);
const publicFiles = new Set(['sw.js', 'robots.txt', '.nojekyll', 'CNAME', '__gate/gate.js', '__gate/gate.css', '__gate/session.js', '__gate/config.json']);
const safePath = path => !path.split('/').some(part => part === '..' || part === '.') && !path.includes('\\') && !path.includes('\0');
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
async function clearOldCaches() {
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) if (isScoped(new URL(request.url))) await cache.delete(request, {ignoreVary: true});
    if (!(await cache.keys()).length) await caches.delete(name);
  }
}
self.addEventListener('activate', event => event.waitUntil((async () => { await clearOldCaches(); await self.clients.claim(); })()));
async function decrypt(resource, key, expectedEpoch = epoch) {
  if (!/^[a-f0-9]{64}$/.test(resource)) throw new Error('format');
  const response = await fetch(new URL('__gate/payload/' + resource + '.bin', BASE), {cache: 'no-store', credentials: 'omit'});
  if (!response.ok) throw new Error('network');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expectedEpoch !== epoch) throw new Error('locked');
  const result = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(CONFIG.format + ':' + CONFIG.build + ':' + resource), tagLength: 128}, key, bytes.slice(12));
  if (expectedEpoch !== epoch) throw new Error('locked');
  return new Uint8Array(result);
}
async function openSession(raw, expectedEpoch = epoch) {
  let key;
  try {
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    if (bytes.length !== 32) throw new Error('password');
    key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
  } catch { throw new Error('password'); }
  let plain;
  try { plain = await decrypt(CONFIG.manifest, key, expectedEpoch); }
  catch (error) { throw new Error(error.message === 'network' ? 'network' : 'password'); }
  const manifest = JSON.parse(new TextDecoder().decode(plain));
  if (manifest.build !== CONFIG.build || manifest.format !== CONFIG.format || !manifest.files?.['index.html']) throw new Error('password');
  return {key, manifest, epoch: expectedEpoch};
}
async function clientKey(id) {
  const client = await self.clients.get(id);
  if (!client || !isScoped(new URL(client.url))) return null;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1200);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.key || null); };
    try { client.postMessage({type: 'SEALED_KEY_REQUEST', build: CONFIG.build}, [channel.port2]); }
    catch { clearTimeout(timer); resolve(null); }
  });
}
async function sessionFor(event) {
  if (explicitlyLocked) return null;
  const expectedEpoch = epoch;
  for (const id of [event.clientId, event.replacesClientId].filter(Boolean)) {
    let session = sessions.get(id);
    if (!session) {
      if (!recovering.has(id)) recovering.set(id, (async () => {
        const raw = await clientKey(id);
        if (!raw || expectedEpoch !== epoch || explicitlyLocked) return null;
        try {
          const value = await openSession(raw, expectedEpoch);
          if (expectedEpoch !== epoch || explicitlyLocked) return null;
          sessions.set(id, value);
          return value;
        } catch { return null; }
      })().finally(() => recovering.delete(id)));
      session = await recovering.get(id);
    }
    if (session && session.epoch === epoch && !explicitlyLocked) {
      if (event.resultingClientId) sessions.set(event.resultingClientId, session);
      return session;
    }
  }
  return null;
}
self.addEventListener('message', event => {
  const data = event.data || {};
  if (!event.source?.id || !isScoped(new URL(event.source.url))) return;
  if (data.type === 'SEALED_HELLO') event.ports[0]?.postMessage({build: CONFIG.build});
  if (data.type === 'SEALED_UNLOCK') event.waitUntil((async () => {
    try {
      if (data.build !== CONFIG.build) throw new Error('updated');
      const expectedEpoch = epoch;
      const session = await openSession(data.key, expectedEpoch);
      if (expectedEpoch !== epoch) throw new Error('locked');
      explicitlyLocked = false;
      sessions.set(event.source.id, session);
      const live = new Set((await self.clients.matchAll()).map(client => client.id));
      for (const id of sessions.keys()) if (!live.has(id)) sessions.delete(id);
      event.ports[0]?.postMessage({ok: true});
    } catch (error) { event.ports[0]?.postMessage({ok: false, reason: error.message}); }
  })());
  if (data.type === 'SEALED_LOCK') event.waitUntil((async () => {
    explicitlyLocked = true;
    epoch += 1;
    const lockedEpoch = epoch;
    sessions.clear();
    recovering.clear();
    for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
      if (isScoped(new URL(client.url))) {
        client.postMessage({type: 'SEALED_LOCKED', build: CONFIG.build});
        // Images/PDFs have no injected lifecycle script. Navigating those clients
        // also replaces their already-rendered private document with the gate.
        client.navigate(client.url).catch(() => {});
      }
    }
    await clearOldCaches();
    if (epoch === lockedEpoch && explicitlyLocked) sessions.clear();
    event.ports[0]?.postMessage({ok: true});
  })());
});
async function gate(method) {
  const response = await fetch(new URL('index.html', BASE), {cache: 'no-store'});
  return new Response(method === 'HEAD' ? null : await response.arrayBuffer(), {headers: {...headers, 'Content-Type': 'text/html; charset=utf-8'}});
}
function locked(method, navigation) {
  return navigation ? gate(method) : new Response(method === 'HEAD' ? null : 'Site locked', {status: 401, headers});
}
function resolveFile(path, manifest, navigation) {
  const files = manifest.files;
  const normalized = !path ? 'index.html' : path.endsWith('/') ? path + 'index.html' : path;
  if (files[normalized]) return {path: normalized, entry: files[normalized]};
  if (navigation && files[path + '/index.html']) return {redirect: BASE.pathname + encodeURI(path) + '/'};
  if (navigation && files[path + '.html']) return {path: path + '.html', entry: files[path + '.html']};
  if (navigation && manifest.spaFallback) return {path: 'index.html', entry: files['index.html']};
  if (navigation && files['404.html']) return {path: '404.html', entry: files['404.html'], status: 404};
  return null;
}
function injectSession(bytes) {
  const html = new TextDecoder().decode(bytes);
  const script = '<script src="' + BASE.pathname + '__gate/session.js"></script>';
  // Do not reserialize the HTML: keep all original attributes, scripts and markup.
  if (/<head(?:\s[^>]*)?>/i.test(html)) return encoder.encode(html.replace(/<head(?:\s[^>]*)?>/i, match => match + script));
  if (/<!doctype[^>]*>/i.test(html)) return encoder.encode(html.replace(/<!doctype[^>]*>/i, match => match + script));
  return encoder.encode(script + html);
}
async function serve(event, path) {
  const request = event.request;
  const navigation = request.mode === 'navigate';
  const session = await sessionFor(event);
  if (!session || session.epoch !== epoch || explicitlyLocked) return locked(request.method, navigation);
  const resolved = resolveFile(path, session.manifest, navigation);
  if (!resolved) return new Response(null, {status: 404, headers});
  if (resolved.redirect) {
    const original = new URL(request.url);
    return Response.redirect(new URL(resolved.redirect + original.search, BASE), 302);
  }
  const file = resolved.entry;
  try {
    // HTML injection only adds the session lifecycle/lock control. Its asset URLs
    // are unchanged, so module imports, workers, CSS and fetch() keep their URLs.
    if (file.mime.startsWith('text/html')) {
      const pieces = [];
      for (const id of file.chunks) pieces.push(await decrypt(id, session.key, session.epoch));
      if (session.epoch !== epoch) return locked(request.method, navigation);
      const bytes = new Uint8Array(file.size);
      let offset = 0;
      for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
      const body = injectSession(bytes);
      return new Response(request.method === 'HEAD' ? null : body, {status: resolved.status || 200, headers: {...headers, 'Content-Type': file.mime, 'Content-Length': String(body.length)}});
    }
    let start = 0, end = file.size - 1, status = resolved.status || 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': 'bytes */' + file.size}});
      if (!match[1]) start = Math.max(0, file.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= file.size) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': 'bytes */' + file.size}});
      status = 206;
    }
    const responseHeaders = {...headers, 'Content-Type': file.mime, 'Content-Length': String(Math.max(0, end - start + 1)), 'Accept-Ranges': 'bytes'};
    if (range) responseHeaders['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    if (request.method === 'HEAD') return new Response(null, {status, headers: responseHeaders});
    if (file.size === 0) return new Response(new Uint8Array(), {status, headers: responseHeaders});
    let cursor = start, cancelled = false;
    const first = await decrypt(file.chunks[Math.floor(start / session.manifest.chunkSize)], session.key, session.epoch);
    let firstChunk = first;
    const stream = new ReadableStream({
      async pull(controller) {
        if (cancelled) return;
        try {
          if (session.epoch !== epoch) throw new Error('locked');
          const index = Math.floor(cursor / session.manifest.chunkSize);
          const bytes = firstChunk || await decrypt(file.chunks[index], session.key, session.epoch);
          firstChunk = null;
          if (cancelled || session.epoch !== epoch) throw new Error('locked');
          const offset = cursor % session.manifest.chunkSize;
          const count = Math.min(bytes.length - offset, end - cursor + 1);
          controller.enqueue(bytes.slice(offset, offset + count));
          cursor += count;
          if (cursor > end) controller.close();
        } catch (error) { if (!cancelled) controller.error(error); }
      },
      cancel() { cancelled = true; }
    });
    return new Response(stream, {status, headers: responseHeaders});
  } catch {
    if (session.epoch !== epoch) return locked(request.method, navigation);
    return new Response(request.method === 'HEAD' ? null : 'Unable to open protected resource.', {status: 503, headers});
  }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!isScoped(url)) return;
  let path;
  try { path = decodeURIComponent(url.pathname.slice(BASE.pathname.length)); }
  catch { event.respondWith(new Response(null, {status: 400, headers})); return; }
  if (!safePath(path)) { event.respondWith(new Response(null, {status: 400, headers})); return; }
  if (publicFiles.has(path) || /^__gate\/payload\/[a-f0-9]{64}\.bin$/.test(path)) return;
  if (!['GET', 'HEAD'].includes(event.request.method)) return;
  event.respondWith(serve(event, path));
});
