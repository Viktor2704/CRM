import { useEffect, useState } from 'react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { api } from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/auth/AuthContext';

type Campaign = {
  id: string;
  name: string;
  subject: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled';
  totalRecipients: number;
  sentCount: number;
  openedCount?: number;
  clickedCount?: number;
  unsubscribedCount?: number;
  scheduledAt?: string;
  createdAt: string;
};

type CampaignAnalytics = Campaign & {
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  unsubscribeRate: number;
};

export default function EmailCampaigns() {
  const toast = useToast();
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [_showCreateModal, setShowCreateModal] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const result = await api.getT<{ items: Campaign[]; total: number }>(
        '/admin/email-campaigns?limit=50&offset=0'
      );
      setCampaigns(result.items);
    } catch {
      toast.error('Не удалось загрузить кампании.');
    } finally {
      setLoading(false);
    }
  };

  const loadCampaignAnalytics = async (campaignId: string) => {
    try {
      const analytics = await api.getT<CampaignAnalytics>(
        `/admin/email-campaigns/${campaignId}/analytics`
      );
      setSelectedCampaign(analytics);
    } catch {
      toast.error('Не удалось загрузить аналитику.');
    }
  };

  const startCampaign = async (campaignId: string) => {
    try {
      await api.postT(`/admin/email-campaigns/${campaignId}/start`, {});
      toast.success('Кампания запущена');
      loadCampaigns();
    } catch {
      toast.error('Не удалось запустить кампанию');
    }
  };

  const pauseCampaign = async (campaignId: string) => {
    try {
      await api.postT(`/admin/email-campaigns/${campaignId}/pause`, {});
      toast.success('Кампания приостановлена');
      loadCampaigns();
    } catch {
      toast.error('Не удалось приостановить кампанию');
    }
  };

  useEffect(() => {
    if (!canManage) return;
    loadCampaigns();
  }, [canManage]);

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="text-gray-600">У вас нет доступа к этой странице.</p>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      scheduled: 'bg-blue-100 text-blue-800',
      sending: 'bg-yellow-100 text-yellow-800',
      sent: 'bg-green-100 text-green-800',
      paused: 'bg-orange-100 text-orange-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    const labels: Record<string, string> = {
      draft: 'Черновик',
      scheduled: 'Запланирована',
      sending: 'Отправка',
      sent: 'Отправлена',
      paused: 'Приостановлена',
      cancelled: 'Отменена',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || colors.draft}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="p-6">
      <Breadcrumbs items={[{ label: 'Email кампании' }]} />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Email кампании</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Создать кампанию
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">Нет кампаний</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{campaign.subject}</p>
                </div>
                {getStatusBadge(campaign.status)}
              </div>

              <div className="grid grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-xs text-gray-500">Получателей</p>
                  <p className="text-lg font-semibold text-gray-900">{campaign.totalRecipients}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Отправлено</p>
                  <p className="text-lg font-semibold text-gray-900">{campaign.sentCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Открыто</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {campaign.openedCount || 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Кликов</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {campaign.clickedCount || 0}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                {campaign.status === 'draft' && (
                  <button
                    onClick={() => startCampaign(campaign.id)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Запустить
                  </button>
                )}
                {campaign.status === 'sending' && (
                  <button
                    onClick={() => pauseCampaign(campaign.id)}
                    className="px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-700"
                  >
                    Приостановить
                  </button>
                )}
                {campaign.status === 'paused' && (
                  <button
                    onClick={() => startCampaign(campaign.id)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Возобновить
                  </button>
                )}
                <button
                  onClick={() => loadCampaignAnalytics(campaign.id)}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Аналитика
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedCampaign && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-gray-900">Аналитика кампании</h2>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">{selectedCampaign.name}</h3>
                <p className="text-sm text-gray-600">{selectedCampaign.subject}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Open Rate</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedCampaign.openRate.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Click Rate</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedCampaign.clickRate.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Click-to-Open Rate</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedCampaign.clickToOpenRate.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Bounce Rate</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {selectedCampaign.bounceRate.toFixed(1)}%
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                <div>
                  <p className="text-xs text-gray-500">Всего получателей</p>
                  <p className="text-lg font-semibold">{selectedCampaign.totalRecipients}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Отправлено</p>
                  <p className="text-lg font-semibold">{selectedCampaign.sentCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Отписались</p>
                  <p className="text-lg font-semibold">{selectedCampaign.unsubscribedCount || 0}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
