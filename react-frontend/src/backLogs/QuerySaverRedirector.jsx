import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Cookies from 'js-cookie';
import Swal from 'sweetalert2';
import { logout } from '@/hooks/logout';
import 'sweetalert2/dist/sweetalert2.min.css';

const REDIRECT_LOGOUT = import.meta.env.VITE_AMEMBER_URL;
const POPUP_SHOWN_COOKIE = 'popup_shown';

const QuerySaverRedirector = ({ targetUrl }) => {
  const location = useLocation();

  useEffect(() => {
    // Extract query string from the current route
    const query = location.search;
    if (query) {
      // Save query in a cookie
      Cookies.set('savedQuery', query, { expires: 1, path: '/', secure: true });
    }

    // Check if the user is already logged in (presence of "access-token")
    const accessToken = Cookies.get('access-token');
    const userName = Cookies.get('user_name');
    const userEmail = Cookies.get('user_email');
    const popupShown = Cookies.get(POPUP_SHOWN_COOKIE);

    if (accessToken && !popupShown) {
      // Show SweetAlert popup only if it hasn't been shown before
      Swal.fire({
        title: 'Already Logged In',
        text: `You are logged in as ${userName} (${userEmail}). Do you want to continue?`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Continue',
        cancelButtonText: 'Logout',
        reverseButtons: true,

        // 🌙 Dark theme customization
        background: '#1e1e1e',
        color: '#ffffff',
        iconColor: '#4fc3f7',
        confirmButtonColor: '#00bfa5',
        cancelButtonColor: '#f44336',
        customClass: {
          popup: 'dark-popup',
          title: 'dark-title',
          content: 'dark-content',
          confirmButton: 'dark-confirm',
          cancelButton: 'dark-cancel',
        },
      }).then((result) => {
        // Set cookie to remember popup was shown (expires in 6 hours)
        Cookies.set(POPUP_SHOWN_COOKIE, 'true', {
          expires: 0.25, // 6 hours (0.25 of a day)
          path: '/',
          secure: true,
        });

        if (result.isConfirmed) {
          const redirectUrl = query ? `${targetUrl}${query}` : targetUrl;
          window.location.href = redirectUrl;
        } else {
          logout(); // Logout the user
          window.location.href = REDIRECT_LOGOUT + '/logout'; // Redirect to logout page
        }
      });
    } else {
      // If no access token or popup was already shown, proceed with normal redirection
      const redirectUrl = query ? `${targetUrl}${query}` : targetUrl;
      window.location.href = redirectUrl;
    }
  }, [location.search, targetUrl]);

  return null; // This component does not render anything
};

export default QuerySaverRedirector;
