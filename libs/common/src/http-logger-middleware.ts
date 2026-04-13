import type { Logger } from 'pino';

type HttpRequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
  ip?: string;
};

type HttpResponseLike = {
  statusCode?: number;
  on?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};

type NextFunctionLike = () => void;

export function createHttpLoggerMiddleware(logger: Logger) {
  return function httpLoggerMiddleware(
    req: HttpRequestLike,
    res: HttpResponseLike,
    next: NextFunctionLike,
  ) {
    const startNs = process.hrtime.bigint();
    let logged = false;

    const cleanup = () => {
      res.removeListener?.('finish', onFinished);
      res.removeListener?.('close', onClosed);
    };

    const getCommon = () => ({
      url: req.originalUrl ?? req.url,
      durationMs: Math.round(Number(process.hrtime.bigint() - startNs) / 1_000_000 * 100) / 100,
    });

    const onFinished = () => {
      if (logged) return;
      logged = true;
      cleanup();

      const { url, durationMs } = getCommon();
      const statusCode = res.statusCode ?? 0;

      const logData = {
        http: { method: req.method, url, statusCode },
        responseTimeMs: durationMs,
        client: { ip: req.ip },
      };

      if (statusCode >= 500) {
        logger.error(logData, `${req.method} ${url} -> ${statusCode}`);
      } else if (statusCode >= 400) {
        logger.warn(logData, `${req.method} ${url} -> ${statusCode}`);
      } else {
        logger.debug(logData, `${req.method} ${url} -> ${statusCode}`);
      }
    };

    const onClosed = () => {
      if (logged) return;
      logged = true;
      cleanup();

      const { url, durationMs } = getCommon();

      logger.warn(
        {
          http: { method: req.method, url },
          responseTimeMs: durationMs,
          client: { ip: req.ip },
        },
        `${req.method} ${url} -> connection closed`,
      );
    };

    res.on?.('finish', onFinished);
    res.on?.('close', onClosed);

    next();
  };
}
