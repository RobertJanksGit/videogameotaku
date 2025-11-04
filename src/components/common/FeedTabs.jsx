import PropTypes from "prop-types";

const FeedTabs = ({
  tabs,
  activeTab,
  onTabChange,
  darkMode = false,
  className = "",
}) => {
  return (
    <div className={`w-full ${className}`}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className={`inline-flex flex-wrap items-center gap-2 rounded-2xl border p-1 shadow-sm ${
          darkMode ? "border-gray-800 bg-[#121722]" : "border-gray-200 bg-white"
        }`}
      >
        {tabs.map(({ key, label, disabled }) => {
          const isActive = key === activeTab;

          return (
            <button
              key={key}
              id={`feed-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`feed-panel-${key}`}
              disabled={disabled}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (!disabled && key !== activeTab) {
                  onTabChange?.(key);
                }
              }}
              className={`relative flex items-center gap-1 rounded-xl border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                darkMode
                  ? "focus-visible:ring-blue-500/70 focus-visible:ring-offset-gray-900"
                  : "focus-visible:ring-blue-500 focus-visible:ring-offset-white"
              } ${
                disabled
                  ? darkMode
                    ? "cursor-not-allowed border-gray-800 text-gray-600"
                    : "cursor-not-allowed border-gray-200 text-gray-400"
                  : "cursor-pointer"
              } ${
                isActive
                  ? darkMode
                    ? "border-blue-500/70 bg-blue-500 text-white shadow"
                    : "border-blue-200 bg-blue-500/10 text-blue-600 shadow"
                  : darkMode
                  ? "border-transparent text-gray-300 hover:border-gray-700 hover:bg-gray-800/60"
                  : "border-transparent text-gray-600 hover:border-gray-200 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

FeedTabs.propTypes = {
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      disabled: PropTypes.bool,
    })
  ).isRequired,
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func,
  darkMode: PropTypes.bool,
  className: PropTypes.string,
};

export default FeedTabs;


