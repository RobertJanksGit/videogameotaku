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
const MIN_ACTION_SPACING_MINUTES = 6;
// Scales response probabilities to keep bots from engaging too frequently.
const GLOBAL_ACTIVITY_RATE = 0.65;
const BOT_DECISION_LOG_SAMPLE_RATE = 0.1;
// Top-level comment guardrails to keep bots chatty but not spammy.
const COMMENT_ELIGIBILITY_LOOKBACK_MINUTES = 48 * 60; // 48 hours
const MAX_BOT_COMMENTS_PER_POST = 2;
const MIN_MINUTES_BETWEEN_BOT_COMMENTS_ON_POST = 120;
const BOT_TOP_LEVEL_COMMENT_COOLDOWN_MINUTES = 10;
const BOT_TOP_LEVEL_COMMENTS_PER_HOUR = 2;
const BOT_TOP_LEVEL_COMMENTS_PER_DAY = 5;
const GLOBAL_TOP_LEVEL_COMMENTS_PER_TICK = 2;
const GLOBAL_TOP_LEVEL_COMMENTS_PER_HOUR = 8;
const BOT_META_COLLECTION = "botMeta";
const BOT_COMMENT_ACTIVITY_DOC_ID = "commentActivity";
const SAFE_LOOKBACK_MS = minutesToMs(COMMENT_ELIGIBILITY_LOOKBACK_MINUTES);
const COMMENT_COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes between top-level comments
const LIKE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between likes

const mentionRegex = /@([A-Za-z0-9_-]+)/g;

const numberOrNull = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Check if a bot has already replied to a specific comment and schedule a reply if allowed.
 * This ensures bots reply at most once per comment, regardless of cooldown resets.
 *
 * @param {Object} params
 * @param {import('firebase-admin').firestore.Firestore} params.db
 * @param {BotProfile} params.bot
 * @param {string} params.postId
 * @param {string} params.commentId
 * @param {number} params.nowMs
 * @param {BotRuntimeState} params.runtimeState
 * @param {Object} params.globalCommentState
 * @param {Map} params.threadReplyCounts
 * @param {Object} params.perBotCommentLimits
 * @returns {Promise<{scheduled: boolean, scheduledAction?: Object, lastActionAt?: number}>}
 */
async function maybeScheduleDirectReplyForComment({
  db,
  bot,
  postId,
  commentId,
  nowMs,
  runtimeState,
  globalCommentState,
  threadReplyCounts,
  perBotCommentLimits,
}) {
  // Fetch the comment document to check botRepliesHandled
  const commentRef = db
    .collection(POSTS_COLLECTION)
    .doc(postId)
    .collection(COMMENTS_COLLECTION)
    .doc(commentId);
  const commentSnap = await commentRef.get();

  if (!commentSnap.exists) {
    console.log("bot_reply_candidate_skip", {
      type: "bot_reply_candidate_skip",
      botId: bot.uid,
      postId,
      commentId,
      reason: "comment_not_found",
    });
    return { scheduled: false };
  }

  const commentData = commentSnap.data() || {};
  const botRepliesHandled = commentData.botRepliesHandled || {};

  // Check if this bot has already replied to this comment
  if (botRepliesHandled[bot.id] === true) {
    console.log("bot_reply_candidate_skip", {
      type: "bot_reply_candidate_skip",
      botId: bot.uid,
      postId,
      commentId,
      reason: "already_replied_to_comment",
    });
    return { scheduled: false };
  }

  // Check existing REPLY cooldown
  const lastScheduledActionForCooldown =
    runtimeState?.lastActionScheduledAt &&
    Number.isFinite(runtimeState.lastActionScheduledAt)
      ? Math.min(runtimeState.lastActionScheduledAt, nowMs)
      : null;

  if (
    lastScheduledActionForCooldown &&
    nowMs - lastScheduledActionForCooldown <
      minutesToMs(MIN_ACTION_SPACING_MINUTES)
  ) {
    const cooldownEndsAt =
      lastScheduledActionForCooldown + minutesToMs(MIN_ACTION_SPACING_MINUTES);
    console.log("bot_cooldown_skip", {
      type: "bot_cooldown_skip",
      botId: bot.uid,
      nowIso: new Date(nowMs).toISOString(),
      cooldownEndsAt,
      cooldownMs: minutesToMs(MIN_ACTION_SPACING_MINUTES),
      actionType: "REPLY",
      reason: "direct_reply_spacing",
    });
    return { scheduled: false };
  }

  // Additional safety check: look for existing pending REPLY actions for this bot+commentId
  // This is an extra guard in case botRepliesHandled write failed
  try {
    const existingActionsQuery = scheduledBotActionsCollection(db)
      .where("botId", "==", bot.uid)
      .where("parentCommentId", "==", commentId)
      .where("type", "==", ScheduledBotActionType.REPLY_TO_COMMENT)
      .where("scheduledAt", ">", nowMs - minutesToMs(60 * 24)) // Last 24 hours
      .limit(1);

    const existingActionsSnap = await existingActionsQuery.get();
    if (!existingActionsSnap.empty) {
      console.log("bot_reply_candidate_skip", {
        type: "bot_reply_candidate_skip",
        botId: bot.uid,
        postId,
        commentId,
        reason: "pending_reply_exists",
      });
      return { scheduled: false };
    }
  } catch (error) {
    // Log but don't fail - this is just an extra safety check
    console.warn("Failed to check for existing reply actions", {
      botId: bot.uid,
      commentId,
      error: error?.message || error,
    });
  }

  // Check thread and global caps
  const threadRootCommentId = resolveThreadRootId({
    id: commentId,
    ...commentData,
  });
  const threadStats = threadReplyCounts.get(threadRootCommentId) || {
    count: 0,
    lastAt: 0,
  };
  const perThreadLimit =
    perBotCommentLimits?.perPost ?? MAX_BOT_COMMENTS_PER_POST;
  const threadCapReached =
    perThreadLimit >= 0 && threadStats.count >= perThreadLimit;

  const globalTickLimitReached =
    globalCommentState &&
    numberOrNull(globalCommentState.perTickLimit) !== null &&
    globalCommentState.commentsScheduledThisTick >=
      globalCommentState.perTickLimit;

  const globalHourCapReached =
    globalCommentState &&
    numberOrNull(globalCommentState.perHourLimit) !== null &&
    globalCommentState.hourCount >=
      (globalCommentState.perHourLimit ?? GLOBAL_TOP_LEVEL_COMMENTS_PER_HOUR);

  if (threadCapReached || globalTickLimitReached || globalHourCapReached) {
    console.log("bot_reply_candidate_skip", {
      type: "bot_reply_candidate_skip",
      botId: bot.uid,
      postId,
      commentId,
      reason: threadCapReached
        ? "thread_cap_reached"
        : globalTickLimitReached
        ? "global_cap_reached"
        : "global_hour_cap_reached",
    });
    return { scheduled: false };
  }

  // All checks passed - schedule the reply
  const delayMs = getDelayFromRange(
    bot.behavior?.replyDelayMinutes ?? { min: 2, max: 15 }
  );
  const scheduledAt = nowMs + delayMs;
  const shouldAskQuestion = randomBoolean(bot.behavior?.questionProbability);
  const shouldDisagree = randomBoolean(bot.behavior?.disagreementProbability);
  const plannedActionId = `plan_reply_${bot.uid}_${commentId}_${scheduledAt}`;

  const scheduledAction = buildScheduledBotActionPayload(
    ScheduledBotActionType.REPLY_TO_COMMENT,
    {
      botId: bot.uid,
      postId,
      scheduledAt,
      parentCommentId: commentId,
      threadRootCommentId,
      metadata: {
        mode: "REPLY",
        targetType: "comment",
        shouldAskQuestion,
        intent: shouldDisagree ? "disagree" : "default",
        repliedToBotId: commentData.parentAuthorId ?? null,
        triggeredByMention: (commentData.mentions || new Set()).has(
          bot.userName?.toLowerCase() ?? ""
        ),
        targetCommentId: commentId,
        origin: "activity_tick",
        plannedActionId,
      },
    }
  );

  // Update thread counts
  threadReplyCounts.set(threadRootCommentId, {
    count: (threadStats.count ?? 0) + 1,
    lastAt: Math.max(threadStats.lastAt ?? 0, scheduledAt),
  });

  // Update global state
  if (globalCommentState) {
    globalCommentState.commentsScheduledThisTick =
      (globalCommentState.commentsScheduledThisTick ?? 0) + 1;
    globalCommentState.hourCount = (globalCommentState.hourCount ?? 0) + 1;
    globalCommentState.dayCount = (globalCommentState.dayCount ?? 0) + 1;
    globalCommentState.dirty = true;
  }

  // Mark this comment as handled by this bot
  await commentRef.set(
    {
      botRepliesHandled: {
        ...(commentData.botRepliesHandled || {}),
        [bot.uid]: true,
      },
    },
    { merge: true }
  );

  console.log("bot_reply_planned", {
    botId: bot.uid,
    postId,
    threadRootCommentId,
    targetCommentId: commentId,
    actionId: plannedActionId,
  });

  return {
    scheduled: true,
    scheduledAction,
    lastActionAt: scheduledAt,
  };
}

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

