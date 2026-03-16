import { callLLMWithFallback } from './aiService.js';
import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import { extractJson } from '../helpers/safeJsonParse.js';

export interface QualityIssue {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export interface QualityCheckResult {
  isValid: boolean;
  score: number;
  issues: QualityIssue[];
  suggestions: string[];
}

export interface DataConsistencyIssue {
  type: string;
  description: string;
  affectedRecords: string[];
  severity: 'high' | 'medium' | 'low';
}

/**
 * Detect incomplete service request fields
 */
export async function detectIncompleteRequest(
  requestData: any
): Promise<QualityCheckResult> {
  try {
    const issues: QualityIssue[] = [];

    // Basic validation
    if (!requestData.title || requestData.title.trim().length < 5) {
      issues.push({
        field: 'title',
        severity: 'error',
        message: 'Title is too short or missing',
        suggestion: 'Provide a clear, descriptive title (at least 5 characters)',
      });
    }

    if (!requestData.description || requestData.description.trim().length < 10) {
      issues.push({
        field: 'description',
        severity: 'error',
        message: 'Description is too short or missing',
        suggestion: 'Provide a detailed description of the issue (at least 10 characters)',
      });
    }

    if (!requestData.systemType) {
      issues.push({
        field: 'systemType',
        severity: 'warning',
        message: 'System type is not specified',
        suggestion: 'Select the appropriate system type for better routing',
      });
    }

    if (!requestData.priority) {
      issues.push({
        field: 'priority',
        severity: 'warning',
        message: 'Priority is not specified',
        suggestion: 'Set the priority level to help with scheduling',
      });
    }

    if (!requestData.tenantId) {
      issues.push({
        field: 'tenantId',
        severity: 'warning',
        message: 'Tenant is not specified',
        suggestion: 'Select the tenant for this request',
      });
    }

    // Use AI to analyze description quality
    if (requestData.description && requestData.description.trim().length >= 10) {
      const systemPrompt = `You are a quality control expert analyzing service request descriptions.
Evaluate the description for completeness, clarity, and actionability.
Identify missing information that would help resolve the request.
Return a JSON object with your analysis.

Format:
{
  "qualityScore": 0.85,
  "issues": [
    {
      "field": "description",
      "severity": "warning",
      "message": "issue description",
      "suggestion": "how to improve"
    }
  ],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

      const userPrompt = `Analyze this service request:

Title: ${requestData.title || 'N/A'}
Description: ${requestData.description}
System Type: ${requestData.systemType || 'N/A'}
Priority: ${requestData.priority || 'N/A'}

Evaluate the quality and completeness of this request.`;

      const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
        maxTokens: 1024,
        temperature: 0.3,
      });

      if (aiResult.content) {
        const analysis = extractJson<any>(aiResult.content, null);
        if (analysis) {
          if (analysis.issues && Array.isArray(analysis.issues)) {
            issues.push(...analysis.issues);
          }
          if (analysis.suggestions && Array.isArray(analysis.suggestions)) {
            const score = analysis.qualityScore || 0.5;
            return {
              isValid: issues.filter(i => i.severity === 'error').length === 0,
              score,
              issues,
              suggestions: analysis.suggestions,
            };
          }
        }
      }
    }

    // Calculate basic score
    const maxScore = 100;
    let score = maxScore;
    for (const issue of issues) {
      if (issue.severity === 'error') score -= 30;
      else if (issue.severity === 'warning') score -= 15;
      else score -= 5;
    }
    score = Math.max(0, score) / 100;

    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      score,
      issues,
      suggestions: [],
    };
  } catch (error) {
    logger.error('Error detecting incomplete request', { error });
    return {
      isValid: true,
      score: 0.5,
      issues: [],
      suggestions: [],
    };
  }
}

/**
 * Flag potential issues in project data
 */
export async function flagProjectIssues(
  projectData: any
): Promise<QualityCheckResult> {
  try {
    const issues: QualityIssue[] = [];

    // Check for missing critical fields
    if (!projectData.title || projectData.title.trim().length < 5) {
      issues.push({
        field: 'title',
        severity: 'error',
        message: 'Project title is too short or missing',
        suggestion: 'Provide a clear project title',
      });
    }

    if (!projectData.tenantId) {
      issues.push({
        field: 'tenantId',
        severity: 'error',
        message: 'Tenant is not specified',
        suggestion: 'Select the tenant for this project',
      });
    }

    if (!projectData.executorIds || projectData.executorIds.length === 0) {
      issues.push({
        field: 'executorIds',
        severity: 'warning',
        message: 'No executors assigned',
        suggestion: 'Assign at least one executor to the project',
      });
    }

    if (!projectData.dueDatePreliminary && !projectData.dueDateAdmin) {
      issues.push({
        field: 'dueDate',
        severity: 'warning',
        message: 'No due date specified',
        suggestion: 'Set a preliminary or admin due date',
      });
    }

    // Check for date consistency
    if (projectData.dueDatePreliminary && projectData.dueDateAdmin) {
      const prelim = new Date(projectData.dueDatePreliminary);
      const admin = new Date(projectData.dueDateAdmin);
      if (admin < prelim) {
        issues.push({
          field: 'dueDate',
          severity: 'warning',
          message: 'Admin due date is earlier than preliminary due date',
          suggestion: 'Ensure due dates are consistent',
        });
      }
    }

    // Use AI to analyze project data
    const systemPrompt = `You are a quality control expert analyzing project data.
Identify potential issues, inconsistencies, or missing information.
Return a JSON object with your analysis.

Format:
{
  "qualityScore": 0.85,
  "issues": [
    {
      "field": "field_name",
      "severity": "error|warning|info",
      "message": "issue description",
      "suggestion": "how to fix"
    }
  ],
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

    const userPrompt = `Analyze this project:

Title: ${projectData.title || 'N/A'}
Description: ${projectData.description || 'N/A'}
Tenant: ${projectData.tenantId || 'N/A'}
Executors: ${projectData.executorIds?.length || 0} assigned
Stage: ${projectData.stage || 'N/A'}
Status: ${projectData.status || 'N/A'}
Due Date (Preliminary): ${projectData.dueDatePreliminary || 'N/A'}
Due Date (Admin): ${projectData.dueDateAdmin || 'N/A'}

Identify any issues or inconsistencies.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 1024,
      temperature: 0.3,
    });

    if (aiResult.content) {
      const analysis = extractJson<any>(aiResult.content, null);
      if (analysis) {
        if (analysis.issues && Array.isArray(analysis.issues)) {
          issues.push(...analysis.issues);
        }
        if (analysis.suggestions && Array.isArray(analysis.suggestions)) {
          const score = analysis.qualityScore || 0.5;
          return {
            isValid: issues.filter(i => i.severity === 'error').length === 0,
            score,
            issues,
            suggestions: analysis.suggestions,
          };
        }
      }
    }

    // Calculate basic score
    const maxScore = 100;
    let score = maxScore;
    for (const issue of issues) {
      if (issue.severity === 'error') score -= 30;
      else if (issue.severity === 'warning') score -= 15;
      else score -= 5;
    }
    score = Math.max(0, score) / 100;

    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      score,
      issues,
      suggestions: [],
    };
  } catch (error) {
    logger.error('Error flagging project issues', { error });
    return {
      isValid: true,
      score: 0.5,
      issues: [],
      suggestions: [],
    };
  }
}

/**
 * Suggest improvements to descriptions
 */
export async function suggestDescriptionImprovements(
  description: string,
  context: string = 'service_request'
): Promise<string[]> {
  try {
    const systemPrompt = `You are an expert at improving technical descriptions.
Analyze the description and suggest specific improvements to make it clearer and more actionable.
Return a JSON array of suggestions.

Format:
["suggestion 1", "suggestion 2", "suggestion 3"]`;

    const userPrompt = `Context: ${context}
Description: ${description}

Suggest 3-5 specific improvements to make this description clearer and more actionable.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.5,
    });

    if (!aiResult.content) {
      return [];
    }

    // Parse JSON response
    const suggestions = extractJson<string[]>(aiResult.content, []);
    return suggestions.slice(0, 5);
  } catch (error) {
    logger.error('Error suggesting description improvements', { error });
    return [];
  }
}

/**
 * Validate data consistency across related records
 */
export async function validateDataConsistency(
  recordType: string,
  recordId: string
): Promise<DataConsistencyIssue[]> {
  try {
    const issues: DataConsistencyIssue[] = [];

    if (recordType === 'project') {
      // Check project consistency
      const projectQuery = `
        SELECT
          p.id,
          p.title,
          p.status,
          p.stage,
          p.tenant_id,
          p.executor_ids,
          p.due_date_preliminary,
          p.due_date_admin,
          t.id as tenant_exists
        FROM requests p
        LEFT JOIN tenants t ON p.tenant_id = t.id
        WHERE p.id = $1 AND p.type = 'installation' AND p.is_project = true
      `;

      const result = await dbQuery(projectQuery, [recordId]);
      if (result.rows.length === 0) {
        return issues;
      }

      const project = result.rows[0];

      // Check if tenant exists
      if (project.tenant_id && !project.tenant_exists) {
        issues.push({
          type: 'missing_reference',
          description: 'Project references a tenant that does not exist',
          affectedRecords: [recordId],
          severity: 'high',
        });
      }

      // Check if executors exist
      if (project.executor_ids && project.executor_ids.length > 0) {
        const executorQuery = `
          SELECT id FROM users WHERE id = ANY($1) AND deleted_at IS NULL
        `;
        const executorResult = await dbQuery(executorQuery, [project.executor_ids]);
        const existingExecutors = executorResult.rows.map(r => r.id);
        const missingExecutors = project.executor_ids.filter(
          (id: string) => !existingExecutors.includes(id)
        );

        if (missingExecutors.length > 0) {
          issues.push({
            type: 'missing_reference',
            description: `Project references ${missingExecutors.length} executor(s) that do not exist`,
            affectedRecords: [recordId],
            severity: 'medium',
          });
        }
      }

      // Check date consistency
      if (project.due_date_preliminary && project.due_date_admin) {
        const prelim = new Date(project.due_date_preliminary);
        const admin = new Date(project.due_date_admin);
        if (admin < prelim) {
          issues.push({
            type: 'data_inconsistency',
            description: 'Admin due date is earlier than preliminary due date',
            affectedRecords: [recordId],
            severity: 'low',
          });
        }
      }

      // Check stage-status consistency
      const completedStages = ['completed', 'cancelled'];
      const activeStatuses = ['new', 'in_progress'];
      if (completedStages.includes(project.stage) && activeStatuses.includes(project.status)) {
        issues.push({
          type: 'data_inconsistency',
          description: 'Project stage indicates completion but status is still active',
          affectedRecords: [recordId],
          severity: 'medium',
        });
      }
    } else if (recordType === 'service_request') {
      // Check service request consistency
      const requestQuery = `
        SELECT
          r.id,
          r.title,
          r.status,
          r.tenant_id,
          r.executor_ids,
          t.id as tenant_exists
        FROM requests r
        LEFT JOIN tenants t ON r.tenant_id = t.id
        WHERE r.id = $1 AND r.is_project = false
      `;

      const result = await dbQuery(requestQuery, [recordId]);
      if (result.rows.length === 0) {
        return issues;
      }

      const request = result.rows[0];

      // Check if tenant exists
      if (request.tenant_id && !request.tenant_exists) {
        issues.push({
          type: 'missing_reference',
          description: 'Service request references a tenant that does not exist',
          affectedRecords: [recordId],
          severity: 'high',
        });
      }

      // Check if executors exist
      if (request.executor_ids && request.executor_ids.length > 0) {
        const executorQuery = `
          SELECT id FROM users WHERE id = ANY($1) AND deleted_at IS NULL
        `;
        const executorResult = await dbQuery(executorQuery, [request.executor_ids]);
        const existingExecutors = executorResult.rows.map(r => r.id);
        const missingExecutors = request.executor_ids.filter(
          (id: string) => !existingExecutors.includes(id)
        );

        if (missingExecutors.length > 0) {
          issues.push({
            type: 'missing_reference',
            description: `Service request references ${missingExecutors.length} executor(s) that do not exist`,
            affectedRecords: [recordId],
            severity: 'medium',
          });
        }
      }
    }

    return issues;
  } catch (error) {
    logger.error('Error validating data consistency', { error });
    return [];
  }
}

/**
 * Perform comprehensive quality check on a record
 */
export async function performQualityCheck(
  recordType: string,
  recordData: any
): Promise<QualityCheckResult> {
  try {
    if (recordType === 'service_request') {
      return await detectIncompleteRequest(recordData);
    } else if (recordType === 'project') {
      return await flagProjectIssues(recordData);
    }

    return {
      isValid: true,
      score: 1.0,
      issues: [],
      suggestions: [],
    };
  } catch (error) {
    logger.error('Error performing quality check', { error });
    return {
      isValid: true,
      score: 0.5,
      issues: [],
      suggestions: [],
    };
  }
}
