import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { ArrowUpRight, Bell } from "lucide-react";

export const Route = createFileRoute("/notifications")({
  component: NotifPage,
});

function NotifPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        navigate({ to: "/auth", search: { next: "/notifications" } });
        return;
      }
      setUserId(data.user.id);
      const { data: n } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", data.user.id)
        .order("created_at", { ascending: false });
      setItems(n ?? []);
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", data.user.id)
        .eq("read", false);
    });
  }, [navigate]);

  if (!userId) return null;

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-semibold mb-8">Notifications</h1>
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center text-muted-foreground">
            <Bell className="size-8 mx-auto mb-3 opacity-40" />
            You're all caught up.
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/60">
            {items.map((n) => {
              const content = (
                <>
                  <div className="font-medium flex items-center gap-2">
                    <span className="min-w-0">{n.title}</span>
                    {n.href && <ArrowUpRight className="size-4 shrink-0 text-lume" />}
                  </div>
                  {n.body && <div className="text-sm text-muted-foreground mt-1">{n.body}</div>}
                  <div className="text-[11px] text-muted-foreground mt-2">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </>
              );
              return n.href ? (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => navigate({ to: n.href as never })}
                  className="block w-full p-4 text-left transition-colors hover:bg-muted/40"
                >
                  {content}
                </button>
              ) : (
                <div key={n.id} className="p-4">
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
