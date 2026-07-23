import React, { useEffect } from 'react';
import { logout } from '@/hooks/logout';

const Logout = ({ targetUrl }) => {
  useEffect(() => {
    const performLogout = async () => {
      try {
        await fetch(`${import.meta.env.VITE_SOCKET_URL}/adsgpt/auth/amember/logout`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch (error) {
        console.error('Failed to clear the server session:', error);
      }
      await logout(); // Clear legacy client-readable cookies too.
      window.location.href = targetUrl;
    };

    performLogout();
  }, [targetUrl]);

  return null; // No need to return an empty fragment
};

export default Logout;
