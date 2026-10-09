/*
 * gungors-floor-card — Home Assistant Lovelace card showing the floors of the Blender house model
 * (repository ha-floorplan: the page src/web/index.html and the render of each floor output/<floor>/,
 * deployed to /config/www/gungors_floor/ by deploy.ps1; the card opens index.html?floor=<floor>).
 *
 * The floor page draws; this card only connects it to Home Assistant. The page runs in an iframe and
 * has typed entities (light: RGBA, cover: 0-100, climate: "mode action current target") plus a time
 * and a sun input. The card feeds them from Home Assistant (time: the clock in Home Assistant's time zone, sun: sun.sun) and turns the page's
 * taps/holds into the actions set here in YAML. Nothing happens by default: an entity without
 * tap_action / hold_action does nothing on tap / hold.
 *
 * Floors: one card shows every floor in `floors`, the first one first; the floor button of the dock
 * goes on to the next floor on each press (after the last, back to the first). Each floor has its own
 * page entities. A single floor can still be given as `floor` + `entities`. The page holds every floor
 * of the list (index.html?floors=kat0,kat1): it loads them all once, a floor switch is a message to it
 * ({gf: "floor", floor}), not a new page.
 *
 * Loading: the page stays behind "loading..." until its images are in and the card's first inputs
 * have arrived (the card sends {gf: "fed"} after its first full feed); the dock appears when the page
 * reports {gf: "shown"}. No tap highlight anywhere in the card (mobile would flash it on every tap).
 *
 * Wall cut: the cut button of the dock goes on to the next cut the floor has (none -> front -> all; the
 * page's "ready" lists them) and sends it to the page ({gf: "cut", mode}); the page shows that cut's
 * render of every floor (the plain one where a floor has none). The choice is kept in this browser
 * (localStorage); YAML `cut` is the first one. The lighting is the same in every cut.
 *
 *   type: custom:gungors-floor-card
 *   base: /local/gungors_floor/       # optional
 *   sun: sun.sun                      # required
 *   dock_radius: 370                  # optional: size (page px) of the control dock in the bottom-left corner
 *   cut: front                        # optional: wall cut shown first: none, front (default: the outer walls
 *                                     #   facing the camera cut down) or all (every wall cut down)
 *   lighting:                         # optional: brightness of the house's world light (the page's
 *     default: 1                      #   settings.json values where left out): default = everywhere, also
 *                                     #   at night; a floor's rooms add to it while the sun is up
 *   colors:                           # optional: border colours per page entity type ("other": every type
 *     other: "#2ecc5a"                #   without its own); the page's defaults: cover blue, light yellow,
 *                                     #   climate red, other green
 *   floors:
 *     - floor: kat0                   # floor of the page (its render folder under base)
 *       rooms:                        # optional: per room (a zone of the floor's render) while the sun is
 *         salon:                      #   up: default + sun + covers x how far its covers are open (their
 *           sun: 1                    #   mean); a room left out: sun 1, covers 2;
 *           covers: 2                 #   "other": what is in no room (rooms without covers, the outside),
 *         koridor0: {sun: 0.7, covers: 1.4}   #   default + its sun (3 if left out)
 *         other: {sun: 3}
 *       entities:                     # page entity -> Home Assistant entity (same domain as its type)
 *         salon_light:
 *           entity: light.salon_light
 *           name: Salon               # optional: label in the dock
 *           slider: true              # optional: a slider in the dock list
 *           gain: 2                   # optional (lights): brightness at full intensity, times the render's
 *           color: "#ff9800"          # optional: border colour of this entity on the page
 *           tap_action:
 *             action: toggle
 *           hold_action:
 *             action: more-info
 *         mutfak_blind: none          # background: no hover, no tap, the page's default (covers open)
 *         salon_blind:                # background that follows Home Assistant (e.g. a manual blind):
 *           entity: cover.salon_cover #   no hover, no border, no tap, like none, but the page shows the
 *           selectable: false         #   entity's state (a cover's position, a light's colour)
 *         garaj_door:                 # background with a fixed value instead of the page's default:
 *           entity: none              #   cover: position 0-100 (0 closed, 100 open)
 *           value: 0                  #   light: [r, g, b, intensity 0-1], e.g. [255, 255, 255, 0] = off
 *         dolap_kapi:                 # page-only cover (no Home Assistant entity): a slider in the dock,
 *           entity: none              #   a tap opens/closes it; its position is kept in this browser
 *           slider: true              #   (value: the first position, 0 closed by default)
 *           name: Dolap
 *     - floor: kat1
 *       entities: ...
 *
 * Page entities left out of `entities` keep the page's defaults and are listed on the page (top right):
 * put them here or set them to none. Errors (unknown page entity, wrong domain, missing Home Assistant
 * entity) stop the card. A Home Assistant entity that is unavailable or unknown is reported to the page,
 * which draws its borders grey. A climate gets its hvac mode, hvac_action, current_temperature and
 * temperature (target), "-" where missing; the page paints the radiator by its state and writes the
 * temperatures. Page entities of other types map to that domain; they take no input, the page only
 * shows their border and reports taps.
 */
