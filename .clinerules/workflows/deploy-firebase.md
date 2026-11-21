## Deploy Firebase Rules

1. **Lint** the Firestore rules file:
   ```bash
   npx eslint firestore.rules
   ```
2. **Deploy** the rules:
   ```bash
   npx firebase deploy --only firestore:rules
   ```
