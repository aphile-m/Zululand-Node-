# Character sheet prompts (Higgsfield)

Six characters: Sakhile and the five people who give him work. Generated as
**8-frame idle-loop sprite sheets**, processed by `scripts/make_sprites.py` into horizontal
WebP strips, and animated in CSS the same way the Trainer App animates Vic.

SPEC §14: *"Do not generate art at runtime. Illustrations are static assets produced
separately and committed to the repo."* This file is the "produced separately" part, kept
in the repo so a regeneration is reproducible rather than a lucky prompt someone lost.

---

## How to use

1. Generate each sheet from the prompt below. **16:9**, one sheet per character.
2. Paste the resulting image URL into `scripts/sprite-urls.txt` as `<key> <url>`.
   The default grid is 4×2, which is what these prompts ask for, so no grid override is
   needed. Add `center` only if the model drifted the figure between cells.
3. Run the **Build character sprites** GitHub Action (`.github/workflows/sprites.yml`),
   which runs `make_sprites.py` and commits `www/img/ch-*.webp` + `ch-meta.json`.

Keys: `sakhile`, `mthiyane`, `thandeka`, `sipho`, `renier`, `amara`.

---

## Two constraints that come from the pipeline, not from taste

**The background must be magenta, not black.** `key_cell()` in `make_sprites.py` takes the
median of the four corners as the background colour and removes every pixel within 40 per
channel of it (`core` at threshold 14, then a 3px fringe at 40). Its own comment records
what that costs on the Trainer App's sheets:

> *a loose single threshold creeps deep into dark clothing on these near-black backgrounds*

This cast wears charcoal, navy, black and dark denim. On a near-black sheet the keyer would
eat Inkosi Mthiyane's blazer and Dr Okonkwo's suit. Flat magenta `#FF00FF` is more than 180
per channel from every colour any of these six wears, so the key is unambiguous. The one
rule that follows: **nobody wears purple or magenta**, which is why the negative tail says so.

**No panel frames, no gutters.** `make_sprites.py` has a whole multi-pass fallback for
"card" sheets where each cell is a framed panel — it works, but it is guesswork, and a
borderless sheet skips it entirely. The prompts ask for cells that butt directly together.

Also: frames are cropped to their **union bounding box**, which preserves inter-frame
registration. That is what keeps the idle loop from jittering — and it only works if the
figure is drawn at the same scale on the same baseline in all eight cells, which the
composition clause states three different ways on purpose.

---

## Shared blocks

Identical in all six prompts. Do not vary them — consistency across the cast is the
whole point.

**A. Composition**

```
Sprite animation sheet, exactly 8 frames arranged in a strict 4 by 2 grid, four columns and two rows, each cell holding one frame of a single continuous idle-breathing animation loop read left to right then top to bottom, identical original character in every frame, the character standing upright facing the viewer at exactly the same scale in every cell with both feet flat on the ground at the same baseline height in every cell, full head-to-toe framing with the entire body and both feet visible in every cell, only the pose changes between frames and only subtly — chest rising and falling, a small weight shift, a slight head turn, one small hand movement — the character never moves sideways, never changes size, and never leaves the cell,
```

**B. Background**

```
flat uniform solid magenta #FF00FF chroma-key background filling every cell edge to edge, no gradient, no vignette, no ground shadow, no floor, no horizon, cells butting directly against each other with no gutters, no panel frames, no borders, no cell dividers,
```

**C. Render — the house style, matched to Vic**

```
16-bit arcade fighting-game sprite art, bold uniform black outline around the silhouette and every interior shape, limited flat colour palette, hard-edged cel shading in two tones per material with no soft gradients and no airbrushing, crisp readable silhouette, clean pixel-art rendering,
```

**D. Lighting and quality**

```
even frontal lighting identical in every frame, no rim light, no coloured light, no lens effects, high-quality game sprite sheet, sharp clean linework, consistent character model across all eight frames, 4K,
```

**E. Negative tail**

```
no text, no numbers, no labels, no captions, no watermark, no logos, no branding, no frame borders, no panel dividers, no drop shadows, no background objects, no other people, no duplicate figures within a cell, no cropped limbs, no sitting, no crouching, no purple or magenta clothing, no babyface, no overly youthful rounded proportions, the character is original and must not resemble any real person or any existing copyrighted character.
```

---

## The six subject blocks

Assemble as: **A + B + `<subject>` + C + D + E**, one paragraph, comma-separated, in that
order. Earlier tokens carry more weight, which is why composition and identity lead and the
quality tail trails.

### `sakhile` — the player

