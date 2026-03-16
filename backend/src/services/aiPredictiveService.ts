import { dbQuery } from '../db.js';
import { callLLMWithFallback } from './aiService.js';
import { logger, serializeError } from '../logger.js';
import { extractJson } from '../helpers/safeJsonParse.js';
import { emitAlert } from '../alerts.js';
import { pushTelegramNotification } from './telegramNotifier.js';

export type PredictionType = 'completion_time' | 'sentiment' | 'anomaly';

export type CompletionTimePrediction = {
  estimatedDays: number;
  confidence: number;
  factors: {
    historicalAverage?: number;
    executorPerformance?: number;
    priorityImpact?: number;
    similarRequests?: number;
  };
};

export type SentimentAnalysis = {
  sentiment: 'positive' | 'negative' | 'neutral' | 'urgent';
  score: number;
  isUrgent: boolean;
  keywords?: string[];
};

export type AnomalyDetection = {
  type: 'stuck_request' | 'high_frequency_issue' | 'overdue_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedEntities: string[];
};

// Predict completion time for service requests
export const predictCompletionTime = async (
  requestId: string,
  requestType: string,
  priority: string,
  executorIds: string[],
  systemType?: string
): Promise<CompletionTimePrediction> => {
  try {
    // Fetch historical data for similar requests
    const historicalQuery = `
      select
        extract(epoch from (updated_at - created_at)) / 86400 as days_to_complete,
        priority,
        type,
        system_type
      from requests
      where type = $1
        and status in ('done', 'closed')
        and updated_at > created_at
        and created_at > now() - interval '6 months'
      order by created_at desc
      limit 100
    `;

    const historicalResult = await dbQuery(historicalQuery, [requestType]);
    const historicalData = historicalResult.rows;

    // Calculate base estimate from historical data
    let estimatedDays = 7; // default
    let confidence = 0.5;
    const factors: CompletionTimePrediction['factors'] = {};

    if (historicalData.length > 0) {
      const avgDays = historicalData.reduce((sum, row) => sum + (row.days_to_complete || 0), 0) / historicalData.length;
      factors.historicalAverage = Math.round(avgDays * 10) / 10;
      estimatedDays = Math.ceil(avgDays);
      confidence = Math.min(0.9, 0.5 + (historicalData.length / 200));
    }

    // Adjust for priority
    const priorityMultipliers: Record<string, number> = {
      critical: 0.5,
      high: 0.7,
      medium: 1.0,
      low: 1.5,
    };
    const priorityMultiplier = priorityMultipliers[priority] || 1.0;
    estimatedDays = Math.ceil(estimatedDays * priorityMultiplier);
    factors.priorityImpact = priorityMultiplier;

    // Check executor performance if available
    if (executorIds.length > 0) {
      const executorQuery = `
        select avg(extract(epoch from (updated_at - created_at)) / 86400) as avg_days
        from requests
        where executor_ids && $1::text[]
          and status in ('done', 'closed')
          and created_at > now() - interval '3 months'
      `;
      const executorResult = await dbQuery(executorQuery, [executorIds]);
      if (executorResult.rows[0]?.avg_days) {
        factors.executorPerformance = Math.round(executorResult.rows[0].avg_days * 10) / 10;
        // Adjust estimate based on executor performance
        const executorFactor = executorResult.rows[0].avg_days / (factors.historicalAverage || estimatedDays);
        estimatedDays = Math.ceil(estimatedDays * executorFactor);
        confidence = Math.min(0.95, confidence + 0.1);
      }
    }

    // Find similar requests
    if (systemType) {
      const similarQuery = `
        select count(*) as count
        from requests
        where type = $1
          and system_type = $2
          and status in ('done', 'closed')
          and created_at > now() - interval '3 months'
      `;
      const similarResult = await dbQuery(similarQuery, [requestType, systemType]);
      if (similarResult.rows[0]?.count > 0) {
        factors.similarRequests = parseInt(similarResult.rows[0].count);
        confidence = Math.min(0.98, confidence + 0.05);
      }
    }

    // Store prediction
    await storePrediction(
      'service_request',
      requestId,
      'completion_time',
      { estimatedDays, confidence, factors },
      confidence
    );

    logger.info('Completion time predicted', {
      requestId,
      estimatedDays,
      confidence,
      factors,
    });

    return { estimatedDays, confidence, factors };
  } catch (error) {
    logger.error('Failed to predict completion time', {
      requestId,
      error: serializeError(error),
    });
    // Return default prediction on error
    return {
      estimatedDays: 7,
      confidence: 0.3,
      factors: {},
    };
  }
};

