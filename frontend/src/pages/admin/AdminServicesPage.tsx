import { useCallback, useEffect, useMemo, useState } from 'react';

import { getDebugServices } from '@api/admin';
import type { DebugServices } from '@api/admin';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  DevicesIcon,
  MonitorHeartIcon,
  RefreshIcon,
  ScheduleIcon,
} from '@components/ui/icons';

import { formatDateTime, formatTime, formatUptime } from './utils';

const REFRESH_MS = 30_000;

export default function AdminServicesPage() {
  const [services, setServices] = useState<DebugServices | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await getDebugServices();
      setServices(response);
      setUpdatedAt(new Date().toISOString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось получить состояние сервисов.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const stats = useMemo(() => {
    const registry = services?.registry ?? [];
    return {
      total: registry.length,
      alive: registry.filter((service) => service.alive).length,
      degraded:
        (services && !services.database.ok ? 1 : 0) +
        (services && !services.redis.ok ? 1 : 0) +
        (services && !services.kafka.ok ? 1 : 0) +
        (services && !services.llm.ok ? 1 : 0),
    };
  }, [services]);

  return (
    <>
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">
            <MonitorHeartIcon />
            Системная диагностика · {services?.env ?? '—'}
          </span>
          <h1 className="admin-title">Состояние сервисов и инфраструктуры</h1>
          <p className="admin-sub">
            Healthcheck микросервисов, статус шлюзов сбора данных, брокера
            сообщений, векторной БД и контура инференса.
          </p>
        </div>
        <div className="admin-actions">
          <span className="admin-badge admin-badge--green">
            <ScheduleIcon />
            Автообновление 30с
          </span>
          <button className="admin-button" type="button" onClick={() => void load()}>
            <RefreshIcon />
            Проверить сейчас
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-error" role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}

      <div className="admin-stats">
        <article className="admin-stat">
          <span className="admin-stat-label">
            Сервисов в реестре
            <DevicesIcon />
          </span>
          <strong className="admin-stat-value">{stats.total}</strong>
          <span className="admin-stat-hint">{stats.alive} отвечают heartbeat</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Проблемные зависимости
            <AlertCircleIcon />
          </span>
          <strong className="admin-stat-value">{stats.degraded}</strong>
          <span className="admin-stat-hint">PostgreSQL, Redis, Kafka, LLM</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            LLM gateway
            <MonitorHeartIcon />
          </span>
          <strong className="admin-stat-value" style={{ fontSize: 15 }}>
            {services?.llm.model ?? '—'}
          </strong>
          <span className="admin-stat-hint">
            {services?.llm.ok ? 'Доступен' : 'Недоступен'}
          </span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Обновлено
            <ScheduleIcon />
          </span>
          <strong className="admin-stat-value" style={{ fontSize: 18 }}>
            {formatTime(updatedAt)}
          </strong>
          <span className="admin-stat-hint">Версия {services?.version ?? '—'}</span>
        </article>
      </div>

      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Реестр компонентов кластера</h2>
            <p className="admin-card-sub">Heartbeat из общего registry-файла</p>
          </div>
          <span className="admin-badge admin-badge--green">
            <CheckCircleIcon />
            {stats.alive}/{stats.total} healthy
          </span>
        </div>

        <div className="admin-service-grid">
          {(services?.registry ?? []).map((service) => (
            <article className="admin-service" key={service.name}>
              <div className="admin-service-head">
                <span className="admin-service-name">{service.name}</span>
                <span
                  className={`admin-badge ${
                    service.alive ? 'admin-badge--green' : 'admin-badge--red'
                  }`}
                >
                  {service.alive ? 'Healthy' : 'Down'}
                </span>
              </div>
              <span className="admin-service-meta">
                PID {service.pid} · uptime {formatUptime(service.started)}
              </span>
              <span className="admin-service-meta admin-mono">
                last_seen {formatDateTime(new Date(service.last_seen * 1000).toISOString())}
              </span>
            </article>
          ))}
          {!loading && (services?.registry.length ?? 0) === 0 && (
            <p className="admin-empty">Реестр сервисов пуст.</p>
          )}
          {loading && <p className="admin-empty">Проверяем сервисы…</p>}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Инфраструктурные зависимости</h2>
            <p className="admin-card-sub">Проверка подключений на момент запроса</p>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Компонент</th>
                <th>Детали</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="admin-cell-strong">PostgreSQL</td>
                <td>Основное хранилище</td>
                <td>
                  <span
                    className={`admin-badge ${
                      services?.database.ok ? 'admin-badge--green' : 'admin-badge--red'
                    }`}
                  >
                    {services?.database.ok ? 'OK' : 'Ошибка'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="admin-cell-strong">Redis</td>
                <td>Кэш и блокировки</td>
                <td>
                  <span
                    className={`admin-badge ${
                      services?.redis.ok ? 'admin-badge--green' : 'admin-badge--red'
                    }`}
                  >
                    {services?.redis.ok
                      ? `${services.redis.latency_ms ?? 0} мс`
                      : 'Ошибка'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="admin-cell-strong">Kafka</td>
                <td className="admin-mono">{services?.kafka.brokers ?? '—'}</td>
                <td>
                  <span
                    className={`admin-badge ${
                      services?.kafka.ok ? 'admin-badge--green' : 'admin-badge--red'
                    }`}
                  >
                    {services?.kafka.ok ? 'OK' : 'Ошибка'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="admin-cell-strong">LLM Inference Gateway</td>
                <td>{services?.llm.model ?? '—'}</td>
                <td>
                  <span
                    className={`admin-badge ${
                      services?.llm.ok ? 'admin-badge--green' : 'admin-badge--amber'
                    }`}
                  >
                    {services?.llm.ok ? 'OK' : 'Недоступен'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
