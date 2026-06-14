export function shortAddr(addr: string | null) {
  if (!addr) return "—";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}
