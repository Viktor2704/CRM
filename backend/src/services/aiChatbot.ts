import { callLLMWithFallback } from './aiService.js';
import { dbQuery } from '../db.js';
import { logger } from '../logger.js';
import { extractJson } from '../helpers/safeJsonParse.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface ChatContext {
  userId: string;
  userRole: string;
  currentPage?: string;
  recentActions?: string[];
}

export interface ChatResponse {
  message: string;
  suggestions?: string[];
  relatedLinks?: Array<{ title: string; url: string }>;
  confidence: number;
}

/**
 * Build system context for the chatbot
 */
async function buildSystemContext(context: ChatContext): Promise<string> {
  const systemInfo = `You are a helpful AI assistant for the Novinzhstroy facility management system — a company specializing in installation and maintenance of building security systems.

Domain expertise:
- Fire alarm systems (APS): smoke detectors, heat detectors, fire alarm control panels
- Fire suppression (AUPT): sprinklers, drenchers, gas suppression
- Fire notification (SOUE): sirens, speakers, emergency exit signs
- Internal fire water supply (VPV): fire hydrants, pumps, standpipes
- Access control (SKUD): turnstiles, intercoms, card readers, electric locks
- Video surveillance (SVN/CCTV): cameras, NVR/DVR, storage servers
- Structured cabling (SKS): cable infrastructure, patch panels
- Intrusion detection (SOTS): motion sensors, perimeter protection
- Building automation (ASUTP): controllers, SCADA systems

System capabilities:
- Service request management (create, track, update requests for maintenance and repairs)
- Project/installation management (track security system installation projects, deadlines, stages)
- Maintenance planning (schedule preventive maintenance per GOST/SP regulations, track items)
- Tenant management (manage building tenants, contacts, contracts)
- User management (manage users, roles, permissions)
- Calendar and scheduling
- Notifications and alerts
- Reports and analytics
- Document management
- Knowledge base

User context:
- Role: ${context.userRole}
- Current page: ${context.currentPage || 'unknown'}
- Recent actions: ${context.recentActions?.join(', ') || 'none'}

Available roles:
- admin: Full system access
- manager: Manage projects, requests, users
- engineer: Work on projects and requests
- technician: Execute maintenance tasks
- client: View own projects and requests
- viewer: Read-only access

Instructions:
- Think step by step when analyzing data or providing recommendations.
- Respond in a helpful, concise manner. Provide step-by-step instructions when needed.
- Explain your reasoning when making suggestions or recommendations.
- If you don't know something, say so and suggest where to find the information.
- Use domain-specific terminology where appropriate (APS, SKUD, SVN, etc.).`;

  return systemInfo;
}

/**
 * Get relevant knowledge base articles
 */
async function getRelevantKnowledgeBase(query: string, limit: number = 3): Promise<any[]> {
  try {
    const searchQuery = `
      SELECT
        id,
        title,
        content,
        metadata->>'category' as category,
        metadata->>'tags' as tags
      FROM knowledge_base_documents
      WHERE deleted_at IS NULL
        AND (
          to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', $1)
          OR title ILIKE $2
        )
      ORDER BY created_at DESC
      LIMIT $3
    `;

    const result = await dbQuery(searchQuery, [query, `%${query}%`, limit]);
    return result.rows;
  } catch (error) {
    logger.error('Error fetching knowledge base articles', { error });
    return [];
  }
}

/**
 * Get system statistics for context
 */
