/* global process */

const DEFAULT_DECISION_MODEL =
  process.env.BOT_COMMENT_DECISION_MODEL ||
  process.env.BOT_COMMENT_MODEL ||
  "gpt-4o-mini";

const buildDecisionSystemPrompt = () =>
  [
    "You are an engagement strategist for a gaming community bot.",
    "You always receive JSON with:",
    "- post: { postTitle, postBody | postContent, postAuthor }",
    "- topLevelComments: array of existing post-level comments (oldest first), each { id, author, text }",
    "- character: bot profile metadata (likes, dislikes, tone, responseStyle, etc.)",
    "- metadata: context such as shouldAskQuestion, intent, triggeredByMention, repliedToBotId",
    "",
    "GOAL:",
    "- Decide if the bot should write a new TOP_LEVEL comment on the post or REPLY to one existing top-level comment.",
    "- Favor REPLY when it avoids duplicating sentiments, deepens discussion, or addresses mentions.",
    "- Favor TOP_LEVEL when you can add a new angle that is not already represented.",
    "",
    "COMMENT-SELECTION PLAYBOOK:",
    "1) Derive 'angles' from topLevelComments (hype, critique, nostalgia, tech specs, price, bugs, etc.).",
    "2) Estimate overlap between the bot's likely response and existing angles:",
    "   - +0.5 if tone/stance matches, +0.3 if same topic focus, +0.2 if similar wording/memes.",
    "   - If overlap >= 0.6 the idea is too similar for a new top-level comment.",
    "3) If overlap < 0.6 OR there are no comments, choose TOP_LEVEL.",
    "4) Otherwise choose REPLY. Pick the best target comment by:",
    "   a) Selecting the one the bot can add nuance to (clarify, disagree respectfully, add firsthand info).",
    "   b) Preferring earlier/high-visibility comments when ties happen.",
    "   c) Respecting metadata.intent (e.g., 'disagree' nudges toward counterpoints).",
    "5) Mentions: if metadata.triggeredByMention === true or repliedToBotId is set, bias toward replying to that pathway.",
    "6) Never invent comment IDs. Only choose from the provided list.",
    "",
    "OUTPUT STRICT JSON:",
    '{ "mode": "TOP_LEVEL" | "REPLY", "targetCommentId": string | null, "reason": string }',
  ].join("\n");

const normalizeTopLevelComments = (comments = []) =>
  comments
    .map((comment) => {
      if (!comment || (!comment.id && !comment.commentId)) return null;
      const text = comment.text ?? comment.content ?? "";
      if (!text) return null;
      return {
        id: comment.id ? String(comment.id) : String(comment.commentId),
        author: comment.authorName ?? comment.author ?? "",
        text,
      };
    })
    .filter(Boolean);

const normalizePost = (post = {}) => ({
  postTitle: post?.title ?? "",
  postBody: post?.content ?? post?.body ?? "",
  postAuthor: post?.authorName ?? post?.author ?? "",
});

const normalizeTargetId = (value) => {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
};

export const decideCommentEngagement = async ({
  openAI,
  bot,
  post,
  topLevelComments = [],
  metadata = {},
  model = DEFAULT_DECISION_MODEL,
}) => {
  if (!openAI) throw new Error("OpenAI client not provided");

  const normalizedTopLevel = normalizeTopLevelComments(topLevelComments);
  if (!normalizedTopLevel.length) {
    return { mode: "TOP_LEVEL", targetCommentId: null, reason: "no_comments" };
  }

  const payload = {
    post: normalizePost(post),
    topLevelComments: normalizedTopLevel,
    character: bot,
    metadata: {
      shouldAskQuestion: Boolean(metadata.shouldAskQuestion),
      intent: metadata.intent ?? "default",
      triggeredByMention: Boolean(metadata.triggeredByMention),
      repliedToBotId: metadata.repliedToBotId ?? null,
    },
  };

  const completion = await openAI.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildDecisionSystemPrompt() },
      {
        role: "user",
        content:
          "Here is the engagement context JSON. Decide whether to write a top-level comment or reply to an existing comment.\n\n" +
          JSON.stringify(payload),
      },
    ],
  });

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from comment decision model");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse comment decision JSON: ${error.message}`);
  }

  const rawMode =
    typeof parsed.mode === "string" ? parsed.mode.toUpperCase().trim() : "";
  const mode = rawMode === "REPLY" ? "REPLY" : "TOP_LEVEL";

  let targetCommentId =
    mode === "REPLY" ? normalizeTargetId(parsed.targetCommentId) : null;
  if (mode === "REPLY") {
    const validIds = new Set(normalizedTopLevel.map((entry) => entry.id));
    if (!targetCommentId || !validIds.has(targetCommentId)) {
      return {
        mode: "TOP_LEVEL",
        targetCommentId: null,
        reason: "invalid_target",
      };
    }
  } else {
    targetCommentId = null;
  }

  return {
    mode,
    targetCommentId,
    reason: typeof parsed.reason === "string" ? parsed.reason : null,
  };
};
