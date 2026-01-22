import { Redis } from "ioredis";

export const redis = new Redis(process.env.REDIS_URL!);
export const TTL = Number(process.env.CACHE_TTL_MINUTES || 20) * 60;
