import { callLLMWithFallback } from './aiService.js';
import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import { extractJson } from '../helpers/safeJsonParse.js';

export interface SimilarSolution {
  requestId: string;
  title: string;
  description: string;
  resolution: string;
  similarity: number;
  systemType: string;
  executorIds: string[];
}

export interface ExecutorRecommendation {
  userId: string;
  userName: string;
  score: number;
  reason: string;
  currentWorkload: number;
  expertise: string[];
}

export interface ScheduleRecommendation {
  suggestedDate: string;
  confidence: number;
  reasoning: string;
  estimatedDuration: number;
}

/**
 * Find similar past solutions based on description and system type
 */
export async function findSimilarSolutions(
  description: string,
  systemType: string,
  limit: number = 5
): Promise<SimilarSolution[]> {
  try {
    // Query completed service requests with resolutions
    const query = `
      SELECT
        id,
        title,
        description,
        resolution,
        system_type,
        executor_ids
      FROM requests
      WHERE is_project = false
        AND status IN ('done', 'closed')
        AND resolution IS NOT NULL
        AND resolution::text != '{}'
        AND deleted_at IS NULL
        ${systemType ? "AND system_type = $1" : ""}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const params = systemType ? [systemType] : [];
    const result = await dbQuery(query, params);

    if (result.rows.length === 0) {
      return [];
    }

    // Use AI to find semantic similarity
    const systemPrompt = `You are an expert at analyzing service requests for building security systems (fire alarms APS, access control SKUD, CCTV/SVN, fire suppression AUPT, emergency notification SOUE, structured cabling SKS, intrusion detection SOTS, etc.).

Given a new service request description, analyze past completed requests and identify the most similar ones.

Think step by step:
1. Identify the system type and nature of the problem in the new request.
2. For each past request, compare: system type, problem symptoms, affected equipment, location context.
3. Assign a similarity score (0-1) based on how relevant the past solution would be.
4. Explain your reasoning — WHY is this past request similar and how its solution might help.

Return a JSON array of similar requests with similarity scores (0-1).

Format:
[
  {
    "requestId": "uuid",
    "similarity": 0.95,
    "reasoning": "explanation of why this is similar and how the solution applies"
  }
]

Example:
New request: "Camera on 2nd floor parking shows black screen"
Past request: "Camera replacement at checkpoint — camera failed, replaced with new unit"
Result: {"requestId":"...", "similarity": 0.85, "reasoning": "Both involve SVN camera failure. Past solution was hardware replacement, which may apply here if the camera is faulty rather than having a connection issue."}`;

    const userPrompt = `New request description: "${description}"

Past completed requests:
${result.rows.map((row, idx) => `
${idx + 1}. ID: ${row.id}
   Title: ${row.title || 'N/A'}
   Description: ${row.description}
   Resolution: ${JSON.stringify(row.resolution)}
`).join('\n')}

Identify the ${limit} most similar requests and return as JSON array.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 2048,
      temperature: 0.2,
    });

    if (!aiResult.content) {
      logger.warn('AI similar solutions returned no content');
      return [];
    }

    // Parse AI response
    const similarities = extractJson<any[]>(aiResult.content, []);
    if (similarities.length === 0) {
      logger.warn('AI similar solutions returned no usable JSON');
      return [];
    }

    // Map to full solution objects
    const solutions: SimilarSolution[] = [];
    for (const sim of similarities.slice(0, limit)) {
      const row = result.rows.find(r => r.id === sim.requestId);
      if (row) {
        solutions.push({
          requestId: row.id,
          title: row.title || '',
          description: row.description || '',
          resolution: typeof row.resolution === 'string'
            ? row.resolution
            : JSON.stringify(row.resolution),
          similarity: sim.similarity || 0,
          systemType: row.system_type || '',
          executorIds: row.executor_ids || [],
        });
      }
    }

    return solutions;
  } catch (error) {
    logger.error('Error finding similar solutions', { error });
    return [];
  }
}

/**
 * Recommend executors based on workload and expertise
 */
