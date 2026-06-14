"use client";
import { useState } from "react";
import { triggerIngest } from "@/lib/api";

export function IngestPanel() {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(type: "identity" | "reputation") {
    setLoading(type);
    setResult(null);
    try {
      const r = await triggerIngest(type, false);
      setResult(JSON.stringify(r, null, 2));
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Data Ingestion</h3>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => run("identity")}
          disabled={!!loading}
          className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all"
        >
          {loading === "identity" ? "Ingesting..." : "Ingest Identity"}
        </button>
        <button
          onClick={() => run("reputation")}
          disabled={!!loading}
          className="px-4 py-2 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all"
        >
          {loading === "reputation" ? "Ingesting..." : "Ingest Reputation"}
        </button>
      </div>
      {result && (
        <pre className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto max-h-40">
          {result}
        </pre>
      )}
    </div>
  );
}
