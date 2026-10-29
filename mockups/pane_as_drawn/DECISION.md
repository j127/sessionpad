# Design decision

Chosen mockup: `mockups/pane_as_drawn/02-cards.html`

## Settings

```json
{
  "v": 1,
  "slug": "02-cards",
  "mode": "light",
  "palette": "claude",
  "font": "system",
  "radius": 8,
  "density": 1,
  "fontStacks": {
    "body": "system-ui, -apple-system, 'Segoe UI', sans-serif",
    "heading": "system-ui, -apple-system, 'Segoe UI', sans-serif"
  },
  "tokens": {
    "light": {
      "--c-bg": "#f4f2ef",
      "--c-surface": "#ffffff",
      "--c-text": "#1b1b1b",
      "--c-muted": "#6b6b6b",
      "--c-accent": "#c8643f",
      "--c-on-accent": "#ffffff",
      "--c-border": "#e2e0dc"
    },
    "dark": {
      "--c-bg": "#121212",
      "--c-surface": "#1a1a1a",
      "--c-text": "#e8e8e8",
      "--c-muted": "#9a9a9a",
      "--c-accent": "#d97757",
      "--c-on-accent": "#111111",
      "--c-border": "#2e2e2e"
    }
  }
}
```

## Rationale

The owner picked Cards as it stands, with no changes asked for. It answers the redesign brief most directly: the headline and each note sit on a soft shaded card instead of an outline, the open tab is the app's primary pill, a deleted note leaves a pink card with Undo, and the note being edited becomes a faint outlined card with a three-row field. The accent is the `claude` theme key, and the mode follows the app's own light or dark, since `promptBorder`, `diffAddedDimmed` and `diffRemovedDimmed` adapt by themselves. In a terminal the same cards draw as box-drawn frames, as the mockup's terminal column shows; the page's element table is the build reference.
