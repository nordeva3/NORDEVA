import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { fetchMyStanding } from "./account-standing";

/* ------------------------------------------------------------------ types */

export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export interface PublicProfileLite {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  verified: boolean;
}

export interface ConversationSummary {
  conversation: ConversationRow;
  other: PublicProfileLite | null;
  lastMessage: Pick<MessageRow, "body" | "sender_id" | "created_at"> | null;
  unreadCount: number;
}

export interface BlockState {
  blockedByMe: boolean;
  blockedMe: boolean;
}

/** Raised when the messages tables are not in the database yet. */
export class MessagesUnavailableError extends Error {
  constructor() {
    super("Messages are not available yet");
    this.name = "MessagesUnavailableError";
  }
}

export const MESSAGE_MAX_LENGTH = 4000;

export const DM_REPORT_REASONS = [
  "Spam",
  "Harassment or bullying",
  "Scam or fraud",
  "Inappropriate content",
  "Impersonation",
  "Other",
] as const;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = error.message ?? "";
  return (
    /does not exist/i.test(msg) ||
    /Could not find the table/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

function otherParticipantId(conversation: ConversationRow, userId: string): string {
  return conversation.buyer_id === userId ? conversation.seller_id : conversation.buyer_id;
}

/* ------------------------------------------------------- conversation list */

export async function fetchMyConversations(userId: string): Promise<ConversationSummary[]> {
  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("*")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) {
    if (isMissingTable(error)) throw new MessagesUnavailableError();
    throw new Error(error.message);
  }
  const rows = (conversations ?? []) as ConversationRow[];
  if (rows.length === 0) return [];

  const otherIds = [...new Set(rows.map((c) => otherParticipantId(c, userId)))];
  const conversationIds = rows.map((c) => c.id);

  const [profilesRes, messagesRes] = await Promise.all([
    supabase
      .from("public_profiles")
      .select("id, display_name, username, avatar_url, verified")
      .in("id", otherIds),
    supabase
      .from("messages")
      .select("conversation_id, body, sender_id, created_at, read_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(1500),
  ]);

  const profiles = new Map<string, PublicProfileLite>();
  for (const p of (profilesRes.data ?? []) as PublicProfileLite[]) profiles.set(p.id, p);

  const lastByConversation = new Map<
    string,
    Pick<MessageRow, "body" | "sender_id" | "created_at">
  >();
  const unreadByConversation = new Map<string, number>();
  for (const m of messagesRes.data ?? []) {
    if (!lastByConversation.has(m.conversation_id)) {
      lastByConversation.set(m.conversation_id, {
        body: m.body,
        sender_id: m.sender_id,
        created_at: m.created_at,
      });
    }
    if (m.sender_id !== userId && !m.read_at) {
      unreadByConversation.set(
        m.conversation_id,
        (unreadByConversation.get(m.conversation_id) ?? 0) + 1,
      );
    }
  }

  return rows.map((conversation) => ({
    conversation,
    other: profiles.get(otherParticipantId(conversation, userId)) ?? null,
    lastMessage: lastByConversation.get(conversation.id) ?? null,
    unreadCount: unreadByConversation.get(conversation.id) ?? 0,
  }));
}

/* ------------------------------------------------------------- one thread */

export async function fetchConversation(conversationId: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new MessagesUnavailableError();
    throw new Error(error.message);
  }
  return (data as ConversationRow | null) ?? null;
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfileLite | null> {
  const { data } = await supabase
    .from("public_profiles")
    .select("id, display_name, username, avatar_url, verified")
    .eq("id", userId)
    .maybeSingle();
  return (data as PublicProfileLite | null) ?? null;
}

export async function fetchListingContext(
  listingId: string,
): Promise<{ id: string; title: string } | null> {
  try {
    const { data } = await supabase
      .from("listings")
      .select("id, title")
      .eq("id", listingId)
      .maybeSingle();
    return data ? { id: data.id, title: data.title } : null;
  } catch {
    return null;
  }
}

export interface MessagesPage {
  messages: MessageRow[];
  hasMore: boolean;
}

/** Latest page (or the page before `before`), returned oldest-first. */
export async function fetchMessages(
  conversationId: string,
  before?: string,
): Promise<MessagesPage> {
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(51);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) throw new MessagesUnavailableError();
    throw new Error(error.message);
  }
  const rows = (data ?? []) as MessageRow[];
  const hasMore = rows.length > 50;
  return { messages: rows.slice(0, 50).reverse(), hasMore };
}

