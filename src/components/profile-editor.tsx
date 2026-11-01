import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import { Briefcase, ExternalLink, Link2, Pencil, Plus, Trash2, UserRound } from "lucide-react";

const UNSET = "__unset";

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "expert", label: "Expert" },
  { value: "professional", label: "Professional" },
] as const;

export const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available for work" },
  { value: "busy", label: "Busy — limited availability" },
  { value: "unavailable", label: "Not available" },
] as const;

type ProfileForm = {
  displayName: string;
  username: string;
  avatarUrl: string;
  coverUrl: string;
  headline: string;
  bio: string;
  skills: string[];
  services: string[];
  languages: string[];
  experienceLevel: string;
  yearsExperience: string;
  availability: string;
  hourlyRate: string;
  websiteUrl: string;
  githubUrl: string;
  twitterUrl: string;
  email: string;
};

const EMPTY_FORM: ProfileForm = {
  displayName: "",
  username: "",
  avatarUrl: "",
  coverUrl: "",
  headline: "",
  bio: "",
  skills: [],
  services: [],
  languages: [],
  experienceLevel: UNSET,
  yearsExperience: "",
  availability: UNSET,
  hourlyRate: "",
  websiteUrl: "",
  githubUrl: "",
  twitterUrl: "",
  email: "",
};

const SKILL_SUGGESTIONS = [
  "React",
  "TypeScript",
  "WordPress",
  "PHP",
  "Node.js",
  "UI Design",
  "SEO",
  "WooCommerce",
  "Next.js",
  "Python",
];

const SERVICE_SUGGESTIONS = [
  "Website development",
  "Landing pages",
  "E-commerce setup",
  "WordPress themes",
  "Plugin development",
  "SEO audit",
  "Speed optimisation",
  "Maintenance & support",
];

