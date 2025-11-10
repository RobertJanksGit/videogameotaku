import {
  PendingActionType,
  botProfilesCollection,
  pendingActionsCollection,
  toBotProfile,
  buildPendingActionPayload,
  MAX_BOTS_PER_POST,
} from "./models.js";
import { pickRandomSubset, getDelayFromRange } from "./utils.js";

const TEXT_FIELDS = ["title", "content", "body", "summary"];

const getPostText = (post = {}) =>
  TEXT_FIELDS.map((field) => (post[field] ?? ""))
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

  return score;
};

const selectBotsForPost = (bots, post, excludeIds = new Set()) => {
  const text = getPostText(post);

  const scored = bots
    .filter((bot) => !excludeIds.has(bot.uid))
    .map((bot) => ({ bot, score: scoreBotForPost(bot, text) }))
    .filter(({ score }) => score > 0);

  if (scored.length === 0) {
    return pickRandomSubset(
      bots.filter((bot) => !excludeIds.has(bot.uid)),
      Math.min(MAX_BOTS_PER_POST, bots.length)
    );
  }

  const candidates = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_BOTS_PER_POST * 2)
    .map(({ bot }) => bot);

  return pickRandomSubset(candidates, Math.min(MAX_BOTS_PER_POST, candidates.length));
};

const mentionRegex = /@([A-Za-z0-9_\-]+)/g;

const extractMentionedUsernames = (text = "") => {
  const mentions = new Set();
  let match;
  while ((match = mentionRegex.exec(text))) {
    mentions.add(match[1].toLowerCase());
  }
  return mentions;
};

const buildActionDoc = (db, payload) => {
  const collectionRef = pendingActionsCollection(db);
  return { ref: collectionRef.doc(), payload };
};

const defaultDelay = (minutesRange, fallbackMin = 5, fallbackMax = 15) => {
  if (minutesRange && typeof minutesRange === "object") {
    return getDelayFromRange(minutesRange);
  }
  return getDelayFromRange({ min: fallbackMin, max: fallbackMax });
};

const loadActiveBots = async (db) => {
  const snapshot = await botProfilesCollection(db)
    .where("isActive", "==", true)
    .get();

  const bots = snapshot.docs
    .map((doc) => toBotProfile(doc))
    .filter((bot) => bot && bot.behavior);

  const byUid = new Map();
  const byUsername = new Map();

  for (const bot of bots) {
    byUid.set(bot.uid, bot);
    if (bot.userName) {
      byUsername.set(bot.userName.toLowerCase(), bot);
    }
  }

  return { bots, byUid, byUsername };
};

export const schedulePostNotifications = async ({
  db,
  postId,
  postData,
  nowMs = Date.now(),
}) => {
  if (!postData) return 0;

  const { bots } = await loadActiveBots(db);
  if (!bots.length) return 0;

  const excludeIds = new Set();
  if (postData.authorId) {
    excludeIds.add(postData.authorId);
  }

  const selectedBots = selectBotsForPost(bots, postData, excludeIds);
  if (!selectedBots.length) {
    return 0;
  }

  const batch = db.batch();

  for (const bot of selectedBots) {
    const delayMs = defaultDelay(bot.behavior?.postDelayMinutes);
    const triggerAt = nowMs + delayMs;
    const payload = buildPendingActionPayload(PendingActionType.POST_NOTIFICATION, {
      userUid: bot.uid,
      postId,
      triggerAt,
    });
    const { ref, payload: docData } = buildActionDoc(db, payload);
    batch.set(ref, docData);
  }

  await batch.commit();
  return selectedBots.length;
};

export const scheduleReplyNotifications = async ({
  db,
  commentId,
  commentData,
  nowMs = Date.now(),
}) => {
  if (!commentData) return 0;

  const { bots, byUid, byUsername } = await loadActiveBots(db);
  if (!bots.length) return 0;

  if (byUid.has(commentData.authorId)) {
    return 0;
  }

  const actions = new Map();
  const parentCommentId = commentData.parentCommentId ?? commentData.parentId ?? null;

  if (parentCommentId) {
    const parentSnapshot = await db
      .collection("comments")
      .doc(parentCommentId)
      .get();
    if (parentSnapshot.exists) {
      const parentAuthorId = parentSnapshot.get("authorId");
      const parentBot = byUid.get(parentAuthorId);
      if (parentBot) {
        const threadRootCommentId =
          parentSnapshot.get("threadRootCommentId") ?? parentCommentId;
        actions.set(parentBot.uid, {
          bot: parentBot,
          parentCommentId,
          threadRootCommentId,
        });
      }
    }
  }

  const mentions = extractMentionedUsernames(commentData.content || "");
  for (const mention of mentions) {
    const bot = byUsername.get(mention);
    if (!bot) continue;
    if (bot.uid === commentData.authorId) continue;

    if (!actions.has(bot.uid)) {
      const threadRootCommentId =
        commentData.threadRootCommentId ?? parentCommentId ?? commentId;
      actions.set(bot.uid, {
        bot,
        parentCommentId: commentId,
        threadRootCommentId,
      });
    }
  }

  if (!actions.size) {
    return 0;
  }

  const batch = db.batch();

  for (const { bot, parentCommentId: parentId, threadRootCommentId } of actions.values()) {
    const delayMs = defaultDelay(bot.behavior?.replyDelayMinutes, 2, 10);
    const triggerAt = nowMs + delayMs;
    const payload = buildPendingActionPayload(PendingActionType.REPLY_NOTIFICATION, {
      userUid: bot.uid,
      postId: commentData.postId,
      triggerAt,
      parentCommentId: parentId,
      threadRootCommentId,
    });
    const { ref, payload: docData } = buildActionDoc(db, payload);
    batch.set(ref, docData);
  }

  await batch.commit();
  return actions.size;
};
