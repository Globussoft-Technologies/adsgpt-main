import { BadgeCheck } from 'lucide-react';
import metaIcon from '@/assets/layouts/appsidebar/meta-icon.svg';

const ConnectionStatusCard = () => (
  <div className="flex items-center gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-3">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white">
      <img src={metaIcon} alt="" className="h-7 w-7" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
        Meta Ads connected <BadgeCheck className="h-4 w-4 text-emerald-500" />
      </span>
      <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-white/50">
        You can continue this conversation and access your Meta Ads data securely.
      </span>
    </span>
  </div>
);

export default ConnectionStatusCard;
