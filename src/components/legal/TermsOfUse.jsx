import { useTheme } from "../../contexts/ThemeContext";

const TermsOfUse = () => {
  const { darkMode } = useTheme();

  return (
    <div className="w-full">
      <div
        className={`w-full p-4 rounded-lg ${
          darkMode
            ? "bg-gray-800 text-gray-200 border-gray-700"
            : "bg-white text-gray-900 border-gray-200"
        } border`}
      >
        <h1
          className={`text-2xl font-bold mb-6 ${
            darkMode ? "text-white" : "text-gray-900"
          }`}
        >
          Terms of Use
        </h1>
        <div className="space-y-6">
          <p
            className={`text-sm ${
              darkMode ? "text-gray-300" : "text-gray-600"
            }`}
          >
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              1. Agreement to Terms
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              By accessing and using Videogame Otaku (&quot;we,&quot;
              &quot;our,&quot; or &quot;us&quot;), you agree to be bound by
              these Terms of Use. If you do not agree to these terms, please do
              not use our service.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              2. User Eligibility
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              You must be at least 13 years old to use this service. If you are
              under 18, you must have parental consent to use the service.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              3. Account Registration
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              When creating an account, you must provide accurate and complete
              information. You are responsible for maintaining the security of
              your account and password. You agree to notify us immediately of
              any unauthorized access or use of your account.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              4. User Content
            </h2>
            <div
              className={`space-y-2 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <p>
                By posting content on Videogame Otaku, you grant us a
                non-exclusive, worldwide, royalty-free license to use, copy,
                modify, and display that content. You are solely responsible for
                your content and must comply with our Content Guidelines.
              </p>
              <p>
                You retain all ownership rights to your content, but you grant
                us permission to use it for the purpose of operating and
                improving our service.
              </p>
            </div>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              5. Prohibited Activities
            </h2>
            <div className={darkMode ? "text-gray-300" : "text-gray-600"}>
              <p className="mb-2">You agree not to:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>Use the service for any illegal purpose</li>
                <li>Post unauthorized commercial communications</li>
                <li>Harass, bully, or intimidate other users</li>
                <li>Post false or misleading information</li>
                <li>
                  Attempt to access accounts or data that don&apos;t belong to
                  you
                </li>
                <li>Interfere with or disrupt our service</li>
              </ul>
            </div>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              6. Intellectual Property
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              The service and its original content (excluding user-submitted
              content) are protected by copyright, trademark, and other laws.
              Our trademarks and trade dress may not be used without our prior
              written permission.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              7. Privacy
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              Your use of Videogame Otaku is also governed by our Privacy
              Policy. By using our service, you consent to our collection and
              use of data as outlined in the Privacy Policy.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              8. Termination
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              We reserve the right to suspend or terminate your account and
              access to our service at our sole discretion, without notice, for
              conduct that we believe violates these Terms of Use or is harmful
              to other users, us, or third parties, or for any other reason.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              9. Disclaimer of Warranties
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              The service is provided &quot;as is&quot; and &quot;as
              available&quot; without any warranties of any kind, either express
              or implied. We do not guarantee that the service will be
              uninterrupted, secure, or error-free.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              10. Limitation of Liability
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              To the maximum extent permitted by law, we shall not be liable for
              any indirect, incidental, special, consequential, or punitive
              damages resulting from your use or inability to use the service.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              11. Changes to Terms
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              We reserve the right to modify these terms at any time. We will
              notify users of any material changes via email or through the
              service. Your continued use of the service after such
              modifications constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2
              className={`text-xl font-semibold mb-3 ${
                darkMode ? "text-gray-200" : "text-gray-800"
              }`}
            >
              12. Governing Law
            </h2>
            <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
              These terms shall be governed by and construed in accordance with
              the laws of the jurisdiction in which we operate, without regard
              to its conflict of law provisions.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TermsOfUse;
