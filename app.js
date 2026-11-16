"use strict";
/* Хронометр — MeMo. Records live only in this browser (localStorage). */
// Refuse to run inside someone else's page (clickjacking).
if (window.top !== window.self) { document.documentElement.innerHTML = ""; throw new Error("framed"); }
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(9)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const pad = n => String(n).padStart(2, "0");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const MIN = 60000, HOUR = 3600000;
const dkey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / MIN)); const hh = Math.floor(m / 60), mm = m % 60; return hh ? (mm ? `${hh} ч ${mm} мин` : `${hh} ч`) : `${mm} мин`; };
const fmtClock = ms => { const x = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(x / 3600)}:${pad(Math.floor(x / 60) % 60)}:${pad(x % 60)}`; };
const fmtDate = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const MON_G = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const WDL = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
function fmtDayTitle(t) {
  const today = startOfDay(Date.now());
  const d = new Date(t); const base = `${d.getDate()} ${MON_G[d.getMonth()]}`;
  if (t === today) return `Сегодня, ${base}`;
  if (t === addDays(today, -1)) return `Вчера, ${base}`;
  return `${WDL[d.getDay()][0].toUpperCase() + WDL[d.getDay()].slice(1)}, ${base}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
}
/* project colours: muted tones from the MeMo world, readable on both paper and ink; brass is kept for the total rule only */
const PALETTE = ["#3E7A6A","#9FB0A8","#5E7FA0","#8C5A5A","#7A8C4E","#A0806A","#6E6A8F","#4F8A8B","#8A9399","#B07A5A","#5C6B4E","#7D9C8F"];

/* ---------- storage: everything lives in this browser ---------- */
const KEY = "hronometr.v1";
const S = { st: null, days: {}, tab: "track", draft: { c: "", p: "", note: "", newC: "", newP: "" }, shown: 30, storageOk: true };
/* Everything read from storage or a backup file is untrusted: keep only known fields of the right type. */
const SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,200}\/exec$/;
const str = (v, max) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "").slice(0, max);
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : 0);
const safeId = v => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "");
const safeColor = v => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#8A9399");
function cleanItem(x, withColor) {
  const id = safeId(x?.id); if (!id) return null;
  const o = { id, name: str(x.name, 80) || "Без названия", archived: !!x.archived, order: num(x.order) };
  if (withColor) { o.color = safeColor(x.color); o.cats = (Array.isArray(x.cats) ? x.cats : []).map(safeId).filter(Boolean).slice(0, 300); }
  return o;
}
function cleanEntry(e) {
  const id = safeId(e?.id), s = num(e?.s), en = num(e?.e);
  if (!id || !(s > 0) || !(en > s)) return null;
  return { id, c: safeId(e.c), p: safeId(e.p), s, e: en, note: str(e.note, 2000) };
}
function cleanDays(days) {
  const out = {};
  for (const [k, d] of Object.entries(days && typeof days === "object" ? days : {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const entries = {};
    for (const e of Object.values(d?.entries || {})) { const c = cleanEntry(e); if (c) entries[c.id] = c; }
    if (Object.keys(entries).length) out[k] = { d: k, entries };
  }
  return out;
}
function cleanGoogle(g) {
  g = g || {};
  return {
    scriptUrl: SCRIPT_RE.test(g.scriptUrl || "") ? g.scriptUrl : "",
    secret: /^[A-Za-z0-9]{24,64}$/.test(g.secret || "") ? g.secret : "",
    lastExport: num(g.lastExport),
  };
}
function norm(st) {
  st = st && typeof st === "object" ? st : {};
  const pair = x => (x && safeId(x.c) && safeId(x.p) ? { c: x.c, p: x.p } : null);
  const r = st.running;
  return {
    categories: (Array.isArray(st.categories) ? st.categories : []).map(x => cleanItem(x, false)).filter(Boolean),
    projects: (Array.isArray(st.projects) ? st.projects : []).map(x => cleanItem(x, true)).filter(Boolean),
    running: r && safeId(r.c) && safeId(r.p) && num(r.s) > 0 ? { c: r.c, p: r.p, s: num(r.s), note: str(r.note, 2000) } : null,
    last: pair(st.last),
    google: cleanGoogle(st.google),
    lastBackup: num(st.lastBackup), v: 1,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) : {};
    S.st = norm(d.st); S.days = cleanDays(d.days);
  } catch { S.st = norm(null); S.days = {}; S.storageOk = false; }
}
let saveT = null;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ st: S.st, days: S.days })); S.storageOk = true; }
    catch (e) { S.storageOk = false; toast("Не удалось сохранить: память браузера недоступна или заполнена"); }
  }, 50);
}
const saveState = persist;
function saveDay(k) { if (S.days[k] && !Object.keys(S.days[k].entries || {}).length) delete S.days[k]; persist(); scheduleSync(); }
addEventListener("pagehide", () => { if (saveT) { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify({ st: S.st, days: S.days })); } catch {} } });
/* another tab changed the data: reload it */
addEventListener("storage", ev => { if (ev.key === KEY) { load(); render(); } });

/* ---------- entries ---------- */
function allEntries() { return Object.values(S.days).flatMap(d => Object.values(d.entries || {})); }
function findEntry(id) { for (const k in S.days) { const e = S.days[k]?.entries?.[id]; if (e) return e; } return null; }
function putEntry(e) {
  const k = dkey(e.s);
  for (const kk of Object.keys(S.days)) if (kk !== k && S.days[kk]?.entries?.[e.id]) { delete S.days[kk].entries[e.id]; saveDay(kk); }
  if (!S.days[k]) S.days[k] = { d: k, entries: {} };
  S.days[k].entries[e.id] = { id: e.id, c: e.c, p: e.p, s: e.s, e: e.e, note: e.note || "" };
  saveDay(k);
}
function removeEntry(id) { for (const k of Object.keys(S.days)) if (S.days[k]?.entries?.[id]) { delete S.days[k].entries[id]; saveDay(k); } }

