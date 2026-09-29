/*
 * gungors-floor-card — Home Assistant Lovelace card showing one floor of the Blender house model
 * with live lighting (WebGL2). Data comes from build_floor_html.py (svg/<floor>_card/, deployed to
 * /config/www/gungors_floor/<floor>/ by deploy.ps1).
 *
 * Like a picture-elements / ha-floorplan dashboard, the folder is only the picture (model.json +
 * layer images); what reacts to the user is set here, in the card's YAML:
 *
 *   type: custom:gungors-floor-card
 *   floor: kat0                       # folder under base (the Home Assistant floor id)
 *   base: /local/gungors_floor/       # optional
 *   light_gain: 1                     # optional: render gain of a light at 100 % brightness
 *   dock_radius: 370                 # optional: size (model px) of the control dock in the bottom-left corner
 *   entities:                         # lamps/covers of the model that react to tap/hold (hover glow)
 *     - entity: light.salon_light     # default tap_action: toggle (lights) / more-info (others)
 *     - entity: cover.salon_cover     # default hold_action: more-info
 *       tap_action: {action: perform-action, perform_action: script.cover_tap, data: {cover: cover.salon_cover}}
 *     - entity: cover.garaj_door
 *       slider: true                  # a slider in the dock list (name: optional label)
 *
 * Without `entities` every lamp and cover of the model reacts with the default actions.
 * The standalone page of the floor (build_floor_html.py -> svg/<floor>.html) runs this same card with
 * the model passed in `model` and a stand-in hass whose entities start at 100 %.
 * The picture always follows Home Assistant for all of them: cover position, light on/off +
 * brightness, sun above/below the horizon. An entity that does not exist in Home Assistant (e.g. a
 * cover not integrated yet) only changes the picture (tap toggles it, a slider moves it).
 */
const CARD_VERSION = "1.10.0";
const MODEL_FORMAT = 2;              // model.json layout written by build_floor_html.py
const HOLD_MS = 500;

// modes of the dock, one round button each (on the rim, from the bottom edge up)
const DOCK_MODES = [
  { id: "lights", icon: "mdi:lightbulb-group", title: "lights" },
  { id: "covers", icon: "mdi:curtains", title: "covers" },
  { id: "sun", icon: "mdi:weather-sunny", title: "sun" },
  { id: "floors", icon: "mdi:home-floor-0", title: "floors" },
];

