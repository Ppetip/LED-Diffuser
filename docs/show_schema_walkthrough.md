# LED Diffuser Show Compiler JSON Specification

This document defines the exact specifications, coordinate systems, rendering boundaries, layer blending math, and configuration schemas for the Web UI Show Compiler. This schema allows complex generative visuals to be written as high-level declarative JSON, compiled to raw pixel frame loops in the browser, and uploaded as compact binary blocks to the ESP32-C3 Mini.

---

## 1. Display Grid System & Boundaries

- **Physical Board Orientation**: Mounted as `10 columns wide x 28 rows high` (serpentine column wiring).
- **Logical Canvas (VIEW/Compiler Coordinates)**: Treated as `28 pixels wide (W=28) x 10 pixels high (H=10)`.
- **Pixel Indexing**: Index ranges from `0` to `279`, calculated as:
  $$\text{Index} = y \times 28 + x \quad \text{where } x \in [0, 27] \text{ and } y \in [0, 9]$$
- **Color Format**: Colors are specified as `#RRGGBB` hex strings (standard 24-bit sRGB).
- **Physical Mapping**: The ESP32 conversion math from logical $(x,y)$ to physical serpentine LED index is:
  $$\text{Column} = y, \quad \text{Row} = x$$
  $$\text{Index} = \text{Column} \times 28 + \begin{cases} 27 - \text{Row} & \text{if Column is odd} \\ \text{Row} & \text{if Column is even} \end{cases}$$

---

## 2. Show Specification Root Schema

A complete show is defined as a JSON object containing:

```json
{
  "name": "My Ambient Show",
  "frameMs": 150,
  "frameCount": 20,
  "layers": []
}
```

- **`name`** (string, optional): A descriptive name for the show. Defaults to `"Compiled Show"`.
- **`frameMs`** (integer, optional): Duration of each frame in milliseconds. Must be between `50` and `5000`. Defaults to `250`.
- **`frameCount`** (integer, optional): Total count of frames to compile. Must be between `1` and `24`. Defaults to `16`.
- **`layers`** (array, required): Ordered list of generator layer configurations (rendered bottom-to-top).

---

## 3. Layer Schema

Each layer in the `layers` array has the following structure:

```json
{
  "type": "gradient",
  "opacity": 0.8,
  "blend": "normal",
  "params": {}
}
```

- **`type`** (string, required): The generator tool identifier (see Section 5 for the 32 supported generators).
- **`opacity`** (float, optional): Alpha opacity factor, between `0.0` (fully transparent) and `1.0` (opaque). Defaults to `1.0`.
- **`blend`** (string, optional): Blending mode to combine this layer with layers underneath. Defaults to `"normal"`. Supported blend modes:
  - `"normal"`: Overwrites destination pixel: $C = C_{\text{layer}}$
  - `"add"`: Additive color mix: $C = \min(255, C_{\text{base}} + C_{\text{layer}})$
  - `"screen"`: Highlights bright regions: $C = 255 - \frac{(255 - C_{\text{base}}) \times (255 - C_{\text{layer}})}{255}$
  - `"multiply"`: Shadows/darkens: $C = \frac{C_{\text{base}} \times C_{\text{layer}}}{255}$
  - `"overlay"`: High contrast blending dependent on base lightness.
  - `"mask"`: Keeps base layer pixels *only* where the current layer is non-black.
  - `"letter_fill"`: Masking mode that draws the layer's pixels inside the boundaries of text glyphs, preserving the base color elsewhere.
- **`params`** (object, optional): Generator-specific options (detailed below).

---

## 4. Time Variables (Procedural Math)

All layers compile deterministically using two time-related factors:
1. **$t$** (normalized float): Progress of the current frame relative to total frames, $t = \frac{\text{frameIndex}}{\text{frameCount}} \in [0.0, 1.0)$.
2. **$\text{timeMs}$** (integer): Simulated timeline time in milliseconds: $\text{timeMs} = \text{frameIndex} \times \text{frameMs}$.

---

## 5. Generator Tools (The 32 Handlers)

### 1. `solid` (Solid background)
Fills the canvas with a static uniform color.
- **`color`** (hex string): Color to fill. Defaults to `"#000000"`.

### 2. `gradient` (Linear Moving Gradient)
Draws a linear color gradient sliding at an angle.
- **`colors`** (array of hex strings): Gradient control nodes. Defaults to `["#ff0000", "#0000ff"]`.
- **`angle`** (number): Rotational angle in degrees. Defaults to `0`.
- **`speed`** (number): Animation speed multiplier. Defaults to `0` (static).

### 3. `radial_gradient` (Radial Pulsing Gradient)
Draws circular gradients originating from a central node.
- **`colors`** (array of hex strings): Gradient control nodes. Defaults to `["#ff0000", "#0000ff"]`.
- **`cx`** (float): Center point X coord. Defaults to `13.5`.
- **`cy`** (float): Center point Y coord. Defaults to `4.5`.
- **`radius`** (float): Base boundary radius. Defaults to `10`.
- **`pulseSpeed`** (number): Rate of radial radius contraction/expansion. Defaults to `0`.

