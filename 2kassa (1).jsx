import React, { useState, useEffect, useRef, useMemo, memo } from "react";

const KEY = "kassa-v1";

const PALETTE = [
  { c: "#D19A00", t: "#F8F2DA" },
  { c: "#15803D", t: "#E7EFE7" },
  { c: "#1D4ED8", t: "#E7EAF3" },
  { c: "#7C3AED", t: "#EEE9F4" },
  { c: "#0E7490", t: "#E2EEF0" },
  { c: "#C2410C", t: "#F5EAE2" },
  { c: "#9D174D", t: "#F4E7EC" },
  { c: "#4D7C0F", t: "#EDF1E2" },
];

const FIX_CAT = "Корректировка";
const FIX_NOTE = "Сверка остатка";
const KIND_RU = { in: "Приход", out: "Расход", self: "Изъятие себе" };

const DEFAULTS = {
  accounts: [
    { id: "a1", name: "Т-Банк", pal: 0 },
    { id: "a2", name: "Сбер", pal: 1 },
    { id: "a3", name: "Наличные", pal: 2 },
    { id: "a4", name: "Р/с ИП", pal: 3, freeOnly: true, biz: true },
  ],
  presets: [
    { id: "p1", amount: 650, label: "Разовая", cat: "Тренировки и абонементы" },
    { id: "p3", amount: 4000, label: "Абонемент", cat: "Тренировки и абонементы" },
  ],
  cats: {
    in: ["Тренировки и абонементы", "Лагеря и кэмпы", "Одежда", "Разовые халтуры"],
    out: [
      "Продукты", "Транспорт и бензин", "Кафе и рестораны", "Развлечения и поездки",
      "Одежда и обувь", "Здоровье и спорт", "Ремонт и дом", "Подарки",
      "Крупная покупка", "Аренда залов (разово)", "Выплаты людям", "Ткань и пошив",
      "Реклама (разово)", "Оборудование и инвентарь", "Налоги (разово)", "Прочее",
    ],
  },
  sheetUrl: "",
  start: {},
  entries: [],
  dels: [],
  upds: [],
};

/* ---------- расчёты ---------- */

const moveOf = (e) => (e.kind === "in" ? e.amount : -e.amount);
const movesOf = (entries, id) =>
  entries.reduce((s, e) => (e.acct === id ? s + moveOf(e) : s), 0);
const balanceOf = (entries, id, start) =>
  (start && start[id] !== undefined ? start[id] : 0) + movesOf(entries, id);

const nf = new Intl.NumberFormat("ru-RU");
const money = (n) => nf.format(Math.round(n)) + " ₽";
const shortMoney = (n) => nf.format(Math.round(n));

const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const monthKey = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};
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

const guessPal = (name, taken) => {
  const n = String(name).toLowerCase();
  const wish = /т-?банк|тинь/.test(n) ? 0 : /сбер/.test(n) ? 1
    : /налич|кэш/.test(n) ? 2 : /р\/с|расчёт|расчет|ип/.test(n) ? 3 : null;
  if (wish !== null && !taken.has(wish)) return wish;
  for (let i = 0; i < PALETTE.length; i++) if (!taken.has(i)) return i;
  return 0;
};
const freePal = (accounts) => {
  const used = new Set(accounts.map((a) => a.pal));
  for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
  return accounts.length % PALETTE.length;
};

/* ---------- корень ---------- */

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    const text = String(this.state.err.stack || this.state.err.message);
    return (
      <div style={{ padding: 20, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
        <p style={{ fontWeight: 700 }}>Сбой в приложении</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</pre>
        <button onClick={() => location.reload()} style={{ marginTop: 12, padding: "12px 16px" }}>
          Перезапустить
        </button>
      </div>
    );
  }
}

export default function Kassa() {
  return (
    <ErrorBoundary>
      <KassaApp />
    </ErrorBoundary>
  );
}

