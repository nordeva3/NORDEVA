import { createFileRoute } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — NORDEVA" },
      {
        name: "description",
        content:
          "How NORDEVA handles buyer and seller data, and why we never inspect your source code.",
      },
      { property: "og:title", content: "Privacy Policy — NORDEVA" },
      { property: "og:description", content: "How NORDEVA handles buyer and seller data." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold">Privacy Policy</h1>
        <p className="text-xs text-muted-foreground">
          Last updated: {new Date().toLocaleDateString()}
        </p>

        <h2 className="mt-8 text-lg font-medium">What we collect</h2>
        <ul className="text-sm text-muted-foreground mt-2 list-disc pl-5 space-y-1">
          <li>Your email address (for sign-in and receipts).</li>
          <li>Listings you create and orders you place.</li>
          <li>Payout details you enter (UPI ID or bank account), stored to send you money.</li>
        </ul>

        <h2 className="mt-6 text-lg font-medium">Your source code is yours</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Files uploaded by sellers live in a private storage bucket that requires a signed,
          time-limited URL to access. NORDEVA staff do not open, read, decompile, or execute your
          JavaScript, source files, or any product archive. Files are delivered directly to a
          verified buyer after payment — nobody else.
        </p>

        <h2 className="mt-6 text-lg font-medium">Who sees what</h2>
        <ul className="text-sm text-muted-foreground mt-2 list-disc pl-5 space-y-1">
          <li>
            Public listing pages show only the title, description, cover image and price you chose.
          </li>
          <li>
            Your email is visible only to you and, for a completed sale, on the receipt shown to the
            counterparty.
          </li>
          <li>Payout details are visible only to you.</li>
        </ul>

        <h2 className="mt-6 text-lg font-medium">Retention</h2>
        <p className="text-sm text-muted-foreground mt-2">
          You can request deletion of your account and associated data at any time by contacting
          support. Order records may be retained for tax and dispute reasons.
        </p>

        <h2 className="mt-6 text-lg font-medium">Cookies</h2>
        <p className="text-sm text-muted-foreground mt-2">
          We use a single session cookie / local storage entry to keep you signed in. No third-party
          ad tracking.
        </p>
      </article>
    </div>
  );
}
