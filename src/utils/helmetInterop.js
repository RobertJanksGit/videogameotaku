export function resolveHelmetModule(module) {
  if (module && typeof module === "object") {
    if ("HelmetProvider" in module || "Helmet" in module) {
      return module;
    }

    if ("default" in module) {
      const candidate = module.default;
      if (candidate && typeof candidate === "object") {
        return candidate;
      }
    }
  }

  return module;
}

