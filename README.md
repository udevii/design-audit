# Design Audit

A Figma plugin that checks your frames for the small stuff that always comes up in design reviews, like low contrast, colors that aren't styles, text with no text style and spacing that's off the grid. It tells you why each thing matters, and if the fix is simple you can fix it in one click.

## What it checks

| Rule | Severity | What it catches | One-click fix |
|---|---|---|---|
| Text contrast | Error | Text under WCAG 4.5:1 (3:1 for large text) against the background behind it | – |
| Raw colors | Warning | Fills that aren't a style or variable, and colors that are almost the same | Use the closest color style |
| Text styles | Warning | Text with no text style | Use the closest text style |
| Spacing grid | Warning | Auto layout gaps or padding off the 4px or 8px grid | Snap to grid |
| Corner radius | Warning | Radius values not on the scale | Use the nearest value |
| Detached components | Warning | Frames that got detached from their component | – |
| Layer names | Note | Default names like "Frame 12" | Rename from the text inside |
| Tap targets | Note | Buttons, chips and tabs under 44px | – |
| Hidden layers | Note | Hidden layers left in the file | – |

For every issue you can jump to the layer, read why it matters, and if you've added an API key, click **Explain with AI** to get an explanation and fix for that specific layer.

## Trying it

```bash
npm install
npm run build        # builds src/code.ts into dist/code.js
npm test             # runs the rule tests
```

Then in the Figma desktop app go to Plugins → Development → **Import plugin from manifest…** and pick `manifest.json`. After that it shows up under Plugins → Development → Design Audit.

## How it works

- `src/code.ts` reads whatever you selected and turns it into plain data, runs the rules on it, and only changes something when you click a fix. Every fix is a normal Figma edit, so ⌘Z / Ctrl+Z undoes it.
- `src/rules.ts` has all the rules. They don't touch Figma directly, so they can be tested in Node (`test/rules.test.ts`).
- `src/ui.html` is the panel. It uses Figma's theme colors, so it works in light and dark mode.
- Instances only get checked at the top level. If something's wrong inside a component it would show up on every copy, so it's better to fix it once in the main component.

## AI and your API key

The AI part is optional and uses an Anthropic API key. Your key gets saved on your computer with `figma.clientStorage`. Nothing gets sent unless you click Explain with AI on an issue, and then it only sends that one issue, the layer's details and the names of your file's styles. The plugin can only reach `api.anthropic.com`.

## What it can't do yet

- It only suggests local styles, not library styles or color variables
- Contrast only works on solid backgrounds, not text on images or gradients
- Settings are saved per computer instead of in the file, so a team can't share them yet
