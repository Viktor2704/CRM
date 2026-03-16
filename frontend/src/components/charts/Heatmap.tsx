import React, { useEffect, useRef } from 'react';

type HeatmapProps = {
  data: {
    x: string[];
    y: string[];
    values: number[][];
  };
  height?: number;
  colorScheme?: 'blue' | 'green' | 'red' | 'purple';
};

export const Heatmap: React.FC<HeatmapProps> = ({ data, height = 400, colorScheme = 'blue' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getColor = (value: number, max: number, scheme: string): string => {
    const intensity = max > 0 ? value / max : 0;

    switch (scheme) {
      case 'blue':
        return `rgba(59, 130, 246, ${intensity})`;
      case 'green':
        return `rgba(16, 185, 129, ${intensity})`;
      case 'red':
        return `rgba(239, 68, 68, ${intensity})`;
      case 'purple':
        return `rgba(139, 92, 246, ${intensity})`;
      default:
        return `rgba(59, 130, 246, ${intensity})`;
    }
  };

  useEffect(() => {
    if (!canvasRef.current || !data.x.length || !data.y.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = { top: 40, right: 100, bottom: 60, left: 100 };
    const cellWidth = (canvas.width - padding.left - padding.right) / data.x.length;
    const cellHeight = (canvas.height - padding.top - padding.bottom) / data.y.length;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find max value for color scaling
    const maxValue = Math.max(...data.values.flat());

    // Draw cells
    data.values.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        const x = padding.left + colIndex * cellWidth;
        const y = padding.top + rowIndex * cellHeight;

        ctx.fillStyle = getColor(value, maxValue, colorScheme);
        ctx.fillRect(x, y, cellWidth, cellHeight);

        // Draw cell border
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellWidth, cellHeight);

        // Draw value in cell
        if (value > 0) {
          ctx.fillStyle = value > maxValue * 0.5 ? '#ffffff' : '#374151';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(value.toFixed(1), x + cellWidth / 2, y + cellHeight / 2);
        }
      });
    });

    // Draw X-axis labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    data.x.forEach((label, index) => {
      const x = padding.left + index * cellWidth + cellWidth / 2;
      ctx.save();
      ctx.translate(x, canvas.height - padding.bottom + 15);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });

    // Draw Y-axis labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    data.y.forEach((label, index) => {
      const y = padding.top + index * cellHeight + cellHeight / 2;
      ctx.fillText(label, padding.left - 10, y);
    });

    // Draw color scale legend
    const legendX = canvas.width - padding.right + 20;
    const legendY = padding.top;
    const legendWidth = 20;
    const legendHeight = canvas.height - padding.top - padding.bottom;

    // Draw gradient
    const gradient = ctx.createLinearGradient(0, legendY, 0, legendY + legendHeight);
    gradient.addColorStop(0, getColor(maxValue, maxValue, colorScheme));
    gradient.addColorStop(1, getColor(0, maxValue, colorScheme));

    ctx.fillStyle = gradient;
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

    // Draw legend border
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    // Draw legend labels
    ctx.fillStyle = '#374151';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(maxValue.toFixed(1), legendX + legendWidth + 5, legendY);
    ctx.fillText('0', legendX + legendWidth + 5, legendY + legendHeight);

  }, [data, colorScheme]);

  return (
    <canvas
      ref={canvasRef}
      width={1000}
      height={height}
      style={{ width: '100%', height: 'auto' }}
    />
  );
};
