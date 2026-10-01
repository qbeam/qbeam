// Camera → Vision → QR bytes. AVFoundation at 1080p and up to 60 fps; each frame's luma plane is copied out (freeing the
// camera buffer at once) and decoded on a pool of workers, like the web receiver's zxing worker pool. QR binary content is
// read from the error-corrected codewords (QRPayload), since Vision's string payload can't carry binary data.
import AVFoundation
import CoreImage
import QBeamKit
import Vision

final class CameraScanner: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    /// Per-second summary, also appended to Library/Caches/scan-stats.log for pulling off the device.
    struct Stats {
        var width = 0, height = 0
        var framesIn = 0, decoded = 0, dropped = 0, observations = 0, codes = 0, decodeMs = 0.0
        var summary: String {
            let n = max(decoded, 1)
            return "\(width)×\(height) · \(framesIn) fps in · \(decoded) decoded/s · \(dropped) dropped · " +
                String(format: "%.1f codes/frame · %.0f ms", Double(codes) / Double(n), decodeMs / Double(n))
        }
    }

    private final class Worker {
        let queue: DispatchQueue
        let request: VNDetectBarcodesRequest
        var busy = false
        var buffer: CVPixelBuffer?
        init(_ i: Int) {
            queue = DispatchQueue(label: "qbeam.decode.\(i)", qos: .userInitiated)
            request = VNDetectBarcodesRequest()
            request.symbologies = [.qr]
        }
    }

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "qbeam.camera", qos: .userInitiated)
    private let onCodes: ([[UInt8]]) -> Void
    private let onStats: (Stats) -> Void
    private let workers: [Worker]
    private let lock = NSLock()
    private var stats = Stats()
    private var windowStart = CFAbsoluteTimeGetCurrent()
    private let logURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("scan-stats.log")

    init(workers: Int = max(2, min(4, ProcessInfo.processInfo.activeProcessorCount - 2)),
         onCodes: @escaping ([[UInt8]]) -> Void, onStats: @escaping (Stats) -> Void) {
        self.workers = (0..<workers).map(Worker.init)
        self.onCodes = onCodes
        self.onStats = onStats
        try? FileManager.default.removeItem(at: logURL)
        FileManager.default.createFile(atPath: logURL.path, contents: Data("workers \(workers)\n".utf8))
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
        lock.lock()
        stats.framesIn += 1
        stats.width = CVPixelBufferGetWidth(pixels); stats.height = CVPixelBufferGetHeight(pixels)
        let worker = workers.first { !$0.busy }
        if let worker { worker.busy = true } else { stats.dropped += 1 }
        lock.unlock()
        flushStatsIfDue()
        guard let worker, let luma = copyLuma(pixels, into: &worker.buffer) else {
            if let worker { lock.lock(); worker.busy = false; lock.unlock() }
            return
        }
        worker.queue.async { [self] in decode(luma, worker) }
    }

    private func decode(_ luma: CVPixelBuffer, _ w: Worker) {
        let t0 = CFAbsoluteTimeGetCurrent()
        try? VNImageRequestHandler(cvPixelBuffer: luma, orientation: .up).perform([w.request])
        let results = w.request.results ?? []
        var codes: [[UInt8]] = []
        for obs in results {
            guard let qr = obs.barcodeDescriptor as? CIQRCodeDescriptor,
                  let bytes = QRPayload.bytes(fromDataCodewords: qr.errorCorrectedPayload, version: qr.symbolVersion) else { continue }
            codes.append(bytes)
        }
        let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        lock.lock()
        w.busy = false
        stats.decoded += 1; stats.observations += results.count; stats.codes += codes.count; stats.decodeMs += ms
        lock.unlock()
        if !codes.isEmpty { onCodes(codes) }
    }

    /// Copies the Y plane into a reusable one-channel buffer so the camera's buffer goes back to its pool right away.
    private func copyLuma(_ src: CVPixelBuffer, into cache: inout CVPixelBuffer?) -> CVPixelBuffer? {
        let w = CVPixelBufferGetWidthOfPlane(src, 0), h = CVPixelBufferGetHeightOfPlane(src, 0)
        if cache.map({ CVPixelBufferGetWidth($0) != w || CVPixelBufferGetHeight($0) != h }) ?? true {
            var out: CVPixelBuffer?
            CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_OneComponent8,
                                [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &out)
            cache = out
        }
        guard let dst = cache else { return nil }
        CVPixelBufferLockBaseAddress(src, .readOnly); CVPixelBufferLockBaseAddress(dst, [])
        defer { CVPixelBufferUnlockBaseAddress(dst, []); CVPixelBufferUnlockBaseAddress(src, .readOnly) }
        guard let s = CVPixelBufferGetBaseAddressOfPlane(src, 0), let d = CVPixelBufferGetBaseAddress(dst) else { return nil }
        let sStride = CVPixelBufferGetBytesPerRowOfPlane(src, 0), dStride = CVPixelBufferGetBytesPerRow(dst)
        if sStride == dStride {
            memcpy(d, s, sStride * h)
        } else {
            for y in 0..<h { memcpy(d + y * dStride, s + y * sStride, w) }
        }
        return dst
    }

    private func flushStatsIfDue() {
        let now = CFAbsoluteTimeGetCurrent()
        lock.lock()
        guard now - windowStart >= 1 else { lock.unlock(); return }
        let s = stats
        stats = Stats(); windowStart = now
        lock.unlock()
        onStats(s)
        if s.decoded > 0, let h = try? FileHandle(forWritingTo: logURL) {
            h.seekToEndOfFile()
            h.write(Data(String(format: "%.0f in=%d dec=%d drop=%d obs=%d codes=%d ms=%.1f\n", now, s.framesIn, s.decoded,
                                s.dropped, s.observations, s.codes, s.decodeMs / Double(max(s.decoded, 1))).utf8))
            try? h.close()
        }
    }
}
