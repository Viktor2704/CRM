import { randomUUID } from 'node:crypto';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';

/**
 * Email Template Builder Service
 * Handles drag-and-drop email builder, template versioning, testing
 */

export interface EmailTemplate {
  id: string;
  name: string;
  description?: string;
  subject: string;
  category?: string;
  design: EmailTemplateDesign;
  htmlContent: string;
  textContent: string;
  thumbnailUrl?: string;
  isPublic: boolean;
  version: number;
  status: 'draft' | 'published' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateDesign {
  version: string;
  body: {
    rows: EmailTemplateRow[];
    values: {
      backgroundColor?: string;
      contentWidth?: string;
      fontFamily?: string;
      textColor?: string;
      linkColor?: string;
    };
  };
}

export interface EmailTemplateRow {
  id: string;
  cells: EmailTemplateCell[];
  values: {
    backgroundColor?: string;
    padding?: string;
    border?: string;
  };
}

export interface EmailTemplateCell {
  id: string;
  contents: EmailTemplateContent[];
  values: {
    width?: string;
    backgroundColor?: string;
    padding?: string;
  };
}

export interface EmailTemplateContent {
  id: string;
  type: 'text' | 'image' | 'button' | 'divider' | 'spacer' | 'social' | 'html';
  values: Record<string, any>;
}

export interface EmailTemplateVersion {
  id: string;
  templateId: string;
  version: number;
  design: EmailTemplateDesign;
  htmlContent: string;
  textContent: string;
  changeDescription?: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Create email template
 */
export const createTemplate = async (params: {
  name: string;
  description?: string;
  subject: string;
  category?: string;
  design: EmailTemplateDesign;
  htmlContent: string;
  textContent: string;
  isPublic?: boolean;
  createdBy: string;
}) => {
  const templateId = randomUUID();

  await dbQuery(
    `insert into email_templates(
      id,
      name,
      description,
      subject,
      category,
      design,
      html_content,
      text_content,
      is_public,
      version,
      status,
      created_by,
      created_at,
      updated_at
    ) values($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 1, 'draft', $10::uuid, now(), now())`,
    [
      templateId,
      params.name,
      params.description || null,
      params.subject,
      params.category || null,
      JSON.stringify(params.design),
      params.htmlContent,
      params.textContent,
      params.isPublic || false,
      params.createdBy,
    ]
  );

  // Create initial version
  await createTemplateVersion({
    templateId,
    design: params.design,
    htmlContent: params.htmlContent,
    textContent: params.textContent,
    changeDescription: 'Initial version',
    createdBy: params.createdBy,
  });

  return templateId;
};

/**
 * Update email template
 */
export const updateTemplate = async (templateId: string, params: {
  name?: string;
  description?: string;
  subject?: string;
  category?: string;
  design?: EmailTemplateDesign;
  htmlContent?: string;
  textContent?: string;
  status?: string;
  changeDescription?: string;
  updatedBy: string;
}) => {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    values.push(params.name);
    paramIndex++;
  }

  if (params.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    values.push(params.description);
    paramIndex++;
  }

  if (params.subject !== undefined) {
    updates.push(`subject = $${paramIndex}`);
    values.push(params.subject);
    paramIndex++;
  }

  if (params.category !== undefined) {
    updates.push(`category = $${paramIndex}`);
    values.push(params.category);
    paramIndex++;
  }

  if (params.design !== undefined) {
    updates.push(`design = $${paramIndex}::jsonb`);
    values.push(JSON.stringify(params.design));
    paramIndex++;
  }

  if (params.htmlContent !== undefined) {
    updates.push(`html_content = $${paramIndex}`);
    values.push(params.htmlContent);
    paramIndex++;
  }

  if (params.textContent !== undefined) {
    updates.push(`text_content = $${paramIndex}`);
    values.push(params.textContent);
    paramIndex++;
  }

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(params.status);
    paramIndex++;
  }

  if (updates.length === 0) {
    return;
  }

  // Increment version if content changed
  if (params.design !== undefined || params.htmlContent !== undefined) {
    updates.push(`version = version + 1`);
  }

  updates.push(`updated_at = now()`);
  values.push(templateId);

  await dbQuery(
    `update email_templates set ${updates.join(', ')} where id = $${paramIndex}::uuid`,
    values
  );

  // Create new version if content changed
  if (params.design !== undefined || params.htmlContent !== undefined) {
    const template = await getTemplateById(templateId);
    if (template) {
      await createTemplateVersion({
        templateId,
        design: params.design || template.design,
        htmlContent: params.htmlContent || template.htmlContent,
        textContent: params.textContent || template.textContent,
        changeDescription: params.changeDescription || 'Updated template',
        createdBy: params.updatedBy,
      });
    }
  }
};

/**
 * Get template by ID
 */
