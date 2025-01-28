import PropTypes from "prop-types";
import { useTheme } from "../../contexts/ThemeContext";

const ContentGuidelines = () => {
  const { darkMode } = useTheme();

  return (
    <div className="w-full">
      <div
        className={`w-full p-4 rounded-lg ${
          darkMode
            ? "bg-gray-800 text-gray-200 border-gray-700"
            : "bg-white text-gray-900 border-gray-200"
        } border`}
      >
        <h1
          className={`text-2xl font-bold mb-6 ${
            darkMode ? "text-white" : "text-gray-900"
          }`}
        >
          Content Guidelines
        </h1>
        <div className="space-y-6">
          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              General Guidelines
            </h2>
            <ul
              className={`list-disc pl-5 space-y-2 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <li>
                Content must be gaming-related and relevant to our community
              </li>
              <li>
                Posts should be well-written and free of major spelling/grammar
                errors
              </li>
              <li>
                Provide accurate information and cite sources when necessary
              </li>
              <li>No plagiarism or copied content from other sources</li>
            </ul>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              Content Quality
            </h2>
            <ul
              className={`list-disc pl-5 space-y-2 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <li>Posts should have clear, descriptive titles</li>
              <li>
                Content should be substantial and provide value to readers
              </li>
              <li>Include relevant details and context</li>
              <li>Organize content with proper formatting and structure</li>
            </ul>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              Prohibited Content
            </h2>
            <ul
              className={`list-disc pl-5 space-y-2 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <li>Hate speech, discrimination, or offensive content</li>
              <li>Spam, excessive self-promotion, or advertising</li>
              <li>Personal attacks or harassment</li>
              <li>Unverified leaks or rumors presented as facts</li>
              <li>
                Content that violates copyright or intellectual property rights
              </li>
            </ul>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              Post Categories
            </h2>
            <div
              className={`space-y-4 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <div>
                <h3
                  className={`text-lg font-medium mb-2 ${
                    darkMode ? "text-gray-200" : "text-gray-700"
                  }`}
                >
                  News
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Must be recent and relevant gaming news</li>
                  <li>Include date and source of information</li>
                  <li>Focus on facts rather than speculation</li>
                </ul>
              </div>

              <div>
                <h3
                  className={`text-lg font-medium mb-2 ${
                    darkMode ? "text-gray-200" : "text-gray-700"
                  }`}
                >
                  Reviews
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Provide balanced and fair assessment</li>
                  <li>Include both positive and negative aspects</li>
                  <li>Base opinions on actual experience with the game</li>
                </ul>
              </div>

              <div>
                <h3
                  className={`text-lg font-medium mb-2 ${
                    darkMode ? "text-gray-200" : "text-gray-700"
                  }`}
                >
                  Guides
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Clear, step-by-step instructions</li>
                  <li>
                    Include relevant screenshots or diagrams when possible
                  </li>
                  <li>Specify game version/patch if applicable</li>
                </ul>
              </div>

              <div>
                <h3
                  className={`text-lg font-medium mb-2 ${
                    darkMode ? "text-gray-200" : "text-gray-700"
                  }`}
                >
                  Opinion
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Clearly state that content is opinion-based</li>
                  <li>Support arguments with examples</li>
                  <li>Remain respectful of differing viewpoints</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              Moderation Process
            </h2>
            <ul
              className={`list-disc pl-5 space-y-2 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <li>All posts are reviewed before being published</li>
              <li>Posts that violate guidelines will be rejected</li>
              <li>
                Multiple rejections may result in temporary posting restrictions
              </li>
              <li>
                5 rejections within a period will result in a 24-hour posting
                ban
              </li>
              <li>
                Serious violations may result in immediate account restrictions
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

ContentGuidelines.propTypes = {
  darkMode: PropTypes.bool.isRequired,
};

export default ContentGuidelines;
