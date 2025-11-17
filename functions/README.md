# Firebase Cloud Functions for VideoGameOtaku

This directory contains the Firebase Cloud Functions that power the backend of VideoGameOtaku.

## Sitemap Generation and SEO Improvements

### Overview

The sitemap generation process has been enhanced to fix the following issues:

1. Race conditions between post creation/validation and sitemap regeneration
2. Missing debouncing mechanism leading to redundant sitemap generations
3. Poor error handling and reporting
4. Limited SEO for Single Page Application (SPA) dynamic routes
5. Security concerns with hardcoded API keys

### Components

#### Sitemap Generation

- **generateSitemap.js**: Core module for sitemap generation with retry logic, error handling, and Firestore logging
- **generateSitemapScheduled.js**: Scheduled function that runs every 6 hours to ensure the sitemap is up-to-date
- **index.js**: Contains `validatePost` function that triggers sitemap regeneration after a post is published

#### Debounce Mechanism

- **regenerateSitemapWithDebounce**: Function in `index.js` that prevents multiple sitemap generations within 5 minutes
- Uses Firestore transactions on `sitemapLocks/lastGeneration` document for atomic operations

#### SPA SEO Optimization

- **prerender**: Function in `index.js` that renders dynamic routes for search engine crawlers using Puppeteer
- Firebase hosting configuration directs crawler requests to this function

#### Error Handling and Monitoring

- Retry logic (up to 3 attempts) for sitemap generation
- Logging to Firestore collections:
  - `sitemapLogs`: Records successful generations
  - `sitemapErrors`: Records failures with stack traces
  - `sitemapLocks`: Tracks generation locks and scheduled runs

#### Security

- API key for manual sitemap generation stored as a Firebase secret (SITEMAP_API_KEY)
- Firestore security rules to restrict access to sitemap collections

### Usage

#### Automatic Sitemap Generation

Sitemaps are automatically generated:

1. After a post is validated and published (with debouncing)
2. Every 6 hours via scheduled function

#### Manual Sitemap Generation

To manually trigger sitemap generation:

```bash
curl -X POST "https://<region>-<project-id>.cloudfunctions.net/updateIndexing?key=<SITEMAP_API_KEY>"
```

#### Monitoring

Admins can view logs and errors in Firestore collections:

- `sitemapLogs`
- `sitemapErrors`

### Dependencies

- Puppeteer: For pre-rendering SPA routes
- Firebase Admin SDK: For Firestore operations and bucket uploads

### Configuration

The following Firebase secrets must be configured:

- `WEBSITE_URL`: The website URL (e.g., videogameotaku.com)
- `SITEMAP_API_KEY`: Secret key for manual sitemap generation

Set these using:

```bash
firebase functions:secrets:set WEBSITE_URL
firebase functions:secrets:set SITEMAP_API_KEY
```

## Post Web Memory (news posts)

- Set `OPENAI_API_KEY` as a Firebase secret.
- Feature flag via `POST_WEB_MEMORY_ENABLED` (defaults to `true`).
- Optional `SEARCH_ENGINE_BASE_URL` to point the scraper at a non-Google search engine (default DuckDuckGo).
- Stores output in `posts/{postId}/meta/postWebMemory` for bots to reference casually.
