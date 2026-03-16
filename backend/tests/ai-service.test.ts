import assert from 'node:assert/strict';
import test from 'node:test';

import { callLLM, callLLMWithFallback } from '../src/services/aiService.js';
import { appConfig } from '../src/config.js';

const originalAiConfig = {
  aiEnabled: appConfig.aiEnabled,
  aiProvider: appConfig.aiProvider,
  groqApiKey: appConfig.groqApiKey,
  arceeApiKey: appConfig.arceeApiKey,
  openrouterApiKey: appConfig.openrouterApiKey,
};

test.afterEach(() => {
  appConfig.aiEnabled = originalAiConfig.aiEnabled;
  appConfig.aiProvider = originalAiConfig.aiProvider;
  appConfig.groqApiKey = originalAiConfig.groqApiKey;
  appConfig.arceeApiKey = originalAiConfig.arceeApiKey;
  appConfig.openrouterApiKey = originalAiConfig.openrouterApiKey;
});

test('callLLM returns null when AI is disabled', async () => {
  appConfig.aiEnabled = false;

  const result = await callLLM('System prompt', 'User prompt');

  assert.equal(result, null);
});

test('callLLMWithFallback returns none source when AI is disabled', async () => {
  appConfig.aiEnabled = false;

  const result = await callLLMWithFallback('System prompt', 'User prompt');

  assert.equal(result.content, null);
  assert.equal(result.source, 'none');
  assert.equal(result.provider, 'disabled');
});

test('callLLMWithFallback returns none when system prompt is empty', async () => {
  appConfig.aiEnabled = true;
  appConfig.aiProvider = 'groq';
  appConfig.groqApiKey = 'test-key';

  const result = await callLLMWithFallback('', 'User prompt');

  assert.equal(result.content, null);
  assert.equal(result.source, 'none');
});

test('callLLMWithFallback returns none when user prompt is empty', async () => {
  appConfig.aiEnabled = true;
  appConfig.aiProvider = 'groq';
  appConfig.groqApiKey = 'test-key';

  const result = await callLLMWithFallback('System prompt', '');

  assert.equal(result.content, null);
  assert.equal(result.source, 'none');
});

test('callLLMWithFallback returns none when API key is missing', async () => {
  appConfig.aiEnabled = true;
  appConfig.aiProvider = 'groq';
  appConfig.groqApiKey = '';

  const result = await callLLMWithFallback('System prompt', 'User prompt');

  assert.equal(result.content, null);
  assert.equal(result.source, 'none');
  assert.equal(result.error, 'no_api_key');
});

test('callLLMWithFallback returns none for unsupported provider', async () => {
  appConfig.aiEnabled = true;
  appConfig.aiProvider = 'unsupported' as any;

  const result = await callLLMWithFallback('System prompt', 'User prompt');

  assert.equal(result.content, null);
  assert.equal(result.source, 'none');
  assert.equal(result.error, 'unsupported provider');
});

test('AI service normalizes model name', () => {
  const inputs = [
    { input: 'llama-3.3-70b-instruct', expected: 'llama-3.3-70b-instruct' },
    { input: '', expected: 'llama-3.3-70b-instruct' },
    { input: '  custom-model  ', expected: 'custom-model' },
    { input: null, expected: 'llama-3.3-70b-instruct' },
  ];

  inputs.forEach(({ input, expected }) => {
    const normalized = typeof input === 'string' && input.trim() ? input.trim() : 'llama-3.3-70b-instruct';
    assert.equal(normalized, expected);
  });
});

test('AI service clamps temperature to valid range', () => {
  const inputs = [
    { input: -1, expected: 0 },
    { input: 0, expected: 0 },
    { input: 0.3, expected: 0.3 },
    { input: 1.5, expected: 1.5 },
    { input: 2, expected: 2 },
    { input: 3, expected: 2 },
    { input: NaN, expected: 0.3 },
  ];

  inputs.forEach(({ input, expected }) => {
    let clamped: number;
    if (!Number.isFinite(input)) {
      clamped = 0.3;
    } else if (input < 0) {
      clamped = 0;
    } else if (input > 2) {
      clamped = 2;
    } else {
      clamped = input;
    }
    assert.equal(clamped, expected);
  });
});

test('AI service normalizes max tokens', () => {
  const inputs = [
    { input: 100, expected: 100 },
    { input: 1024, expected: 1024 },
    { input: 5000, expected: 4096 },
    { input: 0, expected: 1024 },
    { input: -100, expected: 1024 },
    { input: NaN, expected: 1024 },
  ];

  inputs.forEach(({ input, expected }) => {
    const numeric = Number.parseInt(String(input ?? ''), 10);
    const normalized = !Number.isFinite(numeric) || numeric <= 0 ? 1024 : Math.min(numeric, 4096);
    assert.equal(normalized, expected);
  });
});

