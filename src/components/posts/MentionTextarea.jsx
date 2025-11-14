import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import useMentionSuggestions from "../../hooks/useMentionSuggestions";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";

const isValidHandleChar = (char) => /[A-Za-z0-9_-]/.test(char);

const findActiveMention = (value, caret) => {
  const text = value.slice(0, caret);
  const atIndex = text.lastIndexOf("@");
  if (atIndex === -1) return null;
  if (atIndex > 0) {
    const before = text[atIndex - 1];
    if (before && isValidHandleChar(before)) {
      return null;
    }
  }
  const query = text.slice(atIndex + 1);
  if (!/^[A-Za-z0-9_-]*$/.test(query)) {
    return null;
  }
  return {
    start: atIndex,
    query,
  };
};

const MentionTextarea = ({
  value,
  onChange,
  placeholder = "",
  darkMode = false,
  rows = 3,
  id,
  className = "",
  disabled = false,
  onKeyDown,
}) => {
  const textareaRef = useRef(null);
  const [activeMention, setActiveMention] = useState(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const handleInputChange = (event) => {
    onChange?.(event);
    const caret = event.target.selectionStart;
    const mention = findActiveMention(event.target.value, caret);
    setActiveMention(mention);
    if (!mention) {
      setHighlightIndex(0);
    }
  };

  const activeQuery = activeMention?.query || "";
  const { suggestions } = useMentionSuggestions(activeQuery);

  useEffect(() => {
    setHighlightIndex(0);
  }, [activeQuery]);

  const insertHandle = useCallback(
    (handle) => {
      if (!textareaRef.current || !activeMention) {
        return;
      }
      const caret = textareaRef.current.selectionStart;
      const before = value.slice(0, activeMention.start);
      const after = value.slice(caret);
      const insertion = `@${handle} `;
      const nextValue = `${before}${insertion}${after}`;
      const synthetic = {
        target: {
          value: nextValue,
        },
      };
      onChange?.(synthetic);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newCaret = before.length + insertion.length;
          textareaRef.current.selectionStart = newCaret;
          textareaRef.current.selectionEnd = newCaret;
          textareaRef.current.focus();
        }
      });
      setActiveMention(null);
    },
    [activeMention, onChange, value]
  );

  const handleKeyDown = (event) => {
    if (suggestions.length > 0 && activeMention) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex((prev) =>
          prev - 1 < 0 ? suggestions.length - 1 : prev - 1
        );
        return;
      }
      if (event.key === "Enter") {
        const selected = suggestions[highlightIndex] || suggestions[0];
        if (selected) {
          event.preventDefault();
          insertHandle(selected.handle);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setActiveMention(null);
        return;
      }
    }
    onKeyDown?.(event);
  };

  const suggestionList = useMemo(() => {
    if (!activeMention || !activeQuery) {
      return [];
    }
    return suggestions;
  }, [activeMention, activeQuery, suggestions]);

  return (
    <div className="relative">
      <textarea
        id={id}
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-expanded={suggestionList.length > 0}
      />
      {suggestionList.length > 0 && (
        <div
          className={`absolute z-10 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border text-sm shadow-lg ${
            darkMode
              ? "border-gray-700 bg-gray-900 text-gray-100"
              : "border-gray-200 bg-white text-gray-900"
          }`}
          role="listbox"
        >
          {suggestionList.map((suggestion, index) => {
            const isActive = index === highlightIndex;
            const avatar = normalizeProfilePhoto(
              suggestion.avatarUrl || "",
              64
            );
            return (
              <button
                type="button"
                key={suggestion.id || suggestion.handle}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertHandle(suggestion.handle);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? darkMode
                      ? "bg-blue-900/40"
                      : "bg-blue-50"
                    : ""
                }`}
                role="option"
                aria-selected={isActive}
              >
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700 overflow-hidden">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={suggestion.displayName}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    suggestion.displayName.charAt(0).toUpperCase()
                  )}
                </span>
                <span className="flex flex-col text-xs">
                  <span className="font-semibold">
                    {suggestion.displayName}
                  </span>
                  <span className="text-gray-400">
                    @{suggestion.handle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

MentionTextarea.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  darkMode: PropTypes.bool,
  rows: PropTypes.number,
  id: PropTypes.string,
  className: PropTypes.string,
  disabled: PropTypes.bool,
  onKeyDown: PropTypes.func,
};

export default MentionTextarea;
