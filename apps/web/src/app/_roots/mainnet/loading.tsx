/** Mainnet route loading state: hook-free, no Testnet dictionaries. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3 pt-4" role="status" aria-busy="true">
      <span className="sr-only">Loading… / Yükleniyor…</span>
      <div className="h-6 w-32 rounded bg-[var(--tone-neutral-bg)]" />
      <div className="h-24 rounded-[var(--radius-card)] bg-[var(--tone-neutral-bg)]" />
    </div>
  );
}
