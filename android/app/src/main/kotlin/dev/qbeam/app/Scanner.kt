// Camera → zxing-cpp → raw QR bytes. CameraX delivers YUV frames; zxing-cpp reads the luma plane natively (no colour
// conversion), which is what makes the app faster than the web receiver's WASM decoder.
package dev.qbeam.app

import android.annotation.SuppressLint
import android.hardware.camera2.CaptureRequest
import android.os.SystemClock
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors
import zxingcpp.BarcodeReader

class Scanner(private val onCodes: (List<ByteArray>, Stats) -> Unit) {
    data class Stats(val width: Int, val height: Int, val decodeMs: Long, val frameIntervalMs: Long)

    private val executor = Executors.newSingleThreadExecutor()
    private val reader = BarcodeReader().apply {
        options.formats = setOf(BarcodeReader.Format.QR_CODE)
        options.tryHarder = true        // lifted code recovery from 77% to 93% at no extra cost in the web spike
        options.tryRotate = false
        options.tryInvert = false
        options.tryDownscale = false
        options.maxNumberOfSymbols = 16
    }
    private var lastFrame = 0L

    @OptIn(ExperimentalCamera2Interop::class)
    @SuppressLint("UnsafeOptInUsageError")
    fun bind(owner: LifecycleOwner, previewView: PreviewView) {
        val context = previewView.context
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            val resolution = ResolutionSelector.Builder()
                .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                .build()
            val preview = Preview.Builder().setResolutionSelector(resolution).build()
                .also { it.surfaceProvider = previewView.surfaceProvider }
            val analysisBuilder = ImageAnalysis.Builder()
                .setResolutionSelector(resolution)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            // Up to 60 fps: each sender frame then gets two chances to be read (bench/RESULTS.md).
            Camera2Interop.Extender(analysisBuilder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(30, 60))
            val analysis = analysisBuilder.build().also { a ->
                a.setAnalyzer(executor) { image ->
                    val t0 = SystemClock.elapsedRealtime()
                    val results = try { reader.read(image) } catch (e: Exception) { emptyList() }
                    val t1 = SystemClock.elapsedRealtime()
                    val stats = Stats(image.width, image.height, t1 - t0, if (lastFrame == 0L) 0 else t0 - lastFrame)
                    lastFrame = t0
                    image.close()
                    onCodes(results.filter { it.error == null }.map { it.bytes }.filterNotNull(), stats)
                }
            }
            provider.unbindAll()
            provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(context))
    }

    fun shutdown() = executor.shutdown()
}
