import { createFileRoute, Link } from "@tanstack/react-router";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — NORDEVA" },
      { name: "description", content: "Rules for buyers and sellers on the NORDEVA marketplace." },
      { property: "og:title", content: "Terms of Service — NORDEVA" },
      {
        property: "og:description",
        content: "Rules for buyers and sellers on the NORDEVA marketplace.",
      },
      { property: "og:type", content: "article" },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <article className="mx-auto max-w-3xl px-4 py-16 prose prose-invert prose-sm">
        <h1 className="text-3xl font-semibold">Terms of Service</h1>
        <p className="text-xs text-muted-foreground">
          Last updated: {new Date().toLocaleDateString()}
        </p>

        <h2 className="mt-8 text-lg font-medium">1. What NORDEVA is</h2>
        <p className="text-sm text-muted-foreground mt-2">
          NORDEVA is a marketplace that connects independent sellers of software and websites with
          buyers. NORDEVA is not the author of listed products and does not warrant them beyond the
          seller's own claims.
        </p>

        <h2 className="mt-6 text-lg font-medium">2. Seller rules — zero tolerance for scams</h2>
        <ul className="text-sm text-muted-foreground mt-2 list-disc pl-5 space-y-1">
          <li>You must own or have full rights to license the files you upload.</li>
          <li>No malware, spyware, cryptominers, backdoors, or credential stealers.</li>
          <li>No pirated, cracked, or copyrighted material you don't own.</li>
          <li>Listing description and demo must match what the buyer actually receives.</li>
          <li>
            Fraudulent, empty, or intentionally broken deliverables → permanent ban and full refunds
            charged back to your balance.
          </li>
        </ul>

        <h2 className="mt-6 text-lg font-medium">3. Buyer rules</h2>
        <ul className="text-sm text-muted-foreground mt-2 list-disc pl-5 space-y-1">
          <li>
            The download link is for your use only. Do not resell or redistribute a seller's files.
          </li>
          <li>Chargebacks used to obtain a product for free may result in account termination.</li>
        </ul>

        <h2 className="mt-6 text-lg font-medium">4. Fees & payouts</h2>
        <p className="text-sm text-muted-foreground mt-2">
          NORDEVA deducts a flat 15% platform fee from every completed sale. Payout requests are
          reviewed and settled to the seller's UPI or bank account within 1–2 weeks.
        </p>

        <h2 className="mt-6 text-lg font-medium">5. Seller intellectual property</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Files uploaded to NORDEVA are stored in a private, access-controlled bucket. NORDEVA staff
          do not read, audit, or execute your source code. Files are released only to verified
          buyers via signed download links after payment.
        </p>

        <h2 className="mt-6 text-lg font-medium">6. Termination</h2>
        <p className="text-sm text-muted-foreground mt-2">
          We may suspend accounts that violate these terms or applicable law. Balances tied to
          fraudulent activity may be withheld pending review.
        </p>

        <p className="mt-10 text-xs text-muted-foreground">
          Questions? Return to{" "}
          <Link to="/" className="text-lume underline">
            the homepage
          </Link>
          .
        </p>
      </article>
    </div>
  );
}
