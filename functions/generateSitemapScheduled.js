import { onSchedule } from "firebase-functions/v2/scheduler";
import { generateSitemap } from "./generateSitemap.js";
import { pingGoogle, pingBing } from "./pingSearchEngines.js";
import admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import normalizeUrl from "./utils/normalizeUrl.js";

// Define the WEBSITE_URL secret
const WEBSITE_URL = defineSecret("WEBSITE_URL");

/**
 * Cloud Function that runs every 6 hours to generate the sitemap
 * and upload it to Firebase Storage/Hosting
 */
export const generateSitemapScheduled = onSchedule(
  {
    schedule: "every 6 hours",
    timeoutSeconds: 540, // 9 minutes timeout
    memory: "1GiB",
    secrets: [WEBSITE_URL],
    labels: {
      task: "sitemap-generation",
      type: "scheduled",
    },
  },
  async () => {
    console.log("Starting scheduled sitemap generation");

    try {
      // Use the enhanced implementation with retry logic
      await generateSitemap();
      console.log("Sitemap generated successfully");

      // Get website URL from environment config
      const websiteUrl = normalizeUrl(WEBSITE_URL.value());

      // Ping search engines with the sitemap URL
      await pingGoogle(`${websiteUrl}/sitemap.xml`);
      await pingBing(`${websiteUrl}/sitemap.xml`);

      console.log("Search engines pinged successfully");

      // Update the last scheduled run timestamp
      const db = admin.firestore();
      await db.collection("sitemapLocks").doc("lastScheduledRun").set({
        timestamp: admin.firestore.Timestamp.now(),
        success: true,
      });

      return null;
    } catch (error) {
      console.error("Error in scheduled sitemap generation:", error);

      // Log the error to Firestore
      try {
        const db = admin.firestore();
        await db.collection("sitemapErrors").add({
          source: "generateSitemapScheduled",
          error: error.message,
          stack: error.stack,
          timestamp: admin.firestore.Timestamp.now(),
        });
      } catch (logError) {
        console.error("Failed to log error to Firestore:", logError);
      }

      throw error;
    }
  }
);
