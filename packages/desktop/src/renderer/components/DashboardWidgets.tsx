import React from 'react';

// ─── StatCard ────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  color?: string;
}

export function StatCard({ title, value, icon, trend, color }: StatCardProps) {
  return (
    <div className="p-4 rounded-lg bg-[var(--color-surface,var(--color-bg-secondary))] border border-[var(--color-border)]"
      style={{ boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.2))' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
          {title}
        </span>
        {icon && (
          <span className="text-[var(--color-text-muted)]" style={color ? { color } : undefined}>
            {icon}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
      {trend && (
        <div className={`mt-1 text-xs ${
          trend.direction === 'up' ? 'text-[var(--color-success)]' :
          trend.direction === 'down' ? 'text-[var(--color-error)]' :
          'text-[var(--color-text-muted)]'
        }`}>
          {trend.direction === 'up' ? '+' : trend.direction === 'down' ? '-' : ''}
          {trend.label}
        </div>
      )}
    </div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────

interface ProgressBarProps {
  label: string;
  value: number;
  max: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export function ProgressBar({ label, value, max, status }: ProgressBarProps) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  const statusColors: Record<string, string> = {
    pending: 'var(--color-text-muted)',
    running: 'var(--color-primary)',
    completed: 'var(--color-success)',
    failed: 'var(--color-error)',
  };

  const barColor = statusColors[status] || statusColors.pending;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <StatusIndicator status={
            status === 'running' ? 'active' :
            status === 'completed' ? 'active' :
            status === 'failed' ? 'error' : 'idle'
          } />
          <span className="text-sm text-[var(--color-text)]">{label}</span>
        </div>
        <span className="text-xs text-[var(--color-text-muted)]">
          {status === 'completed' ? 'Done' :
           status === 'failed' ? 'Failed' :
           status === 'running' ? `${Math.round(percentage)}%` :
           'Pending'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--color-bg-tertiary,#242424)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${status === 'completed' ? 100 : status === 'pending' ? 0 : percentage}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────

interface TimelineItem {
  time: string;
  title: string;
  description?: string;
}

interface TimelineProps {
  items: TimelineItem[];
}

export function Timeline({ items }: TimelineProps) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)] text-center py-4">
        No recent activity
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {items.map((item, i) => (
        <div key={i} className="flex gap-3 pb-3 last:pb-0">
          {/* Timeline dot and line */}
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full bg-[var(--color-primary)] mt-1.5 shrink-0" />
            {i < items.length - 1 && (
              <div className="w-px flex-1 bg-[var(--color-border)] mt-1" />
            )}
          </div>
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--color-text)] truncate">
                {item.title}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                {item.time}
              </span>
            </div>
            {item.description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
                {item.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── StatusIndicator ─────────────────────────────────────────────

interface StatusIndicatorProps {
  status: 'active' | 'idle' | 'error' | 'warning';
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const colors: Record<string, string> = {
    active: 'var(--color-success)',
    idle: 'var(--color-text-muted)',
    error: 'var(--color-error)',
    warning: 'var(--color-warning)',
  };

  const color = colors[status] || colors.idle;

  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {status === 'active' && (
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex rounded-full h-2.5 w-2.5"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

// ─── MiniChart ───────────────────────────────────────────────────

interface MiniChartProps {
  data: number[];
  type: 'line' | 'bar';
  height?: number;
  color?: string;
}

export function MiniChart({ data, type, height = 40, color }: MiniChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <span className="text-xs text-[var(--color-text-muted)]">No data</span>
      </div>
    );
  }

  const chartColor = color || 'var(--color-primary)';
  const max = Math.max(...data, 1);
  const width = 200;
  const padding = 2;

  if (type === 'bar') {
    const barWidth = Math.max((width - padding * 2) / data.length - 2, 2);
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        {data.map((value, i) => {
          const barHeight = (value / max) * (height - padding * 2);
          const x = padding + i * ((width - padding * 2) / data.length) + 1;
          const y = height - padding - barHeight;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={1}
              fill={chartColor}
              opacity={0.8}
            />
          );
        })}
      </svg>
    );
  }

  // Line chart
  const points = data.map((value, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (value / max) * (height - padding * 2);
    return `${x},${y}`;
  });

  const areaPoints = [
    `${padding},${height - padding}`,
    ...points,
    `${width - padding},${height - padding}`,
  ].join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      <polygon points={areaPoints} fill={chartColor} opacity={0.1} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={chartColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
