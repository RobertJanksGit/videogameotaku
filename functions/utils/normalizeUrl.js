/**
 * Ensures a URL has the proper protocol prefix (https://)
 *
 * @param {string} url - The URL to normalize
 * @returns {string} - The normalized URL with proper https:// prefix
 */
export default function normalizeUrl(url) {
  if (!url) return "";

  const trimmedUrl = url.trim();

  // Check if the URL already has a protocol
  if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    // If it starts with http://, convert to https://
    if (trimmedUrl.startsWith("http://")) {
      return trimmedUrl.replace(/^http:\/\//i, "https://");
    }
    return trimmedUrl;
  }

  // Add https:// prefix if missing
  return `https://${trimmedUrl}`;
}
