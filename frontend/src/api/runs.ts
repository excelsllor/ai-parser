import { getAccessToken } from '@api/auth';
import { request } from '@api/http';
import { API_BASE_URL } from '@constants/api';

export interface Source {
  id: string;
  name: string;
  kind: string;
  url: string;
  enabled: boolean;
  trust: string;
  language: string;
  created_at: string;
}

export interface RunSummary {
  id: string;
  status: string;
  mode: string;
  control_time: string;
  created_at: string;
  finished_at: string | null;
  model: string;
  prompt_version: string;
  error: string | null;
}

export interface RunInfo extends RunSummary {
  period_start: string;
  period_end: string;
  started_at: string | null;
  stats: Record<string, unknown>;
}

export interface RunStage {
  id: string;
  run_id: string;
  stage: string;
  status: string;
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface RunStatusResponse {
  run: RunInfo;
  stages: RunStage[];
  stats: Record<string, unknown>;
}

export interface CreateRunInput {
  mode: 'live' | 'file';
  sources: string[];
  controlTime?: string;
  files?: File[];
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function listSources(): Promise<Source[]> {
  return request<Source[]>('/sources', { headers: authHeaders() });
}

export function listRuns(limit = 6): Promise<RunSummary[]> {
  return request<RunSummary[]>(`/runs?limit=${limit}`, {
    headers: authHeaders(),
  });
}

const VERSION_LINK_KEY = 'cd_run_versions';

function readVersionLinks(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(VERSION_LINK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function linkRunVersion(newId: string, previousId: string): void {
  const links = readVersionLinks();
  links[newId] = previousId;
  window.localStorage.setItem(VERSION_LINK_KEY, JSON.stringify(links));
}

export function runVersionChain(runId: string): string[] {
  const links = readVersionLinks();
  const chain = [runId];
  let current = runId;

  while (links[current] && !chain.includes(links[current])) {
    current = links[current];
    chain.unshift(current);
  }

  current = chain[0];
  for (;;) {
    const child = Object.keys(links)
      .reverse()
      .find((key) => links[key] === current && !chain.includes(key));
    if (!child) {
      break;
    }
    chain.push(child);
    current = child;
  }

  return chain;
}

export function getRunStatus(id: string): Promise<RunStatusResponse> {
  return request<RunStatusResponse>(`/runs/${id}/status`, {
    headers: authHeaders(),
  });
}

export function createRun(input: CreateRunInput): Promise<RunInfo> {
  const form = new FormData();
  form.set('mode', input.mode);
  form.set('control_time', input.controlTime || new Date().toISOString());

  if (input.sources.length > 0) {
    form.set('sources', input.sources.join(','));
  }

  for (const file of input.files ?? []) {
    form.append('files', file);
  }

  return request<RunInfo>('/runs', {
    method: 'POST',
    body: form,
    headers: authHeaders(),
  });
}

export interface Artifact {
  id: string;
  run_id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  sha256: string;
  created_at: string;
}

export interface JournalRow {
  id: string;
  run_id: string;
  item_id: string;
  external_id: string;
  status: string;
  group_key: string | null;
  reason: string;
  error: string | null;
}

export interface EventInfo {
  id: string;
  run_id: string;
  rank: number;
  title: string;
  summary: string;
  consequences: string;
  justification: string;
  score: number;
  event_key: string;
  attributes: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface RunDetail {
  run: RunInfo;
  stages: RunStage[];
  artifacts: Artifact[];
  journal: JournalRow[];
  events: EventInfo[];
}

export interface CheckResult {
  id: string;
  run_id: string;
  scenario: string;
  passed: boolean;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  note: string;
}

export function getRunDetail(id: string): Promise<RunDetail> {
  return request<RunDetail>(`/runs/${id}`, { headers: authHeaders() });
}

export function cancelRun(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/runs/${id}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export function getChecks(id: string): Promise<CheckResult[]> {
  return request<CheckResult[]>(`/runs/${id}/checks`, {
    headers: authHeaders(),
  });
}

export function rerunRun(id: string): Promise<RunInfo> {
  return request<RunInfo>(`/runs/${id}/rerun`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export function sendTestEmail(id: string, to?: string): Promise<unknown> {
  return request<unknown>(`/runs/${id}/email/send`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(to ? { to } : {}),
  });
}

export async function fetchArtifact(id: string, name: string): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/runs/${id}/artifacts/${encodeURIComponent(name)}`,
    { headers: authHeaders() },
  );

  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${name} (${response.status})`);
  }

  return response.text();
}

export async function downloadArtifact(id: string, name: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/runs/${id}/artifacts/${encodeURIComponent(name)}`,
    { headers: authHeaders() },
  );

  if (!response.ok) {
    throw new Error(`Не удалось скачать ${name} (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
