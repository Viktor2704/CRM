import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name?: string;
        role?: string;
        tenantId?: string;
        globalRole?: string;
        [key: string]: any;
      };
      authUser?: {
        id: string;
        email: string;
        name?: string;
        role?: string;
        tenantId?: string;
        globalRole?: string;
        [key: string]: any;
      };
    }
  }
}

export {};
