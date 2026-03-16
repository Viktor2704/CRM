import ExcelJS from 'exceljs';

export type XlsxRow = Record<string, string>;

export const parseXlsxBuffer = async (buffer: Buffer): Promise<XlsxRow[]> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const rows: XlsxRow[] = [];
    const headers: string[] = [];

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
            // Header row
            row.eachCell((cell, colNumber) => {
                headers[colNumber] = String(cell.value ?? '').trim().toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-zа-яё0-9_]/gi, '');
            });
            return;
        }
        const obj: XlsxRow = {};
        row.eachCell((cell, colNumber) => {
            const header = headers[colNumber];
            if (header) {
                const v = cell.value;
                let str: string;
                if (v === null || v === undefined) {
                    str = '';
                } else if (typeof v === 'object' && 'result' in (v as any)) {
                    str = String((v as any).result ?? '');
                } else if (typeof v === 'object' && 'text' in (v as any)) {
                    str = String((v as any).text ?? '');
                } else {
                    str = String(v);
                }
                obj[header] = str.trim();
            }
        });
        // Skip empty rows
        if (Object.values(obj).some(v => v.length > 0)) {
            rows.push(obj);
        }
    });

    return rows;
};

// Map common Russian/English column name variants to canonical keys
export const mapTenantXlsxRow = (row: XlsxRow) => ({
    name: row['название'] || row['name'] || row['наименование'] || row['��онтрагент'] || '',
    brandName: row['бренд'] || row['brand'] || row['brand_name'] || row['торговое_название'] || '',
    inn: row['инн'] || row['inn'] || row['иnn'] || '',
    contactName: row['контакт'] || row['contact'] || row['фио'] || row['contact_name'] || row['контактное_лицо'] || '',
    contactEmail: row['email'] || row['почта'] || row['e-mail'] || row['contact_email'] || '',
    contactPhone: row['телефон'] || row['phone'] || row['тел'] || row['contact_phone'] || '',
});

export const mapDirectionItemXlsxRow = (row: XlsxRow) => ({
    positionNumber: row['№'] || row['номер'] || row['position'] || row['position_number'] || row['позиция'] || '',
    name: row['название'] || row['name'] || row['наименование'] || row['объект'] || '',
    address: row['адрес'] || row['address'] || '',
    legalEntity: row['юр_лицо'] || row['legal_entity'] || row['организация'] || row['юридическое_лицо'] || '',
    contractNumber: row['договор'] || row['contract'] || row['contract_number'] || row['номер_договора'] || '',
});
