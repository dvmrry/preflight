// zlib inflate for PNG profiles and pixel data. Node uses its native zlib; the browser build swaps this module for
// inflate.browser.ts (pure JS), see tools/web/build.ts.
export { inflateSync } from "node:zlib";
