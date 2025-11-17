/* global process */

import puppeteer from "puppeteer-core";

export const DEFAULT_MAX_RESULTS = 3;
const DEFAULT_BASE_URL =
  process.env.SEARCH_ENGINE_BASE_URL || "https://duckduckgo.com/?q=";
const DEFAULT_EXECUTABLE_PATH = "/usr/bin/google-chrome";
const CHROME_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
];

let browserPromise = null;

const getExecutablePath = () =>
  process.env.PUPPETEER_EXECUTABLE_PATH || DEFAULT_EXECUTABLE_PATH;

export const getBrowser = async () => {
  if (browserPromise) return browserPromise;

  const executablePath = getExecutablePath();
  browserPromise = puppeteer
    .launch({
      headless: true,
      executablePath,
      args: CHROME_LAUNCH_ARGS,
    })
    .catch((error) => {
      console.error("[scrapeSearchResults] Failed to launch Chrome", {
        executablePath,
        error: error?.message ?? error,
      });
      browserPromise = null;
      throw error;
    });

  return browserPromise;
};

const buildSearchUrl = (query) => {
  const base = DEFAULT_BASE_URL;
  const placeholder = "{query}";
  if (base.includes(placeholder)) {
    return base.replace(placeholder, encodeURIComponent(query));
  }
  return `${base}${encodeURIComponent(query)}`;
};

const normalizeResult = (result, query) => {
  if (!result) return null;
  const url = typeof result.url === "string" ? result.url.trim() : "";
  const title = typeof result.title === "string" ? result.title.trim() : "";
  const snippet =
    typeof result.snippet === "string" ? result.snippet.trim() : "";
  const rank = Number.isFinite(result.rank) ? result.rank : null;

  if (!url || !title || !rank) return null;
  return { query, title, snippet, url, rank };
};

const dedupeResultsByUrl = (results) => {
  const bestByUrl = new Map();
  for (const result of results) {
    const key = result.url.split("#")[0];
    const existing = bestByUrl.get(key);
    if (!existing || result.rank < existing.rank) {
      bestByUrl.set(key, result);
    }
  }
  return Array.from(bestByUrl.values());
};

export const scrapeSearchResults = async (
  queries,
  options = {}
) => {
  const maxResultsPerQuery =
    Number.isFinite(options.maxResultsPerQuery) && options.maxResultsPerQuery > 0
      ? options.maxResultsPerQuery
      : DEFAULT_MAX_RESULTS;

  if (!Array.isArray(queries) || !queries.length) return [];

  const browser = await getBrowser();
  const allResults = [];

  for (const rawQuery of queries) {
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query) continue;

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(20000);
    page.setDefaultTimeout(15000);

    try {
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
      );

      await page.goto(buildSearchUrl(query), {
        waitUntil: "domcontentloaded",
      });

      // Wait for common DuckDuckGo result selectors; do not throw if missing.
      await page
        .waitForSelector('[data-testid="result"]', { timeout: 8000 })
        .catch(() => page.waitForSelector(".result", { timeout: 6000 }))
        .catch(() => null);

      const results = await page.evaluate((limit) => {
        const collect = (selector) =>
          Array.from(document.querySelectorAll(selector));

        const candidates =
          collect('[data-testid="result"]')?.length > 0
            ? collect('[data-testid="result"]')
            : collect(".result");

        return candidates.slice(0, limit).map((node, idx) => {
          const titleEl =
            node.querySelector('[data-testid="result-title-a"]') ||
            node.querySelector("h2 a") ||
            node.querySelector("a.result__a") ||
            node.querySelector("a");

          const snippetEl =
            node.querySelector('[data-testid="result-snippet"]') ||
            node.querySelector(".result__snippet") ||
            node.querySelector("p");

          const title = titleEl?.textContent?.trim() || "";
          const url = titleEl?.href || "";
          const snippet = snippetEl?.textContent?.trim() || "";

          return {
            title,
            url,
            snippet,
            rank: idx + 1,
          };
        });
      }, maxResultsPerQuery);

      for (const res of results || []) {
        const normalized = normalizeResult(res, query);
        if (normalized) {
          allResults.push(normalized);
        }
      }
    } catch (error) {
      console.warn("[scrapeSearchResults] query failed", {
        query,
        error: error?.message ?? error,
      });
    } finally {
      await page.close().catch(() => null);
    }
  }

  return dedupeResultsByUrl(allResults);
};

export const __testables = {
  dedupeResultsByUrl,
  buildSearchUrl,
};

export const closeBrowser = async () => {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser?.close();
  } catch (error) {
    console.warn("[scrapeSearchResults] failed to close browser", error?.message);
  } finally {
    browserPromise = null;
  }
};
