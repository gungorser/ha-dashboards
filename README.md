# Gungors Cards

Custom Lovelace cards for the Gungor house. Installed through HACS as a custom repository
(category **Dashboard**); HACS registers `ha-gungors-cards.js`, which loads all cards below.

| Card | Used by | What it does |
|---|---|---|
| `custom:gungors-rooms-card` | `unnecessary` dashboard | Lists active entities of a whitelist by domain/area and turns the selected ones off |
| `custom:gungors-schedule-card` | `program` dashboard | Form editor for calendar events whose description is JSON (`room_name`, `temp`, `sleep_temp`, `darkness`) |
| `custom:gungors-floor-card` | `floorplan-3d` dashboard | Live-lit 3D view of a floor (Blender renders + WebGL2), tap/hold like the floorplan dashboard |

## gungors-floor-card

```yaml
type: custom:gungors-floor-card
floor: zemin_kat                  # folder under base
base: /local/gungors_floor/       # optional
light_gain: 1                     # optional
```

The floor data (`model.json` + layer images) is not part of this repository. It is build output of
the Blender project (`gungors_home`: `src/build_floor_html.py`) and is copied to
`/config/www/gungors_floor/<floor>/` by its `src/ha/deploy.ps1`.

## Releasing

Bump the card's `VERSION` / `CARD_VERSION`, commit, then publish a GitHub release (`vX.Y.Z`).
HACS offers the update; after updating, reload the browser.
