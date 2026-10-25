// Preflight — a small Mac window around the checker: drop exports (files, folders, Figma JSON), the right guidelines are
// picked, and the report appears in the window. Native toolbar and Liquid Glass surfaces (macOS 26+). The checker is a
// standalone binary inside the bundle. Build: tools/mac-app/build.sh
import SwiftUI
import WebKit
import UniformTypeIdentifiers

// Files opened from Finder ("Open With", or dropped on the Dock icon) arrive here.
final class AppDelegate: NSObject, NSApplicationDelegate {
  func application(_ app: NSApplication, open urls: [URL]) { Model.shared.check(urls) }
}

@main
struct PreflightApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
  @ObservedObject var m = Model.shared
  var body: some Scene {
    // One window: Finder open events go to it (a WindowGroup would open a new window per event).
    Window("Preflight", id: "main") { ContentView().frame(minWidth: 900, minHeight: 620) }
      .defaultSize(width: 1280, height: 880)
      .commands {
        CommandGroup(replacing: .newItem) {
          Button("New Check") { m.reset() }.keyboardShortcut("n")
          Button("Open…") { m.choose() }.keyboardShortcut("o")
          Menu("Open Recent") {
            ForEach(m.recents, id: \.self) { set in Button(Model.label(set)) { m.check(set) } }
            if m.recents.isEmpty { Text("No recent checks") }
          }
        }
        CommandGroup(after: .newItem) {
          Button("Check Again") { m.run() }.keyboardShortcut("r").disabled(m.dropped.isEmpty)
          Button("Save Report…") { m.save() }.keyboardShortcut("s").disabled(m.reportURL == nil)
        }
      }
  }
}

enum Phase: Equatable { case empty, running, done(URL), failed(String) }

struct Summary: Equatable { var assets = 0, passed = 0, errors = 0, warnings = 0, infos = 0 }

final class Model: ObservableObject {
  static let shared = Model()
  @Published var phase: Phase = .empty
  @Published var guidelines: [URL] = []
  @Published var brands: [URL] = []
  @Published var selected: URL?
  @Published var brand: URL?
  @Published var dropped: [URL] = []
  @Published var summary = Summary()
  @Published var recents: [[URL]] = []

  let res = Bundle.main.resourceURL!
  var reportURL: URL? { if case .done(let u) = phase { return u }; return nil }

  init() {
    let files = (try? FileManager.default.contentsOfDirectory(at: res, includingPropertiesForKeys: nil)) ?? []
    guidelines = files.filter { $0.lastPathComponent.hasPrefix("guidelines-") && ["json", "jsonc"].contains($0.pathExtension) }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    brands = files.filter { $0.lastPathComponent.hasPrefix("brand-") && $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    selected = guidelines.first
    let d = UserDefaults.standard
    brand = d.string(forKey: "brand").flatMap { name in brands.first { Model.name($0) == name } }
    recents = ((d.array(forKey: "recents") as? [[String]]) ?? []).map { $0.map { URL(fileURLWithPath: $0) } }
    // For scripted runs: PREFLIGHT_OPEN (newline-separated paths) and PREFLIGHT_GUIDELINES (a set's name).
    let env = ProcessInfo.processInfo.environment
    if let want = env["PREFLIGHT_GUIDELINES"] { selected = guidelines.first { Model.name($0) == want } ?? selected }
    if let open = env["PREFLIGHT_OPEN"] {
      let urls = open.split(separator: "\n").map { URL(fileURLWithPath: String($0)) }.filter { FileManager.default.fileExists(atPath: $0.path) }
      if !urls.isEmpty { DispatchQueue.main.async { self.check(urls, autoPick: env["PREFLIGHT_GUIDELINES"] == nil) } }
    }
  }

  static func name(_ u: URL) -> String {
    u.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "guidelines-", with: "").replacingOccurrences(of: "brand-", with: "")
  }
  static func label(_ set: [URL]) -> String {
    set.count == 1 ? set[0].lastPathComponent : "\(set[0].lastPathComponent) + \(set.count - 1) more"
  }

  func setBrand(_ b: URL?) {
    brand = b
    UserDefaults.standard.set(b.map(Model.name), forKey: "brand")
    if !dropped.isEmpty { run() }
  }

  func reset() { phase = .empty; dropped = [] }

