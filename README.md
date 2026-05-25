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

The app uses a vendored copy of `figlet.js` v1.8.0 at `vendor/figlet.js` with a small ownership side-channel patch documented in [`PATCH.md`](PATCH.md). All 294 raw `.flf` fonts from figlet v1.8.0 are vendored under `vendor/fonts/`, and `font-manifest.js` lists those filenames for the searchable font picker. Runtime font loading fetches `vendor/fonts/<FontName>.flf`, parses it with `figlet.parseFont()`, and falls back to `https://unpkg.com/figlet@1.8.0/fonts/<FontName>.flf` if the local fetch fails.

When opened via `file://`, browsers usually reject relative `fetch()` requests to `vendor/fonts/`; the CDN fallback keeps font loading working as long as the browser can reach `unpkg.com`. Offline `file://` use may only render fonts already cached by the browser. `vendor/Standard.js` is committed for Node tests only; the browser uses the `.flf` files.

To verify that `font-manifest.js` matches the vendored fonts, run:

```sh
node scripts/verify-font-manifest.js
```

## Deployment

This repository is intended for GitHub Pages deployment from the `main` branch root. The expected public URL is:

```text
https://skwid138.github.io/opencode-logo-builder/
```

Deploy after the companion `opencode-tui` plugin change supporting inline segment colors has merged; exported configs use that newer schema.
