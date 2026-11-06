/* Пик-Квест — service worker.
   Кэширует оболочку приложения и движок Python (Pyodide) с CDN,
   чтобы игра работала без интернета после первого запуска.

   После изменения файлов поднимай VERSION — старый кэш будет удалён. */
'use strict';

var VERSION = 'v5';
var SHELL_CACHE = 'pikquest-shell-' + VERSION;
var RUNTIME_CACHE = 'pikquest-runtime-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/levels.js',
  './js/sim.js',
  './js/editor.js',
  './js/pyrunner.js',
  './js/pwa.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

var CDN_HOSTS = ['cdn.jsdelivr.net'];

/* Ключ кэша для своих файлов: версия (?v=N) не важна, важен путь. */
function keyOf(u) {
  var url = new URL(u, self.registration.scope);
  return url.origin + url.pathname;
}

/* Ключ для чужих файлов: полный адрес, включая версию. */
function fullKey(u) {
  return new URL(u).href;
}

function isCacheable(res) {
  return !!res && (res.ok || res.type === 'opaque');
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    (async function () {
      var cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL.map(async function (u) {
          try {
            var res = await fetch(new Request(u, { cache: 'reload' }));
            if (isCacheable(res)) await cache.put(keyOf(u), res);
          } catch (err) {
            /* один недоступный файл не должен ломать установку */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    (async function () {
      var keys = await caches.keys();
      await Promise.all(
        keys
          .filter(function (k) { return k !== SHELL_CACHE && k !== RUNTIME_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(req, cacheName, keyFn) {
  var cache = await caches.open(cacheName);
  var key = keyFn(req.url);
  var hit = await cache.match(key);
  if (hit) return hit;
  var res = await fetch(req);
  if (isCacheable(res)) {
    // Важно дождаться записи: иначе браузер может остановить worker
    // сразу после отдачи ответа, и файл не попадёт в кэш.
    try { await cache.put(key, res.clone()); } catch (err) { /* не критично */ }
  }
  return res;
}

async function handleNavigation(req) {
  var cache = await caches.open(SHELL_CACHE);
  var indexKey = keyOf('./index.html');
  var cached = (await cache.match(indexKey)) || (await cache.match(keyOf(req.url)));

  // Обновляем копию в фоне, не задерживая запуск.
  fetch(req)
    .then(async function (res) {
      if (isCacheable(res)) {
        try { await cache.put(indexKey, res.clone()); } catch (err) { /* не критично */ }
      }
    })
    .catch(function () { /* офлайн — остаёмся на кэше */ });

  if (cached) return cached;

  try {
    var res = await fetch(req);
    if (isCacheable(res)) {
      try { await cache.put(indexKey, res.clone()); } catch (err) { /* не критично */ }
    }
    return res;
  } catch (err) {
    return new Response(
      'Нет сети, а приложение ещё не загружено целиком. Открой игру один раз с интернетом.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // Переходы по страницам: из кэша, сеть — в фоне (офлайн-запуск).
  if (req.mode === 'navigate') {
    e.respondWith(handleNavigation(req));
    return;
  }

  var url = new URL(req.url);

  // Свои файлы: из кэша, иначе из сети.
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(req, SHELL_CACHE, keyOf));
    return;
  }

  // Python и его стандартная библиотека — с CDN, кладём в кэш навсегда.
  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(cacheFirst(req, RUNTIME_CACHE, fullKey));
  }
});