  // New files: pick the guidelines that recognise the most of them (names only, nothing measured), then check.
  func check(_ urls: [URL], autoPick: Bool = true) {
    dropped = urls
    remember(urls)
    guard autoPick else { run(); return }
    phase = .running
    let p = Process()
    p.executableURL = res.appendingPathComponent("preflight")
    p.arguments = ["match"] + guidelines.flatMap { ["-g", $0.path] } + urls.map(\.path)
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = Pipe()
    p.terminationHandler = { _ in
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      DispatchQueue.main.async {
        if let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]], let best = rows.first,
           (best["matched"] as? Int ?? 0) > 0, let path = best["guidelines"] as? String {
          self.selected = self.guidelines.first { $0.path == path } ?? self.selected
        }
        self.run()
      }
    }
    do { try p.run() } catch { run() }
  }

  func run() {
    guard let g = selected, !dropped.isEmpty else { return }
    phase = .running
    let out = FileManager.default.temporaryDirectory.appendingPathComponent("preflight-\(UUID().uuidString.prefix(8)).html")
    var args = ["check", "-g", g.path, "--compact", "--html", out.path]
    if let b = brand { args += ["--brand", b.path] }
    args += dropped.map(\.path)
    let p = Process()
    p.executableURL = res.appendingPathComponent("preflight")
    p.arguments = args
    // Apps started from Finder get a bare PATH; video checks need ffprobe/ffmpeg from the usual install places.
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = ["/opt/homebrew/bin", "/usr/local/bin", "/etc/profiles/per-user/\(NSUserName())/bin", "/run/current-system/sw/bin", env["PATH"] ?? "/usr/bin:/bin"].joined(separator: ":")
    p.environment = env
    let pipe = Pipe(), err = Pipe()
    p.standardOutput = pipe; p.standardError = err
    p.terminationHandler = { proc in
      let json = pipe.fileHandleForReading.readDataToEndOfFile()
      let msg = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      DispatchQueue.main.async {
        guard FileManager.default.fileExists(atPath: out.path) else {
          self.phase = .failed(msg.isEmpty ? "The checker stopped (exit \(proc.terminationStatus))." : msg); return
        }
        if let o = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let s = o["summary"] as? [String: Int] {
          self.summary = Summary(assets: s["assets"] ?? 0, passed: s["passed"] ?? 0, errors: s["errors"] ?? 0, warnings: s["warnings"] ?? 0, infos: s["infos"] ?? 0)
        }
        self.phase = .done(out)
      }
    }
    do { try p.run() } catch { phase = .failed(error.localizedDescription) }
  }

  func remember(_ urls: [URL]) {
    recents.removeAll { $0 == urls }
    recents.insert(urls, at: 0)
    recents = Array(recents.prefix(6))
    UserDefaults.standard.set(recents.map { $0.map(\.path) }, forKey: "recents")
  }

  func choose() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true; panel.allowsMultipleSelection = true
    panel.message = "Choose exports, folders or Figma JSON to check"
    if panel.runModal() == .OK { check(panel.urls) }
  }

  func save() {
    guard let url = reportURL else { return }
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "preflight-report.html"
    panel.allowedContentTypes = [.html]
    if panel.runModal() == .OK, let dest = panel.url {
      try? FileManager.default.removeItem(at: dest)
      try? FileManager.default.copyItem(at: url, to: dest)
    }
  }
}

struct ContentView: View {
  @ObservedObject var m = Model.shared
  @State var hovering = false

  var body: some View {
    ZStack {
      switch m.phase {
      case .empty: EmptyState(hovering: hovering)
      case .running:
        ProgressView { Text("Checking \(m.dropped.count) item\(m.dropped.count == 1 ? "" : "s")…") }
          .controlSize(.large).padding(28).glassEffect(.regular, in: .rect(cornerRadius: 24))
      case .done(let url):
        ReportView(url: url).ignoresSafeArea(edges: .bottom)
        VStack { Spacer(); SummaryBar(s: m.summary).padding(.bottom, 18) }
      case .failed(let msg):
        VStack(spacing: 14) {
          Image(systemName: "exclamationmark.triangle").font(.system(size: 40)).foregroundStyle(.orange)
          Text("Couldn't check those files").font(.title2.bold())
          Text(msg).font(.callout.monospaced()).textSelection(.enabled).multilineTextAlignment(.center)
          Button("Start Over") { m.reset() }.buttonStyle(.glass)
        }.padding(32).glassEffect(.regular, in: .rect(cornerRadius: 24)).padding(40)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .onDrop(of: [.fileURL], isTargeted: $hovering) { providers in
      var urls: [URL] = []
      let group = DispatchGroup()
      for p in providers {
        group.enter()
        _ = p.loadObject(ofClass: URL.self) { u, _ in if let u { urls.append(u) }; group.leave() }
      }
      group.notify(queue: .main) { m.check(urls) }
      return true
    }
    .navigationTitle("Preflight")
    .navigationSubtitle(subtitle)
    .toolbar { toolbar }
  }

  var subtitle: String {
    if case .done = m.phase { return "\(Model.label(m.dropped)) · \(m.selected.map(Model.name) ?? "")" }
    return m.selected.map { "Guidelines: \(Model.name($0))" } ?? ""
  }

  @ToolbarContentBuilder var toolbar: some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      Picker(selection: Binding(get: { m.selected }, set: { m.selected = $0; if !m.dropped.isEmpty { m.run() } })) {
        ForEach(m.guidelines, id: \.self) { Text(Model.name($0)).tag(Optional($0)) }
      } label: { Label("Guidelines", systemImage: "checklist") }
      .help("Guidelines to check against (picked automatically on drop)")
    }
    ToolbarItem(placement: .navigation) {
      Picker(selection: Binding(get: { m.brand }, set: { m.setBrand($0) })) {
        Text("Neutral").tag(URL?.none)
        ForEach(m.brands, id: \.self) { Text(Model.name($0).capitalized).tag(Optional($0)) }
      } label: { Label("Brand", systemImage: "paintpalette") }
      .help("Brand profile for the report's look")
    }
    ToolbarItemGroup(placement: .primaryAction) {
      Button { m.choose() } label: { Label("Open", systemImage: "plus") }.help("Choose files to check (⌘O)")
      Button { m.run() } label: { Label("Check Again", systemImage: "arrow.clockwise") }.help("Check again (⌘R)").disabled(m.dropped.isEmpty)
      if let url = m.reportURL {
        ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }.help("Share the report page")
        Button { NSWorkspace.shared.open(url) } label: { Label("Open in Browser", systemImage: "safari") }.help("Open the report in your browser")
      }
    }
  }
}

