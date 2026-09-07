import React, { useState, useEffect, useRef, useMemo } from "react";

const KEY = "kassa-v1";

const DEFAULTS = {
  accounts: [
    { id: "a1", name: "Т-Банк", pal: 0 },
    { id: "a2", name: "Сбер", pal: 1 },
    { id: "a3", name: "Наличные", pal: 2 },
    { id: "a4", name: "Р/с ИП", pal: 3, freeOnly: true, biz: true },
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
  upds: [],
};

// Палитра счетов: акцент (точка, обводка) и подсветка страницы
const PALETTE = [
  { c: "#D19A00", t: "#F8F2DA" }, // жёлтый
  { c: "#15803D", t: "#E7EFE7" }, // зелёный
  { c: "#1D4ED8", t: "#E7EAF3" }, // синий
  { c: "#7C3AED", t: "#EEE9F4" }, // фиолетовый
  { c: "#0E7490", t: "#E2EEF0" }, // бирюзовый
  { c: "#C2410C", t: "#F5EAE2" }, // оранжевый
  { c: "#9D174D", t: "#F4E7EC" }, // малиновый
  { c: "#4D7C0F", t: "#EDF1E2" }, // оливковый
];

// Подбирает цвет, которого ещё нет у других счетов
const freePal = (accounts) => {
  const used = new Set(accounts.map((a) => a.pal));
  for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
  return accounts.length % PALETTE.length;
};

// Для счетов, заведённых до появления цветов
const guessPal = (name, taken) => {
  const n = String(name).toLowerCase();
  const wish =
    /т-?банк|тинь/.test(n) ? 0 :
    /сбер/.test(n) ? 1 :
    /налич|кэш|cash/.test(n) ? 2 :
    /р\/с|расчёт|расчет|ип/.test(n) ? 3 : null;
  if (wish !== null && !taken.has(wish)) return wish;
  for (let i = 0; i < PALETTE.length; i++) if (!taken.has(i)) return i;
  return 0;
};
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

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    const text = String(this.state.err && (this.state.err.stack || this.state.err.message));
    return (
      <div style={{ padding: 20, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
        <p style={{ fontWeight: 700, marginBottom: 8 }}>Сбой в приложении</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</pre>
        <button
          onClick={() => navigator.clipboard?.writeText(text)}
          style={{ marginTop: 12, padding: "12px 16px", fontSize: 15 }}
        >
          Скопировать текст ошибки
        </button>
        <button
          onClick={() => location.reload()}
          style={{ marginTop: 12, marginLeft: 8, padding: "12px 16px", fontSize: 15 }}
        >
          Перезапустить
        </button>
      </div>
    );
  }
}

function KassaApp() {
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
  const [crash, setCrash] = useState(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

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
      if (!Array.isArray(merged.upds)) merged.upds = [];
      const taken = new Set(
        merged.accounts.filter((a) => a.pal !== undefined).map((a) => a.pal)
      );
      merged.accounts = merged.accounts.map((a) => {
        if (a.pal !== undefined) return a;
        const pal = guessPal(a.name, taken);
        taken.add(pal);
        return { ...a, pal };
      });
      setData(merged);
      const today = new Date().toDateString();
      let start = merged.accounts.find((a) => a.id === merged.lastAcct);
      if ((!start || (merged.lastDay !== today && (start.biz || start.freeOnly))))
        start = merged.accounts.find((a) => !a.biz && !a.freeOnly) || merged.accounts[0];
      setAcct(start.id);
    })();
  }, []);

  useEffect(() => {
    const onErr = (ev) => {
      const e = ev.error || ev.reason;
      setCrash(String((e && (e.stack || e.message)) || ev.message || ev.reason));
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onErr);
    };
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
  const palOf = (id) => {
    const a = data?.accounts.find((x) => x.id === id);
    const i = a?.pal;
    return PALETTE[(i === undefined ? 0 : i) % PALETTE.length];
  };
  const acctColor = (id) => palOf(id).c;

  /* ---------- обмен с таблицей ---------- */

  const push = async (silent = false) => {
    if (!data?.sheetUrl) {
      setView("settings");
      return;
    }
    const batch = data.entries.filter((e) => !e.sent);
    const dels = data.dels || [];
    const upds = (data.upds || [])
      .map((id) => data.entries.find((e) => e.id === id))
      .filter(Boolean);
    const needCats = !!data.catsDirty;
    if (!batch.length && !dels.length && !upds.length && !needCats) {
      if (!silent) setSync({ state: "ok", msg: "Всё уже в таблице" });
      return;
    }
    setSync({ state: "run", msg: "Синхронизирую…" });

    const wire = (e) => ({
      id: e.id,
      ts: e.ts,
      time: timeStr(e.ts),
      kind: KIND_RU[e.kind] || "Приход",
      amount: e.amount,
      cat: e.kind === "self" ? "" : e.cat,
      scope: e.kind === "self" || acctById(e.acct)?.biz ? "Бизнес" : "Личное",
      note: [acctName(e.acct), e.note].filter(Boolean).join(" · "),
    });

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
      updates: upds.map(wire),
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
        blocked.current = Date.now();
        setSync({ state: "err", msg: "Таблица недоступна. Проверьте ссылку и доступ «Все»." });
      }
    }

    if (ok) {
      blocked.current = 0;
      const ids = new Set(batch.map((e) => e.id));
      persist({
        ...data,
        entries: data.entries.map((e) => (ids.has(e.id) ? { ...e, sent: true } : e)),
        dels: [],
        upds: [],
        catsDirty: false,
      });
      const parts = [];
      if (batch.length) parts.push("записей: " + batch.length);
      if (upds.length) parts.push("исправлено: " + upds.length);
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

  const pendingCount = data
    ? data.entries.filter((e) => !e.sent).length +
      (data.dels || []).length +
      (data.upds || []).length
    : 0;

  useEffect(() => {
    if (!data?.sheetUrl) return;
    if (!pendingCount && !data.catsDirty) return;
    const cooling = blocked.current && Date.now() - blocked.current < 60000;
    const wait = cooling ? 60000 : 14000;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => push(true), wait);
    return () => clearTimeout(syncTimer.current);
  }, [data]);

  // вернулись из фона — экран записи, свежие данные, счёт под новый день
  const awayAt = useRef(Date.now());
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        awayAt.current = Date.now();
        return;
      }
      if (Date.now() - awayAt.current < 600000) return;
      setView("add");
      setToast(null);
      if (data) {
        const cur = data.accounts.find((a) => a.id === acct);
        if (data.lastDay !== new Date().toDateString() && cur && (cur.biz || cur.freeOnly)) {
          const safe = data.accounts.find((a) => !a.biz && !a.freeOnly);
          if (safe) setAcct(safe.id);
        }
        if (data.sheetUrl) pull(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [data, acct]);

  // сеть вернулась — сразу дожимаем очередь
  useEffect(() => {
    const onOnline = () => {
      blocked.current = 0;
      if (data?.sheetUrl) push(true);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [data]);

  /* ---------- операции ---------- */

  useEffect(() => {
    if (sync.state !== "ok" || !sync.msg) return;
    const t = setTimeout(() => setSync({ state: "idle", msg: "" }), 5000);
    return () => clearTimeout(t);
  }, [sync]);

  const showToast = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 11000);
  };

  const add = (amount, cat, kind = "in", note = "", ts = null, useAcct = null) => {
    const lastCat = { ...(data.lastCat || {}) };
    if (cat) lastCat[kind] = cat;
    const entry = {
      id: "e" + Date.now() + Math.random().toString(36).slice(2, 6),
      ts: ts || Date.now(),
      amount: Number(amount),
      cat,
      kind,
      acct: useAcct || acct,
      note,
    };
    const entries = [entry, ...data.entries].sort((a, b) => b.ts - a.ts);
    persist({
      ...data,
      entries,
      lastAcct: acct,
      lastCat,
      lastDay: new Date().toDateString(),
    });
    setNoteOpen(false);
    showToast(entry);
  };

  const saveNote = () => {
    const note = noteDraft.trim();
    persist({
      ...data,
      entries: data.entries.map((e) => (e.id === toast.id ? { ...e, note } : e)),
    });
    setToast({ ...toast, note });
    setNoteOpen(false);
  };

  const update = (patch) => {
    const entry = data.entries.find((e) => e.id === patch.id);
    if (!entry) return;
    const next = { ...entry, ...patch };
    const upds = entry.sent
      ? [...new Set([...(data.upds || []), entry.id])]
      : data.upds || [];
    const lastCat = { ...(data.lastCat || {}) };
    if (next.cat) lastCat[next.kind] = next.cat;
    persist({
      ...data,
      entries: data.entries
        .map((e) => (e.id === patch.id ? next : e))
        .sort((a, b) => b.ts - a.ts),
      upds,
      lastCat,
    });
    setToast(null);
  };

  const remove = (entry) => {
    const dels = entry.sent
      ? [...(data.dels || []), { id: entry.id, ts: entry.ts, amount: entry.amount }]
      : data.dels || [];
    persist({
      ...data,
      entries: data.entries.filter((e) => e.id !== entry.id),
      dels,
      upds: (data.upds || []).filter((id) => id !== entry.id),
    });
    if (toast && toast.id === entry.id) setToast(null);
  };

  const openEdit = (e) =>
    setPad({
      id: e.id,
      amount: String(e.amount),
      cat: e.cat,
      kind: e.kind,
      note: e.note || "",
      acct: e.acct,
      ts: e.ts,
    });

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

  const frequent = useMemo(() => {
    if (!data) return [];
    const since = Date.now() - 60 * 86400000;
    const presetSums = new Set(data.presets.map((p) => p.amount));
    const tally = {};
    data.entries.forEach((e) => {
      if (e.kind !== "in" || e.ts < since || presetSums.has(e.amount)) return;
      const k = e.amount + "|" + e.cat;
      tally[k] = (tally[k] || 0) + 1;
    });
    return Object.entries(tally)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => ({ amount: Number(k.split("|")[0]), cat: k.split("|")[1] }));
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

  const pending = pendingCount;
  const tint = view === "add" ? palOf(acct).t : "#ECEEE9";

  return (
    <div style={{ ...S.shell, background: tint }}>
      <Style />
      <div className="k-frame" style={S.frame}>
        <header style={S.header}>
          <div>
            <div style={S.headerLabel}>{monthName(monthKey(Date.now()))}</div>
            <div className="k-headsum" style={S.headerSum}>{money(thisMonth)}</div>
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

        {crash && (
          <div style={S.err}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Ошибка</div>
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
              {crash}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="k-link" onClick={() => navigator.clipboard?.writeText(crash)}>
                Скопировать
              </button>
              <button className="k-link" onClick={() => setCrash(null)}>
                Скрыть
              </button>
            </div>
          </div>
        )}

        {sync.state === "err" && sync.msg && <div style={S.err}>{sync.msg}</div>}

        {view === "add" && (
          <div style={S.acctRow} role="group" aria-label="Куда пришли деньги">
            {data.accounts.map((a, i) => {
              const n = data.accounts.length;
              const full = Math.floor(n / 3) * 3;
              const span = i < full ? 2 : 6 / (n - full);
              return (
              <button
                key={a.id}
                className={"k-acct" + (acct === a.id ? " on" : "")}
                style={{
                  gridColumn: "span " + span,
                  ...(acct === a.id ? { borderColor: acctColor(a.id) } : {}),
                }}
                onClick={() => {
                  setSlide(
                    i > data.accounts.findIndex((x) => x.id === acct) ? "left" : "right"
                  );
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
            <AddView
              data={data}
              add={add}
              frequent={frequent}
              activeAcct={acctById(acct)}
              todayEntries={todayEntries}
              acctName={acctName}
              acctColor={acctColor}
              onDelete={remove}
              onEdit={openEdit}
              openPad={() =>
                setPad({
                  amount: "",
                  cat: data.lastCat?.in || data.cats.in[0],
                  kind: "in",
                  note: "",
                  acct,
                  ts: Date.now(),
                })
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
              onEdit={openEdit}
              onPull={() => pull(false)}
              syncing={sync.state === "run"}
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

        {sync.state !== "err" && sync.msg && !toast && (
          <div style={S.syncFloat} role="status">
            {sync.msg}
          </div>
        )}

        {toast && (
          <div style={S.toast} role="status">
            {noteOpen ? (
              <>
                <input
                  className="k-toast-input"
                  autoFocus
                  placeholder="Кто заплатил"
                  value={noteDraft}
                  onChange={(ev) => setNoteDraft(ev.target.value)}
                  onKeyDown={(ev) => ev.key === "Enter" && saveNote()}
                />
                <button className="k-undo" onClick={saveNote}>
                  Готово
                </button>
              </>
            ) : (
              <>
                <span style={{ minWidth: 0 }}>
                  <b>{money(toast.amount)}</b> · {acctName(toast.acct)}
                  {toast.note ? " · " + toast.note : ""}
                </span>
                <span style={{ display: "flex", gap: 7, flexShrink: 0 }}>
                  <button
                    className="k-undo"
                    onClick={() => {
                      setNoteDraft(toast.note || "");
                      setNoteOpen(true);
                    }}
                  >
                    Имя
                  </button>
                  <button className="k-undo" onClick={() => remove(toast)}>
                    Отменить
                  </button>
                </span>
              </>
            )}
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
          acctColor={acctColor}
          onSave={(v) => {
            if (v.id) update(v);
            else add(v.amount, v.cat, v.kind, v.note, v.ts, v.acct);
            setPad(null);
          }}
          onClose={() => setPad(null)}
        />
      )}
    </div>
  );
}

export default function Kassa() {
  return (
    <ErrorBoundary>
      <KassaApp />
    </ErrorBoundary>
  );
}

/* ---------- строка операции ---------- */

function EntryRow({ e, acctName, acctColor, onDelete, onEdit }) {
  const [ask, setAsk] = useState(false);
  return (
    <li style={S.row}>
      <span style={{ ...S.bar, background: acctColor(e.acct) }} />
      {ask ? (
        <>
          <span style={{ ...S.rowCat, flex: 1 }}>Удалить запись?</span>
          <button className="k-link danger" onClick={() => onDelete(e)}>
            Удалить
          </button>
          <button className="k-link" onClick={() => setAsk(false)}>
            Отмена
          </button>
        </>
      ) : (
        <>
          <button className="k-rowmain" onClick={() => onEdit && onEdit(e)}>
            <span style={S.rowTime}>{timeStr(e.ts)}</span>
            <span style={S.rowCat}>
              {e.cat || KIND_RU[e.kind]}
              {e.note ? <em style={S.note}> · {e.note}</em> : null}
            </span>
            <span style={S.rowAcct}>{acctName(e.acct)}</span>
            <span style={{ ...S.rowSum, color: sumColor(e) }}>
              {sumPrefix(e)}
              {nf.format(e.amount)}
              {!e.sent && <span style={S.pendingDot} title="Ещё не в таблице" />}
            </span>
          </button>
          <button className="k-del" onClick={() => setAsk(true)} aria-label="Удалить запись">
            ✕
          </button>
        </>
      )}
    </li>
  );
}

/* ---------- экран записи ---------- */

function AddView({ data, add, frequent, activeAcct, todayEntries, acctName, acctColor, onDelete, onEdit, openPad }) {
  const sum = todayEntries.reduce((s, e) => s + delta(e), 0);
  const freeOnly = !!activeAcct?.freeOnly;
  const [flash, setFlash] = useState(null);
  const flashRef = useRef(null);
  const hit = (key, amount, cat) => {
    add(amount, cat);
    setFlash(key);
    clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setFlash(null), 900);
  };
  return (
    <>
      <div className="k-presets" style={S.presets}>
        {!freeOnly &&
          data.presets.map((p) => (
            <button
              key={p.id}
              className={"k-preset" + (flash === p.id ? " done" : "")}
              onClick={() => hit(p.id, p.amount, p.cat)}
            >
              <span className="k-preset-text">
                <span className="k-preset-sum">{nf.format(p.amount)}</span>
                <span className="k-preset-label">
                  {flash === p.id ? "Записано" : p.label}
                </span>
              </span>
              <span className="k-preset-plus">{flash === p.id ? "✓" : "+"}</span>
            </button>
          ))}
        <button className={"k-preset" + (freeOnly ? " solo" : " alt")} onClick={openPad}>
          <span className="k-preset-sum">···</span>
          <span className="k-preset-label">
            {freeOnly ? "Ввести поступление" : "Другая сумма"}
          </span>
        </button>
      </div>

      {!freeOnly && frequent.length > 0 && (
        <div style={S.freqRow}>
          {frequent.map((f) => (
            <button
              key={f.amount + f.cat}
              className={"k-freq" + (flash === "f" + f.amount ? " done" : "")}
              onClick={() => hit("f" + f.amount, f.amount, f.cat)}
            >
              {nf.format(f.amount)}
            </button>
          ))}
        </div>
      )}

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
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
      <p style={S.swipeHint}>Смахните влево или вправо, чтобы сменить счёт</p>
    </>
  );
}

/* ---------- клавиатура ---------- */

function Pad({ data, state, setState, acctColor, onSave, onClose }) {
  const press = (d) => {
    if (d === "del") return setState({ ...state, amount: state.amount.slice(0, -1) });
    if (state.amount.length > 8) return;
    setState({ ...state, amount: (state.amount + d).replace(/^0+/, "") });
  };
  const value = Number(state.amount || 0);
  const editing = !!state.id;

  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const shiftDay = (n) => {
    const base = new Date(state.ts || Date.now());
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(base.getHours(), base.getMinutes(), 0, 0);
    setState({ ...state, ts: d.getTime() });
  };
  const isoDate = new Date(state.ts || Date.now()).toISOString().slice(0, 10);

  return (
    <div style={S.sheetWrap} onClick={onClose}>
      <div className="k-sheet" style={S.sheet} onClick={(ev) => ev.stopPropagation()}>
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
                    cat:
                      k === "self"
                        ? ""
                        : data.lastCat?.[k] ||
                          (k === "in" ? data.cats.in[0] : data.cats.out[0]),
                  })
                }
              >
                {k === "self" ? "Себе" : KIND_RU[k]}
              </button>
            ))}
          </div>
          <div style={S.padSum}>{state.amount ? nf.format(value) : "0"} ₽</div>
        </div>

        <div className="k-scroll" style={S.catRow}>
          {state.dateOpen ? (
            <>
              {[0, 1, 2].map((n) => (
                <button
                  key={n}
                  className={
                    "k-chip" +
                    (sameDay(state.ts || Date.now(), Date.now() - n * 86400000) ? " on" : "")
                  }
                  onClick={() => shiftDay(n)}
                >
                  {["Сегодня", "Вчера", "Позавчера"][n]}
                </button>
              ))}
              <label className="k-chip date">
                Другой день
                <input
                  type="date"
                  value={isoDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(ev) => {
                    if (!ev.target.value) return;
                    const base = new Date(state.ts || Date.now());
                    const d = new Date(ev.target.value + "T00:00:00");
                    d.setHours(base.getHours(), base.getMinutes(), 0, 0);
                    setState({ ...state, ts: d.getTime() });
                  }}
                />
              </label>
            </>
          ) : (
            <button
              className={"k-chip" + (sameDay(state.ts || Date.now(), Date.now()) ? "" : " on")}
              onClick={() => setState({ ...state, dateOpen: true })}
            >
              {dayLabel(state.ts || Date.now())} ⌄
            </button>
          )}
        </div>

        {editing && (
          <div className="k-scroll" style={S.catRow}>
            {data.accounts.map((a) => (
              <button
                key={a.id}
                className={"k-chip" + (state.acct === a.id ? " on" : "")}
                onClick={() => setState({ ...state, acct: a.id })}
              >
                <span className="k-dot" style={{ background: acctColor(a.id), marginRight: 6 }} />
                {a.name}
              </button>
            ))}
          </div>
        )}

        {state.kind === "self" ? (
          <p style={S.hint}>
            Перевод с бизнес-счёта себе на карту. В журнал уйдёт строка «Изъятие себе» — в
            отчёте по бизнесу это ваша зарплата.
          </p>
        ) : (
          <div className="k-scroll" style={S.catRow}>
            {(state.kind === "in" ? data.cats.in : data.cats.out)
              .slice()
              .sort((a, b) => (a === state.cat ? -1 : b === state.cat ? 1 : 0))
              .map((c) => (
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

        <div className="k-pad" style={S.pad}>
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
            onClick={() =>
              onSave({
                id: state.id,
                amount: value,
                cat: state.kind === "self" ? "" : state.cat,
                kind: state.kind,
                note: state.note.trim(),
                ts: state.ts,
                acct: state.acct,
              })
            }
          >
            {editing ? "Сохранить" : "Записать"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- все записи ---------- */

function LogView({ data, acctName, acctColor, onDelete, onEdit, onPull, syncing }) {
  const nowKey = monthKey(Date.now());
  const [openMonths, setOpenMonths] = useState([nowKey]);

  // месяц → дни → записи
  const months = [];
  data.entries.forEach((e) => {
    const mk = monthKey(e.ts);
    let m = months[months.length - 1];
    if (!m || m.key !== mk) {
      m = { key: mk, items: [], days: [] };
      months.push(m);
    }
    m.items.push(e);
    const dk = dayKey(e.ts);
    const d = m.days[m.days.length - 1];
    if (d && d.key === dk) d.items.push(e);
    else m.days.push({ key: dk, ts: e.ts, items: [e] });
  });

  const isOpen = (mk) => openMonths.includes(mk);
  const toggle = (mk) =>
    setOpenMonths(
      openMonths.includes(mk) ? openMonths.filter((x) => x !== mk) : [...openMonths, mk]
    );

  const notSent = data.entries.filter((e) => !e.sent).length;

  return (
    <>
      <div style={S.logBar}>
        <span>
          {notSent
            ? notSent + " ещё не в таблице"
            : data.entries.length
            ? "Всё сходится с таблицей"
            : "Пока пусто"}
        </span>
        <button className="k-link" onClick={onPull} disabled={syncing}>
          {syncing ? "Читаю…" : "Обновить"}
        </button>
      </div>

      {months.length === 0 && <p style={S.empty}>Записей пока нет.</p>}

      {months.map((m) => {
        const inc = m.items.filter((e) => e.kind === "in").reduce((s, e) => s + e.amount, 0);
        const out = m.items.filter((e) => e.kind === "out").reduce((s, e) => s + e.amount, 0);
        const open = isOpen(m.key);
        return (
          <div key={m.key} style={S.section}>
            <button className="k-section" onClick={() => toggle(m.key)}>
              <span style={S.sectionText}>
                <span style={S.sectionTitle}>
                  {monthName(m.key).charAt(0).toUpperCase() + monthName(m.key).slice(1)}
                </span>
                <span style={S.sectionSummary}>
                  {m.items.length} операций
                  {out ? " · расход " + money(out) : ""}
                </span>
              </span>
              <span style={S.monthSum}>{money(inc - out)}</span>
              <span className={"k-chev" + (open ? " on" : "")}>›</span>
            </button>

            {open && (
              <div style={{ paddingTop: 4 }}>
                {m.days.map((g) => (
                  <div key={g.key}>
                    <div style={S.sectionHead}>
                      <span>{dayLabel(g.ts)}</span>
                      <span style={{ fontWeight: 700, color: INK }}>
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
                          onEdit={onEdit}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
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

function Section({ title, summary, open, onToggle, children }) {
  return (
    <div style={S.section}>
      <button className="k-section" onClick={onToggle}>
        <span style={S.sectionText}>
          <span style={S.sectionTitle}>{title}</span>
          <span style={S.sectionSummary}>{summary}</span>
        </span>
        <span className={"k-chev" + (open ? " on" : "")}>›</span>
      </button>
      {open && <div style={S.sectionBody}>{children}</div>}
    </div>
  );
}

function SettingsView({ data, persist, setCats, onPull }) {
  const [open, setOpen] = useState(null);
  const [newAcct, setNewAcct] = useState("");
  const [newCat, setNewCat] = useState({ in: "", out: "" });
  const [pAmount, setPAmount] = useState("");
  const [pLabel, setPLabel] = useState("");
  const toggle = (id) => setOpen(open === id ? null : id);

  const setAcct = (id, patch) =>
    persist({
      ...data,
      accounts: data.accounts.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    });

  return (
    <>
      <Section
        title="Суммы на главной"
        summary={
          data.presets.length
            ? data.presets.map((p) => nf.format(p.amount)).join(" · ")
            : "нет кнопок"
        }
        open={open === "sums"}
        onToggle={() => toggle("sums")}
      >
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
                    cat: data.lastCat?.in || data.cats.in[0],
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
      </Section>

      <Section
        title="Счета и карты"
        summary={data.accounts.map((a) => a.name).join(" · ")}
        open={open === "acct"}
        onToggle={() => toggle("acct")}
      >
        {data.accounts.map((a) => (
          <div key={a.id} style={S.acctCard}>
            <div style={S.acctCardTop}>
              <span
                className="k-dot"
                style={{
                  background: PALETTE[(a.pal || 0) % PALETTE.length].c,
                  flexShrink: 0,
                }}
              />
              <input
                className="k-inline"
                value={a.name}
                onChange={(e) => setAcct(a.id, { name: e.target.value })}
              />
              <button
                className="k-del"
                onClick={() =>
                  persist({ ...data, accounts: data.accounts.filter((x) => x.id !== a.id) })
                }
                aria-label="Убрать счёт"
              >
                ✕
              </button>
            </div>
            <div style={S.segLine}>
              <span style={S.segLabel}>В таблицу пойдёт как</span>
              <div style={S.seg}>
                {[
                  [false, "Личное"],
                  [true, "Бизнес"],
                ].map(([val, label]) => (
                  <button
                    key={label}
                    className={"k-seg" + (!!a.biz === val ? " on" : "")}
                    onClick={() => setAcct(a.id, { biz: val })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={S.segLine}>
              <span style={S.segLabel}>Отображать на главной</span>
              <div style={S.seg}>
                {[
                  [false, "Суммы"],
                  [true, "Только ввод"],
                ].map(([val, label]) => (
                  <button
                    key={label}
                    className={"k-seg" + (!!a.freeOnly === val ? " on" : "")}
                    onClick={() => setAcct(a.id, { freeOnly: val })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
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
                accounts: [
                  ...data.accounts,
                  {
                    id: "a" + Date.now(),
                    name: newAcct.trim(),
                    pal: freePal(data.accounts),
                  },
                ],
              });
              setNewAcct("");
            }}
          >
            Добавить
          </button>
        </div>
        <p style={S.hint}>
          «Личное» и «Бизнес» — это колонка «Контур» в журнале. Названия карт в таблице не
          хранятся, они уходят в комментарий строки.
        </p>
      </Section>

      <Section
        title="Источники и статьи"
        summary={
          data.cats.in.length + " источников · " + data.cats.out.length + " статей"
        }
        open={open === "cats"}
        onToggle={() => toggle("cats")}
      >
        {["in", "out"].map((k) => (
          <div key={k}>
            <div style={S.subHead}>
              {k === "in" ? "Источники дохода" : "Статьи расходов"}
            </div>
            <div style={S.wrapRow}>
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
          Списки общие с вкладкой «Настройки» в таблице и синхронизируются в обе стороны.
        </p>
      </Section>

      <Section
        title="Связь с таблицей"
        summary={data.sheetUrl ? "подключена" : "не подключена"}
        open={open === "sheet"}
        onToggle={() => toggle("sheet")}
      >
        <input
          className="k-input"
          placeholder="https://script.google.com/macros/s/…/exec"
          value={data.sheetUrl || ""}
          onChange={(e) => persist({ ...data, sheetUrl: e.target.value.trim() })}
        />
        <button className="k-ghost wide" style={{ marginTop: 10 }} onClick={onPull}>
          Прочитать таблицу сейчас
        </button>
        <p style={S.hint}>
          Записи уходят в таблицу сами. Обратно приложение читает её при запуске и по
          нажатию на «Таблица» в шапке.
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
    minHeight: "100%",
    transition: "background .25s ease",
    padding: "14px 12px 24px",
    fontFamily:
      "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: INK,
  },
  frame: { margin: "0 auto", position: "relative" },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "2px 2px 16px",
  },
  headerLabel: { fontSize: 13, color: MUTED },
  headerSum: {
    fontWeight: 750,
    letterSpacing: -1,
    fontVariantNumeric: "tabular-nums",
    marginTop: 3,
  },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  acctRow: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 7,
    marginBottom: 16,
  },
  monthRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  main: { paddingBottom: 100, minHeight: 320 },
  presets: { gap: 10 },
  freqRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  sectionHead: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    color: MUTED,
    padding: "26px 2px 8px",
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "4px 12px 4px 12px",
    minHeight: 52,
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
  syncFloat: {
    position: "sticky",
    bottom: 78,
    background: "#DFE9DE",
    color: "#2C5340",
    padding: "11px 14px",
    borderRadius: 12,
    fontSize: 13,
    marginTop: 14,
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
    padding: "10px 14px 18px",
    borderRadius: "20px 20px 0 0",
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
  catRow: {
    display: "flex",
    gap: 7,
    marginBottom: 12,
    overflowX: "auto",
    paddingBottom: 4,
    WebkitOverflowScrolling: "touch",
  },
  pad: { gap: 7, margin: "14px 0" },
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
  wrapRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  section: { marginBottom: 8 },
  sectionText: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, textAlign: "left" },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: INK },
  sectionSummary: {
    fontSize: 13,
    color: MUTED,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sectionBody: { padding: "4px 2px 18px" },
  subHead: { fontSize: 13, color: MUTED, padding: "16px 2px 8px" },
  logBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 13,
    color: MUTED,
    padding: "0 2px 14px",
  },
  monthSum: {
    fontSize: 15,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
    marginLeft: "auto",
  },
  pendingDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: 6,
    background: "#C2410C",
    marginLeft: 6,
    verticalAlign: "middle",
  },
  acctCard: {
    background: "#FFFFFF",
    borderRadius: 14,
    padding: "12px 14px 14px",
    marginBottom: 8,
  },
  acctCardTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottom: "1px solid #EDEFEA",
  },
  segLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
  },
  segLabel: { fontSize: 13, color: MUTED, flex: 1, minWidth: 0 },
  seg: { display: "flex", background: "#F0F2ED", borderRadius: 999, padding: 3, flexShrink: 0 },
  hint: { fontSize: 13, color: "#9AA09A", lineHeight: 1.45, margin: "10px 2px 0" },
};

function Style() {
  return (
    <style>{`
      .k-preset {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        width: 100%; min-height: 96px; text-align: left; cursor: pointer;
        background: #FFFFFF; border: none; border-radius: 20px;
        padding: 20px 22px; font: inherit; color: inherit;
        box-shadow: 0 1px 2px rgba(20,25,20,.05), 0 8px 20px rgba(20,25,20,.06);
        transition: transform .09s ease, box-shadow .12s ease;
      }
      .k-preset:active { transform: scale(.975); box-shadow: 0 1px 2px rgba(20,25,20,.06); }
      .k-preset.done .k-preset-label { color: #15653F; font-weight: 600; }
      .k-preset.done .k-preset-plus { background: #15653F; color: #fff; }
      .k-freq.done { border-color: #15653F; color: #15653F; }
      .k-preset-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .k-preset-sum { font-size: 40px; font-weight: 760; letter-spacing: -1.6px; line-height: 1; font-variant-numeric: tabular-nums; }
      .k-preset-label { font-size: 14.5px; color: #7B8280; }
      .k-preset-plus {
        width: 38px; height: 38px; flex-shrink: 0; border-radius: 999px;
        background: #F0F2ED; color: #8A918A; font-size: 21px; font-weight: 500;
        display: flex; align-items: center; justify-content: center;
      }
      .k-preset.alt, .k-preset.solo { min-height: 78px; box-shadow: none; background: #FFFFFF99; }
      .k-preset.alt .k-preset-sum, .k-preset.solo .k-preset-sum {
        color: #9AA09A; font-size: 26px; letter-spacing: 3px;
      }
      .k-preset.solo { min-height: 110px; }

      .k-link {
        background: transparent; border: none; color: #15653F;
        font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer;
        padding: 6px 2px;
      }
      .k-link:disabled { color: #9AA09A; }

      .k-section {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        width: 100%; background: #FFFFFF; border: none; border-radius: 14px;
        padding: 15px 16px; font: inherit; color: inherit; cursor: pointer;
      }
      .k-section:active { background: #F7F8F5; }
      .k-chev {
        color: #B6BCB6; font-size: 22px; line-height: 1; flex-shrink: 0;
        transform: rotate(90deg); transition: transform .18s ease;
      }
      .k-chev.on { transform: rotate(-90deg); }

      .k-seg {
        background: transparent; border: none; color: #7B8280;
        min-height: 34px; padding: 0 13px; border-radius: 999px;
        font: inherit; font-size: 13.5px; cursor: pointer; white-space: nowrap;
      }
      .k-seg.on { background: #FFFFFF; color: #16191A; font-weight: 600; box-shadow: 0 1px 3px rgba(20,25,20,.10); }

      .k-freq {
        background: #FFFFFF; border: 1px solid #E3E6E0; color: #16191A;
        min-height: 44px; padding: 0 18px; border-radius: 999px;
        font: inherit; font-size: 16px; font-weight: 600; cursor: pointer;
        font-variant-numeric: tabular-nums;
      }
      .k-freq:active { background: #F0F2ED; }

      .k-acct {
        display: flex; align-items: center; justify-content: center; gap: 7px;
        min-width: 0; overflow: hidden;
        background: #FFFFFF; border: 1.5px solid transparent; color: #5A625E;
        min-height: 44px; padding: 0 16px; border-radius: 999px;
        font: inherit; font-size: 14.5px; cursor: pointer;
        transition: color .12s ease, border-color .12s ease;
      }
      .k-acct.on { color: #16191A; font-weight: 600; }
      .k-acct-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .k-dot { width: 8px; height: 8px; border-radius: 8px; display: inline-block; }

      .k-chip {
        background: #FFFFFF; border: 1px solid #E3E6E0; color: #5A625E;
        min-height: 40px; padding: 0 15px; border-radius: 999px;
        font: inherit; font-size: 14px; cursor: pointer; white-space: nowrap;
      }
      .k-chip.tiny { font-size: 12px; min-height: 32px; padding: 0 11px; }
      .k-chip.on { color: #FFFFFF; background: #16191A; border-color: #16191A; }
      .k-chip.date { position: relative; display: inline-flex; align-items: center; }
      .k-chip.date input {
        position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%;
        border: none; padding: 0;
      }

      .k-tab {
        position: relative; background: transparent; border: none;
        padding: 16px 0 18px; font: inherit; font-size: 14.5px; color: #9AA09A; cursor: pointer;
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

      .k-rowmain {
        display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0;
        background: transparent; border: none; padding: 12px 0;
        font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .k-link.danger { color: #A33421; }

      .k-del {
        background: transparent; border: none; color: #C3C8C2;
        font-size: 16px; cursor: pointer; flex-shrink: 0;
        width: 40px; height: 40px; margin: -8px -10px -8px 0;
      }
      .k-del:active { color: #A33421; }

      .k-undo {
        background: transparent; border: 1px solid #4A514C; color: #F4F6F2;
        min-height: 38px; padding: 0 15px; border-radius: 999px;
        font: inherit; font-size: 13.5px; cursor: pointer; flex-shrink: 0;
      }
      .k-toast-input {
        flex: 1; min-width: 0; background: transparent; border: none;
        border-bottom: 1px solid #4A514C; color: #F4F6F2;
        font: inherit; font-size: 16px; padding: 6px 2px;
      }
      .k-toast-input::placeholder { color: #8A928C; }
      .k-toast-input:focus { outline: none; }

      @keyframes k-in-left  { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
      @keyframes k-in-right { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
      .k-slide-left  { animation: k-in-left .22s ease-out; }
      .k-slide-right { animation: k-in-right .22s ease-out; }

      /* ── Раскладка и адаптив ─────────────────────────────── */
      .k-frame { max-width: 440px; }
      .k-presets { display: grid; }
      .k-pad { display: grid; grid-template-columns: repeat(3, 1fr); }
      .k-sheet { max-width: 440px; max-height: 94%; }
      .k-headsum { font-size: clamp(26px, 8.5vw, 34px); }
      .k-preset-sum { font-size: clamp(30px, 9.5vw, 42px); }

      .k-scroll { scrollbar-width: none; }
      .k-scroll::-webkit-scrollbar { display: none; }

      /* Узкие телефоны: SE, mini */
      @media (max-width: 360px) {
        .k-preset { min-height: 82px; padding: 16px 16px; }
        .k-preset-plus { width: 32px; height: 32px; font-size: 19px; }
        .k-acct { font-size: 13.5px; padding: 0 10px; }
        .k-key { padding: 14px 0; font-size: 20px; }
      }

      /* Альбомная ориентация: клавиатура не должна уезжать за экран */
      @media (orientation: landscape) and (max-height: 520px) {
        .k-presets { grid-template-columns: 1fr 1fr; }
        .k-sheet { max-width: 620px; max-height: 98%; }
        .k-pad { gap: 5px; }
        .k-key { padding: 11px 0; font-size: 19px; }
        .k-preset { min-height: 78px; }
      }

      /* Планшеты и десктоп */
      @media (min-width: 700px) {
        .k-frame { max-width: 560px; }
        .k-sheet { max-width: 520px; border-radius: 20px; margin-bottom: 24px; }
        .k-presets { grid-template-columns: 1fr 1fr; }
        .k-preset.alt, .k-preset.solo { grid-column: 1 / -1; }
      }

      /* Мышь вместо пальца */
      @media (hover: hover) and (pointer: fine) {
        .k-preset:hover { box-shadow: 0 2px 6px rgba(20,25,20,.08), 0 12px 26px rgba(20,25,20,.09); }
        .k-chip:hover, .k-acct:hover, .k-freq:hover, .k-key:hover { background: #F7F8F5; }
        .k-section:hover { background: #FAFBF9; }
        .k-del:hover { color: #A33421; }
        .k-link:hover { text-decoration: underline; }
      }

      button:focus-visible { outline: 2px solid #15653F; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
    `}</style>
  );
}
