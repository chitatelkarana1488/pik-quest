/* Пик-Квест — запуск настоящего Python в браузере через Pyodide. */
(function (global) {
  'use strict';

  var BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

  var py = null;
  var initPromise = null;
  var runFn = null;
  var outBuf = '';
  var statusCb = null;

  function setStatus(s) {
    if (typeof statusCb === 'function') statusCb(s);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(s);
    });
  }

  var RUNNER_SRC = [
    'import sys, traceback, time',
    '',
    'class _Stop(Exception):',
    '    pass',
    '',
    'class _TimeLimit(Exception):',
    '    pass',
    '',
    "_state = {'lines': 0, 't0': 0.0}",
    '',
    'def _tracer(frame, event, arg):',
    "    if event == 'line':",
    "        _state['lines'] += 1",
    "        if _state['lines'] > 120000:",
    '            raise _TimeLimit()',
    "        if _state['lines'] % 200 == 0:",
    "            if time.monotonic() - _state['t0'] > 6.0:",
    '                raise _TimeLimit()',
    '    return _tracer',
    '',
    'def _wrap(fn):',
    '    def inner(*args):',
    '        res = fn(*args)',
    '        if res:',
    '            raise _Stop(str(res))',
    '        return None',
    '    return inner',
    '',
    'def _run_user_code():',
    '    api = _api',
    "    ns = {'__name__': '__main__'}",
    "    ns['move'] = _wrap(api.move)",
    "    ns['turn_left'] = _wrap(api.turn_left)",
    "    ns['turn_right'] = _wrap(api.turn_right)",
    "    ns['wall_ahead'] = lambda: bool(api.wall_ahead())",
    "    ns['crystal_ahead'] = lambda: bool(api.crystal_ahead())",
    "    ns['crystals_left'] = lambda: int(api.crystals_left())",
    "    ns['at_goal'] = lambda: bool(api.at_goal())",
    '',
    "    _state['lines'] = 0",
    "    _state['t0'] = time.monotonic()",
    '',
    '    try:',
    '        sys.settrace(_tracer)',
    '        try:',
    "            exec(compile(USER_CODE, 'level.py', 'exec'), ns)",
    '        finally:',
    '            sys.settrace(None)',
    "        return ''",
    '    except _Stop as e:',
    '        return str(e)',
    '    except _TimeLimit:',
    "        return 'Программа выполняется слишком долго. Проверь циклы: возможно, while никогда не заканчивается.'",
    '    except SyntaxError as e:',
    "        return 'Синтаксис, строка %s: %s' % (e.lineno or '?', e.msg)",
    '    except Exception as e:',
    '        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "level.py"]',
    '        if frames:',
    '            last = frames[-1]',
    "            return 'Строка %s: %s: %s' % (last.lineno, type(e).__name__, e)",
    "        return '%s: %s' % (type(e).__name__, e)",
    ''
  ].join('\n');

  function ensure(cb) {
    if (typeof cb === 'function') statusCb = cb;
    if (py && runFn) {
      setStatus('ready');
      return Promise.resolve();
    }
    if (initPromise) return initPromise;

    initPromise = (async function () {
      try {
        setStatus('loading');
        if (typeof global.loadPyodide === 'undefined') {
          await loadScript(BASE + 'pyodide.js');
        }
        setStatus('boot');
        py = await global.loadPyodide({
          indexURL: BASE,
          stdout: function (s) { outBuf += s + '\n'; },
          stderr: function (s) { outBuf += s + '\n'; }
        });
        setStatus('compile');
        py.runPython(RUNNER_SRC);
        runFn = py.globals.get('_run_user_code');
        setStatus('ready');
      } catch (e) {
        py = null;
        initPromise = null;
        setStatus('error');
        throw e;
      }
    })();

    return initPromise;
  }

  async function run(code, api) {
    if (!py || !runFn) throw new Error('Python ещё не загружен');
    outBuf = '';
    py.globals.set('USER_CODE', code);
    py.globals.set('_api', api);
    var err = '';
    try {
      err = runFn() || '';
    } catch (e) {
      err = (e && e.message) ? e.message : String(e);
    }
    try {
      py.globals.delete('USER_CODE');
      py.globals.delete('_api');
    } catch (e) { /* ignore */ }
    return { error: err ? String(err) : '', output: outBuf };
  }

  global.PikPy = {
    ensure: ensure,
    run: run,
    isReady: function () { return !!runFn; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
