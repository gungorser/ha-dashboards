/*
 * gungors-floor-card — Home Assistant Lovelace card showing the floors of the Blender house model
 * (repository ha-floorplan: the page src/web/index.html and the render of each floor output/<floor>/,
 * deployed to /config/www/gungors_floor/ by deploy.ps1; the card opens index.html?floor=<floor>).
 *
 * The floor page draws; this card only connects it to Home Assistant. The page runs in an iframe and
 * has typed entities (light: RGBA, cover: 0-100, climate: "mode action current target", valve: 0/1) plus a time
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
 * Dock: bottom left, three straight edges (horizontal top: the floor button, opening the floors upwards; slanted along the render's axis: the modes; vertical right: the wall cut button, opening the cuts to the right) with the buttons heating, sun, cameras, vacuum, floor and wall cut over a screen (clock,
 * date and the mode's rows). Heating: the climates of the floor shown (page type climate, in the order of
 * `entities`), one room at a time; each press of the heating button (while the heating mode is on) goes on
 * to the next room (after the last, back to the first; a floor switch starts at the first). The screen shows
 * the room's name, current and target temperature, hvac mode and action, and humidity (the entity's
 * `humidity` sensor, else its current_humidity attribute); a tap / hold on the screen runs the room's
 * tap_action / hold_action; hovered, it glows in the room's border colour together with the room
 * and its link on the page. The card asks the page for a link
 * line from the screen to the room's radiator ({gf: "link", id, rect: the screen in page px}; {gf: "link",
 * id: null} in the other modes), drawn along the world axes and glowing only while hovered.
 *
 * Cameras: the camera mode of the dock (the cctv button) shows the cameras of the floor shown (page type
 * camera, in the order of `entities`), one at a time; each press of the button (while the camera mode is
 * on) goes on to the next camera. The screen shows its name, state and motion (the entity's `motion`
 * binary sensor, optional); a tap / hold on the screen runs the camera's tap_action / hold_action, hovered
 * it glows with the camera and its link line on the page (as in the heating mode).
 * Live view: `action: camera` (tap_action or hold_action of a camera) opens a popup with the camera's live
 * picture: once the camera streams, its frames (camera_proxy, one after the other), switching to its MJPEG
 * stream (camera_proxy_stream) once that draws (Home Assistant's HLS player stayed blank when opened before the
 * video was up; a Eufy camera that is not streaming gives no JPEG). If the camera is not streaming, the card first starts
 * it: `start` (a service, called with the camera's entity_id; e.g. eufy_security.start_p2p_livestream),
 * else camera.turn_on when the camera supports it; the picture shows once the camera is `streaming`
 * (up to 45 s). A start that fails is tried once more (a sleeping battery camera may miss the first one);
 * a second failure shows its error in the popup (no toast) and nothing is stopped. Closing the popup stops
 * a stream the card started (`stop`, else camera.turn_off). A camera whose stream runs over RTSP
 * (Eufy with RTSP on) needs start_rtsp_livestream / stop_rtsp_livestream, not the P2P ones.
 *
 * Decor: per floor `show` (YAML) shows or leaves out the decor parts of the floor's render (kat0 araba: the
 * car on the driveway), fixed (true / false) or following an entity (shown while it is "on"); the card sends
 * each to the page ({gf: "show", id, value: true|false}) with its other inputs, again when the entity
 * changes. A part left out of `show` keeps the render's default.
 *
 * Vacuum: the vacuum mode of the dock (the robot-vacuum button) shows the robot vacuums of the floor shown (page
 * type vacuum, in the order of `entities`), one at a time (each press goes on to the next): state, status, battery,
 * suction and the last cleaned area; a tap / hold on the screen runs the vacuum's tap_action / hold_action,
 * hovered it glows with the vacuum and its link line on the page (as in the heating mode). The floor's vacuum map
 * is shown only in this mode.
 * Vacuum map: per floor `vacuum_map` (YAML), the map camera of a robot vacuum (Dreame / Xiaomi, e.g.
 * camera.xiaomi_robot_vacuum_x20_map). The card sends its picture to the page ({gf: "vacuum", src: the camera's
 * entity_picture, calib: its calibration_points, trim: the no-go zones in robot mm}), again whenever the map
 * changes; the page lays it on the floor under the furniture and walls, at `vacuum_opacity` (0-1, optional). Trimmed: the map's rooms named
 * "No go ..." (their x0 y0 x1 y1 box) and its no_go_areas. Unavailable: {gf: "vacuum", src: null}.
 *
 * Qibla: in the sun mode of the dock the card asks the page for its qibla compass ({gf: "compass", value:
 * true}; false in the other modes), drawn by the page bottom right.
 *
 * Remote (TV remote, keyboard), only in kiosk mode (the page was opened with ?kiosk in its URL, as the TV's
 * Fully Kiosk does; elsewhere keys do nothing and nothing below shows): the arrow keys pick the entities of the floor shown by where they are on the
 * picture (the boxes of the page's "ready"; only entities with a tap or hold action), the one picked glows as if
 * hovered ({gf: "highlight", id}). OK / Enter: a short press is its tap, a long one (HOLD_MS) its hold. Left or
 * down with nothing further that way goes into the dock (at the button of the mode shown): up / down walk its
 * buttons and its screen, OK presses them (the screen: tap / hold of the room, camera or vacuum shown, which
 * glows), right goes back to the house. Colour keys: red the dock, blue the side panel's control, green / yellow
 * the house. OK on floor / cut opens its choices: up / down (floors) or left / right (cuts) walk them, OK picks, any other arrow closes. Back / Esc closes a popup, else leaves the dock, else drops the pick.
 * Side panel: the entity picked with the remote shows top right on the picture (its bottom-left corner cut
 * along the house's long axis): icon in its colour, name, floor, its state in plain words and, where it has one, a bar. A long OK moves
 * the control into the panel (its frame turns gold) instead of the hold action, for the types that have one:
 *   light    left / right brightness -/+ 10 % (below 10 %: off), OK on / off
 *   cover    left / right position -/+ 10 % (no position: close / open), OK open / close, stop while moving
 *            (page-only covers too)
 *   climate  shows the room temperature; left / right target -/+ its step, OK on (its first mode) / off
 *   valve    OK open / close;  vacuum: OK start / back to the dock;  camera and others: no control, state only
 * In the control: OK as above, up / down (or back, if the browser passes it on; Fully Kiosk keeps it for its
 * settings) give the control back to the house; 15 s without a key too, and 60 s drop the pick. Other types keep
 * their hold action, except more-info: from the remote it does nothing (Home Assistant's dialog could not be
 * closed without back). A popup of the card closes with OK or back.
 * Channel up / down (page up / down): the next floor. Nothing shows until a key is pressed; a touch or click
 * drops it. Keys in a text field or a Home Assistant dialog (more-info) are left to it.
 *
 * Wall cut: the cut button of the dock goes on to the next cut the floor has (none -> front -> all; the
 * page's "ready" lists them) and sends it to the page ({gf: "cut", mode}); the page shows that cut's
 * render of every floor (the plain one where a floor has none). The choice is kept in this browser
 * (localStorage); YAML `cut` is the first one. The lighting is the same in every cut.
 *
 *   type: custom:gungors-floor-card
 *   base: /local/gungors_floor/       # optional
 *   sun: sun.sun                      # required
 *   dock_radius: 370                  # optional: height (page px) of the control dock in the bottom-left corner
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
 *       show:                         # optional: decor of the floor's render shown or left out, e.g. kat0
 *         araba: input_boolean.floorplan_araba   # araba: the car on the driveway: true / false, or an
 *                                     #   entity (shown while it is "on", e.g. an input_boolean on a
 *                                     #   settings view); left out of this map: the render's default (shown)
 *       vacuum_map: camera.xiaomi_robot_vacuum_x20_map   # optional: a robot vacuum's map camera, laid on
 *                                     #   the floor under its furniture (no-go zones trimmed)
 *       vacuum_opacity: 0.6           # optional: the map's opacity 0-1 (default: the page's, 0.6), or an
 *                                     #   entity whose state sets it live (e.g. an input_number 0-100 %)
 *       entities:                     # page entity -> Home Assistant entity (same domain as its type)
 *         salon_light:
 *           entity: light.salon_light
 *           name: Salon               # optional: name in the dock (heating: the room's name)
 *           gain: 2                   # optional (lights): brightness at full intensity, times the render's
 *           color: "#ff9800"          # optional: border colour of this entity on the page
 *           tap_action:
 *             action: toggle
 *           hold_action:
 *             action: more-info
 *         cop_kutulari:               # popup: a tap opens a window over the screen with any Lovelace card
 *           entity: sensor.afval_next #   (title optional; the window closes on its x, a tap beside it or Esc)
 *           tap_action:
 *             action: popup
 *             title: Bins
 *             card: {type: markdown, content: "..."}
 *         mutfak_blind: none          # background: no hover, no tap, the page's default (covers open)
 *         salon_blind:                # background that follows Home Assistant (e.g. a manual blind):
 *           entity: cover.salon_cover #   no hover, no border, no tap, like none, but the page shows the
 *           selectable: false         #   entity's state (a cover's position, a light's colour)
 *         garaj_door:                 # background with a fixed value instead of the page's default:
 *           entity: none              #   cover: position 0-100 (0 closed, 100 open)
 *           value: 0                  #   light: [r, g, b, intensity 0-1], e.g. [255, 255, 255, 0] = off
 *         bebek_climate:              # a climate: a room of the heating mode
 *           entity: climate.bebek_thermostat
 *           name: Bebek
 *           humidity: sensor.bebek_sensor_humidity   # optional: the room's humidity in the dock
 *           tap_action: {action: more-info}
 *         kapi_kamera:                # a camera: a camera of the camera mode
 *           entity: camera.doorbell
 *           name: Kapı
 *           motion: binary_sensor.doorbell_motion_detected   # optional: motion in the dock
 *           tap_action:               # live view popup; start / stop optional (default camera.turn_on / turn_off)
 *             action: camera
 *             start: eufy_security.start_p2p_livestream
 *             stop: eufy_security.stop_p2p_livestream
 *         dolap_kapi:                 # page-only cover (no Home Assistant entity, slider: true): a tap opens /
 *           entity: none              #   closes it; its position is kept in this browser
 *           slider: true              #   (value: the first position, 0 closed by default)
 *     - floor: kat1
 *       entities: ...
 *
 * Page entities left out of `entities` keep the page's defaults and are listed on the page (top right):
 * put them here or set them to none. Errors (unknown page entity, wrong domain, missing Home Assistant
 * entity) stop the card. A Home Assistant entity that is unavailable or unknown is reported to the page,
 * which draws its borders grey. A climate gets its hvac mode, hvac_action, current_temperature and
 * temperature (target), "-" where missing; the page paints the radiator by its state and writes the
 * temperatures. A valve (valve.*) gets 1 while open or opening, else 0; the page shows the watering
 * effect while it is 1. A cover also gets {gf: "move", id, value}: "opening" / "closing" while its state
 * is that, else null; the page draws arrows on it in the direction it moves. Page entities of other types map to that domain; they take no input, the page only
 * shows their border and reports taps.
 */
