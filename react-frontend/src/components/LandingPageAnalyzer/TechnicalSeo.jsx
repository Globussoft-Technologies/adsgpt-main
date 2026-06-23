import { Card, PriorityBadge, SectionTitle } from './_atoms';
import { priorityRank } from './helpers';

// BLOCK 5 — Technical SEO. Grid table, priority-sorted.
export default function TechnicalSeo({ report }) {
  const rows = [...(report?.technical_seo || [])].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
  );

  return (
    <>
      <SectionTitle hint="Crawl-level issues affecting indexing and performance.">
        Technical SEO
      </SectionTitle>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-160">
            <div className="grid grid-cols-[1.5fr_0.6fr_2.4fr] border-b border-gray-200 bg-gray-50 px-6 py-4 text-13 font-extrabold uppercase tracking-wide text-gray-400 dark:border-white/10 dark:bg-white/2 dark:text-white/45">
              <span>Issue</span>
              <span>Priority</span>
              <span>Recommended Fix</span>
            </div>
            {rows.map((r, i) => (
              <div
                key={i}
                className={`grid grid-cols-[1.5fr_0.6fr_2.4fr] items-center px-6 py-4.5 text-sm 2xl:text-base transition-colors hover:bg-gray-50 dark:hover:bg-white/2 ${
                  i ? 'border-t border-gray-100 dark:border-white/6' : ''
                }`}
              >
                <span className="pr-3 font-semibold text-gray-900 dark:text-white">{r.issue}</span>
                <span>
                  <PriorityBadge priority={r.priority} />
                </span>
                <span className="pl-3 leading-relaxed text-gray-500 dark:text-white/60">
                  {r.fix}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
