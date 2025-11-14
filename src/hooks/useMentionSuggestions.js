import { useEffect, useMemo, useState } from "react";
import {
  collection,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
} from "firebase/firestore";
import { db } from "../config/firebase";

const handlesCollection = collection(db, "user_handles");

const normalizeTerm = (term = "") => term.trim().toLowerCase();

export default function useMentionSuggestions(term, maxResults = 5) {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const normalizedTerm = useMemo(() => normalizeTerm(term), [term]);

  useEffect(() => {
    if (!normalizedTerm) {
      setSuggestions([]);
      setIsLoading(false);
      return undefined;
    }

    let isCancelled = false;
    const fetchSuggestions = async () => {
      setIsLoading(true);
      try {
        const q = query(
          handlesCollection,
          orderBy("handleLower"),
          startAt(normalizedTerm),
          endAt(`${normalizedTerm}\uf8ff`),
          limit(maxResults)
        );
        const snapshot = await getDocs(q);
        if (isCancelled) {
          return;
        }
        const results = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          return {
            id: docSnap.id,
            handle: data.handle || docSnap.id,
            handleLower: data.handleLower || docSnap.id,
            displayName: data.displayName || data.handle || docSnap.id,
            avatarUrl: data.avatarUrl || "",
            userId: data.userId || "",
          };
        });
        setSuggestions(results);
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to fetch mention suggestions", error);
          setSuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchSuggestions();

    return () => {
      isCancelled = true;
    };
  }, [normalizedTerm, maxResults]);

  return {
    suggestions,
    isLoading,
    term: normalizedTerm,
  };
}
