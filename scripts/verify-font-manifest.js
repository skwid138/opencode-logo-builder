#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseFontManifest(source) {
  const match = String(source).match(/^\s*window\.ALL_FONTS\s*=\s*(\[[\s\S]*\])\s*;\s*$/);
  if (!match) {
    throw new Error("font-manifest.js must use the exact format: window.ALL_FONTS = [...];");
  }
  const parsed = JSON.parse(match[1]);
  if (!Array.isArray(parsed) || parsed.some((font) => typeof font !== "string" || !font)) {
    throw new Error("window.ALL_FONTS must be a non-empty string array.");
  }
  return parsed;
}

function readVendoredFontNames(fontsDir) {
  return fs.readdirSync(fontsDir)
    .filter((file) => file.endsWith(".flf"))
    .map((file) => file.slice(0, -".flf".length))
    .sort((a, b) => a.localeCompare(b));
}

function compareFontSets(vendoredFonts, manifestFonts) {
  const sortedManifestFonts = manifestFonts.slice().sort((a, b) => a.localeCompare(b));
  const missingFromManifest = vendoredFonts.filter((font) => !sortedManifestFonts.includes(font));
  const missingFromVendor = sortedManifestFonts.filter((font) => !vendoredFonts.includes(font));
  const orderMatches = manifestFonts.every((font, index) => font === sortedManifestFonts[index]);
  return {
    ok: missingFromManifest.length === 0 && missingFromVendor.length === 0 && orderMatches,
    missingFromManifest,
    missingFromVendor,
    orderMatches,
  };
}

function verifyFontManifest(rootDir = path.join(__dirname, "..")) {
  const fontsDir = path.join(rootDir, "vendor", "fonts");
  const manifestPath = path.join(rootDir, "font-manifest.js");
  const vendoredFonts = readVendoredFontNames(fontsDir);
  const manifestFonts = parseFontManifest(fs.readFileSync(manifestPath, "utf8"));
  const result = compareFontSets(vendoredFonts, manifestFonts);
  if (!result.ok) {
    const details = [];
    if (result.missingFromManifest.length) {
      details.push(`Missing from manifest: ${result.missingFromManifest.join(", ")}`);
    }
    if (result.missingFromVendor.length) {
      details.push(`Missing from vendor/fonts: ${result.missingFromVendor.join(", ")}`);
    }
    if (!result.orderMatches) {
      details.push("Manifest fonts are not sorted alphabetically.");
    }
    throw new Error(details.join("\n"));
  }
  return { count: vendoredFonts.length };
}

if (require.main === module) {
  try {
    const result = verifyFontManifest();
    console.log(`Font manifest verified (${result.count} fonts).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  compareFontSets,
  parseFontManifest,
  readVendoredFontNames,
  verifyFontManifest,
};
