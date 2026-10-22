# Twilight Greenhouse — Night Shift Prototype

CSC 486B Assignment 3 (Digital Prototype) · Kehan Wang

**Play:** https://kehan316.github.io/greenhouse-prototype/ (phone or desktop browser).
Locally: serve this folder with any static server (e.g. `python3 -m http.server`) and open `index.html`.
One session takes about 5 minutes.

## Design question

After the "While You Slept" recap (Sol's day replayed in the greenhouse + journal + gift), can the
Night Keeper tell what their partner did, and do they actively use what the partner left behind
during their own shift?

## What you play

An isometric greenhouse you can drag, zoom and tap (tap anything for a context bubble).

1. **Login**: a handover notification from Sol, the (scripted) Day Keeper.
2. **While You Slept**: a ghost of Sol walks through the greenhouse and replays the day
   (~30 s, skippable). Places Sol changed keep a ☀️ "Sol was here" marker.
3. **Sol's journal** and a wrapped gift.
4. **Night shift** (3 min): collect dew, guide moths to pollinate moonflowers, water night jasmine,
   catch fireflies, compost Sol's leaves (worms speed it up), feed the glow mushrooms.
   Mid-shift, slugs arrive: pick them off, send the frog, or use Sol's gift.
5. **Dawn handover**: leave a note and pack a gift for Sol.
6. **Recall check + playtest summary** (copyable JSON for the tester's notes).

## Tester settings

Open "Tester settings" on the start screen, or use URL parameters:

| Parameter | Values | Meaning |
|---|---|---|
| `feel` | `on` (default) / `off` | Feel pass on opening Sol's gift. `off` is the "before" version. |
| `recap` | `anim` (default) / `noskip` / `text` | Animated tour + skippable, animated without skip, or a static text list. |

Example: `index.html?feel=off&recap=text`

## Second player

Sol (the Day Keeper) is a scripted partner and the time between shifts is simulated. No networking.

## Credits

- Tiles, walls, fences and props: [Kenney — Isometric Miniature Farm](https://kenney.nl/assets/isometric-miniature-farm) (CC0), see `assets/kenney/License.txt`.
- Engine: [Phaser 3.80](https://phaser.io) (MIT), bundled in `lib/`.
- Plants and creatures: system emoji.
