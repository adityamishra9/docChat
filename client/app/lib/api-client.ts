// app/lib/api-client.ts
"use client";

import { useAuth } from "@clerk/nextjs";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

/** Build a clean error message from responses */
async function toError(res: Response) {
  const ct = res.headers.get("content-type") || "";
  let msg = `HTTP ${res.status}`;
  try {
    if (ct.includes("application/json")) {
      const j = await res.json();
      msg = j?.message || j?.error || msg;
    } else {
      msg = (await res.text()) || msg;
    }
  } catch {
    /* ignore */
  }
  return new Error(msg);
}

/** Generic requester; JSON by default; adds Bearer token if available */
async function coreRequest(
  path: string,
  {
    method = "GET",
    body,
    headers = {},
    json = true,
    authToken,
    timeout = 20_000,
    ...rest
  }: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: any;
    headers?: Record<string, string>;
    json?: boolean; // auto JSON encode/decode
    authToken?: string | null;
    timeout?: number;
    // you can pass any fetch() options in ...rest (e.g. cache, next, etc.)
  } = {}
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const finalHeaders: Record<string, string> = {
    ...(json && !isFormData ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...headers,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: finalHeaders,
    body:
      json && body && !isFormData
        ? JSON.stringify(body)
        : (body as BodyInit | undefined),
    signal: controller.signal,
    credentials: "include",
    ...rest,
  }).finally(() => clearTimeout(t));

  if (!res.ok) throw await toError(res);

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text(); // callers can handle blobs themselves if needed
}

/** Hook for React components (gets Clerk token automatically) */
export function useApi() {
  const { getToken } = useAuth();

  async function request(path: string, opts?: Parameters<typeof coreRequest>[1]) {
    const token = (await getToken?.()) ?? null;
    return coreRequest(path, { ...opts, authToken: token });
  }

  return {
    // convenience helpers
    get: (p: string, o?: any) => request(p, { ...o, method: "GET" }),
    post: (p: string, body?: any, o?: any) =>
      request(p, { ...o, method: "POST", body }),
    put: (p: string, body?: any, o?: any) =>
      request(p, { ...o, method: "PUT", body }),
    patch: (p: string, body?: any, o?: any) =>
      request(p, { ...o, method: "PATCH", body }),
    del: (p: string, o?: any) => request(p, { ...o, method: "DELETE" }),

    /** File uploads (FormData) */
    upload: (p: string, form: FormData, o?: any) =>
      request(p, { ...o, method: "POST", body: form, json: false }),
  };
}

/** Optional: central place to keep route builders */
export const endpoints = {
  docs: {
    list: () => `/documents`,
    get: (id: string) => `/documents/${id}`,
    remove: (id: string) => `/documents/${id}`,
    status: (id: string) => `/documents/${id}/status`,
    removeAll: () => `/documents`, // DELETE
  },
  files: {
    upload: () => `/files/upload`,
    download: (id: string) => `/files/${id}`,
  },
  chat: {
    ask: (docId: string) => `/chat/${docId}`,
    history: (docId: string) => `/chat/${docId}/messages`,
  },
};
