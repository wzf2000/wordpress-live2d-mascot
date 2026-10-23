// Resource deadlines include response bodies and decode work, not just HTTP headers.
export const RESOURCE_TIMEOUT_MS = 15000;
export class ResourceError extends Error {
  constructor(
    public code: string,
    message: string,
    public category: string = 'resource',
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}
export const cancelled = () => new DOMException("Loading cancelled", 'AbortError');
export function checkSignal(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason || cancelled();
}
export type ResourceSpan = {
  ordinal: number;
  finish: (error?: unknown, bodyBytes?: number | null) => void;
};
function finishSpan(span: ResourceSpan | undefined, error?: unknown, bodyBytes: number | null = null) {
  try { span?.finish(error, bodyBytes); } catch { /* Diagnostics cannot change resource results. */ }
}
export function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = RESOURCE_TIMEOUT_MS,
  span?: ResourceSpan,
  bodyBytes: () => number | null = () => null,
): Promise<T> {
  try { checkSignal(signal); } catch (error) { finishSpan(span, error); return Promise.reject(error); }
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (span) {
        let size: number | null = null;
        if (!error) { try { size = bodyBytes(); } catch { /* Optional diagnostics only. */ } }
        finishSpan(span, error, size);
      }
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => {
      const error = signal.reason || cancelled();
      controller.abort(error);
      finish(error);
    };
    const timer = setTimeout(() => {
      const error = new ResourceError('timeout', "Resource loading timed out. Try again.");
      controller.abort(error);
      finish(error);
    }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        checkSignal(controller.signal);
        return work(controller.signal);
      })
      .then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
  });
}
export function resource(
  url: string,
  signal: AbortSignal,
  type: 'bytes' | 'blob' | 'text' = 'bytes',
  span?: ResourceSpan,
) {
  let bodyBytes: number | null = null;
  return bounded(async (requestSignal) => {
    let response: Response;
    try {
      response = await fetch(url, { signal: requestSignal, credentials: 'omit' });
    } catch (error) {
      checkSignal(requestSignal);
      throw new ResourceError('network', "Network connection failed. Check your connection and retry.");
    }
    if (!response.ok) {
      throw new ResourceError(
        'http',
        response.status === 404
          ? "Character resources are missing. Retry or choose another character."
          : "Resources cannot be downloaded right now. Try again later.",
      );
    }
    try {
      const rawText = type === 'text' && span ? await response.arrayBuffer() : null;
      const value = rawText ? new TextDecoder().decode(rawText) : await (type === 'blob'
        ? response.blob()
        : type === 'text'
          ? response.text()
          : response.arrayBuffer());
      checkSignal(requestSignal);
      if (span) bodyBytes = typeof value === 'string' ? rawText!.byteLength
        : value instanceof Blob ? value.size : value.byteLength;
      return value;
    } catch (error) {
      checkSignal(requestSignal);
      throw new ResourceError('network', "Resource download interrupted. Check your connection and retry.");
    }
  }, signal, RESOURCE_TIMEOUT_MS, span, () => bodyBytes);
}
export async function bytes(url: string, signal: AbortSignal, span?: ResourceSpan) {
  return (await resource(url, signal, 'bytes', span)) as ArrayBuffer;
}
export function jsonResource(raw: ArrayBuffer) {
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ResourceError('invalid', "Character resource format is invalid. Retry or choose another character.");
  }
}
export function decodeImage(blob: Blob, signal: AbortSignal, span?: ResourceSpan) {
  return bounded(
    (imageSignal) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        const cleanup = () => {
          img.onload = img.onerror = null;
          imageSignal.removeEventListener('abort', abort);
          URL.revokeObjectURL(url);
        };
        const abort = () => {
          cleanup();
          img.src = '';
          reject(imageSignal.reason || cancelled());
        };
        imageSignal.addEventListener('abort', abort, { once: true });
        img.onload = () => {
          cleanup();
          resolve(img);
        };
        img.onerror = () => {
          cleanup();
          reject(new ResourceError('invalid', "The character texture cannot be decoded. Retry or choose another character."));
        };
        img.src = url;
      }),
    signal,
    RESOURCE_TIMEOUT_MS,
    span,
  );
}
