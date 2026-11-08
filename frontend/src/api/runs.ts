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

export interface RunPolicies {
  dedup: boolean;
  injection_guard: boolean;
  neutral: boolean;
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
  parent_run_id: string | null;
}

export interface RunInfo extends RunSummary {
  period_start: string;
  period_end: string;
  started_at: string | null;
  stats: Record<string, unknown>;
  interval_hours: number;
  max_items: number;
  source_ids: string[];
  policies: RunPolicies;
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
  policies?: RunPolicies;
  controlTime?: string;
  intervalHours?: number;
  maxItems?: number;
  parentRunId?: string;
  files?: File[];
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function listSources(): Promise<Source[]> {
  return request<Source[]>('/sources', { headers: authHeaders() });
}

export function listRuns(limit = 6, offset = 0): Promise<RunSummary[]> {
  return request<RunSummary[]>(`/runs?limit=${limit}&offset=${offset}`, {
    headers: authHeaders(),
  });
}

export function runVersionChain(runId: string, runs: RunSummary[]): string[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  let rootId = runId;
  const seen = new Set([runId]);

  while (true) {
    const parentId = byId.get(rootId)?.parent_run_id;
    if (!parentId || seen.has(parentId) || !byId.has(parentId)) {
      break;
    }
    seen.add(parentId);
    rootId = parentId;
  }

  const chain: RunSummary[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const run = byId.get(current);
    if (!run || chain.some((item) => item.id === current)) {
      continue;
    }
    chain.push(run);
    for (const candidate of runs) {
      if (candidate.parent_run_id === current) {
        queue.push(candidate.id);
      }
    }
  }

  return chain
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    )
    .map((run) => run.id);
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
  form.set('interval_hours', String(input.intervalHours ?? 24));
  form.set('max_items', String(input.maxItems ?? 5));

  if (input.parentRunId) {
    form.set('parent_run_id', input.parentRunId);
  }

  if (input.sources.length > 0) {
    form.set('sources', input.sources.join(','));
  }

  if (input.policies) {
    form.set('policies', JSON.stringify(input.policies));
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

export function deleteRun(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/runs/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
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
