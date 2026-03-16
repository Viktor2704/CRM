import { dbQuery } from '../db.js';
import { schemaReady } from './schemaReady.js';

export const ensureUploadedFileSchema = (_queryFn = dbQuery) => schemaReady();
