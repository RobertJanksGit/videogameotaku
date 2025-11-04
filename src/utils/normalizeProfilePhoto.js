const GOOGLE_SIZE_PATTERN = /(=s)(\d+)(-[^/?&]*)?/i;
const GOOGLE_QUERY_PATTERN = /([?&])(sz|s)=\d+/i;

export const normalizeProfilePhoto = (url, desiredSize = 256) => {
  if (!url) return url;

  const normalizeGoogleUrl = (input) => {
    if (!input) return input;

    if (GOOGLE_SIZE_PATTERN.test(input)) {
      return input.replace(GOOGLE_SIZE_PATTERN, (_, prefix, __, suffix = "") => {
        const normalizedSuffix = suffix || "-c";
        return `${prefix}${desiredSize}${normalizedSuffix}`;
      });
    }

    if (GOOGLE_QUERY_PATTERN.test(input)) {
      return input.replace(GOOGLE_QUERY_PATTERN, (_, sep, key) => `${sep}${key}=${desiredSize}`);
    }

    if (input.includes("?")) {
      const separator = input.endsWith("?") || input.endsWith("&") ? "" : "&";
      return `${input}${separator}sz=${desiredSize}`;
    }

    return `${input}=s${desiredSize}-c`;
  };

  try {
    const parsed = new URL(url);

    // Handle Google profile images (Firebase / Google auth)
    if (parsed.hostname.includes("googleusercontent.com")) {
      return normalizeGoogleUrl(parsed.toString());
    }

    // Handle Gravatar images (?s= size param)
    if (parsed.hostname.includes("gravatar.com")) {
      parsed.searchParams.set("s", String(desiredSize));
      return parsed.toString();
    }

    return url;
  } catch (error) {
    // Fallback to regex replacement when URL constructor fails (e.g., protocol-relative URLs)
    if (/googleusercontent\.com/.test(url)) {
      return normalizeGoogleUrl(url);
    }
    return url;
  }
};

export default normalizeProfilePhoto;

