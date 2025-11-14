/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

"use strict";

import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import fetch from "node-fetch";
import { defineInt, defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { Buffer } from "buffer";
import { randomBytes } from "crypto";
import OpenAI from "openai";
import v8 from "v8";
import {
  pingSearchEngines,
  pingSearchEnginesOnUpdate,
  pingGoogle,
  pingBing,
} from "./pingSearchEngines.js";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { generateSitemap } from "./generateSitemap.js";
import normalizeUrl from "./utils/normalizeUrl.js";
import { runBotActivityTick, processScheduledBotActions } from "./bots/index.js";
import {
  buildMentionPayload,
  computeScore,
  createNotificationItem,
  maybeAwardAuthorsPickBadge,
  maybeAwardHelpfulBadge,
  normalizeCommentFields,
  updateUserStatsOnComment,
} from "./engagement.js";

// Define all secrets at the top of the file
const bucketName = defineSecret("STORAGE_BUCKET_NAME");
const validationApiUrl = defineSecret("VALIDATION_API_URL");
const validationPrompt = defineSecret("VALIDATION_PROMPT");
const openaiApiKey = defineSecret("OPENAI_API_KEY");
const newsApiUrl = defineSecret("NEWS_API_URL");
const systemUserId = defineSecret("SYSTEM_USER_ID");
const systemUserIds = defineSecret("SYSTEM_USER_IDS");
const newsUserSupermeeshiId = defineSecret("NEWS_USER_SUPERMEESHI_ID");
const newsUserShakudaId = defineSecret("NEWS_USER_SHAKUDA_ID");
const newsUserBlofuId = defineSecret("NEWS_USER_BLOFU_ID");
const WEBSITE_URL = defineSecret("WEBSITE_URL");
const FACEBOOK_PAGE_ACCESS_TOKEN = defineSecret("FACEBOOK_PAGE_ACCESS_TOKEN");
const SITEMAP_API_KEY = defineSecret("SITEMAP_API_KEY");
const KARMA_SYNC_TOKEN = defineSecret("KARMA_SYNC_TOKEN");

// Import sitemap generation function
import { generateSitemapScheduled } from "./generateSitemapScheduled.js";

// Initialize Firebase Admin with admin privileges and explicit project configuration
admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();

// Define configuration parameters
const requestTimeout = defineInt("REQUEST_TIMEOUT", { default: 5000 }); // 5 seconds
const maxCallsPerMinute = defineInt("MAX_CALLS_PER_MINUTE", { default: 50 });
const maxSystemCallsPerMinute = defineInt("MAX_SYSTEM_CALLS_PER_MINUTE", {
  default: 500,
}); // Higher limit for system operations
const maxTitleLength = defineInt("MAX_TITLE_LENGTH", { default: 200 });
const maxContentLength = defineInt("MAX_CONTENT_LENGTH", { default: 10000 });
const minContentLength = defineInt("MIN_CONTENT_LENGTH", { default: 10 });

const MAX_VALIDATION_ATTEMPTS = 3;
const VALIDATION_RETRY_BASE_DELAY_MS = 1000;
const VALIDATION_FALLBACK_MESSAGE =
  "Our automated review hit a snag. No action needed—moderators will take a look soon.";
const MAX_MODERATION_IMAGE_WIDTH = 1280;
const MAX_MODERATION_IMAGE_BYTES = 450 * 1024; // ~450KB cap for moderation payloads

// Initialize OpenAI client
let openai = null;
const getOpenAIClient = () => {
  if (!openai) {
    openai = new OpenAI({ apiKey: openaiApiKey.value() });
  }
  return openai;
};

// Constants for duplicate detection
const SIMILARITY_THRESHOLD = 0.65;
const RECENT_POSTS_HOURS = 96;
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_CONCURRENT_EMBEDDINGS = 3;
const FUNCTION_TIMEOUT = 540;

// Helper function to standardize text for embedding
const getStandardizedText = (title, content) => {
  // Normalize text to lowercase
  const normalizedTitle = title.toLowerCase();
  const normalizedContent = content.toLowerCase();

  // Remove URLs, special characters, and extra whitespace
  const cleanContent = normalizedContent
    .replace(/\[Source\]\([^)]+\)/g, "") // Remove source links
    .replace(/\[img:[^\]]+\]/g, "") // Remove image tags
    .replace(/https?:\/\/\S+/g, "") // Remove URLs
    .replace(/[^\w\s-]/g, " ") // Replace special chars with space
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  const cleanTitle = normalizedTitle
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Combine title and content with more weight on the title
  return `${cleanTitle} ${cleanTitle} ${cleanContent}`;
};

// Helper function to process in batches with timeout tracking
const processBatch = async (items, batchSize, processor) => {
  const startTime = Date.now();
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    // Check if we're approaching the timeout
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds > FUNCTION_TIMEOUT - 60) {
      // Leave 1 minute buffer
      console.log("Approaching function timeout, returning partial results");
      return results;
    }

    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
    // Increased delay between batches
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return results;
};

// Helper function to get embeddings with retry
const getEmbeddingsWithRetry = async (texts, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const openaiClient = getOpenAIClient();
      const response = await openaiClient.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts.map((text) => text.substring(0, 8000)), // Ensure we don't exceed token limit
      });
      return response.data.map((item) => item.embedding);
    } catch (error) {
      console.error(`Embedding attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) throw error;
      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
};

// Helper function to get embeddings for a batch of texts
const getEmbeddings = async (texts) => {
  try {
    // Process in smaller batches to avoid timeouts
    return await processBatch(
      texts,
      MAX_CONCURRENT_EMBEDDINGS,
      async (batch) => {
        return await getEmbeddingsWithRetry(batch);
      }
    );
  } catch (error) {
    console.error("Error generating embeddings:", error);
    throw error;
  }
};

// Helper function to calculate cosine similarity
const cosineSimilarity = (vecA, vecB) => {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB);
};

// Helper function to check for semantic duplicates
const checkForSemanticDuplicates = async (articles) => {
  try {
    console.log(
      "Starting semantic duplicate check for articles:",
      articles.map((a) => ({
        title: a.title,
        url: a.sourceUrl,
      }))
    );

    // Get recent posts from the last 48 hours
    const cutoffTime = admin.firestore.Timestamp.fromMillis(
      Date.now() - RECENT_POSTS_HOURS * 60 * 60 * 1000
    );

    const recentPostsSnapshot = await db
      .collection("posts")
      .where("createdAt", ">=", cutoffTime)
      .get();

    if (recentPostsSnapshot.empty) {
      console.log("No recent posts found for comparison");
      return new Set();
    }

    console.log(
      `Found ${
        recentPostsSnapshot.size
      } recent posts for comparison. Cutoff time: ${cutoffTime.toDate()}`
    );

    // Get embeddings for recent posts
    const recentPosts = recentPostsSnapshot.docs.map((doc) => ({
      id: doc.id,
      title: doc.data().title,
      content: doc.data().content,
      ...doc.data(),
    }));

    console.log(
      "Recent posts for comparison:",
      recentPosts.map((p) => ({ id: p.id, title: p.title }))
    );

    // Process embeddings in batches of 25 to stay under the 30-item limit
    const BATCH_SIZE = 25;
    const duplicateIds = new Set();

    for (let i = 0; i < recentPosts.length; i += BATCH_SIZE) {
      const batchPosts = recentPosts.slice(i, i + BATCH_SIZE);
      const batchIds = batchPosts.map((post) => post.id);

      // Get embeddings for this batch
      const embeddingsSnapshot = await db
        .collection("postEmbeddings")
        .where("postId", "in", batchIds)
        .get();

      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}, found ${
          embeddingsSnapshot.size
        } embeddings`
      );

      const batchEmbeddings = new Map(
        embeddingsSnapshot.docs.map((doc) => [
          doc.data().postId,
          doc.data().embedding,
        ])
      );

      // Check each article against this batch of embeddings
      for (const article of articles) {
        if (duplicateIds.has(article.sourceUrl)) continue;

        const articleText = getStandardizedText(article.title, article.summary);
        const articleEmbedding = (await getEmbeddings([articleText]))[0];

        let highestSimilarity = 0;
        let mostSimilarPostId = null;
        let mostSimilarTitle = null;

        // Compare with embeddings in this batch
        for (const [postId, existingEmbedding] of batchEmbeddings) {
          const existingPost = batchPosts.find((p) => p.id === postId);
          if (!existingPost) continue;

          const similarity = cosineSimilarity(
            articleEmbedding,
            existingEmbedding
          );

          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            mostSimilarPostId = postId;
            mostSimilarTitle = existingPost.title;
          }

          // Log all high similarity scores (even if below threshold)
          if (similarity >= 0.5) {
            console.log(`High similarity detected (${similarity.toFixed(4)}):`);
            console.log(`New Article: "${article.title}"`);
            console.log(`Existing Post: "${existingPost.title}"`);
            console.log(`Post ID: ${postId}`);
            console.log(
              `Standardized new text: "${getStandardizedText(
                article.title,
                article.summary
              )}"`
            );
            console.log(
              `Standardized existing text: "${getStandardizedText(
                existingPost.title,
                existingPost.content
              )}"`
            );
          }

          if (similarity >= SIMILARITY_THRESHOLD) {
            console.log(`\nDUPLICATE FOUND (${similarity.toFixed(4)}):`);
            console.log(`New Article: "${article.title}"`);
            console.log(`Existing Post: "${existingPost.title}"`);
            console.log(`Post ID: ${postId}`);
            duplicateIds.add(article.sourceUrl);
            break;
          }
        }

        if (!duplicateIds.has(article.sourceUrl)) {
          console.log(
            `Batch ${
              Math.floor(i / BATCH_SIZE) + 1
            } - No duplicates found for "${article.title}"`
          );
          if (mostSimilarTitle) {
            console.log(
              `Highest similarity in this batch: ${highestSimilarity.toFixed(
                4
              )} with "${mostSimilarTitle}" (${mostSimilarPostId})`
            );
          }
        }
      }
    }

    console.log(`\nFinal Results:`);
    console.log(`Total articles processed: ${articles.length}`);
    console.log(`Duplicates found: ${duplicateIds.size}`);
    console.log(
      `Articles to be posted: ${articles.length - duplicateIds.size}`
    );
    console.log(`Duplicate URLs:`, Array.from(duplicateIds));

    return duplicateIds;
  } catch (error) {
    console.error("Error checking for semantic duplicates:", error);
    return new Set();
  }
};

// Security Constants
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const SECURE_TOKEN_LENGTH = 32;

// System user configuration
const systemUserCache = new Map();
let systemUserIdPool = null;
let optionalSystemUserIdsWarningLogged = false;

const getOptionalSecretValue = (secretParam) => {
  try {
    return secretParam.value();
  } catch (error) {
    if (!optionalSystemUserIdsWarningLogged) {
      console.warn("Optional system user IDs secret is not available.", {
        error: error.message,
      });
      optionalSystemUserIdsWarningLogged = true;
    }
    return null;
  }
};