### 4. `rainbow` (Moving HSL Spectrum)
Outputs a rolling rainbow spectrum along an axis.
- **`angle`** (number): Strip rotation angle in degrees. Defaults to `0`.
- **`speed`** (number): Frequency scroll multiplier. Defaults to `1.0`.
- **`width`** (number): Width of a full cycle. Defaults to `14`.

### 5. `plasma` (Liquid wave noise)
Simulates classic liquid style plasma patterns.
- **`scale`** (float): Noise frequency spacing. Defaults to `0.2`.
- **`speed`** (float): Kinetic wave speed. Defaults to `1.0`.
- **`hue`** (number): Base hue starting offset (0-360). Defaults to `200`.

### 6. `rain` (Matrix code drops)
Fades columns of code drops dropping vertically.
- **`color`** (hex string): Leading drop color. Defaults to `"#38d9d6"`.
- **`speed`** (float): Downward speed rate. Defaults to `1.0`.

### 7. `snow` (Floating snow drifts)
Downward drift particles behaving like snowflakes.
- **`color`** (hex string): Snow flake color. Defaults to `"#ffffff"`.
- **`speed`** (float): Drop speed rate. Defaults to `0.5`.

### 8. `starfield` (twinkling star parallax)
Draws dots scrolling past horizontally or vertically at varied speed depths.
- **`stars`** (integer): Density of points on board. Defaults to `15`.
- **`speed`** (float): Scroll velocity. Defaults to `0.2`.

### 9. `waves` (Ocean fluid wave)
Fills the canvas starting from dynamic sine wave boundaries.
- **`color`** (hex string): Core wave liquid color. Defaults to `"#4d96ff"`.
- **`bg`** (hex string): Sky background color. Defaults to `"#000000"`.
- **`amplitude`** (number): High peak offset. Defaults to `2`.
- **`frequency`** (number): Wave compression factor. Defaults to `0.3`.
- **`speed`** (number): Horizontal flow rate. Defaults to `2.0`.

### 10. `fire` (Thermal fireplace)
Generates upward-moving flames from heat spots.
- **`color1`** (hex string): Outer flame color. Defaults to `"#ff477e"`.
- **`color2`** (hex string): Core coal fire color. Defaults to `"#ffe66d"`.

### 11. `shapes` (Vector drawing commands)
Draws vector primitives sequentially.
- **`draw`** (array of objects): List of primitives:
  - **`type`**: `"rect"`, `"circle"`, or `"line"`.
  - **`x`/`y`/`w`/`h`** (for `"rect"`): Boundary layout.
  - **`cx`/`cy`/`r`** (for `"circle"`): Center coordinates and radius.
  - **`x0`/`y0`/`x1`/`y1`** (for `"line"`): Start and end points.
  - **`color`** (hex string): Shape color.
  - **`fill`** (boolean): True for filled, false for border outline.

### 12. `text` (Text rendering)
Draws text using standard (5x7) or fatter bold (6x8) font grids.
- **`text`** (string): Letters to display.
- **`font`** (string): `"bold"` (default, 6x8) or `"standard"` (5x7).
- **`color`** (hex string): Text color. Defaults to `"#ffffff"`.
- **`scroll`** (boolean): Whether to animate scroll movement. Defaults to `true`.
- **`direction`** (string): Scroll vector (`"left"`, `"right"`, `"up"`, `"down"`). Defaults to `"left"`.
- **`speed`** (number): Milliseconds per scroll step. Defaults to `100`.
- **`x`/`y`** (integer): Start coordinates if `scroll` is `false`.

### 13. `cellular_automata` (Game of Life simulation)
Simulates Game of Life generations step-by-step.
- **`seed`** (string): Seeding blueprint: `"random"` (default) or `"glider"`.
- **`color`** (hex string): Color of living nodes. Defaults to `"#8cff98"`.
- **`deadColor`** (hex string): Empty background color. Defaults to `"#000000"`.

### 14. `particles` (Bouncing gravity balls)
Bounces points off frame boundaries applying gravity offsets.
- **`count`** (integer): Ball density. Defaults to `5`.
- **`color`** (hex string): Particle color. Defaults to `"#ff9f1c"`.
- **`gravity`** (float): Gravitational pull factor. Defaults to `0.1`.
- **`speed`** (float): Velocity scalar. Defaults to `1.0`.

### 15. `street_scene` (Street skyline & cars)
Generates moving headlights against silhouettes of windows and buildings.
- **`skyColor`** (hex string): Sky ambient backdrop. Defaults to `"#050512"`.
- **`buildingColor`** (hex): Silhouette blocks color. Defaults to `"#111422"`.
- **`windowColor`** (hex): Glowing apartment windows. Defaults to `"#ffe66d"`.
- **`carColor`** (hex): Car taillights. Defaults to `"#ff477e"`.

