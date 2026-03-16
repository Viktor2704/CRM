import { ApiError } from '../errors.js';
import { appendUserAuditLog, buildUserBindings, createEmailLoginToken, countRecentFailedLoginsByIp, createBootstrapAdmin, createInviteToken, createPasswordResetToken, findEmailLoginToken, findInviteToken, findPasswordResetToken, findRefreshTokenByHash, getUserByEmailForAuth, getUserById, listActiveAdminRecipients, markEmailLoginTokenUsed, markInviteTokenUsed, markLoginSuccess, markPasswordResetTokenUsed, recordLoginEvent, revokeActiveEmailLoginTokensForUser, revokeAllUserRefreshTokens, revokeRefreshTokenByHash, revokeRefreshTokenById, saveRefreshToken, updateLoginFailureState, updateUserPasswordAndActivate, updateUserPasswordAfterInviteAcceptance, } from './userService.js';
import { appConfig } from '../config.js';
import { createJti, createOpaqueToken, hashOpaqueToken, hashPassword, passwordResetExpiresAtIso, refreshTokenExpiresAtIso, signAccessToken, verifyPassword, } from '../security.js';
import { canSendEmails, sendApprovalRequiredNotice, sendEmailLoginToken, sendInviteToken, sendPasswordChangedNotice } from './mailService.js';
import { logger, serializeError } from '../logger.js';
const ensureLoginRateLimit = async (args) => {
    if (!args.meta.ip || appConfig.loginRateLimitMaxAttempts <= 0 || appConfig.loginRateLimitWindowMinutes <= 0) {
        return;
    }
    const failedAttempts = await countRecentFailedLoginsByIp(args.meta.ip, appConfig.loginRateLimitWindowMinutes);
    if (failedAttempts < appConfig.loginRateLimitMaxAttempts) {
        return;
    }
    await recordLoginEvent({
        userId: args.userId ?? null,
        email: args.email.toLowerCase(),
        success: false,
        reasonCode: 'RATE_LIMITED',
        meta: args.meta,
    });
    throw new ApiError(429, 'RATE_LIMITED', 'Too many login attempts, try again later');
};
const createSession = async (user, meta) => {
    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = createOpaqueToken();
    const refreshTokenHash = hashOpaqueToken(refreshToken);
    const jti = createJti();
    const expiresAt = refreshTokenExpiresAtIso();
    await saveRefreshToken({
        userId: user.id,
        tokenHash: refreshTokenHash,
        jti,
        expiresAt,
        meta,
    });
    return {
        accessToken,
        expiresIn: appConfig.accessTokenTtlSeconds,
        user,
        refreshToken,
    };
};
export const bootstrapFirstAdmin = async (args) => {
    const passwordHash = await hashPassword(args.password);
    const adminUser = await createBootstrapAdmin({
        fullName: args.fullName,
        email: args.email,
        passwordHash,
    });
    const session = await createSession(adminUser, args.meta);
    return {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        user: session.user,
        refreshToken: session.refreshToken,
    };
};
export const loginByPassword = async (args) => {
    if (!appConfig.authPasswordLoginEnabled) {
        throw new ApiError(403, 'PASSWORD_LOGIN_DISABLED', 'Password login is disabled');
    }
    await ensureLoginRateLimit({
        email: args.email,
        meta: args.meta,
    });
    const candidate = await getUserByEmailForAuth(args.email);
    if (!candidate) {
        await recordLoginEvent({
            userId: null,
            email: args.email.toLowerCase(),
            success: false,
            reasonCode: 'INVALID_CREDENTIALS',
            meta: args.meta,
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (candidate.lockedUntil && new Date(candidate.lockedUntil).getTime() > Date.now()) {
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: 'ACCOUNT_LOCKED',
            meta: args.meta,
        });
        throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');
    }
    if (candidate.status === 'blocked' || candidate.status === 'deactivated') {
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: 'ACCOUNT_DISABLED',
            meta: args.meta,
        });
        throw new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (candidate.status === 'invited') {
        const code = candidate.mustChangePassword ? 'INVITE_PENDING' : 'ACCOUNT_PENDING_APPROVAL';
        const message = candidate.mustChangePassword
            ? 'Invitation must be accepted first'
            : 'Account is pending admin approval';
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: code,
            meta: args.meta,
        });
        throw new ApiError(403, code, message);
    }
    const verified = await verifyPassword(candidate.passwordHash, args.password);
    if (!verified) {
        const nextAttempts = candidate.failedLoginAttempts + 1;
        const shouldLock = nextAttempts >= appConfig.loginLockThreshold;
        const lockUntil = shouldLock
            ? new Date(Date.now() + appConfig.loginLockMinutes * 60 * 1000).toISOString()
            : null;
        await updateLoginFailureState(candidate.id, nextAttempts, lockUntil);
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: shouldLock ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
            meta: args.meta,
        });
        if (shouldLock) {
            throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');
        }
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    await markLoginSuccess(candidate.id);
    await recordLoginEvent({
        userId: candidate.id,
        email: candidate.email,
        success: true,
        reasonCode: null,
        meta: args.meta,
    });
    const user = await getUserById(candidate.id);
    if (!user) {
        throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const session = await createSession(user, args.meta);
    return {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        user: session.user,
        refreshToken: session.refreshToken,
    };
};
export const requestEmailLoginToken = async (args) => {
    if (!appConfig.authEmailLoginEnabled) {
        throw new ApiError(403, 'EMAIL_LOGIN_DISABLED', 'Email login is disabled');
    }
    await ensureLoginRateLimit({
        email: args.email,
        meta: args.meta,
    });
    const candidate = await getUserByEmailForAuth(args.email);
    if (!candidate) {
        if (args.hideUserNotFound) {
            return { debugToken: null };
        }
        throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }
    if (candidate.lockedUntil && new Date(candidate.lockedUntil).getTime() > Date.now()) {
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: 'ACCOUNT_LOCKED',
            meta: args.meta,
        });
        throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');
    }
    if (candidate.status === 'blocked' || candidate.status === 'deactivated') {
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: 'ACCOUNT_DISABLED',
            meta: args.meta,
        });
        throw new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (candidate.status === 'invited') {
        const code = candidate.mustChangePassword ? 'INVITE_PENDING' : 'ACCOUNT_PENDING_APPROVAL';
        const message = candidate.mustChangePassword
            ? 'Invitation must be accepted first'
            : 'Account is pending admin approval';
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: code,
            meta: args.meta,
        });
        throw new ApiError(403, code, message);
    }
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    const expiresAt = new Date(Date.now() + appConfig.emailLoginTokenTtlMinutes * 60 * 1000).toISOString();
    await revokeActiveEmailLoginTokensForUser(candidate.id);
    await createEmailLoginToken({
        userId: candidate.id,
        email: candidate.email,
        tokenHash,
        expiresAt,
    });
    if (canSendEmails()) {
        await sendEmailLoginToken({
            to: candidate.email,
            token,
            expiresInMinutes: appConfig.emailLoginTokenTtlMinutes,
        });
    }
    else if (!appConfig.allowDebugTokens) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
    await recordLoginEvent({
        userId: candidate.id,
        email: candidate.email,
        success: true,
        reasonCode: 'EMAIL_TOKEN_SENT',
        meta: args.meta,
    });
    if (args.actorUserId) {
        await appendUserAuditLog({
            actorUserId: args.actorUserId,
            targetUserId: candidate.id,
            action: 'email_login_token_sent',
            afterState: {
                email: candidate.email,
                expiresAt,
            },
            meta: args.meta,
        });
    }
    return {
        debugToken: appConfig.allowDebugTokens ? token : null,
    };
};
export const loginByEmailToken = async (args) => {
    if (!appConfig.authEmailLoginEnabled) {
        throw new ApiError(403, 'EMAIL_LOGIN_DISABLED', 'Email login is disabled');
    }
    await ensureLoginRateLimit({
        email: args.email,
        meta: args.meta,
    });
    const candidate = await getUserByEmailForAuth(args.email);
    if (!candidate) {
        await recordLoginEvent({
            userId: null,
            email: args.email.toLowerCase(),
            success: false,
            reasonCode: 'INVALID_CREDENTIALS',
            meta: args.meta,
        });
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or token');
    }
    if (candidate.lockedUntil && new Date(candidate.lockedUntil).getTime() > Date.now()) {
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: 'ACCOUNT_LOCKED',
            meta: args.meta,
        });
        throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');
    }
    if (candidate.status === 'blocked' || candidate.status === 'deactivated') {
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: 'ACCOUNT_DISABLED',
            meta: args.meta,
        });
        throw new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (candidate.status === 'invited') {
        const code = candidate.mustChangePassword ? 'INVITE_PENDING' : 'ACCOUNT_PENDING_APPROVAL';
        const message = candidate.mustChangePassword
            ? 'Invitation must be accepted first'
            : 'Account is pending admin approval';
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: code,
            meta: args.meta,
        });
        throw new ApiError(403, code, message);
    }
    const tokenHash = hashOpaqueToken(args.token);
    const tokenRow = await findEmailLoginToken(tokenHash);
    const isInvalidToken = !tokenRow ||
        tokenRow.user_id !== candidate.id ||
        tokenRow.email.toLowerCase() !== candidate.email.toLowerCase() ||
        !!tokenRow.used_at ||
        new Date(tokenRow.expires_at).getTime() <= Date.now();
    if (isInvalidToken) {
        const nextAttempts = candidate.failedLoginAttempts + 1;
        const shouldLock = nextAttempts >= appConfig.loginLockThreshold;
        const lockUntil = shouldLock
            ? new Date(Date.now() + appConfig.loginLockMinutes * 60 * 1000).toISOString()
            : null;
        await updateLoginFailureState(candidate.id, nextAttempts, lockUntil);
        await recordLoginEvent({
            userId: candidate.id,
            email: candidate.email,
            success: false,
            reasonCode: shouldLock ? 'ACCOUNT_LOCKED' : 'INVALID_EMAIL_TOKEN',
            meta: args.meta,
        });
        if (shouldLock) {
            throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');
        }
        throw new ApiError(401, 'INVALID_EMAIL_TOKEN', 'Invalid or expired email token');
    }
    await markEmailLoginTokenUsed(tokenRow.id);
    await revokeActiveEmailLoginTokensForUser(candidate.id);
    await markLoginSuccess(candidate.id);
    await recordLoginEvent({
        userId: candidate.id,
        email: candidate.email,
        success: true,
        reasonCode: null,
        meta: args.meta,
    });
    const user = await getUserById(candidate.id);
    if (!user) {
        throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const session = await createSession(user, args.meta);
    return {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        user: session.user,
        refreshToken: session.refreshToken,
    };
};
export const refreshSession = async (args) => {
    if (!args.refreshToken) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is required');
    }
    const tokenHash = hashOpaqueToken(args.refreshToken);
    const tokenRow = await findRefreshTokenByHash(tokenHash);
    if (!tokenRow) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is invalid');
    }
    if (tokenRow.revoked_at) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is revoked');
    }
    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token is expired');
    }
    const user = await getUserById(tokenRow.user_id);
    if (!user) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Refresh token user is missing');
    }
    if (user.status === 'blocked' || user.status === 'deactivated') {
        await revokeAllUserRefreshTokens(user.id);
        throw new ApiError(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    }
    if (user.status === 'invited') {
        await revokeAllUserRefreshTokens(user.id);
        if (user.mustChangePassword) {
            throw new ApiError(403, 'INVITE_PENDING', 'Invitation must be accepted first');
        }
        throw new ApiError(403, 'ACCOUNT_PENDING_APPROVAL', 'Account is pending admin approval');
    }
    const session = await createSession(user, args.meta);
    const newTokenHash = hashOpaqueToken(session.refreshToken);
    const nextToken = await findRefreshTokenByHash(newTokenHash);
    if (nextToken?.jti) {
        await revokeRefreshTokenById(tokenRow.id, nextToken.jti);
    }
    else {
        await revokeRefreshTokenById(tokenRow.id, undefined);
    }
    return {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        user: session.user,
        refreshToken: session.refreshToken,
    };
};
export const logoutSession = async (refreshToken) => {
    if (!refreshToken)
        return;
    await revokeRefreshTokenByHash(hashOpaqueToken(refreshToken));
};
export const requestPasswordReset = async (args) => {
    const user = await getUserByEmailForAuth(args.email);
    if (!user) {
        return { debugToken: null };
    }
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    await createPasswordResetToken({
        userId: user.id,
        tokenHash,
        expiresAt: passwordResetExpiresAtIso(),
    });
    await appendUserAuditLog({
        actorUserId: null,
        targetUserId: user.id,
        action: 'password_reset_requested',
        afterState: { email: user.email },
        meta: args.meta,
    });
    return {
        debugToken: appConfig.allowDebugTokens ? token : null,
    };
};
export const confirmPasswordReset = async (args) => {
    const tokenHash = hashOpaqueToken(args.token);
    const tokenRow = await findPasswordResetToken(tokenHash);
    if (!tokenRow) {
        throw new ApiError(422, 'TOKEN_INVALID', 'Reset token is invalid');
    }
    if (tokenRow.used_at) {
        throw new ApiError(422, 'TOKEN_USED', 'Reset token already used');
    }
    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        throw new ApiError(422, 'TOKEN_EXPIRED', 'Reset token expired');
    }
    const newPasswordHash = await hashPassword(args.password);
    await updateUserPasswordAndActivate(tokenRow.user_id, newPasswordHash);
    await markPasswordResetTokenUsed(tokenRow.id);
    await revokeAllUserRefreshTokens(tokenRow.user_id);
    await appendUserAuditLog({
        actorUserId: tokenRow.user_id,
        targetUserId: tokenRow.user_id,
        action: 'password_reset',
        afterState: { status: 'active' },
        meta: args.meta,
    });
    // Email уведомление о смене пароля
    const user = await getUserById(tokenRow.user_id);
    if (user) {
        void sendPasswordChangedNotice({ to: user.email, toName: user.fullName }).catch(() => { });
        // In-app уведомление (колокольчик)
        const { dbQuery } = await import('../db.js');
        void dbQuery(`INSERT INTO app_notifications(user_id, event_type, title, body, entity_type, entity_id)
            VALUES($1::uuid, 'password_changed', 'Пароль изменён', 'Пароль вашего аккаунта был успешно изменён.', 'user', $1)`, [tokenRow.user_id]).catch(() => { });
    }
};
export const sendInvite = async (args) => {
    const user = await getUserById(args.userId);
    if (!user) {
        throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const inviteToken = createOpaqueToken();
    const tokenHash = hashOpaqueToken(inviteToken);
    const expiresAt = new Date(Date.now() + (args.expiresInHours ?? appConfig.inviteTtlHours) * 60 * 60 * 1000).toISOString();
    await createInviteToken({
        userId: user.id,
        email: user.email,
        tokenHash,
        createdByUserId: args.actorUserId,
        expiresAt,
    });
    await appendUserAuditLog({
        actorUserId: args.actorUserId,
        targetUserId: user.id,
        action: 'invite_sent',
        afterState: { expiresAt },
        meta: args.meta,
    });
    if (canSendEmails()) {
        await sendInviteToken({
            to: user.email,
            token: inviteToken,
            expiresInHours: args.expiresInHours ?? appConfig.inviteTtlHours,
        });
    }
    else if (!appConfig.allowDebugTokens) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not configured');
    }
    return {
        debugToken: appConfig.allowDebugTokens ? inviteToken : null,
    };
};
export const acceptInvite = async (args) => {
    const inviteTokenHash = hashOpaqueToken(args.token);
    const inviteRow = await findInviteToken(inviteTokenHash);
    if (!inviteRow) {
        throw new ApiError(422, 'TOKEN_INVALID', 'Invite token is invalid');
    }
    if (inviteRow.used_at) {
        throw new ApiError(422, 'TOKEN_USED', 'Invite token already used');
    }
    if (new Date(inviteRow.expires_at).getTime() <= Date.now()) {
        throw new ApiError(422, 'TOKEN_EXPIRED', 'Invite token expired');
    }
    const passwordHash = await hashPassword(args.password);
    await updateUserPasswordAfterInviteAcceptance(inviteRow.user_id, passwordHash);
    await markInviteTokenUsed(inviteRow.id);
    await revokeAllUserRefreshTokens(inviteRow.user_id);
    await appendUserAuditLog({
        actorUserId: inviteRow.user_id,
        targetUserId: inviteRow.user_id,
        action: 'invite_accepted',
        afterState: { status: 'invited', approval: 'pending' },
        meta: args.meta,
    });
    const acceptedUser = await getUserById(inviteRow.user_id);
    const adminRecipients = await listActiveAdminRecipients();
    await appendUserAuditLog({
        actorUserId: inviteRow.user_id,
        targetUserId: inviteRow.user_id,
        action: 'registration_pending_approval',
        afterState: {
            status: 'invited',
            approval: 'pending',
            adminRecipients: adminRecipients.length,
        },
        meta: args.meta,
    });
    if (acceptedUser && canSendEmails() && adminRecipients.length > 0) {
        await Promise.all(adminRecipients.map(async (admin) => {
            try {
                await sendApprovalRequiredNotice({
                    to: admin.email,
                    userFullName: acceptedUser.fullName,
                    userEmail: acceptedUser.email,
                });
            }
            catch (error) {
                logger.error('Failed to send admin approval notice', {
                    adminEmail: admin.email,
                    userId: acceptedUser.id,
                    error: serializeError(error),
                });
            }
        }));
    }
};
export const buildInitialBindings = buildUserBindings;
