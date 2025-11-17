/* global process */

import { getOpenAIClient } from "./openaiClient.js";

const DEFAULT_MODEL =
  process.env.BOT_WEB_MEMORY_MODEL ||
  process.env.BOT_COMMENT_MODEL ||
  "gpt-4o-mini";

const clampScraped = (scraped = [], limit = 10) =>
  (Array.isArray(scraped) ? scraped : [])
    .map((entry, idx) => ({
      query: entry?.query ?? "",
      title: entry?.title ?? "",
      snippet: entry?.snippet ?? "",
      url: entry?.url ?? "",
      rank: Number.isFinite(entry?.rank) ? entry.rank : idx + 1,
    }))
    .filter((r) => r.url && r.title)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, limit);

const sanitizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const sanitizeStringArray = (values) =>
  Array.isArray(values)
    ? values.map(sanitizeString).filter((v) => v.length > 0)
    : [];

const sanitizeSources = (values) =>
  Array.isArray(values)
    ? values
        .map((entry) => {
          const url = sanitizeString(entry?.url);
          const title = sanitizeString(entry?.title);
          const shortNote = sanitizeString(entry?.shortNote);
          if (!url || !title) return null;
          return {
            url,
            title,
            shortNote: shortNote || title,
          };
        })
        .filter(Boolean)
        .slice(0, 15)
    : [];

const systemPrompt = [
  "You summarize what the broader web is saying about a gaming news post.",
  "You will receive the post content plus scraped search snippets.",
  "Return STRICT JSON matching the schema.",
  "Be concise, hedge speculation, and clearly separate consensus vs rumors.",
  "Never copy text verbatim; paraphrase in neutral, compact phrasing.",
].join("\n");

const buildUserPrompt = (post, scraped) =>
  [
    "POST:",
    `- title: ${post.title || ""}`,
    `- gameTitle: ${post.gameTitle || ""}`,
    `- body: ${post.body || ""}`,
    "",
    "SCRAPED RESULTS (top hits, oldest first by rank):",
    JSON.stringify(scraped, null, 2),
    "",
    "Output JSON shape:",
    `{
  "summary": string,
  "consensus": string,
  "pointsOfDisagreement": string[],
  "rumorsAndUnconfirmed": string[],
  "notableDetails": string[],
  "sources": [{ "url": string, "title": string, "shortNote": string }],
  "generatedAtIso": string
}`,
    "",
    "Guidelines:",
    "- summary: 1-3 tight sentences.",
    "- consensus: what most sources align on (hedged if weak).",
    "- pointsOfDisagreement: polarized takes or conflicting facts.",
    "- rumorsAndUnconfirmed: explicitly label speculative items.",
    "- notableDetails: interesting extras (platforms, release windows, dev quotes).",
    "- sources: pick the most useful URLs with a shortNote on why they matter.",
  ].join("\n");

const validateMemory = (memory) => {
  const summary = sanitizeString(memory?.summary);
  const consensus = sanitizeString(memory?.consensus);
  const pointsOfDisagreement = sanitizeStringArray(
    memory?.pointsOfDisagreement
  );
  const rumorsAndUnconfirmed = sanitizeStringArray(
    memory?.rumorsAndUnconfirmed
  );
  const notableDetails = sanitizeStringArray(memory?.notableDetails);
  const sources = sanitizeSources(memory?.sources);
  const generatedAtIso =
    sanitizeString(memory?.generatedAtIso) || new Date().toISOString();

  if (!summary) return null;

  return {
    summary,
    consensus: consensus || summary,
    pointsOfDisagreement,
    rumorsAndUnconfirmed,
    notableDetails,
    sources,
    generatedAtIso,
  };
};

export const buildPostWebMemory = async (
  { post, scraped },
  options = {}
) => {
  if (!Array.isArray(scraped) || scraped.length === 0) return null;

  const { openAI = getOpenAIClient(), model = DEFAULT_MODEL } = options;
  const postForPrompt = {
    title: post?.title ?? post?.postTitle ?? "",
    body: post?.body ?? post?.content ?? "",
    gameTitle: post?.gameTitle ?? post?.game ?? "",
  };
  const cappedScraped = clampScraped(scraped, 10);

  try {
    const completion = await openAI.chat.completions.create({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: buildUserPrompt(postForPrompt, cappedScraped),
        },
      ],
    });

    const content = completion?.choices?.[0]?.message?.content ?? "";
    if (!content) return null;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      console.warn("[buildPostWebMemory] Failed to parse JSON", {
        error: error?.message ?? error,
      });
      return null;
    }

    return validateMemory(parsed);
  } catch (error) {
    console.error("[buildPostWebMemory] LLM call failed", {
      error: error?.message ?? error,
    });
    return null;
  }
};
