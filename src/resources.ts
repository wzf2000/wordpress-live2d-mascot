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
export function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = RESOURCE_TIMEOUT_MS,
): Promise<T> {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
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
) {
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
      const value = await (type === 'blob'
        ? response.blob()
        : type === 'text'
          ? response.text()
          : response.arrayBuffer());
      checkSignal(requestSignal);
      return value;
    } catch (error) {
      checkSignal(requestSignal);
      throw new ResourceError('network', "Resource download interrupted. Check your connection and retry.");
    }
  }, signal);
}
export async function bytes(url: string, signal: AbortSignal) {
  return (await resource(url, signal)) as ArrayBuffer;
}
export function jsonResource(raw: ArrayBuffer) {
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ResourceError('invalid', "Character resource format is invalid. Retry or choose another character.");
  }
}
export function decodeImage(blob: Blob, signal: AbortSignal) {
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
  );
}