const resolveThreadRootId = (comment = {}) => {
  if (!comment) return null;
  return (
    comment.threadRootCommentId ??
    comment.parentCommentId ??
    comment.parentId ??
    comment.id ??
    null
  );
};

const normalizeCommentWindow = ({
  windowStartMs,
  count,
  windowSizeMs,
  now,
}) => {
  const startMs = numberOrNull(windowStartMs) ?? 0;
  const value = numberOrNull(count) ?? 0;
  if (!startMs || now - startMs >= windowSizeMs || startMs > now) {
    return {
      windowStartMs: now,
      count: 0,
      reset: true,
    };
  }
  return {
    windowStartMs: startMs,
    count: Math.max(0, value),
    reset: false,
  };
};

const normalizeBotCommentState = (rawStats = {}, now) => {
  const hourWindow = normalizeCommentWindow({
    windowStartMs: rawStats.hourWindowStartMs ?? rawStats.hourWindowStart,
    count: rawStats.hourCount,
    windowSizeMs: minutesToMs(60),
    now,
  });
  const dayWindow = normalizeCommentWindow({
    windowStartMs: rawStats.dayWindowStartMs ?? rawStats.dayWindowStart,
    count: rawStats.dayCount,
    windowSizeMs: minutesToMs(24 * 60),
    now,
  });
  return {
    state: {
      hourWindowStartMs: hourWindow.windowStartMs,
      hourCount: hourWindow.count,
      dayWindowStartMs: dayWindow.windowStartMs,
      dayCount: dayWindow.count,
      lastTopLevelCommentAt:
        numberOrNull(rawStats.lastTopLevelCommentAt) ?? null,
    },
    dirty: hourWindow.reset || dayWindow.reset,
  };
};

const normalizeGlobalCommentState = (raw = {}, now) => {
  const normalized = normalizeBotCommentState(raw, now);
  return {
    state: {
      ...normalized.state,
      perTickLimit:
        numberOrNull(raw.perTickLimit) ?? GLOBAL_TOP_LEVEL_COMMENTS_PER_TICK,
      perHourLimit:
        numberOrNull(raw.perHourLimit) ?? GLOBAL_TOP_LEVEL_COMMENTS_PER_HOUR,
      commentsScheduledThisTick: 0,
    },
    dirty: normalized.dirty,
  };
};

