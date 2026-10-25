// Parsers read through this, so a file is read by position: a JPEG costs its header segments and its last 4 KB, a PNG
// its chunk headers (pixel data only when transparency has to be counted).
export interface Reader { size: number; read(off: number, len: number): Buffer } // short read at end of data

export const bufferReader = (b: Buffer): Reader => ({ size: b.length, read: (o, l) => b.subarray(o, Math.min(b.length, o + l)) });
