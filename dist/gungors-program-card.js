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
// View: the programs active now (each with stop: the running occurrence ends now, and pause /
// resume: gungors.pause_program / resume_program, the calendar's `paused` attribute),
// and a week grid, one row per room with a program that week (an entity target without an
// area gets its own row), one column per day. Tap an entry to edit it; "Yeni" adds one.
const VERSION = "1.5.0";
const DEFAULT_CAL = "calendar.program";

const ATTRS = {
  on: { domain: "light", label: "Açık / kapalı", kind: "bool" },
  brightness: { domain: "light", label: "Parlaklık", kind: "num", range: true, unit: "%", min: 0, max: 100, step: 1 },
  color: { domain: "light", label: "Renk", kind: "color" },
  color_temp: { domain: "light", label: "Renk sıcaklığı", kind: "num", unit: "K", min: 2000, max: 6500, step: 100 },
  hvac_mode: { domain: "climate", label: "Isıtma modu", kind: "enum", options: [["heat", "Isıtma"], ["off", "Kapalı"]] },
  temperature: { domain: "climate", label: "Sıcaklık", kind: "num", range: true, unit: "°C", min: 5, max: 35, step: 0.5 },
  position: { domain: "cover", label: "Perde pozisyonu", kind: "num", range: true, unit: "%", min: 0, max: 100, step: 5 },
};
const OPS = [["eq", "="], ["min", "≥"], ["max", "≤"]];
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
      const obj = v && typeof v === "object" && !Array.isArray(v);
      const text = obj && (v.set || !("eq" in v) || Object.keys(v).length > 1)
        ? `{${["eq", "min", "max"].filter((o) => o in v).map((o) => `${o}: ${yamlScalarText(v[o])}`).join(", ")}${v.set ? ", set: true" : ""}}`
        : yamlScalarText(obj ? v.eq : v);
      out.push(`  ${k}: ${text}`);
    }
  }
  return out.join("\n") + "\n";
}
// {attr: value | {eq|min|max, set}} -> rule lines [{attr, op, value, set}]
function linesOf(rules) {
  const lines = [];
  for (const [attr, v] of Object.entries(rules || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const op of ["eq", "min", "max"]) if (op in v) lines.push({ attr, op, value: v[op], set: !!v.set });
    } else lines.push({ attr, op: "eq", value: v, set: false });
  }
  return lines;
}
const isSet = (v) => !!(v && typeof v === "object" && !Array.isArray(v) && v.set);
function ruleText(attr, v) {
  const a = ATTRS[attr];
  if (!a) return `${attr}: ${JSON.stringify(v)}`;
  const val = (x) => {
    if (a.kind === "bool") return x ? "açık" : "kapalı";
    if (a.kind === "enum") return (a.options.find((o) => o[0] === x) || [x, x])[1];
    if (a.kind === "color") return Array.isArray(x) ? hex(x) : x;
    return `${String(x).replace(".", ",")}${a.unit === "%" ? "%" : a.unit === "K" ? "K" : "°"}`;
  };
  const mode = isSet(v) ? " (uygula)" : "";
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("eq" in v) return `${a.label} ${val(v.eq)}${mode}`;
    if ("min" in v && "max" in v) return `${a.label} ${val(v.min)}–${val(v.max)}${mode}`;
    if ("min" in v) return `${a.label} ≥ ${val(v.min)}${mode}`;
    return `${a.label} ≤ ${val(v.max)}${mode}`;
  }
  return `${a.label} ${val(v)}`;
}

