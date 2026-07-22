import { ArrowRight } from 'lucide-react';
import metaIcon from '@/assets/layouts/appsidebar/meta-icon.svg';

const MetaConnectCard = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="not-prose group mt-3 flex w-full max-w-xl items-center gap-4 rounded-2xl border border-white/10 bg-[#171717] p-4 text-left shadow-lg transition hover:-translate-y-0.5 hover:border-[#1877F2]/60 hover:bg-[#1B1B1B] focus-visible:ring-2 focus-visible:ring-[#1877F2] focus-visible:outline-none"
    aria-label="Open Ads Manager to connect Meta Ads"
  >
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white">
      <img src={metaIcon} alt="" className="h-8 w-8" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-semibold text-white">Connect Meta Ads</span>
      <span className="mt-0.5 block text-[12px] leading-relaxed text-white/55">
        Open Ads Manager to securely connect your account
      </span>
    </span>
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-white transition group-hover:bg-[#166FE5]">
      <ArrowRight className="h-4 w-4" />
    </span>
  </button>
);

export default MetaConnectCard;
