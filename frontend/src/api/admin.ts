import { getAccessToken } from '@api/auth';
import { request } from '@api/http';

export interface AdminUser {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  display_name: string;
  department: string;
  email: string | null;
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
    weights: Record<string, number>;
    env: string;
  };
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
  llm: { ok: boolean; model: string };
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
}): Promise<AdminUser> {
  return request<AdminUser>('/admin/users', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
}

export function updateAdminUser(
  id: string,
  input: { role?: string; is_active?: boolean },
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

export function putAdminSetting(key: string, value: unknown): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/admin/settings', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ key, value }),
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
