/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

"use strict";

const {
  onDocumentCreated,
  onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const {
  defineString,
  defineInt,
  defineSecret,
} = require("firebase-functions/params");
const { onInit } = require("firebase-functions/v2/core");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

// Define configuration parameters
const validationApiUrl = defineSecret("VALIDATION_API_URL");
const validationPrompt = defineSecret("VALIDATION_PROMPT");
const maxCallsPerMinute = defineInt("MAX_CALLS_PER_MINUTE", { default: 50 });
const maxTitleLength = defineInt("MAX_TITLE_LENGTH", { default: 200 });
const maxContentLength = defineInt("MAX_CONTENT_LENGTH", { default: 10000 });
const minContentLength = defineInt("MIN_CONTENT_LENGTH", { default: 10 });

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

  if (
    !content ||
    typeof content !== "string" ||
    content.length > maxContentLength.value() ||
    content.length < minContentLength.value()
  ) {
    throw new Error(
      `Content must be between ${minContentLength.value()} and ${maxContentLength.value()} characters`
    );
  }
}

// Helper function to check rate limits
async function checkRateLimit(userId) {
  const now = Date.now();
  const limitKey = `ratelimit_${userId}`;
  const rateLimitRef = admin.firestore().collection("rateLimits").doc(limitKey);

  try {
    const result = await admin
      .firestore()
      .runTransaction(async (transaction) => {
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

        if (data.count >= maxCallsPerMinute.value()) {
          return false;
        }

        transaction.update(rateLimitRef, {
          count: admin.firestore.FieldValue.increment(1),
        });

        return true;
      });

    return result;
  } catch (error) {
    console.error("Rate limit check failed:", error);
    return true;
  }
}

// Post validation function
exports.validatePost = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [validationApiUrl, validationPrompt],
    maxInstances: 10,
  },
  async (event) => {
    console.log("Starting validation for post:", event.params.postId);

    const post = event.data.data();
    const postId = event.params.postId;
    const userId = post.authorId;

    try {
      validateContent(post.title, post.content);

      const withinLimits = await checkRateLimit(userId);
      if (!withinLimits) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      if (post.status === "published") {
        console.log("Skipping already published post");
        return null;
      }

      const apiUrl = validationApiUrl.value();
      if (!apiUrl || !apiUrl.startsWith("http")) {
        throw new Error("Invalid API URL configuration");
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://videogameotaku-74ad8.web.app",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({
          prompt: validationPrompt.value(),
          title: post.title,
          content: post.content,
        }),
      });

      if (!response.ok) {
        throw new Error(`Validation API error: ${response.statusText}`);
      }

      const result = await response.json();
      let validationResult = JSON.parse(result.message);

      await admin
        .firestore()
        .collection("posts")
        .doc(postId)
        .update({
          status: validationResult.isValid ? "published" : "rejected",
          moderationMessage: validationResult.message || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      return { success: true };
    } catch (error) {
      console.error("Error validating post:", error);

      await admin
        .firestore()
        .collection("posts")
        .doc(postId)
        .update({
          status: "rejected",
          moderationMessage:
            error.message || "Validation error. Please try again.",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      return { error: error.message };
    }
  }
);

// Handle post status changes for rate limiting
exports.onPostStatusChange = onDocumentUpdated(
  {
    document: "posts/{postId}",
  },
  async (event) => {
    const newData = event.data.after.data();
    const previousData = event.data.before.data();

    // Only proceed if status has changed
    if (newData.status === previousData.status) return;

    const userId = newData.authorId;
    const rateLimitRef = admin.firestore().collection("rateLimits").doc(userId);

    try {
      await admin.firestore().runTransaction(async (transaction) => {
        const rateLimitDoc = await transaction.get(rateLimitRef);
        const now = admin.firestore.Timestamp.now();

        if (!rateLimitDoc.exists) {
          transaction.set(rateLimitRef, {
            lastPostTime: now,
            lastPostStatus: newData.status,
            recentRejections: newData.status === "rejected" ? 1 : 0,
          });
          return;
        }

        const data = rateLimitDoc.data();

        if (newData.status === "rejected") {
          const recentRejections = (data.recentRejections || 0) + 1;
          const updates = {
            lastPostTime: now,
            lastPostStatus: "rejected",
            recentRejections: recentRejections,
          };

          // If user has had 5 or more rejections, ban them for 24 hours
          if (recentRejections >= 5) {
            updates.bannedUntil = admin.firestore.Timestamp.fromMillis(
              now.toMillis() + 24 * 60 * 60 * 1000 // 24 hours
            );
          }

          transaction.update(rateLimitRef, updates);
        } else if (newData.status === "published") {
          // Reset rejection count on successful publish
          transaction.update(rateLimitRef, {
            lastPostTime: now,
            lastPostStatus: "published",
            recentRejections: 0,
            bannedUntil: null,
          });
        }
      });
    } catch (error) {
      console.error("Error updating rate limits:", error);
    }
  }
);
