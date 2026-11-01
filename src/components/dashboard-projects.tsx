import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bookmark, Briefcase, FileText, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar } from "@/components/ui-kit";
import { formatMoney } from "@/lib/currencies";
import { effectiveStatus, PROJECT_STATUSES, type RequestLike } from "@/lib/project-requests";

/**
 * "Projects" area of the dashboard: the same person's client view (requests
 * they posted, proposals waiting on them, developers they saved) and
 * developer view (proposals they sent, projects assigned to them, open
 * requests). Every block loads independently — when the project-upgrade
 * tables are not in the live database yet, that block shows a short
 * "activates after the database upgrade" note instead of failing the page.
 */

const ACTIVE_STATUSES = [
  "developer_selected",
  "awaiting_agreement",
  "awaiting_payment",
  "in_progress",
  "preview_submitted",
  "revision_requested",
  "final_submitted",
];

const PROPOSAL_STATUS: Record<string, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-amber-500/15 text-amber-400" },
  accepted: { label: "Accepted", classes: "bg-emerald-500/15 text-emerald-400" },
  rejected: { label: "Not selected", classes: "bg-muted text-muted-foreground" },
  withdrawn: { label: "Withdrawn", classes: "bg-muted text-muted-foreground" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = PROJECT_STATUSES[status] ?? {
    label: status,
    classes: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

function UpgradeNote({ what }: { what: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border/60 p-3 text-xs leading-relaxed text-muted-foreground">
      {what} activate once the database upgrade is applied to the live project.
    </p>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-base font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

type SavedProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  headline?: string | null;
};

export function DashboardProjects({ userId }: { userId: string }) {
  const [myRequests, setMyRequests] = useState<RequestLike[] | null>(null);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [pendingByRequest, setPendingByRequest] = useState<Record<string, number> | null>(null);
  const [proposalsUnavailable, setProposalsUnavailable] = useState(false);
  const [myProposals, setMyProposals] = useState<any[] | null>(null);
  const [myProposalsUnavailable, setMyProposalsUnavailable] = useState(false);
  const [requestTitles, setRequestTitles] = useState<Record<string, string>>({});
  const [assigned, setAssigned] = useState<RequestLike[] | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [saved, setSaved] = useState<SavedProfile[] | null>(null);
  const [savedUnavailable, setSavedUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("website_requests")
        .select("*")
        .eq("requester_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        setRequestsFailed(true);
        setMyRequests([]);
        return;
      }
      const rows = (data ?? []) as RequestLike[];
      setMyRequests(rows);

      if (rows.length > 0) {
        const { data: props, error: propsError } = await supabase
          .from("project_proposals")
          .select("request_id, status")
          .in(
            "request_id",
            rows.map((r) => r.id),
          );
        if (cancelled) return;
        if (propsError) {
          setProposalsUnavailable(true);
        } else {
          const counts: Record<string, number> = {};
          for (const p of (props ?? []) as { request_id: string; status: string }[]) {
            if (p.status === "pending") counts[p.request_id] = (counts[p.request_id] ?? 0) + 1;
          }
          setPendingByRequest(counts);
        }
      } else {
        setPendingByRequest({});
      }
    })();

    (async () => {
      const { data, error } = await supabase
        .from("project_proposals")
        .select("*")
        .eq("developer_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) {
        setMyProposalsUnavailable(true);
        setMyProposals([]);
        return;
      }
      const rows = data ?? [];
      setMyProposals(rows);
      const ids = [...new Set(rows.map((p: any) => p.request_id))];
      if (ids.length > 0) {
        const { data: titles } = await supabase
          .from("website_requests_public")
          .select("id, title")
          .in("id", ids);
        if (cancelled) return;
        if (titles) {
          setRequestTitles(
            Object.fromEntries(
              (titles as { id: string; title: string }[]).map((t) => [t.id, t.title]),
            ),
          );
        }
      }
    })();

    (async () => {
      const { data, error } = await supabase
        .from("website_requests")
        .select("*")
        .eq("taken_by", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      setAssigned(error ? [] : ((data ?? []) as RequestLike[]));
    })();

    (async () => {
      const { count } = await supabase
        .from("website_requests_public")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      if (!cancelled) setOpenCount(count ?? 0);
    })();

    (async () => {
      const { data, error } = await supabase
        .from("saved_developers")
        .select("developer_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) {
        setSavedUnavailable(true);
        setSaved([]);
        return;
      }
      const ids = (data ?? []).map((r: any) => r.developer_id);
      if (ids.length === 0) {
        setSaved([]);
        return;
      }
      const withHeadline = await supabase
        .from("public_profiles")
        .select("id, username, display_name, avatar_url, headline")
        .in("id", ids);
      const profiles = withHeadline.error
        ? await supabase
            .from("public_profiles")
            .select("id, username, display_name, avatar_url")
            .in("id", ids)
        : withHeadline;
      if (cancelled) return;
      const byId = new Map(((profiles.data ?? []) as SavedProfile[]).map((p) => [p.id, p]));
      setSaved(ids.map((id: string) => byId.get(id)).filter(Boolean) as SavedProfile[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const requests = myRequests ?? [];
  const drafts = requests.filter((r) => r.is_draft || effectiveStatus(r) === "draft").length;
  const openMine = requests.filter((r) =>
    ["open", "proposals_received"].includes(effectiveStatus(r)),
  ).length;
  const activeMine = requests.filter((r) => ACTIVE_STATUSES.includes(effectiveStatus(r)));
  const awaitingReview = Object.values(pendingByRequest ?? {}).reduce((a, b) => a + b, 0);
  const reviewList = requests.filter((r) => (pendingByRequest?.[r.id] ?? 0) > 0);
  const assignedRows = assigned ?? [];

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Briefcase className="size-5 text-lume" /> Projects
        </h2>
        <Link
          to="/requests"
          className="inline-flex items-center gap-1 text-sm text-lume hover:opacity-80"
        >
          Request board <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------ CLIENT VIEW ------------------------------ */}
        <div className="surface p-5">
          <h3 className="flex items-center gap-2 font-medium">
            <FileText className="size-4 text-lume" /> As a client
          </h3>

          {requestsFailed ? (
            <div className="mt-4">
              <UpgradeNote what="Your project requests" />
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-4 gap-2">
                <StatChip label="Drafts" value={drafts} />
                <StatChip label="Open" value={openMine} />
                <StatChip label="In progress" value={activeMine.length} />
                <StatChip label="To review" value={awaitingReview} />
              </div>

              {proposalsUnavailable ? (
                <div className="mt-4">
                  <UpgradeNote what="Developer proposals" />
                </div>
              ) : reviewList.length > 0 ? (
                <div className="mt-4">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Proposals waiting for your review
                  </div>
                  <div className="mt-2 divide-y divide-border/60 rounded-xl border border-border/60">
                    {reviewList.slice(0, 3).map((r) => (
                      <Link
                        key={r.id}
                        to="/requests"
                        className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent/30"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                          {pendingByRequest?.[r.id]} pending
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Active projects
                </div>
                {activeMine.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No active projects yet.{" "}
                    <Link to="/requests" className="text-lume underline">
                      Post a website request
                    </Link>{" "}
                    and pick a developer from their proposals.
                  </p>
                ) : (
                  <div className="mt-2 divide-y divide-border/60 rounded-xl border border-border/60">
                    {activeMine.slice(0, 5).map((r) => (
                      <Link
                        key={r.id}
                        to="/projects/$id"
                        params={{ id: r.id }}
                        className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent/30"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                        <StatusBadge status={effectiveStatus(r)} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Bookmark className="size-3.5" /> Saved developers
            </div>
            {savedUnavailable ? (
              <div className="mt-2">
                <UpgradeNote what="Saved developers" />
              </div>
            ) : saved && saved.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {saved.map((p) => (
                  <Link
                    key={p.id}
                    to="/creator/$username"
                    params={{ username: p.username ?? p.id }}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 py-1 pl-1 pr-3 transition-colors hover:border-lume/50"
                  >
                    <Avatar name={p.display_name ?? p.username} url={p.avatar_url} size={24} />
                    <span className="max-w-40 truncate text-xs font-medium">
                      {p.display_name ?? p.username ?? "Developer"}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Nobody saved yet — find developers on the{" "}
                <Link to="/people" className="text-lume underline">
                  Developers page
                </Link>
                .
              </p>
            )}
          </div>
        </div>

        {/* ---------------------------- DEVELOPER VIEW ---------------------------- */}
        <div className="surface p-5">
          <h3 className="flex items-center gap-2 font-medium">
            <Send className="size-4 text-lume" /> As a developer
          </h3>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatChip label="Open requests" value={openCount ?? 0} />
            <StatChip label="My proposals" value={myProposals?.length ?? 0} />
            <StatChip label="Assigned" value={assignedRows.length} />
          </div>
          <Link
            to="/requests"
            className="mt-3 inline-flex items-center gap-1 text-sm text-lume hover:opacity-80"
          >
            Browse open requests <ArrowRight className="size-3.5" />
          </Link>

          <div className="mt-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Projects assigned to me
            </div>
            {assignedRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No projects assigned yet — send a proposal from the request board.
              </p>
            ) : (
              <div className="mt-2 divide-y divide-border/60 rounded-xl border border-border/60">
                {assignedRows.slice(0, 5).map((r) => (
                  <Link
                    key={r.id}
                    to="/projects/$id"
                    params={{ id: r.id }}
                    className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent/30"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    <StatusBadge status={effectiveStatus(r)} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              My proposals
            </div>
            {myProposalsUnavailable ? (
              <div className="mt-2">
                <UpgradeNote what="Proposals" />
              </div>
            ) : (myProposals ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                You haven't sent any proposals yet.
              </p>
            ) : (
              <div className="mt-2 divide-y divide-border/60 rounded-xl border border-border/60">
                {(myProposals ?? []).slice(0, 5).map((p: any) => {
                  const meta = PROPOSAL_STATUS[p.status] ?? PROPOSAL_STATUS.pending;
                  const row = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {requestTitles[p.request_id] ?? "Website project"}
                        </span>
                        {p.proposed_amount != null && (
                          <span className="text-xs text-muted-foreground">
                            {formatMoney(Number(p.proposed_amount), p.currency ?? "USD")}
                            {p.estimated_days ? ` · ~${p.estimated_days} days` : ""}
                          </span>
                        )}
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.classes}`}
                      >
                        {meta.label}
                      </span>
                    </>
                  );
                  return p.status === "accepted" ? (
                    <Link
                      key={p.id}
                      to="/projects/$id"
                      params={{ id: p.request_id }}
                      className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent/30"
                    >
                      {row}
                    </Link>
                  ) : (
                    <Link
                      key={p.id}
                      to="/requests"
                      className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent/30"
                    >
                      {row}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
