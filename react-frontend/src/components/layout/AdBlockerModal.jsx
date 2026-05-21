import React from 'react';

export default function AdBlockerModal() {
  const [adBlockDetected, setAdBlockDetected] = React.useState(false);
  const [isChecking, setIsChecking] = React.useState(true);

  // Function to detect ad blockers
  const detectAdBlocker = React.useCallback(async () => {
    setIsChecking(true);

    try {
      // Method 1: Bait Element Detection
      // Create a fake ad element that ad blockers typically block
      const baitElement = document.createElement('div');
      baitElement.className =
        'ad ads adsbox doubleclick ad-placement ad-placeholder adbadge BannerAd';
      baitElement.style.cssText =
        'position: absolute; top: -1px; left: -1px; width: 1px; height: 1px;';
      document.body.appendChild(baitElement);

      // Wait a bit for ad blockers to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if element was hidden or removed
      const isBlocked =
        baitElement.offsetParent === null ||
        baitElement.offsetHeight === 0 ||
        baitElement.offsetLeft === 0 ||
        baitElement.offsetTop === 0 ||
        baitElement.offsetWidth === 0 ||
        baitElement.clientHeight === 0 ||
        baitElement.clientWidth === 0 ||
        window.getComputedStyle(baitElement).display === 'none' ||
        window.getComputedStyle(baitElement).visibility === 'hidden';

      // Clean up
      document.body.removeChild(baitElement);

      if (isBlocked) {
        setAdBlockDetected(true);
        setIsChecking(false);
        return;
      }

      // Method 2: Check for Brave Browser (has built-in shields)
      if (navigator.brave && (await navigator.brave.isBrave())) {
        setAdBlockDetected(true);
        setIsChecking(false);
        return;
      }

      // Method 3: Try to fetch a common ad script
      try {
        await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
        });
        // If we get here without error, no ad blocker detected
        setAdBlockDetected(false);
      } catch {
        // Fetch was blocked
        setAdBlockDetected(true);
      }
    } catch (error) {
      console.error('Error detecting ad blocker:', error);
      // On error, assume no ad blocker to avoid false positives
      setAdBlockDetected(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Run detection on mount
  React.useEffect(() => {
    detectAdBlocker();
  }, [detectAdBlocker]);

  // Handle "Try Again" button
  const handleTryAgain = () => {
    detectAdBlocker();
  };

  // Don't show anything while checking or if no ad blocker detected
  if (isChecking || !adBlockDetected) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0D0D]/90 p-4">
      <div className="w-full max-w-xl scale-75 rounded-2xl border border-white/10 bg-[#303030]/50 p-8 backdrop-blur-[100px] md:p-10 2xl:scale-100">
        <h1 className="mb-6 text-center text-2xl font-bold text-white md:text-3xl">
          Oops! Ad Blocker Detected
        </h1>

        <div className="mb-8 space-y-4">
          <p className="text-center text-sm leading-relaxed text-[#AFAFAF] md:text-xl">
            Please disable your Ad Blocker or whitelist{' '}
            <a
              href="https://adsgpt.io"
              className="text-[#5D69F6] transition-colors hover:text-blue-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              adsgpt.io
            </a>
          </p>

          <p className="text-center text-xs leading-6 text-gray-400 md:text-xl">
            Some features may not work while an Ad Blocker is enabled. Meanwhile, explore our
            product:{' '}
            <a
              href="https://adsgpt.io"
              className="text-[#5D69F6] transition-colors hover:text-blue-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              adsgpt.io
            </a>
          </p>
        </div>

        <div className="flex justify-center">
          <button
            onClick={handleTryAgain}
            disabled={isChecking}
            className="prompt_selection_button rounded-full px-8 py-3 text-sm font-medium transition-all duration-300 hover:bg-blue-500 hover:text-white focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-zinc-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-base"
          >
            <span className="bg-gradient-to-b from-[#15DCFF] to-[#5E66F5] bg-clip-text text-xl font-medium text-transparent hover:from-white hover:to-white">
              {isChecking ? 'Checking...' : 'Try Again'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
