import { describe, expect, it } from 'vitest';
import {
  bytesFromBase64,
  bytesToBase64,
  bytesToHex,
  installBytes,
  installPromiseWithResolvers,
  installUint8Compat,
} from '../browser';

/**
 * pdf.js calls these on every document it opens. A browser without them opens
 * no PDF at all, so what matters here is that the stand-ins return exactly
 * what the native methods would.
 */
describe('the byte-array methods pdf.js needs', () => {
  it('writes hex the way a fingerprint is written', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
    expect(bytesToHex(new Uint8Array())).toBe('');
  });

  it('round-trips base64, padding and all', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111, 33]);
    expect(bytesToBase64(bytes)).toBe('SGVsbG8h');
    expect([...bytesFromBase64('SGVsbG8h')]).toEqual([...bytes]);
    // every byte value, which is what a font actually is
    const all = new Uint8Array(256).map((_, i) => i);
    expect([...bytesFromBase64(bytesToBase64(all))]).toEqual([...all]);
  });

  it('handles the url alphabet in both directions', () => {
    const bytes = new Uint8Array([251, 255, 190]);
    const url = bytesToBase64(bytes, 'base64url');
    expect(url).toBe('-_--');
    expect([...bytesFromBase64(url, 'base64url')]).toEqual([...bytes]);
  });

  // A font is megabytes; String.fromCharCode(...bytes) on one blows the stack.
  it('survives a font-sized array', () => {
    const big = new Uint8Array(400_000).map((_, i) => i % 256);
    const text = bytesToBase64(big);
    expect(bytesFromBase64(text).length).toBe(big.length);
  });

  it('installs only what is missing, and leaves a native method alone', () => {
    type WithHex = Uint8Array & { toHex(): string };
    const hexOf = (bytes: Uint8Array) => (bytes as WithHex).toHex();
    const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
    const native = proto.toHex;
    const marker = function marker(this: Uint8Array) {
      return 'native';
    };
    Object.defineProperty(proto, 'toHex', { value: marker, writable: true, configurable: true });
    installUint8Compat();
    expect(hexOf(new Uint8Array([1]))).toBe('native');

    delete (proto as { toHex?: unknown }).toHex;
    installUint8Compat();
    expect(hexOf(new Uint8Array([1, 171]))).toBe('01ab');

    if (native) {
      Object.defineProperty(proto, 'toHex', { value: native, writable: true, configurable: true });
    } else {
      delete (proto as { toHex?: unknown }).toHex;
    }
  });

  it('gives Promise.withResolvers to a browser that lacks it', async () => {
    const ctor = Promise as unknown as { withResolvers?: unknown };
    const native = ctor.withResolvers;
    delete ctor.withResolvers;
    installPromiseWithResolvers();
    const { promise, resolve } = (
      Promise as unknown as { withResolvers<T>(): { promise: Promise<T>; resolve(v: T): void } }
    ).withResolvers<string>();
    resolve('done');
    await expect(promise).resolves.toBe('done');
    if (native) {
      Object.defineProperty(Promise, 'withResolvers', { value: native, writable: true, configurable: true });
    }
  });

  it('gives Response.bytes() to a browser that lacks it', async () => {
    const proto = Response.prototype as unknown as { bytes?: unknown };
    const native = proto.bytes;
    delete proto.bytes;
    installBytes();
    const bytes = await (new Response('AB') as unknown as { bytes(): Promise<Uint8Array> }).bytes();
    expect([...bytes]).toEqual([65, 66]);
    if (native) {
      Object.defineProperty(Response.prototype, 'bytes', { value: native, writable: true, configurable: true });
    }
  });

  it('gives Uint8Array.fromBase64 to a browser that lacks it', () => {
    const ctor = Uint8Array as unknown as { fromBase64?: (t: string) => Uint8Array };
    const native = ctor.fromBase64;
    delete ctor.fromBase64;
    installUint8Compat();
    expect([...ctor.fromBase64!('QQ==')]).toEqual([65]);
    if (native) {
      Object.defineProperty(Uint8Array, 'fromBase64', { value: native, writable: true, configurable: true });
    }
  });
});
