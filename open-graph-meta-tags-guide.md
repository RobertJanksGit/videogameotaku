# Open Graph Meta Tags Implementation Guide

This guide explains how the Open Graph meta tags solution works and how to test and deploy it.

## What We've Implemented

1. **Enhanced SEO Component**: Updated the existing SEO component to better handle post data and format descriptions properly.

2. **Teaser Creation Utility**: Added a utility function to create clean teasers/excerpts from post content for meta descriptions.

3. **Server-Side Meta Tags**: Created a Firebase Cloud Function that serves pre-rendered HTML with proper Open Graph meta tags to social media crawlers like Facebook, Twitter, etc.

4. **Conditional Routing**: Updated Firebase hosting configuration to route crawler requests to our Cloud Function.

## How It Works

When a social media crawler (like Facebook's scraper) visits a post page:

1. The Firebase hosting configuration detects the crawler's user agent
2. The request is routed to our `socialMediaMetaTags` Cloud Function
3. The function fetches the post data from Firestore
4. It generates proper meta tags based on the post data
5. It returns an HTML document with the meta tags embedded

When a regular user visits, they get the normal SPA experience with client-side rendering.

## Configuration

Before deploying, add these secrets to your Firebase Functions:

```bash
firebase functions:secrets:set WEBSITE_URL
# Enter: https://videogameotaku.com

firebase functions:secrets:set APP_NAME
# Enter: Video Game Otaku
```

## Deployment

Deploy the changes with:

```bash
npm run build  # Build your React app
firebase deploy  # Deploy everything
```

Or to deploy just the functions and hosting configuration:

```bash
firebase deploy --only functions:socialMediaMetaTags,hosting
```

## Testing

To test if the Open Graph meta tags are working correctly:

### 1. Use Facebook's Sharing Debugger

Visit [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) and enter your post URL:
`https://videogameotaku.com/post/{postId}`

The debugger will show you what Facebook sees when your link is shared. You should see:

- Post title as the og:title
- Post teaser (first 100 words) as og:description
- Post image as og:image
- The correct URL as og:url
- "article" as og:type

If you see warnings or errors, you can click "Scrape Again" to refresh the data.

### 2. Manual Testing with cURL

You can simulate how crawlers see your page with this cURL command:

```bash
curl -A "facebookexternalhit/1.1" https://videogameotaku.com/post/{postId}
```

Look for the `<meta property="og:...">` tags in the response.

### 3. Other Tools

- [Twitter Card Validator](https://cards-dev.twitter.com/validator)
- [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/)
- [OpenGraph.xyz](https://www.opengraph.xyz/) (enter your URL to check all meta tags)

## Troubleshooting

If meta tags aren't appearing correctly:

1. **Check Function Logs**: Look at Firebase Function logs for errors

   ```bash
   firebase functions:log --only socialMediaMetaTags
   ```

2. **Verify Firestore Access**: Ensure the function can access your Firestore database

3. **Test URL Patterns**: Verify that URLs match the expected format `/post/{postId}`

4. **Cache Issues**: Facebook caches scrape results. Use "Scrape Again" in the debugger

5. **Image Issues**: Make sure images are accessible and properly sized (Facebook recommends at least 1200x630 pixels)

## Adapting to Other Frameworks

This solution is framework-agnostic since it works at the hosting/server level. However:

### For Next.js

If you switch to Next.js, you can use its built-in SSR capabilities instead:

```jsx
// pages/post/[postId].js
export async function getServerSideProps({ params }) {
  const { postId } = params;
  // Fetch post data from Firestore
  // ...
  return { props: { post } };
}

function PostPage({ post }) {
  return (
    <Head>
      <title>{post.title}</title>
      <meta property="og:title" content={post.title} />
      {/* other meta tags */}
    </Head>
    // rest of your component
  );
}
```

### For Static Site Generation (Gatsby, Astro, etc.)

If using a static site generator, pre-generate pages with meta tags at build time.

## Additional Resources

- [The Open Graph Protocol](https://ogp.me/)
- [Facebook Sharing Best Practices](https://developers.facebook.com/docs/sharing/best-practices/)
- [Firebase Hosting with Dynamic Content](https://firebase.google.com/docs/hosting/functions)
