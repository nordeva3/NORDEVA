import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  CreditCard,
  Eye,
  FileText,
  Globe,
  ImagePlus,
  Loader2,
  MessageSquare,
  Pencil,
  Percent,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "@/components/tag-input";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/currencies";
import {
  PROJECT_PACKAGES,
  PROJECT_STATUSES,
  REQUEST_CATEGORIES,
  TECHNOLOGY_SUGGESTIONS,
  effectivePackage,
  effectiveStatus,
  packageBadgeLabel,
  packageMeta,
  type PackageType,
  type RequestLike,
} from "@/lib/project-requests";
import { fetchMyStanding } from "@/lib/account-standing";
import type { Database } from "@/integrations/supabase/types";

type PublicRow = Database["public"]["Views"]["website_requests_public"]["Row"];
type OwnRow = Database["public"]["Tables"]["website_requests"]["Row"];
type UpdateRow = Database["public"]["Tables"]["website_requests"]["Update"];

/**
 * The generated view type marks every column nullable; coalesce the core
 * fields once at load so the UI works with the structural RequestLike type.
 */
function normalizePublicRow(r: PublicRow): RequestLike {
  return {
    id: r.id ?? "",
    requester_id: r.requester_id ?? "",
    title: r.title ?? "",
    description: r.description ?? "",
    budget: r.budget ?? 0,
    currency: r.currency ?? "USD",
    status: r.status ?? "open",
    taken_by: r.taken_by ?? null,
    created_at: r.created_at ?? "",
    tier: r.tier,
    photos: r.photos,
    package_type: r.package_type,
    project_status: r.project_status,
    category: r.category,
    purpose: r.purpose,
    target_audience: r.target_audience,
    required_pages: r.required_pages,
    required_functionality: r.required_functionality,
    preferred_technologies: r.preferred_technologies,
    design_references: r.design_references,
    reference_urls: r.reference_urls,
    domain_needs: r.domain_needs,
    hosting_needs: r.hosting_needs,
    deadline: r.deadline,
    is_draft: r.is_draft,
    agreed_amount: r.agreed_amount,
    agreed_currency: r.agreed_currency,
    selected_proposal_id: r.selected_proposal_id,
  };
}
type ProposalRow = Database["public"]["Tables"]["project_proposals"]["Row"];
type ProfileRow = Database["public"]["Tables"]["public_profiles"]["Row"];
type ProfileLite = Pick<
  ProfileRow,
  "id" | "username" | "display_name" | "avatar_url" | "verified" | "headline"
>;

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Custom website projects — NORDEVA" },
      {
        name: "description",
        content:
          "Post a custom website project, receive proposals from NORDEVA developers, and pick the developer you want. Package prices are starting ranges — the final price is agreed before work begins.",
      },
      { property: "og:title", content: "Custom website projects — NORDEVA" },
      {
        property: "og:description",
        content: "Post a website project and review developer proposals on NORDEVA.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: RequestsPage,
});

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function profileName(p: ProfileLite | undefined, fallback = "NORDEVA member"): string {
  return p?.display_name || (p?.username ? `@${p.username}` : fallback);
}

function postedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function deadlineLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const meta = PROJECT_STATUSES[status] ?? {
    label: status.replace(/_/g, " "),
    classes: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

function Avatar({ profile, size = "size-6" }: { profile?: ProfileLite; size?: string }) {
  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        className={`${size} rounded-full object-cover border border-border/60`}
      />
    );
  }
  return (
    <span
      className={`${size} rounded-full bg-lume/20 text-lume grid place-items-center text-[10px] font-semibold`}
    >
      {(profileName(profile, "?")[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Simple add/remove list for URLs (reference sites, portfolio links). */
function UrlListInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    if (!raw.includes(".")) {
      setError("That doesn't look like a website address");
      return;
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (value.includes(url)) {
      setDraft("");
      return;
    }
    setError(null);
    onChange([...value, url]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? "https://example.com"}
          inputMode="url"
        />
        <Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()}>
          <Plus className="size-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((u) => (
            <li
              key={u}
              className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs"
            >
              <span className="truncate flex-1 text-muted-foreground">{u}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== u))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${u}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-package accents (design tokens only — presets recolour these,   */
/* so the landing cards, wizard options and request badges stay in     */
/* sync without hardcoded colours).                                    */
/* ------------------------------------------------------------------ */

const PACKAGE_ACCENTS: Record<
  PackageType,
  { price: string; check: string; chip: string; selected: string; bar: string }
> = {
  simple: {
    price: "text-foreground",
    check: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground",
    selected: "border-foreground/40 bg-muted/40",
    bar: "bg-border",
  },
  advanced: {
    price: "text-lume",
    check: "text-lume",
    chip: "bg-lume/15 text-lume",
    selected: "border-lume/60 bg-lume/5",
    bar: "bg-lume",
  },
  max_advanced: {
    price: "text-gold",
    check: "text-gold",
    chip: "bg-gold/15 text-gold",
    selected: "border-gold/60 bg-gold/5",
    bar: "bg-gold",
  },
};

const STARTING_RANGE_NOTE = "Starting range — the final price is agreed before work begins.";

/* ------------------------------------------------------------------ */
/* How it works strip                                                  */
/* ------------------------------------------------------------------ */

function HowItWorks() {
  const steps = [
    {
      title: "Post your project",
      text: "Describe the website you need, pick a package range and set your budget.",
    },
    {
      title: "Compare proposals",
      text: "Developers send a price, a timeline and their portfolio — you choose who to hire.",
    },
    {
      title: "Build together",
      text: "Chat, milestones, previews and revisions in a private workspace until final delivery.",
    },
  ];
  return (
    <section id="how-it-works" className="scroll-mt-24 mb-10" aria-label="How it works">
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-border/60 bg-card p-4 flex gap-3">
            <span className="size-7 shrink-0 rounded-full bg-lume/15 text-lume grid place-items-center font-display text-xs font-semibold">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{s.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Client / developer benefits band                                    */
/* ------------------------------------------------------------------ */

function BenefitsBand() {
  const columns = [
    {
      title: "For clients",
      items: [
        {
          icon: Eye,
          text: "Compare proposals side by side — price, timeline and portfolio — before you commit to anyone.",
        },
        {
          icon: MessageSquare,
          text: "One private workspace for chat, milestones, previews and revision requests.",
        },
        {
          icon: CreditCard,
          text: "The final price is agreed with your developer first; when online payment is enabled, you pay securely by card via Stripe.",
        },
      ],
    },
    {
      title: "For developers",
      items: [
        {
          icon: FileText,
          text: "Real briefs with budgets, requirements and deadlines — no guesswork about what the client wants.",
        },
        {
          icon: MessageSquare,
          text: "Talk directly with the client inside the project workspace, from proposal to delivery.",
        },
        {
          icon: Percent,
          text: "You receive 85% of the agreed project price — NORDEVA's commission is 15%.",
        },
      ],
    },
  ];
  return (
    <section className="mt-12 grid gap-3 md:grid-cols-2" aria-label="Benefits">
      {columns.map((col) => (
        <div key={col.title} className="rounded-2xl border border-border/60 bg-card p-5">
          <h3 className="font-display text-base font-semibold">{col.title}</h3>
          <ul className="mt-3 space-y-2.5">
            {col.items.map((item) => (
              <li key={item.text} className="flex gap-2.5 text-sm text-muted-foreground">
                <item.icon className="size-4 text-lume shrink-0 mt-0.5" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Packages strip (spec Part 4.1)                                      */
/* ------------------------------------------------------------------ */

function PackageCards({ onPick }: { onPick: (p: PackageType) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 mb-10">
      {PROJECT_PACKAGES.map((p) => {
        const accent = PACKAGE_ACCENTS[p.id];
        return (
          <div
            key={p.id}
            className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 pt-6 flex flex-col lift"
          >
            <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${accent.bar}`} />
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display font-semibold flex items-center gap-2">
                {p.label}
                {p.id === "max_advanced" && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-gold/15 text-gold">
                    <Sparkles className="size-3" /> Premium
                  </span>
                )}
              </h3>
              <span className={`text-sm font-semibold whitespace-nowrap ${accent.price}`}>
                ${p.min}–${p.max}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{p.blurb}</p>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground flex-1">
              {p.suitableFor.map((s) => (
                <li key={s} className="flex gap-1.5">
                  <Check className={`size-3.5 shrink-0 mt-px ${accent.check}`} />
                  <span>{s}</span>
                </li>
              ))}
              <li className="flex gap-1.5">
                <Check className={`size-3.5 shrink-0 mt-px ${accent.check}`} />
                <span>Includes up to 2 free revision rounds</span>
              </li>
            </ul>
            <p className="text-[11px] text-muted-foreground mt-4">{STARTING_RANGE_NOTE}</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => onPick(p.id)}>
              Start with this package
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Request card (browse + my requests)                                 */
/* ------------------------------------------------------------------ */

function RequestCard({
  r,
  mine,
  requesterProfile,
  assignedProfile,
  signedPhotos,
  proposalCount,
  showWorkspace,
  onOpen,
  onPublish,
  onCancel,
  onEdit,
  onDelete,
}: {
  r: RequestLike;
  mine: boolean;
  requesterProfile?: ProfileLite;
  assignedProfile?: ProfileLite;
  signedPhotos: Record<string, string>;
  proposalCount?: number;
  showWorkspace?: boolean;
  onOpen: () => void;
  onPublish?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const status = effectiveStatus(r);
  const badge = packageBadgeLabel(r);
  const pkgAccent = PACKAGE_ACCENTS[effectivePackage(r) ?? "advanced"];
  const techs = r.preferred_technologies ?? [];
  const photos = (r.photos ?? []).filter((p) => signedPhotos[p]);
  return (
    <li className="rounded-2xl border border-border/60 bg-card p-5 flex flex-col gap-3 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-lume/40 hover:shadow-[var(--shadow-lift)]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-base font-semibold leading-snug">{r.title}</h3>
            {badge && (
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${pkgAccent.chip}`}
              >
                {badge}
              </span>
            )}
            <StatusBadge status={status} />
            {typeof proposalCount === "number" && proposalCount > 0 && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400">
                {proposalCount} proposal{proposalCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">
            {r.description}
          </p>
          {techs.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {techs.slice(0, 5).map((t) => (
                <span
                  key={t}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {t}
                </span>
              ))}
              {techs.length > 5 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  +{techs.length - 5}
                </span>
              )}
            </div>
          )}
          {photos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
              {photos.slice(0, 6).map((p) => (
                <a
                  key={p}
                  href={signedPhotos[p]}
                  target="_blank"
                  rel="noreferrer"
                  className="aspect-square rounded-lg overflow-hidden bg-muted border border-border/60 block"
                >
                  <img
                    src={signedPhotos[p]}
                    alt="Reference"
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          )}
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Avatar profile={requesterProfile} size="size-5" />
              {mine ? "Posted by you" : `Posted by ${profileName(requesterProfile)}`}
            </span>
            <span>Posted {postedDate(r.created_at)}</span>
            {r.deadline && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" /> Deadline {deadlineLabel(r.deadline)}
              </span>
            )}
            {r.category && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{r.category}</span>
            )}
          </div>
          {r.taken_by && (
            <div className="flex items-center gap-2 mt-2 text-xs">
              <Avatar profile={assignedProfile} size="size-5" />
              <span className="text-muted-foreground">
                Developer assigned:{" "}
                <span className="text-foreground font-medium">{profileName(assignedProfile)}</span>
              </span>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-display text-xl font-semibold">
            {formatMoney(Number(r.budget), r.currency)}
          </div>
          <div className="text-xs text-muted-foreground">client budget</div>
          {r.agreed_amount != null && (
            <div className="text-xs text-lume mt-1">
              Agreed: {formatMoney(Number(r.agreed_amount), r.agreed_currency ?? r.currency)}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={onOpen}>
          View details & proposals
        </Button>
        {showWorkspace && (
          <Button size="sm" variant="secondary" asChild>
            <Link to="/projects/$id" params={{ id: r.id }}>
              Open workspace
            </Link>
          </Button>
        )}
        {mine && status === "draft" && onPublish && (
          <Button size="sm" variant="secondary" onClick={onPublish}>
            <Send className="size-3.5 mr-1" /> Publish
          </Button>
        )}
        {mine && status === "draft" && onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1" /> Edit draft
          </Button>
        )}
        {mine && onCancel && !["completed", "cancelled", "refunded"].includes(status) && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <Ban className="size-3.5 mr-1" /> Cancel request
          </Button>
        )}
        {mine && onDelete && ["draft", "cancelled"].includes(status) && (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="size-3.5 mr-1" /> Delete
          </Button>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Request detail + proposals (spec Part 4.4)                          */
/*                                                                     */
/* Proposal notifications are created by database triggers             */
/* (notify_requester_new_proposal / notify_developer_proposal_         */
/* decision in the Wave C migration) — the notifications table has no  */
/* client INSERT policy, so nothing is inserted from here.             */
/* ------------------------------------------------------------------ */

function isMissingFeatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /project_proposals|select_project_proposal|transition_project_status/.test(error.message ?? "")
  );
}

function DetailBody({
  request,
  userId,
  profiles,
  signedPhotos,
  onChanged,
  onCancelRequest,
}: {
  request: RequestLike;
  userId: string | null;
  profiles: Record<string, ProfileLite>;
  signedPhotos: Record<string, string>;
  onChanged: () => void;
  onCancelRequest: () => void;
}) {
  const mine = request.requester_id === userId;
  const status = effectiveStatus(request);
  const pkg =
    packageMeta(request.package_type) ??
    (request.tier ? packageMeta(effectivePackage(request) ?? "") : null);
  const [proposals, setProposals] = useState<ProposalRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [devProfiles, setDevProfiles] = useState<Record<string, ProfileLite>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Proposal form state
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [portfolioUrls, setPortfolioUrls] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const loadProposals = async () => {
    const { data, error } = await supabase
      .from("project_proposals")
      .select("*")
      .eq("request_id", request.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingFeatureError(error)) setUnavailable(true);
      else toast.error(error.message);
      setProposals([]);
      return;
    }
    const rows = (data ?? []) as ProposalRow[];
    setProposals(rows);
    const missing = Array.from(new Set(rows.map((p) => p.developer_id))).filter(
      (id) => !profiles[id] && !devProfiles[id],
    );
    if (missing.length > 0) {
      const { data: profs } = await supabase
        .from("public_profiles")
        .select("id, username, display_name, avatar_url, verified, headline")
        .in("id", missing);
      if (profs) {
        setDevProfiles((prev) => ({
          ...prev,
          ...Object.fromEntries((profs as ProfileLite[]).map((p) => [p.id, p])),
        }));
      }
    }
  };

  useEffect(() => {
    loadProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const profileOf = (id: string): ProfileLite | undefined => devProfiles[id] ?? profiles[id];
  const myActive = (proposals ?? []).find(
    (p) => p.developer_id === userId && p.status !== "withdrawn",
  );
  const accepting =
    ["open", "proposals_received"].includes(status) && !request.taken_by && !request.is_draft;

  const submitProposal = async () => {
    if (!userId) return;
    // Suspension guard (M5): suspended accounts cannot submit proposals.
    if ((await fetchMyStanding()).suspended)
      return setFormError("Account suspended — proposals are paused on your account");
    if (!message.trim()) return setFormError("Write a short message to the client");
    const amountNum = amount.trim() === "" ? null : Number(amount);
    if (amountNum !== null && !(amountNum > 0))
      return setFormError("Proposed amount must be more than 0");
    const daysNum = days.trim() === "" ? null : Number(days);
    if (daysNum !== null && (!Number.isInteger(daysNum) || daysNum < 1))
      return setFormError("Estimated days must be a whole number of 1 or more");
    setFormError(null);
    setBusy("submit");
    const { error } = await supabase.from("project_proposals").insert({
      request_id: request.id,
      developer_id: userId,
      message: message.trim(),
      proposed_amount: amountNum,
      currency: request.currency,
      estimated_days: daysNum,
      portfolio_urls: portfolioUrls,
    });
    setBusy(null);
    if (error) {
      if (error.code === "23505") {
        toast.error("You already have a pending proposal for this request");
      } else if (isMissingFeatureError(error)) {
        setUnavailable(true);
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success("Proposal sent — the client has been notified");
    setMessage("");
    setAmount("");
    setDays("");
    setPortfolioUrls([]);
    await loadProposals();
    onChanged();
  };

  const withdraw = async (p: ProposalRow) => {
    setBusy(p.id);
    const { error } = await supabase
      .from("project_proposals")
      .update({ status: "withdrawn" })
      .eq("id", p.id)
      .eq("developer_id", userId ?? "");
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Proposal withdrawn");
    await loadProposals();
    onChanged();
  };

  const select = async (p: ProposalRow) => {
    setBusy(p.id);
    const { data, error } = await supabase.rpc("select_project_proposal", {
      p_request_id: request.id,
      p_proposal_id: p.id,
    });
    setBusy(null);
    if (error) {
      if (isMissingFeatureError(error)) {
        return toast.error(
          "Developer selection activates once the database upgrade is applied to the live project",
        );
      }
      return toast.error(error.message);
    }
    if (data === false) return toast.error("That proposal could not be selected");
    toast.success("Developer selected — the project is now assigned");
    await loadProposals();
    onChanged();
  };

  const markProposalsReceived = async () => {
    setBusy("status");
    const { error } = await supabase.rpc("transition_project_status", {
      p_request_id: request.id,
      p_status: "proposals_received",
    });
    setBusy(null);
    if (error) {
      if (isMissingFeatureError(error)) {
        return toast.error(
          "Status updates activate once the database upgrade is applied to the live project",
        );
      }
      return toast.error(error.message);
    }
    onChanged();
  };

  const photos = (request.photos ?? []).filter((p) => signedPhotos[p]);
  const facts: { label: string; value: string }[] = [];
  if (pkg)
    facts.push({
      label: "Package",
      value: `${pkg.label} (starting range $${pkg.min}–$${pkg.max})`,
    });
  if (request.category) facts.push({ label: "Category", value: request.category });
  if (request.purpose) facts.push({ label: "Website purpose", value: request.purpose });
  if (request.target_audience)
    facts.push({ label: "Target audience", value: request.target_audience });
  if (request.required_pages)
    facts.push({ label: "Required pages", value: request.required_pages });
  if (request.required_functionality)
    facts.push({ label: "Required functionality", value: request.required_functionality });
  if (request.design_references)
    facts.push({ label: "Design references", value: request.design_references });
  if (request.domain_needs) facts.push({ label: "Domain", value: request.domain_needs });
  if (request.hosting_needs) facts.push({ label: "Hosting", value: request.hosting_needs });
  if (request.deadline)
    facts.push({ label: "Desired deadline", value: deadlineLabel(request.deadline) });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap pr-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold">{request.title}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Posted by {profileName(profiles[request.requester_id])} ·{" "}
            {postedDate(request.created_at)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">
            {formatMoney(Number(request.budget), request.currency)}
          </div>
          <div className="text-xs text-muted-foreground">client budget</div>
        </div>
      </div>

      {request.taken_by && (
        <div className="flex items-center gap-2 rounded-xl border border-lume/40 bg-lume/5 px-3 py-2 text-sm">
          <Avatar profile={profileOf(request.taken_by)} />
          <span>
            Developer assigned:{" "}
            <span className="font-medium">{profileName(profileOf(request.taken_by))}</span>
            {profileOf(request.taken_by)?.headline
              ? ` — ${profileOf(request.taken_by)?.headline}`
              : ""}
          </span>
          {(mine || request.taken_by === userId) && (
            <Button size="sm" variant="secondary" asChild className="ml-auto shrink-0">
              <Link to="/projects/$id" params={{ id: request.id }}>
                Open workspace
              </Link>
            </Button>
          )}
        </div>
      )}

      <div>
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Description</h4>
        <p className="text-sm whitespace-pre-wrap">{request.description}</p>
      </div>

      {(request.preferred_technologies ?? []).length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Preferred technologies
          </h4>
          <div className="flex gap-1.5 flex-wrap">
            {(request.preferred_technologies ?? []).map((t) => (
              <span
                key={t}
                className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {facts.length > 0 && (
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">{f.label}</dt>
              <dd className="text-sm mt-0.5 whitespace-pre-wrap">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(request.reference_urls ?? []).length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            Reference websites
          </h4>
          <ul className="space-y-1 text-sm">
            {(request.reference_urls ?? []).map((u) => (
              <li key={u}>
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="text-lume underline break-all"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {photos.map((p) => (
            <a
              key={p}
              href={signedPhotos[p]}
              target="_blank"
              rel="noreferrer"
              className="aspect-square rounded-lg overflow-hidden bg-muted border border-border/60 block"
            >
              <img src={signedPhotos[p]} alt="Reference" className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}

      <div className="border-t border-border/60 pt-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="font-medium">Proposals</h4>
          {mine && status === "open" && (proposals ?? []).some((p) => p.status === "pending") && (
            <Button
              size="sm"
              variant="secondary"
              onClick={markProposalsReceived}
              disabled={busy !== null}
            >
              {busy === "status" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Mark as proposals received"
              )}
            </Button>
          )}
        </div>

        {unavailable ? (
          <div className="rounded-xl border border-dashed border-border/60 p-4 mt-3 text-sm text-muted-foreground">
            Proposals are not available yet — they activate once the project database upgrade is
            applied to the live project.
          </div>
        ) : proposals === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {mine && proposals.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                No proposals yet. Developers will see your request on the public board.
              </p>
            )}
            {!mine && !userId && (
              <p className="text-sm text-muted-foreground mt-2">
                <Link to="/auth" className="text-lume underline">
                  Sign in
                </Link>{" "}
                to send a proposal for this project.
              </p>
            )}

            <ul className="space-y-3 mt-3">
              {(mine ? proposals : proposals.filter((p) => p.developer_id === userId)).map((p) => {
                const dev = profileOf(p.developer_id);
                return (
                  <li key={p.id} className="rounded-xl border border-border/60 p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar profile={dev} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-1.5">
                            {profileName(dev)}
                            {dev?.verified && <Check className="size-3.5 text-lume" />}
                          </div>
                          {dev?.headline && (
                            <div className="text-xs text-muted-foreground truncate">
                              {dev.headline}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {p.proposed_amount != null && (
                          <div className="text-sm font-semibold">
                            {formatMoney(Number(p.proposed_amount), p.currency)}
                          </div>
                        )}
                        {p.estimated_days != null && (
                          <div className="text-xs text-muted-foreground">
                            ~{p.estimated_days} day{p.estimated_days === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{p.message}</p>
                    {(p.portfolio_urls ?? []).length > 0 && (
                      <div className="flex gap-x-3 gap-y-1 flex-wrap text-xs">
                        {(p.portfolio_urls ?? []).map((u) => (
                          <a
                            key={u}
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                            className="text-lume underline break-all"
                          >
                            {u}
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={p.status} />
                      <span className="text-[11px] text-muted-foreground">
                        {postedDate(p.created_at)}
                      </span>
                      {mine && p.status === "pending" && accepting && (
                        <Button
                          size="sm"
                          className="ml-auto"
                          onClick={() => select(p)}
                          disabled={busy !== null}
                        >
                          {busy === p.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            "Select this developer"
                          )}
                        </Button>
                      )}
                      {!mine && p.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          onClick={() => withdraw(p)}
                          disabled={busy !== null}
                        >
                          {busy === p.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            "Withdraw proposal"
                          )}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {!mine && userId && accepting && !myActive && (
              <div className="rounded-xl border border-border/60 p-4 mt-4 space-y-3">
                <h5 className="text-sm font-medium">Send a proposal</h5>
                <Textarea
                  placeholder="Introduce yourself, how you would build this, and anything the client should know…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={2000}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Your price ({request.currency})
                    </label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder={String(request.budget)}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Estimated days</label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="14"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Portfolio links (optional)
                  </label>
                  <UrlListInput
                    value={portfolioUrls}
                    onChange={setPortfolioUrls}
                    placeholder="https://your-work.example.com"
                  />
                </div>
                {formError && <p className="text-xs text-red-400">{formError}</p>}
                <Button
                  onClick={submitProposal}
                  loading={busy === "submit"}
                  disabled={busy !== null}
                  className="w-full"
                >
                  <Send className="size-4 mr-1" /> Send proposal
                </Button>
              </div>
            )}
            {!mine && userId && myActive && (
              <p className="text-xs text-muted-foreground mt-3">
                Your proposal is{" "}
                {myActive.status === "pending" ? "with the client for review" : myActive.status}.
              </p>
            )}
            {!mine && userId && !accepting && !myActive && (
              <p className="text-xs text-muted-foreground mt-3">
                This project is not accepting proposals right now.
              </p>
            )}
          </>
        )}

        {mine && !["completed", "cancelled", "refunded"].includes(status) && (
          <div className="flex justify-end mt-4">
            <Button size="sm" variant="ghost" onClick={onCancelRequest}>
              <Ban className="size-3.5 mr-1" /> Cancel request
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RequestDetailDialog({
  request,
  userId,
  profiles,
  signedPhotos,
  onClose,
  onChanged,
  onCancelRequest,
}: {
  request: RequestLike | null;
  userId: string | null;
  profiles: Record<string, ProfileLite>;
  signedPhotos: Record<string, string>;
  onClose: () => void;
  onChanged: () => void;
  onCancelRequest: (r: RequestLike) => void;
}) {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project details</DialogTitle>
        </DialogHeader>
        {request && (
          <DetailBody
            key={request.id}
            request={request}
            userId={userId}
            profiles={profiles}
            signedPhotos={signedPhotos}
            onChanged={onChanged}
            onCancelRequest={() => onCancelRequest(request)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-step request form (spec Part 4.2)                             */
/* ------------------------------------------------------------------ */

type InsertRow = Database["public"]["Tables"]["website_requests"]["Insert"];
type RequestPayload = Omit<InsertRow, "requester_id">;

const PACKAGE_TO_TIER: Record<PackageType, string> = {
  simple: "normal",
  advanced: "advanced",
  max_advanced: "high_end",
};

function NewRequestWizard({
  open,
  onOpenChange,
  userId,
  initialPackage,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  initialPackage: PackageType;
  editing: OwnRow | null;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(1);
  const [pkg, setPkg] = useState<PackageType>("simple");
  const [budget, setBudget] = useState("");
  // NORDEVA is USD-only (the database rejects other currencies on
  // website_requests), so the wizard no longer offers a currency choice.
  const currency = "USD";
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");
  const [audience, setAudience] = useState("");
  const [pages, setPages] = useState("");
  const [functionality, setFunctionality] = useState("");
  const [techs, setTechs] = useState<string[]>([]);
  const [designRefs, setDesignRefs] = useState("");
  const [refUrls, setRefUrls] = useState<string[]>([]);
  const [domainNeeds, setDomainNeeds] = useState("");
  const [hostingNeeds, setHostingNeeds] = useState("");
  const [deadline, setDeadline] = useState("");
  const [contact, setContact] = useState("");
  const [photos, setPhotos] = useState<{ path: string; previewUrl: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setErrors({});
    if (editing) {
      setPkg((editing.package_type as PackageType | null) ?? "simple");
      setBudget(String(editing.budget ?? ""));
      setTitle(editing.title ?? "");
      setCategory(editing.category ?? "");
      setDescription(editing.description ?? "");
      setPurpose(editing.purpose ?? "");
      setAudience(editing.target_audience ?? "");
      setPages(editing.required_pages ?? "");
      setFunctionality(editing.required_functionality ?? "");
      setTechs(editing.preferred_technologies ?? []);
      setDesignRefs(editing.design_references ?? "");
      setRefUrls(editing.reference_urls ?? []);
      setDomainNeeds(editing.domain_needs ?? "");
      setHostingNeeds(editing.hosting_needs ?? "");
      setDeadline(editing.deadline ?? "");
      setContact(editing.contact ?? "");
      const paths = editing.photos ?? [];
      setPhotos(paths.map((p) => ({ path: p, previewUrl: "" })));
      if (paths.length > 0) {
        supabase.storage
          .from("request-photos")
          .createSignedUrls(paths, 60 * 60)
          .then(({ data }) => {
            if (!data) return;
            setPhotos(paths.map((p, i) => ({ path: p, previewUrl: data[i]?.signedUrl ?? "" })));
          });
      }
    } else {
      setPkg(initialPackage);
    }
  }, [open, editing, initialPackage]);

  const pkgMeta = packageMeta(pkg);
  const budgetNum = Number(budget);
  const outOfRange =
    budgetNum > 0 && pkgMeta !== null && (budgetNum < pkgMeta.min || budgetNum > pkgMeta.max);
  const today = new Date().toISOString().slice(0, 10);

  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!(budgetNum > 0)) e.budget = "Enter your budget for this project";
    }
    if (s === 2) {
      if (title.trim().length < 3) e.title = "Give your project a title (at least 3 characters)";
      if (!category) e.category = "Choose a project category";
      if (description.trim().length < 20)
        e.description = "Describe the project in a little more detail (at least 20 characters)";
    }
    if (s === 3) {
      if (deadline && deadline < today) e.deadline = "The deadline can't be in the past";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !userId) return;
    const list = Array.from(files).slice(0, 6 - photos.length);
    if (list.length === 0) return;
    setUploading(true);
    const uploaded: { path: string; previewUrl: string }[] = [];
    for (const f of list) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} is not an image`);
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name} is over 5MB`);
        continue;
      }
      // Filename validation via char codes (same rule as the sell flow).
      const badName = Array.from(f.name).some((ch) => {
        const c = ch.charCodeAt(0);
        return c < 32 || c === 127;
      });
      if (badName) {
        toast.error(`${f.name} has an invalid file name`);
        continue;
      }
      const ext = f.name.split(".").pop() || "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("request-photos").upload(path, f);
      if (error) {
        toast.error(error.message);
        continue;
      }
      const { data: signed } = await supabase.storage
        .from("request-photos")
        .createSignedUrl(path, 60 * 60);
      uploaded.push({ path, previewUrl: signed?.signedUrl ?? "" });
    }
    setPhotos((prev) => [...prev, ...uploaded]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removePhoto = async (path: string) => {
    if (!editing) await supabase.storage.from("request-photos").remove([path]);
    setPhotos((prev) => prev.filter((p) => p.path !== path));
  };

  const buildFull = (asDraft: boolean): RequestPayload => ({
    title: title.trim(),
    description: description.trim(),
    budget: budgetNum,
    currency,
    contact: contact.trim() || null,
    tier: PACKAGE_TO_TIER[pkg],
    photos: photos.map((p) => p.path),
    package_type: pkg,
    category: category || null,
    purpose: purpose.trim() || null,
    target_audience: audience.trim() || null,
    required_pages: pages.trim() || null,
    required_functionality: functionality.trim() || null,
    preferred_technologies: techs,
    design_references: designRefs.trim() || null,
    reference_urls: refUrls,
    domain_needs: domainNeeds || null,
    hosting_needs: hostingNeeds || null,
    deadline: deadline || null,
    is_draft: asDraft,
    project_status: asDraft ? "draft" : "open",
  });

  const finish = () => {
    setTitle("");
    setDescription("");
    setBudget("");
    setContact("");
    setPhotos([]);
    setTechs([]);
    setRefUrls([]);
    setStep(1);
    onOpenChange(false);
    onSaved();
  };

  const save = async (asDraft: boolean) => {
    if (!userId) return toast.error("Sign in to post a request");
    for (const s of [1, 2, 3]) {
      if (!validateStep(s)) {
        setStep(s);
        toast.error("Please fix the highlighted fields first");
        return;
      }
    }
    setSaving(asDraft ? "draft" : "submit");
    const full = buildFull(asDraft);
    try {
      if (editing) {
        const { error } = await supabase.from("website_requests").update(full).eq("id", editing.id);
        if (error) throw error;
        toast.success(asDraft ? "Draft updated" : "Request published");
        finish();
        return;
      }
      const { error } = await supabase
        .from("website_requests")
        .insert({ ...full, requester_id: userId });
      if (error) {
        if (asDraft) {
          toast.error(
            "Drafts activate once the database upgrade is applied to the live project — your request was not posted",
          );
          return;
        }
        // Graceful fallback (Wave B pattern): before the upgrade migration is
        // live, the new columns do not exist yet — post with the long-standing
        // fields only so the request still reaches the board.
        const legacy: InsertRow = {
          requester_id: userId,
          title: full.title,
          description: full.description,
          budget: full.budget,
          currency: full.currency,
          contact: full.contact,
          tier: full.tier,
          photos: full.photos,
        };
        const { error: legacyError } = await supabase.from("website_requests").insert(legacy);
        if (legacyError) throw legacyError;
        toast.success(
          "Request posted — package details and proposals activate once the database upgrade is applied",
        );
        finish();
        return;
      }
      toast.success(
        asDraft
          ? "Draft saved — only you can see it"
          : "Request posted — developers can now send proposals",
      );
      finish();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your request");
    } finally {
      setSaving(null);
    }
  };

  const err = (k: string) =>
    errors[k] ? <p className="text-xs text-red-400 mt-1">{errors[k]}</p> : null;
  const stepLabels = ["Package & budget", "Project details", "References & logistics", "Review"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {editing ? "Edit your website request" : "Post a website project"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1.5 flex-wrap">
          {stepLabels.map((label, i) => (
            <span
              key={label}
              className={`text-[11px] px-2.5 py-1 rounded-full ${
                step === i + 1
                  ? "lume-gradient text-white"
                  : step > i + 1
                    ? "bg-lume/15 text-lume"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-2">
              {PROJECT_PACKAGES.map((p) => {
                const accent = PACKAGE_ACCENTS[p.id];
                const isSelected = pkg === p.id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPkg(p.id)}
                    aria-pressed={isSelected}
                    className={`text-left rounded-xl border p-3 transition-colors ${
                      isSelected ? accent.selected : "border-border/60 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`size-2 rounded-full shrink-0 ${accent.bar}`}
                        />
                        {p.label}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className={`text-xs font-semibold ${accent.price}`}>
                          ${p.min}–${p.max}
                        </span>
                        {isSelected && <Check className={`size-4 ${accent.check}`} />}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.suitableFor.slice(0, 3).join(" · ")}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              These are <span className="text-foreground">starting ranges, not fixed prices</span>.
              The final price is agreed between you and the developer you select, before work
              begins. Custom budgets outside the range are welcome. Every project includes up to 2
              free revision rounds.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Your budget *</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder={pkgMeta ? String(pkgMeta.min) : "100"}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
                {err("budget")}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Currency</label>
                <Select value={currency} disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Projects are priced in USD.</p>
              </div>
            </div>
            {outOfRange && (
              <p className="text-xs text-amber-400">
                This is outside the typical {pkgMeta?.label} range — no problem, it will be treated
                as a custom budget.
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Project title *</label>
              <Input
                placeholder="e.g. Portfolio site for a photographer"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
              {err("title")}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Project category *</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("category")}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Project description *</label>
              <Textarea
                placeholder="What should the website do? Who is it for? Any must-have features or style notes?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
              />
              {err("description")}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Website purpose</label>
                <Input
                  placeholder="e.g. Get enquiries for my studio"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Target audience</label>
                <Input
                  placeholder="e.g. Local small businesses"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Required pages</label>
              <Textarea
                placeholder={"Home, About, Services, Gallery, Contact…"}
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Required functionality</label>
              <Textarea
                placeholder={"Contact form, online booking, payments, blog, login area…"}
                value={functionality}
                onChange={(e) => setFunctionality(e.target.value)}
                rows={2}
              />
            </div>
            <TagInput
              label="Preferred technologies"
              description="Optional — type and press Enter to add."
              value={techs}
              onChange={setTechs}
              suggestions={[...TECHNOLOGY_SUGGESTIONS]}
              placeholder="e.g. WordPress"
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Design references</label>
              <Textarea
                placeholder="Describe the look you like — colours, style, mood…"
                value={designRefs}
                onChange={(e) => setDesignRefs(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Reference website URLs</label>
              <UrlListInput
                value={refUrls}
                onChange={setRefUrls}
                placeholder="https://a-site-you-like.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Reference photos (optional, up to 6)
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {photos.map((p) => (
                  <div
                    key={p.path}
                    className="relative aspect-square rounded-lg overflow-hidden bg-muted border border-border/60"
                  >
                    {p.previewUrl ? (
                      <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center">
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(p.path)}
                      className="absolute top-1 right-1 size-5 rounded-full bg-black/70 text-white grid place-items-center hover:bg-black"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {photos.length < 6 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || !userId}
                    className="aspect-square rounded-lg border border-dashed border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:border-lume/60 transition-colors"
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => onPickFiles(e.target.files)}
              />
              <p className="text-[11px] text-muted-foreground">
                Photos are private — only you and the developer you select can view them.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Domain</label>
                <Select value={domainNeeds} onValueChange={setDomainNeeds}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="I already have a domain">I already have a domain</SelectItem>
                    <SelectItem value="I need a domain">I need a domain</SelectItem>
                    <SelectItem value="Not sure yet">Not sure yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Hosting</label>
                <Select value={hostingNeeds} onValueChange={setHostingNeeds}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="I already have hosting">I already have hosting</SelectItem>
                    <SelectItem value="I need hosting">I need hosting</SelectItem>
                    <SelectItem value="Not sure yet">Not sure yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Desired deadline</label>
              <Input
                type="date"
                min={today}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              {err("deadline")}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Additional instructions / contact (private)
              </label>
              <Input
                placeholder="Anything else, or how the selected developer can reach you"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={300}
              />
              <p className="text-[11px] text-muted-foreground">
                This is never shown on the public board.
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-lume/40 bg-lume/5 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium">{pkgMeta?.label}</span>
                <span className="font-semibold">
                  {budgetNum > 0 ? formatMoney(budgetNum, currency) : "—"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Starting range ${pkgMeta?.min}–${pkgMeta?.max}. The final price is agreed with the
                developer you select, before any work begins.
                {outOfRange ? " Your budget is a custom budget outside this range." : ""}
              </p>
            </div>
            <dl className="space-y-2.5 text-sm">
              <ReviewRow label="Title" value={title} />
              <ReviewRow label="Category" value={category} />
              <ReviewRow label="Description" value={description} />
              <ReviewRow label="Purpose" value={purpose} />
              <ReviewRow label="Target audience" value={audience} />
              <ReviewRow label="Required pages" value={pages} />
              <ReviewRow label="Required functionality" value={functionality} />
              <ReviewRow label="Technologies" value={techs.length ? techs.join(", ") : ""} />
              <ReviewRow label="Design references" value={designRefs} />
              <ReviewRow label="Reference URLs" value={refUrls.length ? refUrls.join("\n") : ""} />
              <ReviewRow label="Photos" value={photos.length ? `${photos.length} attached` : ""} />
              <ReviewRow label="Domain" value={domainNeeds} />
              <ReviewRow label="Hosting" value={hostingNeeds} />
              <ReviewRow label="Deadline" value={deadline ? deadlineLabel(deadline) : ""} />
            </dl>
            <p className="text-xs text-muted-foreground">
              When you submit, your request appears on the public board (without your private
              contact details). Developers send proposals, and only the developer you select gets
              assigned — nobody can take your project without your approval.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-1">
          {step > 1 && (
            <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="size-4 mr-1" /> Back
            </Button>
          )}
          <div className="ml-auto flex gap-2 flex-wrap">
            <Button
              type="button"
              variant="secondary"
              onClick={() => save(true)}
              disabled={saving !== null}
            >
              {saving === "draft" ? <Loader2 className="size-4 animate-spin" /> : "Save draft"}
            </Button>
            {step < 4 ? (
              <Button
                type="button"
                onClick={() => {
                  if (validateStep(step)) setStep(step + 1);
                }}
              >
                Continue <ArrowRight className="size-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={() => save(false)} disabled={saving !== null}>
                {saving === "submit" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : editing ? (
                  "Publish request"
                ) : (
                  "Submit request"
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground pt-0.5">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type StatusFilter = "accepting" | "all" | "active" | "completed" | "cancelled";

const ACTIVE_STATUSES = [
  "pending_review",
  "developer_selected",
  "awaiting_agreement",
  "awaiting_payment",
  "in_progress",
  "preview_submitted",
  "revision_requested",
  "final_submitted",
  "disputed",
];

function RequestsPage() {
  const [publicItems, setPublicItems] = useState<RequestLike[] | null>(null);
  const [ownItems, setOwnItems] = useState<OwnRow[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [signedPhotos, setSignedPhotos] = useState<Record<string, string>>({});
  const [proposalCounts, setProposalCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [pkgFilter, setPkgFilter] = useState<"all" | PackageType>("all");
  const [budgetFilter, setBudgetFilter] = useState("any");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("accepting");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPkg, setWizardPkg] = useState<PackageType>("simple");
  const [editing, setEditing] = useState<OwnRow | null>(null);

  const load = async (uid: string | null) => {
    const { data, error } = await supabase
      .from("website_requests_public")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    setPublicItems(((data ?? []) as PublicRow[]).map(normalizePublicRow));
    if (uid) {
      const { data: own, error: ownError } = await supabase
        .from("website_requests")
        .select("*")
        .eq("requester_id", uid)
        .order("created_at", { ascending: false })
        .limit(50);
      // If the owner-table read is unavailable, the My Requests section
      // simply falls back to the owner's rows from the public list.
      setOwnItems(ownError ? null : ((own ?? []) as OwnRow[]));
    }
  };

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      load(uid);
      channel = supabase
        .channel("requests-board")
        .on("postgres_changes", { event: "*", schema: "public", table: "website_requests" }, () =>
          load(uid),
        )
        .subscribe();
    });
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const myRequests: RequestLike[] = useMemo(() => {
    if (!userId) return [];
    if (ownItems) return ownItems;
    return (publicItems ?? []).filter((r) => r.requester_id === userId);
  }, [ownItems, publicItems, userId]);

  // Profiles for requesters + assigned developers shown on cards.
  useEffect(() => {
    const rows: RequestLike[] = [...(publicItems ?? []), ...myRequests];
    const ids = Array.from(
      new Set(rows.flatMap((r) => [r.requester_id, r.taken_by]).filter(Boolean) as string[]),
    ).filter((id) => !profiles[id]);
    if (ids.length === 0) return;
    supabase
      .from("public_profiles")
      .select("id, username, display_name, avatar_url, verified, headline")
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        setProfiles((prev) => ({
          ...prev,
          ...Object.fromEntries((data as ProfileLite[]).map((p) => [p.id, p])),
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicItems, myRequests]);

  // Proposal counts for the owner's own requests.
  useEffect(() => {
    if (!userId || myRequests.length === 0) return;
    const ids = myRequests.map((r) => r.id);
    supabase
      .from("project_proposals")
      .select("request_id, status")
      .in("request_id", ids)
      .then(({ data, error }) => {
        if (error || !data) return; // proposals not live yet — counts just stay hidden
        const counts: Record<string, number> = {};
        for (const p of data as { request_id: string; status: string }[]) {
          if (p.status === "withdrawn") continue;
          counts[p.request_id] = (counts[p.request_id] ?? 0) + 1;
        }
        setProposalCounts(counts);
      });
  }, [userId, myRequests]);

  // Sign photo paths for requests the viewer participates in (private bucket).
  useEffect(() => {
    if (!userId) return;
    const rows: RequestLike[] = [...(publicItems ?? []), ...myRequests];
    const paths: string[] = Array.from(
      new Set(
        rows
          .filter((r) => r.requester_id === userId || r.taken_by === userId)
          .flatMap((r) => r.photos ?? [])
          .filter((p) => p && !signedPhotos[p]),
      ),
    );
    if (paths.length === 0) return;
    supabase.storage
      .from("request-photos")
      .createSignedUrls(paths, 60 * 60)
      .then(({ data }) => {
        if (!data) return;
        setSignedPhotos((prev) => {
          const next = { ...prev };
          data.forEach((d, i) => {
            if (d.signedUrl) next[paths[i]] = d.signedUrl;
          });
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicItems, myRequests, userId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (publicItems ?? []).filter((row) => {
      if (row.is_draft) return false; // drafts are owner-only, never public
      const st = effectiveStatus(row);
      if (statusFilter === "accepting" && !["open", "proposals_received"].includes(st))
        return false;
      if (statusFilter === "active" && !ACTIVE_STATUSES.includes(st)) return false;
      if (statusFilter === "completed" && !["completed", "refunded"].includes(st)) return false;
      if (statusFilter === "cancelled" && st !== "cancelled") return false;
      if (pkgFilter !== "all" && effectivePackage(row) !== pkgFilter) return false;
      const b = Number(row.budget);
      if (budgetFilter === "under100" && !(b < 100)) return false;
      if (budgetFilter === "100-200" && !(b >= 100 && b < 200)) return false;
      if (budgetFilter === "200-1000" && !(b >= 200 && b <= 1000)) return false;
      if (budgetFilter === "over1000" && !(b > 1000)) return false;
      if (q) {
        const hay = [
          row.title,
          row.description,
          row.category ?? "",
          ...(row.preferred_technologies ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [publicItems, search, pkgFilter, budgetFilter, statusFilter]);

  const detailRow: RequestLike | null = useMemo(() => {
    if (!detailId) return null;
    const own = (ownItems ?? []).find((r) => r.id === detailId);
    if (own) return own;
    return (publicItems ?? []).find((r) => r.id === detailId) ?? null;
  }, [detailId, ownItems, publicItems]);

  const transition = async (r: RequestLike, to: string, successMsg: string) => {
    const { data, error } = await supabase.rpc("transition_project_status", {
      p_request_id: r.id,
      p_status: to,
    });
    if (!error && data !== false) {
      toast.success(successMsg);
      await load(userId);
      return;
    }
    if (error && isMissingFeatureError(error)) {
      // Pre-upgrade fallback for cancel only: the legacy status column can
      // still be updated directly by the owner for open requests.
      if (to === "cancelled") {
        const { error: directError } = await supabase
          .from("website_requests")
          .update({ status: "cancelled" })
          .eq("id", r.id);
        if (!directError) {
          toast.success(successMsg);
          await load(userId);
          return;
        }
      }
      toast.error("This action activates once the database upgrade is applied to the live project");
      return;
    }
    toast.error(error?.message ?? "That status change is not allowed");
  };

  const cancelRequest = (r: RequestLike) => transition(r, "cancelled", "Request cancelled");
  const publishDraft = (r: RequestLike) => transition(r, "open", "Request published");

  const deleteRequest = async (r: RequestLike) => {
    const { error } = await supabase.from("website_requests").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Request deleted");
    if (detailId === r.id) setDetailId(null);
    await load(userId);
  };

  const openWizard = (pkg?: PackageType) => {
    if (!userId) {
      toast.error("Sign in to post a project");
      return;
    }
    setEditing(null);
    if (pkg) setWizardPkg(pkg);
    setWizardOpen(true);
  };

  const cardProps = (r: RequestLike) => ({
    r,
    mine: r.requester_id === userId,
    requesterProfile: profiles[r.requester_id],
    assignedProfile: r.taken_by ? profiles[r.taken_by] : undefined,
    signedPhotos,
    proposalCount: r.requester_id === userId ? proposalCounts[r.id] : undefined,
    showWorkspace:
      (r.requester_id === userId || r.taken_by === userId) &&
      (!!r.taken_by ||
        [
          "developer_selected",
          "awaiting_agreement",
          "awaiting_payment",
          "in_progress",
          "preview_submitted",
          "revision_requested",
          "final_submitted",
          "completed",
          "disputed",
        ].includes(effectiveStatus(r))),
    onOpen: () => setDetailId(r.id),
    onPublish: () => publishDraft(r),
    onCancel: () => cancelRequest(r),
    onEdit: () => {
      const own = (ownItems ?? []).find((x) => x.id === r.id);
      if (own) {
        setEditing(own);
        setWizardOpen(true);
      }
    },
    onDelete: () => deleteRequest(r),
  });

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="relative overflow-hidden rounded-3xl border border-border/60 bg-card px-6 py-8 sm:px-8 sm:py-10 mb-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-28 -right-24 size-80 rounded-full bg-lume/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 right-40 size-56 rounded-full bg-gold/10 blur-3xl"
          />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-full bg-lume/15 text-lume font-medium">
              <Globe className="size-3.5" /> Custom Projects
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.05] mt-4">
              Custom website projects
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl text-sm sm:text-base">
              Post the website you want built, receive proposals from NORDEVA developers, and select
              the developer you trust. Package prices are starting ranges — the final price is
              agreed between you and your developer before work begins.
            </p>
            <div className="flex gap-2 flex-wrap mt-6">
              {userId ? (
                <Button onClick={() => openWizard()}>
                  <Plus className="size-4 mr-1" /> Post a project
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/auth">Sign in to post</Link>
                </Button>
              )}
              <Button asChild variant="secondary">
                <a href="#how-it-works">How it works</a>
              </Button>
            </div>
          </div>
        </header>

        <HowItWorks />

        <PackageCards
          onPick={(p) => (userId ? openWizard(p) : toast.error("Sign in to post a project"))}
        />

        {userId && (
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold mb-3">My requests</h2>
            {publicItems === null && ownItems === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : myRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                You haven't posted a project yet.{" "}
                <button className="text-lume underline" onClick={() => openWizard()}>
                  Post your first one
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {myRequests.map((r) => (
                  <RequestCard key={r.id} {...cardProps(r)} />
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <h2 className="font-display text-xl font-semibold mb-3">Open projects</h2>
          <div className="flex gap-2 flex-wrap mb-5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects, technologies…"
                className="pl-9"
              />
            </div>
            <Select value={pkgFilter} onValueChange={(v) => setPkgFilter(v as "all" | PackageType)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Package" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All packages</SelectItem>
                {PROJECT_PACKAGES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={budgetFilter} onValueChange={setBudgetFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Budget" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any budget</SelectItem>
                <SelectItem value="under100">Under $100</SelectItem>
                <SelectItem value="100-200">$100 – $200</SelectItem>
                <SelectItem value="200-1000">$200 – $1,000</SelectItem>
                <SelectItem value="over1000">Over $1,000</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accepting">Accepting proposals</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {publicItems === null ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center text-muted-foreground">
              No projects match these filters.{" "}
              {userId ? (
                <button className="text-lume underline" onClick={() => openWizard()}>
                  Post the first one
                </button>
              ) : (
                <Link to="/auth" className="text-lume underline">
                  Sign in to post
                </Link>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((r) => (
                <RequestCard key={r.id} {...cardProps(r)} />
              ))}
            </ul>
          )}
        </section>

        <BenefitsBand />
      </div>

      <RequestDetailDialog
        request={detailRow}
        userId={userId}
        profiles={profiles}
        signedPhotos={signedPhotos}
        onClose={() => setDetailId(null)}
        onChanged={() => load(userId)}
        onCancelRequest={(r) => cancelRequest(r)}
      />
      <NewRequestWizard
        open={wizardOpen}
        onOpenChange={(v) => {
          setWizardOpen(v);
          if (!v) setEditing(null);
        }}
        userId={userId}
        initialPackage={wizardPkg}
        editing={editing}
        onSaved={() => load(userId)}
      />
    </div>
  );
}
