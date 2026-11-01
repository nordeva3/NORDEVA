import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TagInputProps = {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  maxTags?: number;
  maxLength?: number;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/^#+/, "").slice(0, 48);
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add a tag…",
  maxTags = 12,
  maxLength = 48,
  label,
  description,
  disabled,
  className,
}: TagInputProps) {
  const [input, setInput] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const normalizedSuggestions = React.useMemo(() => {
    const seen = new Set(value.map((tag) => tag.toLowerCase()));
    const query = input.trim().toLowerCase();
    return suggestions
      .map(normalizeTag)
      .filter(Boolean)
      .filter(
        (tag, index, all) => all.findIndex((x) => x.toLowerCase() === tag.toLowerCase()) === index,
      )
      .filter((tag) => !seen.has(tag.toLowerCase()))
      .filter((tag) => !query || tag.toLowerCase().includes(query))
      .slice(0, 8);
  }, [input, suggestions, value]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const addTag = React.useCallback(
    (raw: string) => {
      if (value.length >= maxTags) return;
      const tag = normalizeTag(raw).slice(0, maxLength);
      if (!tag) return;
      if (value.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        setInput("");
        return;
      }
      onChange([...value, tag]);
      setInput("");
      setActiveIndex(-1);
      setOpen(true);
    },
    [maxLength, maxTags, onChange, value],
  );

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (!open || normalizedSuggestions.length === 0) return;
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % normalizedSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      if (!open || normalizedSuggestions.length === 0) return;
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? normalizedSuggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (activeIndex >= 0 && normalizedSuggestions[activeIndex])
        addTag(normalizedSuggestions[activeIndex]);
      else addTag(input);
      return;
    }
    if (event.key === "Backspace" && !input && value.length) {
      removeTag(value.length - 1);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {label && <div className="mb-1.5 text-sm font-medium">{label}</div>}
      {description && <p className="mb-2 text-xs text-muted-foreground">{description}</p>}
      <div
        className={cn(
          "flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 transition focus-within:border-lume/60 focus-within:ring-1 focus-within:ring-ring",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                removeTag(index);
              }}
              className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          disabled={disabled || value.length >= maxTags}
          maxLength={maxLength}
          role="combobox"
          aria-label={label ?? "Tags"}
          aria-autocomplete="list"
          aria-expanded={open && normalizedSuggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const next = event.target.value;
            if (next.includes(",")) {
              const candidates = next.split(",").map(normalizeTag).filter(Boolean);
              const merged = [...value, ...candidates]
                .filter(
                  (tag, index, all) =>
                    all.findIndex((x) => x.toLowerCase() === tag.toLowerCase()) === index,
                )
                .slice(0, maxTags);
              onChange(merged);
              setInput("");
              setActiveIndex(-1);
              setOpen(true);
            } else {
              setInput(next);
              setActiveIndex(-1);
              setOpen(true);
            }
          }}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "Add another tag…" : placeholder}
          className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
        />
      </div>

      {open && normalizedSuggestions.length > 0 && !disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          {normalizedSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addTag(suggestion)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                activeIndex === index
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <span>{suggestion}</span>
              {activeIndex === index && <Check className="size-4" />}
            </button>
          ))}
          <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Enter to add · ↑↓ to choose · Backspace to remove
          </div>
        </div>
      )}
    </div>
  );
}
