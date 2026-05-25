const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const figlet = require("./vendor/figlet");
const { renderWithOwnership } = require("./figlet-color-map");
const { compareFontSets, parseFontManifest } = require("./scripts/verify-font-manifest");

function loadImportableFont(fontName) {
  const fontPath = path.join(__dirname, "vendor", `${fontName}.js`);
  const source = fs.readFileSync(fontPath, "utf8").replace(/^export default /, "module.exports = ");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename: fontPath });
  figlet.parseFont(fontName, module.exports);
}

function loadLogoBuilderInternals(windowExtras = {}) {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const sandbox = {
    console,
    document: {
      addEventListener() {},
      activeElement: null,
      createElement: createTestElement,
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    window: {
      __LOGO_BUILDER_TEST__: true,
      figlet,
      ...windowExtras,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "app.js" });
  assert.ok(sandbox.window.__logoBuilderInternals, "expected app.js to expose test internals");
  return sandbox.window.__logoBuilderInternals;
}

function createTestElement(tagName = "div") {
  const classNames = new Set();
  const element = {
    tagName: String(tagName).toUpperCase(),
    attributes: {},
    children: [],
    className: "",
    dataset: {},
    disabled: false,
    hidden: false,
    style: {},
    textContent: "",
    value: "",
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    closest() {
      return null;
    },
    contains() {
      return false;
    },
    select() {},
  };
  element.classList = {
    add(...names) {
      names.forEach((name) => classNames.add(name));
      element.className = [...classNames].join(" ");
    },
    remove(...names) {
      names.forEach((name) => classNames.delete(name));
      element.className = [...classNames].join(" ");
    },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !classNames.has(name) : Boolean(force);
      if (shouldAdd) {
        classNames.add(name);
      } else {
        classNames.delete(name);
      }
      element.className = [...classNames].join(" ");
      return shouldAdd;
    },
    contains(name) {
      return classNames.has(name);
    },
  };
  return element;
}

function installRenderElementStubs(internals) {
  Object.assign(internals.els, {
    previewBackgroundInput: createTestElement("input"),
    preview: createTestElement("div"),
    fontStatus: createTestElement("div"),
    messages: createTestElement("div"),
    exportOutput: createTestElement("pre"),
    copyStatus: createTestElement("div"),
    copyExportButton: createTestElement("button"),
  });
}

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

loadImportableFont("Standard");

const { renderBlocksToLines, rightTrim, trimBlankLines } = loadLogoBuilderInternals();

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function renderText(text) {
  return figlet.textSync(text, {
    font: "Standard",
    horizontalLayout: "default",
    verticalLayout: "default",
  });
}

function renderOwned(blocks, fontName = "Standard", options = {}) {
  return renderWithOwnership(blocks, fontName, { figlet, ...options });
}

test("Figlet renders Standard font text", () => {
  const output = renderText("A");
  assert.ok(output.includes("/ \\"), "expected Standard font output for A");
  assert.ok(output.split("\n").length >= 6, "expected multi-line figlet output");
});

test("non-final block segments are padded to their consistent trimmed width", () => {
  const rendered = renderBlocksToLines(
    [
      { text: "Just", color: "#111111" },
      { text: "Vibes", color: "#222222" },
    ],
    "Standard",
    figlet,
  );
  const justLines = trimBlankLines(renderText("Just").split("\n")).map(rightTrim);
  const justTrimmedWidth = justLines.reduce((max, line) => Math.max(max, line.length), 0);

  assert.ok(rendered.rows.length > 0, "expected rendered rows");
  rendered.rows.forEach((row) => {
    assert.strictEqual(row.segments.length, 2, "expected two rendered segments");
    assert.strictEqual(row.segments[0].text.length, justTrimmedWidth, "non-final segment should use the block's max trimmed width");
    assert.ok(!/[ \t]+$/.test(row.segments[1].text), `final segment has trailing whitespace: ${JSON.stringify(row.segments[1].text)}`);
  });
});

