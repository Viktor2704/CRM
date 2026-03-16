export const registerFileRoutes = (params) => {
    const {
        app,
        requireAuth,
        asyncHandler,
        ApiError,
        storeFile,
        storeFileStream,
        parseDataUrlPayload,
        ensureSafeUploadMetadata,
        buildFileUrl,
        registerUploadedFile,
    } = params;
    app.post('/files/upload', requireAuth, asyncHandler(async (request, response) => {
        const contentType = String(request.headers['content-type'] || '');
        let stored;
        if (contentType.includes('application/json')) {
            const body = request.body;
            if (typeof body.fileName !== 'string' || typeof body.dataUrl !== 'string') {
                throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'fileName and dataUrl are required');
            }
            const fileName = body.fileName.trim();
            if (!fileName) {
                throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'fileName is required');
            }
            const parsed = parseDataUrlPayload({ fileName, dataUrl: body.dataUrl });
            stored = await storeFile({
                fileName: parsed.fileName,
                mimeType: parsed.mimeType,
                content: parsed.content,
            });
        }
        else {
            const rawFileName = Array.isArray(request.query?.fileName) ? request.query.fileName[0] : request.query?.fileName;
            const fileName = typeof rawFileName === 'string' ? rawFileName.trim() : '';
            if (!fileName) {
                throw new ApiError(422, 'INVALID_FILE_PAYLOAD', 'fileName query parameter is required');
            }
            const metadata = ensureSafeUploadMetadata({ fileName, mimeType: contentType });
            stored = await storeFileStream({
                fileName: metadata.fileName,
                mimeType: metadata.mimeType,
                stream: request,
            });
        }
        await registerUploadedFile({
            fileId: stored.id,
            storageKey: stored.storageKey,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            uploadedById: request.authUser?.id ?? '',
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
