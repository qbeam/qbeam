// Camera → Vision → QR bytes. AVFoundation at 1080p and up to 60 fps; Vision finds QR codes; their binary content is
// read from the error-corrected codewords (QRPayload), since Vision's string payload can't carry binary data.
import AVFoundation
import CoreImage
import QBeamKit
import Vision

final class CameraScanner: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    struct Stats { let width: Int; let height: Int; let decodeMs: Int; let fps: Int }

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "qbeam.camera")
    private let onCodes: ([[UInt8]], Stats) -> Void
    private var lastFrame = CFAbsoluteTimeGetCurrent()
    private lazy var request: VNDetectBarcodesRequest = {
        let r = VNDetectBarcodesRequest()
        r.symbologies = [.qr]
        return r
    }()

    init(onCodes: @escaping ([[UInt8]], Stats) -> Void) {
        self.onCodes = onCodes
    }

    /// Configures and starts the back camera; returns an error message when there's no usable camera (e.g. Simulator).
    func start() -> String? {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            return "No camera available on this device."
        }
        do {
            try device.lockForConfiguration()
            // Prefer a 1080p format that can run at 60 fps: each sender frame then gets two chances to be read.
            let formats = device.formats.filter {
                let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
                return d.width == 1920 && d.height == 1080
            }
            if let best = formats.max(by: { a, b in
                (a.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0) < (b.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0)
            }) {
                device.activeFormat = best
                let fps = min(60, best.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30)
                device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
                device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: CMTimeScale(min(fps, 30)))
            }
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            device.unlockForConfiguration()

            session.beginConfiguration()
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) { session.addInput(input) }
            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: queue)
            if session.canAddOutput(output) { session.addOutput(output) }
            session.commitConfiguration()
        } catch {
            return "Camera failed: \(error.localizedDescription)"
        }
        queue.async { self.session.startRunning() }
        return nil
    }

    func stop() { queue.async { self.session.stopRunning() } }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let t0 = CFAbsoluteTimeGetCurrent()
        try? VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up).perform([request])
        var codes: [[UInt8]] = []
        for obs in request.results ?? [] {
            guard let qr = obs.barcodeDescriptor as? CIQRCodeDescriptor,
                  let bytes = QRPayload.bytes(fromDataCodewords: qr.errorCorrectedPayload, version: qr.symbolVersion) else { continue }
            codes.append(bytes)
        }
        let stats = Stats(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels),
                          decodeMs: Int((CFAbsoluteTimeGetCurrent() - t0) * 1000),
                          fps: Int(1 / max(t0 - lastFrame, 0.001)))
        lastFrame = t0
        onCodes(codes, stats)
    }
}
