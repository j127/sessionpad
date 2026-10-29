# What the pane can draw

Measured with `/pad-demo`, the mod's design test page, on 2026-10-28 and 2026-10-29 with Claude Code 2.1.308: in the Desktop app's Code tab in light and dark mode (screenshots from the owner, kept in `reference/`: `desktop-light.webp`, `desktop-dark.webp`, and `desktop-hover-button.png` with the pointer on section 12), and in a terminal with a dark theme (captured through tmux, which reports 256-color approximations). The Desktop colors below are read from the screenshots' flat areas; the screenshots are scaled down, which leaves a light or dark ring at sharp edges that isn't drawn by the app. Every mockup in this set keeps to what is listed here, so what it shows is what the mod can draw.

## Desktop app

The pane body is the app's own background (white in light mode, near-black `#181818` in dark), set in the system font at about 15px, with text `#1b1b1b` (light) or `#e8e8e8` (dark).

- **Text.** Theme colors follow the mode. Bold, italic, underline, dim, inverse and strikethrough all draw. `size` draws five steps (caption about 12px, footnote 13px, body 15px, heading 17px, title 22px), `weight` draws medium and semibold, and `mono` draws the system monospace face.
- **Spaces.** Runs of spaces shrink to one, so columns can't be lined up with spaces: they need Boxes of a fixed width.
- **Backgrounds.** `backgroundColor` fills a plain rectangle, with no rounding, just big enough for the text plus its padding (`paddingX={1}` is about 11px a side). Most theme keys fill strongly: `claude` is the orange accent, `success` green, `error` red, `warning` brown or amber, and `text`, `inactive`, `subtle`, `suggestion`, `remember`, `permission` and `ide` dark greys in light mode and light greys in dark. Three keys are soft shades that follow the mode:
  - `promptBorder`: light grey `#cecece` in light mode, dark grey `#474747` in dark. The one neutral shade for cards and stripes.
  - `diffAddedDimmed`: pale green `#d7edda` in light mode, deep green `#223f23` in dark.
  - `diffRemovedDimmed`: pale pink `#f9d5dd` in light mode, deep maroon `#472024` in dark.
- **Raw colors.** A hex color draws exactly as given, but doesn't follow the mode: a light tint is right in light mode and an unreadable light block under white text in dark mode, and a dark tint the reverse. So no opaque one is used.
- **See-through colors.** The engine admits a theme key, a color name, hex (8-digit `#rrggbbaa` too) or `rgba()`, and refuses anything else, `hsl()` among them: a tree holding one is refused whole, so the pane draws nothing. A see-through color is laid over whatever is beneath it, so a mid grey at low opacity, `rgba(128, 128, 128, 0.12)`, should be a light tint (`#f0f0f0`) on the white pane and a dark one (`#252525`) on the near-black pane: it would follow the mode as the soft keys do, but lighter. Seen on 2026-10-29: the pane's cards, filled so with a `borderDimColor` border, draw `#f0f0f0` with a `#e4e4e4` edge on the white pane and `#262626` with a `#2b2b2b` edge on the dark one (`#191919` in that screenshot), and the default button pill on them `#e4e4e4` and `#464646`. The pane uses it since `promptBorder` drew too dark for dim text and button pills on it; section 13 of `/pad-demo` tries rgba and 8-digit hex side by side.
- **Borders.** A Box with `borderStyle` draws as a rounded card, radius about 10px, 1px border (`bold` 2px, `double` a double line), with about 18px of padding above and below one line of text and about 11px at the sides. Every style but `bold` and `double` looks the same. `borderColor` takes a theme key; `borderDimColor` gives a very faint grey. A border and a background in the same soft theme key make one filled rounded card, its border lost in the fill: tried with all three soft keys, each draws right in both modes (section 11). A raw color fills it too, but only in one mode.
- **Buttons.** Drawn by the app, as rounded pills about 32px tall with about 14px of side padding:
  - default and `variant="secondary"`: a see-through grey pill with normal text, black at about 5% in light mode (`#f2f2f2` on white) and white at about 15% in dark (`#3b3b3b` on `#181818`). On a shaded card it draws a step darker or lighter than the card (`#c4c4c4` on `#cecece`);
  - `variant="primary"`: a solid black pill (`#181818`) with white text in light mode, a solid white pill (`#efefef`) with black text in dark mode;
  - `dimColor`: the same pill with grey text;
  - `plain`: bare text, no pill. A colored or bold `Text` inside a Button is ignored: the label draws plain.
- **Fields.** An Input draws its label as text, then a rounded field (1px light border, radius about 8px, 32px tall, the placeholder grey), then its submit label as a grey pill button beside it, whether or not the field has focus (`submit` when no `submitLabel` is given). With `rows={3}` the field is about 88px tall, with the button beside its top. So a form's main action is the Input's own grey pill: a primary Button beside it would draw next to that pill, not instead of it.
- **Line characters.** Box-drawing characters don't line up in the proportional font, nor fully in `mono`: no drawn frames or rails made of characters.
- **Hover.** A Box's `hover` background change works (section 10), and keeps working while the pointer is on a Button inside the Box (section 12). Nothing can be shown by hover: a hidden Box given `display: "flex"` on hover through a shared `scope` never appeared, neither the hint under section 12 nor the H and X hints in the pane.

## Terminal

Everything is in the terminal's one monospace font and one size, on its own background (here a dark theme), with whatever colors the theme gives.

- **Text.** Theme colors (on this dark theme): `text` white, dim grey, `claude` salmon, `suggestion` light blue, `success` green, `error` pink, `warning` yellow, `merged` lavender. Bold, underline, dim, inverse and strikethrough draw; italic didn't. `size`, `weight` and `mono` change nothing.
- **Spaces.** Shrink to one, as on Desktop.
- **Backgrounds.** Theme keys fill whole cells strongly: `text` white, `claude` salmon, `warning` yellow. On a dark theme, `subtle` is a usable dark grey and `promptBorder` a mid grey. Raw colors become their nearest terminal color: light tints turn almost white.
- **Borders.** Drawn with box-drawing characters, one cell wide: `╭─╮` round, `┌─┐` single, `┏━┓` bold, `╔═╗` double, `+-+` classic, `╌` dashed; with a background, the inside fills.
- **Buttons.** `[ label ]`; `primary` colors the label light blue, `secondary` makes it bold, `plain` is the label alone, `dimColor` grey.
- **Fields.** `Label: placeholder` on one line; `rows={3}` is three lines. The submit label is drawn beside the field only while it has focus (from the types; not yet seen).
- **Line characters.** `● ○ │ ├─ └─ ▌ ━ ▔` all draw and line up.
- **Hover.** None.

## So, for the design

- One surface's look can't be copied to the other: the mod draws by `e.surface` where they differ (it does already for the tab digits).
- Shading that works in both Desktop modes uses `promptBorder`, `diffAddedDimmed` or `diffRemovedDimmed`, or a see-through color for a lighter tint; accents come from text color and border color.
- The open tab is a `primary` button on Desktop (black or white pill) and bold or inverse in a terminal; a colored label inside a button does nothing.
- Rounded cards on Desktop come from `borderStyle`; in a terminal the same Box is a box-drawn frame.
- Text sizes and weights are for Desktop; a terminal has one.
- Hover may tint a note card or a row on Desktop, as a sign it can be acted on, but nothing may depend on it: no hints, buttons or text that appear only on hover.
- Frames, rails and tables are Boxes, never characters, on Desktop; characters are fine in a terminal.
