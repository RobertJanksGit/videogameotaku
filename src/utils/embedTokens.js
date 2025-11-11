// Centralized helpers for working with the custom `{{embed ...}}` syntax.
// To add a new provider, update `SUPPORTED_PROVIDERS` and the host-matching
// logic inside `matchProviderForUrl`.

const SUPPORTED_PROVIDERS = {
  twitter: {
    label: "X / Twitter",
    hosts: ["x.com", "twitter.com"],
  },
  youtube: {
    label: "YouTube",
    hosts: ["youtube.com", "youtu.be"],
  },
  twitch: {
    label: "Twitch",
    hosts: ["twitch.tv"],
  },
};

const hostMatches = (hostname, pattern) => {
  if (hostname === pattern) return true;
  if (hostname.endsWith(`.${pattern}`)) return true;
  return false;
};

const sanitizeHostname = (hostname) =>
  hostname.replace(/^www\./i, "").toLowerCase();

const matchProviderForUrl = (urlObj) => {
  const hostname = sanitizeHostname(urlObj.hostname);
  return Object.entries(SUPPORTED_PROVIDERS).find(([, config]) =>
    config.hosts.some((host) => hostMatches(hostname, host))
  );
};

const isSafeProtocol = (urlObj) =>
  urlObj.protocol === "https:" || urlObj.protocol === "http:";

const buildUnknownProviderMessage = () =>
  "Only X, YouTube, and Twitch links are supported right now.";

export const validateEmbedUrl = (rawUrl) => {
  let urlObj;
  try {
    urlObj = new URL(rawUrl);
  } catch (error) {
    return {
      ok: false,
      errorMessage: "Please enter a valid URL.",
    };
  }

  if (!isSafeProtocol(urlObj)) {
    return {
      ok: false,
      errorMessage: "Only http and https links are supported.",
    };
  }

  const match = matchProviderForUrl(urlObj);
  if (!match) {
    return {
      ok: false,
      errorMessage: buildUnknownProviderMessage(),
    };
  }

  const [providerKey] = match;
  return {
    ok: true,
    provider: providerKey,
    url: rawUrl,
    normalizedUrl: urlObj.toString(),
  };
};

export const buildEmbedToken = (provider, url) =>
  `{{embed type="${provider}" url="${url}"}}`;

const EMBED_TOKEN_PATTERN =
  /\{\{\s*embed\s+type="([^"]+)"\s+url="([^"]+)"\s*\}\}/gi;

export const EMBED_TOKEN_REGEX = EMBED_TOKEN_PATTERN;

export const parseEmbedToken = (token) => {
  if (!token) return null;
  const trimmed = token.trim();
  const match = trimmed.match(
    /\{\{\s*embed\s+type="([^"]+)"\s+url="([^"]+)"\s*\}\}/i
  );

  if (!match) {
    return null;
  }

  const provider = match[1].toLowerCase();
  const url = match[2];

  if (!SUPPORTED_PROVIDERS[provider]) {
    return null;
  }

  try {
    const urlObj = new URL(url);
    if (!isSafeProtocol(urlObj)) {
      return null;
    }

    const hostMatch = matchProviderForUrl(urlObj);
    if (!hostMatch) {
      return null;
    }

    const [matchedProvider] = hostMatch;
    if (matchedProvider !== provider) {
      return null;
    }

    return {
      provider,
      url,
      normalizedUrl: urlObj.toString(),
    };
  } catch (error) {
    return null;
  }
};

export const findEmbedTokens = (content = "") => {
  if (!content) return [];
  const matches = content.matchAll(EMBED_TOKEN_PATTERN);
  const tokens = [];
  for (const match of matches) {
    const parsed = parseEmbedToken(match[0]);
    if (parsed) {
      tokens.push({
        fullMatch: match[0],
        provider: parsed.provider,
        url: parsed.url,
        index: match.index,
      });
    }
  }
  return tokens;
};

export const supportedProvidersList = () =>
  Object.keys(SUPPORTED_PROVIDERS);


