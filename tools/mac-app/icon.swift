// Draws the Preflight app icon (1024 px master + iconset sizes): an indigo-to-violet rounded square with a white
// check-seal symbol. Usage: swift icon.swift OUT.iconset
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
  let s = CGFloat(px)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let inset = s * 0.1, rect = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
  let path = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
  NSGradient(colors: [NSColor(srgbRed: 0.23, green: 0.36, blue: 0.86, alpha: 1), NSColor(srgbRed: 0.48, green: 0.18, blue: 0.97, alpha: 1)])!
    .draw(in: path, angle: -60)
  let cfg = NSImage.SymbolConfiguration(pointSize: s * 0.42, weight: .semibold).applying(.init(paletteColors: [.white]))
  if let sym = NSImage(systemSymbolName: "checkmark.seal.fill", accessibilityDescription: nil)?.withSymbolConfiguration(cfg) {
    let sz = sym.size
    sym.draw(in: NSRect(x: (s - sz.width) / 2, y: (s - sz.height) / 2, width: sz.width, height: sz.height))
  }
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
  try render(base).write(to: out.appendingPathComponent("icon_\(base)x\(base).png"))
  try render(base * 2).write(to: out.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
