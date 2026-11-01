import { Link } from "@tanstack/react-router";
import { BadgeCheck, MessageCircle, Search } from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { profileName, relativeTime, type ConversationSummary } from "@/lib/messages";

export function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/60">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationList({
  summaries,
  userId,
  activeId,
  query,
  onQueryChange,
}: {
  summaries: ConversationSummary[];
  userId: string;
  activeId?: string;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? summaries.filter((s) => {
        const name = (s.other?.display_name ?? "").toLowerCase();
        const username = (s.other?.username ?? "").toLowerCase();
        return name.includes(q) || username.includes(q);
      })
    : summaries;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/60 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="h-10 w-full rounded-full border border-border/60 bg-muted/60 pl-9 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-lume/60 focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <MessageCircle className="mx-auto mb-3 size-7 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">
              {q ? "No conversations match your search." : "No conversations yet."}
            </p>
            {!q && (
              <Link
                to="/people"
                className="mt-4 inline-block rounded-full lume-gradient px-4 py-2 text-sm font-semibold text-white"
              >
                Find a creator
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map(({ conversation, other, lastMessage, unreadCount }) => {
              const mine = lastMessage?.sender_id === userId;
              const active = conversation.id === activeId;
              return (
                <Link
                  key={conversation.id}
                  to="/messages/$conversationId"
                  params={{ conversationId: conversation.id }}
                  className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${
                    active ? "bg-accent/50" : "hover:bg-accent/30"
                  }`}
                >
                  <span className="relative shrink-0">
                    <Avatar name={profileName(other)} url={other?.avatar_url} size={44} />
                    {unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full lume-gradient px-1 text-[10px] font-semibold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                        <span className="truncate">{profileName(other)}</span>
                        {other?.verified && (
                          <BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
                        )}
                      </span>
                      {lastMessage && (
                        <span
                          className={`shrink-0 text-[11px] ${
                            unreadCount > 0 ? "font-semibold text-lume" : "text-muted-foreground"
                          }`}
                        >
                          {relativeTime(lastMessage.created_at)}
                        </span>
                      )}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-[13px] ${
                        unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {lastMessage
                        ? `${mine ? "You: " : ""}${lastMessage.body}`
                        : "No messages yet — say hello"}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
