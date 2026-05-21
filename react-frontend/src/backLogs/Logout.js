import React, { useEffect } from 'react';
import { logout } from '@/hooks/logout';

const Logout = ({ targetUrl }) => {
  useEffect(() => {
    const performLogout = async () => {
      await logout(); // Ensure logout is completed before redirecting
      window.location.href = targetUrl;
    };

    performLogout();
  }, [targetUrl]);

  return null; // No need to return an empty fragment
};

export default Logout;
