export function WorldIdBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 border border-slate-200 bg-white rounded-full px-3 py-1 ${className}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9.5" stroke="#059669" strokeWidth="2" />
        <circle cx="12" cy="12" r="3.4" fill="#059669" />
      </svg>
      Personhood by World ID
    </span>
  );
}