// A rule as an icon and a short value (the full text is the chip's tooltip).
const eqOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? ("eq" in v ? v.eq : undefined) : v);
function ruleIcon(attr, v) {
  const eq = eqOf(v);
  switch (attr) {
    case "on": return eq === false ? "mdi:lightbulb-off" : "mdi:lightbulb-on";
    case "brightness": return "mdi:brightness-6";
    case "color": return "mdi:palette";
    case "color_temp": return "mdi:white-balance-sunny";
    case "hvac_mode": return eq === "off" ? "mdi:radiator-off" : "mdi:radiator";
    case "temperature": return "mdi:thermometer";
    case "position": return eq === 0 ? "mdi:roller-shade-closed" : "mdi:roller-shade";
    default: return "mdi:help-circle-outline";
  }
}
function ruleValue(attr, v) {
  const a = ATTRS[attr];
  if (!a) return "";
  const eq = eqOf(v);
  if (a.kind === "color") {
    const rgb = Array.isArray(eq) ? eq : COLOR_NAMES[eq];
    return rgb ? `<span class="sw" style="background:${hex(rgb)}"></span>` : esc(eq);
  }
  if (a.kind === "bool") return eq ? "Açık" : "Kapalı";
  if (attr === "hvac_mode") return eq === "off" ? "Kapalı" : "Açık";
  if (attr === "position" && (eq === 0 || eq === 100)) return eq ? "Açık" : "Kapalı";
  const unit = a.unit === "%" ? "%" : a.unit === "K" ? "K" : "°";
  const n = (x) => `${String(x).replace(".", ",")}${unit}`;
  if (eq !== undefined) return esc(n(eq));
  if ("min" in v && "max" in v) return esc(`${String(v.min).replace(".", ",")}–${n(v.max)}`);
  return esc("min" in v ? `≥ ${n(v.min)}` : `≤ ${n(v.max)}`);
}
// Set rules (the system applies them) are filled chips, let rules outlined.
const ruleChip = (attr, v) =>
  `<span class="chip ${isSet(v) ? "set" : ""}" title="${esc(ruleText(attr, v))}"><ha-icon icon="${ruleIcon(attr, v)}"></ha-icon>${ruleValue(attr, v)}</span>`;
const ruleMini = (attr, v) => {
  const eq = eqOf(v);
  if (attr === "color" && (Array.isArray(eq) || COLOR_NAMES[eq])) return ruleValue(attr, v);
  return `<ha-icon class="${isSet(v) ? "set" : ""}" icon="${ruleIcon(attr, v)}"></ha-icon>`;
};

