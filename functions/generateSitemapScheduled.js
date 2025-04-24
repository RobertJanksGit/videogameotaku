import { onSchedule } from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import { Storage } from "@google-cloud/storage";
import fs from "fs";
import os from "os";
import path from "path";
import { create } from "xmlbuilder2";

// Initialize storage for uploading generated sitemap
const storage = new Storage();

// Site URL for sitemap
const SITE_URL = "https://videogameotaku.com";

/**
 * Cloud Function that runs daily to generate the sitemap
 * and upload it to Firebase Storage/Hosting
 */
export const generateSitemapScheduled = onSchedule(
  { schedule: "every 24 hours" },
  async () => {
    console.log("Starting scheduled sitemap generation");

    try {
      // Get the Firestore database
      const db = admin.firestore();

      // Create temporary file paths
      const tempSitemapPath = path.join(os.tmpdir(), "sitemap.xml");
      const tempSitemapIndexPath = path.join(os.tmpdir(), "sitemapindex.xml");

      // Fetch all published posts ordered by last modified date
      const postsSnapshot = await db
        .collection("posts")
        .where("status", "==", "published")
        .orderBy("updatedAt", "desc")
        .get();

      // Create the sitemap object with image namespace
      const sitemap = create({ version: "1.0", encoding: "UTF-8" }).ele(
        "urlset",
        {
          xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
          "xmlns:image": "http://www.google.com/schemas/sitemap-image/1.1",
          "xmlns:news": "http://www.google.com/schemas/sitemap-news/0.9",
          "xmlns:xhtml": "http://www.w3.org/1999/xhtml",
        }
      );

      // Add static routes
      const staticRoutes = [
        { url: "/", priority: "1.0", changefreq: "daily" },
        { url: "/guidelines", priority: "0.5", changefreq: "monthly" },
        { url: "/terms", priority: "0.5", changefreq: "monthly" },
      ];

      // Add category routes with proper priorities
      const categories = [
        { path: "news", priority: "0.9", changefreq: "daily" },
        { path: "review", priority: "0.8", changefreq: "daily" },
        { path: "guide", priority: "0.8", changefreq: "weekly" },
        { path: "opinion", priority: "0.7", changefreq: "weekly" },
      ];

      // Add static routes to sitemap
      staticRoutes.forEach((route) => {
        const url = sitemap.ele("url");
        url.ele("loc").txt(`${SITE_URL}${route.url}`);
        url.ele("lastmod").txt(new Date().toISOString());
        url.ele("changefreq").txt(route.changefreq);
        url.ele("priority").txt(route.priority);
      });

      // Add category routes to sitemap
      categories.forEach((category) => {
        const url = sitemap.ele("url");
        url.ele("loc").txt(`${SITE_URL}/${category.path}`);
        url.ele("lastmod").txt(new Date().toISOString());
        url.ele("changefreq").txt(category.changefreq);
        url.ele("priority").txt(category.priority);
      });

      // Add dynamic post routes with images
      postsSnapshot.forEach((doc) => {
        const post = doc.data();
        const url = sitemap.ele("url");

        // Basic URL data
        url.ele("loc").txt(`${SITE_URL}/post/${doc.id}`);
        url
          .ele("lastmod")
          .txt(
            post.updatedAt?.toDate().toISOString() ||
              post.createdAt?.toDate().toISOString()
          );
        url.ele("changefreq").txt("weekly");
        url.ele("priority").txt("0.8");

        // Add image data if available
        if (post.imageUrl) {
          const image = url.ele("image:image");
          image.ele("image:loc").txt(post.imageUrl);
          image.ele("image:title").txt(post.title);
          image.ele("image:caption").txt(post.description || post.title);
        }

        // Add news specific tags for news category
        if (post.category === "news") {
          const news = url.ele("news:news");
          news
            .ele("news:publication")
            .ele("news:name")
            .txt("Video Game Otaku")
            .up()
            .ele("news:language")
            .txt("en");
          news
            .ele("news:publication_date")
            .txt(post.createdAt?.toDate().toISOString());
          news.ele("news:title").txt(post.title);
        }
      });

      // Convert sitemap to XML string with pretty formatting
      const sitemapXml = sitemap.end({ prettyPrint: true });

      // Write sitemap to temp file
      fs.writeFileSync(tempSitemapPath, sitemapXml);

      // Create the sitemapindex
      const sitemapIndex = create({ version: "1.0", encoding: "UTF-8" }).ele(
        "sitemapindex",
        {
          xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
        }
      );

      // Add main sitemap to index
      const sitemapNode = sitemapIndex.ele("sitemap");
      sitemapNode.ele("loc").txt(`${SITE_URL}/sitemap.xml`);
      sitemapNode.ele("lastmod").txt(new Date().toISOString());

      // Convert sitemap index to XML
      const sitemapIndexXml = sitemapIndex.end({ prettyPrint: true });

      // Write sitemap index to temp file
      fs.writeFileSync(tempSitemapIndexPath, sitemapIndexXml);

      // Upload both files to Firebase Storage
      const bucket = storage.bucket("videogameotaku-74ad8.appspot.com");

      // Upload sitemap.xml to the hosting directory
      await bucket.upload(tempSitemapPath, {
        destination: "sitemap.xml",
        metadata: {
          contentType: "application/xml",
          cacheControl: "public, max-age=3600",
        },
      });

      // Upload sitemapindex.xml to the hosting directory
      await bucket.upload(tempSitemapIndexPath, {
        destination: "sitemapindex.xml",
        metadata: {
          contentType: "application/xml",
          cacheControl: "public, max-age=3600",
        },
      });

      // Clean up temp files
      fs.unlinkSync(tempSitemapPath);
      fs.unlinkSync(tempSitemapIndexPath);

      console.log("Sitemap generation and upload complete");
      return null;
    } catch (error) {
      console.error("Error generating sitemap:", error);
      throw error;
    }
  }
);
