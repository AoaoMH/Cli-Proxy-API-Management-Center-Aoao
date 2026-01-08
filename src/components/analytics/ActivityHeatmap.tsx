import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityHeatmap as ActivityHeatmapData, ActivityHeatmapDay } from '@/services/api/usageRecords';
import './ActivityHeatmap.scss';

interface ActivityHeatmapProps {
  data: ActivityHeatmapData | null;
  title?: string;
  isLoading?: boolean;
  hasError?: boolean;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];



// Get intensity level (0-4) based on request count
const getIntensityLevel = (requests: number, maxRequests: number): number => {
  if (requests === 0) return 0;
  if (maxRequests === 0) return 0;
  
  const ratio = requests / maxRequests;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

// Format number with K/M suffix
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

export const ActivityHeatmap = ({ data, title = '活跃天数', isLoading, hasError }: ActivityHeatmapProps) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [visibleWeeksCount, setVisibleWeeksCount] = useState(0);

  // Fixed cell size for consistent appearance
  const CELL_SIZE = 11;
  const CELL_GAP = 3;
  const WEEKDAY_LABEL_WIDTH = 20; // 1.25rem

  const { weeks, monthLabels } = useMemo(() => {
    if (!data?.days?.length) {
      return { weeks: [], monthLabels: [] };
    }

    // Group days into weeks (starting from Sunday)
    const weeks: ActivityHeatmapDay[][] = [];
    const monthLabels: { month: string; colStart: number }[] = [];

    let currentWeek: ActivityHeatmapDay[] = [];
    let currentMonth = -1;

    // Parse the start date to find the first day of week
    const startDate = new Date(`${data.days[0].date}T00:00:00Z`);
    const startDayOfWeek = startDate.getUTCDay();

    // Pad the first week with empty days
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push({ date: '', requests: -1, total_tokens: 0 });
    }

    data.days.forEach((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      const month = date.getUTCMonth();
      const dayOfWeek = date.getUTCDay();

      // Track month changes for labels
      if (month !== currentMonth) {
        currentMonth = month;
        monthLabels.push({
          month: MONTHS[month],
          colStart: weeks.length,
        });
      }

      currentWeek.push(day);

      // If Saturday (end of week), start new week
      if (dayOfWeek === 6) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    // Push remaining days
    if (currentWeek.length > 0) {
      // Pad the last week with empty days
      while (currentWeek.length < 7) {
        currentWeek.push({ date: '', requests: -1, total_tokens: 0 });
      }
      weeks.push(currentWeek);
    }

    return { weeks, monthLabels };
  }, [data]);

  // Calculate how many weeks can fit in the container
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const updateVisibleWeeks = () => {
      const width = el.clientWidth;
      if (width <= 0 || weeks.length === 0) {
        setVisibleWeeksCount(weeks.length);
        return;
      }

      // Calculate available width for the grid (subtract weekday labels)
      const availableWidth = width - WEEKDAY_LABEL_WIDTH;
      // Calculate how many weeks can fit with fixed cell size
      const weeksCanFit = Math.floor((availableWidth + CELL_GAP) / (CELL_SIZE + CELL_GAP));
      // Limit to actual weeks count
      setVisibleWeeksCount(Math.min(Math.max(weeksCanFit, 1), weeks.length));
    };

    updateVisibleWeeks();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateVisibleWeeks());
      ro.observe(el);
    }

    const onResize = () => updateVisibleWeeks();
    window.addEventListener('resize', onResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [weeks.length]);

  // Get visible weeks (from the end, showing most recent data)
  const visibleWeeks = useMemo(() => {
    if (visibleWeeksCount >= weeks.length || visibleWeeksCount === 0) return weeks;
    // Slice from the end to show most recent weeks
    return weeks.slice(weeks.length - visibleWeeksCount);
  }, [weeks, visibleWeeksCount]);

  // Calculate visible month labels based on visible weeks
  const visibleMonthLabels = useMemo(() => {
    if (visibleWeeksCount >= weeks.length || visibleWeeksCount === 0) return monthLabels;
    
    const startVisibleIndex = weeks.length - visibleWeeksCount;
    return monthLabels
      .filter(label => label.colStart >= startVisibleIndex)
      .map(label => ({
        ...label,
        colStart: label.colStart - startVisibleIndex,
      }));
  }, [monthLabels, weeks.length, visibleWeeksCount]);


  const hasData = data && data.days && data.days.length > 0;
  const activeDays = data?.days?.filter(d => d.requests > 0).length || 0;

  if (isLoading) {
    return (
      <div className="activity-heatmap-card">
        <div className="heatmap-header">
          <h3 className="heatmap-title">{title}</h3>
        </div>
        <div className="heatmap-loading">
          <div className="spinner" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="activity-heatmap-card">
        <div className="heatmap-header">
          <h3 className="heatmap-title">{title}</h3>
        </div>
        <div className="heatmap-error">
          <span>加载失败</span>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-heatmap-card">
      <div className="heatmap-header">
        <h3 className="heatmap-title">{title}</h3>
        {hasData && (
          <div className="heatmap-legend">
            <span className="legend-label">少</span>
            {[0.08, 0.25, 0.45, 0.65, 0.85].map((level, i) => (
              <div 
                key={i} 
                className="legend-cell"
                style={{ opacity: level }}
              />
            ))}
            <span className="legend-label">多</span>
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="heatmap-empty">
          暂无活跃数据
        </div>
      ) : (
        <>
          <div className="heatmap-stats">
            <span className="stat-item">
              <strong>{activeDays}</strong> 活跃天数
            </span>
            <span className="stat-item">
              <strong>{formatNumber(data.max_requests)}</strong> 最高请求
            </span>
          </div>

          <div className="heatmap-container" ref={wrapperRef}>
            <div className="month-labels" style={{ gridTemplateColumns: `repeat(${visibleWeeks.length}, ${CELL_SIZE}px)` }}>
              {visibleMonthLabels.map((label, i) => (
                <span 
                  key={i} 
                  className="month-label"
                  style={{ gridColumn: label.colStart + 1 }}
                >
                  {label.month}
                </span>
              ))}
            </div>

            <div className="heatmap-grid-wrapper" style={{ columnGap: `${CELL_GAP}px` }}>
              <div className="weekday-labels" style={{ rowGap: `${CELL_GAP}px` }}>
                {WEEKDAYS.map((day, i) => (
                  <span key={i} className="weekday-label" style={{ height: `${CELL_SIZE}px` }}>
                    {i % 2 === 1 ? day : ''}
                  </span>
                ))}
              </div>

              <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${visibleWeeks.length}, ${CELL_SIZE}px)`, gap: `${CELL_GAP}px` }}>
                {visibleWeeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="heatmap-week" style={{ rowGap: `${CELL_GAP}px` }}>
                    {week.map((day, dayIndex) => (
                      <div
                        key={dayIndex}
                        className={`heatmap-cell ${day.requests < 0 ? 'empty' : ''}`}
                        style={{ width: `${CELL_SIZE}px`, height: `${CELL_SIZE}px`, borderRadius: 3 }}
                        data-level={day.requests >= 0 ? getIntensityLevel(day.requests, data.max_requests) : 0}
                        title={day.date ? `${day.date}: ${day.requests} 请求, ${formatNumber(day.total_tokens)} tokens` : ''}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
