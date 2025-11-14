import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";

const auth = getAuth();

export const useAuthUser = () => {
  const [user, setUser] = useState(() => auth.currentUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return unsubscribe;
  }, []);

  return user;
};

export default useAuthUser;