const CARD_VERSION = "1.17.0";
const TYPES = { light: "light", cover: "cover" };     // page entity type -> Home Assistant domain (else the type itself)
const domainOf = (type) => TYPES[type] || type;
const INPUTS = { light: 1, cover: 1, climate: 1 };     // page entity types that take a value
const isColor = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

// dock buttons: display modes of the screen, and the floor button (goes to the next floor)
const DOCK_MODES = [
  { id: "lights", icon: "mdi:lightbulb-group", title: "lights" },
  { id: "covers", icon: "mdi:curtains", title: "covers" },
  { id: "sun", icon: "mdi:weather-sunny", title: "sun" },
  { id: "floor", title: "next floor" },
  { id: "cut", title: "wall cut" },
];
// wall cut (the page's renders): icon and title of each
const CUTS = ["none", "front", "all"];
const CUT_ICON = { none: "mdi:wall", front: "mdi:box-cutter", all: "mdi:floor-plan" };
const CUT_TITLE = { none: "walls: no cut", front: "walls: front cut", all: "walls: all cut" };
const CUT_KEY = "gungors-floor-card.cut";
const savedCut = () => { try { return localStorage.getItem(CUT_KEY); } catch (e) { return null; } };
// position of a page-only cover (entity none + slider), kept per browser
const LOCAL_KEY = "gungors-floor-card.local.";
const savedLocal = (k) => { try { const v = localStorage.getItem(LOCAL_KEY + k); return v == null ? null : +v; } catch (e) { return null; } };
// icon of the floor button: the number in the floor's id (kat1 -> mdi:home-floor-1)
const floorIcon = (id) => { const m = /(\d+)/.exec(id); return m && +m[1] <= 3 ? "mdi:home-floor-" + m[1] : "mdi:layers"; };

const CSS = `
  ha-card{overflow:hidden;background:#3a3a3a;-webkit-tap-highlight-color:transparent;
          display:flex;align-items:center;justify-content:center}
  .wrap{position:relative;flex:none;width:100%;aspect-ratio:16 / 9}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
  .err{padding:12px 16px;color:#ff8a80;font:14px sans-serif;white-space:pre-wrap}
  .dock{position:absolute;left:0;transform-origin:0 0;font:15px "Segoe UI",Roboto,Arial,sans-serif;color:#e8f4ff;
        user-select:none;-webkit-user-select:none;pointer-events:none;visibility:hidden}
  .dock.shown{visibility:visible}
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
  .btn.single{opacity:.5;cursor:default}
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
`;

const HOLD_MS = 500;
const pad = (n) => String(n).padStart(2, "0");
// "HH:MM" of a moment in Home Assistant's time zone (hass.config.time_zone), not the browser's
const hhmm = (d, tz) => {
  d = d instanceof Date ? d : new Date(d);
  if (isNaN(d)) return null;
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d); }
  catch (e) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
};

