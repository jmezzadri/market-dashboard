// /paper — Paper Portfolio
//
// 2026-08-13: the Conviction Events book was retired. Its selection rule
// (buy anything with >= $250k of aggregated insider buying) proved to be a
// single-signal strategy with no quality screen: it bought PRCT and HUBS days
// after both fell on earnings, and it sized a 10% beneficial owner's routine
// rebalance the same as a CEO opening a new position. All automated trading is
// halted while the replacement is built and backtested.
//
// Restore the old page from git history if ever needed.

export const metadata = {
  title: "Paper Portfolio — MacroTilt",
  description: "The MacroTilt paper portfolio is being rebuilt.",
};

export default function PaperPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center px-6 py-24">
      <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        Paper Portfolio
      </p>

      <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
        Under construction
      </h1>

      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-700">
        We have retired the Conviction Events book and are rebuilding the paper
        portfolio from the ground up.
      </p>

      <div className="mt-10 border-l-2 border-neutral-300 pl-6">
        <p className="text-sm leading-relaxed text-neutral-600">
          The previous book selected positions on a single input — the dollar
          value of insider buying — with no test of who was buying, how
          meaningful the purchase was relative to their existing stake, or what
          condition the business was in. We are replacing it with a
          multi-factor model screened for quality, momentum and risk, and we are
          not restarting it until the backtest is complete and independently
          reviewed.
        </p>
      </div>

      <dl className="mt-12 grid grid-cols-1 gap-x-10 gap-y-6 border-t border-neutral-200 pt-8 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Automated trading
          </dt>
          <dd className="mt-1.5 text-sm text-neutral-900">Halted</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Open positions
          </dt>
          <dd className="mt-1.5 text-sm text-neutral-900">None</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Status
          </dt>
          <dd className="mt-1.5 text-sm text-neutral-900">Rebuild in progress</dd>
        </div>
      </dl>

      <p className="mt-12 text-sm text-neutral-500">
        The rest of the site is unaffected.{" "}
        <a href="/macro" className="underline underline-offset-4 hover:text-neutral-800">
          Macro overview
        </a>{" "}
        and{" "}
        <a href="/methodology" className="underline underline-offset-4 hover:text-neutral-800">
          Methodology
        </a>{" "}
        remain live.
      </p>
    </main>
  );
}