struct EmptyState: View {
  @ObservedObject var m = Model.shared
  let hovering: Bool
  var body: some View {
    GlassEffectContainer(spacing: 18) {
      VStack(spacing: 18) {
        VStack(spacing: 12) {
          Image(systemName: hovering ? "tray.and.arrow.down.fill" : "checkmark.seal")
            .font(.system(size: 52, weight: .light)).foregroundStyle(.tint).contentTransition(.symbolEffect(.replace))
          Text("Drop exports to preflight").font(.system(size: 26, weight: .bold))
          Text("Images, video, audio, whole folders, or a Figma file exported as JSON.\nThe matching guidelines are picked for you; the report appears here.")
            .multilineTextAlignment(.center).foregroundStyle(.secondary)
          Button { m.choose() } label: { Label("Choose Files…", systemImage: "folder") }
            .buttonStyle(.glassProminent).controlSize(.large).keyboardShortcut("o")
        }
        .padding(.horizontal, 44).padding(.vertical, 34)
        .glassEffect(hovering ? .regular.tint(.accentColor.opacity(0.25)).interactive() : .regular.interactive(), in: .rect(cornerRadius: 28))
        if !m.recents.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            Text("Recent").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.leading, 6)
            HStack(spacing: 8) {
              ForEach(m.recents.prefix(4), id: \.self) { set in
                Button { m.check(set) } label: { (Text(Image(systemName: "clock.arrow.circlepath")) + Text("  " + Model.label(set))).lineLimit(1) }
                  .buttonStyle(.glass)
              }
            }
          }
        }
      }
    }
    .frame(maxWidth: 760).padding(40)
    .animation(.smooth, value: hovering)
  }
}

struct SummaryBar: View {
  let s: Summary
  var body: some View {
    GlassEffectContainer(spacing: 10) {
      HStack(spacing: 10) {
        chip("\(s.passed)", "ready", "checkmark.circle.fill", .green)
        chip("\(s.errors)", "blocking", "xmark.octagon.fill", .red)
        chip("\(s.warnings)", "fix if quick", "exclamationmark.triangle.fill", .orange)
        chip("\(s.infos)", "human look", "eye.fill", .purple)
      }
    }
  }
  // One Text per chip (symbol + number + label), so everything sits on a single baseline.
  func chip(_ n: String, _ label: String, _ icon: String, _ color: Color) -> some View {
    (Text(Image(systemName: icon)).foregroundStyle(color)
      + Text("  \(n)").font(.body.weight(.semibold).monospacedDigit())
      + Text("  \(label)").foregroundStyle(.secondary))
      .font(.body)
      .lineLimit(1).fixedSize()
      .padding(.horizontal, 14).padding(.vertical, 8)
      .glassEffect(.regular, in: .capsule)
  }
}

struct ReportView: NSViewRepresentable {
  let url: URL
  func makeNSView(context: Context) -> WKWebView {
    let w = WKWebView()
    w.setValue(false, forKey: "drawsBackground")
    w.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    return w
  }
  func updateNSView(_ w: WKWebView, context: Context) {
    if w.url != url { w.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent()) }
  }
}
