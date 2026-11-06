/* Пик-Квест — игровая логика лабиринта (без DOM).
   Используется и страницей, и (при желании) тестами. */
(function (global) {
  'use strict';

  var DX = [0, 1, 0, -1]; // 0 = вверх, 1 = вправо, 2 = вниз, 3 = влево
  var DY = [-1, 0, 1, 0];

  function create(level) {
    var rows = level.grid.map(function (r) { return r.split(''); });
    var h = rows.length;
    var w = rows[0].length;

    var start = { x: 1, y: 1 };
    var goal = { x: 1, y: 1 };
    var crystals = new Set();

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y][x];
        if (ch === 'P') { start = { x: x, y: y }; rows[y][x] = '.'; }
        else if (ch === 'G') { goal = { x: x, y: y }; }
        else if (ch === '*') { crystals.add(x + ',' + y); }
      }
    }

    var total = crystals.size;

    var state = {
      w: w, h: h,
      cells: rows,
      crystals: crystals,
      start: start,
      goal: goal,
      total: total,
      px: start.x,
      py: start.y,
      dir: 1,
      actions: [],
      count: 0,
      error: null,
      collected: new Set(),
      limit: 800
    };

    function blocked(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return true;
      return rows[y][x] === '#';
    }

    function fail(msg) {
      state.error = msg;
      state.actions.push({ t: 'error' });
      return msg;
    }

    function tick() {
      state.count++;
      if (state.count > state.limit) {
        return 'Слишком много команд за один запуск (лимит ' + state.limit + '). Похоже, цикл никогда не заканчивается.';
      }
      return null;
    }

    var api = {
      move: function () {
        if (state.error) return state.error;
        var over = tick();
        if (over) return fail(over);
        var nx = state.px + DX[state.dir];
        var ny = state.py + DY[state.dir];
        if (blocked(nx, ny)) {
          state.actions.push({ t: 'bump', dir: state.dir });
          return fail('Ой! Пик врезался в стену.');
        }
        var key = nx + ',' + ny;
        var got = crystals.has(key) && !state.collected.has(key);
        if (got) state.collected.add(key);
        state.px = nx;
        state.py = ny;
        state.actions.push({ t: 'm', x: nx, y: ny, got: got });
        return null;
      },

      turn_left: function () {
        if (state.error) return state.error;
        var over = tick();
        if (over) return fail(over);
        state.dir = (state.dir + 3) % 4;
        state.actions.push({ t: 't', dir: state.dir });
        return null;
      },

      turn_right: function () {
        if (state.error) return state.error;
        var over = tick();
        if (over) return fail(over);
        state.dir = (state.dir + 1) % 4;
        state.actions.push({ t: 't', dir: state.dir });
        return null;
      },

      wall_ahead: function () {
        return blocked(state.px + DX[state.dir], state.py + DY[state.dir]);
      },

      crystal_ahead: function () {
        var key = (state.px + DX[state.dir]) + ',' + (state.py + DY[state.dir]);
        return crystals.has(key) && !state.collected.has(key);
      },

      crystals_left: function () {
        return total - state.collected.size;
      },

      at_goal: function () {
        return state.px === goal.x && state.py === goal.y;
      }
    };

    function reset() {
      state.px = start.x;
      state.py = start.y;
      state.dir = 1;
      state.actions = [];
      state.count = 0;
      state.error = null;
      state.collected = new Set();
    }

    return {
      state: state,
      api: api,
      reset: reset,
      blocked: blocked
    };
  }

  global.PikSim = { create: create, DX: DX, DY: DY };
})(typeof window !== 'undefined' ? window : globalThis);