const LANGUAGE_SUGGESTIONS = ["English", "Hindi", "Spanish", "French", "German", "Arabic"];

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-28 space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EditorSection({
  icon,
  title,
  blurb,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lume/10 text-lume">
          {icon}
        </span>
        <div>
          <h3 className="font-display text-base font-semibold leading-tight">{title}</h3>
          {blurb && <p className="text-xs text-muted-foreground">{blurb}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ProfileEditor({ userId, onSaved }: { userId: string; onSaved?: () => void }) {
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // False when the database has not received the Wave A/B columns yet:
  // the editor then works with the original fields only, instead of failing.
  const [proFields, setProFields] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const full = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (!active) return;
      if (!full.error && full.data) {
        const p = full.data;
        setProFields(true);
        setForm({
          displayName: p.display_name ?? "",
          username: p.username ?? "",
          avatarUrl: p.avatar_url ?? "",
          coverUrl: p.cover_url ?? "",
          headline: p.headline ?? "",
          bio: p.bio ?? "",
          skills: p.skills ?? [],
          services: p.services ?? [],
          languages: p.languages ?? [],
          experienceLevel: p.experience_level ?? UNSET,
          yearsExperience: p.years_experience != null ? String(p.years_experience) : "",
          availability: p.availability ?? UNSET,
          hourlyRate: p.hourly_rate != null ? String(p.hourly_rate) : "",
          websiteUrl: p.website_url ?? "",
          githubUrl: p.github_url ?? "",
          twitterUrl: p.twitter_url ?? "",
          email: p.email ?? "",
        });
        setLoading(false);
        return;
      }
      // Graceful fallback: load the long-standing columns only.
      const legacy = await supabase
        .from("profiles")
        .select("id,display_name,username,avatar_url,bio,website_url,twitter_url,github_url,email")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      if (legacy.error || !legacy.data) {
        setLoadError("Your profile could not be loaded. Please try again in a moment.");
      } else {
        const p = legacy.data;
        setProFields(false);
        setForm({
          ...EMPTY_FORM,
          displayName: p.display_name ?? "",
          username: p.username ?? "",
          avatarUrl: p.avatar_url ?? "",
          bio: p.bio ?? "",
          websiteUrl: p.website_url ?? "",
          githubUrl: p.github_url ?? "",
          twitterUrl: p.twitter_url ?? "",
          email: p.email ?? "",
        });
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const set = (patch: Partial<ProfileForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaveState(null);
  };

  const save = async () => {
    if (!form.displayName.trim()) {
      toast.error("Display name can't be empty");
      return;
    }
    const years = form.yearsExperience.trim() === "" ? null : Number(form.yearsExperience);
    if (years != null && (!Number.isFinite(years) || years < 0 || years > 80)) {
      toast.error("Years of experience must be between 0 and 80");
      return;
    }
    const rate = form.hourlyRate.trim() === "" ? null : Number(form.hourlyRate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) {
      toast.error("Hourly rate must be a positive amount");
      return;
    }
    setBusy(true);
    setSaveState(null);
    const legacyPayload = {
      display_name: form.displayName.trim(),
      username: form.username.trim() || null,
      avatar_url: form.avatarUrl.trim() || null,
      bio: form.bio.trim() || null,
      website_url: form.websiteUrl.trim() || null,
      github_url: form.githubUrl.trim() || null,
      twitter_url: form.twitterUrl.trim() || null,
    };
    const payload = proFields
      ? {
          ...legacyPayload,
          cover_url: form.coverUrl.trim() || null,
          headline: form.headline.trim() || null,
          skills: form.skills,
          services: form.services,
          languages: form.languages,
          experience_level: form.experienceLevel === UNSET ? null : form.experienceLevel,
          years_experience: years,
          availability: form.availability === UNSET ? null : form.availability,
          hourly_rate: rate,
        }
      : legacyPayload;
    const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
    setBusy(false);
    if (error) {
      setSaveState({ ok: false, text: `Could not save: ${error.message}` });
      toast.error(error.message);
      return;
    }
    setSaveState({ ok: true, text: "Profile saved — your public page is up to date." });
    toast.success("Profile saved");
    onSaved?.();
  };

  if (loading) return null;
  if (loadError) {
    return (
      <section className="surface mt-12 p-5 text-sm text-muted-foreground" role="alert">
        {loadError}
      </section>
    );
  }

  return (
    <div className="mt-12 space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <UserRound className="size-5 text-lume" /> Your profile
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is what buyers and clients see on your public NORDEVA page. Only your completion
          score stays private.
        </p>
        {!proFields && (
          <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Professional fields (headline, skills, portfolio…) will unlock once the latest NORDEVA
            database update is applied. Your basic details can still be edited and saved.
          </p>
        )}
      </div>

      <EditorSection
        icon={<UserRound className="size-4.5" />}
        title="Basic info"
        blurb="Your name, photo and the essentials people see first."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="pe-basics" label="Display name *">
            <Input
              value={form.displayName}
              onChange={(e) => set({ displayName: e.target.value })}
              placeholder="Your name or studio name"
            />
          </Field>
          <Field label="Username" hint="Used in your public profile URL: /creator/username">
            <Input
              value={form.username}
              onChange={(e) => set({ username: e.target.value })}
              placeholder="your-username"
            />
          </Field>
          <Field label="Contact email" hint="From your account — shown only to you here.">
            <Input value={form.email} disabled placeholder="—" />
          </Field>
          <Field id="pe-photo" label="Profile photo URL">
            <div className="flex items-center gap-3">
              {form.avatarUrl ? (
                <img
                  src={form.avatarUrl}
                  alt=""
                  className="size-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="size-10 shrink-0 rounded-full bg-muted" />
              )}
              <Input
                value={form.avatarUrl}
                onChange={(e) => set({ avatarUrl: e.target.value })}
                placeholder="https://…"
              />
            </div>
          </Field>
          <Field label="Cover image URL" hint="Wide banner shown at the top of your page.">
            <Input
              value={form.coverUrl}
              onChange={(e) => set({ coverUrl: e.target.value })}
              placeholder="https://…"
              disabled={!proFields}
            />
          </Field>
        </div>
      </EditorSection>

      <EditorSection
        icon={<Briefcase className="size-4.5" />}
        title="Professional"
        blurb="The details clients and buyers use to judge your expertise."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="pe-headline"
            label="Professional headline"
            hint="One line that sells your expertise."
          >
            <Input
              value={form.headline}
              onChange={(e) => set({ headline: e.target.value })}
              placeholder="WordPress developer for small businesses"
              disabled={!proFields}
            />
          </Field>
          <div id="pe-bio" className="scroll-mt-28 space-y-1.5 sm:col-span-2">
            <Label>Biography</Label>
            <Textarea
              value={form.bio}
              onChange={(e) => set({ bio: e.target.value })}
              placeholder="Tell clients who you are, what you build, and why they can trust you…"
              className="min-h-28"
            />
          </div>
          <div id="pe-skills" className="scroll-mt-28 sm:col-span-2">
            <TagInput
              value={form.skills}
              onChange={(skills) => set({ skills })}
              suggestions={SKILL_SUGGESTIONS}
              label="Skills"
              description="Press Enter or comma to add a skill. Three or more complete this section."
              placeholder="Add a skill…"
              maxTags={20}
              disabled={!proFields}
            />
          </div>
          <div id="pe-services" className="scroll-mt-28 sm:col-span-2">
            <TagInput
              value={form.services}
              onChange={(services) => set({ services })}
              suggestions={SERVICE_SUGGESTIONS}
              label="Services offered"
              description="What clients can hire you for. Press Enter or comma to add a service — these appear on your public page and in creator search."
              placeholder="Add a service…"
              maxTags={20}
              disabled={!proFields}
            />
          </div>
          <div id="pe-languages" className="scroll-mt-28 sm:col-span-2">
            <TagInput
              value={form.languages}
              onChange={(languages) => set({ languages })}
              suggestions={LANGUAGE_SUGGESTIONS}
              label="Languages"
              placeholder="Add a language…"
              maxTags={10}
              disabled={!proFields}
            />
          </div>
          <Field id="pe-experience" label="Experience level">
            <Select
              value={form.experienceLevel}
              onValueChange={(v) => set({ experienceLevel: v })}
              disabled={!proFields}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {EXPERIENCE_LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Years of experience">
            <Input
              type="number"
              min={0}
              max={80}
              value={form.yearsExperience}
              onChange={(e) => set({ yearsExperience: e.target.value })}
              placeholder="e.g. 5"
              disabled={!proFields}
            />
          </Field>
          <Field id="pe-availability" label="Availability">
            <Select
              value={form.availability}
              onValueChange={(v) => set({ availability: v })}
              disabled={!proFields}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {AVAILABILITY_OPTIONS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Hourly rate (USD)" hint="Optional — shown on your public page.">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.hourlyRate}
              onChange={(e) => set({ hourlyRate: e.target.value })}
              placeholder="e.g. 40"
              disabled={!proFields}
            />
          </Field>
        </div>
      </EditorSection>

      <PortfolioManager userId={userId} disabled={!proFields} onChanged={onSaved} />

      <EditorSection
        icon={<Link2 className="size-4.5" />}
        title="Links"
        blurb="Where people can find you and your work elsewhere."
      >
        <div id="pe-links" className="grid scroll-mt-28 gap-5 sm:grid-cols-3">
          <Field label="Website">
            <Input
              value={form.websiteUrl}
              onChange={(e) => set({ websiteUrl: e.target.value })}
              placeholder="https://yoursite.com"
            />
          </Field>
          <Field label="GitHub">
            <Input
              value={form.githubUrl}
              onChange={(e) => set({ githubUrl: e.target.value })}
              placeholder="https://github.com/you"
            />
          </Field>
          <Field label="X / Twitter">
            <Input
              value={form.twitterUrl}
              onChange={(e) => set({ twitterUrl: e.target.value })}
              placeholder="https://x.com/you"
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
          <Button onClick={save} loading={busy}>
            Save profile
          </Button>
          {saveState && (
            <span
              role="status"
              className={`text-sm ${saveState.ok ? "text-emerald-500" : "text-destructive"}`}
            >
              {saveState.text}
            </span>
          )}
        </div>
      </EditorSection>
    </div>
  );
}

type PortfolioItem = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  image_url: string | null;
  technologies: string[];
  sort_order: number;
};

type PortfolioDraft = {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  technologies: string[];
};

const EMPTY_DRAFT: PortfolioDraft = {
  title: "",
  description: "",
  url: "",
  imageUrl: "",
  technologies: [],
};

function PortfolioManager({
  userId,
  disabled,
  onChanged,
}: {
  userId: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState<PortfolioDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("profile_portfolio")
      .select("id,title,description,url,image_url,technologies,sort_order")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setUnavailable(true);
      setItems([]);
      return;
    }
    setItems((data ?? []) as PortfolioItem[]);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  };

  const submit = async () => {
    if (!draft.title.trim()) return toast.error("Give the project a title");
    setBusy(true);
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      url: draft.url.trim() || null,
      image_url: draft.imageUrl.trim() || null,
      technologies: draft.technologies,
    };
    const { error } = editingId
      ? await supabase.from("profile_portfolio").update(payload).eq("id", editingId)
      : await supabase
          .from("profile_portfolio")
          .insert({ ...payload, user_id: userId, sort_order: items.length });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Portfolio project updated" : "Portfolio project added");
    resetDraft();
    await load();
    onChanged?.();
  };

  const remove = async (item: PortfolioItem) => {
    if (!window.confirm(`Remove “${item.title}” from your portfolio?`)) return;
    const { error } = await supabase.from("profile_portfolio").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success("Portfolio project removed");
    if (editingId === item.id) resetDraft();
    await load();
    onChanged?.();
  };

  return (
    <section id="pe-portfolio" className="surface scroll-mt-28 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Briefcase className="size-5 text-lume" />
        <h3 className="font-medium">Portfolio</h3>
      </div>
      {unavailable || disabled ? (
        <p className="text-sm text-muted-foreground">
          Your portfolio manager will be available once the latest NORDEVA database update is
          applied.
        </p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="mb-4 text-sm text-muted-foreground">
              No portfolio projects yet. Add your best work — one project already completes this
              part of your profile.
            </p>
          ) : (
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-border/60 bg-background/40 p-3"
                >
                  <div className="flex items-start gap-3">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt=""
                        className="h-14 w-20 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <Briefcase className="size-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.title}</div>
                      {item.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      {item.technologies.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.technologies.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs hover:bg-muted"
                      >
                        <ExternalLink className="size-3" /> Visit
                      </a>
                    )}
                    <button
                      onClick={() => {
                        setEditingId(item.id);
                        setDraft({
                          title: item.title,
                          description: item.description ?? "",
                          url: item.url ?? "",
                          imageUrl: item.image_url ?? "",
                          technologies: item.technologies,
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      <Pencil className="size-3" /> Edit
                    </button>
                    <button
                      onClick={() => void remove(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="text-sm font-medium">
              {editingId ? "Edit portfolio project" : "Add a portfolio project"}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Project title *"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <Input
                placeholder="Project URL (https://…)"
                value={draft.url}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              />
              <Input
                placeholder="Image URL (https://…)"
                value={draft.imageUrl}
                onChange={(e) => setDraft((d) => ({ ...d, imageUrl: e.target.value }))}
              />
              <Input
                placeholder="Short description"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>
            <TagInput
              value={draft.technologies}
              onChange={(technologies) => setDraft((d) => ({ ...d, technologies }))}
              suggestions={SKILL_SUGGESTIONS}
              placeholder="Technologies used…"
              maxTags={10}
            />
            <div className="flex gap-2">
              <Button onClick={submit} disabled={busy} size="sm">
                <Plus className="mr-1 size-4" />
                {editingId ? "Save changes" : "Add project"}
              </Button>
              {editingId && (
                <Button onClick={resetDraft} disabled={busy} size="sm" variant="outline">
                  Cancel editing
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