test("blank top and bottom figlet lines are trimmed", () => {
  assert.deepStrictEqual(Array.from(trimBlankLines(["", "   ", "top", "  ", "bottom", "\t", ""])), ["top", "  ", "bottom"]);

  const fakeFiglet = {
    textSync() {
      return "\n   \nTOP   \nBOTTOM   \n\t\n";
    },
  };
  const rendered = renderBlocksToLines([{ text: "X", color: "#333333" }], "Standard", fakeFiglet);
  assert.deepStrictEqual(
    Array.from(rendered.rows, (row) => Array.from(row.segments, (segment) => segment.text).join("")),
    ["TOP", "BOTTOM"],
  );
});

test("multiple blocks concatenate with aligned non-final block width", () => {
  const rendered = renderBlocksToLines(
    [
      { text: "A", color: "#111111" },
      { text: "B", color: "#222222" },
    ],
    "Standard",
    figlet,
  );
  const aLines = trimBlankLines(renderText("A").split("\n")).map(rightTrim);
  const aTrimmedWidth = aLines.reduce((max, line) => Math.max(max, line.length), 0);
  const bLines = trimBlankLines(renderText("B").split("\n")).map(rightTrim);

  assert.strictEqual(rendered.rows.length, Math.max(aLines.length, bLines.length));
  rendered.rows.forEach((row, lineIndex) => {
    assert.strictEqual(row.segments.length, 2, `expected two segments on line ${lineIndex}`);
    assert.strictEqual(row.segments[0].text, aLines[lineIndex].padEnd(aTrimmedWidth, " "));
    assert.strictEqual(row.segments[0].text.length, aTrimmedWidth);
    assert.strictEqual(row.segments[1].text, bLines[lineIndex]);
    assert.strictEqual(row.segments.map((segment) => segment.text).join(""), `${aLines[lineIndex].padEnd(aTrimmedWidth, " ")}${bLines[lineIndex]}`);
  });
});

test("empty segments are filtered from rendered export rows", () => {
  const emptyOnly = renderBlocksToLines([{ text: "", color: "#FF0000" }], "Standard", figlet);
  assert.deepStrictEqual(Array.from(emptyOnly.rows), []);

  const rendered = renderBlocksToLines(
    [
      { text: "", color: "#FF0000" },
      { text: "A", color: "#00FF00" },
    ],
    "Standard",
    figlet,
  );
  assert.ok(rendered.rows.length > 0, "expected non-empty block to render");
  rendered.rows.forEach((row) => {
    row.segments.forEach((segment) => {
      assert.notStrictEqual(segment.text, "");
      assert.notStrictEqual(segment.color, "#FF0000");
    });
  });
});

test("ownership render keeps owner widths matched to rendered line widths", () => {
  const rendered = renderOwned([
    { text: "Just", color: "#111111" },
    { text: "Vibes", color: "#222222" },
  ]);

  assert.strictEqual(rendered.lines.length, rendered.owners.length);
  rendered.lines.forEach((line, lineIndex) => {
    assert.strictEqual(rendered.owners[lineIndex].length, line.length, `owner row ${lineIndex} should match rendered width`);
  });
  assert.strictEqual(Math.max(...rendered.lines.map((line) => line.length)), 47, "JustVibes Standard width should stay seamless");
});

test("single-block ownership assigns every cell to original block 0", () => {
  const rendered = renderOwned([{ text: "A", color: "#111111" }]);
  assert.ok(rendered.lines.length > 0, "expected rendered lines");
  rendered.owners.forEach((ownerRow) => {
    assert.ok(ownerRow.length > 0, "expected owners for visible row");
    assert.ok(ownerRow.every((owner) => owner === 0), `expected only owner 0, got ${ownerRow.join(",")}`);
  });
});

test("two-block ownership moves the boundary through smushed columns", () => {
  const rendered = renderOwned([
    { text: "Just", color: "#111111" },
    { text: "Vibes", color: "#222222" },
  ]);
  const justWidth = Math.max(...trimBlankLines(renderText("Just").split("\n")).map(rightTrim).map((line) => line.length));

  assert.ok(rendered.owners.some((ownerRow) => ownerRow.indexOf(1) !== -1 && ownerRow.indexOf(1) < justWidth), "right block should own non-blank overlap columns");
  assert.ok(
    rendered.owners.some((ownerRow) => {
      const firstRight = ownerRow.indexOf(1);
      return firstRight !== -1 && ownerRow.indexOf(0, firstRight) !== -1 && ownerRow.lastIndexOf(1) > ownerRow.indexOf(0, firstRight);
    }),
    "left owner should be preserved when the right overlap character is blank",
  );
});

