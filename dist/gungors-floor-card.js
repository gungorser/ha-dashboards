/*
 * gungors-floor-card — Home Assistant Lovelace card showing one floor of the Blender house model
 * (repository ha-floorplan: the page src/web/index.html and the render of each floor output/<floor>/,
 * deployed to /config/www/gungors_floor/ by deploy.ps1; the card opens index.html?floor=<floor>).
 *
 * The floor page draws; this card only connects it to Home Assistant. The page runs in an iframe and
 * has typed entities (light: RGBA, cover: 0-100) plus a time and a sun input. The card feeds them from
 * Home Assistant states and turns the page's taps/holds into the actions set here in YAML. Nothing
 * happens by default: an entity without tap_action / hold_action does nothing on tap / hold.
 *
 *   type: custom:gungors-floor-card
 *   floor: kat0                       # floor of the page (its render folder under base)
 *   base: /local/gungors_floor/       # optional
 *   time: sensor.time                 # required
 *   sun: sun.sun                      # required
 *   dock_radius: 370                  # optional: size (page px) of the control dock in the bottom-left corner
 *   entities:                         # page entity -> Home Assistant entity (same domain as its type)
 *     salon_light:
 *       entity: light.salon_light
 *       name: Salon                   # optional: label in the dock
 *       slider: true                  # optional: a slider in the dock list
 *       tap_action:
 *         action: toggle
 *       hold_action:
 *         action: more-info
 *     garaj_door: none                # background: the page shows it as it is, no hover, no tap
 *
 * Page entities left out of `entities` keep the page's defaults and are listed on the page (top right):
 * put them here or set them to none. Errors (unknown page entity, wrong domain, missing Home Assistant
 * entity) stop the card.
 */
const CARD_VERSION = "1.10.2";
const TYPES = { light: "light", cover: "cover" };     // page entity type -> Home Assistant domain

const DOCK_MODES = [
  { id: "lights", icon: "mdi:lightbulb-group", title: "lights" },
  { id: "covers", icon: "mdi:curtains", title: "covers" },
  { id: "sun", icon: "mdi:weather-sunny", title: "sun" },
  { id: "floors", icon: "mdi:home-floor-0", title: "floors" },
];

const CSS = `
  ha-card{overflow:hidden;background:#3a3a3a}
  .wrap{position:relative;width:100%;aspect-ratio:16 / 9}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
  .err{padding:12px 16px;color:#ff8a80;font:14px sans-serif;white-space:pre-wrap}
  .dock{position:absolute;left:0;transform-origin:0 0;font:15px "Segoe UI",Roboto,Arial,sans-serif;color:#e8f4ff;
        user-select:none;-webkit-user-select:none;pointer-events:none}
  .disc,.gloss{position:absolute;left:0;bottom:0;box-sizing:border-box}
  .disc{width:100%;height:100%;border-top-right-radius:100%;pointer-events:auto;
        background:radial-gradient(circle at 0% 100%,#071d45 0 52%,#0d3b85 64%,#1d6fd6 80%,#3b95f0 89%,#0b3a86 100%);
        border-top:4px solid #a8dcff;border-right:4px solid #a8dcff;
        box-shadow:0 0 22px rgba(90,180,255,.55),inset 0 0 30px rgba(0,20,60,.6)}
  .gloss{width:70%;height:70%;border-top-right-radius:100%;border-top:2px solid rgba(160,215,255,.35);
         border-right:2px solid rgba(160,215,255,.35)}
  .btn{position:absolute;width:70px;height:70px;border-radius:50%;padding:0;cursor:pointer;outline:none;pointer-events:auto;
       border:3px solid #e6f5ff;color:#fff;display:flex;align-items:center;justify-content:center;
       background:radial-gradient(circle at 35% 28%,#e4f4ff 0 7%,#63b4ff 20%,#1a67d1 58%,#0a2f70 100%);
       box-shadow:0 4px 10px rgba(0,0,0,.55),0 0 12px rgba(120,200,255,.55);transition:transform .15s,box-shadow .15s}
  .btn ha-icon{--mdc-icon-size:34px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
  .btn:hover{transform:scale(1.08)}
  .btn.active{border-color:#ffd66b;box-shadow:0 4px 10px rgba(0,0,0,.55),0 0 20px rgba(255,214,107,.85)}
  .screen{position:absolute;left:14px;bottom:14px;width:206px;height:182px;box-sizing:border-box;padding:8px 10px;pointer-events:auto;
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
  .row.dim{opacity:.45}
`;

const HOLD_MS = 500;
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : pad(d.getHours()) + ":" + pad(d.getMinutes()); };

