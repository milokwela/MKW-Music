## Deploy Site Workflow

This document describes the steps to deploy the static MKW Music site.

1. **Lint** the source code:
   ```bash
   npx eslint . --ext .js,.mjs,.cjs
   ```
2. **Update version**:
   - Edit `version.json` and `sw.js` with the new version number.
   - Commit changes:
     ```bash
     git add version.json sw.js
     git commit -m "chore: bump version to $(cat version.json)"
     ```
3. **Refresh memory‑bank**:
   - Copy the latest `memory-bank/` state from the repo or CI artifact.
   - Commit if there were changes.
4. **Push to GitHub**:
   ```bash
   git push origin main
   ```
5. **GitHub Pages** automatically deploys on push to `main`.
