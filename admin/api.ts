import type { Picture } from "./types";

const TOKEN_KEY = "admin_token";
let token: string | null = localStorage.getItem(TOKEN_KEY);

export function hasToken() {
  return token !== null;
}

function signOut() {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("admin:signed-out"));
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") signOut();
    throw new ApiError(data.error ?? `Something went wrong (${res.status})`, res.status);
  }
  return data as T;
}

export async function login(password: string) {
  const { token: t } = await apiFetch<{ token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  token = t;
  localStorage.setItem(TOKEN_KEY, t);
}

export const verify = () => apiFetch<{ valid: boolean }>("/auth/verify");
export const getContent = <T>(file: string) => apiFetch<T>(`/content/${file}`);
export const putContent = (file: string, body: unknown) =>
  apiFetch<{ success: true }>(`/content/${file}`, { method: "PUT", body: JSON.stringify(body) });

function form(file: File, kind: "image" | "file") {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  return fd;
}

/** Low-level: the server answers `{ picture }` on picture sites, `{ url }` on single-JPEG sites and for kind=file. */
export const upload = (file: File, kind: "image" | "file") =>
  apiFetch<{ kind: typeof kind; picture?: Picture; url?: string }>("/upload", { method: "POST", body: form(file, kind) });

/** Photos → responsive Picture (sites with `image.kind: "picture"`). */
export const uploadImage = (file: File) => upload(file, "image").then((r) => r.picture!);
/** Photos → one JPEG path (sites with `image.kind: "jpeg"`). */
export const uploadJpeg = (file: File) => upload(file, "image").then((r) => r.url!);
/** Raw files (logos, video, audio) → plain URL. */
export const uploadFile = (file: File) => upload(file, "file").then((r) => r.url!);
