import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

const ShareButtons = ({ url, title, darkMode }) => {
  const shareUrls = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
      url
    )}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(
      url
    )}&text=${encodeURIComponent(title)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
      url
    )}`,
    reddit: `https://reddit.com/submit?url=${encodeURIComponent(
      url
    )}&title=${encodeURIComponent(title)}`,
  };

  const shareOptions = [
    { id: "facebook", label: "Share on Facebook", name: "Facebook" },
    { id: "twitter", label: "Share on X", name: "X (Twitter)" },
    { id: "linkedin", label: "Share on LinkedIn", name: "LinkedIn" },
    { id: "reddit", label: "Share on Reddit", name: "Reddit" },
  ];

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleShare = (platform, e) => {
    e.stopPropagation();
    setIsDropdownOpen(false);
    window.open(shareUrls[platform], "_blank", "width=600,height=400");
  };

  const renderIcon = (platform, customClassName) => {
    const className =
      customClassName || (platform === "twitter" ? "w-4 h-4" : "w-5 h-5");

    switch (platform) {
      case "facebook":
        return (
          <svg className={className} fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.77 7.46H14.5v-1.9c0-.9.6-1.1 1-1.1h3V.5h-4.33C10.24.5 9.5 3.44 9.5 5.32v2.15h-3v4h3v12h5v-12h3.85l.42-4z" />
          </svg>
        );
      case "twitter":
        return (
          <svg className={className} fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        );
      case "linkedin":
        return (
          <svg className={className} fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
        );
      case "reddit":
        return (
          <svg className={className} fill="currentColor" viewBox="0 0 24 24">
            <path d="M24 11.779c0-1.459-1.192-2.645-2.657-2.645-.715 0-1.363.286-1.84.746-1.81-1.191-4.259-1.949-6.971-2.046l1.483-4.669 4.016.941-.006.058c0 1.193.975 2.163 2.174 2.163 1.198 0 2.172-.97 2.172-2.163s-.975-2.164-2.172-2.164c-.92 0-1.704.574-2.021 1.379l-4.329-1.015c-.189-.046-.381.063-.44.249l-1.654 5.207c-2.838.034-5.409.798-7.3 2.025-.474-.438-1.103-.712-1.799-.712-1.465 0-2.656 1.187-2.656 2.646 0 .97.533 1.811 1.317 2.271-.052.282-.086.567-.086.857 0 3.911 4.808 7.093 10.719 7.093s10.72-3.182 10.72-7.093c0-.274-.029-.544-.075-.81.832-.447 1.405-1.312 1.405-2.318zm-17.224 1.816c0-.868.71-1.575 1.582-1.575.872 0 1.581.707 1.581 1.575s-.709 1.574-1.581 1.574-1.582-.706-1.582-1.574zm9.061 4.669c-.797.793-2.048 1.179-3.824 1.179l-.013-.003-.013.003c-1.777 0-3.028-.386-3.824-1.179-.145-.144-.145-.379 0-.523.145-.145.381-.145.526 0 .65.647 1.729.961 3.298.961l.013.003.013-.003c1.569 0 2.648-.315 3.298-.962.145-.145.381-.144.526 0 .145.145.145.379 0 .524zm-.189-3.095c-.872 0-1.581-.706-1.581-1.574 0-.868.709-1.575 1.581-1.575s1.581.707 1.581 1.575-.709 1.574-1.581 1.574z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const inlineButtonClass = `p-2 rounded-full transition-colors ${
    darkMode
      ? "bg-gray-800 hover:bg-gray-700 text-gray-300"
      : "bg-gray-100 hover:bg-gray-200 text-gray-700"
  }`;

  const dropdownButtonClass = `flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    darkMode
      ? "bg-gray-800 text-gray-200 hover:bg-gray-700"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
  }`;

  return (
    <div className="flex items-center space-x-2">
      <div className="hidden items-center space-x-2 min-[840px]:flex">
        {shareOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={(e) => handleShare(option.id, e)}
            className={inlineButtonClass}
            aria-label={option.label}
          >
            {renderIcon(option.id)}
          </button>
        ))}
      </div>
      <div className="relative min-[840px]:hidden" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ${
            darkMode
              ? "bg-gray-800 text-gray-200 hover:bg-gray-700"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          aria-haspopup="true"
          aria-expanded={isDropdownOpen}
        >
          Share
          <svg
            className="ml-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {isDropdownOpen ? (
          <div
            className={`absolute left-0 min-[500px]:left-auto min-[500px]:right-0 z-20 mt-2 w-48 rounded-xl border p-3 shadow-lg ${
              darkMode
                ? "border-gray-700 bg-gray-900 text-gray-100 shadow-black/40"
                : "border-gray-200 bg-white text-gray-800 shadow-gray-300/40"
            }`}
          >
            <div className="flex flex-col gap-2">
              {shareOptions.map((option) => (
                <button
                  key={`${option.id}-dropdown`}
                  type="button"
                  onClick={(e) => handleShare(option.id, e)}
                  className={dropdownButtonClass}
                >
                  <span className="flex items-center gap-3">
                    {renderIcon(option.id, "h-4 w-4")}
                    <span>{option.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

ShareButtons.propTypes = {
  url: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  darkMode: PropTypes.bool.isRequired,
};

export default ShareButtons;
