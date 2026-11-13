import { useCallback, useEffect, useMemo, useState } from 'react';
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
  SortHeader,
  TuneIcon,
} from '@components/ui';
import { cx } from '@utils/cx';
import { sortRows } from '@utils/sort';
import type { SortDirection } from '@utils/sort';

import adminStyles from '@components/admin/Admin.module.css';

const styles = adminStyles;

import { downloadFile, formatDateTime } from './utils';

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
  const [sortKey, setSortKey] = useState<'time' | 'purpose' | 'model' | 'tokens' | 'latency' | 'status'>('time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
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

  const loadModels = useCallback(async (url: string) => {
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
  }, []);

  const load = useCallback(async () => {
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
      setApiKeySet(Boolean(settingsResponse.settings.llm_api_key_set));
      setModel(settingsResponse.effective.model);
      setWeights({ ...settingsResponse.effective.weights });
      setUpdatedAt(new Date().toISOString());
      void loadModels(settingsResponse.effective.base_url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить LLM-данные.');
    } finally {
      setLoading(false);
    }
  }, [loadModels]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

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

  const sortedCalls = useMemo(
    () =>
      sortRows(calls.slice(0, 40), sortDirection, (call) => {
        switch (sortKey) {
          case 'purpose':
            return call.purpose;
          case 'model':
            return call.model;
          case 'tokens':
            return call.input_tokens + call.output_tokens;
          case 'latency':
            return call.latency_ms;
          case 'status':
            return call.ok;
          default:
            return call.created_at;
        }
      }),
    [calls, sortKey, sortDirection],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await putAdminSetting('llm_base_url', baseUrl.trim());
      if (apiKey.trim()) {
        await putAdminSetting('llm_api_key', apiKey.trim());
      }
      await putAdminSetting('model', model.trim());
      setApiKey('');
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
      <header className={cx(styles, "admin-head")}>
        <div>
          <span className={cx(styles, "admin-eyebrow")}>
            <BotIcon />
            LLM runtime configuration
          </span>
          <h1 className={cx(styles, "admin-title")}>LLM</h1>
          <p className={cx(styles, "admin-sub")}>
            Base URL провайдера, выбор модели, веса ранжирования и расход токенов.
          </p>
        </div>
        <div className={cx(styles, "admin-actions")}>
          <button className={cx(styles, "admin-button")} type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
        </div>
      </header>

      {error && (
        <div className={cx(styles, "admin-error")} role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className={cx(styles, "admin-notice")} role="status">
          <CheckCircleIcon />
          <span>{notice}</span>
        </div>
      )}

      <div className={cx(styles, "admin-stats")}>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Рабочая модель
            <BotIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value admin-stat-value--sm")}>
            {settings?.effective.model ?? '—'}
          </strong>
          <span className={cx(styles, "admin-stat-hint")}>Base URL: {settings?.effective.base_url ?? '—'}</span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Токенов обработано
            <TuneIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>
            {stats.totalTokens.toLocaleString('ru-RU')}
          </strong>
          <span className={cx(styles, "admin-stat-hint")}>
            {stats.inputTokens.toLocaleString('ru-RU')} вход ·{' '}
            {stats.outputTokens.toLocaleString('ru-RU')} выход
          </span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Средняя задержка
            <ScheduleIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>
            {stats.avgLatency === null ? '—' : stats.avgLatency}
            {stats.avgLatency !== null && <small> мс</small>}
          </strong>
          <span className={cx(styles, "admin-stat-hint")}>По последним 200 вызовам</span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Стоимость
            <DownloadIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>${stats.cost.toFixed(4)}</strong>
          <span className={cx(styles, "admin-stat-hint")}>
            {stats.ok} из {calls.length} успешных
          </span>
        </article>
      </div>

      <div className={cx(styles, "admin-grid")}>
        <section className={cx(styles, "admin-card")}>
          <div className={cx(styles, "admin-card-head")}>
            <div>
              <h2 className={cx(styles, "admin-card-title")}>Base URL и модель</h2>
              <p className={cx(styles, "admin-card-sub")}>Применяется к следующим запускам пайплайна</p>
            </div>
            <span className={cx(styles, "admin-badge admin-badge--blue")}>Strict mode</span>
          </div>

          <form className={cx(styles, "admin-form")} onSubmit={handleSave}>
            <label className={cx(styles, "admin-field")}>
              <span>Base URL</span>
              <input
                className={cx(styles, "admin-input")}
                required
                placeholder="https://provider.example/v1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
            <label className={cx(styles, "admin-field")}>
              <span>API-токен</span>
              <input
                autoComplete="new-password"
                className={cx(styles, "admin-input")}
                placeholder={apiKeySet ? 'Токен сохранён' : 'Токен провайдера'}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <label className={cx(styles, "admin-field")}>
              <span>Модель</span>
              <select
                className={cx(styles, "admin-select")}
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
            <div className={cx(styles, "admin-form-actions")}>
              <button
                className={cx(styles, "admin-button")}
                type="button"
                disabled={modelsLoading || !baseUrl.trim()}
                onClick={() => void loadModels(baseUrl)}
              >
                <RefreshIcon />
                {modelsLoading ? 'Загружаем…' : 'Загрузить модели'}
              </button>
              <button
                className={cx(styles, "admin-button admin-button--primary")}
                type="submit"
                disabled={saving || loading || !baseUrl.trim() || !model.trim()}
              >
                <SaveIcon />
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </form>

          {modelsError && (
            <p className={cx(styles, "admin-note admin-note--error admin-mt-10")}>
              Список моделей не получен: {modelsError}
            </p>
          )}
          <p className={cx(styles, "admin-note admin-mt-10")}>
            Окружение: {settings?.effective.env ?? '—'}. Значения сохраняются в
            настройках платформы и переопределяют переменные окружения.
          </p>
        </section>

        <section className={cx(styles, "admin-card")}>
          <div className={cx(styles, "admin-card-head")}>
            <div>
              <h2 className={cx(styles, "admin-card-title")}>Веса ранжирования</h2>
              <p className={cx(styles, "admin-card-sub")}>Влияют на порядок событий в дайджесте</p>
            </div>
          </div>
          <form className={cx(styles, "admin-form")} onSubmit={handleSaveWeights}>
            {weightKeys.map((key) => (
              <label className={cx(styles, "admin-field")} key={key}>
                <span>{WEIGHT_LABELS[key]}</span>
                <input
                  className={cx(styles, "admin-input")}
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
            <div className={cx(styles, "admin-form-actions")}>
              <button
                className={cx(styles, "admin-button admin-button--primary")}
                type="submit"
                disabled={savingWeights}
              >
                <SaveIcon />
                {savingWeights ? 'Сохраняем…' : 'Сохранить веса'}
              </button>
            </div>
          </form>
          <p className={cx(styles, "admin-note admin-mt-12")}>
            Температура и лимит токенов задаются конфигурацией backend и не
            редактируются из интерфейса.
          </p>
        </section>
      </div>

      <section className={cx(styles, "admin-card")}>
        <div className={cx(styles, "admin-card-head")}>
          <div>
            <h2 className={cx(styles, "admin-card-title")}>Журнал вызовов и расход токенов</h2>
            <p className={cx(styles, "admin-card-sub")}>Детализированная телеметрия последних генераций</p>
          </div>
          <div className={cx(styles, "admin-actions")}>
            <button className={cx(styles, "admin-button")} type="button" onClick={exportCsv}>
              <DownloadIcon />
              Экспорт CSV
            </button>
          </div>
        </div>

        <div className={cx(styles, "admin-table-wrap")}>
          <table className={cx(styles, "admin-table")}>
            <thead>
              <tr>
                <SortHeader
                  label="Время"
                  active={sortKey === 'time'}
                  direction={sortDirection}
                  onClick={() => toggleSort('time')}
                />
                <SortHeader
                  label="Назначение"
                  active={sortKey === 'purpose'}
                  direction={sortDirection}
                  onClick={() => toggleSort('purpose')}
                />
                <SortHeader
                  label="Модель"
                  active={sortKey === 'model'}
                  direction={sortDirection}
                  onClick={() => toggleSort('model')}
                />
                <th>Вход</th>
                <th>Выход</th>
                <SortHeader
                  label="Итого"
                  active={sortKey === 'tokens'}
                  direction={sortDirection}
                  onClick={() => toggleSort('tokens')}
                />
                <SortHeader
                  label="Задержка"
                  active={sortKey === 'latency'}
                  direction={sortDirection}
                  onClick={() => toggleSort('latency')}
                />
                <SortHeader
                  label="Статус"
                  active={sortKey === 'status'}
                  direction={sortDirection}
                  onClick={() => toggleSort('status')}
                />
              </tr>
            </thead>
            <tbody>
              {sortedCalls.map((call) => (
                <tr key={call.id}>
                  <td className={cx(styles, "admin-mono")}>{formatDateTime(call.created_at)}</td>
                  <td>
                    <span className={cx(styles, "admin-cell-strong")}>{call.purpose}</span>
                    {call.run_id && (
                      <span className={cx(styles, "admin-cell-sub")}>{call.run_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td>{call.model}</td>
                  <td>{call.input_tokens.toLocaleString('ru-RU')}</td>
                  <td>{call.output_tokens.toLocaleString('ru-RU')}</td>
                  <td>{call.input_tokens + call.output_tokens}</td>
                  <td>{call.latency_ms} мс</td>
                  <td>
                    <span
                      className={cx(styles, `admin-badge ${
                        call.ok ? 'admin-badge--green' : 'admin-badge--red'
                      }`)}
                    >
                      {call.ok ? 'OK' : 'Ошибка'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && calls.length === 0 && (
            <p className={cx(styles, "admin-empty")}>Вызовов LLM пока нет.</p>
          )}
          {loading && <p className={cx(styles, "admin-empty")}>Загружаем журнал вызовов…</p>}
        </div>

        <p className={cx(styles, "admin-note admin-mt-10")}>
          Показаны последние {Math.min(calls.length, 40)} из {calls.length} вызовов · обновлено{' '}
          {formatDateTime(updatedAt)}
        </p>
      </section>
    </>
  );
}