// Analyze sentiment of comments
export const analyzeSentiment = async (
  commentId: string,
  commentText: string
): Promise<SentimentAnalysis> => {
  try {
    if (!commentText || commentText.trim().length < 5) {
      return {
        sentiment: 'neutral',
        score: 0.5,
        isUrgent: false,
      };
    }

    const systemPrompt = `You are a sentiment analysis expert for service request comments. Analyze the sentiment and urgency of comments.
Return ONLY a JSON object with this structure:
{
  "sentiment": "positive" | "negative" | "neutral" | "urgent",
  "score": 0.0-1.0,
  "isUrgent": boolean,
  "keywords": ["keyword1", "keyword2"]
}

Guidelines:
- "urgent" sentiment for emergency situations, critical issues, or time-sensitive matters
- "negative" for complaints, problems, dissatisfaction
- "positive" for satisfaction, praise, completion
- "neutral" for informational updates
- isUrgent=true if immediate action is needed
- Extract 2-3 key words that indicate the sentiment`;

    const userPrompt = `Analyze this service request comment:\n\n"${commentText.substring(0, 500)}"`;

    const result = await callLLMWithFallback(systemPrompt, userPrompt, {
      temperature: 0.1,
      maxTokens: 200,
      timeoutMs: 8000,
    });

    if (result.content) {
      const parsed = extractJson<any>(result.content, null);
      if (parsed && parsed.sentiment) {
        const analysis: SentimentAnalysis = {
          sentiment: parsed.sentiment || 'neutral',
          score: Math.max(0, Math.min(1, parsed.score || 0.5)),
          isUrgent: Boolean(parsed.isUrgent),
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : undefined,
        };

        // Store prediction
        await storePrediction(
          'comment',
          commentId,
          'sentiment',
          analysis,
          analysis.score
        );

        logger.info('Sentiment analyzed', {
          commentId,
          sentiment: analysis.sentiment,
          isUrgent: analysis.isUrgent,
        });

        return analysis;
      }
    }

    // Fallback: simple keyword-based analysis
    const urgentKeywords = ['срочно', 'авария', 'критично', 'немедленно', 'экстренно', 'emergency', 'urgent', 'critical'];
    const negativeKeywords = ['проблема', 'не работает', 'сломан', 'ошибка', 'плохо', 'жалоба'];
    const positiveKeywords = ['спасибо', 'отлично', 'хорошо', 'решено', 'выполнено', 'благодарю'];

    const lowerText = commentText.toLowerCase();
    const isUrgent = urgentKeywords.some(kw => lowerText.includes(kw));
    const hasNegative = negativeKeywords.some(kw => lowerText.includes(kw));
    const hasPositive = positiveKeywords.some(kw => lowerText.includes(kw));

    let sentiment: SentimentAnalysis['sentiment'] = 'neutral';
    let score = 0.5;

    if (isUrgent) {
      sentiment = 'urgent';
      score = 0.9;
    } else if (hasNegative) {
      sentiment = 'negative';
      score = 0.3;
    } else if (hasPositive) {
      sentiment = 'positive';
      score = 0.8;
    }

    return { sentiment, score, isUrgent };
  } catch (error) {
    logger.error('Failed to analyze sentiment', {
      commentId,
      error: serializeError(error),
    });
    return {
      sentiment: 'neutral',
      score: 0.5,
      isUrgent: false,
    };
  }
};

