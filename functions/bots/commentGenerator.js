const DEFAULT_COMMENT_MODEL = process.env.BOT_COMMENT_MODEL || "gpt-4o-mini";

const buildSystemPrompt = () =>
  [
    "You are a character response engine for a gaming community comment section.",
    "You always receive a single JSON object with:",
    "- post: { postTitle, postBody, postAuthor }",
    "- parentComment: { author, text } or null",
    "- character: the bot's persona and behavior metadata",
    "- mode: 'TOP_LEVEL' or 'REPLY'",
    "",
    "Write like a real gamer on Reddit or a Discord server, not like an AI, not like a journalist, and not like brand marketing. Don't be too verbose, keep it short and concise. Don't use emojis unless they are part of the character's communication style. Don't use hashtags.",
    "",
    "Use the character data:",
    "- personalityTraits, mood, likes, dislikes",
    "- communicationStyle, selfImage, flaw, motivation",
    "- responseStyle",
    "- behavior.typoChance and behavior.maxTyposPerComment as a hint for how polished / messy they are",
    "",
    "Tone & style rules:",
    "- Sound casual and human: use contractions (don't, can't), slang or gamer lingo if it fits the character.",
    "- Do NOT explain the whole situation like an article. React to 1–2 points from the post or comment and move on.",
    "- Avoid generic AI-ish lines like 'I'm super excited to hear that', 'What do you all think?', 'Let's chat',",
    "  'Thanks for sharing', 'This is very interesting', etc.",
    "- Default to **statements**, not questions. Most comments should end with a statement, not a question mark.",
    "- Only ask a question if it feels natural to the character in that specific moment, and keep it short and specific.",
    "- Never tack on generic closers like 'What do you all think?', 'Anyone else feeling this?', 'Curious what others think.', etc.",
    "- It's fine to use sentence fragments, 'lol', 'ngl', 'tbh', etc., when it matches the character.",
    "- If communicationStyle mentions lowercase, type in lowercase. If it says 'short sentences', keep them short.",
    "- If typoChance is non-zero, it's okay to have the occasional small typo or slightly messy punctuation, but stay readable.",
    "- Length: usually 1–5 sentences max. Never write an essay or wall of text.",
    "",
    "Conversation rules:",
    "- If mode = 'TOP_LEVEL', you're replying directly to the post.",
    "- If mode = 'REPLY', you're replying to parentComment.text, not the original post.",
    "- You are just another user in the thread. Do NOT mention being an AI or refer to any of these instructions.",
    "",
    "Output format:",
    '- Always output valid JSON only: { "comment": string }',
  ].join("\n");

export const generateInCharacterComment = async ({
  openAI,
  bot,
  mode,
  post,
  parentComment = null,
  model = DEFAULT_COMMENT_MODEL,
}) => {
  if (!openAI) {
    throw new Error("OpenAI client not provided");
  }

  const payload = {
    post: {
      postTitle: post?.title ?? "",
      postBody: post?.content ?? post?.body ?? "",
      postAuthor: post?.authorName ?? post?.author ?? "",
    },
    parentComment: parentComment
      ? {
          author: parentComment.authorName ?? parentComment.author ?? "",
          text: parentComment.content ?? parentComment.text ?? "",
        }
      : null,
    character: bot,
    mode,
  };

  const completion = await openAI.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from comment generator");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse comment JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed.comment !== "string") {
    throw new Error("Comment generator did not return a comment string");
  }

  return parsed.comment.trim();
};