const CARD_VERSION = "1.38.0";
const TYPES = { light: "light", cover: "cover" };     // page entity type -> Home Assistant domain (else the type itself)
const domainOf = (type) => TYPES[type] || type;
const INPUTS = { light: 1, cover: 1, climate: 1, valve: 1 };     // page entity types that take a value
const isColor = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

// dock buttons: display modes of the screen, and the floor button (goes to the next floor)
const DOCK_MODES = [
  { id: "heating", icon: "mdi:radiator", title: "heating" },
  { id: "sun", icon: "mdi:weather-sunny", title: "sun" },
  { id: "camera", icon: "mdi:cctv", title: "cameras" },
  { id: "vacuum", icon: "mdi:robot-vacuum", title: "vacuum" },
  { id: "floor", title: "next floor" },
  { id: "cut", title: "wall cut" },
];
// wall cut (the page's renders): icon and title of each
const CUTS = ["none", "front", "all"];
const CUT_ICON = { none: "mdi:wall", front: "mdi:box-cutter", all: "mdi:floor-plan" };
const CUT_TITLE = { none: "walls: no cut", front: "walls: front cut", all: "walls: all cut" };
// the remote's colour keys (KeyboardEvent.key; keyCode on TV browsers that give no key name)
const COLOUR_KEYS = { ColorF0Red: "red", ColorF1Green: "green", ColorF2Yellow: "yellow", ColorF3Blue: "blue" };
const COLOUR_CODES = { 403: "red", 404: "green", 405: "yellow", 406: "blue", 183: "red", 184: "green", 185: "yellow", 186: "blue" };
// the remote's walk through the dock (up = next): the screen, then round the edges from the bottom right
const DOCK_KEYS = ["screen", "cut", "heating", "sun", "camera", "vacuum", "floor"];
const CUT_LABEL = { none: "duvar", front: "ön kesik", all: "hepsi" };
const CUT_KEY = "gungors-floor-card.cut";
const savedCut = () => { try { return localStorage.getItem(CUT_KEY); } catch (e) { return null; } };
// position of a page-only cover (entity none + slider: true), kept per browser
const LOCAL_KEY = "gungors-floor-card.local.";
const savedLocal = (k) => { try { const v = localStorage.getItem(LOCAL_KEY + k); return v == null ? null : +v; } catch (e) { return null; } };
// popup window (action: popup): on document.body, so no transformed or clipping ancestor of the card
// can trap it; the theme's variables come from the document; z-index under HA's dialogs (8), so a
// more-info opened from the popup card shows above it
const POP_CSS = `
  .pop{position:fixed;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;
       background:rgba(0,0,0,.55);-webkit-tap-highlight-color:transparent}
  .box{width:min(520px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;
       background:var(--card-background-color,#1c1c1c);color:var(--primary-text-color,#e1e1e1);
       border-radius:var(--ha-card-border-radius,12px);box-shadow:0 8px 30px rgba(0,0,0,.6);overflow:hidden}
  .head{display:flex;align-items:center;gap:8px;padding:10px 8px 6px 16px;font:500 18px Roboto,"Segoe UI",Arial,sans-serif}
  .head span{flex:1}
  .head button{width:40px;height:40px;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer;
               display:flex;align-items:center;justify-content:center}
  .head button:hover{background:rgba(127,127,127,.2)}
  .body{overflow-y:auto;padding:0 8px 8px}
  .msg{padding:24px 12px;text-align:center;opacity:.8;font:15px Roboto,"Segoe UI",Arial,sans-serif}
  .cam{display:block;width:100%;height:auto;border-radius:8px;background:#000}
`;

// icon of the floor button: the number in the floor's id (kat1 -> mdi:home-floor-1)
const floorLabel = (id) => { const m = /(\d+)/.exec(id); return m ? "Kat " + m[1] : id; };
const rectCss = (r) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
const floorIcon = (id) => { const m = /(\d+)/.exec(id); return m && +m[1] <= 3 ? "mdi:home-floor-" + m[1] : "mdi:layers"; };

