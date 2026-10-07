import { Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleTheme } from '@/store/reducers/theme/themeSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

export default function ProfileThemeToggle({ className = '', variant = 'circle' }) {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  const handleToggle = (e) => {
    const root = document.documentElement;

    // Track click coordinates for the circular expanding transition wave
    if (e && e.clientX && e.clientY) {
      root.style.setProperty('--theme-toggle-x', `${e.clientX}px`);
      root.style.setProperty('--theme-toggle-y', `${e.clientY}px`);
    } else {
      const rect = e?.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        root.style.setProperty('--theme-toggle-x', `${rect.left + rect.width / 2}px`);
        root.style.setProperty('--theme-toggle-y', `${rect.top + rect.height / 2}px`);
      } else {
        root.style.setProperty('--theme-toggle-x', '90%');
        root.style.setProperty('--theme-toggle-y', '2rem');
      }
    }

    const apply = () => {
      if (isDarkMode) {
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
      }
      dispatch(toggleTheme());
    };

    if (typeof document.startViewTransition !== 'function') {
      apply();
      return;
    }

    root.classList.add('theme-changing');
    const transition = document.startViewTransition(() => {
      flushSync(apply);
    });
    transition.finished.finally(() => {
      root.classList.remove('theme-changing');
    });
  };

  if (variant === 'circle') {
    return (
      <ShadcnTooltip
        label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        side="bottom"
      >
        <button
          type="button"
          role="switch"
          aria-checked={isDarkMode}
          aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
          onClick={handleToggle}
          className={`group relative inline-flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white/80 text-zinc-700 shadow-xs backdrop-blur-md transition-all duration-300 outline-none hover:scale-105 hover:border-black/20 hover:bg-white hover:text-zinc-900 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/50 active:scale-95 dark:border-white/20 dark:bg-white/[0.05] dark:text-zinc-300 dark:shadow-none dark:hover:border-white/35 dark:hover:bg-white/[0.1] dark:hover:text-white ${className}`}
        >
          <Sun
            className={`absolute h-4 w-4 sm:h-[18px] sm:w-[18px] transition-all duration-500 ${
              !isDarkMode
                ? 'rotate-90 scale-0 opacity-0'
                : 'rotate-0 scale-100 opacity-100 group-hover:rotate-45'
            }`}
          />
          <Moon
            className={`absolute h-4 w-4 sm:h-[18px] sm:w-[18px] transition-all duration-500 ${
              !isDarkMode
                ? 'rotate-0 scale-100 opacity-100 group-hover:-rotate-12'
                : '-rotate-90 scale-0 opacity-0'
            }`}
          />
        </button>
      </ShadcnTooltip>
    );
  }

  return (
    <ShadcnTooltip label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'} side="top">
      <button
        type="button"
        role="switch"
        aria-checked={isDarkMode}
        aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
        onClick={handleToggle}
        className={`profile-theme-switch group relative isolate grid h-9 w-[160px] cursor-pointer grid-cols-2 overflow-hidden rounded-full border border-white/70 bg-white/[0.45] p-0.5 text-xs font-semibold tracking-[-0.01em] shadow-[0_8px_20px_-4px_rgba(0,0,0,0.08),0_4px_8px_-2px_rgba(0,0,0,0.04),inset_0_1px_1px_0_rgba(255,255,255,0.8)] backdrop-blur-[16px] transition-[border-color,background-color] duration-300 outline-none select-none hover:border-white/85 hover:bg-white/[0.52] focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EE] active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none dark:border-white/[0.07] dark:bg-white/[0.05] dark:shadow-[0_8px_20px_-4px_rgba(0,0,0,0.28),0_4px_8px_-2px_rgba(0,0,0,0.18),inset_0_1px_1px_0_rgba(255,255,255,0.04)] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.065] dark:focus-visible:ring-offset-[#0F0F0F] ${className}`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0.5 left-0.5 z-0 w-[calc(50%-2px)] rounded-full border transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none ${
            isDarkMode
              ? 'translate-x-full border-white/[0.08] bg-[linear-gradient(135deg,rgba(52,53,60,0.94),rgba(30,31,36,0.92))] shadow-[0_2px_7px_rgba(0,0,0,0.22),0_1px_2px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.04)]'
              : 'translate-x-0 border-white/90 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_white]'
          }`}
        >
          <span
            className={`absolute inset-x-3 top-0 h-px rounded-full bg-gradient-to-r from-transparent to-transparent transition-opacity duration-300 ${
              isDarkMode ? 'via-[#8B82A8] opacity-20' : 'via-white opacity-80'
            }`}
          />
        </span>

        <span
          aria-hidden="true"
          className={`relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-full transition-[color,background-color] duration-300 ease-out motion-reduce:transition-none ${
            isDarkMode
              ? 'text-[#64748B] hover:bg-white/10 dark:text-[#7E8795]'
              : 'text-[#0F172A]'
          }`}
        >
          <Sun
            className={`h-3.5 w-3.5 transition-[color,transform,filter] duration-300 motion-reduce:transition-none ${
              isDarkMode
                ? 'scale-90 -rotate-45 text-[#94A3B8]'
                : 'scale-100 rotate-0 text-[#8B5CF6] drop-shadow-[0_0_5px_rgba(139,92,246,0.34)]'
            }`}
          />
          <span>Light</span>
        </span>

        <span
          aria-hidden="true"
          className={`relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-full transition-[color,background-color] duration-300 ease-out motion-reduce:transition-none ${
            isDarkMode
              ? 'text-white'
              : 'text-[#64748B] hover:bg-white/20 dark:text-[#8E96A3] dark:hover:bg-white/[0.05]'
          }`}
        >
          <Moon
            className={`h-3.5 w-3.5 transition-[color,transform,filter] duration-300 motion-reduce:transition-none ${
              isDarkMode
                ? 'scale-100 rotate-0 text-[#C4B5FD] drop-shadow-[0_0_5px_rgba(196,181,253,0.28)]'
                : 'scale-95 rotate-12 text-[#94A3B8]'
            }`}
          />
          <span>Dark</span>
        </span>
      </button>
    </ShadcnTooltip>
  );
}
