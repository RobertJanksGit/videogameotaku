import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { generateSearchQueriesForPost } from "../llm/generateSearchQueries.js";
import { buildPostWebMemory } from "../llm/buildPostWebMemory.js";
import {
  __testables as scraperTestables,
  scrapeSearchResults,
  closeBrowser,
} from "../scraping/searchScraper.js";
import { setOpenAIClientForTesting } from "../llm/openaiClient.js";

const makeFakeOpenAI = (payload) => ({
  chat: {
    completions: {
      create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
    },
  },
});

afterEach(() => {
  setOpenAIClientForTesting(null);
});

afterAll(async () => {
  await closeBrowser();
});

describe("generateSearchQueriesForPost", () => {
  it("deduplicates and trims query suggestions", async () => {
    const fakeClient = makeFakeOpenAI({
      queries: ["Halo release date 2025  ", "halo release date 2025", "Halo PC specs"],
    });
    setOpenAIClientForTesting(fakeClient);

    const queries = await generateSearchQueriesForPost({
      title: "Halo Infinite roadmap update",
      body: "343 shared some new roadmap notes.",
    });

    expect(queries).toEqual(["Halo release date 2025", "Halo PC specs"]);
    expect(fakeClient.chat.completions.create).toHaveBeenCalled();
  });
});

describe("buildPostWebMemory", () => {
  it("returns sanitized memory JSON", async () => {
    const fakeClient = makeFakeOpenAI({
      summary: "Most outlets mention a delay.",
      consensus: "Delay seems likely.",
      pointsOfDisagreement: ["Some think only the DLC slips."],
      rumorsAndUnconfirmed: ["Rumors about a new mode."],
      notableDetails: ["PC performance patch incoming."],
      sources: [
        { url: "https://example.com/a", title: "Example A", shortNote: "Delay report" },
      ],
      generatedAtIso: "2024-05-01T00:00:00.000Z",
    });
    setOpenAIClientForTesting(fakeClient);

    const memory = await buildPostWebMemory({
      post: { title: "Game delayed", body: "Reports of a delay." },
      scraped: [
        { query: "game delay", title: "Example A", snippet: "snippet", url: "https://example.com/a", rank: 1 },
      ],
    });

    expect(memory).toMatchObject({
      summary: "Most outlets mention a delay.",
      consensus: "Delay seems likely.",
      pointsOfDisagreement: ["Some think only the DLC slips."],
      rumorsAndUnconfirmed: ["Rumors about a new mode."],
      notableDetails: ["PC performance patch incoming."],
      sources: [{ url: "https://example.com/a", title: "Example A" }],
    });
  });
});

describe("searchScraper helpers", () => {
  it("deduplicates URLs and keeps best rank", () => {
    const deduped = scraperTestables.dedupeResultsByUrl([
      { url: "https://a.com/path", title: "A1", snippet: "", query: "q1", rank: 2 },
      { url: "https://a.com/path#frag", title: "A2", snippet: "", query: "q2", rank: 1 },
      { url: "https://b.com", title: "B", snippet: "", query: "q1", rank: 3 },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.url.startsWith("https://a.com")).rank).toBe(1);
  });

  const runLive = process.env.RUN_LIVE_SCRAPER_TEST === "true";
  (runLive ? it : it.skip)("scrapes a small number of results (live)", async () => {
    const results = await scrapeSearchResults(["zelda trailer"], {
      maxResultsPerQuery: 2,
    });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
});
