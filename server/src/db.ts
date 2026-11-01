import { PrismaClient } from '@prisma/client';
import { loadConfig } from './env.js';

const config = loadConfig();

/**
 * Prisma is the single owner of persistent state. Games are loaded back from
 * Postgres after a restart, which is what makes restart recovery possible.
 */
export const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
  log: config.isProduction ? ['error', 'warn'] : ['error', 'warn'],
});

export type Db = PrismaClient;

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
