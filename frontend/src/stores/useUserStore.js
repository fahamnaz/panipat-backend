import { create } from "zustand";
import axios from "../lib/axios";
import { toast } from "react-hot-toast";
import {
  clearAuthTokens,
  getRefreshToken,
  setAuthTokens,
} from "../lib/auth-storage";

const extractUser = (payload) => {
  if (!payload) {
    return null;
  }

  const { accessToken, refreshToken, ...user } = payload;
  return user;
};

export const useUserStore = create((set, get) => ({
  user: null,
  loading: false,
  checkingAuth: false,

  signup: async ({ name, email, password, confirmPassword }) => {
    set({ loading: true });

    if (password !== confirmPassword) {
      set({ loading: false });
      return toast.error("Passwords do not match");
    }

    try {
      const res = await axios.post("/auth/signup", { name, email, password });
      setAuthTokens(res.data);
      set({ user: extractUser(res.data), loading: false });
      toast.success("Account created Successfully!");
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  login: async (email, password) => {
    set({ loading: true });

    try {
      const res = await axios.post("/auth/login", { email, password });
      setAuthTokens(res.data);
      set({ user: extractUser(res.data), loading: false });
    } catch (error) {
      set({ loading: false });
      toast.error(error.response?.data?.message || "An error occurred");
    }
  },

  logout: async () => {
    try {
      await axios.post("/auth/logout");
      set({ user: null });
    } catch (error) {
      toast.error(
        error.response?.data?.message || "An error occurred during logout"
      );
    } finally {
      clearAuthTokens();
      set({ user: null });
    }
  },

  checkAuth: async () => {
    set({ checkingAuth: true });
    try {
      const response = await axios.get("/auth/profile");
      set({ user: response.data, checkingAuth: false });
    } catch (error) {
      console.log(error.message);
      set({ checkingAuth: false, user: null });
    }
  },

  refreshToken: async () => {
    // Prevent multiple simultaneous refresh attempts
    if (get().checkingAuth) return;

    set({ checkingAuth: true });
    try {
      const refreshToken = getRefreshToken();

      const response = await axios.post("/auth/refresh-token", {
        refreshToken,
      });

      if (response.data?.accessToken) {
        setAuthTokens({ accessToken: response.data.accessToken });
      }

      set({ checkingAuth: false });
      return response.data;
    } catch (error) {
      clearAuthTokens();
      set({ user: null, checkingAuth: false });
      throw error;
    }
  },
}));

// TODO: Implement the axios interceptors for refreshing access token

// Axios interceptor for token refresh
let refreshPromise = null;

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestPath = originalRequest?.url || "";
    const isAuthRefreshRequest = requestPath.includes("/auth/refresh-token");

    if (
      error.response?.status === 401 &&
      !originalRequest?._retry &&
      !isAuthRefreshRequest
    ) {
      originalRequest._retry = true;

      try {
        // If a refresh is already in progress, wait for it to complete
        if (refreshPromise) {
          await refreshPromise;
          return axios(originalRequest);
        }

        // Start a new refresh process
        refreshPromise = useUserStore.getState().refreshToken();
        await refreshPromise;

        return axios(originalRequest);
      } catch (refreshError) {
        // If refresh fails, redirect to login or handle as needed
        useUserStore.getState().logout();
        return Promise.reject(refreshError);
      } finally {
        refreshPromise = null;
      }
    }
    return Promise.reject(error);
  }
);
