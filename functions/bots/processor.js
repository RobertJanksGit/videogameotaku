import admin from "firebase-admin";
import {
  scheduledBotActionsCollection,
  toScheduledBotAction,
  botProfilesCollection,
  toBotProfile,
  ScheduledBotActionType,
  MAX_PENDING_ACTION_ATTEMPTS,
  BOT_COOLDOWN_MINUTES,
} from "./models.js";
import {
  nowMs,
  minutesToMs,
  isWithinCooldown,
} from "./utils.js";
import { maybeAddTypos } from "./typoUtils.js";
import { generateInCharacterComment } from "./commentGenerator.js";
import { decideCommentEngagement } from "./commentDecision.js";

const COMMENTS_COLLECTION = "comments";
const POSTS_COLLECTION = "posts";
const USERS_COLLECTION = "users";
const NOTIFICATIONS_COLLECTION = "notifications";

const scheduledActionsDueQuery = (db, now) =>
  scheduledBotActionsCollection(db)
    .where("scheduledAt", "<=", now)
    .orderBy("scheduledAt", "asc");

const THREAD_CONTEXT_LIMIT = 15;
const THREAD_PATH_LIMIT = 12;
const TOP_LEVEL_CONTEXT_LIMIT = 10;

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

const sanitizeCommentForContext = (comment) => {
  if (!comment || !comment.id) return null;
  const content = comment.content ?? comment.text ?? "";
  if (!content) return null;
  return {
    id: comment.id,
    authorName: comment.authorName ?? comment.author ?? "",
    authorId: comment.authorId ?? null,
    parentCommentId: comment.parentCommentId ?? comment.parentId ?? null,
    threadRootCommentId: comment.threadRootCommentId ?? null,
    content,
    createdAt: comment.createdAt ?? null,
  };
};

const prepareCommentForPrompt = (
  comment,
  {
    targetCommentId = null,
    threadRootCommentId = null,
    depthOverride = null,
  } = {}
) => {
  if (!comment) return null;
  const content = comment.content ?? comment.text ?? "";
  if (!content) return null;

  const id = comment.id != null ? String(comment.id) : null;
  const normalizedTargetId =
    targetCommentId != null ? String(targetCommentId) : null;
  const normalizedThreadRootId =
    threadRootCommentId != null
      ? String(threadRootCommentId)
      : comment.threadRootCommentId != null
        ? String(comment.threadRootCommentId)
        : null;
  const depth =
    Number.isFinite(depthOverride) && depthOverride >= 0
      ? depthOverride
      : Number.isFinite(comment.depth)
        ? comment.depth
        : null;

  return {
    id,
    author: comment.authorName ?? comment.author ?? "",
    text: content,
    parentCommentId: comment.parentCommentId ?? comment.parentId ?? null,
    threadRootCommentId: normalizedThreadRootId,
    isTarget: Boolean(
      normalizedTargetId && id && normalizedTargetId === id
    ),
    isThreadRoot: Boolean(
      normalizedThreadRootId && id && normalizedThreadRootId === id
    ),
    ...(Number.isFinite(depth) ? { depth } : {}),
  };
};

const prepareTopLevelCommentForPrompt = (comment) => {
  if (!comment || !comment.id) return null;
  return prepareCommentForPrompt(comment);
};

const normalizeThreadEntriesForPrompt = (
  entries,
  targetCommentId,
  threadRootCommentId
) =>
  Array.isArray(entries)
    ? entries
        .map((entry) =>
          prepareCommentForPrompt(entry, { targetCommentId, threadRootCommentId })
        )
        .filter(Boolean)
    : [];

const normalizeThreadPathForPrompt = (
  entries,
  targetCommentId,
  threadRootCommentId
) =>
  Array.isArray(entries)
    ? entries
        .map((entry, index) =>
          prepareCommentForPrompt(entry, {
            targetCommentId,
            threadRootCommentId,
            depthOverride:
              Number.isFinite(entry?.depth) && entry.depth >= 0
                ? entry.depth
                : index,
          })
        )
        .filter(Boolean)
    : [];

