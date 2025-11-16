import admin from "firebase-admin";
import {
  ScheduledBotActionType,
  botProfilesCollection,
  botRuntimeStateCollection,
  scheduledBotActionsCollection,
  toBotProfile,
  toBotRuntimeState,
  buildScheduledBotActionPayload,
} from "./models.js";
import {
  clamp01,
  weightedChoice,
  randomFloat,
  getDelayFromRange,
  minutesToMs,
  nowMs as getNowMs,
} from "./utils.js";

/* global Intl */

export const resolveBotTimezone = (bot = {}) =>
  bot?.behavior?.activeTimeZone || bot?.timeZone || "America/Chicago";

const parseHHmm = (hhmm) => {
  if (typeof hhmm !== "string") {
    return NaN;
  }
  const trimmed = hhmm.trim();
  if (!trimmed) {
    return NaN;
  }
  const [hourPart, minutePart = "0"] = trimmed.split(":");
  const rawHour = Number.parseInt(hourPart, 10);
  const rawMinute = Number.parseInt(minutePart, 10);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) {
    return NaN;
  }
  if (rawHour === 24 && rawMinute === 0) {
    return 0;
  }
  const hour = Math.max(0, Math.min(23, rawHour));
  const minute = Math.max(0, Math.min(59, rawMinute));
  return hour * 60 + minute;
};

const POSTS_COLLECTION = "posts";
const COMMENTS_COLLECTION = "comments";

const TEXT_FIELDS = ["title", "content", "body", "summary"];
const POST_LOOKBACK_MINUTES = 720; // 12 hours
const NOTIFICATION_LOOKBACK_MINUTES = 720; // 12 hours
const STATE_BUFFER_MINUTES = 5;
const INITIAL_SCAN_MINUTES = 180;
const MAX_POSTS_TO_SCAN = 60;
const MAX_NOTIFICATIONS_TO_SCAN = 120;
const MIN_ACTION_SPACING_MINUTES = 8;
// Scales response probabilities to keep bots from engaging too frequently.
const GLOBAL_ACTIVITY_RATE = 0.65;
const BOT_DECISION_LOG_SAMPLE_RATE = 0.1;

const mentionRegex = /@([A-Za-z0-9_-]+)/g;

const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") {
    const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanos / 1e6);
  }
  if (typeof value === "number") return value;
  return 0;
};

const extractMentionedUsernames = (text = "") => {
  const mentions = new Set();
  let match;
  while ((match = mentionRegex.exec(text))) {
    mentions.add(match[1].toLowerCase());
  }
  return mentions;
};

const getPostText = (post = {}) =>
  TEXT_FIELDS.map((field) => post[field] ?? "")
    .join(" \n")
    .toLowerCase();

const scoreBotForPost = (bot, postText) => {
  let score = 0;
  const likes = Array.isArray(bot.likes) ? bot.likes : [];
  for (const like of likes) {
    if (like && postText.includes(like.toLowerCase())) {
      score += 1;
    }
  }

  const topicPrefs = bot.topicPreferences || {};
  for (const [topic, weight] of Object.entries(topicPrefs)) {
    if (topic && postText.includes(topic.toLowerCase())) {
      score += Number(weight) || 0.5;
    }
  }

  const dislikes = Array.isArray(bot.dislikes) ? bot.dislikes : [];
  for (const dislike of dislikes) {
    if (dislike && postText.includes(dislike.toLowerCase())) {
      score *= 0.75;
    }
  }

  return score;
};

const getLocalHour = (nowDate, timeZone) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone,
    });
    const formatted = formatter.format(nowDate);
    return Number.parseInt(formatted, 10);
  } catch (error) {
    console.warn?.("Failed to resolve time zone for bot", {
      timeZone,
      error: error.message,
    });
    return nowDate.getUTCHours();
  }
};

