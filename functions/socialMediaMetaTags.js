import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

// Initialize Firebase Admin if not already initialized
try {
  admin.initializeApp();
} catch (e) {
  // App already initialized
}

// Define the website URL and app name as secrets
const WEBSITE_URL = defineSecret("WEBSITE_URL");
const APP_NAME = defineSecret("APP_NAME");

// Helper function to ensure URLs have the proper prefix
const normalizeUrl = (url) => {
  if (!url) return "";
  const trimmedUrl = url.trim();
  if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    return trimmedUrl;
  }
  return `https://${trimmedUrl}`;
};

// Function to create a teaser (excerpt) from content
const createTeaser = (content = "", wordLimit = 100) => {
  if (!content) return "";

  // Remove any image tags, markdown or HTML
  const cleanContent = content
    .replace(/\[img:.*?\|.*?\]/g, "")
    .replace(/\[Source\]\([^)]+\)/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/#{1,6}\s/g, "");

  const words = cleanContent.split(/\s+/);
  const teaser = words.slice(0, wordLimit).join(" ");
  return words.length > wordLimit ? `${teaser}...` : teaser;
};

/**
 * Cloud Function that serves pre-rendered HTML with Open Graph meta tags
 * for social media crawlers. This ensures Facebook, Twitter, and other platforms
 * can properly display link previews even though the main site is a SPA.
 */
export const socialMediaMetaTags = onRequest(
  {
    secrets: [WEBSITE_URL, APP_NAME],
    maxInstances: 10,
    timeoutSeconds: 10,
    memory: "256MiB",
  },
  async (req, res) => {
    // Set security headers
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("X-XSS-Protection", "1; mode=block");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");

    try {
      // Extract path from the URL
      const url = new URL(req.url, `https://${req.hostname}`);
      const pathSegments = url.pathname.split("/").filter(Boolean);

      // Get normalized website URL
      const websiteUrl = normalizeUrl(WEBSITE_URL.value());

      // Default meta values
      let metaTags = {
        title: APP_NAME.value() || "Video Game Otaku",
        description:
          "The latest gaming news, reviews, and community discussions",
        image: `${websiteUrl}/logo.svg`,
        url: websiteUrl,
        type: "website",
      };

      // Check if this is a post page request (/post/[postId])
      if (pathSegments[0] === "post" && pathSegments[1]) {
        const postId = pathSegments[1];
        const db = getFirestore();

        console.log(`Attempting to fetch post data for ID: ${postId}`);

        try {
          // Get post data from Firestore
          const postDoc = await db.collection("posts").doc(postId).get();

          console.log(`Post exists: ${postDoc.exists}`);

          if (postDoc.exists) {
            const post = postDoc.data();
            console.log(`Found post with title: ${post.title}`);

            // Create post teaser
            const postTeaser = createTeaser(post.content);

            // Format dates
            const publishDate = post.createdAt?.toDate().toISOString();
            const modifiedDate = post.updatedAt
              ? post.updatedAt.toDate().toISOString()
              : publishDate;

            // Set meta tags for this post
            metaTags = {
              title: post.title,
              description: postTeaser,
              image: normalizeUrl(post.imageUrl) || metaTags.image,
              url: `${websiteUrl}/post/${postId}`,
              type: "article",
              publishedTime: publishDate,
              modifiedTime: modifiedDate,
              author: post.authorName,
              section: post.category || "Gaming",
              tags: Array.isArray(post.platforms) ? post.platforms : [],
            };
          } else {
            console.log(`Post ${postId} not found in Firestore`);
            // Post not found, set 404 meta
            metaTags = {
              title: "Post Not Found | Video Game Otaku",
              description: "The requested post could not be found",
              image: metaTags.image,
              url: `${websiteUrl}/post/${postId}`,
              type: "website",
            };
          }
        } catch (error) {
          console.error(`Error fetching post ${postId}:`, error);
          // Error fetching post, set error meta
          metaTags = {
            title: "Error Fetching Post | Video Game Otaku",
            description: "There was an error fetching the requested post",
            image: metaTags.image,
            url: `${websiteUrl}/post/${postId}`,
            type: "website",
          };
        }
      }

      // Detect crawler type to optimize response
      const userAgent = req.get("User-Agent") || "";
      const isFacebookBot = /facebookexternalhit|Facebot|Facebook/i.test(
        userAgent
      );
      const isTwitterBot = /Twitterbot/i.test(userAgent);
      const isLinkedInBot = /LinkedInBot/i.test(userAgent);
      const isSocialBot = isFacebookBot || isTwitterBot || isLinkedInBot;
      const isBot =
        isSocialBot ||
        /bot|crawler|spider|pinterest|google|bing|yandex/i.test(userAgent);

      // If this is a social media bot, serve only the meta tags without JS bundle
      // For regular browsers, redirect to the main app
      if (isBot) {
        console.log(
          `Bot detected: ${userAgent}. Serving meta tags for: ${url.pathname}`
        );

        // Generate HTML with just the necessary meta tags
        const html = generateHTML(metaTags);

        res.status(200).send(html);
      } else {
        // For regular users, we'll redirect to the root with a hash fragment
        // This will maintain the original path and work with client-side routing
        console.log(
          `Regular user detected. Redirecting with path hash for: ${url.pathname}`
        );

        // Set cache control to prevent browser caching redirect
        res.set(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate"
        );
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");

        // Redirect to the index page with a special parameter that the client can use
        // to restore the original route after the page loads
        res.redirect(302, `/?redirect=${encodeURIComponent(url.pathname)}`);
      }
    } catch (error) {
      console.error("Error generating meta tags:", error);
      res.status(500).send("Error generating meta tags");
    }
  }
);

