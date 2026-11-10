export type ProcessStep = { title: string; body: string };

export function ProcessSteps({ steps }: { steps: readonly ProcessStep[] }) {
  return (
    <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="reveal group relative rounded-3xl border border-border bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand/30 hover:shadow-xl hover:shadow-brand/10"
        >
          <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-teal text-lg font-bold text-night shadow-md shadow-brand/30">
            {index + 1}
          </span>
          <h3 className="mt-5 text-lg font-semibold text-ink">{step.title}</h3>
          <p className="mt-2 text-muted-foreground">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
