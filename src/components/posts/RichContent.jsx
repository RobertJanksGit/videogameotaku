import React from "react";
import PropTypes from "prop-types";

const RichContent = ({ content, darkMode }) => {
  const renderContent = () => {
    if (!content) return null;

    // Split content by image tags
    const parts = content.split(/(\[img:[^\]]+\])/);

    return parts.map((part, index) => {
      // Check if this part is an image tag
      const imgMatch = part.match(/\[img:([^|]+)\|([^\]]+)\]/);
      if (imgMatch) {
        const [, url, alt] = imgMatch;
        return (
          <img
            key={index}
            src={url}
            alt={alt}
            className="max-w-full h-auto rounded-lg my-4"
          />
        );
      }

      // Regular text content
      return (
        <span
          key={index}
          className={darkMode ? "text-gray-300" : "text-gray-600"}
        >
          {part}
        </span>
      );
    });
  };

  return (
    <div className="rich-content space-y-4 whitespace-pre-wrap">
      {renderContent()}
    </div>
  );
};

RichContent.propTypes = {
  content: PropTypes.string.isRequired,
  darkMode: PropTypes.bool.isRequired,
};

export default RichContent;
