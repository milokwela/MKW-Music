#!/usr/bin/env bash
# Запускается внутри эмулятора (см. .github/workflows/android.yml, job smoke).
# Использование: smoke.sh путь/к/debug.apk папка-для-результатов
set -u
APK="$1"
OUT="$2"
mkdir -p "$OUT"
adb wait-for-device
adb logcat -c || true
adb install -r -t "$APK" > "$OUT/install.txt" 2>&1
cat "$OUT/install.txt"
python3 android/ci/smoke.py "$OUT" > "$OUT/smoke.log" 2>&1 || echo "smoke.py завершился с ошибкой" >> "$OUT/smoke.log"
cat "$OUT/smoke.log" | tail -n 80
adb logcat -d > "$OUT/logcat_full.txt" 2>&1 || true
grep -E "MKWWeb|MKWApp|AndroidRuntime|FATAL|MKWSHIM" "$OUT/logcat_full.txt" > "$OUT/logcat_mkw.txt" || true
tail -n 300 "$OUT/logcat_full.txt" > "$OUT/logcat_tail.txt" || true
rm -f "$OUT/logcat_full.txt"
exit 0
