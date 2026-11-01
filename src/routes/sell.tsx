import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/top-nav";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MARKETPLACE_CURRENCY } from "@/lib/currencies";
import { fetchMyStanding } from "@/lib/account-standing";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_TYPES,
  PLATFORMS,
  LICENSE_TYPES,
  PRICING_MODELS,
  TAG_SUGGESTIONS,
  scoreProductStudio,
  splitLines,
} from "@/lib/product-studio";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileArchive,
  FileImage,
  FileText,
  Globe2,
  ImagePlus,
  Layers3,
  Loader2,
  PackagePlus,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { TagInput } from "@/components/tag-input";

const MAX_PRODUCT_FILE_MB = 200;
const MAX_COVER_MB = 8;
const MAX_MEDIA_MB = 25;
const MAX_EXTRA_FILES = 20;
const MAX_TOTAL_UPLOAD_MB = 500;
const STEPS = ["Basics", "Media", "Files", "Pricing", "Technical", "Legal", "Review"] as const;

type Kind = "software" | "website";
type FileEntry = { file: File; kind: string };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PRODUCT_FILE_EXTENSIONS = new Set([
  "zip",
  "rar",
  "7z",
  "pdf",
  "doc",
  "docx",
  "apk",
  "aab",
  "dmg",
  "pkg",
  "exe",
  "msi",
  "iso",
]);

function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop() || "";
}

function validateSafeFileName(name: string) {
  if (!name.trim() || name.length > 180) return "File name must be between 1 and 180 characters.";
  if (
    [...name].some((ch) => {
      const c = ch.charCodeAt(0);
      return c <= 0x1f || c === 0x7f;
    }) ||
    name.includes("/") ||
    name.includes("\\")
  )
    return "File name contains unsupported characters.";
  return "File name contains unsupported characters.";
  return null;
}

function validateImageFile(file: File, maxMb: number, label: string) {
  const safeName = validateSafeFileName(file.name);
  if (safeName) return safeName;
  if (file.size <= 0) return `${label} cannot be empty.`;
  if (!IMAGE_TYPES.has(file.type)) return `${label} must be JPG, PNG, WebP or GIF.`;
  if (file.size > maxMb * 1024 * 1024) return `${label} must be ${maxMb} MB or smaller.`;
  return null;
}

function validateProductFile(file: File, maxMb: number) {
  const safeName = validateSafeFileName(file.name);
  if (safeName) return safeName;
  if (file.size <= 0) return "Product files cannot be empty.";
  if (file.size > maxMb * 1024 * 1024) return `Product files must be ${maxMb} MB or smaller.`;
  const ext = fileExtension(file.name);
  if (!PRODUCT_FILE_EXTENSIONS.has(ext))
    return `Unsupported delivery file type: .${ext || "unknown"}. Use ZIP, RAR, 7Z, PDF, APK/AAB, DMG/PKG, EXE/MSI or ISO.`;
  return null;
}

export const Route = createFileRoute("/sell")({
  head: () => ({
    meta: [
      { title: "Product Studio — NORDEVA" },
      { name: "description", content: "Create a complete digital product listing for NORDEVA." },
    ],
  }),
  component: SellPage,
});

function SellPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Category options come from the admin-managed categories table when it
  // is available; the built-in list remains as the fallback.
  const [dbCategories, setDbCategories] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [step, setStep] = useState<(typeof STEPS)[number]>("Basics");
  const [saving, setSaving] = useState(false);
  const [inlineMode, setInlineMode] = useState<"signin" | "signup">("signup");
  const [inlineEmail, setInlineEmail] = useState("");
  const [inlinePassword, setInlinePassword] = useState("");
  const [inlineName, setInlineName] = useState("");
  const [inlineLoading, setInlineLoading] = useState(false);

  const [form, setForm] = useState({
    title: "",
    shortDescription: "",
    description: "",
    category: "",
    subcategory: "",
    tags: "",
    targetAudience: "",
    price: "",
    currency: "USD",
    demoUrl: "",
    videoUrl: "",
    docsUrl: "",
    supportUrl: "",
    requirements: "",
    version: "1.0.0",
    releaseDate: new Date().toISOString().slice(0, 10),
    lastUpdated: new Date().toISOString().slice(0, 10),
    pricingModel: "one_time",
    trialDays: "0",
    minimumPrice: "",
    payWhatYouWant: false,
    licenseType: "standard",
    licenseSeats: "1",
    activationLimit: "",
    licenseDurationDays: "",
    taxCategory: "Digital Software",
    seoTitle: "",
    seoDescription: "",
    seoKeywords: "",
    changelog: "",
    aiUsed: false,
    aiDetails: "",
    rightsConfirmed: false,
    assetsConfirmed: false,
    legalConfirmed: false,
  });
  const [platforms, setPlatforms] = useState<string[]>(["Web"]);
  const [languages, setLanguages] = useState("");
  const [techStack, setTechStack] = useState("");
  const [fileFormats, setFileFormats] = useState("");
  const [features, setFeatures] = useState("");
  const [included, setIncluded] = useState("");
  const [faqs, setFaqs] = useState([{ question: "", answer: "" }]);
  const [variants, setVariants] = useState([
    { name: "", price: "", currency: "USD", description: "" },
  ]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [extraFiles, setExtraFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserId(session?.user?.id ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("name")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (active && !error && data && data.length > 0) setDbCategories(data.map((c) => c.name));
      } catch {
        /* keep the built-in fallback list */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const categoryOptions = dbCategories.length > 0 ? dbCategories : PRODUCT_CATEGORIES;

  const update = (key: keyof typeof form, value: string | boolean) =>
    setForm((p) => ({ ...p, [key]: value }));
  const togglePlatform = (platform: string) =>
    setPlatforms((p) =>
      p.includes(platform) ? p.filter((x) => x !== platform) : [...p, platform],
    );
  const tags = useMemo(() => splitLines(form.tags), [form.tags]);
  const setTags = (next: string[]) => update("tags", next.join(", "));
  const featureList = useMemo(() => splitLines(features), [features]);
  const includedList = useMemo(() => splitLines(included), [included]);
  const quality = useMemo(
    () =>
      scoreProductStudio({
        title: form.title,
        description: form.description,
        category: form.category,
        cover: !!coverFile,
        screenshots: galleryFiles.length,
        demo: form.demoUrl,
        docs: form.docsUrl,
        requirements: form.requirements,
        tags,
        features: featureList,
        files: Number(Boolean(productFile)) + extraFiles.length,
        variantCount: variants.filter((v) => v.name.trim()).length,
        rights: form.rightsConfirmed,
        assets: form.assetsConfirmed,
        legal: form.legalConfirmed,
        seoTitle: form.seoTitle,
        seoDescription: form.seoDescription,
      }),
    [
      form,
      coverFile,
      galleryFiles.length,
      productFile,
      extraFiles.length,
      variants,
      tags,
      featureList,
    ],
  );

  const inlineAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inlineLoading) return;
    setInlineLoading(true);
    try {
      if (inlineMode === "signup") {
        if (inlinePassword.length < 8) throw new Error("Password must be at least 8 characters.");
        const { data, error } = await supabase.auth.signUp({
          email: inlineEmail,
          password: inlinePassword,
          options: {
            emailRedirectTo: window.location.origin + "/sell",
            data: { display_name: inlineName || inlineEmail.split("@")[0] },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Account created. Confirm your email, then return to Product Studio.");
          return;
        }
        setUserId(data.user?.id ?? null);
        toast.success("You're in. Continue your product listing.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: inlineEmail,
          password: inlinePassword,
        });
        if (error) throw error;
        setUserId(data.user?.id ?? null);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setInlineLoading(false);
    }
  };

  const addGallery = (files: FileList | null) => {
    if (!files) return;
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const problem = validateImageFile(file, MAX_MEDIA_MB, "Screenshot");
      if (problem) toast.error(problem);
      else accepted.push(file);
    }
    setGalleryFiles((p) => [...p, ...accepted].slice(0, 12));
  };
  const addExtra = (files: FileList | null) => {
    if (!files) return;
    const next: FileEntry[] = [];
    for (const file of Array.from(files)) {
      const problem = validateProductFile(file, MAX_PRODUCT_FILE_MB);
      if (problem) toast.error(`${file.name}: ${problem}`);
      else next.push({ file, kind: "bonus" });
    }
    setExtraFiles((p) => [...p, ...next].slice(0, MAX_EXTRA_FILES));
  };
  const setCover = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const problem = validateImageFile(file, MAX_COVER_MB, "Cover image");
    if (problem) {
      toast.error(problem);
      return;
    }
    setCoverFile(file);
  };
  const setMainProduct = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const problem = validateProductFile(file, MAX_PRODUCT_FILE_MB);
    if (problem) {
      toast.error(problem);
      return;
    }
    setProductFile(file);
  };
  const validate = () => {
    if (!kind) return "Choose a product type.";
    if (!form.title.trim()) return "Add a product title.";
    if (form.description.trim().length < 40) return "Description should be at least 40 characters.";
    if (!form.category) return "Choose a category.";
    if (tags.length < 3) return "Add at least 3 searchable tags.";
    if (!coverFile) return "Add a cover image.";
    if (!galleryFiles.length) return "Add at least 1 screenshot/preview image.";
    if (!productFile) return "Add the main product file.";
    const totalUploadBytes =
      productFile.size +
      extraFiles.reduce((sum, entry) => sum + entry.file.size, 0) +
      galleryFiles.reduce((sum, file) => sum + file.size, 0) +
      (coverFile?.size ?? 0);
    if (totalUploadBytes > MAX_TOTAL_UPLOAD_MB * 1024 * 1024)
      return `All uploaded files together must be ${MAX_TOTAL_UPLOAD_MB} MB or smaller.`;
    if (!form.version.trim()) return "Add a product version.";
    if (!platforms.length) return "Select at least one supported platform.";
    if (!form.docsUrl.trim() || !/^https?:\/\//i.test(form.docsUrl.trim()))
      return "Add a valid documentation URL.";
    if (form.pricingModel !== "free" && Number(form.price) <= 0 && !form.payWhatYouWant)
      return "Enter a valid price.";
    if (Number(form.price || 0) < 0 || Number(form.minimumPrice || 0) < 0)
      return "Price values cannot be negative.";
    if (Number(form.minimumPrice || 0) > Number(form.price || 0) && !form.payWhatYouWant)
      return "Minimum price cannot exceed the base price.";
    const namedVariants = variants.filter((v) => v.name.trim());
    if (namedVariants.some((v) => Number(v.price) <= 0))
      return "Every product tier must have a price greater than zero.";
    if (
      form.currency !== MARKETPLACE_CURRENCY ||
      namedVariants.some((v) => v.currency !== MARKETPLACE_CURRENCY)
    )
      return "All prices must use USD.";
    if (namedVariants.some((v) => !v.description.trim()))
      return "Every product tier needs a short description.";
    if (form.releaseDate && form.lastUpdated && form.lastUpdated < form.releaseDate)
      return "Last updated date cannot be before the release date.";
    if (form.demoUrl.trim() && !/^https?:\/\//i.test(form.demoUrl.trim()))
      return "Demo URL must start with http:// or https://.";
    if (form.videoUrl.trim() && !/^https?:\/\//i.test(form.videoUrl.trim()))
      return "Video URL must start with http:// or https://.";
    if (form.supportUrl.trim() && !/^https?:\/\//i.test(form.supportUrl.trim()))
      return "Support URL must start with http:// or https://.";
    if (!form.rightsConfirmed || !form.assetsConfirmed || !form.legalConfirmed)
      return "Complete all rights and marketplace declarations.";
    if (quality < 70)
      return "Complete the Product Studio checklist until the quality score reaches at least 70%.";
    return null;
  };

  const uploadPublicMedia = async (path: string, file: File) => {
    const { error } = await supabase.storage
      .from("listing-media")
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw error;
    const { data } = supabase.storage.from("listing-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const submit = async () => {
    if (!userId) return;
    // Suspension guard (M5): suspended accounts cannot publish listings.
    if ((await fetchMyStanding()).suspended) {
      toast.error("Account suspended — listing publishing is paused on your account");
      return;
    }
    if (!kind) {
      toast.error("Choose a product type.");
      return;
    }
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    let listingId: string | null = null;
    const uploadedPrivatePaths: string[] = [];
    const uploadedPublicPaths: string[] = [];
    try {
      const price = form.pricingModel === "free" ? 0 : Number(form.price || 0);
      const { data: listing, error: listingError } = await supabase
        .from("listings")
        .insert({
          seller_id: userId,
          kind,
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          price,
          currency: MARKETPLACE_CURRENCY,
          demo_url: form.demoUrl.trim() || null,
          file_name: productFile!.name,
          file_size: productFile!.size,
          status: "pending",
        })
        .select("id")
        .single();
      if (listingError || !listing) throw listingError ?? new Error("Could not create listing");
      listingId = listing.id;

      const mainExt = productFile!.name.split(".").pop() || "bin";
      const mainPath = `${userId}/${listingId}/files/main-${crypto.randomUUID()}.${mainExt}`;
      const mainUpload = await supabase.storage
        .from("listing-files")
        .upload(mainPath, productFile!, {
          upsert: false,
          contentType: productFile!.type || undefined,
        });
      if (mainUpload.error) throw mainUpload.error;
      uploadedPrivatePaths.push(mainPath);
      const mainPathUpdate = await supabase
        .from("listings")
        .update({ file_path: mainPath })
        .eq("id", listingId);
      if (mainPathUpdate.error) throw mainPathUpdate.error;
      const assets = [
        {
          listing_id: listingId,
          asset_kind: "main",
          storage_path: mainPath,
          file_name: productFile!.name,
          mime_type: productFile!.type || null,
          file_size: productFile!.size,
          sort_order: 0,
        },
      ];

      for (let i = 0; i < extraFiles.length; i++) {
        const entry = extraFiles[i];
        const ext = entry.file.name.split(".").pop() || "bin";
        const path = `${userId}/${listingId}/files/${i + 1}-${crypto.randomUUID()}.${ext}`;
        const upload = await supabase.storage
          .from("listing-files")
          .upload(path, entry.file, { upsert: false, contentType: entry.file.type || undefined });
        if (upload.error) throw upload.error;
        uploadedPrivatePaths.push(path);
        assets.push({
          listing_id: listingId,
          asset_kind: entry.kind,
          storage_path: path,
          file_name: entry.file.name,
          mime_type: entry.file.type || null,
          file_size: entry.file.size,
          sort_order: i + 1,
        });
      }
      if (assets.length) {
        const { error } = await supabase.from("listing_assets").insert(assets);
        if (error) throw error;
        const { error: scanQueueError } = await supabase.rpc("queue_listing_scans", {
          p_listing_id: listingId,
        });
        // The scanner is an optional external worker. Uploads remain safely
        // pending moderation if the worker is not configured yet.
        if (scanQueueError) console.warn("Malware scan queue unavailable:", scanQueueError.message);
      }

      const coverExt = coverFile!.name.split(".").pop() || "png";
      const coverPath = `${userId}/${listingId}/media/cover-${crypto.randomUUID()}.${coverExt}`;
      const coverUrl = await uploadPublicMedia(coverPath, coverFile!);
      uploadedPublicPaths.push(coverPath);
      const coverUpdate = await supabase
        .from("listings")
        .update({ cover_url: coverUrl })
        .eq("id", listingId);
      if (coverUpdate.error) throw coverUpdate.error;
      const coverMetadata = await supabase.from("listing_media").insert({
        listing_id: listingId,
        media_type: "cover",
        storage_path: coverPath,
        external_url: coverUrl,
        sort_order: 0,
        title: form.title,
        alt_text: `${form.title} cover`,
      });
      if (coverMetadata.error) throw coverMetadata.error;

      for (let i = 0; i < galleryFiles.length; i++) {
        const file = galleryFiles[i];
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${userId}/${listingId}/media/${i + 1}-${crypto.randomUUID()}.${ext}`;
        const url = await uploadPublicMedia(path, file);
        uploadedPublicPaths.push(path);
        const mediaMetadata = await supabase.from("listing_media").insert({
          listing_id: listingId,
          media_type: file.type === "image/gif" ? "gif" : "screenshot",
          storage_path: path,
          external_url: url,
          sort_order: i + 1,
          title: file.name,
          alt_text: `${form.title} preview ${i + 1}`,
        });
        if (mediaMetadata.error) throw mediaMetadata.error;
      }
      if (form.videoUrl.trim()) {
        const videoMetadata = await supabase.from("listing_media").insert({
          listing_id: listingId,
          media_type: "video",
          external_url: form.videoUrl.trim(),
          sort_order: galleryFiles.length + 1,
          title: "Product demo video",
        });
        if (videoMetadata.error) throw videoMetadata.error;
      }

      const { error: detailError } = await supabase.from("listing_product_details").insert({
        listing_id: listingId,
        product_type: kind === "website" ? "website" : "software",
        short_description: form.shortDescription.trim() || null,
        subcategory: form.subcategory.trim() || null,
        tags,
        features: featureList,
        included_items: includedList,
        target_audience: form.targetAudience.trim() || null,
        platforms,
        languages: splitLines(languages),
        requirements: form.requirements.trim() || null,
        tech_stack: splitLines(techStack),
        file_formats: splitLines(fileFormats),
        version: form.version.trim() || null,
        release_date: form.releaseDate || null,
        last_updated: form.lastUpdated || null,
        pricing_model: form.pricingModel,
        trial_days: Number(form.trialDays || 0),
        pay_what_you_want: form.payWhatYouWant,
        minimum_price: form.minimumPrice ? Number(form.minimumPrice) : null,
        license_type: form.licenseType,
        license_seats: Number(form.licenseSeats || 1),
        activation_limit: form.activationLimit ? Number(form.activationLimit) : null,
        license_duration_days: form.licenseDurationDays ? Number(form.licenseDurationDays) : null,
        tax_category: form.taxCategory,
        support_url: form.supportUrl.trim() || null,
        documentation_url: form.docsUrl.trim() || null,
        seo_title: form.seoTitle.trim() || form.title.trim(),
        seo_description: form.seoDescription.trim() || form.shortDescription.trim() || null,
        seo_keywords: splitLines(form.seoKeywords),
        changelog: form.changelog.trim() || null,
        ai_used: form.aiUsed,
        ai_details: form.aiDetails.trim() || null,
        rights_confirmed: form.rightsConfirmed,
        assets_confirmed: form.assetsConfirmed,
        legal_confirmed: form.legalConfirmed,
        quality_score: quality,
      });
      if (detailError) throw detailError;

      const validVariants = variants
        .filter((v) => v.name.trim())
        .map((v, i) => ({
          listing_id: listingId!,
          name: v.name.trim(),
          price: Number(v.price || 0),
          currency: MARKETPLACE_CURRENCY,
          description: v.description.trim() || null,
          sort_order: i,
          active: true,
        }));
      if (validVariants.length) {
        const { error } = await supabase.from("product_variants").insert(validVariants);
        if (error) throw error;
      }
      const validFaqs = faqs
        .filter((f) => f.question.trim() && f.answer.trim())
        .map((f, i) => ({
          listing_id: listingId!,
          question: f.question.trim(),
          answer: f.answer.trim(),
          sort_order: i,
        }));
      if (validFaqs.length) {
        const { error } = await supabase.from("listing_faq").insert(validFaqs);
        if (error) throw error;
      }

      toast.success("Product submitted for professional moderation.");
      navigate({ to: "/dashboard" });
    } catch (err: unknown) {
      if (uploadedPrivatePaths.length)
        await supabase.storage.from("listing-files").remove(uploadedPrivatePaths);
      if (uploadedPublicPaths.length)
        await supabase.storage.from("listing-media").remove(uploadedPublicPaths);
      if (listingId) {
        await supabase
          .from("listings")
          .update({
            status: "rejected",
            file_path: null,
            cover_url: null,
            review_note: "Upload setup failed. Files were cleaned up; edit and resubmit.",
          })
          .eq("id", listingId);
      }
      toast.error(
        err instanceof Error
          ? err.message
          : "Product upload failed. Uploaded files were cleaned up where possible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    const i = STEPS.indexOf(step);
    if (i >= STEPS.length - 1) return;
    const problemByStep: Partial<Record<(typeof STEPS)[number], string>> = {
      Basics: !form.title.trim()
        ? "Add a product title."
        : form.description.trim().length < 40
          ? "Add a description of at least 40 characters."
          : !form.category
            ? "Choose a category."
            : tags.length < 3
              ? "Add at least 3 searchable tags."
              : undefined,
      Media: !coverFile
        ? "Add a cover image."
        : galleryFiles.length < 1
          ? "Add at least 1 screenshot/preview image."
          : undefined,
      Files: !productFile ? "Add the main product file." : undefined,
      Pricing:
        form.pricingModel !== "free" && !form.payWhatYouWant && Number(form.price) <= 0
          ? "Enter a valid price."
          : variants.some((v) => v.name.trim() && (Number(v.price) <= 0 || !v.description.trim()))
            ? "Complete every named variant with a valid price and description."
            : undefined,
      Technical: !form.version.trim()
        ? "Add a product version."
        : !platforms.length
          ? "Select at least one supported platform."
          : undefined,
      Legal:
        !form.rightsConfirmed || !form.assetsConfirmed || !form.legalConfirmed
          ? "Complete all 3 required marketplace declarations."
          : undefined,
    };
    const problem = problemByStep[step];
    if (problem) {
      toast.error(problem);
      return;
    }
    setStep(STEPS[i + 1]);
  };
  const back = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  if (!authChecked) return null;
  if (!userId)
    return (
      <AuthGate
        inlineMode={inlineMode}
        setInlineMode={setInlineMode}
        email={inlineEmail}
        setEmail={setInlineEmail}
        password={inlinePassword}
        setPassword={setInlinePassword}
        name={inlineName}
        setName={setInlineName}
        loading={inlineLoading}
        onSubmit={inlineAuth}
      />
    );
  if (!kind)
    return (
      <TypePicker
        onPick={(value) => {
          setKind(value);
        }}
      />
    );

  return (
    <div className="min-h-screen pb-16">
      <TopNav />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-lume">
              <Sparkles className="size-4" /> NORDEVA Product Studio
            </div>
            <h1 className="text-3xl font-semibold md:text-4xl">
              Create a marketplace-ready product
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Build the complete product page: media, files, variants, licensing, technical details,
              SEO, tax and legal declarations.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Exit Studio</Link>
          </Button>
        </div>
        <div className="mb-5 grid gap-3 md:grid-cols-[1fr_260px]">
          <div className="surface p-3">
            <div className="flex flex-wrap gap-2">
              {STEPS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s)}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition ${step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  <span className="mr-1.5 opacity-60">{i + 1}</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="surface flex items-center gap-3 p-3">
            <div className="relative size-12 shrink-0 rounded-full bg-muted">
              <div
                className="absolute inset-0 rounded-full border-4 border-primary"
                style={{ clipPath: `inset(${100 - quality}% 0 0 0)` }}
              />
              <div className="absolute inset-0 grid place-items-center text-xs font-bold">
                {quality}%
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Quality score</div>
              <div className="text-xs text-muted-foreground">
                Higher quality gets a cleaner review queue.
              </div>
            </div>
          </div>
        </div>
        <Tabs value={step} onValueChange={(v) => setStep(v as typeof step)}>
          <TabsList className="sr-only">
            {STEPS.map((s) => (
              <TabsTrigger key={s} value={s}>
                {s}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <TabsContent value="Basics">
                <Section title="Product identity" icon={<PackagePlus />}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Product title *" hint="Clear, searchable and specific">
                      <Input
                        value={form.title}
                        onChange={(e) => update("title", e.target.value)}
                        placeholder="AI SaaS Dashboard — React + TypeScript"
                      />
                    </Field>
                    <Field label="Product type">
                      <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                        {
                          PRODUCT_TYPES.find(
                            (x) => x.value === (kind === "website" ? "website" : "software"),
                          )?.label
                        }
                      </div>
                    </Field>
                    <Field label="Short description">
                      <Input
                        value={form.shortDescription}
                        onChange={(e) => update("shortDescription", e.target.value)}
                        placeholder="One sentence explaining the value"
                      />
                    </Field>
                    <Field label="Category *">
                      <Select value={form.category} onValueChange={(v) => update("category", v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Preserve an existing value (e.g. a legacy free-text
                              category) even when it is not in the managed list. */}
                          {form.category && !categoryOptions.includes(form.category) && (
                            <SelectItem value={form.category}>{form.category}</SelectItem>
                          )}
                          {categoryOptions.map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Subcategory">
                      <Input
                        value={form.subcategory}
                        onChange={(e) => update("subcategory", e.target.value)}
                        placeholder="Admin dashboards, SaaS, AI tools…"
                      />
                    </Field>
                    <TagInput
                      value={tags}
                      onChange={setTags}
                      suggestions={[...TAG_SUGGESTIONS, ...PRODUCT_CATEGORIES]}
                      label="Tags / keywords *"
                      description="Press Enter or comma to turn a keyword into a tag. Pick a suggestion or type your own."
                      placeholder="Type a tag and press Enter…"
                      maxTags={12}
                    />
                    <Field label="Target audience">
                      <Input
                        value={form.targetAudience}
                        onChange={(e) => update("targetAudience", e.target.value)}
                        placeholder="Developers, agencies, startups…"
                      />
                    </Field>
                    <Field label="Languages">
                      <Input
                        value={languages}
                        onChange={(e) => setLanguages(e.target.value)}
                        placeholder="English, Hindi, Spanish…"
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Full description *">
                        <Textarea
                          className="min-h-44"
                          value={form.description}
                          onChange={(e) => update("description", e.target.value)}
                          placeholder="Explain what buyers receive, how it works, who it is for, and what makes it useful."
                        />
                      </Field>
                    </div>
                  </div>
                </Section>
                <Section title="Features & what's included" icon={<Layers3 />}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Key features" hint="One item per line or comma-separated">
                      <Textarea
                        value={features}
                        onChange={(e) => setFeatures(e.target.value)}
                        placeholder={
                          "Responsive UI\nAuthentication\nAdmin dashboard\nAPI integration"
                        }
                      />
                    </Field>
                    <Field label="What's included">
                      <Textarea
                        value={included}
                        onChange={(e) => setIncluded(e.target.value)}
                        placeholder={"Source code\nDocumentation\nAssets\nLifetime updates"}
                      />
                    </Field>
                  </div>
                </Section>
              </TabsContent>
              <TabsContent value="Media">
                <Section title="Product media" icon={<ImagePlus />}>
                  <p className="mb-5 text-sm text-muted-foreground">
                    Add a strong cover plus multiple screenshots. Preview media helps buyers
                    understand the product before purchase.
                  </p>
                  <div className="grid gap-5 md:grid-cols-2">
                    <DropZone
                      label="Cover image *"
                      accept="image/*"
                      multiple={false}
                      onFiles={setCover}
                      icon={<FileImage />}
                    />
                    <DropZone
                      label="Screenshots / gallery"
                      accept="image/*"
                      multiple
                      onFiles={addGallery}
                      icon={<ImagePlus />}
                    />
                    <Field label="Live demo URL">
                      <Input
                        value={form.demoUrl}
                        onChange={(e) => update("demoUrl", e.target.value)}
                        placeholder="https://demo.example.com"
                      />
                    </Field>
                    <Field label="Preview video URL">
                      <Input
                        value={form.videoUrl}
                        onChange={(e) => update("videoUrl", e.target.value)}
                        placeholder="YouTube / Vimeo URL"
                      />
                    </Field>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {coverFile && (
                      <PreviewFile file={coverFile} onRemove={() => setCoverFile(null)} />
                    )}
                    {galleryFiles.map((f, i) => (
                      <PreviewFile
                        key={`${f.name}-${i}`}
                        file={f}
                        onRemove={() => setGalleryFiles((p) => p.filter((_, x) => x !== i))}
                      />
                    ))}
                  </div>
                </Section>
              </TabsContent>
              <TabsContent value="Files">
                <Section title="Secure delivery files" icon={<FileArchive />}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <DropZone
                      label="Main product file *"
                      accept=".zip,.rar,.7z,.pdf,.doc,.docx,.apk,.aab,.dmg,.pkg,.exe,.msi,.iso"
                      multiple={false}
                      onFiles={setMainProduct}
                      icon={<Upload />}
                    />
                    <DropZone
                      label="Additional files / bonus assets"
                      accept=".zip,.rar,.7z,.pdf,.doc,.docx,.apk,.aab,.dmg,.pkg,.exe,.msi,.iso"
                      multiple
                      onFiles={addExtra}
                      icon={<Plus />}
                    />
                  </div>
                  {productFile && (
                    <FileRow file={productFile} primary onRemove={() => setProductFile(null)} />
                  )}
                  {extraFiles.map((e, i) => (
                    <FileRow
                      key={`${e.file.name}-${i}`}
                      file={e.file}
                      onRemove={() => setExtraFiles((p) => p.filter((_, x) => x !== i))}
                    />
                  ))}
                  <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-muted-foreground">
                    <ShieldCheck className="mr-2 inline size-4 text-amber-400" />
                    Every submitted file stays private until moderation. Production deployments
                    should connect the storage bucket to a malware scanner before approval.
                  </div>
                </Section>
              </TabsContent>
              <TabsContent value="Pricing">
                <Section title="Pricing & variants" icon={<Globe2 />}>
                  <div className="grid gap-5 md:grid-cols-3">
                    <Field label="Pricing model">
                      <Select
                        value={form.pricingModel}
                        onValueChange={(v) => update("pricingModel", v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRICING_MODELS.map((x) => (
                            <SelectItem key={x.value} value={x.value}>
                              {x.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Base price">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.price}
                        onChange={(e) => update("price", e.target.value)}
                        placeholder="49.00"
                      />
                    </Field>
                    <Field label="Currency">
                      <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium">
                        USD — single marketplace currency
                      </div>
                    </Field>
                  </div>
                  <div className="md:col-span-3 rounded-xl border border-lume/20 bg-lume/5 p-4 text-sm">
                    <div className="font-medium">Marketplace commission: 15%</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      NORDEVA keeps 15% of the completed sale amount. You receive an estimated 85%
                      before processor, tax, refund, or payout costs. Final accounting is enforced
                      server-side.
                    </p>
                    {Number(form.price) > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg border p-2">
                          <div className="text-muted-foreground">Sale</div>
                          <div className="font-semibold">USD {Number(form.price).toFixed(2)}</div>
                        </div>
                        <div className="rounded-lg border p-2">
                          <div className="text-muted-foreground">NORDEVA 15%</div>
                          <div className="font-semibold">
                            USD {(Number(form.price) * 0.15).toFixed(2)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-2">
                          <div className="text-muted-foreground">Seller 85%</div>
                          <div className="font-semibold">
                            USD {(Number(form.price) * 0.85).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <Field label="Trial days">
                      <Input
                        type="number"
                        min="0"
                        value={form.trialDays}
                        onChange={(e) => update("trialDays", e.target.value)}
                      />
                    </Field>
                    <Field label="Minimum price (PWYW)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.minimumPrice}
                        onChange={(e) => update("minimumPrice", e.target.value)}
                      />
                    </Field>
                    <label className="flex items-center gap-3 rounded-xl border p-4 text-sm">
                      <Checkbox
                        checked={form.payWhatYouWant}
                        onCheckedChange={(v) => update("payWhatYouWant", !!v)}
                      />
                      <span>Allow pay-what-you-want pricing</span>
                    </label>
                  </div>
                  <div className="mt-6 rounded-2xl border border-border/60 p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium">Plans / variants</div>
                        <div className="text-xs text-muted-foreground">
                          Offer Basic, Pro, Agency, Lifetime or other tiers.
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setVariants((p) => [
                            ...p,
                            { name: "", price: "", currency: form.currency, description: "" },
                          ])
                        }
                      >
                        <Plus /> Add variant
                      </Button>
                    </div>
                    {variants.map((v, i) => (
                      <div
                        key={i}
                        className="mb-3 grid gap-3 rounded-xl bg-muted/40 p-3 md:grid-cols-[1fr_150px_150px_1.5fr_auto]"
                      >
                        <Input
                          placeholder="Pro / Lifetime"
                          value={v.name}
                          onChange={(e) =>
                            setVariants((p) =>
                              p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Price"
                          value={v.price}
                          onChange={(e) =>
                            setVariants((p) =>
                              p.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)),
                            )
                          }
                        />
                        <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                          USD
                        </div>
                        <Input
                          placeholder="What this tier includes"
                          value={v.description}
                          onChange={(e) =>
                            setVariants((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, description: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setVariants((p) => p.filter((_, j) => j !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                </Section>
              </TabsContent>
              <TabsContent value="Technical">
                <Section title="Technical compatibility" icon={<Layers3 />}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Requirements">
                      <Textarea
                        value={form.requirements}
                        onChange={(e) => update("requirements", e.target.value)}
                        placeholder="Node 20+, PostgreSQL, WordPress 6.5+, 4GB RAM…"
                      />
                    </Field>
                    <Field label="Technology / stack">
                      <Textarea
                        value={techStack}
                        onChange={(e) => setTechStack(e.target.value)}
                        placeholder="React, TypeScript, TanStack Start, Supabase…"
                      />
                    </Field>
                    <Field label="File formats">
                      <Input
                        value={fileFormats}
                        onChange={(e) => setFileFormats(e.target.value)}
                        placeholder="ZIP, PDF, PNG, MP4…"
                      />
                    </Field>
                    <Field label="Version">
                      <Input
                        value={form.version}
                        onChange={(e) => update("version", e.target.value)}
                      />
                    </Field>
                    <Field label="Release date">
                      <Input
                        type="date"
                        value={form.releaseDate}
                        onChange={(e) => update("releaseDate", e.target.value)}
                      />
                    </Field>
                    <Field label="Last updated">
                      <Input
                        type="date"
                        value={form.lastUpdated}
                        onChange={(e) => update("lastUpdated", e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="mt-5">
                    <Label className="mb-3 block">Supported platforms</Label>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORMS.map((p) => (
                        <button
                          type="button"
                          key={p}
                          onClick={() => togglePlatform(p)}
                          className={`rounded-full border px-3 py-1.5 text-xs ${platforms.includes(p) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
                        >
                          {platforms.includes(p) ? "✓ " : ""}
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </Section>
                <Section title="Documentation & support" icon={<FileText />}>
                  <div className="grid gap-5 md:grid-cols-3">
                    <Field label="Documentation URL">
                      <Input
                        value={form.docsUrl}
                        onChange={(e) => update("docsUrl", e.target.value)}
                        placeholder="https://docs.example.com"
                      />
                    </Field>
                    <Field label="Support URL">
                      <Input
                        value={form.supportUrl}
                        onChange={(e) => update("supportUrl", e.target.value)}
                        placeholder="https://example.com/support"
                      />
                    </Field>
                    <Field label="Changelog">
                      <Input
                        value={form.changelog}
                        onChange={(e) => update("changelog", e.target.value)}
                        placeholder="Initial release"
                      />
                    </Field>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {faqs.map((f, i) => (
                      <div key={i} className="rounded-xl border p-4">
                        <div className="mb-3 flex items-center justify-between text-sm font-medium">
                          FAQ {i + 1}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setFaqs((p) => p.filter((_, j) => j !== i))}
                          >
                            <X />
                          </Button>
                        </div>
                        <Input
                          className="mb-2"
                          placeholder="Question"
                          value={f.question}
                          onChange={(e) =>
                            setFaqs((p) =>
                              p.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)),
                            )
                          }
                        />
                        <Textarea
                          placeholder="Answer"
                          value={f.answer}
                          onChange={(e) =>
                            setFaqs((p) =>
                              p.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)),
                            )
                          }
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFaqs((p) => [...p, { question: "", answer: "" }])}
                    >
                      <Plus /> Add FAQ
                    </Button>
                  </div>
                </Section>
              </TabsContent>
              <TabsContent value="Legal">
                <Section title="License & usage" icon={<ShieldCheck />}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="License type">
                      <Select
                        value={form.licenseType}
                        onValueChange={(v) => update("licenseType", v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LICENSE_TYPES.map((x) => (
                            <SelectItem key={x.value} value={x.value}>
                              {x.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Seats">
                      <Input
                        type="number"
                        min="1"
                        value={form.licenseSeats}
                        onChange={(e) => update("licenseSeats", e.target.value)}
                      />
                    </Field>
                    <Field label="Activation limit">
                      <Input
                        type="number"
                        min="1"
                        value={form.activationLimit}
                        onChange={(e) => update("activationLimit", e.target.value)}
                        placeholder="Unlimited"
                      />
                    </Field>
                    <Field label="License duration (days)">
                      <Input
                        type="number"
                        min="1"
                        value={form.licenseDurationDays}
                        onChange={(e) => update("licenseDurationDays", e.target.value)}
                        placeholder="Never expires"
                      />
                    </Field>
                    <Field label="Tax category">
                      <Input
                        value={form.taxCategory}
                        onChange={(e) => update("taxCategory", e.target.value)}
                        placeholder="Digital Software"
                      />
                    </Field>
                  </div>
                </Section>
                <Section title="AI, ownership & compliance" icon={<ShieldCheck />}>
                  <div className="space-y-3">
                    <CheckRow
                      checked={form.rightsConfirmed}
                      onChange={(v) => update("rightsConfirmed", v)}
                      text="I own or have legal rights to sell this product."
                    />
                    <CheckRow
                      checked={form.assetsConfirmed}
                      onChange={(v) => update("assetsConfirmed", v)}
                      text="I have the required licenses for all included fonts, images, code and other assets."
                    />
                    <CheckRow
                      checked={form.legalConfirmed}
                      onChange={(v) => update("legalConfirmed", v)}
                      text="This product follows NORDEVA marketplace rules and does not contain prohibited or unauthorized content."
                    />
                    <CheckRow
                      checked={form.aiUsed}
                      onChange={(v) => update("aiUsed", v)}
                      text="AI was used in creating part of this product."
                    />
                    {form.aiUsed && (
                      <Textarea
                        value={form.aiDetails}
                        onChange={(e) => update("aiDetails", e.target.value)}
                        placeholder="Describe what was AI-generated or AI-assisted."
                      />
                    )}
                  </div>
                </Section>
                <Section title="SEO" icon={<Globe2 />}>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="SEO title">
                      <Input
                        value={form.seoTitle}
                        onChange={(e) => update("seoTitle", e.target.value)}
                        placeholder={form.title || "Product SEO title"}
                      />
                    </Field>
                    <TagInput
                      value={splitLines(form.seoKeywords)}
                      onChange={(next) => update("seoKeywords", next.join(", "))}
                      suggestions={[...TAG_SUGGESTIONS, ...PRODUCT_CATEGORIES]}
                      label="SEO keywords"
                      description="Use focused search terms; Enter/comma creates a chip."
                      placeholder="Add SEO keyword…"
                      maxTags={12}
                    />
                    <div className="md:col-span-2">
                      <Field label="SEO description">
                        <Textarea
                          value={form.seoDescription}
                          onChange={(e) => update("seoDescription", e.target.value)}
                          placeholder="Search-friendly product description"
                        />
                      </Field>
                    </div>
                  </div>
                </Section>
              </TabsContent>
              <TabsContent value="Review">
                <Section title="Final marketplace review" icon={<Check />}>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <ReviewMetric label="Quality score" value={`${quality}%`} ok={quality >= 70} />
                    <ReviewMetric
                      label="Media"
                      value={`${galleryFiles.length + Number(!!coverFile)} files`}
                      ok={!!coverFile}
                    />
                    <ReviewMetric
                      label="Delivery"
                      value={`${extraFiles.length + Number(!!productFile)} files`}
                      ok={!!productFile}
                    />
                    <ReviewMetric
                      label="Declarations"
                      value={`${Number(form.rightsConfirmed) + Number(form.assetsConfirmed) + Number(form.legalConfirmed)}/3`}
                      ok={form.rightsConfirmed && form.assetsConfirmed && form.legalConfirmed}
                    />
                  </div>
                  <div className="mt-6 rounded-2xl border border-border/60 bg-muted/30 p-5">
                    <h3 className="font-medium">Before you submit</h3>
                    <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                      <li>• Files remain private until moderation.</li>
                      <li>• Product is not live until approved by an admin.</li>
                      <li>
                        • Buyers will see your cover, gallery, description and technical
                        information.
                      </li>
                      <li>
                        • Variants, license settings and product metadata are stored with the
                        listing.
                      </li>
                      <li>• All product prices and tiers are charged in USD.</li>
                      <li>• Use a real demo/documentation URL where possible.</li>
                    </ul>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <Button
                      size="lg"
                      disabled={saving}
                      onClick={submit}
                      className="lume-gradient text-white"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="animate-spin" /> Uploading securely…
                        </>
                      ) : (
                        <>
                          <Upload /> Submit for moderation
                        </>
                      )}
                    </Button>
                  </div>
                </Section>
              </TabsContent>
            </div>
            <aside className="hidden lg:block">
              <div className="sticky top-24 space-y-4">
                <div className="surface p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium">Product checklist</span>
                    <Badge variant={quality >= 80 ? "default" : "secondary"}>{quality}%</Badge>
                  </div>
                  <Checklist
                    label="Title & description"
                    ok={!!form.title && form.description.length >= 40}
                  />
                  <Checklist label="Cover image" ok={!!coverFile} />
                  <Checklist label="3+ screenshots" ok={galleryFiles.length >= 3} />
                  <Checklist label="Main file" ok={!!productFile} />
                  <Checklist label="Category & tags" ok={!!form.category && tags.length >= 3} />
                  <Checklist label="Demo & docs" ok={!!form.demoUrl && !!form.docsUrl} />
                  <Checklist label="Technical requirements" ok={!!form.requirements} />
                  <Checklist
                    label="Legal declarations"
                    ok={form.rightsConfirmed && form.assetsConfirmed && form.legalConfirmed}
                  />
                  <Checklist label="SEO" ok={!!form.seoTitle && !!form.seoDescription} />
                </div>
                <div className="surface p-5">
                  <div className="text-sm font-medium">Security status</div>
                  <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                    <ShieldCheck className="size-5 text-emerald-400" />
                    <span>
                      Private storage + admin moderation. Add a production malware scanning worker
                      before opening unrestricted seller uploads.
                    </span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </Tabs>
        <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-5">
          <Button variant="outline" onClick={back} disabled={step === STEPS[0]}>
            <ArrowLeft /> Back
          </Button>
          <div className="text-xs text-muted-foreground">
            Step {STEPS.indexOf(step) + 1} of {STEPS.length}
          </div>
          {step === "Review" ? (
            <Button disabled={saving} onClick={submit} className="lume-gradient text-white">
              Submit product <Check />
            </Button>
          ) : (
            <Button onClick={next}>
              Continue <ArrowRight />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface mb-6 p-5 md:p-7">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Configure this part of your product listing.
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
function CheckRow({
  checked,
  onChange,
  text,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span>{text}</span>
    </label>
  );
}
function Checklist({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <span
        className={`grid size-5 place-items-center rounded-full ${ok ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}
      >
        {ok ? <Check className="size-3" /> : <span>•</span>}
      </span>
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
function ReviewMetric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-center justify-between font-semibold">
        {value}
        <span className={ok ? "text-emerald-400" : "text-amber-400"}>
          {ok ? <Check className="size-4" /> : <span>!</span>}
        </span>
      </div>
    </div>
  );
}
function FileRow({
  file,
  onRemove,
  primary = false,
}: {
  file: File;
  onRemove: () => void;
  primary?: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
      <FileArchive className="size-5 text-lume" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="text-xs text-muted-foreground">
          {(file.size / 1024 / 1024).toFixed(2)} MB{" "}
          {primary ? "· Main delivery" : "· Additional asset"}
        </div>
      </div>
      <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}
function PreviewFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = URL.createObjectURL(file);
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-muted">
      <img src={url} className="h-32 w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white"
      >
        <X className="size-3" />
      </button>
      <div className="truncate px-2 py-2 text-[10px] text-muted-foreground">{file.name}</div>
    </div>
  );
}
function DropZone({
  label,
  accept,
  multiple,
  onFiles,
  icon,
}: {
  label: string;
  accept: string;
  multiple: boolean;
  onFiles: (files: FileList | null) => void;
  icon: React.ReactNode;
}) {
  return (
    <label className="group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-center transition hover:border-primary/50 hover:bg-primary/5">
      <input
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(e) => onFiles(e.target.files)}
      />
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Click to browse {multiple ? "multiple files" : "a file"}
      </div>
    </label>
  );
}
function TypePicker({ onPick }: { onPick: (v: Kind) => void }) {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-5xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles />
          </div>
          <h1 className="text-4xl font-semibold">Start your product</h1>
          <p className="mt-3 text-muted-foreground">
            Choose the closest product type. You can still customize every detail later.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <button onClick={() => onPick("software")} className="surface lift p-8 text-left">
            <div className="text-xl font-semibold">Software / Digital product</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Apps, SaaS, code, AI tools, plugins, assets, courses and downloadable products.
            </p>
            <div className="mt-6 text-sm text-lume">Open Product Studio →</div>
          </button>
          <button onClick={() => onPick("website")} className="surface lift p-8 text-left">
            <div className="text-xl font-semibold">Website / Template</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Websites, templates, themes, landing pages and complete site packages.
            </p>
            <div className="mt-6 text-sm text-lume">Open Product Studio →</div>
          </button>
        </div>
      </main>
    </div>
  );
}
function AuthGate({
  inlineMode,
  setInlineMode,
  email,
  setEmail,
  password,
  setPassword,
  name,
  setName,
  loading,
  onSubmit,
}: {
  inlineMode: "signin" | "signup";
  setInlineMode: (v: "signin" | "signup") => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="surface p-8">
          <h1 className="text-2xl font-semibold text-center">
            {inlineMode === "signup" ? "Start selling on NORDEVA" : "Welcome back"}
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Create your account, then launch the full Product Studio.
          </p>
          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            {inlineMode === "signup" && (
              <Field label="Display name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button disabled={loading} className="w-full">
              {loading ? <Loader2 className="animate-spin" /> : null}
              {inlineMode === "signup" ? "Create seller account" : "Sign in"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-5 w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setInlineMode(inlineMode === "signup" ? "signin" : "signup")}
          >
            {inlineMode === "signup"
              ? "Already have an account? Sign in"
              : "Need an account? Create one"}
          </button>
        </div>
      </main>
    </div>
  );
}