const summarizeBotCommentsByPost = (comments = [], botIds = new Set()) => {
  const perPost = new Map();
  const perThread = new Map();
  for (const comment of comments) {
    if (!comment?.postId || !botIds.has?.(comment.authorId)) continue;
    const existing = perPost.get(comment.postId) || {
      count: 0,
      lastAt: 0,
      topLevelCount: 0,
      lastTopLevelAt: 0,
    };
    existing.count += 1;
    existing.lastAt = Math.max(existing.lastAt, comment.createdAtMs || 0);
    if (!comment.parentCommentId) {
      existing.topLevelCount += 1;
      existing.lastTopLevelAt = Math.max(
        existing.lastTopLevelAt,
        comment.createdAtMs || 0
      );
    }
    perPost.set(comment.postId, existing);

    const threadRootId = resolveThreadRootId(comment);
    if (threadRootId) {
      const threadStats = perThread.get(threadRootId) || {
        count: 0,
        lastAt: 0,
      };
      threadStats.count += 1;
      threadStats.lastAt = Math.max(
        threadStats.lastAt,
        comment.createdAtMs || 0
      );
      perThread.set(threadRootId, threadStats);
    }
  }
  return {
    perPost,
    perThread,
  };
};

const canBotLeaveTopLevelCommentOnPost = ({
  bot: _bot, // eslint-disable-line no-unused-vars
  post,
  botCommentState,
  recentBotActivity,
  globalCommentState,
  commentLimits,
  now,
}) => {
  const commentState = botCommentState?.state ?? botCommentState ?? {};
  const postAgeMinutes = (now - (post.createdAtMs || 0)) / minutesToMs(1);
  if (postAgeMinutes > COMMENT_ELIGIBILITY_LOOKBACK_MINUTES) {
    return { eligible: false, reason: "post_too_old" };
  }

  const perPost = recentBotActivity?.perPost?.get(post.id) ?? {
    count: 0,
    topLevelCount: 0,
    lastTopLevelAt: 0,
  };
  if (
    perPost.topLevelCount >=
    (commentLimits?.perPost ?? MAX_BOT_COMMENTS_PER_POST)
  ) {
    return { eligible: false, reason: "too_many_bot_comments" };
  }
  if (
    perPost.lastTopLevelAt &&
    now - perPost.lastTopLevelAt <
      minutesToMs(MIN_MINUTES_BETWEEN_BOT_COMMENTS_ON_POST)
  ) {
    return { eligible: false, reason: "recent_bot_comment" };
  }

  if (
    globalCommentState &&
    numberOrNull(globalCommentState.perTickLimit) !== null &&
    globalCommentState.commentsScheduledThisTick >=
      globalCommentState.perTickLimit
  ) {
    return { eligible: false, reason: "global_cap_reached" };
  }

  if (
    globalCommentState &&
    numberOrNull(globalCommentState.perHourLimit) !== null &&
    globalCommentState.hourCount >=
      (globalCommentState.perHourLimit ?? GLOBAL_TOP_LEVEL_COMMENTS_PER_HOUR)
  ) {
    return { eligible: false, reason: "global_hour_cap_reached" };
  }

  const hourlyLimit = commentLimits?.perHour ?? BOT_TOP_LEVEL_COMMENTS_PER_HOUR;
  const dailyLimit = commentLimits?.perDay ?? BOT_TOP_LEVEL_COMMENTS_PER_DAY;
  if (hourlyLimit >= 0 && commentState.hourCount >= hourlyLimit) {
    return { eligible: false, reason: "bot_hourly_cap" };
  }
  if (dailyLimit >= 0 && commentState.dayCount >= dailyLimit) {
    return { eligible: false, reason: "bot_daily_cap" };
  }
  if (
    commentState.lastTopLevelCommentAt &&
    now - commentState.lastTopLevelCommentAt <
      minutesToMs(BOT_TOP_LEVEL_COMMENT_COOLDOWN_MINUTES)
  ) {
    return { eligible: false, reason: "cooldown" };
  }

  return { eligible: true, reason: "eligible" };
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

const loadGlobalCommentActivityState = async (db, now) => {
  const ref = db
    .collection(BOT_META_COLLECTION)
    .doc(BOT_COMMENT_ACTIVITY_DOC_ID);
  try {
    const snap = await ref.get();
    const raw = snap?.exists ? snap.data() || {} : {};
    const normalized = normalizeGlobalCommentState(raw, now);
    return { ref, ...normalized.state, dirty: normalized.dirty };
  } catch (error) {
    console.warn?.("Failed to load global bot comment activity state", {
      message: error?.message || error,
    });
    const fallback = normalizeGlobalCommentState({}, now);
    return { ref, ...fallback.state, dirty: true };
  }
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

const hydrateNotificationsWithParents = async (db, comments) => {
  const parentCache = new Map();
  const needsLookup = comments.filter(
    (comment) =>
      comment.postId &&
      comment.parentCommentId &&
      (!comment.parentAuthorId || !comment.threadRootCommentId)
  );

  const fetchParent = async (comment) => {
    if (!comment?.postId || !comment?.parentCommentId) return;
    const cacheKey = `${comment.postId}::${comment.parentCommentId}`;
    if (parentCache.has(cacheKey)) return;
    try {
      const snap = await db
        .collection(POSTS_COLLECTION)
        .doc(comment.postId)
        .collection(COMMENTS_COLLECTION)
        .doc(comment.parentCommentId)
        .get();
      if (snap?.exists) {
        parentCache.set(cacheKey, {
          id: snap.id,
          ...snap.data(),
        });
      }
    } catch (error) {
      console.warn("Failed to load parent comment for notification", {
        postId: comment.postId,
        parentCommentId: comment.parentCommentId,
        error: error?.message || error,
      });
    }
  };

  for (const chunk of chunkArray(needsLookup, 20)) {
    // Parallelize lookups while keeping batch sizes small to avoid hammering Firestore.
    await Promise.all(chunk.map(fetchParent));
  }

  return comments.map((comment) => {
    const cacheKey = `${comment.postId}::${comment.parentCommentId}`;
    const parent = parentCache.get(cacheKey);
    const parentAuthorId = comment.parentAuthorId ?? parent?.authorId ?? null;
    const parentAuthorIsBot =
      comment.parentAuthorIsBot ??
      (parent ? Boolean(parent.isBotAuthor) : null);
    const parentAuthorBotId =
      comment.parentAuthorBotId ?? (parentAuthorIsBot ? parentAuthorId : null);
    const resolvedThreadRoot =
      comment.threadRootCommentId ??
      parent?.threadRootCommentId ??
      resolveThreadRootId(comment);

    return {
      ...comment,
      parentAuthorId,
      parentAuthorBotId,
      parentAuthorIsBot,
      threadRootCommentId: resolvedThreadRoot,
    };
  });
};

// Fetch comment-based notifications from the comments collection group.
// Time filter: prefers Firestore Timestamp in "createdAt"; falls back to a numeric ms
// query if the field was stored as a number. Includes a safe fallback window on first
// run to avoid skipping recent items when the watermark is unset.
const fetchRecentNotifications = async (db, sinceMs) => {
  const nowMs = getNowMs();
  const fallbackSinceMs = nowMs - minutesToMs(INITIAL_SCAN_MINUTES);
  let normalizedSinceMs = Number.isFinite(sinceMs) ? sinceMs : fallbackSinceMs;
  if (normalizedSinceMs > nowMs) {
    normalizedSinceMs = fallbackSinceMs;
  }
  if (!Number.isFinite(normalizedSinceMs) || normalizedSinceMs < 0) {
    normalizedSinceMs = fallbackSinceMs;
  }
  const sinceTimestamp = admin.firestore.Timestamp.fromMillis(
    Math.max(0, normalizedSinceMs)
  );

  console.log("fetchRecentNotifications query", {
    collection: `collectionGroup(${COMMENTS_COLLECTION})`,
    providedSinceMs: sinceMs,
    normalizedSinceMs,
    sinceTimestampIso: sinceTimestamp.toDate().toISOString(),
  });

  try {
    let snapshot = await db
      .collectionGroup(COMMENTS_COLLECTION)
      .where("createdAt", ">=", sinceTimestamp)
      .orderBy("createdAt", "asc")
      .limit(MAX_NOTIFICATIONS_TO_SCAN)
      .get();
    let querySource = "createdAt_timestamp";

    if (snapshot.size === 0) {
      // Fallback for cases where createdAt is stored as a number (ms) instead of a Firestore Timestamp.
      try {
        const numericSnapshot = await db
          .collectionGroup(COMMENTS_COLLECTION)
          .where("createdAt", ">=", normalizedSinceMs)
          .orderBy("createdAt", "asc")
          .limit(MAX_NOTIFICATIONS_TO_SCAN)
          .get();
        if (numericSnapshot.size > 0) {
          snapshot = numericSnapshot;
          querySource = "createdAt_number_ms";
        }
        console.log("fetchRecentNotifications numeric fallback", {
          size: numericSnapshot.size,
          normalizedSinceMs,
          sinceTimestampIso: sinceTimestamp.toDate().toISOString(),
        });
      } catch (fallbackError) {
        console.warn("fetchRecentNotifications numeric fallback failed", {
          error: fallbackError?.message || fallbackError,
          code: fallbackError?.code,
        });
      }
    }

    console.log("fetchRecentNotifications snapshot", {
      size: snapshot.size,
      normalizedSinceMs,
      sinceTimestampIso: sinceTimestamp.toDate().toISOString(),
      querySource,
    });
    const sampleDocs = snapshot.docs.slice(0, 2).map((doc) => {
      const data = doc.data() || {};
      const createdAtRaw = data.createdAt;
      return {
        id: doc.id,
        createdAt: createdAtRaw,
        createdAtType: {
          instanceOfTimestamp:
            createdAtRaw instanceof admin.firestore.Timestamp,
          hasToMillis: typeof createdAtRaw?.toMillis === "function",
          typeof: typeof createdAtRaw,
        },
        createdAtMs: timestampToMillis(createdAtRaw),
      };
    });
    if (sampleDocs.length) {
      console.log("fetchRecentNotifications samples", sampleDocs);
    }

    const raw = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const contentText = data.content ?? data.text ?? "";
      const authorIsBot = Boolean(
        data.isBotAuthor ?? data.authorIsBot ?? data.author?.isBot
      );
      const parentAuthorId = data.parentAuthorId ?? data.parentUserId ?? null;
      const parentAuthorIsBot = data.parentIsBotAuthor ?? null;
      const parentAuthorBotId =
        data.parentAuthorBotId ?? (parentAuthorIsBot ? parentAuthorId : null);
      return {
        id: doc.id,
        documentPath: doc.ref.path,
        postId: data.postId ?? null,
        authorId: data.authorId ?? null,
        authorName: data.authorName ?? "",
        authorIsBot,
        content: contentText,
        createdAtMs: timestampToMillis(data.createdAt),
        parentCommentId: data.parentCommentId ?? data.parentId ?? null,
        parentAuthorId,
        parentAuthorBotId: parentAuthorBotId ?? null,
        parentAuthorIsBot,
        threadRootCommentId: data.threadRootCommentId ?? null,
        mentions: extractMentionedUsernames(contentText),
      };
    });

    const hydrated = await hydrateNotificationsWithParents(db, raw);

    return hydrated.map((comment) => ({
      ...comment,
      threadRootCommentId:
        comment.threadRootCommentId ?? resolveThreadRootId(comment),
    }));
  } catch (error) {
    console.error("fetchRecentNotifications failed", {
      sinceMs,
      normalizedSinceMs,
      sinceTimestampIso: sinceTimestamp.toDate().toISOString(),
      error: error?.message || error,
      code: error?.code,
      stack: error?.stack,
    });
    return [];
  }
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
  topLevelCommentStats = null,
}) => {
  const update = {};
  if (Number.isFinite(latestPostSeenMs) && latestPostSeenMs > 0) {
    update.lastSeenPostAt = admin.firestore.Timestamp.fromMillis(
      // Clamp to avoid jumping the watermark forward to "now" when no posts were seen.
      Math.min(now, latestPostSeenMs)
    );
  }
  if (
    Number.isFinite(latestNotificationSeenMs) &&
    latestNotificationSeenMs > 0
  ) {
    update.lastSeenNotificationAt = admin.firestore.Timestamp.fromMillis(
      // Same treatment for notifications to prevent skipping older items.
      Math.min(now, latestNotificationSeenMs)
    );
  }
  if (Number.isFinite(lastActionAt) && lastActionAt > 0) {
    update.lastActionScheduledAt = lastActionAt;
  }
  if (topLevelCommentStats) {
    update.topLevelCommentStats = {
      hourWindowStartMs: topLevelCommentStats.hourWindowStartMs,
      hourCount: topLevelCommentStats.hourCount,
      dayWindowStartMs: topLevelCommentStats.dayWindowStartMs,
      dayCount: topLevelCommentStats.dayCount,
      lastTopLevelCommentAt: topLevelCommentStats.lastTopLevelCommentAt ?? null,
    };
  }
  update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  return update;
};

