interface Props {
  riskLevel: "low" | "medium" | "high" | null | undefined;
  score?: number | null;
}

const colors = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

const labels = { low: "LOW RISK", medium: "MEDIUM RISK", high: "HIGH RISK" };

export function TrustBadge({ riskLevel, score }: Props) {
  const level = riskLevel ?? "high";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${colors[level]}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          level === "low"
            ? "bg-emerald-500"
            : level === "medium"
            ? "bg-yellow-500"
            : "bg-red-500"
        }`}
      />
      {score !== null && score !== undefined ? `${Math.round(score)} · ` : ""}
      {labels[level]}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full bg-slate-200 rounded-full h-2">
      <div
        className={`${color} h-2 rounded-full transition-all`}
        style={{ width: `${Math.min(100, score)}%` }}
      />
    </div>
  );
}
