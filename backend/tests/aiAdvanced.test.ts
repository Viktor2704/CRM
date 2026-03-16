import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('AI Smart Suggestions Service', () => {
  it('should export findSimilarSolutions function', async () => {
    const module = await import('../src/services/aiSmartSuggestions.js');
    assert.strictEqual(typeof module.findSimilarSolutions, 'function');
  });

  it('should export recommendExecutors function', async () => {
    const module = await import('../src/services/aiSmartSuggestions.js');
    assert.strictEqual(typeof module.recommendExecutors, 'function');
  });

  it('should export predictOptimalSchedule function', async () => {
    const module = await import('../src/services/aiSmartSuggestions.js');
    assert.strictEqual(typeof module.predictOptimalSchedule, 'function');
  });
});

describe('AI Document Analysis Service', () => {
  it('should export extractTextFromDocument function', async () => {
    const module = await import('../src/services/aiDocumentAnalysis.js');
    assert.strictEqual(typeof module.extractTextFromDocument, 'function');
  });

  it('should export analyzeDocument function', async () => {
    const module = await import('../src/services/aiDocumentAnalysis.js');
    assert.strictEqual(typeof module.analyzeDocument, 'function');
  });

  it('should export autoFillFormFromDocument function', async () => {
    const module = await import('../src/services/aiDocumentAnalysis.js');
    assert.strictEqual(typeof module.autoFillFormFromDocument, 'function');
  });
});

describe('AI Chatbot Service', () => {
  it('should export processChatMessage function', async () => {
    const module = await import('../src/services/aiChatbot.js');
    assert.strictEqual(typeof module.processChatMessage, 'function');
  });

  it('should export getContextualHelp function', async () => {
    const module = await import('../src/services/aiChatbot.js');
    assert.strictEqual(typeof module.getContextualHelp, 'function');
  });

  it('should export suggestNavigation function', async () => {
    const module = await import('../src/services/aiChatbot.js');
    assert.strictEqual(typeof module.suggestNavigation, 'function');
  });

  it('should export answerFaq function', async () => {
    const module = await import('../src/services/aiChatbot.js');
    assert.strictEqual(typeof module.answerFaq, 'function');
  });
});

describe('AI Quality Control Service', () => {
  it('should export detectIncompleteRequest function', async () => {
    const module = await import('../src/services/aiQualityControl.js');
    assert.strictEqual(typeof module.detectIncompleteRequest, 'function');
  });

  it('should export flagProjectIssues function', async () => {
    const module = await import('../src/services/aiQualityControl.js');
    assert.strictEqual(typeof module.flagProjectIssues, 'function');
  });

  it('should export suggestDescriptionImprovements function', async () => {
    const module = await import('../src/services/aiQualityControl.js');
    assert.strictEqual(typeof module.suggestDescriptionImprovements, 'function');
  });

  it('should export validateDataConsistency function', async () => {
    const module = await import('../src/services/aiQualityControl.js');
    assert.strictEqual(typeof module.validateDataConsistency, 'function');
  });

  it('should export performQualityCheck function', async () => {
    const module = await import('../src/services/aiQualityControl.js');
    assert.strictEqual(typeof module.performQualityCheck, 'function');
  });
});

describe('AI Advanced Routes', () => {
  it('should export createAiAdvancedRouter function', async () => {
    const module = await import('../src/routes/aiAdvanced.js');
    assert.strictEqual(typeof module.createAiAdvancedRouter, 'function');
  });

  it('should create router with all endpoints', async () => {
    const module = await import('../src/routes/aiAdvanced.js');
    const router = module.createAiAdvancedRouter();
    assert.ok(router);
  });
});