class GungorsFloorCard extends HTMLElement {
  // ------------------------------------------------------------------ config (checked before the page loads)
  setConfig(config) {
    const err = (m) => { throw new Error("gungors-floor-card: " + m); };
    if (typeof config.sun !== "string" || !config.sun.startsWith("sun.")) err("'sun' is required: a sun entity (sun.sun)");
    const list = config.floors != null ? config.floors : [{ floor: config.floor, entities: config.entities }];
    if (!Array.isArray(list) || !list.length) err("'floors' must be a list of {floor, entities}");
    const floors = list.map((f, n) => {
      if (!f || typeof f !== "object" || !f.floor) err(`floors[${n}]: 'floor' is required (e.g. kat0)`);
      const ents = f.entities == null ? {} : f.entities;
      if (typeof ents !== "object" || Array.isArray(ents)) err(`${f.floor}: 'entities' must be a map: page entity -> settings (or none)`);
      const map = new Map(), fixed = new Map(), local = new Map();
      for (const [id, e] of Object.entries(ents)) {
        if (e === "none") { map.set(id, null); continue; }
        if (e && typeof e === "object" && e.entity === "none" && e.slider === true) {   // page-only, driven from the dock
          if (e.color != null && !isColor(e.color)) err(`${f.floor}.${id}: color must be "#rrggbb"`);
          local.set(id, e);
          continue;
        }
        if (e && typeof e === "object" && e.entity === "none") {
          if (e.value != null) fixed.set(id, e.value);
          map.set(id, null);
          continue;
        }
        if (!e || typeof e !== "object" || typeof e.entity !== "string" || !e.entity.includes("."))
          err(`${f.floor}.${id}: give 'entity' (a Home Assistant entity id, or none with an optional value)`);
        if (e.color != null && !isColor(e.color)) err(`${f.floor}.${id}: color must be "#rrggbb"`);
        if (e.selectable != null && typeof e.selectable !== "boolean") err(`${f.floor}.${id}: selectable must be true or false`);
        map.set(id, e);
      }
      const rooms = f.rooms == null ? null : f.rooms;
      if (rooms != null) {
        if (typeof rooms !== "object" || Array.isArray(rooms)) err(`${f.floor}: 'rooms' must be a map: room -> {sun, covers}`);
        for (const [r, v] of Object.entries(rooms)) {
          if (!v || typeof v !== "object") err(`${f.floor}.rooms.${r}: give {sun, covers} (numbers)`);
          for (const [k, x] of Object.entries(v))
            if (!["sun", "covers"].includes(k) || typeof x !== "number") err(`${f.floor}.rooms.${r}.${k}: sun and covers are numbers`);
        }
      }
      for (const [id, e] of map) if (e && e.gain != null && typeof e.gain !== "number") err(`${f.floor}.${id}: gain must be a number`);
      return { floor: String(f.floor), map, fixed, local, rooms };
    });
    const colors = config.colors == null ? {} : config.colors;
    if (typeof colors !== "object" || Array.isArray(colors)) err("'colors' must be a map: page entity type (or other) -> \"#rrggbb\"");
    for (const [t, c] of Object.entries(colors)) if (!isColor(c)) err(`colors.${t} must be "#rrggbb"`);
    const lighting = config.lighting == null ? {} : config.lighting;
    if (typeof lighting !== "object" || (lighting.default != null && typeof lighting.default !== "number"))
      err("'lighting' must be {default: a number}");
    if (config.cut != null && !CUTS.includes(config.cut)) err("'cut' must be none, front or all");
    this._config = { base: "/local/gungors_floor/", dock_radius: 370, cut: "front", ...config };
    if (!this._cut) this._cut = CUTS.includes(savedCut()) ? savedCut() : this._config.cut;
    if (!this._config.base.endsWith("/")) this._config.base += "/";
    this._floors = floors;
    this._fi = Math.min(this._fi || 0, floors.length - 1);
    this._useFloor();
    if (this._frame) this._load();
  }