const randomBoolean = (probability) =>
  Math.random() < clamp01(probability ?? 0);

export const runBotActivityForTick = async ({
  db,
  bot,
  runtimeState,
  now,
  posts,
  notifications,
  recentBotCommentSummary = null,
  globalCommentState = null,
  commentLimits: commentLimitOverrides = null,
}) => {
  const behavior = bot.behavior || {};
  const nowDate = new Date(now);
  const nowIso = nowDate.toISOString();

  const { state: botCommentState, dirty: botCommentStateDirtyStart } =
    normalizeBotCommentState(runtimeState?.topLevelCommentStats, now);
  let botCommentStateDirty = botCommentStateDirtyStart;

  const perBotCommentLimits = {
    perHour:
      commentLimitOverrides?.perHour ??
      behavior?.commentLimits?.perHour ??
      BOT_TOP_LEVEL_COMMENTS_PER_HOUR,
    perDay:
      commentLimitOverrides?.perDay ??
      behavior?.commentLimits?.perDay ??
      BOT_TOP_LEVEL_COMMENTS_PER_DAY,
    perPost:
      commentLimitOverrides?.perPost ??
      behavior?.commentLimits?.perPost ??
      behavior?.maxCommentsPerPost ??
      MAX_BOT_COMMENTS_PER_POST,
  };

  const threadReplyCounts = new Map(
    recentBotCommentSummary?.perThread
      ? Array.from(recentBotCommentSummary.perThread.entries())
      : []
  );

  const botCommentActivity =
    recentBotCommentSummary ||
    summarizeBotCommentsByPost(
      notifications,
      new Set([bot.uid]) // fallback only knows about the current bot
    );

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

  let postCandidates = posts.filter(
    (post) =>
      post.createdAtMs >= postWindowSince &&
      post.createdAtMs > 0 &&
      post.authorId !== bot.uid
  );
  let effectivePostSince = postWindowSince;

  const botUserNameLower = bot.userName ? bot.userName.toLowerCase() : "";

  const buildNotificationBuckets = (windowStartMs) => {
    const notificationList = [];
    const replyList = [];
    for (const comment of notifications) {
      if (comment.createdAtMs < windowStartMs) continue;
      if (comment.authorId === bot.uid) continue;
      const parentAuthorMatchesBot =
        comment.parentAuthorBotId === bot.uid ||
        comment.parentAuthorId === bot.uid;
      const mentionsBot =
        botUserNameLower && comment.mentions?.has(botUserNameLower);
      const targetsBot = parentAuthorMatchesBot || mentionsBot;
      if (!targetsBot) continue;
      const normalized = {
        ...comment,
        threadRootCommentId: resolveThreadRootId(comment),
      };
      notificationList.push(normalized);
      const isReply = Boolean(normalized.parentCommentId);
      const isHumanAuthor = normalized.authorIsBot === false;
      if (isReply && parentAuthorMatchesBot && isHumanAuthor) {
        replyList.push(normalized);
        console.log("bot_reply_candidate", {
          botId: bot.uid,
          postId: normalized.postId,
          commentId: normalized.id,
          parentCommentId: normalized.parentCommentId,
          reason: "human_reply_to_bot",
        });
      }
    }
    return { notificationList, replyList };
  };

  let { notificationList: notificationCandidates, replyList: replyCandidates } =
    buildNotificationBuckets(notificationWindowSince);

  // If the window start is ahead of the newest post/notification we fetched,
  // fallback to a recent window so bots can catch up after long downtime or
  // a bad watermark.
  const newestPostMs = posts.reduce(
    (acc, post) => Math.max(acc, post.createdAtMs || 0),
    0
  );
  if (
    !postCandidates.length &&
    newestPostMs > 0 &&
    postWindowSince - newestPostMs > minutesToMs(STATE_BUFFER_MINUTES)
  ) {
    let fallbackSince = Math.max(
      now - minutesToMs(INITIAL_SCAN_MINUTES),
      newestPostMs - minutesToMs(STATE_BUFFER_MINUTES)
    );
    if (fallbackSince > newestPostMs) {
      fallbackSince = Math.max(0, newestPostMs - SAFE_LOOKBACK_MS);
    }
    effectivePostSince = fallbackSince;
    postCandidates = posts.filter(
      (post) =>
        post.createdAtMs >= effectivePostSince &&
        post.createdAtMs > 0 &&
        post.authorId !== bot.uid
    );
    console.log(
      JSON.stringify({
        type: "bot_resync_window",
        target: "posts",
        botId: bot.uid,
        windowSince: postWindowSince,
        fallbackSince: effectivePostSince,
        newest: newestPostMs,
      })
    );
  }

  const newestNotificationMs = notifications.reduce(
    (acc, comment) => Math.max(acc, comment.createdAtMs || 0),
    0
  );
  if (
    !notificationCandidates.length &&
    newestNotificationMs > 0 &&
    notificationWindowSince - newestNotificationMs >
      minutesToMs(STATE_BUFFER_MINUTES)
  ) {
    const fallbackSince = Math.max(
      now - minutesToMs(INITIAL_SCAN_MINUTES),
      newestNotificationMs - minutesToMs(STATE_BUFFER_MINUTES)
    );
    const fallbackBuckets = buildNotificationBuckets(fallbackSince);
    notificationCandidates = fallbackBuckets.notificationList;
    replyCandidates = fallbackBuckets.replyList;
    console.log(
      JSON.stringify({
        type: "bot_resync_window",
        target: "notifications",
        botId: bot.uid,
        windowSince: notificationWindowSince,
        fallbackSince,
        newest: newestNotificationMs,
      })
    );
  }

  // Top-level comment eligibility: recent posts only, respect per-post bot limits,
  // per-bot hourly/daily caps, per-post cooldowns, and global caps.
  const commentCandidates = [];
  for (const post of postCandidates) {
    const evaluation = canBotLeaveTopLevelCommentOnPost({
      bot,
      post,
      botCommentState,
      recentBotActivity: botCommentActivity,
      globalCommentState,
      commentLimits: perBotCommentLimits,
      now,
    });
    console.log(
      JSON.stringify({
        type: "bot_comment_candidate",
        botId: bot.uid,
        postId: post.id,
        reason: evaluation.reason,
        nowIso,
      })
    );
    if (evaluation.eligible) {
      commentCandidates.push(post);
    }
  }

  const latestPostSeenMs = postCandidates.reduce(
    (acc, post) => Math.max(acc, post.createdAtMs),
    lastSeenPostAtMs
  );
  const latestNotificationSeenMs = notificationCandidates.reduce(
    (acc, comment) => Math.max(acc, comment.createdAtMs),
    lastSeenNotificationAtMs
  );

  const commentStatsForUpdate = () =>
    botCommentStateDirty ? botCommentState : null;
  const eligiblePostsCount = commentCandidates.length;
  const lastScheduledActionForCooldown =
    runtimeState?.lastActionScheduledAt &&
    Number.isFinite(runtimeState.lastActionScheduledAt)
      ? Math.min(runtimeState.lastActionScheduledAt, now)
      : null;

  if (!isBotActiveNow(bot, nowDate)) {
    return {
      status: "offline",
      eligiblePosts: eligiblePostsCount,
      effectivePostSince,
      eligibleCommentPosts: commentCandidates,
      runtimeUpdate: buildRuntimeUpdate({
        now,
        latestPostSeenMs,
        latestNotificationSeenMs,
        lastActionAt: runtimeState?.lastActionScheduledAt ?? null,
        topLevelCommentStats: commentStatsForUpdate(),
      }),
    };
  }

  const baseResponseProbability = clamp01(
    (behavior.baseResponseProbability ?? 0.35) * GLOBAL_ACTIVITY_RATE
  );
  const replyResponseProbability = clamp01(
    behavior.replyResponseProbability ?? 0.7
  );
  const replyResponseRate = clamp01(
    replyResponseProbability *
      (Number.isFinite(behavior.replyResponseProbability)
        ? 1
        : GLOBAL_ACTIVITY_RATE)
  );

  // Process direct replies to human comments on bot posts
  if (replyCandidates.length) {
    // Process each reply candidate individually through the helper function
    // Each bot gets at most one reply per human comment, regardless of cooldown resets
    for (const replyCandidate of replyCandidates) {
      const result = await maybeScheduleDirectReplyForComment({
        db,
        bot,
        postId: replyCandidate.postId,
        commentId: replyCandidate.id,
        nowMs: now,
        runtimeState,
        globalCommentState,
        threadReplyCounts,
        perBotCommentLimits,
      });

      if (result.scheduled) {
        // Successfully scheduled a reply - return immediately
        return {
          status: "scheduled",
          scheduledAction: result.scheduledAction,
          eligiblePosts: eligiblePostsCount,
          effectivePostSince,
          runtimeUpdate: buildRuntimeUpdate({
            now,
            latestPostSeenMs,
            latestNotificationSeenMs,
            lastActionAt: result.lastActionAt,
            topLevelCommentStats: commentStatsForUpdate(),
          }),
        };
      }
    }
  }

  const weights = normalizeActionWeights(behavior.actionWeights || {});
  const weightedActions = {
    commentOnPost:
      commentCandidates.length > 0
        ? (weights.commentOnPost ?? 0.25) * baseResponseProbability
        : 0,
    replyToComment:
      notificationCandidates.length > 0
        ? (weights.replyToComment ?? 0.3) * replyResponseRate
        : 0,
    likePost:
      postCandidates.length > 0
        ? (weights.likePost ?? 0.5) * baseResponseProbability
        : 0,
    likeComment:
      notificationCandidates.length > 0
        ? (weights.likeComment ?? 0.1) * replyResponseRate
        : 0,
    ignore: weights.ignore ?? (commentCandidates.length > 0 ? 0.25 : 1),
  };

  const chosenAction = weightedChoice(weightedActions) || "ignore";

  if (commentCandidates.length && chosenAction !== "commentOnPost") {
    console.log(
      JSON.stringify({
        type: "bot_comment_candidate",
        botId: bot.uid,
        postId: commentCandidates[0].id,
        reason: "comment_probability_miss",
        nowIso,
      })
    );
  }

  const postScanReason =
    commentCandidates.length === 0
      ? "no_eligible_posts"
      : chosenAction === "ignore"
      ? "no_action_chosen_after_probability"
      : "action_chosen";
  console.log(
    JSON.stringify({
      type: "bot_post_scan_result",
      botId: bot.uid,
      nowIso,
      totalPosts: posts.length,
      eligiblePosts: commentCandidates.length,
      sinceMsUsed: effectivePostSince,
      reason: postScanReason,
    })
  );

  const runtimeUpdate = buildRuntimeUpdate({
    now,
    latestPostSeenMs,
    latestNotificationSeenMs,
    lastActionAt: runtimeState?.lastActionScheduledAt ?? null,
    topLevelCommentStats: commentStatsForUpdate(),
  });

  if (chosenAction !== "ignore") {
    const lastActionAt = lastScheduledActionForCooldown;
    let cooldownMs = minutesToMs(MIN_ACTION_SPACING_MINUTES);
    if (chosenAction === "commentOnPost") {
      cooldownMs = COMMENT_COOLDOWN_MS;
    } else if (chosenAction === "likePost" || chosenAction === "likeComment") {
      cooldownMs = LIKE_COOLDOWN_MS;
    }
    if (lastActionAt && now - lastActionAt < cooldownMs) {
      const cooldownEndsAt = lastActionAt + cooldownMs;
      console.log(
        JSON.stringify({
          type: "bot_cooldown_skip",
          botId: bot.uid,
          nowIso,
          cooldownEndsAt,
          cooldownMs,
          actionType:
            chosenAction === "commentOnPost"
              ? "COMMENT"
              : chosenAction === "likePost" || chosenAction === "likeComment"
              ? "LIKE"
              : "OTHER",
          reason: "action_spacing",
        })
      );
      return {
        status: "cooldown",
        runtimeUpdate,
      };
    }
  }

  if (chosenAction === "ignore") {
    return {
      status: "ignored",
      eligiblePosts: eligiblePostsCount,
      effectivePostSince,
      eligibleCommentPosts: commentCandidates,
      runtimeUpdate,
    };
  }

  let scheduledAction = null;
  let lastActionAt = runtimeState?.lastActionScheduledAt ?? null;

  if (chosenAction === "commentOnPost") {
    const target = choosePostCandidate(bot, commentCandidates, now);
    if (target) {
      const delayMs = getDelayFromRange(
        behavior.postDelayMinutes ?? { min: 5, max: 20 }
      );
      const scheduledAt = now + delayMs;
      const shouldAskQuestion = randomBoolean(behavior.questionProbability);
      const shouldDisagree = randomBoolean(behavior.disagreementProbability);
      const plannedActionId = `plan_${bot.uid}_${target.id}_${scheduledAt}`;

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
            plannedActionId,
          },
        }
      );
      botCommentState.hourCount += 1;
      botCommentState.dayCount += 1;
      botCommentState.lastTopLevelCommentAt = scheduledAt;
      botCommentStateDirty = true;
      if (globalCommentState) {
        globalCommentState.commentsScheduledThisTick =
          (globalCommentState.commentsScheduledThisTick ?? 0) + 1;
        globalCommentState.hourCount = (globalCommentState.hourCount ?? 0) + 1;
        globalCommentState.dayCount = (globalCommentState.dayCount ?? 0) + 1;
        globalCommentState.dirty = true;
      }
      console.log(
        JSON.stringify({
          type: "bot_comment_planned",
          botId: bot.uid,
          postId: target.id,
          actionId: plannedActionId,
          nowIso,
          cooldownEndsAt: scheduledAt + COMMENT_COOLDOWN_MS,
        })
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
      const threadRootCommentId = resolveThreadRootId(target);
      const threadStats = threadReplyCounts.get(threadRootCommentId) || {
        count: 0,
        lastAt: 0,
      };
      const perThreadLimit =
        perBotCommentLimits?.perPost ?? MAX_BOT_COMMENTS_PER_POST;
      const threadCapReached =
        perThreadLimit >= 0 && threadStats.count >= perThreadLimit;
      const globalTickLimitReached =
        globalCommentState &&
        numberOrNull(globalCommentState.perTickLimit) !== null &&
        globalCommentState.commentsScheduledThisTick >=
          globalCommentState.perTickLimit;
      const globalHourCapReached =
        globalCommentState &&
        numberOrNull(globalCommentState.perHourLimit) !== null &&
        globalCommentState.hourCount >=
          (globalCommentState.perHourLimit ??
            GLOBAL_TOP_LEVEL_COMMENTS_PER_HOUR);

      const delayMs = getDelayFromRange(
        behavior.replyDelayMinutes ?? { min: 2, max: 15 }
      );
      const scheduledAt = now + delayMs;
      const shouldAskQuestion = randomBoolean(behavior.questionProbability);
      const shouldDisagree = randomBoolean(behavior.disagreementProbability);
      const plannedActionId = `plan_reply_${bot.uid}_${target.id}_${scheduledAt}`;

      if (
        !threadCapReached &&
        !globalTickLimitReached &&
        !globalHourCapReached
      ) {
        scheduledAction = buildScheduledBotActionPayload(
          ScheduledBotActionType.REPLY_TO_COMMENT,
          {
            botId: bot.uid,
            postId: target.postId,
            scheduledAt,
            parentCommentId: target.id,
            threadRootCommentId,
            metadata: {
              mode: "REPLY",
              targetType: "comment",
              shouldAskQuestion,
              intent: shouldDisagree ? "disagree" : "default",
              repliedToBotId: target.parentAuthorId ?? null,
              triggeredByMention:
                target.mentions?.has(botUserNameLower) ?? false,
              targetCommentId: target.id,
              origin: "activity_tick",
              plannedActionId,
            },
          }
        );
        threadReplyCounts.set(threadRootCommentId, {
          count: (threadStats.count ?? 0) + 1,
          lastAt: Math.max(threadStats.lastAt ?? 0, scheduledAt),
        });
        if (globalCommentState) {
          globalCommentState.commentsScheduledThisTick =
            (globalCommentState.commentsScheduledThisTick ?? 0) + 1;
          globalCommentState.hourCount =
            (globalCommentState.hourCount ?? 0) + 1;
          globalCommentState.dayCount = (globalCommentState.dayCount ?? 0) + 1;
          globalCommentState.dirty = true;
        }
        console.log("bot_reply_planned", {
          botId: bot.uid,
          postId: target.postId,
          threadRootCommentId,
          targetCommentId: target.id,
          actionId: plannedActionId,
        });
        lastActionAt = scheduledAt;
      }
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
      console.log(
        JSON.stringify({
          type: "bot_like_planned",
          botId: bot.uid,
          postId: target.id,
          actionId: `plan_${bot.uid}_${target.id}_${scheduledAt}_like`,
          nowIso,
          cooldownEndsAt: scheduledAt + LIKE_COOLDOWN_MS,
        })
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
        topLevelCommentStats: commentStatsForUpdate(),
      }),
      eligiblePosts: eligiblePostsCount,
      effectivePostSince,
      eligibleCommentPosts: commentCandidates,
    };
  }

  return {
    status: "no_target",
    eligiblePosts: eligiblePostsCount,
    effectivePostSince,
    eligibleCommentPosts: commentCandidates,
    runtimeUpdate,
  };
};