const getLocalMinutes = (nowDate, timeZone) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: false,
      timeZone,
    });
    const parts = formatter.formatToParts(nowDate);
    const hour = Number.parseInt(
      parts.find((part) => part.type === "hour")?.value ?? "",
      10
    );
    const minute = Number.parseInt(
      parts.find((part) => part.type === "minute")?.value ?? "",
      10
    );
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return hour * 60 + minute;
    }
  } catch (error) {
    console.warn?.("Failed to resolve minutes for bot", {
      timeZone,
      error: error.message,
    });
  }
  const fallbackHour = getLocalHour(nowDate, timeZone);
  const fallbackMinute = nowDate.getUTCMinutes();
  if (Number.isFinite(fallbackHour) && Number.isFinite(fallbackMinute)) {
    return fallbackHour * 60 + fallbackMinute;
  }
  return nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
};

const parseTimeToMinutes = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0 && value < 24) {
      return Math.round(value * 60);
    }
    if (value >= 0 && value < 1440) {
      return Math.round(value);
    }
    return null;
  }

  if (typeof value === "string") {
    const minutes = parseHHmm(value);
    return Number.isFinite(minutes) ? minutes : null;
  }

  return null;
};

const isMinuteWithinWindow = (value, start, end) => {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return false;
  }

  if (start === end) {
    return false;
  }

  if (start < end) {
    return value >= start && value < end;
  }

  return value >= start || value < end;
};

export const isWithinActiveWindow = (bot = {}, nowDate, window = {}) => {
  if (!window) {
    return false;
  }

  const tz = window.timeZone || resolveBotTimezone(bot);

  let hourPart = 0;
  let minutePart = 0;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });
    const parts = formatter.formatToParts(nowDate);
    hourPart = Number.parseInt(
      parts.find((part) => part.type === "hour")?.value ?? "",
      10
    );
    minutePart = Number.parseInt(
      parts.find((part) => part.type === "minute")?.value ?? "",
      10
    );
  } catch (error) {
    console.warn?.("Failed to format local time for window", {
      error: error.message,
      timeZone: tz,
    });
    hourPart = nowDate.getUTCHours();
    minutePart = nowDate.getUTCMinutes();
  }

  if (!Number.isFinite(hourPart) || !Number.isFinite(minutePart)) {
    return false;
  }

  const localMinutes = hourPart * 60 + minutePart;
  const startMinutes = parseTimeToMinutes(window.start);
  const endMinutes = parseTimeToMinutes(window.end);

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
    return false;
  }

  if (startMinutes === endMinutes) {
    return false;
  }

  if (endMinutes > startMinutes) {
    return localMinutes >= startMinutes && localMinutes < endMinutes;
  }

  return localMinutes >= startMinutes || localMinutes < endMinutes;
};

const isBotActiveNow = (bot = {}, nowDate) => {
  const behavior = bot.behavior || {};
  const activeWindows = Array.isArray(behavior.activeWindows)
    ? behavior.activeWindows
    : null;
  const timeZone = resolveBotTimezone(bot);

  if (activeWindows?.length) {
    let hasValidWindow = false;
    for (const window of activeWindows) {
      const startMinutes = parseTimeToMinutes(window?.start);
      const endMinutes = parseTimeToMinutes(window?.end);
      if (startMinutes === null || endMinutes === null) {
        continue;
      }
      hasValidWindow = true;
      if (
        isWithinActiveWindow(
          bot,
          nowDate,
          window?.timeZone ? window : { ...window, timeZone }
        )
      ) {
        return true;
      }
    }
    return hasValidWindow ? false : true;
  }

  const legacyActiveHours = behavior.activeHours || bot.activeHours || null;

  if (!timeZone || !legacyActiveHours) {
    return true;
  }

  const startMinutes = parseTimeToMinutes(
    legacyActiveHours.startHour ?? legacyActiveHours.start
  );
  const endMinutes = parseTimeToMinutes(
    legacyActiveHours.endHour ?? legacyActiveHours.end
  );
  if (startMinutes === null || endMinutes === null) {
    return true;
  }

  const localMinutes = getLocalMinutes(nowDate, timeZone);
  return isMinuteWithinWindow(localMinutes, startMinutes, endMinutes);
};

