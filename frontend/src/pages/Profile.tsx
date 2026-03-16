import { useEffect, useState, type FormEvent } from 'react';
import { User, MessageCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import PasswordInput from '@/components/PasswordInput';
import { SkeletonTable } from '@/components/Skeleton';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/auth/AuthContext';
import type { User as UserType } from '@/types';

type ProfileForm = {
  fullName: string;
  phone: string;
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type TelegramStatus = {
  linked: boolean;
  botUsername?: string;
  chatId?: string;
};

const INITIAL_PROFILE: ProfileForm = { fullName: '', phone: '' };
const INITIAL_PASSWORD: PasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function ProfilePage() {
  const toast = useToast();
  const { user: authUser } = useAuth();

  const [profile, setProfile] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileForm, setProfileForm] = useState<ProfileForm>(INITIAL_PROFILE);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(INITIAL_PASSWORD);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getT<UserType>('/users/me')
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setProfileForm({ fullName: data.fullName || '', phone: data.phone || '' });
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось загрузить профиль.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    api.getT<TelegramStatus>('/telegram/status').then(setTelegram).catch(() => {});
  }, []);

  const onLinkTelegram = async () => {
    setTelegramLoading(true);
    try {
      const result = await api.postT<{ token: string; botUsername: string }>('/telegram/link-token', {});
      setLinkCode(result.token);
      setTelegram((prev) => prev ? { ...prev, botUsername: result.botUsername } : { linked: false, botUsername: result.botUsername });
    } catch {
      toast.error('Не удалось создать код привязки.');
    } finally {
      setTelegramLoading(false);
    }
  };

  const onUnlinkTelegram = async () => {
    setTelegramLoading(true);
    try {
      await api.delT('/telegram/unlink');
      setTelegram({ linked: false });
      setLinkCode(null);
      toast.success('Telegram отвязан.');
    } catch {
      toast.error('Не удалось отвязать Telegram.');
    } finally {
      setTelegramLoading(false);
    }
  };

  const onSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await api.patchT('/users/me', { fullName: profileForm.fullName, phone: profileForm.phone });
      toast.success('Профиль обновлён.');
    } catch {
      toast.error('Не удалось обновить профиль.');
    } finally {
      setSavingProfile(false);
    }
  };

  const onSavePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Пароли не совпадают.');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error('Пароль должен быть не менее 8 символов.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.patchT('/users/me', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm(INITIAL_PASSWORD);
      toast.success('Пароль изменён.');
    } catch {
      toast.error('Не удалось изменить пароль. Проверьте текущий пароль.');
    } finally {
      setSavingPassword(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-brand-red transition focus:border-brand-red focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
  const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Панель', to: '/' }, { label: 'Профиль' }]} />

      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
          <User size={24} className="text-slate-600 dark:text-slate-300" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 sm:text-2xl">Профиль</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{authUser?.email || ''}</p>
        </div>
      </div>

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full">
            <tbody>
              <SkeletonTable rows={3} cols={2} />
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Основные данные */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Основные данные</h3>
            <form onSubmit={onSaveProfile} className="space-y-4">
              <div>
                <label className={labelClass}>Email</label>
                <input
                  value={profile?.email || ''}
                  readOnly
                  className={`${inputClass} cursor-not-allowed opacity-60`}
                />
              </div>
              <div>
                <label className={labelClass}>Роль</label>
                <input
                  value={profile?.role || ''}
                  readOnly
                  className={`${inputClass} cursor-not-allowed opacity-60`}
                />
              </div>
              <div>
                <label className={labelClass}>Имя</label>
                <input
                  value={profileForm.fullName}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  className={inputClass}
                  placeholder="Иванов Иван Иванович"
                />
              </div>
              <div>
                <label className={labelClass}>Телефон</label>
                <input
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className={inputClass}
                  placeholder="+7 (999) 000-00-00"
                />
              </div>
              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {savingProfile ? 'Сохранение...' : 'Сохранить'}
              </button>
            </form>
          </div>

          {/* Смена пароля */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Смена пароля</h3>
            <form onSubmit={onSavePassword} className="space-y-4">
              <div>
                <label className={labelClass}>Текущий пароль</label>
                <PasswordInput
                  required
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                  className={inputClass + ' pr-10'}
                />
              </div>
              <div>
                <label className={labelClass}>Новый пароль</label>
                <PasswordInput
                  required
                  minLength={8}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                  className={inputClass + ' pr-10'}
                />
              </div>
              <div>
                <label className={labelClass}>Повторите новый пароль</label>
                <PasswordInput
                  required
                  minLength={8}
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  className={inputClass + ' pr-10'}
                />
                {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                  <p className="mt-1 text-xs text-red-500">Пароли не совпадают</p>
                )}
              </div>
              <button
                type="submit"
                disabled={savingPassword}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {savingPassword ? 'Сохранение...' : 'Изменить пароль'}
              </button>
            </form>
          </div>

          {/* Telegram */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <MessageCircle size={20} className="text-blue-500" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Telegram</h3>
            </div>
            {telegram?.linked ? (
              <div className="space-y-3">
                <p className="text-sm text-green-600 dark:text-green-400">
                  Telegram привязан (chat: {telegram.chatId || '...'})
                </p>
                <button
                  onClick={onUnlinkTelegram}
                  disabled={telegramLoading}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  {telegramLoading ? 'Отвязка...' : 'Отвязать Telegram'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Привяжите Telegram для получения уведомлений.
                </p>
                {linkCode ? (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      Отправьте боту{' '}
                      <a
                        href={`https://t.me/${telegram?.botUsername || ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        @{telegram?.botUsername || 'bot'}
                      </a>{' '}
                      команду:
                    </p>
                    <code className="block overflow-x-auto break-all rounded-lg bg-slate-100 px-3 py-2 text-sm font-mono text-slate-900 dark:bg-slate-800 dark:text-slate-100 sm:break-normal sm:px-4">
                      /link {linkCode}
                    </code>
                    <p className="text-xs text-slate-400">Код действителен 10 минут.</p>
                  </div>
                ) : (
                  <button
                    onClick={onLinkTelegram}
                    disabled={telegramLoading}
                    className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {telegramLoading ? 'Создание кода...' : 'Привязать Telegram'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
