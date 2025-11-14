import { describe, expect, it, vi } from "vitest";
import { __testables } from "../processor.js";
import { ScheduledBotActionType } from "../models.js";

vi.mock("../commentGenerator.js", () => ({
  generateInCharacterComment: vi.fn(),
}));

const { processSingleAction } = __testables;
const { generateInCharacterComment } = await import("../commentGenerator.js");

describe("processSingleAction - reply fallbacks", () => {
  const bot = {
    uid: "bot-1",
    userName: "BotOne",
    behavior: {
      maxCommentsPerPost: 5,
      maxRepliesPerThread: 5,
      typoChance: 0,
      maxTyposPerComment: 0,
      questionProbability: 0,
      disagreementProbability: 0,
    },
  };

  const createDbStub = () => {
    const commentsAdd = vi.fn();
    const postsUpdate = vi.fn();

    const commentsQuery = {
      where: () => commentsQuery,
      orderBy: () => commentsQuery,
      limit: () => commentsQuery,
      get: async () => ({ docs: [], size: 0 }),
    };

    const commentsCollection = {
      add: commentsAdd,
      doc: () => ({
        get: async () => ({ exists: false }),
        update: vi.fn().mockResolvedValue(),
      }),
      where: () => commentsQuery,
    };

    const postsCollection = {
      doc: (id) => ({
        id,
        get: async () => ({
          exists: true,
          data: () => ({
            id: "post-1",
            title: "Sample post",
            content: "Some content",
            status: "published",
          }),
        }),
        update: postsUpdate,
      }),
    };

    return {
      commentsAdd,
      postsUpdate,
      db: {
        collection: (name) => {
          if (name === "posts") return postsCollection;
          if (name === "comments") return commentsCollection;
          if (name === "notifications") {
            return {
              add: vi.fn(),
            };
          }
          if (name === "users") {
            return {
              doc: () => ({
                get: async () => ({ exists: false }),
              }),
            };
          }
          return {
            doc: () => ({
              get: async () => ({ exists: false }),
            }),
          };
        },
      },
    };
  };

  it("does not create a top-level comment when reply target is missing", async () => {
    generateInCharacterComment.mockResolvedValue({
      comment: "Reply content",
      mode: "REPLY",
      targetCommentId: "missing-comment",
    });

    const { db, commentsAdd } = createDbStub();

    const action = {
      id: "action-1",
      type: ScheduledBotActionType.COMMENT_ON_POST,
      botId: bot.uid,
      postId: "post-1",
      metadata: {},
    };

    const actionDoc = {
      ref: {
        delete: vi.fn().mockResolvedValue(),
        update: vi.fn().mockResolvedValue(),
      },
    };

    const result = await processSingleAction({
      db,
      actionDoc,
      action,
      bot,
      openAI: {},
      logger: console,
    });

    expect(result.status).toBe("ignored");
    expect(result.reason).toBe("reply_target_not_found");
    expect(commentsAdd).not.toHaveBeenCalled();
    expect(actionDoc.ref.delete).toHaveBeenCalledTimes(1);
  });
});