/* ---------- directory ---------- */
const cat = id => S.st.categories.find(x => x.id === id);
const prj = id => S.st.projects.find(x => x.id === id);
const cName = id => cat(id)?.name || "Без категории";
const pName = id => prj(id)?.name || "Без проекта";
const pColor = id => prj(id)?.color || "#8A94B3";
const active = list => list.filter(x => !x.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const archived = list => list.filter(x => x.archived).sort((a, b) => a.name.localeCompare(b.name, "ru"));
/* Activities offered for a project: the ones ticked for it, or all of them when nothing is ticked. */
function allowedCats(pid) {
  const all = active(S.st.categories);
  const p = prj(pid); const ids = p?.cats || [];
  if (!ids.length) return all;
  const set = new Set(ids); const list = all.filter(c => set.has(c.id));
  return list.length ? list : all;
}
const isAllowed = (pid, cid) => allowedCats(pid).some(c => c.id === cid);
function linkCat(pid, cid) { const p = prj(pid); if (p && p.cats.length && !p.cats.includes(cid)) { p.cats.push(cid); saveState(); } }
const sameName = (list, name, exceptId) => list.find(x => x.id !== exceptId && x.name.trim().toLowerCase() === name.trim().toLowerCase());
function createCategory(name) {
  const ex = sameName(S.st.categories, name);
  if (ex) { if (ex.archived) { ex.archived = false; saveState(); toast(`«${ex.name}» возвращена из архива`); } return ex.id; }
  const x = { id: uid(), name: name.trim().slice(0, 80), archived: false, order: S.st.categories.length };
  S.st.categories.push(x); saveState(); return x.id;
}
function createProject(name) {
  const ex = sameName(S.st.projects, name);
  if (ex) { if (ex.archived) { ex.archived = false; saveState(); toast(`«${ex.name}» возвращён из архива`); } return ex.id; }
  const used = S.st.projects.map(p => p.color);
  const color = PALETTE.find(c => !used.includes(c)) || PALETTE[S.st.projects.length % PALETTE.length];
  const x = { id: uid(), name: name.trim().slice(0, 80), color, archived: false, order: S.st.projects.length, cats: [] };
  S.st.projects.push(x); saveState(); return x.id;
}

/* ---------- timer ---------- */
function resolvePick(d) {
  let c = d.c, p = d.p;
  if (c === "__new" && !d.newC.trim()) return { err: "Введите название новой категории" };
  if (p === "__new" && !d.newP.trim()) return { err: "Введите название нового проекта" };
  if (!p) return { err: "Выберите проект" };
  if (!c) return { err: "Выберите категорию активности" };
  if (p === "__new") p = createProject(d.newP);
  if (c === "__new") { c = createCategory(d.newC); linkCat(p, c); }
  return { c, p };
}
function startTimer() {
  const r = resolvePick(S.draft);
  if (r.err) { const e = $("#timer-err"); if (e) e.textContent = r.err; return; }
  S.st.running = { c: r.c, p: r.p, s: Date.now(), note: S.draft.note.trim() };
  S.st.last = { c: r.c, p: r.p };
  S.draft = { c: r.c, p: r.p, note: "", newC: "", newP: "" };
  saveState(); render();
}
function stopTimer() {
  const r = S.st.running; if (!r) return;
  const noteEl = $("#run-note"); if (noteEl) r.note = noteEl.value.trim();
  const e = { id: uid(), c: r.c, p: r.p, s: r.s, e: Date.now(), note: r.note || "" };
  S.st.running = null; saveState();
  if (e.e - e.s < MIN) { render(); toast("Меньше минуты — запись не сохранена", () => { S.st.running = r; saveState(); render(); }); return; }
  putEntry(e); render();
  toast(`Сохранено: ${cName(e.c)}, ${fmtDur(e.e - e.s)}`);
}
function updateRunning(patch) { if (!S.st.running) return; Object.assign(S.st.running, patch); if (patch.c || patch.p) S.st.last = { c: S.st.running.c, p: S.st.running.p }; saveState(); }

/* ---------- toast & modal ---------- */
let toastTimer = null;
function toast(msg, undo) {
  const root = $("#toast-root"); root.innerHTML = ""; clearTimeout(toastTimer);
  root.append(h("div", { class: "toast", role: "status" }, h("span", null, msg),
    undo && h("button", { onclick: () => { undo(); root.innerHTML = ""; } }, "Отменить")));
  toastTimer = setTimeout(() => { root.innerHTML = ""; }, undo ? 8000 : 3500);
}
function openModal(title, body, actions) {
  const root = $("#modal-root"); root.innerHTML = "";
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", esc); };
  const esc = ev => { if (ev.key === "Escape") close(); };
  document.addEventListener("keydown", esc);
  const m = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("header", null, h("h2", null, title), h("button", { class: "iconbtn", "aria-label": "Закрыть", onclick: close }, "✕")),
    body, actions && h("div", { class: "actions" }, actions));
  const ov = h("div", { class: "overlay", onpointerdown: ev => { if (ev.target === ov) close(); } }, m);
  root.append(ov);
  return close;
}
function confirmBox(title, text, okLabel) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; close(); res(v); };
    const close = openModal(title, h("p", { style: "font-size:14px" }, text), [
      h("span", { class: "sp" }), h("button", { class: "btn ghost", onclick: () => finish(false) }, "Отмена"),
      h("button", { class: "btn primary", onclick: () => finish(true) }, okLabel)]);
    const obs = new MutationObserver(() => { if (!$(".overlay")) { obs.disconnect(); if (!done) { done = true; res(false); } } });
    obs.observe($("#modal-root"), { childList: true });
  });
}

function fillCats(el, pid, value, withNew) {
  const list = pid && pid !== "__new" ? allowedCats(pid) : active(S.st.categories);
  el.innerHTML = "";
  el.append(h("option", { value: "" }, "— выберите категорию —"));
  for (const x of list) el.append(h("option", { value: x.id }, x.name));
  if (value && value !== "__new" && cat(value) && !list.some(x => x.id === value))
    el.append(h("option", { value }, cName(value) + (cat(value).archived ? " (в архиве)" : " (не из этого проекта)")));
  if (withNew) el.append(h("option", { value: "__new" }, "+ Новая категория…"));
  el.value = value || "";
  if (el.value !== (value || "")) el.value = "";
  return list;
}
function catSelect(id, value, withNew, pid) { const el = h("select", { id }); fillCats(el, pid, value, withNew); return el; }
/* after the project changes: keep the activity if it fits, pick the only one if there is just one, otherwise ask */
function pickForProject(pid, cid) {
  const list = pid && pid !== "__new" ? allowedCats(pid) : active(S.st.categories);
  if (cid === "__new" || list.some(x => x.id === cid)) return cid;
  return list.length === 1 ? list[0].id : "";
}
function prjSelect(id, value, withNew) {
  const el = h("select", { id },
    h("option", { value: "" }, "— выберите проект —"),
    active(S.st.projects).map(x => h("option", { value: x.id }, x.name)),
    value && prj(value)?.archived && h("option", { value }, pName(value) + " (в архиве)"),
    withNew && h("option", { value: "__new" }, "+ Новый проект…"));
  el.value = value || ""; return el;
}

/* ---------- entry editor ---------- */
function fromInputs(dateStr, timeStr) { const [y, m, d] = dateStr.split("-").map(Number); const [hh, mm] = timeStr.split(":").map(Number); return new Date(y, m - 1, d, hh, mm).getTime(); }
function openEditor(entry) {
  const isNew = !entry;
  const now = Math.floor(Date.now() / (5 * MIN)) * 5 * MIN;
  const e = entry ? { ...entry } : { id: uid(), c: S.st.last?.c || "", p: S.st.last?.p || "", s: now - HOUR, e: now, note: "" };
  if (e.c && !cat(e.c)) e.c = ""; if (e.p && !prj(e.p)) e.p = "";
  if (isNew) { if (e.c && cat(e.c).archived) e.c = ""; if (e.p && prj(e.p).archived) e.p = ""; }
  const ps = prjSelect("ed-p", e.p), cs = catSelect("ed-c", e.c, false, e.p);
  ps.addEventListener("change", () => { fillCats(cs, ps.value, pickForProject(ps.value, cs.value), false); });
  const date = h("input", { type: "date", id: "ed-date", value: dkey(e.s) });
  const st = h("input", { type: "time", id: "ed-s", value: fmtTime(e.s) });
  const en = h("input", { type: "time", id: "ed-e", value: fmtTime(e.e) });
  const dur = h("div", { class: "note mono" });
  const note = h("textarea", { id: "ed-note", maxlength: 2000, placeholder: "Что сделано, детали, ссылки" }, e.note || "");
  const err = h("div", { class: "err" });
  const calc = () => {
    if (!date.value || !st.value || !en.value) return null;
    const s0 = fromInputs(date.value, st.value); let e0 = fromInputs(date.value, en.value);
    if (e0 <= s0) e0 = addDays(e0, 1);
    return { s: s0, e: e0 };
  };
  const upd = () => { const r = calc(); dur.textContent = r ? `Длительность: ${fmtDur(r.e - r.s)}${dkey(r.e - 1) !== dkey(r.s) ? " · заканчивается на следующий день" : ""}` : ""; };
  [date, st, en].forEach(x => x.addEventListener("input", upd)); upd();
  const body = h("div", { style: "display:grid;gap:14px" },
    h("div", { class: "picks" }, h("label", { class: "field" }, h("span", null, "проект"), ps), h("label", { class: "field" }, h("span", null, "категория активности"), cs)),
    h("div", { class: "grid3" },
      h("label", { class: "field" }, h("span", null, "дата"), date),
      h("label", { class: "field" }, h("span", null, "начало"), st),
      h("label", { class: "field" }, h("span", null, "окончание"), en)),
    dur, h("label", { class: "field" }, h("span", null, "комментарий"), note), err);
  const close = openModal(isNew ? "Новая запись" : "Запись", body, [
    !isNew && h("button", { class: "btn ghost danger", onclick: () => {
      const old = clone(findEntry(e.id)); removeEntry(e.id); close(); render();
      toast("Запись удалена", () => { if (old) { putEntry(old); render(); } });
    } }, "Удалить"),
    h("span", { class: "sp" }),
    h("button", { class: "btn ghost", onclick: () => close() }, "Отмена"),
    h("button", { class: "btn primary", id: "ed-save", onclick: () => {
      if (!ps.value) { err.textContent = "Выберите проект"; return; }
      if (!cs.value) { err.textContent = "Выберите категорию активности"; return; }
      const r = calc(); if (!r) { err.textContent = "Укажите дату, начало и окончание"; return; }
      if (r.e - r.s > 24 * HOUR) { err.textContent = "Запись не может быть длиннее суток"; return; }
      if (r.e > Date.now() + MIN) { err.textContent = "Окончание не может быть в будущем"; return; }
      putEntry({ ...e, c: cs.value, p: ps.value, s: r.s, e: r.e, note: note.value.trim() });
      close(); render(); toast(isNew ? "Запись добавлена" : "Запись изменена");
    } }, "Сохранить"),
  ]);
}

