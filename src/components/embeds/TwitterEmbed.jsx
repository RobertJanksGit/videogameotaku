import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import useExternalScript from "../../hooks/useExternalScript";

const extractTwitterMeta = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    const handle = parts[0];
    const statusId = parts[parts.length - 1];

    return {
      handle,
      statusId,
    };
  } catch (error) {
    return null;
  }
};

const TwitterEmbed = ({ url, darkMode = false }) => {
  const meta = extractTwitterMeta(url);
  const containerRef = useRef(null);
  const scriptStatus = useExternalScript("https://platform.twitter.com/widgets.js");

  useEffect(() => {
    if (!meta?.statusId || scriptStatus !== "loaded") {
      return;
    }

    const twttr = window.twttr;
    if (!twttr?.widgets?.createTweet || !containerRef.current) {
      return;
    }

    containerRef.current.innerHTML = "";
    twttr.widgets
      .createTweet(meta.statusId, containerRef.current, {
        theme: darkMode ? "dark" : "light",
        dnt: true,
      })
      .catch(() => {
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<p class="text-sm text-gray-500">Unable to load tweet.</p>';
        }
      });
  }, [meta?.statusId, scriptStatus, darkMode]);

  const showFallback = scriptStatus === "error" || !meta?.statusId;

  if (showFallback) {
    return (
      <div className="my-6 space-y-2">
        <p className="text-sm text-gray-500">Twitter embed unavailable.</p>
        <a
          className="inline-flex items-center text-sm font-medium text-blue-500 hover:text-blue-400"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on X
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
      {scriptStatus !== "loaded" && (
        <p className="mb-2 text-sm text-gray-500">Loading tweet…</p>
      )}
      <div ref={containerRef} />
    </div>
  );
};

TwitterEmbed.propTypes = {
  url: PropTypes.string.isRequired,
  darkMode: PropTypes.bool,
};

export default TwitterEmbed;

