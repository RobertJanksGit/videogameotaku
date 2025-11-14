import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import normalizeProfilePhoto from "../utils/normalizeProfilePhoto";

const authorCache = new Map();

const fetchAuthorMeta = async (authorId) => {
  try {
    const [profileSnap, userSnap, statsSnap] = await Promise.all([
      getDoc(doc(db, "profiles", authorId)),
      getDoc(doc(db, "users", authorId)),
      getDoc(doc(db, "user_stats", authorId)),
    ]);

    const profileData = profileSnap.exists() ? profileSnap.data() || {} : {};
    const userData = userSnap.exists() ? userSnap.data() || {} : {};
    const statsData = statsSnap.exists() ? statsSnap.data() || {} : {};

    const karma = Number.isFinite(profileData.karma)
      ? profileData.karma
      : Number.isFinite(userData.karma)
      ? userData.karma
      : 0;

    const avatarUrl = normalizeProfilePhoto(
      profileData.avatarUrl || profileData.photoURL || userData.photoURL || ""
    );

    const badges = Array.isArray(statsData.badges)
      ? statsData.badges
      : Array.isArray(profileData.badges)
      ? profileData.badges
      : [];

    const dailyStreak = Number.isFinite(statsData.dailyStreak)
      ? statsData.dailyStreak
      : 0;

    const lastBadge =
      badges.length > 0 ? badges[badges.length - 1] : statsData.lastBadge || "";

    return {
      karma,
      avatarUrl,
      badges,
      dailyStreak,
      lastBadge,
      commentCount: Number.isFinite(statsData.commentCount)
        ? statsData.commentCount
        : 0,
    };
  } catch (error) {
    console.error("Failed to fetch author profile for", authorId, error);
  }

  return { karma: 0, avatarUrl: "", badges: [], dailyStreak: 0, lastBadge: "" };
};

export const useAuthorRanks = (ids) => {
  const authorIds = useMemo(() => {
    if (!Array.isArray(ids)) return [];
    return Array.from(new Set(ids.filter(Boolean)));
  }, [ids]);

  const [ranks, setRanks] = useState({});

  useEffect(() => {
    if (authorIds.length === 0) {
      setRanks({});
      return;
    }

    let isMounted = true;
    const missing = authorIds.filter((id) => !authorCache.has(id));

    const updateStateFromCache = () => {
      if (!isMounted) return;
      const map = {};
      authorIds.forEach((id) => {
        if (authorCache.has(id)) {
          map[id] = authorCache.get(id);
        }
      });
      setRanks(map);
    };

    if (missing.length === 0) {
      updateStateFromCache();
      return () => {
        isMounted = false;
      };
    }

    const fetchMissingAuthors = async () => {
      const results = await Promise.all(
        missing.map(async (authorId) => {
          const meta = await fetchAuthorMeta(authorId);
          return { id: authorId, meta };
        })
      );

      results.forEach(({ id, meta }) => {
        authorCache.set(id, meta);
      });

      updateStateFromCache();
    };

    fetchMissingAuthors();

    return () => {
      isMounted = false;
    };
  }, [authorIds]);

  return ranks;
};

export default useAuthorRanks;

