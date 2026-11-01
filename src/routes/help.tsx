import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Flag, LifeBuoy, Minus, Plus, ShieldAlert, Ticket } from "lucide-react";
import { TopNav } from "@/components/top-nav";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help Center — NORDEVA" },
      {
        name: "description",
        content:
          "Answers about buying, selling, custom website projects, payments and refunds on NORDEVA, plus how to report a problem or reach support.",
      },
    ],
  }),
  component: HelpPage,
});

type Faq = { q: string; a: string };

const FAQ_GROUPS: { title: string; faqs: Faq[] }[] = [
  {
    title: "Buying & downloads",
    faqs: [
      {
        q: "How do I buy a digital product?",
        a: "Find it in the Marketplace, then check out from the product page or your cart. Once your payment is confirmed, the order appears under Purchases in your account.",
      },
      {
        q: "How do I download what I bought?",
        a: "From your Purchases page. Files are delivered through signed, expiring download links, so the files themselves are never public. If a link has expired, open Purchases again to generate a fresh one — you can re-download products you own at any time.",
      },
      {
        q: "What if a product doesn't work as described?",
        a: "First, check the product's documentation and Q&A — many issues are answered there. If it's still not right, you can request a refund from the Refunds page for eligible issues. Keep screenshots or error messages handy; they help the review go faster.",
      },
    ],
  },
  {
    title: "Selling & payouts",
    faqs: [
      {
        q: "How much does NORDEVA take?",
        a: "A flat 15% of each sale — you keep 85%. There are no listing fees and no monthly fees. The same split applies to custom website projects: the developer receives 85% of the agreed amount.",
      },
      {
        q: "When does my product go live?",
        a: "Every listing is reviewed by a human admin before it goes live, and uploaded files pass through the Product Studio checks. You'll see the listing's status in your dashboard — it appears in the marketplace as soon as it's approved.",
      },
      {
        q: "How do I get paid?",
        a: "Add a payout method (UPI or bank transfer) on the Earnings page, then request a withdrawal. Payouts are released within 1–2 weeks of the request, and you can track every sale and payout from Earnings.",
      },
      {
        q: "Who owns the work I sell?",
        a: "You do. NORDEVA never reads, runs or resells your source code or files — the platform only delivers them to buyers who have paid for them.",
      },
    ],
  },
  {
    title: "Custom website projects",
    faqs: [
      {
        q: "How do custom website projects work?",
        a: "Post a request on the Custom Projects board describing the site you need. Developers send proposals with a price, timeline and message. You review them, select one developer, and a private project workspace opens with chat, milestones, preview submissions and final delivery.",
      },
      {
        q: "What do the packages cost?",
        a: "Simple Website projects start at $50–$100, Advanced at $100–$200, and Max Advanced at $200–$1,000. These are starting ranges, not fixed prices — the final price is agreed between you and the developer before work begins, and it's recorded in the workspace.",
      },
      {
        q: "Is my project payment held in escrow?",
        a: "No — NORDEVA does not hold project funds in escrow, and we won't pretend otherwise. Online payment for projects is arriving with the payments upgrade; until then, agree the scope and amount in the workspace first and keep all communication in the project chat, so there is always a record of what was agreed and delivered.",
      },
      {
        q: "What if something goes wrong mid-project?",
        a: "Ask for revisions inside the workspace — previews can be sent back with your notes. If you and the developer can't resolve it, raise a dispute from the project workspace. The full project history (messages, milestones, deliveries) is preserved for the support team to review.",
      },
      {
        q: "I'm a developer — how do I get hired?",
        a: "Complete your profile (headline, skills, portfolio), then browse open requests on the Custom Projects board and send proposals. Clients see your profile and past work with each proposal, so a complete profile genuinely helps.",
      },
    ],
  },
  {
    title: "Payments, refunds & your account",
    faqs: [
      {
        q: "How do payments work at checkout?",
        a: "Product checkout is handled by our payment providers (Stripe and Razorpay) — you'll see the methods available to you at checkout. NORDEVA never sees or stores your card number; payment is confirmed by the provider before anything is delivered.",
      },
      {
        q: "How do refunds work?",
        a: "Request a refund from the Refunds page within 7 days for eligible issues, and an admin reviews it. Approved refunds are returned through the original payment provider. Change of mind after a successful download is not normally refundable, and neither are limitations that were disclosed on the product page.",
      },
      {
        q: "I can't sign in. What should I do?",
        a: "Use the password reset option on the sign-in page first. If you're still stuck, sign in with any method that works and open a support ticket from your dashboard — the team can help you recover the account.",
      },
    ],
  },
];