// point in polygon (even-odd), polygon as [[x, y], ...]
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const DOCK_CSS = `
  ha-card{overflow:hidden;background:#3a3a3a}
  .wrap{position:relative;width:100%}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .msg{position:absolute;left:12px;top:10px;color:#e6e6e6;font-size:13px}
  .areas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .areas polygon{fill:none;stroke:rgba(214,180,90,.3);stroke-width:1.5;stroke-linejoin:round;transition:stroke .15s,fill .15s}
  .areas polygon.hover{stroke:rgba(255,214,107,.8);fill:rgba(255,214,107,.07)}
  .dock{position:absolute;left:0;transform-origin:0 0;font:15px "Segoe UI",Roboto,Arial,sans-serif;color:#e8f4ff;
        user-select:none;-webkit-user-select:none}
  .disc,.gloss{position:absolute;left:0;bottom:0;box-sizing:border-box}
  .disc{width:100%;height:100%;border-top-right-radius:100%;
        background:radial-gradient(circle at 0% 100%,#071d45 0 52%,#0d3b85 64%,#1d6fd6 80%,#3b95f0 89%,#0b3a86 100%);
        border-top:4px solid #a8dcff;border-right:4px solid #a8dcff;
        box-shadow:0 0 22px rgba(90,180,255,.55),inset 0 0 30px rgba(0,20,60,.6)}
  .gloss{width:70%;height:70%;border-top-right-radius:100%;border-top:2px solid rgba(160,215,255,.35);
         border-right:2px solid rgba(160,215,255,.35);pointer-events:none}
  .btn{position:absolute;width:70px;height:70px;border-radius:50%;padding:0;cursor:pointer;outline:none;
       border:3px solid #e6f5ff;color:#fff;display:flex;align-items:center;justify-content:center;
       background:radial-gradient(circle at 35% 28%,#e4f4ff 0 7%,#63b4ff 20%,#1a67d1 58%,#0a2f70 100%);
       box-shadow:0 4px 10px rgba(0,0,0,.55),0 0 12px rgba(120,200,255,.55);transition:transform .15s,box-shadow .15s}
  .btn ha-icon{--mdc-icon-size:34px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
  .btn:hover{transform:scale(1.08)}
  .btn.active{border-color:#ffd66b;box-shadow:0 4px 10px rgba(0,0,0,.55),0 0 20px rgba(255,214,107,.85)}
  .screen{position:absolute;left:14px;bottom:14px;width:206px;height:182px;box-sizing:border-box;padding:8px 10px;
          border-radius:16px;border:2px solid #5fb4ff;background:linear-gradient(#051a40,#0a2c63);
          box-shadow:inset 0 2px 10px rgba(0,0,0,.7),0 0 10px rgba(80,170,255,.4);display:flex;flex-direction:column}
  .top{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid rgba(95,180,255,.35);padding-bottom:3px}
  .clock{font:bold 26px "Consolas","Courier New",monospace;color:#7dff9a;text-shadow:0 0 8px rgba(125,255,154,.7)}
  .date{font-size:12px;color:#9fcfff}
  .title{font-size:12px;letter-spacing:1px;color:#ffd66b;margin:4px 0 2px;text-transform:uppercase}
  .list{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#3b95f0 transparent}
  .row{display:flex;align-items:center;gap:6px;height:25px;padding:0 4px;border-radius:6px}
  .row.act{cursor:pointer}
  .row.act:hover{background:rgba(95,180,255,.18)}
  .row ha-icon{--mdc-icon-size:18px;color:#6f93c2;flex:none}
  .row.on ha-icon{color:#ffd66b;filter:drop-shadow(0 0 4px rgba(255,214,107,.8))}
  .row .lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .val{font:14px "Consolas","Courier New",monospace;color:#7dff9a}
  .row input{width:74px;margin:0;accent-color:#ffd66b}
  .row.local .lbl{font-style:italic;color:#bcd3ee}
  .row.dim{opacity:.45}
`;

class GungorsFloorCard extends HTMLElement {
  setConfig(config) {
    if (!config.floor) throw new Error("gungors-floor-card: 'floor' is required (e.g. kat0)");
    this._config = { base: "/local/gungors_floor/", light_gain: 1, dock_radius: 370, ...config };
    if (!this._config.base.endsWith("/")) this._config.base += "/";
    const ents = config.entities;
    if (ents != null && !Array.isArray(ents)) throw new Error("gungors-floor-card: 'entities' must be a list");
    this._ents = ents == null ? null
      : new Map(ents.map((e) => (typeof e === "string" ? { entity: e } : e)).map((e) => [e.entity, e]));
  }

  connectedCallback() {
    if (this._M && this._panel.firstChild && !this._clockTimer) this._clockTimer = setInterval(() => this._clock(), 15000);
  }

  disconnectedCallback() { clearInterval(this._clockTimer); this._clockTimer = null; }