const parseSystemUserIdList = (rawValue) => {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);
    }
  } catch (error) {
    // Fall back to comma-separated parsing
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

const getSystemUserIdPool = () => {
  if (systemUserIdPool) {
    return systemUserIdPool;
  }

  const ids = new Set();

  const optionalIds = parseSystemUserIdList(getOptionalSecretValue(systemUserIds));
  optionalIds.forEach((id) => ids.add(id));

  const defaultId = (() => {
    try {
      return systemUserId.value();
    } catch (error) {
      throw new Error(
        "SYSTEM_USER_ID secret is not configured. At least one system user ID is required."
      );
    }
  })();

  if (defaultId) {
    ids.add(defaultId.trim());
  }

  const resolvedIds = Array.from(ids).filter(Boolean);
  if (resolvedIds.length === 0) {
    throw new Error(
      "No system user IDs configured. Provide SYSTEM_USER_ID or SYSTEM_USER_IDS."
    );
  }

  systemUserIdPool = resolvedIds;
  console.log("Loaded system user ID pool:", resolvedIds);
  return systemUserIdPool;
};

const NEWS_POSTER_SECRET_MAP = {
  SuperMeeshi: {
    secret: newsUserSupermeeshiId,
    secretName: "NEWS_USER_SUPERMEESHI_ID",
  },
  Shakuda: {
    secret: newsUserShakudaId,
    secretName: "NEWS_USER_SHAKUDA_ID",
  },
  Blofu: { secret: newsUserBlofuId, secretName: "NEWS_USER_BLOFU_ID" },
};

const getNewsPosterSystemUserId = (userName) => {
  const normalizedName = (userName || "").trim();
  const posterConfig = NEWS_POSTER_SECRET_MAP[normalizedName];

  if (posterConfig) {
    try {
      const resolvedId = (posterConfig.secret.value() || "").trim();
      if (resolvedId) {
        return resolvedId;
      }
      console.warn(
        `Secret ${posterConfig.secretName} is configured but empty. Falling back to default system user.`
      );
    } catch (error) {
      console.error(
        `Failed to resolve secret ${posterConfig.secretName}. Falling back to default system user.`,
        error
      );
    }
  } else if (normalizedName) {
    console.warn(
      `Unknown news poster "${normalizedName}" received. Falling back to default system user.`
    );
  } else {
    console.warn(
      "No UserName provided in article payload. Falling back to default system user."
    );
  }

  return getSystemUserIdPool()[0];
};

const resolveSystemUserForArticle = async (article) => {
  const candidateUserName = article?.UserName ?? article?.userName ?? "";
  const targetUserId = getNewsPosterSystemUserId(candidateUserName);

  try {
    return await initializeSystemUser(targetUserId);
  } catch (error) {
    console.error(
      `Failed to initialize system user ${targetUserId} for article "${
        article?.title ?? "Untitled"
      }". Attempting fallback.`,
      error
    );

    const fallbackId = getSystemUserIdPool()[0];
    if (!fallbackId || fallbackId === targetUserId) {
      throw error;
    }

    try {
      return await initializeSystemUser(fallbackId);
    } catch (fallbackError) {
      console.error(
        `Fallback system user initialization failed for ID ${fallbackId}.`,
        fallbackError
      );
      throw fallbackError;
    }
  }
};

// Helper function to get system user
const getSystemUser = async (userId = null) => {
  const targetUserId = (userId || "").trim() || getSystemUserIdPool()[0];

  if (systemUserCache.has(targetUserId)) {
    return systemUserCache.get(targetUserId);
  }

  const userDoc = await db.collection("users").doc(targetUserId).get();
  if (!userDoc.exists) {
    throw new Error(`System user not found for ID ${targetUserId}`);
  }

  const systemUser = {
    id: userDoc.id,
    ...userDoc.data(),
  };

  systemUserCache.set(targetUserId, systemUser);
  return systemUser;
};

// Helper function to get bucket
const getBucket = () => {
  return storage.bucket(bucketName.value());
};

// Define rejection-related parameters
const maxRejections = 3;
const rejectionResetHours = 24;
const banDurationHours = 24;

// Security utility functions
const generateSecureToken = () => {
  return randomBytes(SECURE_TOKEN_LENGTH).toString("hex");
};

const fetchWithTimeout = async (
  url,
  options = {},
  timeout = requestTimeout.value()
) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_NEWS_POST_DELAY_MS = 1.5 * 60 * 60 * 1000; // 1 hour 30 minutes
const generateRandomNewsDelayMs = () =>
  Math.floor(Math.random() * (MAX_NEWS_POST_DELAY_MS + 1));

const compressImageForModeration = async (
  buffer,
  contentType = "image/jpeg"
) => {
  if (!buffer || buffer.length === 0) {
    return {
      buffer,
      contentType,
      originalSize: buffer ? buffer.length : 0,
      processedSize: buffer ? buffer.length : 0,
    };
  }

  try {
    const basePipeline = sharp(buffer, { failOnError: false });
    const metadata = await basePipeline.metadata();

    const targetWidth =
      metadata.width && metadata.width > MAX_MODERATION_IMAGE_WIDTH
        ? MAX_MODERATION_IMAGE_WIDTH
        : null;

    const createPipeline = (quality, format = "jpeg") => {
      let pipeline = sharp(buffer, { failOnError: false });

      if (targetWidth) {
        pipeline = pipeline.resize({
          width: targetWidth,
          withoutEnlargement: true,
          fit: "inside",
        });
      }

      switch (format) {
        case "png":
          pipeline = pipeline.png({
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: true,
          });
          break;
        case "webp":
          pipeline = pipeline.webp({ quality, smartSubsample: true });
          break;
        default:
          pipeline = pipeline.jpeg({
            quality,
            mozjpeg: true,
            chromaSubsampling: "4:2:0",
          });
      }

      return pipeline.toBuffer();
    };

    // Start with JPEG quality 80
    let outputBuffer = await createPipeline(80, "jpeg");
    let outputContentType = "image/jpeg";

    const qualitySteps = [70, 60, 50, 40];

    for (const quality of qualitySteps) {
      if (outputBuffer.length <= MAX_MODERATION_IMAGE_BYTES) {
        break;
      }
      outputBuffer = await createPipeline(quality, "jpeg");
    }

    if (outputBuffer.length > MAX_MODERATION_IMAGE_BYTES) {
      // Fallback to WEBP which is usually smaller
      outputBuffer = await createPipeline(75, "webp");
      outputContentType = "image/webp";
    }

    // If still large, one more pass at lower quality webp
    if (outputBuffer.length > MAX_MODERATION_IMAGE_BYTES) {
      outputBuffer = await createPipeline(60, "webp");
      outputContentType = "image/webp";
    }

    return {
      buffer: outputBuffer,
      contentType: outputContentType,
      originalSize: buffer.length,
      processedSize: outputBuffer.length,
      targetWidth,
    };
  } catch (error) {
    console.warn("Image compression failed, falling back to original", {
      error: error.message,
    });
    return {
      buffer,
      contentType,
      originalSize: buffer.length,
      processedSize: buffer.length,
    };
  }
};

const callValidationService = async (apiUrl, payload) => {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    try {
      console.log(
        `Sending payload to validation service (attempt ${attempt} of ${MAX_VALIDATION_ATTEMPTS})`
      );

      const response = await fetchWithTimeout(
        apiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        requestTimeout.value()
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Validation service responded with ${response.status}: ${errorBody}`
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      console.error(
        `Validation service attempt ${attempt} failed: ${error.message}`,
        {
          stack: error.stack,
        }
      );

      if (attempt < MAX_VALIDATION_ATTEMPTS) {
        const backoffDelay = Math.min(
          5000,
          VALIDATION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
        );
        console.log(`Retrying validation after ${backoffDelay}ms delay`);
        await sleep(backoffDelay);
        continue;
      }

      throw lastError;
    }
  }

  throw (
    lastError ||
    new Error("Validation service failed without additional details")
  );
};

const sanitizeContent = (content) => {
  // Remove potential XSS vectors and sanitize content
  return content
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/javascript:/gi, "") // Remove javascript: protocols
    .replace(/data:/gi, "") // Remove data: URLs
    .replace(/vbscript:/gi, ""); // Remove vbscript: protocols
};

const safeParseJson = (value) => {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("Failed to parse JSON string from moderation service", {
      error: error.message,
      value,
    });
    return null;
  }
};

const toBoolean = (value) => {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized.length === 0) {
      return null;
    }

    const truthyValues = new Set([
      "true",
      "1",
      "yes",
      "y",
      "approve",
      "approved",
      "accept",
      "accepted",
      "allow",
      "allowed",
      "pass",
      "passed",
      "valid",
      "safe",
      "clean",
      "publish",
      "published",
      "ok",
      "okay",
    ]);

    const falsyValues = new Set([
      "false",
      "0",
      "no",
      "n",
      "reject",
      "rejected",
      "deny",
      "denied",
      "block",
      "blocked",
      "ban",
      "banned",
      "fail",
      "failed",
      "invalid",
      "unsafe",
      "flag",
      "flagged",
    ]);

    if (truthyValues.has(normalized)) return true;
    if (falsyValues.has(normalized)) return false;
  }

  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
  }

  return null;
};

const extractModerationDecision = (result) => {
  const candidateObjects = [];
  const addCandidate = (candidate) => {
    if (!candidate) return;
    if (typeof candidate === "string") {
      const parsed = safeParseJson(candidate);
      if (parsed && typeof parsed === "object") {
        candidateObjects.push(parsed);
      }
      return;
    }
    if (typeof candidate === "object") {
      candidateObjects.push(candidate);
    }
  };

  addCandidate(result);
  addCandidate(result?.details);
  addCandidate(result?.details?.analysis);
  addCandidate(result?.message);

  let decision = typeof result?.isValid === "boolean" ? result.isValid : null;
  let reason = typeof result?.message === "string" ? result.message : null;
  let structuredReason = null;
  let aggregatedDetails = null;

  const decisionKeys = [
    "isValid",
    "isvalid",
    "valid",
    "approved",
    "isApproved",
    "allow",
    "allowed",
  ];

  for (const candidate of candidateObjects) {
    if (!candidate || typeof candidate !== "object") continue;

    for (const key of decisionKeys) {
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue;
      const candidateDecision = toBoolean(candidate[key]);
      if (candidateDecision === null) continue;

      if (decision === null) {
        decision = candidateDecision;
      } else if (decision !== candidateDecision) {
        console.warn("Conflicting moderation decisions detected", {
          previousDecision: decision,
          overridingDecision: candidateDecision,
          candidate,
        });
        // Prefer the safest option (reject if any signal says false)
        decision = decision && candidateDecision;
      }
      break;
    }

    if (!reason && typeof candidate.message === "string") {
      reason = candidate.message;
    }

    if (!reason && typeof candidate.reason === "string") {
      reason = candidate.reason;
    }

    if (
      !structuredReason &&
      typeof candidate === "object" &&
      (candidate.message || candidate.reason)
    ) {
      structuredReason = candidate;
    }

    if (!aggregatedDetails) {
      aggregatedDetails = candidate;
    } else if (typeof aggregatedDetails !== "object") {
      aggregatedDetails = {
        value: aggregatedDetails,
        additional: candidate,
      };
    }
  }

  return {
    decision,
    reason,
    structuredReason,
    aggregatedDetails,
  };
};

// Helper function to validate content
function validateContent(title, content) {
  if (
    !title ||
    typeof title !== "string" ||
    title.length > maxTitleLength.value()
  ) {
    throw new Error(
      `Title must be between 1 and ${maxTitleLength.value()} characters`
    );
  }

  // Extract actual text content without image tags for length validation
  const textContent = content.replace(/\[img:.*?\|.*?\]/g, "");

  if (
    !textContent ||
    typeof textContent !== "string" ||
    textContent.length > maxContentLength.value() ||
    textContent.length < minContentLength.value()
  ) {
    throw new Error(
      `Content must be between ${minContentLength.value()} and ${maxContentLength.value()} characters (excluding images)`
    );
  }

  // Validate image URLs in content
  const imageMatches = content.match(/\[img:(.*?)\|/g) || [];
  for (const match of imageMatches) {
    const url = match.slice(5, -1); // Remove [img: and |
    if (!url.startsWith("https://firebasestorage.googleapis.com/")) {
      throw new Error("Invalid image URL detected in content");
    }
  }
}

// Helper function to check rate limits
async function checkRateLimit(userId, operationType = "default") {
  if (!userId) {
    console.error("No userId provided for rate limit check");
    return false;
  }

  const now = Date.now();
  const limitKey = `ratelimit_${userId}_${operationType}`;
  const rateLimitRef = db.collection("rateLimits").doc(limitKey);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);

      if (!doc.exists) {
        transaction.set(rateLimitRef, {
          count: 1,
          resetTime: now + 60000, // 1 minute
        });
        return true;
      }

      const data = doc.data();
      if (now > data.resetTime) {
        transaction.set(rateLimitRef, {
          count: 1,
          resetTime: now + 60000,
        });
        return true;
      }

      // Use different limits based on operation type
      const limit =
        operationType === "system"
          ? maxSystemCallsPerMinute.value()
          : maxCallsPerMinute.value();
      if (data.count >= limit) {
        return false;
      }

      // Update count using admin.firestore.FieldValue.increment
      transaction.update(rateLimitRef, {
        count: admin.firestore.FieldValue.increment(1),
      });

      return true;
    });

    return result;
  } catch (error) {
    console.error("Rate limit check failed:", error);
    return false; // Changed to return false on error for safety
  }
}

// Post validation function with sitemap regeneration
export const validatePost = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [validationApiUrl, validationPrompt, newsApiUrl, WEBSITE_URL],
    maxInstances: 10,
    memory: "512MiB",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return;
    }

    const postId = event.params.postId;
    const data = snapshot.data();
    let statusUpdated = false;
    let finalStatus = data?.status ?? "pending";

    // Skip validation for already published posts
    if (data.status === "published") {
      console.log(`Post ${postId} is already published, skipping validation`);
      return;
    }

    if (data.status === "scheduled") {
      const scheduledTime =
        data.publishAt && typeof data.publishAt.toDate === "function"
          ? data.publishAt.toDate().toISOString()
          : data.publishAt ?? "future";
      console.log(
        `Post ${postId} is scheduled for ${scheduledTime}, skipping validation until publish`
      );
      return;
    }

    try {
      // Log the original post data for debugging
      console.log("Original post data:", JSON.stringify(data, null, 2));

      const apiUrl = validationApiUrl.value();
      const prompt = validationPrompt.value();

      if (!apiUrl) {
        console.warn(
          "VALIDATION_API_URL is not configured. Leaving post pending for manual review."
        );

        await db
          .collection("posts")
          .doc(postId)
          .update({
            status: "pending",
            moderationMessage:
              "Awaiting manual moderation. AI validation service not configured.",
            moderationDetails: {
              reason: "validation_service_not_configured",
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        return;
      }

      const payload = {
        prompt,
        title: data.title,
        content: data.content,
      };

      if (data.imageUrl && typeof data.imageUrl === "string") {
        try {
          const imageResponse = await fetchWithTimeout(
            data.imageUrl,
            {},
            10000
          );

          if (imageResponse.ok) {
            const contentType =
              imageResponse.headers.get("content-type") || "image/jpeg";
            const originalBuffer = Buffer.from(
              await imageResponse.arrayBuffer()
            );

            const {
              buffer: compressedBuffer,
              contentType: moderationContentType,
              originalSize,
              processedSize,
              targetWidth,
            } = await compressImageForModeration(originalBuffer, contentType);

            payload.image = compressedBuffer.toString("base64");
            payload.imageContentType = moderationContentType;
            payload.imageMetadata = {
              originalBytes: originalSize,
              moderationBytes: processedSize,
              resizedToWidth: targetWidth || null,
            };

            console.log(
              "Prepared image for moderation",
              JSON.stringify(payload.imageMetadata)
            );
          } else {
            console.warn(
              `Unable to fetch image for moderation. Status: ${imageResponse.status} ${imageResponse.statusText}`
            );
          }
        } catch (imageError) {
          console.error("Error fetching image for moderation:", imageError);
        }
      }

      const result = await callValidationService(apiUrl, payload);
      console.log("Validation response:", JSON.stringify(result, null, 2));

      const { decision, reason, structuredReason, aggregatedDetails } =
        extractModerationDecision(result);

      if (decision === null) {
        throw new Error("Validation service did not provide a clear decision");
      }

      let parsedStructuredReason = null;
      let moderationMessage = null;

      if (typeof reason === "string" && reason.trim()) {
        const parsedReason = safeParseJson(reason.trim());
        if (parsedReason && typeof parsedReason === "object") {
          parsedStructuredReason = parsedReason;
          if (typeof parsedReason.message === "string") {
            moderationMessage = parsedReason.message.trim();
          } else if (typeof parsedReason.reason === "string") {
            moderationMessage = parsedReason.reason.trim();
          } else {
            moderationMessage = JSON.stringify(parsedReason);
          }
        } else {
          moderationMessage = reason.trim();
        }
      }

      if (!moderationMessage && structuredReason) {
        parsedStructuredReason =
          parsedStructuredReason ||
          (typeof structuredReason === "object" ? structuredReason : null);

        const structuredMessage =
          typeof structuredReason?.message === "string"
            ? structuredReason.message
            : typeof structuredReason?.reason === "string"
            ? structuredReason.reason
            : null;

        if (structuredMessage && structuredMessage.trim()) {
          moderationMessage = structuredMessage.trim();
        }
      }

      const isApproved = decision === true;

      if (!moderationMessage) {
        moderationMessage = isApproved
          ? "Approved by automated moderation."
          : "Rejected by automated moderation.";
      }

      const detailCandidates = [];

      if (
        parsedStructuredReason &&
        typeof parsedStructuredReason === "object"
      ) {
        detailCandidates.push(parsedStructuredReason);
      }

      if (
        aggregatedDetails &&
        typeof aggregatedDetails === "object" &&
        Object.keys(aggregatedDetails).length > 0
      ) {
        detailCandidates.push(aggregatedDetails);
      } else if (typeof aggregatedDetails === "string") {
        const parsedAggregated = safeParseJson(aggregatedDetails);
        if (parsedAggregated) {
          detailCandidates.push(parsedAggregated);
        } else {
          detailCandidates.push({ summary: aggregatedDetails });
        }
      }

      const mergedDetails = detailCandidates.reduce((acc, candidate) => {
        if (!candidate || typeof candidate !== "object") return acc;
        for (const [key, value] of Object.entries(candidate)) {
          if (value === undefined) continue;
          if (acc[key] === undefined) {
            acc[key] = value;
          }
        }
        return acc;
      }, {});

      mergedDetails.rawResponse = result;

      const moderationUpdate = {
        status: isApproved ? "published" : "rejected",
        moderationMessage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        moderationSource: "ai",
      };

      if (Object.keys(mergedDetails).length > 0) {
        moderationUpdate.moderationDetails = mergedDetails;
      } else {
        moderationUpdate.moderationDetails =
          admin.firestore.FieldValue.delete();
      }

      if (!isApproved) {
        console.log("Post rejected by automated moderation", {
          postId,
          moderationMessage,
        });
      }

      await db.collection("posts").doc(postId).update(moderationUpdate);
      statusUpdated = true;
      finalStatus = moderationUpdate.status;

      console.log(
        `Post ${postId} validation complete. Status: ${moderationUpdate.status}`
      );

      if (isApproved) {
        // After post is published, regenerate sitemap with debouncing
        try {
          await regenerateSitemapWithDebounce();
        } catch (sitemapError) {
          console.error(
            "Error regenerating sitemap after moderation:",
            sitemapError
          );
        }

        // Ping search engines after sitemap is updated
        try {
          const websiteUrl = normalizeUrl(WEBSITE_URL.value());
          await pingGoogle(`${websiteUrl}/sitemap.xml`);
          console.log("Successfully pinged Google with updated sitemap");
        } catch (pingError) {
          console.error("Error pinging search engines:", pingError);
        }
      }
    } catch (error) {
      console.error("Error validating post:", error);

      if (statusUpdated) {
        console.error(
          `Post ${postId} moderation status already set to ${finalStatus}. Skipping rollback to pending.`
        );
        return;
      }

      const errorDetails = {
        status: "pending",
        moderationMessage: VALIDATION_FALLBACK_MESSAGE,
        moderationDetails: {
          reason: "validation_error",
          error: error.message,
          retryAttempts: MAX_VALIDATION_ATTEMPTS,
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        validatedAt: admin.firestore.FieldValue.delete(),
      };

      await db.collection("posts").doc(postId).update(errorDetails);
    }
  }
);

// Handle post status changes for rate limiting
export const onPostStatusChange = onDocumentUpdated(
  {
    document: "posts/{postId}",
    maxInstances: 10,
  },
  async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();

    // Only process changes to rejected status
    if (oldData.status === newData.status || newData.status !== "rejected") {
      return;
    }

    // Log the post data before any changes
    console.log(
      "Post data before status change:",
      JSON.stringify(newData, null, 2)
    );

    const userId = newData.authorId;
    const rateLimitRef = db.collection("rateLimits").doc(userId);

    try {
      await db.runTransaction(async (transaction) => {
        const rateLimitDoc = await transaction.get(rateLimitRef);
        const now = db.Timestamp.now();

        if (!rateLimitDoc.exists) {
          // Only update rate limit document, not the post
          transaction.set(rateLimitRef, {
            recentRejections: 1,
            lastRejectionTime: now,
          });
          return;
        }

        const rateLimitData = rateLimitDoc.data();
        const updates = {
          recentRejections: (rateLimitData.recentRejections || 0) + 1,
          lastRejectionTime: now,
        };

        // Check if user should be banned
        if (updates.recentRejections >= maxRejections) {
          const banDurationMs = banDurationHours * 60 * 60 * 1000;
          updates.bannedUntil = db.Timestamp.fromMillis(
            now.toMillis() + banDurationMs
          );
        }

        // Only update rate limit document, not the post
        transaction.update(rateLimitRef, updates);
      });

      console.log(`Updated rate limit for user ${userId}`);

      // Verify post data wasn't changed
      const postRef = event.data.after.ref;
      const updatedPost = await postRef.get();
      const updatedData = updatedPost.data();

      // Verify author information was preserved
      if (
        updatedData.authorId !== newData.authorId ||
        updatedData.authorEmail !== newData.authorEmail ||
        updatedData.authorName !== newData.authorName ||
        updatedData.authorPhotoURL !== newData.authorPhotoURL
      ) {
        console.error(
          "Author information changed during status update!",
          "Original:",
          {
            id: newData.authorId,
            email: newData.authorEmail,
            name: newData.authorName,
            photoURL: newData.authorPhotoURL,
          },
          "Updated:",
          {
            id: updatedData.authorId,
            email: updatedData.authorEmail,
            name: updatedData.authorName,
            photoURL: updatedData.authorPhotoURL,
          }
        );
      }
    } catch (error) {
      console.error("Error updating rate limit:", error);
    }
  }
);

const computePostUpvotes = (postData = {}) => {
  if (typeof postData.upvoteCount === "number") {
    return Math.max(postData.upvoteCount, 0);
  }

  if (Array.isArray(postData.usersThatLiked)) {
    return postData.usersThatLiked.length;
  }

  if (typeof postData.totalVotes === "number") {
    return Math.max(postData.totalVotes, 0);
  }

  return 0;
};

export const syncAuthorKarma = onDocumentWritten(
  {
    document: "posts/{postId}",
    maxInstances: 10,
    timeoutSeconds: 120,
  },
  async (event) => {
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;

    const beforeExists = beforeSnapshot?.exists ?? false;
    const afterExists = afterSnapshot?.exists ?? false;

    const beforeData = beforeExists ? beforeSnapshot.data() : null;
    const afterData = afterExists ? afterSnapshot.data() : null;

    const affectedAuthors = new Set();
    if (beforeData?.authorId) {
      affectedAuthors.add(beforeData.authorId);
    }
    if (afterData?.authorId) {
      affectedAuthors.add(afterData.authorId);
    }

    if (affectedAuthors.size === 0) {
      console.log("syncAuthorKarma: No author found for post", {
        postId: event.params.postId,
      });
      return;
    }

    const relevantChange = (() => {
      if (!beforeData || !afterData) {
        return true;
      }

      const arraysChanged = (beforeValue, afterValue) => {
        const beforeArray = Array.isArray(beforeValue) ? beforeValue : [];
        const afterArray = Array.isArray(afterValue) ? afterValue : [];
        if (beforeArray.length !== afterArray.length) {
          return true;
        }
        return beforeArray.some((value, index) => value !== afterArray[index]);
      };

      if (arraysChanged(beforeData.usersThatLiked, afterData.usersThatLiked)) {
        return true;
      }

      if (
        arraysChanged(beforeData.usersThatDisliked, afterData.usersThatDisliked)
      ) {
        return true;
      }

      if (
        (beforeData.upvoteCount ?? null) !== (afterData.upvoteCount ?? null)
      ) {
        return true;
      }

      if ((beforeData.totalVotes ?? null) !== (afterData.totalVotes ?? null)) {
        return true;
      }

      if ((beforeData.status ?? null) !== (afterData.status ?? null)) {
        return true;
      }

      return false;
    })();

    if (!relevantChange) {
      return;
    }

    await Promise.all(
      Array.from(affectedAuthors).map(async (authorId) => {
        try {
          const postsSnapshot = await db
            .collection("posts")
            .where("authorId", "==", authorId)
            .get();

          let totalUpvotes = 0;

          postsSnapshot.forEach((docSnap) => {
            const postData = docSnap.data() || {};
            const status = postData.status ?? "published";
            if (status !== "published") {
              return;
            }

            totalUpvotes += computePostUpvotes(postData);
          });

          const safeUpvotes = Math.max(Number(totalUpvotes) || 0, 0);
          const totalXp = safeUpvotes * 10;

          const profileRef = db.collection("profiles").doc(authorId);
          const profileSnap = await profileRef.get();

          if (profileSnap.exists) {
            const profileData = profileSnap.data() || {};
            const currentKarma = Number.isFinite(profileData.karma)
              ? profileData.karma
              : 0;

            if (currentKarma !== totalXp) {
              await profileRef.update({ karma: totalXp });
            }
          }

          const userRef = db.collection("users").doc(authorId);
          const userSnap = await userRef.get();

          if (userSnap.exists) {
            const userData = userSnap.data() || {};
            const currentUserKarma = Number.isFinite(userData.karma)
              ? userData.karma
              : 0;

            if (currentUserKarma !== totalXp) {
              await userRef.update({ karma: totalXp });
            }
          }

          console.log("syncAuthorKarma: Updated karma", {
            authorId,
            totalUpvotes: safeUpvotes,
            totalXp,
          });
        } catch (error) {
          console.error(
            `syncAuthorKarma: Failed to update karma for author ${authorId}`,
            error
          );
        }
      })
    );
  }
);

export const recalculateAllKarma = onRequest(
  {
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [KARMA_SYNC_TOKEN],
  },
  async (req, res) => {
    const authHeader = req.get("authorization") || "";
    const providedToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const expectedToken = KARMA_SYNC_TOKEN.value();

    if (!expectedToken) {
      res.status(500).json({ error: "KARMA_SYNC_TOKEN is not configured" });
      return;
    }

    if (!providedToken || providedToken !== expectedToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const postsSnapshot = await db.collection("posts").get();
      const authorUpvotes = new Map();

      postsSnapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const status = data.status ?? "published";
        const authorId = data.authorId;

        if (status !== "published" || !authorId) {
          return;
        }

        const upvotes = computePostUpvotes(data);
        const current = authorUpvotes.get(authorId) || 0;
        authorUpvotes.set(authorId, current + upvotes);
      });

      let profilesUpdated = 0;
      let usersUpdated = 0;

      for (const [authorId, upvotes] of authorUpvotes.entries()) {
        const safeUpvotes = Math.max(Number(upvotes) || 0, 0);
        const totalXp = safeUpvotes * 10;

        const profileRef = db.collection("profiles").doc(authorId);
        await profileRef.set({ karma: totalXp }, { merge: true });
        profilesUpdated += 1;

        const userRef = db.collection("users").doc(authorId);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          await userRef.update({ karma: totalXp });
          usersUpdated += 1;
        }

        console.log("recalculateAllKarma: Updated author", {
          authorId,
          upvotes: safeUpvotes,
          xp: totalXp,
        });
      }

      res.json({
        authorsProcessed: authorUpvotes.size,
        profilesUpdated,
        usersUpdated,
      });
    } catch (error) {
      console.error("recalculateAllKarma failed", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Add scheduled function to check and reset rejection counts
export const checkRejectionResets = onSchedule(
  {
    schedule: "0 * * * *", // Run at the start of every hour
    maxInstances: 1,
    region: "us-central1",
    memory: "512MiB",
    timeZone: "UTC",
    retryCount: 3,
    minBackoff: "10s",
    maxBackoff: "60s",
    timeoutSeconds: 120, // Increased to 2 minutes
    secrets: [systemUserId, systemUserIds],
    labels: {
      "deployment-scheduled": "true",
    },
  },
  async () => {
    console.log("Starting checkRejectionResets function");
    const startTime = Date.now();

    try {
      // Initialize system user first with timeout
      const userPromise = getSystemUser();
      const userTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("System user fetch timeout")), 10000)
      );

      const SYSTEM_USER = await Promise.race([userPromise, userTimeout]);
      if (!SYSTEM_USER) {
        throw new Error("Failed to initialize system user");
      }

      console.log("Successfully initialized system user:", SYSTEM_USER.id);

      const now = admin.firestore.Timestamp.now();
      const resetTimeInMs = rejectionResetHours * 60 * 60 * 1000;
      const resetThreshold = admin.firestore.Timestamp.fromMillis(
        now.toMillis() - resetTimeInMs
      );

      console.log(
        `Checking for rate limits older than ${rejectionResetHours} hours from ${resetThreshold.toDate()}`
      );

      // Add timeout for the Firestore query
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout")), 30000)
      );

      // Use transaction for the query to ensure consistency
      const queryPromise = db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(
          db
            .collection("rateLimits")
            .where("recentRejections", ">", 0)
            .where("lastRejectionTime", "<=", resetThreshold)
        );
        return snapshot;
      });

      const snapshot = await Promise.race([queryPromise, timeoutPromise]);

      if (snapshot.empty) {
        const endTime = Date.now();
        console.log(
          `No rate limits to reset. Function completed in ${
            (endTime - startTime) / 1000
          }s`
        );
        return;
      }

      console.log(`Found ${snapshot.size} rate limits to reset`);

      // Process in smaller batches to avoid timeouts
      const batchSize = 100;
      const batches = [];
      let processedCount = 0;

      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        // Check if we're approaching the timeout
        if ((Date.now() - startTime) / 1000 > 90) {
          // 90 second safety margin
          console.warn("Approaching function timeout, saving progress");
          break;
        }

        const batch = db.batch();
        const batchDocs = snapshot.docs.slice(i, i + batchSize);

        batchDocs.forEach((doc) => {
          const currentData = doc.data();
          console.log(`Preparing to reset rate limit for document: ${doc.id}`, {
            currentRejections: currentData.recentRejections,
            lastRejectionTime: currentData.lastRejectionTime?.toDate(),
          });

          batch.update(doc.ref, {
            recentRejections: 0,
            bannedUntil: null,
            lastResetTime: now,
            updatedBy: SYSTEM_USER.id,
            previousRejections: currentData.recentRejections, // Keep track of previous value
            resetReason: `Automated reset after ${rejectionResetHours} hours`,
          });
        });

        batches.push(batch);
        processedCount += batchDocs.length;
      }

      // Execute all batches with individual timeouts
      await Promise.all(
        batches.map((batch, index) => {
          console.log(`Committing batch ${index + 1} of ${batches.length}`);
          return Promise.race([
            batch.commit(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Batch ${index + 1} timeout`)),
                20000
              )
            ),
          ]);
        })
      );

      const endTime = Date.now();
      console.log(
        `Successfully reset ${processedCount} rate limits in ${batches.length} batches. ` +
          `Function completed in ${(endTime - startTime) / 1000}s`
      );

      // Log summary statistics
      console.log("Function execution summary:", {
        totalDocumentsFound: snapshot.size,
        documentsProcessed: processedCount,
        batchesExecuted: batches.length,
        executionTimeSeconds: (endTime - startTime) / 1000,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error in checkRejectionResets:", error);

      // Log additional error details
      if (error.code) {
        console.error("Error code:", error.code);
      }
      if (error.details) {
        console.error("Error details:", error.details);
      }

      // Log execution context
      console.error("Execution context at error:", {
        executionTimeSeconds: (Date.now() - startTime) / 1000,
        timestamp: new Date().toISOString(),
      });

      // Re-throw specific errors that should trigger retries
      if (
        error.code === "DEADLINE_EXCEEDED" ||
        error.code === "UNAVAILABLE" ||
        error.message.includes("timeout")
      ) {
        throw error;
      }

      // For other errors, log but don't retry
      console.error("Non-retryable error encountered:", error);
    }
  }
);

