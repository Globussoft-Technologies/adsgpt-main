import { deleteCookie } from '@/utils/getCookies';

const VITE_SITE = import.meta.env.VITE_SITE;

export function logout(domain = VITE_SITE === 'DEV' ? '.poweradspy.com' : '.adsgpt.io') {
  const queryKey = 'access-token';

  // Preserve isDarkMode state
  const isDarkMode = localStorage.getItem('isDarkMode');

  // Clear cookies for the specified domain
  document.cookie = `${queryKey}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;`;
  document.cookie.split(';').forEach(function (cookie) {
    document.cookie = cookie
      .replace(/^ +/, '')
      .replace(/=.*/, '=; expires=' + new Date(0).toUTCString() + '; path=/; domain=' + domain);
  });

  // Clear local storage but restore isDarkMode
  localStorage.clear();
  if (isDarkMode) {
    localStorage.setItem('isDarkMode', isDarkMode);
  }

  // Clear session storage
  sessionStorage.clear();

  // Delete specific cookie
  deleteCookie('access-token');
}
