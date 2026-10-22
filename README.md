# Twilight Greenhouse — Night Shift Prototype

CSC 486B Assignment 3 (Digital Prototype) · Kehan Wang

**Play:** open `index.html` in any modern browser (phone or desktop), or use the GitHub Pages link.
One session takes about 4–5 minutes.

## Design question

After the "While You Slept" recap (time-lapse + partner's journal + gift), can the Night Keeper
tell what their partner did, and do they actively use what the partner left behind during their own shift?

## What you play

1. **Login**: a handover notification from Sol, the (scripted) Day Keeper.
2. **While You Slept**: a ~24-second time-lapse of Sol's day (skippable).
3. **Sol's journal** and a wrapped gift.
4. **Night shift** (~2.5 min): collect dew, guide the moth to pollinate moonflowers,
   turn Sol's leaves into compost at the mushroom log, and deal with slugs mid-shift.
5. **Dawn handover**: leave a note and pack a gift for Sol.
6. **Recall check + playtest summary** (copyable JSON for the tester's notes).

## Tester settings

Open "Tester settings" on the start screen, or use URL parameters:

| Parameter | Values | Meaning |
|---|---|---|
| `feel` | `on` (default) / `off` | Feel pass on opening Sol's gift. `off` is the "before" version. |
| `recap` | `anim` (default) / `noskip` / `text` | Recap animated + skippable, animated without skip, or a static text list. |

Example: `index.html?feel=off&recap=text`

## Second player

Sol (the Day Keeper) is a scripted partner and the time between shifts is simulated.
No networking.
