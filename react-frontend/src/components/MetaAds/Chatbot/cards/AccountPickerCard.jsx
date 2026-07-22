import { Building2, ChevronRight } from 'lucide-react';

const AccountPickerCard = ({ title = 'Choose a Meta ad account', accounts = [], onAction, disabled }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
    <div className="border-b border-gray-200 px-3 py-2.5 dark:border-white/10">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
        Select the account you want this conversation to use.
      </p>
    </div>
    <div className="max-h-80 overflow-y-auto p-2">
      {accounts.map((account, index) => {
        const id = String(account.id || account.accountId || '');
        const name = account.name || `Ad account ${id}`;
        return (
          <button
            key={id || index}
            type="button"
            disabled={disabled || !id}
            onClick={() => onAction?.(`Use Meta ad account "${name}" (${id}) for this conversation, then continue my request.`)}
            className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-white/[0.06]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1877F2]/10 text-[#1877F2]">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">{name}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-gray-500 dark:text-white/45">
                <span>{id}</span>
                {account.currency && <span>{account.currency}</span>}
                {account.status && <span>{account.status}</span>}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
          </button>
        );
      })}
    </div>
  </div>
);

export default AccountPickerCard;
