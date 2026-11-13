import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
} from '@api/admin';
import type { AdminUser } from '@api/admin';
import { getCurrentUser } from '@api/auth';
import {
  AddIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  CopyIcon,
  DeleteIcon,
  EditIcon,
  GroupIcon,
  KeyIcon,
  RefreshIcon,
  SortHeader,
  UserIcon,
  VerifiedUserIcon,
} from '@components/ui';
import { cx } from '@utils/cx';
import { sortRows } from '@utils/sort';
import type { SortDirection } from '@utils/sort';

import adminStyles from '@components/admin/Admin.module.css';

const styles = adminStyles;

import { formatDateTime, initials } from './utils';

export default function AdminUsersPage() {
  const currentUser = getCurrentUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'username' | 'role' | 'active' | 'created'>('created');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }

  const sortedUsers = useMemo(
    () =>
      sortRows(users, sortDirection, (user) => {
        switch (sortKey) {
          case 'username':
            return user.username;
          case 'role':
            return user.role;
          case 'active':
            return user.is_active;
          default:
            return user.created_at;
        }
      }),
    [users, sortKey, sortDirection],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [submitting, setSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<{
    username: string;
    password: string;
  } | null>(null);

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
      usersCount: users.filter((user) => user.role === 'user').length,
    }),
    [users],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createAdminUser({
        username: username.trim(),
        password,
        role,
        email: email.trim() || undefined,
      });
      setUsername('');
      setPassword('');
      setEmail('');
      setRole('user');
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

  async function handleEmail(user: AdminUser) {
    const value = window.prompt(
      `Email для «${user.username}» (пусто — удалить)`,
      user.email ?? '',
    );
    if (value === null) return;
    setBusyId(user.id);
    setError(null);
    try {
      const updated = await updateAdminUser(user.id, { email: value.trim() });
      setUsers((previous) =>
        previous.map((item) => (item.id === user.id ? updated : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить email.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetPassword(user: AdminUser) {
    if (!window.confirm(`Сбросить пароль пользователя «${user.username}»?`)) {
      return;
    }
    setBusyId(user.id);
    setError(null);
    try {
      const result = await resetAdminUserPassword(user.id);
      setGeneratedPassword({ username: user.username, password: result.password });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сбросить пароль.');
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
      <header className={cx(styles, "admin-head")}>
        <div>
          <span className={cx(styles, "admin-eyebrow")}>
            <GroupIcon />
            RBAC & identity core
          </span>
          <h1 className={cx(styles, "admin-title")}>Пользователи и права доступа</h1>
          <p className={cx(styles, "admin-sub")}>
            Управление учётными записями и ролевой моделью: администратор, аналитик,
            наблюдатель.
          </p>
        </div>
        <div className={cx(styles, "admin-actions")}>
          <button className={cx(styles, "admin-button")} type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
          <button
            className={cx(styles, "admin-button admin-button--primary")}
            type="button"
            onClick={() => setAddOpen((value) => !value)}
          >
            <AddIcon />
            {addOpen ? 'Скрыть форму' : 'Добавить пользователя'}
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
      {generatedPassword && (
        <div className={cx(styles, "admin-notice")} role="status">
          <KeyIcon />
          <span>
            Новый пароль для «{generatedPassword.username}»:{' '}
            <code className={cx(styles, "admin-mono")}>{generatedPassword.password}</code>
          </span>
          <button
            aria-label="Скопировать пароль"
            className={cx(styles, "admin-button admin-button--small")}
            type="button"
            onClick={() => void navigator.clipboard.writeText(generatedPassword.password)}
          >
            <CopyIcon />
          </button>
        </div>
      )}

      <div className={cx(styles, "admin-stats")}>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Всего пользователей
            <GroupIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{stats.total}</strong>
          <span className={cx(styles, "admin-stat-hint")}>{stats.active} активных</span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Администраторы
            <VerifiedUserIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{stats.admins}</strong>
          <span className={cx(styles, "admin-stat-hint")}>Полный доступ</span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Пользователи
            <UserIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{stats.usersCount}</strong>
          <span className={cx(styles, "admin-stat-hint")}>Доступ без админки</span>
        </article>
      </div>

      {addOpen && (
        <form className={cx(styles, "admin-form")} onSubmit={handleCreate}>
          <label className={cx(styles, "admin-field")}>
            <span>Логин</span>
            <input
              className={cx(styles, "admin-input")}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className={cx(styles, "admin-field")}>
            <span>Пароль (мин. 8 символов)</span>
            <input
              className={cx(styles, "admin-input")}
              minLength={8}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className={cx(styles, "admin-field")}>
            <span>Email (необязательно)</span>
            <input
              className={cx(styles, "admin-input")}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className={cx(styles, "admin-field")}>
            <span>Роль</span>
            <select
              className={cx(styles, "admin-select")}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="user">Пользователь</option>
              <option value="admin">Администратор</option>
            </select>
          </label>
          <div className={cx(styles, "admin-form-actions")}>
            <button
              className={cx(styles, "admin-button admin-button--primary")}
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      )}

      <section className={cx(styles, "admin-card")}>
        <div className={cx(styles, "admin-table-wrap")}>
          <table className={cx(styles, "admin-table")}>
            <thead>
              <tr>
                <SortHeader
                  label="Пользователь"
                  active={sortKey === 'username'}
                  direction={sortDirection}
                  onClick={() => toggleSort('username')}
                />
                <th>Email</th>
                <SortHeader
                  label="Роль"
                  active={sortKey === 'role'}
                  direction={sortDirection}
                  onClick={() => toggleSort('role')}
                />
                <SortHeader
                  label="Статус"
                  active={sortKey === 'active'}
                  direction={sortDirection}
                  onClick={() => toggleSort('active')}
                />
                <SortHeader
                  label="Создан"
                  active={sortKey === 'created'}
                  direction={sortDirection}
                  onClick={() => toggleSort('created')}
                />
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => {
                const isSelf = user.username === currentUser?.username;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className={cx(styles, "admin-user-cell")}>
                        <span className={cx(styles, "admin-avatar")}>{initials(user.username)}</span>
                        <span>
                          <span className={cx(styles, "admin-cell-strong")}>
                            {user.display_name || user.username}
                            {isSelf && <span className={cx(styles, "admin-note")}> · это вы</span>}
                          </span>
                          <span className={cx(styles, "admin-cell-sub")}>
                            @{user.username}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className={cx(styles, "admin-user-status")}>
                        {user.email ? (
                          <span className={cx(styles, "admin-cell-sub")}>
                            {user.email}
                            <br />
                            <span className={cx(styles, user.email_verified_at ? 'admin-badge admin-badge--green' : 'admin-badge admin-badge--amber')}>
                              {user.email_verified_at ? 'подтверждён' : 'не подтверждён'}
                            </span>
                          </span>
                        ) : (
                          <span className={cx(styles, "admin-cell-sub")}>не указан</span>
                        )}
                        <button
                          aria-label={`Изменить email ${user.username}`}
                          className={cx(styles, "admin-button admin-button--small")}
                          disabled={busyId === user.id}
                          title="Изменить email"
                          type="button"
                          onClick={() => void handleEmail(user)}
                        >
                          <EditIcon />
                        </button>
                      </div>
                    </td>
                    <td>
                      <select
                        className={cx(styles, "admin-select")}
                        disabled={busyId === user.id}
                        value={user.role}
                        onChange={(event) => void handleRole(user, event.target.value)}
                      >
                        <option value="admin">Администратор</option>
                        <option value="user">Пользователь</option>
                      </select>
                    </td>
                    <td>
                      <div className={cx(styles, "admin-user-status")}>
                        <button
                          aria-checked={user.is_active}
                          aria-label={
                            user.is_active
                              ? `Отключить ${user.username}`
                              : `Включить ${user.username}`
                          }
                          className={cx(styles, `admin-toggle${
                            user.is_active ? ' admin-toggle--on' : ''
                          }`)}
                          disabled={busyId === user.id || isSelf}
                          role="switch"
                          type="button"
                          onClick={() => void handleToggleActive(user)}
                        >
                          <span className={cx(styles, "admin-toggle-thumb")} />
                        </button>
                        <span className={cx(styles, "admin-cell-sub")}>
                          {user.is_active ? 'Активен' : 'Отключён'}
                        </span>
                      </div>
                    </td>
                    <td>{formatDateTime(user.created_at)}</td>
                    <td>
                      <div className={cx(styles, "admin-row-actions")}>
                        <button
                          aria-label={`Сбросить пароль ${user.username}`}
                          className={cx(styles, "admin-button admin-button--small")}
                          disabled={busyId === user.id}
                          title="Сбросить пароль"
                          type="button"
                          onClick={() => void handleResetPassword(user)}
                        >
                          <KeyIcon />
                        </button>
                        {user.is_active && (
                          <button
                            aria-label={`Деактивировать ${user.username}`}
                            className={cx(styles, "admin-button admin-button--danger admin-button--small")}
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
            <p className={cx(styles, "admin-empty")}>Пользователей пока нет.</p>
          )}
          {loading && <p className={cx(styles, "admin-empty")}>Загружаем пользователей…</p>}
        </div>
        <p className={cx(styles, "admin-note admin-mt-10")}>
          Роли: администратор — полный доступ, аналитик — запуски и дайджесты,
          наблюдатель — только чтение.
        </p>
      </section>
    </>
  );
}
