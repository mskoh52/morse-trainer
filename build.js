#!/usr/bin/env node
// Compile the multi-file source into one self-contained HTML file.
// Inlines css/styles.css and the four js/ modules into index.html.
// Output: dist/morse-trainer.html — open it directly, no server needed.

const fs = require("fs");
const path = require("path");

const dir = __dirname;
const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");

const JS_FILES = ["js/morse.js", "js/storage.js", "js/srs.js", "js/app.js"];

function build() {
  let html = read("index.html");
  const css = read("css/styles.css");

  // Inline the stylesheet.
  const linkTag = '<link rel="stylesheet" href="css/styles.css" />';
  if (!html.includes(linkTag)) {
    throw new Error("Could not find the stylesheet <link> tag to inline.");
  }
  html = html.replace(linkTag, "<style>\n" + css + "\n  </style>");

  // Inline the scripts, preserving load order, as a single <script> block.
  const scriptTags = JS_FILES.map((f) => '<script src="' + f + '"></script>');
  const scriptBlock = scriptTags.join("\n  ");
  if (!html.includes(scriptBlock)) {
    throw new Error("Could not find the ordered <script> tags to inline.");
  }
  const bundled =
    "<script>\n" +
    JS_FILES.map(
      (f) => "// ===== " + f + " =====\n" + read(f)
    ).join("\n") +
    "\n  </script>";
  html = html.replace(scriptBlock, bundled);

  // Fail loudly if any external reference survived.
  if (/href="css\/|src="js\//.test(html)) {
    throw new Error("Inlining left an external reference behind.");
  }

  const outDir = path.join(dir, "dist");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "morse-trainer.html");
  fs.writeFileSync(outPath, html);
  return outPath;
}

if (require.main === module) {
  const out = build();
  console.log("Wrote " + path.relative(dir, out) + " (" + fs.statSync(out).size + " bytes)");
}

module.exports = { build, JS_FILES };
