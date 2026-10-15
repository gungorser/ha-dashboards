// gungors-program-card — the program calendar (gungors calendar.program) as a weekly grid plus
// an editor for its entries. Replaces gungors-schedule-card.
//
// YAML:
//   type: custom:gungors-program-card
//   entity: calendar.program        # optional, this is the default
//   title: Program                  # optional
//
// An entry is a program: a time window (may repeat), a target (areas and/or entities with the
// gungors `program` feature) and rules. The entry's description holds them as YAML, the rules
// grouped by domain (the older JSON form with one `rules` key is still read):
//   target: [Salon, light.melike_light]
//   light:
//     on: true
//     brightness: {max: 40}
// Rule attributes per domain: light on / brightness (%) / color / color_temp (K), climate
// hvac_mode / temperature, cover position (%). Each rule is a value (eşit) or a min/max.
// The integration checks every save: an unreadable entry or one that conflicts with an
// overlapping entry on an entity is refused, and its message is shown in the editor.
//
// View: the programs active now (each with "Şimdi bitir": the running occurrence ends now),
// and a week grid, one row per room (an entity target without an area gets its own row),
// one column per day. Tap an entry to edit it; "Yeni" adds one.
const VERSION = "1.1.0";
const DEFAULT_CAL = "calendar.program";

const ATTRS = {
  on: { domain: "light", label: "Açık / kapalı", kind: "bool" },
  brightness: { domain: "light", label: "Parlaklık", kind: "num", unit: "%", min: 0, max: 100, step: 1 },
  color: { domain: "light", label: "Renk", kind: "color" },
  color_temp: { domain: "light", label: "Renk sıcaklığı", kind: "num", unit: "K", min: 2000, max: 6500, step: 100 },
  hvac_mode: { domain: "climate", label: "Isıtma modu", kind: "enum", options: [["heat", "Isıtma"], ["off", "Kapalı"]] },
  temperature: { domain: "climate", label: "Sıcaklık", kind: "num", unit: "°C", min: 5, max: 35, step: 0.5 },
  position: { domain: "cover", label: "Perde pozisyonu", kind: "num", unit: "%", min: 0, max: 100, step: 5 },
};
const OPS = [["eq", "eşit"], ["min", "en az"], ["max", "en çok"]];
const DOMAIN_NAMES = { light: "Işık", climate: "Isıtma", cover: "Perde" };
const WD = [["MO", "Pzt"], ["TU", "Sal"], ["WE", "Çar"], ["TH", "Per"], ["FR", "Cum"], ["SA", "Cmt"], ["SU", "Paz"]];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const num = (v) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const hex = (rgb) => "#" + rgb.map((v) => pad(Number(v).toString(16))).join("");
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const COLOR_NAMES = { white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128] };

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
const fmtDay = (date) => { const [, m, d] = date.split("-"); return `${d}.${m}`; };
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
// A small YAML reader for program descriptions: block mappings and sequences, flow [..] and
// {..}, quoted and plain scalars (YAML 1.1 booleans, as Home Assistant reads them). Anything
// else throws, and the entry is shown as raw text.
function yamlScalar(t) {
  if (/^(true|yes|on)$/i.test(t)) return true;
  if (/^(false|no|off)$/i.test(t)) return false;
  if (/^(null|~|)$/i.test(t)) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}
