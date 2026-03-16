import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { appConfig } from './config.js';
export const hashPassword = async (plainText) => {
    return argon2.hash(plainText, { type: argon2.argon2id });
};
export const verifyPassword = async (hash, plainText) => {
    return argon2.verify(hash, plainText);
};
export const signAccessToken = (payload) => {
    return jwt.sign(payload, appConfig.jwtAccessSecret, {
        expiresIn: appConfig.accessTokenTtlSeconds,
    });
};
export const verifyAccessToken = (token) => {
    return jwt.verify(token, appConfig.jwtAccessSecret);
};
export const createOpaqueToken = () => {
    return randomBytes(48).toString('base64url');
};
export const hashOpaqueToken = (token) => {
    return createHash('sha256').update(token).digest('hex');
};
export const createJti = () => {
    return randomUUID();
};
export const refreshTokenExpiresAtIso = () => {
    const ttlMs = appConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ttlMs).toISOString();
};
export const inviteExpiresAtIso = () => {
    const ttlMs = appConfig.inviteTtlHours * 60 * 60 * 1000;
    return new Date(Date.now() + ttlMs).toISOString();
};
export const passwordResetExpiresAtIso = () => {
    const ttlMs = appConfig.passwordResetTtlHours * 60 * 60 * 1000;
    return new Date(Date.now() + ttlMs).toISOString();
};
