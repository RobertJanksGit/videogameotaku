import { PendingActionType } from "./models.js";
import { clamp01, weightedChoice as defaultWeightedChoice } from "./utils.js";

const DEFAULT_ACTION_WEIGHTS = {
  commentOnPost: 0.25,
  commentOnComment: 0.15,
  likePostOnly: 0.1,
  likeAndComment: 0.1,
  ignore: 0.4,
};

const normalizeText = (value) => (value ?? "").toString().toLowerCase();

const gatherContextText = (context = {}) => {
  const segments = [];
  if (context.post) {
    segments.push(context.post.title ?? "");
    segments.push(context.post.content ?? context.post.body ?? "");
  }
  if (context.parentComment) {
    segments.push(context.parentComment.content ?? context.parentComment.text ?? "");
  }
  if (context.triggeringComment && context.triggeringComment !== context.parentComment) {
    segments.push(context.triggeringComment.content ?? "");
  }
  return normalizeText(segments.join(" \n"));
};

const computeRelevanceBoost = (bot, context) => {
  const text = gatherContextText(context);
  if (!text) {
    return 1;
  }

  let boost = 1;
  let likeMatches = 0;

  const likes = Array.isArray(bot.likes) ? bot.likes : [];
  for (const like of likes) {
    if (like && text.includes(like.toLowerCase())) {
      likeMatches += 1;
    }
  }

  if (likeMatches > 0) {
    boost *= Math.min(1.5 + 0.2 * (likeMatches - 1), 2.5);
  }

  const topicPrefs = bot.topicPreferences || {};
  for (const [topic, weight] of Object.entries(topicPrefs)) {
    if (topic && text.includes(topic.toLowerCase())) {
      boost += Number.isFinite(weight) ? Number(weight) : 0.25;
    }
  }

  const dislikes = Array.isArray(bot.dislikes) ? bot.dislikes : [];
  for (const dislike of dislikes) {
    if (dislike && text.includes(dislike.toLowerCase())) {
      boost *= 0.75;
    }
  }

  return Math.max(boost, 0.1);
};

const getBaseProbability = (action, bot) => {
  const behavior = bot.behavior || {};
  if (action.type === PendingActionType.REPLY_NOTIFICATION) {
    return behavior.replyResponseProbability ?? 0;
  }
  return behavior.baseResponseProbability ?? 0;
};

const getActionWeights = (bot) => {
  const weights = bot.behavior?.actionWeights || {};
  return { ...DEFAULT_ACTION_WEIGHTS, ...weights };
};

const isCommentAllowed = (bot, context) => {
  const max = bot.behavior?.maxCommentsPerPost;
  if (!Number.isFinite(max)) return true;
  return (context.commentsByBotOnPost ?? 0) < max;
};

const isReplyAllowed = (bot, context) => {
  const max = bot.behavior?.maxRepliesPerThread;
  if (!Number.isFinite(max)) return true;
  return (context.repliesByBotInThread ?? 0) < max;
};

const adjustActionWeights = (weights, adjustments) => {
  const updated = { ...weights };
  for (const [key, value] of Object.entries(adjustments)) {
    updated[key] = value;
  }
  return updated;
};

