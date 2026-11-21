## Deploy Cloudflare Worker

Steps to deploy the Cloudflare Worker for music recognition.

1. **Lint** the worker code:
   ```bash
   npx eslint docs/recognize-worker.js
   ```
2. **Deploy** via Wrangler:
   ```bash
   npx wrangler deploy
   ```
   Ensure you are logged in with the correct account and have the `wrangler.toml` configured.
