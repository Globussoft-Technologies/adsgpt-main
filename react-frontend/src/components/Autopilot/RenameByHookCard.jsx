import React, { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Wand2 } from 'lucide-react';
import { renameByHook } from '@/apis/autopilot/autopilotApi';
import { Dropdown } from '@/components/MetaAds/MetaAdsAtoms';
import { Section, PrimaryButton } from './_atoms';

/**
 * Self-contained "Suggest ad name updates" tool — was previously in the
 * Autopilot Settings tab but lived there as a misfit (it's a one-shot
 * operation, not a preference). Lives on the Overview tab now.
 *
 * Picks one account, scans active ads, shows the proposed [Hook] <first-line>
 * names. Always dry-run from the UI — applies are a follow-up step.
 */
const RenameByHookCard = ({ adAccounts = [] }) => {
  const [selectedId, setSelectedId] = useState('');
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // Default-pick the first account once the list hydrates.
  useEffect(() => {
    if (!adAccounts.length) return;
    setSelectedId((prev) =>
      prev && adAccounts.find((a) => a.id === prev) ? prev : adAccounts[0].id,
    );
  }, [adAccounts]);

  const onRun = async () => {
    if (!selectedId) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await renameByHook({
        adAccountId: selectedId,
        dryRun: true,
        limit: 50,
      });
      setResult(r);
    } catch (e) {
      setResult({
        status: false,
        error: e?.response?.data?.error || e.message,
      });
    } finally {
      setRunning(false);
    }
  };

  const selected = adAccounts.find((a) => a.id === selectedId);

  return (
    <Section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[240px]">
          <h3 className="text-base font-bold text-white">
            Suggest ad name updates
          </h3>
          <p className="mt-1 text-13 text-[#BEBEBE]">
            Scan active ads and suggest cleaner names tagged with the first
            line of each ad's copy as a "hook" — easier to tell which sales
            angle is winning. Nothing is renamed until you apply them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dropdown
            direction="up"
            open={open}
            onClose={() => setOpen(false)}
            trigger={
              <button
                type="button"
                onClick={() => setOpen((p) => !p)}
                disabled={running || adAccounts.length === 0}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white transition-all hover:border-white/10 disabled:opacity-50"
              >
                <span className="max-w-45 truncate font-medium">
                  {adAccounts.length === 0
                    ? 'No ad accounts'
                    : selected?.name || 'Pick one'}
                </span>
                <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
              </button>
            }
          >
            <div className="w-72 p-1">
              <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
                {adAccounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setSelectedId(a.id);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-all hover:bg-white/5 ${
                      selectedId === a.id ? 'bg-white/5' : ''
                    }`}
                  >
                    <span
                      className={`text-xs font-medium ${
                        selectedId === a.id ? 'text-[#15DCFF]' : 'text-white'
                      }`}
                    >
                      {a.name}
                    </span>
                    <span className="text-10 font-mono text-white/50">
                      act_{a.id}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Dropdown>
          <PrimaryButton onClick={onRun} disabled={running || !selectedId}>
            {running ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Scanning…
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3" /> Propose renames
              </>
            )}
          </PrimaryButton>
        </div>
      </div>
      {result && <RenameResultTable result={result} />}
    </Section>
  );
};

const RenameResultTable = ({ result }) => {
  if (result.error) {
    return <div className="mt-3 text-xs text-red-400">{result.error}</div>;
  }
  return (
    <div className="mt-3">
      <div className="mb-2 text-10 text-white/50">
        scanned {result.total_ads_scanned} · proposed {result.proposed} · would
        rename {result.would_rename} · no body {result.skipped_no_body} ·
        unchanged {result.skipped_unchanged}
      </div>
      {!!result.actions?.length && (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/6 bg-white/2 text-left">
                <th className="px-3 py-2 text-10 font-medium uppercase tracking-wider text-white/40">
                  Current name
                </th>
                <th className="px-3 py-2 text-10 font-medium uppercase tracking-wider text-white/40">
                  Proposed rename
                </th>
                <th className="px-3 py-2 text-10 font-medium uppercase tracking-wider text-white/40">
                  Hook source
                </th>
              </tr>
            </thead>
            <tbody>
              {result.actions.map((a) => (
                <tr
                  key={a.adId}
                  className="border-b border-white/6 align-top last:border-b-0 hover:bg-white/2"
                >
                  <td className="px-3 py-2 text-white/80">{a.prev_name}</td>
                  <td className="px-3 py-2 font-medium text-white">
                    {a.proposed_name}
                  </td>
                  <td className="max-w-sm px-3 py-2 italic text-white/50">
                    "{a.hook}"
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RenameByHookCard;
