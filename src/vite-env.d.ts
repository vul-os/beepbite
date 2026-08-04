/// <reference types="vite/client" />

// Minimal Web Serial API ambient types (WICG spec: https://wicg.github.io/serial/).
// TypeScript's bundled DOM lib does not ship these yet, and no @types/w3c-web-serial
// package is installed, so the subset actually used by pos/hooks/use-scale.js is
// declared here rather than reaching for `any`/`@ts-ignore` at the call sites.
interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
}

interface Serial extends EventTarget {
  requestPort(): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial?: Serial;
}
