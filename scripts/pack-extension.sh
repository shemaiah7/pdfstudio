#!/bin/sh
# Zips the production extension (no tests, README or STORE copy, no localhost matches) for the Chrome Web Store
# and Edge Add-ons: extension/dist/sentinelpdf-extension-<version>.zip
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./extension/manifest.json").version')
mkdir -p extension/dist
zip_path="$PWD/extension/dist/sentinelpdf-extension-$version.zip"
rm -f "$zip_path"
(cd extension && zip -q -r "$zip_path" manifest.json background.js content.js lib.js popup.html popup.js popup.css icons -x '*.DS_Store')
echo "Packed $zip_path"
unzip -l "$zip_path"