// Add scheduled function to fetch and save posts
export const fetchAndSavePosts = onSchedule(
  {
    schedule: "0 2,6,10,14,18,22 * * *",
    maxInstances: 1,
    secrets: [
      systemUserId,
      systemUserIds,
      bucketName,
      openaiApiKey,
      newsApiUrl,
      newsUserSupermeeshiId,
      newsUserShakudaId,
      newsUserBlofuId,
    ],
    timeoutSeconds: FUNCTION_TIMEOUT,
    memory: "2GiB",
    region: "us-central1",
    timeZone: "UTC",
    retryCount: 3,
    minBackoff: "60s",
    maxBackoff: "300s",
    labels: {
      "deployment-scheduled": "true",
      "function-type": "news-fetcher",
      "memory-intensive": "true",
    },
  },
  async () => {
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    let executionRef;
    let lastSuccessfulArticle = null;
    let lastMemoryUsage = 0;
    let memoryGrowthRate = [];

    // Enhanced memory tracking
    const getDetailedMemoryUsage = () => {
      const heapStats = v8.getHeapStatistics();
      const heapUsed = Math.round(heapStats.used_heap_size / 1024 / 1024);

      // Track memory growth
      if (lastMemoryUsage > 0) {
        const growth = heapUsed - lastMemoryUsage;
        memoryGrowthRate.push(growth);
      }
      lastMemoryUsage = heapUsed;

      return {
        heapUsed,
        heapTotal: Math.round(heapStats.total_heap_size / 1024 / 1024),
        heapLimit: Math.round(heapStats.heap_size_limit / 1024 / 1024),
        physicalTotal: Math.round(heapStats.total_physical_size / 1024 / 1024),
        available: Math.round(
          (heapStats.heap_size_limit - heapStats.used_heap_size) / 1024 / 1024
        ),
        growthRate:
          memoryGrowthRate.length > 0
            ? memoryGrowthRate.reduce((a, b) => a + b, 0) /
              memoryGrowthRate.length
            : 0,
      };
    };

    // Memory cleanup helper
    const cleanupMemory = async () => {
      try {
        console.log("Memory cleanup started:", new Date().toISOString());

        // Clear any large objects from memory
        const largeObjects = [
          "openai",
          "imageData",
          "responseData",
          "articles",
        ];
        largeObjects.forEach((obj) => {
          try {
            if (typeof this[obj] !== "undefined") {
              this[obj] = null;
            }
          } catch (e) {
            // Ignore errors for individual objects
          }
        });

        // Small delay to allow natural GC to occur
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.log("Memory cleanup completed:", new Date().toISOString());
      } catch (error) {
        console.warn("Memory cleanup attempt failed:", error);
      }
    };

    const initialMemory = getDetailedMemoryUsage() || {
      heapUsed: 0,
      heapTotal: 0,
      heapLimit: 0,
      physicalTotal: 0,
      available: 0,
      growthRate: 0,
    };
    console.log("Initial memory state:", initialMemory);

    try {
      console.log("Starting fetchAndSavePosts execution");

      // Initialize execution tracking with enhanced memory info
      executionRef = db.collection("functionExecutions").doc();
      await executionRef.set({
        functionName: "fetchAndSavePosts",
        startTime: admin.firestore.Timestamp.fromMillis(startTime),
        status: "initializing",
        lastSuccessfulArticle: null,
        memoryUsage: initialMemory,
        recoveryAttempt: 0,
        systemUserMode: "per_article",
      });

      await executionRef.update({
        status: "fetching_articles",
      });

      // Fetch articles with improved error handling and longer timeout
      const articles = await fetchArticlesWithRetry(3);
      if (!articles?.length) {
        await executionRef.update({
          status: "completed",
          endTime: admin.firestore.Timestamp.now(),
          finalSuccessCount: 0,
          finalErrorCount: 1,
          executionTimeSeconds: (Date.now() - startTime) / 1000,
          finalMemoryUsage: getDetailedMemoryUsage() || initialMemory,
          error: {
            message: "No articles fetched",
            code: "NO_ARTICLES",
            timestamp: admin.firestore.Timestamp.now(),
          },
        });
        return;
      }

      console.log(`Fetched ${articles.length} articles`);
      await executionRef.update({
        status: "processing",
        totalArticles: articles.length,
      });

      // Check for semantic duplicates first
      console.log("Checking for semantic duplicates...");
      const semanticDuplicates = await checkForSemanticDuplicates(articles);
      console.log(`Found ${semanticDuplicates.size} semantic duplicates`);

      // Filter out duplicates before processing
      const uniqueArticles = articles.filter(
        (article) => !semanticDuplicates.has(article.sourceUrl)
      );
      console.log(`Processing ${uniqueArticles.length} unique articles`);

      // Process articles in smaller batches with memory monitoring
      const BATCH_SIZE = 3;
      for (let i = 0; i < uniqueArticles.length; i += BATCH_SIZE) {
        const memoryBeforeBatch = getDetailedMemoryUsage();
        console.log(
          `Memory before batch ${i / BATCH_SIZE + 1}:`,
          memoryBeforeBatch
        );

        // Check for concerning memory growth
        if (memoryBeforeBatch.growthRate > 50) {
          // More than 50MB average growth
          console.warn(
            "Detected significant memory growth, attempting cleanup"
          );
          await cleanupMemory();
        }

        // If memory usage is too high or growth rate is concerning, save progress and exit
        if (
          memoryBeforeBatch.heapUsed > 1800 ||
          memoryBeforeBatch.growthRate > 100
        ) {
          console.warn("Memory usage critical, saving progress and exiting");
          await executionRef.update({
            status: "paused",
            lastProcessedIndex: i,
            memoryUsage: memoryBeforeBatch,
            lastSuccessfulArticle,
            memoryGrowthRate: memoryBeforeBatch.growthRate,
          });
          return;
        }

        const batch = uniqueArticles.slice(i, i + BATCH_SIZE);

        // Process batch
        await processArticleBatch(
          batch,
          executionRef,
          startTime,
          (article) => {
            lastSuccessfulArticle = article;
            successCount++;
          },
          () => errorCount++
        );

        // Cleanup after each batch
        await cleanupMemory();

        // Update progress
        const currentMemory = getDetailedMemoryUsage();
        await executionRef.update({
          currentBatch: Math.floor(i / BATCH_SIZE) + 1,
          totalBatches: Math.ceil(uniqueArticles.length / BATCH_SIZE),
          successCount,
          errorCount,
          lastSuccessfulArticle,
          lastUpdateTime: admin.firestore.Timestamp.now(),
          currentMemoryUsage: currentMemory,
          memoryGrowthRate: currentMemory.growthRate,
        });
      }

      // Final cleanup and update
      const finalMemory = (await cleanupMemory()) || initialMemory;
      await executionRef.update({
        status: "completed",
        endTime: admin.firestore.Timestamp.now(),
        finalSuccessCount: successCount || 0,
        finalErrorCount: errorCount || 0,
        executionTimeSeconds: (Date.now() - startTime) / 1000,
        finalMemoryUsage: finalMemory,
        averageMemoryGrowth:
          memoryGrowthRate.length > 0
            ? memoryGrowthRate.reduce((a, b) => a + b, 0) /
              memoryGrowthRate.length
            : 0,
      });

      console.log(
        `Completed successfully. Success: ${successCount}, Errors: ${errorCount}`
      );
      console.log("Final memory state:", finalMemory);
    } catch (error) {
      console.error("Error in fetchAndSavePosts:", error);

      // Enhanced error logging with memory state
      const currentMemory = getDetailedMemoryUsage() || {
        heapUsed: 0,
        heapTotal: 0,
        heapLimit: 0,
        physicalTotal: 0,
        available: 0,
        growthRate: 0,
      };

      const errorDetails = {
        message: error.message || "Unknown error",
        code: error.code || "UNKNOWN_ERROR",
        stack: error.stack || "",
        timestamp: admin.firestore.Timestamp.now(),
        memoryUsage: currentMemory,
        executionTime: (Date.now() - startTime) / 1000,
      };

      if (executionRef) {
        try {
          const cleanedMemory = (await cleanupMemory()) || currentMemory;
          await executionRef.update({
            status: "failed",
            error: errorDetails,
            endTime: admin.firestore.Timestamp.now(),
            lastSuccessfulArticle: lastSuccessfulArticle || null,
            finalSuccessCount: successCount || 0,
            finalErrorCount: errorCount || 0,
            memoryState: cleanedMemory,
          });
        } catch (updateError) {
          console.error("Failed to update execution status:", updateError);
        }
      }

      // Only retry on specific errors and if memory growth isn't the issue
      if (
        (error.code === "DEADLINE_EXCEEDED" ||
          error.code === "RESOURCE_EXHAUSTED" ||
          error.message.includes("timeout")) &&
        !error.message.includes("memory")
      ) {
        throw error; // Trigger retry
      }
    }
  }
);

