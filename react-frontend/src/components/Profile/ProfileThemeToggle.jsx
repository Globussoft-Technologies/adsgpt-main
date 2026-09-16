import { Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toggleTheme } from '@/store/reducers/theme/themeSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const THEME_APPLY_DELAY_MS = 320;

export default function ProfileThemeToggle({ className = '' }) {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);
  const [visualDarkMode, setVisualDarkMode] = useState(isDarkMode);
  const transitionInProgress = useRef(false);
  const transitionTimer = useRef(null);

  useEffect(() => {
    if (!transitionInProgress.current) {
      setVisualDarkMode(isDarkMode);
    }
  }, [isDarkMode]);

  useEffect(
    () => () => {
      if (transitionTimer.current) {
        window.clearTimeout(transitionTimer.current);
      }
      document.documentElement.classList.remove('theme-changing', 'profile-theme-changing');
    },
    []
  );

  const handleToggle = (e) => {
    if (transitionInProgress.current) return;

    const root = document.documentElement;

    if (e?.clientX && e?.clientY) {
      root.style.setProperty('--theme-toggle-x', `${e.clientX}px`);
      root.style.setProperty('--theme-toggle-y', `${e.clientY}px`);
    } else {
      root.style.setProperty('--theme-toggle-x', '50%');
      root.style.setProperty('--theme-toggle-y', '50%');
    }

    const apply = () => {
      if (isDarkMode) {
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
      }
      dispatch(toggleTheme());
    };

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (typeof document.startViewTransition !== 'function' || prefersReducedMotion) {
      setVisualDarkMode(!isDarkMode);
      apply();
      return;
    }

    transitionInProgress.current = true;
    setVisualDarkMode(!isDarkMode);

    transitionTimer.current = window.setTimeout(() => {
      root.classList.add('theme-changing', 'profile-theme-changing');

      try {
        const transition = document.startViewTransition(() => {
          flushSync(apply);
        });
        transition.finished
          .catch(() => {})
          .finally(() => {
            root.classList.remove('theme-changing', 'profile-theme-changing');
            transitionInProgress.current = false;
            transitionTimer.current = null;
          });
      } catch {
        root.classList.remove('theme-changing', 'profile-theme-changing');
        transitionInProgress.current = false;
        transitionTimer.current = null;
        apply();
      }
    }, THEME_APPLY_DELAY_MS);
  };

  return (
    <ShadcnTooltip label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'} side="top">
      <button
        type="button"
        role="switch"
        aria-checked={isDarkMode}
        aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
        onClick={handleToggle}
        className={`profile-theme-switch group relative isolate grid h-10 w-[168px] cursor-pointer grid-cols-2 overflow-hidden rounded-full border border-white/70 bg-white/[0.45] p-1 text-[13px] font-semibold tracking-[-0.01em] shadow-[0_8px_20px_-4px_rgba(0,0,0,0.08),0_4px_8px_-2px_rgba(0,0,0,0.04),inset_0_1px_1px_0_rgba(255,255,255,0.8)] backdrop-blur-[16px] transition-[border-color,background-color] duration-300 outline-none select-none hover:border-white/85 hover:bg-white/[0.52] focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EE] active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none dark:border-white/[0.07] dark:bg-white/[0.05] dark:shadow-[0_8px_20px_-4px_rgba(0,0,0,0.28),0_4px_8px_-2px_rgba(0,0,0,0.18),inset_0_1px_1px_0_rgba(255,255,255,0.04)] dark:hover:border-white/[0.1] dark:hover:bg-white/[0.065] dark:focus-visible:ring-offset-[#0F0F0F] ${className}`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 left-1 z-0 w-[calc(50%-4px)] rounded-full border transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none ${
            visualDarkMode
              ? 'translate-x-full border-white/[0.08] bg-[linear-gradient(135deg,rgba(52,53,60,0.94),rgba(30,31,36,0.92))] shadow-[0_2px_7px_rgba(0,0,0,0.22),0_1px_2px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.04)]'
              : 'translate-x-0 border-white/90 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_white]'
          }`}
        >
          <span
            className={`absolute inset-x-3 top-0 h-px rounded-full bg-gradient-to-r from-transparent to-transparent transition-opacity duration-300 ${
              visualDarkMode ? 'via-[#8B82A8] opacity-20' : 'via-white opacity-80'
            }`}
          />
        </span>

        <span
          aria-hidden="true"
          className={`relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-full transition-[color,background-color] duration-300 ease-out motion-reduce:transition-none ${
            visualDarkMode
              ? 'text-[#64748B] hover:bg-white/10 dark:text-[#7E8795]'
              : 'text-[#0F172A]'
          }`}
        >
          <Sun
            className={`h-[15px] w-[15px] transition-[color,transform,filter] duration-300 motion-reduce:transition-none ${
              visualDarkMode
                ? 'scale-90 -rotate-45 text-[#94A3B8]'
                : 'scale-100 rotate-0 text-[#8B5CF6] drop-shadow-[0_0_5px_rgba(139,92,246,0.34)]'
            }`}
          />
          <span>Light</span>
        </span>

        <span
          aria-hidden="true"
          className={`relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-full transition-[color,background-color] duration-300 ease-out motion-reduce:transition-none ${
            visualDarkMode
              ? 'text-white'
              : 'text-[#64748B] hover:bg-white/20 dark:text-[#8E96A3] dark:hover:bg-white/[0.05]'
          }`}
        >
          <Moon
            className={`h-3.5 w-3.5 transition-[color,transform,filter] duration-300 motion-reduce:transition-none ${
              visualDarkMode
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
