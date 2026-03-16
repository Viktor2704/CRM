export const registerFileRoutes = (params) => {
    const { app, requireAuth, asyncHandler, ApiError, storeFile, parseDataUrlPayload, buildFileUrl, } = params;
    app.post('/files/upload', requireAuth, asyncHandler(async (request, response) => {
        const body = request.body;
        if (typeof body.fileName !== 'string' || typeof body.dataUrl !== 'string') {
            throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'fileName and dataUrl are required');
        }
        const fileName = body.fileName.trim();
        if (!fileName) {
            throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'fileName is required');
        }
        const parsed = parseDataUrlPayload({ fileName, dataUrl: body.dataUrl });
        const stored = await storeFile({
            fileName,
            mimeType: parsed.mimeType,
            content: parsed.content,
        });
        response.status(201).json({
            id: stored.id,
            name: stored.fileName,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            uploadedAt: stored.uploadedAt,
            url: buildFileUrl(request, stored.storageKey),
        });
    }));
};