async function getSystemStats(userId: string): Promise<any> {
  try {
    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM requests WHERE type != 'installation' AND status NOT IN ('done', 'closed', 'cancelled') AND deleted_at IS NULL) as active_requests,
        (SELECT COUNT(*) FROM requests WHERE is_project = true AND status NOT IN ('done', 'closed', 'cancelled') AND deleted_at IS NULL) as active_projects,
        (SELECT COUNT(*) FROM requests WHERE $1::text = ANY(executor_ids) AND status NOT IN ('done', 'closed', 'cancelled') AND deleted_at IS NULL) as my_tasks,
        (SELECT COUNT(*) FROM app_notifications WHERE user_id = $1::uuid AND is_read = false) as unread_notifications
    `;

    const result = await dbQuery(statsQuery, [userId]);
    return result.rows[0] || {};
  } catch (error) {
    logger.error('Error fetching system stats', { error });
    return {};
  }
}

/**
 * Process chat message and generate response
 */
export async function processChatMessage(
  message: string,
  context: ChatContext,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  try {
    // Build system context
    const systemContext = await buildSystemContext(context);

    // Get relevant knowledge base articles
    const kbArticles = await getRelevantKnowledgeBase(message);

    // Get system stats
    const stats = await getSystemStats(context.userId);

    // Build conversation context
    const conversationContext = conversationHistory
      .slice(-5) // Last 5 messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Build enhanced system prompt
    const systemPrompt = `${systemContext}

Current system statistics:
- Active service requests: ${stats.active_requests || 0}
- Active projects: ${stats.active_projects || 0}
- My assigned tasks: ${stats.my_tasks || 0}
- Unread notifications: ${stats.unread_notifications || 0}

${kbArticles.length > 0 ? `Relevant knowledge base articles:
${kbArticles.map((article, idx) => `${idx + 1}. ${article.title}
   Category: ${article.category}
   Summary: ${article.content.slice(0, 200)}...`).join('\n')}` : ''}

Provide helpful, accurate responses. Include relevant links or suggestions when appropriate.
Format your response as JSON:
{
  "message": "your response",
  "suggestions": ["suggestion 1", "suggestion 2"],
  "relatedLinks": [{"title": "link title", "url": "/path"}],
  "confidence": 0.9
}`;

    const userPrompt = `${conversationContext ? `Previous conversation:\n${conversationContext}\n\n` : ''}User question: ${message}`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 1024,
      temperature: 0.7,
    });

    if (!aiResult.content) {
      logger.warn('AI chatbot returned no content');
      return {
        message: 'I apologize, but I am unable to process your request at the moment. Please try again or contact support.',
        confidence: 0,
      };
    }

    // Try to parse JSON response
    const parsed = extractJson<any>(aiResult.content, null);
    if (parsed && parsed.message) {
      return {
        message: parsed.message,
        suggestions: parsed.suggestions || [],
        relatedLinks: parsed.relatedLinks || [],
        confidence: parsed.confidence || 0.7,
      };
    }

    // Return plain text response
    return {
      message: aiResult.content,
      confidence: 0.7,
    };
  } catch (error) {
    logger.error('Error processing chat message', { error });
    return {
      message: 'I apologize, but an error occurred while processing your request. Please try again.',
      confidence: 0,
    };
  }
}

/**
 * Provide contextual help based on current page
 */
export async function getContextualHelp(
  page: string,
  userRole: string
): Promise<ChatResponse> {
  try {
    const systemPrompt = `You are a helpful AI assistant providing contextual help for the Novinzhstroy system — a building security systems management platform (fire alarms APS, CCTV/SVN, access control SKUD, fire suppression AUPT, notification SOUE, etc.).

Think step by step:
1. Consider the current page and its purpose in the context of managing building security systems.
2. Think about what the user's role allows them to do on this page.
3. Suggest the most useful actions and related pages.
4. Explain your reasoning briefly in the message.

Provide a brief overview of the current page and what the user can do here.
Format as JSON:
{
  "message": "page overview and help",
  "suggestions": ["action 1", "action 2", "action 3"],
  "relatedLinks": [{"title": "link", "url": "/path"}],
  "confidence": 0.9
}

Example for service-requests page with engineer role:
{
  "message": "Here you can view and manage service requests for security system maintenance and repairs. As an engineer, you can update statuses and add resolution details.",
  "suggestions": ["Filter requests by system type (APS, SKUD, SVN)", "Check your assigned requests", "Update resolution for completed requests"],
  "relatedLinks": [{"title": "Dashboard", "url": "/dashboard"}, {"title": "Calendar", "url": "/calendar"}],
  "confidence": 0.9
}`;

    const pageDescriptions: Record<string, string> = {
      dashboard: 'Dashboard - Overview of system activity, statistics, and quick actions',
      'service-requests': 'Service Requests - Create and manage service requests',
      projects: 'Projects - Track installation projects and their progress',
      installations: 'Installations - Manage installation projects with stages and deadlines',
      maintenance: 'Maintenance - Schedule and track maintenance plans',
      tenants: 'Tenants - Manage tenant information and contacts',
      users: 'Users - Manage system users and permissions',
      calendar: 'Calendar - View and manage scheduled events',
      notifications: 'Notifications - View system notifications and alerts',
      reports: 'Reports - Generate and view system reports',
      'knowledge-base': 'Knowledge Base - Access documentation and guides',
    };

    const userPrompt = `Current page: ${page}
Page description: ${pageDescriptions[page] || 'Unknown page'}
User role: ${userRole}

Provide contextual help for this page, including what the user can do and helpful tips.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.5,
    });

    if (!aiResult.content) {
      return {
        message: 'Help information is currently unavailable.',
        confidence: 0,
      };
    }

    // Try to parse JSON response
    const parsed = extractJson<any>(aiResult.content, null);
    if (parsed && parsed.message) {
      return {
        message: parsed.message,
        suggestions: parsed.suggestions || [],
        relatedLinks: parsed.relatedLinks || [],
        confidence: parsed.confidence || 0.8,
      };
    }

    return {
      message: aiResult.content,
      confidence: 0.8,
    };
  } catch (error) {
    logger.error('Error getting contextual help', { error });
    return {
      message: 'Help information is currently unavailable.',
      confidence: 0,
    };
  }
}

