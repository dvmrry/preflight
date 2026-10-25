// Renders an HTML file with the system WebKit to OUTBASE.pdf/.png. Usage: swift tools/render.swift PAGE.html OUTBASE [WIDTH] [MAX_HEIGHT] [light|dark]
import WebKit
let W = Double(CommandLine.arguments[3]) ?? 1200
import AppKit
class D: NSObject, WKNavigationDelegate {
  let w = WKWebView(frame: NSRect(x: 0, y: 0, width: W, height: 800))
  func run() { if CommandLine.arguments.count > 5 { w.appearance = NSAppearance(named: CommandLine.arguments[5] == "dark" ? .darkAqua : .aqua) }
    w.navigationDelegate = self; w.loadFileURL(URL(fileURLWithPath: CommandLine.arguments[1]), allowingReadAccessTo: URL(fileURLWithPath: "/")) }
  func webView(_ v: WKWebView, didFinish n: WKNavigation!) {
    v.evaluateJavaScript("document.documentElement.scrollHeight") { h, _ in
      let H = min((h as? Double) ?? 2000, Double(CommandLine.arguments[4]) ?? 1e9)
      v.frame = NSRect(x: 0, y: 0, width: W, height: H)
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        let pc = WKPDFConfiguration(); pc.rect = NSRect(x: 0, y: 0, width: W, height: H)
        v.createPDF(configuration: pc) { r in
          if case .success(let d) = r { try? d.write(to: URL(fileURLWithPath: CommandLine.arguments[2] + ".pdf")) }
          let sc = WKSnapshotConfiguration(); sc.rect = NSRect(x: 0, y: 0, width: W, height: H)
          v.takeSnapshot(with: sc) { img, _ in
            if let img = img, let t = img.tiffRepresentation, let b = NSBitmapImageRep(data: t), let p = b.representation(using: .png, properties: [:]) {
              try? p.write(to: URL(fileURLWithPath: CommandLine.arguments[2] + ".png")) }
            exit(0) } } } } }
}
let app = NSApplication.shared; let d = D(); d.run(); app.run()