/* ---------- render ---------- */
function render() {
  $$("nav a[data-tab]").forEach(a => { if (a.dataset.tab === S.tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const main = $("#main"); main.innerHTML = "";
  if (S.tab === "dict") viewDict(main); else if (S.tab === "reports") viewReports(main); else viewTrack(main);
}
const clockHTML = ms => fmtClock(ms).split("").map(ch => ch === ":" ? '<span class="cl">:</span>' : `<span class="dg">${ch}</span>`).join("");
function clockEl(since) {
  const el = h("div", { class: "bigclock" + (since ? "" : " idle"), "data-since": since || null, "data-fmt": since ? "clock" : null, role: "timer", "aria-label": since ? "Прошло времени" : "Таймер не запущен" });
  el.innerHTML = clockHTML(since ? Date.now() - since : 0);
  return el;
}
setInterval(() => {
  const now = Date.now();
  $$("[data-since]").forEach(el => {
    const ms = now - Number(el.dataset.since);
    if (el.dataset.fmt === "clock") el.innerHTML = clockHTML(ms); else el.textContent = el.dataset.fmt === "dur" ? fmtDur(ms) : fmtClock(ms);
  });
}, 1000);

/* ---------- Учёт ---------- */
function viewTrack(main) {
  if (!S.storageOk) main.append(h("div", { class: "banner" }, h("p", null, "Браузер не даёт сохранять данные (например, приватный режим). Записи пропадут после закрытия вкладки.")));
  const n = allEntries().length;
  const days = S.st.lastBackup ? (Date.now() - S.st.lastBackup) / (24 * HOUR) : Infinity;
  if (n >= 20 && days > 14) main.append(h("div", { class: "banner" },
    h("p", null, S.st.lastBackup ? `Последняя резервная копия — ${fmtDate(S.st.lastBackup)}. Записи хранятся только в этом браузере: сохраните копию, чтобы не потерять их.` : "Записи хранятся только в этом браузере. Сохраните резервную копию или выгрузите их в Google Таблицу, чтобы не потерять."),
    h("button", { class: "btn sm", onclick: openSettings }, "Сохранить копию")));
  if (!S.st.categories.length && !S.st.projects.length && !S.st.running) {
    main.append(h("div", { class: "card empty" },
      h("h2", null, "Сначала заполните справочник"),
      h("p", null, "Каждая запись времени получает категорию активности (что вы делаете: созвон, анализ, подготовка лекции) и проект (для чего: клиент, направление, сфера жизни). Добавьте хотя бы по одной — или создайте их прямо при запуске таймера."),
      h("div", { class: "row" }, h("a", { class: "btn", href: "#dict" }, "Открыть справочник"))));
  }
  main.append(timerCard());
  main.append(journal());
}
function timerCard() {
  const r = S.st.running; const d = S.draft;
  if (r) {
    const ps = prjSelect("run-p", r.p), cs = catSelect("run-c", r.c, false, r.p);
    cs.addEventListener("change", () => { if (cs.value) { updateRunning({ c: cs.value }); render(); } });
    ps.addEventListener("change", () => { if (ps.value) { const c = pickForProject(ps.value, r.c) || r.c; updateRunning({ p: ps.value, c }); render(); } });
    const note = h("input", { type: "text", id: "run-note", maxlength: 2000, placeholder: "Комментарий к текущей работе", value: r.note || "" });
    note.addEventListener("input", () => updateRunning({ note: note.value.trim() }));
    note.addEventListener("keydown", ev => { if (ev.key === "Enter") note.blur(); });
    return h("section", { class: "card timer running", style: `--c:${pColor(r.p)}`, "aria-label": "Идёт таймер" },
      h("div", { class: "runlabel" }, h("span", { class: "dot" }), h("span", null, `${cName(r.c)} · ${pName(r.p)}`)),
      h("div", { class: "clockrow" },
        h("div", { class: "figure" }, clockEl(r.s), h("div", { class: "rule-total", role: "presentation" }), h("div", { class: "since" }, `в работе с ${fmtTime(r.s)}${dkey(r.s) !== dkey(Date.now()) ? ", " + fmtDayTitle(startOfDay(r.s)).toLowerCase() : ""}`)),
        h("button", { class: "btn big primary", id: "btn-stop", onclick: stopTimer }, "Остановить")),
      h("div", { class: "picks" }, h("label", { class: "field" }, h("span", null, "проект"), ps), h("label", { class: "field" }, h("span", null, "категория активности"), cs)),
      h("label", { class: "field" }, h("span", null, "комментарий"), note));
  }
  if (!d.c && S.st.last && cat(S.st.last.c) && !cat(S.st.last.c).archived) d.c = S.st.last.c;
  if (!d.p && S.st.last && prj(S.st.last.p) && !prj(S.st.last.p).archived) d.p = S.st.last.p;
  if (d.c && d.c !== "__new" && (!cat(d.c) || cat(d.c).archived)) d.c = "";
  if (d.p && d.p !== "__new" && (!prj(d.p) || prj(d.p).archived)) d.p = "";
  if (d.p && d.c && d.c !== "__new") d.c = pickForProject(d.p, d.c);
  const ps = prjSelect("t-p", d.p, true), cs = catSelect("t-c", d.c, true, d.p);
  const newC = h("input", { type: "text", id: "t-newc", maxlength: 80, placeholder: "Название категории", value: d.newC, hidden: d.c !== "__new" });
  const newP = h("input", { type: "text", id: "t-newp", maxlength: 80, placeholder: "Название проекта", value: d.newP, hidden: d.p !== "__new" });
  cs.addEventListener("change", () => { d.c = cs.value; newC.hidden = d.c !== "__new"; if (!newC.hidden) newC.focus(); $("#timer-err").textContent = ""; });
  ps.addEventListener("change", () => {
    d.p = ps.value; newP.hidden = d.p !== "__new"; $("#timer-err").textContent = "";
    d.c = pickForProject(d.p, d.c); fillCats(cs, d.p, d.c, true); newC.hidden = d.c !== "__new";
    if (!newP.hidden) newP.focus(); else if (!d.c) cs.focus();
  });
  newC.addEventListener("input", () => { d.newC = newC.value; });
  newP.addEventListener("input", () => { d.newP = newP.value; });
  const note = h("input", { type: "text", id: "t-note", maxlength: 2000, placeholder: "Необязательно — можно дописать позже", value: d.note });
  note.addEventListener("input", () => { d.note = note.value; });
  [newC, newP, note].forEach(x => x.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); x.blur(); startTimer(); } }));
  return h("section", { class: "card timer", "aria-label": "Таймер" },
    h("div", { class: "picks" },
      h("label", { class: "field" }, h("span", null, "проект"), ps, newP),
      h("label", { class: "field" }, h("span", null, "категория активности"), cs, newC)),
    h("label", { class: "field" }, h("span", null, "комментарий"), note),
    h("div", { class: "err", id: "timer-err" }),
    h("div", { class: "clockrow" },
      h("div", { class: "figure" }, clockEl(null), h("div", { class: "rule-total", role: "presentation" }), h("div", { class: "since" }, "таймер не запущен")),
      h("button", { class: "btn big primary", id: "btn-start", onclick: startTimer }, "Начать")));
}
function journal() {
  const byDay = {};
  for (const e of allEntries()) (byDay[dkey(e.s)] = byDay[dkey(e.s)] || []).push(e);
  const r = S.st.running;
  if (r) (byDay[dkey(r.s)] = byDay[dkey(r.s)] || []).push({ id: "__run", ...r, e: Date.now(), live: true });
  const keys = Object.keys(byDay).sort().reverse();
  const card = h("section", { class: "card", style: "display:grid;gap:18px" },
    h("div", { class: "card-head" }, h("h2", null, "Журнал"),
      h("button", { class: "btn sm", onclick: openSettings }, "В Google Таблицу"),
      h("button", { class: "btn sm", id: "btn-add", onclick: () => openEditor(null) }, "+ Добавить вручную")));
  if (!keys.length) card.append(h("p", { class: "muted" }, "Записей пока нет. Выберите проект и категорию выше и нажмите «Начать»."));
  for (const k of keys.slice(0, S.shown)) {
    const list = byDay[k].sort((a, b) => b.s - a.s);
    const tot = list.filter(e => !e.live).reduce((t, e) => t + (e.e - e.s), 0);
    const live = list.find(e => e.live);
    const totEl = live ? h("span", { class: "num muted", "data-since": live.s - tot, "data-fmt": "dur" }, fmtDur(tot + Date.now() - live.s)) : h("span", { class: "num muted" }, fmtDur(tot));
    card.append(h("div", { class: "day" },
      h("div", { class: "dayhead" }, h("b", null, fmtDayTitle(parseKey(k))), totEl),
      list.map(e => h("button", { class: "entry" + (e.live ? " live" : ""), onclick: () => e.live ? $("#run-note")?.focus() : openEditor(e) },
        h("span", { class: "t" }, `${fmtTime(e.s)}–${e.live ? "сейчас" : fmtTime(e.e)}`),
        h("span", { class: "m", style: "min-width:0;display:grid;gap:2px" },
          h("span", { class: "what" }, h("span", { class: "dot", style: `--c:${pColor(e.p)}` }), h("span", null, cName(e.c), h("span", { class: "proj" }, " · " + pName(e.p)))),
          e.note && h("span", { class: "cm" }, e.note)),
        e.live ? h("span", { class: "d", "data-since": e.s, "data-fmt": "dur" }, fmtDur(Date.now() - e.s)) : h("span", { class: "d" }, fmtDur(e.e - e.s))))));
  }
  if (keys.length > S.shown) card.append(h("div", null, h("button", { class: "btn sm ghost", onclick: () => { S.shown += 30; render(); } }, `Показать ещё (${keys.length - S.shown} дн.)`)));
  return card;
}

