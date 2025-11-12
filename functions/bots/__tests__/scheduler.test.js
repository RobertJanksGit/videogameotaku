import { describe, expect, it } from "vitest";
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