/** Messages created after `afterIso`, oldest-first (used by polling). */
export async function fetchMessagesSince(
  conversationId: string,
  afterIso: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .gt("created_at", afterIso)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as MessageRow[];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<MessageRow> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  if (text.length > MESSAGE_MAX_LENGTH)
    throw new Error(`Messages are limited to ${MESSAGE_MAX_LENGTH} characters`);
  // Suspension guard (M5): a suspended account can read but not send. The
  // helper is failure-open, so a standing-check hiccup never blocks chat.
  if ((await fetchMyStanding()).suspended)
    throw new Error("Account suspended — messaging is paused on your account");
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, body: text })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as MessageRow;
}

/** Mark everything the other person sent in this conversation as read. */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .is("read_at", null);
  if (error && !isMissingTable(error)) throw new Error(error.message);
}

/* ------------------------------------------------------- find or create DM */

/**
 * One general (listing-less) conversation per user pair. The pair can be
 * stored in either direction, so both directions are queried; the partial
 * unique index on (LEAST, GREATEST) of the pair keeps concurrent inserts
 * from duplicating — a unique violation is resolved by re-querying.
 * New rows are written initiator-as-buyer, other-as-seller.
 */
export async function findOrCreateConversation(
  userId: string,
  otherUserId: string,
): Promise<string> {
  const existing = await findGeneralConversation(userId, otherUserId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ buyer_id: userId, seller_id: otherUserId, listing_id: null })
    .select("id")
    .single();
  if (!error && data) return data.id;
  if (error && isMissingTable(error)) throw new MessagesUnavailableError();
  if (error && (error.code === "23505" || /duplicate|unique/i.test(error.message))) {
    const raced = await findGeneralConversation(userId, otherUserId);
    if (raced) return raced;
  }
  throw new Error(error?.message ?? "Could not start the conversation");
}

async function findGeneralConversation(
  userId: string,
  otherUserId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .is("listing_id", null)
    .or(
      `and(buyer_id.eq.${userId},seller_id.eq.${otherUserId}),and(buyer_id.eq.${otherUserId},seller_id.eq.${userId})`,
    )
    .limit(1);
  if (error) {
    if (isMissingTable(error)) throw new MessagesUnavailableError();
    throw new Error(error.message);
  }
  return data && data.length > 0 ? data[0].id : null;
}

/* ------------------------------------------------------------ block/report */

export async function fetchBlockState(userId: string, otherUserId: string): Promise<BlockState> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${userId})`,
    );
  if (error) {
    if (isMissingTable(error)) return { blockedByMe: false, blockedMe: false };
    throw new Error(error.message);
  }
  const rows = data ?? [];
  return {
    blockedByMe: rows.some((r) => r.blocker_id === userId),
    blockedMe: rows.some((r) => r.blocker_id === otherUserId),
  };
}

export async function blockUser(userId: string, otherUserId: string): Promise<void> {
  const { error } = await supabase
    .from("user_blocks")
    .insert({ blocker_id: userId, blocked_id: otherUserId });
  if (error && error.code !== "23505" && !/duplicate/i.test(error.message))
    throw new Error(error.message);
}

export async function unblockUser(userId: string, otherUserId: string): Promise<void> {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", otherUserId);
  if (error) throw new Error(error.message);
}

export async function reportUser(
  userId: string,
  reportedUserId: string,
  reason: string,
  details?: string,
): Promise<void> {
  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    reported_user_id: reportedUserId,
    reason,
    details: details?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function reportMessage(
  userId: string,
  messageId: string,
  reason: string,
  details?: string,
): Promise<void> {
  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    message_id: messageId,
    reason,
    details: details?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------- nav badge */

export async function fetchTotalUnread(userId: string): Promise<number> {
  try {
    const { data: conversations, error } = await supabase
      .from("conversations")
      .select("id")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .limit(200);
    if (error || !conversations || conversations.length === 0) return 0;
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in(
        "conversation_id",
        conversations.map((c) => c.id),
      )
      .neq("sender_id", userId)
      .is("read_at", null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------ formatting */

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function messageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function profileName(profile: PublicProfileLite | null): string {
  return profile?.display_name || profile?.username || "NORDEVA member";
}
