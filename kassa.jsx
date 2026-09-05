import React, { useState, useEffect, useRef, useMemo } from "react";

const KEY = "kassa-v1";

const DEFAULTS = {
  accounts: [
    { id: "a1", name: "Т-Банк" },
    { id: "a2", name: "Сбер" },
    { id: "a3", name: "Наличные" },
    { id: "a4", name: "Р/с ИП", freeOnly: true, biz: true },
  ],
  presets: [
    { id: "p1", amount: 650, label: "Разовая тренировка", cat: "Тренировки и абонементы" },
    { id: "p3", amount: 4000, label: "Абонемент", cat: "Тренировки и абонементы" },
  ],
  cats: {
    in: [
      "Тренировки и абонементы",
      "Лагеря и кэмпы",
      "Одежда",
      "Разовые халтуры",
      "Долги и возвраты",
    ],
    out: [
      "Продукты",
      "Транспорт и бензин",
      "Кафе и рестораны",
      "Развлечения и поездки",
      "Одежда и обувь",
      "Здоровье и спорт",
      "Ремонт и дом",
      "Подарки",
      "Крупная покупка",
      "Аренда залов (разово)",
      "Выплаты людям",
      "Ткань и пошив",
      "Реклама (разово)",
      "Оборудование и инвентарь",
      "Налоги (разово)",
      "Прочее",
    ],
  },
  sheetUrl: "",
  entries: [],
  dels: [],
};

const ACCENTS = ["#C2410C", "#15803D", "#1D4ED8", "#7C3AED", "#0E7490", "#9D174D"];
const TINTS = ["#F4EAE3", "#E7EFE7", "#E7EAF3", "#EEE9F4", "#E4EEEF", "#F3E8EC"];
const KIND_RU = { in: "Приход", out: "Расход", self: "Изъятие себе" };

const delta = (e) => (e.kind === "in" ? e.amount : e.kind === "out" ? -e.amount : 0);
const sumColor = (e) =>
  e.kind === "in" ? "#15653F" : e.kind === "out" ? "#A33421" : "#5A625E";
const sumPrefix = (e) => (e.kind === "in" ? "" : e.kind === "out" ? "−" : "→ ");

const nf = new Intl.NumberFormat("ru-RU");
const money = (n) => nf.format(Math.round(n)) + " ₽";

const monthKey = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};
const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const monthName = (mk) => MONTHS[Number(mk.split("-")[1]) - 1] + " " + mk.split("-")[0];
const dayKey = (ts) => new Date(ts).toDateString();
const timeStr = (ts) =>
  new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (ts) => {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return "Сегодня";
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};