// Detect anomalies in service requests
export const detectAnomalies = async (): Promise<AnomalyDetection[]> => {
  const anomalies: AnomalyDetection[] = [];

  try {
    // Detect stuck requests (no updates > 7 days)
    const stuckQuery = `
      select id, title, type, status, created_at, updated_at
      from requests
      where type in ('emergency', 'operation', 'maintenance_planned', 'general')
        and status not in ('done', 'closed', 'cancelled')
        and updated_at < now() - interval '7 days'
        and deleted_at is null
      order by updated_at asc
      limit 50
    `;

    const stuckResult = await dbQuery(stuckQuery);

    if (stuckResult.rows.length > 0) {
      const affectedIds = stuckResult.rows.map(r => r.id);
      anomalies.push({
        type: 'stuck_request',
        severity: stuckResult.rows.length > 10 ? 'high' : 'medium',
        description: `Found ${stuckResult.rows.length} service requests with no updates for more than 7 days`,
        affectedEntities: affectedIds,
      });

      // Store anomaly
      for (const row of stuckResult.rows.slice(0, 10)) {
        await storeAnomaly(
          'stuck_request',
          'service_request',
          row.id,
          'medium',
          `Request "${row.title || 'Untitled'}" has no updates for ${Math.floor((Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24))} days`,
          { status: row.status, lastUpdate: row.updated_at }
        );
      }
    }

    // Detect high-frequency issues (same problem > 3 times in last 30 days)
    const frequencyQuery = `
      select
        system_type,
        direction_id,
        count(*) as issue_count,
        array_agg(id) as request_ids
      from requests
      where type in ('emergency', 'operation')
        and created_at > now() - interval '30 days'
        and system_type is not null
        and direction_id is not null
        and deleted_at is null
      group by system_type, direction_id
      having count(*) >= 3
      order by count(*) desc
      limit 20
    `;

    const frequencyResult = await dbQuery(frequencyQuery);

    if (frequencyResult.rows.length > 0) {
      for (const row of frequencyResult.rows) {
        const severity = row.issue_count >= 5 ? 'high' : 'medium';
        anomalies.push({
          type: 'high_frequency_issue',
          severity,
          description: `System "${row.system_type}" at direction has ${row.issue_count} issues in the last 30 days`,
          affectedEntities: row.request_ids.slice(0, 10),
        });

        // Store anomaly for the most recent request
        if (row.request_ids.length > 0) {
          await storeAnomaly(
            'high_frequency_issue',
            'service_request',
            row.request_ids[0],
            severity,
            `High frequency issue detected: ${row.issue_count} similar requests in 30 days`,
            { systemType: row.system_type, directionId: row.direction_id, count: row.issue_count }
          );
        }
      }
    }

    // Detect overdue patterns
    const overdueQuery = `
      select id, title, type, priority, due_date_preliminary, created_at
      from requests
      where type in ('emergency', 'operation', 'maintenance_planned')
        and status not in ('done', 'closed', 'cancelled')
        and due_date_preliminary < current_date
        and deleted_at is null
      order by due_date_preliminary asc
      limit 30
    `;

    const overdueResult = await dbQuery(overdueQuery);

    if (overdueResult.rows.length > 5) {
      const affectedIds = overdueResult.rows.map(r => r.id);
      anomalies.push({
        type: 'overdue_pattern',
        severity: overdueResult.rows.length > 15 ? 'critical' : 'high',
        description: `Found ${overdueResult.rows.length} overdue service requests`,
        affectedEntities: affectedIds,
      });
    }

    logger.info('Anomaly detection completed', {
      anomalyCount: anomalies.length,
      types: anomalies.map(a => a.type),
    });

    return anomalies;
  } catch (error) {
    logger.error('Failed to detect anomalies', {
      error: serializeError(error),
    });
    return anomalies;
  }
};

// Alert admins about anomalies via Telegram
export const alertAdminsAboutAnomalies = async (anomalies: AnomalyDetection[]): Promise<void> => {
  if (anomalies.length === 0) return;

  try {
    // Get admin user IDs
    const adminQuery = `
      select id, telegram_chat_id
      from app_users
      where role in ('admin', 'manager')
        and status = 'active'
        and telegram_chat_id is not null
    `;

    const adminResult = await dbQuery(adminQuery);
    const admins = adminResult.rows;

    if (admins.length === 0) {
      logger.warn('No admins with Telegram configured for anomaly alerts');
      return;
    }

    // Group anomalies by severity
    const critical = anomalies.filter(a => a.severity === 'critical');
    const high = anomalies.filter(a => a.severity === 'high');
    const medium = anomalies.filter(a => a.severity === 'medium');

    let message = '🚨 *Обнаружены аномалии в системе*\n\n';

    if (critical.length > 0) {
      message += `⛔️ *Критические (${critical.length}):*\n`;
      critical.forEach(a => {
        message += `• ${a.description}\n`;
      });
      message += '\n';
    }

    if (high.length > 0) {
      message += `⚠️ *Высокий приоритет (${high.length}):*\n`;
      high.forEach(a => {
        message += `• ${a.description}\n`;
      });
      message += '\n';
    }

    if (medium.length > 0) {
      message += `ℹ️ *Средний приоритет (${medium.length}):*\n`;
      medium.slice(0, 3).forEach(a => {
        message += `• ${a.description}\n`;
      });
      if (medium.length > 3) {
        message += `• ...и еще ${medium.length - 3}\n`;
      }
    }

    // Send to all admins
    for (const admin of admins) {
      try {
        await pushTelegramNotification({
          recipientIds: [admin.id],
          title: 'Anomaly Alert',
          body: message,
          eventType: 'anomaly_detected',
        });
      } catch (notifyError) {
        logger.warn('Failed to send anomaly alert to admin', {
          adminId: admin.id,
          error: serializeError(notifyError),
        });
      }
    }

    // Also emit system alert
    await emitAlert({
      type: 'anomaly_detected',
      severity: critical.length > 0 ? 'critical' : high.length > 0 ? 'high' : 'medium',
      message: `Detected ${anomalies.length} anomalies in service requests`,
      dedupeKey: `anomaly_detection:${new Date().toISOString().split('T')[0]}`,
      context: {
        critical: critical.length,
        high: high.length,
        medium: medium.length,
      },
    });

    logger.info('Anomaly alerts sent to admins', {
      adminCount: admins.length,
      anomalyCount: anomalies.length,
    });
  } catch (error) {
    logger.error('Failed to alert admins about anomalies', {
      error: serializeError(error),
    });
  }
};

