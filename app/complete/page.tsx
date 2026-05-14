import { Suspense } from "react";
import { CompletionContent } from "./CompletionContent";

export const metadata = {
  title: "Interview Complete — SparkMeLive",
};

export default function CompletePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-stone-400 text-sm">Loading...</p>
        </div>
      }
    >
      <CompletionContent />
    </Suspense>
  );
}
