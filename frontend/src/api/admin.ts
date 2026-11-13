import { getAccessToken } from '@api/auth';
import { request } from '@api/http';

export interface AdminUser {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  display_name: string;
  email: string | null;
  email_verified_at: string | null;
  created_at: string;
}

export interface AdminSource {
  id: string;
  name: string;
  kind: string;
  url: string;
  enabled: boolean;
  trust: string;
  language: string;
  created_at: string;
  last_synced_at: string | null;
  last_error: string | null;
  items_collected: number;
}

export interface AdminKeyword {
  id: string;
  word: string;
  created_at: string;
}

export interface AdminSettings {
  settings: Record<string, unknown>;
  effective: {
    model: string;
    prompt_version: string;
    base_url: string;
    weights: Record<string, number>;
    telegram: {
      bot_configured: boolean;
      chat_id: string;
      chat_ids: string[];
      send_to_subscribers: boolean;
    };
    email: {
      provider: string;
      host: string;
      port: number;
      username: string;
      from: string;
      test_recipient: string;
      tls: boolean;
      starttls: boolean;
      password_set: boolean;
    };
    two_factor_enabled: boolean;
    env: string;
  };
}

export interface TelegramSubscriber {
  chat_id: number;
  chat_type: string;
  title: string;
  username: string | null;
  first_name: string;
  last_name: string;
  is_active: boolean;
  created_at: string;
  last_seen_at: string;
}

export interface TelegramSyncResult {
  updated: number;
  subscribers: TelegramSubscriber[];
}

export interface LlmModels {
  base_url: string;
  models: string[];
}

export interface LlmCall {
  id: string;
  run_id: string | null;
  purpose: string;
  model: string;
  prompt_hash: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_username: string;
  action: string;
  resource: string;
  detail: Record<string, unknown>;
  ip: string;
  created_at: string;
}

export interface ServiceInfo {
  name: string;
  pid: number;
  started: number;
  last_seen: number;
  alive: boolean;
}

export interface HealthSnapshot {
  id: string;
  checked_at: string;
  database_ok: boolean;
  redis_ok: boolean;
  redis_latency_ms: number | null;
  kafka_ok: boolean;
  llm_ok: boolean;
  registry_alive: number;
  registry_total: number;
}

export interface DebugServices {
  registry: ServiceInfo[];
  database: { ok: boolean };
  redis: { ok: boolean; latency_ms: number | null };
  kafka: { ok: boolean; brokers: string };
  llm: { ok: boolean; model: string; base_url: string };
  env: string;
  version: string;
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function listAdminUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>('/admin/users', { headers: authHeaders() });
}

export function createAdminUser(input: {
  username: string;
  password: string;
  role: string;
  email?: string;
}): Promise<AdminUser> {
  return request<AdminUser>('/admin/users', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export function updateAdminUser(
  id: string,
  input: { role?: string; is_active?: boolean; email?: string },
): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export function deleteAdminUser(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export function testAdminEmail(to?: string): Promise<{ sent: boolean; to: string }> {
  return request<{ sent: boolean; to: string }>('/admin/email/test', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to?.trim() || undefined }),
  });
}

export function resetAdminUserPassword(id: string): Promise<{ password: string }> {
  return request<{ password: string }>(`/admin/users/${id}/reset-password`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export function listAdminSources(): Promise<AdminSource[]> {
  return request<AdminSource[]>('/admin/sources', { headers: authHeaders() });
}

export function createAdminSource(input: {
  name: string;
  kind: string;
  url: string;
  trust: string;
}): Promise<AdminSource> {
  return request<AdminSource>('/admin/sources', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export function toggleAdminSource(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/sources/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ enabled }),
  });
}

export function deleteAdminSource(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/sources/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export function listAdminKeywords(): Promise<AdminKeyword[]> {
  return request<AdminKeyword[]>('/admin/keywords', { headers: authHeaders() });
}

export function createAdminKeyword(word: string): Promise<AdminKeyword> {
  return request<AdminKeyword>('/admin/keywords', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ word }),
  });
}

export function deleteAdminKeyword(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/keywords/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export function getAdminSettings(): Promise<AdminSettings> {
  return request<AdminSettings>('/admin/settings', { headers: authHeaders() });
}

export function getLlmModels(baseUrl?: string): Promise<LlmModels> {
  const query = baseUrl?.trim()
    ? `?base_url=${encodeURIComponent(baseUrl.trim())}`
    : '';
  return request<LlmModels>(`/admin/llm/models${query}`, {
    headers: authHeaders(),
  });
}

export function putAdminSetting(key: string, value: unknown): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/admin/settings', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ key, value }),
  });
}

export function testTelegramBot(): Promise<{ ok: boolean; username: string }> {
  return request<{ ok: boolean; username: string }>('/admin/telegram/test', {
    method: 'POST',
    headers: authHeaders(),
  });
}

export function getTelegramSubscribers(): Promise<TelegramSubscriber[]> {
  return request<TelegramSubscriber[]>('/admin/telegram/subscribers', {
    headers: authHeaders(),
  });
}

export function syncTelegramUsers(): Promise<TelegramSyncResult> {
  return request<TelegramSyncResult>('/admin/telegram/sync', {
    method: 'POST',
    headers: authHeaders(),
  });
}

export function setTelegramSubscriberActive(
  chatId: number,
  active: boolean,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/admin/telegram/subscribers/${chatId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ active }),
  });
}

export function getAudit(limit = 100, offset = 0): Promise<AuditEntry[]> {
  return request<AuditEntry[]>(`/admin/audit?limit=${limit}&offset=${offset}`, {
    headers: authHeaders(),
  });
}

export function getLlmCalls(): Promise<LlmCall[]> {
  return request<LlmCall[]>('/admin/debug/llm-calls', { headers: authHeaders() });
}

export function getHealthHistory(limit = 20): Promise<HealthSnapshot[]> {
  return request<HealthSnapshot[]>(`/admin/health/history?limit=${limit}`, {
    headers: authHeaders(),
  });
}

export function getDebugServices(): Promise<DebugServices> {
  return request<DebugServices>('/admin/debug/services', { headers: authHeaders() });
}