export const publishScheduledAggregatorPosts = onSchedule(
  {
    schedule: "* * * * *",
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    timeZone: "UTC",
  },
  async () => {
    let processed = 0;
    const pageSize = 20;

    while (true) {
      const nowTimestamp = admin.firestore.Timestamp.now();
      const snapshot = await db
        .collection("posts")
        .where("status", "==", "scheduled")
        .where("publishAt", "<=", nowTimestamp)
        .orderBy("publishAt", "asc")
        .limit(pageSize)
        .get();

      if (snapshot.empty) {
        break;
      }

      const batch = db.batch();
      const publishTimestamp = admin.firestore.Timestamp.now();

      snapshot.docs.forEach((doc) => {
        const scheduledPublishAt = doc.get("publishAt") || null;

        const updateData = {
          status: "published",
          createdAt: publishTimestamp,
          updatedAt: publishTimestamp,
          publishedAt: publishTimestamp,
        };

        if (scheduledPublishAt) {
          updateData.scheduledPublishAt = scheduledPublishAt;
          updateData.publishAt = admin.firestore.FieldValue.delete();
        }

        batch.update(doc.ref, updateData);
      });

      await batch.commit();
      processed += snapshot.size;

      if (snapshot.size < pageSize) {
        break;
      }
    }

    if (processed > 0) {
      console.log(
        `publishScheduledAggregatorPosts published ${processed} scheduled posts`
      );
    } else {
      console.log("publishScheduledAggregatorPosts found no posts to publish");
    }
  }
);

