const Redis = require('ioredis');
const redis = new Redis();
const script = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  
  local bucket = redis.call("HMGET", key, "tokens", "last_update")
  local tokens = tonumber(bucket[1])
  local last_update = tonumber(bucket[2])
  
  if not tokens then
    tokens = capacity
    last_update = now
  end
  
  local elapsed = math.max(0, (now - last_update) / 1000)
  tokens = math.min(capacity, tokens + (elapsed * rate))
  
  if tokens >= 1 then
    tokens = tokens - 1
    redis.call("HMSET", key, "tokens", tokens, "last_update", now)
    redis.call("PEXPIRE", key, 60000)
    return {1, tokens}
  else
    return {0, tokens}
  end
`;

(async () => {
  await redis.del('ratelimit:1');
  let allowed = 0;
  let rejected = 0;
  for(let i=0; i<60; i++) {
    const res = await redis.eval(script, 1, 'ratelimit:1', 50, 5, Date.now());
    if (res[0] === 1) allowed++; else rejected++;
  }
  console.log({ allowed, rejected });
  process.exit(0);
})();
