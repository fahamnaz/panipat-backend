const ACCESS_TOKEN_KEY = "auth_access_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";

const canUseStorage = () => typeof window !== "undefined";

export const getAccessToken = () => {
  if (!canUseStorage()) {
    return "";
  }

  return window.localStorage.getItem(ACCESS_TOKEN_KEY) || "";
};

export const getRefreshToken = () => {
  if (!canUseStorage()) {
    return "";
  }

  return window.localStorage.getItem(REFRESH_TOKEN_KEY) || "";
};

export const setAuthTokens = ({ accessToken, refreshToken }) => {
  if (!canUseStorage()) {
    return;
  }

  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }

  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
};

export const clearAuthTokens = () => {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
};
