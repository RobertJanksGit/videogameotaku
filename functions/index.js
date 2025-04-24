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
import { onRequest } from "firebase-functions/v2/https";
import { Buffer } from "buffer";
import { randomBytes } from "crypto";
import OpenAI from "openai";
import v8 from "v8";

// Import sitemap generation function
import { generateSitemapScheduled } from "./generateSitemapScheduled.js";

// Initialize Firebase Admin with admin privileges and explicit project configuration
admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();

// Define configuration parameters
const bucketName = defineSecret("STORAGE_BUCKET_NAME");
const validationApiUrl = defineSecret("VALIDATION_API_URL");
const validationPrompt = defineSecret("VALIDATION_PROMPT");
const openaiApiKey = defineSecret("OPENAI_API_KEY");
const newsApiUrl = defineSecret("NEWS_API_URL");
const requestTimeout = defineInt("REQUEST_TIMEOUT", { default: 5000 }); // 5 seconds
const maxCallsPerMinute = defineInt("MAX_CALLS_PER_MINUTE", { default: 50 });
const maxSystemCallsPerMinute = defineInt("MAX_SYSTEM_CALLS_PER_MINUTE", {
  default: 500,
}); // Higher limit for system operations
const maxTitleLength = defineInt("MAX_TITLE_LENGTH", { default: 200 });
const maxContentLength = defineInt("MAX_CONTENT_LENGTH", { default: 10000 });
const minContentLength = defineInt("MIN_CONTENT_LENGTH", { default: 10 });

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
const systemUserId = defineSecret("SYSTEM_USER_ID");
let SYSTEM_USER = null;

