import { Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleTheme } from '@/store/reducers/theme/themeSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { IS_GLOBAL_THEME_TOGGLE_ENABLED } from '@/utils/featureFlags';

export default function ThemeToggle({ forceShow = false, className = '' }) {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  if (!IS_GLOBAL_THEME_TOGGLE_ENABLED && !forceShow) {
    return null;
  }

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

  return (
    <ShadcnTooltip label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'} side="bottom">
      <button
        type="button"
        role="switch"
        aria-checked={isDarkMode}
        aria-label="Toggle theme"
        onClick={handleToggle}
        className={`group relative flex h-8 w-8 sm:h-8.5 sm:w-8.5 2xl:h-9 2xl:w-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white/80 text-zinc-700 shadow-xs backdrop-blur-md transition-all duration-300 outline-none hover:scale-105 hover:border-black/20 hover:bg-white hover:text-zinc-900 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/50 active:scale-95 dark:border-white/20 dark:bg-white/[0.05] dark:text-zinc-300 dark:shadow-none dark:hover:border-white/35 dark:hover:bg-white/[0.1] dark:hover:text-white ${className}`}
      >
        <Sun
          className={`absolute h-4 w-4 transition-all duration-500 2xl:h-4.5 2xl:w-4.5 ${
            !isDarkMode
              ? 'rotate-90 scale-0 opacity-0'
              : 'rotate-0 scale-100 opacity-100 group-hover:rotate-45'
          }`}
        />
        <Moon
          className={`absolute h-4 w-4 transition-all duration-500 2xl:h-4.5 2xl:w-4.5 ${
            !isDarkMode
              ? 'rotate-0 scale-100 opacity-100 group-hover:-rotate-12'
              : '-rotate-90 scale-0 opacity-0'
          }`}
        />
      </button>
    </ShadcnTooltip>
  );
}
