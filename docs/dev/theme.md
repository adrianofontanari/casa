# Theme (Agent 5): what changes where

`src/room/theme/theme.js` defines `window.CasaTheme` (version 2). It is listed first in
`src/room/order.txt`. It has no dependencies, no timers and no network.

**Direction (2026-11-10).** An original room, with its own palette, shapes and layout. The free room, the packs and the panels
share one family: pixel art, flat tones with Bayer dither, hard 1-px edges, the night shade, the family gold
`#F2C14E` and vermilion `#D2473A`, the cosy evening. Everything else is new: palette, object shapes, where
things stand. No memory objects (trophies, bibs, plush toys, team shirts, personal photos, real places).

Concept picture of the free room, drawn from the same numbers as `CasaTheme.layout`:
`test/out/theme/room-concept.png` (rendered by the landing page tooling). Proof of the sprites and the palette:
`python3 test/theme/render.py` (writes `test/out/theme/`, exits non-zero on a page error or an empty frame).

## API

| Field | What | How the room uses it |
|---|---|---|
| `P` | the whole palette, "clay and ink", by base tone name (44 tones). | `PIX.T(name)` reads `CasaTheme.P[name]` first. |
| `grade([r,g,b])` | only +2 red / -2 blue on lit tones now. The look lives in `P`. | `PIX.shade()` runs it on every final pixel. |
| `tone(name, base)`, `palette(base)` | the tone by day (P, then grade) | previews, CSS for DOM parts that must match the canvas |
| `layout` | where each object stands, fractions of the room (below) | replace the positions in `engine/layout.js` |
| `tweak[id]` | per-object variant: `shape`, `pattern`, `colors`, `tones`, `was` | `PIX.withTweak(id, fn)` |
| `trees` | `leaf moss pine gold wood umber dark` for trees only: olive summer, red-orange maple autumn | window view tree |
| `buddy`, `pet` | the penguin (26x28) and the dog (48x31), see "Sprites" | |
| `warm(k)` | pre-renders every sprite frame (about 5 ms) | optional, when idle |

## Palette: clay and ink

| Role | Tones | Values |
|---|---|---|
| Walls (clay plaster, lit to corner) | `plas plast plasd plasx` | `#C48A6E #B2785E #8E5C48 #623E34` |
| Floor, beam, frames (walnut) | `oak wood umber dark soot` | `#9C6C48 #7A4E32 #563624 #3A241A #241610` |
| Desk, shelves (pale ash) | `birch beech tan` | `#E4D4B4 #CCB690 #A28C68` |
| Trim, paper | `cream paper bone pale` | `#EEE2C8 #FAF3E2 #F6F0E4 #D8D6D2` |
| Textiles | `curt curtd` mustard linen, `rug rugd rugl` indigo and oat | `#D8A84E #B08434`, `#3C4E84 #2A3660 #ECDCB8` |
| Plants | `leaf moss pine` | `#86B85C #548A48 #2C5A3E` |
| Accents | `gold verm` (family, unchanged), `teal rose sky lilac flame hay amber rust berry` | `teal #3A8A86` |
| Neutrals | `ink coal slate blue steel mist` | warm inks, indigo `blue #3A4A78` |
| Night | `night` | `#1C162A` (indigo-plum) |

## Arrangement (`CasaTheme.layout`, v2)
x is a fraction of the room width, y of its height. The concept picture is 480x300.
- **Ceiling**: a flat walnut beam across the top (`beam.h`). **No slope.**
- **Window**: an ARCH on the left (`window` x 0.083-0.292, y 0.133-0.567), cream frame, centre mullion, a transom
  at the spring of the arch, no curtains. The view is two soft hills and one maple from `trees`.
- **Window seat** under it (`seat` x 0.058-0.317, top 0.587): cream box, three cubbies of books (the only
  books in the room), a mustard cushion, a teal and a rose pillow. **The buddy sits here** (`buddy.cx` 0.15).
- **Plants**: a pothos hanging from the beam on cream ropes (`plantHang`), a tall leafy plant in a white pot on
  the floor (`plantFloor` cx 0.358).