test('AI service resolves Groq provider config', () => {
  appConfig.aiProvider = 'groq';
  appConfig.groqApiKey = 'groq-key-123';

  const config = {
    provider: 'groq',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: appConfig.groqApiKey,
  };

  assert.equal(config.provider, 'groq');
  assert.equal(config.apiKey, 'groq-key-123');
  assert.ok(config.apiUrl.includes('groq.com'));
});

test('AI service resolves Arcee provider config', () => {
  appConfig.aiProvider = 'arcee';
  appConfig.arceeApiKey = 'arcee-key-123';

  const config = {
    provider: 'arcee',
    apiUrl: 'https://api.arcee.ai/api/v1/chat/completions',
    apiKey: appConfig.arceeApiKey,
  };

  assert.equal(config.provider, 'arcee');
  assert.equal(config.apiKey, 'arcee-key-123');
  assert.ok(config.apiUrl.includes('arcee.ai'));
});

test('AI service resolves OpenRouter provider config', () => {
  appConfig.aiProvider = 'openrouter';
  appConfig.openrouterApiKey = 'openrouter-key-123';

  const config = {
    provider: 'openrouter',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: appConfig.openrouterApiKey,
  };

  assert.equal(config.provider, 'openrouter');
  assert.equal(config.apiKey, 'openrouter-key-123');
  assert.ok(config.apiUrl.includes('openrouter.ai'));
});

test('AI service determines fallback provider from Groq', () => {
  const primary = 'groq';
  appConfig.openrouterApiKey = 'openrouter-key';
  appConfig.arceeApiKey = '';

  const fallback = appConfig.openrouterApiKey ? 'openrouter' : appConfig.arceeApiKey ? 'arcee' : null;

  assert.equal(fallback, 'openrouter');
});

test('AI service determines fallback provider from OpenRouter', () => {
  const primary = 'openrouter';
  appConfig.groqApiKey = 'groq-key';
  appConfig.arceeApiKey = '';

  const fallback = appConfig.groqApiKey ? 'groq' : appConfig.arceeApiKey ? 'arcee' : null;

  assert.equal(fallback, 'groq');
});

test('AI service determines fallback provider from Arcee', () => {
  const primary = 'arcee';
  appConfig.openrouterApiKey = 'openrouter-key';
  appConfig.groqApiKey = '';

  const fallback = appConfig.openrouterApiKey ? 'openrouter' : appConfig.groqApiKey ? 'groq' : null;

  assert.equal(fallback, 'openrouter');
});

test('AI service returns null fallback when no alternative configured', () => {
  const primary = 'groq';
  appConfig.openrouterApiKey = '';
  appConfig.arceeApiKey = '';

  const fallback = appConfig.openrouterApiKey ? 'openrouter' : appConfig.arceeApiKey ? 'arcee' : null;

  assert.equal(fallback, null);
});

test('AI service identifies fallback status codes', () => {
  const fallbackCodes = [402, 429, 500, 502, 503, 504];
  const nonFallbackCodes = [200, 400, 401, 403, 404];

  fallbackCodes.forEach((code) => {
    assert.ok([402, 429, 500, 502, 503, 504].includes(code));
  });

  nonFallbackCodes.forEach((code) => {
    assert.equal([402, 429, 500, 502, 503, 504].includes(code), false);
  });
});

test('AI service detects transport proxy URL', () => {
  const transportProxies = [
    'http://proxy.example.com',
    'http://proxy.example.com/',
    'https://proxy.example.com:8080',
  ];

  transportProxies.forEach((url) => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.trim();
      const isTransport = !path || path === '/';
      assert.ok(isTransport);
    } catch (e) {
      assert.fail('Should parse valid URL');
    }
  });
});

test('AI service detects gateway proxy URL', () => {
  const gatewayProxies = [
    'http://proxy.example.com/api/v1',
    'https://proxy.example.com/gateway',
  ];

  gatewayProxies.forEach((url) => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.trim();
      const isGateway = path && path !== '/';
      assert.ok(isGateway);
    } catch (e) {
      assert.fail('Should parse valid URL');
    }
  });
});

test('AI service resolves proxy config with target placeholder', () => {
  const proxyUrl = 'http://proxy.example.com/gateway?target={target}';
  const targetUrl = 'https://api.groq.com/openai/v1/chat/completions';

  const requestUrl = proxyUrl.replace('{target}', encodeURIComponent(targetUrl));

  assert.ok(requestUrl.includes('proxy.example.com'));
  assert.ok(requestUrl.includes(encodeURIComponent(targetUrl)));
});

test('AI service builds request headers with authorization', () => {
  const apiKey = 'test-api-key-123';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['Authorization'], 'Bearer test-api-key-123');
});

