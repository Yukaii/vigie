import { defineConfig } from 'kysely-ctl'; // Use defineConfig
import { PostgresDialect, type Dialect } from 'kysely';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

// Load environment variables from .env file if it exists
require('@dotenvx/dotenvx').config();

// Define the pool configuration
const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Add SSL configuration if required for your Supabase connection
  // ssl: {
  //   rejectUnauthorized: false, // Adjust as needed for your environment
  // },
  max: 10, // Kysely might require a max connection pool size
};

// Define the dialect using an async function for the pool
const dialect: Dialect = new PostgresDialect({
  pool: new Pool(poolConfig)
});

// Export configuration using defineConfig and a relative path
export default defineConfig({
  dialect,
  migrations: {
    migrationFolder: 'src/migration', // Use relative path
  },
});