class GungorsFloorCard extends HTMLElement {
  // ------------------------------------------------------------------ config (checked before the page loads)
  setConfig(config) {
    const err = (m) => { throw new Error("gungors-floor-card: " + m); };
    if (!config.floor) err("'floor' is required (e.g. kat0)");
    if (typeof config.time !== "string" || !config.time.startsWith("sensor.")) err("'time' is required: a sensor entity (sensor.time)");
    if (typeof config.sun !== "string" || !config.sun.startsWith("sun.")) err("'sun' is required: a sun entity (sun.sun)");
    const ents = config.entities == null ? {} : config.entities;
    if (typeof ents !== "object" || Array.isArray(ents)) err("'entities' must be a map: page entity -> settings (or none)");
    const map = new Map();
    for (const [id, e] of Object.entries(ents)) {
      if (e === "none") { map.set(id, null); continue; }
      if (!e || typeof e !== "object" || typeof e.entity !== "string" || !e.entity.includes("."))
        err(`${id}: give 'entity' (a Home Assistant entity id) or none`);
      map.set(id, e);
    }
    this._config = { base: "/local/gungors_floor/", dock_radius: 370, ...config };
    if (!this._config.base.endsWith("/")) this._config.base += "/";
    this._map = map;                          // page id -> settings, null for none
    this._page = null;                        // what the page reported: {W, H, entities}
    this._sent = {};                          // last value sent per input (only changes are sent)
    if (this._frame) this._load();
  }

  getCardSize() { return 9; }
  getGridOptions() { return { columns: "full", min_rows: 6 }; }

  set hass(hass) {
    this._hass = hass;
    if (!this._root) this._build();
    this._feed();
    this._renderList(false);
  }

  connectedCallback() {
    if (this._root && !this._clockTimer) this._clockTimer = setInterval(() => this._clock(), 15000);
  }

  disconnectedCallback() { clearInterval(this._clockTimer); this._clockTimer = null; }

