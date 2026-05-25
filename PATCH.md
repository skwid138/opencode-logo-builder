# figlet.js ownership patch

This repository vendors `figlet.js` v1.8.0 from:

```text
https://cdn.jsdelivr.net/npm/figlet@1.8.0/lib/figlet.js
```

`vendor/figlet.js` is intentionally patched with a small side channel so the app can render a whole row as one FIGlet string while still knowing which original text block owns each output column.

## Patch locations

1. `generateFigTextLines` near line 785:
   - initializes `owners` when `opts._blockBoundaries` is an array
   - after `horizontalSmush(...)`, mirrors figlet's left/overlap/right assembly to update owner columns
   - writes `me._lastOwners = owners` only when `_blockBoundaries` was passed
2. `_reworkFontOpts` near line 1125:
   - preserves `options._blockBoundaries` through figlet's option normalization

## Applied diff

```diff
@@ function generateFigTextLines(txt, figChars, opts) {
+    const trackOwnership = Array.isArray(opts._blockBoundaries);
+    let owners = trackOwnership ? newFigChar(height).map(function () { return []; }) : null,
+      currentBlock = 0;
@@
-        outputFigText = horizontalSmush(outputFigText, figChar, overlap, opts);
+        const previousOutputFigText = outputFigText;
+        outputFigText = horizontalSmush(outputFigText, figChar, overlap, opts);
+        if (trackOwnership) {
+          while (
+            currentBlock + 1 < opts._blockBoundaries.length &&
+            charIndex >= opts._blockBoundaries[currentBlock + 1]
+          ) {
+            currentBlock++;
+          }
+          for (row = 0; row < opts.height; row++) {
+            const leftOwners = owners[row] || [];
+            const txt1 = previousOutputFigText[row];
+            const txt2 = figChar[row];
+            const len1 = txt1.length;
+            const len2 = txt2.length;
+            const piece1Len = Math.max(0, len1 - overlap);
+            const seg1StartPos = Math.max(0, len1 - overlap);
+            const seg2 = txt2.substring(0, Math.min(overlap, len2));
+            const rowOwners = leftOwners.slice(0, piece1Len);
+            for (let jj = 0; jj < overlap; jj++) {
+              const ch2 = jj < len2 ? seg2.substring(jj, jj + 1) : " ";
+              rowOwners.push(ch2 === " " || ch2 === "" ? leftOwners[seg1StartPos + jj] : currentBlock);
+            }
+            for (let jj = overlap; jj < len2; jj++) {
+              rowOwners.push(currentBlock);
+            }
+            owners[row] = rowOwners;
+          }
+        }
       }
     }
+    if (trackOwnership) {
+      me._lastOwners = owners;
+    }
@@ function _reworkFontOpts(fontOpts, options) {
     myOpts.width = options.width || -1;
     myOpts.whitespaceBreak = options.whitespaceBreak || false;
+    myOpts._blockBoundaries = options._blockBoundaries;
```

## Ownership rules

- `_blockBoundaries` is an array of cumulative start offsets for each non-empty block in the concatenated input, for example `['Just', 'Vibes'] → [0, 4]`.
- Non-overlap columns coming from the right FIGcharacter are assigned to the current block.
- Existing left-side non-overlap columns keep their previous owner.
- Overlap columns are assigned to the current/right block unless the right character is blank, in which case the left owner is preserved. This matches `uni_Smush` behavior.
- No `_blockBoundaries` means the patch is inert: no `_lastOwners` write and no return-value/signature changes.

## Preconditions and limitations

- Use through `figlet-color-map.js` / `window.renderWithOwnership(blocks, fontName)`.
- Inputs must not contain newlines; the wrapper enforces this.
- Width wrapping must not be used; the wrapper enforces this.
- Read `figlet._lastOwners` immediately after `textSync`, before any other figlet render.
- Right-to-left fonts (`printDirection === 1`) are unsupported by this side channel; the wrapper falls back to per-block rendering.

## Re-applying after a figlet update

1. Download the new core file to `vendor/figlet.js`.
2. Re-apply the two patch locations above.
3. Confirm `vendor/Standard.js` is present for tests.
4. Run:

```sh
node test.js
node --check app.js
node --check figlet-color-map.js
node --check vendor/figlet.js
```
