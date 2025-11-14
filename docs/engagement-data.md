# Engagement Data Foundations

## Comment & Post Fields

| Document | Field | Type | Notes |
| --- | --- | --- | --- |
| `posts/{postId}` | `commentCount` | number | Already present; ensure increments stay atomic. |
| `posts/{postId}/comments/{commentId}` | `score` | number | Computed server-side: `likeCount * 3 + replyCount * 2 + freshnessBoost`. |
|  | `likeCount` | number | Increment-only via callable; default `0`. |
|  | `likedByAuthor` | boolean | Only toggled by post author. |
|  | `replyCount` | number | Maintained by functions; default `0`. |
|  | `mentions` | string[] | List of mentioned userIds (validated server-side). |
|  | `mentionHandles` | object[] | Optional client hint for UI (handle, userId, avatarUrl). |
|  | `createdAt` | Timestamp | Required for freshness boost + ordering. |
|  | `threadRootCommentId` | string | Stable root id for nested replies. |

## Supporting Collections

| Collection | Fields | Purpose |
| --- | --- | --- |
| `user_stats/{userId}` | `commentCount`, `dailyStreak`, `lastCommentDate`, `badges` | Tracked/updated exclusively by Cloud Functions. |
| `notifications/{userId}/items/{notificationId}` | `type`, `postId`, `commentId`, `actorId`, `createdAt`, `read`, `title?`, `snippet?` | Reply/mention/like loop. Write guarded to server. |
| `user_handles/{handle}` | `userId`, `handle`, `handleLower`, `displayName`, `avatarUrl`, `updatedAt` | Lookup table for mention autocomplete + normalization. |

## Utility Modules Added

| File | Responsibility |
| --- | --- |
| `src/utils/commentRefs.js` | Centralized helpers for `posts/{postId}/comments` refs, including safe fallbacks when only doc paths are available. |
| `src/utils/mentions.js` | Mention parsing + caching; exports helpers to extract handles from text and resolve them to userIds. |
| `src/utils/userHandles.js` | Normalize handles and persist/remove `user_handles/{handle}` docs with timestamps. |
| `src/hooks/useMentionSuggestions.js` & `src/components/posts/MentionTextarea.jsx` | Client-side mention autocomplete: detects `@handle` tokens, fetches suggestions from `user_handles`, and inserts the selected handle into the textarea. |
| `src/hooks/useNotifications.js` & header updates | Centralized listener for `notifications/{userId}/items`, exposes unread count + mark-as-read helpers used by the Layout bell, dropdown, and toast workflow. |
| `src/hooks/useAuthorRanks.js` | Fetches profile/user/user_stats data (karma, badges, streaks) for rendering badge chips and hovercard stats alongside comments and mentions. |

> These utilities are not yet wired into UI/Functions steps; they exist now so subsequent checklist items can reuse them consistently.
