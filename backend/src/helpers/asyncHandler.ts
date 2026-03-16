export const asyncHandler = (handler: (request: any, response: any, next: any) => Promise<any>) => (request: any, response: any, next: any) => {
    handler(request, response, next).catch(next);
};
