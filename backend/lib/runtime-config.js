const DEFAULT_FRONTEND_URL = "https://panipat-frontend.vercel.app";

const DEFAULT_FRONTEND_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  DEFAULT_FRONTEND_URL,
];

const normalizeUrl = (value = "") => value.trim().replace(/\/+$/, "");

const parseHostname = (value = "") => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const parseUrlList = (...values) => {
  const urls = values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => normalizeUrl(value))
    .filter(Boolean);

  return [...new Set(urls)];
};

export const FRONTEND_ORIGINS = parseUrlList(
  process.env.CLIENT_URLS,
  process.env.CLIENT_URL,
  ...DEFAULT_FRONTEND_ORIGINS
);

const configuredClientUrl = normalizeUrl(process.env.CLIENT_URL);

export const IS_PRODUCTION =
  process.env.NODE_ENV === "production" ||
  (!!configuredClientUrl &&
    configuredClientUrl.startsWith("https://") &&
    !configuredClientUrl.includes("localhost"));

export const CLIENT_URL =
  configuredClientUrl &&
  (!IS_PRODUCTION || !configuredClientUrl.includes("localhost"))
    ? configuredClientUrl
    : DEFAULT_FRONTEND_URL;

const canonicalFrontendHostname = parseHostname(CLIENT_URL);
const canonicalFrontendLabel = canonicalFrontendHostname.split(".")[0] || "";

const isTrustedVercelPreviewOrigin = (origin) => {
  const originHostname = parseHostname(origin);

  if (!originHostname.endsWith(".vercel.app")) {
    return false;
  }

  if (!canonicalFrontendHostname.endsWith(".vercel.app")) {
    return false;
  }

  return (
    originHostname === canonicalFrontendHostname ||
    originHostname.startsWith(`${canonicalFrontendLabel}-`)
  );
};

export const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeUrl(origin);

  return (
    FRONTEND_ORIGINS.includes(normalizedOrigin) ||
    isTrustedVercelPreviewOrigin(normalizedOrigin)
  );
};

export const buildClientUrl = (path = "") => {
  if (!path) {
    return CLIENT_URL;
  }

  return `${CLIENT_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

export const getCookieOptions = (maxAge) => {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? "none" : "lax",
    path: "/",
    ...(typeof maxAge === "number" ? { maxAge } : {}),
  };
};
