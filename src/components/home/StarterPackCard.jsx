import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  DEFAULT_STARTER_PACK_STATE,
  dismissStarterPack,
  loadStarterPackState,
  shouldShowStarterPack,
} from "../../utils/starterPackStorage";

const tasksConfig = [
  {
    key: "hasPostedFirst",
    label: "Post your first gaming news find",
    getCompleted: (state) => Boolean(state.hasPostedFirst),
  },
  {
    key: "hasCommented",
    label: "Leave a comment on a post",
    getCompleted: (state) => Boolean(state.hasCommented),
  },
  {
    key: "upvoteCount",
    label: "Upvote 3 posts you like",
    getCompleted: (state) => Number(state.upvoteCount || 0) >= 3,
  },
];

const progressByCompleted = [0, 33, 66, 100];

const StarterPackCard = ({ userId, className = "" }) => {
  const [starterPackState, setStarterPackState] = useState(() =>
    loadStarterPackState(userId)
  );

  useEffect(() => {
    if (!userId) {
      setStarterPackState({ ...DEFAULT_STARTER_PACK_STATE });
      return undefined;
    }

    setStarterPackState(loadStarterPackState(userId));

    if (typeof window === "undefined") {
      return undefined;
    }

    const handleStateChange = (event) => {
      const { detail } = event || {};
      if (detail?.userId !== userId) return;
      if (detail?.state) {
        setStarterPackState(detail.state);
      }
    };

    window.addEventListener("starterpack:update", handleStateChange);
    return () => {
      window.removeEventListener("starterpack:update", handleStateChange);
    };
  }, [userId]);

  const tasks = useMemo(() => {
    return tasksConfig.map((task) => ({
      ...task,
      completed: task.getCompleted(starterPackState),
    }));
  }, [starterPackState]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const progressPercent = progressByCompleted[completedCount] ?? 0;

  const showCard = shouldShowStarterPack(userId, starterPackState);

  const handleDismiss = () => {
    if (!userId) return;
    const nextState = dismissStarterPack(userId);
    if (nextState) {
      setStarterPackState(nextState);
    } else {
      setStarterPackState((prev) => ({
        ...(prev || DEFAULT_STARTER_PACK_STATE),
        dismissed: true,
      }));
    }
  };

  if (!userId || !showCard) {
    return null;
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/80 p-6 text-slate-100 shadow-lg backdrop-blur-sm ${className}`}
      role="region"
      aria-label="Starter Pack Checklist"
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/80 text-slate-400 transition hover:bg-slate-700 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"
        aria-label="Dismiss starter pack"
      >
        ×
      </button>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">
            Welcome to Video Game Otaku 👾
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Knock out these quick actions to get the full community experience.
          </p>
        </div>

        <div className="space-y-3">
          {tasks.map((task) => (
            <label
              key={task.key}
              className={`flex items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-sm transition ${
                task.completed
                  ? "border-green-500/40 bg-green-900/20 text-green-200"
                  : "hover:border-slate-600 hover:bg-slate-900/80"
              }`}
            >
              <input
                type="checkbox"
                checked={task.completed}
                readOnly
                className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-400/70"
                aria-checked={task.completed}
              />
              <span className="leading-snug">{task.label}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>Starter Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

StarterPackCard.propTypes = {
  userId: PropTypes.string,
  className: PropTypes.string,
};

export default StarterPackCard;


