import { afterEach, describe, expect, it, vi } from "vitest";
import {
  maybeScheduleDirectReplyForComment,
  runBotActivityForTick,
} from "../scheduler.js";
import * as models from "../models.js";

const { ScheduledBotActionType } = models;

afterEach(() => {
  vi.restoreAllMocks();
});

const baseBot = {
  uid: "bot-1",
  userName: "BotOne",
  behavior: {
    baseResponseProbability: 0.3,
    replyResponseProbability: 0.6,
    postDelayMinutes: { min: 5, max: 5 },
    replyDelayMinutes: { min: 2, max: 2 },
    actionWeights: {
      commentOnPost: 0.4,
      replyToComment: 0.3,
      likePost: 0.2,
      likeComment: 0.1,
      ignore: 0.1,
    },
    questionProbability: 0,
    disagreementProbability: 0,
  },
};

const createMockDb = (commentOverrides = {}) => {
  const commentData = {
    id: "comment-123",
    postId: "post-1",
    parentCommentId: "parent-1",
    parentAuthorId: baseBot.uid,
    mentions: ["bot-1"],
    botRepliesHandled: {},
    ...commentOverrides,
  };

  const commentDoc = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ ...commentData }),
    }),
    set: vi.fn().mockResolvedValue(undefined),
  };

  const commentsCollection = {
    doc: vi.fn(() => commentDoc),
  };

  const postDoc = {
    collection: vi.fn(() => commentsCollection),
  };

  const postsCollection = {
    doc: vi.fn(() => postDoc),
  };

  const collectionGroupQuery = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
  };

  return {
    collection: vi.fn(() => postsCollection),
    collectionGroup: vi.fn(() => collectionGroupQuery),
  };
};

const stubScheduledActionsQuery = ({ shouldThrow = false, empty = true } = {}) => {
  const query = {
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: shouldThrow
      ? vi.fn().mockRejectedValue(new Error("Firestore failure"))
      : vi.fn().mockResolvedValue({ empty }),
  };
  vi.spyOn(models, "scheduledBotActionsCollection").mockReturnValue(query);
  return query;
};

