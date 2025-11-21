import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { TwitterApi } from "twitter-api-v2";
import { getFirestore } from "firebase-admin/firestore";

// X/Twitter configuration for 2nd Gen functions:
// These values should be provided via Secret Manager, e.g.:
//   - X_API_KEY (from X Developer Portal)
//   - X_API_SECRET (from X Developer Portal)
//   - X_ACCESS_TOKEN (from X Developer Portal - Access Token)
//   - X_ACCESS_TOKEN_SECRET (from X Developer Portal - Access Token Secret)
//
// NOTE: We no longer use functions.config() because it is not supported in
// Cloud Functions for Firebase v2 / Node.js 22.
const X_API_KEY = defineSecret("X_API_KEY");
const X_API_SECRET = defineSecret("X_API_SECRET");
const X_ACCESS_TOKEN = defineSecret("X_ACCESS_TOKEN");
const X_ACCESS_TOKEN_SECRET = defineSecret("X_ACCESS_TOKEN_SECRET");

let hasWarnedMissingConfig = false;

/**
 * Get X/Twitter configuration from Firebase secrets
 * @returns {Object|null} Configuration object or null if missing secrets
 */
const getXConfig = () => {
  const apiKey = X_API_KEY.value();
  const apiSecret = X_API_SECRET.value();
  const accessToken = X_ACCESS_TOKEN.value();
  const accessTokenSecret = X_ACCESS_TOKEN_SECRET.value();

  const missing = [];
  if (!apiKey) missing.push("X_API_KEY");
  if (!apiSecret) missing.push("X_API_SECRET");
  if (!accessToken) missing.push("X_ACCESS_TOKEN");
  if (!accessTokenSecret) missing.push("X_ACCESS_TOKEN_SECRET");

  if (missing.length > 0) {
    if (!hasWarnedMissingConfig) {
      hasWarnedMissingConfig = true;
      console.warn(
        "[x] Missing X/Twitter env/secrets; postToX will no-op until configured.",
        { missing }
      );
    }
    return null;
  }

  return {
    apiKey,
    apiSecret,
    accessToken,
    accessTokenSecret,
  };
};

/**
 * Create a TwitterApi client instance with OAuth 1.0a user context authentication
 * @returns {TwitterApi|null} TwitterApi client or null if config missing
 */
const getTwitterClient = () => {
  const cfg = getXConfig();
  if (!cfg) return null;

  return new TwitterApi({
    appKey: cfg.apiKey,
    appSecret: cfg.apiSecret,
    accessToken: cfg.accessToken,
    accessSecret: cfg.accessTokenSecret,
  });
};

/**
 * Upload media to X/Twitter and return media ID
 * @param {string} imageUrl - URL of the image to upload
 * @param {string} altText - Alt text for the image
 * @returns {string|null} Media ID or null if upload failed
 */
