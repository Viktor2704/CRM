const BOM = '\uFEFF';

export const normalizeCsvKey = (value: string) =>
  String(value || '')
    .replace(BOM, '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/gi, '');

const countDelimiter = (line: string, delimiter: string) => {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
};

const detectDelimiter = (text: string) => {
  const firstLine = text
    .replace(BOM, '')
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!firstLine) {
    return ',';
  }
  const commaCount = countDelimiter(firstLine, ',');
  const semicolonCount = countDelimiter(firstLine, ';');
  return semicolonCount > commaCount ? ';' : ',';
};

export const parseCsvTable = (text: string): string[][] => {
  const normalizedText = text.replace(BOM, '');
  const delimiter = detectDelimiter(normalizedText);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index];

    if (char === '"') {
      if (inQuotes && normalizedText[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && normalizedText[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell.trim());
      cell = '';
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
};

export const resolveHeaderIndex = (headers: string[], candidates: string[], fallback = -1) => {
  for (const candidate of candidates) {
    const candidateKey = normalizeCsvKey(candidate);
    const index = headers.findIndex((header) => header === candidateKey);
    if (index >= 0) {
      return index;
    }
  }
  return fallback;
};

export const readCell = (row: string[], index: number) => {
  if (index < 0 || index >= row.length) {
    return '';
  }
  return String(row[index] || '').trim();
};

export const parseBooleanCell = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'да', '+', 'x', 'ok'].includes(normalized);
};
