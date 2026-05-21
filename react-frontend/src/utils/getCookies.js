import Cookies from 'js-cookie';

function getCookies() {
  return Cookies.get('access-token') || null;
}

export function deleteCookie(name, path = '/') {
  const domain = `.${window.location.hostname.split('.').slice(-2).join('.')}`;
  document.cookie = `${name}=; domain=${domain}; path=${path}; expires=Thu, 01 Jan 1970 00:00:00 UTC;`;
}

export default getCookies;
