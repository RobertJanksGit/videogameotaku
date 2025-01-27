/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

"use strict";

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

// Define both values as secrets for better security
const validationApiUrl = defineSecret("VALIDATION_API_URL");
const validationPrompt = defineSecret("VALIDATION_PROMPT");

// Rate limiting configuration
const rateLimits = {
  maxCalls: 50,
  periodSeconds: 60,
};

// Content validation limits
const contentLimits = {
  maxTitleLength: 200,
  maxContentLength: 10000,
  minContentLength: 10,
};

// Helper function to validate content
function validateContent(title, content) {
  if (
    !title ||
    typeof title !== "string" ||
    title.length > contentLimits.maxTitleLength
  ) {
    throw new Error(
      `Title must be between 1 and ${contentLimits.maxTitleLength} characters`
    );
  }

  if (
    !content ||
    typeof content !== "string" ||
    content.length > contentLimits.maxContentLength ||
    content.length < contentLimits.minContentLength
  ) {
    throw new Error(
      `Content must be between ${contentLimits.minContentLength} and ${contentLimits.maxContentLength} characters`
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

        // If document doesn't exist, create it with initial count
        if (!doc.exists) {
          transaction.set(rateLimitRef, {
            count: 1,
            resetTime: now + rateLimits.periodSeconds * 1000,
          });
          return true;
        }

        const data = doc.data();

        // Reset count if period has expired
        if (now > data.resetTime) {
          transaction.set(rateLimitRef, {
            count: 1,
            resetTime: now + rateLimits.periodSeconds * 1000,
          });
          return true;
        }

        // Check if limit exceeded
        if (data.count >= rateLimits.maxCalls) {
          console.log(
            `Rate limit exceeded for user ${userId}. Count: ${
              data.count
            }, Reset time: ${new Date(data.resetTime)}`
          );
          return false;
        }

        // Increment count
        transaction.update(rateLimitRef, {
          count: admin.firestore.FieldValue.increment(1),
        });

        console.log(
          `Rate limit check passed for user ${userId}. Current count: ${
            data.count + 1
          }`
        );
        return true;
      });

    return result;
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // On error, allow the request to proceed
    return true;
  }
}

// Export the function directly with secret access
exports.validatePost = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [validationApiUrl, validationPrompt], // Explicitly grant access to both secrets
    maxInstances: 10, // Limit concurrent executions
  },
  async (event) => {
    console.log("Starting validation for post:", event.params.postId);

    const post = event.data.data();
    const postId = event.params.postId;
    const userId = post.authorId;

    try {
      // Validate content length and format
      validateContent(post.title, post.content);

      // Check rate limits
      const withinLimits = await checkRateLimit(userId);
      if (!withinLimits) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      console.log("Post content to validate:", {
        title: post.title,
        content: post.content,
      });

      // Skip if already published
      if (post.status === "published") {
        console.log("Skipping already published post");
        return null;
      }

      // Get the API URL from the secret
      const apiUrl = validationApiUrl.value();
      console.log("Using validation API URL:", apiUrl);

      if (!apiUrl || !apiUrl.startsWith("http")) {
        throw new Error("Invalid API URL configuration");
      }

      console.log("Sending request to validation API...");

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
        console.error(
          "API response not OK:",
          response.status,
          response.statusText
        );
        throw new Error(`Validation API error: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("Raw API response:", result);

      // Parse the nested JSON response
      let validationResult;
      try {
        validationResult = JSON.parse(result.message);
        console.log("Parsed validation result:", validationResult);
      } catch (parseError) {
        console.error("Error parsing validation result:", parseError);
        validationResult = {
          isValid: false,
          message: "Invalid response format",
        };
      }

      // Update the post with validation results
      console.log(
        "Updating post status to:",
        validationResult.isValid ? "published" : "rejected"
      );

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

      console.log("Post update complete");
      return { success: true };
    } catch (error) {
      console.error("Error validating post:", error);

      // Mark as rejected on error
      console.log("Marking post as rejected due to error");

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