/* ---------- Справочник ---------- */
function viewDict(main) {
  main.append(h("p", { class: "lead" }, "Архивные категории и проекты не удаляются: записи с ними остаются в журнале, а в списках выбора они больше не показываются. Вернуть из архива можно в любой момент."));
  main.append(h("div", { class: "dict" },
    dictCard({ title: "Категории активностей", hint: "Что вы делаете: созвон, анализ отчётности, подготовка лекции.", list: S.st.categories, kind: "c", create: createCategory, placeholder: "Новая категория" }),
    dictCard({ title: "Проекты", hint: "Для чего работаете: клиент, направление, сфера жизни. У каждого проекта можно выбрать его активности — при запуске таймера покажутся только они.", list: S.st.projects, kind: "p", create: createProject, placeholder: "Новый проект" })));
}
function dictCard({ title, hint, list, kind, create, placeholder }) {
  const act = active(list), arch = archived(list);
  const err = h("div", { class: "err" });
  const add = h("input", { type: "text", id: "add-" + kind, maxlength: 80, placeholder });
  const doAdd = () => {
    const v = add.value.trim(); if (!v) { add.focus(); return; }
    const ex = sameName(list, v);
    if (ex && !ex.archived) { err.textContent = `«${ex.name}» уже есть в списке`; return; }
    create(v); render();
    setTimeout(() => $("#add-" + kind)?.focus(), 30);
  };
  add.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); doAdd(); } });
  const items = h("div", { class: "list" });
  act.forEach((x, i) => {
    const name = h("input", { type: "text", id: `nm-${x.id}`, value: x.name, maxlength: 80, "aria-label": "Название" });
    name.addEventListener("keydown", ev => { if (ev.key === "Enter") name.blur(); if (ev.key === "Escape") { name.value = x.name; name.blur(); } });
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (!v) { name.value = x.name; return; }
      if (sameName(list, v, x.id)) { err.textContent = `«${v}» уже есть в справочнике`; name.value = x.name; return; }
      x.name = v; err.textContent = ""; saveState();
    });
    const move = dir => { const j = i + dir; if (j < 0 || j >= act.length) return; [act[i], act[j]] = [act[j], act[i]]; act.forEach((y, n) => (y.order = n)); saveState(); render(); };
    const row = h("div", { class: "li" },
      kind === "p" && h("button", { class: "swatch", style: `--c:${x.color}`, "aria-label": "Цвет проекта", title: "Сменить цвет", onclick: () => pickColor(x) }),
      name,
      h("button", { class: "iconbtn", "aria-label": "Выше", disabled: i === 0, onclick: () => move(-1) }, "↑"),
      h("button", { class: "iconbtn", "aria-label": "Ниже", disabled: i === act.length - 1, onclick: () => move(1) }, "↓"),
      h("button", { class: "btn sm ghost", "aria-label": "В архив", title: "В архив", onclick: () => {
        x.archived = true; saveState(); render();
        toast(`«${x.name}» в архиве`, () => { x.archived = false; saveState(); render(); });
      } }, h("span", { class: "arch-label" }, "В архив"),
        archIcon()));
    if (kind === "p") {
      const own = (x.cats || []).filter(id => cat(id) && !cat(id).archived);
      items.append(h("div", { class: "li-wrap" }, row, h("div", { class: "li-sub" },
        h("span", null, own.length ? `активности: ${own.map(id => cName(id)).slice(0, 3).join(", ")}${own.length > 3 ? ` и ещё ${own.length - 3}` : ""}` : "активности: все"),
        h("button", { onclick: () => pickProjectCats(x) }, own.length ? "изменить" : "выбрать"))));
    } else items.append(row);
  });
  const archBox = arch.length ? h("details", { class: "arch", open: S["open-" + kind] || null, ontoggle: ev => { S["open-" + kind] = ev.currentTarget.open; } },
    h("summary", null, `В архиве: ${arch.length}`),
    h("div", { class: "list" }, arch.map(x => h("div", { class: "li archived" },
      kind === "p" && h("span", { class: "dot", style: `--c:${x.color};margin:0 10px` }),
      h("span", { class: "name" }, x.name),
      h("button", { class: "btn sm", onclick: () => {
        if (sameName(list.filter(y => !y.archived), x.name, x.id)) { err.textContent = `Активный элемент «${x.name}» уже есть — сначала переименуйте его`; return; }
        x.archived = false; x.order = act.length; saveState(); render();
      } }, "Вернуть"))))) : null;
  return h("section", { class: "card" },
    kind === "c" ? h("div", { class: "card-head" }, h("h2", null, title), h("button", { class: "btn sm", id: "btn-import", onclick: openImport }, "Загрузить списком")) : h("h2", null, title),
    h("p", { class: "note" }, hint),
    h("div", { class: "addrow" }, add, h("button", { class: "btn", onclick: doAdd }, "Добавить")), err,
    act.length ? items : h("p", { class: "muted", style: "font-size:14px" }, "Список пуст."),
    archBox);
}
function pickProjectCats(p) {
  const all = active(S.st.categories);
  if (!all.length) { toast("Сначала добавьте категории активностей"); return; }
  const chosen = new Set((p.cats || []).filter(id => cat(id) && !cat(id).archived));
  const boxes = all.map(c => { const cb = h("input", { type: "checkbox", value: c.id }); cb.checked = chosen.has(c.id); return h("label", null, cb, h("span", null, c.name)); });
  const setAll = v => boxes.forEach(l => (l.firstChild.checked = v));
  const close = openModal(`Активности: ${p.name}`, h("div", { style: "display:grid;gap:12px" },
    h("p", { class: "note" }, "Отметьте, какие активности показывать при выборе этого проекта. Если ничего не отмечено — показываются все."),
    h("div", { class: "row" }, h("button", { class: "btn sm ghost", onclick: () => setAll(true) }, "Отметить все"), h("button", { class: "btn sm ghost", onclick: () => setAll(false) }, "Снять все")),
    h("div", { class: "checks" }, boxes)), [
    h("span", { class: "sp" }), h("button", { class: "btn ghost", onclick: () => close() }, "Отмена"),
    h("button", { class: "btn primary", id: "pc-save", onclick: () => {
      const ids = boxes.filter(l => l.firstChild.checked).map(l => l.firstChild.value);
      // archived activities that were linked before stay linked, so returning them from the archive restores the list
      const keepArchived = (p.cats || []).filter(id => cat(id)?.archived);
      p.cats = ids.length === all.length ? [] : [...ids, ...keepArchived];
      if (!ids.length) p.cats = [];
      saveState(); close(); render();
      toast(p.cats.length ? `У проекта «${p.name}» ${ids.length} ${plural(ids.length, "активность", "активности", "активностей")}` : `У проекта «${p.name}» показываются все активности`);
    } }, "Сохранить")]);
}
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };

