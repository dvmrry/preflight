// ICC profile: colour space from the header, human name from the 'desc' tag (v2 'desc' or v4 'mluc' encoding).
export interface IccFacts { iccProfile?: string; iccColorSpace?: string }

export function iccFacts(p: Buffer): IccFacts {
  const out: IccFacts = {};
  if (p.length < 132) return out;
  out.iccColorSpace = p.toString("latin1", 16, 20).trim();
  const count = Math.min(p.readUInt32BE(128), Math.floor((p.length - 132) / 12)); // never trust the count
  for (let i = 0; i < count; i++) {
    const e = 132 + i * 12;
    if (p.toString("latin1", e, e + 4) !== "desc") continue;
    const at = p.readUInt32BE(e + 4);
    const type = p.toString("latin1", at, at + 4);
    if (type === "desc" && at + 12 <= p.length) {
      const n = p.readUInt32BE(at + 8);
      out.iccProfile = p.toString("latin1", at + 12, Math.min(p.length, at + 12 + n)).replace(/\0+$/, "");
    } else if (type === "mluc" && at + 28 <= p.length) {
      const len = p.readUInt32BE(at + 20), rel = p.readUInt32BE(at + 24);
      const s = Buffer.from(p.subarray(at + rel, Math.min(p.length, at + rel + len)));
      out.iccProfile = s.subarray(0, s.length & ~1).swap16().toString("utf16le").replace(/\0+$/, "");
    }
    break;
  }
  if (out.iccProfile === "") delete out.iccProfile;
  return out;
}
