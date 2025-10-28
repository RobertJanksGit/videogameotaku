import { onRequest } from "firebase-functions/v2/https";
import { renderPage } from "vite-plugin-ssr/server";

export const ssr = onRequest(
  {
    maxInstances: 10,
    memory: "1GiB",
    timeoutSeconds: 60,
    secrets: [],
  },
  async (req, res) => {
    try {
      // Set security headers
      res.set("X-Content-Type-Options", "nosniff");
      res.set("X-Frame-Options", "DENY");
      res.set("X-XSS-Protection", "1; mode=block");
      res.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
      res.set("Content-Security-Policy", "default-src 'self'");

      const userAgent = req.get("User-Agent") || "";
      const isCrawler =
        /bot|googlebot|crawler|spider|robot|crawling|slurp|bingbot|yandex|baiduspider|facebookexternalhit|Facebot|Twitterbot|Pinterest|LinkedInBot|WhatsApp/i.test(
          userAgent
        );

      // Only do SSR for crawlers, redirect regular users to SPA
      if (!isCrawler) {
        const websiteUrl =
          process.env.WEBSITE_URL || "https://videogameotaku.com";
        res.redirect(`${websiteUrl}${req.path}`);
        return;
      }

      console.log(`SSR request for crawler: ${userAgent} - Path: ${req.path}`);

      // Import the build dynamically
      const { importBuild } = await import("./dist/server/importBuild.mjs");

      // Render the page using Vike
      const pageContextInit = {
        urlOriginal: req.path,
        userAgent,
      };

      const pageContext = await renderPage(pageContextInit);
      const { httpResponse } = pageContext;

      if (!httpResponse) {
        res.status(404).send("Page not found");
        return;
      }

      const { body, statusCode, headers } = httpResponse;

      // Set response headers
      headers.forEach(([name, value]) => res.set(name, value));

      res.status(statusCode).send(body);
    } catch (error) {
      console.error("SSR Error:", error);

      // Return fallback content for crawlers
      res.status(500).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Video Game Otaku</title>
          <meta name="description" content="Video Game Otaku - Your source for video game news, reviews, guides and opinions">
        </head>
        <body>
          <h1>Video Game Otaku</h1>
          <p>We're experiencing technical difficulties. Please try again later.</p>
        </body>
        </html>
      `);
    }
  }
);