- **Clock** round and plain above the **tear-off calendar** (navy header, yellow month, big day number), on the
  wall between the window and the desk.
- **Desk**: a shorter pale-ash TRESTLE on the right (`desk` x 0.492-0.896, top 0.573), A-frame legs, a stretcher.
- **Goal**: a GARLAND of small flags (mustard, teal, rose) across the desk wall with the paper sign hanging
  from it (`goal.sign`). The goal text stays DOM text in the sign.
- **Cork**: ROUND, walnut rim, over the left half of the desk. **Shelves**: two floating ash shelves right of it.
- **Lamp**: a FLOOR arc lamp standing right of the desk, teal dome over the desk's right end, warm cone.
- **On the desk**, left to right (`on`): mug, agenda (teal, lying), typewriter (mint), headphones on a stand,
  a vermilion PORTABLE TV with a handle and rabbit ears (it replaces the wall TV).
- **Chair**: a wooden spindle chair seen from behind, mustard cushion. **Backpack** leans by the left trestle.
- **Floor**: walnut planks, an OVAL indigo rug with oat and mustard border rings (`rug`), the power strip under
  the desk, the **dog's own round bed** (vermilion rim) front left (`petbed`), where it sleeps.
- **Removed**: the sloped ceiling, the bed, the bookcase, the wall-mounted TV.
- Daylight from the window falls as a slanted pale patch on the floor; at night the room's own shade does the rest.

## Object shapes (`CasaTheme.tweak`, v2; `was` keeps the first-pass names you already drew)

| id | shape / pattern | in words |
|---|---|---|
| ceiling | `beam` | walnut beam, lit top edge, dark bottom edge, 2-px shadow under it |
| floor | `wide-planks` | walnut planks 9 px high, staggered joints, light grain dither |
| window | `arched` / `no-curtains`, `seat: true` | see Arrangement; `tones.curt/curtd` stay mustard if you keep curtains anywhere |
| desk | `trestle` | ash top 4 px (white top line, tan bottom line), two A-frames, a stretcher 18 px above the floor |
| goal | `garland` / `flags` | catenary cord, 8-px triangle flags every 12 px in mustard/teal/rose, paper sign on two strings |
| calendar | `tear-off` / `plain-header` | nail, string triangle, navy 10-px header with yellow month, 2x day digits, two torn edges at the bottom |
| clock | `round-simple` | walnut ring, paper face, ink hands, vermilion centre |
| cork | `round` / `pins-yellow-teal` | circle r 22, walnut rim, dithered cork, square notes with one pin each |
| shelf | `floating-pair` | two ash boards, no brackets, shadow line under each |
| lamp | `floor-arc` | ink pole and base on the floor, a curved arm, teal dome, warm dithered cone on the desk |
| typewriter | `low-carriage` / `round-keys` | mint body, ink platen with chrome knobs, paper sheet up |
| headphones | `on-stand` | walnut stand, oat band, navy cups |
| tv | `portable` / `antenna`, `place: "desk"` | 30x22 vermilion body, dark screen, two cream knobs, handle, V antenna |
| chair | `spindle` / `cushion` | walnut legs and seat, five spindles, top rail, mustard cushion |
| rug | `oval` / `border-stripes` | indigo oval, oat outer ring, mustard inner ring |
| plants | `hanging-and-floor` / `macrame` | see Arrangement |
| petbed | `round-cushion` | vermilion rim, oat inside; the dog sleeps in it |
| agenda, strip, backpack, mug | as before | teal notebook with yellow band; white strip, teal switch; mustard roll-top; tall yellow mug, navy band |

## Sprites
### buddy.draw(ctx, x, y, u, frame, mood, opts)
- `(x, y)` is the top-left of the box, `buddy.w*u` by `buddy.h*u` (26x28). Whole `u`. Feet on the last row.
- `mood`: `idle | blink | wave | sleep | talk | happy`; `buddy.moods[m] = {n, ms}`. Repaint only when
  `Math.floor(t / ms)` changes (idle: 600 ms). Frame 0 is the still for calm mode. `sleep` paints two z's up to
  9 sprite px above the box.
