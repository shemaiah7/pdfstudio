import { DEFAULT_ORIGIN, canHandOff } from "./lib.js";

const auto = document.getElementById("auto");
const open = document.getElementById("open");
const hint = document.getElementById("hint");

const { autoOpen } = await chrome.storage.sync.get({ autoOpen: true });
auto.checked = autoOpen !== false;
auto.addEventListener("change", () => { void chrome.storage.sync.set({ autoOpen: auto.checked }); });

const { appOrigin } = await chrome.storage.local.get("appOrigin");
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const ok = !!tab && canHandOff(tab.url, appOrigin || DEFAULT_ORIGIN);
open.disabled = !ok;
if (!ok) {
  hint.hidden = false;
  hint.textContent = "Open a web page or a PDF first. Browser pages and SentinelPDF itself can't be sent.";
}
open.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "open-url", url: tab.url, how: "same-tab", tabId: tab.id });
  window.close();
});