const defaultSinceMs = (now, timestamp, fallbackMinutes) => {
  const fallbackMs = now - minutesToMs(fallbackMinutes);
  const valueMs = timestampToMillis(timestamp);
  if (!valueMs) {
    return fallbackMs;
  }
  return Math.min(
    now,
    Math.max(fallbackMs, valueMs - minutesToMs(STATE_BUFFER_MINUTES))
  );
};

const loadActiveBotsWithState = async (db) => {
  const [botSnapshot, runtimeSnapshot] = await Promise.all([
    botProfilesCollection(db).where("isActive", "==", true).get(),
    botRuntimeStateCollection(db).get(),
  ]);

  const runtimeStateByBot = new Map();
  for (const doc of runtimeSnapshot.docs) {
    const state = toBotRuntimeState(doc);
    if (state) {
      runtimeStateByBot.set(state.botId, state);
    }
  }

  const bots = [];
  for (const doc of botSnapshot.docs) {
    const bot = toBotProfile(doc);
    if (bot && bot.behavior) {
      bots.push(bot);
    }
  }

  return { bots, runtimeStateByBot };
};

const fetchRecentPosts = async (db, sinceMs) => {
  const sinceTimestamp = admin.firestore.Timestamp.fromMillis(sinceMs);
  const snapshot = await db
    .collection(POSTS_COLLECTION)
    .where("status", "==", "published")
    .where("createdAt", ">=", sinceTimestamp)
    .orderBy("createdAt", "asc")
    .limit(MAX_POSTS_TO_SCAN)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    const createdAtMs = timestampToMillis(data.createdAt);
    return {
      id: doc.id,
      createdAtMs,
      authorId: data.authorId ?? null,
      title: data.title ?? "",
      content: data.content ?? data.body ?? "",
      summary: data.summary ?? "",
      tags: Array.isArray(data.tags) ? data.tags : [],
      text: getPostText(data),
    };
  });
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchRecentNotifications = async (db, sinceMs) => {
  const sinceTimestamp = admin.firestore.Timestamp.fromMillis(sinceMs);
  const snapshot = await db
    .collectionGroup(COMMENTS_COLLECTION)
    .where("createdAt", ">=", sinceTimestamp)
    .orderBy("createdAt", "asc")
    .limit(MAX_NOTIFICATIONS_TO_SCAN)
    .get();

  const raw = snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      documentPath: doc.ref.path,
      postId: data.postId ?? null,
      authorId: data.authorId ?? null,
      authorName: data.authorName ?? "",
      content: data.content ?? data.text ?? "",
      createdAtMs: timestampToMillis(data.createdAt),
      parentCommentId: data.parentCommentId ?? data.parentId ?? null,
      threadRootCommentId: data.threadRootCommentId ?? null,
      mentions: extractMentionedUsernames(data.content ?? data.text ?? ""),
    };
  });

  const parentIds = Array.from(
    new Set(
      raw
        .map((comment) => comment.parentCommentId)
        .filter((value) => typeof value === "string" && value.length > 0)
    )
  );

  let parentAuthorById = new Map();
  if (parentIds.length) {
    const chunks = chunkArray(parentIds, 10);
    const docs = [];
    for (const chunk of chunks) {
      const snap = await db
        .collectionGroup(COMMENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      docs.push(...snap.docs);
    }
    parentAuthorById = new Map(
      docs.map((snap) => [
        snap.id,
        {
          authorId: snap.get("authorId") ?? null,
          threadRootCommentId:
            snap.get("threadRootCommentId") ?? snap.get("parentCommentId") ?? snap.id,
        },
      ])
    );
  }

  return raw.map((comment) => {
    const parentMeta = comment.parentCommentId
      ? parentAuthorById.get(comment.parentCommentId) ?? {}
      : {};
    return {
      ...comment,
      parentAuthorId: parentMeta.authorId ?? null,
      threadRootCommentId:
        comment.threadRootCommentId ??
        parentMeta.threadRootCommentId ??
        comment.parentCommentId,
    };
  });
};

