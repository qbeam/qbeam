// qbeam receiver for iOS: camera preview, live progress, passphrase prompt, save to Files.
import AVFoundation
import SwiftUI

@main
struct QBeamApp: App {
    var body: some Scene { WindowGroup { ContentView().preferredColorScheme(.dark) } }
}

struct ContentView: View {
    @StateObject private var model = ReceiverModel()
    @State private var scanner: CameraScanner?
    @State private var cameraError: String?
    @State private var passphrase = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("qbeam").font(.title2)
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(.black)
                    if let scanner { CameraPreview(session: scanner.session).clipShape(RoundedRectangle(cornerRadius: 12)) }
                    if let cameraError { Text(cameraError).foregroundStyle(.secondary).padding() }
                }
                .aspectRatio(3 / 4, contentMode: .fit)
                Text(model.status)
                if let p = model.progress { ProgressView(value: p) }
                if let hint = model.hint { Banner(text: hint, bg: Color(red: 0.24, green: 0.2, blue: 0.06), fg: Color(red: 1, green: 0.88, blue: 0.54)) }
                if let notice = model.notice { Banner(text: notice, bg: Color(red: 0.29, green: 0.08, blue: 0.08), fg: Color(red: 1, green: 0.7, blue: 0.7)) }
                if model.needsPassphrase {
                    SecureField("Passphrase", text: $passphrase).textFieldStyle(.roundedBorder)
                    Button("Decrypt") { model.submitPassphrase(passphrase) }.buttonStyle(.borderedProminent)
                }
                if let url = model.saved {
                    HStack {
                        ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent)
                        Button("Next file") { passphrase = ""; model.reset() }.buttonStyle(.bordered)
                    }
                }
                Text(model.stats).font(.caption2).foregroundStyle(.secondary)
            }
            .padding()
        }
        .task { await startCamera() }
    }

    private func startCamera() async {
        guard scanner == nil else { return }
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            cameraError = "Camera access is off. Turn it on in Settings › qbeam to receive files."
            return
        }
        let s = CameraScanner(onCodes: model.onCodes)
        if let err = s.start() { cameraError = err } else { scanner = s }
    }
}

struct Banner: View {
    let text: String, bg: Color, fg: Color
    var body: some View {
        Text(text).font(.footnote).foregroundStyle(fg).padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(bg, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