test("empty ownership blocks are filtered while owner IDs map to original block indexes", () => {
  const rendered = renderOwned([
    { text: "A", color: "#111111" },
    { text: "", color: "#FF0000" },
    { text: "B", color: "#222222" },
  ]);
  const owners = new Set(rendered.owners.flat());

  assert.ok(owners.has(0), "expected owner 0");
  assert.ok(owners.has(2), "expected owner 2 mapped through empty block");
  assert.ok(!owners.has(1), "empty original block should not own rendered cells");
});

test("figlet without _blockBoundaries remains a normal passthrough", () => {
  delete figlet._lastOwners;
  const normal = renderText("AB");
  assert.strictEqual(normal, figlet.textSync("AB", {
    font: "Standard",
    horizontalLayout: "default",
    verticalLayout: "default",
  }));
  assert.ok(!Object.prototype.hasOwnProperty.call(figlet, "_lastOwners"), "no-boundary render should not write _lastOwners");
});

test("ownership wrapper enforces no-newline and no-width preconditions", () => {
  assert.throws(() => renderOwned([{ text: "A\nB", color: "#111111" }]), /newline/i);
  assert.throws(() => renderOwned([{ text: "A", color: "#111111" }], "Standard", { width: 20 }), /width/i);
});

test("ownership wrapper falls back visibly when owner widths do not match output", () => {
  const fakeFiglet = {
    textSync(text, options) {
      if (options._blockBoundaries) {
        this._lastOwners = [[]];
        return "AB";
      }
      return text;
    },
  };

  const rendered = renderWithOwnership([
    { text: "A", color: "#111111" },
    { text: "B", color: "#222222" },
  ], "Standard", { figlet: fakeFiglet });

  assert.strictEqual(rendered.fallback, true);
  assert.match(rendered.warning, /fallback rendering/i);
  assert.deepStrictEqual(rendered.lines, ["AB"]);
  assert.deepStrictEqual(rendered.owners, [[0, 1]]);
});

test("app render path uses ownership renderer for seamless final rows", () => {
  const internals = loadLogoBuilderInternals({
    renderWithOwnership: (blocks, fontName) => renderWithOwnership(blocks, fontName, { figlet }),
  });
  const rendered = internals.renderBlocksToLines(
    [
      { text: "Just", color: "#111111" },
      { text: "Vibes", color: "#222222" },
    ],
    "Standard",
    figlet,
  );

  const lines = rendered.rows.map((row) => row.segments.map((segment) => segment.text).join(""));
  assert.strictEqual(Math.max(...lines.map((line) => line.length)), 47);
  assert.ok(rendered.rows.some((row) => row.segments.some((segment) => segment.color === "#222222")), "expected second block color in ownership segments");
  assert.strictEqual(rendered.warnings.length, 0);
});

test("font loading fetches local FLF, checks response.ok, and parses the font", async () => {
  const parseCalls = [];
  const internals = loadLogoBuilderInternals({
    figlet: {
      parseFont(name, data) {
        parseCalls.push({ name, data });
      },
      textSync() {},
    },
    fetch: async (url) => ({
      ok: true,
      status: 200,
      async text() {
        return `data for ${url}`;
      },
    }),
  });

  await internals.loadFontAsync("Big Chief");

  assert.deepStrictEqual(parseCalls, [{ name: "Big Chief", data: "data for vendor/fonts/Big%20Chief.flf" }]);
});

test("font loading falls back to CDN when local response is not ok", async () => {
  const urls = [];
  const parseCalls = [];
  const internals = loadLogoBuilderInternals({
    figlet: {
      parseFont(name, data) {
        parseCalls.push({ name, data });
      },
      textSync() {},
    },
    fetch: async (url) => {
      urls.push(url);
      if (url.startsWith("vendor/fonts/")) {
        return { ok: false, status: 404, text: async () => "not found" };
      }
      return { ok: true, status: 200, text: async () => "cdn flf" };
    },
  });

  await internals.loadFontAsync("Star Wars");

  assert.deepStrictEqual(urls, [
    "vendor/fonts/Star%20Wars.flf",
    "https://unpkg.com/figlet@1.8.0/fonts/Star%20Wars.flf",
  ]);
  assert.deepStrictEqual(parseCalls, [{ name: "Star Wars", data: "cdn flf" }]);
});

