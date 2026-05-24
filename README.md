# OpenCode Logo Builder

A static, no-build web app for designing colored FIGlet ASCII logos for the [`@skwid138/opencode-tui`](https://github.com/skwid138/opencode-tui) OpenCode plugin.

The builder lets you edit rows, choose a FIGlet font per row, split row text into colored inline blocks, preview the final terminal output, and export the plugin-compatible `logo` object:

```json
{
  "rows": [
    {
      "segments": [
        { "text": "...", "color": "#5DBDB3" }
      ]
    }
  ]
}
```

Font names, editor metadata, and preview background settings are not exported.

## Local usage

Open `index.html` directly in a browser. There is no framework, bundler, package manager, or build step.

The app loads `figlet.js` and font files from the public CDN at `unpkg.com`, so rendering requires network access unless those browser requests are already cached.

## Deployment

This repository is intended for GitHub Pages deployment from the `main` branch root. The expected public URL is:

```text
https://skwid138.github.io/opencode-logo-builder/
```

Deploy after the companion `opencode-tui` plugin change supporting inline segment colors has merged; exported configs use that newer schema.
