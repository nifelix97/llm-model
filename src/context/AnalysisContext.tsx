/**
 * Lightweight cross-page state for passing model prompt analysis to the Dashboard.
 * Uses sessionStorage so data survives navigation but not a full page refresh.
 */

const KEY = "dc-tim-analysis";

export interface AnalysisPayload {
  prompt: string;       // the optimized prompt that was sent
  response: string;     // full model response text
  category: string;     // detected policy category id
  timestamp: number;
  workspace_id: string;
}

type AnalysisPayloadInput = Omit<AnalysisPayload, "workspace_id">;

export function saveAnalysis(payload: AnalysisPayloadInput, workspaceId: string) {
  if (!workspaceId) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...payload, workspace_id: workspaceId }));
  } catch {
    // ignore storage errors
  }
}

export function loadAnalysis(workspaceId: string | null | undefined): AnalysisPayload | null {
  if (!workspaceId) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as Partial<AnalysisPayload>;
    if (payload.workspace_id !== workspaceId) {
      clearAnalysis();
      return null;
    }
    return payload as AnalysisPayload;
  } catch {
    return null;
  }
}

export function clearAnalysis() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
}

/** Detect which policy category the response text is most about */
export function detectCategory(text: string): string {
  const t = text.toLowerCase();
  const scores: Record<string, number> = {
    education:      (t.match(/educat|literacy|school|enrolment|teacher|curriculum/g) ?? []).length,
    healthcare:     (t.match(/health|hospital|doctor|medicine|bed|coverage|disease/g) ?? []).length,
    economic:       (t.match(/gdp|economic|inflation|employment|trade|fiscal|invest/g) ?? []).length,
    infrastructure: (t.match(/infra|road|water|internet|broadband|power|housing|transport/g) ?? []).length,
    governance:     (t.match(/govern|corrupt|transparenc|law|civic|judiciar|parliament/g) ?? []).length,
    environment:    (t.match(/renew|energy|carbon|emission|climate|forest|biodiversity|solar/g) ?? []).length,
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : "all";
}