- `opts`: `{flip}` mirrors; `{k}` (0..0.62) night inside the sprite, only on a layer `shade()` does not touch.
- One `drawImage` of a cached canvas per call.
### pet.draw(ctx, x, y, u, gait, frame, opts)
- Box `pet.w*u` by `pet.h*u` (48x31), paws on row 29. Faces left; `opts.right` mirrors. `opts.k` as above.
- `gait`: `stand | wag | sit | lie | sleep | walk | trot`; `pet.gaits[g] = {n, ms, step?}`. While walking or
  trotting move the box `step` sprite px per frame (walk 1.008, trot 1.778) so planted paws stay still.

## Panels (Agent 4): widget design language

The DOM panels opened from objects (`src/room/panels/`) share one look, defined once in
`panels/shell.js` as CSS variables on `.cp-overlay`. It is built from this palette so a panel
reads as the object it came from: light paper cards with a navy pixel frame.

| Part | Rule |
|---|---|
| Frame | paper card `#fffdf8`, ink `#18171c`, a 4px navy `#24335e` pixel border with notched corners (box-shadow, no radius), a hard stepped navy shadow down-right |
| Header | solid teal `#2e6e66` bar, 4px navy rule under it, a small yellow square before the title, title in system sans 15px semibold on paper colour. Close: 32px yellow `#f6c93e` square, navy edge and shadow |
| Section label | sans 12px bold uppercase in teal, followed by a dotted mint `#7ec2b0` rule (`.cp-label`) |
| Buttons | square, 2px navy edge, 3px hard navy shadow that collapses on press. Primary: navy fill, paper text. Selected (`aria-pressed`): yellow fill |
| Inputs | white, 2px navy edge, mustard-light `#f0d89a` halo on focus |
| Rows | oat `#e6dac2` lines or ruled paper; checkbox 20px navy square, teal when done |
| Colour roles | teal = done, links, headings; mustard and yellow = selected, today, "next"; vermilion `#d2473a` = now line and errors only; oat = quiet surfaces |
| Focus | 3px teal-light `#2c8c88` outline (yellow on the teal header) |
| Type | system sans for UI, mono for numbers and times, serif italic only for quotes |
| Motion | none by default; the few loops (TV, clock line) run through `Pace`; reduced motion and calm mode give still frames |

Per object, the panel borrows the room tweak above: agenda = teal cloth cover with the yellow
elastic band and ruled pages; calendar = navy day header with yellow digits; TV = vermilion portable
body with cream knobs and a handle; typewriter = mint body with round cream keys under the
sheet; headphones = navy bar with an oat play button; cork = round walnut frame around a cork-dotted page.

### Refinements for v2 (Agent 5, adopting the language above)
- Keep every token above. The paper card, navy frame and teal bar already belong to the clay-and-ink family.
- Panel chrome never uses the clay wall tone (a panel must stand off the wall behind it), never a radius,
  blur or gradient. Hard shadows only, in navy or `rgba(28,22,42,.45)` (the room's night).
- List rows: 36 px min height, oat 1-px rule, teal check when done, the text struck through in `--cp-faint`.
  "Today" rows get a 4-px mustard bar at the left edge; "now" is the only vermilion.
- Empty states: one small code-drawn pixel icon (16x16 at x2) in teal, one line of muted text, one button.
- Icons are 1-px pixel glyphs drawn in the panel's own colours, never emoji, never a third-party icon font.

## Garden pack rules (Casa Garden)
- Its name sign reads "CASA GARDEN". No other sign, no personal word, no signpost from a real garden.
- Trees from `CasaTheme.trees` (olive and red-orange maples), soft generic hills, no mountains with a real
  profile, no real river, bridge, church, museum or monument. A greenhouse, a bird bath, a cream bench,
  stepping stones, crates of notes by tag, a clothesline of photos. See `pack-living-garden-still.webp`.

## Risks
- The penguin is navy and white with an orange beak and feet: a cousin of every cartoon penguin, including
  the well-known Linux one. The yellow scarf and the round bobble-head separate it. Have someone look at it.
- The arrangement is a proposal: `engine/layout.js` and the decor must adopt it (Agent 3).
