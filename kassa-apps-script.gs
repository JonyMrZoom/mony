/**
 * Приёмник записей из приложения «Касса» в таблицу «Финансы_2026».
 *
 * Пишет во вкладку «Журнал» в колонки Дата, Контур, Тип, Источник / Статья,
 * Сумма ₽, Комментарий. Формулу в колонке «Месяц» не трогает, а если строка
 * ниже готового блока — проставляет её сама.
 *
 * Установка:
 * 1. Сделайте копию таблицы и настройте сначала на ней.
 * 2. Расширения → Apps Script → вставьте этот код вместо содержимого.
 * 3. Развернуть → Новое развёртывание → Веб-приложение.
 *    Запуск от имени: я. Доступ: все.
 * 4. Откройте полученную ссылку .../exec в браузере — она покажет,
 *    какие колонки скрипт распознал и куда положит следующую строку.
 * 5. Вставьте ссылку в приложении: шестерёнка → Google Таблица.
 */

var SHEET_NAME = 'Журнал';
var MONTH_HEADER = 'месяц';

// Вкладка «Настройки»: где лежат списки источников и статей
var SETTINGS_SHEET = 'Настройки';
var IN_COL = 5;    // столбец E — источники дохода
var IN_ROW = 6;    // первая строка списка
var IN_MAX = 15;   // до E20, дальше начинается служебная зона
var OUT_COL = 7;   // столбец G — статьи расходов
var OUT_ROW = 6;
var OUT_MAX = 16;  // до G21

var SYNONYMS = {
  date:   ['дата'],
  scope:  ['контур'],
  kind:   ['тип'],
  cat:    ['источник', 'статья'],
  amount: ['сумма'],
  note:   ['комментарий']
};

// ── Приём ───────────────────────────────────────────────────────────────────

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var payload = JSON.parse(e.postData.contents);
    var entries = payload.entries || [];
    var deletes = payload.deletes || [];
    var settings = payload.settings || null;
    var sh = sheet_();
    var head = header_(sh);
    var map = head.map;
    if (map.date === undefined || map.amount === undefined) {
      throw new Error('Не нашёл колонки «Дата» и «Сумма ₽» в шапке журнала');
    }

    var known = sentIds_();

    // 1. Удаления — до записи, чтобы освободившиеся строки можно было занять
    var removed = 0;
    deletes.forEach(function (d) {
      if (clearEntry_(sh, head, known, d)) removed++;
    });
    if (removed) known = sentIds_();

    // 2. Новые записи
    var added = 0;
    entries.forEach(function (x) {
      if (known[String(x.id)]) return;
      var row = nextRow_(sh, head);
      writeRow_(sh, row, head, x);
      logId_(x.id, row);
      known[String(x.id)] = { row: row };
      added++;
    });

    // 3. Справочники
    var lists = settings ? syncSettings_(settings) : null;

    return json_({ ok: true, added: added, removed: removed, lists: lists });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ── Удаление строки ─────────────────────────────────────────────────────────

// Чистит ячейки записи. Строку не удаляем: это сдвинуло бы остальные и сломало
// сохранённые номера. Пустая строка потом переиспользуется под новую запись.
function clearEntry_(sh, head, known, d) {
  var row = known[String(d.id)] && known[String(d.id)].row;
  if (row && !matches_(sh, head, row, d)) row = null;
  if (!row) row = findRow_(sh, head, d);
  if (!row) return false;

  Object.keys(head.map).forEach(function (k) {
    sh.getRange(row, head.map[k] + 1).clearContent();
  });
  markDeleted_(d.id);
  return true;
}

function matches_(sh, head, row, d) {
  var m = head.map;
  var amount = sh.getRange(row, m.amount + 1).getValue();
  if (Math.abs(Number(amount) - Math.abs(Number(d.amount))) > 0.01) return false;
  var date = sh.getRange(row, m.date + 1).getValue();
  if (!(date instanceof Date) || !d.ts) return true;
  return Math.abs(date.getTime() - d.ts) < 86400000;
}

