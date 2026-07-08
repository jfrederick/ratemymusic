import type { CandidateView, Evidence, MethodKey } from "./api";

type EvidenceOf<K extends MethodKey> = Extract<Evidence, { method: K }>;

function formatList(evidence: EvidenceOf<"list">): string {
  const lists = evidence.lists;
  if (lists.length === 0) return "";
  const shown = lists.slice(0, 2);
  const remainder = lists.length - shown.length;
  const label =
    shown.map((l) => l.title).join(", ") + (remainder > 0 ? `, +${remainder} more` : "");
  const noun = lists.length === 1 ? "list" : "lists";
  return `On ${lists.length} ${noun} you love: ${label}`;
}

function formatTwin(evidence: EvidenceOf<"twin">): string {
  const twins = evidence.twins;
  if (twins.length === 0) return "";
  const top = [...twins].sort((a, b) => b.rating - a.rating)[0];
  const remainder = twins.length - 1;
  const suffix = remainder > 0 ? ` (+${remainder} more)` : "";
  return `taste-twin ${top.username} rated it ${top.rating.toFixed(1)}${suffix}`;
}

function formatGenre(evidence: EvidenceOf<"genre">): string {
  const charts = evidence.charts;
  if (charts.length === 0) return "";
  const top = [...charts].sort((a, b) => a.position - b.position)[0];
  return `#${top.position} in ${top.genre}`;
}

function formatDescriptor(evidence: EvidenceOf<"descriptor">): string {
  const charts = evidence.charts;
  if (charts.length === 0) return "";
  const top = [...charts].sort((a, b) => a.position - b.position)[0];
  return `#${top.position} among "${top.descriptor}" picks`;
}

function formatNew(evidence: EvidenceOf<"new">): string {
  const charts = evidence.charts;
  if (charts.length === 0) return "";
  const top = [...charts].sort((a, b) => a.position - b.position)[0];
  return `#${top.position} on the new-music chart`;
}

const METHOD_ORDER: MethodKey[] = ["list", "twin", "genre", "descriptor", "new"];

/** Renders the human-readable "why this candidate surfaced" line from its scoring components. */
export function buildEvidenceLine(candidate: CandidateView): string {
  const parts: string[] = [];
  for (const key of METHOD_ORDER) {
    const component = candidate.components[key];
    if (!component) continue;
    const evidence = component.evidence;
    let part = "";
    switch (evidence.method) {
      case "list":
        part = formatList(evidence);
        break;
      case "twin":
        part = formatTwin(evidence);
        break;
      case "genre":
        part = formatGenre(evidence);
        break;
      case "descriptor":
        part = formatDescriptor(evidence);
        break;
      case "new":
        part = formatNew(evidence);
        break;
    }
    if (part) parts.push(part);
  }
  return parts.length > 0 ? parts.join(" · ") : "Surfaced by your taste profile.";
}
