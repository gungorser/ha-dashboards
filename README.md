# Gungors Cards

Custom Lovelace cards for the Gungor house. Installed through HACS as a custom repository
(category **Dashboard**); HACS registers `ha-dashboards.js`, which loads all cards below.

| Card | File | Used by (ha-configs) | What it does |
|---|---|---|---|
| `custom:gungors-rooms-card` | `dist/gungors-rooms-card.js` | `dashboards/unnecessary.yaml` (Gereksiz) | Lists active entities of a whitelist by domain/area and turns the selected ones off; per-user whitelist override in frontend user data |
| `custom:gungors-schedule-card` | `dist/gungors-schedule-card.js` | `dashboards/program.yaml` (Program) | Form editor for local calendar events whose description is JSON (`room_name`, `temp`, `sleep_temp`, `darkness`); calls the `*_sync_room` scripts of `packages/schedules.yaml` after a save |
| `custom:gungors-floor-card` | `dist/gungors-floor-card.js` | `dashboards/floorplan_3d.yaml` (Floorplan 3D) | Live-lit 3D view of the floors (Blender renders + WebGL2 page from `ha-floorplan`), tap/hold like the 2D floorplan dashboard |

Plain ES modules, no build step: edit the file in `dist/` directly. Each file opens with a header comment
that documents its config; that header is the reference, keep it up to date.

## gungors-floor-card

The card only connects the floor page to Home Assistant; the page draws. The page
(`/local/gungors_floor/index.html` + one render folder per floor) is build output of `ha-floorplan`
and is not part of this repository.

```
HA states ──► card ──postMessage {gf:"set", id, value}──► iframe index.html?floors=kat0,kat1,kat2&floor=kat0
HA actions ◄── card ◄──────── {gf:"tap"|"hold", id} ─────┘
```

```yaml
type: custom:gungors-floor-card
sun: sun.sun                      # required: sunrise/sunset for the page's sun
base: /local/gungors_floor/       # optional
lighting: {default: 0.15}         # optional: world light everywhere, also at night
colors: {other: "#2ecc5a"}        # optional: border colour per page entity type
floors:
  - floor: kat0                   # render folder under base; the dock button cycles the floors
    rooms:                        # optional, per zone of the render while the sun is up:
      koridor0: {sun: 0.7, covers: 1.4}   # default + sun + covers x mean openness of its covers
    entities:                     # page entity id -> HA entity (same domain as the page type)
      salon_light:
        entity: light.salon_light
        gain: 2                   # lights: brightness at full intensity
        tap_action: {action: toggle}
        hold_action: {action: more-info}
      mutfak_blind: none          # background
      garaj_door: {entity: none, value: 0}               # background with a fixed value
      yemek_blind: {entity: cover.yemek_cover, selectable: false}   # background that follows HA
```

Values sent to the page: light RGBA `[r, g, b, a]` (off: a = 0; on: `rgb_color` + brightness/255),
cover position 0-100, climate `"mode action current target"`, `time` "HH:MM" in HA's time zone,
`sun` "HH:MM HH:MM". Unavailable/unknown entities are reported, the page draws their borders grey.
Nothing happens without a `tap_action`/`hold_action`. Errors (unknown page entity, wrong domain,
missing HA entity) stop the card; page entities left out of `entities` are listed on the page top right.
Message protocol and page settings: `ha-floorplan` README.

## Releasing

- Bump the card's `VERSION` / `CARD_VERSION`, commit with a message that starts with the card and
  version (`gungors-floor-card 1.15.0: ...`), then publish a GitHub release (`vX.Y.Z`). HACS offers the
  update; after updating, reload the browser.
- Quick deploy without a release: copy the file to HA `/config/www/community/ha-dashboards/` (Home
  Assistant MCP `ha_write_file`), then bump `&v=<card version>` on the dashboard resource
  `/hacsfiles/ha-dashboards/ha-dashboards.js?hacstag=...`; otherwise browsers keep the cached card
  (`ha-dashboards.js` passes its query on to every card).
