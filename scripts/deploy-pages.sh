#!/bin/sh
# Build and publish dist/ to the gh-pages branch (GitHub Pages serves it at /vasoscan/).
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
npm test
VASOSCAN_BASE=/vasoscan/ npm run build
TMP=$(mktemp -d)
cp -R dist/. "$TMP"
touch "$TMP/.nojekyll"
REV=$(git rev-parse --short HEAD)
cd "$TMP"
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" commit -qm "Deploy $REV"
git push -qf "$(git -C "$ROOT" remote get-url origin)" gh-pages
rm -rf "$TMP"
echo "Deployed $REV to https://aunn-a.github.io/vasoscan/"
