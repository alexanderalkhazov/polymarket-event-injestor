import Redis from "ioredis"

let client: Redis

export const getRedis = (): Redis => {
  if (!client) client = new Redis(process.env.REDIS_URL!)
  return client
}
