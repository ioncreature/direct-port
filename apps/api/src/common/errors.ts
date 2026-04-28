import Anthropic from '@anthropic-ai/sdk';
import { ErrorCode } from './error-codes';

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// AiParserService catches Anthropic.* errors and re-throws as BadRequestException
// with the SDK message embedded — instanceof checks lose the type, so we fall
// back to substring matching on the rethrown text.
export function classifyPipelineError(err: unknown, defaultCode: ErrorCode): ErrorCode {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return ErrorCode.AI_TIMEOUT;
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  ) {
    return ErrorCode.AI_UNAVAILABLE;
  }

  const msg = errMsg(err).toLowerCase();

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return ErrorCode.AI_TIMEOUT;
  }
  if (
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up')
  ) {
    return ErrorCode.AI_UNAVAILABLE;
  }
  if (
    msg.includes('prompt is too long') ||
    msg.includes('context_length') ||
    msg.includes('too many tokens')
  ) {
    return ErrorCode.FILE_TOO_BIG;
  }
  if (
    msg.includes('password') ||
    msg.includes("can't find") ||
    msg.includes('cannot find') ||
    msg.includes('invalid signature') ||
    msg.includes('end of central directory') ||
    msg.includes('zip end') ||
    msg.includes('corrupted')
  ) {
    return ErrorCode.FILE_CORRUPTED;
  }

  return defaultCode;
}
