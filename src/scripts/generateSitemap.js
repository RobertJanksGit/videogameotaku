/* eslint-env node */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { create } from "xmlbuilder2";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// Initialize Firebase with your config
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SITE_URL = "https://videogameotaku.com";

async function generateSitemap() {
  try {
    // Fetch all published posts ordered by last modified date
    const postsQuery = query(
      collection(db, "posts"),
      where("status", "==", "published"),
      orderBy("updatedAt", "desc")
    );
    const postsSnapshot = await getDocs(postsQuery);

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

    // Write to file
    fs.writeFileSync(path.join(process.cwd(), "public", "sitemap.xml"), xml);
    console.log("Enhanced sitemap generated successfully!");

    // Generate sitemap index file
    generateSitemapIndex();
  } catch (error) {
    console.error("Error generating sitemap:", error);
  } finally {
    process.exit();
  }
}

function generateSitemapIndex() {
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

    // Write to file
    fs.writeFileSync(
      path.join(process.cwd(), "public", "sitemapindex.xml"),
      xml
    );
    console.log("Sitemap index generated successfully!");
  } catch (error) {
    console.error("Error generating sitemap index:", error);
  }
}

generateSitemap();
