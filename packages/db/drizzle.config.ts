import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL migrations from the schema. It never connects to a database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
