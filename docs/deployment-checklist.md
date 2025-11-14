# Deployment & Verification Checklist

## 1. Local Verification
1. Install dependencies if needed: `npm install && cd functions && npm install`.
2. Run the app build to ensure Vite compiles: `npm run build`.
3. Run Cloud Functions tests (if/when added).  
   - `npm run test` is not defined in this repo (confirmed 2025-11-13). Add a functions test script (e.g., `npm run test:functions`) when ready.
4. Optionally run linting/formatting commands (`npm run lint` if configured).

## 2. Firestore Rules & Indexes
1. Deploy the updated security rules:  
   ```bash
   firebase deploy --only firestore:rules
   ```
2. Deploy Firestore indexes (or use `firebase firestore:indexes` to push `firestore.indexes.json`).

## 3. Cloud Functions
1. From `/functions`, deploy the new engagement functions:  
   ```bash
   npm run deploy -- onCommentWrite toggleCommentLike authorLikeToggle
   ```  
   or run `firebase deploy --only functions`.
2. Monitor the logs after deploy: `npm run logs` or `firebase functions:log`.

## 4. Client Release
1. Build the production bundle: `npm run build`.
2. Deploy hosting if applicable: `firebase deploy --only hosting`.

## 5. Communication & Follow‑up
1. Announce the schema/rules changes to the team (pinned message or release notes).
2. Share the new engagement features (top replies, badges, notifications, mentions) with QA/product for regression testing.
3. Track any index build progress in the Firebase console (indexes may take several minutes).

> **Note:** Running `npm run test` currently fails because the script is not defined. Add appropriate unit/integration tests (especially for Cloud Functions) and wire them into the npm scripts to satisfy automated test expectations.