export default function Kassa() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("add");
  const [acct, setAcct] = useState(null);
  const [toast, setToast] = useState(null);
  const [pad, setPad] = useState(null);
  const [statMonth, setStatMonth] = useState(monthKey(Date.now()));
  const [sync, setSync] = useState({ state: "idle", msg: "" });
  const toastTimer = useRef(null);
  const syncTimer = useRef(null);
  const blocked = useRef(false);
  const touch = useRef(null);
  const [slide, setSlide] = useState(null);

  useEffect(() => {
    (async () => {
      let parsed = null;
      try {
        const res = await window.storage.get(KEY);
        parsed = res ? JSON.parse(res.value) : null;
      } catch (e) {
        parsed = null;
      }
      const merged = { ...DEFAULTS, ...(parsed || {}) };
      if (Array.isArray(merged.cats)) merged.cats = DEFAULTS.cats;
      if (!Array.isArray(merged.dels)) merged.dels = [];
      setData(merged);
      setAcct(merged.lastAcct || merged.accounts[0].id);
    })();
  }, []);

  const persist = async (next) => {
    setData(next);
    try {
      await window.storage.set(KEY, JSON.stringify(next));
    } catch (e) {
      setSync({ state: "err", msg: "Запись не сохранилась на устройстве" });
    }
  };

  const acctById = (id) => data?.accounts.find((a) => a.id === id);
  const acctName = (id) => acctById(id)?.name || "—";
  const acctColor = (id) => {
    const i = data ? data.accounts.findIndex((a) => a.id === id) : 0;
    return ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length];
  };

  /* ---------- обмен с таблицей ---------- */

  const push = async (silent = false) => {
    if (!data?.sheetUrl) {
      setView("settings");
      return;
    }
    const batch = data.entries.filter((e) => !e.sent);
    const dels = data.dels || [];
    const needCats = !!data.catsDirty;
    if (!batch.length && !dels.length && !needCats) {
      if (!silent) setSync({ state: "ok", msg: "Всё уже в таблице" });
      return;
    }
    setSync({ state: "run", msg: "Синхронизирую…" });

    const body = JSON.stringify({
      entries: batch.map((e) => ({
        id: e.id,
        ts: e.ts,
        time: timeStr(e.ts),
        kind: KIND_RU[e.kind] || "Приход",
        amount: e.amount,
        cat: e.kind === "self" ? "" : e.cat,
        scope: e.kind === "self" || acctById(e.acct)?.biz ? "Бизнес" : "Личное",
        note: [acctName(e.acct), e.note].filter(Boolean).join(" · "),
      })),
      deletes: dels,
      settings: needCats ? { in: data.cats.in, out: data.cats.out } : null,
    });

    let ok = false;
    let blind = false;
    try {
      const r = await fetch(data.sheetUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      });
      const j = await r.json();
      ok = !!j.ok;
      if (!ok) setSync({ state: "err", msg: j.error || "Таблица вернула ошибку" });
    } catch (e1) {
      try {
        await fetch(data.sheetUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body,
        });
        ok = true;
        blind = true;
      } catch (e2) {
        blocked.current = true;
        setSync({ state: "err", msg: "Таблица недоступна. Проверьте ссылку и доступ «Все»." });
      }
    }

    if (ok) {
      blocked.current = false;
      const ids = new Set(batch.map((e) => e.id));
      persist({
        ...data,
        entries: data.entries.map((e) => (ids.has(e.id) ? { ...e, sent: true } : e)),
        dels: [],
        catsDirty: false,
      });
      const parts = [];
      if (batch.length) parts.push("записей: " + batch.length);
      if (dels.length) parts.push("удалено: " + dels.length);
      if (needCats) parts.push("списки обновлены");
      setSync({
        state: "ok",
        msg: (blind ? "Отправлено — " : "В таблице — ") + parts.join(", "),
      });
    }
  };

  const pull = async (silent = false) => {
    if (!data?.sheetUrl) return;
    if (!silent) setSync({ state: "run", msg: "Читаю таблицу…" });
    let remote;
    try {
      const r = await fetch(data.sheetUrl + "?pull=1");
      remote = await r.json();
      if (!remote.ok) throw new Error(remote.error || "ошибка");
    } catch (err) {
      if (!silent)
        setSync({ state: "err", msg: "Не удалось прочитать таблицу: " + err.message });
      return;
    }

    const rows = remote.rows || [];
    const byKey = new Map(rows.map((r) => [r.id || "sr" + r.row, r]));
    const accByName = (name) =>
      data.accounts.find((a) => a.name.toLowerCase() === String(name || "").toLowerCase());

    const fromRow = (r, base) => {
      const parts = String(r.note || "").split(" · ");
      const hit = accByName(parts[0]);
      return {
        ...(base || {}),
        id: r.id || "sr" + r.row,
        ts: r.ts || base?.ts || Date.now(),
        amount: Math.abs(Number(r.amount) || 0),
        cat: r.cat || "",
        kind: r.kind === "Расход" ? "out" : r.kind === "Изъятие себе" ? "self" : "in",
        acct: hit ? hit.id : base?.acct || data.accounts[0].id,
        note: hit ? parts.slice(1).join(" · ") : r.note || "",
        sent: true,
      };
    };

    const local = [];
    let changed = 0;
    let gone = 0;
    data.entries.forEach((e) => {
      if (!e.sent) return local.push(e);
      const r = byKey.get(e.id);
      if (!r) {
        // строку стёрли в таблице — убираем и у себя, но только если чтение живое
        if (rows.length) return gone++;
        return local.push(e);
      }
      byKey.delete(e.id);
      const upd = fromRow(r, e);
      if (upd.amount !== e.amount || upd.cat !== e.cat || upd.kind !== e.kind) changed++;
      local.push(upd);
    });

    // строки, заведённые в таблице руками
    let fresh = 0;
    byKey.forEach((r) => {
      local.push(fromRow(r, null));
      fresh++;
    });

    local.sort((a, b) => b.ts - a.ts);

    const next = { ...data, entries: local };
    if (remote.settings && !data.catsDirty) {
      const inList = remote.settings.in || [];
      const outList = remote.settings.out || [];
      if (inList.length) next.cats = { in: inList, out: outList.length ? outList : data.cats.out };
    }
    persist(next);

    if (!silent || changed || gone || fresh) {
      const parts = [];
      if (fresh) parts.push("новых из таблицы: " + fresh);
      if (changed) parts.push("исправлено: " + changed);
      if (gone) parts.push("удалено: " + gone);
      setSync({
        state: "ok",
        msg: parts.length ? "Из таблицы — " + parts.join(", ") : "Совпадает с таблицей",
      });
    }
  };

  const syncNow = async () => {
    await push(false);
    await pull(false);
  };

  // разовое чтение при запуске
  const pulledOnce = useRef(false);
  useEffect(() => {
    if (!data?.sheetUrl || pulledOnce.current) return;
    pulledOnce.current = true;
    pull(true);
  }, [data]);

  useEffect(() => {
    if (!data?.sheetUrl || blocked.current) return;
    const pending =
      data.entries.some((e) => !e.sent) || (data.dels || []).length > 0 || data.catsDirty;
    if (!pending) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => push(true), 4000);
    return () => clearTimeout(syncTimer.current);
  }, [data]);

  /* ---------- операции ---------- */

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  };

  const add = (amount, cat, kind = "in", note = "") => {
    const entry = {
      id: "e" + Date.now() + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      amount: Number(amount),
      cat,
      kind,
      acct,
      note,
    };
    persist({ ...data, entries: [entry, ...data.entries], lastAcct: acct });
    showToast(entry);
  };

  const remove = (entry) => {
    const dels = entry.sent
      ? [...(data.dels || []), { id: entry.id, ts: entry.ts, amount: entry.amount }]
      : data.dels || [];
    persist({ ...data, entries: data.entries.filter((e) => e.id !== entry.id), dels });
    if (toast && toast.id === entry.id) setToast(null);
  };

  const setCats = (kind, list) =>
    persist({ ...data, cats: { ...data.cats, [kind]: list }, catsDirty: true });

  /* ---------- свайп по счетам ---------- */

  const onTouchStart = (ev) => {
    const t = ev.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (ev) => {
    if (!touch.current || view !== "add") return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 45) return;
    const i = data.accounts.findIndex((a) => a.id === acct);
    const n = data.accounts.length;
    const next = data.accounts[(i + (dx < 0 ? 1 : -1) + n) % n];
    setSlide(dx < 0 ? "left" : "right");
    setAcct(next.id);
  };

  const thisMonth = useMemo(() => {
    if (!data) return 0;
    const mk = monthKey(Date.now());
    return data.entries.filter((e) => monthKey(e.ts) === mk).reduce((s, e) => s + delta(e), 0);
  }, [data]);

  const todayEntries = useMemo(() => {
    if (!data) return [];
    const dk = dayKey(Date.now());
    return data.entries.filter((e) => dayKey(e.ts) === dk);
  }, [data]);

  if (!data) {
    return (
      <div style={S.shell}>
        <Style />
        <div style={{ padding: 40, color: "#7B8280" }}>Открываю кассу…</div>
      </div>
    );
  }

  const pending =
    data.entries.filter((e) => !e.sent).length + (data.dels || []).length;
  const tintIndex = Math.max(0, data.accounts.findIndex((a) => a.id === acct));
  const tint = TINTS[tintIndex % TINTS.length];

  return (
    <div style={{ ...S.shell, background: tint }}>
      <Style />
      <div style={S.frame}>
        <header style={S.header}>
          <div>
            <div style={S.headerLabel}>{monthName(monthKey(Date.now()))}</div>
            <div style={S.headerSum}>{money(thisMonth)}</div>
          </div>
          <div style={S.headerRight}>
            {data.sheetUrl && (
              <button className="k-pill" onClick={syncNow}>
                <span
                  className="k-dot"
                  style={{
                    background:
                      sync.state === "err" ? "#A33421" : pending ? "#C2410C" : "#15803D",
                  }}
                />
                {sync.state === "run" ? "Синхр." : pending ? "Таблица " + pending : "Таблица"}
              </button>
            )}
            <button
              className="k-icon"
              onClick={() => setView(view === "settings" ? "add" : "settings")}
              aria-label="Настройки"
            >
              ⚙
            </button>
          </div>
        </header>

        {sync.msg && (
          <div style={sync.state === "err" ? S.err : S.syncNote}>{sync.msg}</div>
        )}

        {view !== "settings" && (
          <div style={S.acctRow} role="group" aria-label="Куда пришли деньги">
            {data.accounts.map((a, i) => (
              <button
                key={a.id}
                className={"k-acct" + (acct === a.id ? " on" : "")}
                style={acct === a.id ? { borderColor: acctColor(a.id) } : {}}
                onClick={() => {
                  setSlide(i > tintIndex ? "left" : "right");
                  setAcct(a.id);
                }}
              >
                <span className="k-dot" style={{ background: acctColor(a.id) }} />
                {a.name}
              </button>
            ))}
          </div>
        )}

        <main style={S.main} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {view === "add" && (
            <div key={acct} className={slide ? "k-slide-" + slide : undefined}>
            <AddView
              data={data}
              add={add}
              activeAcct={acctById(acct)}
              todayEntries={todayEntries}
              acctName={acctName}
              acctColor={acctColor}
              onDelete={remove}
              openPad={() =>
                setPad({ amount: "", cat: data.cats.in[0], kind: "in", note: "" })
              }
            />
            </div>
          )}
          {view === "log" && (
            <LogView
              data={data}
              acctName={acctName}
              acctColor={acctColor}
              onDelete={remove}
            />
          )}
          {view === "stats" && (
            <StatsView
              data={data}
              month={statMonth}
              setMonth={setStatMonth}
              acctName={acctName}
              acctColor={acctColor}
            />
          )}
          {view === "settings" && (
            <SettingsView data={data} persist={persist} setCats={setCats} onPull={() => pull(false)} />
          )}
        </main>

        {toast && (
          <div style={S.toast} role="status">
            <span>
              {KIND_RU[toast.kind]} <b>{money(toast.amount)}</b>
              {toast.cat ? " · " + toast.cat : ""}
            </span>
            <button className="k-undo" onClick={() => remove(toast)}>
              Отменить
            </button>
          </div>
        )}

        <nav style={{ ...S.tabs, background: tint }}>
          {[
            ["add", "Запись"],
            ["log", "Все"],
            ["stats", "Итоги"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={"k-tab" + (view === id ? " on" : "")}
              onClick={() => setView(id)}
            >
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {pad && (
        <Pad
          data={data}
          state={pad}
          setState={setPad}
          onSave={(amount, cat, kind, note) => {
            add(amount, cat, kind, note);
            setPad(null);
          }}
          onClose={() => setPad(null)}
        />
      )}
    </div>
  );
}

/* ---------- строка операции ---------- */

function EntryRow({ e, acctName, acctColor, onDelete }) {
  return (
    <li style={S.row}>
      <span style={{ ...S.bar, background: acctColor(e.acct) }} />
      <span style={S.rowTime}>{timeStr(e.ts)}</span>
      <span style={S.rowCat}>
        {e.cat || KIND_RU[e.kind]}
        {e.note ? <em style={S.note}> · {e.note}</em> : null}
      </span>
      <span style={S.rowAcct}>{acctName(e.acct)}</span>
      <span style={{ ...S.rowSum, color: sumColor(e) }}>
        {sumPrefix(e)}
        {nf.format(e.amount)}
      </span>
      <button className="k-del" onClick={() => onDelete(e)} aria-label="Удалить запись">
        ✕
      </button>
    </li>
  );
}

/* ---------- экран записи ---------- */

function AddView({ data, add, activeAcct, todayEntries, acctName, acctColor, onDelete, openPad }) {
  const sum = todayEntries.reduce((s, e) => s + delta(e), 0);
  const freeOnly = !!activeAcct?.freeOnly;
  return (
    <>
      <div style={S.presets}>
        {!freeOnly &&
          data.presets.map((p) => (
            <button key={p.id} className="k-preset" onClick={() => add(p.amount, p.cat)}>
              <span className="k-preset-sum">{nf.format(p.amount)}</span>
              <span className="k-preset-label">{p.label}</span>
            </button>
          ))}
        <button className={"k-preset" + (freeOnly ? " solo" : " alt")} onClick={openPad}>
          <span className="k-preset-sum">···</span>
          <span className="k-preset-label">
            {freeOnly ? "Ввести поступление" : "Другая сумма"}
          </span>
        </button>
      </div>

      <div style={S.sectionHead}>
        <span>Сегодня · {todayEntries.length}</span>
        <span style={{ fontWeight: 700, color: "#16191A" }}>{money(sum)}</span>
      </div>

      {todayEntries.length === 0 ? (
        <p style={S.empty}>Пока пусто. Нажмите сумму выше — запись появится здесь.</p>
      ) : (
        <ul style={S.list}>
          {todayEntries.map((e) => (
            <EntryRow
              key={e.id}
              e={e}
              acctName={acctName}
              acctColor={acctColor}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      <p style={S.swipeHint}>Смахните влево или вправо, чтобы сменить счёт</p>
    </>
  );
}

/* ---------- клавиатура ---------- */

function Pad({ data, state, setState, onSave, onClose }) {
  const press = (d) => {
    if (d === "del") return setState({ ...state, amount: state.amount.slice(0, -1) });
    if (state.amount.length > 8) return;
    setState({ ...state, amount: (state.amount + d).replace(/^0+/, "") });
  };
  const value = Number(state.amount || 0);

  return (
    <div style={S.sheetWrap} onClick={onClose}>
      <div style={S.sheet} onClick={(ev) => ev.stopPropagation()}>
        <div style={S.grabber} />
        <div style={S.padTop}>
          <div style={S.kindSwitch}>
            {["in", "out", "self"].map((k) => (
              <button
                key={k}
                className={"k-kind" + (state.kind === k ? " on " + k : "")}
                onClick={() =>
                  setState({
                    ...state,
                    kind: k,
                    cat: k === "in" ? data.cats.in[0] : k === "out" ? data.cats.out[0] : "",
                  })
                }
              >
                {k === "self" ? "Себе" : KIND_RU[k]}
              </button>
            ))}
          </div>
          <div style={S.padSum}>{state.amount ? nf.format(value) : "0"} ₽</div>
        </div>

        {state.kind === "self" ? (
          <p style={S.hint}>
            Перевод с бизнес-счёта себе на карту. В журнал уйдёт строка «Изъятие себе» — в
            отчёте по бизнесу это ваша зарплата.
          </p>
        ) : (
          <div style={S.catRow}>
            {(state.kind === "in" ? data.cats.in : data.cats.out).map((c) => (
              <button
                key={c}
                className={"k-chip" + (state.cat === c ? " on" : "")}
                onClick={() => setState({ ...state, cat: c })}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <input
          className="k-input"
          placeholder="Комментарий: имя, за что"
          value={state.note}
          onChange={(ev) => setState({ ...state, note: ev.target.value })}
        />

        <div style={S.pad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"].map((d) => (
            <button key={d} className="k-key" onClick={() => press(d)}>
              {d === "del" ? "⌫" : d}
            </button>
          ))}
        </div>

        <div style={S.padActions}>
          <button className="k-ghost" onClick={onClose}>
            Закрыть
          </button>
          <button
            className="k-save"
            disabled={!value}
            onClick={() => onSave(value, state.cat, state.kind, state.note.trim())}
          >
            Записать
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- все записи ---------- */

function LogView({ data, acctName, acctColor, onDelete }) {
  const [q, setQ] = useState("");
  const filtered = data.entries.filter(
    (e) =>
      !q ||
      (e.cat || "").toLowerCase().includes(q.toLowerCase()) ||
      (e.note || "").toLowerCase().includes(q.toLowerCase()) ||
      String(e.amount).includes(q)
  );
  const groups = [];
  filtered.forEach((e) => {
    const k = dayKey(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.k === k) last.items.push(e);
    else groups.push({ k, ts: e.ts, items: [e] });
  });

  return (
    <>
      <input
        className="k-input"
        placeholder="Поиск: имя, категория, сумма"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {groups.length === 0 && <p style={S.empty}>Ничего не нашлось.</p>}
      {groups.map((g) => (
        <div key={g.k}>
          <div style={S.sectionHead}>
            <span>{dayLabel(g.ts)}</span>
            <span style={{ fontWeight: 700, color: "#16191A" }}>
              {money(g.items.reduce((s, e) => s + delta(e), 0))}
            </span>
          </div>
          <ul style={S.list}>
            {g.items.map((e) => (
              <EntryRow
                key={e.id}
                e={e}
                acctName={acctName}
                acctColor={acctColor}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/* ---------- итоги ---------- */

function StatsView({ data, month, setMonth, acctName, acctColor }) {
  const months = useMemo(() => {
    const set = new Set(data.entries.map((e) => monthKey(e.ts)));
    set.add(monthKey(Date.now()));
    return [...set].sort().reverse();
  }, [data]);

  const rows = data.entries.filter((e) => monthKey(e.ts) === month);
  const ins = rows.filter((e) => e.kind === "in");
  const inc = ins.reduce((s, e) => s + e.amount, 0);
  const out = rows.filter((e) => e.kind === "out").reduce((s, e) => s + e.amount, 0);
  const self = rows.filter((e) => e.kind === "self").reduce((s, e) => s + e.amount, 0);

  const prevKey = (() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  })();
  const prevInc = data.entries
    .filter((e) => monthKey(e.ts) === prevKey && e.kind === "in")
    .reduce((s, e) => s + e.amount, 0);
  const diff = prevInc ? Math.round(((inc - prevInc) / prevInc) * 100) : null;
  const avg = ins.length ? inc / ins.length : 0;
  const days = new Set(ins.map((e) => dayKey(e.ts))).size;

  const byCat = {};
  ins.forEach((e) => (byCat[e.cat] = (byCat[e.cat] || 0) + e.amount));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const byAcct = {};
  ins.forEach((e) => (byAcct[e.acct] = (byAcct[e.acct] || 0) + e.amount));

  const csv = () => {
    const head = "дата;время;тип;сумма;категория;счёт;комментарий";
    const body = rows
      .map((e) =>
        [
          new Date(e.ts).toLocaleDateString("ru-RU"),
          timeStr(e.ts),
          KIND_RU[e.kind],
          e.amount,
          e.cat || "",
          acctName(e.acct),
          (e.note || "").replace(/;/g, ","),
        ].join(";")
      )
      .join("\n");
    navigator.clipboard?.writeText(head + "\n" + body);
    alert("Таблица за месяц скопирована.");
  };

  return (
    <>
      <div style={S.monthRow}>
        {months.map((m) => (
          <button
            key={m}
            className={"k-chip" + (m === month ? " on" : "")}
            onClick={() => setMonth(m)}
          >
            {monthName(m).split(" ")[0]}
          </button>
        ))}
      </div>

      <div style={S.totals}>
        <div>
          <div style={S.totalLabel}>Пришло</div>
          <div style={{ ...S.totalSum, color: "#15653F" }}>{money(inc)}</div>
        </div>
        <div>
          <div style={S.totalLabel}>Потратил</div>
          <div style={{ ...S.totalSum, color: "#A33421" }}>{money(out)}</div>
        </div>
        <div>
          <div style={S.totalLabel}>Осталось</div>
          <div style={S.totalSum}>{money(inc - out)}</div>
        </div>
      </div>

      <div style={S.facts}>
        <span>{ins.length} платежей</span>
        <span>средний {money(avg)}</span>
        <span>{days} активных дней</span>
        {self > 0 && <span>забрал себе {money(self)}</span>}
        {diff !== null && (
          <span style={{ color: diff >= 0 ? "#15653F" : "#A33421", fontWeight: 600 }}>
            {diff >= 0 ? "+" : ""}
            {diff}% к {monthName(prevKey).split(" ")[0]}
          </span>
        )}
      </div>

      <div style={S.blockHead}>Откуда приход</div>
      {cats.length === 0 && <p style={S.empty}>За этот месяц записей нет.</p>}
      {cats.map(([c, v]) => (
        <div key={c} style={S.barRow}>
          <div style={S.barTop}>
            <span>{c}</span>
            <span style={{ fontWeight: 700 }}>{money(v)}</span>
          </div>
          <div style={S.barTrack}>
            <div style={{ ...S.barFill, width: (v / inc) * 100 + "%" }} />
          </div>
        </div>
      ))}

      {Object.keys(byAcct).length > 0 && (
        <>
          <div style={S.blockHead}>По счетам</div>
          <ul style={S.list}>
            {Object.entries(byAcct)
              .sort((a, b) => b[1] - a[1])
              .map(([a, v]) => (
                <li key={a} style={S.row}>
                  <span style={{ ...S.bar, background: acctColor(a) }} />
                  <span style={{ ...S.rowCat, flex: 1 }}>{acctName(a)}</span>
                  <span style={S.rowSum}>{money(v)}</span>
                </li>
              ))}
          </ul>
        </>
      )}

      <button className="k-ghost wide" style={{ marginTop: 20 }} onClick={csv}>
        Скопировать месяц таблицей
      </button>
    </>
  );
}

/* ---------- настройки ---------- */

function SettingsView({ data, persist, setCats, onPull }) {
  const [newAcct, setNewAcct] = useState("");
  const [newCat, setNewCat] = useState({ in: "", out: "" });
  const [pAmount, setPAmount] = useState("");
  const [pLabel, setPLabel] = useState("");

  return (
    <>
      <div style={S.blockHead}>Google Таблица</div>
      <input
        className="k-input"
        placeholder="https://script.google.com/macros/s/…/exec"
        value={data.sheetUrl || ""}
        onChange={(e) => persist({ ...data, sheetUrl: e.target.value.trim() })}
      />
      <p style={S.hint}>
        Записи, удаления и правки списков уходят в таблицу сами через несколько секунд.
        Обратно приложение читает таблицу при каждом запуске.
      </p>
      <button className="k-ghost wide" style={{ marginTop: 10 }} onClick={onPull}>
        Прочитать таблицу сейчас
      </button>

      <div style={S.blockHead}>Счета и карты</div>
      <ul style={S.list}>
        {data.accounts.map((a) => (
          <li key={a.id} style={S.row}>
            <input
              className="k-inline"
              value={a.name}
              onChange={(e) =>
                persist({
                  ...data,
                  accounts: data.accounts.map((x) =>
                    x.id === a.id ? { ...x, name: e.target.value } : x
                  ),
                })
              }
            />
            {["biz", "freeOnly"].map((flag) => (
              <button
                key={flag}
                className={"k-chip tiny" + (a[flag] ? " on" : "")}
                onClick={() =>
                  persist({
                    ...data,
                    accounts: data.accounts.map((x) =>
                      x.id === a.id ? { ...x, [flag]: !x[flag] } : x
                    ),
                  })
                }
              >
                {flag === "biz" ? "бизнес" : "своя сумма"}
              </button>
            ))}
            <button
              className="k-del"
              onClick={() =>
                persist({ ...data, accounts: data.accounts.filter((x) => x.id !== a.id) })
              }
              aria-label="Убрать счёт"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div style={S.addRow}>
        <input
          className="k-input"
          placeholder="Новая карта или счёт"
          value={newAcct}
          onChange={(e) => setNewAcct(e.target.value)}
        />
        <button
          className="k-save small"
          disabled={!newAcct.trim()}
          onClick={() => {
            persist({
              ...data,
              accounts: [...data.accounts, { id: "a" + Date.now(), name: newAcct.trim() }],
            });
            setNewAcct("");
          }}
        >
          Добавить
        </button>
      </div>
      <p style={S.hint}>Счета живут только в приложении — в журнал они идут комментарием.</p>

      <div style={S.blockHead}>Кнопки сумм</div>
      <ul style={S.list}>
        {data.presets.map((p) => (
          <li key={p.id} style={S.row}>
            <span style={{ ...S.rowCat, flex: 1 }}>
              {money(p.amount)} · {p.label}
            </span>
            <button
              className="k-del"
              onClick={() =>
                persist({ ...data, presets: data.presets.filter((x) => x.id !== p.id) })
              }
              aria-label="Убрать кнопку"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div style={S.addRow}>
        <input
          className="k-input"
          style={{ maxWidth: 96 }}
          placeholder="Сумма"
          inputMode="numeric"
          value={pAmount}
          onChange={(e) => setPAmount(e.target.value.replace(/\D/g, ""))}
        />
        <input
          className="k-input"
          placeholder="Название"
          value={pLabel}
          onChange={(e) => setPLabel(e.target.value)}
        />
        <button
          className="k-save small"
          disabled={!pAmount || !pLabel.trim()}
          onClick={() => {
            persist({
              ...data,
              presets: [
                ...data.presets,
                {
                  id: "p" + Date.now(),
                  amount: Number(pAmount),
                  label: pLabel.trim(),
                  cat: data.cats.in[0],
                },
              ],
            });
            setPAmount("");
            setPLabel("");
          }}
        >
          Добавить
        </button>
      </div>

      {["in", "out"].map((k) => (
        <div key={k}>
          <div style={S.blockHead}>
            {k === "in" ? "Источники дохода" : "Статьи расходов"}
          </div>
          <div style={S.catRow}>
            {data.cats[k].map((c) => (
              <button
                key={c}
                className="k-chip"
                onClick={() => setCats(k, data.cats[k].filter((x) => x !== c))}
              >
                {c} ✕
              </button>
            ))}
          </div>
          <div style={S.addRow}>
            <input
              className="k-input"
              placeholder={k === "in" ? "Новый источник" : "Новая статья"}
              value={newCat[k]}
              onChange={(e) => setNewCat({ ...newCat, [k]: e.target.value })}
            />
            <button
              className="k-save small"
              disabled={!newCat[k].trim()}
              onClick={() => {
                setCats(k, [...data.cats[k], newCat[k].trim()]);
                setNewCat({ ...newCat, [k]: "" });
              }}
            >
              Добавить
            </button>
          </div>
        </div>
      ))}
      <p style={S.hint}>
        Эти два списка синхронизируются с вкладкой «Настройки» в таблице: что добавили или
        убрали здесь, то поменяется и там.
      </p>
    </>
  );
}

/* ---------- стили ---------- */

const INK = "#16191A";
const MUTED = "#7B8280";
const LINE = "#DDE0DA";

const S = {
  shell: {
    minHeight: "100%",
    transition: "background .25s ease",
    padding: "14px 12px 24px",
    fontFamily:
      "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: INK,
  },
  frame: { maxWidth: 440, margin: "0 auto", position: "relative" },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "2px 2px 16px",
  },
  headerLabel: { fontSize: 13, color: MUTED },
  headerSum: {
    fontSize: 32,
    fontWeight: 750,
    letterSpacing: -1,
    fontVariantNumeric: "tabular-nums",
    marginTop: 3,
  },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  acctRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 },
  monthRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  main: { paddingBottom: 100, minHeight: 320 },
  presets: { display: "grid", gap: 10, marginBottom: 26 },
  sectionHead: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    color: MUTED,
    padding: "18px 2px 8px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "11px 10px",
    background: "#FFFFFF",
    borderRadius: 12,
    marginBottom: 6,
    fontSize: 14,
  },
  bar: { width: 4, height: 22, borderRadius: 4, flexShrink: 0 },
  rowTime: { color: "#A3A8A3", fontSize: 12, fontVariantNumeric: "tabular-nums" },
  rowCat: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  note: { color: "#A3A8A3", fontStyle: "normal" },
  rowAcct: { color: "#A3A8A3", fontSize: 12 },
  rowSum: { fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  empty: { color: MUTED, fontSize: 14, padding: "16px 2px" },
  swipeHint: { color: "#AEB3AD", fontSize: 12, textAlign: "center", marginTop: 22 },
  toast: {
    position: "sticky",
    bottom: 78,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: INK,
    color: "#F4F6F2",
    padding: "13px 15px",
    borderRadius: 14,
    fontSize: 14,
    marginTop: 14,
    boxShadow: "0 8px 24px rgba(20,25,20,.22)",
  },
  err: {
    background: "#F6DCD4",
    color: "#8C2A16",
    padding: "10px 13px",
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 12,
  },
  syncNote: {
    background: "#DFE9DE",
    color: "#2C5340",
    padding: "9px 13px",
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 12,
  },
  tabs: {
    position: "sticky",
    bottom: 0,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    background: "#ECEEE9",
    borderTop: "1px solid " + LINE,
    marginTop: 14,
  },
  sheetWrap: {
    position: "fixed",
    inset: 0,
    background: "rgba(20,25,20,.42)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50,
  },
  sheet: {
    background: "#F3F5F1",
    width: "100%",
    maxWidth: 440,
    padding: "10px 14px 18px",
    borderRadius: "20px 20px 0 0",
    maxHeight: "94%",
    overflowY: "auto",
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 4,
    background: "#CDD2CB",
    margin: "0 auto 14px",
  },
  padTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  kindSwitch: { display: "flex", gap: 5 },
  padSum: {
    fontSize: 30,
    fontWeight: 750,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: -1,
  },
  catRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 },
  pad: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, margin: "14px 0" },
  padActions: { display: "flex", gap: 8 },
  totals: {
    display: "grid",
    gridTemplateColumns: "repeat(3,1fr)",
    gap: 8,
    background: "#FFFFFF",
    borderRadius: 14,
    padding: 15,
  },
  totalLabel: { fontSize: 12, color: MUTED },
  totalSum: {
    fontSize: 17,
    fontWeight: 750,
    fontVariantNumeric: "tabular-nums",
    marginTop: 3,
  },
  facts: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    fontSize: 13,
    color: MUTED,
    padding: "12px 4px 0",
  },
  blockHead: { fontSize: 13, color: MUTED, padding: "24px 2px 10px" },
  barRow: { padding: "6px 2px 12px" },
  barTop: { display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 },
  barTrack: { height: 7, background: "#DCE0D9", borderRadius: 7 },
  barFill: { height: 7, background: "#15653F", borderRadius: 7 },
  addRow: { display: "flex", gap: 7, marginTop: 8 },
  hint: { fontSize: 13, color: "#9AA09A", lineHeight: 1.45, margin: "10px 2px 0" },
};

function Style() {
  return (
    <style>{`
      .k-preset {
        display: flex; align-items: baseline; gap: 13px; width: 100%;
        text-align: left; cursor: pointer; background: #FFFFFF; border: none;
        border-radius: 16px; padding: 18px 18px; font: inherit; color: inherit;
        box-shadow: 0 1px 2px rgba(20,25,20,.05), 0 6px 16px rgba(20,25,20,.05);
        transition: transform .09s ease, box-shadow .12s ease;
      }
      .k-preset:active { transform: scale(.982); box-shadow: 0 1px 2px rgba(20,25,20,.06); }
      .k-preset-sum { font-size: 32px; font-weight: 750; letter-spacing: -1.2px; font-variant-numeric: tabular-nums; }
      .k-preset-label { font-size: 14px; color: #7B8280; }
      .k-preset.alt .k-preset-sum, .k-preset.solo .k-preset-sum { color: #9AA09A; letter-spacing: 2px; }
      .k-preset.solo { padding: 30px 18px; }

      .k-acct {
        display: inline-flex; align-items: center; gap: 7px;
        background: #FFFFFF; border: 1.5px solid transparent; color: #5A625E;
        padding: 9px 14px; border-radius: 999px; font: inherit; font-size: 14px; cursor: pointer;
        transition: color .12s ease, border-color .12s ease;
      }
      .k-acct.on { color: #16191A; font-weight: 600; }
      .k-dot { width: 8px; height: 8px; border-radius: 8px; display: inline-block; }

      .k-chip {
        background: #FFFFFF; border: 1px solid #E3E6E0; color: #5A625E;
        padding: 8px 13px; border-radius: 999px; font: inherit; font-size: 13.5px; cursor: pointer;
      }
      .k-chip.tiny { font-size: 12px; padding: 5px 10px; }
      .k-chip.on { color: #FFFFFF; background: #16191A; border-color: #16191A; }

      .k-tab {
        position: relative; background: transparent; border: none;
        padding: 14px 0 16px; font: inherit; font-size: 14px; color: #9AA09A; cursor: pointer;
      }
      .k-tab.on { color: #16191A; font-weight: 650; }
      .k-tab.on span::after {
        content: ""; position: absolute; left: 50%; transform: translateX(-50%);
        bottom: 9px; width: 26px; height: 2.5px; border-radius: 3px; background: #16191A;
      }

      .k-pill {
        display: inline-flex; align-items: center; gap: 6px;
        background: #FFFFFF; border: none; color: #5A625E;
        padding: 8px 12px; border-radius: 999px; font: inherit; font-size: 13px; cursor: pointer;
      }
      .k-icon {
        background: #FFFFFF; border: none; color: #5A625E; width: 36px; height: 36px;
        border-radius: 999px; font-size: 16px; cursor: pointer;
      }

      .k-ghost {
        flex: 1; background: transparent; border: 1px solid #D2D6CF; color: #5A625E;
        padding: 13px 16px; border-radius: 12px; font: inherit; font-size: 15px; cursor: pointer;
      }
      .k-ghost.wide { width: 100%; }

      .k-save {
        flex: 1; background: #15653F; color: #fff; border: none; border-radius: 12px;
        padding: 14px; font: inherit; font-size: 16px; font-weight: 650; cursor: pointer;
      }
      .k-save.small { flex: none; padding: 11px 15px; font-size: 14px; }
      .k-save:disabled { background: #BFC6C0; cursor: default; }

      .k-key {
        background: #FFFFFF; border: none; border-radius: 12px; padding: 17px 0;
        font: inherit; font-size: 22px; font-weight: 600; cursor: pointer;
        font-variant-numeric: tabular-nums;
      }
      .k-key:active { background: #E4E8E2; }

      .k-kind {
        background: #FFFFFF; border: 1px solid #E3E6E0; color: #7B8280;
        padding: 8px 13px; border-radius: 999px; font: inherit; font-size: 13px; cursor: pointer;
      }
      .k-kind.on { color: #fff; background: #15653F; border-color: #15653F; }
      .k-kind.on.out { background: #A33421; border-color: #A33421; }
      .k-kind.on.self { background: #5A625E; border-color: #5A625E; }

      .k-input {
        flex: 1; width: 100%; background: #FFFFFF; border: 1px solid #E3E6E0;
        border-radius: 12px; padding: 13px; font: inherit; font-size: 15px; color: #16191A;
      }
      .k-inline {
        flex: 1; min-width: 0; background: transparent; border: none;
        border-bottom: 1px dashed #D2D6CF; font: inherit; font-size: 14px;
        padding: 3px 0; color: #16191A;
      }
      .k-input:focus-visible, .k-inline:focus-visible { outline: 2px solid #15653F; outline-offset: 1px; }

      .k-del {
        background: transparent; border: none; color: #C3C8C2;
        font-size: 15px; cursor: pointer; padding: 4px 6px; flex-shrink: 0;
      }
      .k-del:active { color: #A33421; }

      .k-undo {
        background: transparent; border: 1px solid #4A514C; color: #F4F6F2;
        padding: 8px 13px; border-radius: 999px; font: inherit; font-size: 13px;
        cursor: pointer; flex-shrink: 0;
      }

      @keyframes k-in-left  { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
      @keyframes k-in-right { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
      .k-slide-left  { animation: k-in-left .22s ease-out; }
      .k-slide-right { animation: k-in-right .22s ease-out; }

      button:focus-visible { outline: 2px solid #15653F; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
    `}</style>
  );
}