// Helper function to initialize system user with retry
async function initializeSystemUser(targetUserId, maxRetries = 3) {
  if (!targetUserId) {
    throw new Error("No system user ID provided for initialization");
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      const userPromise = getSystemUser(targetUserId);
      const userTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("System user fetch timeout")), 10000)
      );
      return await Promise.race([userPromise, userTimeout]);
    } catch (error) {
      console.error(
        `System user initialization attempt ${i + 1} failed:`,
        error
      );
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, i) * 1000)
      );
    }
  }
}

// Helper function to fetch articles with retry
async function fetchArticlesWithRetry(maxRetries = 3) {
  // Initial wake up call
  try {
    console.log("Making initial wake-up call to the API");
    await fetch(`${newsApiUrl.value()}`);
    console.log(
      "Wake-up call completed, waiting 60 seconds before first attempt"
    );
    await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 1 minute
  } catch (error) {
    console.log("Wake-up call failed, proceeding with normal retry flow");
  }

  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(
        `Attempting to fetch articles (attempt ${i + 1}/${maxRetries})`
      );

      // Use direct fetch like test endpoint
      const response = await fetch(`${newsApiUrl.value()}`);

      if (!response.ok) {
        console.error(
          `API Response Status: ${response.status} ${response.statusText}`
        );
        console.error(
          `API Response Headers:`,
          Object.fromEntries(response.headers.entries())
        );
        const errorText = await response.text();
        console.error(`API Error Response:`, errorText);
        throw new Error(
          `API request failed with status ${response.status} - ${response.statusText}`
        );
      }

      const responseData = await response.json();
      if (
        !responseData ||
        !responseData.data ||
        !Array.isArray(responseData.data)
      ) {
        throw new Error("Invalid API response format");
      }

      console.log(`Successfully fetched ${responseData.data.length} articles`);
      return responseData.data;
    } catch (error) {
      console.error(`Article fetch attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) throw error;

      // Wait 60 seconds between retries
      console.log("Waiting 60 seconds before next attempt...");
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }
}

// Update the processArticleBatch function to be more memory-conscious
async function processArticleBatch(
  articles,
  executionRef,
  startTime,
  onSuccess,
  onError
) {
  for (const article of articles) {
    try {
      // Check for timeout
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      if (elapsedSeconds > FUNCTION_TIMEOUT - 60) {
        console.log("Approaching timeout, saving progress");
        return false;
      }

      let systemUser;
      try {
        systemUser = await resolveSystemUserForArticle(article);
        if (systemUser) {
          article.assignedSystemUserId = systemUser.id;
        }
        console.log(
          `Resolved system user for article "${article.title}": ${
            systemUser?.id ?? "unknown"
          } (requested by ${article?.UserName ?? article?.userName ?? "N/A"})`
        );
      } catch (error) {
        console.error(
          `Unable to resolve system user for article "${article.title}". Skipping.`,
          error
        );
        onError();
        continue;
      }

      if (!systemUser) {
        console.error(
          `System user resolution returned null for article "${article.title}". Skipping.`
        );
        onError();
        continue;
      }

      // Skip articles without images
      if (!article.imageUrl) {
        console.log(`Skipping article without image: ${article.title}`);
        onError();
        continue;
      }

      const publishDelayMs = generateRandomNewsDelayMs();
      const publishAtTimestamp =
        publishDelayMs > 0
          ? admin.firestore.Timestamp.fromMillis(Date.now() + publishDelayMs)
          : null;
      article.publishDelayMs = publishDelayMs;
      if (publishAtTimestamp) {
        console.log(
          `Scheduling article "${article.title}" to publish at ${publishAtTimestamp
            .toDate()
            .toISOString()}`
        );
      } else {
        console.log(
          `Publishing article "${article.title}" immediately (no delay)`
        );
      }

      // Process image
      console.log(`Processing image for article: ${article.title}`);
      try {
        article.imageData = await processImage(article.imageUrl, systemUser);
        await cleanupMemory(); // Clean up after image processing
      } catch (error) {
        console.error(
          `Error processing image for article ${article.title}:`,
          error
        );
        console.log(
          `Skipping article due to image processing failure: ${article.title}`
        );
        onError();
        continue; // Skip this article and move to the next one
      }

      // Generate embeddings with cleanup
      const embedding = await generateEmbedding(article);
      await cleanupMemory(); // Clean up after embedding generation

      // Create post only if we have valid image data
      if (article.imageData) {
        await createPost(article, systemUser, embedding, {
          publishAt: publishAtTimestamp,
        });
        onSuccess(article);
      } else {
        console.log(
          `Skipping article creation due to missing image data: ${article.title}`
        );
        onError();
      }
    } catch (error) {
      console.error(`Error processing article: ${article.title}`, error);
      onError();
    }
  }
  return true;
}

// Helper functions for article processing
async function processImage(imageUrl, SYSTEM_USER) {
  try {
    console.log(`Starting image processing for URL: ${imageUrl}`);

    const imageResponse = await fetchWithTimeout(imageUrl);
    if (!imageResponse.ok) {
      const errorDetails = {
        status: imageResponse.status,
        statusText: imageResponse.statusText,
        headers: Object.fromEntries(imageResponse.headers.entries()),
      };
      console.error(
        `Failed to download image from ${imageUrl}. Details:`,
        errorDetails
      );
      throw new Error(
        `Image download failed: ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    const contentType = imageResponse.headers.get("content-type");
    console.log(`Image content type: ${contentType}`);

    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      console.error(
        `Unsupported image type: ${contentType}. Allowed types: ${ALLOWED_MIME_TYPES.join(
          ", "
        )}`
      );
      throw new Error(`Unsupported image type: ${contentType}`);
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    console.log(`Image size: ${imageBuffer.length} bytes`);

    if (imageBuffer.length > MAX_IMAGE_SIZE) {
      console.error(
        `Image size (${imageBuffer.length} bytes) exceeds limit of ${MAX_IMAGE_SIZE} bytes`
      );
      throw new Error(`Image size exceeds limit of ${MAX_IMAGE_SIZE} bytes`);
    }

    const timestamp = Date.now();
    const secureToken = generateSecureToken();
    const fileName = `post-images/${timestamp}_${imageUrl.split("/").pop()}`;

    const file = getBucket().file(fileName);
    await file.save(imageBuffer, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: secureToken,
          userId: SYSTEM_USER.id,
          originalUrl: imageUrl,
          uploadTimestamp: timestamp.toString(),
        },
      },
    });

    console.log(`Successfully processed and stored image: ${fileName}`);

    return {
      url: `https://firebasestorage.googleapis.com/v0/b/${
        getBucket().name
      }/o/${encodeURIComponent(fileName)}?alt=media&token=${secureToken}`,
      path: fileName,
      contentType: contentType,
    };
  } catch (error) {
    console.error("Error processing image:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

async function generateEmbedding(article) {
  try {
    const embedding = await getEmbeddings([
      `${article.title} ${article.summary}`,
    ]);
    return embedding[0];
  } catch (error) {
    console.error("Error generating embedding:", error);
    return null;
  }
}

const SOCIAL_EMBED_HOSTS = {
  youtube: ["youtube.com", "youtu.be"],
  twitter: ["twitter.com", "x.com"],
};

const hostMatchesDomain = (host, domain) =>
  host === domain || host.endsWith(`.${domain}`);

function getSocialEmbedType(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (
      SOCIAL_EMBED_HOSTS.youtube.some((domain) =>
        hostMatchesDomain(host, domain)
      )
    ) {
      return "youtube";
    }

    if (
      SOCIAL_EMBED_HOSTS.twitter.some((domain) =>
        hostMatchesDomain(host, domain)
      )
    ) {
      return "twitter";
    }
  } catch (error) {
    console.warn("Invalid social URL provided for embed:", rawUrl, error);
    return null;
  }

  return null;
}

function buildSocialEmbedSnippet(rawUrl) {
  const socialUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!socialUrl) return null;

  const embedType = getSocialEmbedType(socialUrl);
  if (!embedType) return null;

  return `{{embed type="${embedType}" url="${socialUrl}"}}`;
}