// border colour of a climate on the page (docs/page.md), unless YAML colours it
const CLIMATE_COLOR = "#e62823";
// border colour of a camera ("other" on the page), unless YAML colours it
const OTHER_COLOR = "#2ecc5a";
// how long the live view waits for a camera to start streaming
const STREAM_WAIT_MS = 45000;
// the dock, bottom left: three straight edges, a horizontal top (DOCK.top px long, the floor button), a slanted
// edge along the render's world Y axis (slope 0.707 as model.json camera y = [-24.27, -17.16] shows it; the mode
// buttons) and a vertical right edge (DOCK.side px long, the wall cut button). Its height is dock_radius.
const DOCK = { top: 120, side: 120, slope: Math.SQRT1_2, gap: 76, cellH: 95, cellW: 100 };
// the dock's screen: left / bottom offset and size in page px
const SCREEN = { x: 14, y: 14, w: 206, h: 182 };
// the remote's side panel, top right: designed on a picture SIDE.ref px wide, scaled with the card. Its bottom-left
// corner is cut along the render's world Y axis (from the left edge at SIDE.y down to the bottom at SIDE.x), parallel
// to the house walls: model.json camera y = [-24.27, -17.16] px per metre, slope 17.16 / 24.27 = 0.707 (116 / 164). Plain CSS (no inset, no flex gap): TV browsers are old.
const SIDE = { ref: 1065, w: 295, h: 200, y: 84, x: 164 };
const BULB = "M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z";
const SIDE_POLY = `0 0,100% 0,100% 100%,${SIDE.x}px 100%,0 ${SIDE.y}px`;
const SIDE_CSS = `
  .side{position:absolute;right:1.5%;top:3%;width:${SIDE.w}px;height:${SIDE.h}px;transform-origin:100% 0;pointer-events:none;
        font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#e8f4ff;display:none;line-height:1.15}
  .side.on{display:block}
  .side .bg{position:absolute;left:0;top:0;width:100%;height:100%;-webkit-clip-path:polygon(${SIDE_POLY});clip-path:polygon(${SIDE_POLY});
            background:linear-gradient(160deg,rgba(13,59,133,.93),rgba(7,29,69,.95) 70%)}
  .side svg.edge{position:absolute;left:0;top:0;width:${SIDE.w}px;height:${SIDE.h}px;overflow:visible}
  .side .ico{position:absolute;left:16px;top:14px;width:50px;height:50px;border-radius:50%;text-align:center;
             background:radial-gradient(circle at 50% 45%,var(--lc) 0,var(--lc) 30%,rgba(255,200,90,.22) 60%,rgba(0,0,0,0) 72%)}
  .side .ico svg{width:32px;height:32px;margin-top:9px;fill:#fff8e6;filter:drop-shadow(0 0 7px var(--lc))}
  .side .ico ha-icon{--mdc-icon-size:32px;margin-top:9px;color:#fff8e6;filter:drop-shadow(0 0 7px var(--lc))}
  .side.off .ico{background:radial-gradient(circle,#24406e 0,#24406e 55%,rgba(0,0,0,0) 72%)}
  .side.off .ico svg{fill:#7f9ac4;filter:none}.side.off .ico ha-icon{color:#7f9ac4;filter:none}
  .side .name{position:absolute;left:76px;right:14px;top:16px;height:28px;font-size:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .side .sub{position:absolute;left:77px;right:14px;top:45px;height:14px;font-size:11px;color:#9fcfff;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap;overflow:hidden}
  .side .w{position:absolute;right:16px;top:74px;width:200px;height:14px;text-align:right;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#ffd66b;white-space:nowrap;overflow:hidden}
  .side .v{position:absolute;right:16px;top:89px;width:160px;height:30px;text-align:right;font:bold 28px Consolas,"Courier New",monospace;line-height:30px;color:#7dff9a;text-shadow:0 0 10px rgba(125,255,154,.6);white-space:nowrap}
  .side.off .v{color:#6f93c2;text-shadow:none}
  .side .bar{position:absolute;left:92px;right:22px;top:131px;height:10px;border-radius:5px;background:#0a2a5e;border:1px solid #3b6fb0}
  .side .fill{position:absolute;left:0;top:0;bottom:0;width:var(--b);border-radius:5px;background:linear-gradient(90deg,rgba(0,0,0,.25),var(--lc));box-shadow:0 0 8px var(--lc)}
  .side .knob{position:absolute;top:50%;left:var(--b);width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px var(--lc),0 0 10px var(--lc)}
  .side.off .bar{opacity:.4}.side.off .fill,.side.off .knob{display:none}
  .side .arr{display:none;position:absolute;top:125px;font-size:16px;line-height:20px;color:#ffd66b;text-shadow:0 0 8px #ffd66b}
  .side.ctl .arr{display:block}
  .side .hint{position:absolute;right:14px;top:149px;width:170px;text-align:right;font-size:11px;line-height:13px;color:#cfe6ff}
  .side .hint div{white-space:nowrap;height:13px}
  .side .k{display:inline-block;padding:0 4px;margin-right:3px;border-radius:4px;border:1px solid #8cc4ff;background:#0d3b85;font-size:10px;line-height:11px;color:#fff}
`;
const CSS = `${SIDE_CSS}
  ha-card{overflow:hidden;background:#3a3a3a;-webkit-tap-highlight-color:transparent;
          display:flex;align-items:center;justify-content:center}
  .wrap{position:relative;flex:none;width:100%;aspect-ratio:16 / 9}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
  .err{padding:12px 16px;color:#ff8a80;font:14px sans-serif;white-space:pre-wrap}
  .dock{position:absolute;left:0;transform-origin:0 0;font:15px "Segoe UI",Roboto,Arial,sans-serif;color:#e8f4ff;
        user-select:none;-webkit-user-select:none;pointer-events:none;visibility:hidden}
  .dock.shown{visibility:visible}
  .disc,.rim{position:absolute;left:0;top:0;width:100%;height:100%}
  .disc{pointer-events:auto;
        background:radial-gradient(ellipse farthest-corner at 0% 100%,#071d45 0 40%,#0d3b85 52%,#1d6fd6 64%,#3b95f0 70%,#0b3a86 76%)}
  .rim{overflow:visible;pointer-events:none;filter:drop-shadow(0 0 10px rgba(90,180,255,.6))}
  .rim polygon{fill:none;stroke:#a8dcff;stroke-width:4;stroke-linejoin:round}
  .rim polygon.in{stroke:rgba(160,215,255,.35);stroke-width:2}
  .rim .div{fill:none;stroke:rgba(168,220,255,.75);stroke-width:2}
  .cell{position:absolute;box-sizing:border-box;margin:0;padding:0;border:0;border-radius:6px;background:transparent;color:#fff;
        cursor:pointer;outline:none;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;
        font:bold 13px "Segoe UI",Roboto,Arial,sans-serif;letter-spacing:.5px;text-transform:uppercase;text-shadow:0 1px 3px #000;
        transition:background .15s,box-shadow .15s}
  .cell ha-icon{--mdc-icon-size:38px;margin-bottom:4px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
  .cell:hover,.cell.open{background:rgba(160,215,255,.16)}
  .cell.single{opacity:.5;cursor:default}
  .cell.floor{padding-right:22px}
  .cell.cut{padding-top:44px}
  .cell.kf{background:rgba(190,230,255,.34)}
  .cell.kf ha-icon{filter:drop-shadow(0 0 6px #fff)}
  .cell.opt.kf ha-icon{filter:none}
  .cell.opt{z-index:2;border:2px solid #a8dcff;border-radius:8px;background:linear-gradient(#1d6fd6,#0b3a86);
            box-shadow:0 4px 10px rgba(0,0,0,.55)}
  .cell.opt ha-icon{--mdc-icon-size:30px;margin-bottom:2px}
  .cell.opt.active{border-color:#ffd66b;color:#ffd66b}
  .cell.opt.kf{box-shadow:0 0 0 3px #fff,0 0 22px #fff}
  .btn{position:absolute;width:70px;height:70px;border-radius:50%;padding:0;cursor:pointer;outline:none;pointer-events:auto;
       border:3px solid #e6f5ff;color:#fff;display:flex;align-items:center;justify-content:center;
       background:radial-gradient(circle at 35% 28%,#e4f4ff 0 7%,#63b4ff 20%,#1a67d1 58%,#0a2f70 100%);
       box-shadow:0 4px 10px rgba(0,0,0,.55),0 0 12px rgba(120,200,255,.55);transition:transform .15s,box-shadow .15s}
  .btn ha-icon{--mdc-icon-size:34px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
  .btn:hover{transform:scale(1.08)}
  .btn.active{border-color:#ffd66b;box-shadow:0 4px 10px rgba(0,0,0,.55),0 0 20px rgba(255,214,107,.85)}
  .btn.single{opacity:.5;cursor:default}
  .btn.kf{transform:scale(1.12);border-color:#fff;box-shadow:0 0 0 3px #fff,0 0 26px #fff}
  .screen{position:absolute;left:${SCREEN.x}px;bottom:${SCREEN.y}px;width:${SCREEN.w}px;height:${SCREEN.h}px;box-sizing:border-box;padding:8px 10px;pointer-events:auto;
          border-radius:16px;border:2px solid #5fb4ff;background:linear-gradient(#051a40,#0a2c63);
          box-shadow:inset 0 2px 10px rgba(0,0,0,.7),0 0 10px rgba(80,170,255,.4);display:flex;flex-direction:column}
  .screen.act{cursor:pointer;transition:box-shadow .15s,border-color .15s}
  .screen.act:hover{border-color:var(--hc);box-shadow:inset 0 2px 10px rgba(0,0,0,.7),0 0 6px var(--hc),0 0 22px var(--hc)}
  .screen.kf{border-color:var(--hc,#fff);box-shadow:inset 0 2px 10px rgba(0,0,0,.7),0 0 0 2px #fff,0 0 22px var(--hc,#fff)}
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
const KEY_CTL_MS = 15000, KEY_IDLE_MS = 60000;
// kiosk mode (the TV): the dashboard opened with ?kiosk; the remote control and its side panel exist only there
const kioskUrl = () => /[?&]kiosk(?:[=&]|$)/.test(location.search);
let KIOSK = kioskUrl();
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
        if (e && typeof e === "object" && e.entity === "none" && e.slider === true) {   // page-only, opened / closed by a tap
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
      for (const [id, e] of map) for (const w of ["tap", "hold"]) {
        const a = e && e[w + "_action"];
        if (a && a.action === "popup" && (!a.card || typeof a.card !== "object" || !a.card.type))
          err(`${f.floor}.${id}.${w}_action: a popup needs 'card': a Lovelace card config with a type`);
        if (a && a.action === "camera") for (const k of ["start", "stop"])
          if (a[k] != null && !(typeof a[k] === "string" && /^\w+\.\w+$/.test(a[k])))
            err(`${f.floor}.${id}.${w}_action.${k}: a service (domain.service)`);
      }
      for (const [id, e] of map) if (e && e.gain != null && typeof e.gain !== "number") err(`${f.floor}.${id}: gain must be a number`);
      const show = f.show == null ? {} : f.show;
      if (typeof show !== "object" || Array.isArray(show)) err(`${f.floor}: 'show' must be a map: decor -> true / false`);
      for (const [d, v] of Object.entries(show))
        if (typeof v !== "boolean" && !(typeof v === "string" && /^\w+\.\w+$/.test(v)))
          err(`${f.floor}.show.${d}: true, false or an entity (shown while it is on)`);
      if (f.vacuum_map != null && !(typeof f.vacuum_map === "string" && f.vacuum_map.startsWith("camera.")))
        err(`${f.floor}.vacuum_map: a camera entity (the vacuum's map)`);
      if (f.vacuum_opacity != null && !(typeof f.vacuum_opacity === "number" && f.vacuum_opacity >= 0 && f.vacuum_opacity <= 1)
          && !(typeof f.vacuum_opacity === "string" && /^\w+\.\w+$/.test(f.vacuum_opacity)))
        err(`${f.floor}.vacuum_opacity: a number 0-1 or an entity (e.g. an input_number 0-100 %)`);
      return { floor: String(f.floor), map, fixed, local, rooms, show, vacuum: f.vacuum_map || null,
               vacuumOpacity: f.vacuum_opacity != null ? f.vacuum_opacity : null };
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
    this._show = f.show;
    this._vacuum = f.vacuum;
    this._vacuumOpacity = f.vacuumOpacity;
  }

  // next wall cut of the floor's renders (the page's "ready" cuts); kept in this browser
  _nextCut() {
    if (!this._page) return;
    const cuts = this._page.cuts, i = cuts.indexOf(this._cut);
    if (cuts.length < 2) return;
    this._setCut(cuts[(i + 1) % cuts.length]);
  }

  _setCut(c) {
    if (!this._page || c === this._cut) { this._fly = null; if (this._page) this._buildDock(); return; }
    this._fly = null;
    this._cut = c;
    try { localStorage.setItem(CUT_KEY, this._cut); } catch (e) { /* private mode: this session only */ }
    this._post({ gf: "cut", mode: this._cut });
    this._buildDock();                        // the button's icon (the page answers "ready" if the picture changes)
  }

  _nextFloor() {
    if (this._floors.length < 2 || !this._page) return;
    this._setFloor((this._fi + 1) % this._floors.length);
  }

  _setFloor(i) {
    this._fly = null;
    if (!this._page) return;
    if (i === this._fi) { this._buildDock(); return; }
    this._fi = i;
    this._useFloor();
    this._room = 0;
    this._cam = 0;
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
    if (this._pop && this._pop.update) this._pop.update();
    if (this._pop && this._pop.card) this._pop.card.hass = hass;
    this._sideRender();
  }

  connectedCallback() {
    if (this._root && !this._clockTimer) this._clockTimer = setInterval(() => this._feed(), 15000);
  }

  _tz() { return (this._hass && this._hass.config && this._hass.config.time_zone) || undefined; }

  disconnectedCallback() { clearInterval(this._clockTimer); this._clockTimer = null; this._closePopup(); }

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
      <ha-card><div class="err" hidden></div><div class="wrap"><iframe title="floor"></iframe><div class="dock"></div><div class="side"></div></div></ha-card>`;
    this._wrap = this._root.querySelector(".wrap");
    this._frame = this._root.querySelector("iframe");
    this._dock = this._root.querySelector(".dock");
    this._side = this._root.querySelector(".side");
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
    // remote: keys of this document and of the page's (focus may be in the iframe); a touch or click drops the pick
    const kd = (e) => this._key(e, true), ku = (e) => this._key(e, false), pd = () => this._keyDrop();
    const listen = (w) => { w.addEventListener("keydown", kd); w.addEventListener("keyup", ku); w.addEventListener("pointerdown", pd, true); };
    listen(window);
    this._frame.addEventListener("load", () => { try { listen(this._frame.contentWindow); } catch (e) { /* not the same origin */ } });
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
                     cuts: Array.isArray(d.cuts) ? d.cuts : ["none"],
                     centres: new Map(d.entities.filter((e) => Array.isArray(e.box) && e.box[2] > e.box[0]).map((e) => {
                       const b = e.box, [sx, sy] = e.shift || [0, 0];
                       return [e.id, [(b[0] + b[2]) / 2 + sx, (b[1] + b[3]) / 2 + sy]];
                     })) };
      if (d.cut == null && this._cut !== "none") this._post({ gf: "cut", mode: this._cut });   // an older page
      this._sent = {};
      this._fed = false;
      this._linkSent = null;                  // a reloaded page has no link: send it again
      this._wrap.style.aspectRatio = d.W + " / " + d.H;
      this._ratio = d.W / d.H;
      this._fit();
      this._hlSent = null;                    // a new page or floor glows nothing yet
      if (this._kz === "house" && !this._navigable().includes(this._kid)) this._kz = null;   // another floor
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
    for (const [d, v] of Object.entries(this._show || {}))
      if (typeof v === "string" && !hass.states[v]) out.push(`show.${d}: ${v} is not in Home Assistant`);
    if (this._vacuum && !hass.states[this._vacuum]) out.push(`vacuum_map: ${this._vacuum} is not in Home Assistant`);
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
        else if (type === "valve" && v !== 0 && v !== 1)
          out.push(`${id}: value of a valve is 0 (closed) or 1 (open), not ${JSON.stringify(v)}`);
        else if (type === "climate" && !(typeof v === "string" && v.trim().split(/\s+/).length === 4))
          out.push(`${id}: value of a climate is "mode action current target" ("-" where unknown), not ${JSON.stringify(v)}`);
        else if (!INPUTS[type]) out.push(`${id}: a ${type} entity takes no value`);
        continue;
      }
      const domain = e.entity.split(".")[0];
      if (domainOf(type) !== domain) out.push(`${id}: a ${type} entity, ${e.entity} is a ${domain}`);
      else if (!hass.states[e.entity]) out.push(`${id}: ${e.entity} is not in Home Assistant (set it to none)`);
      if (e.humidity != null && (type !== "climate" || typeof e.humidity !== "string" || !hass.states[e.humidity]))
        out.push(`${id}: humidity is a sensor in Home Assistant, for a climate only (${e.humidity})`);
      if (e.motion != null && (type !== "camera" || typeof e.motion !== "string" || !hass.states[e.motion]))
        out.push(`${id}: motion is a binary sensor in Home Assistant, for a camera only (${e.motion})`);
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
    for (const [d, v] of Object.entries(this._show || {}))   // decor: fixed, or while its entity is on
      send("show:" + d, { gf: "show", id: d, value: typeof v === "boolean" ? v : this._hass.states[v].state === "on" });
    if (this._vacuum)                                 // the vacuum map: only while the dock's vacuum mode is on
      send("vacuum", this._mode === "vacuum" ? this._vacuumMsg(this._hass.states[this._vacuum]) : { gf: "vacuum", src: null });
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
      if (!INPUTS[this._page.entities.get(id)]) continue;   // other types take no input
      const v = this._value(id, e);
      if (v != null) send(id, { gf: "set", id, value: v });
      if (this._page.entities.get(id) === "cover") {      // moving: the page draws arrows on it
        const st = this._hass.states[e.entity].state;
        send("move:" + id, { gf: "move", id, value: st === "opening" || st === "closing" ? st : null });
      }
    }
    for (const [id, e] of this._local) {                // page-only covers: their position from this browser
      if (e.color) send("color:" + id, { gf: "color", id, value: e.color });
      send("available:" + id, { gf: "available", id, value: true });
      send(id, { gf: "set", id, value: this._localValue(id) });
    }
    if (!this._fed) { this._fed = true; this._post({ gf: "fed" }); }   // first inputs are in: the page may show itself
    this._clock();
  }

  // the vacuum's map for the page: its picture, robot mm <-> map px, the no-go zones (robot mm) to cut out
  _vacuumMsg(st) {
    const a = st.attributes || {}, cal = a.calibration_points;
    if (st.state === "unavailable" || !a.entity_picture || !Array.isArray(cal) || cal.length !== 3) return { gf: "vacuum", src: null };
    const trim = [];
    for (const r of Object.values(a.rooms || {}))
      if (r && /^no ?go/i.test(String(r.custom_name || r.name || "")) && [r.x0, r.y0, r.x1, r.y1].every(Number.isFinite))
        trim.push([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]);
    for (const z of a.no_go_areas || [])
      if (z && [z.x0, z.y0, z.x1, z.y1, z.x2, z.y2, z.x3, z.y3].every(Number.isFinite))
        trim.push([[z.x0, z.y0], [z.x1, z.y1], [z.x2, z.y2], [z.x3, z.y3]]);
    const msg = { gf: "vacuum", src: a.entity_picture, calib: cal.map((c) => ({ vacuum: c.vacuum, map: c.map })), trim };
    const op = this._opacity();
    if (op != null) msg.opacity = op;
    return msg;
  }

  // the vacuum map's opacity 0-1: a number, or an entity's state (a % unit or a value over 1: 0-100)
  _opacity() {
    const o = this._vacuumOpacity;
    if (typeof o !== "string") return o;
    const st = this._hass.states[o], v = st ? parseFloat(st.state) : NaN;
    if (!Number.isFinite(v)) return null;
    const pct = (st.attributes || {}).unit_of_measurement === "%" || v > 1;
    return Math.min(1, Math.max(0, pct ? v / 100 : v));
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
    if (type === "valve") return st.state === "open" || st.state === "opening" ? 1 : 0;
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
      case "popup":
        this._openPopup(act);
        break;
      case "camera":
        this._openCamera(act.entity || e.entity, act, act.title || e.name);
        break;
      default:
        console.warn("gungors-floor-card: unknown action " + act.action);
    }
  }

  // popup: a window over the screen holding the Lovelace card of the action
  async _openPopup(act) {
    this._closePopup();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${POP_CSS}</style><div class="pop"><div class="box">
      <div class="head"><span></span><button title="close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="body"></div></div></div>`;
    root.querySelector(".head span").textContent = act.title || "";
    const pop = { host, card: null, onKey: (e) => { if (e.key === "Escape") this._closePopup(); }, onClose: act.onClose };
    root.querySelector("button").addEventListener("click", () => this._closePopup());
    // a tap beside the window closes it, but only one that also started there: the click that ends the
    // tap opening the popup (the dock's screen acts on pointerup) lands on this backdrop and must not close it
    const back = root.querySelector(".pop");
    let downOnBack = false;
    back.addEventListener("pointerdown", (e) => { downOnBack = e.target === e.currentTarget; });
    back.addEventListener("click", (e) => { if (e.target === e.currentTarget && downOnBack) this._closePopup(); downOnBack = false; });
    window.addEventListener("keydown", pop.onKey);
    document.body.appendChild(host);
    this._pop = pop;
    if (act.camera) { this._cameraBody(pop, root.querySelector(".body"), act.camera); return; }
    try {
      const helpers = await window.loadCardHelpers();
      if (this._pop !== pop) return;                  // closed while the helpers loaded
      pop.card = helpers.createCardElement(act.card);
      pop.card.hass = this._hass;
      root.querySelector(".body").appendChild(pop.card);
    } catch (e) {
      root.querySelector(".body").textContent = "popup card failed: " + e.message;
    }
  }

  _closePopup() {
    if (!this._pop) return;
    const pop = this._pop;
    window.removeEventListener("keydown", pop.onKey);
    clearTimeout(pop.timer);
    if (pop.drop) pop.drop();
    pop.host.remove();
    this._pop = null;
    if (pop.onClose) pop.onClose();
  }

  // live view of a camera: start its stream if it is not streaming, show it in a popup once it streams,
  // stop it again when the popup closes (only a stream this card started)
  _openCamera(entity, act, title) {
    const st = this._hass.states[entity];
    if (!st) return;
    // over the websocket, not hass.callService: a failure goes to the popup, not to a toast
    const call = (svc) => { const [d, s] = svc.split(".");
      return this._hass.callWS({ type: "call_service", domain: d, service: s, target: { entity_id: entity } }); };
    let start = null, stop = null;
    if (st.state !== "streaming") {
      const onOff = (st.attributes.supported_features || 0) & 1;    // CameraEntityFeature.ON_OFF
      start = act.start || (onOff ? "camera.turn_on" : null);
      if (start) stop = act.stop || (onOff ? "camera.turn_off" : null);
    }
    // stop only a stream that started: a failed start leaves nothing running (stopping it would fail too)
    let started = false;
    this._openPopup({ title: title || st.attributes.friendly_name || entity, camera: entity,
                      onClose: stop ? () => { if (started) call(stop).catch(() => {}); } : null });
    const pop = this._pop;
    // a sleeping battery camera may miss the first start (Eufy gives up after 15 s): try once more
    const ok = () => { started = true; if (stop && this._pop !== pop) call(stop).catch(() => {}); };
    const bad = (e) => { if (this._pop === pop && pop.fail) pop.fail("the stream could not start" + (e && e.message ? ": " + e.message : "")); };
    if (start) call(start).then(ok, () => {
      if (this._pop !== pop) return;
      if (pop.retry) pop.retry();
      call(start).then(ok, bad);
    });
  }

  // popup body of a live view: a message until the camera streams, then its live picture
  _cameraBody(pop, body, entity) {
    const msg = (t) => { body.innerHTML = `<div class="msg"></div>`; body.firstChild.textContent = t; };
    msg("starting the stream...");
    // camera_proxy / camera_proxy_stream of the camera, with its access token (it changes every few minutes)
    const api = (path) => {
      const s = this._hass.states[entity], m = s && /[?&]token=([^&]+)/.exec(s.attributes.entity_picture || "");
      const u = `/api/${path}/${entity}` + (m ? "?token=" + m[1] : "");
      const url = this._hass.hassUrl ? this._hass.hassUrl(u) : u;
      return url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();      // never a cached answer
    };
    // The camera's video reaches its video server (Eufy: go2rtc) only seconds after the camera turns
    // "streaming", so Home Assistant's HLS player opened then stays blank. The picture is built from what
    // works once the video is there instead: camera_proxy frames (a Eufy camera that is not streaming gives an
    // encrypted thumbnail, not a JPEG), fetched one after the other. Next to them the MJPEG stream
    // (camera_proxy_stream) is opened hidden; once it draws a frame it replaces the frames.
    const frame = async () => {
      const r = await fetch(api("camera_proxy"), { cache: "no-store" });
      if (!r.ok) return null;
      const blob = await r.blob(), head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      return head[0] === 0xff && head[1] === 0xd8 ? blob : null;
    };
    const streaming = () => { const s = this._hass.states[entity]; return !!s && s.state === "streaming"; };
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const show = async () => {
      pop.update = null;
      clearTimeout(pop.timer);
      msg("connecting to the camera...");
      const end = Date.now() + STREAM_WAIT_MS;
      let blob = null;
      while (this._pop === pop && streaming() && Date.now() < end && !blob) {
        try { blob = await frame(); } catch (e) { /* not ready yet */ }
        if (!blob) await sleep(1000);
      }
      if (this._pop !== pop) return;
      if (!blob) { msg(streaming() ? "no picture from the camera" : "the camera stopped streaming"); return; }
      body.innerHTML = `<img class="cam" alt=""><img class="cam" alt="" hidden>`;
      const [still, live] = body.querySelectorAll("img");
      let url = URL.createObjectURL(blob), isLive = false;
      still.src = url;
      pop.drop = () => { live.removeAttribute("src"); URL.revokeObjectURL(url); };
      // MJPEG: an <img> fires no load event per frame, so watch for its first frame (naturalWidth)
      let tries = 0;
      const open = () => {
        if (this._pop !== pop || isLive || ++tries > 5) return;
        live.src = api("camera_proxy_stream");
        const t0 = Date.now(), seen = () => {
          if (this._pop !== pop || isLive) return;
          if (live.naturalWidth > 0) { isLive = true; live.hidden = false; still.remove(); return; }
          if (Date.now() - t0 < 8000) setTimeout(seen, 250);
          else { live.removeAttribute("src"); setTimeout(open, 1000); }
        };
        seen();
      };
      live.onerror = () => { if (this._pop === pop && !isLive) { live.removeAttribute("src"); setTimeout(open, 2000); } };
      open();
      // frames until the stream draws, or the camera stops streaming
      while (this._pop === pop && !isLive && streaming()) {
        let next = null;
        try { next = await frame(); } catch (e) { /* skip this frame */ }
        if (this._pop !== pop || isLive) break;
        if (next) { URL.revokeObjectURL(url); url = URL.createObjectURL(next); still.src = url; }
        else await sleep(1000);
      }
      if (this._pop === pop && !isLive && !streaming()) msg("the camera stopped streaming");
    };
    pop.update = () => { const s = this._hass.states[entity]; if (s && s.state === "streaming") show(); };
    pop.fail = (t) => { pop.update = null; clearTimeout(pop.timer); msg(t); };
    const wait = () => setTimeout(() => {
      if (this._pop !== pop || !pop.update) return;
      pop.update = null;
      msg("the camera did not start streaming");
    }, STREAM_WAIT_MS);
    pop.timer = wait();
    pop.retry = () => { clearTimeout(pop.timer); msg("waking the camera, trying again..."); pop.timer = wait(); };
    pop.update();
  }

  // ------------------------------------------------------------------ dock (quarter-disc control panel, bottom left)
  _buildDock() {
    // see DOCK: the floor button on the top edge, the cut button on the right edge, the modes along the slanted
    // edge (heating lowest), each 46 px inside its edge; floor and cut open their choices (up / right) when pressed
    const R = this._config.dock_radius, d = this._dock, H = this._page.H, g = this._dockGeo();
    if (!DOCK_MODES.some((m) => m.id === this._mode && m.icon)) this._mode = "heating";
    const btns = DOCK_MODES.map((m) => {
      const c = g.at[m.id];
      const isFloor = m.id === "floor", isCut = m.id === "cut";
      const single = isFloor ? this._floors.length < 2 : isCut ? this._page.cuts.length < 2
        : m.id === "heating" ? !this._climates().length : m.id === "camera" ? !this._cameras().length
        : m.id === "vacuum" && !this._vacuums().length;
      const icon = isFloor ? floorIcon(this._floor) : isCut ? CUT_ICON[this._cut] : m.icon;
      const title = isFloor ? this._floor + (single ? "" : " (next floor)") : isCut ? CUT_TITLE[this._cut]
        : m.id === "heating" ? "heating" + (single ? ": no climates" : " (next room)")
        : m.id === "camera" ? "cameras" + (single ? ": none on this floor" : " (next camera)")
        : m.id === "vacuum" ? "vacuum" + (single ? ": none on this floor" : " (map)") : m.title;
      if (isFloor || isCut) {                                     // a cell in its corner, its choice in words
        const r = g.cell[m.id], lb = isFloor ? floorLabel(this._floor) : CUT_LABEL[this._cut];
        const poly = r.pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",");
        return `<button class="cell ${m.id}${single ? " single" : ""}${this._fly === m.id ? " open" : ""}" data-mode="${m.id}" title="${title}"
                  style="${rectCss(r)};-webkit-clip-path:polygon(${poly});clip-path:polygon(${poly})"><ha-icon icon="${icon}"></ha-icon><span>${lb}</span></button>`;
      }
      return `<button class="btn${single ? " single" : ""}" data-mode="${m.id}" title="${title}"
                style="left:${c[0] - 35}px;top:${c[1] - 35}px"><ha-icon icon="${icon}"></ha-icon></button>`;
    }).join("");
    const opts = this._flyOpts().map((o, i) => `<button class="cell opt${o.on ? " active" : ""}" data-opt="${i}" title="${o.title}"
                style="${rectCss(o.r)}"><ha-icon icon="${o.icon}"></ha-icon><span>${o.label}</span></button>`).join("");
    const fc = g.cell.floor, cc = g.cell.cut;
    const P = (r, i) => `${(r.x + r.pts[i][0]).toFixed(1)},${(r.y + r.pts[i][1]).toFixed(1)}`;
    const lines = `<path class="div" d="M${P(fc, 1)}L${P(fc, 2)}L${P(fc, 3)}M${P(cc, 0)}L${P(cc, 3)}L${P(cc, 2)}"/>`;
    const pts = (k) => g.poly.map(([x, y]) => `${(x * k).toFixed(1)},${(R - (R - y) * k).toFixed(1)}`).join(" ");
    d.style.width = g.W + "px"; d.style.height = R + "px";
    d.style.top = ((H - R) / H * 100) + "%";
    const clip = g.poly.map(([x, y]) => `${x}px ${y}px`).join(",");
    d.innerHTML = `<div class="disc" style="-webkit-clip-path:polygon(${clip});clip-path:polygon(${clip})"></div>
      <svg class="rim" viewBox="0 0 ${g.W} ${R}"><polygon points="${pts(1)}"/>${lines}</svg>${btns}${opts}
      <div class="screen"><div class="top"><span class="clock"></span><span class="date"></span></div>
        <div class="title"></div><div class="list"></div></div>`;
    d.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => this._flyPick(+b.dataset.opt)));
    d.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      const fm = b.dataset.mode;
      if (fm === "floor" || fm === "cut") {                                   // open / close its choices
        if (b.classList.contains("single")) return;   // one floor / one cut: nothing to choose
        this._fly = this._fly === fm ? null : fm;
        this._flyI = Math.max(0, this._flyOpts().findIndex((o) => o.on));
        this._buildDock();
        return;
      }
      if (this._fly) { this._fly = null; this._buildDock(); }
      if (b.dataset.mode === "heating" && this._mode === "heating") {        // heating again: the next room
        const n = this._climates().length;
        if (n < 2) return;
        this._room = ((this._room || 0) + 1) % n;
      }
      if (b.dataset.mode === "camera" && this._mode === "camera") {          // cameras again: the next camera
        const n = this._cameras().length;
        if (n < 2) return;
        this._cam = ((this._cam || 0) + 1) % n;
      }
      if (b.dataset.mode === "vacuum" && this._mode === "vacuum") {          // vacuum again: the next vacuum
        const n = this._vacuums().length;
        if (n < 2) return;
        this._vac = ((this._vac || 0) + 1) % n;
      }
      this._mode = b.dataset.mode;
      this._renderList(true);
      this._compass();
      this._feed();                                                            // the vacuum map: only in the vacuum mode
    }));
    // the screen in the heating / camera mode: the room's / camera's tap / hold actions, hover highlights it on the page
    const scr = d.querySelector(".screen"), room = () => this._selected();
    let timer = null, held = false;
    scr.addEventListener("mouseenter", () => { const r = room(); if (r) this._post({ gf: "highlight", id: r.id }); });
    scr.addEventListener("mouseleave", () => { clearTimeout(timer); this._post({ gf: "highlight", id: null }); });
    scr.addEventListener("pointerdown", () => {
      held = false;
      const r = room();
      if (r) timer = setTimeout(() => { held = true; this._run(r.id, "hold"); }, HOLD_MS);
    });
    scr.addEventListener("pointerup", () => { clearTimeout(timer); const r = room(); if (r && !held) this._run(r.id, "tap"); });
    scr.addEventListener("contextmenu", (ev) => { if (room()) ev.preventDefault(); });
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => this._feed(), 15000);          // the clock moves on without state changes
    this._clock();
    this._renderList(true);
    this._compass();
    this._fitDock();
    this._keyApply();
  }

  // the dock's outline (dock px, top left origin) and its buttons' centres
  _dockGeo() {
    const R = this._config.dock_radius, dy = R - DOCK.side, dx = dy / DOCK.slope, W = Math.round(DOCK.top + dx);
    const L = Math.hypot(dx, dy), u = [dx / L, dy / L], n = [-u[1], u[0]], at = {};
    ["vacuum", "camera", "sun", "heating"].forEach((id, k) => {   // evenly along the slanted edge, centred on it
      const t = L / 2 - 10 + (k - 1.5) * DOCK.gap;                // a group in the middle of the edge, clear of the cells
      at[id] = [DOCK.top + u[0] * t + n[0] * 46, u[1] * t + n[1] * 46];
    });
    // the corner cells: bands along the top and the right edge (DOCK.cellH / cellW deep), cut off from the slanted
    // edge by mitres (the lines halving the corners' angles), like the corners of a frame; pts: in the cell's box
    const off = (b, s) => [DOCK.top + n[0] * b + u[0] * s, n[1] * b + u[1] * s];   // inside the slanted edge by b
    const mt = off(DOCK.cellH, DOCK.cellH * (1 - n[1]) / u[1]);                     // top mitre's inner end (y = cellH)
    const mx = W - DOCK.cellW, mb = off(DOCK.cellW, (mx - DOCK.top - n[0] * DOCK.cellW) / u[0]);  // right mitre's (x = mx)
    const cell = {
      floor: { x: 0, y: 0, w: DOCK.top, h: DOCK.cellH, pts: [[0, 0], [DOCK.top, 0], [mt[0], DOCK.cellH], [0, DOCK.cellH]] },
      cut: { x: mx, y: dy, w: DOCK.cellW, h: R - dy, pts: [[DOCK.cellW, 0], [DOCK.cellW, R - dy], [0, R - dy], [0, mb[1] - dy]] },
    };
    return { W, at, cell, poly: [[0, 0], [DOCK.top, 0], [W, dy], [W, R], [0, R]] };
  }

  // the choices of the open floor / cut button: floors upwards from the floor button, cuts rightwards from the cut button
  _flyOpts() {
    if (!this._fly || !this._page) return [];
    const g = this._dockGeo();
    if (this._fly === "floor") return this._floors.map((f, i) => ({ v: i, on: i === this._fi, icon: floorIcon(f.floor),
      label: floorLabel(f.floor), title: f.floor, r: { x: 0, y: -(i + 1) * 62, w: DOCK.top, h: 56 } }));
    return this._page.cuts.map((c, i) => ({ v: c, on: c === this._cut, icon: CUT_ICON[c], label: CUT_LABEL[c],
      title: CUT_TITLE[c], r: { x: g.W + 8 + i * 108, y: g.cell.cut.y, w: DOCK.cellW, h: DOCK.side } }));
  }

  _flyPick(i) {
    const o = this._flyOpts()[i];
    if (!o) return;
    if (this._fly === "floor") this._setFloor(o.v); else this._setCut(o.v);
  }

  // ------------------------------------------------------------------ remote (TV remote, keyboard)
  _key(ev, down) {
    if (!this.isConnected || !this._page || !this._hass) return;
    if (!KIOSK && !(KIOSK = kioskUrl())) return;    // not the kiosk: the remote is off
    const k = ev.key, back = k === "Escape" || k === "GoBack" || k === "BrowserBack";
    if (this._pop) {                                  // a popup is open: back or OK closes it, other keys are its own
      const okKey = k === "Enter" || k === " " || k === "Select";
      if (down && !ev.repeat && (back || okKey)) { ev.preventDefault(); this._closePopup(); }
      return;
    }
    const path = ev.composedPath ? ev.composedPath() : [];
    if (path.some((n) => n && n.tagName && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || /DIALOG/.test(n.tagName) || n.isContentEditable)))
      return;                                         // a text field or a Home Assistant dialog has the keys
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    const colour = COLOUR_KEYS[k] || COLOUR_CODES[ev.keyCode];
    if (colour) {                                     // red: the dock, blue: the side panel, green / yellow: the house
      ev.preventDefault();
      if (down && !ev.repeat) this._keyFocus(colour);
      return;
    }
    const ok = k === "Enter" || k === " " || k === "Select";
    if (this._kCtl) {                                 // the side panel has the control
      if (!(dir || ok || back)) return;
      ev.preventDefault();
      if (!down || (ev.repeat && !dir)) return;
      if (back || dir && dir[1]) this._kCtl = false;  // back (Fully may keep it) or up / down: control back to the house
      else if (ok) this._sideToggle();
      else if (dir[0]) this._sideStep(dir[0]);
      this._keyApply();
      return;
    }
    const floorKey = k === "ChannelUp" || k === "ChannelDown" || k === "PageUp" || k === "PageDown";
    if (!down && ok && this._kFlyUp) { ev.preventDefault(); this._kFlyUp = false; return; }   // the OK that picked a choice
    if (down && this._fly && this._kz === "dock" && (dir || ok || back)) {   // floor / cut choices open: walk them, OK picks
      ev.preventDefault();
      if (ev.repeat && !dir) return;
      const n = this._flyOpts().length, step = !dir ? 0 : this._fly === "floor" ? -dir[1] : dir[0];
      if (ok) { this._kFlyUp = true; this._flyPick(this._flyI); }
      else if (back || !step || this._flyI + step < 0) this._fly = null;   // back, across or before the first: closed
      else this._flyI = Math.min(n - 1, this._flyI + step);
      this._buildDock();
      return;
    }
    if (!down) {                                      // key up: only OK's, a tap unless it became a hold
      const p = this._kPress;
      if (ok && p) { ev.preventDefault(); this._kPress = null; clearTimeout(p.timer); if (!p.held) this._keyAct(p, "tap"); }
      return;
    }
    if (back) {                                       // back: out of the dock, else drop the pick; nothing picked: not ours
      if (!this._kz) return;
      ev.preventDefault();
      this._kz = this._kz === "dock" && this._navigable().includes(this._kid) ? "house" : null;
      this._keyApply();
      return;
    }
    if (!dir && !ok && !floorKey) return;
    ev.preventDefault();
    if (ev.repeat && !dir) return;                    // a held OK: one press (its hold runs from the timer)
    if (floorKey) { this._nextFloor(); return; }
    if (ok) {
      const t = this._keyTarget();
      if (!t) return;
      const p = { ...t, held: false };
      if (t.id) p.timer = setTimeout(() => { p.held = true; this._keyAct(p, "hold"); }, HOLD_MS);
      this._kPress = p;
      return;
    }
    const nav = this._navigable();
    if (this._kz === "dock") {
      const items = DOCK_KEYS, i = Math.max(0, items.indexOf(this._kd));
      if (dir[1]) this._kd = items[Math.min(items.length - 1, Math.max(0, i - dir[1]))];   // up: round the edges, up
      else if (dir[0] > 0 && nav.length) {                                                // right: back to the house
        this._kz = "house";
        if (!nav.includes(this._kid)) this._kid = this._keyNearest(nav, "corner");
      }
    } else if (this._kz !== "house" || !nav.includes(this._kid)) {   // the first arrow picks the middle of the house
      if (nav.length) { this._kz = "house"; this._kid = this._keyNearest(nav, "middle"); }
      else { this._kz = "dock"; this._kd = this._mode; }
    } else {
      const next = this._keyStep(nav, this._kid, dir);
      if (next) this._kid = next;
      else if (dir[0] < 0 || dir[1] > 0) { this._kz = "dock"; this._kd = this._mode; }   // left / down past the house: the dock
    }
    this._keyApply();
  }

  // entities the remote can pick on the floor shown: on the picture, with a tap or hold action (page-only covers too)
  _navigable() {
    const out = [];
    if (!this._page || !this._page.centres || !this._hass) return out;
    for (const id of this._page.centres.keys()) {
      if (this._local.has(id)) { out.push(id); continue; }
      const e = this._map.get(id);
      if (!e || e.selectable === false || !this._hass.states[e.entity]) continue;
      if ([e.tap_action, e.hold_action].some((a) => a && a.action && a.action !== "none")) out.push(id);
    }
    return out;
  }

  // the entity nearest the middle of all of them, or the bottom-left corner (coming back from the dock)
  _keyNearest(nav, where) {
    const c = nav.map((id) => this._page.centres.get(id)), xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    const t = where === "corner" ? [Math.min(...xs), Math.max(...ys)]
      : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    let best = nav[0], bd = Infinity;
    nav.forEach((id, n) => { const d = Math.hypot(c[n][0] - t[0], c[n][1] - t[1]); if (d < bd) { bd = d; best = id; } });
    return best;
  }

  // the next entity in a direction: ahead of the one picked (within about 70 degrees), near and close to the line
  _keyStep(nav, from, dir) {
    const [cx, cy] = this._page.centres.get(from);
    let best = null, bs = Infinity;
    for (const id of nav) {
      if (id === from) continue;
      const [x, y] = this._page.centres.get(id), vx = x - cx, vy = y - cy;
      const along = vx * dir[0] + vy * dir[1], side = Math.abs(vx * dir[1] - vy * dir[0]);
      if (along <= 0 || side > along * 3) continue;
      const sc = along + 2 * side;
      if (sc < bs) { bs = sc; best = id; }
    }
    return best;
  }

  // what OK acts on: the entity picked, the dock screen's room / camera / vacuum, or a dock button
  _keyTarget() {
    if (this._kz === "house") return this._kid ? { id: this._kid } : null;
    if (this._kz !== "dock") return null;
    if (this._kd === "screen") { const r = this._selected(); return r ? { id: r.id } : null; }
    return { mode: this._kd };
  }

  _keyAct(p, which) {
    if (p.id && which === "hold" && this._kz === "house") {   // a long OK: the side panel's control, where the type has one
      const i = this._sideCtl();
      if (i && i.ctl) { this._kCtl = true; this._keyApply(); return; }
    }
    const e = p.id && this._map.get(p.id), act = e && e[which + "_action"];
    if (act && act.action === "more-info") return;    // Home Assistant's dialog: the remote could not close it (Fully keeps back)
    if (p.id) this._run(p.id, which);
    else {
      const b = this._dock.querySelector(`[data-mode="${p.mode}"]`);
      if (b) b.click();
    }
    this._keyApply();
  }

  // a colour key: move the remote's focus to the dock, the side panel's control or the house
  _keyFocus(colour) {
    const nav = this._navigable();
    clearTimeout(this._kPress && this._kPress.timer);
    this._kPress = null;
    if (this._fly) { this._fly = null; this._buildDock(); }
    if (colour === "red") { this._kCtl = false; this._kz = "dock"; if (!DOCK_KEYS.includes(this._kd)) this._kd = this._mode; }
    else {
      if (nav.length) {
        this._kz = "house";
        if (!nav.includes(this._kid)) this._kid = this._keyNearest(nav, "middle");
      }
      this._keyApply();                               // the panel follows the pick before its control is taken
      this._kCtl = colour === "blue" && this._kz === "house" && !!(this._sideCtl() || {}).ctl;
    }
    this._keyApply();
  }

  _keyDrop() {
    if (this._fly) { this._fly = null; if (this._page) this._buildDock(); }
    if (!this._kz) return;
    this._kz = null;
    this._kCtl = false;
    this._keyApply();
  }

  // the pick shown: a white ring on the dock's button / screen, a glow on the page (the entity, or the screen's room)
  _keyApply() {
    if (!this._dock) return;
    // idle: the panel's control ends after KEY_CTL_MS, the pick after KEY_IDLE_MS without a key (the TV goes back to just showing)
    clearTimeout(this._kIdle);
    if (this._kz) this._kIdle = setTimeout(() => {
      if (this._kCtl) { this._kCtl = false; this._keyApply(); } else this._keyDrop();
    }, this._kCtl ? KEY_CTL_MS : KEY_IDLE_MS);
    if (this._kz !== "house" || this._kCtl && !(this._sideCtl() || {}).ctl) this._kCtl = false;
    if (this._kid !== this._sideId) { this._kCtl = false; this._sideId = this._kid; this._sidePending = null; }
    this._sideRender();
    const fly = this._fly && this._kz === "dock";
    this._dock.querySelectorAll("[data-mode], .screen").forEach((el) =>
      el.classList.toggle("kf", this._kz === "dock" && !fly && (el.dataset.mode || "screen") === this._kd));
    this._dock.querySelectorAll(".opt").forEach((el) => el.classList.toggle("kf", fly && +el.dataset.opt === this._flyI));
    let hl = null;
    if (this._kz === "house") hl = this._kid;
    else if (this._kz === "dock" && this._kd === "screen") { const r = this._selected(); hl = r ? r.id : null; }
    if (hl === (this._hlSent || null)) return;
    this._hlSent = hl;
    this._post({ gf: "highlight", id: hl });
  }

  // ------------------------------------------------------------------ side panel (the entity picked with the remote)
  // the entity picked in the house: {id, type, e (YAML), st (state; null for a page-only cover)}, else null
  _sideItem() {
    if (this._kz !== "house" || !this._kid || !this._page || !this._hass) return null;
    const id = this._kid, type = this._page.entities.get(id);
    if (this._local.has(id)) return { id, type: "cover", e: this._local.get(id), st: null };
    const e = this._map.get(id), st = e && this._hass.states[e.entity];
    return st ? { id, type, e, st } : null;
  }

  // what the panel shows and what its control does, per type; human words, no technical attributes
  _sideInfo(it) {
    const { id, type, e, st } = it, a = st ? st.attributes : {}, hass = this._hass;
    const na = st && (st.state === "unavailable" || st.state === "unknown");
    const pend = this._sidePending && Date.now() - this._sidePending.t < 4000 ? this._sidePending.v : null;
    const call = (d, s, data) => hass.callService(d, s, { entity_id: e.entity, ...data });
    const pct = (v) => "%" + Math.round(v);
    const info = { kind: "cihaz", icon: "mdi:information-outline", color: OTHER_COLOR, on: !na, word: na ? "ulaşılamıyor" : st ? st.state : "", value: "", bar: null };
    if (type === "light") {
      const dims = !Array.isArray(a.supported_color_modes) || a.supported_color_modes.some((m) => m !== "onoff");
      const own = st.state === "on" ? (a.brightness == null ? 100 : Math.round(a.brightness / 2.55)) : 0;
      if (pend != null && (pend === 0 ? st.state === "off" : st.state === "on" && Math.abs(own - pend) <= 1)) this._sidePending = null;
      const v = na ? 0 : pend != null ? pend : own, rgb = Array.isArray(a.rgb_color) ? a.rgb_color : null;
      return { kind: "lamba", svg: BULB, color: rgb ? `rgb(${rgb.join(",")})` : "#ffc35a", on: v > 0, word: na ? "ulaşılamıyor" : v > 0 ? "açık" : "kapalı",
        value: v > 0 && dims ? pct(v) : "—", bar: dims ? v : null, adj: "parlaklık", okWord: "aç/kapa", ctl: !na,
        step: dims ? (d) => { const n = Math.max(0, Math.min(100, Math.round((v + d * 10) / 10) * 10)); if (n === v) return;
          this._sidePending = { v: n, t: Date.now() }; n ? call("light", "turn_on", { brightness_pct: n }) : call("light", "turn_off"); } : null,
        ok: () => { this._sidePending = null; call("light", st.state === "on" ? "turn_off" : "turn_on"); } };
    }
    if (type === "cover") {
      const local = !st, own = local ? this._localValue(id) : a.current_position != null ? a.current_position : st.state === "closed" ? 0 : 100;
      if (pend != null && Math.abs(own - pend) <= 1) this._sidePending = null;
      const v = na ? 0 : pend != null ? pend : own, moving = st && (st.state === "opening" || st.state === "closing");
      const hasPos = local || a.current_position != null;
      const set = (n) => { this._sidePending = { v: n, t: Date.now() };
        if (local) this._setLocal(id, n); else if (hasPos) call("cover", "set_cover_position", { position: n }); else call("cover", n ? "open_cover" : "close_cover"); };
      return { kind: local ? "kapı" : "perde", icon: v > 0 ? "mdi:window-shutter-open" : "mdi:window-shutter", color: "#5fb4ff", on: v > 0,
        word: na ? "ulaşılamıyor" : moving ? (st.state === "opening" ? "açılıyor" : "kapanıyor") : v >= 100 ? "açık" : v <= 0 ? "kapalı" : "kısmen açık",
        value: na ? "—" : pct(v), bar: v, adj: "pozisyon", okWord: moving ? "dur" : v > 0 ? "kapat" : "aç", ctl: !na,
        step: (d) => { const n = hasPos ? Math.max(0, Math.min(100, Math.round((v + d * 10) / 10) * 10)) : d > 0 ? 100 : 0; if (n !== v) set(n); },
        ok: () => { if (moving) call("cover", "stop_cover"); else set(v > 0 ? 0 : 100); } };
    }
    if (type === "climate") {
      const cur = Number(a.current_temperature), lo = Number(a.min_temp) || 5, hi = Number(a.max_temp) || 30, step = Number(a.target_temp_step) || 0.5;
      const own = Number(a.temperature);
      if (pend != null && Math.abs(own - pend) < step / 2) this._sidePending = null;
      const t = pend != null ? pend : own, off = st.state === "off", heating = a.hvac_action === "heating";
      const deg = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) + "°" : "—");
      const modes = Array.isArray(a.hvac_modes) ? a.hvac_modes : ["heat", "off"];
      return { kind: "ısıtma", icon: heating ? "mdi:radiator" : off ? "mdi:radiator-off" : "mdi:radiator", color: heating ? "#ff7a45" : CLIMATE_COLOR, on: !na && !off,
        word: na ? "ulaşılamıyor" : off ? "kapalı" : (heating ? "ısıtıyor" : "bekliyor") + (Number.isFinite(t) ? " · hedef " + deg(t) : ""),
        value: deg(cur), bar: !off && Number.isFinite(t) ? Math.max(0, Math.min(100, (t - lo) / (hi - lo) * 100)) : null,
        adj: "hedef ±" + step, okWord: off ? "aç" : "kapat", ctl: !na,
        step: off || !Number.isFinite(t) ? null : (d) => { const n = Math.max(lo, Math.min(hi, Math.round((t + d * step) / step) * step));
          if (n === t) return; this._sidePending = { v: n, t: Date.now() }; call("climate", "set_temperature", { temperature: n }); },
        ok: () => { this._sidePending = null; call("climate", "set_hvac_mode", { hvac_mode: off ? (modes.find((m) => m !== "off") || "heat") : "off" }); } };
    }
    if (type === "valve") {
      const open = st.state === "open" || st.state === "opening";
      return { kind: "sulama", icon: open ? "mdi:sprinkler-variant" : "mdi:sprinkler", color: "#4fc3f7", on: open,
        word: na ? "ulaşılamıyor" : open ? "sulanıyor" : "kapalı", value: "", bar: null, okWord: open ? "kapat" : "aç", ctl: !na,
        ok: () => call("valve", open ? "close_valve" : "open_valve") };
    }
    if (type === "camera") {
      const ms = e.motion && hass.states[e.motion], live = st.state === "streaming";
      return { kind: "kamera", icon: "mdi:cctv", color: OTHER_COLOR, on: !na,
        word: na ? "ulaşılamıyor" : ms && ms.state === "on" ? "hareket var" : live ? "canlı" : "hazır", value: "", bar: null };
    }
    if (type === "vacuum") {
      const W = { cleaning: "temizliyor", docked: "şarjda", returning: "eve dönüyor", paused: "duraklatıldı", idle: "bekliyor", error: "hata" };
      const busy = st.state === "cleaning" || st.state === "returning";
      return { kind: "süpürge", icon: "mdi:robot-vacuum", color: "#b388ff", on: busy, word: na ? "ulaşılamıyor" : W[st.state] || st.state, value: "", bar: null,
        okWord: st.state === "cleaning" ? "eve gönder" : "başlat", ctl: !na,
        ok: () => call("vacuum", st.state === "cleaning" ? "return_to_base" : "start") };
    }
    if (!na) {                                        // anything else: its state as Home Assistant words it, with its unit
      const u = a.unit_of_measurement;
      info.word = "durum";
      info.value = st.state + (u ? " " + u : "");
      if (info.value.length > 10) { info.word = st.state; info.value = ""; }
    }
    return info;
  }

  // a name for people: the YAML name, else Home Assistant's, else the page id; snake_case ids lose their type and get a capital
  _sideName(it) {
    let n = (it.e && it.e.name) || (it.st && it.st.attributes.friendly_name) || it.id;
    if (/_/.test(n) && !/\s/.test(n)) {
      n = n.replace(/_(light|lamp|cover|blind|climate|thermostat|camera|kamera|valve|vacuum)$/i, "").replace(/_/g, " ");
      n = n.charAt(0).toLocaleUpperCase("tr-TR") + n.slice(1);
    }
    return n;
  }

  _sideCtl() { const it = this._sideItem(); return it ? this._sideInfo(it) : null; }

  _sideStep(d) { const i = this._sideCtl(); if (i && i.ctl && i.step) i.step(d); }

  _sideToggle() { const i = this._sideCtl(); if (i && i.ctl && i.ok) i.ok(); }

  _sideRender() {
    const el = this._side;
    if (!el) return;
    const it = this._hass && this._sideItem();
    if (!it) { el.classList.remove("on"); this._sideSig = null; return; }
    const i = this._sideInfo(it), name = this._sideName(it), ctl = !!this._kCtl && !!i.ctl;
    const fl = /^kat(\d+)$/i.test(this._floor) ? "Kat " + this._floor.slice(3) : this._floor;
    const color = (it.e && it.e.color) || i.color;
    const sig = JSON.stringify([it.id, name, fl, i.kind, i.icon, i.svg ? 1 : 0, color, i.on, i.word, i.value, i.bar, ctl, i.adj, i.okWord, !!i.step]);
    el.classList.add("on");
    if (sig === this._sideSig) return;
    this._sideSig = sig;
    el.classList.toggle("off", !i.on);
    el.classList.toggle("ctl", ctl);
    el.style.setProperty("--lc", color);
    el.style.setProperty("--b", (i.bar || 0) + "%");
    const stroke = ctl ? "#ffd66b" : "#a8dcff", W = SIDE.w, H = SIDE.h;
    const k = (t) => `<span class="k">${t}</span>`;
    const hint = ctl
      ? (i.step ? `<div>${k("◀")}${k("▶")}${i.adj}</div>` : "") + (i.ok ? `<div>${k("OK")}${i.okWord}</div>` : "") + `<div>${k("▲")}${k("▼")}bitir</div>`
      : (this._sideTapWord(it) ? `<div>${k("OK")}${this._sideTapWord(it)}</div>` : "") + (i.ctl ? `<div>uzun ${k("OK")}kontrol</div>` : "");
    el.innerHTML = `<div class="bg"></div>
      <svg class="edge" viewBox="0 0 ${W} ${H}"><polygon points="1.5,1.5 ${W - 1.5},1.5 ${W - 1.5},${H - 1.5} ${SIDE.x},${H - 1.5} 1.5,${SIDE.y}"
        fill="none" stroke="${stroke}" stroke-width="${ctl ? 3 : 2}" style="filter:drop-shadow(0 0 ${ctl ? 9 : 5}px ${stroke})"/></svg>
      <div class="ico">${i.svg ? `<svg viewBox="0 0 24 24"><path d="${i.svg}"/></svg>` : `<ha-icon icon="${i.icon}"></ha-icon>`}</div>
      <div class="name"></div><div class="sub">${fl} · ${i.kind}</div>
      <div class="w">${i.word}</div><div class="v">${i.value}</div>
      ${i.bar != null ? `<div class="bar"><div class="fill"></div><div class="knob"></div></div>
      <div class="arr" style="left:76px">◀</div><div class="arr" style="right:4px">▶</div>` : ""}
      <div class="hint">${hint}</div>`;
    el.querySelector(".name").textContent = name;
  }

  // what a short OK does on the entity picked (its tap action), in words
  _sideTapWord(it) {
    if (!it.st) return "aç/kapa";
    const a = it.e.tap_action && it.e.tap_action.action;
    return a === "toggle" ? "aç/kapa" : a === "camera" ? "canlı izle" : a === "popup" ? "göster" : a && a !== "more-info" && a !== "none" ? "çalıştır" : "";
  }

  // rooms of the heating mode: the floor's climates mapped to Home Assistant, in the order of the YAML
  _climates() {
    if (!this._page || !this._hass) return [];
    const out = [];
    for (const [id, e] of this._map)
      if (e && e.selectable !== false && this._page.entities.get(id) === "climate" && this._hass.states[e.entity]) out.push({ id, e });
    return out;
  }

  // the room the heating mode shows now (null: the floor has no climates)
  _climate() {
    const list = this._climates();
    if (!list.length) return null;
    if (!(this._room < list.length)) this._room = 0;
    return list[this._room];
  }

  // cameras of the camera mode: the floor's page cameras mapped to Home Assistant, in the order of the YAML
  _cameras() {
    if (!this._page || !this._hass) return [];
    const out = [];
    for (const [id, e] of this._map)
      if (e && e.selectable !== false && this._page.entities.get(id) === "camera" && this._hass.states[e.entity]) out.push({ id, e });
    return out;
  }

  // the camera the camera mode shows now (null: the floor has none)
  _camera() {
    const list = this._cameras();
    if (!list.length) return null;
    if (!(this._cam < list.length)) this._cam = 0;
    return list[this._cam];
  }

  // robot vacuums of the vacuum mode: the floor's page vacuums mapped to Home Assistant, in the order of the YAML
  _vacuums() {
    if (!this._page || !this._hass) return [];
    const out = [];
    for (const [id, e] of this._map)
      if (e && e.selectable !== false && this._page.entities.get(id) === "vacuum" && this._hass.states[e.entity]) out.push({ id, e });
    return out;
  }

  // the vacuum the vacuum mode shows now (null: the floor has none)
  _vacuumSel() {
    const list = this._vacuums();
    if (!list.length) return null;
    if (!(this._vac < list.length)) this._vac = 0;
    return list[this._vac];
  }

  // the entity the screen stands for: the room (heating), the camera (camera) or the vacuum (vacuum mode), else null
  _selected() {
    return this._mode === "heating" ? this._climate() : this._mode === "camera" ? this._camera()
      : this._mode === "vacuum" ? this._vacuumSel() : null;
  }

  // the page's link line from the screen to the room / camera shown, else none
  _link() {
    const r = this._selected(), H = this._page.H;
    const rect = [SCREEN.x, H - SCREEN.y - SCREEN.h, SCREEN.x + SCREEN.w, H - SCREEN.y];
    const msg = r ? { gf: "link", id: r.id, rect } : { gf: "link", id: null };
    const key = JSON.stringify(msg);
    if (key === this._linkSent) return;
    this._linkSent = key;
    this._post(msg);
  }

  // the page's qibla compass (bottom right) shows while the sun mode is on
  _compass() { this._post({ gf: "compass", value: this._mode === "sun" }); }

  _fitDock() {
    if (!this._page) return;
    this._dock.style.transform = `scale(${this._wrap.clientWidth / this._page.W})`;
    this._side.style.transform = `scale(${this._wrap.clientWidth / SIDE.ref})`;
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

  // rows of the active mode; rebuilt when the mode or a listed state changes
  _renderList(force) {
    const d = this._dock, list = d.querySelector(".list");
    if (!list || !this._hass || !this._page) return;
    const mode = this._mode, hass = this._hass;
    let rows = [], title = this._floor + " · " + DOCK_MODES.find((m) => m.id === mode).title, room = null;
    if (mode === "heating") {
      room = this._climate();
      const n = this._climates().length;
      if (!room) rows = [{ icon: "mdi:radiator-off", label: "no climates", value: "" }];
      else {
        const { id, e } = room, st = hass.states[e.entity], a = st.attributes;
        const t = (v) => (v == null || !Number.isFinite(Number(v)) ? "-" : (Math.round(Number(v) * 10) / 10).toFixed(1) + "°");
        const hs = e.humidity && hass.states[e.humidity];
        const hum = hs && Number.isFinite(Number(hs.state)) ? Number(hs.state) : a.current_humidity;
        const on = st.state !== "off" && st.state !== "unavailable" && st.state !== "unknown";
        const act = a.hvac_action || (on ? "-" : "");
        title = this._floor + " · " + (e.name || id.replace(/_climate$/, "")) + (n > 1 ? " " + (this._room + 1) + "/" + n : "");
        rows = [{ icon: "mdi:thermometer", label: "current", value: t(a.current_temperature) },
                { icon: "mdi:target", label: "target", value: on ? t(a.temperature) : "-" },
                { icon: act === "heating" ? "mdi:fire" : on ? "mdi:radiator" : "mdi:radiator-off", on: act === "heating",
                  label: "mode", value: st.state + (act && act !== st.state ? "/" + act : "") },
                { icon: "mdi:water-percent", label: "humidity", value: hum == null || !Number.isFinite(Number(hum)) ? "-" : Math.round(Number(hum)) + "%" }];
      }
    } else if (mode === "camera") {
      room = this._camera();
      const n = this._cameras().length;
      if (!room) rows = [{ icon: "mdi:cctv-off", label: "no cameras", value: "" }];
      else {
        const { id, e } = room, st = hass.states[e.entity], ms = e.motion && hass.states[e.motion];
        const live = st.state === "streaming";
        title = this._floor + " · " + (e.name || id) + (n > 1 ? " " + (this._cam + 1) + "/" + n : "");
        rows = [{ icon: live ? "mdi:cctv" : "mdi:cctv-off", on: live, label: "state", value: st.state }];
        if (ms) rows.push({ icon: ms.state === "on" ? "mdi:motion-sensor" : "mdi:motion-sensor-off", on: ms.state === "on",
                            label: "motion", value: ms.state === "on" ? "yes" : "no" });
        const act = e.tap_action && e.tap_action.action;
        if (act && act !== "none") rows.push({ icon: "mdi:gesture-tap", label: "tap", value: act === "camera" ? "live" : act });
      }
    } else if (mode === "vacuum") {
      room = this._vacuumSel();
      const n = this._vacuums().length;
      if (!room) rows = [{ icon: "mdi:robot-vacuum-off", label: "no vacuum", value: "" }];
      else {
        const { id, e } = room, st = hass.states[e.entity], a = st.attributes;
        const busy = st.state === "cleaning" || st.state === "returning";
        const area = a["vacuum_extend.cleaning_area"];
        title = this._floor + " · " + (e.name || id) + (n > 1 ? " " + (this._vac + 1) + "/" + n : "");
        rows = [{ icon: busy ? "mdi:robot-vacuum" : "mdi:robot-vacuum-off", on: busy, label: "state", value: st.state },
                { icon: "mdi:information-outline", label: "status", value: a["vacuum.status_desc"] || a.status || "-" },
                { icon: "mdi:battery", label: "battery", value: a.battery_level != null ? a.battery_level + "%" : "-" },
                { icon: "mdi:fan", label: "suction", value: a.fan_speed || "-" }];
        if (area != null) rows.push({ icon: "mdi:texture-box", label: "last area", value: area + " m²" });
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
    this._link();
    const sig = title + JSON.stringify(rows.map((r) => [r.label, r.value, r.on]));
    if (!force && sig === this._listSig) return;
    this._listSig = sig;
    d.querySelectorAll(".btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    d.querySelector(".screen").classList.toggle("act", !!room);
    d.querySelector(".screen").title = room ? room.e.entity : "";
    // hovered, the screen glows in the room's border colour, together with the room and its link on the page
    const cols = this._config.colors || {};
    if (room) d.querySelector(".screen").style.setProperty("--hc", room.e.color
      || (mode === "camera" ? cols.camera || cols.other || OTHER_COLOR
        : mode === "vacuum" ? cols.vacuum || cols.other || OTHER_COLOR : cols.climate || CLIMATE_COLOR));
    d.querySelector(".title").textContent = title;
    list.innerHTML = rows.map((r) => `<div class="row${r.on ? " on" : ""}">
        <ha-icon icon="${r.icon}"></ha-icon><span class="lbl">${r.label}</span><span class="val">${r.value}</span></div>`).join("");
  }
}

customElements.define("gungors-floor-card", GungorsFloorCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "gungors-floor-card", name: "Gungor floor view", description: "Live-lit 3D view of the floors (Blender renders, ha-floorplan page)" });