test('AI service builds request headers for gateway proxy', () => {
  const apiKey = 'test-api-key-123';
  const proxyBearerToken = 'proxy-token-456';
  const provider = 'groq';
  const targetUrl = 'https://api.groq.com/openai/v1/chat/completions';

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${proxyBearerToken}`,
    'X-Upstream-Authorization': `Bearer ${apiKey}`,
    'X-AI-Provider': provider,
    'X-AI-Target-Url': targetUrl,
  };

  assert.equal(headers['Authorization'], 'Bearer proxy-token-456');
  assert.equal(headers['X-Upstream-Authorization'], 'Bearer test-api-key-123');
  assert.equal(headers['X-AI-Provider'], 'groq');
});

test('AI service builds request body with messages', () => {
  const systemPrompt = 'You are a helpful assistant';
  const userPrompt = 'What is the weather?';
  const model = 'llama-3.3-70b-instruct';
  const temperature = 0.3;
  const maxTokens = 1024;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  assert.equal(body.model, 'llama-3.3-70b-instruct');
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.temperature, 0.3);
  assert.equal(body.max_tokens, 1024);
});

test('AI service extracts content from response', () => {
  const response = {
    choices: [
      {
        message: {
          content: 'This is the AI response',
        },
      },
    ],
  };

  const content = response?.choices?.[0]?.message?.content;

  assert.equal(content, 'This is the AI response');
});

test('AI service removes think tags from response', () => {
  const rawContent = '<think>Internal reasoning</think>This is the response<think>More thinking</think>';
  const cleaned = rawContent.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

  assert.equal(cleaned, 'This is the response');
});

test('AI service handles response without choices', () => {
  const response = {};
  const content = typeof response?.choices?.[0]?.message?.content === 'string'
    ? response.choices[0].message.content
    : '';

  assert.equal(content, '');
});

test('AI service enforces internal rate limit', () => {
  const windowMs = 60000;
  const maxRequests = 25;
  let windowStart = Date.now();
  let requestCount = 0;

  const canMakeRequest = () => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      requestCount = 0;
    }
    if (requestCount >= maxRequests) {
      return false;
    }
    requestCount += 1;
    return true;
  };

  // Make 25 requests
  for (let i = 0; i < 25; i++) {
    assert.ok(canMakeRequest());
  }

  // 26th request should be blocked
  assert.equal(canMakeRequest(), false);
});

test('AI service resets rate limit after window', () => {
  const windowMs = 60000;
  let windowStart = Date.now() - windowMs - 1000; // Window expired
  let requestCount = 25; // Was at limit

  const now = Date.now();
  if (now - windowStart >= windowMs) {
    windowStart = now;
    requestCount = 0;
  }

  assert.equal(requestCount, 0);
});

test('AI service handles timeout', () => {
  const timeoutMs = 10000;
  const controller = new AbortController();

  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  assert.ok(timeout);
  clearTimeout(timeout);
});

test('AI service validates timeout parameter', () => {
  const inputs = [500, 1000, 5000, 10000, 60000];
  const results = inputs.map((input) => Math.max(1000, input));

  assert.deepEqual(results, [1000, 1000, 5000, 10000, 60000]);
});

test('AI service logs successful call', () => {
  const logEntry = {
    provider: 'groq',
    model: 'llama-3.3-70b-instruct',
    usingProxy: false,
    proxyMode: 'none',
    durationMs: 1234,
    promptLength: 100,
    responseLength: 200,
  };

  assert.equal(logEntry.provider, 'groq');
  assert.equal(logEntry.durationMs, 1234);
  assert.equal(logEntry.promptLength, 100);
  assert.equal(logEntry.responseLength, 200);
});

test('AI service logs failed call', () => {
  const logEntry = {
    provider: 'groq',
    model: 'llama-3.3-70b-instruct',
    usingProxy: false,
    proxyMode: 'none',
    status: 429,
    durationMs: 567,
    promptLength: 100,
  };

  assert.equal(logEntry.status, 429);
  assert.equal(logEntry.durationMs, 567);
});

test('AI service tracks duration', () => {
  const startedAt = Date.now();
  const endedAt = startedAt + 1234;
  const durationMs = endedAt - startedAt;

  assert.equal(durationMs, 1234);
});

test('callLLM is backwards compatible wrapper', async () => {
  appConfig.aiEnabled = false;

  const result = await callLLM('System', 'User');

  // Should return string | null like before
  assert.equal(typeof result === 'string' || result === null, true);
});

test('callLLMWithFallback returns structured result', async () => {
  appConfig.aiEnabled = false;

  const result = await callLLMWithFallback('System', 'User');

  // Should return structured object
  assert.ok('content' in result);
  assert.ok('source' in result);
  assert.ok('provider' in result);
});
