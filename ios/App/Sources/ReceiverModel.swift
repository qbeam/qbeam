// Owns QBeamKit's Receiver on a serial queue and publishes UI state on the main thread.
import Foundation
import QBeamKit

@MainActor
final class ReceiverModel: ObservableObject {
    @Published var status = "Point the camera at the codes on the sending screen."
    @Published var progress: Double?
    @Published var hint: String?
    @Published var notice: String?
    @Published var needsPassphrase = false
    @Published var saved: URL?
    @Published var stats = ""
    @Published var counter: String?          // "5 of 10 free transfers used"
    @Published var paywall = false           // free transfers used up and not unlocked
    @Published var price: String?

    /// The trial switch: Info.plist QBeamTrial, from the QBEAM_TRIAL build setting (NO for betas).
    nonisolated static let trialEnabled = (Bundle.main.object(forInfoDictionaryKey: "QBeamTrial") as? String) == "YES"
    private nonisolated let trial = Trial(store: UserDefaults.standard, enabled: ReceiverModel.trialEnabled)
    private var purchases: Purchases?

    init() {
        publishTrial()
        guard trial.enabled else { return }
        let p = Purchases { [weak self] owned in
            guard let self else { return }
            self.trial.setPurchased(owned)
            self.publishTrial()
        }
        purchases = p
        Task { await p.start(); self.price = p.price }
    }

    private nonisolated func publishTrial() {
        let counter = trial.counterText(), paywall = !trial.canStart(sessionInProgress: false)
        Task { @MainActor in self.counter = counter; self.paywall = paywall }
    }

    func buy() { Task { if let m = await purchases?.buy() { notice = m } } }
    func restore() { Task { await purchases?.restore() } }

    private nonisolated let work = DispatchQueue(label: "qbeam.receiver")
    private nonisolated(unsafe) let receiver = Receiver()
    private nonisolated(unsafe) var pending: Receiver.Session?
    private nonisolated(unsafe) var lastUI = Date.distantPast

    nonisolated func onStats(_ s: CameraScanner.Stats) {
        let text = s.summary
        Task { @MainActor in self.stats = text }
    }

    nonisolated func onCodes(_ codes: [[UInt8]]) {
        work.async { [self] in
            // Free transfers used up: don't start a new one (a transfer already under way always finishes).
            let current = receiver.session
            guard trial.canStart(sessionInProgress: current.map { !$0.finished && $0.progress > 0 } ?? false) else { return }
            var complete: Receiver.Session?
            var notice: String?
            for c in codes {
                switch receiver.onCode(c) {
                case .complete(let session): complete = session
                case .notice(let m): notice = m
                default: break
                }
            }
            let now = Date()
            guard complete != nil || now.timeIntervalSince(lastUI) > 0.25 else { return }  // ~4 UI updates a second
            lastUI = now
            let session = receiver.session, rate = receiver.catchRate()
            let elapsed = session.map { now.timeIntervalSince1970 - $0.started } ?? 0
            let progress = session?.progress ?? 0, L = session?.L ?? 0, encrypted = session?.encrypted ?? false
            let active = session.map { !$0.finished } ?? false
            Task { @MainActor in
                if let notice, progress == 0 { self.notice = notice }
                guard active, self.saved == nil, !self.needsPassphrase else { return }
                self.progress = progress
                var text = "Receiving \(Self.size(L))\(encrypted ? " (encrypted)" : ""): \(Int(progress * 100))%"
                if elapsed > 0.5, progress > 0 {
                    let bps = Double(L) * progress / elapsed
                    text += " · \(Self.size(Int(bps)))/s · about \(Int(Double(L) * (1 - progress) / bps)) s left"
                }
                self.status = text
                self.hint = rate.map { $0 < 0.5 } == true
                    ? "Catching only \(Int(rate! * 100))% of the codes. Move closer so the codes fill the view, hold still and avoid glare. If it stays low, switch the sender to “safe” speed."
                    : nil
                if progress > 0 { self.notice = nil }
            }
            if let complete { finish(complete, passphrase: nil) }
        }
    }

    func submitPassphrase(_ pass: String) { work.async { [self] in if let p = pending { finish(p, passphrase: pass) } } }

    func reset() {
        work.async { [self] in receiver.reset(); pending = nil }
        saved = nil; progress = nil; hint = nil; notice = nil; needsPassphrase = false
        status = "Ready for the next file. Point the camera at the sender."
    }

    private nonisolated func finish(_ s: Receiver.Session, passphrase: String?) {
        do {
            let file = try receiver.finish(s, passphrase: passphrase)
            let url = try Self.store(file)
            trial.onSaved()
            publishTrial()
            pending = nil
            // From the first code to the last needed one (not passphrase typing), counting the bytes on screen.
            let sec = (s.completedAt ?? Date().timeIntervalSince1970) - s.started
            let took = sec < 0.5 ? "" : " in \(Int(sec)) s at \(Self.size(Int(Double(s.L) / sec)))/s"
            Task { @MainActor in
                self.needsPassphrase = false; self.hint = nil; self.progress = 1
                self.saved = url
                self.status = "Saved \(url.lastPathComponent) (\(Self.size(file.bytes.count)))\(took). Find it in Files › On My iPhone › qbeam."
            }
        } catch QBeamError.envelope("passphrase") {
            pending = s
            Task { @MainActor in self.needsPassphrase = true; self.status = "Encrypted file received. Enter the passphrase shown in the sender's terminal." }
        } catch QBeamError.envelope("auth") {
            pending = s
            Task { @MainActor in self.needsPassphrase = true; self.status = "Wrong passphrase (or the transfer was damaged). Try again." }
        } catch QBeamError.container("checksum") {
            Task { @MainActor in self.notice = "Checksum mismatch: a code was misread. Keep the camera on the sender to receive it again."; self.progress = nil }
        } catch QBeamError.container("too-large") {
            Task { @MainActor in self.notice = "The file expands to more than 1 GB; refusing to unpack it."; self.progress = nil }
        } catch {
            Task { @MainActor in self.notice = "Could not save: \(error)" }
        }
    }

    /// Writes into Documents (visible in the Files app), never overwriting an existing file.
    nonisolated static func store(_ file: Receiver.Saved) throws -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let (base, ext) = splitExtension(file.filename)
        var url = docs.appendingPathComponent(file.filename), n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = docs.appendingPathComponent("\(base) \(n)\(ext)"); n += 1   // "logs 2.tar.gz", like Finder
        }
        try Data(file.bytes).write(to: url, options: .atomic)
        return url
    }

    /// "logs.tar.gz" → ("logs", ".tar.gz"); "notes" → ("notes", ""). Compound archive extensions stay together.
    nonisolated static func splitExtension(_ name: String) -> (String, String) {
        let lower = name.lowercased()
        for compound in [".tar.gz", ".tar.xz", ".tar.bz2", ".tar.zst"] where lower.hasSuffix(compound) && lower.count > compound.count {
            return (String(name.dropLast(compound.count)), String(name.suffix(compound.count)))
        }
        let ext = (name as NSString).pathExtension
        return ext.isEmpty ? (name, "") : ((name as NSString).deletingPathExtension, "." + ext)
    }

    nonisolated static func size(_ b: Int) -> String {
        b >= 1 << 20 ? String(format: "%.1f MB", Double(b) / 1_048_576) : "\(max(1, b / 1024)) KB"
    }
}
