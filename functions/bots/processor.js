import admin from "firebase-admin";
import {
  pendingActionsDueQuery,
  pendingActionsCollection,
  toPendingAction,
  botProfilesCollection,
  toBotProfile,
  PendingActionType,
  MAX_PENDING_ACTION_ATTEMPTS,
  BOT_COOLDOWN_MINUTES,
} from "./models.js";
import { handlePendingAction } from "./decision.js";
import {
  nowMs,
  minutesToMs,
  isWithinCooldown,
  weightedChoice,
} from "./utils.js";
import { maybeAddTypos } from "./typoUtils.js";
import { generateInCharacterComment } from "./commentGenerator.js";

const COMMENTS_COLLECTION = "comments";
const POSTS_COLLECTION = "posts";
const USERS_COLLECTION = "users";
const NOTIFICATIONS_COLLECTION = "notifications";

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
    triggerAt: nowMs() + Math.max(millis, minutesToMs(1)),
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
    triggerAt: nowMs() + minutesToMs(delayMinutes),
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
      triggerAt: nowMs() + minutesToMs(10),
    });
    return { status: "post_unpublished" };
  }

  const state = {
    commentsByBotOnPost: contextResult.commentsByBotOnPost,
    repliesByBotInThread: contextResult.repliesByBotInThread,
  };

  const result = await handlePendingAction({
    action,
    bot,
    context: {
      post: contextResult.post,
      parentComment: contextResult.parentComment,
      threadRootCommentId: contextResult.threadRootCommentId,
      commentsByBotOnPost: state.commentsByBotOnPost,
      repliesByBotInThread: state.repliesByBotInThread,
      triggeringComment: contextResult.parentComment,
    },
    helpers: {
      random: Math.random,
      weightedChoice,
      generateComment: async ({ mode, post, parentComment }) =>
        generateInCharacterComment({
          openAI,
          bot,
          mode,
          post,
          parentComment,
        }),
      maybeAddTypos,
      createCommentOnPost: ({ post, text }) =>
        createCommentOnPostHelper(db, state, { bot, post, text }),
      createReplyToComment: ({ post, parentComment, threadRootCommentId, text }) =>
        createReplyHelper(db, state, {
          bot,
          post,
          parentComment,
          threadRootCommentId,
          text,
        }),
      likePost: ({ post }) => likePostHelper(db, { bot, post }),
      logger,
    },
  });

  await actionDoc.ref.delete();

  if (result.status === "engaged") {
    await updateBotCooldown(db, bot, nowMs());
  }

  return {
    status: result.status,
    action: result.action,
  };
};

export const processPendingActions = async ({
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
  };

  const now = nowMs();
  const snapshot = await pendingActionsDueQuery(db, now).limit(limit).get();

  if (snapshot.empty) {
    return stats;
  }

  for (const doc of snapshot.docs) {
    stats.total += 1;
    const action = toPendingAction(doc);

    if ((action.attempts ?? 0) >= MAX_PENDING_ACTION_ATTEMPTS) {
      await doc.ref.delete();
      stats.deleted += 1;
      continue;
    }

    try {
      const botSnap = await botProfilesCollection(db).doc(action.userUid).get();
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
        userUid: action.userUid,
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

  return stats;
};
