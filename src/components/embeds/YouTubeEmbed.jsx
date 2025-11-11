import PropTypes from "prop-types";

const extractVideoId = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (hostname.endsWith("youtube.com")) {
      if (url.searchParams.has("v")) {
        return url.searchParams.get("v");
      }

      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "shorts" && segments[1]) {
        return segments[1];
      }
      if ((segments[0] === "embed" || segments[0] === "v") && segments[1]) {
        return segments[1];
      }
    }

    return null;
  } catch (error) {
    return null;
  }
};

const YouTubeEmbed = ({ url, darkMode = false }) => {
  const videoId = extractVideoId(url);
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&color=${
        darkMode ? "white" : "red"
      }`
    : null;

  if (!embedUrl) {
    return (
      <div className="my-6 space-y-2">
        <p className="text-sm text-gray-500">
          We couldn&apos;t embed this YouTube link. Open it directly instead.
        </p>
        <a
          className="inline-flex items-center text-sm font-medium text-red-500 hover:text-red-400"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch on YouTube
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
          src={embedUrl}
          title="YouTube video"
          className="absolute inset-0 h-full w-full"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </div>
  );
};

YouTubeEmbed.propTypes = {
  url: PropTypes.string.isRequired,
  darkMode: PropTypes.bool,
};

export default YouTubeEmbed;

