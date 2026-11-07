import { request } from '@api/http';

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: string;
  username: string;
}

const ACCESS_TOKEN_KEY = 'cd_access_token';
const REFRESH_TOKEN_KEY = 'cd_refresh_token';
const USER_KEY = 'cd_user';

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function saveSession(session: LoginResponse, remember: boolean): void {
  const storage = remember ? window.localStorage : window.sessionStorage;
  const other = remember ? window.sessionStorage : window.localStorage;

  other.removeItem(ACCESS_TOKEN_KEY);
  other.removeItem(REFRESH_TOKEN_KEY);
  other.removeItem(USER_KEY);

  storage.setItem(ACCESS_TOKEN_KEY, session.access_token);
  storage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
  storage.setItem(
    USER_KEY,
    JSON.stringify({ username: session.username, role: session.role }),
  );
}

export function getAccessToken(): string | null {
  return (
    window.localStorage.getItem(ACCESS_TOKEN_KEY) ||
    window.sessionStorage.getItem(ACCESS_TOKEN_KEY)
  );
}

export function getCurrentUser(): { username: string; role: string } | null {
  const raw =
    window.localStorage.getItem(USER_KEY) ||
    window.sessionStorage.getItem(USER_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as { username: string; role: string };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(REFRESH_TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
}
