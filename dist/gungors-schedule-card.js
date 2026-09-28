// gungors-schedule-card — form editor for local calendar events whose description is JSON
// JSON keys: room_name (area name), temp, sleep_temp (optional), darkness (optional, true)
const VERSION = "0.6.0";
const DEFAULT_CALS = ["calendar.sercan", "calendar.melike", "calendar.misafir"];
const DEFAULT_TOGGLES = [
  { entity: "automation.climate_schedule", name: "Isınma", icon: "mdi:radiator", group: "climate", sync: "script.climate_schedule_sync_room" },
  { entity: "automation.cover_schedule", name: "Perdeler", icon: "mdi:curtains", group: "cover", sync: "script.cover_schedule_sync_room" },
];
const GROUP_META = {
  climate: { name: "Isınma", icon: "mdi:radiator" },
  cover: { name: "Perdeler", icon: "mdi:curtains" },
};
const DEFAULT_TEMP = 21;
const KNOWN = ["room_name", "temp", "sleep_temp", "darkness"];
const WD = [["MO", "Pzt"], ["TU", "Sal"], ["WE", "Çar"], ["TH", "Per"], ["FR", "Cum"], ["SA", "Cmt"], ["SU", "Paz"]];
const GROUP_KEY = "gungors-schedule-card:groups:";
const GROUP_IDS = ["event", "climate", "cover"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const num = (v) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const fmtT = (v) => `${String(v).replace(".", ",")}°`;

function tzOffsetMin(ts, tz) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ts));
  const g = (t) => +p.find((x) => x.type === t).value;
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - ts) / 6e4);
}
function zonedIso(date, time, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMin(guess, tz);
  const off2 = tzOffsetMin(guess - off * 6e4, tz);
  if (off2 !== off) off = off2;
  const a = Math.abs(off);
  return `${date}T${pad(hh)}:${pad(mm)}:00${off >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function partsInTz(d, tz) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${pad(+g("hour") % 24)}:${g("minute")}` };
}
function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const weekdayIdx = (date) => (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = Monday
const fmtDate = (date) => { const [y, m, d] = date.split("-"); return `${d}.${m}.${y}`; };

function parseRrule(r) {
  if (!r) return { mode: "none", days: [], raw: "" };
  const m = Object.fromEntries(r.replace(/^RRULE:/, "").split(";").filter(Boolean).map((x) => x.split("=")));
  const keys = Object.keys(m).filter((k) => !(k === "INTERVAL" && m[k] === "1"));
  if (m.FREQ === "DAILY" && keys.length === 1) return { mode: "daily", days: [], raw: r };
  if (m.FREQ === "WEEKLY" && keys.every((k) => k === "FREQ" || k === "BYDAY"))
    return { mode: "weekly", days: (m.BYDAY || "").split(",").filter(Boolean), raw: r };
  return { mode: "custom", days: [], raw: r };
}
function parseDesc(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const d = JSON.parse(raw);
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch (e) {
    return null;
  }
}

const CSS = `
:host{display:block}
ha-card{padding:16px;color:var(--primary-text-color)}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.title{font-size:1.25rem;font-weight:500}
.tgls{display:flex;flex-direction:column;margin-bottom:8px}
.tgl{display:flex;align-items:center;gap:12px;padding:6px 4px;min-height:40px;cursor:pointer}
.tgl ha-icon{color:var(--secondary-text-color);flex:none}
.tgl.on ha-icon{color:var(--state-active-color,var(--primary-color))}
.tgl.dis{opacity:.55;cursor:default}
.tn{flex:1;min-width:0}
.ts{display:block;font-size:.75rem;color:var(--secondary-text-color)}
.sw{appearance:none;-webkit-appearance:none;width:36px;height:20px;margin:0;border-radius:10px;background:var(--switch-unchecked-track-color,var(--disabled-color,#bdbdbd));position:relative;cursor:pointer;transition:background .2s;flex:none}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}
.sw:checked{background:var(--switch-checked-track-color,var(--primary-color))}
.sw:checked::after{transform:translateX(16px)}
.sw:disabled{cursor:default;opacity:.55}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--divider-color);margin-bottom:4px;overflow-x:auto}
.tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;color:var(--secondary-text-color);font:inherit;cursor:pointer;white-space:nowrap}
.tab.on{color:var(--primary-color);border-bottom-color:var(--primary-color);font-weight:500}
.row{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--divider-color);padding:10px 4px;font:inherit;color:inherit;cursor:pointer}
.row:last-child{border-bottom:0}
.row:hover{background:var(--secondary-background-color)}
.r1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.sum{font-weight:500}
.rep,.r2{color:var(--secondary-text-color);font-size:.875rem}
.r2{margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.chip{font-size:.75rem;padding:2px 8px;border-radius:10px;background:var(--secondary-background-color);border:1px solid var(--divider-color)}
.chip.warn{color:var(--error-color);border-color:var(--error-color)}
.empty{padding:24px 4px;color:var(--secondary-text-color);text-align:center}
.err{padding:8px 10px;margin:8px 0;border-radius:6px;border:1px solid var(--error-color);color:var(--error-color);font-size:.875rem}
.note{font-size:.75rem;color:var(--secondary-text-color);margin-top:4px}
.form{display:flex;flex-direction:column;gap:12px}
.field label,.lbl{display:block;font-size:.8rem;color:var(--secondary-text-color);margin-bottom:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
input[type=text],input[type=number],input[type=date],input[type=time],select,textarea{box-sizing:border-box;width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);font:inherit;min-height:40px}
textarea{min-height:140px;font-family:var(--code-font-family,monospace);font-size:.85rem}
.check{display:flex;align-items:center;gap:8px;cursor:pointer}
.check input{width:18px;height:18px;accent-color:var(--primary-color)}
.sl{display:flex;align-items:center;gap:12px}
.sl input[type=range]{flex:1;min-width:0;height:32px;margin:0;accent-color:var(--primary-color);cursor:pointer}
.slv{min-width:64px;text-align:right;font-size:1.3rem;font-weight:500;font-variant-numeric:tabular-nums}
.slv.none{color:var(--secondary-text-color)}
.days{display:flex;flex-wrap:wrap;gap:4px}
.day{min-width:44px;padding:6px 8px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:inherit;font:inherit;cursor:pointer}
.day.on{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.grp{border:1px solid var(--divider-color);border-radius:var(--ha-card-border-radius,12px);overflow:hidden}
.grp.bad{border-color:var(--error-color)}
.gh{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:12px;min-height:56px;cursor:pointer;user-select:none}
.gh:hover{background:var(--secondary-background-color)}
.grp.off .gh{cursor:default}
.grp.off .gh:hover{background:none}
.grp.off .gi,.grp.off .gt{opacity:.5}
.gh ha-icon{color:var(--secondary-text-color);flex:none}
.grp.open .gh .gi{color:var(--primary-color)}
.grp.bad .gh ha-icon,.grp.bad .gn{color:var(--error-color)}
.gt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.gn{font-weight:500}
.gs{font-size:.85rem;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chev{transition:transform .2s}
.grp.open .chev{transform:rotate(180deg)}
.gb{display:flex;flex-direction:column;gap:12px;padding:12px 12px 14px;border-top:1px solid var(--divider-color)}
.link{background:none;border:0;padding:0;color:var(--primary-color);font:inherit;font-size:.875rem;cursor:pointer;align-self:flex-start}
.actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:4px}
.actions .right{display:flex;gap:8px;margin-left:auto}
.btn{padding:8px 14px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);font:inherit;cursor:pointer;min-height:38px}
.btn.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.btn.danger{color:var(--error-color);border-color:var(--error-color)}
.btn:disabled{opacity:.5;cursor:default}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.gh:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
`;

class GungorsScheduleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._events = [];
    this._areas = [];
    this._areaIds = {};
    this._open = {};
    this._pending = {};
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("input", (e) => this._onInput(e));
    this.shadowRoot.addEventListener("change", (e) => this._onInput(e));
    this.shadowRoot.addEventListener("keydown", (e) => {
      const el = e.target;
      if ((e.key === "Enter" || e.key === " ") && el?.dataset?.a === "grp") {
        e.preventDefault();
        this._toggleGroup(el.dataset.g);
      }
    });
  }

  setConfig(config) {
    const calendars = config.calendars || DEFAULT_CALS;
    if (!Array.isArray(calendars) || !calendars.length) throw new Error("calendars listesi gerekli");
    const rawToggles = config.toggles ?? DEFAULT_TOGGLES;
    if (!Array.isArray(rawToggles)) throw new Error("toggles bir liste olmalı");
    const toggles = rawToggles.map((t) => {
      const o = typeof t === "string" ? { entity: t } : { ...t };
      const def = DEFAULT_TOGGLES.find((d) => d.entity === o?.entity);
      if (def && !o.group) o.group = def.group;
      if (def && o.sync === undefined) o.sync = def.sync;
      return o;
    });
    if (toggles.some((t) => !t || !t.entity)) throw new Error("toggles: her öğede entity gerekli");
    const temp_min = num(config.temp_min) ?? 16;
    const temp_max = num(config.temp_max) ?? 28;
    const temp_step = num(config.temp_step) ?? 0.5;
    if (temp_min >= temp_max) throw new Error("temp_min, temp_max'tan küçük olmalı");
    if (temp_step <= 0) throw new Error("temp_step pozitif olmalı");
    this._config = { title: "Program", ...config, calendars, toggles, temp_min, temp_max, temp_step };
    if (!calendars.includes(this._cal)) this._cal = calendars[0];
    this._render();
  }

  set hass(h) {
    const prev = this._hass;
    this._hass = h;
    if (!prev) {
      this._loadAreas();
      this._load();
      return;
    }
    let changed = false;
    for (const t of this._config?.toggles || []) {
      if (prev.states[t.entity] !== h.states[t.entity]) {
        changed = true;
        delete this._pending[t.entity];
      }
    }
    if (changed) this._render();
  }

  getCardSize() { return 7; }
  static getStubConfig() { return { calendars: DEFAULT_CALS }; }
  get _tz() { return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone; }

  async _loadAreas() {
    let list;
    try {
      list = await this._hass.callWS({ type: "config/area_registry/list" });
    } catch (e) {
      list = Object.values(this._hass.areas || {});
    }
    this._areaIds = Object.fromEntries(list.map((x) => [x.name, x.area_id]));
    this._areas = list.map((x) => x.name).sort((a, b) => a.localeCompare(b, "tr"));
    this._render();
  }

  _evDate(x) { return x.dateTime ? new Date(x.dateTime) : new Date(zonedIso(x.date, "00:00", this._tz)); }

  async _load() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const now = Date.now();
      const s = new Date(now - 2 * 864e5).toISOString();
      const e = new Date(now + 60 * 864e5).toISOString();
      const res = await this._hass.callApi("GET", `calendars/${this._cal}?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`);
      const by = new Map();
      for (const ev of res) {
        const st = this._evDate(ev.start), en = this._evDate(ev.end);
        if (en.getTime() <= now) continue;
        const k = ev.uid || `${ev.summary}|${ev.start.dateTime || ev.start.date}`;
        const cur = by.get(k);
        if (!cur || st < cur._st) by.set(k, { ...ev, _st: st });
      }
      const tz = this._tz;
      const key = (ev) => {
        const p = ev.start.dateTime ? partsInTz(ev._st, tz) : { date: ev.start.date, time: "00:00" };
        return ev.rrule ? `0${p.time}` : `1${p.date}${p.time}`;
      };
      this._events = [...by.values()].sort((a, b) => key(a).localeCompare(key(b)));
    } catch (err) {
      this._error = `Takvim okunamadı: ${err?.message || err?.body?.message || err}`;
      this._events = [];
    }
    this._loading = false;
    this._render();
  }

  // ---------- automation toggles ----------
  _tState(t) { return this._hass?.states?.[t.entity]; }
  _isOn(t) { return t.entity in this._pending ? this._pending[t.entity] : this._tState(t)?.state === "on"; }
  _toggleFor(group) { return this._config.toggles.find((t) => t.group === group); }
  _groupEnabled(group) { const t = this._toggleFor(group); return !t || this._isOn(t); }
  _anyOn() { const ts = this._config.toggles; return !ts.length || ts.some((t) => this._isOn(t)); }

  async _toggleAuto(entity, on) {
    this._tglError = null;
    this._pending[entity] = on;
    const t = this._config.toggles.find((x) => x.entity === entity);
    if (on && this._form && t?.group) this._open[t.group] = true;
    this._render();
    setTimeout(() => {
      if (entity in this._pending) {
        delete this._pending[entity];
        this._render();
      }
    }, 5000);
    try {
      await this._hass.callService("automation", on ? "turn_on" : "turn_off", { entity_id: entity });
      // resync every room right away instead of waiting for the next trigger
      if (on) await this._hass.callService("automation", "trigger", { entity_id: entity, skip_condition: true });
    } catch (e) {
      delete this._pending[entity];
      this._tglError = `Değiştirilemedi (${entity}): ${e?.message || e}`;
      this._render();
    }
  }

  // re-evaluate the given rooms now, for every enabled automation that has a sync script
  async _syncRooms(roomNames) {
    const ids = [...new Set(roomNames.filter(Boolean).map((n) => this._areaIds[n]).filter(Boolean))];
    const calls = [];
    for (const t of this._config.toggles) {
      if (!t.sync || !this._isOn(t)) continue;
      for (const area_id of ids) calls.push(this._hass.callService("script", "turn_on", { entity_id: t.sync, variables: { area_id } }));
    }
    try {
      await Promise.all(calls);
    } catch (e) {
      this._tglError = `Oda yeniden hesaplanamadı: ${e?.message || e}`;
      this._render();
    }
  }

  _switchHtml(t, label) {
    const st = this._tState(t);
    const dis = !st || st.state === "unavailable" || st.state === "unknown";
    return `<input type="checkbox" class="sw" data-a="toggle" data-e="${esc(t.entity)}" ${this._isOn(t) ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${esc(label)}">`;
  }

  _togglesHtml() {
    const ts = this._config.toggles;
    if (!ts.length) return "";
    const rows = ts.map((t) => {
      const st = this._tState(t);
      const dis = !st || st.state === "unavailable" || st.state === "unknown";
      const name = t.name || st?.attributes?.friendly_name || t.entity;
      const sub = dis && this._hass ? `<span class="ts">${st ? "Kullanılamıyor" : "Automation bulunamadı"}</span>` : "";
      return `<label class="tgl ${this._isOn(t) ? "on" : ""} ${dis ? "dis" : ""}">
        <ha-icon icon="${esc(t.icon || "mdi:robot")}"></ha-icon>
        <span class="tn">${esc(name)}${sub}</span>
        ${this._switchHtml(t, name)}
      </label>`;
    }).join("");
    const none = this._hass && !this._anyOn() ? `<div class="note">Yeni event eklemek için en az bir automation açık olmalı.</div>` : "";
    return `<div class="tgls">${rows}${none}</div>${this._tglError ? `<div class="err">${esc(this._tglError)}</div>` : ""}`;
  }

  // ---------- form model ----------
  _newForm() {
    const p = partsInTz(new Date(Date.now() + 36e5), this._tz);
    const h = +p.time.slice(0, 2);
    const eh = (h + 1) % 24;
    return {
      cal: this._cal, orig: null, origRoom: null, summary: "", allDay: false,
      sDate: p.date, sTime: `${pad(h)}:00`, eDate: eh === 0 ? addDays(p.date, 1) : p.date, eTime: `${pad(eh)}:00`,
      mode: "daily", days: [], rawRrule: "",
      room: this._areas[0] || "", temp: DEFAULT_TEMP, sleepOn: false, sleepTemp: null, dark: false, extra: {},
      rawMode: false, rawBad: false, rawDesc: "",
    };
  }

  _formFromEvent(ev) {
    const tz = this._tz;
    const allDay = !ev.start.dateTime;
    let s, e;
    if (allDay) {
      s = { date: ev.start.date, time: "00:00" };
      e = { date: addDays(ev.end.date, -1), time: "00:00" };
    } else {
      s = partsInTz(new Date(ev.start.dateTime), tz);
      e = partsInTz(new Date(ev.end.dateTime), tz);
    }
    const rr = parseRrule(ev.rrule);
    if (rr.mode === "weekly" && !rr.days.length) rr.days = [WD[weekdayIdx(s.date)][0]];
    const d = parseDesc(ev.description);
    const f = {
      cal: this._cal, orig: { cal: this._cal, uid: ev.uid }, origRoom: d?.room_name ?? null, summary: ev.summary || "", allDay,
      sDate: s.date, sTime: s.time, eDate: e.date, eTime: e.time,
      mode: rr.mode, days: rr.days, rawRrule: rr.raw,
      room: "", temp: "", sleepOn: false, sleepTemp: null, dark: false, extra: {},
      rawMode: false, rawBad: false, rawDesc: ev.description || "",
    };
    if (d) this._fillFromDesc(f, d);
    else { f.rawMode = true; f.rawBad = true; }
    return f;
  }

  _fillFromDesc(f, d) {
    f.room = d.room_name ?? "";
    f.temp = d.temp ?? "";
    f.sleepOn = "sleep_temp" in d;
    f.sleepTemp = num(d.sleep_temp);
    f.dark = d.darkness === true;
    f.extra = {};
    for (const [k, v] of Object.entries(d)) if (!KNOWN.includes(k)) f.extra[k] = v;
    f.rawMode = false;
    f.rawBad = false;
  }

  _descObj(f) {
    const d = { room_name: f.room };
    const t = num(f.temp), st = num(f.sleepTemp);
    if (t !== null) d.temp = t;
    if (f.sleepOn && st !== null) d.sleep_temp = st;
    if (f.dark) d.darkness = true;
    return { ...d, ...f.extra };
  }

  // returns null or [message, group]
  _validate(f) {
    if (!f.orig && !this._anyOn()) return ["Yeni event eklemek için en az bir automation açık olmalı.", null];
    if (!f.cal) return ["Takvim seç.", "event"];
    if (f.mode === "weekly" && !f.days.length) return ["Haftanın en az bir gününü seç.", "event"];
    if (f.mode === "custom" && !f.rawRrule.trim()) return ["Tekrar kuralını (RRULE) gir.", "event"];
    if (!f.sDate || !f.eDate || (!f.allDay && (!f.sTime || !f.eTime))) return ["Başlangıç ve bitişi doldur.", "event"];
    if (f.allDay ? f.eDate < f.sDate : new Date(zonedIso(f.eDate, f.eTime, this._tz)) <= new Date(zonedIso(f.sDate, f.sTime, this._tz)))
      return ["Bitiş, başlangıçtan sonra olmalı.", "event"];
    if (f.rawMode) {
      if (parseDesc(f.rawDesc) === null) return ["Açıklama geçerli JSON değil; automation'lar bunu okuyamaz.", "event"];
      return null;
    }
    if (!f.room) return ["Oda seç.", "event"];
    if (this._groupEnabled("climate")) {
      if (num(f.temp) === null) return ["Sıcaklığı seç.", "climate"];
      if (f.sleepOn && num(f.sleepTemp) === null) return ["Uyku sıcaklığını seç ya da kapat.", "climate"];
    }
    return null;
  }

  async _save() {
    const f = this._form;
    const v = this._validate(f);
    if (v) {
      this._formError = v[0];
      this._errGroup = v[1];
      if (v[1]) this._open[v[1]] = true;
      this._render();
      return;
    }
    let { sDate, eDate } = f;
    if (f.mode === "weekly") {
      let shift = 0;
      while (shift < 7 && !f.days.includes(WD[weekdayIdx(addDays(sDate, shift))][0])) shift++;
      sDate = addDays(sDate, shift);
      eDate = addDays(eDate, shift);
    }
    const descObj = f.rawMode ? parseDesc(f.rawDesc) : this._descObj(f);
    const event = {
      summary: f.summary.trim() || f.room || "Event",
      description: JSON.stringify(descObj),
      dtstart: f.allDay ? sDate : zonedIso(sDate, f.sTime, this._tz),
      dtend: f.allDay ? addDays(eDate, 1) : zonedIso(eDate, f.eTime, this._tz),
    };
    if (f.mode === "daily") event.rrule = "FREQ=DAILY";
    else if (f.mode === "weekly") event.rrule = `FREQ=WEEKLY;BYDAY=${WD.map((w) => w[0]).filter((d) => f.days.includes(d)).join(",")}`;
    else if (f.mode === "custom") event.rrule = f.rawRrule.trim().replace(/^RRULE:/, "");

    this._busy = true; this._formError = null; this._errGroup = null; this._render();
    try {
      // create first, then remove the old one, so a failed save never loses the event
      await this._hass.callWS({ type: "calendar/event/create", entity_id: f.cal, event });
      if (f.orig?.uid) await this._hass.callWS({ type: "calendar/event/delete", entity_id: f.orig.cal, uid: f.orig.uid });
      this._busy = false;
      this._form = null;
      this._cal = f.cal;
      this._syncRooms([f.origRoom, descObj?.room_name]);
      await this._load();
    } catch (e) {
      this._busy = false;
      this._formError = `Kaydedilemedi: ${e?.message || e}`;
      this._render();
    }
  }

  async _delete() {
    const f = this._form;
    if (!f?.orig?.uid) return;
    const what = f.mode === "none" ? "Bu event" : "Bu tekrarlı event'in tüm serisi";
    if (!confirm(`${what} silinsin mi?`)) return;
    this._busy = true; this._render();
    try {
      await this._hass.callWS({ type: "calendar/event/delete", entity_id: f.orig.cal, uid: f.orig.uid });
      this._busy = false;
      this._form = null;
      this._syncRooms([f.origRoom]);
      await this._load();
    } catch (e) {
      this._busy = false;
      this._formError = `Silinemedi: ${e?.message || e}`;
      this._render();
    }
  }

  // ---------- groups ----------
  _grpKey() { return GROUP_KEY + (this._form?.orig ? "edit" : "new"); }

  _openForm(f) {
    this._form = f;
    this._formError = null;
    this._errGroup = null;
    const def = Object.fromEntries(GROUP_IDS.map((g) => [g, !f.orig]));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this._grpKey()) || "null"); } catch (e) { saved = null; }
    this._open = { ...def, ...(saved && typeof saved === "object" ? saved : {}) };
    if (f.rawBad) { this._open.event = true; this._errGroup = "event"; }
    this._render();
  }

  _toggleGroup(g) {
    if (g !== "event" && !this._groupEnabled(g)) return;
    this._open[g] = !this._open[g];
    try { localStorage.setItem(this._grpKey(), JSON.stringify(Object.fromEntries(GROUP_IDS.map((x) => [x, !!this._open[x]])))); } catch (e) { /* ignore */ }
    this._render();
  }

  _eventSummary(f) {
    let time = "Tüm gün";
    if (!f.allDay && f.sTime && f.eTime) {
      const days = f.sDate && f.eDate ? Math.round((Date.parse(f.eDate) - Date.parse(f.sDate)) / 864e5) : 0;
      time = `${f.sTime} → ${f.eTime}${days > 0 ? ` (+${days})` : ""}`;
    }
    let rep;
    if (f.mode === "daily") rep = "Her gün";
    else if (f.mode === "weekly") rep = WD.filter((w) => f.days.includes(w[0])).map((w) => w[1]).join(", ") || "Gün seçilmedi";
    else if (f.mode === "custom") rep = "Özel tekrar";
    else rep = f.sDate ? fmtDate(f.sDate) : "";
    const room = f.rawMode ? (f.rawBad ? "Açıklama JSON değil" : "Ham JSON") : f.room || "Oda seçilmedi";
    return [f.summary.trim() || "(başlıksız)", room, time, rep].filter(Boolean).join(" · ");
  }

  _climateSummary(f) {
    const t = num(f.temp), st = num(f.sleepTemp);
    if (t === null) return "Sıcaklık yok";
    return `${fmtT(t)}${f.sleepOn && st !== null ? ` / uyku ${fmtT(st)}` : ""}`;
  }

  _coverSummary(f) { return f.dark ? "Karartma açık" : "Karartma yok"; }

  _groupHtml(id, icon, name, summary, body, tgl) {
    const off = !!tgl && !this._isOn(tgl);
    const open = !off && !!this._open[id];
    const bad = this._errGroup === id;
    const sub = off ? ["Automation kapalı", summary].filter(Boolean).join(" · ") : open ? "" : summary;
    const hdrAttrs = off ? "" : `data-a="grp" data-g="${id}" role="button" tabindex="0" aria-expanded="${open}"`;
    return `<div class="grp ${open ? "open" : ""} ${bad ? "bad" : ""} ${off ? "off" : ""}">
      <div class="gh" ${hdrAttrs}>
        <ha-icon class="gi" icon="${esc(icon)}"></ha-icon>
        <span class="gt"><span class="gn">${esc(name)}</span>${sub ? `<span class="gs">${esc(sub)}</span>` : ""}</span>
        ${tgl ? this._switchHtml(tgl, name) : ""}
        ${off ? "" : `<ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>`}
      </div>
      ${open ? `<div class="gb">${body}</div>` : ""}
    </div>`;
  }

  _autoGroupHtml(id, body, summary) {
    const t = this._toggleFor(id);
    const meta = GROUP_META[id];
    return this._groupHtml(id, t?.icon || meta.icon, t?.name || meta.name, summary, body, t);
  }

  // ---------- events ----------
  _onClick(e) {
    const el = e.target.closest("[data-a]");
    if (!el || el.disabled) return;
    const a = el.dataset.a;
    if (a === "tab") { this._cal = el.dataset.cal; this._load(); }
    else if (a === "toggle") this._toggleAuto(el.dataset.e, el.checked);
    else if (a === "new") { if (this._anyOn()) this._openForm(this._newForm()); }
    else if (a === "edit") this._openForm(this._formFromEvent(this._events[+el.dataset.i]));
    else if (a === "cancel") { this._form = null; this._formError = null; this._errGroup = null; this._render(); }
    else if (a === "save") this._save();
    else if (a === "delete") this._delete();
    else if (a === "reload") this._load();
    else if (a === "grp") this._toggleGroup(el.dataset.g);
    else if (a === "day") {
      const d = el.dataset.d, days = this._form.days;
      this._form.days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
      this._render();
    } else if (a === "toraw") {
      const f = this._form;
      f.rawDesc = JSON.stringify(this._descObj(f), null, 2);
      f.rawMode = true;
      f.rawBad = false;
      this._render();
    } else if (a === "toform") {
      const d = parseDesc(this._form.rawDesc);
      if (d) {
        this._fillFromDesc(this._form, d);
        this._formError = null;
        if (this._errGroup === "event") this._errGroup = null;
      } else {
        this._formError = "Açıklama hâlâ geçerli JSON değil.";
        this._errGroup = "event";
      }
      this._render();
    }
  }

  _onInput(e) {
    const el = e.target;
    const k = el?.dataset?.f;
    if (!k || !this._form) return;
    const f = this._form;
    if (el.type === "range") {
      f[k] = Number(el.value);
      const out = this.shadowRoot.querySelector(`[data-v="${k}"]`);
      if (out) { out.textContent = fmtT(f[k]); out.classList.remove("none"); }
      return;
    }
    f[k] = el.type === "checkbox" ? el.checked : el.value;
    // sleep temperature starts one degree below the current temperature when first enabled
    if (k === "sleepOn" && el.checked && num(f.sleepTemp) === null) f.sleepTemp = (num(f.temp) ?? DEFAULT_TEMP) - 1;
    if (e.type === "change" && "rr" in el.dataset) this._render();
  }

  // ---------- render ----------
  _calName(c) { return this._hass?.states?.[c]?.attributes?.friendly_name || c.replace(/^calendar\./, ""); }

  _repLabel(ev) {
    const rr = parseRrule(ev.rrule);
    if (rr.mode === "daily") return "Her gün";
    if (rr.mode === "weekly") return WD.filter((w) => rr.days.includes(w[0])).map((w) => w[1]).join(", ") || "Haftalık";
    if (rr.mode === "custom") return "Özel tekrar";
    return fmtDate(ev.start.dateTime ? partsInTz(ev._st, this._tz).date : ev.start.date);
  }

  _rowHtml(ev, i) {
    const tz = this._tz;
    let time = "Tüm gün";
    if (ev.start.dateTime) {
      const s = partsInTz(new Date(ev.start.dateTime), tz), e = partsInTz(new Date(ev.end.dateTime), tz);
      const days = Math.round((Date.parse(e.date) - Date.parse(s.date)) / 864e5);
      time = `${s.time}–${e.time}${days > 0 ? ` (+${days})` : ""}`;
    }
    const d = parseDesc(ev.description);
    let chips = "", room = "";
    if (d === null) chips = `<span class="chip warn">Açıklama JSON değil</span>`;
    else {
      room = d.room_name || "";
      if (d.temp !== undefined) chips += `<span class="chip">${esc(d.temp)}°</span>`;
      if (d.sleep_temp !== undefined) chips += `<span class="chip">uyku ${esc(d.sleep_temp)}°</span>`;
      if (d.darkness === true) chips += `<span class="chip">karartma</span>`;
    }
    return `<button class="row" data-a="edit" data-i="${i}">
      <div class="r1"><span class="sum">${esc(ev.summary || "(başlıksız)")}</span><span class="rep">${esc(this._repLabel(ev))}</span></div>
      <div class="r2">${room ? `${esc(room)}, ` : ""}${esc(time)}</div>
      ${chips ? `<div class="chips">${chips}</div>` : ""}
    </button>`;
  }

  _listHtml() {
    const c = this._config;
    const tabs = c.calendars.map((cal) => `<button class="tab ${cal === this._cal ? "on" : ""}" data-a="tab" data-cal="${esc(cal)}">${esc(this._calName(cal))}</button>`).join("");
    let body;
    if (this._loading) body = `<div class="empty">Yükleniyor…</div>`;
    else if (!this._events.length) body = `<div class="empty">Bu takvimde yaklaşan event yok.${this._anyOn() ? ` Eklemek için "Yeni"ye dokun.` : ""}</div>`;
    else body = `<div>${this._events.map((ev, i) => this._rowHtml(ev, i)).join("")}</div>`;
    const canAdd = !this._hass || this._anyOn();
    return `<div class="head"><div class="title">${esc(c.title)}</div><button class="btn primary" data-a="new" ${canAdd ? "" : "disabled"}>Yeni</button></div>
      ${this._togglesHtml()}
      <div class="tabs">${tabs}</div>
      ${this._error ? `<div class="err">${esc(this._error)} <button class="btn" data-a="reload">Tekrar dene</button></div>` : ""}
      ${body}`;
  }

  _eventBody(f) {
    const calOpts = this._config.calendars.map((c) => `<option value="${esc(c)}" ${c === f.cal ? "selected" : ""}>${esc(this._calName(c))}</option>`).join("");
    const modeOpts = [["none", "Tekrar yok"], ["daily", "Her gün"], ["weekly", "Haftanın belirli günleri"], ["custom", "Özel (RRULE)"]]
      .map(([v, l]) => `<option value="${v}" ${v === f.mode ? "selected" : ""}>${l}</option>`).join("");
    const days = WD.map(([code, l]) => `<button class="day ${f.days.includes(code) ? "on" : ""}" data-a="day" data-d="${code}">${l}</button>`).join("");
    const when = f.allDay
      ? `<div class="grid2">
          <div class="field"><label>Başlangıç günü</label><input type="date" data-f="sDate" value="${esc(f.sDate)}"></div>
          <div class="field"><label>Son gün</label><input type="date" data-f="eDate" value="${esc(f.eDate)}"></div></div>`
      : `<div class="grid2">
          <div class="field"><label>Başlangıç tarihi</label><input type="date" data-f="sDate" value="${esc(f.sDate)}"></div>
          <div class="field"><label>Başlangıç saati</label><input type="time" data-f="sTime" value="${esc(f.sTime)}"></div>
          <div class="field"><label>Bitiş tarihi</label><input type="date" data-f="eDate" value="${esc(f.eDate)}"></div>
          <div class="field"><label>Bitiş saati</label><input type="time" data-f="eTime" value="${esc(f.eTime)}"></div></div>`;

    let desc;
    if (f.rawMode) {
      desc = `<div class="field"><label>Açıklama (JSON)</label>
        ${f.rawBad
          ? `<div class="err">Bu event'in açıklaması JSON olarak okunamadı. Düzeltip forma geçebilir ya da ham hâliyle kaydedebilirsin.</div>`
          : `<div class="note" style="margin:0 0 6px">JSON'u doğrudan düzenliyorsun; oda, ısınma ve perde alanları burada. Kaydederken geçerli JSON olmalı.</div>`}
        <textarea data-f="rawDesc" aria-label="Açıklama (JSON)">${esc(f.rawDesc)}</textarea>
        <button class="btn" data-a="toform" style="margin-top:6px">Forma geç</button></div>`;
    } else {
      const rooms = [...this._areas];
      if (f.room && !rooms.includes(f.room)) rooms.unshift(f.room);
      const roomOpts = `<option value="" ${f.room ? "" : "selected"} disabled>Oda seç</option>` +
        rooms.map((r) => `<option value="${esc(r)}" ${r === f.room ? "selected" : ""}>${esc(r)}${this._areas.includes(r) ? "" : " (area bulunamadı)"}</option>`).join("");
      desc = `<div class="field"><label>Oda</label><select data-f="room">${roomOpts}</select></div>
        ${Object.keys(f.extra).length ? `<div class="note">Korunan ek alanlar: ${esc(Object.keys(f.extra).join(", "))}</div>` : ""}
        <button class="link" data-a="toraw">Ham JSON'u düzenle</button>`;
    }

    return `<div class="field"><label>Takvim</label><select data-f="cal">${calOpts}</select></div>
      <div class="field"><label>Başlık</label><input type="text" data-f="summary" value="${esc(f.summary)}" placeholder="Boş bırakılırsa oda adı kullanılır"></div>
      <label class="check"><input type="checkbox" data-f="allDay" data-rr ${f.allDay ? "checked" : ""}>Tüm gün</label>
      ${when}
      <div class="field"><label>Tekrar</label><select data-f="mode" data-rr>${modeOpts}</select></div>
      ${f.mode === "weekly" ? `<div class="days">${days}</div>` : ""}
      ${f.mode === "custom" ? `<div class="field"><input type="text" data-f="rawRrule" value="${esc(f.rawRrule)}" placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"></div>` : ""}
      ${desc}`;
  }

  _sliderHtml(field, value, label) {
    const c = this._config;
    const v = num(value);
    let min = c.temp_min, max = c.temp_max;
    if (v !== null) { min = Math.min(min, Math.floor(v)); max = Math.max(max, Math.ceil(v)); }
    const pos = v !== null ? v : (min + max) / 2;
    return `<div class="sl">
      <input type="range" min="${min}" max="${max}" step="${c.temp_step}" value="${pos}" data-f="${field}" aria-label="${esc(label)}">
      <span class="slv ${v === null ? "none" : ""}" data-v="${field}">${v === null ? "—" : fmtT(v)}</span>
    </div>`;
  }

  _climateBody(f) {
    return `<div class="field"><label>Sıcaklık</label>${this._sliderHtml("temp", f.temp, "Sıcaklık")}</div>
      <div class="field">
        <label class="check"><input type="checkbox" data-f="sleepOn" data-rr ${f.sleepOn ? "checked" : ""}>Uyku sıcaklığı</label>
        ${f.sleepOn ? `<div style="margin-top:6px">${this._sliderHtml("sleepTemp", f.sleepTemp, "Uyku sıcaklığı")}</div>
          <div class="note">Event'in ilk ve son 30 dakikasında normal sıcaklık geçerli olur.</div>` : ""}
      </div>`;
  }

  _coverBody(f) {
    return `<label class="check"><input type="checkbox" data-f="dark" ${f.dark ? "checked" : ""}>Karartma (gün doğunca perdeleri kapalı tut)</label>`;
  }

  _formHtml() {
    const f = this._form, b = this._busy ? "disabled" : "";
    const autoGroups = f.rawMode ? "" : `
        ${this._autoGroupHtml("climate", this._climateBody(f), this._climateSummary(f))}
        ${this._autoGroupHtml("cover", this._coverBody(f), this._coverSummary(f))}`;
    return `<div class="head"><div class="title">${f.orig ? "Event'i düzenle" : "Yeni event"}</div></div>
      <div class="form">
        ${this._groupHtml("event", "mdi:calendar-clock", "Takvim event'i", this._eventSummary(f), this._eventBody(f), null)}
        ${autoGroups}
        ${this._tglError ? `<div class="err">${esc(this._tglError)}</div>` : ""}
        ${this._formError ? `<div class="err">${esc(this._formError)}</div>` : ""}
        <div class="actions">
          ${f.orig ? `<button class="btn danger" data-a="delete" ${b}>Sil</button>` : ""}
          <div class="right"><button class="btn" data-a="cancel" ${b}>Vazgeç</button><button class="btn primary" data-a="save" ${b}>${this._busy ? "Kaydediliyor…" : "Kaydet"}</button></div>
        </div>
      </div>`;
  }

  _render() {
    if (!this._config) return;
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>${this._form ? this._formHtml() : this._listHtml()}</ha-card>`;
  }
}

customElements.define("gungors-schedule-card", GungorsScheduleCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "gungors-schedule-card", name: "Gungors Schedule Card", description: "JSON açıklamalı takvim event'leri için form" });
console.info(`%c gungors-schedule-card ${VERSION} `, "background:#03a9f4;color:#fff");
