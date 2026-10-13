import { useAccount } from "../../account/store";
import { paywallEnabled } from "../../account/capabilities";
import { useSheets } from "./useGate";

/** Shown inside limit panels: free plan gets the paywall; trial and Pro see the reset time instead, so no button. */
export default function UpgradeProButton() {
  const plan = useAccount((s) => s.plan());
  if (plan !== "free" || !paywallEnabled()) return null;
  return <button type="button" className="primary upgrade-pro" data-testid="upgrade-pro" onClick={() => useSheets.setState({ open: "paywall" })}>Upgrade to Pro</button>;
}
