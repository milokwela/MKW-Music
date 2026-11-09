#!/bin/bash
# Сборка MKW из src/ в dist/. Запуск из корня репозитория: bash scripts/build.sh 0.36.7 1
# Нужны: bash, node, npx (esbuild ставится сам через npx). Переменная ESBUILD — свой путь к esbuild.
set -e
PY=$(command -v python3 || command -v python)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V=$1; D="${OUT:-$ROOT/dist}"
cd "$ROOT/src"
rm -rf "$D" && mkdir -p "$D"
cp css/*.css js/*.js assets/*.png assets/*.jpg assets/*.svg assets/*.webp manifest.webmanifest firestore.rules $D/
sed 's#css/##g; s#js/app.js#app.js#; s#assets/##g' index.html | sed "s/v=0\.13\.[0-9]/v=$V/g" > $D/index.html
cd $D
sed -i 's#assets/##g' manifest.webmanifest *.js
sed -i -E "s#(from '\./[a-z0-9-]+\.js)'#\1?v=$V'#g" *.js
grep -l "assets/" *.js || true
rm -f config.js keys.js firebase-config.js shazam-config.js
cp "$ROOT/README.md" .

echo "{\"v\":\"$(grep -o "VERSION = '[^']*" $ROOT/src/js/changelog.js | cut -d"'" -f2)\"}" > version.json
for f in *.js; do node --check $f || echo BAD $f; done

# ---- 0.31: один файл скриптов и один файл стилей (быстрый старт на телефоне) ----
EB="${ESBUILD:-npx esbuild}"
SRC=$(mktemp -d); cp $ROOT/src/js/*.js $SRC/; sed -i "s#assets/##g" $SRC/*.js
$EB $SRC/app.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --log-level=warning \
  --external:'https://*' --external:./config.js --external:./keys.js --external:./firebase-config.js --external:./shazam-config.js \
  --outfile=$D/app.js
sed -i -E "s#\"\./(config|keys|firebase-config|shazam-config)\.js\"#\"./\1.js?v=$V\"#g" $D/app.js
rm -rf $SRC
CSS=$(grep -o 'href="css/[a-z0-9-]*\.css' $ROOT/src/index.html | sed 's#href="css/##')
( for c in $CSS; do cat $ROOT/src/css/$c; echo; done ) > $D/app.src.css
$EB $D/app.src.css --minify --loader:.css=css --log-level=warning --outfile=$D/app.css
rm $D/app.src.css
"$PY" - "$D/index.html" "$V" <<'PY'
import re,sys
p,v=sys.argv[1],sys.argv[2]; s=open(p).read()
links=re.findall(r'<link rel="stylesheet" href="[a-z0-9-]+\.css\?v=[^"]*">\n?', s)
s=s.replace(links[0], f'<link rel="stylesheet" href="app.css?v={v}">\n',1)
for l in links[1:]: s=s.replace(l,'',1)
open(p,'w').write(s)
PY
# ---- 0.35.8: в сайт кладём только то, что реально грузится ----
( cd $D && for f in *.js; do case $f in app.js|sw.js|lame.min.js) ;; *) rm -f "$f";; esac; done
  for f in *.css; do [ "$f" = app.css ] || rm -f "$f"; done
  rm -f ic4-*.png mkw-180.png mkw-192.png mkw-512.png mkw-maskable-512.png logo.jpg cat.jpg )
node --check $D/app.js && echo "bundle ok: $(wc -c < $D/app.js) js, $(wc -c < $D/app.css) css"