/* ---------- import a list of activities ----------
   One activity per line. A second column (tab or «;» from Excel / Google Sheets, or a .csv column)
   may name projects, separated by commas: the activity is then linked to them. */
function parseImport(text, isCsv) {
  const out = new Map();
  const lines = String(text).replace(/^\ufeff/, "").split(/\r?\n/).slice(0, 2000);
  const unq = s => s.trim().replace(/^"(.*)"$/s, "$1").replace(/""/g, '"').trim();
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let cols;
    if (line.includes("\t")) cols = line.split("\t");
    else if (line.includes(";")) cols = line.split(";");
    else if (isCsv && line.includes(",")) cols = line.split(",");
    else cols = [line];
    cols = cols.map(unq);
    const name = cols[0].slice(0, 80); if (!name) return;
    if (i === 0 && /^(категори|активност|вид|название)/i.test(name) && (cols.length === 1 || /проект/i.test(cols[1] || ""))) return;
    const projects = cols.slice(1).join(",").split(",").map(s => s.trim().slice(0, 80)).filter(Boolean);
    const key = name.toLowerCase();
    const prev = out.get(key);
    if (prev) projects.forEach(x => prev.projects.includes(x) || prev.projects.push(x));
    else out.set(key, { name, projects });
  });
  return [...out.values()].slice(0, 500);
}
function importPlan(items) {
  const plan = { add: [], exists: [], unarchive: [], newProjects: new Set(), links: 0, archivedProjects: new Set() };
  for (const it of items) {
    const ex = sameName(S.st.categories, it.name);
    if (!ex) plan.add.push(it.name); else if (ex.archived) plan.unarchive.push(ex.name); else plan.exists.push(ex.name);
    for (const pn of it.projects) {
      const p = sameName(S.st.projects, pn);
      if (!p) plan.newProjects.add(pn); else if (p.archived) { plan.archivedProjects.add(p.name); continue; }
      plan.links++;
    }
  }
  return plan;
}
function applyImport(items) {
  for (const it of items) {
    const cid = createCategory(it.name);
    for (const pn of it.projects) {
      const ex = sameName(S.st.projects, pn);
      if (ex && ex.archived) continue;
      const pid = ex ? ex.id : createProject(pn);
      const p = prj(pid); if (!p.cats.includes(cid)) p.cats.push(cid);
    }
  }
  saveState();
}
function openImport() {
  const ta = h("textarea", { id: "imp-text", style: "min-height:160px", placeholder: "Созвон\nАнализ отчётности\nПодготовка выступления; Личный бренд\nПосты; Личный бренд, Выступления" });
  const file = h("input", { type: "file", id: "imp-file", accept: ".txt,.csv,text/plain,text/csv", hidden: true });
  const preview = h("div", { class: "preview", role: "status" });
  const go = h("button", { class: "btn primary", id: "imp-go", disabled: true }, "Добавить");
  let isCsv = false, items = [];
  const update = () => {
    items = parseImport(ta.value, isCsv); const pl = importPlan(items); preview.innerHTML = "";
    go.disabled = !items.length;
    if (!items.length) { preview.append(h("p", { class: "note" }, "Вставьте список или выберите файл — здесь появится, что будет добавлено.")); return; }
    const facts = [
      pl.add.length && `новых активностей: ${pl.add.length}`,
      pl.unarchive.length && `вернутся из архива: ${pl.unarchive.length}`,
      pl.exists.length && `уже есть: ${pl.exists.length}`,
      pl.links && `привязок к проектам: ${pl.links}`,
      pl.newProjects.size && `новых проектов: ${pl.newProjects.size} (${[...pl.newProjects].slice(0, 3).join(", ")}${pl.newProjects.size > 3 ? "…" : ""})`,
    ].filter(Boolean);
    preview.append(h("p", null, h("b", null, facts.join(" · "))));
    if (pl.links) preview.append(h("p", { class: "note" }, "У проектов из второго столбца при выборе будут показываться только привязанные к ним активности."));
    if (pl.archivedProjects.size) preview.append(h("p", { class: "note" }, `Проекты в архиве пропущены: ${[...pl.archivedProjects].join(", ")}.`));
    preview.append(h("ul", null, items.slice(0, 50).map(it => h("li", null, it.name, it.projects.length ? ` → ${it.projects.join(", ")}` : ""))));
    if (items.length > 50) preview.append(h("p", { class: "note" }, `и ещё ${items.length - 50}`));
  };
  ta.addEventListener("input", () => { isCsv = false; update(); });
  file.addEventListener("change", () => {
    const f = file.files[0]; file.value = ""; if (!f) return;
    if (/\.(xlsx?|ods|numbers)$/i.test(f.name)) { preview.innerHTML = ""; preview.append(h("p", { class: "err" }, "Файлы Excel напрямую не читаются. Сохраните таблицу как CSV (Файл → Сохранить как → CSV) или просто скопируйте столбец и вставьте сюда.")); return; }
    if (f.size > 1024 * 1024) { preview.innerHTML = ""; preview.append(h("p", { class: "err" }, "Файл слишком большой для списка активностей.")); return; }
    const read = enc => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(f, enc); });
    read("utf-8").then(async txt => { if (txt.includes("\ufffd")) txt = await read("windows-1251"); isCsv = /\.csv$/i.test(f.name); ta.value = txt; update(); });
  });
  const close = openModal("Загрузить активности списком", h("div", { style: "display:grid;gap:14px" },
    h("p", { class: "note" }, "По одной активности в строке. Можно скопировать столбец из Excel или Google Таблицы и вставить сюда. Чтобы сразу привязать активность к проектам, укажите их во втором столбце (или через «;»), несколько — через запятую."),
    h("label", { class: "field" }, h("span", null, "список"), ta),
    h("div", { class: "row" }, h("button", { class: "btn sm", onclick: () => file.click() }, "Выбрать файл (.txt, .csv)"), file),
    preview), [
    h("span", { class: "sp" }), h("button", { class: "btn ghost", onclick: () => close() }, "Отмена"),
    go]);
  go.addEventListener("click", () => {
    if (!items.length) return;
    const pl = importPlan(items); applyImport(items); close(); render();
    toast(`Готово: ${pl.add.length} ${plural(pl.add.length, "новая активность", "новые активности", "новых активностей")}` + (pl.links ? `, привязок к проектам: ${pl.links}` : ""));
  });
  update();
}

