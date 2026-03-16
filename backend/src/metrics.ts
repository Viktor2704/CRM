const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

const metricPrefix = 'novin_app';

const escapeLabelValue = (value: string) => value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');

const toCounterKey = (method: string, route: string, status: string) => JSON.stringify([method, route, status]);
const toDurationKey = (method: string, route: string) => JSON.stringify([method, route]);

const fromCounterKey = (key: string) => {
    const [method, route, status] = JSON.parse(key);
    return { method, route, status };
};

const fromDurationKey = (key: string) => {
    const [method, route] = JSON.parse(key);
    return { method, route };
};

const resolveRouteLabel = (request: any) => {
    const baseUrl = typeof request?.baseUrl === 'string' ? request.baseUrl : '';
    const routePath = request?.route?.path;
    if (typeof routePath === 'string' && routePath.length > 0) {
        return `${baseUrl}${routePath}` || routePath;
    }
    if (Array.isArray(routePath) && routePath.length > 0) {
        return `${baseUrl}${routePath.join('|')}`;
    }
    return 'unmatched';
};

const pushMetricHeader = (lines: string[], name: string, type: string, help: string) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
};

const toMetricLabelKey = (labels: Record<string, string>) => JSON.stringify(
    Object.entries(labels)
        .sort(([left], [right]) => left.localeCompare(right)),
);

