(function (root) {
  "use strict";

  const FALLBACK_WARNING = "Ownership coloring unavailable; using per-block fallback rendering.";

  function renderWithOwnership(blocks, fontName, options = {}) {
    options = options || {};
    if (options && Object.prototype.hasOwnProperty.call(options, "width") && options.width > 0) {
      throw new Error("renderWithOwnership does not support width wrapping.");
    }

    const figletApi = options.figlet || root.figlet;
    if (!figletApi || typeof figletApi.textSync !== "function") {
      throw new Error("figlet.textSync is required for renderWithOwnership.");
    }

    const normalizedBlocks = normalizeBlocks(blocks);
    if (normalizedBlocks.length === 0) {
      return { lines: [], owners: [] };
    }

    if (isRightToLeftFont(figletApi, fontName)) {
      return renderFallback(figletApi, normalizedBlocks, fontName, "Ownership coloring is unsupported for right-to-left FIGlet fonts; using per-block fallback rendering.");
    }

    const ownerIndexToOriginalBlock = [];
    const boundaries = [];
    const parts = [];
    let offset = 0;
    normalizedBlocks.forEach((block) => {
      boundaries.push(offset);
      ownerIndexToOriginalBlock.push(block.originalIndex);
      parts.push(block.text);
      offset += block.text.length;
    });

    try {
      if (Object.prototype.hasOwnProperty.call(figletApi, "_lastOwners")) {
        delete figletApi._lastOwners;
      }
      const output = figletApi.textSync(parts.join(""), {
        font: fontName,
        horizontalLayout: "default",
        verticalLayout: "default",
        _blockBoundaries: boundaries,
      });
      const rawLines = output.split("\n");
      const rawOwners = figletApi._lastOwners;
      if (!Array.isArray(rawOwners)) {
        return renderFallback(figletApi, normalizedBlocks, fontName, FALLBACK_WARNING);
      }

      const trimmed = trimBlankLinesWithOwners(rawLines, rawOwners);
      const mappedOwners = trimmed.owners.map((row) => row.map((owner) => ownerIndexToOriginalBlock[owner]));
      if (!ownersMatchLines(trimmed.lines, mappedOwners)) {
        return renderFallback(figletApi, normalizedBlocks, fontName, "Ownership width mismatch; using per-block fallback rendering.");
      }

      return { lines: trimmed.lines, owners: mappedOwners };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return renderFallback(figletApi, normalizedBlocks, fontName, `Ownership render failed (${message}); using per-block fallback rendering.`);
    }
  }

  function normalizeBlocks(blocks) {
    if (!Array.isArray(blocks)) {
      throw new Error("renderWithOwnership expected an array of blocks.");
    }

    const normalized = [];
    blocks.forEach((block, originalIndex) => {
      const text = String((block && block.text) ?? "");
      if (/\r|\n/.test(text)) {
        throw new Error("renderWithOwnership does not support newline characters.");
      }
      if (text !== "") {
        normalized.push({ text, originalIndex });
      }
    });
    return normalized;
  }

  function isRightToLeftFont(figletApi, fontName) {
    return Boolean(
      figletApi.figFonts &&
        figletApi.figFonts[fontName] &&
        figletApi.figFonts[fontName].options &&
        figletApi.figFonts[fontName].options.printDirection === 1,
    );
  }

  function renderFallback(figletApi, normalizedBlocks, fontName, warning = FALLBACK_WARNING) {
    const renderedBlocks = [];
    const errors = [];

    normalizedBlocks.forEach((block) => {
      try {
        const output = figletApi.textSync(block.text, {
          font: fontName,
          horizontalLayout: "default",
          verticalLayout: "default",
        });
        const lines = trimBlankLines(output.split("\n")).map(rightTrim);
        const trimmedWidth = lines.reduce((max, line) => Math.max(max, line.length), 0);
        renderedBlocks.push({ originalIndex: block.originalIndex, lines, trimmedWidth });
      } catch (error) {
        errors.push({ blockIndex: block.originalIndex, error });
      }
    });

    const height = renderedBlocks.reduce((max, block) => Math.max(max, block.lines.length), 0);
    const lines = [];
    const owners = [];
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      const rowLines = renderedBlocks.map((block) => rightTrim(block.lines[lineIndex] || ""));
      const finalBlockIndex = findLastIndex(rowLines, (line) => line !== "");
      if (finalBlockIndex === -1) {
        continue;
      }

      let line = "";
      const ownerRow = [];
      renderedBlocks.slice(0, finalBlockIndex + 1).forEach((block, blockIndex) => {
        const rawLine = rowLines[blockIndex];
        const text = blockIndex === finalBlockIndex ? rawLine : padRight(rawLine, block.trimmedWidth);
        line += text;
        for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
          ownerRow.push(block.originalIndex);
        }
      });
      lines.push(line);
      owners.push(ownerRow);
    }

    return { lines, owners, fallback: true, warning, errors };
  }

  function trimBlankLinesWithOwners(lines, owners) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === "") {
      start += 1;
    }
    while (end > start && lines[end - 1].trim() === "") {
      end -= 1;
    }

    const trimmedLines = [];
    const trimmedOwners = [];
    for (let index = start; index < end; index += 1) {
      const line = rightTrim(lines[index]);
      trimmedLines.push(line);
      trimmedOwners.push(Array.isArray(owners[index]) ? owners[index].slice(0, line.length) : []);
    }
    return { lines: trimmedLines, owners: trimmedOwners };
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

  function ownersMatchLines(lines, owners) {
    return lines.length === owners.length && lines.every((line, index) => owners[index].length === line.length && owners[index].every((owner) => Number.isInteger(owner)));
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

  root.renderWithOwnership = renderWithOwnership;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { renderWithOwnership };
  }
})(typeof window !== "undefined" ? window : globalThis);