  // ------------------------------------------------------------------ page
  _build() {
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${CSS}</style>
      <ha-card><div class="err" hidden></div><div class="wrap"><iframe title="floor"></iframe><div class="dock"></div></div></ha-card>`;
    this._wrap = this._root.querySelector(".wrap");
    this._frame = this._root.querySelector("iframe");
    this._dock = this._root.querySelector(".dock");
    this._errBox = this._root.querySelector(".err");
    this._onMessage = (e) => { if (e.source === this._frame.contentWindow) this._message(e.data); };
    window.addEventListener("message", this._onMessage);
    new ResizeObserver(() => this._fitDock()).observe(this._wrap);
    this._load();
  }

  _load() {
    this._page = null;
    this._sent = {};
    this._frame.src = this._config.base + "index.html?floor=" + encodeURIComponent(this._config.floor) + "&t=" + Date.now();
  }

  _post(msg) { if (this._frame && this._frame.contentWindow) this._frame.contentWindow.postMessage(msg, "*"); }

  _message(d) {
    if (!d || typeof d.gf !== "string") return;
    if (d.gf === "ready") {
      this._page = { W: d.W, H: d.H, entities: new Map(d.entities.map((e) => [e.id, e.type])) };
      this._sent = {};
      this._wrap.style.aspectRatio = d.W + " / " + d.H;
      this._buildDock();
      this._feed();
    } else if (d.gf === "tap" || d.gf === "hold") {
      this._run(d.id, d.gf);
    } else if (d.gf === "phase") {
      this._phase = d.phase;
      this._renderList(false);
    }
  }

  // configuration against the page and Home Assistant; null if all is well
  _errors() {
    const out = [], hass = this._hass, page = this._page;
    for (const k of ["time", "sun"]) if (!hass.states[this._config[k]]) out.push(`${k}: ${this._config[k]} is not in Home Assistant`);
    for (const [id, e] of this._map) {
      const type = page.entities.get(id);
      if (!type) { out.push(`${id}: not an entity of the ${this._config.floor} page`); continue; }
      if (!e) continue;
      const domain = e.entity.split(".")[0];
      if (TYPES[type] !== domain) out.push(`${id}: a ${type} entity, ${e.entity} is a ${domain}`);
      else if (!hass.states[e.entity]) out.push(`${id}: ${e.entity} is not in Home Assistant (set it to none)`);
    }
    return out.length ? out : null;
  }

  _showErrors(list) {
    this._errBox.hidden = !list;
    this._wrap.hidden = !!list;
    if (list) this._errBox.textContent = "gungors-floor-card:\n" + list.join("\n");
  }

  // Home Assistant state -> page inputs (only what changed is sent)
  _feed() {
    if (!this._page || !this._hass) return;
    const errors = this._errors();
    this._showErrors(errors);
    if (errors) return;
    const send = (id, msg) => {
      const key = JSON.stringify(msg);
      if (this._sent[id] === key) return;
      this._sent[id] = key;
      this._post(msg);
    };
    const t = this._hass.states[this._config.time].state;
    if (/^\d{1,2}:\d{2}$/.test(t)) send("time", { gf: "set", id: "time", value: t });
    const sa = this._hass.states[this._config.sun].attributes, rise = hhmm(sa.next_rising), set = hhmm(sa.next_setting);
    if (rise && set) send("sun", { gf: "set", id: "sun", value: rise + " " + set });
    for (const [id, e] of this._map) {
      if (!e) { send(id, { gf: "static", id }); continue; }
      if (this._drag === id) continue;                // the slider being dragged drives the picture
      const v = this._value(id, e);
      if (v != null) send(id, { gf: "set", id, value: v });
    }
    this._clock();
  }

  _value(id, e) {
    const st = this._hass.states[e.entity], type = this._page.entities.get(id);
    if (type === "light") {
      const rgb = (st.attributes.rgb_color || [255, 255, 255]).slice(0, 3);
      if (st.state !== "on") return rgb.concat(0);
      const b = st.attributes.brightness;
      return rgb.concat(b != null ? Math.round(b / 2.55) / 100 : 1);
    }
    const pos = st.attributes.current_position;
    return pos != null ? pos : st.state === "closed" ? 0 : 100;
  }

  // ------------------------------------------------------------------ tap / hold -> the actions in YAML
  _run(id, which) {
    const e = this._map.get(id);
    if (!e) return;                                   // not mapped (the page toggles it itself) or none
    const act = e[which + "_action"];
    if (!act || act.action === "none") return;
    if (navigator.vibrate) navigator.vibrate(which === "hold" ? 50 : 10);
    const fire = (type, detail) => this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    switch (act.action) {
      case "toggle":
        this._hass.callService("homeassistant", "toggle", { entity_id: e.entity });
        break;
      case "more-info":
        fire("hass-more-info", { entityId: act.entity || e.entity });
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
      default:
        console.warn("gungors-floor-card: unknown action " + act.action);
    }
  }

  // slider in the dock -> Home Assistant
  _command(id, pct) {
    const e = this._map.get(id), st = this._hass.states[e.entity];
    if (this._page.entities.get(id) === "cover") {
      if (st.attributes.supported_features & 4) this._hass.callService("cover", "set_cover_position", { entity_id: e.entity, position: pct });
      else this._hass.callService("cover", pct > 50 ? "open_cover" : "close_cover", { entity_id: e.entity });
    } else if (pct <= 0) {
      this._hass.callService("light", "turn_off", { entity_id: e.entity });
    } else {
      const modes = st.attributes.supported_color_modes || [];
      const data = { entity_id: e.entity };
      if (!(modes.length === 1 && modes[0] === "onoff")) data.brightness_pct = pct;
      this._hass.callService("light", "turn_on", data);
    }
  }

  // ------------------------------------------------------------------ dock (quarter-disc control panel, bottom left)
  _buildDock() {
    const R = this._config.dock_radius, d = this._dock, H = this._page.H;
    this._mode = this._mode || "lights";
    const rb = R - 46, angles = [16, 37, 58, 79];
    const btns = DOCK_MODES.map((m, i) => {
      const a = angles[i] * Math.PI / 180;
      return `<button class="btn" data-mode="${m.id}" title="${m.title}"
                style="left:${rb * Math.cos(a) - 35}px;top:${R - rb * Math.sin(a) - 35}px"><ha-icon icon="${m.icon}"></ha-icon></button>`;
    }).join("");
    d.style.width = d.style.height = R + "px";
    d.style.top = ((H - R) / H * 100) + "%";
    d.innerHTML = `<div class="disc"></div><div class="gloss"></div>${btns}
      <div class="screen"><div class="top"><span class="clock"></span><span class="date"></span></div>
        <div class="title"></div><div class="list"></div></div>`;
    d.querySelectorAll(".btn").forEach((b) => b.addEventListener("click", () => { this._mode = b.dataset.mode; this._renderList(true); }));
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => this._clock(), 15000);
    this._clock();
    this._renderList(true);
    this._fitDock();
  }

  _fitDock() {
    if (!this._page) return;
    this._dock.style.transform = `scale(${this._wrap.clientWidth / this._page.W})`;
  }

  _clock() {
    const d = this._dock, c = d.querySelector(".clock");
    if (!c || !this._hass) return;
    const t = this._hass.states[this._config.time];
    c.textContent = t ? t.state : "--:--";
    d.querySelector(".date").textContent = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" });
  }

  // rows of the active mode; rebuilt when the mode or a listed state changes (not while a slider is dragged)
  _renderList(force) {
    const d = this._dock, list = d.querySelector(".list");
    if (!list || !this._hass || !this._page || (!force && this._drag)) return;
    const mode = this._mode, hass = this._hass;
    let rows = [];
    if (mode === "lights" || mode === "covers") {
      const type = mode === "lights" ? "light" : "cover";
      for (const [id, e] of this._map) {
        if (!e || this._page.entities.get(id) !== type || !hass.states[e.entity]) continue;
        const st = hass.states[e.entity], v = this._value(id, e);
        const pct = type === "light" ? Math.round(v[3] * 100) : v, on = pct > 0;
        const icon = type === "light" ? (on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline") : (on ? "mdi:curtains" : "mdi:curtains-closed");
        const value = type === "light" ? (st.state !== "on" ? "off" : st.attributes.brightness != null ? pct + "%" : "on") : pct + "%";
        rows.push({ id, icon, on, label: e.name || id, value, pct, slider: !!e.slider });
      }
    } else if (mode === "sun") {
      const s = hass.states[this._config.sun], a = s ? s.attributes : {};
      const t = (v) => hhmm(v) || "-";
      rows = [{ icon: s && s.state === "above_horizon" ? "mdi:weather-sunny" : "mdi:weather-night", on: s && s.state === "above_horizon",
                label: "sun", value: s ? (s.state === "above_horizon" ? "up" : "down") : "-" },
              { icon: "mdi:angle-acute", label: "elevation", value: a.elevation != null ? Math.round(a.elevation) + "°" : "-" },
              { icon: "mdi:weather-sunset-down", label: "sunset", value: t(a.next_setting) },
              { icon: "mdi:weather-sunset-up", label: "sunrise", value: t(a.next_rising) },
              { icon: this._phase === "gece" ? "mdi:post-lamp" : "mdi:sun-clock", on: true, label: "picture", value: this._phase || "-" }];
    } else {
      const floors = hass.floors ? Object.values(hass.floors).sort((x, y) => (x.level ?? 0) - (y.level ?? 0)) : [];
      rows = (floors.length ? floors : [{ floor_id: this._config.floor, name: this._config.floor }]).map((f) => {
        const cur = f.floor_id === this._config.floor;
        return { icon: f.icon || "mdi:home-floor-" + (f.level ?? 0), on: cur, label: f.name, value: cur ? "●" : "", dim: !cur };
      });
    }
    const sig = mode + JSON.stringify(rows.map((r) => [r.label, r.value, r.on]));
    if (!force && sig === this._listSig) return;
    this._listSig = sig;
    d.querySelectorAll(".btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    d.querySelector(".title").textContent = DOCK_MODES.find((m) => m.id === mode).title;
    list.innerHTML = rows.map((r, i) => `<div class="row${r.on ? " on" : ""}${r.dim ? " dim" : ""}${r.id ? " act" : ""}" data-i="${i}" title="${r.id || ""}">
        <ha-icon icon="${r.icon}"></ha-icon><span class="lbl">${r.label}</span>
        ${r.slider ? `<input type="range" min="0" max="100" value="${r.pct}">` : `<span class="val">${r.value}</span>`}</div>`).join("");
    list.querySelectorAll(".row.act").forEach((el) => {
      const r = rows[+el.dataset.i];
      el.addEventListener("mouseenter", () => this._post({ gf: "highlight", id: r.id }));
      el.addEventListener("mouseleave", () => this._post({ gf: "highlight", id: null }));
      const inp = el.querySelector("input");
      if (inp) {
        inp.addEventListener("input", () => { this._drag = r.id; this._preview(r.id, +inp.value); });
        inp.addEventListener("change", () => { this._command(r.id, +inp.value); this._drag = null; });
        return;
      }
      let timer = null, held = false;
      el.addEventListener("pointerdown", () => { held = false; timer = setTimeout(() => { held = true; this._run(r.id, "hold"); }, HOLD_MS); });
      el.addEventListener("pointerup", () => { clearTimeout(timer); if (!held) this._run(r.id, "tap"); });
      el.addEventListener("pointerleave", () => clearTimeout(timer));
      el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    });
  }

  // the picture follows a slider while it is dragged
  _preview(id, pct) {
    const e = this._map.get(id);
    let value = pct;
    if (this._page.entities.get(id) === "light") value = (this._hass.states[e.entity].attributes.rgb_color || [255, 255, 255]).slice(0, 3).concat(pct / 100);
    this._sent[id] = null;
    this._post({ gf: "set", id, value });
  }
}

customElements.define("gungors-floor-card", GungorsFloorCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "gungors-floor-card", name: "Gungor floor view", description: "Live-lit 3D view of a floor (Blender renders, ha-floorplan page)" });