export async function recommendExecutors(
  systemType: string,
  description: string,
  priority: string = 'medium'
): Promise<ExecutorRecommendation[]> {
  try {
    // Get active users with their workload
    const usersQuery = `
      SELECT
        u.id,
        u.full_name as name,
        u.email,
        u.role::text,
        COUNT(DISTINCT r.id) FILTER (WHERE r.status IN ('new', 'in_progress', 'pending')) as active_requests
      FROM app_users u
      LEFT JOIN requests r ON u.id::text = ANY(r.executor_ids) AND r.deleted_at IS NULL
      WHERE u.status = 'active'
        AND u.role IN ('admin', 'manager', 'dispatcher', 'executor', 'installer')
      GROUP BY u.id, u.full_name, u.email, u.role
      ORDER BY active_requests ASC
    `;

    const usersResult = await dbQuery(usersQuery, []);

    if (usersResult.rows.length === 0) {
      return [];
    }

    // Get expertise from past completed requests
    const expertiseQuery = `
      SELECT
        unnest(executor_ids) as user_id,
        system_type,
        COUNT(*) as completed_count
      FROM requests
      WHERE is_project = false
        AND status IN ('done', 'closed')
        AND deleted_at IS NULL
        AND system_type IS NOT NULL
      GROUP BY user_id, system_type
    `;

    const expertiseResult = await dbQuery(expertiseQuery, []);

    // Build expertise map
    const expertiseMap = new Map<string, Map<string, number>>();
    for (const row of expertiseResult.rows) {
      if (!expertiseMap.has(row.user_id)) {
        expertiseMap.set(row.user_id, new Map());
      }
      expertiseMap.get(row.user_id)!.set(row.system_type, row.completed_count);
    }

    // Use AI to rank executors
    const systemPrompt = `You are an expert at recommending the best executors for building security system service requests (fire alarms APS, access control SKUD, CCTV/SVN, fire suppression AUPT, etc.).

Think step by step:
1. Understand the request: what system type, what kind of work, what priority.
2. For each executor, evaluate: expertise in the specific system type, current workload, total experience.
3. For high-priority requests, prefer executors with direct expertise even if busier.
4. For low-priority requests, prefer executors with lower workload.
5. Explain your reasoning for each recommendation.

Return a JSON array with scores and reasoning.

Format:
[
  {
    "userId": "uuid",
    "score": 0.95,
    "reason": "detailed explanation of why this executor is the best fit"
  }
]

Example:
Request: APS fire alarm maintenance, medium priority
Executor A: 5 completed APS tasks, 2 active requests
Executor B: 0 completed APS tasks, 0 active requests
Result: [{"userId":"A-id", "score": 0.9, "reason": "Has 5 completed APS tasks showing strong expertise in fire alarm systems. Current workload of 2 is manageable for medium priority."}, {"userId":"B-id", "score": 0.5, "reason": "No APS experience but available. Could handle the task with guidance."}]`;

    const userPrompt = `Request details:
System Type: ${systemType}
Description: ${description}
Priority: ${priority}

Available executors:
${usersResult.rows.map((user, idx) => {
  const userExpertise = expertiseMap.get(user.id);
  const systemExpertise = userExpertise?.get(systemType) || 0;
  const totalExpertise = userExpertise
    ? Array.from(userExpertise.values()).reduce((a, b) => a + b, 0)
    : 0;

  return `${idx + 1}. ID: ${user.id}
   Name: ${user.name}
   Role: ${user.role}
   Current workload: ${user.active_requests} active requests
   Expertise in ${systemType}: ${systemExpertise} completed
   Total completed: ${totalExpertise}`;
}).join('\n')}

Recommend the top 3 executors and return as JSON array.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 1024,
      temperature: 0.3,
    });

    if (!aiResult.content) {
      logger.warn('AI executor recommendations returned no content');
      return [];
    }

    // Parse AI response
    const recommendations = extractJson<any[]>(aiResult.content, []);
    if (recommendations.length === 0) {
      logger.warn('AI executor recommendations returned no usable JSON');
      return [];
    }

    // Map to full recommendation objects
    const results: ExecutorRecommendation[] = [];
    for (const rec of recommendations.slice(0, 3)) {
      const user = usersResult.rows.find(u => u.id === rec.userId);
      if (user) {
        const userExpertise = expertiseMap.get(user.id);
        const expertiseList = userExpertise
          ? Array.from(userExpertise.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([type]) => type)
          : [];

        results.push({
          userId: user.id,
          userName: user.name,
          score: rec.score || 0,
          reason: rec.reason || '',
          currentWorkload: user.active_requests || 0,
          expertise: expertiseList,
        });
      }
    }

    return results;
  } catch (error) {
    logger.error('Error recommending executors', { error });
    return [];
  }
}

/**
 * Predict optimal scheduling based on workload and patterns
 */
export async function predictOptimalSchedule(
  systemType: string,
  priority: string,
  executorIds: string[]
): Promise<ScheduleRecommendation | null> {
  try {
    // Get historical completion times
    const historyQuery = `
      SELECT
        system_type,
        priority,
        created_at,
        updated_at,
        EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600 as duration_hours
      FROM requests
      WHERE is_project = false
        AND status IN ('done', 'closed')
        AND deleted_at IS NULL
        AND system_type = $1
        AND updated_at > created_at
      ORDER BY created_at DESC
      LIMIT 20
    `;

    const historyResult = await dbQuery(historyQuery, [systemType]);

    if (historyResult.rows.length === 0) {
      return null;
    }

    // Get current workload for executors
    const workloadQuery = `
      SELECT
        COUNT(*) as active_count,
        MIN(due_date_preliminary) as earliest_due
      FROM requests
      WHERE deleted_at IS NULL
        AND status IN ('new', 'in_progress', 'pending')
        AND executor_ids && $1
    `;

    const workloadResult = await dbQuery(workloadQuery, [executorIds]);

    // Use AI to predict optimal schedule
    const systemPrompt = `You are an expert at predicting optimal scheduling for building security system service requests (fire alarms, CCTV, access control, fire suppression, etc.).

Think step by step:
1. Analyze historical completion times for this system type.
2. Consider current executor workload and their earliest due dates.
3. Account for priority: critical requests should start ASAP, low-priority can be deferred.
4. Factor in typical maintenance windows (weekdays preferred for non-emergency work).
5. Explain your reasoning, including what factors influenced the date choice.

Return a JSON object with your recommendation.

Format:
{
  "suggestedDate": "YYYY-MM-DD",
  "confidence": 0.85,
  "reasoning": "detailed explanation of why this date was chosen",
  "estimatedDuration": 24
}

Example:
System: APS, Priority: medium, Avg completion: 8h, Active workload: 3 requests, Earliest due: 2025-01-20
Result: {"suggestedDate":"2025-01-22","confidence":0.8,"reasoning":"Medium priority APS work with 8h average duration. Executors have 3 active requests with earliest due Jan 20, so scheduling for Jan 22 allows current tasks to be completed first. Weekday scheduling preferred for planned maintenance.","estimatedDuration":8}`;

    const avgDuration = historyResult.rows.reduce((sum, row) => sum + parseFloat(row.duration_hours), 0) / historyResult.rows.length;

    const userPrompt = `Request details:
System Type: ${systemType}
Priority: ${priority}
Assigned Executors: ${executorIds.length}

Historical data:
- Average completion time: ${avgDuration.toFixed(1)} hours
- Recent completions: ${historyResult.rows.length}
- Completion times: ${historyResult.rows.map(r => `${parseFloat(r.duration_hours).toFixed(1)}h`).join(', ')}

Current workload:
- Active requests for executors: ${workloadResult.rows[0]?.active_count || 0}
- Earliest due date: ${workloadResult.rows[0]?.earliest_due || 'none'}

Today's date: ${new Date().toISOString().split('T')[0]}

Recommend the optimal start date and estimated duration.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.2,
    });

    if (!aiResult.content) {
      logger.warn('AI schedule prediction returned no content');
      return null;
    }

    // Parse AI response
    const recommendation = extractJson(aiResult.content, null as any);
    if (!recommendation) {
      logger.warn('AI schedule prediction returned invalid JSON');
      return null;
    }

    return {
      suggestedDate: recommendation.suggestedDate || '',
      confidence: recommendation.confidence || 0,
      reasoning: recommendation.reasoning || '',
      estimatedDuration: recommendation.estimatedDuration || Math.ceil(avgDuration),
    };
  } catch (error) {
    logger.error('Error predicting optimal schedule', { error });
    return null;
  }
}
