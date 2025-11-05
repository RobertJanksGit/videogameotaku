/**
 * Sitemap generation utility for Firebase Functions
 * This file contains the generateSitemap function used by Firebase Functions
 */

import admin from "firebase-admin";
import { create } from "xmlbuilder2";
import { Buffer } from "buffer";

// Firebase Admin instances (lazy loaded)
let storage;
let db;

function getStorageInstance() {
  if (!storage) {
    storage = admin.storage();
  }
  return storage;
}

function getFirestoreInstance() {
  if (!db) {
    db = admin.firestore();
  }
  return db;
}

const SITE_URL = "https://videogameotaku.com";

export async function generateSitemap() {
  try {
    // Get Firestore instance (lazy loaded)
    const firestore = getFirestoreInstance();

    // Fetch all published posts ordered by last modified date
    const postsSnapshot = await firestore
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
      url.ele("lastmod").txt(new Date().toISOString().slice(0, 10));
      url.ele("changefreq").txt(route.changefreq);
      url.ele("priority").txt(route.priority);
    });

    // Add category routes to sitemap
    categories.forEach((category) => {
      const url = sitemap.ele("url");
      url.ele("loc").txt(`${SITE_URL}/${category.path}`);
      url.ele("lastmod").txt(new Date().toISOString().slice(0, 10));
      url.ele("changefreq").txt(category.changefreq);
      url.ele("priority").txt(category.priority);
    });

    // Add dynamic post routes with images
    postsSnapshot.forEach((doc) => {
      const post = doc.data();
      const url = sitemap.ele("url");

      // Basic URL data
      url.ele("loc").txt(`${SITE_URL}/post/${doc.id}`);

      // Determine last modification date
      const lastModDate = post.updatedAt?.toDate() || post.createdAt?.toDate();
      const lastMod = lastModDate.toISOString().slice(0, 10);
      url.ele("lastmod").txt(lastMod);

      // Determine change frequency and priority based on age
      const now = new Date();
      const diffDays = Math.floor((now - lastModDate) / (1000 * 60 * 60 * 24));
      const changefreq =
        diffDays <= 7 ? "daily" : diffDays <= 30 ? "weekly" : "monthly";
      const priority = diffDays <= 7 ? "0.8" : "0.5";
      url.ele("changefreq").txt(changefreq);
      url.ele("priority").txt(priority);

      // Add image data if available
      if (post.imageUrl) {
        const image = url.ele("image:image");
        image.ele("image:loc").txt(post.imageUrl);
        image.ele("image:title").txt(post.title);
        image.ele("image:caption").txt(post.description || post.title);
      }

      // Add alternate language versions if available
      if (post.alternateLanguages) {
        Object.entries(post.alternateLanguages).forEach(([lang, altUrl]) => {
          url
            .ele("xhtml:link")
            .att("rel", "alternate")
            .att("hreflang", lang)
            .att("href", altUrl);
        });
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

    // Convert to XML string with pretty formatting
    const xml = sitemap.end({ prettyPrint: true });

    // Upload sitemap.xml to Firebase Storage
    const bucketName =
      process.env.STORAGE_BUCKET_NAME || process.env.FIREBASE_STORAGE_BUCKET;
    const bucket = bucketName
      ? getStorageInstance().bucket(bucketName)
      : getStorageInstance().bucket();
    const file = bucket.file("public/sitemap.xml");
    await file.save(Buffer.from(xml), {
      contentType: "application/xml",
      metadata: {
        cacheControl: "public, max-age=300",
      },
    });
    console.log("Sitemap uploaded to Storage successfully!");

    // Generate sitemap index file
    await generateSitemapIndex();
  } catch (error) {
    console.error("Error generating sitemap:", error);
    throw error;
  }
}

async function generateSitemapIndex() {
  try {
    // Create the sitemapindex
    const sitemapIndex = create({ version: "1.0", encoding: "UTF-8" }).ele(
      "sitemapindex",
      {
        xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
      }
    );

    // Add main sitemap
    const sitemap = sitemapIndex.ele("sitemap");
    sitemap.ele("loc").txt(`${SITE_URL}/sitemap.xml`);
    sitemap.ele("lastmod").txt(new Date().toISOString());

    // Convert to XML string
    const xml = sitemapIndex.end({ prettyPrint: true });

    // Upload sitemapindex.xml to Firebase Storage
    const bucketName =
      process.env.STORAGE_BUCKET_NAME || process.env.FIREBASE_STORAGE_BUCKET;
    const bucket = bucketName
      ? getStorageInstance().bucket(bucketName)
      : getStorageInstance().bucket();
    const file = bucket.file("public/sitemapindex.xml");
    await file.save(Buffer.from(xml), {
      contentType: "application/xml",
      metadata: {
        cacheControl: "public, max-age=300",
      },
    });
    console.log("Sitemap index uploaded to Storage successfully!");
  } catch (error) {
    console.error("Error generating sitemap index:", error);
    throw error;
  }
}
