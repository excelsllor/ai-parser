import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { getAdminSettings, getLlmCalls, putAdminSetting } from '@api/admin';
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
  const [model, setModel] = useState('');
  const [promptVersion, setPromptVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

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
      setModel(settingsResponse.effective.model);
      setPromptVersion(settingsResponse.effective.prompt_version);
      setUpdatedAt(new Date().toISOString());
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
      await putAdminSetting('model', model.trim());
      await putAdminSetting('prompt_version', promptVersion.trim());
      setNotice('Конфигурация сохранена.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить настройки.');
    } finally {
      setSaving(false);
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

  const weights = settings?.effective.weights ?? {};

  return (
    <>
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">
            <BotIcon />
            LLM runtime configuration
          </span>
          <h1 className="admin-title">Параметры моделей LLM и учёт токенов</h1>
          <p className="admin-sub">
            Управление рабочей моделью, версией промпта и аналитика расходов на
            генерацию.
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
          <strong className="admin-stat-value" style={{ fontSize: 16 }}>
            {settings?.effective.model ?? '—'}
          </strong>
          <span className="admin-stat-hint">Провайдер из конфигурации</span>
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
              <h2 className="admin-card-title">Конфигурация модели и промптов</h2>
              <p className="admin-card-sub">Применяется к новым запускам пайплайна</p>
            </div>
            <span className="admin-badge admin-badge--blue">Strict mode</span>
          </div>

          <form className="admin-form" onSubmit={handleSave}>
            <label className="admin-field">
              <span>Модель</span>
              <input
                className="admin-input"
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Версия промпта</span>
              <input
                className="admin-input"
                required
                value={promptVersion}
                onChange={(event) => setPromptVersion(event.target.value)}
              />
            </label>
            <div className="admin-form-actions">
              <button
                className="admin-button admin-button--primary"
                type="submit"
                disabled={saving || loading}
              >
                <SaveIcon />
                {saving ? 'Сохраняем…' : 'Сохранить конфигурацию'}
              </button>
            </div>
          </form>

          <p className="admin-note" style={{ marginTop: 10 }}>
            Окружение: {settings?.effective.env ?? '—'}. Значения сохраняются в
            настройках платформы и переопределяют переменные окружения.
          </p>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <div>
              <h2 className="admin-card-title">Веса ранжирования</h2>
              <p className="admin-card-sub">Эффективные значения скоринга событий</p>
            </div>
          </div>
          <div className="admin-kv">
            {Object.entries(weights).map(([key, value]) => (
              <div className="admin-kv-item" key={key}>
                <span>{WEIGHT_LABELS[key] ?? key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="admin-note" style={{ marginTop: 12 }}>
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

        <p className="admin-note" style={{ marginTop: 10 }}>
          Показаны последние {Math.min(calls.length, 40)} из {calls.length} вызовов · обновлено{' '}
          {formatDateTime(updatedAt)}
        </p>
      </section>
    </>
  );
}
