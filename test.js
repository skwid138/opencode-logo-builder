const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const figlet = require("./vendor/figlet");

function loadImportableFont(fontName) {
  const fontPath = path.join(__dirname, "vendor", `${fontName}.js`);
  const source = fs.readFileSync(fontPath, "utf8").replace(/^export default /, "module.exports = ");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename: fontPath });
  figlet.parseFont(fontName, module.exports);
}

function loadLogoBuilderInternals() {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const sandbox = {
    console,
    document: {
      addEventListener() {},
    },
    window: {
      __LOGO_BUILDER_TEST__: true,
      figlet,
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

test("Figlet renders Standard font text", () => {
  const output = renderText("A");
  assert.ok(output.includes("/ \\"), "expected Standard font output for A");
  assert.ok(output.split("\n").length >= 6, "expected multi-line figlet output");
});

test("trailing whitespace is trimmed from all rendered block segments", () => {
  const rendered = renderBlocksToLines(
    [
      { text: "A", color: "#111111" },
      { text: "B", color: "#222222" },
    ],
    "Standard",
    figlet,
  );

  assert.ok(rendered.rows.length > 0, "expected rendered rows");
  rendered.rows.forEach((row) => {
    row.segments.forEach((segment) => {
      assert.ok(!/[ \t]+$/.test(segment.text), `segment has trailing whitespace: ${JSON.stringify(segment.text)}`);
    });
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

test("multiple blocks concatenate without artificial padding gaps", () => {
  const rendered = renderBlocksToLines(
    [
      { text: "A", color: "#111111" },
      { text: "B", color: "#222222" },
    ],
    "Standard",
    figlet,
  );
  const aLines = trimBlankLines(renderText("A").split("\n")).map(rightTrim);
  const bLines = trimBlankLines(renderText("B").split("\n")).map(rightTrim);

  assert.strictEqual(rendered.rows.length, Math.max(aLines.length, bLines.length));
  rendered.rows.forEach((row, lineIndex) => {
    assert.strictEqual(row.segments.length, 2, `expected two segments on line ${lineIndex}`);
    assert.strictEqual(row.segments[0].text, aLines[lineIndex]);
    assert.strictEqual(row.segments[1].text, bLines[lineIndex]);
    assert.strictEqual(row.segments.map((segment) => segment.text).join(""), `${aLines[lineIndex]}${bLines[lineIndex]}`);
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

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
});

if (failed > 0) {
  console.error(`${failed} test${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`${tests.length} tests passed.`);
