/**
 * The pdf.js worker, with the byte-array methods installed first.
 *
 * pdf.js reads a document's fingerprint through `Uint8Array.prototype.toHex`
 * inside its worker, so the fix has to be in the worker's own global scope -
 * patching the page it was started from does nothing. This file is therefore
 * the worker that gets loaded instead of `pdf.worker.mjs`, and it does exactly
 * two things in exactly this order.
 *
 * The order is load-bearing and invisible: module bodies run in the order
 * their imports are listed, so the install below really does happen before
 * pdf.js evaluates. Swapping these two lines would restore the bug.
 */
import './install';
import 'pdfjs-dist/build/pdf.worker.mjs';