export const getTemplateById = async (templateId: string): Promise<EmailTemplate | null> => {
  const result = await dbQuery(
    `select * from email_templates where id = $1::uuid`,
    [templateId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    subject: String(row.subject),
    category: row.category ? String(row.category) : undefined,
    design: row.design || getDefaultDesign(),
    htmlContent: String(row.html_content),
    textContent: String(row.text_content),
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : undefined,
    isPublic: Boolean(row.is_public),
    version: Number(row.version),
    status: String(row.status) as any,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
};

/**
 * List templates
 */
export const listTemplates = async (params: {
  category?: string;
  status?: string[];
  isPublic?: boolean;
  limit?: number;
  offset?: number;
}) => {
  const limit = Math.max(1, Math.min(200, params.limit || 50));
  const offset = Math.max(0, params.offset || 0);

  let whereClause = 'where 1=1';
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (params.category) {
    whereClause += ` and category = $${paramIndex}`;
    queryParams.push(params.category);
    paramIndex++;
  }

  if (params.status && params.status.length > 0) {
    whereClause += ` and status = any($${paramIndex}::text[])`;
    queryParams.push(params.status);
    paramIndex++;
  }

  if (params.isPublic !== undefined) {
    whereClause += ` and is_public = $${paramIndex}`;
    queryParams.push(params.isPublic);
    paramIndex++;
  }

  queryParams.push(limit, offset);

  const result = await dbQuery(
    `select
      id,
      name,
      description,
      subject,
      category,
      thumbnail_url,
      is_public,
      version,
      status,
      created_at,
      updated_at
    from email_templates
    ${whereClause}
    order by updated_at desc
    limit $${paramIndex}
    offset $${paramIndex + 1}`,
    queryParams
  );

  const totalResult = await dbQuery(
    `select count(*)::int as total from email_templates ${whereClause}`,
    queryParams.slice(0, -2)
  );

  return {
    items: result.rows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : undefined,
      subject: String(row.subject),
      category: row.category ? String(row.category) : undefined,
      thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : undefined,
      isPublic: Boolean(row.is_public),
      version: Number(row.version),
      status: String(row.status),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
    total: Number(totalResult.rows[0]?.total || 0),
  };
};

/**
 * Create template version
 */
const createTemplateVersion = async (params: {
  templateId: string;
  design: EmailTemplateDesign;
  htmlContent: string;
  textContent: string;
  changeDescription?: string;
  createdBy: string;
}) => {
  const versionId = randomUUID();

  // Get current version number
  const versionResult = await dbQuery(
    `select version from email_templates where id = $1::uuid`,
    [params.templateId]
  );

  const version = versionResult.rows.length > 0 ? Number(versionResult.rows[0].version) : 1;

  await dbQuery(
    `insert into email_template_versions(
      id,
      template_id,
      version,
      design,
      html_content,
      text_content,
      change_description,
      created_by,
      created_at
    ) values($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8::uuid, now())`,
    [
      versionId,
      params.templateId,
      version,
      JSON.stringify(params.design),
      params.htmlContent,
      params.textContent,
      params.changeDescription || null,
      params.createdBy,
    ]
  );

  return versionId;
};

/**
 * Get template versions
 */
export const getTemplateVersions = async (templateId: string, params: {
  limit?: number;
  offset?: number;
}) => {
  const limit = Math.max(1, Math.min(100, params.limit || 20));
  const offset = Math.max(0, params.offset || 0);

  const result = await dbQuery(
    `select * from email_template_versions
     where template_id = $1::uuid
     order by version desc
     limit $2
     offset $3`,
    [templateId, limit, offset]
  );

  const totalResult = await dbQuery(
    `select count(*)::int as total from email_template_versions where template_id = $1::uuid`,
    [templateId]
  );

  return {
    items: result.rows.map(row => ({
      id: String(row.id),
      templateId: String(row.template_id),
      version: Number(row.version),
      design: row.design || getDefaultDesign(),
      htmlContent: String(row.html_content),
      textContent: String(row.text_content),
      changeDescription: row.change_description ? String(row.change_description) : undefined,
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
    })),
    total: Number(totalResult.rows[0]?.total || 0),
  };
};

/**
 * Restore template version
 */
export const restoreTemplateVersion = async (templateId: string, versionId: string, restoredBy: string) => {
  const versionResult = await dbQuery(
    `select design, html_content, text_content from email_template_versions where id = $1::uuid`,
    [versionId]
  );

  if (versionResult.rows.length === 0) {
    throw new Error('Version not found');
  }

  const version = versionResult.rows[0];

  await updateTemplate(templateId, {
    design: version.design,
    htmlContent: version.html_content,
    textContent: version.text_content,
    changeDescription: `Restored from version ${versionId}`,
    updatedBy: restoredBy,
  });
};

/**
 * Render template with variables
 */
export const renderTemplate = (template: EmailTemplate, variables: Record<string, any>) => {
  let html = template.htmlContent;
  let text = template.textContent;
  let subject = template.subject;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    html = html.replace(regex, String(value || ''));
    text = text.replace(regex, String(value || ''));
    subject = subject.replace(regex, String(value || ''));
  }

  return { html, text, subject };
};

/**
 * Send test email
 */
export const sendTestEmail = async (params: {
  templateId: string;
  toEmail: string;
  variables?: Record<string, any>;
}) => {
  const template = await getTemplateById(params.templateId);
  if (!template) {
    throw new Error('Template not found');
  }

  const { html, text, subject } = renderTemplate(template, params.variables || {});

  const { enqueueEmail } = await import('./mailService.js');
  const { sender } = await import('./mailService.js');

  await enqueueEmail({
    to: params.toEmail,
    from: sender!,
    subject: `[TEST] ${subject}`,
    text,
    html,
    metadata: {
      isTest: true,
      templateId: params.templateId,
    },
  });
};

/**
 * Convert design to HTML
 */
export const designToHtml = (design: EmailTemplateDesign): string => {
  const bodyValues = design.body.values;
  const backgroundColor = bodyValues.backgroundColor || '#f4f4f4';
  const contentWidth = bodyValues.contentWidth || '600px';
  const fontFamily = bodyValues.fontFamily || 'Arial, Helvetica, sans-serif';
  const textColor = bodyValues.textColor || '#333333';
  const linkColor = bodyValues.linkColor || '#1a73e8';

  let html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: ${fontFamily}; color: ${textColor}; }
    a { color: ${linkColor}; text-decoration: none; }
    table { border-collapse: collapse; }
    img { border: 0; display: block; }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${backgroundColor};">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table width="${contentWidth}" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff;">
`;

  for (const row of design.body.rows) {
    html += renderRow(row);
  }

  html += `
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
};

