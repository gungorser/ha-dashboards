# Gungors Cards

Custom Lovelace cards for the Gungor house. Installed through HACS as a custom repository
(category **Dashboard**); HACS registers `ha-dashboards.js`, which loads all cards below.

| Card | Used by | What it does |
|---|---|---|
| `custom:gungors-rooms-card` | `unnecessary` dashboard | Lists active entities of a whitelist by domain/area and turns the selected ones off |
| `custom:gungors-program-card` | `program` dashboard | The gungors program calendar (`calendar.program`): every program (pinned first; start and stop timeless ones like "Bebek uyku"), a week grid per room, and an editor for an entry's targets and rules |
| `custom:gungors-floor-card` | `floorplan-3d` dashboard | Live-lit 3D view of a floor (Blender renders + WebGL2), tap/hold like the floorplan dashboard |
| `kiosk-mode.js` (not a card) | TV (Fully Kiosk) | [NemesisRE/kiosk-mode](https://github.com/NemesisRE/kiosk-mode) v15.0.0, MIT, vendored unchanged (HACS cannot download its release assets): `?kiosk` on a dashboard URL hides the header and sidebar; without it nothing changes |

Each card's header comment is its full reference (YAML options, messages, behaviour): read the
README, then only the header of the card you touch.

## gungors-floor-card

Shows the 3D floor view of ha-floorplan in an iframe (`/local/gungors_floor/index.html?floors=...`)
and connects it to Home Assistant: feeds lights, covers, climates, time and sun, and turns taps/holds
into the actions set in YAML. Configuration and the card <-> page messages: the header of
`dist/gungors-floor-card.js`. The page, the renders (`model.json` + layers) and their deploy belong
to ha-floorplan; the dashboard that uses the card is ha-configs `dashboards/floorplan_3d.yaml`.

## Related repositories

- **ha-floorplan**: the floor page and renders the floor card shows (page protocol documented there).
- **ha-configs**: the dashboards that use these cards (`floorplan_3d`, `program`, `unnecessary`).

## Claude agent

No agent: the main session works on the cards following ha-configs `CLAUDE.md` (card release steps there).

## Releasing

Bump the card's `VERSION` / `CARD_VERSION`, commit, then publish a GitHub release (`vX.Y.Z`).
HACS offers the update; after updating, reload the browser. A card copied straight into
`www/community/ha-dashboards/` (no release) keeps its old URL: bump `v=<card version>` on the
dashboard resource `ha-dashboards.js` so browsers load the new file.
