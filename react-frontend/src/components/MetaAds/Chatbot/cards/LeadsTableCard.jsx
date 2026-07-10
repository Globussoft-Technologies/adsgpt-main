import React from 'react';

const LeadsTableCard = ({ title, leads = [] }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
    {title && (
      <p className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 dark:border-white/5 dark:text-white">
        {title}
      </p>
    )}
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-gray-400 dark:text-gray-500">
            <th className="px-3 py-1.5 font-medium">Name</th>
            <th className="px-3 py-1.5 font-medium">Contact</th>
            <th className="px-3 py-1.5 font-medium">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-white/5">
              <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white">{lead.name || '—'}</td>
              <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                {lead.email || lead.phone || '—'}
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-400">
                {lead.submittedAt || '—'}
              </td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center text-gray-400 dark:text-gray-500">
                No leads in range
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default LeadsTableCard;