  // the floor shown now: its page id, page entity -> settings (null for none), fixed values of none entities
  _useFloor() {
    const f = this._floors[this._fi];
    this._floor = f.floor;
    this._map = f.map;
    this._fixed = f.fixed;
    this._local = f.local;
    this._rooms = f.rooms;
  }

  // next wall cut of the floor's renders (the page's "ready" cuts); kept in this browser
  _nextCut() {
    if (!this._page) return;
    const cuts = this._page.cuts, i = cuts.indexOf(this._cut);
    if (cuts.length < 2) return;
    this._cut = cuts[(i + 1) % cuts.length];
    try { localStorage.setItem(CUT_KEY, this._cut); } catch (e) { /* private mode: this session only */ }
    this._post({ gf: "cut", mode: this._cut });
    this._buildDock();                        // the button's icon (the page answers "ready" if the picture changes)
  }

  _nextFloor() {
    if (this._floors.length < 2 || !this._page) return;
    this._fi = (this._fi + 1) % this._floors.length;
    this._useFloor();
    this._drag = null;
    this._listSig = null;
    this._page = null;                        // until the page's "ready" for the new floor
    this._sent = {};
    this._fed = false;
    this._post({ gf: "floor", floor: this._floor });
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
    if (this._root && !this._clockTimer) this._clockTimer = setInterval(() => this._feed(), 15000);
  }

  _tz() { return (this._hass && this._hass.config && this._hass.config.time_zone) || undefined; }

  disconnectedCallback() { clearInterval(this._clockTimer); this._clockTimer = null; }