const buildThreadContext = async (db, parentComment, threadRootCommentId) => {
  const entries = new Map();
  const requiredIds = new Set(
    [parentComment?.id, threadRootCommentId].filter(Boolean).map(String)
  );

  const addEntry = (comment) => {
    const sanitized = sanitizeCommentForContext(comment);
    if (!sanitized) return;
    if (!entries.has(sanitized.id)) {
      entries.set(sanitized.id, {
        ...sanitized,
        isBotAuthor: Boolean(comment?.isBotAuthor),
      });
    }
  };

  if (parentComment) {
    addEntry(parentComment);
  }

  if (threadRootCommentId) {
    try {
      const snapshot = await db
        .collection(COMMENTS_COLLECTION)
        .where("threadRootCommentId", "==", threadRootCommentId)
        .orderBy("createdAt", "asc")
        .limit(THREAD_CONTEXT_LIMIT * 2)
        .get();

      for (const doc of snapshot.docs) {
        addEntry({ id: doc.id, ...doc.data() });
      }
    } catch (error) {
      console.error?.("Failed to load thread context for bot reply", {
        threadRootCommentId,
        error: error.message,
      });
    }
  }

  const sorted = Array.from(entries.values()).sort(
    (a, b) => timestampToMillis(a.createdAt) - timestampToMillis(b.createdAt)
  );

  const requiredEntries = sorted.filter((entry) =>
    requiredIds.has(String(entry.id))
  );

  const merged = [...requiredEntries, ...sorted.slice(-THREAD_CONTEXT_LIMIT)];
  const deduped = Array.from(
    new Map(merged.map((entry) => [entry.id, entry])).values()
  );

  const trimmed = deduped
    .sort(
      (a, b) => timestampToMillis(a.createdAt) - timestampToMillis(b.createdAt)
    )
    .slice(-THREAD_CONTEXT_LIMIT);

  const byId = new Map(trimmed.map((entry) => [entry.id, entry]));
  const depthMemo = new Map();

  const computeDepth = (entry) => {
    if (!entry || !entry.id) return 0;
    if (depthMemo.has(entry.id)) return depthMemo.get(entry.id);

    const parentId = entry.parentCommentId;
    if (!parentId || parentId === entry.id) {
      depthMemo.set(entry.id, 0);
      return 0;
    }

    const parent = byId.get(parentId);
    const depth = parent ? 1 + computeDepth(parent) : 1;
    depthMemo.set(entry.id, depth);
    return depth;
  };

  return trimmed.map((entry) => ({
    ...entry,
    depth: computeDepth(entry),
    isThreadRoot: Boolean(
      threadRootCommentId &&
        entry.id &&
        String(entry.id) === String(threadRootCommentId)
    ),
    threadRootCommentId: entry.threadRootCommentId ?? threadRootCommentId ?? null,
  }));
};

const buildThreadPath = async (db, parentComment, threadRootCommentId) => {
  if (!parentComment?.id) {
    return [];
  }

  const normalizedRootId =
    threadRootCommentId ??
    parentComment.threadRootCommentId ??
    parentComment.id;

  const path = [];
  const seen = new Set();
  let current = parentComment;

  while (
    current &&
    current.id &&
    path.length < THREAD_PATH_LIMIT &&
    !seen.has(current.id)
  ) {
    seen.add(current.id);
    const sanitized = sanitizeCommentForContext(current);
    if (sanitized) {
      path.push({
        ...sanitized,
        isBotAuthor: Boolean(current.isBotAuthor),
      });
    }

    const nextParentId =
      current.parentCommentId ??
      current.parentId ??
      (current.threadRootCommentId &&
      current.threadRootCommentId !== current.id
        ? current.threadRootCommentId
        : null);

    if (!nextParentId || nextParentId === current.id) {
      break;
    }

    try {
      const parentSnap = await db.collection(COMMENTS_COLLECTION).doc(nextParentId).get();
      if (!parentSnap.exists) {
        break;
      }
      current = { id: parentSnap.id, ...parentSnap.data() };
    } catch (error) {
      console.error?.("Failed to walk thread path for bot reply", {
        nextParentId,
        error: error.message,
      });
      break;
    }
  }

  if (
    normalizedRootId &&
    !seen.has(normalizedRootId) &&
    path.length < THREAD_PATH_LIMIT
  ) {
    try {
      const rootSnap = await db
        .collection(COMMENTS_COLLECTION)
        .doc(normalizedRootId)
        .get();
      if (rootSnap.exists) {
        const data = { id: rootSnap.id, ...rootSnap.data() };
        const sanitized = sanitizeCommentForContext(data);
        if (sanitized) {
          path.push({
            ...sanitized,
            isBotAuthor: Boolean(data.isBotAuthor),
          });
        }
      }
    } catch (error) {
      console.error?.("Failed to load thread root for bot prompt", {
        threadRootCommentId: normalizedRootId,
        error: error.message,
      });
    }
  }

  const ordered = path.reverse().slice(-THREAD_PATH_LIMIT);

  return ordered.map((entry, index) => ({
    ...entry,
    depth: index,
    threadRootCommentId: entry.threadRootCommentId ?? normalizedRootId ?? null,
  }));
};

