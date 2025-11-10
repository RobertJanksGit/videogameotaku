import { describe, it, expect, vi } from "vitest";
import { handlePendingAction } from "../decision.js";
import { PendingActionType } from "../models.js";

describe("handlePendingAction", () => {
  const baseBot = {
    uid: "bot-1",
    userName: "BotOne",
    isActive: true,
    likes: ["speed"],
    dislikes: [],
    topicPreferences: { mechanic: 0.5 },
    behavior: {
      baseResponseProbability: 1,
      replyResponseProbability: 1,
      actionWeights: {
        commentOnPost: 1,
        commentOnComment: 1,
        likePostOnly: 1,
        likeAndComment: 1,
        ignore: 0,
      },
      maxCommentsPerPost: 5,
      maxRepliesPerThread: 5,
      typoChance: 0,
      maxTyposPerComment: 0,
    },
  };

  it("ignores when base probability is zero", async () => {
    const result = await handlePendingAction({
      action: { type: PendingActionType.POST_NOTIFICATION },
      bot: {
        ...baseBot,
        behavior: { ...baseBot.behavior, baseResponseProbability: 0 },
      },
      context: {
        post: { id: "post", title: "Sample", content: "content" },
        commentsByBotOnPost: 0,
        repliesByBotInThread: 0,
      },
      helpers: {},
    });

    expect(result.status).toBe("ignored");
  });

  it("creates a top-level comment when chosen", async () => {
    const generateComment = vi.fn().mockResolvedValue("Hi there");
    const createCommentOnPost = vi.fn().mockResolvedValue("comment-123");
    const maybeAddTypos = vi.fn((bot, text) => text);

    const result = await handlePendingAction({
      action: { type: PendingActionType.POST_NOTIFICATION },
      bot: baseBot,
      context: {
        post: {
          id: "post-1",
          title: "New mechanic",
          content: "This mechanic improves speed",
        },
        commentsByBotOnPost: 0,
        repliesByBotInThread: 0,
      },
      helpers: {
        random: () => 0.1,
        weightedChoice: () => "commentOnPost",
        generateComment,
        createCommentOnPost,
        maybeAddTypos,
      },
    });

    expect(result.status).toBe("engaged");
    expect(result.action).toBe("commentOnPost");
    expect(generateComment).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "TOP_LEVEL" })
    );
    expect(createCommentOnPost).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Hi there" })
    );
  });

  it("likes a post when likePostOnly is selected", async () => {
    const likePost = vi.fn().mockResolvedValue(true);

    const result = await handlePendingAction({
      action: { type: PendingActionType.POST_NOTIFICATION },
      bot: baseBot,
      context: {
        post: { id: "post-2", title: "Update", content: "General news" },
        commentsByBotOnPost: 0,
        repliesByBotInThread: 0,
      },
      helpers: {
        random: () => 0,
        weightedChoice: () => "likePostOnly",
        likePost,
        generateComment: vi.fn(),
      },
    });

    expect(result.status).toBe("engaged");
    expect(result.action).toBe("likePostOnly");
    expect(likePost).toHaveBeenCalled();
  });

  it("replies to a comment when permitted", async () => {
    const generateComment = vi.fn().mockResolvedValue("Reply text");
    const createReplyToComment = vi
      .fn()
      .mockResolvedValue("reply-comment-id");

    const result = await handlePendingAction({
      action: { type: PendingActionType.REPLY_NOTIFICATION },
      bot: baseBot,
      context: {
        post: { id: "post-3", title: "Guide", content: "mechanic details" },
        parentComment: { id: "c1", content: "What about speed?" },
        threadRootCommentId: "c1",
        commentsByBotOnPost: 0,
        repliesByBotInThread: 0,
      },
      helpers: {
        random: () => 0,
        weightedChoice: () => "commentOnComment",
        generateComment,
        createReplyToComment,
        maybeAddTypos: (bot, text) => text,
      },
    });

    expect(result.status).toBe("engaged");
    expect(result.action).toBe("commentOnComment");
    expect(generateComment).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "REPLY" })
    );
    expect(createReplyToComment).toHaveBeenCalledWith(
      expect.objectContaining({ parentComment: expect.any(Object) })
    );
  });
});
