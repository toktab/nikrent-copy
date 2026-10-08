/**
 * The browser pdf.js assumes it is running in, filled in where it is not.
 *
 * pdf.js 6 is written against the "Uint8Array to/from base64 and hex" proposal:
 * `toHex()` for a document's fingerprint, `toBase64()` for every embedded font
 * it turns into a data URL, `fromBase64()` for base64 streams. Those methods
 * landed in Chrome 140 and Safari 18.4, which means a browser one version
 * behind opens no PDF at all - it fails inside the worker with
 * "hashOriginal.toHex is not a function", before a single page is read.
 *
 * The app cannot pick its users' browsers: this is a tool for an architect's
 * office machine, and a PDF that will not open there is the whole feature
 * gone. So the three methods are filled in where they are missing, in the main
 * thread and inside the pdf.js worker alike.
 *
 * Native implementations are never replaced, and a browser that has them pays
 * nothing: the check is one `in` test per method at start-up.
 */

type Alphabet = 'base64' | 'base64url';

interface Base64Options {
  alphabet?: Alphabet;
}

const HEX = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

export function bytesToBase64(bytes: Uint8Array, alphabet: Alphabet = 'base64'): string {
  // Chunked: `String.fromCharCode(...bytes)` on a megabyte-long font blows the
  // call stack, and a font is exactly what this is used for.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  return alphabet === 'base64url'
    ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    : base64;
}

export function bytesFromBase64(text: string, alphabet: Alphabet = 'base64'): Uint8Array {
  let input = String(text).trim();
  if (alphabet === 'base64url') {
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    // atob wants the padding the url alphabet drops.
    const pad = input.length % 4;
    if (pad) input += '='.repeat(4 - pad);
  }
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Shape of the methods, so the casts below stay honest. */
interface Uint8ArrayCompat {
  toHex?: () => string;
  toBase64?: (options?: Base64Options) => string;
}

/**
 * Installs whatever this browser is missing. Safe to call more than once, and
 * safe to call in a worker - it only touches globals that are not there.
 */
export function installPdfJsCompat(): void {
  installUint8Compat();
  installPromiseWithResolvers();
  installBytes();
}

/**
 * `Promise.withResolvers` (Chrome 119, Safari 17.4). pdf.js uses it in forty
 * places, so without it nothing works at all.
 */
export function installPromiseWithResolvers(): void {
  const ctor = Promise as unknown as { withResolvers?: unknown };
  if (typeof ctor.withResolvers === 'function') return;
  Object.defineProperty(Promise, 'withResolvers', {
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
    writable: true,
    configurable: true,
  });
}

/**
 * `Response.bytes()` and `Blob.bytes()` (Chrome 133, Safari 18.2). pdf.js
 * reads streams through them; `arrayBuffer()` has been in every browser for
 * years and gives the same thing.
 */
export function installBytes(): void {
  const add = (proto: { bytes?: unknown; arrayBuffer?: () => Promise<ArrayBuffer> } | undefined) => {
    if (!proto || typeof proto.bytes === 'function' || typeof proto.arrayBuffer !== 'function') return;
    Object.defineProperty(proto, 'bytes', {
      value: async function bytes(this: { arrayBuffer(): Promise<ArrayBuffer> }) {
        return new Uint8Array(await this.arrayBuffer());
      },
      writable: true,
      configurable: true,
    });
  };
  add(typeof Response === 'undefined' ? undefined : (Response.prototype as never));
  add(typeof Blob === 'undefined' ? undefined : (Blob.prototype as never));
}

export function installUint8Compat(): void {
  const proto = Uint8Array.prototype as Uint8Array & Uint8ArrayCompat;

  if (typeof proto.toHex !== 'function') {
    Object.defineProperty(proto, 'toHex', {
      value: function toHex(this: Uint8Array) {
        return bytesToHex(this);
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof proto.toBase64 !== 'function') {
    Object.defineProperty(proto, 'toBase64', {
      value: function toBase64(this: Uint8Array, options?: Base64Options) {
        return bytesToBase64(this, options?.alphabet ?? 'base64');
      },
      writable: true,
      configurable: true,
    });
  }

  const ctor = Uint8Array as unknown as {
    fromBase64?: (text: string, options?: Base64Options) => Uint8Array;
  };
  if (typeof ctor.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value: (text: string, options?: Base64Options) =>
        bytesFromBase64(text, options?.alphabet ?? 'base64'),
      writable: true,
      configurable: true,
    });
  }
}