function yamlFlow(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const quoted = () => {
    const q = src[i++];
    let out = "";
    while (i < src.length) {
      if (src[i] === q) {
        if (q === "'" && src[i + 1] === "'") { out += "'"; i += 2; continue; }
        break;
      }
      if (q === '"' && src[i] === "\\") { out += JSON.parse(`"${src.slice(i, i + 2)}"`); i += 2; }
      else out += src[i++];
    }
    if (src[i] !== q) throw new Error("unterminated string");
    i++;
    return out;
  };
  const value = (inFlow) => {
    ws();
    const c = src[i];
    if (c === "[") {
      i++; const arr = []; ws();
      if (src[i] === "]") { i++; return arr; }
      for (;;) { arr.push(value(true)); ws(); if (src[i] === ",") { i++; continue; } if (src[i] === "]") { i++; return arr; } throw new Error("bad list"); }
    }
    if (c === "{") {
      i++; const obj = {}; ws();
      if (src[i] === "}") { i++; return obj; }
      for (;;) {
        ws();
        const k = src[i] === '"' || src[i] === "'" ? quoted() : plain(true, true);
        ws(); if (src[i] !== ":") throw new Error("bad mapping"); i++;
        obj[k] = value(true); ws();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "}") { i++; return obj; }
        throw new Error("bad mapping");
      }
    }
    if (c === '"' || c === "'") return quoted();
    return yamlScalar(plain(inFlow, false));
  };
  const plain = (inFlow, isKey) => {
    const start = i;
    while (i < src.length && !(inFlow && /[,\]}]/.test(src[i])) && !(isKey && src[i] === ":")) i++;
    return src.slice(start, i).trim();
  };
  const v = value(false);
  ws();
  if (i < src.length) throw new Error("trailing text");
  return v;
}
function yamlParse(text) {
  const lines = [];
  for (const raw of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    let q = null, cut = raw.length;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (q) { if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === "#" && (k === 0 || /\s/.test(raw[k - 1]))) { cut = k; break; }
    }
    const line = raw.slice(0, cut).replace(/\s+$/, "");
    if (line.trim()) lines.push({ ind: line.length - line.trimStart().length, text: line.trim() });
  }
  let i = 0;
  const keyOf = (t) => {
    const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:(\s+|$)(.*)$/.exec(t);
    if (!m) throw new Error("expected key: value");
    const k = /^["']/.test(m[1]) ? yamlFlow(m[1]) : m[1];
    return [k, m[3]];
  };
  const block = (ind) => {
    if (lines[i].text.startsWith("- ") || lines[i].text === "-") {
      const arr = [];
      while (i < lines.length && lines[i].ind === ind && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
        const rest = lines[i].text.slice(1).trim(); i++;
        if (!rest) throw new Error("nested list items are not supported");
        arr.push(yamlFlow(rest));
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length && lines[i].ind === ind) {
      const [k, rest] = keyOf(lines[i].text); i++;
      if (rest) obj[k] = yamlFlow(rest);
      else if (i < lines.length && (lines[i].ind > ind || (lines[i].ind === ind && lines[i].text.startsWith("-")))) obj[k] = block(lines[i].ind);
      else obj[k] = null;
    }
    return obj;
  };
  if (!lines.length) return null;
  const v = lines.length === 1 && /^[[{"']/.test(lines[0].text) ? yamlFlow(lines[0].text) : block(lines[0].ind);
  if (i < lines.length && lines.length !== 1) throw new Error("bad indentation");
  return v;
}
const DOMAINS = Object.keys(DOMAIN_NAMES);
function parseProgram(raw) {
  if (!raw || !raw.trim()) return null;
  let d;
  try { d = JSON.parse(raw); } catch (e) { try { d = yamlParse(raw); } catch (e2) { return null; } }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  if (Object.keys(d).some((k) => k !== "target" && k !== "rules" && !DOMAINS.includes(k))) return null;
  const target = typeof d.target === "string" ? [d.target] : d.target;
  if (!Array.isArray(target) || !target.length) return null;
  const rules = {};
  const add = (attr, v, domain) => {
    const a = ATTRS[attr];
    if (!a || (domain && a.domain !== domain) || attr in rules) return false;
    rules[attr] = attr === "hvac_mode" && v === false ? "off" : v;
    return true;
  };
  if (d.rules !== undefined) {
    if (!d.rules || typeof d.rules !== "object") return null;
    for (const [k, v] of Object.entries(d.rules)) if (!add(k, v)) return null;
  }
  for (const dom of DOMAINS) {
    if (d[dom] === undefined) continue;
    if (!d[dom] || typeof d[dom] !== "object" || Array.isArray(d[dom])) return null;
    for (const [k, v] of Object.entries(d[dom])) if (!add(k, v, dom)) return null;
  }
  return Object.keys(rules).length ? { target, rules } : null;
}
// The description text of a program: YAML, rules grouped by domain (as the integration writes it).
function yamlScalarText(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(yamlScalarText).join(", ")}]`;
  const t = String(v);
  if (/^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#,[\]{}]*$/.test(t) && !/^(y|n|yes|no|true|false|on|off|null|~|[-+.]?\d.*|\.(inf|nan))$/i.test(t) && t === t.trim()) return t;
  return JSON.stringify(t);
}
function dumpProgram(target, rules) {
  const out = [`target: ${yamlScalarText(target)}`];
  for (const dom of DOMAINS) {
    const attrs = Object.keys(rules).filter((k) => ATTRS[k] && ATTRS[k].domain === dom);
    if (!attrs.length) continue;
    out.push(`${dom}:`);
    for (const k of attrs) {
      const v = rules[k];
      const text = v && typeof v === "object" && !Array.isArray(v)
        ? `{${["eq", "min", "max"].filter((o) => o in v).map((o) => `${o}: ${yamlScalarText(v[o])}`).join(", ")}}`
        : yamlScalarText(v);
      out.push(`  ${k}: ${text}`);
    }
  }
  return out.join("\n") + "\n";
}
// {attr: value | {eq|min|max}} -> rule lines [{attr, op, value}]
function linesOf(rules) {
  const lines = [];
  for (const [attr, v] of Object.entries(rules || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const op of ["eq", "min", "max"]) if (op in v) lines.push({ attr, op, value: v[op] });
    } else lines.push({ attr, op: "eq", value: v });
  }
  return lines;
}
function ruleText(attr, v) {
  const a = ATTRS[attr];
  if (!a) return `${attr}: ${JSON.stringify(v)}`;
  const val = (x) => {
    if (a.kind === "bool") return x ? "açık" : "kapalı";
    if (a.kind === "enum") return (a.options.find((o) => o[0] === x) || [x, x])[1];
    if (a.kind === "color") return Array.isArray(x) ? hex(x) : x;
    return `${String(x).replace(".", ",")}${a.unit === "%" ? "%" : a.unit === "K" ? "K" : "°"}`;
  };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("eq" in v) return `${a.label} ${val(v.eq)}`;
    if ("min" in v && "max" in v) return `${a.label} ${val(v.min)}–${val(v.max)}`;
    if ("min" in v) return `${a.label} ≥ ${val(v.min)}`;
    return `${a.label} ≤ ${val(v.max)}`;
  }
  return `${a.label} ${val(v)}`;
}

const CSS = `
:host{display:block}
ha-card{padding:16px;color:var(--primary-text-color)}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.title{font-size:1.25rem;font-weight:500}
.sec{font-size:.8rem;font-weight:500;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.04em;margin:12px 0 6px}
.act{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--divider-color)}
.act:last-child{border-bottom:0}
.act .t{flex:1;min-width:0;cursor:pointer}
.sum{font-weight:500}
.sub{font-size:.85rem;color:var(--secondary-text-color)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{font-size:.75rem;padding:2px 8px;border-radius:10px;background:var(--secondary-background-color);border:1px solid var(--divider-color)}
.chip.warn{color:var(--error-color);border-color:var(--error-color)}
.nav{display:flex;align-items:center;gap:8px}
.wk{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:640px;table-layout:fixed}
th,td{border:1px solid var(--divider-color);padding:4px;vertical-align:top;font-size:.8rem}
th{font-weight:500;color:var(--secondary-text-color);background:var(--secondary-background-color)}
th.room{width:110px;text-align:left}
th.today{color:var(--primary-color)}
td.room{font-weight:500}
.ev{display:block;width:100%;box-sizing:border-box;text-align:left;margin:0 0 3px;padding:3px 5px;border-radius:5px;border:0;border-left:3px solid var(--primary-color);background:var(--secondary-background-color);color:inherit;font:inherit;font-size:.75rem;cursor:pointer;line-height:1.25}
.ev.now{border-left-color:var(--success-color,#43a047)}
.ev.bad{border-left-color:var(--error-color)}
.ev .tm{color:var(--secondary-text-color)}
.empty{padding:16px 4px;color:var(--secondary-text-color);text-align:center}
.err{padding:8px 10px;margin:8px 0;border-radius:6px;border:1px solid var(--error-color);color:var(--error-color);font-size:.875rem}
.note{font-size:.75rem;color:var(--secondary-text-color);margin-top:4px}
.form{display:flex;flex-direction:column;gap:12px}
.field label,.lbl{display:block;font-size:.8rem;color:var(--secondary-text-color);margin-bottom:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
input[type=text],input[type=number],input[type=date],input[type=time],select,textarea{box-sizing:border-box;width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);font:inherit;min-height:40px}
input[type=color]{width:56px;height:40px;padding:2px;border-radius:6px;border:1px solid var(--divider-color);background:none}
textarea{min-height:140px;font-family:var(--code-font-family,monospace);font-size:.85rem}
.check{display:flex;align-items:center;gap:8px;cursor:pointer}
.check input{width:18px;height:18px;accent-color:var(--primary-color)}
.days,.targets{display:flex;flex-wrap:wrap;gap:4px}
.day,.tg{padding:6px 10px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:inherit;font:inherit;cursor:pointer}
.day{min-width:44px}
.day.on,.tg.on{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.rule{display:grid;grid-template-columns:1.4fr 1fr 1.2fr auto;gap:6px;align-items:center}
.x{background:none;border:0;color:var(--secondary-text-color);cursor:pointer;font-size:1.2rem;padding:4px 8px}
.link{background:none;border:0;padding:0;color:var(--primary-color);font:inherit;font-size:.875rem;cursor:pointer;align-self:flex-start}
.actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:4px}
.actions .right{display:flex;gap:8px;margin-left:auto}
.btn{padding:8px 14px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);font:inherit;cursor:pointer;min-height:38px}
.btn.small{padding:4px 10px;min-height:30px;font-size:.85rem}
.btn.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.btn.danger{color:var(--error-color);border-color:var(--error-color)}
.btn:disabled{opacity:.5;cursor:default}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
`;

class GungorsProgramCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._events = [];
    this._active = [];
    this._week = null;
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("input", (e) => this._onInput(e));
    this.shadowRoot.addEventListener("change", (e) => this._onInput(e));
  }

  setConfig(config) {
    this._config = { title: "Program", entity: DEFAULT_CAL, ...config };
    this._render();
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) {
      this._week = this._monday(partsInTz(new Date(), this._tz).date);
      this._load();
    }
  }

  getCardSize() { return 10; }
  static getStubConfig() { return { entity: DEFAULT_CAL }; }
  get _tz() { return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone; }
  _monday(date) { return addDays(date, -weekdayIdx(date)); }

  // ---------- registry helpers ----------
  _areaName(id) { return this._hass?.areas?.[id]?.name || id; }
  _entityArea(eid) {
    const e = this._hass?.entities?.[eid];
    if (!e) return null;
    return e.area_id || this._hass?.devices?.[e.device_id]?.area_id || null;
  }
  _entityName(eid) { return this._hass?.states?.[eid]?.attributes?.friendly_name || eid; }
  // entities with the gungors `program` feature (they publish a `program` attribute)
  _programEntities() {
    return Object.values(this._hass?.states || {})
      .filter((s) => Array.isArray(s.attributes?.program) && /^(light|climate|cover)\./.test(s.entity_id))
      .map((s) => s.entity_id);
  }
  _areasWithEntities() {
    const ids = new Set(this._programEntities().map((e) => this._entityArea(e)).filter(Boolean));
    return [...ids].map((id) => ({ id, name: this._areaName(id) })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }
  _areaIdOf(target) {
    const areas = this._hass?.areas || {};
    if (areas[target]) return target;
    const hit = Object.values(areas).find((a) => a.name.toLowerCase() === String(target).toLowerCase());
    return hit ? hit.area_id : null;
  }
  // rows a target shows in: its area (an entity's area), else the entity itself
  _rowsOf(target) {
    return target.map((t) => {
      if (String(t).includes(".")) {
        const area = this._entityArea(t);
        return area ? `a:${area}` : `e:${t}`;
      }
      const id = this._areaIdOf(t);
      return id ? `a:${id}` : `x:${t}`;
    });
  }
  _rowName(key) {
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    if (kind === "a") return this._areaName(id);
    if (kind === "e") return this._entityName(id);
    return id;
  }
  _domainsOf(targets) {
    const ents = this._programEntities();
    const out = new Set();
    for (const t of targets) {
      if (String(t).includes(".")) out.add(t.split(".")[0]);
      else {
        const id = this._areaIdOf(t);
        for (const e of ents) if (this._entityArea(e) === id) out.add(e.split(".")[0]);
      }
    }
    return out;
  }

  // ---------- loading ----------
  _evDate(x) { return x.dateTime ? new Date(x.dateTime) : new Date(zonedIso(x.date, "00:00", this._tz)); }

  async _fetch(start, end) {
    const res = await this._hass.callApi("GET",
      `calendars/${this._config.entity}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
    return res.map((ev) => ({ ...ev, _st: this._evDate(ev.start), _en: this._evDate(ev.end), _p: parseProgram(ev.description) }));
  }

  async _load() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const tz = this._tz;
      const ws = new Date(zonedIso(this._week, "00:00", tz));
      const we = new Date(zonedIso(addDays(this._week, 7), "00:00", tz));
      const now = new Date();
      const [events, active] = await Promise.all([this._fetch(ws, we), this._fetch(now, new Date(now.getTime() + 1000))]);
      this._events = events;
      this._active = active.filter((ev) => ev._st <= now && ev._en > now);
    } catch (err) {
      this._error = `Takvim okunamadı: ${err?.message || err?.body?.message || err}`;
      this._events = [];
      this._active = [];
    }
    this._loading = false;
    this._render();
  }

  // ---------- form model ----------
  _newForm() {
    const p = partsInTz(new Date(Date.now() + 36e5), this._tz);
    const h = +p.time.slice(0, 2);
    const eh = (h + 1) % 24;
    return {
      orig: null, summary: "", allDay: false,
      sDate: p.date, sTime: `${pad(h)}:00`, eDate: eh === 0 ? addDays(p.date, 1) : p.date, eTime: `${pad(eh)}:00`,
      mode: "none", days: [], rawRrule: "",
      targets: [], lines: [], rawMode: false, rawBad: false, rawDesc: "",
    };
  }

  _formFromEvent(ev) {
    const tz = this._tz;
    const allDay = !ev.start.dateTime;
    // a series is edited as a whole, from its first occurrence on the shown days
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
    const p = ev._p;
    return {
      orig: { uid: ev.uid, recurrence_id: ev.recurrence_id || null, rrule: ev.rrule || null },
      summary: ev.summary || "", allDay,
      sDate: s.date, sTime: s.time, eDate: e.date, eTime: e.time,
      mode: rr.mode, days: rr.days, rawRrule: rr.raw,
      targets: p ? p.target.map((t) => (String(t).includes(".") ? t : this._areaIdOf(t) || t)) : [],
      lines: p ? linesOf(p.rules) : [],
      rawMode: !p, rawBad: !p, rawDesc: ev.description || "",
    };
  }

  _rulesOf(lines) {
    const rules = {};
    for (const l of lines) {
      if (!l.attr) continue;
      const a = ATTRS[l.attr];
      let v = l.value;
      if (a.kind === "num") v = num(v);
      if (a.kind === "bool") v = v === true || v === "true";
      if (a.kind === "color") v = Array.isArray(v) ? v : COLOR_NAMES[v] || rgbOf(/^#[0-9a-f]{6}$/i.test(v) ? v : "#ffffff");
      if (l.op === "eq") rules[l.attr] = v;
      else {
        const cur = rules[l.attr];
        rules[l.attr] = { ...(cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}), [l.op]: v };
      }
    }
    return rules;
  }

  _programText(f) {
    if (f.rawMode) return f.rawDesc;
    const target = f.targets.map((t) => (String(t).includes(".") ? t : this._areaName(t)));
    return dumpProgram(target, this._rulesOf(f.lines));
  }

  _validate(f) {
    if (f.mode === "weekly" && !f.days.length) return "Haftanın en az bir gününü seç.";
    if (f.mode === "custom" && !f.rawRrule.trim()) return "Tekrar kuralını (RRULE) gir.";
    if (!f.sDate || !f.eDate || (!f.allDay && (!f.sTime || !f.eTime))) return "Başlangıç ve bitişi doldur.";
    if (f.allDay ? f.eDate < f.sDate : new Date(zonedIso(f.eDate, f.eTime, this._tz)) <= new Date(zonedIso(f.sDate, f.sTime, this._tz)))
      return "Bitiş, başlangıçtan sonra olmalı.";
    if (f.rawMode) return parseProgram(f.rawDesc) ? null : "Açıklama geçerli bir program değil (target ve rules gerekli).";
    if (!f.targets.length) return "En az bir oda ya da cihaz seç.";
    if (!f.lines.length) return "En az bir kural ekle.";
    const seen = {};
    for (const l of f.lines) {
      if (!l.attr) return "Her kuralda bir özellik seç.";
      const a = ATTRS[l.attr];
      if (a.kind === "num" && num(l.value) === null) return `${a.label}: bir değer gir.`;
      (seen[l.attr] = seen[l.attr] || []).push(l.op);
    }
    for (const [attr, ops] of Object.entries(seen)) {
      if (new Set(ops).size !== ops.length || (ops.includes("eq") && ops.length > 1))
        return `${ATTRS[attr].label}: ya bir eşit değeri ya da en az / en çok verilebilir.`;
    }
    const rules = this._rulesOf(f.lines);
    if ("color" in rules && "color_temp" in rules) return "Renk ve renk sıcaklığı aynı programda olamaz.";
    return null;
  }

  _eventPayload(f) {
    let { sDate, eDate } = f;
    if (f.mode === "weekly" && !f.orig) {
      let shift = 0;
      while (shift < 7 && !f.days.includes(WD[weekdayIdx(addDays(sDate, shift))][0])) shift++;
      sDate = addDays(sDate, shift);
      eDate = addDays(eDate, shift);
    }
    const event = {
      summary: f.summary.trim() || "Program",
      description: this._programText(f),
      dtstart: f.allDay ? sDate : zonedIso(sDate, f.sTime, this._tz),
      dtend: f.allDay ? addDays(eDate, 1) : zonedIso(eDate, f.eTime, this._tz),
    };
    if (f.mode === "daily") event.rrule = "FREQ=DAILY";
    else if (f.mode === "weekly") event.rrule = `FREQ=WEEKLY;BYDAY=${WD.map((w) => w[0]).filter((d) => f.days.includes(d)).join(",")}`;
    else if (f.mode === "custom") event.rrule = f.rawRrule.trim().replace(/^RRULE:/, "");
    return event;
  }

  async _save() {
    const f = this._form;
    const v = this._validate(f);
    if (v) { this._formError = v; this._render(); return; }
    const event = this._eventPayload(f);
    this._busy = true; this._formError = null; this._render();
    try {
      if (f.orig) {
        // a whole series (or a single entry) is edited in place, keeping its uid
        const msg = { type: "calendar/event/update", entity_id: this._config.entity, uid: f.orig.uid, event };
        if (!f.orig.rrule && f.orig.recurrence_id) msg.recurrence_id = f.orig.recurrence_id;
        await this._hass.callWS(msg);
      } else {
        await this._hass.callWS({ type: "calendar/event/create", entity_id: this._config.entity, event });
      }
      this._busy = false;
      this._form = null;
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
    const what = f.mode === "none" ? "Bu program" : "Bu tekrarlı programın tüm serisi";
    if (!confirm(`${what} silinsin mi?`)) return;
    this._busy = true; this._render();
    try {
      await this._hass.callWS({ type: "calendar/event/delete", entity_id: this._config.entity, uid: f.orig.uid });
      this._busy = false;
      this._form = null;
      await this._load();
    } catch (e) {
      this._busy = false;
      this._formError = `Silinemedi: ${e?.message || e}`;
      this._render();
    }
  }

  // the running occurrence ends now (a series keeps its other occurrences)
  async _endNow(ev) {
    if (!confirm(`"${ev.summary}" şimdi bitirilsin mi?`)) return;
    const end = new Date(Math.max(Date.now(), ev._st.getTime() + 60e3));
    const event = {
      summary: ev.summary,
      description: ev.description || "",
      dtstart: ev.start.dateTime || ev.start.date,
      dtend: ev.start.dateTime ? end.toISOString() : ev.end.date,
    };
    if (!ev.start.dateTime) {
      // an all-day entry: it can only end with today
      event.dtend = addDays(partsInTz(new Date(), this._tz).date, 1);
    }
    const msg = { type: "calendar/event/update", entity_id: this._config.entity, uid: ev.uid, event };
    if (ev.recurrence_id) msg.recurrence_id = ev.recurrence_id;
    else if (ev.rrule) event.rrule = ev.rrule;
    try {
      await this._hass.callWS(msg);
      await this._load();
    } catch (e) {
      this._error = `Bitirilemedi: ${e?.message || e}`;
      this._render();
    }
  }

  // ---------- events ----------
  _onClick(e) {
    const el = e.target.closest("[data-a]");
    if (!el || el.disabled) return;
    const a = el.dataset.a;
    const f = this._form;
    if (a === "new") { this._openForm(this._newForm()); }
    else if (a === "edit") { this._openForm(this._formFromEvent(this._find(el.dataset.k))); }
    else if (a === "end") { this._endNow(this._find(el.dataset.k)); }
    else if (a === "prev" || a === "next" || a === "today") {
      this._week = a === "today" ? this._monday(partsInTz(new Date(), this._tz).date) : addDays(this._week, a === "prev" ? -7 : 7);
      this._load();
    } else if (a === "reload") this._load();
    else if (a === "cancel") { this._form = null; this._formError = null; this._render(); }
    else if (a === "save") this._save();
    else if (a === "delete") this._delete();
    else if (a === "day") {
      const d = el.dataset.d;
      f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d];
      this._render();
    } else if (a === "tg") {
      const t = el.dataset.t;
      f.targets = f.targets.includes(t) ? f.targets.filter((x) => x !== t) : [...f.targets, t];
      this._render();
    } else if (a === "addrule") {
      f.lines.push({ attr: "", op: "eq", value: "" });
      this._render();
    } else if (a === "delrule") {
      f.lines.splice(+el.dataset.i, 1);
      this._render();
    } else if (a === "toraw") {
      f.rawDesc = this._programText(f);
      f.rawMode = true; f.rawBad = false;
      this._render();
    } else if (a === "toform") {
      const p = parseProgram(f.rawDesc);
      if (p) {
        f.targets = p.target.map((t) => (String(t).includes(".") ? t : this._areaIdOf(t) || t));
        f.lines = linesOf(p.rules);
        f.rawMode = false; f.rawBad = false; this._formError = null;
      } else this._formError = "Açıklama hâlâ geçerli bir program değil.";
      this._render();
    }
  }

  _find(key) {
    return [...this._active, ...this._events].find((ev) => `${ev.uid}|${ev.recurrence_id || ""}` === key);
  }

  _openForm(f) { this._form = f; this._formError = null; this._render(); }

  _onInput(e) {
    const el = e.target;
    if (!this._form) return;
    const f = this._form;
    if ("ri" in el.dataset) {
      const line = f.lines[+el.dataset.ri];
      const k = el.dataset.rk;
      line[k] = el.value;
      if (k === "attr") {
        const a = ATTRS[line.attr];
        line.op = "eq";
        line.value = !a ? "" : a.kind === "bool" ? true : a.kind === "enum" ? a.options[0][0] : a.kind === "color" ? "#ff0000" : "";
      }
      if (k === "value" && ATTRS[line.attr]?.kind === "bool") line.value = el.value === "true";
      if (e.type === "change" && (k === "attr" || k === "op")) this._render();
      return;
    }
    const k = el.dataset.f;
    if (!k) return;
    f[k] = el.type === "checkbox" ? el.checked : el.value;
    if (e.type === "change" && "rr" in el.dataset) this._render();
  }

  // ---------- render ----------
  _key(ev) { return `${ev.uid}|${ev.recurrence_id || ""}`; }

  _timeText(ev) {
    if (!ev.start.dateTime) return "Tüm gün";
    const tz = this._tz;
    const s = partsInTz(ev._st, tz), e = partsInTz(ev._en, tz);
    const days = Math.round((Date.parse(e.date) - Date.parse(s.date)) / 864e5);
    return `${s.time}–${e.time}${days > 0 ? ` (+${days})` : ""}`;
  }

  _ruleChips(ev) {
    if (!ev._p) return `<span class="chip warn">Okunamayan açıklama</span>`;
    return Object.entries(ev._p.rules).map(([k, v]) => `<span class="chip">${esc(ruleText(k, v))}</span>`).join("");
  }

  _activeHtml() {
    if (!this._active.length) return `<div class="empty">Şu an aktif program yok.</div>`;
    return this._active.map((ev) => {
      const where = ev._p ? [...new Set(this._rowsOf(ev._p.target).map((k) => this._rowName(k)))].join(", ") : "";
      return `<div class="act">
        <div class="t" data-a="edit" data-k="${esc(this._key(ev))}">
          <div class="sum">${esc(ev.summary || "(başlıksız)")}</div>
          <div class="sub">${esc([where, `${this._timeText(ev)} bitiş ${partsInTz(ev._en, this._tz).time}`].filter(Boolean).join(" · "))}</div>
          <div class="chips">${this._ruleChips(ev)}</div>
        </div>
        <button class="btn small" data-a="end" data-k="${esc(this._key(ev))}">Şimdi bitir</button>
      </div>`;
    }).join("");
  }

  _weekHtml() {
    const tz = this._tz;
    const days = [...Array(7)].map((_, i) => addDays(this._week, i));
    const today = partsInTz(new Date(), tz).date;
    const now = new Date();
    const rows = new Map(this._areasWithEntities().map((a) => [`a:${a.id}`, new Map()]));
    for (const ev of this._events) {
      const keys = ev._p ? this._rowsOf(ev._p.target) : ["x:?"];
      for (const key of new Set(keys)) {
        if (!rows.has(key)) rows.set(key, new Map());
        const cells = rows.get(key);
        days.forEach((d, i) => {
          const ds = new Date(zonedIso(d, "00:00", tz)), de = new Date(zonedIso(addDays(d, 1), "00:00", tz));
          if (ev._st < de && ev._en > ds) {
            if (!cells.has(i)) cells.set(i, []);
            cells.get(i).push(ev);
          }
        });
      }
    }
    const head = `<tr><th class="room">Oda</th>${days.map((d, i) => `<th class="${d === today ? "today" : ""}">${WD[i][1]} ${fmtDay(d)}</th>`).join("")}</tr>`;
    const body = [...rows.entries()]
      .sort((a, b) => this._rowName(a[0]).localeCompare(this._rowName(b[0]), "tr"))
      .map(([key, cells]) => `<tr><td class="room">${esc(key === "x:?" ? "Okunamayan" : this._rowName(key))}</td>${days.map((_, i) => {
        const evs = (cells.get(i) || []).sort((a, b) => a._st - b._st);
        return `<td>${evs.map((ev) => `<button class="ev ${ev._st <= now && ev._en > now ? "now" : ""} ${ev._p ? "" : "bad"}" data-a="edit" data-k="${esc(this._key(ev))}" title="${esc(ev._p ? Object.entries(ev._p.rules).map(([k, v]) => ruleText(k, v)).join(", ") : "Okunamayan açıklama")}">
          <span class="tm">${esc(this._timeText(ev))}</span><br>${esc(ev.summary || "(başlıksız)")}</button>`).join("")}</td>`;
      }).join("")}</tr>`).join("");
    return `<div class="wk"><table>${head}${body || `<tr><td colspan="8" class="empty">Programlı oda yok.</td></tr>`}</table></div>`;
  }

  _listHtml() {
    const c = this._config;
    if (!this._week) return `<div class="head"><div class="title">${esc(c.title)}</div></div><div class="empty">Yükleniyor…</div>`;
    const days = [this._week, addDays(this._week, 6)];
    return `<div class="head"><div class="title">${esc(c.title)}</div><button class="btn primary" data-a="new">Yeni</button></div>
      ${this._error ? `<div class="err">${esc(this._error)} <button class="btn small" data-a="reload">Tekrar dene</button></div>` : ""}
      <div class="sec">Şu an aktif</div>
      ${this._loading ? `<div class="empty">Yükleniyor…</div>` : this._activeHtml()}
      <div class="head" style="margin-top:12px">
        <div class="sec" style="margin:0">Hafta ${esc(fmtDate(days[0]))} – ${esc(fmtDate(days[1]))}</div>
        <div class="nav"><button class="btn small" data-a="prev" aria-label="Önceki hafta">‹</button><button class="btn small" data-a="today">Bu hafta</button><button class="btn small" data-a="next" aria-label="Sonraki hafta">›</button></div>
      </div>
      ${this._weekHtml()}`;
  }

  _targetsHtml(f) {
    const areas = this._areasWithEntities();
    const ents = this._programEntities().sort((a, b) => this._entityName(a).localeCompare(this._entityName(b), "tr"));
    const known = new Set([...areas.map((a) => a.id), ...ents]);
    const extra = f.targets.filter((t) => !known.has(t));
    const btn = (t, label) => `<button class="tg ${f.targets.includes(t) ? "on" : ""}" data-a="tg" data-t="${esc(t)}">${esc(label)}</button>`;
    const chosenEnts = ents.filter((e) => f.targets.includes(e));
    const otherEnts = ents.filter((e) => !f.targets.includes(e));
    return `<div class="field"><label>Odalar</label><div class="targets">${areas.map((a) => btn(a.id, a.name)).join("")}${extra.map((t) => btn(t, `${t} (bulunamadı)`)).join("")}</div></div>
      <div class="field"><label>Cihazlar</label><div class="targets">${chosenEnts.map((e) => btn(e, this._entityName(e))).join("")}</div>
        <select data-f="addEntity" data-rr aria-label="Cihaz ekle"><option value="">Cihaz ekle…</option>${otherEnts.map((e) => `<option value="${esc(e)}">${esc(this._entityName(e))} (${esc(DOMAIN_NAMES[e.split(".")[0]])})</option>`).join("")}</select></div>`;
  }

  _rulesHtml(f) {
    const domains = this._domainsOf(f.targets);
    const lines = f.lines.map((l, i) => {
      const attrs = Object.entries(ATTRS).filter(([k, a]) => domains.has(a.domain) || k === l.attr);
      const a = ATTRS[l.attr];
      const attrSel = `<select data-ri="${i}" data-rk="attr" aria-label="Özellik"><option value="" ${l.attr ? "" : "selected"} disabled>Özellik seç</option>${attrs.map(([k, x]) => `<option value="${k}" ${k === l.attr ? "selected" : ""}>${esc(DOMAIN_NAMES[x.domain])}: ${esc(x.label)}</option>`).join("")}</select>`;
      const ops = a && a.kind === "num" ? OPS : [["eq", "eşit"]];
      const opSel = `<select data-ri="${i}" data-rk="op" aria-label="İşlem" ${a ? "" : "disabled"}>${ops.map(([k, x]) => `<option value="${k}" ${k === l.op ? "selected" : ""}>${x}</option>`).join("")}</select>`;
      let val = `<span></span>`;
      if (a?.kind === "num") val = `<input type="number" data-ri="${i}" data-rk="value" min="${a.min}" max="${a.max}" step="${a.step}" value="${esc(l.value)}" placeholder="${esc(a.unit)}" aria-label="Değer">`;
      else if (a?.kind === "bool") val = `<select data-ri="${i}" data-rk="value" aria-label="Değer"><option value="true" ${l.value ? "selected" : ""}>açık</option><option value="false" ${l.value ? "" : "selected"}>kapalı</option></select>`;
      else if (a?.kind === "enum") val = `<select data-ri="${i}" data-rk="value" aria-label="Değer">${a.options.map(([k, x]) => `<option value="${k}" ${k === l.value ? "selected" : ""}>${x}</option>`).join("")}</select>`;
      else if (a?.kind === "color") {
        const v = Array.isArray(l.value) ? hex(l.value) : COLOR_NAMES[l.value] ? hex(COLOR_NAMES[l.value]) : (l.value || "#ff0000");
        val = `<input type="color" data-ri="${i}" data-rk="value" value="${esc(v)}" aria-label="Renk">`;
      }
      return `<div class="rule">${attrSel}${opSel}${val}<button class="x" data-a="delrule" data-i="${i}" aria-label="Kuralı sil">×</button></div>`;
    }).join("");
    const hint = f.targets.length ? "" : `<div class="note">Önce oda ya da cihaz seç; özellikler onların türüne göre listelenir.</div>`;
    return `<div class="field"><label>Kurallar</label><div class="form" style="gap:6px">${lines}</div>${hint}
      <button class="link" data-a="addrule" style="margin-top:6px">+ Kural ekle</button>
      <div class="note">Eşit kurallar program başlarken uygulanır ve bitince varsayılana döner (ışık kapalı, renk beyaz, ısıtma kapalı, perde gündüz açık / gece kapalı). En az / en çok yalnızca sınır koyar.</div></div>`;
  }

  _formHtml() {
    const f = this._form, b = this._busy ? "disabled" : "";
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
    const program = f.rawMode
      ? `<div class="field"><label>Program (YAML)</label>
          ${f.rawBad ? `<div class="err">Bu kaydın açıklaması program olarak okunamadı. Düzeltip forma geçebilirsin.</div>` : ""}
          <textarea data-f="rawDesc" aria-label="Program (YAML)">${esc(f.rawDesc)}</textarea>
          <button class="btn small" data-a="toform" style="margin-top:6px">Forma geç</button></div>`
      : `${this._targetsHtml(f)}${this._rulesHtml(f)}<button class="link" data-a="toraw">YAML olarak düzenle</button>`;
    const series = f.orig && f.orig.rrule ? `<div class="note">Tekrarlı bir programı düzenlemek tüm seriyi değiştirir.</div>` : "";
    return `<div class="head"><div class="title">${f.orig ? "Programı düzenle" : "Yeni program"}</div></div>
      <div class="form">
        <div class="field"><label>Ad</label><input type="text" data-f="summary" value="${esc(f.summary)}" placeholder="ör. melike_uyku"></div>
        <label class="check"><input type="checkbox" data-f="allDay" data-rr ${f.allDay ? "checked" : ""}>Tüm gün</label>
        ${when}
        <div class="field"><label>Tekrar</label><select data-f="mode" data-rr>${modeOpts}</select></div>
        ${f.mode === "weekly" ? `<div class="days">${days}</div>` : ""}
        ${f.mode === "custom" ? `<div class="field"><input type="text" data-f="rawRrule" value="${esc(f.rawRrule)}" placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"></div>` : ""}
        ${series}
        ${program}
        ${this._formError ? `<div class="err">${esc(this._formError)}</div>` : ""}
        <div class="actions">
          ${f.orig ? `<button class="btn danger" data-a="delete" ${b}>Sil</button>` : ""}
          <div class="right"><button class="btn" data-a="cancel" ${b}>Vazgeç</button><button class="btn primary" data-a="save" ${b}>${this._busy ? "Kaydediliyor…" : "Kaydet"}</button></div>
        </div>
      </div>`;
  }

  _render() {
    if (!this._config) return;
    const f = this._form;
    if (f && f.addEntity) {
      if (!f.targets.includes(f.addEntity)) f.targets.push(f.addEntity);
      f.addEntity = "";
    }
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>${f ? this._formHtml() : this._listHtml()}</ha-card>`;
  }
}

customElements.define("gungors-program-card", GungorsProgramCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "gungors-program-card", name: "Gungors Program Card", description: "Program takvimi: haftalık görünüm ve kural editörü" });
console.info(`%c gungors-program-card ${VERSION} `, "background:#03a9f4;color:#fff");
