import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Flag,
  Loader2,
  MessageCircle,
  MoreVertical,
  Send,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { Avatar } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConversationList, ConversationListSkeleton } from "@/components/conversation-list";
import {
  DM_REPORT_REASONS,
  MESSAGE_MAX_LENGTH,
  MessagesUnavailableError,
  blockUser,
  dayLabel,
  fetchBlockState,
  fetchConversation,
  fetchListingContext,
  fetchMessages,
  fetchMessagesSince,
  fetchMyConversations,
  fetchPublicProfile,
  markConversationRead,
  messageTime,
  profileName,
  reportMessage,
  reportUser,
  sendMessage,
  unblockUser,
  type BlockState,
  type ConversationRow,
  type ConversationSummary,
  type MessageRow,
  type PublicProfileLite,
} from "@/lib/messages";

export const Route = createFileRoute("/messages/$conversationId")({
  component: MessageThreadPage,
});

type PageState = "loading" | "signed-out" | "unavailable" | "not-found" | "ready";

interface ReportTarget {
  kind: "user" | "message";
  messageId?: string;
}

const POLL_MS = 9000;

function MessageThreadPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();

  const [state, setState] = useState<PageState>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [other, setOther] = useState<PublicProfileLite | null>(null);
  const [listing, setListing] = useState<{ id: string; title: string } | null>(null);
  const [blocks, setBlocks] = useState<BlockState>({ blockedByMe: false, blockedMe: false });
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportReason, setReportReason] = useState<string>(DM_REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [listQuery, setListQuery] = useState("");
  const [listLoaded, setListLoaded] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialisedRef = useRef(false);
  const prependRef = useRef<{ height: number; top: number } | null>(null);
  const messagesRef = useRef<MessageRow[]>([]);
  messagesRef.current = messages;

  const otherId =
    conversation && userId
      ? conversation.buyer_id === userId
        ? conversation.seller_id
        : conversation.buyer_id
      : null;

  const refreshSummaries = useCallback(async (uid: string) => {
    try {
      const rows = await fetchMyConversations(uid);
      setSummaries(rows);
      setListLoaded(true);
    } catch {
      setListLoaded(true);
    }
  }, []);

  const refreshBlocks = useCallback(async (uid: string, oid: string) => {
    try {
      setBlocks(await fetchBlockState(uid, oid));
    } catch {
      /* block state is best-effort; sending is enforced server-side */
    }
  }, []);

  /* ------------------------------------------------------ initial load */
  useEffect(() => {
    let cancelled = false;
    initialisedRef.current = false;
    setState("loading");
    setMessages([]);

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);
      if (!uid) {
        setState("signed-out");
        return;
      }
      try {
        const conv = await fetchConversation(conversationId);
        if (cancelled) return;
        if (!conv) {
          setState("not-found");
          return;
        }
        setConversation(conv);
        const oid = conv.buyer_id === uid ? conv.seller_id : conv.buyer_id;
        const [profile, page] = await Promise.all([
          fetchPublicProfile(oid),
          fetchMessages(conversationId),
        ]);
        if (cancelled) return;
        setOther(profile);
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setState("ready");
        void refreshBlocks(uid, oid);
        void refreshSummaries(uid);
        if (conv.listing_id) {
          void fetchListingContext(conv.listing_id).then((l) => {
            if (!cancelled) setListing(l);
          });
        }
        void markConversationRead(conversationId, uid).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setState(err instanceof MessagesUnavailableError ? "unavailable" : "not-found");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshBlocks, refreshSummaries]);

  /* ------------------------------------------------- scroll management */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || state !== "ready") return;
    if (prependRef.current) {
      const { height, top } = prependRef.current;
      el.scrollTop = el.scrollHeight - height + top;
      prependRef.current = null;
      return;
    }
    if (!initialisedRef.current && messages.length >= 0) {
      el.scrollTop = el.scrollHeight;
      initialisedRef.current = true;
    }
  }, [messages, state]);

  /* ------------------------------------------------------------ polling */
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = async () => {
    if (!userId || state !== "ready") return;
    const current = messagesRef.current;
    const last = current[current.length - 1];
    try {
      const fresh = last
        ? await fetchMessagesSince(conversationId, last.created_at)
        : (await fetchMessages(conversationId)).messages;
      if (fresh.length === 0) return;
      const known = new Set(current.map((m) => m.id));
      const additions = fresh.filter((m) => !known.has(m.id));
      if (additions.length === 0) return;
      const el = scrollRef.current;
      const nearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 140 : true;
      setMessages((prev) => [...prev, ...additions]);
      if (additions.some((m) => m.sender_id !== userId)) {
        void markConversationRead(conversationId, userId).catch(() => {});
      }
      void refreshSummaries(userId);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (node && nearBottom) node.scrollTop = node.scrollHeight;
      });
    } catch {
      /* polling is best-effort */
    }
  };

  useEffect(() => {
    if (state !== "ready") return;
    const t = setInterval(() => pollRef.current(), POLL_MS);
    return () => clearInterval(t);
  }, [state, conversationId]);

  /* ------------------------------------------------------------- actions */
  const loadEarlier = async () => {
    const first = messages[0];
    if (!first || loadingEarlier) return;
    const el = scrollRef.current;
    if (el) prependRef.current = { height: el.scrollHeight, top: el.scrollTop };
    setLoadingEarlier(true);
    try {
      const page = await fetchMessages(conversationId, first.created_at);
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
    } catch {
      prependRef.current = null;
      toast.error("Could not load earlier messages.");
    } finally {
      setLoadingEarlier(false);
    }
  };

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const sent = await sendMessage(conversationId, userId, text);
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setDraft("");
      void refreshSummaries(userId);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      });
    } catch (err) {
      toast.error(
        err instanceof Error && /blocked/i.test(err.message)
          ? "Messages are blocked between you and this user."
          : "Could not send the message. Please try again.",
      );
      if (userId && otherId) void refreshBlocks(userId, otherId);
    } finally {
      setSending(false);
    }
  };

  const toggleBlock = async () => {
    if (!userId || !otherId) return;
    try {
      if (blocks.blockedByMe) {
        await unblockUser(userId, otherId);
        toast.success("User unblocked");
      } else {
        await blockUser(userId, otherId);
        toast.success("User blocked — they can no longer message you");
      }
      await refreshBlocks(userId, otherId);
    } catch {
      toast.error("Could not update the block. Please try again.");
    }
  };

  const submitReport = async () => {
    if (!userId || !reportTarget || !otherId) return;
    setReportBusy(true);
    try {
      if (reportTarget.kind === "user") {
        await reportUser(userId, otherId, reportReason, reportDetails);
      } else if (reportTarget.messageId) {
        await reportMessage(userId, reportTarget.messageId, reportReason, reportDetails);
      }
      toast.success("Report sent — our team will review it");
      setReportTarget(null);
      setReportDetails("");
      setReportReason(DM_REPORT_REASONS[0]);
    } catch {
      toast.error("Could not send the report. Please try again.");
    } finally {
      setReportBusy(false);
    }
  };

  const nearLimit = draft.length > MESSAGE_MAX_LENGTH - 500;

  /* -------------------------------------------------------------- render */
  const threadBody = (() => {
    if (state === "loading") {
      return (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (state === "signed-out") {
      return (
        <div className="px-4 py-14 text-center">
          <MessageCircle className="mx-auto mb-3 size-8 text-muted-foreground opacity-40" />
          <p className="font-medium">Sign in to read this conversation</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            Messages are private between you and the other person.
          </p>
          <Link
            to="/auth"
            search={{ next: `/messages/${conversationId}` }}
            className="mt-5 inline-block rounded-full lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </div>
      );
    }
    if (state === "unavailable") {
      return (
        <div className="px-4 py-14 text-center">
          <Wrench className="mx-auto mb-3 size-8 text-muted-foreground opacity-40" />
          <p className="font-medium">Messages is being set up</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            Direct messaging is almost ready — please check back soon.
          </p>
          <Link
            to="/messages"
            className="mt-5 inline-block rounded-full border border-border/70 bg-card/60 px-5 py-2.5 text-sm font-semibold"
          >
            Back to messages
          </Link>
        </div>
      );
    }
    if (state === "not-found") {
      return (
        <div className="px-4 py-14 text-center">
          <ShieldAlert className="mx-auto mb-3 size-8 text-muted-foreground opacity-40" />
          <p className="font-medium">This conversation isn't available</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            It may have been removed, or you may not be a participant.
          </p>
          <Link
            to="/messages"
            className="mt-5 inline-block rounded-full border border-border/70 bg-card/60 px-5 py-2.5 text-sm font-semibold"
          >
            Back to messages
          </Link>
        </div>
      );
    }

    /* ready */
    let lastDay = "";
    return (
      <>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/messages" })}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground lg:hidden"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-4" />
          </button>
          {other?.username ? (
            <Link
              to="/creator/$username"
              params={{ username: other.username }}
              className="flex min-w-0 items-center gap-3"
            >
              <Avatar name={profileName(other)} url={other?.avatar_url} size={40} />
              <span className="min-w-0">
                <span className="flex items-center gap-1 truncate text-sm font-semibold">
                  <span className="truncate">{profileName(other)}</span>
                  {other?.verified && <BadgeCheck className="size-4 shrink-0 text-sky-500" />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  @{other.username}
                </span>
              </span>
            </Link>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={profileName(other)} url={other?.avatar_url} size={40} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{profileName(other)}</span>
                <span className="block truncate text-xs text-muted-foreground">NORDEVA member</span>
              </span>
            </div>
          )}

          <div className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  aria-label="Conversation actions"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-2xl">
                {other?.username && (
                  <DropdownMenuItem asChild>
                    <Link to="/creator/$username" params={{ username: other.username }}>
                      View profile
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setReportTarget({ kind: "user" })}>
                  <Flag className="mr-2 size-4" /> Report user
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={toggleBlock}>
                  <Ban className="mr-2 size-4" />
                  {blocks.blockedByMe ? "Unblock user" : "Block user"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {listing && (
          <Link
            to="/listing/$id"
            params={{ id: listing.id }}
            className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            About the listing: <span className="font-medium text-lume">{listing.title}</span>
          </Link>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {hasMore && (
            <div className="mb-4 text-center">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className="rounded-full border border-border/70 px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No messages yet — say hello to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const mine = m.sender_id === userId;
                const day = dayLabel(m.created_at);
                const showDay = day !== lastDay;
                lastDay = day;
                return (
                  <div key={m.id}>
                    {showDay && (
                      <div className="py-2 text-center">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {day}
                        </span>
                      </div>
                    )}
                    <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${
                          mine
                            ? "rounded-br-md border border-lume/25 bg-lume/15"
                            : "rounded-bl-md border border-border/60 bg-muted/50"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                        <div className="mt-1.5 flex items-center justify-end gap-1 text-right text-[10px] text-muted-foreground">
                          <span>
                            {messageTime(m.created_at)}
                            {mine && (m.read_at ? " · Seen" : " · Sent")}
                          </span>
                          {!mine && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="grid size-5 place-items-center rounded-full opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100"
                                  aria-label="Message actions"
                                >
                                  <MoreVertical className="size-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44 rounded-2xl">
                                <DropdownMenuItem
                                  onClick={() =>
                                    setReportTarget({ kind: "message", messageId: m.id })
                                  }
                                >
                                  <Flag className="mr-2 size-4" /> Report message
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Blocked notice / composer */}
        {blocks.blockedByMe ? (
          <div className="border-t border-border/60 px-4 py-3.5 text-center">
            <p className="text-sm text-muted-foreground">
              You blocked this user — they can't message you, and you can't message them.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 rounded-full"
              onClick={toggleBlock}
            >
              Unblock user
            </Button>
          </div>
        ) : blocks.blockedMe ? (
          <div className="border-t border-border/60 px-4 py-3.5 text-center">
            <p className="text-sm text-muted-foreground">You can't message this user.</p>
          </div>
        ) : (
          <form onSubmit={onSend} className="border-t border-border/60 px-4 py-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={`Message ${profileName(other)}…`}
                rows={1}
                aria-label="Message"
                className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl"
              />
              <Button
                type="submit"
                disabled={sending || !draft.trim()}
                className="size-10 shrink-0 rounded-full lume-gradient p-0 text-white hover:opacity-90"
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
            {nearLimit && (
              <p className="mt-1.5 text-right text-[11px] text-muted-foreground">
                {draft.length}/{MESSAGE_MAX_LENGTH}
              </p>
            )}
          </form>
        )}
      </>
    );
  })();

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        <h1 className="mb-5 hidden font-display text-2xl font-semibold sm:text-3xl lg:block">
          Messages
        </h1>

        <div className="flex h-[calc(100dvh-10rem)] min-h-[26rem] overflow-hidden rounded-[1.5rem] border border-border/60 bg-card shadow-[var(--shadow-soft)] lg:h-[calc(100dvh-13rem)]">
          <aside className="hidden w-[22rem] shrink-0 flex-col border-r border-border/60 lg:flex">
            {!listLoaded ? (
              <ConversationListSkeleton />
            ) : userId ? (
              <ConversationList
                summaries={summaries}
                userId={userId}
                activeId={conversationId}
                query={listQuery}
                onQueryChange={setListQuery}
              />
            ) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Sign in to see your conversations.
              </p>
            )}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">{threadBody}</section>
        </div>
      </div>

      {/* Report dialog */}
      <Dialog
        open={reportTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReportTarget(null);
        }}
      >
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reportTarget?.kind === "message" ? "Report message" : "Report user"}
            </DialogTitle>
            <DialogDescription>
              {reportTarget?.kind === "message"
                ? "Tell us what's wrong with this message. Our team will review it."
                : `Tell us what's wrong with your experience with ${profileName(other)}. Our team will review it.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Reason</span>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm focus:border-lume/60 focus:outline-none"
              >
                {DM_REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Details (optional)</span>
              <Textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value.slice(0, 1000))}
                placeholder="Anything else we should know…"
                rows={3}
                className="rounded-xl"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => setReportTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-full lume-gradient text-white hover:opacity-90"
              onClick={submitReport}
              disabled={reportBusy}
            >
              {reportBusy ? <Loader2 className="size-4 animate-spin" /> : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
