import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ThemeProvider } from "../../src/contexts/ThemeContext";
import { AuthProvider } from "../../src/contexts/AuthContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { AccessibilityProvider } from "../../src/components/common/AccessibilityProvider";
import "../../src/styles/accessibility.css";
import AppRoutes from "../../src/Routes";

export { Page };

function Page({ url, postId }) {
  return (
    <HelmetProvider context={{}}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AccessibilityProvider>
              <StaticRouter location={url}>
                <AppRoutes />
              </StaticRouter>
            </AccessibilityProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export { onBeforeRender };
export { render };

async function onBeforeRender(pageContext) {
  const { routeParams, urlOriginal } = pageContext;
  const { postId } = routeParams;

  return {
    pageContext: {
      url: urlOriginal,
      postId,
    },
  };
}

async function render(pageContext) {
  const { url, postId } = pageContext;

  const page = <Page url={url} postId={postId} />;
  const pageHtml = renderToString(page);

  // Extract helmet data
  const helmet = HelmetProvider.canUseDOM
    ? null
    : HelmetProvider._context?.helmet;

  const documentHtml = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        ${helmet?.title?.toString() || "<title>Video Game Otaku</title>"}
        ${helmet?.meta?.toString() || ""}
        ${helmet?.link?.toString() || ""}
        ${helmet?.script?.toString() || ""}
      </head>
      <body>
        <div id="root">${pageHtml}</div>
        <script type="module" src="/src/main.jsx"></script>
      </body>
    </html>`;

  return {
    documentHtml,
    pageContext: {},
  };
}
