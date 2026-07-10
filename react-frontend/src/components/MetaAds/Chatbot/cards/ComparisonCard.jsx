import React from 'react';

// Comparison table across entities; the highlighted row (the winner) gets an
// accent background. Scrolls horizontally if columns overflow the sidebar.
const ComparisonCard = ({ title, columns = [], rows = [], highlightIndex }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    {title && (
      <p className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
    )}
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-gray-400 dark:text-gray-500">
            {columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const highlight = ri === highlightIndex;
            return (
              <tr
                key={ri}
                className={
                  highlight
                    ? 'rounded bg-[#15DCFF]/10 font-medium text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`whitespace-nowrap px-2 py-1.5 ${
                      highlight && ci === 0 ? 'text-[#0082FB] dark:text-[#15DCFF]' : ''
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export default ComparisonCard;