const choosePostCandidate = (bot, candidates, now) => {
  if (!candidates.length) return null;

  const scored = candidates
    .map((post) => {
      const interest = scoreBotForPost(bot, post.text) + randomFloat(0, 0.5);
      const recencyHours = (now - post.createdAtMs) / minutesToMs(60);
      const recencyBoost = Math.max(0, 2 - recencyHours) * 0.4;
      return {
        post,
        score: interest + recencyBoost,
      };
    })
    .filter(({ score }) => score > 0.1)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return null;
  }

  const topSlice = scored.slice(0, Math.min(3, scored.length));
  return topSlice[Math.floor(Math.random() * topSlice.length)]?.post ?? null;
};

const normalizeActionWeights = (weights = {}) => {
  const normalized = { ...weights };
  if (normalized.likePost === undefined || normalized.likePost === null) {
    const fallbacks = [normalized.likePostOnly, normalized.likeAndComment];
    for (const fallback of fallbacks) {
      if (Number.isFinite(fallback)) {
        normalized.likePost = fallback;
        break;
      }
    }
    if (normalized.likePost === undefined || normalized.likePost === null) {
      normalized.likePost = 0;
    }
  }
  return normalized;
};

const chooseNotificationCandidate = (bot, candidates, now) => {
  if (!candidates.length) return null;

  const scored = candidates
    .map((comment) => {
      let score = 1;
      if (comment.parentAuthorId === bot.uid) {
        score += 0.9;
      }
      if (comment.mentions?.has(bot.userName?.toLowerCase?.() ?? "")) {
        score += 0.6;
      }
      const recencyMinutes = (now - comment.createdAtMs) / minutesToMs(1);
      score += Math.max(0, 1.5 - recencyMinutes / 20);
      score += randomFloat(0, 0.5);
      return { comment, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return null;
  }

  const topSlice = scored.slice(0, Math.min(3, scored.length));
  return topSlice[Math.floor(Math.random() * topSlice.length)]?.comment ?? null;
};

const buildRuntimeUpdate = ({
  now,
  latestPostSeenMs,
  latestNotificationSeenMs,
  lastActionAt,
}) => {
  const update = {};
  if (Number.isFinite(latestPostSeenMs) && latestPostSeenMs > 0) {
    update.lastSeenPostAt = admin.firestore.Timestamp.fromMillis(
      Math.max(now, latestPostSeenMs)
    );
  }
  if (
    Number.isFinite(latestNotificationSeenMs) &&
    latestNotificationSeenMs > 0
  ) {
    update.lastSeenNotificationAt = admin.firestore.Timestamp.fromMillis(
      Math.max(now, latestNotificationSeenMs)
    );
  }
  if (Number.isFinite(lastActionAt) && lastActionAt > 0) {
    update.lastActionScheduledAt = lastActionAt;
  }
  update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  return update;
};

const randomBoolean = (probability) =>
  Math.random() < clamp01(probability ?? 0);

export const runBotActivityForTick = async ({
  bot,
  runtimeState,
  now,
  posts,
  notifications,
}) => {
  const behavior = bot.behavior || {};
  const nowDate = new Date(now);

  const lastSeenPostAtMs = runtimeState
    ? timestampToMillis(runtimeState.lastSeenPostAt)
    : 0;
  const lastSeenNotificationAtMs = runtimeState
    ? timestampToMillis(runtimeState.lastSeenNotificationAt)
    : 0;

  const postWindowSince = defaultSinceMs(
    now,
    runtimeState?.lastSeenPostAt,
    INITIAL_SCAN_MINUTES
  );
  const notificationWindowSince = defaultSinceMs(
    now,
    runtimeState?.lastSeenNotificationAt,
    INITIAL_SCAN_MINUTES
  );

  const postCandidates = posts.filter(
    (post) =>
      post.createdAtMs >= postWindowSince &&
      post.createdAtMs > 0 &&
      post.authorId !== bot.uid
  );

  const botUserNameLower = bot.userName ? bot.userName.toLowerCase() : "";

  const notificationCandidates = notifications.filter((comment) => {
    if (comment.createdAtMs < notificationWindowSince) return false;
    if (comment.authorId === bot.uid) return false;
    const targetsBot =
      comment.parentAuthorId === bot.uid ||
      (botUserNameLower && comment.mentions?.has(botUserNameLower));
    return targetsBot;
  });

  const directReplyCandidates = notificationCandidates.filter(
    (comment) => comment.parentAuthorId === bot.uid
  );

  const latestPostSeenMs = postCandidates.reduce(
    (acc, post) => Math.max(acc, post.createdAtMs),
    lastSeenPostAtMs
  );
  const latestNotificationSeenMs = notificationCandidates.reduce(
    (acc, comment) => Math.max(acc, comment.createdAtMs),
    lastSeenNotificationAtMs
  );

  if (!isBotActiveNow(bot, nowDate)) {
    return {
      status: "offline",
      runtimeUpdate: buildRuntimeUpdate({
        now,
        latestPostSeenMs,
        latestNotificationSeenMs,
        lastActionAt: runtimeState?.lastActionScheduledAt ?? null,
      }),
    };
  }

  const baseResponseProbability = clamp01(
    (behavior.baseResponseProbability ?? 0) * GLOBAL_ACTIVITY_RATE
  );
  const replyResponseProbability = clamp01(
    (behavior.replyResponseProbability ?? behavior.baseResponseProbability ?? 0) *
      GLOBAL_ACTIVITY_RATE
  );

  if (directReplyCandidates.length) {
    if (
      runtimeState?.lastActionScheduledAt &&
      now - runtimeState.lastActionScheduledAt <
        minutesToMs(MIN_ACTION_SPACING_MINUTES)
    ) {
      return {
        status: "cooldown",
        runtimeUpdate: buildRuntimeUpdate({
          now,
          latestPostSeenMs,
          latestNotificationSeenMs,
          lastActionAt: runtimeState.lastActionScheduledAt,
        }),
      };
    }

    const target = chooseNotificationCandidate(bot, directReplyCandidates, now);

    if (target) {
      const delayMs = getDelayFromRange(
        behavior.replyDelayMinutes ?? { min: 2, max: 15 }
      );
      const scheduledAt = now + delayMs;
      const shouldAskQuestion = randomBoolean(behavior.questionProbability);
      const shouldDisagree = randomBoolean(behavior.disagreementProbability);

      const scheduledAction = buildScheduledBotActionPayload(
        ScheduledBotActionType.REPLY_TO_COMMENT,
        {
          botId: bot.uid,
          postId: target.postId,
          scheduledAt,
          parentCommentId: target.id,
          threadRootCommentId: target.threadRootCommentId ?? target.id,
          metadata: {
            mode: "REPLY",
            targetType: "comment",
            shouldAskQuestion,
            intent: shouldDisagree ? "disagree" : "default",
            repliedToBotId: target.parentAuthorId ?? null,
            triggeredByMention: target.mentions?.has(botUserNameLower) ?? false,
            origin: "activity_tick",
          },
        }
      );

      return {
        status: "scheduled",
        scheduledAction,
        runtimeUpdate: buildRuntimeUpdate({
          now,
          latestPostSeenMs,
          latestNotificationSeenMs,
          lastActionAt: scheduledAt,
        }),
      };
    }
  }

  const weights = normalizeActionWeights(behavior.actionWeights || {});
  const weightedActions = {
    commentOnPost:
      postCandidates.length > 0
        ? (weights.commentOnPost ?? 0.4) * baseResponseProbability
        : 0,
    replyToComment:
      notificationCandidates.length > 0
        ? (weights.replyToComment ?? 0.3) * replyResponseProbability
        : 0,
    likePost:
      postCandidates.length > 0
        ? (weights.likePost ?? 0) * baseResponseProbability
        : 0,
    likeComment:
      notificationCandidates.length > 0
        ? (weights.likeComment ?? 0) * replyResponseProbability
        : 0,
    ignore: weights.ignore ?? 1,
  };

  const chosenAction = weightedChoice(weightedActions) || "ignore";

  const runtimeUpdate = buildRuntimeUpdate({
    now,
    latestPostSeenMs,
    latestNotificationSeenMs,
    lastActionAt: runtimeState?.lastActionScheduledAt ?? null,
  });

  if (
    chosenAction !== "ignore" &&
    runtimeState?.lastActionScheduledAt &&
    now - runtimeState.lastActionScheduledAt <
      minutesToMs(MIN_ACTION_SPACING_MINUTES)
  ) {
    return {
      status: "cooldown",
      runtimeUpdate,
    };
  }

  if (chosenAction === "ignore") {
    return {
      status: "ignored",
      runtimeUpdate,
    };
  }

  let scheduledAction = null;
  let lastActionAt = runtimeState?.lastActionScheduledAt ?? null;

  if (chosenAction === "commentOnPost") {
    const target = choosePostCandidate(bot, postCandidates, now);
    if (target) {
      const delayMs = getDelayFromRange(
        behavior.postDelayMinutes ?? { min: 5, max: 20 }
      );
      const scheduledAt = now + delayMs;
      const shouldAskQuestion = randomBoolean(behavior.questionProbability);
      const shouldDisagree = randomBoolean(behavior.disagreementProbability);

      scheduledAction = buildScheduledBotActionPayload(
        ScheduledBotActionType.COMMENT_ON_POST,
        {
          botId: bot.uid,
          postId: target.id,
          scheduledAt,
          metadata: {
            mode: "TOP_LEVEL",
            targetType: "post",
            shouldAskQuestion,
            intent: shouldDisagree ? "disagree" : "default",
            origin: "activity_tick",
          },
        }
      );
      lastActionAt = scheduledAt;
    }
  } else if (chosenAction === "replyToComment") {
    const target = chooseNotificationCandidate(
      bot,
      notificationCandidates,
      now
    );
    if (target) {
      const delayMs = getDelayFromRange(
        behavior.replyDelayMinutes ?? { min: 2, max: 15 }
      );
      const scheduledAt = now + delayMs;
      const shouldAskQuestion = randomBoolean(behavior.questionProbability);
      const shouldDisagree = randomBoolean(behavior.disagreementProbability);

      scheduledAction = buildScheduledBotActionPayload(
        ScheduledBotActionType.REPLY_TO_COMMENT,
        {
          botId: bot.uid,
          postId: target.postId,
          scheduledAt,
          parentCommentId: target.id,
          threadRootCommentId: target.threadRootCommentId ?? target.id,
          metadata: {
            mode: "REPLY",
            targetType: "comment",
            shouldAskQuestion,
            intent: shouldDisagree ? "disagree" : "default",
            repliedToBotId: target.parentAuthorId ?? null,
            triggeredByMention: target.mentions?.has(botUserNameLower) ?? false,
            origin: "activity_tick",
          },
        }
      );
      lastActionAt = scheduledAt;
    }
  } else if (chosenAction === "likePost") {
    const target = choosePostCandidate(bot, postCandidates, now);
    if (target) {
      const delayMs = getDelayFromRange(
        behavior.postDelayMinutes ?? { min: 1, max: 10 }
      );
      const scheduledAt = now + delayMs;
      scheduledAction = buildScheduledBotActionPayload(
        ScheduledBotActionType.LIKE_POST,
        {
          botId: bot.uid,
          postId: target.id,
          scheduledAt,
          metadata: {
            origin: "activity_tick",
          },
        }
      );
      lastActionAt = scheduledAt;
    }
  } else if (chosenAction === "likeComment") {
    const target = chooseNotificationCandidate(
      bot,
      notificationCandidates,
      now
    );
    if (target) {
      const delayMs = getDelayFromRange(
        behavior.replyDelayMinutes ?? { min: 1, max: 5 }
      );
      const scheduledAt = now + delayMs;
      scheduledAction = buildScheduledBotActionPayload(
        ScheduledBotActionType.LIKE_COMMENT,
        {
          botId: bot.uid,
          postId: target.postId,
          scheduledAt,
          parentCommentId: target.id,
          threadRootCommentId: target.threadRootCommentId ?? target.id,
          metadata: {
            origin: "activity_tick",
          },
        }
      );
      lastActionAt = scheduledAt;
    }
  }

  if (scheduledAction) {
    return {
      status: "scheduled",
      scheduledAction,
      runtimeUpdate: buildRuntimeUpdate({
        now,
        latestPostSeenMs,
        latestNotificationSeenMs,
        lastActionAt,
      }),
    };
  }

  return {
    status: "no_target",
    runtimeUpdate,
  };
};

export const runBotActivityTick = async ({ db, now = getNowMs() }) => {
  const nowValue = typeof now === "number" ? now : new Date(now).getTime();

  const { bots, runtimeStateByBot } = await loadActiveBotsWithState(db);
  if (!bots.length) {
    return {
      botsProcessed: 0,
      actionsScheduled: 0,
      breakdown: {
        inactive_window: 0,
        cooldown: 0,
        no_targets: 0,
        below_threshold: 0,
        scheduled: 0,
      },
    };
  }

  const baselinePostSince = nowValue - minutesToMs(POST_LOOKBACK_MINUTES);
  const baselineNotificationSince =
    nowValue - minutesToMs(NOTIFICATION_LOOKBACK_MINUTES);

  const [recentPosts, recentNotifications] = await Promise.all([
    fetchRecentPosts(db, baselinePostSince),
    fetchRecentNotifications(db, baselineNotificationSince),
  ]);

  const batch = db.batch();
  let actionsScheduled = 0;
  let statesUpdated = 0;
  const breakdown = {
    inactive_window: 0,
    cooldown: 0,
    no_targets: 0,
    below_threshold: 0,
    scheduled: 0,
  };
  const statusToReason = {
    offline: "inactive_window",
    cooldown: "cooldown",
    no_target: "no_targets",
    ignored: "below_threshold",
    scheduled: "scheduled",
  };
  const nowIso = new Date(nowValue).toISOString();

  for (const bot of bots) {
    const runtimeState = runtimeStateByBot.get(bot.uid) ?? null;

    const result = await runBotActivityForTick({
      db,
      bot,
      runtimeState,
      now: nowValue,
      posts: recentPosts,
      notifications: recentNotifications,
    });

    const reason = statusToReason[result.status] ?? null;
    if (reason) {
      breakdown[reason] += 1;
      if (Math.random() < BOT_DECISION_LOG_SAMPLE_RATE) {
        const timeZone = resolveBotTimezone(bot);
        console.log(
          JSON.stringify({
            type: "bot_decision",
            botId: bot.uid,
            reason,
            tz: timeZone,
            nowIso,
          })
        );
      }
    }

    const userRef = db.collection("users").doc(bot.uid);
    batch.set(
      userRef,
      {
        isOnline: result.status !== "offline",
      },
      { merge: true }
    );

    const stateRef = botRuntimeStateCollection(db).doc(bot.uid);
    if (result.runtimeUpdate) {
      batch.set(stateRef, result.runtimeUpdate, { merge: true });
      statesUpdated += 1;
    }

    if (result.scheduledAction) {
      const actionRef = scheduledBotActionsCollection(db).doc();
      batch.set(actionRef, result.scheduledAction);
      actionsScheduled += 1;
    }
  }

  if (actionsScheduled > 0 || statesUpdated > 0) {
    await batch.commit();
  }

  return {
    botsProcessed: bots.length,
    actionsScheduled,
    breakdown,
  };
};

// Temporary no-op exports kept for compatibility during migration.
export const schedulePostNotifications = async () => 0;
export const scheduleReplyNotifications = async () => 0;
