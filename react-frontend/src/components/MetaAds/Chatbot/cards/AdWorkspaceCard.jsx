import { useState } from 'react';
import { CheckCircle2, Megaphone, Pencil, Save, X } from 'lucide-react';
import toMediaUrl from '@/utils/mediaUrl';

const actionFor = (workspace) => {
  if (workspace.status === 'published') {
    return {
      label: 'Track performance',
      prompt: `Track the Meta ads saved in ad workspace ${workspace.workspaceId}.`,
    };
  }
  if (workspace.status === 'prepared') {
    return {
      label: 'Review & publish',
      prompt: `Review ad workspace ${workspace.workspaceId} for Meta publishing. Show the exact account, campaign, ad set, selected creatives, status, and spend impact before asking for my approval.`,
    };
  }
  return {
    label: 'Prepare for posting',
    prompt: `Prepare ad workspace ${workspace.workspaceId} for Meta posting. Ask only for details that are still missing.`,
  };
};

const AdWorkspaceCard = ({ workspace, onAction, disabled }) => {
  const action = actionFor(workspace);
  const [editing, setEditing] = useState(false);
  const [creatives, setCreatives] = useState(() => workspace.creatives || []);
  const selected = creatives.filter((creative) => creative.selected !== false);
  const setField = (creativeId, field, value) =>
    setCreatives((items) =>
      items.map((item) => (item.creativeId === creativeId ? { ...item, [field]: value } : item)),
    );
  const save = () => {
    onAction?.(
      `Update ad workspace ${workspace.workspaceId} with these exact creative values, then prepare it for posting:\n${JSON.stringify(
        creatives.map(
          ({
            creativeId,
            headline,
            primaryText,
            description,
            callToAction,
            destinationUrl,
            selected: isSelected,
          }) => ({
            creativeId,
            headline,
            primaryText,
            description,
            callToAction,
            destinationUrl,
            selected: isSelected !== false,
          }),
        ),
      )}`,
    );
    setEditing(false);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{workspace.title}</p>
          <p className="text-[11px] text-white/45">
            {workspace.platform || 'meta'} · {workspace.status || 'draft'} · {workspace.workspaceId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspace.status === 'published' && (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          )}
          {workspace.status !== 'published' && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditing((value) => !value)}
              className="rounded-lg border border-white/10 p-1.5 text-white/60 hover:text-white disabled:opacity-40"
              title={editing ? 'Close editor' : 'Edit creatives'}
            >
              {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {(editing ? creatives : selected).map((creative) => (
          <article
            key={creative.creativeId}
            className="overflow-hidden rounded-xl border border-white/10 bg-black/30"
          >
            {creative.imageUrl && (
              <img
                src={toMediaUrl(creative.imageUrl)}
                alt={creative.headline || 'Ad creative'}
                className="aspect-square w-full object-cover"
              />
            )}
            <div className="space-y-1.5 p-3">
              {editing ? (
                <>
                  <label className="flex items-center gap-2 text-[10.5px] text-white/60">
                    <input
                      type="checkbox"
                      checked={creative.selected !== false}
                      onChange={(event) =>
                        setField(creative.creativeId, 'selected', event.target.checked)
                      }
                    />
                    Include this creative
                  </label>
                  {[
                    ['headline', 'Headline'],
                    ['primaryText', 'Primary text'],
                    ['description', 'Description'],
                    ['callToAction', 'CTA'],
                    ['destinationUrl', 'Destination URL'],
                  ].map(([field, label]) => (
                    <label key={field} className="block text-[10px] text-white/45">
                      {label}
                      {field === 'primaryText' ? (
                        <textarea
                          value={creative[field] || ''}
                          onChange={(event) =>
                            setField(creative.creativeId, field, event.target.value)
                          }
                          rows={3}
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none focus:border-[#15DCFF]/60"
                        />
                      ) : (
                        <input
                          value={creative[field] || ''}
                          onChange={(event) =>
                            setField(creative.creativeId, field, event.target.value)
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none focus:border-[#15DCFF]/60"
                        />
                      )}
                    </label>
                  ))}
                </>
              ) : (
                <>
                  <p className="text-[13px] font-semibold text-white">{creative.headline}</p>
                  <p className="line-clamp-3 text-[11.5px] leading-relaxed text-white/60">
                    {creative.primaryText}
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-1.5 text-[10px] text-white/45">
                {creative.callToAction && (
                  <span className="rounded-full bg-white/[0.07] px-2 py-0.5">
                    {creative.callToAction}
                  </span>
                )}
                <span>{creative.creativeId}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
        <div className="text-[11px] text-white/45">
          <p>
            {selected.length} selected
            {workspace.adIds?.length ? ` · ${workspace.adIds.length} published` : ''}
          </p>
          {(workspace.accountId || workspace.pageId || workspace.campaignId || workspace.adSetId) && (
            <p>
              Account {workspace.accountId || 'not selected'} · Page{' '}
              {workspace.pageId || 'not selected'}
            </p>
          )}
          {(workspace.campaignId || workspace.adSetId) && (
            <p>
              Campaign {workspace.campaignId || 'new'} · Ad set {workspace.adSetId || 'new'}
            </p>
          )}
          {(workspace.objective || workspace.dailyBudget) && (
            <p>
              {workspace.objective || 'Objective not selected'}
              {workspace.dailyBudget ? ` · ${workspace.dailyBudget} minor units/day` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => (editing ? save() : onAction?.(action.prompt))}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] px-3 py-1.5 text-[11px] font-semibold text-black disabled:opacity-40"
        >
          {editing ? <Save className="h-3.5 w-3.5" /> : <Megaphone className="h-3.5 w-3.5" />}
          {editing ? 'Save & prepare' : action.label}
        </button>
      </footer>
    </section>
  );
};

export default AdWorkspaceCard;
