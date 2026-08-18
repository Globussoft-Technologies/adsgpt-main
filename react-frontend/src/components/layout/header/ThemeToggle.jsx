import { Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleTheme } from '@/store/reducers/theme/themeSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

export default function ThemeToggle() {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  const handleToggle = (e) => {
    const root = document.documentElement;

    // Track click coordinates for the circular expanding transition wave
    if (e && e.clientX && e.clientY) {
      root.style.setProperty('--theme-toggle-x', `${e.clientX}px`);
      root.style.setProperty('--theme-toggle-y', `${e.clientY}px`);
    } else {
      root.style.setProperty('--theme-toggle-x', '90%');
      root.style.setProperty('--theme-toggle-y', '2rem');
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
    <ShadcnTooltip label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}>
      <button
        type="button"
        aria-label="Toggle theme"
        onClick={handleToggle}
        className="group relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white/80 text-zinc-700 backdrop-blur-md transition-all duration-300 hover:scale-105 active:scale-95 2xl:h-9 2xl:w-9 lm-pill-btn shadow-sm hover:text-zinc-900 dark:border-white/20 dark:bg-[#0D0D0D]/70 dark:text-[#AFAFAF] dark:hover:border-white/40 dark:hover:text-white"
      >
        <Sun
          className={`absolute h-4 w-4 transition-all duration-500 2xl:h-5 2xl:w-5 ${
            !isDarkMode
              ? 'rotate-90 scale-0 opacity-0'
              : 'rotate-0 scale-100 opacity-100 group-hover:rotate-45'
          }`}
        />
        <Moon
          className={`absolute h-4 w-4 transition-all duration-500 2xl:h-5 2xl:w-5 ${
            !isDarkMode
              ? 'rotate-0 scale-100 opacity-100 group-hover:-rotate-12'
              : '-rotate-90 scale-0 opacity-0'
          }`}
        />
      </button>
    </ShadcnTooltip>
  );
}
