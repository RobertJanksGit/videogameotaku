/* global process */

import admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { generateSearchQueriesForPost } from "../llm/generateSearchQueries.js";
import { buildPostWebMemory } from "../llm/buildPostWebMemory.js";
import {
  scrapeSearchResults,
  closeBrowser,
} from "../scraping/searchScraper.js";
import { getOpenAIClient, openaiSecret } from "../llm/openaiClient.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const DEFAULT_MAX_RESULTS = 3;
const BATCH_FETCH_LIMIT = 20;
const MAX_POSTS_PER_BATCH = 1;

const isFeatureEnabled = () =>
  (process.env.POST_WEB_MEMORY_ENABLED ?? "true").toLowerCase() === "true";

const getBatchCutoffTimestamp = () => {
  const value = process.env.POST_WEB_MEMORY_MIN_CREATED_AT;
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(
      "[postWebMemory] Invalid POST_WEB_MEMORY_MIN_CREATED_AT; ignoring cutoff"
    );
    return null;
  }

  return admin.firestore.Timestamp.fromDate(parsed);
};

const normalizePostForMemory = (postData = {}) => ({
  title: postData.title ?? "",
  body: postData.body ?? postData.content ?? "",
  gameTitle: postData.gameTitle ?? postData.game ?? "",
});

const extractPostId = (payload = {}) => {
  const candidates = [
    payload?.postId,
    payload?.data?.postId,
    payload?.params?.postId,
  ];
  const resolved = candidates.find(
    (value) => typeof value === "string" && value.trim()
  );
  return resolved ? resolved.trim() : null;
};

const generateWebMemoryForPost = async (postId, payloadPostData = null) => {
  let postData = payloadPostData || null;

  if (!postData) {
    const snapshot = await db.doc(`posts/${postId}`).get();
    if (!snapshot.exists) {
      console.log("[postWebMemory] Post not found; skipping", { postId });
      return;
    }
    postData = snapshot.data() || {};
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

  console.log("[postWebMemory] Starting memory generation", { postId });

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
  } finally {
    await closeBrowser();
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

  const now = admin.firestore.Timestamp.now();
  const ttlDays = 30;
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + ttlDays * 24 * 60 * 60 * 1000
  );

  await metaRef.set({
    ...memory,
    createdAt: now,
    expiresAt,
    queryCount: queries.length,
    resultCount: scraped.length,
  });

  console.log("[postWebMemory] Stored", {
    postId,
    queryCount: queries.length,
    resultCount: scraped.length,
  });
};

export const handleGeneratePostWebMemory = async (payload = {}) => {
  const postId = extractPostId(payload);

  if (!isFeatureEnabled()) {
    console.log("[postWebMemory] Disabled via POST_WEB_MEMORY_ENABLED");
    return;
  }

  if (postId) {
    await generateWebMemoryForPost(postId, payload.postData ?? payload.data);
    return;
  }

  console.log(
    "[postWebMemory] No postId provided; skipping (batch mode disabled)"
  );
};

export const generatePostWebMemory = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [openaiSecret],
    memory: "1GiB",
    timeoutSeconds: 300,
    region: "us-central1",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    await handleGeneratePostWebMemory({
      postId: event.params.postId,
      postData: snapshot.data() || {},
    });
  }
);

const getCleanupTtlDays = () => {
  const raw = process.env.POST_WEB_MEMORY_TTL_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
};

export const cleanupPostWebMemory = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const ttlDays = getCleanupTtlDays();
    const cutoffDate = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

    console.log(
      "[cleanupPostWebMemory] Starting cleanup",
      JSON.stringify({
        ttlDays,
        cutoff: cutoffDate.toISOString(),
      })
    );

    const snapshot = await db
      .collectionGroup("postWebMemory")
      .where("createdAt", "<", cutoffTimestamp)
      .limit(100)
      .get();

    if (snapshot.empty) {
      console.log("[cleanupPostWebMemory] No expired memories found");
      return;
    }

    let deletedCount = 0;
    for (const doc of snapshot.docs) {
      try {
        await doc.ref.delete();
        deletedCount += 1;
      } catch (error) {
        console.error("[cleanupPostWebMemory] Failed to delete doc", {
          path: doc.ref.path,
          error: error?.message ?? error,
        });
      }
    }

    console.log(
      "[cleanupPostWebMemory] Cleanup complete",
      JSON.stringify({
        found: snapshot.size,
        deleted: deletedCount,
        ttlDays,
        cutoff: cutoffDate.toISOString(),
      })
    );
  }
);
