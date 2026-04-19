import { get, set } from "idb-keyval";

export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Fetch a model from URL, caching in IndexedDB.
 * Returns the model as an ArrayBuffer.
 */
export async function fetchModel(
  url: string,
  cacheKey: string,
  onProgress?: ProgressCallback,
): Promise<ArrayBuffer> {
  // Check cache first
  const cached = await get<ArrayBuffer>(cacheKey);
  if (cached) {
    onProgress?.(cached.byteLength, cached.byteLength);
    return cached;
  }

  // Fetch with progress
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, contentLength);
  }

  // Concatenate chunks
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const arrayBuffer = buffer.buffer as ArrayBuffer;

  // Cache in IndexedDB
  await set(cacheKey, arrayBuffer);

  return arrayBuffer;
}
