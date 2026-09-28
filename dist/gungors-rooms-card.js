// gungors-rooms-card — lists the active (not off) entities of a whitelist as checkbox trees
// (by domain / by area) and turns the selected ones off after a confirmation.
// The whitelist comes from the card config (`entities`) and can be overridden per user in
// the card's settings; the override is stored server-side in frontend user data.
// Hidden entities cannot be added from the settings.
const VERSION = "0.1.1";
const STORE_KEY = "gungors-rooms-card";
const INACTIVE = new Set(["off", "unavailable", "unknown"]);
const DOMAIN_META = {
  light: ["Işıklar", "mdi:lightbulb-group"],
  climate: ["Isıtma", "mdi:radiator"],
  media_player: ["Medya", "mdi:television"],
  fan: ["Fanlar", "mdi:fan"],
  switch: ["Anahtarlar", "mdi:toggle-switch"],
  cover: ["Perdeler", "mdi:curtains"],
};
const DOMAIN_ICON = { light: "mdi:lightbulb", climate: "mdi:thermostat", media_player: "mdi:television", fan: "mdi:fan", switch: "mdi:toggle-switch", cover: "mdi:curtains" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cmp = (a, b) => String(a).localeCompare(String(b), "tr");

const CSS = `
:host{display:block}
ha-card{padding:16px;color:var(--primary-text-color)}
.head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.title{font-size:1.25rem;font-weight:500;flex:1;min-width:0}
.badge{font-size:.8rem;color:var(--secondary-text-color);white-space:nowrap}
.icon-btn{background:none;border:0;padding:6px;border-radius:50%;color:var(--secondary-text-color);cursor:pointer;display:flex}
.icon-btn:hover{background:var(--secondary-background-color)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--divider-color);margin-bottom:4px}
.tab{background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;color:var(--secondary-text-color);font:inherit;cursor:pointer;white-space:nowrap}
.tab.on{color:var(--primary-color);border-bottom-color:var(--primary-color);font-weight:500}
.bar{display:flex;align-items:center;gap:12px;padding:6px 4px;font-size:.875rem;color:var(--secondary-text-color)}
.bar .sp{flex:1}
.link{background:none;border:0;padding:0;color:var(--primary-color);font:inherit;font-size:.875rem;cursor:pointer}
.link:disabled{color:var(--disabled-text-color,#999);cursor:default}
.tree{display:flex;flex-direction:column}
.node{display:flex;align-items:center;gap:2px;padding-left:calc(var(--d) * 20px);min-height:44px;border-bottom:1px solid var(--divider-color)}
.node:last-child{border-bottom:0}
.fold{background:none;border:0;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--secondary-text-color);cursor:pointer;flex:none}
.fold.sp{cursor:default}
.lb{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:6px 4px;cursor:pointer}
.cb{width:18px;height:18px;margin:0;accent-color:var(--primary-color);flex:none;cursor:pointer}
.ic{color:var(--state-active-color,var(--primary-color));flex:none;--mdc-icon-size:22px}
.par .ic{color:var(--secondary-text-color)}
.tx{flex:1;min-width:0;display:flex;flex-direction:column}
.nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.par .nm{font-weight:500}
.sb{font-size:.75rem;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cnt{font-size:.75rem;padding:1px 8px;border-radius:10px;background:var(--secondary-background-color);color:var(--secondary-text-color)}
.empty{padding:24px 4px;color:var(--secondary-text-color);text-align:center}
.err{padding:8px 10px;margin:8px 0;border-radius:6px;border:1px solid var(--error-color);color:var(--error-color);font-size:.875rem}
.note{font-size:.8rem;color:var(--secondary-text-color);margin:4px 0 8px}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--divider-color)}
.btn{padding:8px 14px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);font:inherit;cursor:pointer;min-height:38px}
.btn.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--text-primary-color,#fff)}
.btn.danger{background:var(--error-color);border-color:var(--error-color);color:#fff}
.btn:disabled{opacity:.45;cursor:default}
.srow{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--divider-color)}
.srow .tx .sb.warn{color:var(--warning-color,#ff9800)}
.add{display:flex;gap:8px;margin-top:12px}
.add input{flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);font:inherit;min-height:40px}
dialog{border:0;border-radius:var(--ha-card-border-radius,12px);padding:0;max-width:min(440px,92vw);width:100%;background:var(--card-background-color,#fff);color:var(--primary-text-color);box-shadow:0 8px 32px rgba(0,0,0,.35)}
dialog::backdrop{background:rgba(0,0,0,.45)}
.dlg{padding:20px;display:flex;flex-direction:column;gap:12px;max-height:80vh}
.dlg h2{margin:0;font-size:1.15rem;font-weight:500}
.dlist{overflow:auto;border:1px solid var(--divider-color);border-radius:8px}
.ditem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--divider-color)}
.ditem:last-child{border-bottom:0}
.dact{display:flex;gap:8px;justify-content:flex-end}
button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
`;

class GungorsRoomsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "domain";
    this._view = "main";
    this._sel = new Set();
    this._collapsed = new Set();
    this._floors = {};
    this._user = undefined; // undefined = not loaded yet, null = no override
    this._nodeIds = {};
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this.shadowRoot.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target?.dataset?.f === "add") { e.preventDefault(); this._add(); }
    });
  }

  setConfig(config) {
    if (config.entities !== undefined && !Array.isArray(config.entities)) throw new Error("entities bir liste olmalı");
    this._config = { title: "Açık cihazlar", entities: [], ...config };
    this._sig = null;
    this._render();
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) { this._init(); return; }
    if (this._view !== "main" || this._confirm) return; // don't disturb settings input or the open dialog
    const sig = this._signature();
    if (sig !== this._sig) this._render();
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  static getStubConfig() { return { entities: [] }; }

  async _init() {
    try {
      const list = this._hass.floors ? Object.values(this._hass.floors) : await this._hass.callWS({ type: "config/floor_registry/list" });
      this._floors = Object.fromEntries(list.map((f) => [f.floor_id, f]));
    } catch (e) { this._floors = {}; }
    try {
      const res = await this._hass.callWS({ type: "frontend/get_user_data", key: STORE_KEY });
      const v = res?.value;
      this._user = v && Array.isArray(v.entities) ? v : null;
    } catch (e) { this._user = null; }
    this._render();
  }

  // ---------- data ----------
  _list() { return [...new Set(this._user?.entities ?? this._config?.entities ?? [])]; }

  _isHidden(eid) { return !!this._hass?.entities?.[eid]?.hidden; }

  _areaOf(eid) {
    const h = this._hass;
    const e = h.entities?.[eid];
    if (!e) return null;
    if (e.area_id) return e.area_id;
    const d = e.device_id ? h.devices?.[e.device_id] : null;
    return d?.area_id || null;
  }

  _items() {
    const h = this._hass;
    if (!h) return [];
    const out = [];
    for (const id of this._list()) {
      const st = h.states[id];
      if (!st || INACTIVE.has(st.state)) continue;
      const area = this._areaOf(id);
      if (!area || !h.areas?.[area]) continue;
      const domain = id.split(".")[0];
      out.push({
        id, domain, area,
        areaName: h.areas[area].name,
        name: st.attributes.friendly_name || id,
        icon: st.attributes.icon || DOMAIN_ICON[domain] || "mdi:checkbox-blank-circle",
        stateText: h.formatEntityState ? h.formatEntityState(st) : st.state,
      });
    }
    return out;
  }

  _signature() {
    return this._items().map((i) => `${i.id}|${i.stateText}|${i.area}|${i.name}`).join(";") + `#${this._user === undefined ? "u" : "l"}`;
  }

  _leaf(it, sub) { return { key: `e:${it.id}`, label: it.name, icon: it.icon, sub, ids: [it.id] }; }

  _treeDomain(items) {
    const by = new Map();
    for (const it of items) { if (!by.has(it.domain)) by.set(it.domain, []); by.get(it.domain).push(it); }
    const order = Object.keys(DOMAIN_META);
    return [...by.entries()]
      .sort(([a], [b]) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || cmp(a, b))
      .map(([d, list]) => {
        const children = list.sort((a, b) => cmp(a.name, b.name)).map((it) => this._leaf(it, `${it.areaName} · ${it.stateText}`));
        const [label, icon] = DOMAIN_META[d] || [d, "mdi:shape"];
        return { key: `d:${d}`, label, icon, children, ids: children.flatMap((c) => c.ids) };
      });
  }

  _treeArea(items) {
    const h = this._hass;
    const byArea = new Map();
    for (const it of items) { if (!byArea.has(it.area)) byArea.set(it.area, []); byArea.get(it.area).push(it); }
    const floors = new Map();
    for (const [aid, list] of byArea) {
      const a = h.areas[aid];
      const fid = a?.floor_id || "";
      const f = this._floors[fid];
      if (!floors.has(fid)) floors.set(fid, { key: `f:${fid}`, label: f?.name || "Kat atanmamış", icon: f?.icon || "mdi:layers", level: f?.level ?? 999, areas: [] });
      const children = list.sort((x, y) => cmp(x.name, y.name)).map((it) => this._leaf(it, it.stateText));
      floors.get(fid).areas.push({ key: `a:${aid}`, label: a?.name || aid, icon: a?.icon || "mdi:texture-box", children, ids: children.flatMap((c) => c.ids) });
    }
    return [...floors.values()]
      .sort((a, b) => a.level - b.level || cmp(a.label, b.label))
      .map((f) => {
        const children = f.areas.sort((a, b) => cmp(a.label, b.label));
        return { key: f.key, label: f.label, icon: f.icon, children, ids: children.flatMap((c) => c.ids) };
      });
  }

  async _save(entities) {
    this._user = entities === null ? null : { entities };
    this._error = null;
    try {
      await this._hass.callWS({ type: "frontend/set_user_data", key: STORE_KEY, value: this._user });
    } catch (e) {
      this._error = `Ayarlar kaydedilemedi: ${e?.message || e}`;
    }
    this._render();
  }

  _add() {
    const inp = this.shadowRoot.querySelector('[data-f="add"]');
    const id = (inp?.value || "").trim();
    if (!id) return;
    if (!this._hass.states[id]) { this._error = `Böyle bir entity yok: ${id}`; this._render(); return; }
    if (this._isHidden(id)) { this._error = `Gizli entity eklenemez: ${id}`; this._render(); return; }
    const list = this._list();
    if (list.includes(id)) { this._error = null; this._render(); return; }
    this._save([...list, id]);
  }

  async _turnOff() {
    const ids = [...this._confirm];
    this._busy = true;
    this._render();
    try {
      await this._hass.callService("homeassistant", "turn_off", { entity_id: ids });
      this._sel.clear();
      this._error = null;
    } catch (e) {
      this._error = `Kapatılamadı: ${e?.message || e}`;
    }
    this._busy = false;
    this._confirm = null;
    this._render();
  }

  // ---------- events ----------
  _onClick(e) {
    const el = e.target.closest("[data-a]");
    if (!el || el.disabled) return;
    const a = el.dataset.a;
    if (a === "sel") return; // handled on change
    if (a === "tab") { this._tab = el.dataset.t; this._render(); }
    else if (a === "fold") {
      const k = el.dataset.k;
      this._collapsed.has(k) ? this._collapsed.delete(k) : this._collapsed.add(k);
      this._render();
    } else if (a === "all") { this._items().forEach((i) => this._sel.add(i.id)); this._render(); }
    else if (a === "none") { this._sel.clear(); this._render(); }
    else if (a === "close") {
      const active = new Set(this._items().map((i) => i.id));
      const ids = [...this._sel].filter((id) => active.has(id));
      if (ids.length) { this._confirm = ids; this._render(); }
    } else if (a === "cancel") { this._confirm = null; this._render(); }
    else if (a === "confirm") this._turnOff();
    else if (a === "settings") { this._view = "settings"; this._error = null; this._render(); }
    else if (a === "done") { this._view = "main"; this._error = null; this._sig = null; this._render(); }
    else if (a === "rm") this._save(this._list().filter((x) => x !== el.dataset.e));
    else if (a === "addbtn") this._add();
    else if (a === "reset") this._save(null);
  }

  _onChange(e) {
    const el = e.target;
    if (el?.dataset?.a !== "sel") return;
    const ids = this._nodeIds[el.dataset.k] || [];
    const allSel = ids.length && ids.every((id) => this._sel.has(id));
    ids.forEach((id) => (allSel ? this._sel.delete(id) : this._sel.add(id)));
    this._render();
  }

  // ---------- render ----------
  _nodeHtml(n, depth) {
    this._nodeIds[n.key] = n.ids;
    const c = n.ids.filter((id) => this._sel.has(id)).length;
    const all = n.ids.length > 0 && c === n.ids.length;
    const some = c > 0 && !all;
    const kids = n.children;
    const open = kids && !this._collapsed.has(n.key);
    const fold = kids
      ? `<button class="fold" data-a="fold" data-k="${esc(n.key)}" aria-label="${open ? "Daralt" : "Genişlet"}"><ha-icon icon="mdi:chevron-${open ? "down" : "right"}"></ha-icon></button>`
      : `<span class="fold sp"></span>`;
    const row = `<div class="node ${kids ? "par" : "leaf"}" style="--d:${depth}">${fold}
      <label class="lb">
        <input type="checkbox" class="cb" data-a="sel" data-k="${esc(n.key)}" ${all ? "checked" : ""} ${some ? "data-ind" : ""} aria-label="${esc(n.label)}">
        <ha-icon class="ic" icon="${esc(n.icon)}"></ha-icon>
        <span class="tx"><span class="nm">${esc(n.label)}</span>${n.sub ? `<span class="sb">${esc(n.sub)}</span>` : ""}</span>
        ${kids ? `<span class="cnt">${n.ids.length}</span>` : ""}
      </label></div>`;
    return row + (open ? kids.map((k) => this._nodeHtml(k, depth + 1)).join("") : "");
  }

  _mainHtml() {
    const items = this._items();
    const active = new Set(items.map((i) => i.id));
    for (const id of [...this._sel]) if (!active.has(id)) this._sel.delete(id); // entities that turned off drop out
    const selN = this._sel.size;
    const areas = new Set(items.map((i) => i.area)).size;
    this._nodeIds = {};
    const tree = this._tab === "area" ? this._treeArea(items) : this._treeDomain(items);
    const tabs = [["domain", "By domain"], ["area", "By area"]]
      .map(([t, l]) => `<button class="tab ${this._tab === t ? "on" : ""}" data-a="tab" data-t="${t}">${l}</button>`).join("");
    const loading = this._user === undefined;
    let body;
    if (loading) body = `<div class="empty">Yükleniyor…</div>`;
    else if (!items.length) body = `<div class="empty">Şu an açık cihaz yok.</div>`;
    else body = `<div class="bar"><span>${selN ? `${selN} seçili` : "Seçim yok"}</span><span class="sp"></span>
        <button class="link" data-a="all" ${selN === items.length ? "disabled" : ""}>Tümünü seç</button>
        <button class="link" data-a="none" ${selN ? "" : "disabled"}>Hiçbiri</button></div>
      <div class="tree">${tree.map((n) => this._nodeHtml(n, 0)).join("")}</div>`;
    return `<div class="head"><div class="title">${esc(this._config.title)}</div>
        ${items.length ? `<span class="badge">${items.length} açık · ${areas} area</span>` : ""}
        <button class="icon-btn" data-a="settings" aria-label="Ayarlar"><ha-icon icon="mdi:cog"></ha-icon></button></div>
      <div class="tabs">${tabs}</div>
      ${this._error ? `<div class="err">${esc(this._error)}</div>` : ""}
      ${body}
      <div class="actions"><button class="btn danger" data-a="close" ${selN ? "" : "disabled"}>Kapat${selN ? ` (${selN})` : ""}</button></div>
      ${this._confirm ? this._dialogHtml() : ""}`;
  }

  _dialogHtml() {
    const h = this._hass;
    const rows = this._confirm.map((id) => {
      const st = h.states[id];
      const area = this._areaOf(id);
      const icon = st?.attributes?.icon || DOMAIN_ICON[id.split(".")[0]] || "mdi:checkbox-blank-circle";
      return `<div class="ditem"><ha-icon class="ic" icon="${esc(icon)}"></ha-icon>
        <span class="tx"><span class="nm">${esc(st?.attributes?.friendly_name || id)}</span><span class="sb">${esc(h.areas?.[area]?.name || "")}</span></span></div>`;
    }).join("");
    const b = this._busy ? "disabled" : "";
    return `<dialog>
      <div class="dlg">
        <h2>${this._confirm.length} cihaz kapatılacak</h2>
        <div class="dlist">${rows}</div>
        <div>Emin misin?</div>
        <div class="dact"><button class="btn" data-a="cancel" ${b}>Vazgeç</button>
          <button class="btn danger" data-a="confirm" ${b}>${this._busy ? "Kapatılıyor…" : "Kapat"}</button></div>
      </div></dialog>`;
  }

  _settingsHtml() {
    const h = this._hass;
    const list = this._list();
    const rows = list.map((id) => {
      const st = h?.states[id];
      const area = h ? this._areaOf(id) : null;
      let sub = id, warn = false;
      if (!st) { sub = `${id} · bulunamadı`; warn = true; }
      else if (!area) { sub = `${id} · area atanmamış, listede görünmez`; warn = true; }
      else sub = `${id} · ${h.areas?.[area]?.name || area}`;
      const icon = st?.attributes?.icon || DOMAIN_ICON[id.split(".")[0]] || "mdi:checkbox-blank-circle";
      return `<div class="srow"><ha-icon class="ic" icon="${esc(icon)}"></ha-icon>
        <span class="tx"><span class="nm">${esc(st?.attributes?.friendly_name || id)}</span><span class="sb ${warn ? "warn" : ""}">${esc(sub)}</span></span>
        <button class="icon-btn" data-a="rm" data-e="${esc(id)}" aria-label="Çıkar"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
    }).join("");
    const opts = h ? Object.keys(h.states).filter((id) => !list.includes(id) && !this._isHidden(id) && this._areaOf(id)).sort(cmp)
      .map((id) => `<option value="${esc(id)}">${esc(h.states[id].attributes.friendly_name || "")}</option>`).join("") : "";
    const custom = !!this._user;
    return `<div class="head"><div class="title">Ayarlar</div></div>
      <div class="note">${custom ? "Kendi listeni kullanıyorsun." : "Varsayılan liste kullanılıyor; değişiklik yaparsan sana özel bir liste oluşur."} Liste kullanıcı başına saklanır. Gizli entity'ler eklenemez.</div>
      ${this._error ? `<div class="err">${esc(this._error)}</div>` : ""}
      <div>${rows || `<div class="empty">Liste boş.</div>`}</div>
      <div class="add"><input data-f="add" list="grc-ents" placeholder="Entity ekle (ör. light.salon_light)" autocomplete="off">
        <button class="btn" data-a="addbtn">Ekle</button></div>
      <datalist id="grc-ents">${opts}</datalist>
      <div class="actions"><button class="btn" data-a="reset" ${custom ? "" : "disabled"}>Varsayılana dön</button>
        <button class="btn primary" data-a="done">Bitti</button></div>`;
  }

  _render() {
    if (!this._config) return;
    const html = this._view === "settings" ? this._settingsHtml() : this._mainHtml();
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>${html}</ha-card>`;
    this.shadowRoot.querySelectorAll("input[data-ind]").forEach((el) => { el.indeterminate = true; });
    const dlg = this.shadowRoot.querySelector("dialog");
    if (dlg) {
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (!this._busy) { this._confirm = null; this._render(); } });
      dlg.showModal();
    }
    if (this._view === "main") this._sig = this._signature();
  }
}

customElements.define("gungors-rooms-card", GungorsRoomsCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "gungors-rooms-card", name: "Gungors Rooms Card", description: "Açık cihazları domain/area ağacında listeler, seçilenleri toplu kapatır" });
console.info(`%c gungors-rooms-card ${VERSION} `, "background:#03a9f4;color:#fff");
