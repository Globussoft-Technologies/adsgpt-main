import { Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleTheme } from '@/store/reducers/theme/themeSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

export default function ThemeToggle() {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((state) => state.theme.isDarkMode);

  const handleToggle = () => {
    const root = document.documentElement;
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

    // Disable per-element transitions during the toggle. Otherwise Tailwind's
    // `transition-colors` / `transition-all` utilities start their own color
    // tweens between the class flip and the VT "new" snapshot, so the snapshot
    // captures elements mid-animation and the cross-fade looks staggered.
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
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-black/20 bg-white/70 text-black/70 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:text-black 2xl:h-9 2xl:w-9 dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:text-white"
      >
        <Sun
          className={`absolute h-4 w-4 transition-all duration-500 2xl:h-5 2xl:w-5 ${
            !isDarkMode ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        />
        <Moon
          className={`absolute h-4 w-4 transition-all duration-500 2xl:h-5 2xl:w-5 ${
            !isDarkMode ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
          }`}
        />
      </button>
    </ShadcnTooltip>
  );
}