function HelpPage() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-lume">
          <LifeBuoy className="size-4" /> Help Center
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">How can we help?</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Answers about buying, selling and hiring on NORDEVA — and the fastest ways to reach a
          human when something goes wrong.
        </p>

        {/* Report a problem */}
        <h2 className="mt-12 text-lg font-medium">Report a problem</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="surface flex flex-col p-5">
            <Flag className="size-5 text-lume" />
            <div className="mt-4 font-medium">Report a product</div>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
              On any product page, use the report option for stolen or pirated products, misleading
              descriptions, malware or content the seller doesn't own. Reports go straight to the
              admin team. To report a user or behaviour outside a product page, open a support
              ticket instead.
            </p>
            <Link
              to="/browse"
              search={{}}
              className="mt-4 inline-flex items-center gap-1 text-sm text-lume hover:opacity-80"
            >
              Go to the marketplace <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="surface flex flex-col p-5">
            <Ticket className="size-5 text-lume" />
            <div className="mt-4 font-medium">Open a support ticket</div>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
              Sign in, open your Dashboard, and use the Support tickets form in the Marketplace
              Suite section. Your ticket is saved with its full message history, and the support
              team replies in the same thread.
            </p>
            <Link
              to="/dashboard"
              className="mt-4 inline-flex items-center gap-1 text-sm text-lume hover:opacity-80"
            >
              Open your dashboard <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="surface flex flex-col p-5">
            <ShieldAlert className="size-5 text-lume" />
            <div className="mt-4 font-medium">Dispute a project</div>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
              For custom website projects, open the project workspace and choose "Raise a dispute".
              Messages, milestones and deliveries stay preserved, so support can see exactly what
              was agreed and what was delivered.
            </p>
            <Link
              to="/requests"
              className="mt-4 inline-flex items-center gap-1 text-sm text-lume hover:opacity-80"
            >
              Go to your projects <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        {/* FAQ */}
        {FAQ_GROUPS.map((group) => (
          <section key={group.title} className="mt-12">
            <h2 className="text-lg font-medium">{group.title}</h2>
            <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/50">
              {group.faqs.map((f) => (
                <FaqRow key={f.q} q={f.q} a={f.a} />
              ))}
            </div>
          </section>
        ))}

        {/* Policies */}
        <section className="mt-12 rounded-[1.5rem] border border-border/60 bg-card/50 p-6">
          <h2 className="font-medium">Policies & platform status</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The fine print lives here — and if the platform itself is having trouble, the status
            page says so.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { to: "/terms", label: "Terms of Service" },
              { to: "/privacy", label: "Privacy Policy" },
              { to: "/refunds", label: "Refunds" },
              { to: "/status", label: "Platform status" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded-full border border-border/70 px-4 py-2 text-sm transition-colors hover:border-lume/50 hover:text-lume"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-muted/30 sm:px-7"
      >
        <span className="flex-1 text-sm font-medium">{q}</span>
        {open ? (
          <Minus className="size-4 shrink-0 text-lume" />
        ) : (
          <Plus className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <p className="animate-fade px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-7">
          {a}
        </p>
      )}
    </div>
  );
}
