import Redis from 'ioredis';
import { RateLimitInfo } from './ratelimit';

/**
 * Redis-based storage for rate limit records using Streams.
 * Provides immutable/append-only storage with history preservation.
 */

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const STREAM_MAX_LEN = 1000;  // Max entries per stream (per model+account)
const KEY_PREFIX = 'angrav:ratelimit';

// Singleton Redis client
let redis: Redis | null = null;

export interface RateLimitRecord {
    // Identity
    model: string;
    account: string;
    sessionId: string;

    // State
    isLimited: boolean;
    availableAt: string;      // ISO timestamp
    availableAtUnix: number;  // Unix timestamp for comparison

    // Metadata
    detectedAt: string;       // When we detected this
    source: string;           // Which angrav instance
}

/**
 * Gets or creates the Redis client.
 */
export function getRedisClient(): Redis {
    if (!redis) {
        console.log(`🔌 Connecting to Redis at ${REDIS_URL}...`);
        redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        });

        redis.on('error', (err) => {
            console.error('❌ Redis error:', err.message);
        });

        redis.on('connect', () => {
            console.log('✅ Redis connected');
        });
    }
    return redis;
}

/**
 * Closes the Redis connection.
 */
export async function closeRedis(): Promise<void> {
    if (redis) {
        await redis.quit();
        redis = null;
        console.log('🔌 Redis disconnected');
    }
}

/**
 * Generates the stream key for a model+account combination.
 */
function getStreamKey(model: string, account: string): string {
    // Normalize model name for key (remove spaces, lowercase)
    const normalizedModel = model.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const normalizedAccount = account.toLowerCase().replace(/[^a-z0-9@.-]/g, '');
    return `${KEY_PREFIX}:${normalizedModel}:${normalizedAccount}`;
}

/**
 * Persists a rate limit record to Redis Stream (immutable/append-only).
 */
export async function persistRateLimit(
    limitInfo: RateLimitInfo,
    account: string,
    sessionId: string,
    source: string = 'angrav'
): Promise<string> {
    const client = getRedisClient();
    const streamKey = getStreamKey(limitInfo.model, account);

    const record: RateLimitRecord = {
        model: limitInfo.model,
        account,
        sessionId,
        isLimited: limitInfo.isLimited,
        availableAt: limitInfo.availableAt || '',
        availableAtUnix: limitInfo.availableAtDate?.getTime() || 0,
        detectedAt: new Date().toISOString(),
        source
    };

    // XADD with MAXLEN to prevent unbounded growth
    const entryId = await client.xadd(
        streamKey,
        'MAXLEN', '~', STREAM_MAX_LEN.toString(),
        '*',  // Auto-generate ID
        'model', record.model,
        'account', record.account,
        'sessionId', record.sessionId,
        'isLimited', record.isLimited.toString(),
        'availableAt', record.availableAt,
        'availableAtUnix', record.availableAtUnix.toString(),
        'detectedAt', record.detectedAt,
        'source', record.source
    );

    console.log(`📝 Persisted rate limit: ${limitInfo.model} -> ${streamKey} [${entryId}]`);

    // Also update a current state key for fast lookups
    await client.set(
        `${KEY_PREFIX}:current:${getStreamKey(limitInfo.model, account).replace(KEY_PREFIX + ':', '')}`,
        JSON.stringify(record),
        'EX',
        Math.max(1, Math.floor((record.availableAtUnix - Date.now()) / 1000))  // TTL until available
    );

    return entryId || '';
}

/**
 * Gets the current (latest) rate limit state for a model+account.
 * Uses the cached current key for fast access.
 */
export async function getCurrentRateLimit(
    model: string,
    account: string
): Promise<RateLimitRecord | null> {
    const client = getRedisClient();
    const normalizedModel = model.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const normalizedAccount = account.toLowerCase().replace(/[^a-z0-9@.-]/g, '');
    const currentKey = `${KEY_PREFIX}:current:${normalizedModel}:${normalizedAccount}`;

    const data = await client.get(currentKey);
    if (data) {
        return JSON.parse(data) as RateLimitRecord;
    }

    // Fallback: get latest from stream
    return getLatestFromStream(model, account);
}

/**
 * Gets the latest entry from the rate limit stream.
 */
async function getLatestFromStream(
    model: string,
    account: string
): Promise<RateLimitRecord | null> {
    const client = getRedisClient();
    const streamKey = getStreamKey(model, account);

    const entries = await client.xrevrange(streamKey, '+', '-', 'COUNT', '1');

    if (entries.length === 0) {
        return null;
    }

    const [, fields] = entries[0];
    return parseStreamEntry(fields);
}

/**
 * Gets the rate limit history for a model+account.
 */
export async function getRateLimitHistory(
    model: string,
    account: string,
    limit: number = 50
): Promise<RateLimitRecord[]> {
    const client = getRedisClient();
    const streamKey = getStreamKey(model, account);

    const entries = await client.xrevrange(streamKey, '+', '-', 'COUNT', limit.toString());

    return entries.map(([, fields]) => parseStreamEntry(fields));
}

/**
 * Gets all currently rate-limited models across all accounts.
 */
export async function getAllCurrentLimits(): Promise<RateLimitRecord[]> {
    const client = getRedisClient();
    const pattern = `${KEY_PREFIX}:current:*`;

    const keys = await client.keys(pattern);
    const results: RateLimitRecord[] = [];

    for (const key of keys) {
        const data = await client.get(key);
        if (data) {
            const record = JSON.parse(data) as RateLimitRecord;
            // Check if still limited
            if (record.availableAtUnix > Date.now()) {
                results.push(record);
            }
        }
    }

    return results;
}

/**
 * Finds the first available model from a list.
 */
export async function findAvailableModel(
    models: string[],
    account: string
): Promise<string | null> {
    const client = getRedisClient();

    for (const model of models) {
        const limit = await getCurrentRateLimit(model, account);
        if (!limit || !limit.isLimited || limit.availableAtUnix <= Date.now()) {
            return model;
        }
    }

    return null;
}

/**
 * Gets the next model to become available.
 */
export async function getNextAvailableModel(
    models: string[],
    account: string
): Promise<{ model: string; availableAt: Date } | null> {
    const limits: { model: string; availableAtUnix: number }[] = [];

    for (const model of models) {
        const limit = await getCurrentRateLimit(model, account);
        if (limit && limit.isLimited && limit.availableAtUnix > Date.now()) {
            limits.push({ model, availableAtUnix: limit.availableAtUnix });
        }
    }

    if (limits.length === 0) {
        return null;
    }

    // Sort by availability time
    limits.sort((a, b) => a.availableAtUnix - b.availableAtUnix);

    return {
        model: limits[0].model,
        availableAt: new Date(limits[0].availableAtUnix)
    };
}

/**
 * Parses a Redis stream entry into a RateLimitRecord.
 */
function parseStreamEntry(fields: string[]): RateLimitRecord {
    const record: Partial<RateLimitRecord> = {};

    for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];

        switch (key) {
            case 'model': record.model = value; break;
            case 'account': record.account = value; break;
            case 'sessionId': record.sessionId = value; break;
            case 'isLimited': record.isLimited = value === 'true'; break;
            case 'availableAt': record.availableAt = value; break;
            case 'availableAtUnix': record.availableAtUnix = parseInt(value); break;
            case 'detectedAt': record.detectedAt = value; break;
            case 'source': record.source = value; break;
        }
    }

    return record as RateLimitRecord;
}
