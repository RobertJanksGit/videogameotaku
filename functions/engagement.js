import admin from "firebase-admin";

const LIKE_WEIGHT = 3;
const REPLY_WEIGHT = 2;
const AUTHOR_PICK_BONUS = 5;
const FRESHNESS_WINDOW_HOURS = 10;
const FRESHNESS_MAX = 10;
const MENTION_REGEX = /@([A-Za-z0-9_-]{1,32})/g;
const NOTIFICATION_DEDUPE_MS = 5 * 60 * 1000;

const TALKATIVE_THRESHOLDS = [
  { badge: "talkative_i", count: 10 },
  { badge: "talkative_ii", count: 50 },
  { badge: "talkative_iii", count: 200 },
];

const STREAK_THRESHOLDS = [
  { badge: "streaker_3", days: 3 },
  { badge: "streaker_7", days: 7 },
  { badge: "streaker_30", days: 30 },
];

const BADGE_LABELS = {
  first_comment: "First Comment",
  talkative_i: "Talkative I",
  talkative_ii: "Talkative II",
  talkative_iii: "Talkative III",
  helpful: "Helpful",
  authors_pick: "Author's Pick",
  streaker_3: "Streaker (3 days)",
  streaker_7: "Streaker (7 days)",
  streaker_30: "Streaker (30 days)",
};

const toDate = (value) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return new Date(value);
};

export const toDateStamp = (value) => {
  const date = toDate(value);
  return date.toISOString().split("T")[0];
};

export const getYesterdayStamp = (value) => {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split("T")[0];
};

export const computeFreshnessBoost = (createdAt) => {
  const createdDate = toDate(createdAt);
  const hours = Math.max(
    0,
    (Date.now() - createdDate.getTime()) / (1000 * 60 * 60)
  );
  return Math.max(0, Math.floor(FRESHNESS_MAX - Math.min(hours, FRESHNESS_WINDOW_HOURS)));
};

export const computeScore = (comment) => {
  const likeCount = Number.isFinite(comment.likeCount) ? comment.likeCount : 0;
  const replyCount = Number.isFinite(comment.replyCount) ? comment.replyCount : 0;
  const likedBonus = comment.likedByAuthor ? AUTHOR_PICK_BONUS : 0;
  return (
    likeCount * LIKE_WEIGHT +
    replyCount * REPLY_WEIGHT +
    computeFreshnessBoost(comment.createdAt) +
    likedBonus
  );
};

export const normalizeCommentFields = (comment, overrides = {}) => {
  const base = {
    likeCount: 0,
    replyCount: 0,
    score: 0,
    likedByAuthor: false,
    mentions: [],
    mentionHandles: [],
    threadRootCommentId: comment.threadRootCommentId || null,
    ...comment,
    ...overrides,
  };

  base.likeCount = Number.isFinite(base.likeCount) ? base.likeCount : 0;
  base.replyCount = Number.isFinite(base.replyCount) ? base.replyCount : 0;
  base.likedByAuthor = Boolean(base.likedByAuthor);
  if (!Array.isArray(base.mentions)) base.mentions = [];
  if (!Array.isArray(base.mentionHandles)) base.mentionHandles = [];
  return base;
};

export const parseHandlesFromContent = (content = "") => {
  const handles = new Set();
  let match;
  while ((match = MENTION_REGEX.exec(content))) {
    if (match[1]) {
      handles.add(match[1].toLowerCase());
    }
  }
  return Array.from(handles);
};

export const resolveHandlesToUsers = async (db, handles = []) => {
  if (!handles.length) return [];
  const unique = Array.from(new Set(handles.filter(Boolean)));
  const refs = unique.map((handle) =>
    db.collection("user_handles").doc(handle)
  );
  if (!refs.length) return [];
  const snaps = await db.getAll(...refs);
  return snaps
    .filter((snap) => snap.exists)
    .map((snap) => {
      const data = snap.data() || {};
      return {
        userId: data.userId || null,
        handle: data.handle || snap.id,
        handleLower: data.handleLower || snap.id,
        displayName: data.displayName || "",
        avatarUrl: data.avatarUrl || "",
      };
    })
    .filter((entry) => entry.userId);
};

