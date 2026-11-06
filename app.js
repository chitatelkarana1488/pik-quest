/* Пик-Квест — приложение: экран, анимация, прогресс. */
(function () {
  'use strict';

  var LEVELS = window.LEVELS || [];
  var SAVE_KEY = 'pikquest.save.v1';

  var CMDS = {
    move: { sig: 'move()', desc: 'Шаг вперёд на одну клетку.' },
    turn_left: { sig: 'turn_left()', desc: 'Повернуться налево на месте.' },
    turn_right: { sig: 'turn_right()', desc: 'Повернуться направо на месте.' },
    wall_ahead: { sig: 'wall_ahead()', desc: 'True, если прямо перед Пиком стена.' },
    crystal_ahead: { sig: 'crystal_ahead()', desc: 'True, если прямо впереди кристалл.' },
    crystals_left: { sig: 'crystals_left()', desc: 'Сколько кристаллов ещё не собрано.' },
    at_goal: { sig: 'at_goal()', desc: 'True, если Пик стоит на портале.' },
    print: { sig: 'print(...)', desc: 'Вывести текст или число в консоль.' }
  };

  var CHEATS = [
    { sig: 'for i in range(3):', desc: 'Повторить блок 3 раза', code: 'for i in range(3):\n    ' },
    { sig: 'while not at_goal():', desc: 'Повторять, пока не дойдём', code: 'while not at_goal():\n    ' },
    { sig: 'if / else', desc: 'Ветвление по условию', code: 'if wall_ahead():\n    turn_right()\nelse:\n    move()' },
    { sig: 'def go(n):', desc: 'Своя функция', code: 'def go(n):\n    for i in range(n):\n        move()' }
  ];

  var el = {};
  var level = null;
  var sim = null;
  var view = { px: 1, py: 1, dir: 1, count: 0, collected: new Set() };
  var bot = null;
  var goalEl = null;
  var crystalEls = new Map();
  var editor = null;
  var running = false;
  var pyReady = false;
  var runToken = 0;

  var save = loadSave();

  /* ---------------- сохранение ---------------- */

  function defaultSave() {
    return { current: 1, done: {}, code: {}, seenIntro: false };
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var s = JSON.parse(raw);
      return {
        current: s.current || 1,
        done: s.done || {},
        code: s.code || {},
        seenIntro: !!s.seenIntro
      };
    } catch (e) {
      return defaultSave();
    }
  }

  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
    }, 120);
  }

  /* ---------------- утилиты ---------------- */

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function levelById(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return null;
  }

  function unlocked(id) {
    if (id === 1) return true;
    return save.done[id - 1] != null;
  }

  function setOverlay(id, show) {
    var node = document.getElementById(id);
    if (!node) return;
    if (show) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
  }

  /* ---------------- доска ---------------- */

  function buildBoard() {
    var st = sim.state;
    el.board.innerHTML = '';
    el.board.style.setProperty('--cols', st.w);
    el.board.style.setProperty('--rows', st.h);

    var frag = document.createDocumentFragment();
    for (var y = 0; y < st.h; y++) {
      for (var x = 0; x < st.w; x++) {
        var t = document.createElement('div');
        t.className = 'tile ' + (st.cells[y][x] === '#' ? 'wall' : 'floor');
        t.style.setProperty('--cx', x);
        t.style.setProperty('--cy', y);
        frag.appendChild(t);
      }
    }
    el.board.appendChild(frag);

    crystalEls.clear();
    st.crystals.forEach(function (key) {
      var p = key.split(',');
      var c = document.createElement('div');
      c.className = 'crystal';
      c.style.setProperty('--cx', p[0]);
      c.style.setProperty('--cy', p[1]);
      el.board.appendChild(c);
      crystalEls.set(key, c);
    });

    goalEl = document.createElement('div');
    goalEl.className = 'goal';
    goalEl.style.setProperty('--cx', st.goal.x);
    goalEl.style.setProperty('--cy', st.goal.y);
    el.board.appendChild(goalEl);

    bot = document.createElement('div');
    bot.className = 'robot';
    bot.innerHTML = '<div class="body"></div>';
    el.board.appendChild(bot);

    resetVisuals();
    fitBoard();
    requestAnimationFrame(fitBoard);
    setTimeout(fitBoard, 90);
  }

  function resetVisuals() {
    var st = sim.state;
    view.px = st.start.x;
    view.py = st.start.y;
    view.dir = 1;
    view.count = 0;
    view.collected = new Set();
    placeRobot();
    crystalEls.forEach(function (node) {
      node.classList.remove('pop');
      node.style.display = '';
    });
    if (goalEl) goalEl.classList.remove('open');
    updateHud();
  }

  function placeRobot() {
    if (!bot) return;
    bot.style.setProperty('--cx', view.px);
    bot.style.setProperty('--cy', view.py);
    bot.style.setProperty('--dir', view.dir);
  }

  function fitBoard() {
    if (!sim || !el.boardWrap) return;
    var st = sim.state;
    var rect = el.boardWrap.getBoundingClientRect();
    var pad = 30;
    var maxW = Math.max(100, rect.width - pad);
    var maxH = Math.max(100, rect.height - pad);
    var tile = Math.floor(Math.min(maxW / st.w, maxH / st.h));
    tile = Math.max(11, Math.min(tile, 62));
    el.board.style.setProperty('--tile', tile + 'px');
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    var st = sim.state;
    el.chipCrystals.textContent = '◆ ' + view.collected.size + '/' + st.total;
    el.chipActions.textContent = '⚡ ' + view.count;
    var rec = save.done[level.id];
    el.chipPar.textContent = 'рекорд ' + (rec != null ? rec : '—');
    if (st.total > 0 && view.collected.size === st.total) el.chipCrystals.classList.add('good');
    else el.chipCrystals.classList.remove('good');
  }

  /* ---------------- запуск ---------------- */

  function clearConsole() {
    el.console.innerHTML = '';
  }

  function logLine(text, cls) {
    var d = document.createElement('span');
    d.className = 'line ' + (cls || '');
    d.textContent = text;
    el.console.appendChild(d);
    el.console.scrollTop = el.console.scrollHeight;
  }

  function setBusy(b) {
    running = b;
    el.runBtn.disabled = b;
    el.runBtn.querySelector('.run-label').textContent = b ? '⏳ Пик идёт…' : '▶ Запустить';
  }

  async function ensurePython() {
    if (pyReady) return true;
    setOverlay('loadingOverlay', true);
    try {
      await window.PikPy.ensure(function (status) {
        var sub = document.getElementById('loaderSub');
        if (!sub) return;
        if (status === 'loading') sub.textContent = 'Скачиваю движок Python…';
        else if (status === 'boot') sub.textContent = 'Распаковываю Python (около 10 МБ)…';
        else if (status === 'compile') sub.textContent = 'Почти готово…';
      });
      pyReady = true;
      el.pyStatus.textContent = 'Python: готов';
      el.pyStatus.className = 'pill ok';
      setOverlay('loadingOverlay', false);
      return true;
    } catch (e) {
      setOverlay('loadingOverlay', false);
      el.pyStatus.textContent = 'Python: нет связи';
      el.pyStatus.className = 'pill err';
      logLine('Не удалось загрузить Python.', 'err');
      logLine('Нужен интернет: движок подгружается с cdn.jsdelivr.net.', 'err');
      logLine('Если открываешь файл напрямую и браузер ругается — запусти локальный сервер:', '');
      logLine('    python -m http.server 8000', 'ok');
      return false;
    }
  }

  async function runCode() {
    if (running || !level) return;

    if (!pyReady) {
      var ok = await ensurePython();
      if (!ok) return;
    }

    var token = ++runToken;
    setBusy(true);
    clearConsole();
    sim.reset();
    resetVisuals();

    if (window.innerWidth <= 980 && el.boardWrap && el.boardWrap.scrollIntoView) {
      try { el.boardWrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
    }

    var t0 = performance.now();
    var res;
    try {
      res = await window.PikPy.run(editor.getValue(), sim.api);
    } catch (e) {
      res = { error: (e && e.message) ? e.message : String(e), output: '' };
    }

    if (token !== runToken) return;

    var out = (res.output || '').replace(/\r/g, '');
    if (out.trim()) {
      out.replace(/\s+$/, '').split('\n').forEach(function (line) { logLine(line, ''); });
    }

    var actions = sim.state.actions.slice();
    await playActions(actions, token);
    if (token !== runToken) return;

    var st = sim.state;
    var won = view.px === st.goal.x && view.py === st.goal.y && view.collected.size === st.total && !st.error;

    if (res.error) {
      logLine('✖ ' + res.error, 'err');
    } else if (won) {
      logLine('✔ Портал открыт! Уровень пройден за ' + view.count + ' команд.', 'ok');
    } else if (view.px !== st.goal.x || view.py !== st.goal.y) {
      logLine('Пик остановился не на портале. Попробуй ещё раз.', '');
    } else {
      logLine('Портал закрыт: осталось кристаллов — ' + (st.total - view.collected.size) + '.', '');
    }

    if (res.error === '' && st.total - view.collected.size > 0 && view.px === st.goal.x && view.py === st.goal.y) {
      logLine('Сначала собери все кристаллы, потом входи в портал.', '');
    }

    var secs = ((performance.now() - t0) / 1000);
    if (won && secs > 0) {
      // лёгкая метрика в консоль — приятный штрих
      logLine('Время выполнения: ' + secs.toFixed(2) + ' с', '');
    }

    setBusy(false);

    if (won) {
      if (goalEl) goalEl.classList.add('open');
      var prev = save.done[level.id];
      if (prev == null || view.count < prev) save.done[level.id] = view.count;
      var idx = LEVELS.indexOf(level);
      var next = LEVELS[idx + 1];
      if (next && save.current <= level.id) save.current = next.id;
      persist();
      updateHud();
      setTimeout(function () { showWin(); }, 620);
    }
  }

  function playActions(actions, token) {
    return new Promise(function (resolve) {
      var i = 0;
      var n = actions.length;
      var delay = n > 80 ? 24 : n > 45 ? 36 : n > 18 ? 60 : 110;
      var lastTurn = 0;

      function step() {
        if (token !== runToken || !running) { resolve(); return; }
        if (i >= n) { resolve(); return; }
        var a = actions[i++];

        if (a.t === 'm') {
          view.px = a.x;
          view.py = a.y;
          view.count++;
          placeRobot();
          if (a.got) {
            view.collected.add(a.x + ',' + a.y);
            popCrystal(a.x + ',' + a.y);
          }
          updateHud();
        } else if (a.t === 't') {
          view.dir = a.dir;
          view.count++;
          placeRobot();
          updateHud();
          lastTurn = Date.now();
        } else if (a.t === 'bump') {
          bumpRobot();
          view.count++;
          updateHud();
        }

        var wait = delay;
        if (Date.now() - lastTurn < 40) wait = Math.min(wait, 45);
        setTimeout(step, wait);
      }
      step();
    });
  }

  function popCrystal(key) {
    var node = crystalEls.get(key);
    if (!node) return;
    node.classList.add('pop');
    setTimeout(function () { node.style.display = 'none'; }, 480);
  }

  function bumpRobot() {
    if (!bot) return;
    bot.classList.remove('bump');
    void bot.offsetWidth;
    bot.classList.add('bump');
    setTimeout(function () { bot.classList.remove('bump'); }, 380);
  }

  /* ---------------- уровни ---------------- */

  function showLevel(id) {
    var lv = levelById(id) || LEVELS[0];
    level = lv;
    sim = window.PikSim.create(lv);
    runToken++;
    running = false;
    setBusy(false);

    el.chapterName.textContent = lv.chapterTitle + ' · ' + lv.id + '/' + LEVELS.length;
    el.levelTitle.textContent = lv.title;
    el.story.innerHTML = '<span class="who">Пик:</span> ' + lv.story;
    el.hintBox.hidden = true;
    el.hintBox.textContent = lv.hint;
    el.hintBtn.textContent = '💡 Подсказка';

    buildBoard();
    buildPalette();

    var saved = save.code[lv.id];
    editor.setValue(saved != null ? saved : lv.starter);
    clearConsole();
    logLine('Задача: ' + lv.task, 'ok');

    save.current = lv.id;
    persist();
    renderMap();

    try { history.replaceState(null, '', '#level=' + lv.id); } catch (e) { /* ignore */ }
  }

  function buildPalette() {
    el.palette.innerHTML = '';
    var list = (level.api || []).slice();
    if (list.indexOf('print') === -1) list.push('print');

    list.forEach(function (name) {
      var c = CMDS[name];
      if (!c) return;
      var b = document.createElement('button');
      b.className = 'cmd';
      b.type = 'button';
      var sig = document.createElement('div');
      sig.className = 'sig';
      sig.textContent = c.sig;
      var desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = c.desc;
      b.appendChild(sig);
      b.appendChild(desc);
      b.addEventListener('click', function () {
        editor.insert(name + '()');
        switchTab('code');
      });
      el.palette.appendChild(b);
    });

    if (level.id >= 5) {
      var head = document.createElement('div');
      head.className = 'sheet-head';
      head.style.gridColumn = '1 / -1';
      head.style.padding = '10px 0 2px';
      head.style.borderBottom = '0';
      head.innerHTML = '<h2 style="font-size:12px;letter-spacing:.16em;color:#8b9cbd;text-transform:uppercase">Шпаргалка</h2>';
      el.palette.appendChild(head);

      CHEATS.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'cmd';
        b.type = 'button';
        var sig = document.createElement('div');
        sig.className = 'sig';
        sig.textContent = c.sig;
        var desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = c.desc;
        b.appendChild(sig);
        b.appendChild(desc);
        b.addEventListener('click', function () {
          editor.insert(c.code);
          switchTab('code');
        });
        el.palette.appendChild(b);
      });
    }
  }

  /* ---------------- карта ---------------- */

  function renderMap() {
    if (!el.mapBody) return;
    el.mapBody.innerHTML = '';

    var chapters = [];
    LEVELS.forEach(function (lv) {
      var ch = chapters.filter(function (c) { return c.num === lv.chapter; })[0];
      if (!ch) {
        ch = { num: lv.chapter, title: lv.chapterTitle, items: [] };
        chapters.push(ch);
      }
      ch.items.push(lv);
    });

    chapters.forEach(function (ch) {
      var block = document.createElement('div');
      block.className = 'chapter-block';
      var h = document.createElement('h3');
      h.textContent = ch.title;
      block.appendChild(h);

      var grid = document.createElement('div');
      grid.className = 'levels';

      ch.items.forEach(function (lv) {
        var open = unlocked(lv.id);
        var b = document.createElement('button');
        b.className = 'lvl-card' + (save.done[lv.id] != null ? ' done' : '') + (lv.id === save.current ? ' current' : '');
        b.disabled = !open;
        b.type = 'button';

        var num = document.createElement('div');
        num.className = 'num';
        num.textContent = 'УРОВЕНЬ ' + String(lv.id).padStart(2, '0') + (save.done[lv.id] != null ? '  ✔' : open ? '' : '  🔒');

        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = lv.title;

        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = save.done[lv.id] != null
          ? 'лучший результат: ' + save.done[lv.id]
          : lv.task;

        b.appendChild(num);
        b.appendChild(name);
        b.appendChild(meta);
        b.addEventListener('click', function () {
          setOverlay('mapOverlay', false);
          showLevel(lv.id);
        });
        grid.appendChild(b);
      });

      block.appendChild(grid);
      el.mapBody.appendChild(block);
    });
  }

  /* ---------------- победа ---------------- */

  function showWin() {
    var idx = LEVELS.indexOf(level);
    var next = LEVELS[idx + 1];
    var rec = save.done[level.id];

    var emojis = ['🏆', '⭐', '🚀', '💎', '🥇', '🎉'];
    el.winEmoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];

    if (!next) {
      el.winTitle.textContent = 'Пифония починена!';
      el.winText.textContent = 'Ты прошёл все уровни и собрал все кристаллы. Глитч побеждён, а Пик теперь умеет всё — потому что ты научил его думать кодом.';
    } else {
      el.winTitle.textContent = 'Уровень пройден!';
      el.winText.textContent = pickPraise(rec, level.par);
    }

    el.winStats.innerHTML = '';
    addStat('⚡ команд: ' + view.count);
    addStat('🎯 идеал: ' + level.par);
    if (sim.state.total > 0) addStat('◆ кристаллов: ' + view.collected.size + '/' + sim.state.total);

    el.winNextBtn.textContent = next ? 'Дальше →' : 'К карте';
    el.winNextBtn.onclick = function () {
      setOverlay('winOverlay', false);
      if (next) showLevel(next.id);
      else setOverlay('mapOverlay', true);
    };
    el.winMapBtn.onclick = function () {
      setOverlay('winOverlay', false);
      setOverlay('mapOverlay', true);
    };

    setOverlay('winOverlay', true);
  }

  function addStat(text) {
    var s = document.createElement('span');
    s.className = 'chip';
    s.textContent = text;
    el.winStats.appendChild(s);
  }

  function pickPraise(rec, par) {
    if (rec != null && rec <= par) return 'Идеальное решение — ни одной лишней команды. Пик гордится тобой!';
    if (rec != null && rec <= par + 4) return 'Отличная работа! Совсем немного команд — почти идеал.';
    return 'Портал открыт, кристаллы собраны. Попробуй пройти уровень меньшим числом команд!';
  }

  /* ---------------- вкладки ---------------- */

  function switchTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    $$('.pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === name); });
  }

  /* ---------------- старт ---------------- */

  function boot() {
    el = {
      chapterName: $('#chapterName'),
      levelTitle: $('#levelTitle'),
      story: $('#story'),
      board: $('#board'),
      boardWrap: $('#boardWrap'),
      chipCrystals: $('#chipCrystals'),
      chipActions: $('#chipActions'),
      chipPar: $('#chipPar'),
      hintBox: $('#hintBox'),
      hintBtn: $('#hintBtn'),
      restartBtn: $('#restartBtn'),
      console: $('#console'),
      palette: $('#palette'),
      runBtn: $('#runBtn'),
      mapBtn: $('#mapBtn'),
      mapBody: $('#mapBody'),
      mapOverlay: $('#mapOverlay'),
      winEmoji: $('#winEmoji'),
      winTitle: $('#winTitle'),
      winText: $('#winText'),
      winStats: $('#winStats'),
      winNextBtn: $('#winNextBtn'),
      winMapBtn: $('#winMapBtn'),
      pyStatus: $('#pyStatus'),
      loadingOverlay: $('#loadingOverlay'),
      introOverlay: $('#introOverlay')
    };

    editor = window.PikEditor.create(
      document.getElementById('code'),
      document.querySelector('.editor .hl'),
      document.getElementById('hlCode')
    );

    // сохранять код уровня при вводе
    var codeTimer = null;
    document.getElementById('code').addEventListener('input', function () {
      clearTimeout(codeTimer);
      codeTimer = setTimeout(function () {
        if (!level) return;
        save.code[level.id] = editor.getValue();
        persist();
      }, 400);
    });

    el.runBtn.addEventListener('click', runCode);

    el.hintBtn.addEventListener('click', function () {
      var showing = !el.hintBox.hidden;
      el.hintBox.hidden = showing;
      el.hintBtn.textContent = showing ? '💡 Подсказка' : '🙈 Скрыть подсказку';
    });

    el.restartBtn.addEventListener('click', function () {
      if (running) return;
      sim.reset();
      resetVisuals();
      clearConsole();
      logLine('Поле сброшено. Задача: ' + level.task, 'ok');
    });

    document.getElementById('resetCodeBtn').addEventListener('click', function () {
      if (!level) return;
      editor.setValue(level.starter);
      save.code[level.id] = level.starter;
      persist();
    });

    document.getElementById('tabKey').addEventListener('click', function () {
      editor.insert('    ');
    });

    el.mapBtn.addEventListener('click', function () { setOverlay('mapOverlay', true); });

    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { setOverlay(b.dataset.close, false); });
    });

    document.getElementById('wipeBtn').addEventListener('click', function () {
      if (!confirm('Сбросить весь прогресс и открытые уровни?')) return;
      localStorage.removeItem(SAVE_KEY);
      save = defaultSave();
      setOverlay('mapOverlay', false);
      showLevel(1);
      setOverlay('introOverlay', true);
    });

    document.getElementById('introStart').addEventListener('click', function () {
      save.seenIntro = true;
      persist();
      setOverlay('introOverlay', false);
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runCode();
      }
      if (e.key === 'Escape') {
        setOverlay('winOverlay', false);
        setOverlay('mapOverlay', false);
      }
    });

    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { fitBoard(); });
      ro.observe(el.boardWrap);
    }
    window.addEventListener('resize', fitBoard);
    window.addEventListener('load', fitBoard);
    window.addEventListener('orientationchange', function () { setTimeout(fitBoard, 250); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) fitBoard(); });
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fitBoard).catch(function () {}); }
    setTimeout(fitBoard, 400);
    setTimeout(fitBoard, 1200);

    // стартовый уровень: #level=N или сохранённый
    var hash = /level=(\d+)/.exec(location.hash || '');
    var wantMap = /(^#|\&)map\b/.test(location.hash || '');
    var startId = hash ? parseInt(hash[1], 10) : save.current;
    if (!levelById(startId)) startId = 1;
    showLevel(startId);
    if (wantMap) setOverlay('mapOverlay', true);

    // переход по ссылке #level=N или кнопками «назад/вперёд»
    window.addEventListener('hashchange', function () {
      var m = /level=(\d+)/.exec(location.hash || '');
      if (!m) return;
      var id = parseInt(m[1], 10);
      if (levelById(id) && (!level || level.id !== id)) showLevel(id);
    });

    if (!save.seenIntro && !hash) {
      setTimeout(function () { setOverlay('introOverlay', true); }, 250);
    }

    // грузим Python в фоне
    el.pyStatus.textContent = 'Python: загрузка…';
    window.PikPy.ensure(function (status) {
      if (status === 'ready') {
        pyReady = true;
        el.pyStatus.textContent = 'Python: готов';
        el.pyStatus.className = 'pill ok';
      } else if (status === 'error') {
        el.pyStatus.textContent = 'Python: нет связи';
        el.pyStatus.className = 'pill err';
      }
    }).catch(function () {
      el.pyStatus.textContent = 'Python: нет связи';
      el.pyStatus.className = 'pill err';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
