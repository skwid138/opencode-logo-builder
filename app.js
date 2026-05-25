(function () {
  "use strict";

  window.FONT_TAGS = window.FONT_TAGS || {};

  const STORAGE_KEY = "opencode-logo-builder-state-v1";
  const THEME_STORAGE_KEY = "logo-builder-theme";
  const STORAGE_VERSION = 1;
  const TEAL = "#5DBDB3";
  const PINK = "#F8B4C4";
  const DEFAULT_PREVIEW_BACKGROUND = "#0B1020";
  const FONT_CDN_PATH = "https://unpkg.com/figlet@1.8.0/fonts";
  const LOCAL_FONT_PATH = "vendor/fonts";
  const BACKGROUND_FONT_BATCH_SIZE = 30;
  const BACKGROUND_FONT_BATCH_DELAY_MS = 100;
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
  const fontCache = new Map();

  const state = {
    rows: cloneDefaultState().rows,
  };

  const ui = {
    theme: "dark",
    previewBackground: DEFAULT_PREVIEW_BACKGROUND,
    storageNote: "",
    fatalError: "",
    copyStatus: "",
    availableFonts: sortedUniqueFonts(typeof window !== "undefined" && Array.isArray(window.ALL_FONTS) ? window.ALL_FONTS : CURATED_FONTS),
    loadedFonts: new Set(),
    loadingFonts: new Set(),
    failedFonts: new Map(),
    fontComboboxes: new Map(),
    lastExportText: "",
    lastRenderResult: null,
    renderSequence: 0,
  };

  const els = {};
  let cyclePreviewTimer = null;
  let cycleSaveTimer = null;
  const pendingCycleFonts = new Set();
  const CYCLE_PREVIEW_DEBOUNCE_MS = 150;
  const CYCLE_SAVE_DEBOUNCE_MS = 500;

  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });

  async function init() {
    cacheElements();
    applyInitialTheme();
    restoreState();
    wireGlobalControls();
    await initializeFiglet();
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
    els.preview = document.getElementById("preview");
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
      void renderDerived();
    });

    els.addRowButton.addEventListener("click", () => {
      state.rows.push({
        font: "Standard",
        blocks: [{ text: "", color: nextDefaultColor(0) }],
      });
      ui.fontComboboxes.clear();
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
      ui.fontComboboxes.clear();
      ui.previewBackground = DEFAULT_PREVIEW_BACKGROUND;
      els.previewBackgroundInput.value = ui.previewBackground;
      saveState();
      ensureSelectedFontsLoaded();
      renderApp();
    });

    els.copyExportButton.addEventListener("click", async () => {
      await copyText(ui.lastExportText);
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest || !event.target.closest(".font-combobox")) {
        closeAllFontComboboxes();
      }
    });

    if (typeof window.addEventListener === "function") {
      window.addEventListener("beforeunload", flushCyclePending);
    }
  }

  async function initializeFiglet() {
    ui.availableFonts = mergeAvailableFonts(selectedFonts());

    if (!window.figlet || typeof window.figlet.parseFont !== "function" || typeof window.figlet.textSync !== "function") {
      ui.fatalError = "The vendored figlet.js library did not load. Check the local vendor file and refresh.";
      return;
    }

    if (typeof window.figlet.defaults === "function") {
      window.figlet.defaults({ fontPath: "", fetchFontIfMissing: false });
    }

    try {
      await loadFontAsync("Standard", { selected: true });
    } catch (error) {
      // Rendering will surface the selected-font failure. Continue so the UI remains usable.
    }

    CURATED_FONTS
      .filter((font) => font !== "Standard")
      .forEach((font) => {
        void loadFontAsync(font, { selected: isSelectedFont(font), background: true }).catch(() => {});
      });

    scheduleBackgroundFontLoading();
  }

  function mergeAvailableFonts(extraFonts = []) {
    const manifestFonts = typeof window !== "undefined" && Array.isArray(window.ALL_FONTS) ? window.ALL_FONTS : CURATED_FONTS;
    return sortedUniqueFonts([...manifestFonts, ...extraFonts.filter(Boolean)]);
  }

  function scheduleBackgroundFontLoading() {
    const remainingFonts = ui.availableFonts.filter((font) => !CURATED_FONTS.includes(font));
    for (let start = 0; start < remainingFonts.length; start += BACKGROUND_FONT_BATCH_SIZE) {
      const batch = remainingFonts.slice(start, start + BACKGROUND_FONT_BATCH_SIZE);
      const batchIndex = start / BACKGROUND_FONT_BATCH_SIZE;
      setTimeout(() => {
        batch.forEach((font) => {
          void loadFontAsync(font, { selected: isSelectedFont(font), background: true }).catch(() => {});
        });
      }, batchIndex * BACKGROUND_FONT_BATCH_DELAY_MS);
    }
  }

  function ensureSelectedFontsLoaded() {
    selectedFonts().forEach((font) => {
      void loadFontAsync(font, { selected: true }).catch(() => {});
    });
  }

  function loadFontAsync(fontName, options = {}) {
    const font = typeof fontName === "string" && fontName ? fontName : "Standard";
    if (ui.loadedFonts.has(font)) {
      return Promise.resolve(font);
    }
    if (fontCache.has(font)) {
      return fontCache.get(font);
    }
    if (!window.figlet || typeof window.figlet.parseFont !== "function") {
      return Promise.reject(new Error("figlet.parseFont is unavailable"));
    }

    ui.loadingFonts.add(font);
    ui.failedFonts.delete(font);
    refreshFontLoadingUi(font, options);

    const promise = fetchFontText(font)
      .then(() => {
        // fetchFontText parses and registers the font before resolving.
        ui.loadedFonts.add(font);
        ui.failedFonts.delete(font);
        return font;
      })
      .catch((error) => {
        fontCache.delete(font);
        ui.failedFonts.set(font, error instanceof Error ? error.message : String(error));
        throw error;
      })
      .finally(() => {
        ui.loadingFonts.delete(font);
        refreshFontLoadingUi(font, options);
        if ((options.selected || isSelectedFont(font)) && !options.silent) {
          void renderDerived();
        }
      });

    fontCache.set(font, promise);
    return promise;
  }

  async function fetchFontText(font) {
    const localUrl = fontUrl(LOCAL_FONT_PATH, font);
    const cdnUrl = fontUrl(FONT_CDN_PATH, font);
    const response = await fetchFontResponse(localUrl).catch(() => fetchFontResponse(cdnUrl));
    const data = await response.text();
    window.figlet.parseFont(font, data);
    return data;
  }

  function fontUrl(basePath, font) {
    return `${basePath}/${encodeURIComponent(font)}.flf`;
  }

  function fetchFontResponse(url) {
    const fetchImpl = typeof window.fetch === "function" ? window.fetch.bind(window) : typeof fetch === "function" ? fetch : null;
    if (!fetchImpl) {
      return Promise.reject(new Error("fetch is unavailable"));
    }
    return fetchImpl(url).then((response) => {
      if (!response || !response.ok) {
        const status = response && typeof response.status !== "undefined" ? response.status : "unknown";
        throw new Error(`Font fetch failed (${status}) for ${url}`);
      }
      return response;
    });
  }

  function refreshFontLoadingUi(font, options = {}) {
    updateFontOptionState(font);
    if (els.fontStatus) {
      renderFontStatus();
    }
    if (options.selected && !options.background && els.copyExportButton) {
      els.copyExportButton.disabled = selectedFonts().some((selectedFont) => ui.loadingFonts.has(selectedFont));
    }
  }

  function renderApp() {
    renderEditor();
    void renderDerived();
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
    ensureFontOptionPresent(row.font);
    const comboboxState = getFontComboboxState(rowIndex);
    const field = document.createElement("div");
    field.className = "field font-field";
    const text = document.createElement("span");
    text.id = `font-label-${rowIndex}`;
    text.textContent = "Font";

    const combobox = document.createElement("div");
    combobox.className = "font-combobox";
    combobox.dataset.rowIndex = String(rowIndex);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "font-combobox-input";
    input.value = comboboxState.open ? comboboxState.filter : row.font;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-labelledby", text.id);
    input.setAttribute("aria-expanded", String(comboboxState.open));
    input.setAttribute("aria-controls", `font-listbox-${rowIndex}`);

    const listbox = document.createElement("div");
    listbox.id = `font-listbox-${rowIndex}`;
    listbox.className = "font-listbox";
    listbox.setAttribute("role", "listbox");
    listbox.hidden = !comboboxState.open;

    const tagControls = document.createElement("div");
    tagControls.className = "font-tag-controls";

    const openList = () => {
      openFontCombobox(rowIndex, listbox, input);
    };

    input.addEventListener("focus", () => {
      comboboxState.filter = "";
      input.select();
    });
    input.addEventListener("click", (event) => {
      event.stopPropagation();
      openList();
    });
    input.addEventListener("input", (event) => {
      comboboxState.filter = event.target.value;
      if (comboboxState.open) {
        comboboxState.highlightIndex = 0;
        renderFontOptions(rowIndex, listbox, input);
      } else {
        openList();
      }
    });
    input.addEventListener("keydown", (event) => {
      handleFontComboboxKeydown(event, rowIndex, listbox, input);
    });
    input.addEventListener("blur", () => {
      flushCyclePending();
    });
    combobox.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!combobox.contains(document.activeElement)) {
          closeFontCombobox(rowIndex, combobox);
        }
      }, 0);
    });

    renderFontTagControls(rowIndex, tagControls, listbox, input);
    renderFontOptions(rowIndex, listbox, input);
    combobox.append(tagControls, input, listbox);
    field.append(text, combobox);
    return field;
  }

  function getFontComboboxState(rowIndex) {
    if (!ui.fontComboboxes.has(rowIndex)) {
      ui.fontComboboxes.set(rowIndex, { filter: "", open: false, highlightIndex: 0, activeTags: [], tagPanelOpen: false });
    }
    const comboboxState = ui.fontComboboxes.get(rowIndex);
    if (!Array.isArray(comboboxState.activeTags)) {
      comboboxState.activeTags = [];
    }
    if (typeof comboboxState.tagPanelOpen !== "boolean") {
      comboboxState.tagPanelOpen = false;
    }
    return comboboxState;
  }

  function filterFontOptions(filter, fonts = ui.availableFonts) {
    const filtered = filterWithTags(fonts, [], filter);
    return String(filter || "").trim() ? sortFontResults(filtered, filter) : filtered;
  }

  function getFilteredFontOptions(comboboxState, fonts = ui.availableFonts) {
    const activeTags = Array.isArray(comboboxState.activeTags) ? comboboxState.activeTags : [];
    const searchText = comboboxState.filter;
    const filtered = filterWithTags(fonts, activeTags, searchText);
    if (!activeTags.length && !String(searchText || "").trim()) {
      return filtered;
    }
    return sortFontResults(filtered, searchText);
  }

  function filterWithTags(fonts, activeTags = [], searchText = "") {
    const normalizedTags = normalizeTags(activeTags);
    const normalizedSearch = String(searchText || "").trim().toLowerCase();
    return (Array.isArray(fonts) ? fonts : []).filter((font) => {
      if (typeof font !== "string" || !font) {
        return false;
      }
      const fontTags = normalizeTags(getFontTags(font));
      if (normalizedTags.length) {
        const hasAllTags = normalizedTags.every((tag) => fontTags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
        return !normalizedSearch || font.toLowerCase().includes(normalizedSearch);
      }
      if (!normalizedSearch) {
        return true;
      }
      return font.toLowerCase().includes(normalizedSearch) || fontTags.some((tag) => tag.includes(normalizedSearch));
    });
  }

  function sortFontResults(fonts, searchText = "") {
    const normalizedSearch = String(searchText || "").trim().toLowerCase();
    return (Array.isArray(fonts) ? fonts : []).slice().sort((left, right) => {
      const leftRank = fontSearchRank(left, normalizedSearch);
      const rightRank = fontSearchRank(right, normalizedSearch);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left).localeCompare(String(right));
    });
  }

  function fontSearchRank(font, normalizedSearch) {
    if (!normalizedSearch) {
      return 0;
    }
    const normalizedFont = String(font || "").toLowerCase();
    if (normalizedFont.includes(normalizedSearch)) {
      return 0;
    }
    if (getFontTags(font).some((tag) => String(tag).toLowerCase().includes(normalizedSearch))) {
      return 1;
    }
    return 2;
  }

  function normalizeTags(tags) {
    return [...new Set((Array.isArray(tags) ? tags : []).filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim().toLowerCase()))];
  }

  function getFontTags(font) {
    const tags = window.FONT_TAGS && window.FONT_TAGS[font];
    return Array.isArray(tags) ? tags : [];
  }

  function getCommonFontTags(fonts = ui.availableFonts, limit = 5) {
    const counts = new Map();
    (Array.isArray(fonts) ? fonts : []).forEach((font) => {
      normalizeTags(getFontTags(font)).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  function getAllFontTags(fonts = ui.availableFonts) {
    const tags = new Set();
    (Array.isArray(fonts) ? fonts : []).forEach((font) => {
      normalizeTags(getFontTags(font)).forEach((tag) => tags.add(tag));
    });
    return [...tags].sort((left, right) => left.localeCompare(right));
  }

  function highlightedIndexForFont(font, options) {
    const index = options.indexOf(font);
    return index === -1 ? 0 : index;
  }

  function highlightedIndexForSelectedFont(selectedFont, filter, fonts = ui.availableFonts) {
    return highlightedIndexForFont(selectedFont, filterFontOptions(filter, fonts));
  }

  function getCycledFont(currentFont, direction, fonts = ui.availableFonts) {
    const availableFonts = (Array.isArray(fonts) ? fonts : []).filter((font) => typeof font === "string" && font);
    if (!availableFonts.length) {
      return currentFont || "";
    }

    const delta = direction === "up" || direction === "previous" || direction < 0 ? -1 : 1;
    const currentIndex = availableFonts.indexOf(currentFont);
    if (currentIndex === -1) {
      return delta > 0 ? availableFonts[0] : availableFonts[availableFonts.length - 1];
    }
    return availableFonts[(currentIndex + delta + availableFonts.length) % availableFonts.length];
  }

  function cycleFont(rowIndex, direction, input) {
    const row = state.rows[rowIndex];
    if (!row) {
      return "";
    }

    const nextFont = getCycledFont(row.font, direction);
    if (!nextFont) {
      return row.font || "";
    }

    row.font = nextFont;

    const comboboxState = getFontComboboxState(rowIndex);
    comboboxState.open = false;
    comboboxState.filter = "";
    comboboxState.activeTags = [];
    comboboxState.tagPanelOpen = false;
    comboboxState.highlightIndex = highlightedIndexForFont(nextFont, ui.availableFonts);

    const targetInput = input || fontComboboxInputForRow(rowIndex);
    if (targetInput) {
      targetInput.value = nextFont;
      targetInput.setAttribute("aria-expanded", "false");
      targetInput.removeAttribute("aria-activedescendant");
    }

    scheduleCyclePreview(nextFont);
    scheduleCycleSave();
    return nextFont;
  }

  function fontComboboxInputForRow(rowIndex) {
    if (!document.querySelector) {
      return null;
    }
    return document.querySelector(`.font-combobox[data-row-index="${rowIndex}"] .font-combobox-input`);
  }

  function scheduleCyclePreview(font) {
    if (font) {
      pendingCycleFonts.add(font);
    }
    clearScheduledTimeout(cyclePreviewTimer);
    cyclePreviewTimer = scheduleTimeout(() => {
      cyclePreviewTimer = null;
      runPendingCyclePreview();
    }, CYCLE_PREVIEW_DEBOUNCE_MS);
  }

  function scheduleCycleSave() {
    clearScheduledTimeout(cycleSaveTimer);
    cycleSaveTimer = scheduleTimeout(() => {
      cycleSaveTimer = null;
      runPendingCycleSave();
    }, CYCLE_SAVE_DEBOUNCE_MS);
  }

  function flushCyclePending() {
    const shouldRenderPreview = cyclePreviewTimer !== null || pendingCycleFonts.size > 0;
    const shouldSave = cycleSaveTimer !== null;

    clearScheduledTimeout(cyclePreviewTimer);
    clearScheduledTimeout(cycleSaveTimer);
    cyclePreviewTimer = null;
    cycleSaveTimer = null;

    if (shouldRenderPreview) {
      runPendingCyclePreview();
    }
    if (shouldSave) {
      runPendingCycleSave();
    }
  }

  function runPendingCyclePreview() {
    const fontsToLoad = [...pendingCycleFonts];
    pendingCycleFonts.clear();
    fontsToLoad.forEach((pendingFont) => {
      void ensureFontLoaded(pendingFont, { selected: true });
    });
    void renderDerived();
  }

  function runPendingCycleSave() {
    saveState();
  }

  function scheduleTimeout(callback, delay) {
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      return window.setTimeout(callback, delay);
    }
    if (typeof setTimeout === "function") {
      return setTimeout(callback, delay);
    }
    callback();
    return null;
  }

  function clearScheduledTimeout(timer) {
    if (timer === null || timer === undefined) {
      return;
    }
    if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
      window.clearTimeout(timer);
      return;
    }
    if (typeof clearTimeout === "function") {
      clearTimeout(timer);
    }
  }

  function openFontCombobox(rowIndex, listbox, input) {
    flushCyclePending();
    const comboboxState = getFontComboboxState(rowIndex);
    const row = state.rows[rowIndex];
    const wasOpen = comboboxState.open;
    comboboxState.open = true;
    if (!wasOpen) {
      comboboxState.highlightIndex = highlightedIndexForSelectedFont(row && row.font, comboboxState.filter);
    }
    input.setAttribute("aria-expanded", "true");
    listbox.hidden = false;
    renderFontOptions(rowIndex, listbox, input);
  }

  function renderFontTagControls(rowIndex, container, listbox, input) {
    const comboboxState = getFontComboboxState(rowIndex);
    const commonTags = getCommonFontTags(ui.availableFonts, 5);
    const allTags = getAllFontTags(ui.availableFonts);
    const commonTagSet = new Set(commonTags);
    const moreTags = allTags.filter((tag) => !commonTagSet.has(tag));
    const activeTagSet = new Set(normalizeTags(comboboxState.activeTags));

    container.replaceChildren();

    const row = document.createElement("div");
    row.className = "font-tag-row";
    row.setAttribute("aria-label", "Filter fonts by tag");

    if (!allTags.length) {
      const empty = document.createElement("span");
      empty.className = "font-tag-empty";
      empty.textContent = "No font tags available";
      row.append(empty);
      container.append(row);
      return;
    }

    commonTags.forEach((tag) => {
      row.append(createTagChip(tag, activeTagSet.has(tag), () => {
        toggleFontTag(rowIndex, tag, listbox, input, container);
      }));
    });

    if (moreTags.length) {
      const moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = "font-tag-chip font-tag-more";
      moreButton.classList.toggle("active", moreTags.some((tag) => activeTagSet.has(tag)));
      moreButton.setAttribute("aria-expanded", String(comboboxState.tagPanelOpen));
      moreButton.textContent = "More...";
      moreButton.addEventListener("mousedown", preventComboboxBlur);
      moreButton.addEventListener("click", (event) => {
        event.stopPropagation();
        comboboxState.tagPanelOpen = !comboboxState.tagPanelOpen;
        openFontCombobox(rowIndex, listbox, input);
        renderFontTagControls(rowIndex, container, listbox, input);
      });
      row.append(moreButton);
    }

    container.append(row);

    if (comboboxState.tagPanelOpen && moreTags.length) {
      const panel = document.createElement("div");
      panel.className = "font-tag-panel";
      panel.addEventListener("mousedown", preventComboboxBlur);
      moreTags.forEach((tag) => {
        panel.append(createTagChip(tag, activeTagSet.has(tag), () => {
          toggleFontTag(rowIndex, tag, listbox, input, container);
        }, "font-tag-panel-chip"));
      });
      container.append(panel);
    }
  }

  function createTagChip(tag, active, onToggle, extraClass = "") {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = ["font-tag-chip", extraClass].filter(Boolean).join(" ");
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
    chip.textContent = tag;
    chip.addEventListener("mousedown", preventComboboxBlur);
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle();
    });
    return chip;
  }

  function toggleFontTag(rowIndex, tag, listbox, input, tagControls) {
    const comboboxState = getFontComboboxState(rowIndex);
    const normalizedTag = String(tag || "").trim().toLowerCase();
    if (!normalizedTag) {
      return;
    }
    const activeTags = normalizeTags(comboboxState.activeTags);
    comboboxState.activeTags = activeTags.includes(normalizedTag)
      ? activeTags.filter((activeTag) => activeTag !== normalizedTag)
      : [...activeTags, normalizedTag];
    comboboxState.highlightIndex = 0;
    comboboxState.open = true;
    input.setAttribute("aria-expanded", "true");
    listbox.hidden = false;
    renderFontTagControls(rowIndex, tagControls, listbox, input);
    renderFontOptions(rowIndex, listbox, input);
  }

  function preventComboboxBlur(event) {
    event.preventDefault();
  }

  function renderFontOptions(rowIndex, listbox, input) {
    const comboboxState = getFontComboboxState(rowIndex);
    const row = state.rows[rowIndex];
    const options = getFilteredFontOptions(comboboxState);
    const maxIndex = Math.max(0, options.length - 1);
    comboboxState.highlightIndex = Math.min(Math.max(0, comboboxState.highlightIndex), maxIndex);
    listbox.replaceChildren();

    if (!options.length) {
      input.removeAttribute("aria-activedescendant");
      const empty = document.createElement("div");
      empty.className = "font-option empty";
      empty.textContent = comboboxState.activeTags.length ? "No fonts match all selected tags" : "No matching fonts";
      listbox.append(empty);
      return;
    }

    options.forEach((font, optionIndex) => {
      const option = document.createElement("div");
      option.id = `font-option-${rowIndex}-${optionIndex}`;
      option.className = "font-option";
      option.dataset.fontName = font;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(row && row.font === font));
      appendFontOptionContent(option, font);
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectFontForRow(rowIndex, font);
      });
      applyFontOptionState(option, font);
      if (optionIndex === comboboxState.highlightIndex) {
        option.classList.add("highlighted");
        input.setAttribute("aria-activedescendant", option.id);
      }
      listbox.append(option);
    });

    if (comboboxState.open && !listbox.hidden) {
      scrollHighlightedFontOption(listbox);
    }
  }

  function appendFontOptionContent(option, font) {
    const name = document.createElement("span");
    name.className = "font-option-name";
    name.textContent = font;

    const tags = document.createElement("span");
    tags.className = "font-option-tags";
    tags.setAttribute("aria-hidden", "true");
    getFontTags(font).forEach((tag) => {
      const label = document.createElement("span");
      label.className = "font-option-tag";
      label.textContent = tag;
      tags.append(label);
    });

    const status = document.createElement("span");
    status.className = "font-option-status";
    status.setAttribute("aria-hidden", "true");

    option.append(name, tags, status);
  }

  function scrollHighlightedFontOption(listbox) {
    const schedule = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (callback) => callback();
    schedule(() => {
      const highlightedOption = listbox.querySelector && listbox.querySelector(".font-option.highlighted");
      if (highlightedOption && typeof highlightedOption.scrollIntoView === "function") {
        highlightedOption.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function handleFontComboboxKeydown(event, rowIndex, listbox, input) {
    const comboboxState = getFontComboboxState(rowIndex);
    if (!comboboxState.open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        cycleFont(rowIndex, event.key === "ArrowDown" ? 1 : -1, input);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        openFontCombobox(rowIndex, listbox, input);
        return;
      }
      if (isTextInputKey(event)) {
        comboboxState.filter = "";
        input.value = "";
        openFontCombobox(rowIndex, listbox, input);
      }
      return;
    }

    const options = getFilteredFontOptions(comboboxState);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        comboboxState.highlightIndex = (comboboxState.highlightIndex + delta + options.length) % options.length;
        const highlightedFont = options[comboboxState.highlightIndex];
        if (highlightedFont && state.rows[rowIndex]) {
          state.rows[rowIndex].font = highlightedFont;
          input.value = highlightedFont;
          scheduleCyclePreview(highlightedFont);
          scheduleCycleSave();
        }
      }
      renderFontOptions(rowIndex, listbox, input);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (options[comboboxState.highlightIndex]) {
        selectFontForRow(rowIndex, options[comboboxState.highlightIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeFontCombobox(rowIndex, input.closest(".font-combobox"));
    }
  }

  function isTextInputKey(event) {
    return event.key && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
  }

  function selectFontForRow(rowIndex, font) {
    if (!state.rows[rowIndex]) {
      return;
    }
    state.rows[rowIndex].font = font;
    const comboboxState = getFontComboboxState(rowIndex);
    comboboxState.open = false;
    comboboxState.filter = "";
    comboboxState.activeTags = [];
    comboboxState.tagPanelOpen = false;
    comboboxState.highlightIndex = 0;
    saveState();
    ensureFontLoaded(font, { selected: true });
    renderApp();
  }

  function closeAllFontComboboxes() {
    document.querySelectorAll(".font-combobox").forEach((combobox) => {
      closeFontCombobox(Number(combobox.dataset.rowIndex), combobox);
    });
  }

  function closeFontCombobox(rowIndex, combobox) {
    if (!combobox) {
      return;
    }
    const row = state.rows[rowIndex];
    const comboboxState = getFontComboboxState(rowIndex);
    comboboxState.open = false;
    comboboxState.filter = "";
    comboboxState.activeTags = [];
    comboboxState.tagPanelOpen = false;
    const input = combobox.querySelector(".font-combobox-input");
    const listbox = combobox.querySelector(".font-listbox");
    const tagControls = combobox.querySelector(".font-tag-controls");
    if (input) {
      input.value = row ? row.font : "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    if (listbox) {
      listbox.hidden = true;
      listbox.replaceChildren();
    }
    if (tagControls && input && listbox) {
      renderFontTagControls(rowIndex, tagControls, listbox, input);
    }
  }

  function updateFontOptionState(font) {
    if (!document.querySelectorAll) {
      return;
    }
    document.querySelectorAll(".font-option[data-font-name]").forEach((option) => {
      if (option.dataset.fontName === font) {
        applyFontOptionState(option, font);
      }
    });
  }

  function applyFontOptionState(option, font) {
    option.classList.toggle("loaded", ui.loadedFonts.has(font));
    option.classList.toggle("loading", ui.loadingFonts.has(font));
    option.classList.toggle("failed", ui.failedFonts.has(font));
    option.classList.toggle("unloaded", !ui.loadedFonts.has(font));
    const status = ui.loadedFonts.has(font) ? "loaded" : ui.loadingFonts.has(font) ? "loading" : ui.failedFonts.has(font) ? "failed" : "not loaded";
    const visibleStatus = status === "loading" || status === "failed" ? status : "";
    const statusElement = findChildByClassName(option, "font-option-status");
    if (statusElement) {
      statusElement.textContent = visibleStatus ? capitalize(visibleStatus) : "";
      statusElement.hidden = !visibleStatus;
    }
    option.setAttribute("aria-label", `${font} (${status})`);
  }

  function findChildByClassName(element, className) {
    if (!element) {
      return null;
    }
    if (typeof element.querySelector === "function") {
      const found = element.querySelector(`.${className}`);
      if (found) {
        return found;
      }
    }
    const children = Array.isArray(element.children) ? element.children : Array.from(element.children || []);
    return children.find((child) => child.className === className || (child.classList && child.classList.contains(className))) || null;
  }

  function capitalize(value) {
    const stringValue = String(value || "");
    return stringValue ? `${stringValue.charAt(0).toUpperCase()}${stringValue.slice(1)}` : "";
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
      void renderDerived();
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
      void renderDerived();
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
      void renderDerived();
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

  async function renderDerived() {
    const renderId = (ui.renderSequence += 1);
    els.previewBackgroundInput.value = ui.previewBackground;
    els.preview.style.backgroundColor = ui.previewBackground;

    const result = await renderLogo();
    if (renderId !== ui.renderSequence) {
      return;
    }
    ui.lastRenderResult = result;
    ui.lastExportText = buildExportText(result.logo);

    renderFontStatus();
    renderMessages(result);
    renderPreview(els.preview, result.lines);
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

  function renderPreview(container, lines) {
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
        span.textContent = segment.text;
        lineEl.append(span);
      });
      container.append(lineEl);
    });
  }

  async function renderLogo() {
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

    for (let rowIndex = 0; rowIndex < state.rows.length; rowIndex += 1) {
      const row = state.rows[rowIndex];
      const font = row.font || "Standard";
      try {
        await loadFontAsync(font, { selected: true, silent: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Row ${rowIndex + 1}: font “${font}” failed to load and was skipped (${message}).`);
        continue;
      }

      const rendered = renderBlocksToLines(row.blocks, font, window.figlet);
      rendered.errors.forEach(({ blockIndex, error }) => {
        result.renderErrorCount += 1;
        result.errors.push(`Row ${rowIndex + 1}, block ${blockIndex + 1}: ${error instanceof Error ? error.message : String(error)}`);
      });
      rendered.warnings.forEach((warning) => {
        result.warnings.push(`Row ${rowIndex + 1}: ${warning}`);
      });

      if (!rendered.rows.length) {
        result.warnings.push(`Row ${rowIndex + 1}: no blocks rendered, so the row was skipped.`);
        continue;
      }

      rendered.rows.forEach((renderedRow) => {
        result.logo.rows.push({
          segments: renderedRow.segments.map((segment) => ({ text: segment.text, color: segment.color })),
        });
        result.lines.push(renderedRow);
        result.renderedRowCount += 1;
      });
    }

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

  function renderBlocksToLines(blocks, font, figletApi) {
    const ownershipWarnings = [];

    if (typeof window.renderWithOwnership === "function") {
      try {
        const rendered = window.renderWithOwnership(blocks, font);
        return {
          rows: ownershipLinesToRows(rendered, blocks),
          errors: Array.isArray(rendered.errors) ? rendered.errors : [],
          warnings: [rendered.warning, ...(Array.isArray(rendered.warnings) ? rendered.warnings : [])].filter(Boolean),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ownershipWarnings.push(`Ownership render failed (${message}); using per-block fallback rendering.`);
      }
    }

    const fallback = renderBlocksToLinesFallback(blocks, font, figletApi);
    return {
      rows: fallback.rows,
      errors: fallback.errors,
      warnings: ownershipWarnings,
    };
  }

  function ownershipLinesToRows(rendered, blocks) {
    const rows = [];
    const lines = Array.isArray(rendered.lines) ? rendered.lines : [];
    const owners = Array.isArray(rendered.owners) ? rendered.owners : [];

    lines.forEach((line, lineIndex) => {
      if (line === "") {
        return;
      }

      const ownerRow = owners[lineIndex] || [];
      const segments = [];
      let segmentOwner = ownerRow[0];
      let segmentText = "";

      for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
        const owner = ownerRow[charIndex];
        if (charIndex > 0 && owner !== segmentOwner) {
          segments.push({ text: segmentText, color: colorForBlock(blocks, segmentOwner) });
          segmentText = "";
          segmentOwner = owner;
        }
        segmentText += line[charIndex];
      }

      if (segmentText !== "") {
        segments.push({ text: segmentText, color: colorForBlock(blocks, segmentOwner) });
      }
      if (segments.length) {
        rows.push({ segments });
      }
    });

    return rows;
  }

  function colorForBlock(blocks, blockIndex) {
    const block = blocks[blockIndex];
    return normalizeColor(block && block.color, TEAL);
  }

  function renderBlocksToLinesFallback(blocks, font, figletApi) {
    const renderedBlocks = [];
    const errors = [];

    blocks.forEach((block, blockIndex) => {
      const text = String(block.text ?? "").replace(/[\r\n]/g, "");
      if (text === "") {
        return;
      }
      try {
        const rendered = figletApi.textSync(text, {
          font,
          horizontalLayout: "default",
          verticalLayout: "default",
        });
        const lines = trimBlankLines(rendered.split("\n"));
        const trimmedWidth = lines.reduce((max, line) => Math.max(max, rightTrim(line).length), 0);

        renderedBlocks.push({
          color: normalizeColor(block.color, TEAL),
          lines,
          trimmedWidth,
        });
      } catch (error) {
        errors.push({ blockIndex, error });
      }
    });

    const height = renderedBlocks.reduce((max, block) => Math.max(max, block.lines.length), 0);
    const rows = [];
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      const trimmedLines = renderedBlocks.map((block) => rightTrim(block.lines[lineIndex] || ""));
      const finalSegmentIndex = findLastIndex(trimmedLines, (line) => line !== "");
      if (finalSegmentIndex === -1) {
        continue;
      }

      const segments = renderedBlocks.slice(0, finalSegmentIndex + 1).map((block, blockIndex) => {
        const rawLine = trimmedLines[blockIndex];
        const text = blockIndex === finalSegmentIndex
          ? rawLine
          : padRight(rawLine, block.trimmedWidth);
        return { text, color: block.color };
      });
      rows.push({ segments });
    }

    return { rows, errors };
  }

  function trimBlankLines(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === "") {
      start += 1;
    }
    while (end > start && lines[end - 1].trim() === "") {
      end -= 1;
    }
    return lines.slice(start, end);
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
    ui.fontComboboxes.clear();
    saveState();
    renderApp();
  }

  async function copyText(text) {
    if (!text) {
      ui.copyStatus = "Nothing to copy yet.";
      void renderDerived();
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
    void renderDerived();
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
    return loadFontAsync(font, options).catch(() => {});
  }

  function ensureFontOptionPresent(font) {
    if (font && !ui.availableFonts.includes(font)) {
      ui.availableFonts = mergeAvailableFonts([font]);
    }
  }

  function sortedUniqueFonts(fonts) {
    return [...new Set((Array.isArray(fonts) ? fonts : []).filter((font) => typeof font === "string" && font))].sort((a, b) => a.localeCompare(b));
  }

  function nextDefaultColor(index) {
    return index % 2 === 0 ? TEAL : PINK;
  }

  function rightTrim(value) {
    return value.replace(/\s+$/g, "");
  }

  function padRight(value, width) {
    if (value.length >= width) {
      return value;
    }
    return `${value}${" ".repeat(width - value.length)}`;
  }

  function findLastIndex(values, predicate) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (predicate(values[index], index, values)) {
        return index;
      }
    }
    return -1;
  }

  if (typeof window !== "undefined") {
    window.filterWithTags = filterWithTags;
    window.sortFontResults = sortFontResults;
  }

  if (typeof window !== "undefined" && window.__LOGO_BUILDER_TEST__) {
    window.__logoBuilderInternals = {
      cycleFont,
      els,
      filterFontOptions,
      filterWithTags,
      flushCyclePending,
      getAllFontTags,
      getCommonFontTags,
      getCycledFont,
      getFilteredFontOptions,
      handleFontComboboxKeydown,
      highlightedIndexForSelectedFont,
      loadFontAsync,
      openFontCombobox,
      renderBlocksToLines,
      renderFontOptions,
      scrollHighlightedFontOption,
      sortFontResults,
      state,
      ui,
      trimBlankLines,
      rightTrim,
    };
  }
})();
