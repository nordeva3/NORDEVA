import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Check,
  CircleAlert,
  CreditCard,
  Download,
  Eye,
  FileArchive,
  Flag,
  Loader2,
  Milestone as MilestoneIcon,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/currencies";
import {
  PROJECT_STATUSES,
  effectivePackage,
  effectiveStatus,
  packageBadgeLabel,
  packageMeta,
} from "@/lib/project-requests";
import { createProjectCheckout, getProjectPayment } from "@/lib/project-payment.functions";
import type { Database } from "@/integrations/supabase/types";

type RequestRow = Database["public"]["Tables"]["website_requests"]["Row"];
type ProjectPaymentRow = Database["public"]["Tables"]["project_payments"]["Row"];
type ProjectPaymentInfo = {
  payment: ProjectPaymentRow | null;
  breakdown: {
    amount: number;
    currency: string;
    platformFee: number;
    developerAmount: number;
  } | null;
  stripeConfigured: boolean;
  testMode: boolean;
  unavailable: boolean;
};
type MilestoneRow = Database["public"]["Tables"]["project_milestones"]["Row"];
type DeliveryRow = Database["public"]["Tables"]["project_deliveries"]["Row"];
type RevisionRow = Database["public"]["Tables"]["project_revisions"]["Row"];
type MessageRow = Database["public"]["Tables"]["project_messages"]["Row"];
type DisputeRow = Database["public"]["Tables"]["project_disputes"]["Row"];
type ProposalRow = Database["public"]["Tables"]["project_proposals"]["Row"];
type ProfileRow = Database["public"]["Tables"]["public_profiles"]["Row"];
type ProfileLite = Pick<
  ProfileRow,
  "id" | "username" | "display_name" | "avatar_url" | "verified" | "headline" | "bio" | "skills"
>;