const buildTopLevelContext = async (db, action, bot) => {
  if (!action?.postId) {
    return [];
  }

  try {
    const snapshot = await db
      .collection(COMMENTS_COLLECTION)
      .where("postId", "==", action.postId)
      .where("parentCommentId", "==", null)
      .orderBy("createdAt", "asc")
      .limit(TOP_LEVEL_CONTEXT_LIMIT * 2)
      .get();

    const entries = [];
    for (const doc of snapshot.docs) {
      const data = { id: doc.id, ...doc.data() };
      if (!data) continue;
      if (data.authorId === bot?.uid) continue;

      const sanitized = sanitizeCommentForContext(data);
      if (!sanitized) continue;

      entries.push({
        ...sanitized,
        isBotAuthor: Boolean(data.isBotAuthor),
        threadRootCommentId: data.threadRootCommentId ?? data.id ?? doc.id,
      });
    }

    return entries.slice(-TOP_LEVEL_CONTEXT_LIMIT);
  } catch (error) {
    console.error?.("Failed to load top-level comments for bot prompt context", {
      postId: action.postId,
      error: error.message,
    });
    return [];
  }
};

const getCount = async (query) => {
  if (typeof query.count === "function") {
    const snapshot = await query.count().get();
    return snapshot.data().count || 0;
  }
  const snapshot = await query.get();
  return snapshot.size;
};

const computeThreadRoot = (action, parentComment) => {
  if (action.threadRootCommentId) return action.threadRootCommentId;
  if (!parentComment) return null;
  return (
    parentComment.threadRootCommentId ||
    parentComment.parentCommentId ||
    parentComment.id ||
    null
  );
};

const buildNotificationMessage = ({ type, senderName, postTitle }) => {
  switch (type) {
    case "post_comment":
      if (postTitle) {
        return `${senderName} commented on your post "${postTitle}"`;
      }
      return `${senderName} commented on your post`;
    case "comment_reply":
      return `${senderName} replied to your comment`;
    default:
      return "";
  }
};

const shouldSendPreference = (prefs = {}, key) => prefs?.[key] !== false;