test("font loading deletes failed cache entries so later calls retry", async () => {
  let callCount = 0;
  const parseCalls = [];
  const internals = loadLogoBuilderInternals({
    figlet: {
      parseFont(name, data) {
        parseCalls.push({ name, data });
      },
      textSync() {},
    },
    fetch: async () => {
      callCount += 1;
      if (callCount <= 2) {
        return { ok: false, status: 500, text: async () => "bad" };
      }
      return { ok: true, status: 200, text: async () => "retry flf" };
    },
  });

  await assert.rejects(() => internals.loadFontAsync("Retry Font"), /Font fetch failed/);
  await internals.loadFontAsync("Retry Font");

  assert.strictEqual(callCount, 3, "expected local+cdn failure, then a new local retry");
  assert.deepStrictEqual(parseCalls, [{ name: "Retry Font", data: "retry flf" }]);
});

test("font loading deduplicates in-flight requests for the same font", async () => {
  let resolveText;
  let fetchCount = 0;
  const parseCalls = [];
  const textPromise = new Promise((resolve) => {
    resolveText = resolve;
  });
  const internals = loadLogoBuilderInternals({
    figlet: {
      parseFont(name, data) {
        parseCalls.push({ name, data });
      },
      textSync() {},
    },
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, status: 200, text: () => textPromise };
    },
  });

  const first = internals.loadFontAsync("Shared Font");
  const second = internals.loadFontAsync("Shared Font");
  resolveText("shared flf");
  await Promise.all([first, second]);

  assert.strictEqual(fetchCount, 1);
  assert.deepStrictEqual(parseCalls, [{ name: "Shared Font", data: "shared flf" }]);
});

test("manifest parser and set comparison detect exact drift", () => {
  assert.deepStrictEqual(parseFontManifest('window.ALL_FONTS = ["A", "B Font"];\n'), ["A", "B Font"]);
  assert.strictEqual(compareFontSets(["A", "B"], ["A", "B"]).ok, true);

  const drift = compareFontSets(["A", "B"], ["A", "C"]);
  assert.strictEqual(drift.ok, false);
  assert.deepStrictEqual(drift.missingFromManifest, ["B"]);
  assert.deepStrictEqual(drift.missingFromVendor, ["C"]);
});

test("font dropdown filter matches case-insensitively while preserving order", () => {
  const internals = loadLogoBuilderInternals({ ALL_FONTS: ["Big", "Big Chief", "Small", "Star Wars"] });

  assert.deepStrictEqual(internals.filterFontOptions("big", ["Big", "Big Chief", "Small", "Star Wars"]), ["Big", "Big Chief"]);
  assert.deepStrictEqual(internals.filterFontOptions(" wars ", ["Big", "Big Chief", "Small", "Star Wars"]), ["Star Wars"]);
  assert.deepStrictEqual(internals.filterFontOptions("", ["Big", "Small"]), ["Big", "Small"]);
});

test("filterWithTags requires every active tag and filters tagged results by font name", () => {
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"],
    FONT_TAGS: {
      Alpha: ["readable", "block"],
      Beta: ["block"],
      Gamma: ["readable", "shadow"],
      Delta: ["readable", "block", "shadow"],
    },
  });
  const fonts = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

  assert.deepStrictEqual(internals.filterWithTags(fonts, ["readable", "block"], ""), ["Alpha", "Delta"]);
  assert.deepStrictEqual(internals.filterWithTags(fonts, ["readable", "block"], "del"), ["Delta"]);
  assert.deepStrictEqual(internals.filterWithTags(fonts, ["readable"], "sha"), []);
});

test("filterWithTags searches font names and tag names only when no tags are active", () => {
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Zed", "Alpha Shadow", "Blocky", "Plain"],
    FONT_TAGS: {
      Zed: ["shadow"],
      Blocky: ["shadow", "block"],
      Plain: ["readable"],
    },
  });
  const fonts = ["Zed", "Alpha Shadow", "Blocky", "Plain"];

  assert.deepStrictEqual(internals.filterWithTags(fonts, [], "shadow"), ["Zed", "Alpha Shadow", "Blocky"]);
  assert.deepStrictEqual(internals.filterWithTags(fonts, [], ""), fonts);
});