// Запасной путь: ищем по дате и сумме, если номер строки устарел.
function findRow_(sh, head, d) {
  var start = head.row + 1;
  var last = sh.getLastRow();
  if (last < start) return null;
  var m = head.map;
  var dates = sh.getRange(start, m.date + 1, last - start + 1, 1).getValues();
  var sums = sh.getRange(start, m.amount + 1, last - start + 1, 1).getValues();
  for (var i = 0; i < sums.length; i++) {
    if (Math.abs(Number(sums[i][0]) - Math.abs(Number(d.amount))) > 0.01) continue;
    var dt = dates[i][0];
    if (dt instanceof Date && d.ts && Math.abs(dt.getTime() - d.ts) > 86400000) continue;
    return start + i;
  }
  return null;
}

// ── Справочники ─────────────────────────────────────────────────────────────

// Переписывает списки источников и статей на вкладке «Настройки».
function syncSettings_(settings) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  if (!sh) return { error: 'Вкладка «' + SETTINGS_SHEET + '» не найдена' };
  var res = {};
  res.in = writeList_(sh, IN_COL, IN_ROW, IN_MAX, settings.in || []);
  res.out = writeList_(sh, OUT_COL, OUT_ROW, OUT_MAX, settings.out || []);
  return res;
}

function writeList_(sh, col, row, max, list) {
  if (list.length > max) return 'больше ' + max + ' — лишнее не записано';
  var values = [];
  for (var i = 0; i < max; i++) values.push([i < list.length ? list[i] : '']);
  sh.getRange(row, col, max, 1).setValues(values);
  return list.length;
}

// ── Отдача данных в приложение ──────────────────────────────────────────────

function pullPayload_() {
  var sh = sheet_();
  var head = header_(sh);
  var m = head.map;
  var start = head.row + 1;
  var last = sh.getLastRow();
  var rows = [];

  if (last >= start) {
    var width = Math.max(sh.getLastColumn(), 1);
    var block = sh.getRange(start, 1, last - start + 1, width).getValues();
    var rowToId = idsByRow_();
    for (var i = 0; i < block.length; i++) {
      var r = block[i];
      var amount = r[m.amount];
      var date = r[m.date];
      if (amount === '' && date === '') continue;
      var n = start + i;
      rows.push({
        row: n,
        id: rowToId[n] || null,
        ts: date instanceof Date ? date.getTime() : null,
        scope: m.scope === undefined ? '' : r[m.scope],
        kind: m.kind === undefined ? '' : r[m.kind],
        cat: m.cat === undefined ? '' : r[m.cat],
        amount: Number(amount) || 0,
        note: m.note === undefined ? '' : r[m.note]
      });
    }
  }

  return { ok: true, rows: rows.slice(-500), settings: readSettings_() };
}

function readSettings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  if (!sh) return null;
  var pick = function (col, row, max) {
    return sh.getRange(row, col, max, 1).getValues()
      .map(function (r) { return String(r[0] || '').trim(); })
      .filter(function (v) { return v !== ''; });
  };
  return { in: pick(IN_COL, IN_ROW, IN_MAX), out: pick(OUT_COL, OUT_ROW, OUT_MAX) };
}

function idsByRow_() {
  var sh = idSheet_();
  var last = sh.getLastRow();
  var out = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
      if (String(r[2]) === 'удалено') return;
      var n = Number(r[2]);
      if (n) out[n] = String(r[0]);
    });
  }
  return out;
}

