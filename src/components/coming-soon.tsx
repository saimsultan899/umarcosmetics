export function ComingSoon({
  title,
  phase,
}: {
  title: string;
  phase: string;
}) {
  return (
    <div className="panel animate-rise mx-auto max-w-2xl p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
        {phase}
      </p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold">
        {title}
      </h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        Navigation is ready. This module will be built next according to the
        requirements roadmap.
      </p>
    </div>
  );
}
