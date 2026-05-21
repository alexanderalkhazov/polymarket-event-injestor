import { Pool } from "pg"

export const tsdb = new Pool({ connectionString: process.env.TIMESCALE_URL })