function archIcon() {
  const span = h("span", { class: "arch-icon", "aria-hidden": "true", style: "display:inline-grid" });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-10M10 12.5h4"/></svg>';
  return span;
}
function pickColor(p) {
  const close = openModal("Цвет проекта", h("div", { class: "palette" }, PALETTE.map(c =>
    h("button", { style: `--c:${c}`, "aria-label": "Цвет " + c, "aria-pressed": p.color === c ? "true" : "false", onclick: () => { p.color = c; saveState(); close(); render(); } }))), null);
}

/* ---------- files: backup, restore, CSV ---------- */
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function rowsForExport() {
  return allEntries().sort((a, b) => a.s - b.s).map(e => ({ date: dkey(e.s), s: fmtTime(e.s), e: fmtTime(e.e), min: Math.round((e.e - e.s) / MIN), c: cName(e.c), p: pName(e.p), note: e.note || "" }));
}
const HEAD = ["Дата", "Начало", "Окончание", "Минут", "Часов", "Категория", "Проект", "Комментарий"];
function exportCSV() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [HEAD.map(q).join(";")].concat(rowsForExport().map(r => [r.date, r.s, r.e, r.min, String(Math.round(r.min / 60 * 100) / 100).replace(".", ","), safeCell(r.c), safeCell(r.p), safeCell(r.note)].map(q).join(";")));
  download(`hronometr_${dkey(Date.now())}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}
function backup() {
  const st = clone(S.st); st.lastBackup = Date.now();
  download(`hronometr_backup_${dkey(Date.now())}.json`, JSON.stringify({ app: "hronometr", v: 1, exported: new Date().toISOString(), state: st, days: S.days }), "application/json");
  S.st.lastBackup = st.lastBackup; saveState();
}
function restore(file) {
  const rd = new FileReader();
  rd.onload = async () => {
    let data; try { data = JSON.parse(rd.result); } catch { toast("Файл не читается"); return; }
    if (file.size > 20 * 1024 * 1024) { toast("Файл слишком большой для резервной копии"); return; }
    if (data?.app !== "hronometr" || !data.state || !data.days || typeof data.days !== "object") { toast("Это не резервная копия Хронометра"); return; }
    const n = Object.values(data.days).reduce((t, d) => t + Object.keys(d?.entries || {}).length, 0);
    if (!(await confirmBox("Восстановить из копии?", `В копии ${n} записей от ${data.exported ? fmtDate(Date.parse(data.exported)) : "неизвестной даты"}. Все текущие данные в этом браузере будут заменены.`, "Восстановить"))) return;
    const google = S.st.google; // Google settings always stay from this browser, never from a file
    S.st = norm(data.state); S.st.google = google;
    S.days = cleanDays(data.days); persist(); render();
    const kept = Object.values(S.days).reduce((t, d) => t + Object.keys(d.entries).length, 0);
    toast(kept === n ? `Восстановлено записей: ${kept}` : `Восстановлено записей: ${kept} из ${n} — остальные были повреждены`);
  };
  rd.readAsText(file);
}

/* ---------- Google Sheets through a small script inside the user's own table ----------
   The table runs a script (Apps Script web app) that accepts the records and writes them
   to the sheet «Записи». No Google Cloud project and no sign-in window are needed.
   The script accepts data only together with the key stored in this browser. */
function newSecret() { const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; const a = new Uint32Array(32); crypto.getRandomValues(a); return [...a].map(x => abc[x % abc.length]).join(""); }
function ensureSecret() { if (!S.st.google.secret) { S.st.google.secret = newSecret(); saveState(); } return S.st.google.secret; }
function scriptCode(key) {
  return `// Хронометр → эта таблица. Вставьте этот код целиком в «Расширения → Apps Script».
// Ключ ниже знает только ваш Хронометр: без него скрипт ничего не запишет.
const KEY = '${key}';
const SHEET = 'Записи';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.key !== KEY) return reply({ ok: false, error: 'wrong key' });
    const rows = data.rows;
    if (!Array.isArray(rows) || !rows.length) return reply({ ok: false, error: 'no rows' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
    sh.clearContents();
    sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    return reply({ ok: true, count: rows.length - 1 });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Открыв адрес скрипта в браузере, вы увидите только эту строку — данных он не отдаёт.
function doGet() { return reply({ ok: true, app: 'Хронометр' }); }

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
const safeCell = v => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
function sheetRows() {
  return [HEAD, ...rowsForExport().map(r => [r.date, r.s, r.e, r.min, Math.round(r.min / 60 * 100) / 100, safeCell(r.c), safeCell(r.p), safeCell(r.note)])];
}
async function pushToSheet() {
  const g = S.st.google;
  if (!SCRIPT_RE.test(g.scriptUrl)) return { ok: false, error: "Сначала вставьте адрес скрипта (заканчивается на /exec)." };
  const rows = sheetRows();
  const body = JSON.stringify({ key: ensureSecret(), rows });
  try {
    // Plain-text body: the browser sends it without a preflight request, which Apps Script cannot answer.
    const r = await fetch(g.scriptUrl, { method: "POST", body, redirect: "follow", credentials: "omit" });
    let d = null; try { d = await r.json(); } catch {}
    if (!d) return { ok: false, error: "Скрипт ответил не так, как ожидалось. Проверьте, что в развёртывании выбрано «У кого есть доступ: Все»." };
    if (!d.ok) return { ok: false, error: d.error === "wrong key" ? "Ключ в скрипте не совпадает с этим Хронометром. Скопируйте код скрипта заново и обновите развёртывание." : "Ошибка в таблице: " + str(d.error, 200) };
    g.lastExport = Date.now(); saveState(); return { ok: true, count: d.count };
  } catch {
    // If the browser could not read the answer, send once more without reading it.
    try { await fetch(g.scriptUrl, { method: "POST", body, mode: "no-cors", credentials: "omit" }); g.lastExport = Date.now(); saveState(); return { ok: true, unconfirmed: true, count: rows.length - 1 }; }
    catch { return { ok: false, error: "Нет связи с Google. Проверьте интернет и повторите." }; }
  }
}

/* ---------- automatic update: a few seconds after any change to the records ---------- */
let syncT = null, syncFailed = false, syncRunning = false, syncAgain = false;
function scheduleSync() {
  clearTimeout(syncT);
  if (!S.st.google.scriptUrl) return;
  syncT = setTimeout(runSync, 4000);
}
async function runSync() {
  if (syncRunning) { syncAgain = true; return; }
  syncRunning = true;
  const r = await pushToSheet();
  syncRunning = false;
  if (!r.ok && !syncFailed) toast("Google Таблица не обновилась: " + r.error);
  syncFailed = !r.ok;
  if (syncAgain) { syncAgain = false; runSync(); }
}

/* ---------- reports ---------- */
const DAY = 86400000;
const startOfWeek = t => { const d = startOfDay(t); return addDays(d, -((new Date(d).getDay() + 6) % 7)); };
const startOfMonth = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const addMonths = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
const WD = ["вс","пн","вт","ср","чт","пт","сб"];
const MON_N = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const fmtHours = ms => (Math.round(ms / HOUR * 10) / 10).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat(9)) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
S.rep = { period: "week", from: "", to: "" };
function repRange() {
  const now = Date.now(); const p = S.rep.period;
  if (p === "week") { const a = startOfWeek(now); return [a, addDays(a, 7)]; }
  if (p === "month") { const a = startOfMonth(now); return [a, addMonths(a, 1)]; }
  if (p === "lastmonth") { const a = addMonths(startOfMonth(now), -1); return [a, addMonths(a, 1)]; }
  const f = S.rep.from ? parseKey(S.rep.from) : startOfWeek(now); const t = S.rep.to ? addDays(parseKey(S.rep.to), 1) : addDays(f, 7);
  return [f, Math.max(t, addDays(f, 1))];
}
function entriesIn(from, to) {
  const list = allEntries().filter(e => e.s >= from && e.s < to);
  const r = S.st.running; if (r && r.s >= from && r.s < to) list.push({ ...r, id: "__run", e: Date.now() });
  return list;
}
const durOf = e => e.e - e.s;
function sumBy(list, key) { const m = {}; for (const e of list) m[e[key]] = (m[e[key]] || 0) + durOf(e); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function viewReports(main) {
  const sec = h("section", { class: "stack" });
  const [from, to] = repRange();
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Период" }, [["week", "Неделя"], ["month", "Месяц"], ["lastmonth", "Прошлый месяц"], ["custom", "Период"]].map(([k, l]) =>
    h("button", { "aria-pressed": S.rep.period === k ? "true" : "false", onclick: () => { S.rep.period = k; render(); } }, l)));
  const tools = h("div", { class: "toolbar" }, h("div", { class: "field" }, h("span", null, "период"), seg));
  if (S.rep.period === "custom") {
    const fi = h("input", { type: "date", id: "rep-from", value: S.rep.from || dkey(from) }), ti = h("input", { type: "date", id: "rep-to", value: S.rep.to || dkey(addDays(to, -1)) });
    const apply = () => { S.rep.from = fi.value; S.rep.to = ti.value; render(); };
    fi.addEventListener("change", apply); ti.addEventListener("change", apply);
    tools.append(h("div", { class: "field" }, h("span", null, "с — по"), h("div", { class: "dates" }, fi, h("span", { class: "muted" }, "—"), ti)));
  }
  tools.append(h("div", { class: "row", style: "margin-left:auto" }, h("button", { class: "btn", onclick: openSettings }, "Google Таблица")));
  sec.append(tools);
  const list = entriesIn(from, to);
  const total = list.reduce((t, e) => t + durOf(e), 0);
  const days = []; for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const perDay = days.map(d => list.filter(e => e.s >= d && e.s < addDays(d, 1)).reduce((t, e) => t + durOf(e), 0));
  const worked = perDay.filter(v => v > 0).length;
  const label = S.rep.period === "month" || S.rep.period === "lastmonth" ? `${MON_N[new Date(from).getMonth()]} ${new Date(from).getFullYear()}` : `${fmtDate(from)} — ${fmtDate(addDays(to, -1))}`;
  sec.append(h("section", { class: "hero" },
    h("div", { class: "fig" }, fmtHours(total), h("small", null, "ч")),
    h("div", { class: "rule-total", role: "presentation" }),
    h("div", { class: "cap" }, label),
    h("div", { class: "kpis" },
      kpi(worked ? fmtHours(total / worked) : "0,0", "часов в среднем за рабочий день"),
      kpi(String(worked), "дней с записями"),
      kpi(String(list.length), "записей"),
      kpi(list.length ? fmtDur(total / list.length) : "—", "средняя запись"))));
  if (!list.length) { sec.append(h("div", { class: "card empty" }, h("p", null, "За этот период записей нет."))); main.append(sec); return; }
  sec.append(h("section", { class: "card stack18" }, h("h2", null, "Часы по дням"), dayChart(days, perDay)));
  sec.append(h("div", { class: "rep-grid" }, barCard("По проектам", sumBy(list, "p"), total, pName, pColor), barCard("По категориям", sumBy(list, "c"), total, cName, null)));
  const tb = h("tbody");
  for (const [p, v] of sumBy(list, "p")) {
    tb.append(h("tr", { class: "pr" }, h("td", null, pName(p)), h("td", { class: "n" }, fmtHours(v)), h("td", { class: "n" }, Math.round(v / total * 100) + "%")));
    for (const [c, vc] of sumBy(list.filter(e => e.p === p), "c")) tb.append(h("tr", { class: "sub" }, h("td", null, cName(c)), h("td", { class: "n" }, fmtHours(vc)), h("td", { class: "n" }, Math.round(vc / total * 100) + "%")));
  }
  sec.append(h("section", { class: "card stack18" }, h("h2", null, "Проекты и категории"),
    h("div", { class: "scroll-x" }, h("table", { class: "t" }, h("thead", null, h("tr", null, h("th", null, "проект / категория"), h("th", { class: "n" }, "часов"), h("th", { class: "n" }, "доля"))), tb))));
  main.append(sec);
}
const kpi = (v, l) => h("div", { class: "kpi" }, h("span", { class: "v" }, v), h("span", { class: "l" }, l));
function barCard(title, pairs, total, nameOf, colorOf) {
  const max = pairs[0]?.[1] || 1;
  return h("section", { class: "card" }, h("h2", null, title), h("div", { class: "hbars", role: "list" }, pairs.map(([id, v]) =>
    h("div", { class: "hrow", role: "listitem", title: `${nameOf(id)}: ${fmtDur(v)}` },
      h("span", { class: "nm" }, colorOf && h("span", { class: "dot", style: `--c:${colorOf(id)}` }), h("span", null, nameOf(id))),
      h("span", { class: "track" }, h("i", { style: `width:${Math.max(1, v / max * 100)}%` })),
      h("span", { class: "h" }, fmtHours(v) + " ч"),
      h("span", { class: "pc" }, Math.round(v / total * 100) + "%")))));
}
function dayChart(days, vals) {
  const n = days.length; const W = Math.round(Math.min(760, Math.max(300, innerWidth - 90))), H = W < 500 ? 200 : 240, L = 34, R = 6, T = 14, B = 28;
  const maxV = Math.max(HOUR, ...vals); const stepH = maxV > 10 * HOUR ? 4 : maxV > 5 * HOUR ? 2 : 1; const top = Math.ceil(maxV / HOUR / stepH) * stepH;
  const y = v => T + (H - T - B) * (1 - v / (top * HOUR)); const bw = (W - L - R) / n; const today = startOfDay(Date.now());
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Часы по дням" });
  for (let t = 0; t <= top; t += stepH) svg.append(sv("line", { class: t ? "gridl" : "axis", x1: L, x2: W - R, y1: y(t * HOUR), y2: y(t * HOUR) }), sv("text", { x: L - 8, y: y(t * HOUR) + 4, "text-anchor": "end" }, t + " ч"));
  const wrap = h("div", { class: "chart" }, svg); const tip = h("div", { class: "tip", hidden: true }); wrap.append(tip);
  const every = n > 16 ? Math.ceil(n / (W < 500 ? 7 : 12)) : (W < 500 && n > 8 ? 2 : 1);
  days.forEach((d, i) => {
    const v = vals[i]; const x = L + i * bw + bw * 0.2, w = Math.max(2, bw * 0.6); const dd = new Date(d);
    const hit = sv("rect", { x: L + i * bw, y: T, width: bw, height: H - T - B, fill: "transparent" });
    const bar = sv("rect", { class: "bar", x, y: y(v), width: w, height: Math.max(0, y(0) - y(v)), rx: 1.5 });
    const show = () => { bar.classList.add("hl"); const bx = svg.getBoundingClientRect(); tip.hidden = false; tip.innerHTML = ""; tip.append(h("b", null, `${WD[dd.getDay()]}, ${dd.getDate()} ${MON_G[dd.getMonth()]}`), h("br"), v ? fmtDur(v) : "нет записей"); tip.style.left = ((x + w / 2) / W * bx.width) + "px"; tip.style.top = (y(v) / H * bx.height - 8) + "px"; };
    const hide = () => { bar.classList.remove("hl"); tip.hidden = true; };
    hit.addEventListener("pointerenter", show); hit.addEventListener("pointerleave", hide); hit.addEventListener("pointerdown", show);
    svg.append(hit, bar);
    if (i % every === 0) svg.append(sv("text", { x: x + w / 2, y: H - 10, "text-anchor": "middle", class: d === today ? "today" : null }, n <= 8 && W >= 500 ? `${WD[dd.getDay()]} ${dd.getDate()}` : n <= 8 ? WD[dd.getDay()] : dd.getDate()));
  });
  return wrap;
}

