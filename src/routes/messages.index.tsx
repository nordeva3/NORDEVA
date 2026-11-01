import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { ConversationList, ConversationListSkeleton } from "@/components/conversation-list";
import {
  MessagesUnavailableError,
  fetchMyConversations,
  type ConversationSummary,
} from "@/lib/messages";

export const Route = createFileRoute("/messages/")({
  component: MessagesIndexPage,
});

type PageState = "loading" | "signed-out" | "unavailable" | "ready";

function MessagesIndexPage() {
  const [state, setState] = useState<PageState>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    const load = async (uid: string, initial: boolean) => {
      try {
        const rows = await fetchMyConversations(uid);
        if (cancelled) return;
        setSummaries(rows);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof MessagesUnavailableError) {
          setState("unavailable");
        } else if (initial) {
          // Transient failure: show an empty-but-ready inbox rather than a
          // hard error; the next refresh tick retries.
          setState("ready");
        }
      }
    };

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setState("signed-out");
        return;
      }
      void load(uid, true);
    });

    const timer = setInterval(() => {
      if (stateRef.current !== "ready") return;
      supabase.auth.getUser().then(({ data }) => {
        if (!cancelled && data.user) void load(data.user.id, false);
      });
    }, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        <h1 className="mb-5 font-display text-2xl font-semibold sm:text-3xl">Messages</h1>

        <div className="flex h-[calc(100dvh-13rem)] min-h-[26rem] overflow-hidden rounded-[1.5rem] border border-border/60 bg-card shadow-[var(--shadow-soft)]">
          <div className="flex min-w-0 flex-1 flex-col lg:max-w-sm lg:flex-none lg:basis-[22rem] lg:border-r lg:border-border/60">
            {state === "loading" && <ConversationListSkeleton />}
            {state === "signed-out" && (
              <div className="px-4 py-14 text-center">
                <MessageCircle className="mx-auto mb-3 size-8 text-muted-foreground opacity-40" />
                <p className="font-medium">Sign in to see your messages</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  Conversations with creators and clients live here once you're signed in.
                </p>
                <Link
                  to="/auth"
                  search={{ next: "/messages" }}
                  className="mt-5 inline-block rounded-full lume-gradient px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Sign in
                </Link>
              </div>
            )}
            {state === "unavailable" && (
              <div className="px-4 py-14 text-center">
                <Wrench className="mx-auto mb-3 size-8 text-muted-foreground opacity-40" />
                <p className="font-medium">Messages is being set up</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  Direct messaging is almost ready. In the meantime you can reach creators through
                  their profiles and project workspaces.
                </p>
                <Link
                  to="/people"
                  className="mt-5 inline-block rounded-full border border-border/70 bg-card/60 px-5 py-2.5 text-sm font-semibold"
                >
                  Browse creators
                </Link>
              </div>
            )}
            {state === "ready" && userId && (
              <ConversationList
                summaries={summaries}
                userId={userId}
                query={query}
                onQueryChange={setQuery}
              />
            )}
          </div>

          <div className="hidden flex-1 flex-col items-center justify-center px-8 text-center lg:flex">
            <MessageCircle className="mb-3 size-10 text-muted-foreground opacity-30" />
            <p className="font-medium">Select a conversation</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Pick a conversation from the list, or message a creator from their profile.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
