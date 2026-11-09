import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { API_BASE_URL } from '@constants/api';
import {
  downloadSharedArchive,
  fetchSharedArtifact,
  getSharedRun,
} from '@api/runs';
import type { RunDetail } from '@api/runs';
import { AppHeader } from '@components';
import {
  AlertCircleIcon,
  DownloadIcon,
  MailIcon,
  DescriptionIcon,
  SendIcon,
  TableIcon,
} from '@components/ui';
import { cx } from '@utils/cx';

import runStyles from '@pages/workspace/RunPage.module.css';
import workspaceStyles from '@components/workspace/workspace.module.css';

const styles = { ...workspaceStyles, ...runStyles };

type TabId = 'digest' | 'post' | 'email' | 'journal';

const TABS: Array<{ id: TabId; label: string; icon: typeof DescriptionIcon }> = [
  { id: 'digest', label: 'Дайджест', icon: DescriptionIcon },
  { id: 'post', label: 'Пост', icon: SendIcon },
  { id: 'email', label: 'Письмо', icon: MailIcon },
  { id: 'journal', label: 'Журнал', icon: TableIcon },
];

const ARTIFACTS: Record<Exclude<TabId, 'email'>, string> = {
  digest: 'digest.md',
  post: 'post.md',
  journal: 'journal.csv',
};

export default function SharedRunPage() {
  const { token = '' } = useParams();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [tab, setTab] = useState<TabId>('digest');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getSharedRun(token);
        if (active) {
          setDetail(result);
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Не удалось открыть публичную сессию.',
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (tab === 'email') {
      return;
    }
    let active = true;
    void fetchSharedArtifact(token, ARTIFACTS[tab])
      .then((value) => {
        if (active) {
          setText(value);
        }
      })
      .catch(() => {
        if (active) {
          setText('');
        }
      });
    return () => {
      active = false;
    };
  }, [tab, token]);

  return (
    <div className={cx(styles, 'ws-page')}>
      <AppHeader badge="Публичная ссылка" />
      <main className={cx(styles, 'ws-main')}>
        <section className={cx(styles, 'ws-card rp-results')}>
          <div className={cx(styles, 'rp-tabs')}>
            <div className={cx(styles, 'rp-tab-list')} role="tablist">
              {TABS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={cx(styles, `rp-tab${tab === item.id ? ' rp-tab--active' : ''}`)}
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => {
                      setText('');
                      setTab(item.id);
                    }}
                  >
                    <Icon />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className={cx(styles, 'rp-tab-actions')}>
              <button
                className={cx(styles, 'rp-primary-button rp-primary-button--small')}
                type="button"
                onClick={() => void downloadSharedArchive(token)}
              >
                <DownloadIcon />
                Скачать ZIP
              </button>
            </div>
          </div>

          {error && (
            <div className={cx(styles, 'rp-content')}>
              <div className={cx(styles, 'ws-alert ws-alert--error')} role="alert">
                <AlertCircleIcon />
                <span>{error}</span>
              </div>
              <p className={cx(styles, 'rp-muted')}>
                <Link to="/login">Войти в CyberBug</Link>
              </p>
            </div>
          )}

          {!error && loading && (
            <p className={cx(styles, 'rp-content rp-muted')}>Загружаем дайджест…</p>
          )}

          {!error && !loading && (
            <div className={cx(styles, 'rp-content')}>
              <p className={cx(styles, 'rp-muted')}>
                Запуск {detail?.run.id.slice(0, 8)} · {detail?.run.status}
              </p>
              {tab === 'email' ? (
                <iframe
                  className={cx(styles, 'rp-email-frame')}
                  title="Письмо"
                  src={`${API_BASE_URL}/public/runs/${token}/artifacts/email.html`}
                />
              ) : (
                <pre className={cx(styles, 'rp-post-text')}>
                  {text || 'Артефакт ещё не сформирован.'}
                </pre>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
