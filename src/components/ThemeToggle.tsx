import { useThemeStore, type ThemePreference } from "../store/theme";
import { Icon, type IconName } from "./icons";

const LABEL: Record<ThemePreference, string> = { system: "Theme: System", light: "Theme: Light", dark: "Theme: Dark" };
const ICON: Record<ThemePreference, IconName> = { system: "monitor", light: "sun", dark: "moon" };

export default function ThemeToggle({ className }: { className?: string }) {
  const preference = useThemeStore((s) => s.preference);
  const cycle = useThemeStore((s) => s.cycle);
  return (
    <button type="button" className={className} data-testid="theme-toggle" aria-label={LABEL[preference]} title={`${LABEL[preference]} (click to change)`} onClick={cycle}>
      <Icon name={ICON[preference]} />
    </button>
  );
}
