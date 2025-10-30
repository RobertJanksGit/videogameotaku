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
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { initializeApp } from "firebase/app";

export { Page };

function Page({ url, postId, post }) {
  return (
    <HelmetProvider context={{}}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AccessibilityProvider>
              <StaticRouter location={url}>
                <AppRoutes initialPost={post} />
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

  // Initialize Firebase for server-side rendering
  const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  let post = null;
  try {
    const postDoc = await getDoc(doc(db, "posts", postId));
    if (postDoc.exists()) {
      post = { id: postDoc.id, ...postDoc.data() };
    }
  } catch (error) {
    console.error("Error fetching post server-side:", error);
  }

  return {
    pageContext: {
      url: urlOriginal,
      postId,
      post,
    },
  };
}

async function render(pageContext) {
  const { url, postId, post } = pageContext;

  const page = <Page url={url} postId={postId} post={post} />;
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
