import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../config/firebase";

const authorCache = new Map();

const fetchAuthorMeta = async (authorId) => {
  try {
    const profileSnap = await getDoc(doc(db, "profiles", authorId));
    if (profileSnap.exists()) {
      const data = profileSnap.data() || {};
      return {
        karma: Number.isFinite(data.karma) ? data.karma : 0,
      };
    }

    const userSnap = await getDoc(doc(db, "users", authorId));
    if (userSnap.exists()) {
      const data = userSnap.data() || {};
      return {
        karma: Number.isFinite(data.karma) ? data.karma : 0,
      };
    }
  } catch (error) {
    console.error("Failed to fetch author profile for", authorId, error);
  }

  return { karma: 0 };
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

