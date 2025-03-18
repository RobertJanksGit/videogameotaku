import { Helmet } from "react-helmet-async";
import PropTypes from "prop-types";

/**
 * Creates a teaser from content by extracting the first 100 words
 * and adding ellipsis if the content is longer.
 *
 * @param {string} content - The full content text
 * @param {number} wordLimit - Maximum number of words (default: 100)
 * @returns {string} Formatted teaser text
 */
export const createTeaser = (content = "", wordLimit = 100) => {
  // Remove any image tags or markdown syntax
  const cleanContent = content
    .replace(/\[img:.*?\|.*?\]/g, "")
    .replace(/\[Source\]\([^)]+\)/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/#{1,6}\s/g, "");

  const words = cleanContent.split(/\s+/);
  const teaser = words.slice(0, wordLimit).join(" ");
  return words.length > wordLimit ? `${teaser}...` : teaser;
};

const SEO = ({
  title,
  description,
  image,
  url,
  type = "website",
  keywords,
  author = "Video Game Otaku",
  publishedTime,
  modifiedTime,
  section = "Gaming",
  tags = [],
}) => {
  const siteUrl = import.meta.env.VITE_APP_URL || "https://videogameotaku.com";
  const defaultImage = `${siteUrl}/logo.svg`;
  const fullTitle = `${title} | Video Game Otaku`;

  // Ensure description is properly formatted with a reasonable length
  const formattedDescription = description
    ? description.length > 300
      ? description.substring(0, 297) + "..."
      : description
    : "Video Game Otaku - Latest gaming news, reviews, and community discussions";

  // Ensure URL is absolute
  const absoluteUrl = url?.startsWith("http") ? url : `${siteUrl}${url || ""}`;

  return (
    <Helmet>
      {/* Basic Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={formattedDescription} />
      {keywords && <meta name="keywords" content={keywords} />}
      <meta name="author" content={author} />
      <meta
        name="robots"
        content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
      />

      {/* Open Graph Meta Tags */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={formattedDescription} />
      <meta property="og:image" content={image || defaultImage} />
      <meta property="og:image:alt" content={title} />
      <meta property="og:url" content={absoluteUrl} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content="Video Game Otaku" />
      {publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {modifiedTime && (
        <meta property="article:modified_time" content={modifiedTime} />
      )}
      {type === "article" && (
        <meta property="article:section" content={section} />
      )}
      {tags.map((tag) => (
        <meta property="article:tag" content={tag} key={tag} />
      ))}

      {/* Twitter Card Meta Tags */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@VideoGameOtaku" />
      <meta name="twitter:creator" content="@VideoGameOtaku" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={formattedDescription} />
      <meta name="twitter:image" content={image || defaultImage} />
      <meta name="twitter:image:alt" content={title} />

      {/* Additional Social Media Meta Tags */}
      <meta
        property="fb:app_id"
        content={import.meta.env.VITE_FACEBOOK_APP_ID}
      />
      <meta name="linkedin:title" content={title} />
      <meta name="linkedin:description" content={formattedDescription} />
      <meta name="linkedin:image" content={image || defaultImage} />

      {/* Additional SEO Meta Tags */}
      <meta name="googlebot" content="index, follow" />
      <meta name="google" content="notranslate" />
      <meta name="format-detection" content="telephone=no" />
      <link rel="canonical" href={absoluteUrl} />

      {/* PWA Meta Tags */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content="Video Game Otaku" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="theme-color" content="#3B82F6" />
      <link rel="manifest" href="/manifest.json" />
    </Helmet>
  );
};

SEO.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  image: PropTypes.string,
  url: PropTypes.string,
  type: PropTypes.string,
  keywords: PropTypes.string,
  author: PropTypes.string,
  publishedTime: PropTypes.string,
  modifiedTime: PropTypes.string,
  section: PropTypes.string,
  tags: PropTypes.arrayOf(PropTypes.string),
};

export default SEO;
