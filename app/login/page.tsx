import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign In — AVP Life Story Interview",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-stone-50">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-stone-200 mb-5">
            <svg
              className="w-5 h-5 text-stone-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            AVP Life Story Interview
          </h1>
          <p className="mt-2 text-sm text-stone-500 leading-relaxed">
            Enter your participant ID to begin your interview session.
          </p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-8">
          <LoginForm />
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-stone-400 leading-relaxed">
          This is a research interview. Your responses will be recorded and
          used for research purposes only. Please do not share personally
          identifying information unless prompted.
        </p>
      </div>
    </div>
  );
}
