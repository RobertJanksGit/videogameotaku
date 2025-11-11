import PropTypes from "prop-types";

const extractTwitchMeta = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments.length === 0) {
      return null;
    }

    if (segments[0] === "videos" && segments[1]) {
      return {
        label: "video",
        identifier: segments[1],
      };
    }

    if (segments[0] === "clip" && segments[1]) {
      return {
        label: "clip",
        identifier: segments[1],
      };
    }

    return {
      label: "channel",
      identifier: segments[0],
    };
  } catch (error) {
    return null;
  }
};

const buildEmbedSrc = (meta, darkMode) => {
  if (!meta || typeof window === "undefined") {
    return null;
  }

  const parent = window.location.hostname;
  const themeParam = darkMode ? "&theme=dark" : "";

  if (meta.label === "video") {
    return `https://player.twitch.tv/?video=${meta.identifier}&parent=${parent}&autoplay=false${themeParam}`;
  }

  if (meta.label === "clip") {
    return `https://clips.twitch.tv/embed?clip=${meta.identifier}&parent=${parent}&autoplay=false${themeParam}`;
  }

  return `https://player.twitch.tv/?channel=${meta.identifier}&parent=${parent}&autoplay=false${themeParam}`;
};

const TwitchEmbed = ({ url, darkMode = false }) => {
  const meta = extractTwitchMeta(url);
  const embedSrc = buildEmbedSrc(meta, darkMode);

  if (!embedSrc) {
    return (
      <div className="my-6 space-y-2">
        <p className="text-sm text-gray-500">
          We couldn&apos;t embed this Twitch link. Open it directly instead.
        </p>
        <a
          className="inline-flex items-center text-sm font-medium text-purple-500 hover:text-purple-400"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Twitch
          <svg
            className="ml-1 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 7l-10 10m0-10h10v10"
            />
          </svg>
        </a>
      </div>
    );
  }

  return (
    <div className="my-6">
      <div className="relative w-full overflow-hidden rounded-md bg-black pb-[56.25%]">
        <iframe
          src={embedSrc}
          title="Twitch embed"
          className="absolute inset-0 h-full w-full"
          frameBorder="0"
          allowFullScreen
          scrolling="no"
        />
      </div>
    </div>
  );
};

TwitchEmbed.propTypes = {
  url: PropTypes.string.isRequired,
  darkMode: PropTypes.bool,
};

export default TwitchEmbed;

