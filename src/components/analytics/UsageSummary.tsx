import type { UsageSummary as UsageSummaryData } from '@/services/api/usageRecords';
import './UsageSummary.scss';

interface UsageSummaryProps {
  data: UsageSummaryData | null;
  isLoading?: boolean;
  hasError?: boolean;
}

// Format number with K/M suffix
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

// Format duration
const formatDuration = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

const StatCard = ({ label, value, subValue, variant = 'default' }: StatCardProps) => (
  <div className={`stat-card ${variant}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {subValue && <div className="stat-sub">{subValue}</div>}
  </div>
);

export const UsageSummaryCard = ({ data, isLoading, hasError, title = '使用概览' }: UsageSummaryProps & { title?: string }) => {
  if (isLoading) {
    return (
      <div className="usage-summary-card">
        <h3 className="summary-title">{title}</h3>
        <div className="summary-loading">
          <div className="spinner" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (hasError || !data) {
    return (
      <div className="usage-summary-card">
        <h3 className="summary-title">{title}</h3>
        <div className="summary-error">
          {hasError ? '加载失败' : '暂无数据'}
        </div>
      </div>
    );
  }

  const successRateVariant = data.success_rate >= 95 ? 'success' : data.success_rate >= 80 ? 'warning' : 'error';

  return (
    <div className="usage-summary-card">
      <h3 className="summary-title">{title}</h3>
      <div className="summary-grid">
        <StatCard 
          label="总请求数" 
          value={formatNumber(data.total_requests)}
          subValue={`${formatNumber(data.success_requests)} 成功`}
        />
        <StatCard 
          label="成功率" 
          value={`${data.success_rate.toFixed(1)}%`}
          variant={successRateVariant}
        />
        <StatCard 
          label="总 Tokens" 
          value={formatNumber(data.total_tokens)}
          subValue={`输入: ${formatNumber(data.input_tokens)} / 输出: ${formatNumber(data.output_tokens)}`}
        />
        <StatCard 
          label="平均耗时" 
          value={formatDuration(data.avg_duration_ms)}
        />
      </div>
    </div>
  );
};
