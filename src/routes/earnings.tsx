import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Wallet, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  createStripeConnectOnboarding,
  syncStripeConnectAccount,
} from "@/lib/production-completion.functions";

export const Route = createFileRoute("/earnings")({
  component: EarningsPage,
});

function EarningsPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [payouts, setPayouts] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [connect, setConnect] = useState<any>(null);
  const startConnect = useServerFn(createStripeConnectOnboarding);
  const syncConnect = useServerFn(syncStripeConnectAccount);

  const load = async (uid: string) => {
    const [{ data: os }, { data: ps }, { data: ms }] = await Promise.all([
      supabase
        .from("orders")
        .select("currency,seller_earnings,created_at,buyer_email")
        .eq("seller_id", uid),
      supabase
        .from("payout_requests")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false }),
      supabase.from("payout_methods").select("*").eq("user_id", uid),
    ]);
    let ca: any = null;
    try {
      const synced = await syncConnect({});
      ca = {
        onboarding_status: synced.payoutsEnabled
          ? "enabled"
          : synced.detailsSubmitted
            ? "restricted"
            : "pending",
        payouts_enabled: synced.payoutsEnabled,
      };
    } catch {
      // No Connect account yet, or Stripe is not configured. The setup button remains available.
    }
    const bal: Record<string, number> = {};
    (os ?? []).forEach((o) => {
      bal[o.currency] = (bal[o.currency] ?? 0) + Number(o.seller_earnings);
    });
    (ps ?? []).forEach((p) => {
      if (p.status !== "rejected") {
        bal[p.currency] = (bal[p.currency] ?? 0) - Number(p.amount);
      }
    });
    setBalances(bal);
    setPayouts(ps ?? []);
    setMethods(ms ?? []);
    setOrders(os ?? []);
    setConnect(ca ?? null);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/auth", search: { next: "/earnings" } });
      } else {
        setUserId(data.user.id);
        load(data.user.id);
      }
    });
  }, [navigate]);

  if (!userId) return null;
  const totalCurrencies = Object.keys(balances);

  return (
    <div className="min-h-screen">
      <TopNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-semibold">Earnings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your available balance across all sales, after the 15% platform fee.
        </p>

        <section className="mt-6 rounded-2xl border border-lume/30 bg-lume/5 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Seller payout account</div>
              <p className="text-xs text-muted-foreground mt-1">
                Connect a supported payout account so NORDEVA can route marketplace earnings without
                storing raw bank credentials.
              </p>
              {connect && (
                <div className="mt-2 text-xs">
                  Status: <span className="font-medium">{connect.onboarding_status}</span> · Payouts{" "}
                  {connect.payouts_enabled ? "enabled" : "not enabled"}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  try {
                    if (connect) {
                      await syncConnect({});
                      toast.success("Payout account synced");
                      await load(userId);
                    } else {
                      const r = await startConnect({ data: { countryCode: "US" } });
                      if (r.url) window.location.assign(r.url);
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Connect setup failed");
                  }
                }}
              >
                {connect ? "Continue verification" : "Set up payouts"}
              </Button>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-3">
          {totalCurrencies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-muted-foreground">
              No earnings yet.
            </div>
          ) : (
            totalCurrencies.map((cur) => (
              <div
                key={cur}
                className="rounded-2xl border border-border/60 bg-card p-6 flex items-center justify-between"
              >
                <div>
                  <div className="text-xs text-muted-foreground">Available in {cur}</div>
                  <div className="text-3xl font-semibold lume-text mt-1">
                    {formatMoney(balances[cur], cur)}
                  </div>
                </div>
                <WithdrawDialog
                  userId={userId}
                  currency={cur}
                  available={balances[cur]}
                  methods={methods}
                  onDone={() => load(userId)}
                />
              </div>
            ))
          )}
        </div>

        <div className="mt-6 rounded-lg border border-lume/30 bg-lume/5 p-4 text-xs text-muted-foreground flex gap-2">
          <Clock className="size-4 text-lume shrink-0 mt-0.5" />
          Payout requests are processed within{" "}
          <span className="text-foreground mx-1">1–2 weeks</span> after you submit them.
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-medium mb-3">Payout history</h2>
          {payouts.length === 0 ? (
            <div className="text-sm text-muted-foreground">No payouts requested yet.</div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/60">
              {payouts.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{formatMoney(Number(p.amount), p.currency)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium mb-3">Recent sales</h2>
          {orders.length === 0 ? (
            <div className="text-sm text-muted-foreground">No sales yet.</div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/60">
              {orders.slice(0, 8).map((o, i) => (
                <div key={i} className="p-3 flex justify-between text-sm">
                  <span className="text-muted-foreground">{o.buyer_email}</span>
                  <span className="lume-text font-medium">
                    +{formatMoney(Number(o.seller_earnings), o.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WithdrawDialog({
  userId,
  currency,
  available,
  methods,
  onDone,
}: {
  userId: string;
  currency: string;
  available: number;
  methods: any[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(available.toFixed(2));
  const [methodType, setMethodType] = useState<"upi" | "bank">("upi");
  const [upi, setUpi] = useState("");
  const [bank, setBank] = useState({ account: "", ifsc: "", name: "", bankName: "" });
  const [existing, setExisting] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0 || amt > available) {
      toast.error("Enter a valid amount");
      return;
    }
    setBusy(true);
    let methodId: string | null = existing || null;
    if (!methodId) {
      const payload: any = { user_id: userId, method_type: methodType };
      if (methodType === "upi") payload.upi_number = upi;
      else {
        payload.bank_account_number = bank.account;
        payload.bank_ifsc = bank.ifsc;
        payload.account_holder_name = bank.name;
        payload.bank_name = bank.bankName;
      }
      const { data: m, error: mErr } = await supabase
        .from("payout_methods")
        .insert(payload)
        .select("id")
        .single();
      if (mErr) {
        setBusy(false);
        toast.error(mErr.message);
        return;
      }
      methodId = m.id;
    }
    const { error } = await supabase.from("payout_requests").insert({
      user_id: userId,
      amount: amt,
      currency,
      method_id: methodId,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Withdrawal requested. You'll receive it in 1–2 weeks.");
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="lume-gradient text-white hover:opacity-90" disabled={available <= 0}>
          <Wallet className="size-4 mr-2" /> Get money
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw {currency}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Amount</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min="0"
              step="0.01"
            />
            <div className="text-xs text-muted-foreground mt-1">
              Available: {formatMoney(available, currency)}
            </div>
          </div>

          {methods.length > 0 && (
            <div>
              <Label>Use saved method</Label>
              <Select value={existing} onValueChange={setExisting}>
                <SelectTrigger>
                  <SelectValue placeholder="Add new below…" />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.method_type === "upi"
                        ? `UPI · ${m.upi_number}`
                        : `Bank · ${m.bank_account_number}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!existing && (
            <>
              <div>
                <Label>Payout method</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setMethodType("upi")}
                    className={`rounded-lg border p-3 text-sm ${
                      methodType === "upi" ? "border-lume bg-lume/10" : "border-border/60"
                    }`}
                  >
                    UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethodType("bank")}
                    className={`rounded-lg border p-3 text-sm ${
                      methodType === "bank" ? "border-lume bg-lume/10" : "border-border/60"
                    }`}
                  >
                    Bank transfer
                  </button>
                </div>
              </div>

              {methodType === "upi" ? (
                <div>
                  <Label>UPI ID / number</Label>
                  <Input
                    value={upi}
                    onChange={(e) => setUpi(e.target.value)}
                    placeholder="name@upi"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Account holder name</Label>
                    <Input
                      value={bank.name}
                      onChange={(e) => setBank({ ...bank, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Bank name</Label>
                    <Input
                      value={bank.bankName}
                      onChange={(e) => setBank({ ...bank, bankName: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Account number</Label>
                      <Input
                        value={bank.account}
                        onChange={(e) => setBank({ ...bank, account: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>IFSC / routing</Label>
                      <Input
                        value={bank.ifsc}
                        onChange={(e) => setBank({ ...bank, ifsc: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <Button
            onClick={submit}
            loading={busy}
            className="w-full lume-gradient text-white hover:opacity-90"
          >
            Request withdrawal
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Funds arrive in 1–2 weeks after review.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
