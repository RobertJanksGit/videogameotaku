import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import Layout from "./components/layout/Layout";

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Layout>
          <div className="w-full space-y-8">
            <section className="w-full">
              <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
                Latest Gaming News
              </h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div className="p-6 rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
                  <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                    Welcome to VideoGame Otaku!
                  </h3>
                  <p className="text-gray-600 dark:text-gray-300">
                    Your source for the latest gaming news, reviews, and
                    community discussions.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </Layout>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
