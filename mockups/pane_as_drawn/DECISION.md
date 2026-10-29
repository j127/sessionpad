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

## Changed after the first build

On 2026-10-29, after seeing the pane in the Desktop app, the owner found the `promptBorder` cards too dark for the dim text and buttons on them, and asked for a way to dismiss the Undo card. The cards now take a faint border (`borderDimColor`) around a see-through grey, `rgba(128, 128, 128, 0.12)`, which follows the mode by being laid over the pane (measured `#f0f0f0` in light mode, `#262626` in dark); the Undo card is tinted red the same way, `rgba(220, 60, 80, 0.12)`, and gains a **Dismiss** button beside Undo. The mockup shows both.
