import React, { useEffect, useRef } from 'react';

type LineChartProps = {
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      borderColor?: string;
      backgroundColor?: string;
      fill?: boolean;
    }>;
  };
  height?: number;
};

export const LineChart: React.FC<LineChartProps> = ({ data, height = 300 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data.labels.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = { top: 40, right: 40, bottom: 60, left: 60 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find min and max values
    const allValues = data.datasets.flatMap(d => d.data);
    const maxValue = Math.max(...allValues, 0);
    const minValue = Math.min(...allValues, 0);
    const valueRange = maxValue - minValue || 1;

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
      const value = maxValue - (valueRange / 5) * i;
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(1), padding.left - 10, y + 4);
    }

    // Draw datasets
    data.datasets.forEach((dataset, datasetIndex) => {
      const color = dataset.borderColor || `hsl(${datasetIndex * 60}, 70%, 50%)`;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      dataset.data.forEach((value, index) => {
        const x = padding.left + (chartWidth / (data.labels.length - 1)) * index;
        const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Draw fill if specified
      if (dataset.fill && dataset.backgroundColor) {
        ctx.fillStyle = dataset.backgroundColor;
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.closePath();
        ctx.fill();
      }

      // Draw points
      ctx.fillStyle = color;
      dataset.data.forEach((value, index) => {
        const x = padding.left + (chartWidth / (data.labels.length - 1)) * index;
        const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // Draw X-axis labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    data.labels.forEach((label, index) => {
      const x = padding.left + (chartWidth / (data.labels.length - 1)) * index;
      ctx.fillText(label, x, canvas.height - padding.bottom + 20);
    });

    // Draw legend
    let legendX = padding.left;
    const legendY = 20;
    data.datasets.forEach((dataset, index) => {
      const color = dataset.borderColor || `hsl(${index * 60}, 70%, 50%)`;

      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY - 8, 12, 12);

      ctx.fillStyle = '#374151';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(dataset.label, legendX + 18, legendY + 2);

      legendX += ctx.measureText(dataset.label).width + 40;
    });

  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={height}
      style={{ width: '100%', height: 'auto' }}
    />
  );
};
