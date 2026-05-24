# CONTEXT.md

Domain glossary for the opencode-logo-builder web app.

### Logo Builder

A single-page static web app (vanilla HTML/CSS/JS, no build step) deployed via GitHub Pages that generates logo configs for the `@skwid138/opencode-tui` plugin.

### Row

A horizontal line of the logo. Each row has a font (figlet font name) and contains one or more blocks rendered inline.

### Block (Segment)

A piece of text within a row. Has `text` and `color` (hex string). Blocks within a row share the row's font and render horizontally concatenated.

### Color

A hex color string stored directly on each block. No shared palette — color is a property of each block. New blocks default to JustVibes colors.

### Builder View

The editing interface showing blocks with visual gaps between them for editing clarity.

### Final Preview

The seamless rendered preview showing the full ASCII art with colors applied, as it would appear in the terminal.

### JustVibes

The default logo pre-populated in the builder. Uses teal (`#5DBDB3`) and pink (`#F8B4C4`).

### Export

The generated JSON `logo` object (not the full plugins config) that users paste into their opencode config. Includes a comment showing placement context.

### Font

A figlet font applied per-row. Fonts are loaded via CDN (figlet.js). A curated subset loads immediately; remaining fonts eager-load in background after first paint.