function buildPostContent(article) {
  const baseContent = `${article.summary}`;
  const sourceSection = `[Source](${article.sourceUrl})`;
  const embedSnippet = buildSocialEmbedSnippet(article.socialUrl);

  if (embedSnippet) {
    return `${baseContent}\n\n${embedSnippet}\n\n${sourceSection}`;
  }

  return `${baseContent}\n\n${sourceSection}`;
}

async function createPost(article, SYSTEM_USER, embedding, options = {}) {
  const { publishAt: requestedPublishAt } = options;

  // Validate and sanitize content
  const contentWithSource = buildPostContent(article);
  const sanitizedContent = sanitizeContent(contentWithSource);
  await validateContent(article.title, sanitizedContent);

  // Check rate limit
  if (!(await checkRateLimit(SYSTEM_USER.id, "system"))) {
    throw new Error("Rate limit exceeded");
  }

  // Create post
  const timestamp = admin.firestore.Timestamp.now();
  const publishAtIsTimestamp =
    requestedPublishAt instanceof admin.firestore.Timestamp;
  const isScheduled = publishAtIsTimestamp;
  const publishAt = publishAtIsTimestamp ? requestedPublishAt : null;

  const postData = {
    title: article.title,
    content: sanitizedContent,
    category: "news",
    platforms: article.platforms || [],
    authorId: SYSTEM_USER.id,
    authorName: SYSTEM_USER.name,
    authorEmail: SYSTEM_USER.email,
    authorPhotoURL: SYSTEM_USER.photoURL,
    imageUrl: article.imageData?.url || null,
    imagePath: article.imageData?.path || null,
    imageContentType: article.imageData?.contentType || null,
    sourceUrl: article.sourceUrl,
    sourceName: "Gaming News Aggregator",
    createdAt: timestamp,
    updatedAt: timestamp,
    usersThatLiked: [],
    usersThatDisliked: [],
    totalVotes: 0,
    status: isScheduled ? "scheduled" : "published",
    type: "news",
    lastEditedBy: SYSTEM_USER.name,
    lastEditedById: SYSTEM_USER.id,
  };

  if (article.imageData) {
    postData.imageUrl = article.imageData.url || null;
    postData.imagePath = article.imageData.path || null;
    postData.imageContentType = article.imageData.contentType || null;
  }

  if (isScheduled) {
    postData.publishAt = publishAt;
    postData.scheduledAt = timestamp;
  } else {
    postData.publishedAt = timestamp;
  }

  // Create the post
  const docRef = await db.collection("posts").add(postData);

  // Store embedding if available
  if (embedding) {
    await db
      .collection("postEmbeddings")
      .doc(docRef.id)
      .set({
        postId: docRef.id,
        embedding: embedding,
        standardizedText: getStandardizedText(article.title, article.summary),
        createdAt: timestamp,
      });
  }

  return docRef;
}

