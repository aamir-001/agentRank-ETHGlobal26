"use client";

interface Props {
  q: string;
  x402Only: boolean;
  activeOnly: boolean;
  ensLinkedOnly: boolean;
  minScore: string;
  onChange: (updates: Partial<{ q: string; x402Only: boolean; activeOnly: boolean; ensLinkedOnly: boolean; minScore: string }>) => void;
}

export function SearchFilters({ q, x402Only, activeOnly, ensLinkedOnly, minScore, onChange }: Props) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        placeholder="Search agents by name, address, ENS..."
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        className="flex-1 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-500"
      />

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onChange({ x402Only: !x402Only })}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
            x402Only
              ? "bg-teal-100 text-teal-700 border-teal-300"
              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
          }`}
        >
          x402 Only
        </button>

        <button
          onClick={() => onChange({ activeOnly: !activeOnly })}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
            activeOnly
              ? "bg-emerald-100 text-emerald-700 border-emerald-300"
              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
          }`}
        >
          Active Only
        </button>

        <button
          onClick={() => onChange({ ensLinkedOnly: !ensLinkedOnly })}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
            ensLinkedOnly
              ? "bg-orange-100 text-orange-700 border-orange-300"
              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
          }`}
        >
          ENS Linked
        </button>

        <select
          value={minScore}
          onChange={(e) => onChange({ minScore: e.target.value })}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-teal-500"
        >
          <option value="">Min Score</option>
          <option value="25">25+</option>
          <option value="50">50+</option>
          <option value="75">75+</option>
        </select>
      </div>
    </div>
  );
}
