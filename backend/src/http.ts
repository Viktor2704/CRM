import { appConfig } from './config.js';
export const getRequestMeta = (request) => {
    const ip = request.ip ?? null;
    const userAgent = request.get('user-agent') ?? null;
    const requestId = request.requestId ?? request.get('x-request-id') ?? null;
    return { ip, userAgent, requestId };
};
export const setRefreshCookie = (response, token) => {
    const maxAge = appConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    response.cookie(appConfig.refreshCookieName, token, {
        httpOnly: true,
        sameSite: appConfig.cookieSameSite,
        secure: appConfig.cookieSecure,
        path: '/',
        maxAge,
    });
};
export const clearRefreshCookie = (response) => {
    response.clearCookie(appConfig.refreshCookieName, {
        httpOnly: true,
        sameSite: appConfig.cookieSameSite,
        secure: appConfig.cookieSecure,
        path: '/',
    });
};
export const setCsrfCookie = (response, token) => {
    const maxAge = appConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
    response.cookie(appConfig.csrfCookieName, token, {
        httpOnly: false,
        sameSite: appConfig.cookieSameSite,
        secure: appConfig.cookieSecure,
        path: '/',
        maxAge,
    });
};
export const clearCsrfCookie = (response) => {
    response.clearCookie(appConfig.csrfCookieName, {
        httpOnly: false,
        sameSite: appConfig.cookieSameSite,
        secure: appConfig.cookieSecure,
        path: '/',
    });
};
