import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { Buffer } from "buffer";
import { getFirestore } from "firebase-admin/firestore";

// Pinterest configuration for 2nd Gen functions:
// These values should be provided via Secret Manager or runtime env, e.g.:
//   - PINTEREST_APP_ID
//   - PINTEREST_APP_SECRET
//   - PINTEREST_REFRESH_TOKEN
//   - PINTEREST_BOARD_ID
//
// NOTE: We no longer use functions.config() because it is not supported in
// Cloud Functions for Firebase v2 / Node.js 22.
const PINTEREST_APP_ID = defineSecret("PINTEREST_APP_ID");
const PINTEREST_APP_SECRET = defineSecret("PINTEREST_APP_SECRET");
const PINTEREST_REFRESH_TOKEN = defineSecret("PINTEREST_REFRESH_TOKEN");
const PINTEREST_BOARD_ID = defineSecret("PINTEREST_BOARD_ID");

let hasWarnedMissingConfig = false;

const getPinterestConfig = () => {
  const appId = PINTEREST_APP_ID.value();
  const appSecret = PINTEREST_APP_SECRET.value();
  const refreshToken = PINTEREST_REFRESH_TOKEN.value();
  const boardId = PINTEREST_BOARD_ID.value();

  const missing = [];
  if (!appId) missing.push("PINTEREST_APP_ID");
  if (!appSecret) missing.push("PINTEREST_APP_SECRET");
  if (!refreshToken) missing.push("PINTEREST_REFRESH_TOKEN");
  if (!boardId) missing.push("PINTEREST_BOARD_ID");

  if (missing.length > 0) {
    if (!hasWarnedMissingConfig) {
      hasWarnedMissingConfig = true;
      console.warn(
        "[pinterest] Missing Pinterest env/secrets; createPinterestPinOnNewPost will no-op until configured.",
        { missing }
      );
    }
    return null;
  }

  return {
    appId,
    appSecret,
    refreshToken,
    boardId,
  };
};

// Refresh the Pinterest access token on each run using the long-lived refresh token.
// This keeps things simple and stateless; later we could cache the short-lived access
// token if we need to optimize API usage.
async function getPinterestAccessToken() {
  const cfg = getPinterestConfig();
  if (!cfg) {
    // Config is missing; we already logged a warning. No-op.
    return null;
  }

  const basicAuth = Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString(
    "base64"
  );

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cfg.refreshToken,
  });

  let res;
  try {
    res = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        // Pinterest expects HTTP Basic auth with app_id:app_secret
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (error) {
    console.error("[pinterest] Network error while refreshing access token:", {
      message: error?.message ?? error,
    });
    throw new Error("Pinterest token refresh network error");
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(
      "[pinterest] Failed to refresh access token:",
      res.status,
      text
    );
    throw new Error(`Pinterest token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  console.log(
    "[pinterest] Access token refreshed; expires_in:",
    data.expires_in
  );
  return data.access_token;
}

export async function createPinterestPinForPost(post, event) {
  // Required post fields: title, summary, and either socialUrl or canonical URL, plus imageUrl
  const cfg = getPinterestConfig();
  if (!cfg) {
    // Config is missing; we already logged a warning. No-op.
    return;
  }

  // Derive the link from available URL fields
  const link =
    post.socialUrl || // Primary: social media URL if available
    `https://videogameotaku.com/post/${event?.params?.postId || "unknown"}`; // Fallback: canonical website URL

  // Derive the image URL from available image fields
  const imageUrl = post.imageUrl; // The processed image URL from Firebase Storage

  if (!link || !imageUrl) {
    const postId = event?.params?.postId || "unknown";
    console.log("[pinterest] Skipping post; missing link or imageUrl.", {
      postId,
      title: post.title,
      hasLink: !!link,
      hasImageUrl: !!imageUrl,
    });
    return;
  }

  const accessToken = await getPinterestAccessToken();
  if (!accessToken) {
    console.warn(
      "[pinterest] No access token available; skipping pin creation for post.",
      { postUrl: post?.url }
    );
    return;
  }

  const payload = {
    title: (post.title || "New gaming news").slice(0, 100),
    description: (post.summary || "").slice(0, 500),
    board_id: cfg.boardId,
    link,
    media_source: {
      source_type: "image_url",
      url: imageUrl,
    },
  };

  const res = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[pinterest] create pin failed:", res.status, text);
    throw new Error(`Pinterest pin creation failed: ${res.status}`);
  }

  const data = await res.json();
  console.log("[pinterest] Pin created", {
    pinId: data.id,
    boardId: cfg.boardId,
    postId: event?.params?.postId,
  });

  // Store the pin ID on the post document to prevent duplicates
  if (event?.params?.postId) {
    try {
      const db = getFirestore();
      await db.collection("posts").doc(event.params.postId).update({
        pinterestPinId: data.id,
        pinterestPinCreatedAt: new Date(),
      });
      console.log("[pinterest] Updated post document with pin ID", {
        postId: event.params.postId,
        pinId: data.id,
      });
    } catch (updateError) {
      console.error("[pinterest] Failed to update post with pin ID", {
        postId: event.params.postId,
        pinId: data.id,
        error: updateError.message,
      });
      // Don't throw - pin was created successfully, just logging failed
    }
  }

  return data;
}

// Firestore trigger: auto-create a Pinterest pin when a post gains valid image and URL
// Path: posts/{postId}
// Secrets: Pinterest app credentials and board configuration are provided via
// Secret Manager / env variables declared above.
export const createPinterestPinOnNewPost = onDocumentUpdated(
  {
    document: "posts/{postId}",
    secrets: [
      PINTEREST_APP_ID,
      PINTEREST_APP_SECRET,
      PINTEREST_REFRESH_TOKEN,
      PINTEREST_BOARD_ID,
    ],
  },
  async (event) => {
    const after = event.data?.after?.data();

    if (!after) {
      console.log("[pinterest] Post update has no after data; skipping.");
      return;
    }

    // Helper functions to derive link and image from post data
    const deriveLink = (post) =>
      post?.socialUrl ||
      `https://videogameotaku.com/post/${event.params.postId}`;

    const deriveImage = (post) => post?.imageUrl;

    // Check if this post already has a Pinterest pin created
    if (after.pinterestPinId || after.pinterestPinCreatedAt) {
      console.log("[pinterest] Skipping - pin already created for this post", {
        postId: event.params.postId,
        title: after.title,
        existingPinId: after.pinterestPinId,
      });
      return;
    }

    // Check what we have now
    const currentLink = deriveLink(after);
    const currentImage = deriveImage(after);
    const hasValidNow = !!currentLink && !!currentImage;

    // Only run if the post currently has valid link+image
    if (!hasValidNow) {
      console.log(
        "[pinterest] Skipping update - post missing valid link or image",
        {
          postId: event.params.postId,
          title: after.title,
          hasLink: !!currentLink,
          hasImage: !!currentImage,
        }
      );
      return;
    }

    try {
      console.log("[pinterest] Post gained valid link+image; creating pin", {
        postId: event.params.postId,
        title: after.title,
      });

      await createPinterestPinForPost(after, event);
    } catch (err) {
      console.error(
        "[pinterest] Error creating pin for post",
        event.params.postId,
        err
      );
    }
  }
);
