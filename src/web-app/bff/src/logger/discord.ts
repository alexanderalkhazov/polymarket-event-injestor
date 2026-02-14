import https from 'https';

const MAX_MESSAGE_LENGTH = 1900;
const serviceName = process.env.SERVICE_NAME || 'bff';

const levelRank: Record<string, number> = {
  debug: 10,
  log: 20,
  info: 20,
  warn: 30,
  error: 40,
};

const formatArg = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const postToDiscord = (webhookUrl: string, content: string): void => {
  const url = new URL(webhookUrl);
  const payload = JSON.stringify({ content });

  const req = https.request(
    {
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    () => {}
  );

  req.on('error', () => {});
  req.write(payload);
  req.end();
};

const shouldSend = (level: string, minLevel: string): boolean => {
  const current = levelRank[level] ?? levelRank.info;
  const min = levelRank[minLevel] ?? levelRank.info;
  return current >= min;
};

export const initDiscordLogger = (): void => {
  if ((globalThis as { __discordLoggerInitialized?: boolean }).__discordLoggerInitialized) {
    return;
  }
  (globalThis as { __discordLoggerInitialized?: boolean }).__discordLoggerInitialized = true;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
  if (!webhookUrl) return;

  const minLevel = (process.env.DISCORD_LOG_LEVEL || process.env.LOG_LEVEL || 'info').toLowerCase();

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const formatMessage = (level: string, args: unknown[]): string => {
    const timestamp = new Date().toISOString();
    const message = args.map(formatArg).join(' ');
    return `${timestamp} | ${level.toUpperCase()} | ${serviceName} | ${message}`;
  };

  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    const originalFn = original[level];
    console[level] = (...args: unknown[]) => {
      const formatted = formatMessage(level, args);
      originalFn(formatted);
      if (!shouldSend(level, minLevel)) return;
      if (!formatted) return;
      const payload = formatted.length > MAX_MESSAGE_LENGTH
        ? formatted.slice(0, MAX_MESSAGE_LENGTH) + '...'
        : formatted;
      postToDiscord(webhookUrl, payload);
    };
  });
};
