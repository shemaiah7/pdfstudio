#!/bin/sh
# Builds the unpacked development copy of the extension at extension/dist/dev: the same files as the
# shipped package, plus localhost / 127.0.0.1 content-script matches so it can talk to a local dev server.
# Load extension/dist/dev with "Load unpacked"; never submit it to a store.
set -eu
cd "$(dirname "$0")/.."
out=extension/dist/dev
rm -rf "$out"
mkdir -p "$out"
for f in manifest.json background.js content.js lib.js popup.html popup.js popup.css; do cp "extension/$f" "$out/$f"; done
cp -R extension/icons "$out/icons"
node -e '
const fs = require("fs");
const p = process.argv[1];
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.content_scripts[0].matches.push("http://localhost/*", "http://127.0.0.1/*");
m.name += " (dev)";
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$out/manifest.json"
echo "Dev extension ready: $out"
