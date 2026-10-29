# What the pane can draw

Measured with `/pad-demo`, the mod's design test page, on 2026-10-28 with Claude Code 2.1.308: in the Desktop app's Code tab in light and dark mode (screenshots from the owner; the light one is `reference/desktop-light.webp`), and in a terminal with a dark theme (captured through tmux, which reports 256-color approximations). Every mockup in this set keeps to what is listed here, so what it shows is what the mod can draw.

## Desktop app

The pane body is the app's own background (white in light mode, near-black `#1e1e1e` in dark), set in the system font at about 15px, with text `#1b1b1b` (light) or `#e8e8e8` (dark).

- **Text.** Theme colors follow the mode. Bold, italic, underline, dim, inverse and strikethrough all draw. `size` draws five steps (caption about 12px, footnote 13px, body 15px, heading 17px, title 22px), `weight` draws medium and semibold, and `mono` draws the system monospace face.
- **Spaces.** Runs of spaces shrink to one, so columns can't be lined up with spaces: they need Boxes of a fixed width.
- **Backgrounds.** `backgroundColor` fills a plain rectangle, with no rounding, just big enough for the text plus its padding (`paddingX={1}` is about 11px a side). Most theme keys fill strongly: `claude` is the orange accent, `success` green, `error` red, `warning` brown or amber, and `text`, `inactive`, `subtle`, `suggestion`, `remember`, `permission` and `ide` dark greys in light mode and light greys in dark. Three keys are soft shades that follow the mode:
  - `promptBorder`: light grey `#dcdcdc` in light mode, dark grey `#3a3a3a` in dark. The one neutral shade for cards and stripes.
  - `diffAddedDimmed`: pale green `#d7efd9` in light mode, deep green `#233a27` in dark.
  - `diffRemovedDimmed`: pale pink `#fbd8e0` in light mode, deep maroon `#3d2327` in dark.
- **Raw colors.** A hex color draws exactly as given, but doesn't follow the mode: a light tint is right in light mode and an unreadable light block under white text in dark mode, and a dark tint the reverse. So none are used.
- **Borders.** A Box with `borderStyle` draws as a rounded card, radius about 10px, 1px border (`bold` 2px, `double` a double line), with about 18px of padding above and below one line of text and about 11px at the sides. Every style but `bold` and `double` looks the same. `borderColor` takes a theme key; `borderDimColor` gives a very faint grey. A border and a background together make a filled rounded card, but only a soft theme key fills it in both modes.
- **Buttons.** Drawn by the app, as rounded pills about 32px tall with about 14px of side padding:
  - default and `variant="secondary"`: a grey pill (`#ececec` light, `#3a3a3a` dark) with normal text;
  - `variant="primary"`: a black pill with white text in light mode, a white pill with black text in dark mode;
  - `dimColor`: a fainter pill with grey text;
  - `plain`: bare text, no pill. A colored or bold `Text` inside a Button is ignored: the label draws plain.
- **Fields.** An Input draws its label as text, then a rounded field (1px light border, radius about 8px, 32px tall, the placeholder grey), then its submit label as a grey pill button beside it. With `rows={3}` the field is about 88px tall, with the button beside its top.
- **Line characters.** Box-drawing characters don't line up in the proportional font, nor fully in `mono`: no drawn frames or rails made of characters.
- **Hover.** A Box's `hover` background change works. Hints tied to a Button's hover did not show.

## Terminal

Everything is in the terminal's one monospace font and one size, on its own background (here a dark theme), with whatever colors the theme gives.

- **Text.** Theme colors (on this dark theme): `text` white, dim grey, `claude` salmon, `suggestion` light blue, `success` green, `error` pink, `warning` yellow, `merged` lavender. Bold, underline, dim, inverse and strikethrough draw; italic didn't. `size`, `weight` and `mono` change nothing.
- **Spaces.** Shrink to one, as on Desktop.
- **Backgrounds.** Theme keys fill whole cells strongly: `text` white, `claude` salmon, `warning` yellow. On a dark theme, `subtle` is a usable dark grey and `promptBorder` a mid grey. Raw colors become their nearest terminal color: light tints turn almost white.
- **Borders.** Drawn with box-drawing characters, one cell wide: `╭─╮` round, `┌─┐` single, `┏━┓` bold, `╔═╗` double, `+-+` classic, `╌` dashed; with a background, the inside fills.
- **Buttons.** `[ label ]`; `primary` colors the label light blue, `secondary` makes it bold, `plain` is the label alone, `dimColor` grey.
- **Fields.** `Label: placeholder` on one line; `rows={3}` is three lines.
- **Line characters.** `● ○ │ ├─ └─ ▌ ━ ▔` all draw and line up.
- **Hover.** None.

## So, for the design

- One surface's look can't be copied to the other: the mod draws by `e.surface` where they differ (it does already for the tab digits).
- Shading that works in both Desktop modes uses `promptBorder`, `diffAddedDimmed` or `diffRemovedDimmed`; accents come from text color and border color.
- The open tab is a `primary` button on Desktop (black or white pill) and bold or inverse in a terminal; a colored label inside a button does nothing.
- Rounded cards on Desktop come from `borderStyle`; in a terminal the same Box is a box-drawn frame.
- Text sizes and weights are for Desktop; a terminal has one.
- Frames, rails and tables are Boxes, never characters, on Desktop; characters are fine in a terminal.