export const Route = createFileRoute("/projects/$id")({
  head: () => ({
    meta: [
      { title: "Project workspace — NORDEVA" },
      {
        name: "description",
        content:
          "Private workspace for a NORDEVA custom website project: milestones, chat, previews, revisions and final delivery.",
      },
      { property: "og:title", content: "Project workspace — NORDEVA" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ProjectWorkspacePage,
});

/* ------------------------------------------------------------------ */
/* Helpers (kept local, mirroring requests.tsx)                        */
/* ------------------------------------------------------------------ */

function isMissingTableError(
  error: { code?: string; message?: string } | null,
  ...tables: string[]
): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const msg = error.message ?? "";
  return tables.some((t) => msg.includes(t));
}

function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || (error.message ?? "").includes("transition_project_status");
}

function profileName(p: ProfileLite | undefined, fallback = "NORDEVA member"): string {
  return p?.display_name || (p?.username ? `@${p.username}` : fallback);
}

function postedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function dateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
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

/** Render plain text with http(s) URLs turned into links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-lume underline break-all"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Section({
  id,
  title,
  right,
  children,
}: {
  id?: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function UnavailableNote({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
      {what} activate once the project database upgrade is applied to the live project.
    </div>
  );
}

/** Filename rule shared with the sell/request flows: reject control characters. */
function hasBadFileName(name: string): boolean {
  return Array.from(name).some((ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127;
  });
}

function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Status stepper                                                      */
/* ------------------------------------------------------------------ */

const MAIN_FLOW = [
  "open",
  "proposals_received",
  "developer_selected",
  "awaiting_agreement",
  "awaiting_payment",
  "in_progress",
  "preview_submitted",
  "final_submitted",
  "completed",
] as const;

function StatusStepper({ status }: { status: string }) {
  // resubmitted sits on the preview step (developer sent a new delivery that
  // is back under review); payment_released is a post-completion marker.
  const mapped =
    status === "revision_requested" || status === "resubmitted"
      ? "preview_submitted"
      : status === "payment_released"
        ? "completed"
        : status;
  const currentIdx = (MAIN_FLOW as readonly string[]).indexOf(mapped);
  if (currentIdx === -1) return null;
  return (
    <div>
      <ol className="flex flex-wrap gap-y-3">
        {MAIN_FLOW.map((s, i) => {
          const done = i < currentIdx;
          const current = i === currentIdx;
          return (
            <li key={s} className="flex items-center">
              <div className="flex items-center gap-1.5">
                <span
                  className={`size-5 rounded-full grid place-items-center text-[10px] shrink-0 ${
                    done
                      ? "bg-lume text-white"
                      : current
                        ? "bg-lume text-white ring-4 ring-lume/20"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                <span
                  className={`text-[11px] whitespace-nowrap ${
                    current ? "text-foreground font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {PROJECT_STATUSES[s]?.label ?? s}
                  {s === "preview_submitted" && status === "revision_requested"
                    ? " (revision)"
                    : s === "preview_submitted" && status === "resubmitted"
                      ? " (resubmitted)"
                      : ""}
                </span>
              </div>
              {i < MAIN_FLOW.length - 1 && (
                <span
                  className={`mx-2 h-px w-4 sm:w-6 ${i < currentIdx ? "bg-lume" : "bg-border"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MILESTONES = [
  "Requirements confirmed",
  "Design started",
  "Development started",
  "First preview",
  "Revision stage",
  "Final delivery",
];

function MilestonesSection({
  canEdit,
  rows,
  unavailable,
  onChanged,
}: {
  canEdit: boolean;
  rows: MilestoneRow[] | null;
  unavailable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (unavailable) return <UnavailableNote what="Milestones" />;
  if (rows === null)
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  const doneCount = rows.filter((m) => m.status === "done").length;

  const setStatus = async (m: MilestoneRow, next: string) => {
    setBusy(m.id);
    const { error } = await supabase
      .from("project_milestones")
      .update({
        status: next,
        completed_at: next === "done" ? new Date().toISOString() : null,
      })
      .eq("id", m.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    onChanged();
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {doneCount} of {rows.length} milestones complete
        {canEdit ? "" : " — progress is updated by the developer."}
      </p>
      <ol className="space-y-2">
        {rows.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2.5"
          >
            <span
              className={`size-6 rounded-full grid place-items-center shrink-0 ${
                m.status === "done"
                  ? "bg-lume text-white"
                  : m.status === "in_progress"
                    ? "bg-sky-500/15 text-sky-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {m.status === "done" ? (
                <Check className="size-3.5" />
              ) : (
                <MilestoneIcon className="size-3.5" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{m.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {m.status === "done" && m.completed_at
                  ? `Completed ${dateTime(m.completed_at)}`
                  : m.status === "in_progress"
                    ? "In progress"
                    : "Pending"}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-1.5 shrink-0">
                {m.status === "pending" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => setStatus(m, "in_progress")}
                  >
                    {busy === m.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <>
                        <Play className="size-3.5 mr-1" /> Start
                      </>
                    )}
                  </Button>
                )}
                {m.status === "in_progress" && (
                  <Button size="sm" disabled={busy !== null} onClick={() => setStatus(m, "done")}>
                    {busy === m.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <>
                        <Check className="size-3.5 mr-1" /> Mark done
                      </>
                    )}
                  </Button>
                )}
                {m.status === "done" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setStatus(m, "pending")}
                  >
                    <RotateCcw className="size-3.5 mr-1" /> Reopen
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

const CHAT_MAX_FILE_MB = 10;
const DELIVERY_PHOTO_MAX_MB = 5;
const FINAL_MAX_MB = 100;

function validateChatFile(f: File): string | null {
  if (hasBadFileName(f.name)) return `${f.name} has an invalid file name`;
  if (f.size <= 0) return `${f.name} is empty`;
  if (f.size > CHAT_MAX_FILE_MB * 1024 * 1024) return `${f.name} is over ${CHAT_MAX_FILE_MB}MB`;
  const ok =
    f.type.startsWith("image/") ||
    ["pdf", "zip", "txt", "md", "doc", "docx"].includes(fileExt(f.name));
  if (!ok) return `${f.name} — only images, PDF, ZIP or text documents can be attached`;
  return null;
}

function ChatSection({
  requestId,
  userId,
  otherProfile,
  messages,
  unavailable,
  signedFiles,
  onSent,
}: {
  requestId: string;
  userId: string;
  otherProfile?: ProfileLite;
  messages: MessageRow[] | null;
  unavailable: boolean;
  signedFiles: Record<string, string>;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const unread = (messages ?? []).filter((m) => m.sender_id !== userId && !m.read_at).length;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  if (unavailable)
    return (
      <Section id="workspace-chat" title="Project chat">
        <UnavailableNote what="Project chat" />
      </Section>
    );

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const err = validateChatFile(f);
      if (err) {
        toast.error(err);
        continue;
      }
      if (next.length >= 4) {
        toast.error("Up to 4 attachments per message");
        break;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    if (!body.trim() && files.length === 0) return;
    setSending(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const path = `projects/${requestId}/chat/${crypto.randomUUID()}.${fileExt(f.name) || "bin"}`;
        const { error } = await supabase.storage
          .from("listing-files")
          .upload(path, f, { upsert: false, contentType: f.type || undefined });
        if (error) throw error;
        paths.push(path);
      }
      const { error } = await supabase.from("project_messages").insert({
        request_id: requestId,
        sender_id: userId,
        body: body.trim(),
        attachment_paths: paths,
      });
      if (error) {
        if (isMissingTableError(error, "project_messages")) {
          toast.error("Chat activates once the database upgrade is applied to the live project");
        } else {
          toast.error(error.message);
        }
        return;
      }
      setBody("");
      setFiles([]);
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your message");
    } finally {
      setSending(false);
    }
  };

  return (
    <Section
      id="workspace-chat"
      title="Project chat"
      right={
        unread > 0 ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-lume/15 text-lume">
            {unread} unread
          </span>
        ) : undefined
      }
    >
      <div>
        <p className="text-xs text-muted-foreground -mt-2 mb-3">
          Private between you and {profileName(otherProfile)} — only the two of you (and NORDEVA
          admins, for safety) can read this conversation.
        </p>
        <div ref={scrollRef} className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {messages === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No messages yet — say hello and confirm the first steps.
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === userId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                      mine
                        ? "bg-lume/15 border border-lume/25 rounded-br-md"
                        : "bg-muted/50 border border-border/60 rounded-bl-md"
                    }`}
                  >
                    {m.body && (
                      <p className="text-sm whitespace-pre-wrap break-words">
                        <Linkified text={m.body} />
                      </p>
                    )}
                    {(m.attachment_paths ?? []).length > 0 && (
                      <div className="flex gap-2 flex-wrap mt-2">
                        {(m.attachment_paths ?? []).map((p) => {
                          const url = signedFiles[p];
                          const isImage = /\.(png|jpe?g|gif|webp)$/i.test(p);
                          if (!url) return null;
                          return isImage ? (
                            <a
                              key={p}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="block size-20 rounded-lg overflow-hidden border border-border/60"
                            >
                              <img
                                src={url}
                                alt="Attachment"
                                className="w-full h-full object-cover"
                              />
                            </a>
                          ) : (
                            <a
                              key={p}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-lume underline"
                            >
                              <Paperclip className="size-3.5" /> {p.split("/").pop()}
                            </a>
                          );
                        })}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1.5 text-right">
                      {dateTime(m.created_at)}
                      {mine && (m.read_at ? " · Seen" : " · Sent")}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {files.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-3">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs"
              >
                <Paperclip className="size-3" /> {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-3 items-end">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="size-10 shrink-0 rounded-xl border border-border/60 grid place-items-center text-muted-foreground hover:text-foreground hover:border-lume/60 transition-colors"
            aria-label="Attach a file"
          >
            <Paperclip className="size-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => pickFiles(e.target.files)}
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message…"
            rows={2}
            maxLength={4000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            onClick={send}
            disabled={sending || (!body.trim() && files.length === 0)}
            className="shrink-0"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Deliveries (preview / revision / final — spec Part 6)               */
/* ------------------------------------------------------------------ */

function validatePhotoFile(f: File): string | null {
  if (!f.type.startsWith("image/")) return `${f.name} is not an image`;
  if (f.size <= 0) return `${f.name} is empty`;
  if (f.size > DELIVERY_PHOTO_MAX_MB * 1024 * 1024)
    return `${f.name} is over ${DELIVERY_PHOTO_MAX_MB}MB`;
  if (hasBadFileName(f.name)) return `${f.name} has an invalid file name`;
  return null;
}

function validateFinalFile(f: File): string | null {
  if (fileExt(f.name) !== "zip") return `${f.name} — final delivery files must be ZIP archives`;
  if (f.size <= 0) return `${f.name} is empty`;
  if (f.size > FINAL_MAX_MB * 1024 * 1024) return `${f.name} is over ${FINAL_MAX_MB}MB`;
  if (hasBadFileName(f.name)) return `${f.name} has an invalid file name`;
  return null;
}

function DeliveriesSection({
  request,
  userId,
  isRequester,
  isDeveloper,
  isAdmin,
  deliveries,
  revisions,
  unavailable,
  profiles,
  signedFiles,
  onChanged,
}: {
  request: RequestRow;
  userId: string;
  isRequester: boolean;
  isDeveloper: boolean;
  isAdmin: boolean;
  deliveries: DeliveryRow[] | null;
  revisions: RevisionRow[];
  unavailable: boolean;
  profiles: Record<string, ProfileLite>;
  signedFiles: Record<string, string>;
  onChanged: () => void;
}) {
  const status = effectiveStatus(request);
  const [busy, setBusy] = useState<string | null>(null);
  const [revisionFor, setRevisionFor] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState("");

  // Revision allowance agreed up front (Wave M4): the buyer gets
  // revision_limit free revision rounds per project.
  const revisionLimit = request.revision_limit ?? 2;
  const revisionsUsed = request.revisions_used ?? 0;
  const revisionLimitReached = revisionsUsed >= revisionLimit;

  // Preview form
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewNotes, setPreviewNotes] = useState("");
  const [shots, setShots] = useState<File[]>([]);
  const shotsRef = useRef<HTMLInputElement>(null);
  // Final form
  const [finalUrl, setFinalUrl] = useState("");
  const [finalNotes, setFinalNotes] = useState("");
  const [zipFiles, setZipFiles] = useState<File[]>([]);
  const zipRef = useRef<HTMLInputElement>(null);

  if (unavailable) {
    return (
      <Section title="Previews & delivery">
        <UnavailableNote what="Deliveries" />
      </Section>
    );
  }

  const canSubmit = isDeveloper || isAdmin;
  const workActive = [
    "in_progress",
    "preview_submitted",
    "revision_requested",
    "resubmitted",
    "final_submitted",
  ].includes(status);

  const nextVersion = (kind: string) =>
    (deliveries ?? [])
      .filter((d) => d.kind === kind)
      .reduce((mx, d) => Math.max(mx, d.version), 0) + 1;

  const uploadFiles = async (files: File[], kind: string): Promise<string[]> => {
    const paths: string[] = [];
    for (const f of files) {
      const path = `projects/${request.id}/deliveries/${kind}-${crypto.randomUUID()}.${fileExt(f.name) || "bin"}`;
      const { error } = await supabase.storage
        .from("listing-files")
        .upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  };

  const transition = async (to: string): Promise<boolean> => {
    const { data, error } = await supabase.rpc("transition_project_status", {
      p_request_id: request.id,
      p_status: to,
    });
    if (error) {
      if (isMissingRpcError(error)) {
        toast.warning(
          "Delivery saved — project status updates activate once the database upgrade is applied",
        );
        return false;
      }
      toast.error(`Delivery saved, but the status could not be updated: ${error.message}`);
      return false;
    }
    if (data === false) {
      toast.error("Delivery saved, but that status change is not allowed");
      return false;
    }
    return true;
  };

  const submitPreview = async () => {
    const url = previewUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) return toast.error("Preview link must start with http");
    if (!url && shots.length === 0 && !previewNotes.trim())
      return toast.error("Add a preview link, screenshots, or notes");
    setBusy("preview");
    try {
      const paths = await uploadFiles(shots, "preview");
      // A fresh delivery after a revision request first moves the project to
      // 'resubmitted'; the transition below then re-enters the review flow.
      if (status === "revision_requested") await transition("resubmitted");
      const { error } = await supabase.from("project_deliveries").insert({
        request_id: request.id,
        submitted_by: userId,
        kind: "preview",
        preview_url: url || null,
        file_paths: paths,
        notes: previewNotes.trim() || null,
        version: nextVersion("preview"),
      });
      if (error) throw error;
      await transition("preview_submitted");
      toast.success("Preview submitted — the client has been notified");
      setPreviewUrl("");
      setPreviewNotes("");
      setShots([]);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit the preview");
    } finally {
      setBusy(null);
    }
  };

  const submitFinal = async () => {
    const url = finalUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) return toast.error("Final link must start with http");
    if (!url && zipFiles.length === 0)
      return toast.error("Add the final website link or upload the ZIP delivery");
    setBusy("final");
    try {
      const paths = await uploadFiles(zipFiles, "final");
      // Same resubmission step as previews when answering a revision request.
      if (status === "revision_requested") await transition("resubmitted");
      const { error } = await supabase.from("project_deliveries").insert({
        request_id: request.id,
        submitted_by: userId,
        kind: "final",
        final_url: url || null,
        file_paths: paths,
        notes: finalNotes.trim() || null,
        version: nextVersion("final"),
      });
      if (error) throw error;
      await transition("final_submitted");
      toast.success("Final delivery submitted — the client has been notified");
      setFinalUrl("");
      setFinalNotes("");
      setZipFiles([]);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit the final delivery");
    } finally {
      setBusy(null);
    }
  };

  const approve = async (d: DeliveryRow) => {
    setBusy(d.id);
    const { error } = await supabase
      .from("project_deliveries")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", d.id);
    if (error) {
      setBusy(null);
      return toast.error(error.message);
    }
    if (d.kind === "final") {
      const { data, error: rpcError } = await supabase.rpc("transition_project_status", {
        p_request_id: request.id,
        p_status: "completed",
      });
      setBusy(null);
      if (rpcError || data === false) {
        return toast.error(
          rpcError && isMissingRpcError(rpcError)
            ? "Delivery approved — completion activates once the database upgrade is applied"
            : (rpcError?.message ?? "Delivery approved, but the project could not be completed"),
        );
      }
      toast.success("Final delivery approved — project completed");
    } else {
      setBusy(null);
      toast.success("Preview approved — the developer can continue to the final delivery");
    }
    onChanged();
  };

  const requestRevision = async (d: DeliveryRow) => {
    if (!revisionNotes.trim()) return toast.error("Describe the changes you need");
    if (revisionLimitReached) {
      return toast.error(
        "Free revision limit reached — message the developer to agree on extra scope",
      );
    }
    setBusy(d.id);
    const { error: revError } = await supabase.from("project_revisions").insert({
      request_id: request.id,
      delivery_id: d.id,
      requested_by: userId,
      notes: revisionNotes.trim(),
    });
    if (revError) {
      setBusy(null);
      return toast.error(revError.message);
    }
    const { error: updError } = await supabase
      .from("project_deliveries")
      .update({ status: "revision_requested" })
      .eq("id", d.id);
    if (updError) {
      setBusy(null);
      return toast.error(updError.message);
    }
    const { data, error: rpcError } = await supabase.rpc("transition_project_status", {
      p_request_id: request.id,
      p_status: "revision_requested",
    });
    setBusy(null);
    if (rpcError || data === false) {
      return toast.error(
        rpcError && isMissingRpcError(rpcError)
          ? "Revision recorded — status updates activate once the database upgrade is applied"
          : (rpcError?.message ?? "Revision recorded, but the status change is not allowed"),
      );
    }
    // Count the round against the agreed free-revision allowance. A failed
    // counter update must not undo the revision itself — warn only.
    const { error: countError } = await supabase
      .from("website_requests")
      .update({ revisions_used: revisionsUsed + 1 })
      .eq("id", request.id);
    if (countError) {
      toast.warning("Revision saved — the revision counter could not be updated");
    }
    toast.success("Revision requested — the developer has been notified");
    setRevisionFor(null);
    setRevisionNotes("");
    onChanged();
  };

  const pickValidated = (
    list: FileList | null,
    validate: (f: File) => string | null,
    current: File[],
    apply: (v: File[]) => void,
    max: number,
  ) => {
    if (!list) return;
    const next = [...current];
    for (const f of Array.from(list)) {
      const err = validate(f);
      if (err) {
        toast.error(err);
        continue;
      }
      if (next.length >= max) {
        toast.error(`Up to ${max} files`);
        break;
      }
      next.push(f);
    }
    apply(next);
  };

  const finalDelivery = (deliveries ?? []).find(
    (d) => d.kind === "final" && d.status === "approved",
  );

  return (
    <Section title="Previews & delivery">
      {status === "completed" && (
        <div className="rounded-xl border border-lume/40 bg-lume/5 p-4 space-y-1.5">
          <div className="flex items-center gap-2 font-medium">
            <Check className="size-4 text-lume" /> Project completed
          </div>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Final version</dt>
              <dd>{finalDelivery ? `v${finalDelivery.version}` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Delivered on</dt>
              <dd>{finalDelivery ? postedDate(finalDelivery.created_at) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Agreed amount</dt>
              <dd>
                {formatMoney(
                  Number(request.agreed_amount ?? request.budget),
                  request.agreed_currency ?? request.currency,
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Approval recorded</dt>
              <dd>
                {finalDelivery?.approved_at
                  ? postedDate(finalDelivery.approved_at)
                  : postedDate(request.updated_at)}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {request.taken_by && (
        <p className="text-xs text-muted-foreground">
          Revisions: {revisionsUsed} of {revisionLimit} used
          {revisionLimitReached && " — free revision limit reached"}
        </p>
      )}

      {deliveries === null ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing submitted yet. Previews and the final delivery will appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {deliveries.map((d) => {
            const revs = revisions.filter((r) => r.delivery_id === d.id);
            const link = d.kind === "preview" ? d.preview_url : d.final_url;
            return (
              <li key={d.id} className="rounded-xl border border-border/60 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-lume/15 text-lume">
                      {d.kind === "preview" ? "Preview" : "Final delivery"} · v{d.version}
                    </span>
                    <StatusBadge status={d.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {profileName(profiles[d.submitted_by])} · {dateTime(d.created_at)}
                  </span>
                </div>
                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-lume underline break-all"
                  >
                    <Eye className="size-4 shrink-0" /> {link}
                  </a>
                )}
                {d.notes && <p className="text-sm whitespace-pre-wrap">{d.notes}</p>}
                {(d.file_paths ?? []).length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {(d.file_paths ?? []).map((p) => {
                      const url = signedFiles[p];
                      if (!url) return null;
                      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(p);
                      const name = p.split("/").pop() ?? "file";
                      return isImage ? (
                        <a
                          key={p}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-28 aspect-video rounded-lg overflow-hidden border border-border/60"
                        >
                          <img src={url} alt="Screenshot" className="w-full h-full object-cover" />
                        </a>
                      ) : (
                        <a
                          key={p}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs hover:border-lume/60"
                        >
                          {fileExt(p) === "zip" ? (
                            <FileArchive className="size-3.5" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                          {name}
                        </a>
                      );
                    })}
                  </div>
                )}
                {revs.length > 0 && (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    {revs.map((r) => (
                      <div key={r.id} className="text-sm">
                        <span className="text-orange-400 text-xs uppercase tracking-wider">
                          Revision requested
                        </span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {dateTime(r.created_at)}
                        </span>
                        <p className="whitespace-pre-wrap mt-0.5">{r.notes}</p>
                      </div>
                    ))}
                  </div>
                )}
                {(isRequester || isAdmin) && d.status === "submitted" && (
                  <div className="border-t border-border/60 pt-3 space-y-3">
                    {revisionFor === d.id ? (
                      revisionLimitReached ? (
                        <>
                          <p className="text-sm text-orange-400">
                            Free revision limit reached — message the developer to agree on extra
                            scope.
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setRevisionFor(null)}>
                              Back
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <Textarea
                            value={revisionNotes}
                            onChange={(e) => setRevisionNotes(e.target.value)}
                            placeholder="Explain exactly what should change…"
                            rows={3}
                            maxLength={2000}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => requestRevision(d)}
                              disabled={busy !== null}
                            >
                              {busy === d.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                "Send revision request"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRevisionFor(null)}
                              disabled={busy !== null}
                            >
                              Back
                            </Button>
                          </div>
                        </>
                      )
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" onClick={() => approve(d)} disabled={busy !== null}>
                          {busy === d.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <>
                              <Check className="size-3.5 mr-1" />
                              {d.kind === "final"
                                ? "Approve & complete project"
                                : "Approve preview"}
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRevisionFor(d.id);
                            setRevisionNotes("");
                          }}
                          disabled={busy !== null}
                        >
                          <RotateCcw className="size-3.5 mr-1" /> Request revision
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {d.status === "approved" && (
                  <p className="text-xs text-lume flex items-center gap-1">
                    <Check className="size-3.5" /> Approved
                    {d.approved_at ? ` · ${dateTime(d.approved_at)}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canSubmit && workActive && status !== "completed" && (
        <div className="grid md:grid-cols-2 gap-4 border-t border-border/60 pt-4">
          <div className="rounded-xl border border-border/60 p-4 space-y-3">
            <h3 className="text-sm font-medium">Submit a preview</h3>
            <Input
              placeholder="Preview link (https://…)"
              value={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.value)}
              inputMode="url"
            />
            <Textarea
              placeholder="Notes for the client — what to look at, what changed…"
              value={previewNotes}
              onChange={(e) => setPreviewNotes(e.target.value)}
              rows={3}
              maxLength={2000}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => shotsRef.current?.click()}
              >
                <Upload className="size-3.5 mr-1" /> Screenshots
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Images up to {DELIVERY_PHOTO_MAX_MB}MB, max 6
              </span>
              <input
                ref={shotsRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  pickValidated(e.target.files, validatePhotoFile, shots, setShots, 6);
                  e.target.value = "";
                }}
              />
            </div>
            {shots.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {shots.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs"
                  >
                    {f.name}
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setShots(shots.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Button onClick={submitPreview} disabled={busy !== null} className="w-full">
              {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : "Submit preview"}
            </Button>
          </div>

          <div className="rounded-xl border border-border/60 p-4 space-y-3">
            <h3 className="text-sm font-medium">Submit final delivery</h3>
            <Input
              placeholder="Final website link (https://…)"
              value={finalUrl}
              onChange={(e) => setFinalUrl(e.target.value)}
              inputMode="url"
            />
            <Textarea
              placeholder="Delivery notes — setup instructions, logins handed over, documentation…"
              value={finalNotes}
              onChange={(e) => setFinalNotes(e.target.value)}
              rows={3}
              maxLength={2000}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => zipRef.current?.click()}
              >
                <FileArchive className="size-3.5 mr-1" /> ZIP files
              </Button>
              <span className="text-[11px] text-muted-foreground">
                ZIP archives up to {FINAL_MAX_MB}MB — stored privately, only the client can download
                them
              </span>
              <input
                ref={zipRef}
                type="file"
                accept=".zip,application/zip"
                multiple
                hidden
                onChange={(e) => {
                  pickValidated(e.target.files, validateFinalFile, zipFiles, setZipFiles, 4);
                  e.target.value = "";
                }}
              />
            </div>
            {zipFiles.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {zipFiles.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs"
                  >
                    <FileArchive className="size-3" /> {f.name}
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setZipFiles(zipFiles.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Button onClick={submitFinal} disabled={busy !== null} className="w-full">
              {busy === "final" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Submit final delivery"
              )}
            </Button>
          </div>
        </div>
      )}
      {canSubmit && !workActive && status !== "completed" && (
        <p className="text-xs text-muted-foreground border-t border-border/60 pt-3">
          Delivery forms appear once the project is in progress.
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Payment (Wave F — Stripe project payments, 85/15 split)             */
/* ------------------------------------------------------------------ */

const PAYMENT_CHIPS: Record<string, { label: string; classes: string }> = {
  unpaid: { label: "Unpaid", classes: "bg-amber-500/15 text-amber-400" },
  pending: { label: "Payment pending", classes: "bg-sky-500/15 text-sky-400" },
  paid: { label: "Paid", classes: "bg-emerald-500/15 text-emerald-400" },
  failed: { label: "Payment failed", classes: "bg-red-500/15 text-red-400" },
  refunded: { label: "Refunded", classes: "bg-muted text-muted-foreground" },
  partially_refunded: {
    label: "Partially refunded",
    classes: "bg-orange-500/15 text-orange-400",
  },
  disputed: { label: "Disputed", classes: "bg-red-500/15 text-red-400" },
};

function PaymentSection({
  info,
  loadFailed,
  isRequester,
  isDeveloper,
  projectStatus,
  paying,
  onPay,
  onRefresh,
}: {
  info: ProjectPaymentInfo | null;
  loadFailed: boolean;
  isRequester: boolean;
  isDeveloper: boolean;
  projectStatus: string;
  paying: boolean;
  onPay: () => void;
  onRefresh: () => void;
}) {
  if (loadFailed) {
    return (
      <Section title="Payment">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            Payment details couldn't be loaded right now.
          </p>
          <Button size="sm" variant="secondary" onClick={onRefresh}>
            <RotateCcw className="size-3.5 mr-1" /> Retry
          </Button>
        </div>
      </Section>
    );
  }
  if (info?.unavailable) {
    return (
      <Section title="Payment">
        <UnavailableNote what="Project payments" />
      </Section>
    );
  }
  if (!info) {
    return (
      <Section title="Payment">
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </Section>
    );
  }

  const payment = info.payment;
  const breakdown = info.breakdown;
  const chip = PAYMENT_CHIPS[payment?.status ?? "unpaid"] ?? PAYMENT_CHIPS.unpaid;
  const paid = payment?.status === "paid";
  const canPay =
    isRequester &&
    info.stripeConfigured &&
    !paid &&
    (projectStatus === "awaiting_payment" || projectStatus === "awaiting_agreement");

  return (
    <Section
      title="Payment"
      right={
        <span className="flex items-center gap-1.5">
          {info.testMode && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40">
              Test mode
            </span>
          )}
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${chip.classes}`}
          >
            {chip.label}
          </span>
        </span>
      }
    >
      {info.testMode && (
        <p className="text-xs text-amber-400/90 -mt-1">
          Stripe is running in test mode — cards are simulated by Stripe and no real money moves.
        </p>
      )}

      {!breakdown ? (
        <p className="text-sm text-muted-foreground">
          The project amount hasn't been agreed yet. Once the client and developer agree the amount,
          the payment breakdown — the developer's 85% share and NORDEVA's 15% fee — will appear
          here.
        </p>
      ) : (
        <>
          <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Agreed amount
              </dt>
              <dd className="text-base font-semibold mt-0.5">
                {formatMoney(breakdown.amount, breakdown.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Developer receives (85%)
              </dt>
              <dd className="text-base font-semibold mt-0.5">
                {formatMoney(breakdown.developerAmount, breakdown.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                NORDEVA fee (15%)
              </dt>
              <dd className="text-base font-semibold mt-0.5">
                {formatMoney(breakdown.platformFee, breakdown.currency)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            The split is calculated on the agreed amount — for example, on a $550 project the
            developer receives $467.50 and the NORDEVA fee is $82.50.
          </p>
        </>
      )}

      {paid && payment && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 space-y-1">
          <p className="text-sm text-emerald-300 inline-flex items-center gap-1.5">
            <ShieldCheck className="size-4" /> Payment confirmed via Stripe ·{" "}
            {dateTime(payment.updated_at)}
          </p>
          {breakdown && projectStatus === "completed" && (
            <p className="text-xs text-emerald-200/80">
              The developer's share of {formatMoney(breakdown.developerAmount, breakdown.currency)}{" "}
              is recorded for payout. NORDEVA processes project payouts through the admin payout
              queue — it is not transferred automatically.
            </p>
          )}
        </div>
      )}

      {payment?.status === "pending" && (
        <p className="text-sm text-muted-foreground">
          A Stripe checkout is in progress. This card updates automatically once Stripe confirms the
          payment — work starts as soon as it does.
        </p>
      )}
      {payment?.status === "failed" && (
        <p className="text-sm text-muted-foreground">
          The last checkout attempt didn't complete.{" "}
          {isRequester ? "You can start a new payment below." : ""}
        </p>
      )}
      {payment?.status === "refunded" && (
        <p className="text-sm text-muted-foreground">
          This payment was refunded in full via Stripe, and the project is marked as refunded.
        </p>
      )}
      {payment?.status === "partially_refunded" && (
        <p className="text-sm text-muted-foreground">
          Part of this payment was refunded via Stripe. NORDEVA support can help reconcile the
          remaining amount.
        </p>
      )}
      {payment?.status === "disputed" && (
        <p className="text-sm text-muted-foreground">
          A payment dispute was raised with the payer's bank via Stripe. NORDEVA support has the
          full payment record.
        </p>
      )}

      {!paid && !info.stripeConfigured && (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          Online card payment isn't switched on yet — Stripe still needs to be configured on the
          server, so no payment can be taken here right now. Once it's configured, the client will
          be able to pay the agreed amount on this page and work will start automatically when
          Stripe confirms.
        </div>
      )}

      {canPay && breakdown && (
        <div className="space-y-2">
          <Button onClick={onPay} disabled={paying} className="w-full sm:w-auto">
            {paying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <CreditCard className="size-4 mr-1.5" /> Pay{" "}
                {formatMoney(breakdown.amount, breakdown.currency)} securely with Stripe
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            You'll be redirected to Stripe's hosted checkout — NORDEVA never sees or stores your
            card details. Work starts automatically once Stripe confirms the payment.
          </p>
        </div>
      )}

      {!paid && isDeveloper && projectStatus === "awaiting_payment" && info.stripeConfigured && (
        <p className="text-sm text-muted-foreground">
          Waiting for the client to complete the payment — you can start work as soon as Stripe
          confirms it.
        </p>
      )}
      {!payment &&
        !paid &&
        projectStatus !== "awaiting_payment" &&
        projectStatus !== "awaiting_agreement" &&
        projectStatus !== "developer_selected" &&
        breakdown && (
          <p className="text-xs text-muted-foreground">
            No online payment is recorded for this project.
          </p>
        )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ProjectWorkspacePage() {
  const { id } = Route.useParams();
  const [userId, setUserId] = useState<string | null>(null);
  const [authKnown, setAuthKnown] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [signedPhotos, setSignedPhotos] = useState<Record<string, string>>({});
  const [signedFiles, setSignedFiles] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<ProposalRow | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[] | null>(null);
  const [milestonesUnavailable, setMilestonesUnavailable] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [deliveriesUnavailable, setDeliveriesUnavailable] = useState(false);
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [chatUnavailable, setChatUnavailable] = useState(false);
  const [projectPayment, setProjectPayment] = useState<ProjectPaymentInfo | null>(null);
  const [paymentLoadFailed, setPaymentLoadFailed] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dispute, setDispute] = useState<DisputeRow | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);

  const fetchProjectPayment = useServerFn(getProjectPayment);
  const startProjectCheckout = useServerFn(createProjectCheckout);

  const chatVisibleRef = useRef(false);
  const chatSectionRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<MessageRow[] | null>(null);
  const defaultsAttemptedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const isRequester = !!request && !!userId && request.requester_id === userId;
  const isDeveloper = !!request && !!userId && request.taken_by === userId;
  const status = request ? effectiveStatus(request) : "open";

  /* ------------------------------ loaders ------------------------------ */

  const signFilePaths = async (paths: string[]) => {
    const missing = Array.from(new Set(paths)).filter((p) => p && !signedFiles[p]);
    if (missing.length === 0) return;
    const { data } = await supabase.storage
      .from("listing-files")
      .createSignedUrls(missing, 60 * 60);
    if (!data) return;
    setSignedFiles((prev) => {
      const next = { ...prev };
      data.forEach((d, i) => {
        if (d.signedUrl) next[missing[i]] = d.signedUrl;
      });
      return next;
    });
  };

  const markRead = async (msgs: MessageRow[]) => {
    const uid = userIdRef.current;
    if (!uid) return;
    const ids = msgs.filter((m) => m.sender_id !== uid && !m.read_at).map((m) => m.id);
    if (ids.length === 0) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("project_messages")
      .update({ read_at: nowIso })
      .in("id", ids);
    if (!error) {
      setMessages((prev) =>
        prev ? prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: nowIso } : m)) : prev,
      );
    }
  };

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("project_messages")
      .select("*")
      .eq("request_id", id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) {
      if (isMissingTableError(error, "project_messages")) {
        setChatUnavailable(true);
        setMessages([]);
      }
      return;
    }
    const rows = (data ?? []) as MessageRow[];
    setMessages(rows);
    await signFilePaths(rows.flatMap((m) => m.attachment_paths ?? []));
    if (chatVisibleRef.current) void markRead(rows);
  };

  const loadMilestones = async (participant: boolean) => {
    const { data, error } = await supabase
      .from("project_milestones")
      .select("*")
      .eq("request_id", id)
      .order("sort_order", { ascending: true });
    if (error) {
      if (isMissingTableError(error, "project_milestones")) {
        setMilestonesUnavailable(true);
        setMilestones([]);
      } else {
        setMilestones([]);
      }
      return;
    }
    let rows = (data ?? []) as MilestoneRow[];
    if (rows.length === 0 && participant && !defaultsAttemptedRef.current) {
      defaultsAttemptedRef.current = true;
      const { error: insError } = await supabase
        .from("project_milestones")
        .insert(
          DEFAULT_MILESTONES.map((title, i) => ({ request_id: id, title, sort_order: i + 1 })),
        );
      if (!insError) {
        const again = await supabase
          .from("project_milestones")
          .select("*")
          .eq("request_id", id)
          .order("sort_order", { ascending: true });
        rows = (again.data ?? []) as MilestoneRow[];
      }
    }
    setMilestones(rows);
  };

  const loadDeliveries = async () => {
    const [{ data, error }, { data: revData }] = await Promise.all([
      supabase
        .from("project_deliveries")
        .select("*")
        .eq("request_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("project_revisions")
        .select("*")
        .eq("request_id", id)
        .order("created_at", { ascending: false }),
    ]);
    if (error) {
      if (isMissingTableError(error, "project_deliveries")) {
        setDeliveriesUnavailable(true);
        setDeliveries([]);
      } else {
        setDeliveries([]);
      }
      return;
    }
    const rows = (data ?? []) as DeliveryRow[];
    setDeliveries(rows);
    setRevisions((revData ?? []) as RevisionRow[]);
    await signFilePaths(rows.flatMap((d) => d.file_paths ?? []));
  };

  const loadRequest = async (): Promise<RequestRow | null> => {
    const { data, error } = await supabase
      .from("website_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      setNotFound(true);
      setRequest(null);
      return null;
    }
    const row = data as RequestRow;
    setRequest(row);
    setNotFound(false);
    return row;
  };

  const loadProfiles = async (row: RequestRow) => {
    const ids = Array.from(new Set([row.requester_id, row.taken_by].filter(Boolean) as string[]));
    if (ids.length === 0) return;
    const { data } = await supabase
      .from("public_profiles")
      .select("id, username, display_name, avatar_url, verified, headline, bio, skills")
      .in("id", ids);
    if (data) {
      setProfiles(Object.fromEntries((data as ProfileLite[]).map((p) => [p.id, p])));
    }
    const photos = row.photos ?? [];
    if (photos.length > 0) {
      const { data: signed } = await supabase.storage
        .from("request-photos")
        .createSignedUrls(photos, 60 * 60);
      if (signed) {
        const map: Record<string, string> = {};
        signed.forEach((d, i) => {
          if (d.signedUrl) map[photos[i]] = d.signedUrl;
        });
        setSignedPhotos(map);
      }
    }
    if (row.selected_proposal_id) {
      const { data: prop } = await supabase
        .from("project_proposals")
        .select("*")
        .eq("id", row.selected_proposal_id)
        .maybeSingle();
      if (prop) setProposal(prop as ProposalRow);
    }
  };

  /* Latest open dispute record (Wave M4) — failure-isolated: before the
     ecosystem migration is live the table doesn't exist yet, and a disputed
     project must still render without the banner. */
  const loadDispute = async () => {
    const { data, error } = await supabase
      .from("project_disputes")
      .select("*")
      .eq("project_id", id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setDispute(null);
      return;
    }
    setDispute((data as DisputeRow | null) ?? null);
  };

  const loadProjectPayment = async () => {
    try {
      const info = await fetchProjectPayment({ data: { request_id: id } });
      setProjectPayment(info);
      setPaymentLoadFailed(false);
    } catch {
      setPaymentLoadFailed(true);
    }
  };

  const refreshWorkspace = async () => {
    const row = await loadRequest();
    await Promise.all([loadMilestones(true), loadDeliveries(), loadMessages(), loadDispute()]);
    void loadProjectPayment();
    if (row) void loadProfiles(row);
  };

  /* ------------------------------ init ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      userIdRef.current = uid;
      setUserId(uid);
      setAuthKnown(true);
      if (!uid || cancelled) return;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "admin")
        .maybeSingle();
      if (cancelled) return;
      setIsAdmin(!!roles);
      const row = await loadRequest();
      if (!row || cancelled) return;
      await loadProfiles(row);
      const participant = row.requester_id === uid || row.taken_by === uid || !!roles;
      await Promise.all([
        loadMilestones(participant),
        loadDeliveries(),
        loadMessages(),
        loadDispute(),
      ]);
      void loadProjectPayment();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Chat polling (~10s) + read receipts when the chat is on screen. */
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    void loadMessages();
  };
  useEffect(() => {
    if (!request || chatUnavailable) return;
    const t = setInterval(() => pollRef.current(), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, chatUnavailable]);

  useEffect(() => {
    const el = chatSectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      chatVisibleRef.current = true;
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        chatVisibleRef.current = visible;
        if (visible && messagesRef.current) void markRead(messagesRef.current);
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [request?.id, chatUnavailable]);

  /* While a checkout is pending, poll the payment state so the card (and
     the project status) refresh once the Stripe webhook lands. */
  const paymentPollRef = useRef<() => void>(() => {});
  paymentPollRef.current = () => {
    void loadProjectPayment();
    void loadRequest();
  };
  useEffect(() => {
    if (projectPayment?.payment?.status !== "pending") return;
    const t = setInterval(() => paymentPollRef.current(), 6000);
    return () => clearInterval(t);
  }, [projectPayment?.payment?.status, projectPayment?.payment?.id]);

  /* ------------------------------ actions ------------------------------ */

  const payForProject = async () => {
    setPaying(true);
    try {
      // Paying straight from the agreement stage first moves the project to
      // awaiting_payment, so the webhook's paid -> in_progress step applies.
      if (status === "awaiting_agreement") {
        const { error } = await supabase.rpc("transition_project_status", {
          p_request_id: id,
          p_status: "awaiting_payment",
        });
        if (error) {
          toast.error(
            isMissingRpcError(error)
              ? "Status changes activate once the database upgrade is applied to the live project"
              : error.message,
          );
          return;
        }
        await loadRequest();
      }
      const res = await startProjectCheckout({ data: { request_id: id } });
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      toast.error("Stripe did not return a checkout link");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the payment");
    } finally {
      setPaying(false);
    }
  };

  const transition = async (to: string, successMsg: string) => {
    setBusy(to);
    setConfirming(null);
    const { data, error } = await supabase.rpc("transition_project_status", {
      p_request_id: id,
      p_status: to,
    });
    setBusy(null);
    if (error) {
      if (isMissingRpcError(error)) {
        return toast.error(
          "Status changes activate once the database upgrade is applied to the live project",
        );
      }
      return toast.error(error.message);
    }
    if (data === false) return toast.error("That status change is not allowed");
    toast.success(successMsg);
    const row = await loadRequest();
    if (row) void loadProfiles(row);
  };

  /* Raise a dispute (spec §10 Option B): the reason is recorded first and
     the status only changes once the record exists, so from the user's
     perspective the pair is atomic — no bare status flip without a reason. */
  const raiseDispute = async () => {
    const reason = disputeReason.trim();
    if (reason.length < 10 || !userId) return;
    setDisputeBusy(true);
    const { error } = await supabase.from("project_disputes").insert({
      project_id: id,
      raised_by: userId,
      reason,
    });
    if (error) {
      setDisputeBusy(false);
      return toast.error(
        isMissingTableError(error, "project_disputes")
          ? "Disputes activate once the database upgrade is applied to the live project"
          : error.message,
      );
    }
    setDisputeOpen(false);
    setDisputeReason("");
    setDisputeBusy(false);
    await transition("disputed", "Dispute raised — NORDEVA support has been flagged");
    void loadDispute();
  };

  /* ------------------------------ render ------------------------------ */

  if (!authKnown) {
    return (
      <div className="min-h-screen">
        <TopNav />
        <div className="flex justify-center py-24">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen">
        <TopNav />
        <div className="mx-auto max-w-xl px-4 py-20 text-center space-y-4">
          <h1 className="text-2xl font-semibold">Sign in to open this workspace</h1>
          <p className="text-sm text-muted-foreground">
            Project workspaces are private — only the client, the assigned developer and NORDEVA
            admins can see them.
          </p>
          <Button asChild>
            <Link to="/auth" search={{ next: `/projects/${id}` }}>
              Sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !request) {
    return (
      <div className="min-h-screen">
        <TopNav />
        <div className="mx-auto max-w-xl px-4 py-20 text-center space-y-4">
          <CircleAlert className="size-8 mx-auto text-muted-foreground" />
          <h1 className="text-2xl font-semibold">This project isn't available to you</h1>
          <p className="text-sm text-muted-foreground">
            The project doesn't exist, or you're not a participant in it. Workspaces are visible
            only to the client who posted the project, the developer assigned to it, and NORDEVA
            admins.
          </p>
          <Button asChild variant="secondary">
            <Link to="/requests">
              <ArrowLeft className="size-4 mr-1" /> Back to projects
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const client = profiles[request.requester_id];
  const developer = request.taken_by ? profiles[request.taken_by] : undefined;
  const badge = packageBadgeLabel(request);
  const pkg = packageMeta(request.package_type) ?? packageMeta(effectivePackage(request) ?? "");
  const terminal = ["completed", "cancelled", "refunded", "payment_released"].includes(status);
  const disputable = [
    "developer_selected",
    "awaiting_agreement",
    "awaiting_payment",
    "in_progress",
    "preview_submitted",
    "revision_requested",
    "resubmitted",
    "final_submitted",
  ].includes(status);
  const unreadCount = (messages ?? []).filter((m) => m.sender_id !== userId && !m.read_at).length;

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
  if (proposal?.estimated_days != null)
    facts.push({ label: "Agreed timeline", value: `~${proposal.estimated_days} days` });

  const photos = (request.photos ?? []).filter((p) => signedPhotos[p]);
  const busyBtn = (key: string) =>
    busy === key ? <Loader2 className="size-3.5 animate-spin" /> : null;

  const confirmButton = (
    key: string,
    label: string,
    onConfirm: () => void,
    icon?: React.ReactNode,
    spinnerKey?: string,
  ) =>
    confirming === key ? (
      <span className="inline-flex gap-1.5">
        <Button size="sm" variant="destructive" onClick={onConfirm} disabled={busy !== null}>
          {busyBtn(spinnerKey ?? key)} Confirm {label.toLowerCase()}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
          Keep project
        </Button>
      </span>
    ) : (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(key)} disabled={busy !== null}>
        {icon} {label}
      </Button>
    );

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-5">
        <div>
          <Link
            to="/requests"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> All projects
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap mt-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {request.title}
                </h1>
                {badge && (
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      pkg?.id === "max_advanced"
                        ? "bg-gold/15 text-gold"
                        : pkg?.id === "simple"
                          ? "bg-muted text-muted-foreground"
                          : "bg-lume/15 text-lume"
                    }`}
                  >
                    {badge}
                  </span>
                )}
                <StatusBadge status={status} />
                {unreadCount > 0 && (
                  <a
                    href="#workspace-chat"
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400"
                  >
                    {unreadCount} unread message{unreadCount === 1 ? "" : "s"}
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Posted {postedDate(request.created_at)} ·{" "}
                {isRequester
                  ? "You are the client"
                  : isDeveloper
                    ? "You are the assigned developer"
                    : isAdmin
                      ? "Admin view"
                      : ""}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-display text-xl font-semibold">
                {formatMoney(
                  Number(request.agreed_amount ?? request.budget),
                  request.agreed_currency ?? request.currency,
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {request.agreed_amount != null ? "agreed amount" : "client budget"}
              </div>
              {request.deadline && (
                <div className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
                  <CalendarDays className="size-3.5" /> Deadline {deadlineLabel(request.deadline)}
                </div>
              )}
            </div>
          </div>
          <div className="mt-4">
            <StatusStepper status={status} />
            {[
              "draft",
              "pending_review",
              "cancelled",
              "disputed",
              "refunded",
              "payment_released",
            ].includes(status) && (
              <p className="text-xs text-muted-foreground mt-2">
                Current stage: {PROJECT_STATUSES[status]?.label ?? status}.
                {status === "disputed" &&
                  " NORDEVA support can help resolve disputes — the project history above is preserved."}
              </p>
            )}
          </div>
        </div>

        {/* Status actions */}
        {!terminal && (
          <div className="flex gap-2 flex-wrap items-center rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-[var(--shadow-soft)]">
            <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">
              Actions
            </span>
            {(isDeveloper || isAdmin) &&
              ["developer_selected", "awaiting_agreement", "awaiting_payment"].includes(status) && (
                <Button
                  size="sm"
                  onClick={() => transition("in_progress", "Work started")}
                  disabled={busy !== null}
                >
                  {busyBtn("in_progress")} <Play className="size-3.5 mr-1" /> Start work
                </Button>
              )}
            {(isDeveloper || isAdmin) && status === "revision_requested" && (
              <Button
                size="sm"
                onClick={() => transition("in_progress", "Back to work — revision in progress")}
                disabled={busy !== null}
              >
                {busyBtn("in_progress")} <Play className="size-3.5 mr-1" /> Resume work
              </Button>
            )}
            {(isDeveloper || isAdmin) && status === "preview_submitted" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => transition("in_progress", "Continuing to the final delivery")}
                disabled={busy !== null}
              >
                {busyBtn("in_progress")} Continue working
              </Button>
            )}
            {(isDeveloper || isAdmin) && status === "disputed" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => transition("in_progress", "Project resumed")}
                disabled={busy !== null}
              >
                {busyBtn("in_progress")} Resume project
              </Button>
            )}
            {(isRequester || isAdmin) && status === "developer_selected" && (
              <Button
                size="sm"
                onClick={() => transition("awaiting_agreement", "Moving to agreement")}
                disabled={busy !== null}
              >
                {busyBtn("awaiting_agreement")} Confirm agreement
              </Button>
            )}
            {(isRequester || isAdmin) && status === "awaiting_agreement" && (
              <Button
                size="sm"
                onClick={() => transition("awaiting_payment", "Agreement confirmed")}
                disabled={busy !== null}
              >
                {busyBtn("awaiting_payment")} Agreement done — next: payment
              </Button>
            )}
            {status === "awaiting_payment" && (
              <span className="text-xs text-muted-foreground">
                Payment is handled in the Payment section below — once the client pays securely
                online, work starts automatically.
              </span>
            )}
            {(isRequester || isAdmin) && status === "disputed" && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => transition("completed", "Project marked completed")}
                  disabled={busy !== null}
                >
                  {busyBtn("completed")} Resolve: mark completed
                </Button>
                {confirmButton(
                  "cancel",
                  "Cancel project",
                  () => transition("cancelled", "Project cancelled"),
                  undefined,
                  "cancelled",
                )}
              </>
            )}
            {(isRequester || isAdmin) && status !== "disputed" && (
              <>
                {confirmButton(
                  "cancel",
                  "Cancel project",
                  () => transition("cancelled", "Project cancelled"),
                  <Ban className="size-3.5 mr-1" />,
                  "cancelled",
                )}
              </>
            )}
            {disputable && (isRequester || isDeveloper || isAdmin) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDisputeOpen(true)}
                disabled={busy !== null}
              >
                <Flag className="size-3.5 mr-1" /> Raise a dispute
              </Button>
            )}
          </div>
        )}

        {/* Dispute banner — the recorded reason, visible to both parties */}
        {status === "disputed" && dispute && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-300">
                <Flag className="size-4" /> Dispute raised — under admin review
              </span>
              <span className="text-xs text-muted-foreground">
                {profileName(profiles[dispute.raised_by])} · {dateTime(dispute.created_at)}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{dispute.reason}</p>
            <p className="text-xs text-muted-foreground">
              An admin will review the project history. No payment is released automatically.
            </p>
          </div>
        )}

        {/* Overview */}
        <Section title="Overview">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { label: "Client", profile: client, note: "Project owner" },
              { label: "Developer", profile: developer, note: "Assigned developer" },
            ].map((slot) => (
              <div key={slot.label} className="rounded-xl border border-border/60 p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {slot.label}
                </div>
                {slot.profile ? (
                  <div className="flex items-center gap-3 mt-2">
                    <Avatar profile={slot.profile} size="size-10" />
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-1.5">
                        {profileName(slot.profile)}
                        {slot.profile.verified && <Check className="size-4 text-lume" />}
                      </div>
                      {slot.profile.headline && (
                        <div className="text-xs text-muted-foreground truncate">
                          {slot.profile.headline}
                        </div>
                      )}
                      {slot.profile.username && (
                        <Link
                          to="/creator/$username"
                          params={{ username: slot.profile.username }}
                          className="text-xs text-lume underline"
                        >
                          View public profile
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    {slot.label === "Developer" ? "No developer assigned yet." : slot.note}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Description
            </h3>
            <p className="text-sm whitespace-pre-wrap">{request.description}</p>
          </div>

          {(request.preferred_technologies ?? []).length > 0 && (
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
          )}

          {facts.length > 0 && (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                    {f.label}
                  </dt>
                  <dd className="text-sm mt-0.5 whitespace-pre-wrap">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {proposal && (
            <div className="rounded-xl border border-border/60 p-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                Accepted proposal
              </h3>
              <p className="text-sm whitespace-pre-wrap mt-1.5">{proposal.message}</p>
              {(proposal.portfolio_urls ?? []).length > 0 && (
                <div className="flex gap-x-3 gap-y-1 flex-wrap text-xs mt-2">
                  {(proposal.portfolio_urls ?? []).map((u) => (
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
            </div>
          )}

          {(request.reference_urls ?? []).length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Reference websites
              </h3>
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
                  <img
                    src={signedPhotos[p]}
                    alt="Reference"
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </Section>

        {/* Payment */}
        <PaymentSection
          info={projectPayment}
          loadFailed={paymentLoadFailed}
          isRequester={isRequester}
          isDeveloper={isDeveloper}
          projectStatus={status}
          paying={paying}
          onPay={() => void payForProject()}
          onRefresh={() => void loadProjectPayment()}
        />

        {/* Milestones */}
        <Section title="Milestones">
          <MilestonesSection
            canEdit={isDeveloper || isAdmin}
            rows={milestones}
            unavailable={milestonesUnavailable}
            onChanged={() => loadMilestones(true)}
          />
        </Section>

        {/* Chat */}
        <div ref={chatSectionRef}>
          <ChatSection
            requestId={request.id}
            userId={userId}
            otherProfile={isRequester ? developer : client}
            messages={messages}
            unavailable={chatUnavailable}
            signedFiles={signedFiles}
            onSent={() => void loadMessages()}
          />
        </div>

        {/* Deliveries */}
        <DeliveriesSection
          request={request}
          userId={userId}
          isRequester={isRequester}
          isDeveloper={isDeveloper}
          isAdmin={isAdmin}
          deliveries={deliveries}
          revisions={revisions}
          unavailable={deliveriesUnavailable}
          profiles={profiles}
          signedFiles={signedFiles}
          onChanged={() => void refreshWorkspace()}
        />

        {/* Raise-a-dispute dialog (spec §10 Option B) */}
        <Dialog
          open={disputeOpen}
          onOpenChange={(open) => {
            if (!disputeBusy) setDisputeOpen(open);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Raise a dispute</DialogTitle>
              <DialogDescription>
                Explain what went wrong. The project moves to dispute review and the full history —
                brief, chat, deliveries and revisions — is preserved for the review.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Why are you declining the work? Be specific — this is what the admin reviews…"
                rows={4}
                maxLength={2000}
                autoFocus
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  An admin will review. No payment is released automatically.
                </p>
                <span className="text-xs text-muted-foreground shrink-0">
                  {disputeReason.trim().length}/10 min
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDisputeOpen(false)} disabled={disputeBusy}>
                Keep project
              </Button>
              <Button
                variant="destructive"
                onClick={() => void raiseDispute()}
                disabled={disputeBusy || disputeReason.trim().length < 10}
              >
                {disputeBusy ? <Loader2 className="size-4 animate-spin" /> : "Raise dispute"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
