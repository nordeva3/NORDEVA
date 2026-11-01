import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyThemePreference,
  getSavedThemePreference,
  readTheme,
  subscribeToTheme,
  subscribeToThemePreference,
  type VeloraTheme,
  type VeloraThemePreference,
} from "@/lib/theme";
import {
  getPreferences,
  readPreferences,
  subscribeToPreferences,
  updatePreferences,
  type DensityPreference,
  type FontScale,
  type MotionPreference,
  type RadiusPreference,
  type UserPreferences,
} from "@/lib/preferences";
import { getCurrentAppearance, subscribeToAppearance, type GridDensity } from "@/lib/appearance";

/**
 * Per-user appearance settings (TITANIUM wave T2). Every control writes
 * straight through to src/lib/theme.ts / src/lib/preferences.ts, which apply
 * and persist on this device immediately — there is no save button and no
 * dead control. Accent colour is intentionally absent: it is controlled
 * site-wide by the admin design settings (and locked under TITANIUM).
 */

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 rounded-full border border-border/70 bg-muted/50 p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SettingRow({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {caption ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{caption}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function AppearanceSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [themePreference, setThemePreference] = useState<VeloraThemePreference>("dark");
  const [resolvedTheme, setResolvedTheme] = useState<VeloraTheme>("dark");
  const [preferences, setPreferences] = useState<UserPreferences>(() => getPreferences());
  const [siteDensity, setSiteDensity] = useState<GridDensity>(
    () => getCurrentAppearance().gridDensity,
  );

  useEffect(() => {
    setThemePreference(getSavedThemePreference());
    setResolvedTheme(readTheme());
    setPreferences(readPreferences());
    const unsubTheme = subscribeToTheme(setResolvedTheme);
    const unsubPreference = subscribeToThemePreference(setThemePreference);
    const unsubPreferences = subscribeToPreferences(setPreferences);
    const unsubAppearance = subscribeToAppearance((config) => setSiteDensity(config.gridDensity));
    return () => {
      unsubTheme();
      unsubPreference();
      unsubPreferences();
      unsubAppearance();
    };
  }, []);

  const densityValue: DensityPreference = preferences.density ?? siteDensity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>
            Personalise how NORDEVA looks on this device. Changes apply instantly and are saved here
            — they don't follow your account to other devices.
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border/60">
          <SettingRow
            title="Theme"
            caption={
              themePreference === "system"
                ? `Following your device — currently ${resolvedTheme}.`
                : undefined
            }
          >
            <Segmented<VeloraThemePreference>
              ariaLabel="Theme"
              value={themePreference}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              onChange={(value) => applyThemePreference(value)}
            />
          </SettingRow>

          <SettingRow title="Font size" caption="Scales text and spacing across the whole site.">
            <Segmented<FontScale>
              ariaLabel="Font size"
              value={preferences.fontScale}
              options={[
                { value: "standard", label: "Standard" },
                { value: "large", label: "Large" },
              ]}
              onChange={(fontScale) => updatePreferences({ fontScale })}
            />
          </SettingRow>

          <SettingRow
            title="Density"
            caption={`Compact tightens marketplace card spacing and sidebar menu items. Site default: ${siteDensity}.`}
          >
            <Segmented<DensityPreference>
              ariaLabel="Density"
              value={densityValue}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
              onChange={(density) => updatePreferences({ density })}
            />
          </SettingRow>

          <SettingRow
            title="Corner radius"
            caption="Default keeps the corner style chosen for the site."
          >
            <Segmented<RadiusPreference>
              ariaLabel="Corner radius"
              value={preferences.radius}
              options={[
                { value: "default", label: "Default" },
                { value: "sharp", label: "Sharp" },
                { value: "round", label: "Round" },
              ]}
              onChange={(radius) => updatePreferences({ radius })}
            />
          </SettingRow>

          <SettingRow
            title="Motion"
            caption="Reduced minimises animation. If your device already asks for reduced motion, that always applies."
          >
            <Segmented<MotionPreference>
              ariaLabel="Motion"
              value={preferences.motion}
              options={[
                { value: "full", label: "Full" },
                { value: "reduced", label: "Reduced" },
              ]}
              onChange={(motion) => updatePreferences({ motion })}
            />
          </SettingRow>
        </div>
      </DialogContent>
    </Dialog>
  );
}
