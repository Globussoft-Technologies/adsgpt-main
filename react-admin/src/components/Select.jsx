import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

export default function Select({
  value,
  onChange,
  options,
  leadingIcon: LeadingIcon,
  placeholder = "Select...",
  className = "",
}) {
  const current = options.find((o) => o.value === value);
  const label = current?.label || placeholder;

  return (
    <RSelect.Root value={value} onValueChange={onChange}>
      <RSelect.Trigger
        title={label}
        className={
          "group inline-flex min-w-[12rem] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:border-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 data-[state=open]:border-indigo-500 data-[state=open]:ring-4 data-[state=open]:ring-indigo-100 " +
          className
        }
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {LeadingIcon ? <LeadingIcon className="h-4 w-4 shrink-0 text-slate-400" /> : null}
          <RSelect.Value placeholder={placeholder}>{label}</RSelect.Value>
        </span>
        <RSelect.Icon>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-data-[state=open]:rotate-180" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),20rem)] min-w-[var(--radix-select-trigger-width)] max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
        >
          <RSelect.Viewport className="max-h-[19rem] overflow-y-auto overscroll-contain pr-1">
            {options.map((opt) => (
              <RSelect.Item
                key={opt.value}
                value={opt.value}
                title={opt.label}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-slate-700 outline-none transition data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 data-[state=checked]:font-medium data-[state=checked]:text-indigo-700"
              >
                {opt.icon ? <opt.icon className="h-4 w-4 shrink-0 text-slate-400" /> : null}
                <RSelect.ItemText>
                  <span className="block max-w-[22rem] truncate">{opt.label}</span>
                </RSelect.ItemText>
                <RSelect.ItemIndicator className="ml-auto shrink-0">
                  <Check className="h-4 w-4 text-indigo-600" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
