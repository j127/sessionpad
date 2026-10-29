// A design test page, opened with /pad-demo: every drawing piece the pane
// could use, each labelled, so a screenshot shows what a surface really draws
// before the pane's new look is designed around it. Temporary: it goes once
// the look is settled.

import type {
  EngineInterface,
  RenderElement,
  RenderInputOf,
  RenderSurface,
  ThemeKey,
} from "claude-code";

export const DEMO_ID = "sessionpad-demo";
export const DEMO_TITLE = "sessionpad · design test";

type PaneInput = RenderInputOf<"Pane", RenderSurface>;

/** The theme's colors, each tried as a background and as text. */
const THEME_KEYS: readonly ThemeKey[] = [
  "text",
  "inverseText",
  "inactive",
  "subtle",
  "suggestion",
  "remember",
  "success",
  "error",
  "warning",
  "merged",
  "claude",
  "permission",
  "planMode",
  "autoAccept",
  "promptBorder",
  "bashBorder",
  "ide",
  "diffAdded",
  "diffRemoved",
  "diffAddedDimmed",
  "diffRemovedDimmed",
  "diffAddedWord",
  "diffRemovedWord",
];

/** Raw colors: soft tints a theme key doesn't offer, light and dark. */
const RAW_COLORS: readonly string[] = [
  "#f3ede6",
  "#fbe9e1",
  "#e8eef7",
  "#2a2623",
  "#3a2a24",
  "#22303f",
];

/**
 * See-through fills, which would follow the mode as a theme key does: the
 * same grey as rgba and as 8-digit hex, then the Undo card's red. The engine
 * refuses hsl: a color is a theme key, a name, hex or rgba.
 */
const SEE_THROUGH: readonly string[] = [
  "rgba(128, 128, 128, 0.12)",
  "#8080801f",
  "rgba(220, 60, 80, 0.12)",
];

const BORDER_STYLES: readonly string[] = [
  "round",
  "single",
  "bold",
  "double",
  "classic",
  "dashed",
];

