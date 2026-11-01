import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/currencies";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const sb = supabase as any;

export const Route = createFileRoute("/refunds")({
  head: () => ({
    meta: [
      { title: "Refunds & disputes — NORDEVA" },
      {
        name: "description",
        content: "Request help with a NORDEVA purchase and track your dispute.",
      },
      { property: "og:title", content: "Refunds & disputes — NORDEVA" },
      {
        property: "og:description",
        content: "Request help with a NORDEVA purchase and track your dispute.",
      },
      { property: "og:type", content: "article" },
    ],
  }),
  component: Refunds,
});

type Order = {
  id: string;
  listing_id: string;
  amount: number;
  currency: string;
  created_at: string;
  status: string;
  listings?: { title: string } | null;
};
type Refund = {
  id: string;
  order_id: string;
  reason: string;
  details: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

const reasons = [
  "Download is missing/corrupted",
  "Product is materially different",
  "Unsafe or malicious file",
  "Ownership/licensing issue",
  "Other",
];

function Refunds() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [reason, setReason] = useState(reasons[0]);
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async (uid: string) => {
    const [{ data: os }, { data: rs }] = await Promise.all([
      sb
        .from("orders")
        .select("id,listing_id,amount,currency,created_at,status,listings:listing_id(title)")
        .eq("buyer_id", uid)
        .order("created_at", { ascending: false }),
      sb
        .from("refund_requests")
        .select("id,order_id,reason,details,status,admin_note,created_at,resolved_at")
        .eq("buyer_id", uid)
        .order("created_at", { ascending: false }),
    ]);
    setOrders((os ?? []) as unknown as Order[]);
    setRefunds((rs ?? []) as Refund[]);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/auth", search: { next: "/refunds" } });
        return;
      }
      setUserId(data.user.id);
      load(data.user.id);
    });
  }, [navigate]);

  const alreadyRequested = new Set(refunds.map((r) => r.order_id));

  const submit = async () => {
    if (!userId || !selected) return;
    if (details.trim().length < 10)
      return toast.error("Please describe the problem in at least 10 characters.");
    setSaving(true);
    const { error } = await sb.from("refund_requests").insert({
      order_id: selected.id,
      buyer_id: userId,
      reason,
      details: details.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error(
        error.message.includes("duplicate")
          ? "A dispute already exists for this order."
          : error.message,
      );
      return;
    }
    toast.success("Dispute submitted. NORDEVA will review it.");
    setSelected(null);
    setDetails("");
    if (userId) load(userId);
  };

  if (!userId) return null;

  return (
    <div className="min-h-screen">
      <TopNav />
      <article className="mx-auto max-w-4xl px-4 py-12">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-6 text-lume" />
            <h1 className="text-3xl font-semibold">Refunds & disputes</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Digital goods are normally non-returnable, but you can open a dispute within 7 days when
            a product is missing, materially misrepresented, unsafe, or has an ownership/licensing
            problem.
          </p>
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-medium mb-3">Your purchases</h2>
          {orders.length === 0 ? (
            <div className="surface p-8 text-sm text-muted-foreground">
              No completed purchases found on this account.
            </div>
          ) : (
            <div className="surface divide-y divide-border/60 overflow-hidden">
              {orders.map((o) => (
                <div key={o.id} className="p-4 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {o.listings?.title ?? "NORDEVA purchase"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString()} · Order {o.id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {formatMoney(Number(o.amount), o.currency)}
                  </div>
                  {alreadyRequested.has(o.id) ? (
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Dispute opened
                    </span>
                  ) : (
                    <Dialog
                      open={selected?.id === o.id}
                      onOpenChange={(open) => setSelected(open ? o : null)}
                    >
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          Open dispute
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Dispute {o.listings?.title ?? "purchase"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <Select value={reason} onValueChange={setReason}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {reasons.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Textarea
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            rows={6}
                            maxLength={2000}
                            placeholder="Tell us what happened, what you expected, and any steps you already tried."
                          />
                          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                            <AlertCircle className="size-4 text-amber-400 shrink-0" />
                            This release records and reviews the dispute. Provider-side money
                            movement remains a separate payment integration step.
                          </div>
                          <Button
                            onClick={submit}
                            disabled={saving}
                            className="w-full lume-gradient text-white"
                          >
                            {saving ? "Submitting…" : "Submit dispute"}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium mb-3">Dispute history</h2>
          {refunds.length === 0 ? (
            <div className="text-sm text-muted-foreground">No disputes yet.</div>
          ) : (
            <div className="space-y-3">
              {refunds.map((r) => (
                <div key={r.id} className="surface p-5">
                  <div className="flex justify-between gap-3">
                    <div>
                      <div className="font-medium">{r.reason}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Order {r.order_id.slice(0, 8)} ·{" "}
                        {new Date(r.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {r.status.replace("_", " ")}
                    </span>
                  </div>
                  {r.details && (
                    <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">
                      {r.details}
                    </p>
                  )}
                  {r.admin_note && (
                    <div className="mt-3 rounded-xl bg-muted/50 p-3 text-xs">
                      <span className="font-medium">NORDEVA:</span> {r.admin_note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-12 border-t border-border/60 pt-8">
          <h2 className="text-lg font-medium">Policy</h2>
          <ul className="mt-3 text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>Contact NORDEVA within 7 days for eligible issues.</li>
            <li>Change of mind after a successful download is not normally refundable.</li>
            <li>
              Unsupported hardware or software limitations disclosed on the listing are not normally
              refundable.
            </li>
            <li>
              Keep evidence such as screenshots, error messages, and a short reproduction
              description.
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