/**
 * Suggest navigation based on user intent
 */
export async function suggestNavigation(
  userIntent: string,
  userRole: string
): Promise<Array<{ title: string; url: string; description: string }>> {
  try {
    const systemPrompt = `You are a navigation assistant for the Novinzhstroy system — a building security systems management platform (APS, SKUD, SVN, AUPT, SOUE, etc.).

Think step by step:
1. Understand what the user wants to do.
2. Consider which pages are most relevant to their intent and role.
3. Explain why each suggested page is relevant.

Return a JSON array of navigation suggestions.

Format:
[
  {
    "title": "Page Name",
    "url": "/page-path",
    "description": "Why this page is relevant"
  }
]

Example for intent "I need to check fire alarm maintenance schedule":
[
  {"title": "Maintenance", "url": "/maintenance", "description": "View and manage APS maintenance schedules and plans"},
  {"title": "Service Requests", "url": "/service-requests", "description": "Check if there are open service requests related to fire alarm systems"},
  {"title": "Calendar", "url": "/calendar", "description": "See upcoming maintenance events on the calendar"}
]`;

    const userPrompt = `User intent: ${userIntent}
User role: ${userRole}

Available pages:
- /dashboard - System overview
- /service-requests - Service request management
- /projects - Project tracking
- /installations - Installation management
- /maintenance - Maintenance planning
- /tenants - Tenant management
- /users - User management
- /calendar - Event calendar
- /notifications - Notifications
- /reports - Reports and analytics
- /knowledge-base - Documentation

Suggest the 3 most relevant pages for this user intent.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.3,
    });

    if (!aiResult.content) {
      return [];
    }

    // Parse JSON response
    const suggestions = extractJson<any[]>(aiResult.content, []);
    return suggestions.slice(0, 3);
  } catch (error) {
    logger.error('Error suggesting navigation', { error });
    return [];
  }
}

/**
 * Answer frequently asked questions
 */
export async function answerFaq(
  question: string,
  userRole: string
): Promise<string> {
  try {
    // Check knowledge base first
    const kbArticles = await getRelevantKnowledgeBase(question, 1);

    const systemPrompt = `You are a helpful assistant answering frequently asked questions about the Novinzhstroy system — a platform for managing building security systems (fire alarms APS, access control SKUD, CCTV/SVN, fire suppression AUPT, emergency notification SOUE, structured cabling SKS, intrusion detection SOTS, etc.).

Think step by step:
1. Understand the question and identify the relevant domain area.
2. Check if the knowledge base article provides a direct answer.
3. If yes, provide a clear answer based on it. If not, provide general guidance based on your domain knowledge.
4. Explain your reasoning and suggest next steps.

Provide clear, concise answers based on the knowledge base and system documentation.
If you don't know the answer, suggest where the user can find more information (e.g., knowledge base, documentation, or contacting support).`;

    const userPrompt = `Question: ${question}
User role: ${userRole}

${kbArticles.length > 0 ? `Relevant knowledge base article:
Title: ${kbArticles[0].title}
Content: ${kbArticles[0].content.slice(0, 1000)}` : 'No relevant knowledge base articles found.'}

Provide a helpful answer to the question.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 512,
      temperature: 0.5,
    });

    return aiResult.content || 'I apologize, but I could not find an answer to your question. Please contact support for assistance.';
  } catch (error) {
    logger.error('Error answering FAQ', { error });
    return 'An error occurred while processing your question. Please try again.';
  }
}