export const runBotActivityTick = async ({ db, now = getNowMs() }) => {
  const nowValue = typeof now === "number" ? now : new Date(now).getTime();
  const nowIso = new Date(nowValue).toISOString();

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
  console.log("Bot activity inputs loaded", {
    nowIso,
    bots: bots.length,
    postsFetched: recentPosts.length,
    notificationsFetched: recentNotifications.length,
  });

  const botIdSet = new Set(bots.map((bot) => bot.uid));
  const recentBotCommentSummary = summarizeBotCommentsByPost(
    recentNotifications,
    botIdSet
  );
  const globalCommentState = await loadGlobalCommentActivityState(db, nowValue);

  const batch = db.batch();
  let actionsScheduled = 0;
  let statesUpdated = 0;
  let metaUpdated = false;
  let commentsScheduled = 0;
  let likesScheduled = 0;
  let eligiblePostsTotal = 0;
  const eligiblePostsPerBot = {};
  const forcedCommentCandidates = [];
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

  for (const bot of bots) {
    const runtimeState = runtimeStateByBot.get(bot.uid) ?? null;

    const result = await runBotActivityForTick({
      db,
      bot,
      runtimeState,
      now: nowValue,
      posts: recentPosts,
      notifications: recentNotifications,
      recentBotCommentSummary,
      globalCommentState,
    });

    if (typeof result.eligiblePosts === "number") {
      eligiblePostsTotal += result.eligiblePosts;
      eligiblePostsPerBot[bot.uid] = result.eligiblePosts;
    }
    if (
      Array.isArray(result.eligibleCommentPosts) &&
      result.eligibleCommentPosts.length
    ) {
      forcedCommentCandidates.push({
        bot,
        runtimeState,
        posts: result.eligibleCommentPosts,
      });
    }

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
      if (
        result.scheduledAction.type === ScheduledBotActionType.COMMENT_ON_POST
      ) {
        commentsScheduled += 1;
      } else if (
        result.scheduledAction.type === ScheduledBotActionType.LIKE_POST ||
        result.scheduledAction.type === ScheduledBotActionType.LIKE_COMMENT
      ) {
        likesScheduled += 1;
      }
    }
  }

  if (commentsScheduled === 0 && forcedCommentCandidates.length > 0) {
    const forcedPick =
      forcedCommentCandidates[
        Math.floor(Math.random() * forcedCommentCandidates.length)
      ];
    if (forcedPick) {
      const { bot, runtimeState, posts: eligiblePosts } = forcedPick;
      const targetPost =
        eligiblePosts[Math.floor(Math.random() * eligiblePosts.length)];
      if (targetPost) {
        const delayMs = getDelayFromRange(
          bot.behavior?.postDelayMinutes ?? { min: 5, max: 20 }
        );
        const scheduledAt = nowValue + delayMs;
        const actionRef = scheduledBotActionsCollection(db).doc();
        const plannedActionId = `forced_${bot.uid}_${targetPost.id}_${scheduledAt}`;
        const forcedAction = buildScheduledBotActionPayload(
          ScheduledBotActionType.COMMENT_ON_POST,
          {
            botId: bot.uid,
            postId: targetPost.id,
            scheduledAt,
            metadata: {
              mode: "TOP_LEVEL",
              targetType: "post",
              origin: "activity_tick_forced",
              plannedActionId,
            },
          }
        );
        batch.set(actionRef, forcedAction);
        commentsScheduled += 1;
        actionsScheduled += 1;
        console.log(
          JSON.stringify({
            type: "bot_comment_forced",
            botId: bot.uid,
            postId: targetPost.id,
            actionId: plannedActionId,
            nowIso,
          })
        );
        const { state: botCommentState } = normalizeBotCommentState(
          runtimeState?.topLevelCommentStats,
          nowValue
        );
        botCommentState.hourCount += 1;
        botCommentState.dayCount += 1;
        botCommentState.lastTopLevelCommentAt = scheduledAt;
        if (globalCommentState) {
          globalCommentState.commentsScheduledThisTick =
            (globalCommentState.commentsScheduledThisTick ?? 0) + 1;
          globalCommentState.hourCount =
            (globalCommentState.hourCount ?? 0) + 1;
          globalCommentState.dayCount = (globalCommentState.dayCount ?? 0) + 1;
          globalCommentState.dirty = true;
        }
        const stateRef = botRuntimeStateCollection(db).doc(bot.uid);
        batch.set(
          stateRef,
          {
            topLevelCommentStats: {
              hourWindowStartMs: botCommentState.hourWindowStartMs,
              hourCount: botCommentState.hourCount,
              dayWindowStartMs: botCommentState.dayWindowStartMs,
              dayCount: botCommentState.dayCount,
              lastTopLevelCommentAt: botCommentState.lastTopLevelCommentAt,
            },
            lastActionScheduledAt: scheduledAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        statesUpdated += 1;
      }
    }
  }

  if (
    globalCommentState &&
    (globalCommentState.dirty ||
      (globalCommentState.commentsScheduledThisTick ?? 0) > 0)
  ) {
    batch.set(
      globalCommentState.ref,
      {
        hourWindowStartMs: globalCommentState.hourWindowStartMs,
        hourCount: globalCommentState.hourCount,
        dayWindowStartMs: globalCommentState.dayWindowStartMs,
        dayCount: globalCommentState.dayCount,
        perTickLimit: globalCommentState.perTickLimit,
        perHourLimit: globalCommentState.perHourLimit,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    metaUpdated = true;
  }

  if (actionsScheduled > 0 || statesUpdated > 0 || metaUpdated) {
    await batch.commit();
  }

  return {
    botsProcessed: bots.length,
    actionsScheduled,
    postsFetched: recentPosts.length,
    notificationsFetched: recentNotifications.length,
    commentsScheduled,
    likesScheduled,
    eligiblePostsTotal,
    eligiblePostsPerBot,
    breakdown,
  };
};

// Temporary no-op exports kept for compatibility during migration.
export const schedulePostNotifications = async () => 0;
export const scheduleReplyNotifications = async () => 0;