### 16. `dial` (Speedometer / Radial needle)
Draws a gauge radial pointer.
- **`value`** (float): Dial value indicator between `0.0` and `1.0`. Defaults to `0.5`.
- **`color`** (hex string): Pointer needle color. Defaults to `"#7ce7dd"`.
- **`bg`** (hex string): Circular dial background. Defaults to `"#1e293b"`.

### 17. `letter_fill` (Text Masking Layer)
Draws text characters as a boundary mask for a nested procedural effect.
- **`text`** (string): Characters to mask out.
- **`font`** (string): `"bold"` or `"standard"`.
- **`fillType`** (string): Nest generator identifier (e.g. `"rainbow"`, `"plasma"`).
- **`x`/`y`** (integer): Text coordinates.

### 18. `clock` (Digital clock loop)
Draws real-time digit tickers with flashing colons.
- **`color`** (hex string): Digit colors. Defaults to `"#ff477e"`.

### 19. `pacman` (Retro game sprites)
Animates pacman chomping points while chased by red ghost.

### 20. `glitch` (Horizontal row displacement)
Shifts rows horizontally with random scanline dropouts.
- **`amount`** (float): Shift probability density. Defaults to `0.1`.
- **`shift`** (integer): Max horizontal jump displacement. Defaults to `3`.

### 21. `fireworks` (Rocket burst simulation)
Launches rocket paths rising up from bottom before erupting in concentric sparks.

### 22. `sand` (Falling sand physics)
Simulates falling sand pile physics creating pyramids.
- **`color`** (hex string): Sand hue. Defaults to `"#ffe66d"`.

### 23. `dna` (Rotating double helix)
Generates standard rotating DNA helix rungs.
- **`color1`** (hex string): First strand. Defaults to `"#ff477e"`.
- **`color2`** (hex string): Second strand. Defaults to `"#7ce7dd"`.
- **`rungsColor`** (hex string): Connecting center rungs. Defaults to `"#30394a"`.

### 24. `kaleidoscope` (Reflection symmetry)
Cuts board canvas into reflected mirrored quarters.

### 25. `radar` (Sonar scanline sweep)
Sweeps line sectors creating faded phosphorescent trail sweeps.
- **`color`** (hex string): Scanline color. Defaults to `"#8cff98"`.
- **`speed`** (float): Rotational speed multiplier. Defaults to `1.0`.

### 26. `tunnel` (Zooming rectangles)
Zooms concentric rectangle loops.
- **`color`** (hex string): Rectangle lines. Defaults to `"#9d8cff"`.
- **`speed`** (float): Expansion rate. Defaults to `1.0`.

### 27. `ripple` (Expanding drop ripple)
Radiates concentric fading circles.
- **`color`** (hex string): Circle rings color. Defaults to `"#38d9d6"`.
- **`speed`** (float): Growth expansion rate. Defaults to `1.5`.

### 28. `equalizer` (Music equalizer bars)
Bounces 7 columns of multi-frequency equalizer bars.
- **`color`** (hex string): Equalizer nodes. Defaults to `"#ffe66d"`.

### 29. `heartbeat` (Pulsing anatomical heart)
Expands and contracts heart curves following cardiac waveforms.
- **`color`** (hex string): Heart body. Defaults to `"#ff477e"`.

### 30. `lighthouse` (Lighthouse beam sweeps)
Sweeps double light beam wedges outwards from a central lens point.
- **`color`** (hex string): Lens glow. Defaults to `"#ffffff"`.
- **`speed`** (float): Rotational speed. Defaults to `1.0`.

### 31. `sunset` (Sinking sun gradient sky)
Sinks a sun sphere from high sky down into bottom orange horizon.
- **`speed`** (float): Sinking scalar. Defaults to `1.0`.

### 32. `strobe` (Active strobe lights)
Intermittently Strobes whole screen canvas active.
- **`frequency`** (float): Flashing interval frequency. Defaults to `2.0`.
- **`color`** (hex string): Strobe color. Defaults to `"#ffffff"`.

---

## 6. Full Show Compiler JSON Example

Below is a complete, nested, dual-layer example that compiles to 24 frames showing a fatter scrolling bold text layer masked with a dynamic rainbow gradient, layered over a twinkling starfield backdrop:

```json
{
  "name": "AI Neon Stardust",
  "frameMs": 150,
  "frameCount": 24,
  "layers": [
    {
      "type": "solid",
      "opacity": 1.0,
      "blend": "normal",
      "params": {
        "color": "#05070a"
      }
    },
    {
      "type": "starfield",
      "opacity": 0.6,
      "blend": "add",
      "params": {
        "stars": 16,
        "speed": 0.25
      }
    },
    {
      "type": "letter_fill",
      "opacity": 1.0,
      "blend": "add",
      "params": {
        "text": "GLOW",
        "font": "bold",
        "x": 0,
        "y": 1,
        "fillType": "rainbow",
        "angle": 45,
        "speed": 1.5,
        "width": 10
      }
    }
  ]
}
```