// Add HTTP trigger for testing
export const testFetchAndSavePosts = onRequest(
  {
    maxInstances: 1,
    secrets: [
      systemUserId,
      systemUserIds,
      bucketName,
      openaiApiKey,
      newsApiUrl,
      newsUserSupermeeshiId,
      newsUserShakudaId,
      newsUserBlofuId,
    ],
    timeoutSeconds: FUNCTION_TIMEOUT,
    memory: "1GiB",
  },
  async (req, res) => {
    // Set security headers
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("X-XSS-Protection", "1; mode=block");
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.set("Content-Security-Policy", "default-src 'self'");

    console.log("Starting test endpoint execution");
    try {
      let successCount = 0;
      let errorCount = 0;

      console.log("Testing API connection...");
      const response = await fetch(`${newsApiUrl.value()}`);

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const responseData = await response.json();
      if (
        !responseData ||
        !responseData.data ||
        !Array.isArray(responseData.data)
      ) {
        throw new Error("Invalid API response format");
      }

      const articles = responseData.data;
      console.log(`Fetched ${articles.length} articles`);

      // Check for semantic duplicates first
      console.log("Checking for semantic duplicates...");
      const semanticDuplicates = await checkForSemanticDuplicates(articles);
      console.log(`Found ${semanticDuplicates.size} semantic duplicates`);

      // Filter out duplicates before processing
      const uniqueArticles = articles.filter(
        (article) => !semanticDuplicates.has(article.sourceUrl)
      );
      console.log(`Processing ${uniqueArticles.length} unique articles`);

      // Process each unique article
      for (const article of uniqueArticles) {
        try {
          const systemUser = await resolveSystemUserForArticle(article);
          if (!systemUser) {
            console.warn(
              `Skipping article "${article.title}" because no system user could be resolved.`
            );
            errorCount++;
            continue;
          }

          const publishDelayMs = generateRandomNewsDelayMs();
          const publishAtTimestamp =
            publishDelayMs > 0
              ? admin.firestore.Timestamp.fromMillis(
                  Date.now() + publishDelayMs
                )
              : null;
          article.publishDelayMs = publishDelayMs;
          if (publishAtTimestamp) {
            console.log(
              `Scheduling article "${article.title}" to publish at ${publishAtTimestamp
                .toDate()
                .toISOString()}`
            );
          } else {
            console.log(
              `Publishing article "${article.title}" immediately (no delay)`
            );
          }

          // Handle image if it exists
          let imageData = null;
          if (article.imageUrl) {
            console.log(`Processing image for article: ${article.title}`);
            try {
              imageData = await processImage(article.imageUrl, systemUser);
              article.imageData = imageData;
              await cleanupMemory(); // Clean up after image processing
            } catch (error) {
              console.error(
                `Error processing image for article ${article.title}:`,
                error
              );
            }
          }

          const embedding = await generateEmbedding(article);
          await cleanupMemory();

          await createPost(article, systemUser, embedding, {
            publishAt: publishAtTimestamp,
          });

          // createPost handles validation, rate limiting, and embedding storage

          console.log(
            `Successfully created post for article "${article.title}"`
          );
          successCount++;
        } catch (error) {
          console.error(`Error processing article: ${article.title}`, error);
          errorCount++;
        }
      }

      res.json({
        success: true,
        message: `Processed ${uniqueArticles.length} unique articles. Success: ${successCount}, Errors: ${errorCount}, Duplicates skipped: ${semanticDuplicates.size}`,
      });
    } catch (error) {
      console.error("Error in testFetchAndSavePosts:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Memory management helper function
async function cleanupMemory() {
  try {
    console.log("Memory cleanup started:", new Date().toISOString());

    // Clear any large objects from memory
    const largeObjects = ["openai", "imageData", "responseData", "articles"];
    largeObjects.forEach((obj) => {
      try {
        if (typeof this[obj] !== "undefined") {
          this[obj] = null;
        }
      } catch (e) {
        // Ignore errors for individual objects
      }
    });

    // Small delay to allow natural GC to occur
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log("Memory cleanup completed:", new Date().toISOString());
  } catch (error) {
    console.warn("Memory cleanup attempt failed:", error);
  }
}

// Update the Facebook auto-posting function
export const autoPostToFacebook = onDocumentWritten(
  {
    document: "posts/{postId}",
    secrets: [FACEBOOK_PAGE_ACCESS_TOKEN, WEBSITE_URL],
    maxInstances: 10,
  },
  async (event) => {
    console.log("autoPostToFacebook function triggered");
    let pageId = null;

    // Validate configurations immediately
    try {
      if (!FACEBOOK_PAGE_ACCESS_TOKEN.value()) {
        throw new Error("Facebook Page Access Token is not configured");
      }

      // Validate website URL format
      try {
        // Use the normalizeUrl helper function to ensure proper URL format
        const websiteUrl = normalizeUrl(WEBSITE_URL.value());

        // Validate the normalized URL
        new URL(websiteUrl);

        console.log("Website URL validated successfully");
      } catch (e) {
        throw new Error("Invalid Website URL configuration");
      }

      // Get the page ID and verify access
      const pageResponse = await fetch(
        `https://graph.facebook.com/v19.0/me?fields=id,access_token`,
        {
          headers: {
            Authorization: `Bearer ${FACEBOOK_PAGE_ACCESS_TOKEN.value()}`,
          },
        }
      );

      if (!pageResponse.ok) {
        const errorData = await pageResponse.json();
        throw new Error(
          `Invalid Facebook token or page access: ${
            errorData.error?.message || "Token validation failed"
          }`
        );
      }

      const pageData = await pageResponse.json();
      pageId = pageData.id;
      console.log("Successfully retrieved Facebook Page ID:", pageId);

      // Verify the token works for posting
      const testResponse = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}?fields=id,name`,
        {
          headers: {
            Authorization: `Bearer ${FACEBOOK_PAGE_ACCESS_TOKEN.value()}`,
          },
        }
      );

      if (!testResponse.ok) {
        const errorData = await testResponse.json();
        throw new Error(
          `Cannot access page with token: ${
            errorData.error?.message || "Access verification failed"
          }`
        );
      }

      const testData = await testResponse.json();
      console.log("Successfully verified page access for:", testData.name);
    } catch (error) {
      console.error("Configuration validation failed:", error);
      throw error;
    }

    // Ensure we have the after data
    if (!event.data.after || !event.data.after.exists) {
      console.log("Document was deleted, skipping");
      return;
    }

    // Get the document data
    const afterData = event.data.after.data();
    const beforeData = event.data.before?.exists
      ? event.data.before.data()
      : null;

    // Log the event details
    console.log("Post event details:", {
      postId: event.params.postId,
      beforeStatus: beforeData?.status,
      afterStatus: afterData?.status,
      isNewPost: !event.data.before?.exists,
      hasImage: !!afterData.imageUrl,
    });

    // Only proceed for published posts
    if (afterData.status !== "published") {
      console.log("Post is not published, skipping");
      return;
    }

    // Check if this is a new post or status changed to published
    const isNewPublishedPost = !beforeData && afterData.status === "published";
    const isStatusChangedToPublished =
      beforeData &&
      beforeData.status !== "published" &&
      afterData.status === "published";

    if (!isNewPublishedPost && !isStatusChangedToPublished) {
      console.log("Skipping - not a new or newly published post");
      return;
    }

    try {
      // Prepare the post URL
      const websiteUrl = normalizeUrl(WEBSITE_URL.value());
      const postUrl = `${websiteUrl.replace(/\/$/, "")}/post/${
        event.params.postId
      }`;

      // Clean and prepare post content by removing markdown links and normalizing whitespace
      const rawContent =
        typeof afterData.content === "string" ? afterData.content : "";

      if (!rawContent) {
        console.warn(
          "Post content missing or not a string, using title only for Facebook message"
        );
      }

      const cleanContent = rawContent
        .replace(/\[Source\]\([^)]+\)/g, "")
        .replace(/\[.*?\]\(.*?\)/g, "")
        .replace(/\n+/g, " ")
        .trim();

      // Create a shorter teaser for Facebook to entice click-through
      // Limit to 40-50 words for better readability on Facebook
      const words = cleanContent.split(" ");
      const teaser =
        words.slice(0, 40).join(" ") + (words.length > 40 ? "..." : "");

      // Create the Facebook post message with the shorter teaser
      const message = `${afterData.title}\n\n${teaser}\n\nRead more: ${postUrl}`;

      // Facebook Graph API expects URL-encoded form data
      const postData = new URLSearchParams({
        message,
        link: postUrl,
      });

      console.log("Final Facebook post data:", {
        hasMessage: postData.has("message"),
        hasLink: postData.has("link"),
        postUrl: postUrl,
        pageId: pageId,
      });

      // Create the post
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/feed`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FACEBOOK_PAGE_ACCESS_TOKEN.value()}`,
          },
          body: postData,
        }
      );

      const responseText = await response.text();
      console.log("Raw Facebook post response:", responseText);

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        console.error("Failed to parse post response:", e);
        throw new Error(`Invalid response from Facebook: ${responseText}`);
      }

      if (!response.ok) {
        throw new Error(
          `Facebook API error: ${
            responseData.error?.message || "Unknown error"
          }`
        );
      }

      console.log("Successfully posted to Facebook:", {
        postId: event.params.postId,
        facebookPostId: responseData.id,
        title: afterData.title,
      });

      // Update the post with Facebook post ID
      await event.data.after.ref.update({
        facebookPostId: responseData.id,
        lastFacebookPost: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("Error posting to Facebook:", {
        error: error.message,
        stack: error.stack,
        postId: event.params.postId,
      });

      // Store the error in the post document
      await event.data.after.ref.update({
        facebookPostError: {
          message: error.message,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      throw error;
    }
  }
);

// Export the social media metadata function
export { socialMediaMetaTags } from "./socialMediaMetaTags.js";

// Export the scheduled sitemap generation function
export { generateSitemapScheduled };

// Export the new pingSearchEngines functions
export { pingSearchEngines, pingSearchEnginesOnUpdate };

/**
 * HTTP-triggered function that allows manual regeneration of the sitemap
 * and pinging of search engines via a simple API endpoint.
 *
 * This can be called using:
 * curl -X POST https://updateindexing-[region]-[project-id].cloudfunctions.net/
 */
export const updateIndexing = onRequest(
  {
    maxInstances: 1,
    timeoutSeconds: 300, // 5 minute timeout for sitemap generation
    secrets: [SITEMAP_API_KEY, WEBSITE_URL],
  },
  async (req, res) => {
    try {
      // Only allow POST requests
      if (req.method !== "POST") {
        res
          .status(405)
          .send("Method Not Allowed: Only POST requests are supported");
        return;
      }

      console.log("Manual sitemap generation and search engine ping triggered");

      // Get API key from request (improved security with Firebase secret)
      const apiKey = req.query.key || req.headers["x-api-key"];

      // Check against the Firebase secret
      if (!apiKey || apiKey !== SITEMAP_API_KEY.value()) {
        res.status(403).send("Unauthorized: Invalid or missing API key");
        return;
      }

      // Execute sitemap generation using our direct implementation
      try {
        await generateSitemap();
        console.log("Sitemap generated successfully");
      } catch (error) {
        console.error("Error generating sitemap:", error);
        throw error;
      }

      // Ping Google and Bing to let them know about the updated sitemap
      try {
        const websiteUrl = normalizeUrl(WEBSITE_URL.value());
        await pingGoogle(`${websiteUrl}/sitemap.xml`);
        await pingBing(`${websiteUrl}/sitemap.xml`);
        console.log("Search engines pinged successfully");
      } catch (error) {
        console.error("Error pinging search engines:", error);
        throw error;
      }

      res.status(200).send({
        success: true,
        message: "Sitemap generated and search engines notified successfully",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error in manual indexing update:", error);
      res.status(500).send({
        success: false,
        message: "Error processing request",
        error: error.message,
      });
    }
  }
);

// Implement debounced sitemap regeneration
async function regenerateSitemapWithDebounce() {
  const lockRef = db.collection("sitemapLocks").doc("lastGeneration");
  const minDelayMs = 5 * 60 * 1000; // 5 minutes

  try {
    // Use a transaction to ensure atomic read-write operation
    const result = await db.runTransaction(async (transaction) => {
      const lockDoc = await transaction.get(lockRef);
      const now = Date.now();

      if (lockDoc.exists) {
        const lastGenerated = lockDoc.data().timestamp.toMillis();
        if (now - lastGenerated < minDelayMs) {
          console.log(
            "Skipping sitemap regeneration: Recent generation detected within 5 minutes"
          );
          return {
            regenerate: false,
            lastGenerated: new Date(lastGenerated),
          };
        }
      }

      // Update the lock with current timestamp
      transaction.set(lockRef, {
        timestamp: admin.firestore.Timestamp.now(),
        updatedBy: "validatePost function",
      });

      return {
        regenerate: true,
        lastGenerated: lockDoc.exists
          ? new Date(lockDoc.data().timestamp.toMillis())
          : null,
      };
    });

    if (result.regenerate) {
      console.log("Lock acquired, generating sitemap...");
      try {
        // Generate the sitemap directly with our enhanced implementation
        await generateSitemap();

        // Success! Update the lock with completion status
        await lockRef.update({
          completedAt: admin.firestore.Timestamp.now(),
          status: "success",
        });

        console.log("Sitemap regeneration completed successfully");
      } catch (genError) {
        console.error("Error generating sitemap:", genError);

        // Update lock with error status
        await lockRef.update({
          completedAt: admin.firestore.Timestamp.now(),
          status: "error",
          error: genError.message,
        });

        throw genError;
      }
    } else {
      console.log(
        `Sitemap generation skipped. Last generated: ${result.lastGenerated}`
      );
    }
  } catch (error) {
    console.error("Error in regenerateSitemapWithDebounce:", error);
    throw error;
  }
}

// Prerender function for SPA SEO optimization
export const prerender = onRequest(
  {
    maxInstances: 10,
    memory: "1GiB",
    timeoutSeconds: 60,
    secrets: [WEBSITE_URL],
  },
  async (req, res) => {
    try {
      // Set security headers
      res.set("X-Content-Type-Options", "nosniff");
      res.set("X-Frame-Options", "DENY");
      res.set("X-XSS-Protection", "1; mode=block");
      res.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
      res.set("Content-Security-Policy", "default-src 'self'");

      // Get user agent and check if it's a crawler
      const userAgent = req.get("User-Agent") || "";
      const isCrawler =
        /bot|googlebot|crawler|spider|robot|crawling|slurp|bingbot|yandex|duckduckbot|baiduspider/i.test(
          userAgent
        );

      // If not a crawler, redirect to the SPA route
      if (!isCrawler) {
        const websiteUrl = normalizeUrl(WEBSITE_URL.value());
        res.redirect(`${websiteUrl}${req.path}`);
        return;
      }

      console.log(`Prerendering page for crawler: ${userAgent}`);
      console.log(`Requested path: ${req.path}`);

      // Launch headless browser to render the page
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      try {
        const page = await browser.newPage();

        // Set a crawler user agent to ensure proper rendering
        await page.setUserAgent(
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
        );

        // Set viewport to ensure proper rendering
        await page.setViewport({
          width: 1200,
          height: 800,
        });

        // Construct the full URL to render
        const websiteUrl = normalizeUrl(WEBSITE_URL.value());
        const url = `${websiteUrl}${req.path}`;
        console.log(`Rendering URL: ${url}`);

        // Navigate to the page and wait for network to be idle
        await page.goto(url, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });

        // Additional wait for SPA to fully render
        await page.waitForTimeout(2000);

        // Get the rendered HTML
        const content = await page.content();

        // Send the prerendered content
        res.set("Content-Type", "text/html");
        res.set("Cache-Control", "public, max-age=300"); // Cache for 5 minutes
        res.status(200).send(content);
        console.log(`Successfully prerendered: ${url}`);
      } finally {
        // Always close the browser
        await browser.close();
      }
    } catch (error) {
      console.error("Error in prerender function:", error);

      // Return fallback content for crawlers
      res.status(500).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Video Game Otaku</title>
          <meta name="description" content="Video Game Otaku - Your source for video game news, reviews, guides and opinions">
        </head>
        <body>
          <h1>Video Game Otaku</h1>
          <p>We're experiencing technical difficulties. Please try again later.</p>
        </body>
        </html>
      `);
    }
  }
);



export const runBotActivityScheduler = onSchedule(
  {
    schedule: "*/5 * * * *",
    maxInstances: 1,
    memory: "512MiB",
    timeZone: "UTC",
  },
  async () => {
    try {
      const stats = await runBotActivityTick({
        db,
        now: Date.now(),
      });
      const breakdown =
        stats.breakdown ?? {
          inactive_window: 0,
          cooldown: 0,
          no_targets: 0,
          below_threshold: 0,
          scheduled: 0,
        };
      const summary = {
        botsProcessed: stats.botsProcessed ?? 0,
        actionsScheduled: stats.actionsScheduled ?? 0,
        breakdown,
      };
      console.log("Bot activity tick completed", summary);
      console.log(
        JSON.stringify({
          type: "bot_activity_summary",
          ...summary,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      console.error("Bot activity tick failed", error);
      throw error;
    }
  }
);

export const processBotScheduledActions = onSchedule(
  {
    schedule: "*/5 * * * *",
    maxInstances: 1,
    memory: "512MiB",
    timeZone: "UTC",
    secrets: [openaiApiKey],
  },
  async () => {
    try {
      const stats = await processScheduledBotActions({
        db,
        openAI: getOpenAIClient(),
        limit: 20,
        logger: console,
      });
      console.log("Bot scheduled actions processed", stats);
    } catch (error) {
      console.error("Bot scheduled action processor failed", error);
      throw error;
    }
  }
);

const getCommentRefs = (postId, commentId) => {
  const postRef = db.collection("posts").doc(postId);
  const commentRef = postRef.collection("comments").doc(commentId);
  const legacyCommentRef = db.collection("comments").doc(commentId);
  return { postRef, commentRef, legacyCommentRef };
};

const normalizeDocPath = (path) => {
  if (typeof path !== "string") {
    return "";
  }
  return path.replace(/^\/+/, "");
};

const resolveCommentDocRef = async ({
  commentPath,
  postId,
  commentId,
} = {}) => {
  const attemptDoc = async (path) => {
    if (!path) {
      return null;
    }
    const ref = db.doc(path);
    try {
      const snapshot = await ref.get();
      return snapshot.exists ? ref : null;
    } catch (error) {
      console.warn("resolveCommentDocRef get failed", {
        path,
        error: error.message,
      });
      return null;
    }
  };

  if (commentPath) {
    const normalizedPath = normalizeDocPath(commentPath);
    const directRef = await attemptDoc(normalizedPath);
    if (directRef) {
      return directRef;
    }
  }

  if (postId && commentId) {
    const nestedPath = `posts/${postId}/comments/${commentId}`;
    const nestedRef = await attemptDoc(nestedPath);
    if (nestedRef) {
      return nestedRef;
    }

    const legacyPath = `comments/${commentId}`;
    const legacyRef = await attemptDoc(legacyPath);
    if (legacyRef) {
      return legacyRef;
    }
  }

  return null;
};

const getNotificationSnippet = (content = "") =>
  content.length > 140 ? `${content.slice(0, 137)}...` : content;

export const onCommentWrite = onDocumentWritten(
  "posts/{postId}/comments/{commentId}",
  async (event) => {
    const { postId, commentId } = event.params;
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;

    if (!after) {
      return;
    }

    const commentRef = event.data.after.ref;
    const normalized = normalizeCommentFields(after);
    const updates = {};

    if (!normalized.threadRootCommentId) {
      updates.threadRootCommentId =
        normalized.parentCommentId || normalized.parentId || commentId;
    }

    if (!Array.isArray(normalized.mentions) || normalized.mentions.length === 0) {
      try {
        const mentionResult = await buildMentionPayload(
          db,
          normalized.content || "",
          Array.isArray(normalized.mentionHandles)
            ? normalized.mentionHandles.map((entry) =>
                (entry?.handle || "").toLowerCase()
              )
            : []
        );
        if (mentionResult.userIds.length) {
          updates.mentions = mentionResult.userIds;
        }
        if (mentionResult.metadata.length) {
          updates.mentionHandles = mentionResult.metadata;
        }
      } catch (error) {
        console.error("Failed to resolve mentions", {
          postId,
          commentId,
          error: error.message,
        });
      }
    }

    const nextScore = computeScore({
      ...normalized,
      ...updates,
    });
    if (!Number.isFinite(normalized.score) || normalized.score !== nextScore) {
      updates.score = nextScore;
    }

    if (!Number.isFinite(normalized.likeCount)) {
      updates.likeCount = 0;
    }
    if (!Number.isFinite(normalized.replyCount)) {
      updates.replyCount = 0;
    }

    if (Object.keys(updates).length > 0) {
      await commentRef.set(updates, { merge: true });
    }

    const isCreate = !before;
    if (!isCreate) {
      return;
    }

    const parentCommentId =
      normalized.parentCommentId || normalized.parentId || null;
    if (parentCommentId) {
      const parentRef = commentRef.parent.doc(parentCommentId);
      await parentRef
        .update({
          replyCount: admin.firestore.FieldValue.increment(1),
        })
        .catch((error) => {
          console.error("Failed to increment parent replyCount", {
            parentCommentId,
            postId,
            error: error.message,
          });
        });
    }

    await updateUserStatsOnComment({
      db,
      userId: normalized.authorId,
      createdAt: normalized.createdAt,
    });

    const snippet = getNotificationSnippet(normalized.content);

    if (parentCommentId) {
      const parentSnap = await commentRef.parent.doc(parentCommentId).get();
      const parentAuthorId = parentSnap.exists
        ? parentSnap.get("authorId")
        : null;
      if (parentAuthorId && parentAuthorId !== normalized.authorId) {
        await createNotificationItem({
          db,
          recipientId: parentAuthorId,
          type: "reply",
          actorId: normalized.authorId,
          postId,
          commentId,
          snippet,
        });
      }
    } else {
      const postSnap = await commentRef.parent.parent.get();
      const postAuthorId = postSnap.exists ? postSnap.get("authorId") : null;
      if (postAuthorId && postAuthorId !== normalized.authorId) {
        await createNotificationItem({
          db,
          recipientId: postAuthorId,
          type: "reply",
          actorId: normalized.authorId,
          postId,
          commentId,
          snippet,
        });
      }
    }

    const mentionTargets = updates.mentions || normalized.mentions || [];
    await Promise.all(
      mentionTargets
        .filter((userId) => userId && userId !== normalized.authorId)
        .map((userId) =>
          createNotificationItem({
            db,
            recipientId: userId,
            type: "mention",
            actorId: normalized.authorId,
            postId,
            commentId,
            snippet,
          })
        )
    );
  }
);

export const toggleCommentLike = onCall(
  { region: "us-central1", enforceAppCheck: false },
  async (request) => {
    const uid = request.auth?.uid || null;
    const { commentPath, postId, commentId } = request.data || {};

    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to like comments.");
    }

    if (
      !commentPath &&
      (!postId || !commentId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Provide commentPath or postId/commentId."
      );
    }

    try {
      const commentRef = await resolveCommentDocRef({
        commentPath,
        postId,
        commentId,
      });

      if (!commentRef) {
        throw new HttpsError("not-found", "Comment not found.");
      }

      const likeRef = commentRef.collection("likes").doc(uid);

      const result = await db.runTransaction(async (tx) => {
        const [commentSnap, likeSnap] = await Promise.all([
          tx.get(commentRef),
          tx.get(likeRef),
        ]);

        if (!commentSnap.exists) {
          throw new HttpsError(
            "not-found",
            "Comment missing during transaction."
          );
        }

        const commentData = commentSnap.data() || {};
        const baseLikeCount = Number.isFinite(commentData.likeCount)
          ? commentData.likeCount
          : 0;
        const resolvedPostId = commentData.postId || postId || null;
        const resolvedCommentId =
          commentData.id || commentId || commentRef.id;

        let liked;
        let nextLikeCount;
        let nextScore;

        if (likeSnap.exists) {
          liked = false;
          nextLikeCount = Math.max(0, baseLikeCount - 1);
          const scoreInput = { ...commentData, likeCount: nextLikeCount };
          nextScore = computeScore(scoreInput);
          tx.delete(likeRef);
          tx.update(commentRef, {
            likeCount: admin.firestore.FieldValue.increment(-1),
            score: nextScore,
          });
        } else {
          liked = true;
          nextLikeCount = baseLikeCount + 1;
          const scoreInput = { ...commentData, likeCount: nextLikeCount };
          nextScore = computeScore(scoreInput);
          tx.set(likeRef, {
            userId: uid,
            postId: resolvedPostId,
            commentId: resolvedCommentId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          tx.update(commentRef, {
            likeCount: admin.firestore.FieldValue.increment(1),
            score: nextScore,
          });
        }

        return {
          liked,
          likeCount: nextLikeCount,
          score: nextScore,
          commentAuthorId: commentData.authorId,
          content: commentData.content || "",
          postId: resolvedPostId,
          commentId: resolvedCommentId,
          path: commentRef.path,
        };
      });

      if (result.liked && result.commentAuthorId) {
        await Promise.all([
          createNotificationItem({
            db,
            recipientId: result.commentAuthorId,
            type: "like",
            actorId: uid,
            postId: result.postId || postId || null,
            commentId: result.commentId || commentId || null,
            snippet: getNotificationSnippet(result.content),
          }),
          maybeAwardHelpfulBadge({
            db,
            userId: result.commentAuthorId,
            likeCount: result.likeCount,
          }),
        ]);
      }

      return result;
    } catch (error) {
      console.error("toggleCommentLike failure", {
        uid,
        postId,
        commentId,
        commentPath,
        error: error?.message || error,
      });
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "Failed to toggle like.");
    }
  }
);

export const authorLikeToggle = onCall(
  { region: "us-central1", enforceAppCheck: false },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new Error("Authentication required.");
    }
    const { postId, commentId, liked } = request.data || {};
    if (!postId || !commentId || typeof liked !== "boolean") {
      throw new Error("postId, commentId, and liked are required.");
    }

    const { postRef, commentRef } = getCommentRefs(postId, commentId);

    const result = await db.runTransaction(async (tx) => {
      const [postSnap, commentSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(commentRef),
      ]);

      if (!postSnap.exists || postSnap.get("authorId") !== uid) {
        throw new Error("Only the post author can mark author likes.");
      }
      if (!commentSnap.exists) {
        throw new Error("Comment not found.");
      }

      const commentData = commentSnap.data() || {};
      if (Boolean(commentData.likedByAuthor) === liked) {
        return {
          likedByAuthor: liked,
          score: commentData.score || 0,
          commentAuthorId: commentData.authorId,
        };
      }

      const nextScore = computeScore({
        ...commentData,
        likedByAuthor: liked,
      });

      tx.update(commentRef, {
        likedByAuthor: liked,
        score: nextScore,
      });

      return {
        likedByAuthor: liked,
        score: nextScore,
        commentAuthorId: commentData.authorId,
      };
    });

    await maybeAwardAuthorsPickBadge({
      db,
      userId: result.commentAuthorId,
      liked,
    });

    return result;
  }
);
