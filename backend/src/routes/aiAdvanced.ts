import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  findSimilarSolutions,
  recommendExecutors,
  predictOptimalSchedule,
} from '../services/aiSmartSuggestions.js';
import {
  extractTextFromDocument,
  analyzeDocument,
  autoFillFormFromDocument,
} from '../services/aiDocumentAnalysis.js';
import {
  processChatMessage,
  getContextualHelp,
  suggestNavigation,
  answerFaq,
} from '../services/aiChatbot.js';
import {
  detectIncompleteRequest,
  flagProjectIssues,
  suggestDescriptionImprovements,
  validateDataConsistency,
  performQualityCheck,
} from '../services/aiQualityControl.js';
import { logger } from '../logger.js';
import { ApiError } from '../errors.js';

export function createAiAdvancedRouter() {
  const router = Router();

  // Smart Suggestions Routes
  router.post('/smart-suggestions/similar-solutions', requireAuth, async (req, res, next) => {
    try {
      const { description, systemType, limit } = req.body;

      if (!description || typeof description !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Description is required');
      }

      const solutions = await findSimilarSolutions(
        description,
        systemType || '',
        limit || 5
      );

      res.json({ solutions });
    } catch (error) {
      next(error);
    }
  });

  router.post('/smart-suggestions/recommend-executors', requireAuth, async (req, res, next) => {
    try {
      const { systemType, description, priority } = req.body;

      if (!systemType || typeof systemType !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'System type is required');
      }

      if (!description || typeof description !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Description is required');
      }

      const recommendations = await recommendExecutors(
        systemType,
        description,
        priority || 'medium'
      );

      res.json({ recommendations });
    } catch (error) {
      next(error);
    }
  });

  router.post('/smart-suggestions/predict-schedule', requireAuth, async (req, res, next) => {
    try {
      const { systemType, priority, executorIds } = req.body;

      if (!systemType || typeof systemType !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'System type is required');
      }

      if (!Array.isArray(executorIds)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Executor IDs must be an array');
      }

      const schedule = await predictOptimalSchedule(
        systemType,
        priority || 'medium',
        executorIds
      );

      res.json({ schedule });
    } catch (error) {
      next(error);
    }
  });

  // Document Analysis Routes
  router.post('/document-analysis/analyze', requireAuth, async (req, res, next) => {
    try {
      const { filePath, documentType } = req.body;

      if (!filePath || typeof filePath !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'File path is required');
      }

      const analysis = await analyzeDocument(filePath, documentType);

      res.json({ analysis });
    } catch (error) {
      next(error);
    }
  });

  router.post('/document-analysis/extract-text', requireAuth, async (req, res, next) => {
    try {
      const { filePath } = req.body;

      if (!filePath || typeof filePath !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'File path is required');
      }

      const text = await extractTextFromDocument(filePath);

      res.json({ text });
    } catch (error) {
      next(error);
    }
  });

  router.post('/document-analysis/auto-fill', requireAuth, async (req, res, next) => {
    try {
      const { documentInfo, formType } = req.body;

      if (!documentInfo || typeof documentInfo !== 'object') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Document info is required');
      }

      if (!formType || !['service_request', 'project', 'contract'].includes(formType)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid form type');
      }

      const formData = await autoFillFormFromDocument(documentInfo, formType);

      res.json({ formData });
    } catch (error) {
      next(error);
    }
  });

  // Chatbot Routes
  router.post('/chatbot/chat', requireAuth, async (req: any, res, next) => {
    try {
      const { message, context, conversationHistory } = req.body;

      if (!message || typeof message !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Message is required');
      }

      const user = req.authUser;
      if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const chatContext = {
        userId: user.id,
        userRole: user.role,
        currentPage: context?.currentPage,
        recentActions: context?.recentActions,
      };

      const response = await processChatMessage(
        message,
        chatContext,
        conversationHistory || []
      );

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/chatbot/contextual-help', requireAuth, async (req: any, res, next) => {
    try {
      const { page } = req.body;

      if (!page || typeof page !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Page is required');
      }

      const user = req.authUser;
      if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const help = await getContextualHelp(page, user.role);

      res.json(help);
    } catch (error) {
      next(error);
    }
  });

  router.post('/chatbot/suggest-navigation', requireAuth, async (req: any, res, next) => {
    try {
      const { intent } = req.body;

      if (!intent || typeof intent !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Intent is required');
      }

      const user = req.authUser;
      if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const suggestions = await suggestNavigation(intent, user.role);

      res.json({ suggestions });
    } catch (error) {
      next(error);
    }
  });

  router.post('/chatbot/faq', requireAuth, async (req: any, res, next) => {
    try {
      const { question } = req.body;

      if (!question || typeof question !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Question is required');
      }

      const user = req.authUser;
      if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const answer = await answerFaq(question, user.role);

      res.json({ answer });
    } catch (error) {
      next(error);
    }
  });

  // Quality Control Routes
  router.post('/quality-control/check-request', requireAuth, async (req, res, next) => {
    try {
      const { requestData } = req.body;

      if (!requestData || typeof requestData !== 'object') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Request data is required');
      }

      const result = await detectIncompleteRequest(requestData);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/quality-control/check-project', requireAuth, async (req, res, next) => {
    try {
      const { projectData } = req.body;

      if (!projectData || typeof projectData !== 'object') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Project data is required');
      }

      const result = await flagProjectIssues(projectData);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/quality-control/suggest-improvements', requireAuth, async (req, res, next) => {
    try {
      const { description, context } = req.body;

      if (!description || typeof description !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Description is required');
      }

      const suggestions = await suggestDescriptionImprovements(
        description,
        context || 'service_request'
      );

      res.json({ suggestions });
    } catch (error) {
      next(error);
    }
  });

  router.post('/quality-control/validate-consistency', requireAuth, async (req, res, next) => {
    try {
      const { recordType, recordId } = req.body;

      if (!recordType || typeof recordType !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Record type is required');
      }

      if (!recordId || typeof recordId !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Record ID is required');
      }

      const issues = await validateDataConsistency(recordType, recordId);

      res.json({ issues });
    } catch (error) {
      next(error);
    }
  });

  router.post('/quality-control/perform-check', requireAuth, async (req, res, next) => {
    try {
      const { recordType, recordData } = req.body;

      if (!recordType || typeof recordType !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Record type is required');
      }

      if (!recordData || typeof recordData !== 'object') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Record data is required');
      }

      const result = await performQualityCheck(recordType, recordData);

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