// Проверка: откройте ссылку /exec в браузере. С ?pull=1 отдаёт данные приложению.
function doGet(e) {
  if (e && e.parameter && e.parameter.pull) {
    try {
      return json_(pullPayload_());
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }
  try {
    var sh = sheet_();
    var head = header_(sh);
    var seen = {};
    Object.keys(head.map).forEach(function (k) {
      seen[k] = head.titles[head.map[k]] + ' (столбец ' + colLetter_(head.map[k] + 1) + ')';
    });
    return json_({
      ok: true,
      sheet: sh.getName(),
      headerRow: head.row,
      recognized: seen,
      monthColumn: head.month === undefined ? null : colLetter_(head.month + 1),
      nextRow: nextRow_(sh, head),
      alreadySent: Object.keys(sentIds_()).length,
      settingsSheet: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET)
        ? 'найдена'
        : 'НЕ найдена' 
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ── Запись строки ───────────────────────────────────────────────────────────

function writeRow_(sh, row, head, x) {
  var m = head.map;
  set_(sh, row, m.date, new Date(x.ts));
  set_(sh, row, m.scope, x.scope);
  set_(sh, row, m.kind, x.kind);
  set_(sh, row, m.cat, x.cat);
  set_(sh, row, m.amount, Math.abs(x.amount));
  set_(sh, row, m.note, x.note);

  // Колонка «Месяц» — формула, если её там ещё нет
  if (head.month !== undefined && m.date !== undefined) {
    var cell = sh.getRange(row, head.month + 1);
    if (!cell.getFormula()) {
      var a = colLetter_(m.date + 1) + row;
      cell.setFormula('=IF(' + a + '="","",EOMONTH(' + a + ',0))');
    }
  }
}

function set_(sh, row, col, value) {
  if (col === undefined || value === undefined || value === '') return;
  sh.getRange(row, col + 1).setValue(value);
}

// Первая строка, где пусты и дата, и сумма. Формула «Месяц» пустой не считается.
function nextRow_(sh, head) {
  var start = head.row + 1;
  var last = Math.max(sh.getLastRow(), start);
  var dCol = head.map.date + 1;
  var sCol = head.map.amount + 1;
  var d = sh.getRange(start, dCol, last - start + 1, 1).getValues();
  var v = sh.getRange(start, sCol, last - start + 1, 1).getValues();
  for (var i = 0; i < d.length; i++) {
    if (d[i][0] === '' && v[i][0] === '') return start + i;
  }
  return last + 1;
}

// ── Шапка ───────────────────────────────────────────────────────────────────

function sheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Не нашёл вкладку «' + SHEET_NAME + '»');
  return sh;
}

function header_(sh) {
  var depth = Math.min(15, Math.max(sh.getLastRow(), 1));
  var width = Math.max(sh.getLastColumn(), 1);
  var block = sh.getRange(1, 1, depth, width).getDisplayValues();
  var best = null;
  for (var i = 0; i < block.length; i++) {
    var map = mapRow_(block[i]);
    var score = Object.keys(map).length;
    if (!best || score > best.score) {
      best = { row: i + 1, titles: block[i], map: map, score: score };
    }
  }
  best.month = monthCol_(best.titles);
  return best;
}

function mapRow_(cells) {
  var map = {};
  cells.forEach(function (cell, i) {
    var t = String(cell || '').toLowerCase().trim();
    if (!t) return;
    Object.keys(SYNONYMS).forEach(function (key) {
      if (map[key] !== undefined) return;
      var hit = SYNONYMS[key].some(function (w) { return t.indexOf(w) !== -1; });
      if (hit) map[key] = i;
    });
  });
  return map;
}

function monthCol_(titles) {
  for (var i = 0; i < titles.length; i++) {
    if (String(titles[i] || '').toLowerCase().trim() === MONTH_HEADER) return i;
  }
  return undefined;
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

// ── Защита от дублей ────────────────────────────────────────────────────────

function idSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('_kassa_ids');
  if (!sh) {
    sh = ss.insertSheet('_kassa_ids');
    sh.appendRow(['id', 'записано', 'строка']);
    sh.hideSheet();
  }
  return sh;
}

function sentIds_() {
  var sh = idSheet_();
  var last = sh.getLastRow();
  var out = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
      if (String(r[2]) === 'удалено') return;
      out[String(r[0])] = { row: Number(r[2]) || null };
    });
  }
  return out;
}

function logId_(id, row) {
  idSheet_().appendRow([String(id), new Date(), row || '']);
}

function markDeleted_(id) {
  var sh = idSheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sh.getRange(i + 2, 3).setValue('удалено');
      return;
    }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