test("sortFontResults ranks name matches before tag matches and alphabetizes within groups", () => {
  const internals = loadLogoBuilderInternals({
    FONT_TAGS: {
      Zed: ["shadow"],
      Blocky: ["shadow"],
      Gamma: ["readable"],
    },
  });

  assert.deepStrictEqual(internals.sortFontResults(["Zed", "Alpha Shadow", "Blocky"], "shadow"), ["Alpha Shadow", "Blocky", "Zed"]);
  assert.deepStrictEqual(internals.sortFontResults(["Zed", "Alpha", "Blocky"], ""), ["Alpha", "Blocky", "Zed"]);
});

test("getFilteredFontOptions composes active tags with search text and sorts tagged results alphabetically", () => {
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Zed", "Alpha", "Delta", "Beta"],
    FONT_TAGS: {
      Zed: ["block", "readable"],
      Alpha: ["block", "readable"],
      Delta: ["block"],
      Beta: ["readable"],
    },
  });

  assert.deepStrictEqual(Array.from(internals.getFilteredFontOptions({ activeTags: [], filter: "", highlightIndex: 0 })), ["Alpha", "Beta", "Delta", "Zed"]);
  assert.deepStrictEqual(Array.from(internals.getFilteredFontOptions({ activeTags: ["block", "readable"], filter: "", highlightIndex: 0 })), ["Alpha", "Zed"]);
  assert.deepStrictEqual(Array.from(internals.getFilteredFontOptions({ activeTags: ["block"], filter: "de", highlightIndex: 0 })), ["Delta"]);
});

test("font dropdown highlights selected font within the filtered options", () => {
  const internals = loadLogoBuilderInternals({ ALL_FONTS: ["Big", "Small", "Star Wars", "Standard"] });

  assert.strictEqual(internals.highlightedIndexForSelectedFont("Star Wars", "", ["Big", "Small", "Star Wars", "Standard"]), 2);
  assert.strictEqual(internals.highlightedIndexForSelectedFont("Star Wars", "star", ["Big", "Small", "Star Wars", "Standard"]), 0);
  assert.strictEqual(internals.highlightedIndexForSelectedFont("Small", "star", ["Big", "Small", "Star Wars", "Standard"]), 0);
});

test("font cycling wraps through available fonts without filtering", () => {
  const internals = loadLogoBuilderInternals({ ALL_FONTS: ["Big", "Small", "Standard"] });
  const fonts = ["Big", "Small", "Standard"];

  assert.strictEqual(internals.getCycledFont("Big", 1, fonts), "Small");
  assert.strictEqual(internals.getCycledFont("Standard", 1, fonts), "Big");
  assert.strictEqual(internals.getCycledFont("Big", -1, fonts), "Standard");
  assert.strictEqual(internals.getCycledFont("Small", "up", fonts), "Big");
  assert.strictEqual(internals.getCycledFont("Missing", 1, fonts), "Big");
  assert.strictEqual(internals.getCycledFont("Missing", -1, fonts), "Standard");
});

test("font cycle flush cancels debounce timers and runs pending preview plus save", async () => {
  const scheduled = [];
  const savedFonts = [];
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Big", "Standard"],
    localStorage: {
      getItem() {
        return null;
      },
      setItem(key, value) {
        savedFonts.push(JSON.parse(value).state.rows[0].font);
      },
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  });
  installRenderElementStubs(internals);
  internals.state.rows = [{ font: "Big", blocks: [{ text: "A", color: "#111111" }] }];
  internals.ui.loadedFonts.add("Standard");
  internals.ui.previewBackground = "#123456";

  const input = createTestElement("input");
  internals.cycleFont(0, 1, input);

  assert.strictEqual(input.value, "Standard");
  assert.deepStrictEqual(scheduled.map((timer) => timer.delay), [150, 500]);
  assert.deepStrictEqual(savedFonts, [], "cycleFont should debounce, not save immediately");

  internals.flushCyclePending();
  await flushMicrotasks();

  assert.ok(scheduled.every((timer) => timer.cleared), "flush should cancel both debounce timers");
  assert.deepStrictEqual(savedFonts, ["Standard"], "flush should save pending cycle state once");
  assert.strictEqual(internals.els.previewBackgroundInput.value, "#123456", "flush should run the pending preview render");
  assert.ok(internals.ui.lastRenderResult && internals.ui.lastRenderResult.logo.rows.length > 0, "flush should finish preview/export derivation");
});

