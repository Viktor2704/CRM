export class ApiError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export const isApiError = (error) => {
    return error instanceof ApiError;
};
export const mapPgError = (error) => {
    if (!error || typeof error !== 'object')
        return null;
    const pgError = error;
    const detail = pgError.detail ?? '';
    if (pgError.code === 'P0001') {
        if (detail.includes('DIRECTION_IDS_REQUIRED')) {
            return new ApiError(422, 'DIRECTION_IDS_REQUIRED', 'Executor/Curator must have direction_ids');
        }
        if (detail.includes('COUNTERPARTY_ID_REQUIRED')) {
            return new ApiError(422, 'COUNTERPARTY_ID_REQUIRED', 'Client must have counterparty_id');
        }
        if (detail.includes('COUNTERPARTY_SCOPE_VIOLATION')) {
            return new ApiError(403, 'COUNTERPARTY_SCOPE_VIOLATION', 'Bindings outside counterparty scope');
        }
        if (detail.includes('PROJECT_ID_UNKNOWN')) {
            return new ApiError(422, 'PROJECT_ID_UNKNOWN', 'project_id must reference installation request');
        }
    }
    if (pgError.code === '23505') {
        if (pgError.constraint === 'app_users_email_key') {
            return new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email already exists');
        }
        return new ApiError(409, 'UNIQUE_CONSTRAINT', 'Unique constraint violation');
    }
    if (pgError.code === '23503') {
        return new ApiError(422, 'FOREIGN_KEY_VIOLATION', 'Reference not found');
    }
    return null;
};