  getCardSize() { return 9; }
  getGridOptions() { return { columns: "full", min_rows: 6 }; }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) { this._started = true; this._init(); }
    else if (this._M) this._sync();
  }

  // ------------------------------------------------------------------ setup
  async _init() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${DOCK_CSS}</style>
      <ha-card><div class="wrap"><canvas></canvas><svg class="areas"></svg><div class="dock"></div><div class="msg">loading…</div></div></ha-card>`;
    this._wrap = root.querySelector(".wrap");
    this._cv = root.querySelector("canvas");
    this._panel = root.querySelector(".dock");
    this._msg = root.querySelector(".msg");
    const dir = this._config.base + this._config.floor + "/";
    try {
      this._M = this._config.model      // preloaded by the standalone page (images as data URIs in image_urls)
        || await (await fetch(dir + "model.json?v=" + CARD_VERSION, { cache: "no-cache" })).json();
    } catch (e) { this._msg.textContent = "model.json not found: " + dir; return; }
    const M = this._M;
    if (M.format !== MODEL_FORMAT) {
      this._msg.textContent = `model.json format ${M.format} is not supported by gungors-floor-card ${CARD_VERSION} (needs ${MODEL_FORMAT}): update the card or rebuild the floor`;
      return;
    }
    if (this._ents) {
      const known = new Set([...M.lights, ...M.covers].map((x) => x.entity));
      for (const e of this._ents.keys()) if (!known.has(e)) console.warn(`gungors-floor-card: ${e} is not in ${dir}model.json`);
    }
    this._wrap.style.aspectRatio = M.W + " / " + M.H;
    this._cv.width = M.W; this._cv.height = M.H;
    this._val = {};
    this._dragging = {};
    this._buildPanel();
    this._buildAreas();
    new ResizeObserver(() => this._fitPanel()).observe(this._wrap);
    if (!this._initGL()) return;
    this._loadImages(dir);
    this._sync();
    this._cv.addEventListener("pointermove", (e) => this._onMove(e));
    this._cv.addEventListener("pointerleave", () => { if (this._hover !== -1) { this._hover = -1; this._redraw(); } });
    this._cv.addEventListener("pointerdown", (e) => this._onDown(e));
    this._cv.addEventListener("pointerup", (e) => this._onUp(e));
    this._cv.addEventListener("pointercancel", () => this._cancelPress());
    this._cv.addEventListener("contextmenu", (e) => { if (this._pick(e) >= 0) e.preventDefault(); });
    this._cv.style.touchAction = "manipulation";
  }

  _state(entity) { return this._hass && this._hass.states[entity]; }

  // card YAML of an entity (null: it does not react to the user)
  _conf(entity) {
    if (!this._ents) return { entity };
    return this._ents.get(entity) || null;
  }

  // slider rows of the entities with `slider: true`, grouped like the standalone page
  _groups() {
    const M = this._M, short = (e) => e.split(".").slice(1).join(".") || e;
    const rows = (list, kind, init) => list.filter((x) => (this._conf(x.entity) || {}).slider)
      .map((x) => ({ key: kind + ":" + x.id, label: this._conf(x.entity).name || short(x.entity), init: init(x) }));
    return [{ title: "covers:", rows: rows(M.covers, "open", () => 0) },
            { title: "lights:", rows: rows(M.lights.filter((l) => !l.role), "light", (l) => 1 / (l.max || 1)) }]
      .filter((g) => g.rows.length);
  }

  // ------------------------------------------------------------------ dock (quarter-disc control panel, bottom left)
  // Round mode buttons on the rim, a "screen" in the corner with a clock and the list of the active mode.
  _buildPanel() {
    const M = this._M, R = this._config.dock_radius, d = this._panel;
    for (const g of this._groups()) for (const r of g.rows) this._val[r.key] = r.init;
    this._mode = this._mode || "lights";
    const rb = R - 46, angles = [16, 37, 58, 79];
    const btns = DOCK_MODES.map((m, i) => {
      const a = angles[i] * Math.PI / 180;
      return `<button class="btn" data-mode="${m.id}" title="${m.title}"
                style="left:${rb * Math.cos(a) - 35}px;top:${R - rb * Math.sin(a) - 35}px"><ha-icon icon="${m.icon}"></ha-icon></button>`;
    }).join("");
    d.style.width = d.style.height = R + "px";
    d.style.top = ((M.H - R) / M.H * 100) + "%";
    d.innerHTML = `<div class="disc"></div><div class="gloss"></div>${btns}
      <div class="screen"><div class="top"><span class="clock"></span><span class="date"></span></div>
        <div class="title"></div><div class="list"></div></div>`;
    d.querySelectorAll(".btn").forEach((b) => b.addEventListener("click", () => { this._mode = b.dataset.mode; this._renderList(true); }));
    this._clock();
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => this._clock(), 15000);
    this._renderList(true);
    this._fitPanel();
  }

  // touch areas of the lamps (model.json fixtures[].area): larger than the lamp itself, drawn as a faint outline
  _buildAreas() {
    const M = this._M, svg = this._wrap.querySelector(".areas");
    svg.setAttribute("viewBox", `0 0 ${M.W} ${M.H}`);
    svg.innerHTML = M.fixtures.map((f, i) => {
      const l = M.lights.find((x) => x.id === f.id);
      if (!f.area || !l || !this._conf(l.entity)) return "";
      return `<polygon data-h="${M.covers.length + i}" points="${f.area.map((p) => p.join(",")).join(" ")}"/>`;
    }).join("");
  }

  _fitPanel() {
    if (!this._M) return;
    const s = this._wrap.clientWidth / this._M.W;
    this._panel.style.transform = `scale(${s})`;
  }

  // the time the card shows and picks the sun for; the standalone page may set timeOverride (its scene button)
  _now() { return this.timeOverride ? new Date(this.timeOverride) : new Date(); }

  _clock() {
    const now = this._now(), d = this._panel;
    d.querySelector(".clock").textContent = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    d.querySelector(".date").textContent = now.toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" });
    if (this._M && this._updateSun()) { this._redraw(); this._renderList(true); }     // the sun moves on with the clock
  }

  // rows of the active mode; rebuilt when the mode or a listed state changes (not while a slider is dragged)
  _renderList(force) {
    if (!this._M || (!force && Object.values(this._dragging).some(Boolean))) return;
    const M = this._M, mode = this._mode, short = (e) => e.split(".").slice(1).join(".") || e;
    const st = (e) => this._state(e);
    let rows = [];
    if (mode === "lights") {
      M.fixtures.forEach((f, i) => {
        const l = M.lights.find((x) => x.id === f.id), s = st(l.entity), conf = this._conf(l.entity);
        const on = s ? s.state === "on" : (this._val["light:" + l.id] ?? 1) > 0;
        const b = s && s.attributes.brightness != null ? Math.round(s.attributes.brightness / 2.55) + "%" : (on ? "on" : "off");
        rows.push({ entity: l.entity, pick: M.covers.length + i, icon: on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline", on,
                    label: (conf && conf.name) || short(l.entity), value: on ? b : "off", key: "light:" + l.id, conf, kind: "light", it: l });
      });
    } else if (mode === "covers") {
      M.covers.forEach((c, i) => {
        const s = st(c.entity), conf = this._conf(c.entity), t = this._val["open:" + c.id] ?? 0;
        rows.push({ entity: c.entity, pick: i, icon: t > 0.02 ? "mdi:curtains" : "mdi:curtains-closed", on: t > 0.02,
                    label: (conf && conf.name) || short(c.entity), value: Math.round(t * 100) + "%", key: "open:" + c.id, conf, kind: "cover", it: c });
      });
    } else if (mode === "sun") {
      const s = st("sun.sun"), a = s ? s.attributes : {};
      const t = (v) => v ? new Date(v).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "-";
      rows = [{ icon: s && s.state === "above_horizon" ? "mdi:weather-sunny" : "mdi:weather-night", on: s && s.state === "above_horizon",
                label: "sun", value: s ? (s.state === "above_horizon" ? "up" : "down") : "-" },
              { icon: "mdi:angle-acute", label: "elevation", value: a.elevation != null ? Math.round(a.elevation) + "°" : "-" },
              { icon: "mdi:weather-sunset-down", label: "sunset", value: t(a.next_setting) },
              { icon: "mdi:weather-sunset-up", label: "sunrise", value: t(a.next_rising) }];
      // the light shown in the picture: a sun position (its hour on the reference day) or the street lamps
      const sn = this._sun || {};
      rows.push(sn.night ? { icon: "mdi:post-lamp", on: true, label: "picture", value: "gece" }
                         : { icon: "mdi:sun-clock", on: true, label: "picture", value: sn.phase || "-" });
    } else {
      const floors = (this._hass && this._hass.floors) ? Object.values(this._hass.floors).sort((x, y) => (x.level ?? 0) - (y.level ?? 0)) : [];
      rows = (floors.length ? floors : [{ floor_id: this._config.floor, name: this._config.floor }]).map((f) => {
        const cur = f.floor_id === this._config.floor;
        return { icon: f.icon || "mdi:home-floor-" + (f.level ?? 0), on: cur, label: f.name, value: cur ? "●" : "", dim: !cur };
      });
    }
    const sig = mode + JSON.stringify(rows.map((r) => [r.label, r.value, r.on]));
    if (!force && sig === this._listSig) return;
    this._listSig = sig;
    const d = this._panel, title = DOCK_MODES.find((m) => m.id === mode).title;
    d.querySelectorAll(".btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    d.querySelector(".title").textContent = title;
    d.querySelector(".list").innerHTML = rows.map((r, i) => {
      const slider = r.conf && r.conf.slider;
      const local = r.entity && !st(r.entity);
      return `<div class="row${r.on ? " on" : ""}${r.dim ? " dim" : ""}${local ? " local" : ""}${r.entity ? " act" : ""}" data-i="${i}"
                   title="${r.entity || ""}${local ? " (not in Home Assistant: local only)" : ""}">
                <ha-icon icon="${r.icon}"></ha-icon><span class="lbl">${r.label}</span>
                ${slider ? `<input type="range" min="0" max="100" value="${Math.round((this._val[r.key] ?? 0) * 100)}" data-k="${r.key}">`
                         : `<span class="val">${r.value}</span>`}</div>`;
    }).join("");
    this._rows = rows;
    d.querySelectorAll(".row.act").forEach((el) => {
      const r = rows[+el.dataset.i];
      el.addEventListener("mouseenter", () => { this._hover = r.pick; this._redraw(); });
      el.addEventListener("mouseleave", () => { this._hover = -1; this._redraw(); });
      if (!r.conf || r.conf.slider) return;
      let timer = null, held = false;
      el.addEventListener("pointerdown", () => { held = false; timer = setTimeout(() => { held = true; this._run(r.pick, "hold"); }, HOLD_MS); });
      el.addEventListener("pointerup", () => { clearTimeout(timer); if (!held) this._run(r.pick, "tap"); });
      el.addEventListener("pointerleave", () => clearTimeout(timer));
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    d.querySelectorAll("input").forEach((inp) => {
      const k = inp.dataset.k;
      inp.addEventListener("input", () => { this._dragging[k] = true; this._val[k] = inp.value / 100; this._redraw(); });
      inp.addEventListener("change", () => { this._dragging[k] = false; this._val[k] = inp.value / 100; this._command(k, this._val[k]); this._redraw(); this._renderList(true); });
    });
  }

  _entityOf(key) {
    const [kind, id] = key.split(":");
    const list = kind === "open" ? this._M.covers : this._M.lights;
    const it = list.find((x) => x.id === id);
    return it ? it.entity : null;
  }

  // ------------------------------------------------------------------ Home Assistant state <-> values
  _sync() {
    const M = this._M;
    let changed = false;
    const set = (key, v) => {
      if (this._dragging[key] || v == null || Math.abs((this._val[key] ?? -1) - v) < 1e-4) return;
      this._val[key] = v; changed = true;
      const inp = this._panel.querySelector(`input[data-k="${key}"]`);
      if (inp) inp.value = Math.round(v * 100);
    };
    for (const c of M.covers) {
      const st = this._state(c.entity);
      if (!st) continue;
      const pos = st.attributes.current_position;
      set("open:" + c.id, pos != null ? pos / 100 : (st.state === "closed" ? 0 : 1));
    }
    for (const l of M.lights) {
      if (l.role === "sun" || l.role === "night") continue;      // follow sun.sun and the clock (_sunState)
      const st = this._state(l.entity);
      if (!st) continue;
      const b = st.attributes.brightness;
      set("light:" + l.id, st.state === "on" ? (b != null ? b / 255 : 1) : 0);
    }
    if (this._updateSun()) changed = true;
    if (changed) this._redraw();
    this._renderList(false);
  }

  // Which sun light shines: the real day (sun.sun next_rising/next_setting, else the reference day) is
  // scaled onto the reference day the suns were placed for, and the sun with the nearest hour wins.
  // Below the horizon every sun is off and the night lights (street lamps) are on.
  _sunState() {
    const M = this._M, ref = M.sun, suns = M.lights.filter((l) => l.role === "sun");
    const st = this._state("sun.sun"), a = st ? st.attributes : {};
    const hours = (d) => d.getHours() + d.getMinutes() / 60, h = hours(this._now());
    let rise = ref ? ref.sunrise : 6, set = ref ? ref.sunset : 21;
    if (a.next_rising && a.next_setting) { rise = hours(new Date(a.next_rising)); set = hours(new Date(a.next_setting)); }
    const up = st ? st.state === "above_horizon" : h >= rise && h < set;
    if (!up || !suns.length) return { night: true, sun: null, ref: null };
    const f = Math.min(1, Math.max(0, (h - rise) / Math.max(0.1, set - rise)));
    const refH = ref ? ref.sunrise + f * (ref.sunset - ref.sunrise) : h;
    const sun = suns.reduce((b, l) => (Math.abs(l.hour - refH) < Math.abs(b.hour - refH) ? l : b));
    return { night: false, sun: sun.id, ref: refH, hour: sun.hour, phase: sun.phase || sun.id };
  }

  _updateSun() {
    const s = this._sunState(), sig = s.night + ":" + s.sun;
    if (sig === this._sunSig) return false;
    this._sunSig = sig; this._sun = s;
    return true;
  }

  _gain(l) {
    const st = this._state(l.entity);
    if (l.role === "sun") return this._sun && this._sun.sun === l.id ? 1 : 0;
    if (l.role === "night") return this._sun && this._sun.night ? 1 : 0;
    const v = this._val["light:" + l.id];
    if (v == null) return st ? (st.state === "on" ? 1 : 0) : 1;     // light without a slider row
    return v * this._config.light_gain;
  }

  _command(key, v) {
    const ent = this._entityOf(key), st = this._state(ent);
    if (!st) return;                                    // local-only entity
    if (key.startsWith("open:")) {
      if (st.attributes.supported_features & 4) this._hass.callService("cover", "set_cover_position", { entity_id: ent, position: Math.round(v * 100) });
      else this._hass.callService("cover", v > 0.5 ? "open_cover" : "close_cover", { entity_id: ent });
    } else if (v <= 0.005) {
      this._hass.callService("light", "turn_off", { entity_id: ent });
    } else {
      const modes = st.attributes.supported_color_modes || [];
      const data = { entity_id: ent };
      if (!(modes.length === 1 && modes[0] === "onoff")) data.brightness_pct = Math.max(1, Math.round(v * 100));
      this._hass.callService("light", "turn_on", data);
    }
  }

  // ------------------------------------------------------------------ WebGL
  _initGL() {
    const gl = this._cv.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) { this._msg.textContent = "WebGL2 is not available in this browser."; return false; }
    this._gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    try {
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, "#version 300 es\nin vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }"));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, this._M.shader));
    } catch (e) { this._msg.textContent = "shader error: " + e.message; return false; }
    gl.linkProgram(prog); gl.useProgram(prog);
    this._prog = prog;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const M = this._M;
    this._tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, M.W, M.H, M.images.length);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this._hover = -1;
    return true;
  }

  _loadImages(dir) {
    const M = this._M, gl = this._gl;
    this._cpu = {};
    const need = {};
    // outline of each cover: its outline mask (the rectangle it closes) or else its param layer (whole silhouette)
    M.covers.forEach((c) => { if (c.outline != null) need[c.outline] = 3; else need[c.param] = 0; });
    M.fixtures.forEach((f) => { need[f.layer] = 3; });
    const c2 = document.createElement("canvas"); c2.width = M.W; c2.height = M.H;
    const x2 = c2.getContext("2d", { willReadFrequently: true });
    this._left = M.images.length;
    M.images.forEach((name, i) => {
      const im = new Image();
      im.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._tex);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, M.W, M.H, 1, gl.RGBA, gl.UNSIGNED_BYTE, im);
        if (need[i] != null) {
          x2.clearRect(0, 0, M.W, M.H); x2.drawImage(im, 0, 0);
          const d = x2.getImageData(0, 0, M.W, M.H).data, ch = need[i], arr = new Uint8Array(M.W * M.H);
          for (let k = 0; k < arr.length; k++) arr[k] = d[k * 4 + ch];
          this._cpu[i] = arr;
        }
        if (--this._left === 0) { this._msg.remove(); this._redraw(); }
      };
      im.onerror = () => { this._msg.textContent = "missing layer: " + name; };
      im.src = M.image_urls ? M.image_urls[i] : dir + name + "?v=" + CARD_VERSION;
    });
  }

  // parts of a cover's plane covered when opened by t, for the light maps (U, or V for a track door)
  _covered(c, t) {
    if (c.motion === "track") return [Math.min(1, t * c.travel / c.H), 1, 2, 2];
    if (c.motion === "roll") return t >= 0.999 ? [2, 2, 2, 2] : [t, 1, 2, 2];      // fabric left between t and the top
    const s = 1 - (1 - c.min_scale) * t;
    if (c.motion === "both_sides") { const f = s * (c.L / 2 + c.overlap) / c.L; return [0, f, 1 - f, 1]; }
    if (c.motion === "to_end") return [1 - s, 1, 2, 2];
    return [0, s, 2, 2];
  }
  // part of the cover itself that is in place (its param space)
  _visible(c, t) {
    if (c.motion === "track") { const lo = t * c.travel / c.track; return [lo, lo + c.length / c.track, 2, 2]; }
    return this._covered(c, t);
  }

  _redraw() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this._draw(); });
  }

  _draw() {
    if (!this._gl || this._left > 0) return;
    const gl = this._gl, M = this._M, U = (n) => gl.getUniformLocation(this._prog, n);
    gl.viewport(0, 0, M.W, M.H);
    gl.uniform1i(U("T"), 0);
    gl.uniform1fv(U("uGain"), M.lights.map((l) => this._gain(l)));
    const cov = [], vis = [], tt = [];
    M.covers.forEach((c) => { const t = this._val["open:" + c.id] ?? 0; cov.push(...this._covered(c, t)); vis.push(...this._visible(c, t)); tt.push(c.T); });
    if (M.covers.length) {
      gl.uniform4fv(U("uCov"), cov); gl.uniform4fv(U("uVis"), vis); gl.uniform1fv(U("uT"), tt);
      gl.uniform2fv(U("uOff"), [].concat(...M.covers.map((c) => c.offset || [0, 0])));     // outline shift per cover
    }
    const dg = M.default_gain || { day: 1, night: 1 };                  // default (world light) layer: day / night
    gl.uniform1f(U("uDef"), this._sun && this._sun.night ? dg.night : dg.day);
    const bx = [].concat(...M.boxes); if (bx.length) gl.uniform4fv(U("uBox"), bx);
    gl.uniform1i(U("uHover"), this._hover);
    this._wrap.querySelectorAll(".areas polygon").forEach((p) => p.classList.toggle("hover", +p.dataset.h === this._hover));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ------------------------------------------------------------------ hover / click
  _pick(e) {
    const M = this._M, r = this._cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * M.W), y = Math.floor((e.clientY - r.top) / r.height * M.H);
    if (!this._cpu || x < 0 || y < 0 || x >= M.W || y >= M.H) return -1;
    const i = y * M.W + x;
    const inr = (e8, iv) => { if (e8 < 8) return false; const u = (e8 / 255 - 0.05) / 0.9; return (u >= iv[0] && u <= iv[1]) || (u >= iv[2] && u <= iv[3]); };
    // lamps first (they are in front where their touch area meets a cover): inside their touch area
    // (nearest centre wins where areas overlap), else within 6 px of the lamp
    let best = -1, bestD = Infinity;
    for (let f = 0; f < M.fixtures.length; f++) {
      const fx = M.fixtures[f], fa = this._cpu[fx.layer];
      if (!this._conf(this._item(M.covers.length + f).it?.entity)) continue;
      if (fx.area) {
        if (!inPoly(x, y, fx.area)) continue;
        const cx = fx.area.reduce((s, p) => s + p[0], 0) / fx.area.length, cy = fx.area.reduce((s, p) => s + p[1], 0) / fx.area.length;
        const dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (dd < bestD) { bestD = dd; best = M.covers.length + f; }
        continue;
      }
      if (!fa) continue;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < M.W && yy < M.H && fa[yy * M.W + xx] > 100) return M.covers.length + f;
      }
    }
    if (best >= 0) return best;
    for (let n = 0; n < M.covers.length; n++) {
      // by its closed silhouette (the blue outline, shifted by its offset), open or not and also behind a wall
      const c = M.covers[n], [ox, oy] = c.offset || [0, 0];
      const sx = x - ox, sy = y - oy, j = sy * M.W + sx;
      if (!this._conf(c.entity) || sx < 0 || sy < 0 || sx >= M.W || sy >= M.H) continue;
      if (c.outline != null) { const o = this._cpu[c.outline]; if (o && o[j] > 100) return n; continue; }
      const p = this._cpu[c.param];
      if (p && p[j] >= 8) return n;
    }
    return -1;
  }

  _onMove(e) {
    const h = this._pick(e);
    if (h !== this._hover) { this._hover = h; this._cv.style.cursor = h >= 0 ? "pointer" : "default"; this._redraw(); }
  }

  // tap / hold, as on the floorplan dashboard
  _item(h) {
    const M = this._M;
    if (h < M.covers.length) return { kind: "cover", it: M.covers[h] };
    return { kind: "light", it: M.lights.find((x) => x.id === M.fixtures[h - M.covers.length].id) };
  }

  _onDown(e) {
    const h = this._pick(e);
    this._cancelPress();
    if (h < 0) return;
    this._press = { h, x: e.clientX, y: e.clientY, held: false };
    this._press.timer = setTimeout(() => { this._press.held = true; this._run(h, "hold"); }, HOLD_MS);
  }

  _onUp(e) {
    const p = this._press;
    this._cancelPress();
    if (!p || p.held || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
    this._run(p.h, "tap");
  }

  _cancelPress() {
    if (this._press) clearTimeout(this._press.timer);
    this._press = null;
  }

  _run(h, which) {
    const { kind, it } = this._item(h);
    if (!it) return;
    if (!this._state(it.entity)) {                      // not in Home Assistant: the tap only moves the picture
      if (which !== "tap") return;
      const key = (kind === "cover" ? "open:" : "light:") + it.id;
      this._val[key] = (this._val[key] ?? 0) > 0.5 ? 0 : 1;
      const inp = this._panel.querySelector(`input[data-k="${key}"]`);
      if (inp) inp.value = this._val[key] * 100;
      this._redraw();
      this._renderList(true);
      return;
    }
    const conf = this._conf(it.entity) || {};
    const act = conf[which + "_action"]
      || (which === "tap" ? { action: kind === "light" ? "toggle" : "more-info" } : { action: "more-info" });
    if (navigator.vibrate && act.action !== "none") navigator.vibrate(which === "hold" ? 50 : 10);
    this._action(act, it.entity);
  }

  _action(act, entity) {
    const fire = (type, detail) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    switch (act.action) {
      case "toggle":
        this._hass.callService("homeassistant", "toggle", { entity_id: entity });
        break;
      case "more-info":
        fire("hass-more-info", { entityId: act.entity || entity });
        break;
      case "perform-action":
      case "call-service": {
        const [domain, service] = (act.perform_action || act.service).split(".");
        this._hass.callService(domain, service, act.data || act.service_data || {}, act.target);
        break;
      }
      case "navigate":
        history.pushState(null, "", act.navigation_path);
        fire("location-changed", { replace: false });
        break;
      case "url":
        window.open(act.url_path, "_blank");
        break;
    }
  }
}

customElements.define("gungors-floor-card", GungorsFloorCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "gungors-floor-card", name: "Gungor floor view", description: "Live-lit 3D view of a floor (Blender renders + WebGL2)" });