export function renderDemo($: EngineInterface, e: PaneInput): RenderElement {
  const elements = $.ui.resolve(e);
  const { Box, Text, Button } = elements;
  const Input = "Input" in elements ? elements.Input : undefined;
  const ignore = (): void => undefined;

  const heading = (key: string, title: string, note: string): RenderElement => (
    <Box key={key} flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      <Text dimColor wrap="wrap">
        {note}
      </Text>
    </Box>
  );

  const swatch = (key: string, color: string): RenderElement => (
    <Box key={key} backgroundColor={color} paddingX={1}>
      <Text>{color}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color="claude">
        Design test, on {e.surface}
      </Text>
      <Text dimColor wrap="wrap">
        Each block names the property it tries. A screenshot of this page shows
        what this surface draws.
      </Text>

      {heading(
        "h-bg",
        "1. Backgrounds: theme colors",
        "Box backgroundColor with a theme key, the text in the default color."
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        {THEME_KEYS.map((key) => swatch(`bg-${key}`, key))}
      </Box>

      {heading(
        "h-raw",
        "2. Backgrounds: raw colors",
        "Box backgroundColor with a hex color: three light tints, then three dark."
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        {RAW_COLORS.map((color) => swatch(`raw-${color}`, color))}
      </Box>

      {heading("h-text", "3. Text colors", "Text color with a theme key.")}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {THEME_KEYS.map((key) => (
          <Text key={`text-${key}`} color={key}>
            {key}
          </Text>
        ))}
      </Box>

      {heading(
        "h-style",
        "4. Text styles",
        "bold, italic, underline, dim, inverse, strikethrough; then size, weight and mono, which only some surfaces draw."
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>bold</Text>
        <Text italic>italic</Text>
        <Text underline>underline</Text>
        <Text dimColor>dim</Text>
        <Text inverse>inverse</Text>
        <Text strikethrough>strikethrough</Text>
      </Box>
      <Box flexDirection="column">
        <Text size="caption">size caption</Text>
        <Text size="footnote">size footnote</Text>
        <Text size="body">size body</Text>
        <Text size="heading">size heading</Text>
        <Text size="title">size title</Text>
        <Text weight="medium">weight medium</Text>
        <Text weight="semibold">weight semibold</Text>
        <Text mono>mono: 12:31 4m10s 3 files</Text>
      </Box>

      {heading(
        "h-border",
        "5. Borders",
        "borderStyle with borderColor claude; the last two add a background and dim the border."
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        {BORDER_STYLES.map((style) => (
          <Box
            key={`border-${style}`}
            borderStyle={style}
            borderColor="claude"
            paddingX={1}
          >
            <Text>{style}</Text>
          </Box>
        ))}
        <Box
          key="border-bg"
          borderStyle="round"
          borderColor="claude"
          backgroundColor="#fbe9e1"
          paddingX={1}
        >
          <Text>round + tint</Text>
        </Box>
        <Box key="border-dim" borderStyle="round" borderDimColor paddingX={1}>
          <Text>round, dim</Text>
        </Box>
      </Box>

      {heading(
        "h-button",
        "6. Buttons",
        "default, primary, secondary, plain, dim, and a button whose label is a styled Text. Pressing does nothing."
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        <Button key="btn-default" label="Default" onPress={ignore} />
        <Button
          key="btn-primary"
          label="Primary"
          variant="primary"
          onPress={ignore}
        />
        <Button
          key="btn-secondary"
          label="Secondary"
          variant="secondary"
          onPress={ignore}
        />
        <Button key="btn-plain" label="Plain" plain onPress={ignore} />
        <Button key="btn-dim" label="Dim" dimColor onPress={ignore} />
        <Button key="btn-styled" label="Styled" plain onPress={ignore}>
          <Text bold color="claude">
            Styled
          </Text>
        </Button>
      </Box>
      <Text dimColor wrap="wrap">
        Three plain buttons in a row, as tabs could be, the first one primary:
      </Text>
      <Box flexDirection="row" columnGap={1}>
        <Button key="tab-a" label="Notes" variant="primary" onPress={ignore} />
        <Button key="tab-b" label="Timeline" plain onPress={ignore} />
        <Button key="tab-c" label="Workspace" plain onPress={ignore} />
      </Box>

      {heading(
        "h-input",
        "7. Fields",
        "Input with a label, and one three rows tall."
      )}
      {Input === undefined ? (
        <Text dimColor>This surface has no Input.</Text>
      ) : (
        <Box flexDirection="column" rowGap={1}>
          <Input
            key="input-one"
            label="Note"
            placeholder="Add a note…"
            submitLabel="add"
            onSubmit={ignore}
          />
          <Input
            key="input-rows"
            placeholder="Three rows tall"
            rows={3}
            submitLabel="save"
            onSubmit={ignore}
          />
        </Box>
      )}

      {heading(
        "h-chars",
        "8. Drawing characters",
        "Lines and dots in plain text, then the same in mono."
      )}
      <Box flexDirection="column">
        <Text>╭─────────╮ ● 12:31 ├─ main</Text>
        <Text>│ Notes │ │ 11:52 └─ feat/x</Text>
        <Text>╰─────────╯ ○ 11:20 ▌ ━━━━ ▔▔▔▔</Text>
        <Text mono>╭─────────╮ ● 12:31 ├─ main</Text>
        <Text mono>│ Notes │ │ 11:52 └─ feat/x</Text>
        <Text mono>╰─────────╯ ○ 11:20 ▌ ━━━━ ▔▔▔▔</Text>
      </Box>

      {heading(
        "h-chip",
        "9. Chips and stripes",
        "Small tags as a background with padding; two rows on alternating backgrounds."
      )}
      <Box flexDirection="row" columnGap={1}>
        <Box key="chip-1" backgroundColor="subtle" paddingX={1}>
          <Text>3 files</Text>
        </Box>
        <Box key="chip-2" backgroundColor="warning" paddingX={1}>
          <Text color="inverseText">stopped</Text>
        </Box>
        <Box key="chip-3" backgroundColor="claude" paddingX={1}>
          <Text color="inverseText">→ feat/x</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Box key="zebra-1" backgroundColor="#f3ede6" paddingX={1}>
          <Text>A row on a light tint</Text>
        </Box>
        <Box key="zebra-2" paddingX={1}>
          <Text>A row with no background</Text>
        </Box>
        <Box key="zebra-3" backgroundColor="#2a2623" paddingX={1}>
          <Text>A row on a dark tint</Text>
        </Box>
      </Box>

      {heading(
        "h-hover",
        "10. Hover",
        "Point at the box: its background should turn the accent color. Below it, a hidden line should appear."
      )}
      <Box
        key="hover-box"
        borderStyle="round"
        paddingX={1}
        hover={{ backgroundColor: "claude", scope: "demo-hover" }}
      >
        <Text>Point here</Text>
      </Box>
      <Box
        key="hover-reveal"
        display="none"
        hover={{ display: "flex", scope: "demo-hover" }}
      >
        <Text color="claude">Hover works: this line was hidden.</Text>
      </Box>

      {heading(
        "h-filled",
        "11. Filled cards",
        "borderStyle round with the border and the background the same soft theme color: does each draw as one rounded, filled card in both modes?"
      )}
      <Box flexDirection="column" rowGap={1}>
        {(
          ["promptBorder", "diffAddedDimmed", "diffRemovedDimmed"] as const
        ).map((key) => (
          <Box
            key={`filled-${key}`}
            borderStyle="round"
            borderColor={key}
            backgroundColor={key}
            paddingX={1}
            flexDirection="column"
          >
            <Text bold>A card filled with {key}</Text>
            <Text dimColor>with a second, dim line under it</Text>
          </Box>
        ))}
      </Box>

      {heading(
        "h-hover-button",
        "12. Hover around a button",
        "Point at the Edit button: its box should turn the accent color, and a hint line should appear below. Then point at the box's empty part."
      )}
      <Box
        key="hover-button-box"
        flexDirection="row"
        columnGap={1}
        paddingX={1}
        hover={{ backgroundColor: "promptBorder", scope: "demo-hover-button" }}
      >
        <Button key="hover-button" label="Edit" onPress={ignore} />
        <Text dimColor>the box's empty part</Text>
      </Box>
      <Box
        key="hover-button-hint"
        display="none"
        hover={{ display: "flex", scope: "demo-hover-button" }}
      >
        <Text color="claude">
          Hover reaches past the button: this hint was hidden.
        </Text>
      </Box>

      {heading(
        "h-see-through",
        "13. See-through fills",
        "Colors at 12% over the pane, the grey written two ways: each card should be a light tint in light mode and a dark one in dark mode. A card with only a faint border means that way of writing a color doesn't draw."
      )}
      <Box flexDirection="column" rowGap={1}>
        {SEE_THROUGH.map((color, index) => (
          <Box
            key={`see-through-${index}`}
            borderStyle="round"
            borderDimColor
            backgroundColor={color}
            paddingX={1}
            flexDirection="column"
          >
            <Text bold>Filled with {color}</Text>
            <Text dimColor>with a dim line under it</Text>
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`see-through-button-${index}`}
                label="Edit"
                dimColor
                onPress={ignore}
              />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
