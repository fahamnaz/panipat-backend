import axios from "axios";

const LIVE_API_BASE_URL = "https://panipat-backend.onrender.com/api";
const LOCAL_API_BASE_URL = "http://localhost:5001/api";

const normalizeApiUrl = (value) => {
  if (!value) {
    return "";
  }

  const trimmedValue = value.trim().replace(/\/+$/, "");
  return trimmedValue.endsWith("/api") ? trimmedValue : `${trimmedValue}/api`;
};

const resolveApiBaseUrl = () => {
  const configuredUrl = normalizeApiUrl(import.meta.env.VITE_API_URL);

  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window === "undefined") {
    return LIVE_API_BASE_URL;
  }

  const isLocalHost = ["localhost", "127.0.0.1"].includes(
    window.location.hostname
  );

  if (import.meta.env.DEV) {
    return "/api";
  }

  return isLocalHost ? LOCAL_API_BASE_URL : LIVE_API_BASE_URL;
};

const axiosInstance = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
});

export default axiosInstance;
