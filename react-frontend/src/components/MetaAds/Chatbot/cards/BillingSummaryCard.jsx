import React from 'react';
import { CreditCard } from 'lucide-react';

const BillingSummaryCard = ({ paymentMethod, amountDue, nextBillDate, accountStatus }) => (
  <div className="rounded-xl border border-gray-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    <div className="flex items-center gap-2">
      <CreditCard className="h-4 w-4 text-gray-400 dark:text-white/40" />
      <p className="text-sm font-semibold text-gray-900 dark:text-white">Billing</p>
      {accountStatus && (
        <span className="ml-auto text-[11px] font-medium text-gray-500 dark:text-gray-400">{accountStatus}</span>
      )}
    </div>
    <div className="mt-2.5 grid grid-cols-2 gap-2">
      {amountDue && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Amount due</p>
          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">{amountDue}</p>
        </div>
      )}
      {nextBillDate && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Next bill</p>
          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">{nextBillDate}</p>
        </div>
      )}
    </div>
    {paymentMethod && (
      <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">Payment method: {paymentMethod}</p>
    )}
  </div>
);

export default BillingSummaryCard;
