## Release Android APK

1. **Update version** in `app/build.gradle` and `version.json`.
2. **Prepare release notes** following the template from
   `.claude-backup/mkw_release_latest.txt`:
   - `tag: android-beta`
   - `name: MKW Music для Android`
   - `published: <ISO8601>`
   - `Версия приложения, сборка, SHA‑256, подпись и обязательные обновления`
3. **Increment build counter** after `#51`.
4. **Generate APK** using Gradle:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```
5. **Compute SHA‑256** of the generated `app-release.apk`.
6. **Create release** in GitHub (use the above notes and attach the APK).
7. **Push tags** to GitHub.