export const handlePendingAction = async ({
  action,
  bot,
  context,
  helpers = {},
}) => {
  const {
    random = Math.random,
    weightedChoice = defaultWeightedChoice,
    generateComment,
    maybeAddTypos = (text) => text,
    createCommentOnPost,
    createReplyToComment,
    likePost,
    logger = console,
  } = helpers;

  const baseProb = getBaseProbability(action, bot);
  if (baseProb <= 0) {
    return { status: "ignored", reason: "base_probability_zero" };
  }

  const relevanceBoost = computeRelevanceBoost(bot, context);
  const effectiveProb = clamp01(baseProb * relevanceBoost);

  if (random() > effectiveProb) {
    return { status: "ignored", effectiveProb, relevanceBoost };
  }

  let weights = getActionWeights(bot);

  const canComment = isCommentAllowed(bot, context);
  const canReply = isReplyAllowed(bot, context);

  if (!canComment) {
    weights = adjustActionWeights(weights, {
      commentOnPost: 0,
      likeAndComment: weights.likeAndComment ? weights.likeAndComment * 0.5 : 0,
    });
  }

  if (!canReply || !context.parentComment) {
    weights = adjustActionWeights(weights, {
      commentOnComment: 0,
    });
  }

  if (!context.post) {
    weights = adjustActionWeights(weights, {
      commentOnPost: 0,
      likeAndComment: 0,
      likePostOnly: 0,
    });
  }

  const chosenAction = weightedChoice(weights) || "ignore";

  logger?.info?.("Bot pending action decision", {
    botUid: bot.uid,
    actionType: action.type,
    chosenAction,
    canComment,
    canReply,
    hasParentComment: Boolean(context.parentComment?.id),
    parentCommentId: context.parentComment?.id ?? null,
    threadRootCommentId: context.threadRootCommentId ?? null,
  });

  switch (chosenAction) {
    case "commentOnPost": {
      if (!canComment || !context.post) {
        return { status: "ignored", reason: "comment_not_allowed" };
      }
      if (!generateComment || !createCommentOnPost) {
        throw new Error("Comment helpers not provided");
      }
      const rawComment = await generateComment({
        bot,
        mode: "TOP_LEVEL",
        post: context.post,
        parentComment: null,
        threadContext: context.threadContext,
      });
      const finalComment = maybeAddTypos(bot, rawComment);
      const commentId = await createCommentOnPost({
        bot,
        post: context.post,
        text: finalComment,
        action,
      });
      logger?.info?.("Bot top-level comment created", {
        botUid: bot.uid,
        postId: context.post?.id,
        commentId,
        actionType: action.type,
      });
      return {
        status: "engaged",
        action: "commentOnPost",
        commentId,
        effectiveProb,
        relevanceBoost,
      };
    }
    case "commentOnComment": {
      const targetComment =
        context.parentComment && context.parentComment.id ? context.parentComment : null;

      if (!canReply || !targetComment) {
        logger?.info?.("Bot reply fallback to top-level", {
          botUid: bot.uid,
          postId: context.post?.id,
          reason: !canReply ? "reply_not_allowed" : "missing_target_comment",
          contextParentHasId: Boolean(context.parentComment?.id),
          chosenAction,
        });
        if (!canComment || !context.post) {
          return { status: "ignored", reason: "reply_not_allowed" };
        }
        if (!generateComment || !createCommentOnPost) {
          throw new Error("Comment helpers not provided");
        }
        const rawComment = await generateComment({
          bot,
          mode: "TOP_LEVEL",
          post: context.post,
          parentComment: null,
          threadContext: context.threadContext,
        });
        const finalComment = maybeAddTypos(bot, rawComment);
        const commentId = await createCommentOnPost({
          bot,
          post: context.post,
          text: finalComment,
          action,
        });
        return {
          status: "engaged",
          action: "commentOnComment",
          commentId,
          effectiveProb,
          relevanceBoost,
          fallbackToTopLevel: true,
        };
      }

      if (!generateComment || !createReplyToComment) {
        throw new Error("Reply helpers not provided");
      }
      logger?.info?.("Bot reply path selected", {
        botUid: bot.uid,
        postId: context.post?.id,
        parentCommentId: targetComment.id,
        threadRootCommentId: context.threadRootCommentId ?? null,
        threadContextSize: Array.isArray(context.threadContext)
          ? context.threadContext.length
          : 0,
        chosenAction,
      });
      const rawComment = await generateComment({
        bot,
        mode: "REPLY",
        post: context.post,
        parentComment: targetComment,
        threadContext: context.threadContext,
      });
      const finalComment = maybeAddTypos(bot, rawComment);
      // Bot reply path: respond to a specific comment and set parentCommentId so UI nests correctly.
      const commentId = await createReplyToComment({
        bot,
        post: context.post,
        parentComment: targetComment,
        threadRootCommentId: context.threadRootCommentId,
        text: finalComment,
        action,
      });
      logger?.info?.("Bot reply created", {
        botUid: bot.uid,
        postId: context.post?.id,
        parentCommentId: targetComment.id,
        commentId,
      });
      return {
        status: "engaged",
        action: "commentOnComment",
        commentId,
        effectiveProb,
        relevanceBoost,
      };
    }
    case "likeAndComment": {
      const likeResult = likePost ? await likePost({ bot, post: context.post }) : null;

      if (!canComment && !canReply) {
        return {
          status: likeResult ? "engaged" : "ignored",
          action: likeResult ? "likePostOnly" : "ignore",
          effectiveProb,
          relevanceBoost,
        };
      }

      if (!generateComment) {
        throw new Error("generateComment helper not provided");
      }

      const replyMode =
        canReply && context.parentComment && context.parentComment.id ? "REPLY" : "TOP_LEVEL";
      const rawComment = await generateComment({
        bot,
        mode: replyMode,
        post: context.post,
        parentComment: replyMode === "REPLY" ? context.parentComment : null,
        threadContext: context.threadContext,
      });
      const finalComment = maybeAddTypos(bot, rawComment);

      let commentId = null;
      if (replyMode === "REPLY") {
        if (!createReplyToComment) {
          throw new Error("createReplyToComment helper not provided");
        }
        commentId = await createReplyToComment({
          bot,
          post: context.post,
          parentComment: context.parentComment,
          threadRootCommentId: context.threadRootCommentId,
          text: finalComment,
          action,
        });
      } else {
        if (!createCommentOnPost) {
          throw new Error("createCommentOnPost helper not provided");
        }
        commentId = await createCommentOnPost({
          bot,
          post: context.post,
          text: finalComment,
          action,
        });
      }

      return {
        status: "engaged",
        action: "likeAndComment",
        liked: Boolean(likeResult),
        commentId,
        effectiveProb,
        relevanceBoost,
      };
    }
    case "likePostOnly": {
      if (!context.post || !likePost) {
        return { status: "ignored", reason: "like_not_possible" };
      }
      const liked = await likePost({ bot, post: context.post });
      if (!liked) {
        logger?.info?.("Bot like skipped", {
          botUid: bot.uid,
          postId: context.post?.id,
        });
      }
      return {
        status: liked ? "engaged" : "ignored",
        action: "likePostOnly",
        effectiveProb,
        relevanceBoost,
      };
    }
    default:
      return { status: "ignored", reason: "action_ignore", effectiveProb };
  }
};
