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
