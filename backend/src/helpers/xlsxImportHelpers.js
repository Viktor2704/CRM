import ExcelJS from 'exceljs';
export const parseXlsxBuffer = async (buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet)
        return [];
    const rows = [];
    const headers = [];
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
        const obj = {};
        row.eachCell((cell, colNumber) => {
            const header = headers[colNumber];
            if (header) {
                const v = cell.value;
                let str;
                if (v === null || v === undefined) {
                    str = '';
                }
                else if (typeof v === 'object' && 'result' in v) {
                    str = String(v.result ?? '');
                }
                else if (typeof v === 'object' && 'text' in v) {
                    str = String(v.text ?? '');
                }
                else {
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
export const mapTenantXlsxRow = (row) => ({
    name: row['название'] || row['name'] || row['наименование'] || row['��онтрагент'] || '',
    brandName: row['бренд'] || row['brand'] || row['brand_name'] || row['торговое_название'] || '',
    inn: row['инн'] || row['inn'] || row['иnn'] || '',
    contactName: row['контакт'] || row['contact'] || row['фио'] || row['contact_name'] || row['контактное_лицо'] || '',
    contactEmail: row['email'] || row['почта'] || row['e-mail'] || row['contact_email'] || '',
    contactPhone: row['телефон'] || row['phone'] || row['тел'] || row['contact_phone'] || '',
});
export const mapDirectionItemXlsxRow = (row) => ({
    positionNumber: row['№'] || row['номер'] || row['position'] || row['position_number'] || row['позиция'] || '',
    name: row['название'] || row['name'] || row['наименование'] || row['объект'] || '',
    address: row['адрес'] || row['address'] || '',
    legalEntity: row['юр_лицо'] || row['legal_entity'] || row['организация'] || row['юридическое_лицо'] || '',
    contractNumber: row['договор'] || row['contract'] || row['contract_number'] || row['номер_договора'] || '',
});
