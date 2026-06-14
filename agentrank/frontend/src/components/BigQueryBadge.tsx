export function BigQueryBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 border border-slate-200 bg-white rounded-full px-3 py-1 ${className}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#4285F4" strokeWidth="2.5" />
        <path
          d="M15.5 15.5L19 19"
          stroke="#34A853"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect x="9" y="8" width="2.2" height="8" rx="1" fill="#FBBC05" />
        <rect x="12.4" y="11" width="2.2" height="5" rx="1" fill="#EA4335" />
      </svg>
      Powered by Google BigQuery
    </span>
  );
}
