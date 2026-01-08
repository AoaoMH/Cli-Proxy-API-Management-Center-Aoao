import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TableCard } from '@/components/ui/TableCard';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { Drawer } from '@/components/ui/Drawer';
import { IconRefreshCw } from '@/components/ui/icons';
import { JsonViewer } from '@/components/ui/JsonViewer';
import {
  ActivityHeatmap,
  ModelStatsTable,
  ProviderStatsTable,
  UsageSummaryCard,
  RequestTimeline,
} from '@/components/analytics';
import { useAuthStore, useNotificationStore } from '@/stores';
import {
  usageRecordsApi,
  type UsageRecord,
  type UsageRecordsListQuery,
  type ActivityHeatmap as ActivityHeatmapData,
  type ModelStats,
  type ProviderStats,
  type UsageSummary,
  type RequestTimeline as RequestTimelineData,
} from '@/services/api/usageRecords';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import './UsageRecordsPage.scss';

type TabType = 'request_headers' | 'request_body' | 'response_headers' | 'response_body';
type PeriodValue = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'last90days';
type StatusValue = '__all__' | 'streaming' | 'standard' | 'failed';

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (ms: number) => {
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTokens = (input: number, output: number) => {
  return `${input} / ${output}`;
};

// 前端密钥脱敏函数
const maskApiKey = (key: string | undefined): string => {
  if (!key) return '-';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '****' + key.slice(-4);
};

// Get date range from period
const getDateRangeFromPeriod = (
  period: PeriodValue
): { start_time?: string; end_time?: string } => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { start_time: today.toISOString() };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        start_time: yesterday.toISOString(),
        end_time: today.toISOString(),
      };
    }
    case 'last7days': {
      const last7days = new Date(today);
      last7days.setDate(last7days.getDate() - 7);
      return { start_time: last7days.toISOString() };
    }
    case 'last30days': {
      const last30days = new Date(today);
      last30days.setDate(last30days.getDate() - 30);
      return { start_time: last30days.toISOString() };
    }
    case 'last90days': {
      const last90days = new Date(today);
      last90days.setDate(last90days.getDate() - 90);
      return { start_time: last90days.toISOString() };
    }
    default:
      return {};
  }
};