/* ---------- settings / data modal ---------- */
function openSettings() {
  const g = S.st.google;
  const key = ensureSecret();
  const url = h("input", { type: "text", id: "g-url", placeholder: "https://script.google.com/macros/s/…/exec", value: g.scriptUrl, autocomplete: "off", spellcheck: "false" });
  const status = h("div", { class: "note", role: "status" },
    g.scriptUrl ? (g.lastExport ? `Подключено. Последняя отправка: ${fmtDate(g.lastExport)} ${fmtTime(g.lastExport)}.` : "Подключено, отправок ещё не было.") : "");
  const say = (text, bad) => { status.style.color = bad ? "var(--bad)" : ""; status.textContent = text; };
  const go = h("button", { class: "btn primary", id: "g-go" }, g.scriptUrl ? "Отправить сейчас" : "Подключить и отправить");
  go.addEventListener("click", async () => {
    const v = url.value.trim();
    if (!SCRIPT_RE.test(v)) { say("Это не адрес веб-приложения Apps Script. Он начинается с https://script.google.com/macros/s/ и заканчивается на /exec.", true); return; }
    g.scriptUrl = v; saveState(); go.disabled = true; say("Отправляю записи в таблицу…");
    const r = await pushToSheet(); go.disabled = false;
    if (r.ok) { go.textContent = "Отправить сейчас"; syncFailed = false; say(r.unconfirmed ? `Отправлено ${r.count} записей. Браузер не показал ответ таблицы — откройте её и проверьте лист «Записи».` : `Готово: в таблице ${r.count} записей. Дальше она будет обновляться сама.`); }
    else say(r.error, true);
  });
  const copyCode = h("button", { class: "btn", id: "g-copy" }, "Скопировать код скрипта");
  const codeBox = h("textarea", { id: "g-code", readonly: true, style: "font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;min-height:120px", "aria-label": "Код скрипта" }, scriptCode(key));
  copyCode.addEventListener("click", async () => { try { await navigator.clipboard.writeText(codeBox.value); toast("Код скопирован"); } catch { codeBox.hidden = false; codeBox.focus(); codeBox.select(); toast("Выделите код и скопируйте вручную"); } });
  codeBox.hidden = true;
  const off = g.scriptUrl ? h("button", { class: "btn ghost", onclick: () => { g.scriptUrl = ""; saveState(); toast("Таблица отключена"); openSettings(); } }, "Отключить") : null;
  const file = h("input", { type: "file", id: "restore-file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", () => { if (file.files[0]) restore(file.files[0]); file.value = ""; });
  const n = allEntries().length;
  const steps = h("ol", { class: "note" },
    h("li", null, "Создайте Google Таблицу (или откройте ту, где нужны записи) → меню ", h("b", null, "«Расширения» → «Apps Script»"), "."),
    h("li", null, "Удалите всё в редакторе, нажмите здесь ", h("b", null, "«Скопировать код скрипта»"), ", вставьте и сохраните."),
    h("li", null, h("b", null, "«Начать развёртывание» → «Новое развёртывание»"), " → шестерёнка → «Веб-приложение». «Запуск от имени»: ", h("b", null, "Я"), ", «У кого есть доступ»: ", h("b", null, "Все"), ". Нажмите «Начать развёртывание» и разрешите доступ к таблице."),
    h("li", null, "Скопируйте ", h("b", null, "URL веб-приложения"), " (заканчивается на /exec), вставьте ниже и нажмите «Подключить и отправить»."));
  const body = h("div", { style: "display:grid;gap:18px" },
    h("div", { class: "sect" },
      h("h3", null, "Google Таблица"),
      h("p", { class: "note" }, "Записи сами отправляются в вашу Google Таблицу через небольшой скрипт внутри неё — через несколько секунд после каждой новой, изменённой или удалённой записи. Лист «Записи» каждый раз перезаписывается целиком, свои расчёты делайте на других листах."),
      g.scriptUrl ? h("details", null, h("summary", { style: "cursor:pointer;font-size:14px;color:var(--text-muted)" }, "Как подключить (если нужно заново)"), h("div", { style: "display:grid;gap:10px;margin-top:10px" }, steps, h("div", { class: "row" }, copyCode), codeBox))
        : h("div", { style: "display:grid;gap:10px" }, steps, h("div", { class: "row" }, copyCode), codeBox),
      h("label", { class: "field" }, h("span", null, "адрес скрипта"), url),
      h("div", { class: "row" }, go, off), status,
      h("p", { class: "note" }, "«Доступ: Все» нужен, чтобы Хронометр мог достучаться до скрипта. Записать что-то в таблицу можно только с ключом, который хранится в этом браузере, а прочитать данные через скрипт нельзя никому.")),
    h("div", { class: "sect" },
      h("h3", null, "Резервная копия"),
      h("p", { class: "note" }, `Записи (${n}) хранятся только в этом браузере на этом устройстве. Сохраняйте копию время от времени — из неё можно восстановить данные или перенести их на другое устройство.` + (S.st.lastBackup ? ` Последняя копия: ${fmtDate(S.st.lastBackup)}.` : "")),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: backup }, "Скачать копию"),
        h("button", { class: "btn ghost", onclick: () => file.click() }, "Восстановить из копии…"),
        h("button", { class: "btn ghost", onclick: exportCSV, disabled: !n }, "Скачать CSV")), file));
  openModal("Данные и выгрузка", body, null);
}

/* ---------- routing, keys, boot ---------- */
function route() { const t = location.hash.replace("#", ""); S.tab = ["dict", "reports"].includes(t) ? t : "track"; render(); }
addEventListener("hashchange", route);
$("#btn-settings").addEventListener("click", openSettings);
document.addEventListener("keydown", ev => {
  if (ev.target.closest && ev.target.closest("input,textarea,select,button,[contenteditable]")) return;
  if ($(".overlay") || ev.metaKey || ev.ctrlKey || ev.altKey || S.tab !== "track") return;
  if (ev.code === "Space") { ev.preventDefault(); if (S.st.running) stopTimer(); else startTimer(); }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$(".overlay") && !document.activeElement?.matches?.("input,textarea,select")) { load(); render(); } });
load(); route();
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
