import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { getAdminSettings, getLlmCalls, getLlmModels, putAdminSetting } from '@api/admin';
import type { AdminSettings, LlmCall } from '@api/admin';
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircleIcon,
  DownloadIcon,
  RefreshIcon,
  SaveIcon,
  ScheduleIcon,
  TuneIcon,
} from '@components/ui/icons';

import { downloadFile, formatDateTime, formatTime } from './utils';

function isLocalLlmUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === 'vllm' ||
      host === 'host.docker.internal' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

const WEIGHT_LABELS: Record<string, string> = {
  impact: 'Влияние',
  scale: 'Масштаб',
  urgency: 'Срочность',
  relevance: 'Релевантность',
  confidence: 'Уверенность',
  uncertainty_penalty: 'Штраф неопределённости',
};

export default function AdminLlmPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function loadModels(url: string) {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const response = await getLlmModels(url);
      setModels(response.models);
    } catch (caught) {
      setModels([]);
      setModelsError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось получить список моделей.',
      );
    } finally {
      setModelsLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [settingsResponse, callList] = await Promise.all([
        getAdminSettings(),
        getLlmCalls(),
      ]);
      setSettings(settingsResponse);
      setCalls(callList);
      setBaseUrl(settingsResponse.effective.base_url);
      setModel(settingsResponse.effective.model);
      setWeights({ ...settingsResponse.effective.weights });
      setUpdatedAt(new Date().toISOString());
      void loadModels(settingsResponse.effective.base_url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить LLM-данные.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const stats = useMemo(() => {
    const inputTokens = calls.reduce((sum, call) => sum + call.input_tokens, 0);
    const outputTokens = calls.reduce((sum, call) => sum + call.output_tokens, 0);
    const cost = calls.reduce((sum, call) => sum + call.cost, 0);
    const latencies = calls.filter((call) => call.latency_ms > 0);
    const avgLatency =
      latencies.length > 0
        ? Math.round(
            latencies.reduce((sum, call) => sum + call.latency_ms, 0) /
              latencies.length,
          )
        : null;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost,
      avgLatency,
      ok: calls.filter((call) => call.ok).length,
    };
  }, [calls]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await putAdminSetting('llm_base_url', baseUrl.trim());
      await putAdminSetting('model', model.trim());
      setNotice('Конфигурация LLM сохранена.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить настройки.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveWeights(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingWeights(true);
    setError(null);
    setNotice(null);
    try {
      await putAdminSetting('weights', weights);
      setNotice('Веса ранжирования сохранены.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить веса.');
    } finally {
      setSavingWeights(false);
    }
  }

  function exportCsv() {
    const header = 'created_at,purpose,model,input_tokens,output_tokens,cost,latency_ms,ok\n';
    const rows = calls
      .map((call) =>
        [
          call.created_at,
          call.purpose,
          call.model,
          call.input_tokens,
          call.output_tokens,
          call.cost,
          call.latency_ms,
          call.ok,
        ].join(','),
      )
      .join('\n');
    downloadFile('llm-calls.csv', header + rows, 'text/csv');
  }

  const weightKeys = Object.keys(WEIGHT_LABELS);
  const modelOptions = Array.from(
    new Set([model, ...models].filter((value) => value.trim() !== '')),
  );

  return (
    <>
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">
            <BotIcon />
            LLM runtime configuration
          </span>
          <h1 className="admin-title">LLM</h1>
          <p className="admin-sub">
            Base URL провайдера, выбор модели, веса ранжирования и расход токенов.
          </p>
        </div>
        <div className="admin-actions">
          <button className="admin-button" type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-error" role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="admin-notice" role="status">
          <CheckCircleIcon />
          <span>{notice}</span>
        </div>
      )}

      <div className="admin-stats">
        <article className="admin-stat">
          <span className="admin-stat-label">
            Рабочая модель
            <BotIcon />
          </span>
          <strong className="admin-stat-value admin-stat-value--sm">
            {settings?.effective.model ?? '—'}
          </strong>
          <span className="admin-stat-hint">Base URL: {settings?.effective.base_url ?? '—'}</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Токенов обработано
            <TuneIcon />
          </span>
          <strong className="admin-stat-value">
            {stats.totalTokens.toLocaleString('ru-RU')}
          </strong>
          <span className="admin-stat-hint">
            {stats.inputTokens.toLocaleString('ru-RU')} вход ·{' '}
            {stats.outputTokens.toLocaleString('ru-RU')} выход
          </span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Средняя задержка
            <ScheduleIcon />
          </span>
          <strong className="admin-stat-value">
            {stats.avgLatency === null ? '—' : stats.avgLatency}
            {stats.avgLatency !== null && <small> мс</small>}
          </strong>
          <span className="admin-stat-hint">По последним 200 вызовам</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Стоимость
            <DownloadIcon />
          </span>
          <strong className="admin-stat-value">${stats.cost.toFixed(4)}</strong>
          <span className="admin-stat-hint">
            {stats.ok} из {calls.length} успешных
          </span>
        </article>
      </div>

      <div className="admin-grid">
        <section className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Base URL и модель</h2>
              <p className="admin-card-sub">Применяется к следующим запускам пайплайна</p>
            </div>
            <span className="admin-badge admin-badge--blue">Strict mode</span>
          </div>

          <form className="admin-form" onSubmit={handleSave}>
            <label className="admin-field admin-field--full">
              <span>Base URL · {baseUrl.trim() ? (isLocalLlmUrl(baseUrl) ? 'Локальная' : 'API') : '—'}</span>
              <input
                className="admin-input"
                required
                placeholder="http://vllm:8000/v1 или https://provider.example/v1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <small className="admin-note">
                Локальная модель: vllm, localhost, host.docker.internal или частный IP. Внешний URL — API.
              </small>
            </label>
            <label className="admin-field">
              <span>Модель</span>
              <select
                className="admin-select"
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {modelOptions.length === 0 && (
                  <option value="">Нет доступных моделей</option>
                )}
                {modelOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-form-actions">
              <button
                className="admin-button"
                type="button"
                disabled={modelsLoading || !baseUrl.trim()}
                onClick={() => void loadModels(baseUrl)}
              >
                <RefreshIcon />
                {modelsLoading ? 'Загружаем…' : 'Загрузить модели'}
              </button>
              <button
                className="admin-button admin-button--primary"
                type="submit"
                disabled={saving || loading || !baseUrl.trim() || !model.trim()}
              >
                <SaveIcon />
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </form>

          {modelsError && (
            <p className="admin-note admin-note--error admin-mt-10">
              Список моделей не получен: {modelsError}
            </p>
          )}
          <p className="admin-note admin-mt-10">
            Окружение: {settings?.effective.env ?? '—'}. Значения сохраняются в
            настройках платформы и переопределяют переменные окружения.
          </p>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Веса ранжирования</h2>
              <p className="admin-card-sub">Влияют на порядок событий в дайджесте</p>
            </div>
          </div>
          <form className="admin-form" onSubmit={handleSaveWeights}>
            {weightKeys.map((key) => (
              <label className="admin-field" key={key}>
                <span>{WEIGHT_LABELS[key]}</span>
                <input
                  className="admin-input"
                  max={1}
                  min={0}
                  step={0.01}
                  type="number"
                  value={weights[key] ?? 0}
                  onChange={(event) =>
                    setWeights((previous) => ({
                      ...previous,
                      [key]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
            <div className="admin-form-actions">
              <button
                className="admin-button admin-button--primary"
                type="submit"
                disabled={savingWeights}
              >
                <SaveIcon />
                {savingWeights ? 'Сохраняем…' : 'Сохранить веса'}
              </button>
            </div>
          </form>
          <p className="admin-note admin-mt-12">
            Температура и лимит токенов задаются конфигурацией backend и не
            редактируются из интерфейса.
          </p>
        </section>
      </div>

      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Журнал вызовов и расход токенов</h2>
            <p className="admin-card-sub">Детализированная телеметрия последних генераций</p>
          </div>
          <div className="admin-actions">
            <button className="admin-button" type="button" onClick={exportCsv}>
              <DownloadIcon />
              Экспорт CSV
            </button>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Назначение</th>
                <th>Модель</th>
                <th>Вход</th>
                <th>Выход</th>
                <th>Итого</th>
                <th>Задержка</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 40).map((call) => (
                <tr key={call.id}>
                  <td className="admin-mono">{formatTime(call.created_at)}</td>
                  <td>
                    <span className="admin-cell-strong">{call.purpose}</span>
                    {call.run_id && (
                      <span className="admin-cell-sub">{call.run_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td>{call.model}</td>
                  <td>{call.input_tokens.toLocaleString('ru-RU')}</td>
                  <td>{call.output_tokens.toLocaleString('ru-RU')}</td>
                  <td>{call.input_tokens + call.output_tokens}</td>
                  <td>{call.latency_ms} мс</td>
                  <td>
                    <span
                      className={`admin-badge ${
                        call.ok ? 'admin-badge--green' : 'admin-badge--red'
                      }`}
                    >
                      {call.ok ? 'OK' : 'Ошибка'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && calls.length === 0 && (
            <p className="admin-empty">Вызовов LLM пока нет.</p>
          )}
          {loading && <p className="admin-empty">Загружаем журнал вызовов…</p>}
        </div>

        <p className="admin-note admin-mt-10">
          Показаны последние {Math.min(calls.length, 40)} из {calls.length} вызовов · обновлено{' '}
          {formatDateTime(updatedAt)}
        </p>
      </section>
    </>
  );
}
