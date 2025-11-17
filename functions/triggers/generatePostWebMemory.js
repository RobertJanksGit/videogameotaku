/* global process */

import admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import {
  generateSearchQueriesForPost,
} from "../llm/generateSearchQueries.js";
import { buildPostWebMemory } from "../llm/buildPostWebMemory.js";
import { scrapeSearchResults } from "../scraping/searchScraper.js";
import { getOpenAIClient, openaiSecret } from "../llm/openaiClient.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const DEFAULT_MAX_RESULTS = 3;

const isFeatureEnabled = () =>
  (process.env.POST_WEB_MEMORY_ENABLED ?? "true").toLowerCase() === "true";

const normalizePostForMemory = (postData = {}) => ({
  title: postData.title ?? "",
  body: postData.body ?? postData.content ?? "",
  gameTitle: postData.gameTitle ?? postData.game ?? "",
});

export const generatePostWebMemory = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [openaiSecret],
    memory: "512MiB",
    timeoutSeconds: 300,
    region: "us-central1",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const postId = event.params.postId;
    const postData = snapshot.data() || {};

    if (!isFeatureEnabled()) {
      console.log("[postWebMemory] Disabled via POST_WEB_MEMORY_ENABLED");
      return;
    }

    if ((postData.category ?? "").toLowerCase() !== "news") {
      return;
    }

    const metaRef = db.doc(`posts/${postId}/meta/postWebMemory`);
    const existing = await metaRef.get();
    if (existing.exists) {
      console.log("[postWebMemory] Already exists, skipping", { postId });
      return;
    }

    const post = normalizePostForMemory(postData);
    const openAI = getOpenAIClient();

    let queries = [];
    try {
      queries = await generateSearchQueriesForPost(post, { openAI });
    } catch (error) {
      console.error("[postWebMemory] Query generation failed", {
        postId,
        error: error?.message ?? error,
      });
      return;
    }

    if (!Array.isArray(queries) || !queries.length) {
      console.log("[postWebMemory] No queries generated; skipping", { postId });
      return;
    }

    let scraped = [];
    try {
      scraped = await scrapeSearchResults(queries, {
        maxResultsPerQuery: DEFAULT_MAX_RESULTS,
      });
    } catch (error) {
      console.error("[postWebMemory] Scraping failed", {
        postId,
        error: error?.message ?? error,
      });
    }

    let memory = null;
    try {
      memory = await buildPostWebMemory({ post, scraped }, { openAI });
    } catch (error) {
      console.error("[postWebMemory] Memory build failed", {
        postId,
        error: error?.message ?? error,
      });
    }

    if (!memory) {
      console.log("[postWebMemory] Memory generation returned null", { postId });
      return;
    }

    await metaRef.set({
      ...memory,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      queryCount: queries.length,
      resultCount: scraped.length,
    });

    console.log("[postWebMemory] Stored", {
      postId,
      queryCount: queries.length,
      resultCount: scraped.length,
    });
  }
);
