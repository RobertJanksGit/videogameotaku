# Engagement System Rollout Checklist

## 1. Data Foundations

- [x] Document new Firestore fields on `posts/{postId}` and `posts/{postId}/comments/{commentId}` (score, likeCount, likedByAuthor, replyCount, mentions, createdAt).
- [x] Add `user_stats/{userId}`, `notifications/{userId}/items/{notificationId}`, and `user_handles/{handle}` collections with schema notes.
- [x] Update `firestore.rules` with `// RULES: engagement` block covering:
  - [x] author-only writes for `likedByAuthor`.
  - [x] server-only writes for score/replyCount/notifications.
  - [x] callable-only likeCount mutations and mention validation.
- [x] Update/extend `firestore.indexes.json` for comment ordering (score+createdAt) and notifications queries.
- [x] Create helper utilities for comment refs, handle normalization, and mention parsing caches.

## 2. Cloud Functions Layer

- [x] Implement `onCommentWrite` trigger (normalize fields, replyCount increments, score recompute, mention fallback).
- [x] Implement `toggleCommentLike` callable (per-user like toggle, likeCount update, notification creation).
- [x] Implement `authorLikeToggle` callable with permission check and score bump.
- [x] Implement `notifyOnReplyOrMention` (likely folded into `onCommentWrite`) with dedupe + optional push hook.
- [x] Implement `updateUserStatsOnComment` (commentCount, streak logic, badge awards).
- [x] Add badge helper module defining unlock criteria.
- [x] Document any required env vars/secrets and update `functions/package.json` scripts if needed. _(No new secrets required.)_

## 3. Client Comment Flow Upgrade

- [x] Update `PostDetail` comment query to use `collectionGroup` under `posts/{postId}/comments`.
- [x] Add Top/Newest tabs, highlight logic for top reply per thread, and author pick pillar/summary.
- [x] Wire likes via callable + optimistic state; show counts + “Author liked” chip.
- [x] Adjust comment creation/edit paths to include mentions array and rely on new functions.
- [x] Introduce data helpers (`postCommentsCollection`, etc.) for tree reads/writes.

## 4. Mentions & Composer Enhancements

- [x] Build mention-aware textarea with autocomplete on `@`.
- [x] Add `useMentionSuggestions` hook fetching from `user_handles`.
- [x] Before submit/edit, resolve handles => userIds and populate `mentions`.
- [x] Display mention chips/links with hover mini-card in CommentThread.
- [x] Ensure unknown handles gracefully degrade (leave plaintext).

## 5. Notification Experience

- [x] Create `useNotifications(userId)` hook (listen to unread `notifications/{userId}/items`).
- [x] Update header bell to show count, open panel with reply/mention/like items, link into posts.
- [x] Add “mark all as read” + per-item mark and integrate with Layout dropdown.
- [x] Trigger toast via ToastContext when live notification arrives (reply/mention) and auto-scroll to target.

## 6. Gamification Surfaces

- [x] Extend `useAuthorRanks` (or new hook) to expose badges/streak data from `user_stats`.
- [x] Render badge icons + streak chips near usernames in comments and hovercards.
- [x] Under post header, show summary snippet (e.g., “Top reply earned Author’s Pick” + author streak/badge).
- [x] Surface last earned badge + streak in profile or mini card.

## 7. Deployment

- [x] Document how to run local build/tests (see `docs/deployment-checklist.md` – `npm run test` not defined yet).
- [x] Capture deployment commands for Firestore rules + indexes.
- [x] Capture deployment commands for the new Cloud Functions.
- [x] Add release communication notes/checklist for the team.
