import { API_BASE_URL, API_TIMEOUT } from '@constants/api';

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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
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