  // The card takes the screen below its top (a panel view: below the header); the picture keeps its
  // aspect ratio, grows until it meets the first edge of that area and stays centred in it (landscape
  // phone: full height, space left and right; portrait: full width, space above and below).
  _fit() {
    if (!this._card) return;
    const top = this.getBoundingClientRect().top + window.scrollY;
    const H = Math.max(200, Math.floor(window.innerHeight - Math.max(0, top)));
    const W = this.clientWidth || this._card.clientWidth;
    if (!W) return;
    const w = Math.min(W, H * this._ratio);
    this._card.style.height = H + "px";
    this._wrap.style.width = w + "px";
    this._fitDock();
  }

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
    this._card = this._root.querySelector("ha-card");
    this._ratio = 16 / 9;
    this._onResize = () => this._fit();
    window.addEventListener("resize", this._onResize);
    new ResizeObserver(() => this._fit()).observe(this);
    new ResizeObserver(() => this._fitDock()).observe(this._wrap);
    requestAnimationFrame(() => this._fit());
    this._load();
  }

  _load() {
    this._page = null;
    this._sent = {};
    this._fed = false;                        // first full feed not sent yet
    this._dock.classList.remove("shown");     // the dock waits for the page's "shown"
    const floors = this._floors.map((f) => encodeURIComponent(f.floor)).join(",");
    this._frame.src = this._config.base + "index.html?floors=" + floors + "&floor=" + encodeURIComponent(this._floor) +
      "&cut=" + encodeURIComponent(this._cut) + "&t=" + Date.now();
  }

  _post(msg) { if (this._frame && this._frame.contentWindow) this._frame.contentWindow.postMessage(msg, "*"); }

  _message(d) {
    if (!d || typeof d.gf !== "string") return;
    if (d.gf === "ready") {
      if (d.floor != null && d.floor !== this._floor) {
        // another floor: a page still loading from the floor before, or the page reopened on the floor of
        // its URL (the browser reloads the iframe when the view comes back): ask it for this card's floor
        this._post({ gf: "floor", floor: this._floor });
        return;
      }
      this._page = { W: d.W, H: d.H, entities: new Map(d.entities.map((e) => [e.id, e.type])),
                     cuts: Array.isArray(d.cuts) ? d.cuts : ["none"] };
      if (d.cut == null && this._cut !== "none") this._post({ gf: "cut", mode: this._cut });   // an older page
      this._sent = {};
      this._fed = false;
      this._wrap.style.aspectRatio = d.W + " / " + d.H;
      this._ratio = d.W / d.H;
      this._fit();
      this._buildDock();
      this._feed();
    } else if (d.gf === "shown") {
      this._dock.classList.add("shown");
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
    if (!hass.states[this._config.sun]) out.push(`sun: ${this._config.sun} is not in Home Assistant`);
    for (const [id, e] of this._map) {
      const type = page.entities.get(id);
      if (!type) { out.push(`${id}: not an entity of the ${this._floor} page`); continue; }
      if (!e) {
        if (!this._fixed.has(id)) continue;
        const v = this._fixed.get(id);
        if (type === "cover" && !(Number.isInteger(v) && v >= 0 && v <= 100))
          out.push(`${id}: value of a cover is a position 0-100 (0 closed, 100 open), not ${JSON.stringify(v)}`);
        else if (type === "light" && !(Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)
                                       && v.slice(0, 3).every((x) => x >= 0 && x <= 255) && v[3] >= 0 && v[3] <= 1))
          out.push(`${id}: value of a light is [r, g, b, intensity 0-1], not ${JSON.stringify(v)}`);
        else if (type === "climate" && !(typeof v === "string" && v.trim().split(/\s+/).length === 4))
          out.push(`${id}: value of a climate is "mode action current target" ("-" where unknown), not ${JSON.stringify(v)}`);
        else if (!INPUTS[type]) out.push(`${id}: a ${type} entity takes no value`);
        continue;
      }
      const domain = e.entity.split(".")[0];
      if (domainOf(type) !== domain) out.push(`${id}: a ${type} entity, ${e.entity} is a ${domain}`);
      else if (!hass.states[e.entity]) out.push(`${id}: ${e.entity} is not in Home Assistant (set it to none)`);
    }
    for (const [id, e] of this._local) {
      const type = page.entities.get(id);
      if (!type) out.push(`${id}: not an entity of the ${this._floor} page`);
      else if (type !== "cover") out.push(`${id}: only a cover can be page-only (entity none with slider), not a ${type}`);
      else if (e.value != null && !(Number.isInteger(e.value) && e.value >= 0 && e.value <= 100))
        out.push(`${id}: value of a cover is a position 0-100 (0 closed, 100 open), not ${JSON.stringify(e.value)}`);
    }
    return out.length ? out : null;
  }

  _showErrors(list) {
    this._errBox.hidden = !list;
    this._wrap.hidden = !!list;
    if (list) this._errBox.textContent = "gungors-floor-card (" + this._floor + "):\n" + list.join("\n");
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
    const tz = this._tz();
    send("time", { gf: "set", id: "time", value: hhmm(new Date(), tz) });      // Home Assistant's local time
    const sa = this._hass.states[this._config.sun].attributes;
    const rise = sa.next_rising && hhmm(sa.next_rising, tz), set = sa.next_setting && hhmm(sa.next_setting, tz);
    if (rise && set) send("sun", { gf: "set", id: "sun", value: rise + " " + set });
    for (const [t, c] of Object.entries(this._config.colors || {})) send("color:" + t, { gf: "color", type: t, value: c });
    // lighting from this YAML over the page's settings.json: default, the floor's rooms, light gains
    const light = {}, def = (this._config.lighting || {}).default, gain = {};
    if (def != null) light.default = def;
    if (this._rooms) light.rooms = this._rooms;
    for (const [id, e] of this._map) if (e && e.gain != null) gain[id] = e.gain;
    if (Object.keys(gain).length) light.gain = gain;
    if (Object.keys(light).length) send("settings", { gf: "settings", value: light });
    for (const [id, e] of this._map) {
      if (!e) {                                       // none: its fixed value (if any), then background
        if (this._fixed.has(id)) send("value:" + id, { gf: "set", id, value: this._fixed.get(id) });
        send(id, { gf: "static", id });
        continue;
      }
      if (e.selectable === false) send("static:" + id, { gf: "static", id });   // background, but fed from Home Assistant
      else {
        if (e.color) send("color:" + id, { gf: "color", id, value: e.color });
        const state = this._hass.states[e.entity].state;
        send("available:" + id, { gf: "available", id, value: state !== "unavailable" && state !== "unknown" });
      }
      if (this._drag === id || !INPUTS[this._page.entities.get(id)]) continue;   // dragged slider drives the picture; other types take no input
      const v = this._value(id, e);
      if (v != null) send(id, { gf: "set", id, value: v });
    }
    for (const [id, e] of this._local) {                // page-only covers: their position from this browser
      if (e.color) send("color:" + id, { gf: "color", id, value: e.color });
      send("available:" + id, { gf: "available", id, value: true });
      if (this._drag !== id) send(id, { gf: "set", id, value: this._localValue(id) });
    }
    if (!this._fed) { this._fed = true; this._post({ gf: "fed" }); }   // first inputs are in: the page may show itself
    this._clock();
  }

  // page-only cover: last position set in this browser, else its YAML value, else closed
  _localValue(id) {
    const k = this._floor + "." + id, mem = (this._lv || {})[k], v = mem != null ? mem : savedLocal(k);
    if (v != null && Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
    const e = this._local.get(id);
    return e.value != null ? e.value : 0;
  }

  _setLocal(id, pct) {
    const k = this._floor + "." + id;
    (this._lv = this._lv || {})[k] = pct;             // this session; the browser keeps it too where it can
    try { localStorage.setItem(LOCAL_KEY + k, String(pct)); } catch (e) { /* private mode: this session only */ }
    this._feed();
    this._renderList(true);
  }

  _value(id, e) {
    const st = this._hass.states[e.entity], type = this._page.entities.get(id);
    if (type === "light") {
      const rgb = (st.attributes.rgb_color || [255, 255, 255]).slice(0, 3);
      if (st.state !== "on") return rgb.concat(0);
      const b = st.attributes.brightness;
      return rgb.concat(b != null ? Math.round(b / 2.55) / 100 : 1);
    }
    if (type === "climate") {
      const a = st.attributes, n = (x) => (x == null || !Number.isFinite(Number(x)) ? "-" : Number(x));
      return [st.state || "-", a.hvac_action || "-", n(a.current_temperature), n(a.temperature)].join(" ");
    }
    const pos = st.attributes.current_position;
    return pos != null ? pos : st.state === "closed" ? 0 : 100;
  }

  // ------------------------------------------------------------------ tap / hold -> the actions in YAML
  _run(id, which) {
    if (this._local.has(id)) {                        // page-only cover: a tap opens or closes it
      if (which === "tap") this._setLocal(id, this._localValue(id) > 0 ? 0 : 100);
      return;
    }
    const e = this._map.get(id);
    if (!e || e.selectable === false) return;         // not mapped (the page toggles it itself), none or not selectable
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
    if (this._local.has(id)) { this._drag = null; this._setLocal(id, pct); return; }
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
    if (!DOCK_MODES.some((m) => m.id === this._mode && m.icon)) this._mode = "lights";
    const rb = R - 46, angles = [8, 27, 47, 65, 82];
    const btns = DOCK_MODES.map((m, i) => {
      const a = angles[i] * Math.PI / 180, isFloor = m.id === "floor", isCut = m.id === "cut";
      const single = isFloor ? this._floors.length < 2 : isCut && this._page.cuts.length < 2;
      const icon = isFloor ? floorIcon(this._floor) : isCut ? CUT_ICON[this._cut] : m.icon;
      const title = isFloor ? this._floor + (single ? "" : " (next floor)") : isCut ? CUT_TITLE[this._cut] : m.title;
      return `<button class="btn${single ? " single" : ""}" data-mode="${m.id}" title="${title}"
                style="left:${rb * Math.cos(a) - 35}px;top:${R - rb * Math.sin(a) - 35}px"><ha-icon icon="${icon}"></ha-icon></button>`;
    }).join("");
    d.style.width = d.style.height = R + "px";
    d.style.top = ((H - R) / H * 100) + "%";
    d.innerHTML = `<div class="disc"></div><div class="gloss"></div>${btns}
      <div class="screen"><div class="top"><span class="clock"></span><span class="date"></span></div>
        <div class="title"></div><div class="list"></div></div>`;
    d.querySelectorAll(".btn").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.mode === "floor") { this._nextFloor(); return; }
      if (b.dataset.mode === "cut") { this._nextCut(); return; }
      this._mode = b.dataset.mode;
      this._renderList(true);
    }));
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => this._feed(), 15000);          // the clock moves on without state changes
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
    const tz = this._tz(), now = new Date();
    c.textContent = hhmm(now, tz);
    let date;
    try { date = now.toLocaleDateString("tr-TR", { timeZone: tz, day: "numeric", month: "short", weekday: "short" }); }
    catch (e) { date = now.toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" }); }
    d.querySelector(".date").textContent = date;
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
        if (!e || e.selectable === false || this._page.entities.get(id) !== type || !hass.states[e.entity]) continue;
        const st = hass.states[e.entity], v = this._value(id, e);
        const pct = type === "light" ? Math.round(v[3] * 100) : v, on = pct > 0;
        const icon = type === "light" ? (on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline") : (on ? "mdi:curtains" : "mdi:curtains-closed");
        const value = type === "light" ? (st.state !== "on" ? "off" : st.attributes.brightness != null ? pct + "%" : "on") : pct + "%";
        rows.push({ id, icon, on, label: e.name || id, value, pct, slider: !!e.slider });
      }
      if (type === "cover")
        for (const [id, e] of this._local) {
          if (this._page.entities.get(id) !== "cover") continue;
          const pct = this._localValue(id), on = pct > 0;
          rows.push({ id, icon: on ? "mdi:door-sliding-open" : "mdi:door-sliding", on, label: e.name || id, value: pct + "%", pct, slider: true });
        }
    } else {
      const s = hass.states[this._config.sun], a = s ? s.attributes : {};
      const t = (v) => (v && hhmm(v, this._tz())) || "-";
      rows = [{ icon: s && s.state === "above_horizon" ? "mdi:weather-sunny" : "mdi:weather-night", on: s && s.state === "above_horizon",
                label: "sun", value: s ? (s.state === "above_horizon" ? "up" : "down") : "-" },
              { icon: "mdi:angle-acute", label: "elevation", value: a.elevation != null ? Math.round(a.elevation) + "°" : "-" },
              { icon: "mdi:weather-sunset-down", label: "sunset", value: t(a.next_setting) },
              { icon: "mdi:weather-sunset-up", label: "sunrise", value: t(a.next_rising) },
              { icon: this._phase === "gece" ? "mdi:post-lamp" : "mdi:sun-clock", on: true, label: "picture", value: this._phase || "-" }];
    }
    const sig = this._floor + mode + JSON.stringify(rows.map((r) => [r.label, r.value, r.on]));
    if (!force && sig === this._listSig) return;
    this._listSig = sig;
    d.querySelectorAll(".btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    d.querySelector(".title").textContent = this._floor + " · " + DOCK_MODES.find((m) => m.id === mode).title;
    list.innerHTML = rows.map((r, i) => `<div class="row${r.on ? " on" : ""}${r.id ? " act" : ""}" data-i="${i}" title="${r.id || ""}">
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
window.customCards.push({ type: "gungors-floor-card", name: "Gungor floor view", description: "Live-lit 3D view of the floors (Blender renders, ha-floorplan page)" });