/**
 * Generate HTML with appropriate meta tags
 */
function generateHTML(metaTags) {
  const tagsArray = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${metaTags.title}</title>`,
    `<meta name="description" content="${metaTags.description}">`,

    // Open Graph tags
    `<meta property="og:title" content="${metaTags.title}">`,
    `<meta property="og:description" content="${metaTags.description}">`,
    `<meta property="og:image" content="${metaTags.image}">`,
    `<meta property="og:url" content="${metaTags.url}">`,
    `<meta property="og:type" content="${metaTags.type}">`,
    `<meta property="og:site_name" content="${
      APP_NAME.value() || "Video Game Otaku"
    }">`,

    // Twitter Card tags
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${metaTags.title}">`,
    `<meta name="twitter:description" content="${metaTags.description}">`,
    `<meta name="twitter:image" content="${metaTags.image}">`,
    `<meta name="twitter:image:alt" content="${metaTags.title}">`,
  ];

  // Add article-specific tags if applicable
  if (metaTags.type === "article") {
    if (metaTags.publishedTime) {
      tagsArray.push(
        `<meta property="article:published_time" content="${metaTags.publishedTime}">`
      );
    }
    if (metaTags.modifiedTime) {
      tagsArray.push(
        `<meta property="article:modified_time" content="${metaTags.modifiedTime}">`
      );
    }
    if (metaTags.author) {
      tagsArray.push(
        `<meta property="article:author" content="${metaTags.author}">`
      );
    }
    if (metaTags.section) {
      tagsArray.push(
        `<meta property="article:section" content="${metaTags.section}">`
      );
    }
    if (Array.isArray(metaTags.tags)) {
      metaTags.tags.forEach((tag) => {
        tagsArray.push(`<meta property="article:tag" content="${tag}">`);
      });
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${tagsArray.join("\n  ")}
  <link rel="canonical" href="${metaTags.url}">
</head>
<body>
  <h1>${metaTags.title}</h1>
  <p>${metaTags.description}</p>
  <p>You are viewing a simplified version of this page optimized for social media sharing. <a href="${
    metaTags.url
  }">Click here</a> to visit the full page.</p>
</body>
</html>`;
}
