/* global process */

import { getOpenAIClient } from "./openaiClient.js";

const DEFAULT_MODEL =
  process.env.BOT_SEARCH_QUERY_MODEL ||
  process.env.BOT_COMMENT_MODEL ||
  "gpt-4o-mini";

const cleanQueries = (values) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(trimmed);
    if (result.length >= 10) break;
  }
  return result;
};

const buildPrompt = (post) =>
  [
    "Generate 5-10 short search engine queries a gamer would type to learn more about this news post.",
    "Be concise (max ~7 words each). Vary the angles: new features, leaks, platforms, release date, reviews/impressions, developer statements, DLC/expansions, performance/PC specs, controversy, esports impact.",
    "Avoid near-duplicates. Prefer specificity over generic phrasing.",
    "",
    "Return strict JSON: { \"queries\": string[] }.",
    "",
    `Title: ${post.title || ""}`,
    `Game: ${post.gameTitle || ""}`,
    `Body: ${post.body || ""}`,
  ].join("\n");

export const generateSearchQueriesForPost = async (post, options = {}) => {
  const { openAI = getOpenAIClient(), model = DEFAULT_MODEL } = options;

  if (!post || (!post.title && !post.body)) {
    return [];
  }

  try {
    const completion = await openAI.chat.completions.create({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You craft concise, distinct search queries for gamers researching a news headline. Always respond as JSON.",
        },
        {
          role: "user",
          content: buildPrompt({
            title: post.title ?? "",
            body: post.body ?? post.content ?? "",
            gameTitle: post.gameTitle ?? post.game ?? "",
          }),
        },
      ],
    });

    const content = completion?.choices?.[0]?.message?.content ?? "";
    if (!content) return [];

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      console.warn("[generateSearchQueriesForPost] Failed to parse JSON", {
        error: error?.message ?? error,
      });
      return [];
    }

    const queries = cleanQueries(parsed?.queries ?? parsed?.data ?? []);
    return queries.slice(0, 10);
  } catch (error) {
    console.error("[generateSearchQueriesForPost] LLM call failed", {
      error: error?.message ?? error,
    });
    return [];
  }
};
