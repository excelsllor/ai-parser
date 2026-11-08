import { request } from '@api/http';

export interface CurrentUser {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  display_name: string;
  department: string;
  email: string | null;
  created_at: string;
}

export interface ProfileSession {
  id: string;
  created_at: string;
  expires_at: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: string;
  username: string;
}

export interface AuthProviders {
  yandex: boolean;
  vk: boolean;
}

export type OAuthProvider = 'yandex' | 'vk';

export function fetchAuthProviders(): Promise<AuthProviders> {
  return request<AuthProviders>('/auth/providers');
}

export async function startOAuth(provider: OAuthProvider): Promise<string> {
  const response = await request<{ url: string }>(`/auth/oauth/${provider}/start`, {
    method: 'POST',
  });
  return response.url;
}

export function completeOAuth(
  provider: OAuthProvider,
  code: string,
  state: string,
): Promise<LoginResponse> {
  return request<LoginResponse>(`/auth/oauth/${provider}/callback`, {
    method: 'POST',
    body: JSON.stringify({ code, state }),
  });
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

export function register(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/register', {
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

function getRefreshToken(): string | null {
  return (
    window.localStorage.getItem(REFRESH_TOKEN_KEY) ||
    window.sessionStorage.getItem(REFRESH_TOKEN_KEY)
  );
}

export function updateSessionTokens(session: LoginResponse): void {
  const storage = window.localStorage.getItem(REFRESH_TOKEN_KEY)
    ? window.localStorage
    : window.sessionStorage;

  storage.setItem(ACCESS_TOKEN_KEY, session.access_token);
  storage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
  storage.setItem(
    USER_KEY,
    JSON.stringify({ username: session.username, role: session.role }),
  );
}

export function refreshSession(): Promise<LoginResponse> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return Promise.reject(new Error('Нет refresh-токена.'));
  }

  return request<LoginResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
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

export function updateProfile(input: {
  display_name?: string;
  department?: string;
  email?: string;
  current_email?: string;
}): Promise<CurrentUser> {
  return request<CurrentUser>('/auth/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body: JSON.stringify(input),
  });
}

export function verifyCurrentEmail(email: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/email/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body: JSON.stringify({ email }),
  });
}

export function changePassword(input: {
  current_password: string;
  new_password: string;
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body: JSON.stringify(input),
  });
}

export function listSessions(): Promise<ProfileSession[]> {
  return request<ProfileSession[]>('/auth/sessions', {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
  });
}

export function revokeSession(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/auth/sessions/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
  });
}

export function revokeOtherSessions(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/sessions/revoke-others', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    body: JSON.stringify({ refresh_token: getRefreshToken() ?? '' }),
  });
}

export function getMe(): Promise<CurrentUser> {
  const token =
    window.localStorage.getItem(ACCESS_TOKEN_KEY) ||
    window.sessionStorage.getItem(ACCESS_TOKEN_KEY);

  return request<CurrentUser>('/auth/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export function clearSession(): void {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(REFRESH_TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
}
