export class NotionError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

export function createNotionClient(headers, {
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn = console.warn,
  requestTimeoutMs = 15000,
  maxRetries = 5,
} = {}) {
  return async function notion(path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      let response;
      let text;
      let failure;
      let retryAfterMs = 0;
      try {
        response = await fetchImpl(`https://api.notion.com/v1${path}`, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        text = await response.text();
      } catch (error) {
        failure = new NotionError(`Notion network error: ${error.message}`, true);
      }
      if (!failure) {
        let body;
        try { body = text ? JSON.parse(text) : {}; }
        catch { body = { raw: text }; }
        if (response.ok) return body;
        const retryable = response.status === 429 || response.status >= 500;
        failure = new NotionError(`Notion API ${response.status}: ${JSON.stringify(body)}`, retryable);
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          retryAfterMs = /^\d+(\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
        }
      }
      if (!failure.retryable || attempt >= maxRetries) throw failure;
      const delay = Math.max(retryAfterMs, 1000 * 2 ** attempt);
      warn(`Temporary Notion error; retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${failure.message}`);
      await sleep(delay);
    }
  };
}
