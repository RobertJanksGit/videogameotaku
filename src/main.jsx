import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import { AccessibilityProvider } from "./components/common/AccessibilityProvider";
import "./styles/accessibility.css";
import "./index.css";
import AppRoutes from "./Routes";

// This is the client-side entry point for Vike
export { render };

async function render(pageContext) {
  const { isHydration } = pageContext;
  const page = (
    <HelmetProvider>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AccessibilityProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </AccessibilityProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </HelmetProvider>
  );

  const container = document.getElementById("root");

  if (isHydration) {
    // Hydrate the page
    hydrateRoot(container, page);
  } else {
    // Render the page (for client-side navigation)
    const { createRoot } = await import("react-dom/client");
    createRoot(container).render(page);
  }
}
