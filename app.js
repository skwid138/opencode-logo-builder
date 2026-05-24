(function () {
  "use strict";

  const STORAGE_KEY = "opencode-logo-builder-state-v1";
  const THEME_STORAGE_KEY = "logo-builder-theme";
  const STORAGE_VERSION = 1;
  const TEAL = "#5DBDB3";
  const PINK = "#F8B4C4";
  const DEFAULT_PREVIEW_BACKGROUND = "#0B1020";
  const FONT_PATH = "https://unpkg.com/figlet@1.8.0/fonts";
  const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;
  const CURATED_FONTS = [
    "Standard",
    "Big",
    "Banner",
    "Slant",
    "Small",
    "Doom",
    "Digital",
    "Mini",
    "Block",
    "Shadow",
  ];
  const FALLBACK_EXTRA_FONTS = [
    "3-D",
    "ANSI Shadow",
    "Avatar",
    "Basic",
    "Bubble",
    "Chunky",
    "Colossal",
    "Cosmic",
    "Epic",
    "Ghost",
    "Graffiti",
    "Larry 3D",
    "Lean",
    "Ogre",
    "Puffy",
    "Rectangles",
    "Roman",
    "Speed",
    "Star Wars",
    "Stop",
    "Univers",
  ];

  const state = {
    rows: cloneDefaultState().rows,
  };

  const ui = {
    theme: "dark",
    previewBackground: DEFAULT_PREVIEW_BACKGROUND,
    storageNote: "",
    fatalError: "",
    copyStatus: "",
    availableFonts: [...new Set([...CURATED_FONTS, ...FALLBACK_EXTRA_FONTS])],
    loadedFonts: new Set(),
    loadingFonts: new Set(),
    failedFonts: new Map(),
    fontPromises: new Map(),
    lastExportText: "",
    lastRenderResult: null,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    applyInitialTheme();
    restoreState();
    wireGlobalControls();
    initializeFiglet();
    renderApp();
  }

  function cacheElements() {
    els.themeToggle = document.getElementById("themeToggle");
    els.themeToggleText = document.getElementById("themeToggleText");
    els.addRowButton = document.getElementById("addRowButton");
    els.resetButton = document.getElementById("resetButton");
    els.previewBackgroundInput = document.getElementById("previewBackgroundInput");
    els.fontStatus = document.getElementById("fontStatus");
    els.messages = document.getElementById("messages");
    els.rowsContainer = document.getElementById("rowsContainer");
    els.builderPreview = document.getElementById("builderPreview");
    els.finalPreview = document.getElementById("finalPreview");
    els.copyExportButton = document.getElementById("copyExportButton");
    els.copyStatus = document.getElementById("copyStatus");
    els.exportOutput = document.getElementById("exportOutput");
  }

  function applyInitialTheme() {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "dark" || savedTheme === "light") {
        ui.theme = savedTheme;
        applyTheme();
        return;
      }
    } catch (error) {
      // Ignore storage failures and fall back to the system preference.
    }

    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    ui.theme = prefersLight ? "light" : "dark";
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = ui.theme;
    const lightTarget = ui.theme === "dark";
    els.themeToggle.setAttribute("aria-label", lightTarget ? "Switch to light theme" : "Switch to dark theme");
    els.themeToggleText.textContent = lightTarget ? "Light" : "Dark";
  }

  function wireGlobalControls() {
    els.themeToggle.addEventListener("click", () => {
      ui.theme = ui.theme === "dark" ? "light" : "dark";
      saveThemePreference();
      applyTheme();
    });

    els.previewBackgroundInput.addEventListener("input", (event) => {
      ui.previewBackground = normalizeColor(event.target.value, ui.previewBackground);
      renderDerived();
    });

    els.addRowButton.addEventListener("click", () => {
      state.rows.push({
        font: "Standard",
        blocks: [{ text: "", color: nextDefaultColor(0) }],
      });
      saveState();
      ensureFontLoaded("Standard", { selected: true });
      renderApp();
    });

    els.resetButton.addEventListener("click", () => {
      if (!window.confirm("Reset the builder to the default JustVibes logo?")) {
        return;
      }
      const defaults = cloneDefaultState();
      state.rows = defaults.rows;
      ui.previewBackground = DEFAULT_PREVIEW_BACKGROUND;
      els.previewBackgroundInput.value = ui.previewBackground;
      saveState();
      ensureSelectedFontsLoaded();
      renderApp();
    });

    els.copyExportButton.addEventListener("click", async () => {
      await copyText(ui.lastExportText);
    });
  }

  function initializeFiglet() {
    if (!window.figlet || typeof window.figlet.loadFont !== "function") {
      ui.fatalError = "figlet.js did not load from the CDN. Check your network connection and refresh.";
      renderApp();
      return;
    }

    if (typeof window.figlet.defaults === "function") {
      window.figlet.defaults({ fontPath: FONT_PATH, fetchFontIfMissing: true });
    }

    discoverAvailableFonts();
    CURATED_FONTS.forEach((font) => loadFont(font, { selected: isSelectedFont(font) }));
    window.requestAnimationFrame(() => {
      setTimeout(loadRemainingFonts, 0);
    });
  }

  function discoverAvailableFonts() {
    if (!window.figlet || typeof window.figlet.fonts !== "function") {
      return;
    }

    try {
      window.figlet.fonts((error, fonts) => {
        if (error || !Array.isArray(fonts)) {
          return;
        }
        ui.availableFonts = mergeFonts(fonts);
        loadRemainingFonts();
        renderApp();
      });
    } catch (error) {
      // Fall back to the curated list. A failed font discovery should not break rendering.
    }
  }

  function mergeFonts(discoveredFonts) {
    const selectedFonts = state.rows.map((row) => row.font).filter(Boolean);
    return [...new Set([...CURATED_FONTS, ...selectedFonts, ...discoveredFonts, ...FALLBACK_EXTRA_FONTS])].sort((a, b) => {
      const curatedA = CURATED_FONTS.indexOf(a);
      const curatedB = CURATED_FONTS.indexOf(b);
      if (curatedA !== -1 || curatedB !== -1) {
        if (curatedA === -1) return 1;
        if (curatedB === -1) return -1;
        return curatedA - curatedB;
      }
      return a.localeCompare(b);
    });
  }

  function loadRemainingFonts() {
    ui.availableFonts
      .filter((font) => !CURATED_FONTS.includes(font))
      .forEach((font, index) => {
        setTimeout(() => loadFont(font, { selected: isSelectedFont(font), background: true }), index * 18);
      });
  }

  function ensureSelectedFontsLoaded() {
    selectedFonts().forEach((font) => loadFont(font, { selected: true }));
  }

  function loadFont(font, options = {}) {
    if (!font || ui.loadedFonts.has(font) || ui.failedFonts.has(font)) {
      return Promise.resolve();
    }
    if (ui.fontPromises.has(font)) {
      return ui.fontPromises.get(font);
    }
    if (!window.figlet || typeof window.figlet.loadFont !== "function") {
      return Promise.resolve();
    }

    ui.loadingFonts.add(font);
    if (options.selected && !options.background) {
      renderApp();
    } else if (options.selected) {
      renderDerived();
    }

    const promise = Promise.resolve()
      .then(() => window.figlet.loadFont(font, () => {}))
      .then(() => {
        ui.loadedFonts.add(font);
        ui.failedFonts.delete(font);
      })
      .catch((error) => {
        ui.failedFonts.set(font, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        ui.loadingFonts.delete(font);
        ui.fontPromises.delete(font);
        if (options.selected || isSelectedFont(font)) {
          renderApp();
        }
      });

    ui.fontPromises.set(font, promise);
    return promise;
  }

  function renderApp() {
    renderEditor();
    renderDerived();
  }

  function renderEditor() {
    els.rowsContainer.replaceChildren();

    if (state.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No rows yet. Add a row to start building a logo.";
      els.rowsContainer.append(empty);
      return;
    }

    state.rows.forEach((row, rowIndex) => {
      const rowEl = document.createElement("section");
      rowEl.className = "builder-row";
      rowEl.setAttribute("aria-labelledby", `row-${rowIndex}-title`);

      const header = document.createElement("div");
      header.className = "row-header";

      const titleWrap = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "row-title";
      title.id = `row-${rowIndex}-title`;
      title.textContent = `Row ${rowIndex + 1}`;
      const rowHint = document.createElement("p");
      rowHint.className = "hint";
      rowHint.textContent = "Blocks in this row share the selected font.";
      titleWrap.append(title, rowHint);

      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.append(createFontField(row, rowIndex), createRowButton("Add block", () => addBlock(rowIndex)), createRowButton("Remove row", () => removeRow(rowIndex), "danger"));

      header.append(titleWrap, actions);
      rowEl.append(header);

      const blocks = document.createElement("div");
      blocks.className = "blocks-stack";
      if (!row.blocks.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "This row has no blocks. Add a block to render text.";
        blocks.append(empty);
      } else {
        row.blocks.forEach((block, blockIndex) => {
          blocks.append(createBlockCard(block, rowIndex, blockIndex));
        });
      }
      rowEl.append(blocks);
      els.rowsContainer.append(rowEl);
    });
  }

  function createFontField(row, rowIndex) {
    const label = document.createElement("label");
    label.className = "field";
    const text = document.createElement("span");
    text.textContent = "Font";
    const select = document.createElement("select");
    ensureFontOptionPresent(row.font);
    ui.availableFonts.forEach((font) => {
      const option = document.createElement("option");
      option.value = font;
      const suffix = ui.loadingFonts.has(font) ? " (loading)" : ui.failedFonts.has(font) ? " (failed)" : "";
      option.textContent = `${font}${suffix}`;
      select.append(option);
    });
    select.value = row.font;
    select.addEventListener("change", (event) => {
      state.rows[rowIndex].font = event.target.value;
      saveState();
      ensureFontLoaded(event.target.value, { selected: true });
      renderApp();
    });
    label.append(text, select);
    return label;
  }

  function createRowButton(text, onClick, variant = "subtle") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${variant}`;
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function createBlockCard(block, rowIndex, blockIndex) {
    const card = document.createElement("div");
    card.className = "block-card";

    const textLabel = document.createElement("label");
    textLabel.className = "field";
    const textLabelText = document.createElement("span");
    textLabelText.textContent = `Block ${blockIndex + 1} text`;
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = block.text;
    textInput.placeholder = "Text to render";
    textInput.addEventListener("input", (event) => {
      state.rows[rowIndex].blocks[blockIndex].text = event.target.value;
      saveState();
      renderDerived();
    });
    textLabel.append(textLabelText, textInput);

    const colorLabel = document.createElement("label");
    colorLabel.className = "field";
    const colorLabelText = document.createElement("span");
    colorLabelText.textContent = "Color";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = block.color;
    colorInput.addEventListener("input", (event) => {
      const color = normalizeColor(event.target.value, block.color);
      state.rows[rowIndex].blocks[blockIndex].color = color;
      hexInput.value = color;
      saveState();
      renderDerived();
    });
    colorLabel.append(colorLabelText, colorInput);

    const hexLabel = document.createElement("label");
    hexLabel.className = "field";
    const hexLabelText = document.createElement("span");
    hexLabelText.textContent = "Hex";
    const hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "hex-input";
    hexInput.value = block.color;
    hexInput.placeholder = "#RRGGBB";
    hexInput.inputMode = "text";
    hexInput.addEventListener("input", (event) => {
      const value = event.target.value.trim();
      if (!HEX_COLOR_RE.test(value)) {
        hexInput.classList.add("invalid");
        return;
      }
      const color = normalizeColor(value, block.color);
      state.rows[rowIndex].blocks[blockIndex].color = color;
      colorInput.value = color;
      hexInput.value = color;
      hexInput.classList.remove("invalid");
      saveState();
      renderDerived();
    });
    hexInput.addEventListener("blur", () => {
      const currentColor = state.rows[rowIndex].blocks[blockIndex].color;
      if (!HEX_COLOR_RE.test(hexInput.value.trim())) {
        hexInput.value = currentColor;
      }
      hexInput.classList.remove("invalid");
    });
    hexLabel.append(hexLabelText, hexInput);

    const actionWrap = document.createElement("div");
    actionWrap.className = "block-actions";
    const copyColorButton = createRowButton("Copy color", () => copyText(state.rows[rowIndex].blocks[blockIndex].color), "subtle");
    const removeButton = createRowButton("Remove", () => removeBlock(rowIndex, blockIndex), "danger");
    actionWrap.append(copyColorButton, removeButton);

    card.append(textLabel, colorLabel, hexLabel, actionWrap);
    return card;
  }

  function renderDerived() {
    els.previewBackgroundInput.value = ui.previewBackground;
    els.builderPreview.style.backgroundColor = ui.previewBackground;
    els.finalPreview.style.backgroundColor = ui.previewBackground;

    const result = renderLogo();
    ui.lastRenderResult = result;
    ui.lastExportText = buildExportText(result.logo);

    renderFontStatus();
    renderMessages(result);
    renderPreview(els.builderPreview, result.lines, true);
    renderPreview(els.finalPreview, result.lines, false);
    els.exportOutput.textContent = ui.lastExportText;
    els.copyStatus.textContent = ui.copyStatus;
    els.copyExportButton.disabled = Boolean(ui.fatalError) || selectedFonts().some((font) => ui.loadingFonts.has(font));
  }

  function renderFontStatus() {
    const selectedLoading = selectedFonts().filter((font) => ui.loadingFonts.has(font));
    const selectedFailed = selectedFonts().filter((font) => ui.failedFonts.has(font));
    const parts = [`${ui.loadedFonts.size} loaded`, `${ui.loadingFonts.size} loading`];
    if (ui.failedFonts.size) {
      parts.push(`${ui.failedFonts.size} failed`);
    }
    if (selectedLoading.length) {
      parts.push(`export disabled while ${selectedLoading.join(", ")} loads`);
    }
    if (selectedFailed.length) {
      parts.push(`selected font failed: ${selectedFailed.join(", ")}`);
    }
    els.fontStatus.textContent = `Font status: ${parts.join(" · ")}`;
  }

  function renderMessages(result) {
    els.messages.replaceChildren();
    if (ui.fatalError) {
      appendMessage(ui.fatalError, "error");
    }
    if (ui.storageNote) {
      appendMessage(ui.storageNote, "warning");
    }
    result.errors.forEach((message) => appendMessage(message, "error"));
    result.warnings.forEach((message) => appendMessage(message, "warning"));
  }

  function appendMessage(text, type) {
    const message = document.createElement("div");
    message.className = `message ${type}`;
    message.textContent = text;
    els.messages.append(message);
  }

  function renderPreview(container, lines, builderMode) {
    container.replaceChildren();
    if (!lines.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nothing rendered yet. Add non-empty text or wait for the selected font to load.";
      container.append(empty);
      return;
    }

    lines.forEach((line) => {
      const lineEl = document.createElement("div");
      lineEl.className = "preview-line";
      line.segments.forEach((segment) => {
        const span = document.createElement("span");
        span.style.color = segment.color;
        if (builderMode) {
          span.className = "builder-segment";
        }
        span.textContent = segment.text;
        lineEl.append(span);
      });
      container.append(lineEl);
    });
  }

  function renderLogo() {
    const result = {
      logo: { rows: [] },
      lines: [],
      warnings: [],
      errors: [],
      renderedRowCount: 0,
      renderErrorCount: 0,
    };

    if (ui.fatalError) {
      return result;
    }

    state.rows.forEach((row, rowIndex) => {
      const font = row.font || "Standard";
      if (ui.loadingFonts.has(font)) {
        result.warnings.push(`Row ${rowIndex + 1}: font “${font}” is still loading.`);
        return;
      }
      if (ui.failedFonts.has(font)) {
        result.errors.push(`Row ${rowIndex + 1}: font “${font}” failed to load and was skipped.`);
        return;
      }
      if (!ui.loadedFonts.has(font)) {
        loadFont(font, { selected: true });
        result.warnings.push(`Row ${rowIndex + 1}: font “${font}” has not loaded yet.`);
        return;
      }

      const renderedBlocks = [];
      row.blocks.forEach((block, blockIndex) => {
        const text = String(block.text ?? "").replace(/[\r\n]/g, "");
        if (text === "") {
          return;
        }
        try {
          const rendered = window.figlet.textSync(text, {
            font,
            horizontalLayout: "default",
            verticalLayout: "default",
          });
          const lines = rendered.split("\n");
          const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
          renderedBlocks.push({
            color: normalizeColor(block.color, TEAL),
            lines,
            width,
          });
        } catch (error) {
          result.renderErrorCount += 1;
          result.errors.push(`Row ${rowIndex + 1}, block ${blockIndex + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      if (!renderedBlocks.length) {
        result.warnings.push(`Row ${rowIndex + 1}: no blocks rendered, so the row was skipped.`);
        return;
      }

      const height = renderedBlocks.reduce((max, block) => Math.max(max, block.lines.length), 0);
      for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
        const segments = renderedBlocks.map((block, blockIndex) => {
          const rawLine = block.lines[lineIndex] || "";
          const text = blockIndex === renderedBlocks.length - 1 ? rightTrim(rawLine) : padRight(rawLine, block.width);
          return { text, color: block.color };
        });
        const nonEmptySegments = segments.filter((segment) => segment.text !== "");
        if (nonEmptySegments.length === 0) {
          continue;
        }
        result.logo.rows.push({
          segments: nonEmptySegments.map((segment) => ({ text: segment.text, color: segment.color })),
        });
        result.lines.push({ segments: nonEmptySegments });
        result.renderedRowCount += 1;
      }
    });

    if (result.renderedRowCount >= 20) {
      result.warnings.push(`The logo renders ${result.renderedRowCount} plugin rows. That may be tall for a terminal header.`);
    }
    if (result.renderErrorCount > 0) {
      result.warnings.push(`${result.renderErrorCount} block${result.renderErrorCount === 1 ? "" : "s"} failed to render. Export includes the successful blocks only.`);
    }

    return result;
  }

  function buildExportText(logo) {
    return [
      "// Paste into your opencode config:",
      "// [\"@skwid138/opencode-tui/tui\", { \"logo\": <paste here> }]",
      JSON.stringify(logo, null, 2),
    ].join("\n");
  }

  function addBlock(rowIndex) {
    const row = state.rows[rowIndex];
    row.blocks.push({
      text: "",
      color: nextDefaultColor(row.blocks.length),
    });
    saveState();
    renderApp();
  }

  function removeBlock(rowIndex, blockIndex) {
    state.rows[rowIndex].blocks.splice(blockIndex, 1);
    saveState();
    renderApp();
  }

  function removeRow(rowIndex) {
    state.rows.splice(rowIndex, 1);
    saveState();
    renderApp();
  }

  async function copyText(text) {
    if (!text) {
      ui.copyStatus = "Nothing to copy yet.";
      renderDerived();
      return;
    }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      ui.copyStatus = "Copied to clipboard.";
    } catch (error) {
      try {
        fallbackCopy(text);
        ui.copyStatus = "Copied with fallback clipboard path.";
      } catch (fallbackError) {
        ui.copyStatus = "Copy failed. Select the export text and copy manually.";
      }
    }
    renderDerived();
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.inset = "auto auto 0 0";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("document.execCommand('copy') returned false");
    }
  }

  function restoreState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORAGE_VERSION) {
        ui.storageNote = "Saved data used an unsupported version, so the default JustVibes logo was loaded.";
        return;
      }
      const restored = normalizeState(parsed.state);
      state.rows = restored.rows;
    } catch (error) {
      ui.storageNote = "Saved data could not be read. The app will keep working without restoring previous edits.";
    }
  }

  function saveState() {
    try {
      const payload = JSON.stringify({
        version: STORAGE_VERSION,
        state: normalizeState(state),
      });
      window.localStorage.setItem(STORAGE_KEY, payload);
      ui.storageNote = "";
    } catch (error) {
      ui.storageNote = "Changes could not be saved to localStorage. You can still export the current logo.";
    }
  }

  function saveThemePreference() {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, ui.theme);
    } catch (error) {
      // Theme persistence is best-effort; the toggle should still work without storage.
    }
  }

  function normalizeState(candidate) {
    if (!candidate || !Array.isArray(candidate.rows)) {
      return cloneDefaultState();
    }
    return {
      rows: candidate.rows.map((row) => ({
        font: typeof row.font === "string" && row.font ? row.font : "Standard",
        blocks: Array.isArray(row.blocks)
          ? row.blocks.map((block, index) => ({
              text: typeof block.text === "string" ? block.text : "",
              color: normalizeColor(block.color, nextDefaultColor(index)),
            }))
          : [],
      })),
    };
  }

  function cloneDefaultState() {
    return {
      rows: [
        {
          font: "Standard",
          blocks: [
            { text: "Just", color: TEAL },
            { text: "Vibes", color: PINK },
          ],
        },
      ],
    };
  }

  function normalizeColor(value, fallback) {
    if (typeof value !== "string" || !HEX_COLOR_RE.test(value.trim())) {
      return fallback || TEAL;
    }
    const withHash = value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
    return withHash.toUpperCase();
  }

  function selectedFonts() {
    return [...new Set(state.rows.map((row) => row.font || "Standard"))];
  }

  function isSelectedFont(font) {
    return selectedFonts().includes(font);
  }

  function ensureFontLoaded(font, options) {
    return loadFont(font, options);
  }

  function ensureFontOptionPresent(font) {
    if (font && !ui.availableFonts.includes(font)) {
      ui.availableFonts = mergeFonts([font]);
    }
  }

  function nextDefaultColor(index) {
    return index % 2 === 0 ? TEAL : PINK;
  }

  function padRight(value, width) {
    return value + " ".repeat(Math.max(0, width - value.length));
  }

  function rightTrim(value) {
    return value.replace(/\s+$/g, "");
  }
})();