describe("runBotActivityForTick - direct replies", () => {

  it("always schedules a reply when the notification is a direct reply to the bot", async () => {
    const now = Date.now();
    const notification = {
      id: "comment-123",
      postId: "post-1",
      authorId: "user-2",
      parentAuthorId: baseBot.uid,
      createdAtMs: now - 1000,
      mentions: ["bot-1"],
      threadRootCommentId: "thread-1",
    };

    const db = createMockDb({
      id: notification.id,
      postId: notification.postId,
      mentions: ["bot-1"],
    });
    stubScheduledActionsQuery();

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await runBotActivityForTick({
        db,
        bot: baseBot,
        runtimeState: null,
        now,
        posts: [],
        notifications: [notification],
      });

      expect(result.status).toBe("scheduled");
      expect(result.scheduledAction).toBeTruthy();
      expect(result.scheduledAction.type).toBe(ScheduledBotActionType.REPLY_TO_COMMENT);
      expect(result.scheduledAction.parentCommentId).toBe(notification.id);
      expect(result.runtimeUpdate).toBeTruthy();
      expect(result.runtimeUpdate.lastActionScheduledAt).toBeGreaterThan(now);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("respects cooldown window even for direct replies", async () => {
    const now = Date.now();
    const notification = {
      id: "comment-456",
      postId: "post-2",
      authorId: "user-3",
      parentAuthorId: baseBot.uid,
      createdAtMs: now - 1000,
      mentions: ["bot-1"],
      threadRootCommentId: "thread-2",
    };

    const db = createMockDb({
      id: notification.id,
      postId: notification.postId,
      mentions: ["bot-1"],
    });
    stubScheduledActionsQuery();

    const runtimeState = {
      lastSeenPostAt: null,
      lastSeenNotificationAt: null,
      lastActionScheduledAt: now - 60 * 1000, // 1 minute ago
    };

    const result = await runBotActivityForTick({
      db,
      bot: baseBot,
      runtimeState,
      now,
      posts: [],
      notifications: [notification],
    });

    expect(result.status).toBe("cooldown");
    expect(result.scheduledAction).toBeUndefined();
  });
});

describe("maybeScheduleDirectReplyForComment - mentions normalization", () => {
  const baseParams = {
    bot: baseBot,
    nowMs: Date.now(),
    runtimeState: null,
    globalCommentState: null,
    threadReplyCounts: new Map(),
    perBotCommentLimits: null,
  };

  it("schedules when mentions contain the bot via array", async () => {
    const db = createMockDb({
      id: "comment-array",
      postId: "post-array",
      mentions: ["bot-1"],
    });
    stubScheduledActionsQuery();

    const result = await maybeScheduleDirectReplyForComment({
      db,
      bot: baseParams.bot,
      postId: "post-array",
      commentId: "comment-array",
      nowMs: baseParams.nowMs,
      runtimeState: baseParams.runtimeState,
      globalCommentState: baseParams.globalCommentState,
      threadReplyCounts: new Map(),
      perBotCommentLimits: baseParams.perBotCommentLimits,
    });

    expect(result.scheduled).toBe(true);
    expect(result.scheduledAction?.type).toBe(
      ScheduledBotActionType.REPLY_TO_COMMENT
    );
  });

  it("schedules when mentions contain the bot via map", async () => {
    const db = createMockDb({
      id: "comment-map",
      postId: "post-map",
      mentions: { "bot-1": true },
    });
    stubScheduledActionsQuery();

    const result = await maybeScheduleDirectReplyForComment({
      db,
      bot: baseParams.bot,
      postId: "post-map",
      commentId: "comment-map",
      nowMs: baseParams.nowMs,
      runtimeState: baseParams.runtimeState,
      globalCommentState: baseParams.globalCommentState,
      threadReplyCounts: new Map(),
      perBotCommentLimits: baseParams.perBotCommentLimits,
    });

    expect(result.scheduled).toBe(true);
    expect(result.scheduledAction?.type).toBe(
      ScheduledBotActionType.REPLY_TO_COMMENT
    );
  });

  it("returns early when mentions are missing", async () => {
    const db = createMockDb({
      id: "comment-none",
      postId: "post-none",
      mentions: undefined,
    });

    const scheduledSpy = vi.spyOn(models, "scheduledBotActionsCollection");

    const result = await maybeScheduleDirectReplyForComment({
      db,
      bot: baseParams.bot,
      postId: "post-none",
      commentId: "comment-none",
      nowMs: baseParams.nowMs,
      runtimeState: baseParams.runtimeState,
      globalCommentState: baseParams.globalCommentState,
      threadReplyCounts: new Map(),
      perBotCommentLimits: baseParams.perBotCommentLimits,
    });

    expect(result.scheduled).toBe(false);
    expect(scheduledSpy).not.toHaveBeenCalled();
  });

  it("logs and exits gracefully when existing action query fails", async () => {
    const db = createMockDb({
      id: "comment-query",
      postId: "post-query",
      mentions: ["bot-1"],
    });
    const query = stubScheduledActionsQuery({ shouldThrow: true });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await maybeScheduleDirectReplyForComment({
      db,
      bot: baseParams.bot,
      postId: "post-query",
      commentId: "comment-query",
      nowMs: baseParams.nowMs,
      runtimeState: baseParams.runtimeState,
      globalCommentState: baseParams.globalCommentState,
      threadReplyCounts: new Map(),
      perBotCommentLimits: baseParams.perBotCommentLimits,
    });

    expect(result.scheduled).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to check for existing reply actions",
      expect.objectContaining({ error: "Firestore failure" })
    );
    expect(query.get).toHaveBeenCalled();
  });
});

describe("runBotActivityForTick - top level comments", () => {
  it("schedules a top-level comment when the post is eligible and limits allow", async () => {
    const now = Date.now();
    const bot = {
      uid: "bot-chatty",
      userName: "ChattyBot",
      behavior: {
        baseResponseProbability: 1,
        replyResponseProbability: 0,
        postDelayMinutes: { min: 0, max: 0 },
        actionWeights: {
          commentOnPost: 1,
          replyToComment: 0,
          likePost: 0,
          likeComment: 0,
          ignore: 0,
        },
        commentLimits: { perHour: 5, perDay: 10, perPost: 2 },
        questionProbability: 0,
        disagreementProbability: 0,
      },
    };

    const posts = [
      {
        id: "post-latest",
        authorId: "user-123",
        createdAtMs: now - 5 * 60 * 1000,
        title: "fresh post",
        content: "content",
        summary: "",
        tags: [],
        text: "fresh post content",
      },
    ];

    const globalCommentState = {
      commentsScheduledThisTick: 0,
      hourWindowStartMs: now,
      hourCount: 0,
      dayWindowStartMs: now,
      dayCount: 0,
      perTickLimit: 3,
      perHourLimit: 5,
      dirty: false,
    };

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await runBotActivityForTick({
        db: {},
        bot,
        runtimeState: null,
        now,
        posts,
        notifications: [],
        globalCommentState,
        recentBotCommentSummary: { perPost: new Map() },
      });

      expect(result.status).toBe("scheduled");
      expect(result.scheduledAction?.type).toBe(
        ScheduledBotActionType.COMMENT_ON_POST
      );
      expect(globalCommentState.hourCount).toBe(1);
      expect(globalCommentState.commentsScheduledThisTick).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("skips commenting when per-bot comment caps are exhausted", async () => {
    const now = Date.now();
    const bot = {
      uid: "bot-limited",
      userName: "LimitedBot",
      behavior: {
        baseResponseProbability: 1,
        replyResponseProbability: 0,
        postDelayMinutes: { min: 0, max: 0 },
        actionWeights: {
          commentOnPost: 1,
          replyToComment: 0,
          likePost: 0,
          likeComment: 0,
          ignore: 1,
        },
        commentLimits: { perHour: 1, perDay: 1, perPost: 1 },
      },
    };

    const posts = [
      {
        id: "post-latest",
        authorId: "user-123",
        createdAtMs: now - 5 * 60 * 1000,
        title: "fresh post",
        content: "content",
        summary: "",
        tags: [],
        text: "fresh post content",
      },
    ];

    const globalCommentState = {
      commentsScheduledThisTick: 0,
      hourWindowStartMs: now,
      hourCount: 0,
      dayWindowStartMs: now,
      dayCount: 0,
      perTickLimit: 3,
      perHourLimit: 5,
      dirty: false,
    };

    const runtimeState = {
      topLevelCommentStats: {
        hourWindowStartMs: now,
        hourCount: 1,
        dayWindowStartMs: now,
        dayCount: 1,
        lastTopLevelCommentAt: now - 2 * 60 * 1000,
      },
    };

    const result = await runBotActivityForTick({
      db: {},
      bot,
      runtimeState,
      now,
      posts,
      notifications: [],
      globalCommentState,
      recentBotCommentSummary: { perPost: new Map() },
    });

    expect(result.status).not.toBe("scheduled");
    expect(result.scheduledAction).toBeUndefined();
    expect(globalCommentState.commentsScheduledThisTick).toBe(0);
  });
});

describe("runBotActivityForTick - action weight normalization", () => {
  it("schedules a like when only likePostOnly weight is provided", async () => {
    const now = Date.now();
    const bot = {
      uid: "bot-like",
      userName: "LikeOnly",
      likes: ["news"],
      behavior: {
        baseResponseProbability: 1,
        postDelayMinutes: { min: 1, max: 1 },
        actionWeights: {
          commentOnPost: 0,
          replyToComment: 0,
          likePostOnly: 0.6,
          likeComment: 0,
          ignore: 0,
        },
      },
    };

    const posts = [
      {
        id: "post-like-1",
        authorId: "user-123",
        createdAtMs: now - 60 * 1000,
        title: "breaking news",
        content: "latest update",
        summary: "",
        tags: [],
        text: "breaking news latest update",
      },
    ];

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await runBotActivityForTick({
        db: {},
        bot,
        runtimeState: null,
        now,
        posts,
        notifications: [],
      });

      expect(result.status).toBe("scheduled");
      expect(result.scheduledAction).toBeTruthy();
      expect(result.scheduledAction.type).toBe(
        ScheduledBotActionType.LIKE_POST
      );
      expect(result.scheduledAction.postId).toBe(posts[0].id);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
