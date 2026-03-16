import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';

interface AuditLogEntry {
  id: string;
  created_at: string;
  user_id?: string;
  user_email?: string;
  user_role?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  request_method?: string;
  request_path?: string;
  details?: any;
  status: string;
  error_message?: string;
}

interface AuditLogStats {
  action: string;
  resource_type: string;
  status: string;
  count: string;
}

export default function AuditLog() {
  const { apiCall } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditLogStats[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  // Filters
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [limit, _setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    loadLogs();
  }, [action, resourceType, status, startDate, endDate, limit, offset]);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadLogs() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (action) params.append('action', action);
      if (resourceType) params.append('resourceType', resourceType);
      if (status) params.append('status', status);
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());

      const response = await apiCall(`/api/audit-logs?${params.toString()}`);
      setLogs(response.logs);
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    setStatsLoading(true);
    try {
      const response = await apiCall('/api/audit-logs/stats?days=30');
      setStats(response.stats);
    } catch (error) {
      console.error('Failed to load audit stats:', error);
    } finally {
      setStatsLoading(false);
    }
  }

  function resetFilters() {
    setAction('');
    setResourceType('');
    setStatus('');
    setStartDate('');
    setEndDate('');
    setOffset(0);
  }

  function nextPage() {
    if (offset + limit < total) {
      setOffset(offset + limit);
    }
  }

  function prevPage() {
    if (offset > 0) {
      setOffset(Math.max(0, offset - limit));
    }
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString();
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'success':
        return 'text-green-600 bg-green-50';
      case 'failure':
        return 'text-yellow-600 bg-yellow-50';
      case 'error':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-gray-600 mt-1 text-sm sm:text-base">Security audit trail for sensitive operations</p>
      </div>

      {/* Statistics */}
      <div className="mb-4 sm:mb-6 bg-white rounded-lg shadow p-3 sm:p-4">
        <h2 className="text-base sm:text-lg font-semibold mb-3">Activity Summary (Last 30 Days)</h2>
        {statsLoading ? (
          <p className="text-gray-500">Loading statistics...</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {stats.slice(0, 8).map((stat, idx) => (
              <div key={idx} className="border rounded p-2 sm:p-3">
                <div className="text-sm text-gray-600">{stat.action}</div>
                <div className="text-xs text-gray-500">{stat.resource_type}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-2xl font-bold">{stat.count}</span>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(stat.status)}`}>
                    {stat.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 sm:mb-6 bg-white rounded-lg shadow p-3 sm:p-4">
        <h2 className="text-base sm:text-lg font-semibold mb-3">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g., user.create"
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resource Type</label>
            <input
              type="text"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              placeholder="e.g., user"
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={resetFilters}
            className="px-4 py-2.5 min-h-[44px] bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    Loading audit logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="text-gray-900">{log.user_email || 'N/A'}</div>
                      <div className="text-gray-500 text-xs">{log.user_role}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {log.action}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="text-gray-900">{log.resource_type}</div>
                      {log.resource_id && (
                        <div className="text-gray-500 text-xs font-mono">{log.resource_id.slice(0, 8)}...</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded ${getStatusColor(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      {log.ip_address || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-blue-600 hover:text-blue-800 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-gray-50 px-3 py-3 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t">
          <div className="text-xs sm:text-sm text-gray-700">
            Showing {offset + 1} to {Math.min(offset + limit, total)} of {total} entries
          </div>
          <div className="flex gap-2">
            <button
              onClick={prevPage}
              disabled={offset === 0}
              className="px-3 sm:px-4 py-2.5 min-h-[44px] bg-white border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              Previous
            </button>
            <button
              onClick={nextPage}
              disabled={offset + limit >= total}
              className="px-3 sm:px-4 py-2.5 min-h-[44px] bg-white border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center sm:p-4 z-50">
          <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] sm:max-h-[80vh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-lg sm:text-xl font-bold">Audit Log Details</h2>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-gray-400 hover:text-gray-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-500">Timestamp</label>
                  <div className="text-gray-900">{formatDate(selectedLog.created_at)}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">User</label>
                  <div className="text-gray-900">{selectedLog.user_email || 'N/A'}</div>
                  <div className="text-sm text-gray-500">Role: {selectedLog.user_role}</div>
                  {selectedLog.user_id && (
                    <div className="text-xs text-gray-500 font-mono">ID: {selectedLog.user_id}</div>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Action</label>
                  <div className="text-gray-900">{selectedLog.action}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Resource</label>
                  <div className="text-gray-900">{selectedLog.resource_type}</div>
                  {selectedLog.resource_id && (
                    <div className="text-sm text-gray-500 font-mono">ID: {selectedLog.resource_id}</div>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Status</label>
                  <div>
                    <span className={`px-2 py-1 text-xs rounded ${getStatusColor(selectedLog.status)}`}>
                      {selectedLog.status}
                    </span>
                  </div>
                  {selectedLog.error_message && (
                    <div className="mt-1 text-sm text-red-600">{selectedLog.error_message}</div>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Request</label>
                  <div className="text-sm text-gray-900">
                    {selectedLog.request_method} {selectedLog.request_path}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">IP Address</label>
                  <div className="text-gray-900 font-mono">{selectedLog.ip_address || 'N/A'}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">User Agent</label>
                  <div className="text-sm text-gray-900 break-all">{selectedLog.user_agent || 'N/A'}</div>
                </div>
                {selectedLog.details && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Additional Details</label>
                    <pre className="mt-1 p-3 bg-gray-50 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2.5 min-h-[44px] bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
