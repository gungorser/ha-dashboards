/*
 * gungors-floor-card — Home Assistant Lovelace card showing one floor of the Blender house model
 * with live lighting (WebGL2). Data comes from build_floor_html.py (svg/<floor>_card/, deployed to
 * /config/www/gungors_floor/<floor>/ by deploy.ps1).
 *
 *   type: custom:gungors-floor-card
 *   floor: zemin_kat                  # folder under base
 *   base: /local/gungors_floor/       # optional
 *   light_gain: 1                     # optional: render gain of a light at 100 % brightness
 *
 * State comes from Home Assistant: cover position, light on/off + brightness, sun above/below the
 * horizon. Like the floorplan dashboard, a tap and a hold on a lamp or cover run its Lovelace
 * actions (model.json: tap/hold, from config.json home_assistant), e.g. tap toggles a light and
 * hold opens its more-info dialog. Only entities marked ha_slider get a slider; one that does not
 * exist in Home Assistant (e.g. a cover not integrated yet) only changes the picture.
 */
const CARD_VERSION = "1.1.0";
const HOLD_MS = 500;

class GungorsFloorCard extends HTMLElement {
  setConfig(config) {
    if (!config.floor) throw new Error("gungors-floor-card: 'floor' is required (e.g. zemin_kat)");
    this._config = { base: "/local/gungors_floor/", light_gain: 1, ...config };
    if (!this._config.base.endsWith("/")) this._config.base += "/";
  }

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
    root.innerHTML = `<style>
        ha-card{overflow:hidden;background:#3a3a3a}
        .wrap{position:relative;width:100%}
        canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
        .panel{position:absolute;transform-origin:0 0;background:rgba(30,30,30,.78);border-radius:8px;padding:10px 12px;
               box-sizing:border-box;color:#e6e6e6;font:12px "Segoe UI",Roboto,Arial,sans-serif}
        .grp{color:#9a9a9a;font-size:11px;letter-spacing:.5px;margin:4px 0 2px}
        .row{display:grid;gap:10px;align-items:center;height:24px;padding-left:8px}
        .row input{width:100%;accent-color:#e0a45a;margin:0}
        .row.local span{font-style:italic;color:#bdbdbd}
        .msg{position:absolute;left:12px;top:10px;color:#e6e6e6;font-size:13px}
      </style>
      <ha-card><div class="wrap"><canvas></canvas><div class="panel"></div><div class="msg">loading…</div></div></ha-card>`;
    this._wrap = root.querySelector(".wrap");
    this._cv = root.querySelector("canvas");
    this._panel = root.querySelector(".panel");
    this._msg = root.querySelector(".msg");
    const dir = this._config.base + this._config.floor + "/";
    try {
      this._M = await (await fetch(dir + "model.json?v=" + CARD_VERSION, { cache: "no-cache" })).json();
    } catch (e) { this._msg.textContent = "model.json not found: " + dir; return; }
    const M = this._M;
    this._wrap.style.aspectRatio = M.W + " / " + M.H;
    this._cv.width = M.W; this._cv.height = M.H;
    this._val = {};
    this._dragging = {};
    this._buildPanel();
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

  _buildPanel() {
    const M = this._M, ui = M.ui;
    const labels = [].concat(...M.groups.map((g) => g.rows.map((r) => r.label)));
    const lw = 7 * Math.max(8, ...labels.map((l) => l.length)) + 4;
    let html = "";
    for (const g of M.groups) {
      html += `<div class="grp">${g.title}</div>`;
      for (const r of g.rows) {
        const ent = this._entityOf(r.key);
        const local = !this._state(ent);
        html += `<label class="row${local ? " local" : ""}" style="grid-template-columns:${lw}px 1fr" title="${ent}${local ? " (not in Home Assistant: local only)" : ""}">
                   <span>${r.label}</span><input type="range" min="0" max="100" value="${Math.round(r.init * 100)}" data-k="${r.key}"></label>`;
        this._val[r.key] = r.init;
      }
    }
    this._panel.innerHTML = html;
    if (!M.groups.length) this._panel.style.display = "none";
    this._panel.style.left = (ui.x / M.W * 100) + "%";
    this._panel.style.top = (ui.y / M.H * 100) + "%";
    this._panel.style.width = ui.width + "px";
    this._panel.querySelectorAll("input").forEach((inp) => {
      const k = inp.dataset.k;
      inp.addEventListener("input", () => { this._dragging[k] = true; this._val[k] = inp.value / 100; this._redraw(); });
      inp.addEventListener("change", () => { this._dragging[k] = false; this._val[k] = inp.value / 100; this._command(k, this._val[k]); this._redraw(); });
    });
    this._fitPanel();
  }

  _fitPanel() {
    if (!this._M) return;
    const s = this._wrap.clientWidth / this._M.W;
    this._panel.style.transform = `scale(${s})`;
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
      const st = this._state(l.entity);
      if (!st) continue;
      if (l.entity.startsWith("sun.")) { const v = st.state === "above_horizon" ? 1 : 0; if (this._sun !== v) { this._sun = v; changed = true; } continue; }
      const b = st.attributes.brightness;
      set("light:" + l.id, st.state === "on" ? (b != null ? b / 255 : 1) : 0);
    }
    if (changed) this._redraw();
  }

  _gain(l) {
    const st = this._state(l.entity);
    if (l.entity.startsWith("sun.")) return st ? (this._sun ?? 1) : 1;
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
    M.covers.forEach((c) => { need[c.default] = 3; need[c.param] = 0; });
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
      im.src = dir + name + "?v=" + CARD_VERSION;
    });
  }

  // parts of a cover's plane covered when opened by t, for the light maps (U, or V for a track door)
  _covered(c, t) {
    if (c.motion === "track") return [Math.min(1, t * c.travel / c.H), 1, 2, 2];
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
    if (M.covers.length) { gl.uniform4fv(U("uCov"), cov); gl.uniform4fv(U("uVis"), vis); gl.uniform1fv(U("uT"), tt); }
    const bx = [].concat(...M.boxes); if (bx.length) gl.uniform4fv(U("uBox"), bx);
    gl.uniform1i(U("uHover"), this._hover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ------------------------------------------------------------------ hover / click
  _pick(e) {
    const M = this._M, r = this._cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * M.W), y = Math.floor((e.clientY - r.top) / r.height * M.H);
    if (!this._cpu || x < 0 || y < 0 || x >= M.W || y >= M.H) return -1;
    const i = y * M.W + x;
    const inr = (e8, iv) => { if (e8 < 8) return false; const u = (e8 / 255 - 0.05) / 0.9; return (u >= iv[0] && u <= iv[1]) || (u >= iv[2] && u <= iv[3]); };
    for (let n = 0; n < M.covers.length; n++) {
      const c = M.covers[n], a = this._cpu[c.default], p = this._cpu[c.param];
      if (a && p && a[i] > 100 && inr(p[i], this._visible(c, this._val["open:" + c.id] ?? 0))) return n;
    }
    for (let f = 0; f < M.fixtures.length; f++) {
      const fa = this._cpu[M.fixtures[f].layer]; if (!fa) continue;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < M.W && yy < M.H && fa[yy * M.W + xx] > 100) return M.covers.length + f;
      }
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
      return;
    }
    const act = it[which] || { action: "none" };
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
