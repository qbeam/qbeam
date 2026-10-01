// Camera → zxing-cpp → raw QR bytes. CameraX delivers YUV frames; zxing-cpp reads the luma plane natively (no colour
// conversion). Frames are decoded on a small pool of workers, each with its own reader: one thread at ~25 ms a frame
// can't keep up with 60 fps. When every worker is busy the frame is dropped, so the camera never waits on us.
package dev.qbeam.app

import android.annotation.SuppressLint
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import zxingcpp.BarcodeReader

class Scanner(private val onCodes: (List<ByteArray>) -> Unit, private val onStats: (Stats) -> Unit) {
    /** Per-second summary; also logged under the "qbeam" tag (`adb logcat -s qbeam`). */
    data class Stats(
        var width: Int = 0, var height: Int = 0, var fpsRange: String = "",
        var framesIn: Int = 0, var decoded: Int = 0, var dropped: Int = 0, var codes: Int = 0, var decodeMs: Long = 0,
    ) {
        val summary: String
            get() {
                val n = maxOf(decoded, 1)
                return "$width×$height · $framesIn fps in · $decoded decoded/s · $dropped dropped · " +
                    "%.1f codes/frame · %d ms".format(codes.toDouble() / n, decodeMs / n)
            }
    }

    private class Worker(i: Int) {
        val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "qbeam-decode-$i") }
        val busy = AtomicBoolean(false)
        val reader = BarcodeReader().apply {
            options.formats = setOf(BarcodeReader.Format.QR_CODE)
            options.tryHarder = true        // lifted code recovery from 77% to 93% at no extra cost in the web spike
            options.tryRotate = false
            options.tryInvert = false
            options.tryDownscale = false
            options.maxNumberOfSymbols = 16
        }
    }

    private val workers = List(maxOf(2, minOf(4, Runtime.getRuntime().availableProcessors() - 2))) { Worker(it) }
    private val dispatch = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private var stats = Stats()
    private var windowStart = SystemClock.elapsedRealtime()
    private var fpsRange = ""

    @OptIn(ExperimentalCamera2Interop::class)
    @SuppressLint("UnsafeOptInUsageError")
    fun bind(owner: LifecycleOwner, previewView: PreviewView) {
        val context = previewView.context
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            // 16:9 1080p: without the aspect ratio CameraX picks 1920×1440 on some phones (a third more pixels to decode).
            val resolution = ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                .build()
            // A fixed 60 fps range when the camera offers one: with (30, 60) phones settle at 30 (bench/RESULTS.md:
            // at 60 fps each sender frame gets two chances to be read).
            val range = bestFpsRange(provider)
            fpsRange = "${range.lower}–${range.upper}"
            val previewBuilder = Preview.Builder().setResolutionSelector(resolution)
            Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
            val preview = previewBuilder.build().also { it.surfaceProvider = previewView.surfaceProvider }
            // Block-producer with a queue lets several frames be held at once (one per busy worker).
            val analysisBuilder = ImageAnalysis.Builder()
                .setResolutionSelector(resolution)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_BLOCK_PRODUCER)
                .setImageQueueDepth(workers.size + 2)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            Camera2Interop.Extender(analysisBuilder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, range)
            val analysis = analysisBuilder.build().also { it.setAnalyzer(dispatch, ::onFrame) }
            provider.unbindAll()
            provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(context))
    }

    @OptIn(ExperimentalCamera2Interop::class)
    private fun bestFpsRange(provider: ProcessCameraProvider): Range<Int> {
        val info = CameraSelector.DEFAULT_BACK_CAMERA.filter(provider.availableCameraInfos).firstOrNull()
        val ranges = info?.let {
            Camera2CameraInfo.from(it).getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        }.orEmpty().also { Log.i("qbeam", "camera fps ranges: ${it.joinToString()}") }.filter { it.upper <= 60 }
        return ranges.filter { it.lower == it.upper }.maxByOrNull { it.upper }?.takeIf { it.upper >= 60 }
            ?: ranges.maxWithOrNull(compareBy({ it.upper }, { it.lower }))
            ?: Range(30, 60)
    }

    private fun onFrame(image: ImageProxy) {
        val worker = workers.firstOrNull { it.busy.compareAndSet(false, true) }
        synchronized(lock) {
            stats.framesIn++
            stats.width = image.width; stats.height = image.height
            if (worker == null) stats.dropped++
        }
        flushStatsIfDue()
        if (worker == null) { image.close(); return }
        worker.executor.execute {
            val t0 = SystemClock.elapsedRealtime()
            val codes = try {
                worker.reader.read(image).filter { it.error == null }.mapNotNull { it.bytes }
            } catch (e: Exception) {
                emptyList()
            } finally {
                image.close()
            }
            val ms = SystemClock.elapsedRealtime() - t0
            worker.busy.set(false)
            synchronized(lock) { stats.decoded++; stats.codes += codes.size; stats.decodeMs += ms }
            if (codes.isNotEmpty()) onCodes(codes)
        }
    }

    private fun flushStatsIfDue() {
        val now = SystemClock.elapsedRealtime()
        val s = synchronized(lock) {
            if (now - windowStart < 1000) return
            windowStart = now
            stats.also { it.fpsRange = fpsRange; stats = Stats() }
        }
        onStats(s)
        Log.i("qbeam", "fps ${s.fpsRange} workers ${workers.size} · ${s.summary}")
    }

    fun shutdown() {
        dispatch.shutdown()
        workers.forEach { it.executor.shutdown() }
    }
}