export const buildMentionPayload = async (db, content, existingHandles = []) => {
  const handles =
    existingHandles.length > 0
      ? existingHandles
      : parseHandlesFromContent(content);

  if (!handles.length) {
    return { userIds: [], metadata: [] };
  }

  const resolved = await resolveHandlesToUsers(db, handles);
  const seen = new Set();
  const userIds = [];
  const metadata = [];

  resolved.forEach((entry) => {
    if (entry.userId && !seen.has(entry.userId)) {
      seen.add(entry.userId);
      userIds.push(entry.userId);
      metadata.push({
        handle: entry.handle,
        userId: entry.userId,
        displayName: entry.displayName,
        avatarUrl: entry.avatarUrl,
      });
    }
  });

  return { userIds, metadata };
};

const addBadge = (existing = [], badgeId) => {
  if (!badgeId) return existing;
  const set = new Set(existing);
  set.add(badgeId);
  return Array.from(set);
};

const applyCountBadges = (badges, commentCount) => {
  let next = badges.slice();
  if (commentCount === 1) {
    next = addBadge(next, "first_comment");
  }
  TALKATIVE_THRESHOLDS.forEach(({ badge, count }) => {
    if (commentCount >= count) {
      next = addBadge(next, badge);
    }
  });
  return next;
};

const applyStreakBadges = (badges, dailyStreak) => {
  let next = badges.slice();
  STREAK_THRESHOLDS.forEach(({ badge, days }) => {
    if (dailyStreak >= days) {
      next = addBadge(next, badge);
    }
  });
  return next;
};

export const updateUserStatsOnComment = async ({
  db,
  userId,
  createdAt,
}) => {
  if (!userId) return null;
  const statsRef = db.collection("user_stats").doc(userId);
  const todayStamp = toDateStamp(createdAt || new Date());
  const yesterdayStamp = getYesterdayStamp(createdAt || new Date());

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(statsRef);
    const data = snap.exists ? snap.data() || {} : {};
    const prevCount = Number.isFinite(data.commentCount) ? data.commentCount : 0;
    const prevStreak = Number.isFinite(data.dailyStreak) ? data.dailyStreak : 0;
    const prevBadges = Array.isArray(data.badges) ? data.badges : [];

    const nextCount = prevCount + 1;
    let nextStreak = 1;
    if (data.lastCommentDate === todayStamp) {
      nextStreak = prevStreak;
    } else if (data.lastCommentDate === yesterdayStamp) {
      nextStreak = prevStreak + 1;
    }

    let nextBadges = applyCountBadges(prevBadges, nextCount);
    nextBadges = applyStreakBadges(nextBadges, nextStreak);

    tx.set(
      statsRef,
      {
        commentCount: nextCount,
        dailyStreak: nextStreak,
        lastCommentDate: todayStamp,
        badges: nextBadges,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
};

export const maybeAwardBadge = async ({ db, userId, badgeId }) => {
  if (!userId || !badgeId) return;
  const statsRef = db.collection("user_stats").doc(userId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(statsRef);
    const data = snap.exists ? snap.data() || {} : {};
    const badges = Array.isArray(data.badges) ? data.badges : [];
    if (badges.includes(badgeId)) {
      return;
    }
    badges.push(badgeId);
    tx.set(statsRef, { badges }, { merge: true });
  });
};

export const maybeAwardHelpfulBadge = async ({ db, userId, likeCount }) => {
  if (!Number.isFinite(likeCount) || likeCount < 10) {
    return;
  }
  await maybeAwardBadge({ db, userId, badgeId: "helpful" });
};

export const maybeAwardAuthorsPickBadge = async ({ db, userId, liked }) => {
  if (!liked) {
    return;
  }
  await maybeAwardBadge({ db, userId, badgeId: "authors_pick" });
};

export const createNotificationItem = async ({
  db,
  recipientId,
  type,
  actorId,
  actorName,
  postId,
  commentId,
  title = "",
  snippet = "",
}) => {
  if (!recipientId || !actorId || recipientId === actorId) return null;
  const itemsRef = db.collection("notifications").doc(recipientId).collection("items");
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - NOTIFICATION_DEDUPE_MS
  );

  const existing = await itemsRef
    .where("type", "==", type)
    .where("actorId", "==", actorId)
    .where("commentId", "==", commentId || null)
    .where("postId", "==", postId || null)
    .where("createdAt", ">=", cutoff)
    .limit(1)
    .get();

  if (!existing.empty) {
    return null;
  }

  await itemsRef.add({
    type,
    actorId,
    actorName: actorName || "",
    postId: postId || null,
    commentId: commentId || null,
    title: title || "",
    snippet: snippet || "",
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const createLegacyNotification = async ({
  db,
  payload,
}) => {
  const ref = db.collection("notifications").doc();
  await ref.set(payload);
};
