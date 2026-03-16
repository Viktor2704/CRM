import { config as loadEnv } from 'dotenv';
import path from 'node:path';

const REQUIRED_RUNTIME_ENV_KEYS = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;
const DEFAULT_FALLBACK_ENV_FILES = ['/etc/novinzhstroy/backend.env'] as const;

const hasEnvValue = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0;

export const hasRequiredRuntimeEnv = (env: NodeJS.ProcessEnv = process.env) =>
  REQUIRED_RUNTIME_ENV_KEYS.every(key => hasEnvValue(env[key]));

const normalizeEnvFile = (cwd: string, envFile: string) =>
  path.isAbsolute(envFile) ? envFile : path.resolve(cwd, envFile);

export const redactDatabaseUrl = (databaseUrl: string) => {
  try {
    const parsedUrl = new URL(databaseUrl);
    if (parsedUrl.password) {
      parsedUrl.password = '***';
    }
    return parsedUrl.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
};

export const resolveEnvFileCandidates = ({
  cwd = process.cwd(),
  env = process.env,
  fallbackEnvFiles = DEFAULT_FALLBACK_ENV_FILES,
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fallbackEnvFiles?: readonly string[];
} = {}) => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (envFile: string | undefined) => {
    if (!envFile) {
      return;
    }

    const normalized = normalizeEnvFile(cwd, envFile.trim());
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push(normalized);
  };

  addCandidate('.env');

  if (!hasRequiredRuntimeEnv(env)) {
    for (const fallbackEnvFile of fallbackEnvFiles) {
      addCandidate(fallbackEnvFile);
    }
  }

  return candidates;
};

export const loadBackendEnv = ({
  cwd = process.cwd(),
  env = process.env,
  fallbackEnvFiles = DEFAULT_FALLBACK_ENV_FILES,
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fallbackEnvFiles?: readonly string[];
} = {}) => {
  const loadedEnvFiles: string[] = [];

  for (const envFile of resolveEnvFileCandidates({ cwd, env, fallbackEnvFiles })) {
    const result = loadEnv({
      path: envFile,
      override: false,
      processEnv: env,
    });

    if (!result.error) {
      loadedEnvFiles.push(envFile);
    }

    if (hasRequiredRuntimeEnv(env)) {
      break;
    }
  }

  return loadedEnvFiles;
};
