import { useAccount } from "../../account/store";

const trialDaysLeft = (trialEndsAt: number | undefined, now = Date.now()): number =>
  trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt * 1000 - now) / 86_400_000)) : 0;

/** "Trial · N days left"; opens the account menu. Only during the trial and only once the paywall exists. */
export default function TrialPill({ onClick }: { onClick: () => void }) {
  const me = useAccount((s) => s.me);
  if (!me || me.plan !== "trial" || !me.paywall) return null;
  const n = trialDaysLeft(me.trialEndsAt);
  return (
    <button type="button" className="trial-pill" data-testid="trial-pill" onClick={onClick}>
      <span className="trial-dot" aria-hidden="true" />Trial · {n} {n === 1 ? "day" : "days"} left
    </button>
  );
}
