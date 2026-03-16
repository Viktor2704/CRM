import ExcelJS from 'exceljs';
import type { Response } from 'express';

export type XlsxColumn = {
    header: string;
    key: string;
    width?: number;
};

export const sendXlsxResponse = async (
    response: Response,
    filename: string,
    columns: XlsxColumn[],
    rows: Record<string, unknown>[],
): Promise<void> => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Новинжстрой';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Данные');

    sheet.columns = columns.map((col) => ({
        header: col.header,
        key: col.key,
        width: col.width ?? 20,
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height = 22;

    // Add data rows
    for (const row of rows) {
        sheet.addRow(row);
    }

    // Auto-filter on header
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
    };

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.а-яА-ЯёЁ]/g, '_');
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}.xlsx`);

    await workbook.xlsx.write(response);
    response.end();
};
