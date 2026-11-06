/* Пик-Квест — лёгкий редактор кода с подсветкой синтаксиса. */
(function (global) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return ESC[c]; }); }

  var RE = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(def|return|if|elif|else|for|while|in|not|and|or|True|False|None|break|continue|pass|import|from|as|global|lambda|try|except|finally|with|class|is|del|raise)\b|\b(range|print|len|int|str|float|bool|list|dict|set|tuple|abs|min|max|sum|enumerate|input|type|round|sorted)\b|\b(move|turn_left|turn_right|wall_ahead|crystal_ahead|crystals_left|at_goal)\b|\b(\d+(?:\.\d+)?)\b/g;

  function highlight(code) {
    var out = '';
    var last = 0;
    var m;
    RE.lastIndex = 0;
    while ((m = RE.exec(code)) !== null) {
      out += esc(code.slice(last, m.index));
      var cls = m[1] ? 'c-com'
        : m[2] ? 'c-str'
        : m[3] ? 'c-kw'
        : m[4] ? 'c-bi'
        : m[5] ? 'c-api'
        : 'c-num';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    return out;
  }

  function create(ta, pre, codeEl) {
    var syncing = false;

    function paint() {
      codeEl.innerHTML = highlight(ta.value) + '\n';
      sync();
    }

    function sync() {
      if (syncing) return;
      syncing = true;
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      syncing = false;
    }

    function setValue(v) {
      ta.value = v;
      ta.scrollTop = 0;
      ta.scrollLeft = 0;
      paint();
    }

    function insert(text) {
      var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      ta.value = v.slice(0, s) + text + v.slice(e);
      var pos = s + text.length;
      ta.selectionStart = ta.selectionEnd = pos;
      paint();
      ta.focus();
    }

    function indentBlock(dedent) {
      var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      var start = v.lastIndexOf('\n', s - 1) + 1;
      var end = v.indexOf('\n', e);
      if (end === -1) end = v.length;
      var block = v.slice(start, end);
      var lines = block.split('\n');
      var changed = lines.map(function (l) {
        if (dedent) return l.replace(/^( {1,4}|\t)/, '');
        return '    ' + l;
      });
      var next = changed.join('\n');
      ta.value = v.slice(0, start) + next + v.slice(end);
      ta.selectionStart = start;
      ta.selectionEnd = start + next.length;
      paint();
    }

    function currentIndent() {
      var v = ta.value, s = ta.selectionStart;
      var start = v.lastIndexOf('\n', s - 1) + 1;
      var line = v.slice(start, s);
      var m = line.match(/^[ \t]*/);
      return m ? m[0] : '';
    }

    ta.addEventListener('input', paint);
    ta.addEventListener('scroll', sync);

    ta.addEventListener('keydown', function (e) {
      var v = ta.value;

      if (e.key === 'Tab') {
        e.preventDefault();
        if (ta.selectionStart !== ta.selectionEnd && v.slice(ta.selectionStart, ta.selectionEnd).indexOf('\n') !== -1) {
          indentBlock(e.shiftKey);
        } else if (e.shiftKey) {
          indentBlock(true);
        } else {
          insert('    ');
        }
        return;
      }

      if (e.key === 'Enter') {
        var selStart = ta.selectionStart, selEnd = ta.selectionEnd;
        var lineStart = v.lastIndexOf('\n', selStart - 1) + 1;
        var line = v.slice(lineStart, selStart);
        var indent = (line.match(/^[ \t]*/) || [''])[0];
        var extra = /:\s*(#.*)?$/.test(line) ? '    ' : '';
        if (indent === '' && extra === '') return; // обычный перенос
        e.preventDefault();
        insert('\n' + indent + extra);
        return;
      }

      if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
        var s2 = ta.selectionStart;
        var lineStart2 = v.lastIndexOf('\n', s2 - 1) + 1;
        var before = v.slice(lineStart2, s2);
        if (before.length > 0 && /^ +$/.test(before) && before.length % 4 === 0) {
          e.preventDefault();
          ta.value = v.slice(0, s2 - 4) + v.slice(s2);
          ta.selectionStart = ta.selectionEnd = s2 - 4;
          paint();
          return;
        }
      }

      // автозакрытие кавычек и скобок
      if (e.key === '"' || e.key === "'" || e.key === '(' || e.key === '[') {
        var s3 = ta.selectionStart, e3 = ta.selectionEnd;
        var pair = { '"': '"', "'": "'", '(': ')', '[': ']' }[e.key];
        e.preventDefault();
        var sel = v.slice(s3, e3);
        ta.value = v.slice(0, s3) + e.key + sel + pair + v.slice(e3);
        ta.selectionStart = s3 + 1;
        ta.selectionEnd = s3 + 1 + sel.length;
        paint();
        return;
      }
    });

    // Enter на мобильной клавиатуре иногда не даёт keydown — ловим по вставке
    ta.addEventListener('beforeinput', function (e) {
      if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
      var v = ta.value, s = ta.selectionStart;
      var lineStart = v.lastIndexOf('\n', s - 1) + 1;
      var line = v.slice(lineStart, s);
      var indent = (line.match(/^[ \t]*/) || [''])[0];
      var extra = /:\s*$/.test(line) ? '    ' : '';
      if (!indent && !extra) return;
      e.preventDefault();
      insert('\n' + indent + extra);
    });

    return {
      paint: paint,
      setValue: setValue,
      insert: insert,
      focus: function () { ta.focus(); },
      getValue: function () { return ta.value; },
      textarea: ta
    };
  }

  global.PikEditor = { create: create, highlight: highlight };
})(typeof window !== 'undefined' ? window : globalThis);