// Helper function to get system user
const getSystemUser = async () => {
  if (SYSTEM_USER) return SYSTEM_USER;

  const userDoc = await db.collection("users").doc(systemUserId.value()).get();
  if (!userDoc.exists) {
    throw new Error("System user not found");
  }

  SYSTEM_USER = {
    id: userDoc.id,
    ...userDoc.data(),
  };

  return SYSTEM_USER;
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

const sanitizeContent = (content) => {
  // Remove potential XSS vectors and sanitize content
  return content
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/javascript:/gi, "") // Remove javascript: protocols
    .replace(/data:/gi, "") // Remove data: URLs
    .replace(/vbscript:/gi, ""); // Remove vbscript: protocols
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

// Post validation function
export const validatePost = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [validationApiUrl, validationPrompt, newsApiUrl],
    maxInstances: 10,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return;
    }

    const postId = event.params.postId;
    const data = snapshot.data();

    // Skip validation for already published posts
    if (data.status === "published") {
      console.log(`Post ${postId} is already published, skipping validation`);
      return;
    }

    try {
      // Log the original post data for debugging
      console.log("Original post data:", JSON.stringify(data, null, 2));

      // Auto-publish posts since we don't have a validation endpoint
      const updateData = {
        status: "published",
        moderationMessage: "Auto-published - no validation required",
        updatedAt: db.FieldValue.serverTimestamp(),
        validatedAt: db.FieldValue.serverTimestamp(),
      };

      // Log the update data for debugging
      console.log("Update data:", JSON.stringify(updateData, null, 2));

      await db.collection("posts").doc(postId).update(updateData);

      // Verify the update preserved author information
      const updatedPost = await db.collection("posts").doc(postId).get();
      const updatedData = updatedPost.data();
      console.log("Updated post data:", JSON.stringify(updatedData, null, 2));

      // Verify author information was preserved
      if (
        updatedData.authorId !== data.authorId ||
        updatedData.authorEmail !== data.authorEmail ||
        updatedData.authorName !== data.authorName ||
        updatedData.authorPhotoURL !== data.authorPhotoURL
      ) {
        console.error(
          "Author information changed during validation!",
          "Original:",
          {
            id: data.authorId,
            email: data.authorEmail,
            name: data.authorName,
            photoURL: data.authorPhotoURL,
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

      console.log(
        `Post ${postId} validation complete. Status: ${updatedData.status}`
      );
    } catch (error) {
      console.error("Error validating post:", error);

      // Only update error-related fields
      const errorUpdate = {
        status: "error",
        moderationMessage:
          error.message || "Validation error. Please try again.",
        updatedAt: db.FieldValue.serverTimestamp(),
        validatedAt: db.FieldValue.serverTimestamp(),
      };

      await db.collection("posts").doc(postId).update(errorUpdate);
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
    secrets: [systemUserId],
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
    secrets: [systemUserId, bucketName, openaiApiKey, newsApiUrl],
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
      });

      // Initialize system user with timeout and retry
      const SYSTEM_USER = await initializeSystemUser();
      if (!SYSTEM_USER) throw new Error("Failed to initialize system user");

      await executionRef.update({
        status: "fetching_articles",
        systemUserId: SYSTEM_USER.id,
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
          SYSTEM_USER,
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

// Helper function to initialize system user with retry
async function initializeSystemUser(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const userPromise = getSystemUser();
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
  SYSTEM_USER,
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

      // Skip articles without images
      if (!article.imageUrl) {
        console.log(`Skipping article without image: ${article.title}`);
        onError();
        continue;
      }

      // Process image
      console.log(`Processing image for article: ${article.title}`);
      try {
        article.imageData = await processImage(article.imageUrl, SYSTEM_USER);
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
        await createPost(article, SYSTEM_USER, embedding);
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

async function createPost(article, SYSTEM_USER, embedding) {
  // Validate and sanitize content
  const sanitizedContent = sanitizeContent(
    `${article.summary}\n\n[Source](${article.sourceUrl})`
  );
  await validateContent(article.title, sanitizedContent);

  // Check rate limit
  if (!(await checkRateLimit(SYSTEM_USER.id, "system"))) {
    throw new Error("Rate limit exceeded");
  }

  // Create post
  const timestamp = admin.firestore.Timestamp.now();
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
    status: "published",
    type: "news",
    lastEditedBy: SYSTEM_USER.name,
    lastEditedById: SYSTEM_USER.id,
  };

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
    secrets: [systemUserId, bucketName, openaiApiKey, newsApiUrl],
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

      // Get system user at runtime
      const SYSTEM_USER = await getSystemUser();
      if (!SYSTEM_USER) {
        throw new Error("Failed to initialize system user");
      }

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
          // Add delay between posts (2 seconds)
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Handle image if it exists
          let imageData = null;
          if (article.imageUrl) {
            console.log(`Processing image for article: ${article.title}`);
            try {
              imageData = await processImage(article.imageUrl, SYSTEM_USER);
              await cleanupMemory(); // Clean up after image processing
            } catch (error) {
              console.error(
                `Error processing image for article ${article.title}:`,
                error
              );
            }
          }

          // Validate and sanitize content before creating post
          const sanitizedContent = sanitizeContent(
            `${article.summary}\n\n[Source](${article.sourceUrl})`
          );
          await validateContent(article.title, sanitizedContent);

          // Check rate limit before creating post
          if (!(await checkRateLimit(SYSTEM_USER.id, "system"))) {
            throw new Error("Rate limit exceeded");
          }

          // Create post with explicit system user data
          const timestamp = admin.firestore.Timestamp.now();
          const postData = {
            title: article.title,
            content: sanitizedContent,
            category: "news",
            platforms: article.platforms || [],
            authorId: SYSTEM_USER.id,
            authorName: SYSTEM_USER.name,
            authorEmail: SYSTEM_USER.email,
            authorPhotoURL: SYSTEM_USER.photoURL,
            imageUrl: imageData?.url || null,
            imagePath: imageData?.path || null,
            imageContentType: imageData?.contentType || null,
            sourceUrl: article.sourceUrl,
            sourceName: "Gaming News Aggregator",
            createdAt: timestamp,
            updatedAt: timestamp,
            usersThatLiked: [],
            usersThatDisliked: [],
            totalVotes: 0,
            status: "published",
            type: "news",
            lastEditedBy: SYSTEM_USER.name,
            lastEditedById: SYSTEM_USER.id,
          };

          // Create the post
          const docRef = await db.collection("posts").add(postData);

          // Use the same standardized text that was used for duplicate checking
          const standardizedText = getStandardizedText(
            article.title,
            article.summary
          );
          const embedding = await getEmbeddings([standardizedText]);

          await db.collection("postEmbeddings").doc(docRef.id).set({
            postId: docRef.id,
            embedding: embedding[0],
            standardizedText, // Store the text used for embedding for debugging
            createdAt: timestamp,
          });

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

// Add website URL parameter and Facebook token
const WEBSITE_URL = defineSecret("WEBSITE_URL");
const FACEBOOK_PAGE_ACCESS_TOKEN = defineSecret("FACEBOOK_PAGE_ACCESS_TOKEN");

// Helper function to ensure URLs have the proper prefix
const normalizeUrl = (url) => {
  if (!url) return "";
  const trimmedUrl = url.trim();
  if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    return trimmedUrl;
  }
  return `https://${trimmedUrl}`;
};

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
      const cleanContent = afterData.content
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

      // Always use a link post to allow Facebook to scrape the image from Open Graph metadata
      const postData = {
        message: message,
        link: postUrl,
      };

      console.log("Final Facebook post data:", {
        hasMessage: !!postData.message,
        hasLink: !!postData.link,
        postUrl: postUrl,
        pageId: pageId,
      });

      // Create the post
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${pageId}/feed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${FACEBOOK_PAGE_ACCESS_TOKEN.value()}`,
          },
          body: JSON.stringify(postData),
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