test("opening the font dropdown flushes pending cycle preview and save first", async () => {
  const savedFonts = [];
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Big", "Standard"],
    localStorage: {
      getItem() {
        return null;
      },
      setItem(key, value) {
        savedFonts.push(JSON.parse(value).state.rows[0].font);
      },
    },
    setTimeout(callback, delay) {
      return { callback, delay, cleared: false };
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  });
  installRenderElementStubs(internals);
  internals.state.rows = [{ font: "Big", blocks: [{ text: "A", color: "#111111" }] }];
  internals.ui.loadedFonts.add("Standard");

  internals.cycleFont(0, 1, createTestElement("input"));
  assert.deepStrictEqual(savedFonts, []);

  const listbox = createTestElement("div");
  const input = createTestElement("input");
  internals.openFontCombobox(0, listbox, input);
  await flushMicrotasks();

  assert.deepStrictEqual(savedFonts, ["Standard"]);
  assert.strictEqual(input.attributes["aria-expanded"], "true");
  assert.strictEqual(listbox.hidden, false);
  assert.ok(internals.ui.lastRenderResult && internals.ui.lastRenderResult.logo.rows.length > 0, "dropdown open should flush pending preview too");
});

test("open font dropdown arrow updates row font to highlighted option", () => {
  const scheduled = [];
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Big", "Small", "Standard"],
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  });
  internals.state.rows = [{ font: "Big", blocks: [{ text: "A", color: "#111111" }] }];

  const listbox = createTestElement("div");
  const input = createTestElement("input");
  internals.openFontCombobox(0, listbox, input);

  const event = {
    key: "ArrowDown",
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  internals.handleFontComboboxKeydown(event, 0, listbox, input);

  assert.strictEqual(event.defaultPrevented, true);
  assert.strictEqual(internals.state.rows[0].font, "Small");
  assert.strictEqual(input.value, "Small");
  assert.deepStrictEqual(scheduled.map((timer) => timer.delay), [150, 500]);
});

test("font dropdown scrolls highlighted option on the next animation frame", () => {
  let frameCallback;
  const internals = loadLogoBuilderInternals({
    requestAnimationFrame(callback) {
      frameCallback = callback;
    },
  });
  let selector;
  let scrollOptions;
  const highlightedOption = {
    scrollIntoView(options) {
      scrollOptions = options;
    },
  };
  const listbox = {
    querySelector(value) {
      selector = value;
      return highlightedOption;
    },
  };

  internals.scrollHighlightedFontOption(listbox);
  assert.strictEqual(scrollOptions, undefined, "scroll should wait for requestAnimationFrame");
  assert.strictEqual(typeof frameCallback, "function");

  frameCallback();

  assert.strictEqual(selector, ".font-option.highlighted");
  assert.strictEqual(scrollOptions && scrollOptions.block, "nearest");
});

test("font dropdown options render font name, tags, and loading status columns", () => {
  const internals = loadLogoBuilderInternals({
    ALL_FONTS: ["Standard"],
    FONT_TAGS: {
      Standard: ["readable", "block"],
    },
  });
  internals.state.rows = [{ font: "Standard", blocks: [{ text: "A", color: "#111111" }] }];
  internals.ui.loadingFonts.add("Standard");

  const listbox = createTestElement("div");
  const input = createTestElement("input");
  internals.renderFontOptions(0, listbox, input);

  const option = listbox.children[0];
  assert.strictEqual(option.children.length, 3);
  assert.strictEqual(option.children[0].className, "font-option-name");
  assert.strictEqual(option.children[0].textContent, "Standard");
  assert.strictEqual(option.children[1].className, "font-option-tags");
  assert.deepStrictEqual(option.children[1].children.map((child) => child.textContent), ["readable", "block"]);
  assert.strictEqual(option.children[2].className, "font-option-status");
  assert.strictEqual(option.children[2].textContent, "Loading");
  assert.strictEqual(option.attributes["aria-label"], "Standard (loading)");
});

let failed = 0;
(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  if (failed > 0) {
    console.error(`${failed} test${failed === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }

  console.log(`${tests.length} tests passed.`);
})();
