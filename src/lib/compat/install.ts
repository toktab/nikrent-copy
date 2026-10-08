import { installPdfJsCompat } from './browser';

/**
 * Side-effect module: importing it fills in the browser features pdf.js
 * assumes. It exists so the pdf.js worker entry can put the fix in place
 * simply by listing it first - module bodies run in import order, so a bare
 * `import './install'` above the worker import is enough.
 */
installPdfJsCompat();
