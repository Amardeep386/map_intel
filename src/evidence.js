// Opening stored evidence from any screen (kept out of the view files so they only export components).
import { api } from "./api/client.js";
import { attempt } from "./workspace.js";

/** Open the best proof of an observation: page screenshot, else the evidence card or API data. */
export async function openEvidence(showToast, evidenceId, part = "picture") {
  if (!evidenceId) return showToast("No evidence stored for this observation.", "info");
  const e = await attempt(showToast, () => api.getEvidence(evidenceId));
  const url = part === "api" ? e?.api?.url : e?.screenshot?.url ?? e?.card?.url ?? e?.api?.url ?? e?.html?.url;
  if (url) window.open(url, "_blank", "noopener");
  else showToast("Evidence opens when the portal is connected to the API.", "info");
}