// Store prediction in database
const storePrediction = async (
  entityType: string,
  entityId: string,
  predictionType: PredictionType,
  predictionValue: unknown,
  confidenceScore?: number
): Promise<void> => {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Expire after 30 days

    await dbQuery(
      `insert into ai_predictions (entity_type, entity_id, prediction_type, prediction_value, confidence_score, expires_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [entityType, entityId, predictionType, JSON.stringify(predictionValue), confidenceScore, expiresAt]
    );
  } catch (error) {
    logger.warn('Failed to store prediction', {
      entityType,
      entityId,
      predictionType,
      error: serializeError(error),
    });
  }
};

// Store anomaly in database
const storeAnomaly = async (
  anomalyType: string,
  entityType: string,
  entityId: string,
  severity: string,
  description: string,
  metadata: Record<string, unknown>
): Promise<void> => {
  try {
    // Check if similar anomaly already exists (not resolved)
    const existingQuery = `
      select id from ai_anomalies
      where anomaly_type = $1
        and entity_type = $2
        and entity_id = $3
        and resolved_at is null
      limit 1
    `;
    const existing = await dbQuery(existingQuery, [anomalyType, entityType, entityId]);

    if (existing.rows.length > 0) {
      // Update existing anomaly
      await dbQuery(
        `update ai_anomalies
         set description = $1, metadata = $2, created_at = now()
         where id = $3`,
        [description, JSON.stringify(metadata), existing.rows[0].id]
      );
    } else {
      // Insert new anomaly
      await dbQuery(
        `insert into ai_anomalies (anomaly_type, entity_type, entity_id, severity, description, metadata)
         values ($1, $2, $3, $4, $5, $6)`,
        [anomalyType, entityType, entityId, severity, description, JSON.stringify(metadata)]
      );
    }
  } catch (error) {
    logger.warn('Failed to store anomaly', {
      anomalyType,
      entityType,
      entityId,
      error: serializeError(error),
    });
  }
};

// Get prediction for entity
export const getPrediction = async (
  entityType: string,
  entityId: string,
  predictionType: PredictionType
): Promise<unknown | null> => {
  try {
    const result = await dbQuery(
      `select prediction_value, confidence_score, created_at
       from ai_predictions
       where entity_type = $1
         and entity_id = $2
         and prediction_type = $3
         and (expires_at is null or expires_at > now())
       order by created_at desc
       limit 1`,
      [entityType, entityId, predictionType]
    );

    if (result.rows.length > 0) {
      return result.rows[0].prediction_value;
    }

    return null;
  } catch (error) {
    logger.warn('Failed to get prediction', {
      entityType,
      entityId,
      predictionType,
      error: serializeError(error),
    });
    return null;
  }
};

// Get anomalies
export const getAnomalies = async (
  entityType?: string,
  resolved?: boolean
): Promise<unknown[]> => {
  try {
    let query = `
      select id, anomaly_type, entity_type, entity_id, severity, description, metadata, created_at, resolved_at
      from ai_anomalies
      where 1=1
    `;
    const params: unknown[] = [];

    if (entityType) {
      params.push(entityType);
      query += ` and entity_type = $${params.length}`;
    }

    if (resolved !== undefined) {
      if (resolved) {
        query += ` and resolved_at is not null`;
      } else {
        query += ` and resolved_at is null`;
      }
    }

    query += ` order by created_at desc limit 100`;

    const result = await dbQuery(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Failed to get anomalies', {
      error: serializeError(error),
    });
    return [];
  }
};

// Resolve anomaly
export const resolveAnomaly = async (anomalyId: string, resolvedBy: string): Promise<void> => {
  try {
    await dbQuery(
      `update ai_anomalies
       set resolved_at = now(), resolved_by = $1
       where id = $2`,
      [resolvedBy, anomalyId]
    );

    logger.info('Anomaly resolved', { anomalyId, resolvedBy });
  } catch (error) {
    logger.error('Failed to resolve anomaly', {
      anomalyId,
      error: serializeError(error),
    });
    throw error;
  }
};
