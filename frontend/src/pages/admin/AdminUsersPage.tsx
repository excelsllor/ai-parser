import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUser,
} from '@api/admin';
import type { AdminUser } from '@api/admin';
import { getCurrentUser } from '@api/auth';
import {
  AddIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  DeleteIcon,
  GroupIcon,
  RefreshIcon,
  UserIcon,
  VerifiedUserIcon,
} from '@components/ui/icons';

import { formatDateTime, initials } from './utils';

export default function AdminUsersPage() {
  const currentUser = getCurrentUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('analyst');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listAdminUsers());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить пользователей.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => user.is_active).length,
      admins: users.filter((user) => user.role === 'admin').length,
      analysts: users.filter((user) => user.role === 'analyst').length,
    }),
    [users],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createAdminUser({ username: username.trim(), password, role });
      setUsername('');
      setPassword('');
      setRole('analyst');
      setAddOpen(false);
      setNotice('Пользователь создан.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать пользователя.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRole(user: AdminUser, nextRole: string) {
    setBusyId(user.id);
    setError(null);
    try {
      const updated = await updateAdminUser(user.id, { role: nextRole });
      setUsers((previous) =>
        previous.map((item) => (item.id === user.id ? updated : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить роль.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    setBusyId(user.id);
    setError(null);
    try {
      const updated = await updateAdminUser(user.id, { is_active: !user.is_active });
      setUsers((previous) =>
        previous.map((item) => (item.id === user.id ? updated : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить статус.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!window.confirm(`Деактивировать пользователя «${user.username}»?`)) {
      return;
    }
    setBusyId(user.id);
    setError(null);
    try {
      await deleteAdminUser(user.id);
      setUsers((previous) =>
        previous.map((item) =>
          item.id === user.id ? { ...item, is_active: false } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить пользователя.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">
            <GroupIcon />
            RBAC & identity core
          </span>
          <h1 className="admin-title">Пользователи и права доступа</h1>
          <p className="admin-sub">
            Управление учётными записями и ролевой моделью: администратор, аналитик,
            наблюдатель.
          </p>
        </div>
        <div className="admin-actions">
          <button className="admin-button" type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
          <button
            className="admin-button admin-button--primary"
            type="button"
            onClick={() => setAddOpen((value) => !value)}
          >
            <AddIcon />
            {addOpen ? 'Скрыть форму' : 'Добавить пользователя'}
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
            Всего пользователей
            <GroupIcon />
          </span>
          <strong className="admin-stat-value">{stats.total}</strong>
          <span className="admin-stat-hint">{stats.active} активных</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Администраторы
            <VerifiedUserIcon />
          </span>
          <strong className="admin-stat-value">{stats.admins}</strong>
          <span className="admin-stat-hint">Полный доступ</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Аналитики
            <UserIcon />
          </span>
          <strong className="admin-stat-value">{stats.analysts}</strong>
          <span className="admin-stat-hint">Запуск и анализ дайджестов</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Наблюдатели
            <UserIcon />
          </span>
          <strong className="admin-stat-value">
            {users.filter((user) => user.role === 'viewer').length}
          </strong>
          <span className="admin-stat-hint">Только чтение</span>
        </article>
      </div>

      {addOpen && (
        <form className="admin-form" onSubmit={handleCreate}>
          <label className="admin-field">
            <span>Логин</span>
            <input
              className="admin-input"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Пароль (мин. 8 символов)</span>
            <input
              className="admin-input"
              minLength={8}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Роль</span>
            <select
              className="admin-select"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="analyst">Аналитик</option>
              <option value="admin">Администратор</option>
              <option value="viewer">Наблюдатель</option>
            </select>
          </label>
          <div className="admin-form-actions">
            <button
              className="admin-button admin-button--primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      )}

      <section className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Создан</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.username === currentUser?.username;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell">
                        <span className="admin-avatar">{initials(user.username)}</span>
                        <span>
                          <span className="admin-cell-strong">
                            {user.display_name || user.username}
                            {isSelf && <span className="admin-note"> · это вы</span>}
                          </span>
                          <span className="admin-cell-sub">
                            @{user.username}
                            {user.department ? ` · ${user.department}` : ''}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <select
                        className="admin-select"
                        disabled={busyId === user.id}
                        value={user.role}
                        onChange={(event) => void handleRole(user, event.target.value)}
                      >
                        <option value="admin">Администратор</option>
                        <option value="analyst">Аналитик</option>
                        <option value="viewer">Наблюдатель</option>
                      </select>
                    </td>
                    <td>
                      <span
                        className={`admin-badge ${
                          user.is_active ? 'admin-badge--green' : 'admin-badge--amber'
                        }`}
                      >
                        {user.is_active ? 'Активен' : 'Отключён'}
                      </span>
                    </td>
                    <td>{formatDateTime(user.created_at)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          className="admin-button admin-button--small"
                          disabled={busyId === user.id || isSelf}
                          type="button"
                          onClick={() => void handleToggleActive(user)}
                        >
                          {user.is_active ? 'Отключить' : 'Включить'}
                        </button>
                        {user.is_active && (
                          <button
                            aria-label={`Деактивировать ${user.username}`}
                            className="admin-button admin-button--danger admin-button--small"
                            disabled={busyId === user.id || isSelf}
                            type="button"
                            onClick={() => void handleDelete(user)}
                          >
                            <DeleteIcon />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && users.length === 0 && (
            <p className="admin-empty">Пользователей пока нет.</p>
          )}
          {loading && <p className="admin-empty">Загружаем пользователей…</p>}
        </div>
        <p className="admin-note" style={{ marginTop: 10 }}>
          Роли: администратор — полный доступ, аналитик — запуски и дайджесты,
          наблюдатель — только чтение.
        </p>
      </section>
    </>
  );
}
