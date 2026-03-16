import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  predictCompletionTime,
  analyzeSentiment,
  detectAnomalies,
  getPrediction,
  getAnomalies,
  resolveAnomaly,
} from '../src/services/aiPredictiveService.js';
import { dbQuery } from '../src/db.js';

describe('AI Predictive Service', () => {
  describe('predictCompletionTime', () => {
    it('should return a prediction with estimated days', async () => {
      const prediction = await predictCompletionTime(
        'test-request-id',
        'maintenance_planned',
        'medium',
        [],
        'hvac'
      );

      expect(prediction).toBeDefined();
      expect(prediction.estimatedDays).toBeGreaterThan(0);
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
      expect(prediction.factors).toBeDefined();
    });

    it('should adjust estimate based on priority', async () => {
      const criticalPrediction = await predictCompletionTime(
        'test-request-1',
        'emergency',
        'critical',
        [],
        'hvac'
      );

      const lowPrediction = await predictCompletionTime(
        'test-request-2',
        'emergency',
        'low',
        [],
        'hvac'
      );

      // Critical priority should have shorter estimated time
      expect(criticalPrediction.estimatedDays).toBeLessThanOrEqual(lowPrediction.estimatedDays);
    });
  });

  describe('analyzeSentiment', () => {
    it('should detect urgent sentiment', async () => {
      const analysis = await analyzeSentiment(
        'test-comment-1',
        'Срочно! Авария на объекте, требуется немедленное вмешательство!'
      );

      expect(analysis).toBeDefined();
      expect(analysis.sentiment).toBe('urgent');
      expect(analysis.isUrgent).toBe(true);
    });

    it('should detect negative sentiment', async () => {
      const analysis = await analyzeSentiment(
        'test-comment-2',
        'Проблема не решена, система не работает'
      );

      expect(analysis).toBeDefined();
      expect(['negative', 'urgent']).toContain(analysis.sentiment);
    });

    it('should detect positive sentiment', async () => {
      const analysis = await analyzeSentiment(
        'test-comment-3',
        'Спасибо, проблема решена, все работает отлично!'
      );

      expect(analysis).toBeDefined();
      expect(analysis.sentiment).toBe('positive');
      expect(analysis.isUrgent).toBe(false);
    });

    it('should handle neutral comments', async () => {
      const analysis = await analyzeSentiment(
        'test-comment-4',
        'Обновление статуса заявки'
      );

      expect(analysis).toBeDefined();
      expect(analysis.sentiment).toBe('neutral');
    });

    it('should handle empty text', async () => {
      const analysis = await analyzeSentiment('test-comment-5', '');

      expect(analysis).toBeDefined();
      expect(analysis.sentiment).toBe('neutral');
      expect(analysis.score).toBe(0.5);
    });
  });

  describe('detectAnomalies', () => {
    it('should detect anomalies without errors', async () => {
      const anomalies = await detectAnomalies();

      expect(Array.isArray(anomalies)).toBe(true);
      // Each anomaly should have required fields
      anomalies.forEach((anomaly) => {
        expect(anomaly.type).toBeDefined();
        expect(anomaly.severity).toBeDefined();
        expect(anomaly.description).toBeDefined();
        expect(Array.isArray(anomaly.affectedEntities)).toBe(true);
      });
    });
  });

  describe('getPrediction', () => {
    it('should return null for non-existent prediction', async () => {
      const prediction = await getPrediction(
        'service_request',
        'non-existent-id',
        'completion_time'
      );

      expect(prediction).toBeNull();
    });
  });

  describe('getAnomalies', () => {
    it('should return array of anomalies', async () => {
      const anomalies = await getAnomalies();

      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should filter by entity type', async () => {
      const anomalies = await getAnomalies('service_request');

      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should filter by resolved status', async () => {
      const unresolvedAnomalies = await getAnomalies(undefined, false);
      const resolvedAnomalies = await getAnomalies(undefined, true);

      expect(Array.isArray(unresolvedAnomalies)).toBe(true);
      expect(Array.isArray(resolvedAnomalies)).toBe(true);
    });
  });
});
