# Gungors Cards

Custom Lovelace cards for the Gungor house. Installed through HACS as a custom repository
(category **Dashboard**); HACS registers `ha-dashboards.js`, which loads all cards below.

| Card | Used by | What it does |
|---|---|---|
| `custom:gungors-rooms-card` | `unnecessary` dashboard | Lists active entities of a whitelist by domain/area and turns the selected ones off |
| `custom:gungors-schedule-card` | `program` dashboard | Form editor for calendar events whose description is JSON (`room_name`, `temp`, `sleep_temp`, `darkness`) |
| `custom:gungors-floor-card` | `floorplan-3d` dashboard | Live-lit 3D view of a floor (Blender renders + WebGL2), tap/hold like the floorplan dashboard |

## gungors-floor-card

The card connects the floor page of the Blender house model to Home Assistant. The page
(`index.html` plus a render folder per floor) runs in an iframe and does the drawing; the card
feeds it the entity states, Home Assistant's local time and the sun's rise/set times, and turns
taps and holds on the page into the actions you configure. One card shows every floor in
`floors`; the floor button in the dock goes to the next one.

```yaml
type: custom:gungors-floor-card
sun: sun.sun                      # required: a sun entity
base: /local/gungors_floor/       # optional: where index.html and the floor folders are
dock_radius: 370                  # optional: size (page px) of the control dock, bottom left
colors:                           # optional: border colour per page entity type ("other" = any type
  other: "#2ecc5a"                #   without its own); defaults: cover blue, light yellow, climate red, other green
floors:
  - floor: kat0                   # render folder under base; the first floor is shown first
    entities:                     # page entity -> settings
      salon_light:
        entity: light.salon_light # Home Assistant entity, same domain as the page entity's type
        name: Salon               # optional: label in the dock list
        slider: true              # optional: a slider in the dock list
        color: "#ff9800"          # optional: border colour of this entity on the page
        tap_action:
          action: toggle
        hold_action:
          action: more-info
      mutfak_blind: none          # background: no hover or tap, the page's default (covers open)
      garaj_door:                 # background with a fixed value instead of the page's default
        entity: none
        value: 0                  #   cover: position 0-100 (0 closed); light: [r, g, b, intensity 0-1]
  - floor: kat1
    entities: {}
```

| Option | Required | Description |
|---|---|---|
| `sun` | yes | Sun entity (`sun.sun`); its `next_rising` / `next_setting` drive the page's daylight |
| `floors` | yes* | List of `{floor, entities}`. *A single floor can still be given as top-level `floor` + `entities` |
| `base` | no | URL of the deployed page, default `/local/gungors_floor/` |
| `dock_radius` | no | Dock size in page pixels, default `370` |
| `colors` | no | Map of page entity type (or `other`) to `"#rrggbb"` border colour |

Per page entity under `entities`:

| Key | Description |
|---|---|
| `entity` | Home Assistant entity id. Page type `light` maps to `light.*`, `cover` to `cover.*`, any other type (e.g. `climate`) to the domain of the same name; those take no input, the page only draws their border and reports taps |
| `name`, `slider` | Label and optional slider in the dock list |
| `color` | Border colour of this entity, `"#rrggbb"` |
| `tap_action`, `hold_action` | Standard actions: `toggle`, `more-info`, `perform-action` (or `call-service`), `navigate`, `url`, `none`. Without them, tap/hold does nothing |
| `none` / `entity: none` + `value` | Puts the entity in the background, optionally with a fixed value |

Page entities left out of `entities` keep the page's defaults and are listed at the top right of
the page; map them or set them to `none`. Configuration errors (unknown page entity, wrong domain,
missing Home Assistant entity) replace the card with an error message. Unavailable or unknown
entities are drawn with grey borders.

The floor page and its renders are not part of this repository. They are build output of the
Blender project (`ha-floorplan`: the page `src/web/index.html` and the renders `output/<floor>/`)
and are copied to `/config/www/gungors_floor/` by its `src/ha/deploy.ps1`.

## Releasing

Bump the card's `VERSION` / `CARD_VERSION`, commit, then publish a GitHub release (`vX.Y.Z`).
HACS offers the update; after updating, reload the browser.
