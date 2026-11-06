/* Пик-Квест — установка как приложение и офлайн-режим. */
(function () {
  'use strict';

  var installEvent = null;
  var installBtn = document.getElementById('installBtn');

  function hideInstall() {
    if (installBtn) installBtn.hidden = true;
  }

  /* Браузер предлагает установку — показываем кнопку в шапке. */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    if (installBtn) installBtn.hidden = false;
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!installEvent) return;
      installEvent.prompt();
      installEvent.userChoice.then(function () {
        installEvent = null;
        hideInstall();
      }).catch(function () {});
    });
  }

  window.addEventListener('appinstalled', function () {
    installEvent = null;
    hideInstall();
  });

  /* Офлайн-режим: кэшируем приложение и Python. */
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // file:// не умеет service worker

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* без офлайн-режима игра всё равно работает */
    });
  });
})();
