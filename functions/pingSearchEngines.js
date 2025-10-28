import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import fetch from "node-fetch";
import { defineSecret } from "firebase-functions/params";

// Define the website URL as a secret
const WEBSITE_URL = defineSecret("WEBSITE_URL");

/**
 * Cloud Function that automatically pings search engines when a new post is published
 * or when a post is updated to published status.
 *
 * This helps search engines discover and index new content faster without manual submission.
 */
export const pingSearchEngines = onDocumentCreated(
  {
    document: "posts/{postId}",
    secrets: [WEBSITE_URL],
    maxInstances: 10,
  },
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) {
        console.log("No data associated with the event");
        return null;
      }

      const post = snapshot.data();

      // Only ping search engines if the post is published
      if (post.status !== "published") {
        console.log(
          `Post ${snapshot.id} is not published. Skipping search engine notification.`
        );
        return null;
      }

      console.log(
        `New published post detected: ${post.title} (ID: ${snapshot.id})`
      );

      // Get the website URL from environment variables
      const websiteUrl = WEBSITE_URL.value();
      const postUrl = `https://${websiteUrl}/post/${snapshot.id}`;

      // Ping Google
      await pingGoogle(postUrl);

      // Ping Bing
      await pingBing(postUrl);

      // Update sitemap (optional)
      // You could trigger your sitemap generation here to include the new post immediately

      console.log(
        `Successfully notified search engines about new post: ${postUrl}`
      );
      return null;
    } catch (error) {
      console.error("Error pinging search engines:", error);
      return null;
    }
  }
);

/**
 * Also ping search engines when a post is updated to published status
 */
export const pingSearchEnginesOnUpdate = onDocumentUpdated(
  {
    document: "posts/{postId}",
    secrets: [WEBSITE_URL],
    maxInstances: 10,
  },
  async (event) => {
    try {
      const beforeSnapshot = event.data.before;
      const afterSnapshot = event.data.after;

      if (!beforeSnapshot || !afterSnapshot) {
        console.log("No data associated with the event");
        return null;
      }

      const beforeData = beforeSnapshot.data();
      const afterData = afterSnapshot.data();

      // Check if the post was updated to published status
      if (
        beforeData.status !== "published" &&
        afterData.status === "published"
      ) {
        console.log(`Post ${afterSnapshot.id} updated to published status`);

        // Get the website URL from environment variables
        const websiteUrl = WEBSITE_URL.value();
        const postUrl = `https://${websiteUrl}/post/${afterSnapshot.id}`;

        // Ping Google
        await pingGoogle(postUrl);

        // Ping Bing
        await pingBing(postUrl);

        console.log(
          `Successfully notified search engines about updated post: ${postUrl}`
        );
      }

      return null;
    } catch (error) {
      console.error("Error pinging search engines on update:", error);
      return null;
    }
  }
);

/**
 * Ping Google's Indexing API (note: requires OAuth2, which is beyond this implementation)
 * This uses the simple ping method for now
 *
 * @param {string} url - The URL to ping Google with
 */
export async function pingGoogle(url) {
  try {
    console.log(`Pinging Google for URL: ${url}`);

    // Handle both sitemap URLs and post URLs appropriately
    let pingUrl;
    if (url.includes("sitemap.xml")) {
      pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(
        url
      )}`;
    } else {
      // For individual URLs, we still ping the sitemap
      const websiteUrl = WEBSITE_URL.value();
      pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(
        `https://${websiteUrl}/sitemap.xml`
      )}`;
    }

    const response = await fetch(pingUrl);

    if (response.ok) {
      console.log(`Successfully pinged Google for: ${url}`);
    } else {
      console.warn(
        `Failed to ping Google for: ${url}. Status: ${response.status}`
      );
    }
  } catch (error) {
    console.error(`Error pinging Google for ${url}:`, error);
  }
}

/**
 * Ping Bing's submission API
 *
 * @param {string} url - The URL to ping Bing with
 */
export async function pingBing(url) {
  try {
    console.log(`Pinging Bing for URL: ${url}`);

    // Handle both sitemap URLs and post URLs appropriately
    let bingUrl;
    if (url.includes("sitemap.xml")) {
      bingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(url)}`;
    } else {
      // For individual URLs, we still ping the sitemap
      const websiteUrl = WEBSITE_URL.value();
      bingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(
        `https://${websiteUrl}/sitemap.xml`
      )}`;
    }

    const response = await fetch(bingUrl);

    if (response.ok) {
      console.log(`Successfully pinged Bing for: ${url}`);
    } else {
      console.warn(
        `Failed to ping Bing for: ${url}. Status: ${response.status}`
      );
    }
  } catch (error) {
    console.error(`Error pinging Bing for ${url}:`, error);
  }
}
