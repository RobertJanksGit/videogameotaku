import { useEffect, useState } from "react";

const scriptStatuses = {};

const useExternalScript = (src) => {
  const [status, setStatus] = useState(() => scriptStatuses[src] || "loading");

  useEffect(() => {
    if (!src || typeof document === "undefined") {
      setStatus("idle");
      return;
    }

    const existingScript = document.querySelector(`script[src="${src}"]`);

    if (existingScript) {
      const existingStatus = scriptStatuses[src];
      if (existingStatus === "loaded" || existingStatus === "error") {
        setStatus(existingStatus);
        return;
      }
    }

    let script = existingScript;
    let isNewScript = false;

    if (!script) {
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      isNewScript = true;
    }

    const handleLoad = () => {
      scriptStatuses[src] = "loaded";
      setStatus("loaded");
    };

    const handleError = () => {
      scriptStatuses[src] = "error";
      setStatus("error");
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    if (isNewScript) {
      scriptStatuses[src] = "loading";
      document.body.appendChild(script);
    }

    return () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
  }, [src]);

  return status;
};

export default useExternalScript;
