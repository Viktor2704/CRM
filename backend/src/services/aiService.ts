import { appConfig } from '../config.js';
import { logger, serializeError } from '../logger.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ARCEE_URL = 'https://api.arcee.ai/api/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const INTERNAL_WINDOW_MS = 60_000;
const INTERNAL_MAX_REQUESTS_PER_WINDOW = 25;

// HTTP status codes that trigger fallback to another provider
const FALLBACK_STATUS_CODES = new Set([402, 429, 500, 502, 503, 504]);

export type AiCallResult = {
    content: string | null;
    source: 'ai' | 'fallback' | 'none';
    provider: string;
    error?: string;
    durationMs?: number;
};

let internalWindowStartedAt = Date.now();
let internalWindowRequestCount = 0;

const canRunAiCall = () => {
    const now = Date.now();
    if (now - internalWindowStartedAt >= INTERNAL_WINDOW_MS) {
        internalWindowStartedAt = now;
        internalWindowRequestCount = 0;
    }
    if (internalWindowRequestCount >= INTERNAL_MAX_REQUESTS_PER_WINDOW) {
        return false;
    }
    internalWindowRequestCount += 1;
    return true;
};

const normalizeModel = (value) => {
    const model = typeof value === 'string' ? value.trim() : '';
    return model || 'llama-3.3-70b-instruct';
};

const clampTemperature = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0.3;
    }
    if (numeric < 0) {
        return 0;
    }
    if (numeric > 2) {
        return 2;
    }
    return numeric;
};

const normalizeMaxTokens = (value) => {
    const numeric = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 1024;
    }
    return Math.min(numeric, 4096);
};

const resolveProviderConfig = () => resolveProviderConfigFor(appConfig.aiProvider);

const resolveProviderConfigFor = (provider: string) => {
    if (provider === 'arcee') {
        return {
            provider: 'arcee',
            apiUrl: ARCEE_URL,
            apiKey: String(appConfig.arceeApiKey || '').trim(),
            model: appConfig.arceeModel,
            temperature: appConfig.arceeTemperature,
            maxTokens: appConfig.arceeMaxTokens,
        };
    }
    if (provider === 'openrouter') {
        return {
            provider: 'openrouter',
            apiUrl: OPENROUTER_URL,
            apiKey: String(appConfig.openrouterApiKey || '').trim(),
            model: appConfig.openrouterModel,
            temperature: appConfig.openrouterTemperature,
            maxTokens: appConfig.openrouterMaxTokens,
        };
    }
    return {
        provider: 'groq',
        apiUrl: GROQ_URL,
        apiKey: String(appConfig.groqApiKey || '').trim(),
        model: appConfig.groqModel,
        temperature: appConfig.groqTemperature,
        maxTokens: appConfig.groqMaxTokens,
    };
};

const getFallbackProvider = (primary: string): string | null => {
    if (primary === 'openrouter' && appConfig.groqApiKey) return 'groq';
    if (primary === 'openrouter' && appConfig.arceeApiKey) return 'arcee';
    if (primary === 'groq' && appConfig.openrouterApiKey) return 'openrouter';
    if (primary === 'groq' && appConfig.arceeApiKey) return 'arcee';
    if (primary === 'arcee' && appConfig.openrouterApiKey) return 'openrouter';
    if (primary === 'arcee' && appConfig.groqApiKey) return 'groq';
    return null;
};

const isTransportProxyUrl = (proxyUrl) => {
    try {
        const parsed = new URL(proxyUrl);
        const path = parsed.pathname.trim();
        return !path || path === '/';
    }
    catch (_) {
        return false;
    }
};

const resolveProxyConfig = (providerConfig) => {
    const providerProxy = providerConfig.provider === 'arcee'
        ? appConfig.arceeProxy
        : providerConfig.provider === 'openrouter'
            ? appConfig.openrouterProxy
            : appConfig.groqProxy;
    const rawProxyUrl = String(providerProxy || appConfig.aiProxyUrl || appConfig.groqProxy || '').trim();
    if (!rawProxyUrl) {
        return {
            mode: 'none',
            requestUrl: providerConfig.apiUrl,
            proxyUrl: '',
        };
    }
    if (rawProxyUrl.includes('{target}')) {
        return {
            mode: 'gateway',
            requestUrl: rawProxyUrl.replace('{target}', encodeURIComponent(providerConfig.apiUrl)),
            proxyUrl: rawProxyUrl,
        };
    }
    if (isTransportProxyUrl(rawProxyUrl)) {
        return {
            mode: 'transport',
            requestUrl: providerConfig.apiUrl,
            proxyUrl: rawProxyUrl,
        };
    }
    return {
        mode: 'gateway',
        requestUrl: rawProxyUrl,
        proxyUrl: rawProxyUrl,
    };
};

