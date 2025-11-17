import { describe, expect, it, vi } from "vitest";
import { runBotActivityForTick } from "../scheduler.js";
import { ScheduledBotActionType } from "../models.js";

describe("runBotActivityForTick - direct replies", () => {
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

  it("always schedules a reply when the notification is a direct reply to the bot", async () => {
    const now = Date.now();
    const notification = {
      id: "comment-123",
      postId: "post-1",
      authorId: "user-2",
      parentAuthorId: baseBot.uid,
      createdAtMs: now - 1000,
      mentions: new Set(),
      threadRootCommentId: "thread-1",
    };

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const result = await runBotActivityForTick({
        db: {},
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
      mentions: new Set(),
      threadRootCommentId: "thread-2",
    };

    const runtimeState = {
      lastSeenPostAt: null,
      lastSeenNotificationAt: null,
      lastActionScheduledAt: now - 60 * 1000, // 1 minute ago
    };

    const result = await runBotActivityForTick({
      db: {},
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
