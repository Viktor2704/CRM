import { normalizeText } from './normalize.js';
export const serviceRequestTypes = new Set(['emergency', 'operation', 'maintenance_planned', 'general']);
export const aiConfidenceValues = new Set(['high', 'medium', 'low']);
export const aiSimilarityValues = new Set(['high', 'medium', 'low']);
export const aiRequestTypeLabels = {
    emergency: 'Аварийная',
    operation: 'Эксплуатация',
    maintenance_planned: 'Плановое ТО',
    general: 'Общая',
};
export const aiSystemTypeLabels = {
    aps: 'АПС',
    soue: 'СОУЭ',
    aupt: 'АУПТ',
    vpv: 'ВПВ',
    fireExtinguishers: 'Огнетушители',
    exitSigns: 'Табло ВЫХОД',
    gas: 'Газ',
    skud: 'СКУД',
    sks: 'СКС',
    svn: 'СВН',
    asutp: 'АСУ ТП',
    sots: 'СОТС',
};
export const aiSystemTypeAliasMap = {
    aps: 'aps',
    soue: 'soue',
    aupt: 'aupt',
    vpv: 'vpv',
    fireextinguishers: 'fireExtinguishers',
    fire_extinguishers: 'fireExtinguishers',
    exitsigns: 'exitSigns',
    exit_signs: 'exitSigns',
    gas: 'gas',
    skud: 'skud',
    sks: 'sks',
    svn: 'svn',
    asutp: 'asutp',
    sots: 'sots',
};
export const aiPriorityLabels = {
    critical: 'Критический',
    high: 'Высокий',
    medium: 'Средний',
    low: 'Низкий',
};
export const aiSystemTypeValues = new Set(Object.keys(aiSystemTypeLabels));
export const aiSearchSystemLabels = {
    aps: 'АПС',
    soue: 'СОУЭ',
    aupt: 'АУПТ',
    vpv: 'ВПВ',
    fireExtinguishers: 'Огнетушители',
    exitSigns: 'Табло ВЫХОД',
    gas: 'Газовое тушение',
    skud: 'СКУД',
    sks: 'СКС',
    svn: 'СВН',
    asutp: 'АСУ ТП',
    sots: 'СОТС',
};
export const extractAiJsonPayload = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    const withoutFences = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    if (!withoutFences) {
        return '';
    }
    if (withoutFences.startsWith('{') || withoutFences.startsWith('[')) {
        return withoutFences;
    }
    const objectStart = withoutFences.indexOf('{');
    const arrayStart = withoutFences.indexOf('[');
    const start = objectStart >= 0 && arrayStart >= 0
        ? Math.min(objectStart, arrayStart)
        : Math.max(objectStart, arrayStart);
    if (start < 0) {
        return '';
    }
    const sliced = withoutFences.slice(start);
    const objectEnd = sliced.lastIndexOf('}');
    const arrayEnd = sliced.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    if (end < 0) {
        return '';
    }
    return sliced.slice(0, end + 1).trim();
};
export const parseAiJson = (value) => {
    const payload = extractAiJsonPayload(value);
    if (!payload) {
        return null;
    }
    try {
        return JSON.parse(payload);
    }
    catch {
        return null;
    }
};
export const normalizeAiConfidence = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (aiConfidenceValues.has(normalized)) {
        return normalized;
    }
    return 'medium';
};
export const normalizeAiRequestType = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return serviceRequestTypes.has(normalized) ? normalized : '';
};
export const normalizeAiPriority = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(aiPriorityLabels, normalized) ? normalized : '';
};
export const normalizeAiSystemType = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    if (aiSystemTypeValues.has(normalized)) {
        return normalized;
    }
    const alias = aiSystemTypeAliasMap[normalized.toLowerCase()];
    return alias && aiSystemTypeValues.has(alias) ? alias : '';
};
export const mapAiChoice = (value, labels, confidence) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue || !Object.prototype.hasOwnProperty.call(labels, normalizedValue)) {
        return null;
    }
    return {
        value: normalizedValue,
        label: labels[normalizedValue] ?? normalizedValue,
        confidence: normalizeAiConfidence(confidence),
    };
};
export const buildAiSuggestionResponse = (result) => {
    const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    const normalizedType = normalizeAiRequestType(source.type);
    const normalizedSystemType = normalizeAiSystemType(source.systemType);
    const normalizedPriority = normalizeAiPriority(source.priority);
    return {
        type: mapAiChoice(normalizedType, aiRequestTypeLabels, source.typeConfidence),
        systemType: mapAiChoice(normalizedSystemType, aiSystemTypeLabels, source.systemConfidence),
        priority: mapAiChoice(normalizedPriority, aiPriorityLabels, source.priorityConfidence),
    };
};
export const emptyAiSuggestionResponse = () => ({
    type: null,
    systemType: null,
    priority: null,
});
export const aiRequestSuggestSystemPrompt = `
Ты - ассистент системы обслуживания Новинжстрой.
Определи по описанию заявки поля:
1) type: emergency|operation|maintenance_planned|general
2) systemType: aps|soue|aupt|vpv|fireExtinguishers|exitSigns|gas|skud|sks|svn|asutp|sots
3) priority: critical|high|medium|low

Верни только JSON без markdown:
{"type":"...","systemType":"...","priority":"...","typeConfidence":"high|medium|low","systemConfidence":"high|medium|low","priorityConfidence":"high|medium|low"}
Если поле не удалось определить, верни null.
/no_think
`.trim();
export const aiChatSummarySystemPrompt = `
Ты - ассистент Новинжстрой. Составь краткое резюме чата проекта.
Правила:
- максимум 10 пунктов
- только факты из переписки
- отметь ключевые решения, договоренности и проблемы
- русский язык
/no_think
`.trim();
export const aiNotificationSummarySystemPrompt = `
Ты - ассистент уведомлений Новинжстрой.
Сгруппируй уведомления по смыслу и верни JSON:
{"summary":"текст","groups":[{"label":"описание","count":2,"ids":["id1","id2"]}]}
Ограничения:
- максимум 7 групп
- используй только переданные ids
- русский язык
/no_think
`.trim();
export const aiSimilarRequestSystemPrompt = `
Ты - ассистент Новинжстрой.
Сопоставь текущую заявку с закрытыми заявками и верни JSON-массив:
[{"requestId":"...","summary":"как решали","similarity":"high|medium|low"}]
Выбери до 3 наиболее похожих записей. Если похожих нет, верни [].
/no_think
`.trim();
export const aiExpandSearchSystemPrompt = `
Ты - поисковый ассистент Новинжстрой.
Расширь пользовательский запрос синонимами и кодами систем.
Верни JSON:
{"expandedTerms":["термин1","термин2"],"systemTypes":["aps","aupt"]}
Допустимые systemTypes: aps,soue,aupt,vpv,fireExtinguishers,exitSigns,gas,skud,sks,svn,asutp,sots
/no_think
`.trim();
export const aiChatSystemPrompt = `
Ты - AI-ассистент системы управления Новинжстрой (обслуживание систем безопасности: АПС, СОУЭ, АУПТ, ВПВ, СКУД, СВН и др.).
Ты помогаешь диспетчерам, менеджерам и инженерам работать с данными системы.

Что ты умеешь:
- Давать сводки по заявкам, проектам, направлениям, контрагентам
- Анализировать статистику и выявлять проблемные зоны
- Отвечать на вопросы о статусах, сроках, исполнителях
- Давать рекомендации по приоритизации работ
- Объяснять нормативы и регламенты обслуживания систем безопасности

Когда упоминаешь конкретные объекты (заявки, проекты, направления) — указывай их ID в формате [id:UUID] чтобы система могла создать ссылку.
Пример: "Заявка [id:550e8400-e29b-41d4-a716-446655440000] требует внимания."

Отвечай кратко и по делу. Используй русский язык. Если данных недостаточно — скажи об этом честно.
/no_think
`.trim();
export const buildWeeklyDigestSystemPrompt = `
Ты - аналитик Новинжстрой. Подготовь еженедельный дайджест.
Правила:
- 3-5 коротких абзацев
- ключевые цифры
- проблемные зоны
- 2-3 рекомендации
- не более 300 слов
- русский деловой стиль
/no_think
`.trim();