const withTransportProxyEnv = (_proxyUrl) => {
    return () => { };
};

const buildRequestHeaders = (providerConfig, proxyMode) => {
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerConfig.apiKey}`,
    } as Record<string, string>;
    if (proxyMode !== 'gateway') {
        return headers;
    }
    if (appConfig.aiProxyBearerToken) {
        headers.Authorization = `Bearer ${appConfig.aiProxyBearerToken}`;
        headers['X-Upstream-Authorization'] = `Bearer ${providerConfig.apiKey}`;
    }
    headers['X-AI-Provider'] = providerConfig.provider;
    headers['X-AI-Target-Url'] = providerConfig.apiUrl;
    return headers;
};

// Single-provider call — returns structured result with status info
const callLLMSingle = async (
    providerConfig: ReturnType<typeof resolveProviderConfigFor>,
    systemPrompt: string,
    userPrompt: string,
    options: any = {},
): Promise<{ content: string | null; status?: number; error?: string }> => {
    const model = normalizeModel(options.model ?? providerConfig.model);
    const temperature = clampTemperature(options.temperature ?? providerConfig.temperature);
    const maxTokens = normalizeMaxTokens(options.maxTokens ?? providerConfig.maxTokens);
    const proxyConfig = resolveProxyConfig(providerConfig);
    const usingProxy = proxyConfig.mode !== 'none';
    const requestUrl = proxyConfig.requestUrl;
    const requestHeaders = buildRequestHeaders(providerConfig, proxyConfig.mode);
    const releaseTransportProxy = proxyConfig.mode === 'transport'
        ? withTransportProxyEnv(proxyConfig.proxyUrl)
        : () => { };
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
        ? Math.max(1000, Number(options.timeoutMs))
        : 10_000;

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions: any = {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature,
            max_tokens: maxTokens,
        }),
        signal: controller.signal,
    };
    if (proxyConfig.mode === 'transport' && proxyConfig.proxyUrl) {
        const undici = await import('undici' as any);
        fetchOptions.dispatcher = new undici.ProxyAgent(proxyConfig.proxyUrl);
    }
    try {
        const response = await fetch(requestUrl, fetchOptions);
        if (!response.ok) {
            const durationMs = Date.now() - startedAt;
            logger.warn('AI call failed with non-OK response', {
                provider: providerConfig.provider,
                model,
                usingProxy,
                proxyMode: proxyConfig.mode,
                status: response.status,
                durationMs,
                promptLength: systemPrompt.length + userPrompt.length,
            });
            return { content: null, status: response.status, error: `HTTP ${response.status}` };
        }
        const data = await response.json().catch(() => null);
        const content = typeof data?.choices?.[0]?.message?.content === 'string'
            ? data.choices[0].message.content.trim().replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
            : '';
        logger.info('AI call completed', {
            provider: providerConfig.provider,
            model,
            usingProxy,
            proxyMode: proxyConfig.mode,
            durationMs: Date.now() - startedAt,
            promptLength: systemPrompt.length + userPrompt.length,
            responseLength: content.length,
        });
        return { content: content || null };
    }
    catch (error) {
        const durationMs = Date.now() - startedAt;
        const errMsg = error instanceof Error ? error.message : 'unknown error';
        logger.warn('AI call failed', {
            provider: providerConfig.provider,
            model,
            usingProxy,
            proxyMode: proxyConfig.mode,
            durationMs,
            promptLength: systemPrompt.length + userPrompt.length,
            error: serializeError(error),
        });
        return { content: null, error: errMsg };
    }
    finally {
        releaseTransportProxy();
        clearTimeout(timeout);
    }
};

// Main entry point with automatic fallback to second provider
export const callLLMWithFallback = async (
    systemPrompt: string,
    userPrompt: string,
    options: any = {},
): Promise<AiCallResult> => {
    if (!appConfig.aiEnabled) {
        return { content: null, source: 'none', provider: 'disabled' };
    }
    if (appConfig.aiProvider !== 'groq' && appConfig.aiProvider !== 'arcee' && appConfig.aiProvider !== 'openrouter') {
        logger.warn('AI call skipped: unsupported provider', { provider: appConfig.aiProvider });
        return { content: null, source: 'none', provider: appConfig.aiProvider, error: 'unsupported provider' };
    }

    const normalizedSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
    const normalizedUserPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
    if (!normalizedSystemPrompt || !normalizedUserPrompt) {
        return { content: null, source: 'none', provider: appConfig.aiProvider };
    }

    if (!canRunAiCall()) {
        logger.warn('AI call skipped: internal rate limit reached', { maxPerMinute: INTERNAL_MAX_REQUESTS_PER_WINDOW });
        return { content: null, source: 'none', provider: appConfig.aiProvider, error: 'rate_limit' };
    }

    const startedAt = Date.now();

    // Try primary provider
    const primaryConfig = resolveProviderConfig();
    if (!primaryConfig.apiKey) {
        logger.warn('AI call skipped: API key is not configured', { provider: primaryConfig.provider });
        return { content: null, source: 'none', provider: primaryConfig.provider, error: 'no_api_key' };
    }

    const primaryResult = await callLLMSingle(primaryConfig, normalizedSystemPrompt, normalizedUserPrompt, options);
    if (primaryResult.content) {
        return {
            content: primaryResult.content,
            source: 'ai',
            provider: primaryConfig.provider,
            durationMs: Date.now() - startedAt,
        };
    }

    // Check if we should try fallback
    const shouldFallback = primaryResult.status
        ? FALLBACK_STATUS_CODES.has(primaryResult.status)
        : Boolean(primaryResult.error); // network errors, timeouts

    if (!shouldFallback) {
        return {
            content: null,
            source: 'none',
            provider: primaryConfig.provider,
            error: primaryResult.error,
            durationMs: Date.now() - startedAt,
        };
    }

    // Try fallback provider
    const fallbackProviderName = getFallbackProvider(primaryConfig.provider);
    if (!fallbackProviderName) {
        logger.info('AI fallback skipped: no fallback provider configured', {
            primary: primaryConfig.provider,
            primaryError: primaryResult.error,
        });
        return {
            content: null,
            source: 'none',
            provider: primaryConfig.provider,
            error: primaryResult.error,
            durationMs: Date.now() - startedAt,
        };
    }

    logger.info('AI falling back to secondary provider', {
        primary: primaryConfig.provider,
        fallback: fallbackProviderName,
        primaryError: primaryResult.error,
    });

    const fallbackConfig = resolveProviderConfigFor(fallbackProviderName);
    const fallbackResult = await callLLMSingle(fallbackConfig, normalizedSystemPrompt, normalizedUserPrompt, options);

    if (fallbackResult.content) {
        return {
            content: fallbackResult.content,
            source: 'fallback',
            provider: fallbackConfig.provider,
            durationMs: Date.now() - startedAt,
        };
    }

    return {
        content: null,
        source: 'none',
        provider: `${primaryConfig.provider}+${fallbackConfig.provider}`,
        error: `primary: ${primaryResult.error}; fallback: ${fallbackResult.error}`,
        durationMs: Date.now() - startedAt,
    };
};

// Backwards-compatible wrapper — returns string | null like before
export const callLLM = async (systemPrompt, userPrompt, options = {} as any) => {
    const result = await callLLMWithFallback(systemPrompt, userPrompt, options);
    return result.content;
};

// Streaming result type
export type AiStreamResult = {
    stream: ReadableStream<string> | null;
    source: 'ai' | 'fallback' | 'none';
    provider: string;
    error?: string;
};

// Single-provider streaming call
const callLLMStreamSingle = async (
    providerConfig: ReturnType<typeof resolveProviderConfigFor>,
    systemPrompt: string,
    userPrompt: string,
    options: any = {},
): Promise<{ stream: ReadableStream<string> | null; status?: number; error?: string }> => {
    const model = normalizeModel(options.model ?? providerConfig.model);
    const temperature = clampTemperature(options.temperature ?? providerConfig.temperature);
    const maxTokens = normalizeMaxTokens(options.maxTokens ?? providerConfig.maxTokens);
    const proxyConfig = resolveProxyConfig(providerConfig);
    const requestUrl = proxyConfig.requestUrl;
    const requestHeaders = buildRequestHeaders(providerConfig, proxyConfig.mode);
    const releaseTransportProxy = proxyConfig.mode === 'transport'
        ? withTransportProxyEnv(proxyConfig.proxyUrl)
        : () => { };
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
        ? Math.max(1000, Number(options.timeoutMs))
        : 30_000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions: any = {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature,
            max_tokens: maxTokens,
            stream: true,
        }),
        signal: controller.signal,
    };
    if (proxyConfig.mode === 'transport' && proxyConfig.proxyUrl) {
        const undici = await import('undici' as any);
        fetchOptions.dispatcher = new undici.ProxyAgent(proxyConfig.proxyUrl);
    }
    try {
        const response = await fetch(requestUrl, fetchOptions);
        if (!response.ok) {
            clearTimeout(timeout);
            releaseTransportProxy();
            return { stream: null, status: response.status, error: `HTTP ${response.status}` };
        }
        if (!response.body) {
            clearTimeout(timeout);
            releaseTransportProxy();
            return { stream: null, error: 'No response body for streaming' };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const readable = new ReadableStream<string>({
            async pull(ctrl) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        // flush remaining buffer
                        if (buffer.trim()) {
                            const lines = buffer.split('\n');
                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                                    try {
                                        const json = JSON.parse(trimmed.slice(6));
                                        const chunk = json.choices?.[0]?.delta?.content;
                                        if (chunk) ctrl.enqueue(chunk);
                                    } catch { /* skip */ }
                                }
                            }
                        }
                        ctrl.close();
                        clearTimeout(timeout);
                        releaseTransportProxy();
                        return;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    // Keep last incomplete line in buffer
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data: ')) continue;
                        if (trimmed === 'data: [DONE]') {
                            ctrl.close();
                            clearTimeout(timeout);
                            releaseTransportProxy();
                            return;
                        }
                        try {
                            const json = JSON.parse(trimmed.slice(6));
                            const content = json.choices?.[0]?.delta?.content;
                            if (content) {
                                // Strip <think> tags from streaming content
                                ctrl.enqueue(content);
                            }
                        } catch { /* skip malformed lines */ }
                    }
                } catch (err) {
                    clearTimeout(timeout);
                    releaseTransportProxy();
                    ctrl.error(err);
                }
            },
            cancel() {
                reader.cancel();
                clearTimeout(timeout);
                releaseTransportProxy();
            },
        });

        return { stream: readable };
    } catch (error) {
        clearTimeout(timeout);
        releaseTransportProxy();
        const errMsg = error instanceof Error ? error.message : 'unknown error';
        return { stream: null, error: errMsg };
    }
};

// Streaming entry point with fallback
export const callLLMStream = async (
    systemPrompt: string,
    userPrompt: string,
    options: any = {},
): Promise<AiStreamResult> => {
    if (!appConfig.aiEnabled) {
        return { stream: null, source: 'none', provider: 'disabled' };
    }
    if (appConfig.aiProvider !== 'groq' && appConfig.aiProvider !== 'arcee' && appConfig.aiProvider !== 'openrouter') {
        return { stream: null, source: 'none', provider: appConfig.aiProvider, error: 'unsupported provider' };
    }

    const normalizedSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
    const normalizedUserPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
    if (!normalizedSystemPrompt || !normalizedUserPrompt) {
        return { stream: null, source: 'none', provider: appConfig.aiProvider };
    }

    if (!canRunAiCall()) {
        return { stream: null, source: 'none', provider: appConfig.aiProvider, error: 'rate_limit' };
    }

    // Try primary provider
    const primaryConfig = resolveProviderConfig();
    if (!primaryConfig.apiKey) {
        return { stream: null, source: 'none', provider: primaryConfig.provider, error: 'no_api_key' };
    }

    const primaryResult = await callLLMStreamSingle(primaryConfig, normalizedSystemPrompt, normalizedUserPrompt, options);
    if (primaryResult.stream) {
        return { stream: primaryResult.stream, source: 'ai', provider: primaryConfig.provider };
    }

    // Check if we should try fallback
    const shouldFallback = primaryResult.status
        ? FALLBACK_STATUS_CODES.has(primaryResult.status)
        : Boolean(primaryResult.error);

    if (!shouldFallback) {
        return { stream: null, source: 'none', provider: primaryConfig.provider, error: primaryResult.error };
    }

    const fallbackProviderName = getFallbackProvider(primaryConfig.provider);
    if (!fallbackProviderName) {
        return { stream: null, source: 'none', provider: primaryConfig.provider, error: primaryResult.error };
    }

    logger.info('AI stream falling back to secondary provider', {
        primary: primaryConfig.provider,
        fallback: fallbackProviderName,
        primaryError: primaryResult.error,
    });

    const fallbackConfig = resolveProviderConfigFor(fallbackProviderName);
    const fallbackResult = await callLLMStreamSingle(fallbackConfig, normalizedSystemPrompt, normalizedUserPrompt, options);

    if (fallbackResult.stream) {
        return { stream: fallbackResult.stream, source: 'fallback', provider: fallbackConfig.provider };
    }

    return {
        stream: null,
        source: 'none',
        provider: `${primaryConfig.provider}+${fallbackConfig.provider}`,
        error: `primary: ${primaryResult.error}; fallback: ${fallbackResult.error}`,
    };
};
