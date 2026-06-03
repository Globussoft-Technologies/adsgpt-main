import React, { useState, useEffect } from 'react';
import Cookies from 'js-cookie'; // Include the js-cookie library
import getCookies, { deleteCookie } from '@/utils/getCookies';
import { Loader } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { initSocket } from '@/store/reducers/socket/socketSlice';

const HOST = import.meta.env.VITE_SOCKET_URL;

const AMEMBER_HOST = import.meta.env.VITE_AMEMBER_URL;
const REDIRECT_LOGIN = AMEMBER_HOST + '/login';
const REDIRECT_MEMBER_PAGE = AMEMBER_HOST + '/member/index';
function RunBackLog({ children }) {
  const dispatch = useDispatch();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isLoadingQueryBacklog, setIsLoadingQueryBcklog] = useState(false);
  // --- NEW API-based query handling ---
  useEffect(() => {
    async function handleQueryRedirect() {
      const urlParams = new URLSearchParams(window.location.search);
      const forwardKey = urlParams.get('forword');

      if (forwardKey) {
        try {
          setIsLoadingQueryBcklog(true);
          const response = await fetch(`${HOST}/adsgpt/backup/${forwardKey}`);
          const result = await response.json();

          if (result?.success && result?.data?.query) {
            const updatedUrl = `${window.location.pathname}${result.data.query}`;

            // Set token if provided
            if (result.data.token) {
              const domain = `.${window.location.hostname.split('.').slice(-2).join('.')}`;
              Cookies.set('access-token', result.data.token, {
                expires: 1,
                path: '/',
                secure: true,
                domain,
              });
              setIsLoadingQueryBcklog(false);
            }

            // Redirect to updated URL
            window.location.href = updatedUrl;
            return;
          }
        } catch (err) {
          console.error('Error fetching query from API:', err);
        }
      }
    }

    handleQueryRedirect();
  }, []);

  // --- EXISTING amember login/token logic ---
  useEffect(() => {
    
    const userName = Cookies.get('amember_login') || 'Gajendratest';
    const password = Cookies.get('amember_pass') || 'gajendratest';
    const urlParams = new URLSearchParams(window.location.search);
    const forwardKey = urlParams.get('forword');

    if (!(userName && password) && !getCookies() && !forwardKey) {
      window.location.href = REDIRECT_LOGIN;
      return;
    }

    async function checkAccess() {
      try {
        const fields = {
          login: userName,
          pass: password,
        };

        const response = await fetch(`${HOST}/adsgpt/check-access/by-login-pass`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(fields),
        });

        const result = JSON.parse(await response.text());
        if (!result?.ok) {
          window.location.href = REDIRECT_LOGIN;
          return;
        }

        if (result?.expired === true) {
          window.location.href = REDIRECT_MEMBER_PAGE;
          return;
        }

        const token = result?.token;
        if (token) {
          const domain = `.${window.location.hostname.split('.').slice(-2).join('.')}`;
          Cookies.set('access-token', token, {
            expires: 1,
            path: '/',
            secure: true,
            domain,
          });

          deleteCookie('amember_login');
          deleteCookie('amember_pass');
        }

        setIsLoading(false);
      } catch (err) {
        setError(err.message);
      }
    }

    if (userName && password) {
      checkAccess();
    } else {
      setIsLoading(false);
    }
  }, []);

  if (isLoading || isLoadingQueryBacklog) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-gray-600" />
      </div>
    );
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (Cookies.get('access-token')) {
    dispatch(initSocket(import.meta.env.VITE_SOCKET_URL));
    return <>{children}</>;
  }
}

export default RunBackLog;