export function UsageRecordsPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodValue>('today');
  const [modelFilter, setModelFilter] = useState('__all__');
  const [providerFilter, setProviderFilter] = useState('__all__');
  const [statusFilter, setStatusFilter] = useState<StatusValue>('__all__');

  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<UsageRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('request_body');

  // Auto refresh & Debounce
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const filterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Analytics data
  const [heatmapData, setHeatmapData] = useState<ActivityHeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [heatmapError, setHeatmapError] = useState(false);

  const [modelStats, setModelStats] = useState<ModelStats[]>([]);
  const [modelStatsLoading, setModelStatsLoading] = useState(true);
  const [modelStatsError, setModelStatsError] = useState(false);

  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const [providerStats, setProviderStats] = useState<ProviderStats[]>([]);
  const [providerStatsLoading, setProviderStatsLoading] = useState(true);
  const [providerStatsError, setProviderStatsError] = useState(false);

  const [timelineData, setTimelineData] = useState<RequestTimelineData | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState(false);

  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  const loadFilterOptions = useCallback(async () => {
    if (connectionStatus !== 'connected') return;

    setFilterOptionsLoading(true);
    try {
      const dateRange = getDateRangeFromPeriod(selectedPeriod);
      const result = await usageRecordsApi.getOptions(dateRange.start_time, dateRange.end_time);
      setAvailableModels((result.models || []).filter(Boolean).sort());
      setAvailableProviders((result.providers || []).filter(Boolean).sort());
    } catch (err) {
      console.error('Failed to load filter options:', err);
      setAvailableModels([]);
      setAvailableProviders([]);
    } finally {
      setFilterOptionsLoading(false);
    }
  }, [connectionStatus, selectedPeriod]);

  // Load analytics data
  const loadAnalytics = useCallback(async () => {
    if (connectionStatus !== 'connected') return;

    // Load heatmap (always 90 days)
    setHeatmapLoading(true);
    setHeatmapError(false);
    try {
      const data = await usageRecordsApi.getHeatmap(500);
      setHeatmapData(data);
    } catch (err) {
      console.error('Failed to load heatmap:', err);
      setHeatmapError(true);
    } finally {
      setHeatmapLoading(false);
    }

    // Get date range for current filter period
    const dateRange = getDateRangeFromPeriod(selectedPeriod);

    // Load model stats
    setModelStatsLoading(true);
    setModelStatsError(false);
    try {
      const result = await usageRecordsApi.getModelStats(dateRange.start_time, dateRange.end_time);
      setModelStats(result.models || []);
    } catch (err) {
      console.error('Failed to load model stats:', err);
      setModelStatsError(true);
    } finally {
      setModelStatsLoading(false);
    }

    // Load usage summary
    setSummaryLoading(true);
    setSummaryError(false);
    try {
      const data = await usageRecordsApi.getSummary(dateRange.start_time, dateRange.end_time);
      setUsageSummary(data);
    } catch (err) {
      console.error('Failed to load usage summary:', err);
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }

    // Load provider stats
    setProviderStatsLoading(true);
    setProviderStatsError(false);
    try {
      const result = await usageRecordsApi.getProviderStats(
        dateRange.start_time,
        dateRange.end_time
      );
      setProviderStats(result.providers || []);
    } catch (err) {
      console.error('Failed to load provider stats:', err);
      setProviderStatsError(true);
    } finally {
      setProviderStatsLoading(false);
    }

    // Load request timeline
    setTimelineLoading(true);
    setTimelineError(false);
    try {
      const data = await usageRecordsApi.getTimeline(dateRange.start_time, dateRange.end_time);
      setTimelineData(data);
    } catch (err) {
      console.error('Failed to load request timeline:', err);
      setTimelineError(true);
    } finally {
      setTimelineLoading(false);
    }
  }, [connectionStatus, selectedPeriod]);

  const loadRecords = useCallback(
    async (resetPage = false, isSilent = false) => {
      if (connectionStatus !== 'connected') {
        setLoading(false);
        return;
      }

      if (!isSilent) setLoading(true);
      setError('');

      const currentPage = resetPage ? 1 : page;
      if (resetPage) setPage(1);

      try {
        const dateRange = getDateRangeFromPeriod(selectedPeriod);
        const query: UsageRecordsListQuery = {
          page: currentPage,
          page_size: pageSize,
          sort_by: 'timestamp',
          sort_order: 'desc',
          ...dateRange,
        };

        if (modelFilter !== '__all__') {
          query.model = modelFilter;
        }
        if (providerFilter !== '__all__') {
          query.provider = providerFilter;
        }

        const result = await usageRecordsApi.list(query);

        // Apply status filter on frontend (backend may not support it)
        let filteredRecords = result.records || [];
        if (statusFilter !== '__all__') {
          filteredRecords = filteredRecords.filter((record) => {
            if (statusFilter === 'streaming') {
              return record.is_streaming && record.success;
            } else if (statusFilter === 'standard') {
              return !record.is_streaming && record.success;
            } else if (statusFilter === 'failed') {
              return !record.success || (record.status_code && record.status_code >= 400);
            }
            return true;
          });
        }

        setRecords(filteredRecords);
        setTotal(result.total);
      } catch (err: unknown) {
        console.error('Failed to load usage records:', err);
        const message = err instanceof Error ? err.message : String(err);
        if (!isSilent)
          setError(message || t('usage_records.load_error', { defaultValue: '加载使用记录失败' }));
      } finally {
        if (!isSilent) setLoading(false);
      }
    },
    [connectionStatus, page, pageSize, selectedPeriod, modelFilter, providerFilter, statusFilter, t]
  );

  const loadRecordDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const record = await usageRecordsApi.getById(id);
        setSelectedRecord(record);
      } catch (err: unknown) {
        console.error('Failed to load record detail:', err);
        const message = err instanceof Error ? err.message : String(err);
        showNotification(
          message || t('usage_records.load_detail_error', { defaultValue: '加载详情失败' }),
          'error'
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [showNotification, t]
  );

  const handleRowClick = (record: UsageRecord) => {
    setActiveTab('request_body');
    loadRecordDetail(record.id);
  };

  const handleCloseDrawer = () => {
    setSelectedRecord(null);
  };

  // Handle filter changes with debounce (filters affect table only)
  useEffect(() => {
    if (filterTimeoutRef.current) {
      clearTimeout(filterTimeoutRef.current);
    }

    filterTimeoutRef.current = setTimeout(() => {
      loadRecords(true);
    }, 300);

    return () => {
      if (filterTimeoutRef.current) clearTimeout(filterTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod, modelFilter, providerFilter, statusFilter]);

  // Handle page changes independently
  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, connectionStatus]);

  // Load analytics + filter options (period only)
  useEffect(() => {
    loadAnalytics();
    loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus, selectedPeriod]);

  // Handle auto refresh
  useEffect(() => {
    if (autoRefresh) {
      // Immediately refresh both records and analytics
      loadRecords(false, true);
      loadAnalytics();

      autoRefreshIntervalRef.current = setInterval(() => {
        loadRecords(false, true);
        loadAnalytics();
      }, 5000); // 5 seconds
    } else {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
    }

    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
    };
  }, [autoRefresh, loadRecords, loadAnalytics]);

  useHeaderRefresh(() => loadRecords());

  const getTabContent = () => {
    if (!selectedRecord) return null;

    switch (activeTab) {
      case 'request_headers':
        return selectedRecord.request_headers || null;
      case 'request_body':
        return selectedRecord.request_body || null;
      case 'response_headers':
        return selectedRecord.response_headers || null;
      case 'response_body':
        return selectedRecord.response_body || null;
      default:
        return null;
    }
  };

  const getNoDataText = () => t('usage_records.no_data', { defaultValue: '无数据' });

  const disableControls = connectionStatus !== 'connected';

  // Get status badge for record
  const getStatusBadge = (record: UsageRecord) => {
    if (!record.success || (record.status_code && record.status_code >= 400)) {
      return (
        <Badge variant="destructive">{t('usage_records.failed', { defaultValue: '失败' })}</Badge>
      );
    }
    if (record.is_streaming) {
      return (
        <Badge variant="secondary">{t('usage_records.streaming', { defaultValue: '流式' })}</Badge>
      );
    }
    return <Badge variant="outline">{t('usage_records.standard', { defaultValue: '标准' })}</Badge>;
  };

  // Period options
  const periodOptions = [
    { value: 'today', label: t('usage_records.period_today', { defaultValue: '今天' }) },
    { value: 'yesterday', label: t('usage_records.period_yesterday', { defaultValue: '昨天' }) },
    { value: 'last7days', label: t('usage_records.period_7days', { defaultValue: '最近7天' }) },
    { value: 'last30days', label: t('usage_records.period_30days', { defaultValue: '最近30天' }) },
    { value: 'last90days', label: t('usage_records.period_90days', { defaultValue: '最近90天' }) },
  ];

  // Model options
  const modelOptions = [
    { value: '__all__', label: t('usage_records.all_models', { defaultValue: '全部模型' }) },
    ...availableModels.map((model) => ({ value: model, label: model })),
  ];

  // Provider options
  const providerOptions = [
    { value: '__all__', label: t('usage_records.all_providers', { defaultValue: '全部提供商' }) },
    ...availableProviders.map((provider) => ({ value: provider, label: provider })),
  ];

  // Status options
  const statusOptions = [
    { value: '__all__', label: t('usage_records.all_status', { defaultValue: '全部状态' }) },
    { value: 'streaming', label: t('usage_records.streaming', { defaultValue: '流式' }) },
    { value: 'standard', label: t('usage_records.standard', { defaultValue: '标准' }) },
    { value: 'failed', label: t('usage_records.failed', { defaultValue: '失败' }) },
  ];

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  return (
    <div className="usage-records-page">
      <h1 className="page-title">{t('usage_records.title', { defaultValue: '使用记录' })}</h1>

      {/* Analytics Section */}
      <div className="analytics-section">
        <div className="analytics-row">
          <div className="analytics-col analytics-col-summary">
            <UsageSummaryCard
              data={usageSummary}
              title={t('usage_records.usage_summary', { defaultValue: '使用概览' })}
              isLoading={summaryLoading}
              hasError={summaryError}
            />
          </div>
          <div className="analytics-col analytics-col-heatmap">
            <ActivityHeatmap
              data={heatmapData}
              title={t('usage_records.activity_heatmap', { defaultValue: '活跃天数' })}
              isLoading={heatmapLoading}
              hasError={heatmapError}
            />
          </div>
          <div className="analytics-col analytics-col-timeline">
            <RequestTimeline
              data={timelineData}
              title={t('usage_records.request_timeline', { defaultValue: '请求时间线' })}
              isLoading={timelineLoading}
              hasError={timelineError}
            />
          </div>
        </div>
        <div className="analytics-row analytics-row-2col">
          <div className="analytics-col">
            <ModelStatsTable
              data={modelStats}
              isLoading={modelStatsLoading}
              hasError={modelStatsError}
            />
          </div>
          <div className="analytics-col">
            <ProviderStatsTable
              data={providerStats}
              isLoading={providerStatsLoading}
              hasError={providerStatsError}
            />
          </div>
        </div>
      </div>

      <TableCard
        title={t('usage_records.records_table_title', { defaultValue: '请求记录' })}
        actions={
          <>
            {/* Time period filter */}
            <Select
              value={selectedPeriod}
              onChange={(value) => setSelectedPeriod(value as PeriodValue)}
              options={periodOptions}
              disabled={disableControls}
              size="sm"
              className="filter-select"
            />

            <div className="filter-separator" />

            {/* Model filter */}
            <Select
              value={modelFilter}
              onChange={setModelFilter}
              options={modelOptions}
              disabled={disableControls || filterOptionsLoading}
              size="sm"
              className="filter-select"
            />

            {/* Provider filter */}
            <Select
              value={providerFilter}
              onChange={setProviderFilter}
              options={providerOptions}
              disabled={disableControls || filterOptionsLoading}
              size="sm"
              className="filter-select"
            />

            {/* Status filter */}
            <Select
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusValue)}
              options={statusOptions}
              disabled={disableControls}
              size="sm"
              className="filter-select"
            />

            <div className="filter-separator" />

            {/* Auto refresh button */}
            <Button
              variant={autoRefresh ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              disabled={loading && !autoRefresh}
              title={
                autoRefresh
                  ? t('usage_records.auto_refresh_on', { defaultValue: '点击关闭自动刷新' })
                  : t('usage_records.auto_refresh_off', {
                      defaultValue: '点击开启自动刷新（每5秒刷新）',
                    })
              }
              className="refresh-btn"
            >
              <IconRefreshCw size={14} className={autoRefresh ? 'spin-animation' : ''} />
            </Button>
          </>
        }
        pagination={
          total > 0 ? (
            <Pagination
              current={page}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : undefined
        }
      >
        {error && <div className="error-box">{error}</div>}

        {/* Table */}
        {loading && !autoRefresh && records.length === 0 ? (
          <div className="loading-state" style={{ padding: '40px', textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
            <span>{t('common.loading', { defaultValue: '加载中...' })}</span>
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            title={t('usage_records.empty_title', { defaultValue: '暂无使用记录' })}
            description={t('usage_records.empty_description', {
              defaultValue: '当有 API 请求时，使用记录会显示在这里',
            })}
          />
        ) : (
          <div className="table-wrapper">
            <table className="records-table">
              <thead>
                <tr>
                  <th className="col-time">{t('usage_records.time', { defaultValue: '时间' })}</th>
                  <th className="col-ip">{t('usage_records.ip', { defaultValue: 'IP' })}</th>
                  <th className="col-key">
                    {t('usage_records.api_key', { defaultValue: '密钥' })}
                  </th>
                  <th className="col-model">
                    {t('usage_records.model', { defaultValue: '模型' })}
                  </th>
                  <th className="col-provider">
                    {t('usage_records.provider', { defaultValue: '提供商' })}
                  </th>
                  <th className="col-type">{t('usage_records.type', { defaultValue: '类型' })}</th>
                  <th className="col-tokens">
                    {t('usage_records.tokens', { defaultValue: 'Tokens' })}
                  </th>
                  <th className="col-duration">
                    {t('usage_records.duration', { defaultValue: '耗时' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} onClick={() => handleRowClick(record)}>
                    <td className="cell-time">{formatTime(record.timestamp)}</td>
                    <td className="cell-ip">{record.ip || '-'}</td>
                    <td className="cell-key" title={record.api_key}>
                      {maskApiKey(record.api_key)}
                    </td>
                    <td className="cell-model" title={record.model}>
                      {record.model || '-'}
                    </td>
                    <td className="cell-provider">{record.provider || '-'}</td>
                    <td className="cell-type">{getStatusBadge(record)}</td>
                    <td className="cell-tokens">
                      <div className="tokens-display">
                        <span className="tokens-main">
                          {formatTokens(record.input_tokens, record.output_tokens)}
                        </span>
                      </div>
                    </td>
                    <td className="cell-duration">
                      <span className="duration-value">{formatDuration(record.duration_ms)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {/* Detail Drawer */}
      <Drawer
        open={selectedRecord !== null}
        onClose={handleCloseDrawer}
        title={t('usage_records.detail_title', { defaultValue: '请求详情' })}
        width={700}
      >
        {detailLoading ? (
          <div className="loading-state" style={{ padding: '40px', textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
            <span>{t('common.loading', { defaultValue: '加载中...' })}</span>
          </div>
        ) : selectedRecord ? (
          <div className="record-detail">
            {/* Basic Info */}
            <div className="detail-section">
              <div className="section-title">
                {t('usage_records.basic_info', { defaultValue: '基础信息' })}
              </div>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.request_id', { defaultValue: '请求ID' })}
                  </span>
                  <span className="item-value">{selectedRecord.request_id || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.time', { defaultValue: '时间' })}
                  </span>
                  <span className="item-value">{formatTime(selectedRecord.timestamp)}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.ip', { defaultValue: 'IP' })}
                  </span>
                  <span className="item-value">{selectedRecord.ip || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.model', { defaultValue: '模型' })}
                  </span>
                  <span className="item-value">{selectedRecord.model || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.provider', { defaultValue: '提供商' })}
                  </span>
                  <span className="item-value">{selectedRecord.provider || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.status_code', { defaultValue: '状态码' })}
                  </span>
                  <span className="item-value">{selectedRecord.status_code || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.duration', { defaultValue: '耗时' })}
                  </span>
                  <span className="item-value">{formatDuration(selectedRecord.duration_ms)}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.input_tokens', { defaultValue: '输入 Tokens' })}
                  </span>
                  <span className="item-value">{selectedRecord.input_tokens}</span>
                </div>
                <div className="detail-item">
                  <span className="item-label">
                    {t('usage_records.output_tokens', { defaultValue: '输出 Tokens' })}
                  </span>
                  <span className="item-value">{selectedRecord.output_tokens}</span>
                </div>
                <div className="detail-item full-width">
                  <span className="item-label">
                    {t('usage_records.request_url', { defaultValue: '请求 URL' })}
                  </span>
                  <span className="item-value">
                    {selectedRecord.request_method} {selectedRecord.request_url || '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* Request/Response Details */}
            <div className="detail-section">
              <div className="detail-tabs">
                <button
                  className={`tab-button ${activeTab === 'request_headers' ? 'active' : ''}`}
                  onClick={() => setActiveTab('request_headers')}
                >
                  {t('usage_records.request_headers', { defaultValue: '请求头' })}
                </button>
                <button
                  className={`tab-button ${activeTab === 'request_body' ? 'active' : ''}`}
                  onClick={() => setActiveTab('request_body')}
                >
                  {t('usage_records.request_body', { defaultValue: '请求体' })}
                </button>
                <button
                  className={`tab-button ${activeTab === 'response_headers' ? 'active' : ''}`}
                  onClick={() => setActiveTab('response_headers')}
                >
                  {t('usage_records.response_headers', { defaultValue: '响应头' })}
                </button>
                <button
                  className={`tab-button ${activeTab === 'response_body' ? 'active' : ''}`}
                  onClick={() => setActiveTab('response_body')}
                >
                  {t('usage_records.response_body', { defaultValue: '响应体' })}
                </button>
              </div>
              {activeTab === 'request_headers' || activeTab === 'response_headers' ? (
                <div className="headers-table">
                  {Object.entries((getTabContent() as Record<string, string> | null) || {})
                    .length === 0 ? (
                    <div className="headers-empty">{getNoDataText()}</div>
                  ) : (
                    <table>
                      <tbody>
                        {Object.entries(
                          (getTabContent() as Record<string, string> | null) || {}
                        ).map(([key, value]) => (
                          <tr key={key}>
                            <td className="header-key">{key}</td>
                            <td className="header-value">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <JsonViewer data={getTabContent()} emptyText={getNoDataText()} />
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