```
a Zulu man in his late twenties with warm deep-brown skin, oval face with a defined jawline and mature adult bone structure, high cheekbones, straight nose, full lips with a natural matte finish, dark brown almond eyes with naturally muted catchlights and no artificial glare, neat thick eyebrows, short black high-fade haircut with a sharp lineup and light stubble along the jaw, lean athletic build of average height with square shoulders, wearing a clean pale-blue short-sleeved button shirt worn open over a plain white t-shirt, stone-grey chinos with a brown leather belt, scuffed tan leather work boots, a slim silver watch on the left wrist, a slim navy document folder tucked under the right arm, alert forward-leaning posture like a man with somewhere to be,
```

### `mthiyane` — Inkosi Mthiyane, traditional council

```
a Zulu man in his early seventies with deep-brown skin, long oval face with a strong jaw and mature adult bone structure, pronounced cheekbones, deep-set dark eyes with heavy lids, naturally muted catchlights and no artificial glare, weathered skin with deep expression lines across the forehead and around the eyes, close-cropped white hair and a full short white beard, thickset upright build, wearing a well-worn charcoal wool blazer over a cream collared shirt buttoned to the neck, dark formal trousers, polished black leather shoes, a beaded amulet necklace in red white and black at the throat, both hands resting on the carved head of a dark hardwood walking stick planted upright in front of him, completely still and unhurried bearing,
```

### `thandeka` — Thandeka Nxumalo, acting municipal manager

```
a Zulu woman in her mid forties with medium-brown skin, round face with a defined jawline and mature adult bone structure, warm dark-brown eyes with naturally muted catchlights, no artificial glare, and visible tiredness beneath them, neatly shaped eyebrows, black box braids gathered into a low bun, average build standing with the slight forward stoop of desk work, wearing a fitted maroon blazer over a cream blouse, a black knee-length pencil skirt, low black block-heeled shoes, a municipal identity card on a green lanyard around the neck, thin gold hoop earrings, reading glasses pushed up into the hair, a thick overstuffed manila document file clutched against the chest with both arms,
```

### `sipho` — Bra Sipho Zulu, community forum

```
a Zulu man in his mid fifties with dark-brown skin, broad square face with a heavy jaw and mature adult bone structure, wide-set dark eyes with naturally muted catchlights, no artificial glare, and deep laugh lines, greying short afro and a full salt-and-pepper beard, heavy-set barrel-chested build, wearing a faded olive-green work jacket open over a red collared golf shirt, dark blue jeans with a worn leather belt, brown lace-up boots, a soft brown leather bucket hat, feet planted wide and grounded, one hand raised mid-gesture as though making a point to a room,
```

### `renier` — Renier van Zyl, fuel wholesaler

```
a white South African man in his mid forties with sun-reddened fair skin, square face with a soft jaw and mature adult bone structure, pale blue eyes with naturally muted catchlights, no artificial glare, and pronounced crow's feet, sandy blond hair cut short and thinning at the temples, a light sandy moustache, stocky build with a slight belly, wearing a plain navy golf shirt with a contrasting white collar tucked into khaki chino shorts, a brown leather belt, brown leather slip-on shoes worn without socks, mirrored aviator sunglasses pushed up onto the head, a bakkie key fob spinning on one finger, relaxed open friendly posture,
```

### `amara` — Dr Amara Okonkwo, development finance

```
a West African woman in her early fifties with deep-brown skin, heart-shaped face with a defined jawline and mature adult bone structure, sharp cheekbones, dark brown eyes behind thin rectangular gold-rimmed glasses with naturally muted catchlights and no artificial glare, precisely shaped eyebrows, natural black hair cropped very short and neat, slim upright build with excellent posture, wearing a tailored charcoal trouser suit over an emerald-green silk blouse, matching charcoal wide-leg trousers, black low-heeled leather pumps, small gold stud earrings and a thin gold bangle on one wrist, a slim tablet held flat against one forearm, composed and precise bearing,
```

---

## Notes on the cast

The six read as six **silhouettes** before they read as six faces, which is what matters at
200px on a phone: a lean young man with a folder, a heavy elder on a stick, a woman braced
around a file, a broad man mid-gesture, a stocky man in shorts, a slim woman with a tablet.
Nobody is mistakable for anybody else at a glance.

Renier is written to be **likeable** — open posture, friendly, sunburnt. That is deliberate
and it is the point of him: SPEC's easiest money in the game should not arrive looking like
a villain, or the choice it presents is no choice at all. The same restraint applies
throughout; §1 asks for "dry, respectful, specific", and none of these six is a joke.

## If the style drifts

Generate `sakhile` first and keep the best result as the style reference for the other
five — locking the render on one character beats re-describing it six times. The Trainer
App's `www/img/vic-ref.png` also works as a style anchor if you want the two apps to look
like siblings, though NODE's cast should not inherit Vic's build.