async function uploadMediaToX(imageUrl, altText = "") {
  const client = getTwitterClient();
  if (!client) return null;

  try {
    console.log("[x] Uploading media to X", { imageUrl });

    // Fetch the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error("[x] Failed to fetch image", {
        imageUrl,
        status: imageResponse.status,
        statusText: imageResponse.statusText,
      });
      return null;
    }

    const imageBuffer = await imageResponse.arrayBuffer();

    // Upload media to Twitter
    const mediaId = await client.v1.uploadMedia(Buffer.from(imageBuffer), {
      mimeType: imageResponse.headers.get("content-type") || "image/jpeg",
    });

    // Add alt text if provided
    if (altText) {
      await client.v1.createMediaMetadata(mediaId, { alt_text: { text: altText } });
    }

    console.log("[x] Media uploaded successfully", { mediaId });
    return mediaId;
  } catch (error) {
    console.error("[x] Media upload failed", {
      imageUrl,
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Post a tweet to X using OAuth 1.0a user context authentication
 * @param {Object} params - Tweet parameters
 * @param {string} params.text - Main text content of the tweet
 * @param {string} params.url - URL to include in the tweet
 * @param {string} [params.imageUrl] - Optional image URL to attach to tweet
 * @returns {Object|null} Tweet result with id and text, or null if failed
 */
export async function postToX({ text, url, imageUrl }) {
  const client = getTwitterClient();
  if (!client) {
    console.warn("[x] Twitter client not available; skipping post");
    return null;
  }

  try {
    // Validate required parameters
    if (!text || !url) {
      console.error("[x] Missing required parameters", { hasText: !!text, hasUrl: !!url });
      return null;
    }

    // Compose tweet text: truncate to fit within 280 characters
    // Format: "${text} ${url}"
    const fullText = `${text} ${url}`;
    const tweetText = fullText.length > 280 ? `${fullText.substring(0, 277)}...` : fullText;

    console.log("[x] Posting tweet", {
      textLength: tweetText.length,
      hasImage: !!imageUrl,
      imageUrl: imageUrl?.substring(0, 100), // Truncate for logging
    });

    let mediaId = null;
    if (imageUrl) {
      mediaId = await uploadMediaToX(imageUrl, text); // Use text as alt text
    }

    // Create the tweet
    const tweetPayload = {
      text: tweetText,
    };

    if (mediaId) {
      tweetPayload.media = { media_ids: [mediaId] };
    }

    const tweet = await client.v2.tweet(tweetPayload);

    console.log("[x] Tweet posted successfully", {
      tweetId: tweet.data.id,
      text: tweetText.substring(0, 100) + (tweetText.length > 100 ? "..." : ""),
    });

    return {
      id: tweet.data.id,
      text: tweetText,
    };
  } catch (error) {
    console.error("[x] Tweet posting failed", {
      error: error.message,
      stack: error.stack,
      params: { text: text?.substring(0, 50), url, hasImage: !!imageUrl },
    });
    return null;
  }
}

/**
 * Create an X/Twitter post for a Firestore post document
 * @param {Object} post - Post document data
 * @param {Object} event - Firestore event context
 * @returns {Object|null} Tweet result or null if failed/skipped
 */
export async function createXPostForPost(post, event) {
  // Required post fields: title, and either socialUrl or canonical URL, plus optional imageUrl
  const cfg = getXConfig();
  if (!cfg) {
    // Config is missing; we already logged a warning. No-op.
    return null;
  }

  // Derive the URL from available URL fields
  const url =
    post.socialUrl || // Primary: social media URL if available
    `https://videogameotaku.com/post/${event?.params?.postId || "unknown"}`; // Fallback: canonical website URL

  // Use title as the tweet text
  const text = post.title;
  const imageUrl = post.imageUrl; // The processed image URL from Firebase Storage

  if (!text || !url) {
    const postId = event?.params?.postId || "unknown";
    console.log("[x] Skipping post; missing text or url.", {
      postId,
      title: post.title,
      hasText: !!text,
      hasUrl: !!url,
    });
    return null;
  }

  // Post to X
  const tweetResult = await postToX({ text, url, imageUrl });

  if (!tweetResult) {
    console.warn("[x] Failed to post to X for post", {
      postId: event?.params?.postId,
      title: post.title,
    });
    return null;
  }

  // Store the tweet ID on the post document to prevent duplicates
  if (event?.params?.postId) {
    try {
      const db = getFirestore();
      await db.collection("posts").doc(event.params.postId).update({
        xTweetId: tweetResult.id,
        xTweetCreatedAt: new Date(),
        xTweetText: tweetResult.text,
      });
      console.log("[x] Updated post document with tweet ID", {
        postId: event.params.postId,
        tweetId: tweetResult.id,
      });
    } catch (updateError) {
      console.error("[x] Failed to update post with tweet ID", {
        postId: event.params.postId,
        tweetId: tweetResult.id,
        error: updateError.message,
      });
      // Don't throw - tweet was created successfully, just logging failed
    }
  }

  return tweetResult;
}

// Firestore trigger: auto-post to X when a post gains valid title and URL
// Path: posts/{postId}
// Secrets: X app credentials are provided via Secret Manager / env variables declared above.
export const createXPostOnNewPost = onDocumentUpdated(
  {
    document: "posts/{postId}",
    secrets: [
      X_API_KEY,
      X_API_SECRET,
      X_ACCESS_TOKEN,
      X_ACCESS_TOKEN_SECRET,
    ],
  },
  async (event) => {
    const after = event.data?.after?.data();

    if (!after) {
      console.log("[x] Post update has no after data; skipping.");
      return;
    }

    // Helper functions to derive URL from post data
    const deriveUrl = (post) =>
      post?.socialUrl ||
      `https://videogameotaku.com/post/${event.params.postId}`;

    // Check if this post already has an X post created
    if (after.xTweetId || after.xTweetCreatedAt) {
      console.log("[x] Skipping - tweet already created for this post", {
        postId: event.params.postId,
        title: after.title,
        existingTweetId: after.xTweetId,
      });
      return;
    }

    // Check what we have now
    const currentUrl = deriveUrl(after);
    const hasValidNow = !!after.title && !!currentUrl;

    // Only run if the post currently has valid title+url
    if (!hasValidNow) {
      console.log(
        "[x] Skipping update - post missing valid title or url",
        {
          postId: event.params.postId,
          title: after.title,
          hasTitle: !!after.title,
          hasUrl: !!currentUrl,
        }
      );
      return;
    }

    try {
      console.log("[x] Post gained valid title+url; creating tweet", {
        postId: event.params.postId,
        title: after.title,
      });

      await createXPostForPost(after, event);
    } catch (err) {
      console.error(
        "[x] Error creating tweet for post",
        event.params.postId,
        err
      );
    }
  }
);
