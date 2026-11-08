import { clearSession, getAccessToken, refreshSession, updateSessionTokens } from '@api/auth';
import { API_BASE_URL, API_TIMEOUT } from '@constants/api';

let refreshing: Promise<void> | null = null;

// Concurrent 401s share one refresh: the backend revokes the old refresh token.
function refreshOnce(): Promise<void> {
  refreshing ??= refreshSession()
    .then(updateSessionTokens)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  retryAuth = true,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const isFormData =
      typeof FormData !== 'undefined' && init.body instanceof FormData;

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const hasAuth = new Headers(init.headers).has('Authorization');

      if (retryAuth && response.status === 401 && hasAuth) {
        try {
          await refreshOnce();
          return await request<T>(
            path,
            {
              ...init,
              headers: {
                ...init.headers,
                Authorization: `Bearer ${getAccessToken()}`,
              },
            },
            false,
          );
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 401) {
            clearSession();
            window.location.assign('/login');
          }
        }
      }

      let message = `Ошибка запроса (${response.status})`;
      let code: string | undefined;

      try {
        const body = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        message = body.error?.message || message;
        code = body.error?.code;
      } catch {
        // Response has no JSON body.
      }

      throw new ApiError(message, response.status, code);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Сервер не ответил вовремя. Попробуйте ещё раз.', 0, 'timeout');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