function KassaApp() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("add");
  const [acct, setAcct] = useState(null);
  const [pad, setPad] = useState(null);
  const [toast, setToast] = useState(null);
  const [sync, setSync] = useState({ state: "idle", msg: "" });
  const [slide, setSlide] = useState(null);
  const toastTimer = useRef(null);
  const syncTimer = useRef(null);
  const fails = useRef(0);
  const touch = useRef(null);

  /* загрузка */
  useEffect(() => {
    (async () => {
      let parsed = null;
      try {
        const res = await window.storage.get(KEY);
        parsed = res ? JSON.parse(res.value) : null;
      } catch (e) { parsed = null; }
      const m = { ...DEFAULTS, ...(parsed || {}) };
      if (Array.isArray(m.cats)) m.cats = DEFAULTS.cats;
      if (!Array.isArray(m.dels)) m.dels = [];
      if (!Array.isArray(m.upds)) m.upds = [];
      if (!m.start) m.start = {};
      delete m.adjust;
      const taken = new Set(m.accounts.filter((a) => a.pal !== undefined).map((a) => a.pal));
      m.accounts = m.accounts.map((a) => {
        if (a.pal !== undefined) return a;
        const pal = guessPal(a.name, taken);
        taken.add(pal);
        return { ...a, pal };
      });
      setData(m);
      const today = new Date().toDateString();
      let st = m.accounts.find((a) => a.id === m.lastAcct);
      if (!st || (m.lastDay !== today && (st.biz || st.freeOnly)))
        st = m.accounts.find((a) => !a.biz && !a.freeOnly) || m.accounts[0];
      setAcct(st.id);
    })();
  }, []);

  const persist = (next) => {
    setData(next);
    try { window.storage.set(KEY, JSON.stringify(next)); } catch (e) {}
  };

  const acctById = (id) => data?.accounts.find((a) => a.id === id);
  const acctName = (id) => acctById(id)?.name || "—";
  const palOf = (id) => PALETTE[(acctById(id)?.pal ?? 0) % PALETTE.length];
  const acctColor = (id) => palOf(id).c;

  /* обмен с таблицей */
  const pendingCount = data
    ? data.entries.filter((e) => !e.sent).length + data.dels.length + data.upds.length
    : 0;

  const push = async (silent = false) => {
    if (!data?.sheetUrl) { setView("settings"); return; }
    const batch = data.entries.filter((e) => !e.sent);
    const dels = data.dels;
    const upds = data.upds.map((id) => data.entries.find((e) => e.id === id)).filter(Boolean);
    const needCats = !!data.catsDirty;
    if (!batch.length && !dels.length && !upds.length && !needCats) {
      if (!silent) setSync({ state: "ok", msg: "Всё в таблице" });
      return;
    }
    if (navigator.onLine === false) return;
    if (!silent) setSync({ state: "run", msg: "Отправляю…" });

    const wire = (e) => ({
      id: e.id, ts: e.ts, time: timeStr(e.ts),
      kind: KIND_RU[e.kind] || "Приход",
      amount: e.amount,
      cat: e.kind === "self" ? "" : e.cat,
      scope: e.kind === "self" || acctById(e.acct)?.biz ? "Бизнес" : "Личное",
      note: [acctName(e.acct), e.note].filter(Boolean).join(" · "),
    });
    const body = JSON.stringify({
      entries: batch.map(wire),
      deletes: dels,
      updates: upds.map(wire),
      settings: needCats ? { in: data.cats.in, out: data.cats.out } : null,
    });

    let ok = false;
    try {
      const r = await fetch(data.sheetUrl, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body,
      });
      ok = !!(await r.json()).ok;
    } catch (e1) {
      try {
        await fetch(data.sheetUrl, {
          method: "POST", mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, body,
        });
        ok = true;
      } catch (e2) {
        fails.current += 1;
        if (!silent) setSync({ state: "err", msg: "Таблица недоступна" });
      }
    }
    if (ok) {
      fails.current = 0;
      const ids = new Set(batch.map((e) => e.id));
      persist({
        ...data,
        entries: data.entries.map((e) => (ids.has(e.id) ? { ...e, sent: true } : e)),
        dels: [], upds: [], catsDirty: false,
      });
      if (!silent) setSync({ state: "ok", msg: "Отправлено" });
    }
  };

  const pull = async (silent = false) => {
    if (!data?.sheetUrl) return;
    if (!silent) setSync({ state: "run", msg: "Читаю таблицу…" });
    let remote;
    try {
      remote = await (await fetch(data.sheetUrl + "?pull=1")).json();
      if (!remote.ok) throw new Error(remote.error || "ошибка");
    } catch (err) {
      if (!silent) setSync({ state: "err", msg: "Не прочитал таблицу" });
      return;
    }
    const rows = remote.rows || [];
    const byKey = new Map(rows.map((r) => [r.id || "sr" + r.row, r]));
    const accByName = (n) =>
      data.accounts.find((a) => a.name.toLowerCase() === String(n || "").toLowerCase());

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
        acct: hit ? hit.id : base?.acct || null,
        note: hit ? parts.slice(1).join(" · ") : r.note || "",
        sent: true,
      };
    };

    const local = [];
    let gone = 0, fresh = 0;
    data.entries.forEach((e) => {
      if (!e.sent) return local.push(e);
      const r = byKey.get(e.id);
      if (!r) { if (rows.length) { gone++; return; } return local.push(e); }
      byKey.delete(e.id);
      local.push(fromRow(r, e));
    });
    byKey.forEach((r) => { local.push(fromRow(r, null)); fresh++; });
    local.sort((a, b) => b.ts - a.ts);

    const next = { ...data, entries: local, lastPull: Date.now() };
    if (remote.settings && !data.catsDirty) {
      const i = remote.settings.in || [], o = remote.settings.out || [];
      if (i.length) next.cats = { in: i, out: o.length ? o : data.cats.out };
    }
    persist(next);
    if (!silent)
      setSync({ state: "ok", msg: fresh || gone ? "Обновил: +" + fresh + " / −" + gone : "Совпадает" });
  };

  const syncNow = async () => { await push(false); await pull(false); };

  useEffect(() => {
    if (sync.state !== "ok" || !sync.msg) return;
    const t = setTimeout(() => setSync({ state: "idle", msg: "" }), 4000);
    return () => clearTimeout(t);
  }, [sync]);

  useEffect(() => {
    if (!data?.sheetUrl || (!pendingCount && !data.catsDirty)) return;
    const wait = [3000, 15000, 60000, 300000][Math.min(fails.current, 3)];
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => push(true), wait);
    return () => clearTimeout(syncTimer.current);
  }, [data, pendingCount]);

  const pulled = useRef(false);
  useEffect(() => {
    if (!data?.sheetUrl || pulled.current) return;
    pulled.current = true;
    if (!data.lastPull || Date.now() - data.lastPull > 6 * 3600000) pull(true);
  }, [data]);

  useEffect(() => {
    const on = () => { fails.current = 0; if (data?.sheetUrl) push(true); };
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [data]);

  /* операции */
  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 9000);
  };

  const add = (amount, cat, kind = "in", note = "", ts = null, useAcct = null) => {
    const lastCat = { ...(data.lastCat || {}) };
    if (cat) lastCat[kind] = cat;
    const entry = {
      id: "e" + Date.now() + Math.random().toString(36).slice(2, 6),
      ts: ts || Date.now(), amount: Number(amount), cat, kind,
      acct: useAcct || acct, note,
    };
    persist({
      ...data,
      entries: [entry, ...data.entries].sort((a, b) => b.ts - a.ts),
      lastAcct: acct, lastCat, lastDay: new Date().toDateString(),
    });
    showToast(entry);
  };

  const update = (patch) => {
    const cur = data.entries.find((e) => e.id === patch.id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    persist({
      ...data,
      entries: data.entries.map((e) => (e.id === patch.id ? next : e)).sort((a, b) => b.ts - a.ts),
      upds: cur.sent ? [...new Set([...data.upds, cur.id])] : data.upds,
    });
    setToast(null);
  };

  const remove = (e) => {
    persist({
      ...data,
      entries: data.entries.filter((x) => x.id !== e.id),
      dels: e.sent ? [...data.dels, { id: e.id, ts: e.ts, amount: e.amount }] : data.dels,
      upds: data.upds.filter((id) => id !== e.id),
    });
    if (toast && toast.id === e.id) setToast(null);
  };

  /* сверка */
  const fix = (acctId, actual) => {
    const value = Math.round(Number(actual));
    if (data.start[acctId] === undefined) {
      persist({
        ...data,
        start: { ...data.start, [acctId]: value - movesOf(data.entries, acctId) },
      });
      return { mode: "start" };
    }
    const diff = value - balanceOf(data.entries, acctId, data.start);
    if (!diff) return { mode: "same" };
    const entry = {
      id: "e" + Date.now() + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), amount: Math.abs(diff), cat: FIX_CAT,
      kind: diff > 0 ? "in" : "out", acct: acctId, note: FIX_NOTE,
    };
    const next = { ...data, entries: [entry, ...data.entries].sort((a, b) => b.ts - a.ts) };
    if (!data.cats.in.includes(FIX_CAT)) {
      next.cats = { ...data.cats, in: [...data.cats.in, FIX_CAT] };
      next.catsDirty = true;
    }
    persist(next);
    return { mode: "diff", diff };
  };

  const clearStart = (id) => {
    const s = { ...data.start };
    delete s[id];
    persist({ ...data, start: s });
  };

  /* свайп по счетам */
  const onTouchStart = (ev) => {
    const t = ev.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (ev) => {
    if (!touch.current || view !== "add") return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touch.current.x, dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 45) return;
    const i = data.accounts.findIndex((a) => a.id === acct);
    const n = data.accounts.length;
    setSlide(dx < 0 ? "left" : "right");
    setAcct(data.accounts[(i + (dx < 0 ? 1 : -1) + n) % n].id);
  };

  const total = useMemo(() => {
    if (!data) return 0;
    return data.accounts.reduce((s, a) => s + balanceOf(data.entries, a.id, data.start), 0);
  }, [data]);

  const todayList = useMemo(() => {
    if (!data) return [];
    const dk = dayKey(Date.now());
    return data.entries.filter((e) => dayKey(e.ts) === dk);
  }, [data]);

  if (!data) return <div style={S.shell}><Style /></div>;

  const tint = view === "add" ? palOf(acct).t : "#ECEEE9";

  return (
    <div style={{ ...S.shell, background: tint }}>
      <Style />
      <div className="k-frame" style={S.frame}>
        <header style={S.header}>
          <div>
            <div style={S.headLabel}>Сейчас на счетах</div>
            <div className="k-headsum" style={S.headSum}>{money(total)}</div>
          </div>
          <div style={S.headRight}>
            {data.sheetUrl && (
              <button className="k-pill" onClick={syncNow}>
                <span className="k-dot" style={{
                  background: sync.state === "err" ? "#A33421" : pendingCount ? "#C2410C" : "#15803D",
                }} />
                {sync.state === "run" ? "…" : pendingCount || ""}
              </button>
            )}
            <button className="k-icon" onClick={() => setView(view === "settings" ? "add" : "settings")}>
              ⚙
            </button>
          </div>
        </header>

        {sync.state === "err" && <div style={S.err}>{sync.msg}</div>}

        {view === "add" && (
          <div style={S.acctRow}>
            {data.accounts.map((a, i) => {
              const n = data.accounts.length;
              const full = Math.floor(n / 3) * 3;
              const span = i < full ? 2 : 6 / (n - full);
              return (
                <button
                  key={a.id}
                  className={"k-acct" + (acct === a.id ? " on" : "")}
                  style={{ gridColumn: "span " + span, ...(acct === a.id ? { borderColor: acctColor(a.id) } : {}) }}
                  onClick={() => {
                    setSlide(i > data.accounts.findIndex((x) => x.id === acct) ? "left" : "right");
                    setAcct(a.id);
                  }}
                >
                  <span className="k-dot" style={{ background: acctColor(a.id) }} />
                  <span className="k-acct-name">{a.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <main style={S.main} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {view === "add" && (
            <div key={acct} className={slide ? "k-slide-" + slide : undefined}>
              <AddScreen
                data={data}
                acct={acct}
                add={add}
                today={todayList}
                acctName={acctName}
                acctColor={acctColor}
                onEdit={setPad}
                onDelete={remove}
                openPad={() => setPad({ acct, ts: Date.now(), kind: "in" })}
              />
            </div>
          )}

          {view === "money" && (
            <MoneyScreen
              data={data}
              acctName={acctName}
              acctColor={acctColor}
              onFix={fix}
              onClearStart={clearStart}
              onEdit={setPad}
              onDelete={remove}
              onPull={() => pull(false)}
            />
          )}

          {view === "settings" && <Settings data={data} persist={persist} />}
        </main>

        {sync.state === "ok" && sync.msg && !toast && <div style={S.float}>{sync.msg}</div>}

        {toast && (
          <Toast
            entry={toast}
            acctName={acctName}
            onNote={(note) => update({ id: toast.id, note })}
            onUndo={() => remove(toast)}
          />
        )}

        <nav style={{ ...S.tabs, background: tint }}>
          {[["add", "Запись"], ["money", "Деньги"]].map(([id, label]) => (
            <button key={id} className={"k-tab" + (view === id ? " on" : "")} onClick={() => setView(id)}>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {pad && (
        <Pad
          data={data}
          init={pad}
          acctColor={acctColor}
          onClose={() => setPad(null)}
          onSave={(v) => {
            if (v.id) update(v);
            else add(v.amount, v.cat, v.kind, v.note, v.ts, v.acct);
            setPad(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------- запись ---------- */

function AddScreen({ data, acct, add, today, acctName, acctColor, onEdit, onDelete, openPad }) {
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);
  const freeOnly = !!data.accounts.find((a) => a.id === acct)?.freeOnly;
  const sum = today.reduce((s, e) => s + moveOf(e), 0);

  const hit = (key, amount, cat) => {
    add(amount, cat);
    setFlash(key);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 900);
  };

  return (
    <>
      <div className="k-presets">
        {!freeOnly &&
          data.presets.map((p) => (
            <button
              key={p.id}
              className={"k-preset" + (flash === p.id ? " done" : "")}
              onClick={() => hit(p.id, p.amount, p.cat)}
            >
              <span className="k-preset-text">
                <span className="k-preset-sum">{shortMoney(p.amount)}</span>
                <span className="k-preset-label">{flash === p.id ? "Записано" : p.label}</span>
              </span>
              <span className="k-preset-plus">{flash === p.id ? "✓" : "+"}</span>
            </button>
          ))}
        <button className={"k-preset" + (freeOnly ? " solo" : " alt")} onClick={openPad}>
          <span className="k-preset-text">
            <span className="k-preset-sum">···</span>
            <span className="k-preset-label">
              {freeOnly ? "Ввести сумму" : "Другая сумма или расход"}
            </span>
          </span>
        </button>
      </div>

      <div style={S.sectionHead}>
        <span>Сегодня · {today.length}</span>
        <span style={{ fontWeight: 700, color: INK }}>{money(sum)}</span>
      </div>

      {today.length === 0 ? (
        <p style={S.empty}>Нажмите сумму — запись появится здесь.</p>
      ) : (
        <ul style={S.list}>
          {today.map((e) => (
            <EntryRow key={e.id} e={e} acctName={acctName} acctColor={acctColor}
              onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------- деньги ---------- */

function MoneyScreen({ data, acctName, acctColor, onFix, onClearStart, onEdit, onDelete, onPull }) {
  const [month, setMonth] = useState(monthKey(Date.now()));

  const months = useMemo(() => {
    const set = new Set(data.entries.map((e) => monthKey(e.ts)));
    set.add(monthKey(Date.now()));
    return [...set].sort().reverse();
  }, [data.entries]);

  const rows = useMemo(
    () => data.entries.filter((e) => monthKey(e.ts) === month),
    [data.entries, month]
  );
  const inc = rows.filter((e) => e.kind === "in").reduce((s, e) => s + e.amount, 0);
  const out = rows.filter((e) => e.kind === "out").reduce((s, e) => s + e.amount, 0);

  const byCat = {};
  rows.filter((e) => e.kind === "in").forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const byOut = {};
  rows.filter((e) => e.kind === "out").forEach((e) => { byOut[e.cat] = (byOut[e.cat] || 0) + e.amount; });
  const outCats = Object.entries(byOut).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Accounts data={data} acctName={acctName} acctColor={acctColor}
        onFix={onFix} onClearStart={onClearStart} onEdit={onEdit} onDelete={onDelete} />

      <div style={S.blockHead}>Движение за месяц</div>
      <div style={S.monthRow}>
        {months.slice(0, 6).map((m) => (
          <button key={m} className={"k-chip" + (m === month ? " on" : "")} onClick={() => setMonth(m)}>
            {monthName(m).split(" ")[0]}
          </button>
        ))}
      </div>

      <div style={S.totals}>
        <div>
          <div style={S.totalLabel}>Приход</div>
          <div style={{ ...S.totalSum, color: "#15653F" }}>{money(inc)}</div>
        </div>
        <div>
          <div style={S.totalLabel}>Расход</div>
          <div style={{ ...S.totalSum, color: "#A33421" }}>{money(out)}</div>
        </div>
      </div>

      <Bars title="Откуда приход" items={cats} total={inc} color="#15653F" />
      <Bars title="Куда ушло" items={outCats} total={out} color="#A33421" />

      <History data={data} acctName={acctName} acctColor={acctColor}
        onEdit={onEdit} onDelete={onDelete} onPull={onPull} />
    </>
  );
}

function Bars({ title, items, total, color }) {
  if (!items.length) return null;
  return (
    <>
      <div style={S.blockHead}>{title}</div>
      {items.map(([c, v]) => (
        <div key={c} style={S.barRow}>
          <div style={S.barTop}>
            <span>{c || "Без категории"}</span>
            <span style={{ fontWeight: 700 }}>{money(v)}</span>
          </div>
          <div style={S.barTrack}>
            <div style={{ height: 7, borderRadius: 7, background: color, width: (v / total) * 100 + "%" }} />
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------- счета и сверка ---------- */

function Accounts({ data, acctName, acctColor, onFix, onClearStart, onEdit, onDelete }) {
  const [open, setOpen] = useState(null);
  const [val, setVal] = useState("");
  const [msg, setMsg] = useState(null);
  const orphan = data.entries.filter((e) => !e.acct);

  const pick = (id) => { setOpen(open === id ? null : id); setVal(""); setMsg(null); };

  return (
    <>
      <div style={S.blockHead}>Счета и сверка</div>
      <ul style={S.list}>
        {data.accounts.map((a) => {
          const known = data.start[a.id] !== undefined;
          const moves = movesOf(data.entries, a.id);
          const bal = balanceOf(data.entries, a.id, data.start);
          const isOpen = open === a.id;
          const typed = val === "" ? null : Math.round(Number(val));
          const diff = typed === null ? null : typed - bal;
          return (
            <li key={a.id} style={S.card}>
              <button className="k-acctline" onClick={() => pick(a.id)}>
                <span className="k-dot" style={{ background: acctColor(a.id) }} />
                <span style={{ ...S.rowCat, flex: 1 }}>{a.name}</span>
                <span style={{ ...S.acctBal, color: known ? INK : MUTED }}>
                  {known ? money(bal) : "задать"}
                </span>
                <span className={"k-chev" + (isOpen ? " on" : "")}>›</span>
              </button>

              {isOpen && (
                <div style={{ paddingTop: 10 }}>
                  {known && (
                    <div style={S.calc}>
                      <div style={S.calcLine}>
                        <span>Стартовая сумма</span><span>{money(data.start[a.id])}</span>
                      </div>
                      <div style={S.calcLine}>
                        <span>Записано с тех пор</span>
                        <span>{moves >= 0 ? "+" : "−"}{money(Math.abs(moves))}</span>
                      </div>
                      <div style={{ ...S.calcLine, ...S.calcTotal }}>
                        <span>Должно быть</span><span>{money(bal)}</span>
                      </div>
                    </div>
                  )}
                  <div style={S.addRow}>
                    <input className="k-input" inputMode="numeric"
                      placeholder="Сколько на счёте сейчас"
                      value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d-]/g, ""))} />
                    <button className="k-save small" disabled={val === ""}
                      onClick={() => {
                        const r = onFix(a.id, val);
                        setVal("");
                        setMsg(
                          r.mode === "start" ? "Стартовая сумма записана"
                            : r.mode === "diff"
                              ? (r.diff > 0 ? "Заработано " : "Потрачено ") + money(Math.abs(r.diff))
                              : "Всё сходится"
                        );
                      }}>
                      {known ? "Сверить" : "Задать"}
                    </button>
                  </div>
                  <div style={{ ...S.hint, marginTop: 8 }}>
                    {!known
                      ? "Сколько денег на счёте прямо сейчас. Это точка отсчёта, в приход не попадёт."
                      : diff === null ? "Впишите фактическую сумму со счёта."
                        : diff === 0 ? "Сходится"
                          : diff > 0 ? "Не записано " + money(diff) + " прихода"
                            : "Не записано " + money(-diff) + " трат"}
                  </div>
                  {known && (
                    <div style={{ ...S.hint, marginTop: 6 }}>
                      <button className="k-link" onClick={() => onClearStart(a.id)}>
                        задать стартовую сумму заново
                      </button>
                    </div>
                  )}
                  {msg && <div style={{ ...S.hint, marginTop: 6 }}>{msg}</div>}
                </div>
              )}
            </li>
          );
        })}

        {orphan.length > 0 && (
          <li style={S.card}>
            <button className="k-acctline" onClick={() => pick("orphan")}>
              <span className="k-dot" style={{ background: "#B6BCB6" }} />
              <span style={{ ...S.rowCat, flex: 1, color: MUTED }}>Без счёта · {orphan.length}</span>
              <span className={"k-chev" + (open === "orphan" ? " on" : "")}>›</span>
            </button>
            {open === "orphan" && (
              <div style={{ paddingTop: 8 }}>
                <p style={S.hint}>
                  Строки из таблицы без названия карты. В остатках не учтены — откройте и выберите счёт.
                </p>
                <ul style={S.list}>
                  {orphan.slice(0, 40).map((e) => (
                    <EntryRow key={e.id} e={e} acctName={acctName} acctColor={acctColor}
                      onEdit={onEdit} onDelete={onDelete} />
                  ))}
                </ul>
              </div>
            )}
          </li>
        )}
      </ul>
    </>
  );
}

/* ---------- история ---------- */

function History({ data, acctName, acctColor, onEdit, onDelete, onPull }) {
  const [open, setOpen] = useState([monthKey(Date.now())]);

  const months = [];
  data.entries.forEach((e) => {
    const mk = monthKey(e.ts);
    let m = months[months.length - 1];
    if (!m || m.key !== mk) { m = { key: mk, items: [], days: [] }; months.push(m); }
    m.items.push(e);
    const dk = dayKey(e.ts);
    const d = m.days[m.days.length - 1];
    if (d && d.key === dk) d.items.push(e);
    else m.days.push({ key: dk, ts: e.ts, items: [e] });
  });

  const notSent = data.entries.filter((e) => !e.sent).length;

  return (
    <>
      <div style={S.blockHead}>История</div>
      <div style={S.logBar}>
        <span>{notSent ? notSent + " не в таблице" : "Всё в таблице"}</span>
        <button className="k-link" onClick={onPull}>Обновить</button>
      </div>

      {months.map((m) => {
        const isOpen = open.includes(m.key);
        const net = m.items.reduce((s, e) => s + moveOf(e), 0);
        return (
          <div key={m.key} style={{ marginBottom: 8 }}>
            <button className="k-section"
              onClick={() => setOpen(isOpen ? open.filter((x) => x !== m.key) : [...open, m.key])}>
              <span style={S.sectionText}>
                <span style={S.sectionTitle}>
                  {monthName(m.key).charAt(0).toUpperCase() + monthName(m.key).slice(1)}
                </span>
                <span style={S.sectionSummary}>{m.items.length} операций</span>
              </span>
              <span style={S.monthSum}>{money(net)}</span>
              <span className={"k-chev" + (isOpen ? " on" : "")}>›</span>
            </button>
            {isOpen && m.days.map((g) => (
              <div key={g.key}>
                <div style={S.sectionHead}>
                  <span>{dayLabel(g.ts)}</span>
                  <span style={{ fontWeight: 700, color: INK }}>
                    {money(g.items.reduce((s, e) => s + moveOf(e), 0))}
                  </span>
                </div>
                <ul style={S.list}>
                  {g.items.map((e) => (
                    <EntryRow key={e.id} e={e} acctName={acctName} acctColor={acctColor}
                      onEdit={onEdit} onDelete={onDelete} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ---------- строка ---------- */

const EntryRow = memo(function EntryRow({ e, acctName, acctColor, onEdit, onDelete }) {
  const [ask, setAsk] = useState(false);
  const color = e.kind === "in" ? "#15653F" : e.kind === "out" ? "#A33421" : "#5A625E";
  const sign = e.kind === "in" ? "" : e.kind === "out" ? "−" : "→ ";
  return (
    <li style={S.row}>
      <span style={{ ...S.bar, background: e.acct ? acctColor(e.acct) : "#C8CCC7" }} />
      {ask ? (
        <>
          <span style={{ ...S.rowCat, flex: 1 }}>Удалить?</span>
          <button className="k-link danger" onClick={() => onDelete(e)}>Удалить</button>
          <button className="k-link" onClick={() => setAsk(false)}>Отмена</button>
        </>
      ) : (
        <>
          <button className="k-rowmain" onClick={() => onEdit({
            id: e.id, amount: String(e.amount), cat: e.cat, kind: e.kind,
            note: e.note || "", acct: e.acct, ts: e.ts,
          })}>
            <span style={S.rowTime}>{timeStr(e.ts)}</span>
            <span style={S.rowCat}>
              {e.cat || KIND_RU[e.kind]}
              {e.note ? <em style={S.note}> · {e.note}</em> : null}
            </span>
            <span style={S.rowAcct}>{e.acct ? acctName(e.acct) : "—"}</span>
            <span style={{ ...S.rowSum, color }}>
              {sign}{shortMoney(e.amount)}
              {!e.sent && <span style={S.pendingDot} />}
            </span>
          </button>
          <button className="k-del" onClick={() => setAsk(true)} aria-label="Удалить">✕</button>
        </>
      )}
    </li>
  );
});

/* ---------- подтверждение ---------- */

function Toast({ entry, acctName, onNote, onUndo }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note || "");
  useEffect(() => { setEditing(false); setDraft(entry.note || ""); }, [entry.id]);

  return (
    <div style={S.toast} role="status">
      {editing ? (
        <>
          <input className="k-toast-input" autoFocus placeholder="Кто заплатил"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onNote(draft.trim()); setEditing(false); } }} />
          <button className="k-undo" onClick={() => { onNote(draft.trim()); setEditing(false); }}>
            Готово
          </button>
        </>
      ) : (
        <>
          <span style={{ minWidth: 0 }}>
            <b>{money(entry.amount)}</b> · {acctName(entry.acct)}
            {entry.note ? " · " + entry.note : ""}
          </span>
          <span style={{ display: "flex", gap: 7, flexShrink: 0 }}>
            <button className="k-undo" onClick={() => setEditing(true)}>Имя</button>
            <button className="k-undo" onClick={onUndo}>Отменить</button>
          </span>
        </>
      )}
    </div>
  );
}

/* ---------- ввод ---------- */

function Pad({ data, init, acctColor, onSave, onClose }) {
  const [st, setSt] = useState(() => ({
    id: init.id,
    amount: init.amount || "",
    kind: init.kind || "in",
    cat: init.cat !== undefined ? init.cat : data.lastCat?.in || data.cats.in[0],
    note: init.note || "",
    acct: init.acct,
    ts: init.ts || Date.now(),
    dateOpen: false,
  }));
  const editing = !!st.id;
  const value = Number(st.amount || 0);
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  const press = (d) => {
    if (d === "del") return setSt({ ...st, amount: st.amount.slice(0, -1) });
    if (st.amount.length > 8) return;
    setSt({ ...st, amount: (st.amount + d).replace(/^0+/, "") });
  };
  const shiftDay = (n) => {
    const base = new Date(st.ts), d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(base.getHours(), base.getMinutes(), 0, 0);
    setSt({ ...st, ts: d.getTime() });
  };

  return (
    <div style={S.sheetWrap} onClick={onClose}>
      <div className="k-sheet" style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.grabber} />
        <div style={S.padTop}>
          <div style={{ display: "flex", gap: 5 }}>
            {["in", "out", "self"].map((k) => (
              <button key={k} className={"k-kind" + (st.kind === k ? " on " + k : "")}
                onClick={() => setSt({
                  ...st, kind: k,
                  cat: k === "self" ? "" : data.lastCat?.[k] || (k === "in" ? data.cats.in[0] : data.cats.out[0]),
                })}>
                {k === "self" ? "Себе" : KIND_RU[k]}
              </button>
            ))}
          </div>
          <div style={S.padSum}>{st.amount ? nf.format(value) : "0"} ₽</div>
        </div>

        <div className="k-scroll" style={S.chipRow}>
          {st.dateOpen ? (
            [0, 1, 2].map((n) => (
              <button key={n}
                className={"k-chip" + (sameDay(st.ts, Date.now() - n * 86400000) ? " on" : "")}
                onClick={() => shiftDay(n)}>
                {["Сегодня", "Вчера", "Позавчера"][n]}
              </button>
            ))
          ) : (
            <button className={"k-chip" + (sameDay(st.ts, Date.now()) ? "" : " on")}
              onClick={() => setSt({ ...st, dateOpen: true })}>
              {dayLabel(st.ts)} ⌄
            </button>
          )}
        </div>

        {editing && (
          <div className="k-scroll" style={S.chipRow}>
            {data.accounts.map((a) => (
              <button key={a.id} className={"k-chip" + (st.acct === a.id ? " on" : "")}
                onClick={() => setSt({ ...st, acct: a.id })}>
                <span className="k-dot" style={{ background: acctColor(a.id), marginRight: 6 }} />
                {a.name}
              </button>
            ))}
          </div>
        )}

        {st.kind !== "self" && (
          <div className="k-scroll" style={S.chipRow}>
            {(st.kind === "in" ? data.cats.in : data.cats.out)
              .slice()
              .sort((a, b) => (a === st.cat ? -1 : b === st.cat ? 1 : 0))
              .map((c) => (
                <button key={c} className={"k-chip" + (st.cat === c ? " on" : "")}
                  onClick={() => setSt({ ...st, cat: c })}>
                  {c}
                </button>
              ))}
          </div>
        )}

        <input className="k-input" placeholder="Комментарий: имя, за что"
          value={st.note} onChange={(e) => setSt({ ...st, note: e.target.value })} />

        <div className="k-pad" style={S.pad}>
          {["1","2","3","4","5","6","7","8","9","00","0","del"].map((d) => (
            <button key={d} className="k-key" onClick={() => press(d)}>
              {d === "del" ? "⌫" : d}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="k-ghost" onClick={onClose}>Закрыть</button>
          <button className="k-save" disabled={!value}
            onClick={() => onSave({
              id: st.id, amount: value, kind: st.kind,
              cat: st.kind === "self" ? "" : st.cat,
              note: st.note.trim(), ts: st.ts, acct: st.acct,
            })}>
            {editing ? "Сохранить" : "Записать"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- настройки ---------- */

function Section({ title, summary, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button className="k-section" onClick={onToggle}>
        <span style={S.sectionText}>
          <span style={S.sectionTitle}>{title}</span>
          <span style={S.sectionSummary}>{summary}</span>
        </span>
        <span className={"k-chev" + (open ? " on" : "")}>›</span>
      </button>
      {open && <div style={{ padding: "4px 2px 18px" }}>{children}</div>}
    </div>
  );
}

function Settings({ data, persist }) {
  const [open, setOpen] = useState(null);
  const [url, setUrl] = useState(data.sheetUrl || "");
  const [newAcct, setNewAcct] = useState("");
  const [pAmount, setPAmount] = useState("");
  const [pLabel, setPLabel] = useState("");
  const [newCat, setNewCat] = useState({ in: "", out: "" });
  const toggle = (id) => setOpen(open === id ? null : id);

  const setAcct = (id, patch) =>
    persist({ ...data, accounts: data.accounts.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const setCats = (k, list) =>
    persist({ ...data, cats: { ...data.cats, [k]: list }, catsDirty: true });

  return (
    <>
      <Section title="Суммы на главной"
        summary={data.presets.map((p) => shortMoney(p.amount)).join(" · ") || "нет"}
        open={open === "sums"} onToggle={() => toggle("sums")}>
        <ul style={S.list}>
          {data.presets.map((p) => (
            <li key={p.id} style={S.row}>
              <span style={{ ...S.rowCat, flex: 1 }}>{money(p.amount)} · {p.label}</span>
              <button className="k-del"
                onClick={() => persist({ ...data, presets: data.presets.filter((x) => x.id !== p.id) })}>✕</button>
            </li>
          ))}
        </ul>
        <div style={S.addRow}>
          <input className="k-input" style={{ maxWidth: 96 }} placeholder="Сумма" inputMode="numeric"
            value={pAmount} onChange={(e) => setPAmount(e.target.value.replace(/\D/g, ""))} />
          <input className="k-input" placeholder="Название"
            value={pLabel} onChange={(e) => setPLabel(e.target.value)} />
          <button className="k-save small" disabled={!pAmount || !pLabel.trim()}
            onClick={() => {
              persist({ ...data, presets: [...data.presets, {
                id: "p" + Date.now(), amount: Number(pAmount), label: pLabel.trim(),
                cat: data.cats.in[0],
              }] });
              setPAmount(""); setPLabel("");
            }}>Добавить</button>
        </div>
      </Section>

      <Section title="Счета и карты" summary={data.accounts.map((a) => a.name).join(" · ")}
        open={open === "acct"} onToggle={() => toggle("acct")}>
        {data.accounts.map((a) => (
          <div key={a.id} style={S.card}>
            <div style={S.cardTop}>
              <span className="k-dot" style={{ background: PALETTE[(a.pal || 0) % PALETTE.length].c }} />
              <input className="k-inline" defaultValue={a.name}
                onBlur={(e) => setAcct(a.id, { name: e.target.value })} />
              <button className="k-del"
                onClick={() => persist({ ...data, accounts: data.accounts.filter((x) => x.id !== a.id) })}>✕</button>
            </div>
            <div style={S.segLine}>
              <span style={S.segLabel}>В таблицу пойдёт как</span>
              <div style={S.seg}>
                {[[false, "Личное"], [true, "Бизнес"]].map(([v, l]) => (
                  <button key={l} className={"k-seg" + (!!a.biz === v ? " on" : "")}
                    onClick={() => setAcct(a.id, { biz: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div style={S.segLine}>
              <span style={S.segLabel}>Отображать на главной</span>
              <div style={S.seg}>
                {[[false, "Суммы"], [true, "Только ввод"]].map(([v, l]) => (
                  <button key={l} className={"k-seg" + (!!a.freeOnly === v ? " on" : "")}
                    onClick={() => setAcct(a.id, { freeOnly: v })}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
        <div style={S.addRow}>
          <input className="k-input" placeholder="Новая карта или счёт"
            value={newAcct} onChange={(e) => setNewAcct(e.target.value)} />
          <button className="k-save small" disabled={!newAcct.trim()}
            onClick={() => {
              persist({ ...data, accounts: [...data.accounts, {
                id: "a" + Date.now(), name: newAcct.trim(), pal: freePal(data.accounts),
              }] });
              setNewAcct("");
            }}>Добавить</button>
        </div>
      </Section>

      <Section title="Источники и статьи"
        summary={data.cats.in.length + " источников · " + data.cats.out.length + " статей"}
        open={open === "cats"} onToggle={() => toggle("cats")}>
        {["in", "out"].map((k) => (
          <div key={k}>
            <div style={S.subHead}>{k === "in" ? "Источники дохода" : "Статьи расходов"}</div>
            <div style={S.wrapRow}>
              {data.cats[k].map((c) => (
                <button key={c} className="k-chip"
                  onClick={() => setCats(k, data.cats[k].filter((x) => x !== c))}>{c} ✕</button>
              ))}
            </div>
            <div style={S.addRow}>
              <input className="k-input" placeholder={k === "in" ? "Новый источник" : "Новая статья"}
                value={newCat[k]} onChange={(e) => setNewCat({ ...newCat, [k]: e.target.value })} />
              <button className="k-save small" disabled={!newCat[k].trim()}
                onClick={() => { setCats(k, [...data.cats[k], newCat[k].trim()]); setNewCat({ ...newCat, [k]: "" }); }}>
                Добавить
              </button>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Связь с таблицей" summary={data.sheetUrl ? "подключена" : "не подключена"}
        open={open === "sheet"} onToggle={() => toggle("sheet")}>
        <input className="k-input" placeholder="https://script.google.com/macros/s/…/exec"
          value={url} onChange={(e) => setUrl(e.target.value)}
          onBlur={() => persist({ ...data, sheetUrl: url.trim() })} />
        <p style={S.hint}>
          Записи уходят сами. Обратно таблица читается при запуске и по кнопке в шапке.
        </p>
      </Section>
    </>
  );
}

/* ---------- стили ---------- */

const INK = "#16191A";
const MUTED = "#7B8280";
const LINE = "#DDE0DA";

const S = {
  shell: {
    minHeight: "100%", padding: "14px 12px 24px", color: INK,
    transition: "background .25s ease",
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  frame: { margin: "0 auto", position: "relative" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "2px 2px 16px" },
  headLabel: { fontSize: 13, color: MUTED },
  headSum: { fontWeight: 750, letterSpacing: -1, fontVariantNumeric: "tabular-nums", marginTop: 3 },
  headRight: { display: "flex", alignItems: "center", gap: 8 },
  acctRow: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 7, marginBottom: 16 },
  main: { paddingBottom: 100, minHeight: 300 },
  sectionHead: { display: "flex", justifyContent: "space-between", fontSize: 13, color: MUTED, padding: "22px 2px 8px" },
  blockHead: { fontSize: 13, color: MUTED, padding: "24px 2px 10px" },
  subHead: { fontSize: 13, color: MUTED, padding: "16px 2px 8px" },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: { display: "flex", alignItems: "center", gap: 9, padding: "4px 12px", minHeight: 52,
    background: "#FFFFFF", borderRadius: 12, marginBottom: 6, fontSize: 14 },
  card: { background: "#FFFFFF", borderRadius: 14, padding: "12px 14px", marginBottom: 8 },
  cardTop: { display: "flex", alignItems: "center", gap: 9, paddingBottom: 10, marginBottom: 6,
    borderBottom: "1px solid #EDEFEA" },
  bar: { width: 4, height: 22, borderRadius: 4, flexShrink: 0 },
  rowTime: { color: "#A3A8A3", fontSize: 12, fontVariantNumeric: "tabular-nums" },
  rowCat: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  note: { color: "#A3A8A3", fontStyle: "normal" },
  rowAcct: { color: "#A3A8A3", fontSize: 12 },
  rowSum: { fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  acctBal: { fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  pendingDot: { display: "inline-block", width: 6, height: 6, borderRadius: 6,
    background: "#C2410C", marginLeft: 6, verticalAlign: "middle" },
  empty: { color: MUTED, fontSize: 14, padding: "16px 2px" },
  totals: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
    background: "#FFFFFF", borderRadius: 14, padding: 16 },
  totalLabel: { fontSize: 12, color: MUTED },
  totalSum: { fontSize: 20, fontWeight: 750, fontVariantNumeric: "tabular-nums", marginTop: 3 },
  monthRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 },
  chipRow: { display: "flex", gap: 7, marginBottom: 12, overflowX: "auto", paddingBottom: 4 },
  wrapRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  addRow: { display: "flex", gap: 7, marginTop: 8 },
  barRow: { padding: "6px 2px 12px" },
  barTop: { display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 },
  barTrack: { height: 7, background: "#DCE0D9", borderRadius: 7 },
  calc: { background: "#F4F6F2", borderRadius: 10, padding: "10px 12px", marginBottom: 10 },
  calcLine: { display: "flex", justifyContent: "space-between", fontSize: 13, color: MUTED,
    padding: "3px 0", fontVariantNumeric: "tabular-nums" },
  calcTotal: { color: INK, fontWeight: 700, borderTop: "1px solid #E3E6E0", marginTop: 4, paddingTop: 7 },
  segLine: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 },
  segLabel: { fontSize: 13, color: MUTED, flex: 1, minWidth: 0 },
  seg: { display: "flex", background: "#F0F2ED", borderRadius: 999, padding: 3, flexShrink: 0 },
  sectionText: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, textAlign: "left" },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: INK },
  sectionSummary: { fontSize: 13, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  monthSum: { fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0, marginLeft: "auto" },
  logBar: { display: "flex", alignItems: "center", justifyContent: "space-between",
    fontSize: 13, color: MUTED, padding: "0 2px 12px" },
  toast: { position: "sticky", bottom: 78, display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: 10, background: INK, color: "#F4F6F2",
    padding: "13px 15px", borderRadius: 14, fontSize: 14, marginTop: 14,
    boxShadow: "0 8px 24px rgba(20,25,20,.22)" },
  float: { position: "sticky", bottom: 78, background: "#DFE9DE", color: "#2C5340",
    padding: "11px 14px", borderRadius: 12, fontSize: 13, marginTop: 14 },
  err: { background: "#F6DCD4", color: "#8C2A16", padding: "10px 13px",
    borderRadius: 10, fontSize: 13, marginBottom: 12 },
  tabs: { position: "sticky", bottom: 0, display: "grid", gridTemplateColumns: "1fr 1fr",
    borderTop: "1px solid " + LINE, marginTop: 14 },
  sheetWrap: { position: "fixed", inset: 0, background: "rgba(20,25,20,.42)",
    display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  sheet: { background: "#F3F5F1", width: "100%", padding: "10px 14px 18px",
    borderRadius: "20px 20px 0 0", overflowY: "auto" },
  grabber: { width: 38, height: 4, borderRadius: 4, background: "#CDD2CB", margin: "0 auto 14px" },
  padTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  padSum: { fontSize: 30, fontWeight: 750, fontVariantNumeric: "tabular-nums", letterSpacing: -1 },
  pad: { gap: 7, margin: "14px 0" },
  hint: { fontSize: 13, color: "#9AA09A", lineHeight: 1.45, margin: "10px 2px 0" },
};

function Style() {
  return (
    <style>{`
      .k-frame { max-width: 440px; }
      .k-presets { display: grid; gap: 10px; }
      .k-pad { display: grid; grid-template-columns: repeat(3,1fr); }
      .k-sheet { max-width: 440px; max-height: 94%; }
      .k-headsum { font-size: clamp(26px, 8.5vw, 34px); }
      .k-preset-sum { font-size: clamp(30px, 9.5vw, 42px); }
      .k-scroll { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
      .k-scroll::-webkit-scrollbar { display: none; }

      .k-preset {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        width: 100%; min-height: 96px; text-align: left; cursor: pointer;
        background: #FFFFFF; border: none; border-radius: 20px; padding: 20px 22px;
        font: inherit; color: inherit;
        box-shadow: 0 1px 2px rgba(20,25,20,.05), 0 8px 20px rgba(20,25,20,.06);
        transition: transform .09s ease;
      }
      .k-preset:active { transform: scale(.975); }
      .k-preset-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .k-preset-sum { font-weight: 760; letter-spacing: -1.6px; line-height: 1; font-variant-numeric: tabular-nums; }
      .k-preset-label { font-size: 14.5px; color: #7B8280; }
      .k-preset-plus { width: 38px; height: 38px; flex-shrink: 0; border-radius: 999px;
        background: #F0F2ED; color: #8A918A; font-size: 21px;
        display: flex; align-items: center; justify-content: center; }
      .k-preset.done .k-preset-label { color: #15653F; font-weight: 600; }
      .k-preset.done .k-preset-plus { background: #15653F; color: #fff; }
      .k-preset.alt, .k-preset.solo { min-height: 78px; box-shadow: none; background: #FFFFFF99; }
      .k-preset.alt .k-preset-sum, .k-preset.solo .k-preset-sum { color: #9AA09A; font-size: 26px; letter-spacing: 3px; }

      .k-acct { display: flex; align-items: center; justify-content: center; gap: 7px;
        min-width: 0; overflow: hidden; background: #FFFFFF; border: 1.5px solid transparent;
        color: #5A625E; min-height: 44px; padding: 0 12px; border-radius: 999px;
        font: inherit; font-size: 14.5px; cursor: pointer; }
      .k-acct.on { color: #16191A; font-weight: 600; }
      .k-acct-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .k-dot { width: 8px; height: 8px; border-radius: 8px; display: inline-block; flex-shrink: 0; }

      .k-chip { background: #FFFFFF; border: 1px solid #E3E6E0; color: #5A625E;
        min-height: 40px; padding: 0 15px; border-radius: 999px; font: inherit;
        font-size: 14px; cursor: pointer; white-space: nowrap; }
      .k-chip.on { color: #FFFFFF; background: #16191A; border-color: #16191A; }

      .k-tab { position: relative; background: transparent; border: none;
        padding: 16px 0 18px; font: inherit; font-size: 14.5px; color: #9AA09A; cursor: pointer; }
      .k-tab.on { color: #16191A; font-weight: 650; }
      .k-tab.on span::after { content: ""; position: absolute; left: 50%; transform: translateX(-50%);
        bottom: 9px; width: 26px; height: 2.5px; border-radius: 3px; background: #16191A; }

      .k-pill { display: inline-flex; align-items: center; gap: 6px; background: #FFFFFF;
        border: none; color: #5A625E; min-height: 36px; padding: 0 12px; border-radius: 999px;
        font: inherit; font-size: 13px; cursor: pointer; }
      .k-icon { background: #FFFFFF; border: none; color: #5A625E; width: 36px; height: 36px;
        border-radius: 999px; font-size: 16px; cursor: pointer; }

      .k-ghost { flex: 1; background: transparent; border: 1px solid #D2D6CF; color: #5A625E;
        padding: 13px 16px; border-radius: 12px; font: inherit; font-size: 15px; cursor: pointer; }
      .k-save { flex: 1; background: #15653F; color: #fff; border: none; border-radius: 12px;
        padding: 14px; font: inherit; font-size: 16px; font-weight: 650; cursor: pointer; }
      .k-save.small { flex: none; padding: 11px 15px; font-size: 14px; }
      .k-save:disabled { background: #BFC6C0; }

      .k-key { background: #FFFFFF; border: none; border-radius: 12px; padding: 17px 0;
        font: inherit; font-size: 22px; font-weight: 600; cursor: pointer; font-variant-numeric: tabular-nums; }
      .k-key:active { background: #E4E8E2; }

      .k-kind { background: #FFFFFF; border: 1px solid #E3E6E0; color: #7B8280;
        min-height: 38px; padding: 0 13px; border-radius: 999px; font: inherit; font-size: 13px; cursor: pointer; }
      .k-kind.on { color: #fff; background: #15653F; border-color: #15653F; }
      .k-kind.on.out { background: #A33421; border-color: #A33421; }
      .k-kind.on.self { background: #5A625E; border-color: #5A625E; }

      .k-input { flex: 1; width: 100%; background: #FFFFFF; border: 1px solid #E3E6E0;
        border-radius: 12px; padding: 13px; font: inherit; font-size: 16px; color: #16191A; }
      .k-inline { flex: 1; min-width: 0; background: transparent; border: none;
        border-bottom: 1px dashed #D2D6CF; font: inherit; font-size: 15px; padding: 3px 0; color: #16191A; }

      .k-rowmain { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0;
        background: transparent; border: none; padding: 12px 0; font: inherit; color: inherit;
        text-align: left; cursor: pointer; }
      .k-acctline { display: flex; align-items: center; gap: 9px; width: 100%;
        background: transparent; border: none; padding: 2px 0; font: inherit; color: inherit;
        text-align: left; cursor: pointer; }
      .k-section { display: flex; align-items: center; justify-content: space-between; gap: 12px;
        width: 100%; background: #FFFFFF; border: none; border-radius: 14px; padding: 15px 16px;
        font: inherit; color: inherit; cursor: pointer; }
      .k-chev { color: #B6BCB6; font-size: 22px; line-height: 1; flex-shrink: 0;
        transform: rotate(90deg); transition: transform .18s ease; }
      .k-chev.on { transform: rotate(-90deg); }

      .k-seg { background: transparent; border: none; color: #7B8280; min-height: 34px;
        padding: 0 13px; border-radius: 999px; font: inherit; font-size: 13.5px; cursor: pointer; white-space: nowrap; }
      .k-seg.on { background: #FFFFFF; color: #16191A; font-weight: 600; box-shadow: 0 1px 3px rgba(20,25,20,.10); }

      .k-del { background: transparent; border: none; color: #C3C8C2; font-size: 16px;
        cursor: pointer; flex-shrink: 0; width: 40px; height: 40px; }
      .k-link { background: transparent; border: none; color: #15653F; font: inherit;
        font-size: 13.5px; font-weight: 600; cursor: pointer; padding: 6px 2px; }
      .k-link.danger { color: #A33421; }
      .k-undo { background: transparent; border: 1px solid #4A514C; color: #F4F6F2;
        min-height: 38px; padding: 0 15px; border-radius: 999px; font: inherit; font-size: 13.5px;
        cursor: pointer; flex-shrink: 0; }
      .k-toast-input { flex: 1; min-width: 0; background: transparent; border: none;
        border-bottom: 1px solid #4A514C; color: #F4F6F2; font: inherit; font-size: 16px; padding: 6px 2px; }
      .k-toast-input::placeholder { color: #8A928C; }

      @keyframes k-in-left { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
      @keyframes k-in-right { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
      .k-slide-left { animation: k-in-left .2s ease-out; }
      .k-slide-right { animation: k-in-right .2s ease-out; }

      @media (max-width: 360px) {
        .k-preset { min-height: 82px; padding: 16px; }
        .k-key { padding: 14px 0; font-size: 20px; }
      }
      @media (orientation: landscape) and (max-height: 520px) {
        .k-presets { grid-template-columns: 1fr 1fr; }
        .k-sheet { max-width: 620px; max-height: 98%; }
        .k-key { padding: 11px 0; font-size: 19px; }
      }
      @media (min-width: 700px) {
        .k-frame { max-width: 560px; }
        .k-sheet { max-width: 520px; border-radius: 20px; margin-bottom: 24px; }
        .k-presets { grid-template-columns: 1fr 1fr; }
        .k-preset.alt, .k-preset.solo { grid-column: 1 / -1; }
      }
      @media (hover: hover) and (pointer: fine) {
        .k-chip:hover, .k-acct:hover, .k-key:hover { background: #F7F8F5; }
        .k-section:hover { background: #FAFBF9; }
      }
      button:focus-visible, input:focus-visible { outline: 2px solid #15653F; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
    `}</style>
  );
}