const CSS = `
:host{display:block;container-type:inline-size}
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
.chip{display:inline-flex;align-items:center;gap:4px;font-size:.8rem;padding:2px 9px 2px 6px;border-radius:12px;background:transparent;border:1px solid var(--divider-color)}
.chip.set{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.ev .mini ha-icon.set{color:var(--primary-color)}
.chip ha-icon{--mdc-icon-size:16px;display:inline-flex}
.sw{display:inline-block;width:11px;height:11px;border-radius:50%;border:1px solid var(--divider-color)}
.ev .mini{display:flex;flex-wrap:wrap;align-items:center;gap:3px;margin-top:2px}
.ev .mini ha-icon{--mdc-icon-size:14px;display:inline-flex}
.chip.warn{color:var(--error-color);border-color:var(--error-color)}
.nav{display:flex;align-items:center;gap:8px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--divider-color);margin:-4px 0 12px}
.tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font:inherit;color:var(--secondary-text-color);cursor:pointer}
.tab.on{color:var(--primary-color);border-bottom-color:var(--primary-color);font-weight:500}
.drow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:8px;align-items:center;padding:4px 0}
.dcol{display:flex;gap:6px;align-items:center}
.dcol input[type=color]{width:48px;height:40px;padding:2px;flex:none}
.note.ok{color:var(--success-color,#43a047)}
.wk{overflow-x:auto}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1px solid var(--divider-color);padding:4px;vertical-align:top;font-size:.8rem}
th{font-weight:500;color:var(--secondary-text-color);background:var(--secondary-background-color)}
th.room{width:110px;text-align:left}
th.today{color:var(--primary-color)}
td.room{font-weight:500}
.ev{display:block;width:100%;box-sizing:border-box;text-align:left;margin:0 0 3px;padding:3px 5px;border-radius:5px;border:0;border-left:3px solid var(--primary-color);background:var(--secondary-background-color);color:inherit;font:inherit;font-size:.75rem;cursor:pointer;line-height:1.25}
.ev.now{border-left-color:var(--success-color,#43a047)}
.ev.bad{border-left-color:var(--error-color)}
.ev .tm{color:var(--secondary-text-color)}
.ev .sm{display:block;overflow:hidden;text-overflow:ellipsis}
th .nw,th .nd{display:none}
@container (max-width: 640px) {
  ha-card{padding:12px 8px}
  th,td{padding:2px;font-size:.7rem}
  th.room{width:58px}
  td.room{word-break:break-word;hyphens:auto}
  th .wd{display:none}
  th .nw,th .nd{display:block}
  .ev{padding:2px 3px;font-size:.68rem;border-left-width:2px}
  .ev .te,.ev .sm{display:none}
  .ev .mini ha-icon{--mdc-icon-size:12px}
  .ev .mini{gap:1px}
  .sw{width:9px;height:9px}
}
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
.rule{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(56px,.5fr) minmax(0,1fr) 52px 32px;gap:6px;align-items:center}
.rule.hdr{font-size:.75rem;color:var(--secondary-text-color);margin-bottom:-2px}
.rule.hdr span{grid-column:4;text-align:center}
.rule .tog{margin:0;display:flex;justify-content:center;align-items:center;cursor:pointer;min-height:40px}
.rule .tog input{width:18px;height:18px;min-height:0;margin:0;accent-color:var(--primary-color);cursor:pointer}
.x{background:none;border:0;color:var(--secondary-text-color);cursor:pointer;font-size:1.2rem;padding:4px 8px}
.link{background:none;border:0;padding:0;color:var(--primary-color);font:inherit;font-size:.875rem;cursor:pointer;align-self:flex-start}
.actions{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:4px}
.actions .right{display:flex;gap:8px;margin-left:auto}
.btn{padding:8px 14px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);font:inherit;cursor:pointer;min-height:38px}
.btn.small{padding:4px 10px;min-height:30px;font-size:.85rem}
.btn.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.btn.danger{color:var(--error-color);border-color:var(--error-color)}
.btn:disabled{opacity:.5;cursor:default}
.ibtn{width:40px;height:40px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);cursor:pointer;padding:0}
.ibtn:hover{background:var(--secondary-background-color)}
.act.paused .sum{color:var(--secondary-text-color)}
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
    const cal = h.states[this._config?.entity || DEFAULT_CAL];
    const changed = cal !== this._calState;
    this._calState = cal;
    if (first) {
      this._week = this._monday(partsInTz(new Date(), this._tz).date);
      this._load();
    } else if (changed && !this._form && this._tab !== "defaults") this._load(); // entries or pauses changed
  }
  get _paused() { return this._calState?.attributes?.paused || []; }

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
      if (l.op === "eq" && !l.set) rules[l.attr] = v;
      else {
        const cur = rules[l.attr];
        rules[l.attr] = { ...(cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}), [l.op]: v };
      }
    }
    // One flag per attribute: set when any of its lines is.
    for (const l of lines) {
      if (l.attr && l.set && rules[l.attr] && typeof rules[l.attr] === "object" && !Array.isArray(rules[l.attr]))
        rules[l.attr].set = true;
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
      if (l.op !== "eq" && !a.range) return `${a.label}: yalnızca eşit verilebilir.`;
      (seen[l.attr] = seen[l.attr] || []).push(l.op);
    }
    for (const [attr, ops] of Object.entries(seen)) {
      if (new Set(ops).size !== ops.length || (ops.includes("eq") && ops.length > 1))
        return `${ATTRS[attr].label}: ya = ya da ≥ / ≤ verilebilir.`;
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
      // both in UTC: Home Assistant wants the same timezone on start and end
      dtstart: ev.start.dateTime ? new Date(ev.start.dateTime).toISOString() : ev.start.date,
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

  async _pause(ev, resume) {
    try {
      await this._hass.callService("gungors", resume ? "resume_program" : "pause_program", { uid: ev.uid }, { entity_id: this._config.entity });
    } catch (e) {
      this._error = `${resume ? "Devam ettirilemedi" : "Duraklatılamadı"}: ${e?.message || e}`;
      this._render();
    }
  }

  // ---------- events ----------
  _onClick(e) {
    const el = e.target.closest("[data-a]");
    if (!el || el.disabled) return;
    const a = el.dataset.a;
    const f = this._form;
    if (a === "tab") { this._tab = el.dataset.t; this._defs = null; this._defsError = null; this._defsSaved = false; this._render(); return; }
    if (a === "defs-save") { this._saveDefaults(); return; }
    if (a === "defs-reset") { this._defs = null; this._defsError = null; this._defsSaved = false; this._render(); return; }
    if (a === "new") { this._openForm(this._newForm()); }
    else if (a === "edit") { this._openForm(this._formFromEvent(this._find(el.dataset.k))); }
    else if (a === "end") { this._endNow(this._find(el.dataset.k)); }
    else if (a === "pause" || a === "resume") { this._pause(this._find(el.dataset.k), a === "resume"); }
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
      f.lines.push({ attr: "", op: "eq", value: "", set: false });
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
    if ("dk" in el.dataset) {
      if (this._defaultsInput(el) && e.type === "change") this._render();
      return;
    }
    if (!this._form) return;
    const f = this._form;
    if ("ri" in el.dataset) {
      const line = f.lines[+el.dataset.ri];
      const k = el.dataset.rk;
      if (k === "set") {
        // One flag per attribute: its other lines (min and max) follow.
        for (const l of f.lines) if (l.attr === line.attr) l.set = el.checked;
        if (e.type === "change") this._render();
        return;
      }
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

  // the start time, then the rest (hidden in the narrow grid)
  _tmHtml(ev) {
    const t = this._timeText(ev);
    const i = t.indexOf("–");
    return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<span class="te">${esc(t.slice(i))}</span>`;
  }

  _ruleChips(ev) {
    if (!ev._p) return `<span class="chip warn">Okunamayan açıklama</span>`;
    return Object.entries(ev._p.rules).map(([k, v]) => ruleChip(k, v)).join("");
  }

  _activeHtml() {
    if (!this._active.length) return `<div class="empty">Şu an aktif program yok.</div>`;
    return this._active.map((ev) => {
      const where = ev._p ? [...new Set(this._rowsOf(ev._p.target).map((k) => this._rowName(k)))].join(", ") : "";
      const paused = this._paused.includes(ev.uid);
      const k = esc(this._key(ev));
      return `<div class="act ${paused ? "paused" : ""}">
        <div class="t" data-a="edit" data-k="${k}">
          <div class="sum">${esc(ev.summary || "(başlıksız)")}${paused ? ` <span class="chip">Duraklatıldı</span>` : ""}</div>
          <div class="sub">${esc([where, `${this._timeText(ev)} bitiş ${partsInTz(ev._en, this._tz).time}`].filter(Boolean).join(" · "))}</div>
          <div class="chips">${this._ruleChips(ev)}</div>
        </div>
        ${paused
          ? `<button class="ibtn" data-a="resume" data-k="${k}" title="Devam ettir" aria-label="Devam ettir"><ha-icon icon="mdi:play"></ha-icon></button>`
          : `<button class="ibtn" data-a="pause" data-k="${k}" title="Duraklat" aria-label="Duraklat"><ha-icon icon="mdi:pause"></ha-icon></button>`}
        <button class="ibtn" data-a="end" data-k="${k}" title="Şimdi bitir" aria-label="Şimdi bitir"><ha-icon icon="mdi:stop"></ha-icon></button>
      </div>`;
    }).join("");
  }

  _weekHtml() {
    const tz = this._tz;
    const days = [...Array(7)].map((_, i) => addDays(this._week, i));
    const today = partsInTz(new Date(), tz).date;
    const now = new Date();
    const rows = new Map(); // only rows with a program this week
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
    const head = `<tr><th class="room">Oda</th>${days.map((d, i) => `<th class="${d === today ? "today" : ""}"><span class="wd">${WD[i][1]} ${fmtDay(d)}</span><span class="nw">${WD[i][1]}</span><span class="nd">${+d.slice(8)}</span></th>`).join("")}</tr>`;
    const body = [...rows.entries()]
      .sort((a, b) => this._rowName(a[0]).localeCompare(this._rowName(b[0]), "tr"))
      .map(([key, cells]) => `<tr><td class="room">${esc(key === "x:?" ? "Hatalı" : this._rowName(key))}</td>${days.map((_, i) => {
        const evs = (cells.get(i) || []).sort((a, b) => a._st - b._st);
        return `<td>${evs.map((ev) => `<button class="ev ${ev._st <= now && ev._en > now ? "now" : ""} ${ev._p ? "" : "bad"}" data-a="edit" data-k="${esc(this._key(ev))}" title="${esc(`${ev.summary || ""} ${this._timeText(ev)}\n` + (ev._p ? Object.entries(ev._p.rules).map(([k, v]) => ruleText(k, v)).join(", ") : "Okunamayan açıklama"))}">
          <span class="tm">${this._tmHtml(ev)}</span><span class="sm">${esc(ev.summary || "(başlıksız)")}</span>${ev._p ? `<span class="mini">${Object.entries(ev._p.rules).map(([k, v]) => ruleMini(k, v)).join("")}</span>` : ""}</button>`).join("")}</td>`;
      }).join("")}</tr>`).join("");
    return `<div class="wk"><table>${head}${body || `<tr><td colspan="8" class="empty">Bu hafta program yok.</td></tr>`}</table></div>`;
  }

  _listHtml() {
    const c = this._config;
    if (!this._week) return `<div class="head"><div class="title">${esc(c.title)}</div></div><div class="empty">Yükleniyor…</div>`;
    const days = [this._week, addDays(this._week, 6)];
    if (this._tab === "defaults") return `${this._tabsHtml()}${this._defaultsHtml()}`;
    return `${this._tabsHtml()}<div class="head"><div class="title">${esc(c.title)}</div><button class="btn primary" data-a="new">Yeni</button></div>
      ${this._error ? `<div class="err">${esc(this._error)} <button class="btn small" data-a="reload">Tekrar dene</button></div>` : ""}
      <div class="sec">Şu an aktif</div>
      ${this._loading ? `<div class="empty">Yükleniyor…</div>` : this._activeHtml()}
      <div class="head" style="margin-top:12px">
        <div class="sec" style="margin:0">Hafta ${esc(fmtDate(days[0]))} – ${esc(fmtDate(days[1]))}</div>
        <div class="nav"><button class="btn small" data-a="prev" aria-label="Önceki hafta">‹</button><button class="btn small" data-a="today">Bu hafta</button><button class="btn small" data-a="next" aria-label="Sonraki hafta">›</button></div>
      </div>
      ${this._weekHtml()}`;
  }

  _tabsHtml() {
    const t = this._tab || "program";
    return `<div class="tabs" role="tablist">${[["program", "Program"], ["defaults", "Varsayılanlar"]].map(([k, x]) =>
      `<button role="tab" class="tab ${k === t ? "on" : ""}" aria-selected="${k === t}" data-a="tab" data-t="${k}">${x}</button>`).join("")}</div>`;
  }

  // ---------- defaults tab ----------
  _defaultsDraft() {
    const cur = this._calState?.attributes?.defaults || {};
    const d = {};
    for (const dom of DOMAINS) d[dom] = { ...(cur[dom] || {}) };
    return d;
  }

  _defaultsHtml() {
    const d = this._defs || (this._defs = this._defaultsDraft());
    const row = (label, ctl) => `<div class="drow"><span>${esc(label)}</span>${ctl}</div>`;
    const sel = (key, value, options) => `<select data-dk="${key}" aria-label="${esc(key)}">${options.map(([k, x]) =>
      `<option value="${esc(k)}" ${String(value ?? "") === k ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
    const numIn = (key, value, a) => `<input type="number" data-dk="${key}" min="${a.min}" max="${a.max}" step="${a.step}" value="${value ?? ""}" placeholder="yok" aria-label="${esc(a.label)}">`;
    const L = d.light, C = d.climate, V = d.cover;
    const color = L.color === undefined ? "" : hex(Array.isArray(L.color) ? L.color : COLOR_NAMES[L.color] || [255, 255, 255]);
    const pos = V.position === undefined ? "" : V.position === "sun" ? "sun" : "value";
    return `<div class="head"><div class="title">Varsayılanlar</div></div>
      <div class="note" style="margin:0 0 8px">Uygula açık bir kural bitince cihaz bu değerlere döner; perdeler gün doğumu ve batımında da. Boş bırakılan özellik değişmez. Bir cihaz kendi YAML'ındaki <code>- program: {...}</code> ile bunları ezebilir.</div>
      ${this._defsError ? `<div class="err">${esc(this._defsError)}</div>` : ""}
      ${this._defsSaved ? `<div class="note ok">Kaydedildi.</div>` : ""}
      <div class="sec">Işık</div>
      ${row("Açık / kapalı", sel("light.on", L.on === undefined ? "" : String(L.on), [["", "değişmez"], ["true", "açık"], ["false", "kapalı"]]))}
      ${row("Renk", `<span class="dcol">${sel("light.color_on", color ? "1" : "", [["", "değişmez"], ["1", "renk"]])}${color ? `<input type="color" data-dk="light.color" value="${color}" aria-label="Renk">` : ""}</span>`)}
      ${row("Parlaklık (%)", numIn("light.brightness", L.brightness, ATTRS.brightness))}
      ${row("Renk sıcaklığı (K)", numIn("light.color_temp", L.color_temp, ATTRS.color_temp))}
      <div class="sec">Isıtma</div>
      ${row("Isıtma modu", sel("climate.hvac_mode", C.hvac_mode ?? "", [["", "değişmez"], ["heat", "Isıtma"], ["off", "Kapalı"]]))}
      ${row("Sıcaklık (°C)", numIn("climate.temperature", C.temperature, ATTRS.temperature))}
      <div class="sec">Perde</div>
      ${row("Pozisyon", `<span class="dcol">${sel("cover.position_mode", pos, [["", "değişmez"], ["sun", "güneşe göre"], ["value", "sabit"]])}${pos === "value" ? numIn("cover.position", V.position, ATTRS.position) : ""}</span>`)}
      <div class="actions" style="margin-top:12px"><button class="btn" data-a="defs-reset">Geri al</button><button class="btn primary" data-a="defs-save" ${this._defsBusy ? "disabled" : ""}>Kaydet</button></div>`;
  }

  _defaultsInput(el) {
    const d = this._defs || (this._defs = this._defaultsDraft());
    const [dom, attr] = el.dataset.dk.split(".");
    const v = el.value;
    const set = (a, x) => { if (x === undefined) delete d[dom][a]; else d[dom][a] = x; };
    if (attr === "on") set("on", v === "" ? undefined : v === "true");
    else if (attr === "color_on") set("color", v ? [255, 255, 255] : undefined);
    else if (attr === "color") set("color", rgbOf(v));
    else if (attr === "hvac_mode") set("hvac_mode", v || undefined);
    else if (attr === "position_mode") set("position", v === "sun" ? "sun" : v === "value" ? 100 : undefined);
    else set(attr, v === "" ? undefined : num(v) ?? undefined);
    this._defsSaved = false;
    return attr === "on" || attr.endsWith("_on") || attr.endsWith("_mode");
  }

  async _saveDefaults() {
    this._defsBusy = true; this._defsError = null; this._render();
    try {
      await this._hass.callService("gungors", "set_program_defaults", { defaults: this._defs }, { entity_id: this._config.entity });
      this._defsSaved = true;
    } catch (err) {
      this._defsError = err?.message || String(err);
    }
    this._defsBusy = false; this._render();
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
      const ops = a && a.range ? OPS : [OPS[0]];
      const opSel = `<select data-ri="${i}" data-rk="op" aria-label="İşlem" ${a ? "" : "disabled"}>${ops.map(([k, x]) => `<option value="${k}" ${k === l.op ? "selected" : ""}>${x}</option>`).join("")}</select>`;
      let val = `<span></span>`;
      if (a?.kind === "num") val = `<input type="number" data-ri="${i}" data-rk="value" min="${a.min}" max="${a.max}" step="${a.step}" value="${esc(l.value)}" placeholder="${esc(a.unit)}" aria-label="Değer">`;
      else if (a?.kind === "bool") val = `<select data-ri="${i}" data-rk="value" aria-label="Değer"><option value="true" ${l.value ? "selected" : ""}>açık</option><option value="false" ${l.value ? "" : "selected"}>kapalı</option></select>`;
      else if (a?.kind === "enum") val = `<select data-ri="${i}" data-rk="value" aria-label="Değer">${a.options.map(([k, x]) => `<option value="${k}" ${k === l.value ? "selected" : ""}>${x}</option>`).join("")}</select>`;
      else if (a?.kind === "color") {
        const v = Array.isArray(l.value) ? hex(l.value) : COLOR_NAMES[l.value] ? hex(COLOR_NAMES[l.value]) : (l.value || "#ff0000");
        val = `<input type="color" data-ri="${i}" data-rk="value" value="${esc(v)}" aria-label="Renk">`;
      }
      const sw = `<label class="tog" title="Açık: sistem kuralı kendisi uygular. Kapalı: sadece kurala uymayan değişikliğe izin vermez."><input type="checkbox" data-ri="${i}" data-rk="set" ${l.set ? "checked" : ""} ${a ? "" : "disabled"} aria-label="Uygula"></label>`;
      return `<div class="rule">${attrSel}${opSel}${val}${sw}<button class="x" data-a="delrule" data-i="${i}" aria-label="Kuralı sil">×</button></div>`;
    }).join("");
    const hint = f.targets.length ? "" : `<div class="note">Önce oda ya da cihaz seç; özellikler onların türüne göre listelenir.</div>`;
    return `<div class="field"><label>Kurallar</label><div class="form" style="gap:6px">${f.lines.length ? `<div class="rule hdr" aria-hidden="true"><span>Uygula</span></div>` : ""}${lines}</div>${hint}
      <button class="link" data-a="addrule" style="margin-top:6px">+ Kural ekle</button>
      <div class="note">Uygula açık: sistem kuralı kendisi uygular (gerekirse ışığı ya da ısıtmayı açar) ve program bitince cihaz varsayılana döner (ışık kapalı, renk beyaz, ısıtma kapalı, perde gündüz açık / gece kapalı). Kapalı: kapalı cihaz kurala uyar sayılır, sadece kurala uymayan değişikliğe izin verilmez; bitince kural kalkar.</div></div>`;
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
