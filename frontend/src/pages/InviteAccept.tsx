import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { buildApiUrl } from '@/api/client';
import PasswordInput from '@/components/PasswordInput';

export default function InviteAcceptPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(buildApiUrl('/users/invitations/accept'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token.trim(), password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data?.error?.message ?? 'Ошибка');
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось принять приглашение');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg dark:border dark:border-slate-800 dark:bg-slate-900 text-center space-y-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-red">Новинжстрой</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Регистрация завершена</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Ваш аккаунт создан. После проверки администратором вы сможете войти.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2.5 font-semibold text-white transition hover:bg-red-700"
          >
            Перейти ко входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg dark:border dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-red">Новинжстрой</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">Регистрация по приглашению</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Введите токен из письма и задайте пароль
          </p>
        </div>

        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Токен приглашения
            </label>
            <input
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Вставьте токен из письма"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Пароль
            </label>
            <PasswordInput
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Повторите пароль
            </label>
            <PasswordInput
              required
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {password2 && password !== password2 && (
              <p className="mt-1 text-xs text-red-500">Пароли не совпадают</p>
            )}
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <KeyRound size={18} />
            {submitting ? 'Сохранение...' : 'Завершить регистрацию'}
          </button>
        </form>
      </div>
    </div>
  );
}