const renderMetricLabels = (labels: Record<string, string>) => {
    const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0) {
        return '';
    }
    return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`;
};

export const createMetricsRegistry = (dependencies: {
    cpuUsage?: () => NodeJS.CpuUsage;
    memoryUsage?: () => NodeJS.MemoryUsage;
    nowMs?: () => number;
    startedAtMs?: number;
    uptimeSeconds?: () => number;
} = {}) => {
    const nowMs = dependencies.nowMs ?? (() => Date.now());
    const memoryUsage = dependencies.memoryUsage ?? (() => process.memoryUsage());
    const cpuUsage = dependencies.cpuUsage ?? (() => process.cpuUsage());
    const uptimeSeconds = dependencies.uptimeSeconds ?? (() => process.uptime());
    const startedAtMs = dependencies.startedAtMs ?? nowMs();

    let inFlightRequests = 0;

    const httpRequestTotals = new Map<string, number>();
    const httpRequestDurations = new Map<string, { count: number; sumSeconds: number }>();
    const customMetricDefinitions = new Map<string, { help: string; type: 'counter' | 'gauge' }>();
    const customMetricValues = new Map<string, Map<string, { labels: Record<string, string>; value: number }>>();

    const middleware = (request: any, response: any, next: () => void) => {
        if (typeof request?.path === 'string' && request.path === '/metrics') {
            next();
            return;
        }

        const startedAt = nowMs();
        inFlightRequests += 1;

        let finalized = false;
        const finalize = () => {
            if (finalized) {
                return;
            }
            finalized = true;
            inFlightRequests = Math.max(0, inFlightRequests - 1);

            const method = String(request?.method ?? 'UNKNOWN').toUpperCase();
            const route = resolveRouteLabel(request);
            const status = String(response?.statusCode ?? 0);
            const durationSeconds = Math.max(0, (nowMs() - startedAt) / 1000);

            const totalKey = toCounterKey(method, route, status);
            httpRequestTotals.set(totalKey, (httpRequestTotals.get(totalKey) ?? 0) + 1);

            const durationKey = toDurationKey(method, route);
            const currentDuration = httpRequestDurations.get(durationKey) ?? { count: 0, sumSeconds: 0 };
            currentDuration.count += 1;
            currentDuration.sumSeconds += durationSeconds;
            httpRequestDurations.set(durationKey, currentDuration);
        };

        response.on('finish', finalize);
        response.on('close', finalize);
        next();
    };

    const renderMetrics = (serviceName: string) => {
        const memory = memoryUsage();
        const cpu = cpuUsage();
        const lines: string[] = [];

        pushMetricHeader(lines, `${metricPrefix}_info`, 'gauge', 'Static application metadata.');
        lines.push(`${metricPrefix}_info{service="${escapeLabelValue(serviceName)}"} 1`);

        pushMetricHeader(lines, `${metricPrefix}_process_start_time_seconds`, 'gauge', 'Unix time when the process started.');
        lines.push(`${metricPrefix}_process_start_time_seconds ${(startedAtMs / 1000).toFixed(3)}`);

        pushMetricHeader(lines, `${metricPrefix}_process_uptime_seconds`, 'gauge', 'Process uptime in seconds.');
        lines.push(`${metricPrefix}_process_uptime_seconds ${uptimeSeconds().toFixed(3)}`);

        pushMetricHeader(lines, `${metricPrefix}_process_cpu_seconds_total`, 'counter', 'Total user and system CPU time spent by the process.');
        lines.push(`${metricPrefix}_process_cpu_seconds_total{type="user"} ${(cpu.user / 1_000_000).toFixed(6)}`);
        lines.push(`${metricPrefix}_process_cpu_seconds_total{type="system"} ${(cpu.system / 1_000_000).toFixed(6)}`);

        pushMetricHeader(lines, `${metricPrefix}_process_memory_bytes`, 'gauge', 'Current process memory usage in bytes.');
        lines.push(`${metricPrefix}_process_memory_bytes{type="rss"} ${memory.rss}`);
        lines.push(`${metricPrefix}_process_memory_bytes{type="heap_total"} ${memory.heapTotal}`);
        lines.push(`${metricPrefix}_process_memory_bytes{type="heap_used"} ${memory.heapUsed}`);
        lines.push(`${metricPrefix}_process_memory_bytes{type="external"} ${memory.external}`);
        lines.push(`${metricPrefix}_process_memory_bytes{type="array_buffers"} ${memory.arrayBuffers}`);

        pushMetricHeader(lines, `${metricPrefix}_http_requests_in_flight`, 'gauge', 'Current number of in-flight HTTP requests.');
        lines.push(`${metricPrefix}_http_requests_in_flight ${inFlightRequests}`);

        pushMetricHeader(lines, `${metricPrefix}_http_requests_total`, 'counter', 'Total number of completed HTTP requests.');
        for (const key of [...httpRequestTotals.keys()].sort()) {
            const { method, route, status } = fromCounterKey(key);
            lines.push(
                `${metricPrefix}_http_requests_total{method="${escapeLabelValue(method)}",route="${escapeLabelValue(route)}",status="${escapeLabelValue(status)}"} ${httpRequestTotals.get(key)}`,
            );
        }

        pushMetricHeader(lines, `${metricPrefix}_http_request_duration_seconds`, 'summary', 'Count and total duration of completed HTTP requests.');
        for (const key of [...httpRequestDurations.keys()].sort()) {
            const { method, route } = fromDurationKey(key);
            const current = httpRequestDurations.get(key);
            if (!current) {
                continue;
            }
            const labels = `method="${escapeLabelValue(method)}",route="${escapeLabelValue(route)}"`;
            lines.push(`${metricPrefix}_http_request_duration_seconds_sum{${labels}} ${current.sumSeconds.toFixed(6)}`);
            lines.push(`${metricPrefix}_http_request_duration_seconds_count{${labels}} ${current.count}`);
        }

        for (const metricName of [...customMetricDefinitions.keys()].sort()) {
            const definition = customMetricDefinitions.get(metricName);
            if (!definition) {
                continue;
            }
            pushMetricHeader(lines, metricName, definition.type, definition.help);
            const values = customMetricValues.get(metricName) ?? new Map();
            for (const key of [...values.keys()].sort()) {
                const entry = values.get(key);
                if (!entry) {
                    continue;
                }
                lines.push(`${metricName}${renderMetricLabels(entry.labels)} ${entry.value}`);
            }
        }

        return `${lines.join('\n')}\n`;
    };

    const getSnapshot = () => ({
        inFlightRequests,
        httpRequestTotals: [...httpRequestTotals.entries()],
        httpRequestDurations: [...httpRequestDurations.entries()],
    });

    const setGauge = (name: string, help: string, labels: Record<string, string>, value: number) => {
        customMetricDefinitions.set(name, { help, type: 'gauge' });
        const entries = customMetricValues.get(name) ?? new Map();
        const normalizedLabels = Object.fromEntries(Object.entries(labels ?? {}).map(([key, rawValue]) => [key, String(rawValue)]));
        entries.set(toMetricLabelKey(normalizedLabels), {
            labels: normalizedLabels,
            value,
        });
        customMetricValues.set(name, entries);
    };

    const incrementCounter = (name: string, help: string, labels: Record<string, string>, amount = 1) => {
        customMetricDefinitions.set(name, { help, type: 'counter' });
        const entries = customMetricValues.get(name) ?? new Map();
        const normalizedLabels = Object.fromEntries(Object.entries(labels ?? {}).map(([key, rawValue]) => [key, String(rawValue)]));
        const labelKey = toMetricLabelKey(normalizedLabels);
        const current = entries.get(labelKey);
        entries.set(labelKey, {
            labels: normalizedLabels,
            value: (current?.value ?? 0) + amount,
        });
        customMetricValues.set(name, entries);
    };

    return {
        contentType: METRICS_CONTENT_TYPE,
        getSnapshot,
        incrementCounter,
        middleware,
        renderMetrics,
        setGauge,
    };
};

export const appMetrics = createMetricsRegistry();
