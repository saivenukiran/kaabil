// The public surface of @kaabil/db: the schema and where its migrations live.
import { fileURLToPath } from 'node:url';

export * as schema from './schema';
export * from './schema';

/** Folder of generated SQL migrations. Each database driver runs them with its own migrator. */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
