import React, { useEffect, useRef } from 'react';

type BarChartProps = {
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor?: string | string[];
    }>;
  };
  height?: number;
  horizontal?: boolean;
};

export const BarChart: React.FC<BarChartProps> = ({ data, height = 300, horizontal = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data.labels.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = { top: 40, right: 40, bottom: 80, left: 80 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find max value
    const maxValue = Math.max(...data.datasets.flatMap(d => d.data), 0);

    if (!horizontal) {
      // Vertical bars
      const barWidth = chartWidth / data.labels.length / data.datasets.length - 10;

      // Draw grid lines
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();

        // Y-axis labels
        const value = maxValue - (maxValue / 5) * i;
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value.toFixed(0), padding.left - 10, y + 4);
      }

      // Draw bars
      data.datasets.forEach((dataset, datasetIndex) => {
        dataset.data.forEach((value, index) => {
          const x = padding.left + (chartWidth / data.labels.length) * index + barWidth * datasetIndex + 5;
          const barHeight = (value / maxValue) * chartHeight;
          const y = padding.top + chartHeight - barHeight;

          const color = Array.isArray(dataset.backgroundColor)
            ? dataset.backgroundColor[index] || '#3b82f6'
            : dataset.backgroundColor || '#3b82f6';

          ctx.fillStyle = color;
          ctx.fillRect(x, y, barWidth, barHeight);

          // Draw value on top
          ctx.fillStyle = '#374151';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(value.toFixed(0), x + barWidth / 2, y - 5);
        });
      });

      // Draw X-axis labels
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      data.labels.forEach((label, index) => {
        const x = padding.left + (chartWidth / data.labels.length) * index + (chartWidth / data.labels.length) / 2;
        ctx.save();
        ctx.translate(x, canvas.height - padding.bottom + 20);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      });
    } else {
      // Horizontal bars
      const barHeight = chartHeight / data.labels.length / data.datasets.length - 10;

      // Draw grid lines
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const x = padding.left + (chartWidth / 5) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartHeight);
        ctx.stroke();

        // X-axis labels
        const value = (maxValue / 5) * i;
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(value.toFixed(0), x, canvas.height - padding.bottom + 20);
      }

      // Draw bars
      data.datasets.forEach((dataset, datasetIndex) => {
        dataset.data.forEach((value, index) => {
          const y = padding.top + (chartHeight / data.labels.length) * index + barHeight * datasetIndex + 5;
          const barWidth = (value / maxValue) * chartWidth;

          const color = Array.isArray(dataset.backgroundColor)
            ? dataset.backgroundColor[index] || '#3b82f6'
            : dataset.backgroundColor || '#3b82f6';

          ctx.fillStyle = color;
          ctx.fillRect(padding.left, y, barWidth, barHeight);

          // Draw value
          ctx.fillStyle = '#374151';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(value.toFixed(0), padding.left + barWidth + 5, y + barHeight / 2 + 4);
        });
      });

      // Draw Y-axis labels
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      data.labels.forEach((label, index) => {
        const y = padding.top + (chartHeight / data.labels.length) * index + (chartHeight / data.labels.length) / 2;
        ctx.fillText(label, padding.left - 10, y + 4);
      });
    }

    // Draw legend
    let legendX = padding.left;
    const legendY = 20;
    data.datasets.forEach((dataset, _index) => {
      const color = Array.isArray(dataset.backgroundColor)
        ? dataset.backgroundColor[0] || '#3b82f6'
        : dataset.backgroundColor || '#3b82f6';

      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY - 8, 12, 12);

      ctx.fillStyle = '#374151';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(dataset.label, legendX + 18, legendY + 2);

      legendX += ctx.measureText(dataset.label).width + 40;
    });

  }, [data, horizontal]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={height}
      style={{ width: '100%', height: 'auto' }}
    />
  );
};
