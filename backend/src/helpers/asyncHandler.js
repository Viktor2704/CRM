export const asyncHandler = (handler) => (request, response, next) => {
    handler(request, response, next).catch(next);
};
