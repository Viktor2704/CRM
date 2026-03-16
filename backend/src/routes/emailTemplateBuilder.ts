import {
  createTemplate,
  updateTemplate,
  getTemplateById,
  listTemplates,
  getTemplateVersions,
  restoreTemplateVersion,
  renderTemplate,
  sendTestEmail,
  designToHtml,
} from '../services/emailTemplateBuilder.js';

export const registerEmailTemplateBuilderRoutes = (params: any) => {
  const { app, requireAuth, requireAdminLike, asyncHandler } = params;

  // Create template
  app.post('/admin/email-templates', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const templateId = await createTemplate({
      ...request.body,
      createdBy: request.user.id,
    });
    response.status(201).json({ id: templateId });
  }));

  // Update template
  app.patch('/admin/email-templates/:id', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateTemplate(id, {
      ...request.body,
      updatedBy: request.user.id,
    });
    response.status(200).json({ success: true });
  }));

  // Get template by ID
  app.get('/admin/email-templates/:id', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const template = await getTemplateById(id);
    if (!template) {
      response.status(404).json({ error: 'Template not found' });
      return;
    }
    response.status(200).json(template);
  }));

  // List templates
  app.get('/admin/email-templates', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { category, status, isPublic, limit, offset } = request.query;
    const templates = await listTemplates({
      category: category ? String(category) : undefined,
      status: status ? String(status).split(',') : undefined,
      isPublic: isPublic !== undefined ? isPublic === 'true' : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    response.status(200).json(templates);
  }));

  // Delete template
  app.delete('/admin/email-templates/:id', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateTemplate(id, {
      status: 'archived',
      updatedBy: request.user.id,
    });
    response.status(200).json({ success: true });
  }));

  // Get template versions
  app.get('/admin/email-templates/:id/versions', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const { limit, offset } = request.query;
    const versions = await getTemplateVersions(id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    response.status(200).json(versions);
  }));

  // Restore template version
  app.post('/admin/email-templates/:id/versions/:versionId/restore', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id, versionId } = request.params;
    await restoreTemplateVersion(id, versionId, request.user.id);
    response.status(200).json({ success: true });
  }));

  // Render template with variables
  app.post('/admin/email-templates/:id/render', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const { variables } = request.body;
    const template = await getTemplateById(id);
    if (!template) {
      response.status(404).json({ error: 'Template not found' });
      return;
    }
    const rendered = renderTemplate(template, variables || {});
    response.status(200).json(rendered);
  }));

  // Send test email
  app.post('/admin/email-templates/:id/test', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const { toEmail, variables } = request.body;
    await sendTestEmail({
      templateId: id,
      toEmail,
      variables,
    });
    response.status(200).json({ success: true });
  }));

  // Convert design to HTML
  app.post('/admin/email-templates/design-to-html', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { design } = request.body;
    const html = designToHtml(design);
    response.status(200).json({ html });
  }));

  // Publish template
  app.post('/admin/email-templates/:id/publish', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    await updateTemplate(id, {
      status: 'published',
      updatedBy: request.user.id,
    });
    response.status(200).json({ success: true });
  }));

  // Duplicate template
  app.post('/admin/email-templates/:id/duplicate', requireAuth, requireAdminLike, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;
    const template = await getTemplateById(id);
    if (!template) {
      response.status(404).json({ error: 'Template not found' });
      return;
    }

    const newTemplateId = await createTemplate({
      name: `${template.name} (Copy)`,
      description: template.description,
      subject: template.subject,
      category: template.category,
      design: template.design,
      htmlContent: template.htmlContent,
      textContent: template.textContent,
      isPublic: false,
      createdBy: request.user.id,
    });

    response.status(201).json({ id: newTemplateId });
  }));
};
