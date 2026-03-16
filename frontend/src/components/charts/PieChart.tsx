import React, { useEffect, useRef } from 'react';

type PieChartProps = {
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor?: string[];
    }>;
  };
  height?: number;
};

export const PieChart: React.FC<PieChartProps> = ({ data, height = 300 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !data.labels.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 80;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dataset = data.datasets[0];
    const total = dataset.data.reduce((sum, val) => sum + val, 0);

    if (total === 0) return;

    let currentAngle = -Math.PI / 2;

    // Draw pie slices
    dataset.data.forEach((value, index) => {
      const sliceAngle = (value / total) * Math.PI * 2;
      const color = dataset.backgroundColor?.[index] || `hsl(${index * 60}, 70%, 50%)`;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
      ctx.closePath();
      ctx.fill();

      // Draw slice border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw percentage label
      const labelAngle = currentAngle + sliceAngle / 2;
      const labelX = centerX + Math.cos(labelAngle) * (radius * 0.7);
      const labelY = centerY + Math.sin(labelAngle) * (radius * 0.7);
      const percentage = ((value / total) * 100).toFixed(1);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${percentage}%`, labelX, labelY);

      currentAngle += sliceAngle;
    });

    // Draw legend
    const legendX = 20;
    let legendY = 20;

    data.labels.forEach((label, index) => {
      const color = dataset.backgroundColor?.[index] || `hsl(${index * 60}, 70%, 50%)`;
      const value = dataset.data[index];
      const percentage = ((value / total) * 100).toFixed(1);

      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY, 16, 16);

      ctx.fillStyle = '#374151';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${label}: ${value} (${percentage}%)`, legendX + 24, legendY + 12);

      legendY += 24;
    });

  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={height}
      style={{ width: '100%', height: 'auto' }}
    />
  );
};
