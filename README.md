# Bruce-the-frist
Frist one

## Fog Mirror

`index.html` is an interactive "fog mirror": a laptop screen covered in fog that you
wipe clear with your finger or mouse, like writing on a steamed-up bathroom mirror.

- **Wipe**: drag across the glass. Drips run down from the streaks.
- **Write it**: type a message (it starts as "miss you") and it gets written into the fog for you.
- **Fog it up**: fogs the glass over again.
- **Slider** (bottom of the screen): fog thickness.
- **Fog returns**: how long before the fog creeps back (30s, 2 min, or off).
- **Start camera**: puts your live front camera behind the glass, mirrored.
- **Use a photo**: puts any picture behind the glass instead.
- **Save picture**: downloads the current mirror as a PNG.

It is one self-contained file with no build step. Open `index.html` in a browser.
The live camera needs a secure page, so serve it over HTTPS or from `localhost`
(GitHub Pages or `npx http-server` both work). If a browser refuses the camera,
**Use a photo** still works everywhere.
