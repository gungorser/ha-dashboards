// ha-gungors-cards — entry point registered by HACS. Loads every card of this repository from the
// same folder, passing on this file's query (HACS's ?hacstag=...) so a new release is not served
// from the browser cache.
const CARDS = ["gungors-rooms-card.js", "gungors-schedule-card.js", "gungors-floor-card.js"];
const query = new URL(import.meta.url).search;

for (const file of CARDS) {
  import(new URL("./" + file + query, import.meta.url).href)
    .catch((e) => console.error("ha-gungors-cards: failed to load " + file, e));
}