const fetchUserNotificationPrefs = async (db, userId) => {
  if (!userId) return null;
  const snap = await db.collection(USERS_COLLECTION).doc(userId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return data.notificationPrefs || {};
};

const createNotification = async (db, payload) => {
  await db.collection(NOTIFICATIONS_COLLECTION).add({
    ...payload,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

const notifyPostAuthorAboutComment = async ({ db, bot, post, commentId }) => {
  const recipientId = post?.authorId;
  if (!recipientId || recipientId === bot.uid) {
    return;
  }

  try {
    const prefs = await fetchUserNotificationPrefs(db, recipientId);
    if (!shouldSendPreference(prefs, "postComments")) {
      return;
    }

    const senderName = bot.userName || "Bot";
    const message = buildNotificationMessage({
      type: "post_comment",
      senderName,
      postTitle: post?.title ?? "",
    });

    if (!message) {
      return;
    }

    await createNotification(db, {
      recipientId,
      senderId: bot.uid,
      senderName,
      message,
      type: "post_comment",
      link: `/post/${post.id}`,
      postId: post.id,
      commentId,
    });
  } catch (error) {
    console.error("Failed to create bot post comment notification", {
      postId: post?.id,
      commentId,
      error: error.message,
    });
  }
};

const notifyParentCommentAuthor = async ({
  db,
  bot,
  post,
  parentComment,
  commentId,
}) => {
  const recipientId = parentComment?.authorId;
  if (!recipientId || recipientId === bot.uid) {
    return;
  }

  try {
    const prefs = await fetchUserNotificationPrefs(db, recipientId);
    if (!shouldSendPreference(prefs, "commentReplies")) {
      return;
    }

    const senderName = bot.userName || "Bot";
    const message = buildNotificationMessage({
      type: "comment_reply",
      senderName,
    });

    if (!message) {
      return;
    }

    await createNotification(db, {
      recipientId,
      senderId: bot.uid,
      senderName,
      message,
      type: "comment_reply",
      link: `/post/${post.id}`,
      postId: post.id,
      commentId,
    });
  } catch (error) {
    console.error("Failed to create bot reply notification", {
      postId: post?.id,
      parentCommentId: parentComment?.id,
      commentId,
      error: error.message,
    });
  }
};

const fetchContext = async (db, action, bot) => {
  const postRef = db.collection(POSTS_COLLECTION).doc(action.postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) {
    return { missingPost: true };
  }

  const postData = { id: postSnap.id, ...postSnap.data() };
  if ((postData.status ?? "published") !== "published") {
    return { post: postData, unpublished: true };
  }

  let parentComment = null;
  if (action.parentCommentId) {
    const parentSnap = await db
      .collection(COMMENTS_COLLECTION)
      .doc(action.parentCommentId)
      .get();
    if (parentSnap.exists) {
      parentComment = { id: parentSnap.id, ...parentSnap.data() };
    }
  }

  const threadRootCommentId = computeThreadRoot(action, parentComment);

  const threadContext = await buildThreadContext(db, parentComment, threadRootCommentId);
  const threadPath = await buildThreadPath(db, parentComment, threadRootCommentId);
  const topLevelContext = await buildTopLevelContext(db, action, bot);

  const commentsByBotOnPost = await getCount(
    db
      .collection(COMMENTS_COLLECTION)
      .where("postId", "==", action.postId)
      .where("authorId", "==", bot.uid)
  );

  let repliesByBotInThread = 0;
  if (threadRootCommentId) {
    repliesByBotInThread = await getCount(
      db
        .collection(COMMENTS_COLLECTION)
        .where("threadRootCommentId", "==", threadRootCommentId)
        .where("authorId", "==", bot.uid)
    );
  }

  return {
    post: postData,
    parentComment,
    threadRootCommentId,
    threadContext,
    threadPath,
    topLevelContext,
    commentsByBotOnPost,
    repliesByBotInThread,
  };
};

const likePostHelper = async (db, { bot, post }) => {
  if (!post) return false;

  const likes = new Set(Array.isArray(post.usersThatLiked) ? post.usersThatLiked : []);
  const dislikes = new Set(Array.isArray(post.usersThatDisliked) ? post.usersThatDisliked : []);

  if (likes.has(bot.uid)) {
    return false;
  }

  likes.add(bot.uid);
  if (dislikes.has(bot.uid)) {
    dislikes.delete(bot.uid);
  }

  const updatedLikes = Array.from(likes);
  const updatedDislikes = Array.from(dislikes);
  const newTotalVotes = updatedLikes.length - updatedDislikes.length;

  await db.collection(POSTS_COLLECTION).doc(post.id).update({
    usersThatLiked: updatedLikes,
    usersThatDisliked: updatedDislikes,
    totalVotes: newTotalVotes,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  post.usersThatLiked = updatedLikes;
  post.usersThatDisliked = updatedDislikes;
  post.totalVotes = newTotalVotes;

  return true;
};

const likeCommentHelper = async (db, { bot, comment }) => {
  if (!comment || !comment.id) return false;

  const likes = new Set(
    Array.isArray(comment.usersThatLiked) ? comment.usersThatLiked : []
  );

  if (likes.has(bot.uid)) {
    return false;
  }

  likes.add(bot.uid);

  const updatedLikes = Array.from(likes);

  await db.collection(COMMENTS_COLLECTION).doc(comment.id).set(
    {
      usersThatLiked: updatedLikes,
      likeCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  comment.usersThatLiked = updatedLikes;
  comment.likeCount = (comment.likeCount ?? 0) + 1;

  return true;
};

const createCommentOnPostHelper = async (db, state, { bot, post, text }) => {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const commentData = {
    postId: post.id,
    content: text,
    authorId: bot.uid,
    authorName: bot.userName,
    authorPhotoURL: bot.avatarUrl ?? null,
    isBotAuthor: true,
    parentId: null,
    parentCommentId: null,
    threadRootCommentId: null,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const commentRef = await db.collection(COMMENTS_COLLECTION).add(commentData);

  await db.collection(POSTS_COLLECTION).doc(post.id).update({
    commentCount: admin.firestore.FieldValue.increment(1),
    updatedAt: now,
  });

  state.commentsByBotOnPost += 1;

  await notifyPostAuthorAboutComment({
    db,
    bot,
    post,
    commentId: commentRef.id,
  });

  return commentRef.id;
};

const createReplyHelper = async (
  db,
  state,
  { bot, post, parentComment, threadRootCommentId, text }
) => {
  if (!parentComment) {
    throw new Error("Parent comment required for reply");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const rootId = threadRootCommentId || parentComment.threadRootCommentId || parentComment.id;

  const commentData = {
    postId: post.id,
    content: text,
    authorId: bot.uid,
    authorName: bot.userName,
    authorPhotoURL: bot.avatarUrl ?? null,
    isBotAuthor: true,
    parentId: parentComment.id,
    parentCommentId: parentComment.id,
    threadRootCommentId: rootId || null,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const commentRef = await db.collection(COMMENTS_COLLECTION).add(commentData);

  await Promise.all([
    db.collection(POSTS_COLLECTION).doc(post.id).update({
      commentCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    }),
    db.collection(COMMENTS_COLLECTION).doc(parentComment.id).update({
      replyCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    }),
  ]);

  state.commentsByBotOnPost += 1;
  state.repliesByBotInThread += 1;

  await notifyParentCommentAuthor({
    db,
    bot,
    post,
    parentComment,
    commentId: commentRef.id,
  });

  return commentRef.id;
};

const rescheduleForCooldown = async (actionRef, millis) => {
  await actionRef.update({
    scheduledAt: nowMs() + Math.max(millis, minutesToMs(1)),
  });
};

const rescheduleWithBackoff = async (actionRef, action, attempts) => {
  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_PENDING_ACTION_ATTEMPTS) {
    await actionRef.delete();
    return { deleted: true };
  }

  const delayMinutes = Math.min(30, Math.pow(2, nextAttempts));
  await actionRef.update({
    attempts: nextAttempts,
    scheduledAt: nowMs() + minutesToMs(delayMinutes),
  });
  return { rescheduled: true };
};

const updateBotCooldown = async (db, bot, timestampMs) => {
  await botProfilesCollection(db).doc(bot.uid).update({
    lastEngagedAt: timestampMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  bot.lastEngagedAt = timestampMs;
};

const processSingleAction = async ({
  db,
  actionDoc,
  action,
  bot,
  openAI,
  logger,
}) => {
  const contextResult = await fetchContext(db, action, bot);
  if (contextResult.missingPost) {
    await actionDoc.ref.delete();
    return { status: "missing_post" };
  }

  if (contextResult.unpublished) {
    await actionDoc.ref.update({
      scheduledAt: nowMs() + minutesToMs(10),
    });
    return { status: "post_unpublished" };
  }

  const state = {
    commentsByBotOnPost: contextResult.commentsByBotOnPost,
    repliesByBotInThread: contextResult.repliesByBotInThread,
  };

  const metadata = action.metadata ?? {};
  const behavior = bot.behavior || {};

  const topLevelContext = Array.isArray(contextResult.topLevelContext)
    ? contextResult.topLevelContext
    : [];

  const sanitizedTopLevelContext = topLevelContext
    .map((entry) => prepareTopLevelCommentForPrompt(entry))
    .filter(Boolean);

  let promptThreadContext = Array.isArray(contextResult.threadContext)
    ? contextResult.threadContext
    : [];

  let promptThreadPath = Array.isArray(contextResult.threadPath)
    ? contextResult.threadPath
    : [];

  let promptThreadRootId = contextResult.threadRootCommentId ?? null;

  let outcome = { status: "ignored" };

  try {
    switch (action.type) {
      case ScheduledBotActionType.COMMENT_ON_POST: {
        const maxPerPost = behavior.maxCommentsPerPost;
        if (Number.isFinite(maxPerPost) && state.commentsByBotOnPost >= maxPerPost) {
          outcome = { status: "ignored", reason: "post_quota_reached" };
          break;
        }

        const normalizeTargetId = (value) => {
          if (value == null) return null;
          const str = String(value).trim();
          return str || null;
        };

        const requestedMode =
          typeof metadata.mode === "string"
            ? metadata.mode.toUpperCase()
            : null;
        let desiredMode = requestedMode === "REPLY" ? "REPLY" : "TOP_LEVEL";
        let desiredTargetCommentId =
          requestedMode === "REPLY"
            ? normalizeTargetId(metadata.targetCommentId)
            : null;

        const topLevelContext = Array.isArray(contextResult.topLevelContext)
          ? contextResult.topLevelContext
          : [];

        const shouldUseDecision =
          sanitizedTopLevelContext.length > 0 &&
          (!requestedMode ||
            (requestedMode === "REPLY" && !desiredTargetCommentId));

        if (shouldUseDecision) {
          try {
            const decision = await decideCommentEngagement({
              openAI,
              bot,
              post: contextResult.post,
              topLevelComments: sanitizedTopLevelContext,
              metadata,
            });
            if (!requestedMode) {
              desiredMode = decision.mode;
            }
            desiredTargetCommentId = normalizeTargetId(decision.targetCommentId);
            if (requestedMode === "REPLY") {
              desiredMode = "REPLY";
            }
          } catch (error) {
            logger?.warn?.("Bot reply decision failed", {
              botUid: bot.uid,
              postId: contextResult.post?.id,
              error: error.message,
            });
            desiredMode = requestedMode === "REPLY" ? "REPLY" : "TOP_LEVEL";
            desiredTargetCommentId = requestedMode === "REPLY"
              ? normalizeTargetId(metadata.targetCommentId)
              : null;
          }
        }

        let replyTarget = null;
        if (desiredMode === "REPLY") {
          if (!topLevelContext.length) {
            outcome = { status: "ignored", reason: "reply_context_unavailable" };
            break;
          }
          if (!desiredTargetCommentId) {
            outcome = { status: "ignored", reason: "reply_target_not_found" };
            break;
          }
          replyTarget = topLevelContext.find(
            (entry) => String(entry.id) === desiredTargetCommentId
          );
          if (!replyTarget) {
            outcome = { status: "ignored", reason: "reply_target_not_found" };
            break;
          }
        }

        const targetIdForPrompt = desiredMode === "REPLY" ? desiredTargetCommentId : null;
        let threadContextForPrompt = promptThreadContext;
        let threadPathForPrompt = promptThreadPath;
        let parentForPrompt = null;

        if (replyTarget) {
          promptThreadRootId =
            replyTarget.threadRootCommentId ??
            replyTarget.id ??
            targetIdForPrompt ??
            null;
          parentForPrompt = replyTarget;

          const rebuiltThreadContext = await buildThreadContext(
            db,
            replyTarget,
            promptThreadRootId
          );
          if (Array.isArray(rebuiltThreadContext) && rebuiltThreadContext.length) {
            threadContextForPrompt = rebuiltThreadContext;
          } else {
            threadContextForPrompt = [replyTarget];
          }

          const rebuiltThreadPath = await buildThreadPath(
            db,
            replyTarget,
            promptThreadRootId
          );
          if (Array.isArray(rebuiltThreadPath) && rebuiltThreadPath.length) {
            threadPathForPrompt = rebuiltThreadPath;
          } else {
            threadPathForPrompt = [replyTarget];
          }
        }

        const normalizedThreadContext = normalizeThreadEntriesForPrompt(
          threadContextForPrompt,
          targetIdForPrompt,
          promptThreadRootId
        );

        const normalizedThreadPath = normalizeThreadPathForPrompt(
          threadPathForPrompt,
          targetIdForPrompt,
          promptThreadRootId
        );

        const parentCommentForPrompt =
          desiredMode === "REPLY"
            ? prepareCommentForPrompt(parentForPrompt, {
                targetCommentId: targetIdForPrompt,
                threadRootCommentId: promptThreadRootId,
                depthOverride: normalizedThreadPath.length
                  ? normalizedThreadPath[normalizedThreadPath.length - 1].depth
                  : null,
              })
            : null;

        const generation = await generateInCharacterComment({
          openAI,
          bot,
          mode: desiredMode,
          targetCommentId: desiredTargetCommentId,
          post: contextResult.post,
          parentComment: parentCommentForPrompt,
          threadContext: normalizedThreadContext,
          threadPath: normalizedThreadPath,
          topLevelComments: sanitizedTopLevelContext,
          metadata,
        });
        const finalComment = maybeAddTypos(bot, generation.comment);

        const wantsReply = desiredMode === "REPLY";

        if (wantsReply) {
          if (!replyTarget) {
            outcome = { status: "ignored", reason: "reply_target_not_found" };
            break;
          }

          const threadRootId =
            promptThreadRootId ??
            replyTarget.threadRootCommentId ??
            replyTarget.id;
          if (!threadRootId) {
            outcome = { status: "ignored", reason: "reply_thread_missing" };
            break;
          }

          const repliesByBotForTarget = await getCount(
            db
              .collection(COMMENTS_COLLECTION)
              .where("threadRootCommentId", "==", threadRootId)
              .where("authorId", "==", bot.uid)
          );

          const maxReplies = behavior.maxRepliesPerThread;
          const exceedsThreadLimit =
            Number.isFinite(maxReplies) && repliesByBotForTarget >= maxReplies;

          if (exceedsThreadLimit) {
            outcome = { status: "ignored", reason: "thread_quota_reached" };
            break;
          }

          state.repliesByBotInThread = repliesByBotForTarget;

          const parentForReply = {
            ...replyTarget,
            threadRootCommentId: threadRootId,
          };

          const commentId = await createReplyHelper(db, state, {
            bot,
            post: contextResult.post,
            parentComment: parentForReply,
            threadRootCommentId: threadRootId,
            text: finalComment,
          });

          outcome = {
            status: "engaged",
            action: "replyToComment",
            commentId,
          };
          break;
        }

        const commentId = await createCommentOnPostHelper(db, state, {
          bot,
          post: contextResult.post,
          text: finalComment,
        });

        outcome = {
          status: "engaged",
          action: "commentOnPost",
          commentId,
        };
        break;
      }
      case ScheduledBotActionType.REPLY_TO_COMMENT: {
        if (!contextResult.parentComment) {
          outcome = { status: "ignored", reason: "missing_parent_comment" };
          break;
        }

        const maxReplies = behavior.maxRepliesPerThread;
        if (Number.isFinite(maxReplies) && state.repliesByBotInThread >= maxReplies) {
          outcome = { status: "ignored", reason: "thread_quota_reached" };
          break;
        }

        if (
          contextResult.parentComment.isBotAuthor &&
          state.repliesByBotInThread >= 2
        ) {
          outcome = { status: "ignored", reason: "bot_loop_guard" };
          break;
        }

        const targetCommentId = contextResult.parentComment?.id ?? null;

        const rawThreadContext = Array.isArray(contextResult.threadContext)
          ? contextResult.threadContext
          : [];
        const rawThreadPath = Array.isArray(contextResult.threadPath)
          ? contextResult.threadPath
          : contextResult.parentComment
            ? [contextResult.parentComment]
            : [];

        const normalizedThreadContext = normalizeThreadEntriesForPrompt(
          rawThreadContext,
          targetCommentId,
          contextResult.threadRootCommentId
        );

        const normalizedThreadPath = normalizeThreadPathForPrompt(
          rawThreadPath,
          targetCommentId,
          contextResult.threadRootCommentId
        );

        const parentCommentForPrompt = prepareCommentForPrompt(
          contextResult.parentComment,
          {
            targetCommentId,
            threadRootCommentId: contextResult.threadRootCommentId,
            depthOverride: normalizedThreadPath.length
              ? normalizedThreadPath[normalizedThreadPath.length - 1].depth
              : null,
          }
        );

        const generation = await generateInCharacterComment({
          openAI,
          bot,
          mode: metadata.mode ?? "REPLY",
          targetCommentId,
          post: contextResult.post,
          parentComment: parentCommentForPrompt,
          threadContext: normalizedThreadContext,
          threadPath: normalizedThreadPath,
          topLevelComments: sanitizedTopLevelContext,
          metadata,
        });
        const finalComment = maybeAddTypos(bot, generation.comment);
        const commentId = await createReplyHelper(db, state, {
          bot,
          post: contextResult.post,
          parentComment: contextResult.parentComment,
          threadRootCommentId: contextResult.threadRootCommentId,
          text: finalComment,
        });

        outcome = {
          status: "engaged",
          action: "replyToComment",
          commentId,
        };
        break;
      }
      case ScheduledBotActionType.LIKE_POST: {
        const liked = await likePostHelper(db, {
          bot,
          post: contextResult.post,
        });

        outcome = {
          status: liked ? "engaged" : "ignored",
          action: "likePost",
        };
        break;
      }
      case ScheduledBotActionType.LIKE_COMMENT: {
        const liked = await likeCommentHelper(db, {
          bot,
          comment: contextResult.parentComment,
        });

        outcome = {
          status: liked ? "engaged" : "ignored",
          action: "likeComment",
        };
        break;
      }
      default: {
        logger.warn?.("Unknown scheduled bot action type", {
          actionType: action.type,
          actionId: action.id,
        });
        outcome = { status: "ignored", reason: "unknown_action" };
        break;
      }
    }
  } catch (error) {
    logger.error?.("Failed to execute scheduled bot action", {
      actionId: action.id,
      actionType: action.type,
      error: error.message,
    });
    throw error;
  }

  await actionDoc.ref.delete();

  if (outcome.status === "engaged") {
    await updateBotCooldown(db, bot, nowMs());
  }

  return outcome;
};

export const processScheduledBotActions = async ({
  db,
  openAI,
  limit = 10,
  logger = console,
}) => {
  const stats = {
    total: 0,
    engaged: 0,
    ignored: 0,
    cooldownDeferred: 0,
    rescheduled: 0,
    deleted: 0,
    errors: 0,
    likes: 0,
  };

  const now = nowMs();
  const snapshot = await scheduledActionsDueQuery(db, now)
    .limit(limit)
    .get();
  const nowIso = new Date(now).toISOString();
  const firstScheduledMs = snapshot.empty
    ? null
    : timestampToMillis(snapshot.docs[0]?.get("scheduledAt"));
  console.log(
    JSON.stringify({
      type: "scheduled_actions_query",
      nowIso,
      range: {
        from: firstScheduledMs ? new Date(firstScheduledMs).toISOString() : null,
        to: nowIso,
      },
      limit,
      count: snapshot.size,
    })
  );

  if (snapshot.empty) {
    console.log(
      JSON.stringify({
        type: "empty_queue",
        timestamp: nowIso,
      })
    );
    return stats;
  }

  for (const doc of snapshot.docs) {
    stats.total += 1;
    const action = toScheduledBotAction(doc);

    if ((action.attempts ?? 0) >= MAX_PENDING_ACTION_ATTEMPTS) {
      await doc.ref.delete();
      stats.deleted += 1;
      continue;
    }

    try {
      const botSnap = await botProfilesCollection(db).doc(action.botId).get();
      const bot = toBotProfile(botSnap);

      if (!bot || !bot.isActive) {
        await doc.ref.delete();
        stats.deleted += 1;
        continue;
      }

      if (isWithinCooldown(bot.lastEngagedAt, BOT_COOLDOWN_MINUTES)) {
        const remainingMs = minutesToMs(BOT_COOLDOWN_MINUTES) - (nowMs() - bot.lastEngagedAt);
        await rescheduleForCooldown(doc.ref, remainingMs);
        stats.cooldownDeferred += 1;
        continue;
      }

      const outcome = await processSingleAction({
        db,
        actionDoc: doc,
        action,
        bot,
        openAI,
        logger,
      });

      if (outcome.status === "engaged") {
        stats.engaged += 1;
        if (outcome.action === "likePost" || outcome.action === "likeComment") {
          stats.likes += 1;
        }
      } else if (outcome.status === "ignored") {
        stats.ignored += 1;
      } else if (outcome.status === "missing_post") {
        stats.deleted += 1;
      } else if (outcome.status === "post_unpublished") {
        stats.rescheduled += 1;
      }
    } catch (error) {
      logger.error?.("Failed to process pending action", {
        actionId: doc.id,
        botId: action.botId,
        error: error.message,
      });

      stats.errors += 1;
      const outcome = await rescheduleWithBackoff(doc.ref, action, action.attempts ?? 0);
      if (outcome.deleted) {
        stats.deleted += 1;
      } else if (outcome.rescheduled) {
        stats.rescheduled += 1;
      }
    }
  }

  if (stats.total === 0) {
    console.log(
      JSON.stringify({
        type: "empty_queue",
        timestamp: nowIso,
      })
    );
  }

  return stats;
};

export const processPendingActions = processScheduledBotActions;

export const __testables = {
  processSingleAction,
};