/**
 * Render row to HTML
 */
const renderRow = (row: EmailTemplateRow): string => {
  const rowBg = row.values.backgroundColor || 'transparent';
  const rowPadding = row.values.padding || '0';

  let html = `<tr><td style="background-color: ${rowBg}; padding: ${rowPadding};">`;
  html += `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`;

  for (const cell of row.cells) {
    html += renderCell(cell);
  }

  html += `</tr></table></td></tr>`;
  return html;
};

/**
 * Render cell to HTML
 */
const renderCell = (cell: EmailTemplateCell): string => {
  const cellWidth = cell.values.width || 'auto';
  const cellBg = cell.values.backgroundColor || 'transparent';
  const cellPadding = cell.values.padding || '10px';

  let html = `<td width="${cellWidth}" style="background-color: ${cellBg}; padding: ${cellPadding}; vertical-align: top;">`;

  for (const content of cell.contents) {
    html += renderContent(content);
  }

  html += `</td>`;
  return html;
};

/**
 * Render content to HTML
 */
const renderContent = (content: EmailTemplateContent): string => {
  switch (content.type) {
    case 'text':
      return `<div style="font-size: ${content.values.fontSize || '14px'}; color: ${content.values.color || '#333'}; line-height: ${content.values.lineHeight || '1.5'};">${content.values.text || ''}</div>`;

    case 'image':
      return `<img src="${content.values.src || ''}" alt="${content.values.alt || ''}" width="${content.values.width || 'auto'}" style="max-width: 100%;" />`;

    case 'button':
      return `<table cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color: ${content.values.backgroundColor || '#1a73e8'}; padding: ${content.values.padding || '12px 24px'}; border-radius: ${content.values.borderRadius || '4px'};"><a href="${content.values.url || '#'}" style="color: ${content.values.color || '#ffffff'}; font-size: ${content.values.fontSize || '16px'}; font-weight: bold; text-decoration: none; display: inline-block;">${content.values.text || 'Button'}</a></td></tr></table>`;

    case 'divider':
      return `<hr style="border: none; border-top: ${content.values.borderWidth || '1px'} ${content.values.borderStyle || 'solid'} ${content.values.borderColor || '#e0e0e0'}; margin: ${content.values.margin || '20px 0'};" />`;

    case 'spacer':
      return `<div style="height: ${content.values.height || '20px'};"></div>`;

    case 'html':
      return content.values.html || '';

    default:
      return '';
  }
};

/**
 * Get default design
 */
const getDefaultDesign = (): EmailTemplateDesign => {
  return {
    version: '1.0',
    body: {
      rows: [],
      values: {
        backgroundColor: '#f4f4f4',
        contentWidth: '600px',
        fontFamily: 'Arial, Helvetica, sans-serif',
        textColor: '#333333',
        linkColor: '#1a73e8',
      },
    },
  };
};
