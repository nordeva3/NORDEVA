import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { getPrivateDelivery } from "@/lib/delivery.functions";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Renders the seller's buyer-only content. Decryption happens server-side and
 * only for the listing's seller or a verified buyer — nothing is ever shipped
 * to the browser for anyone else.
 */
export function PrivateDeliveryPanel({ listingId }: { listingId: string }) {
  const fetchDelivery = useServerFn(getPrivateDelivery);
  const [state, setState] = useState<
    | { s: "loading" }
    | { s: "locked"; message: string }
    | {
        s: "ready";
        role: "seller" | "buyer";
        content: string;
        files: Array<{ name: string; size: number; url: string }>;
      }
  >({ s: "loading" });

  useEffect(() => {
    let alive = true;
    fetchDelivery({ data: { listing_id: listingId } })
      .then((res) => {
        if (!alive) return;
        setState({ s: "ready", role: res.role, content: res.content, files: res.files });
      })
      .catch((err) => {
        if (!alive) return;
        setState({
          s: "locked",
          message: err instanceof Error ? err.message : "This content is locked",
        });
      });
    return () => {
      alive = false;
    };
  }, [listingId, fetchDelivery]);

  if (state.s === "loading") return <div className="skeleton h-24 w-full" />;

  if (state.s === "locked") {
    return (
      <div className="rounded-2xl border border-border/70 bg-muted/40 p-5 text-center">
        <Lock className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  const empty = !state.content.trim() && state.files.length === 0;

  return (
    <div className="rounded-2xl border border-lume/30 bg-lume/[0.06] p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4 text-lume" />
        Private delivery
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-lume/30 px-2 py-0.5 text-[10px] text-lume">
          <ShieldCheck className="size-3" />{" "}
          {state.role === "seller" ? "Seller preview" : "Unlocked"}
        </span>
      </div>

      {empty ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The creator hasn't added private delivery content for this product.
        </p>
      ) : (
        <>
          {state.content.trim() && (
            <div className="mt-4 whitespace-pre-wrap break-words rounded-2xl border border-border/60 bg-background/60 p-4 text-sm leading-relaxed">
              {state.content}
            </div>
          )}
          {state.files.length > 0 && (
            <ul className="mt-4 space-y-2">
              {state.files.map((f) => (
                <li key={f.url}>
                  <a
                    href={f.url}
                    className="focus-ring flex items-center gap-3 rounded-2xl border border-border/60 bg-background/50 px-4 py-3 text-sm transition-colors hover:border-lume/50"
                  >
                    <FileDown className="size-4 text-lume" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatBytes(f.size)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[11px] text-muted-foreground">
            Stored encrypted at rest. Links expire after 10 minutes.
          </p>
        </>
      )}
    </div>
  );
}
