// qbeam receiver app: camera preview, live progress, passphrase prompt, save to Downloads/qbeam.
// Decoding runs off the main thread: Scanner (camera thread) → Receiver (its own thread) → UI state (main thread).
package dev.qbeam.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import dev.qbeam.core.QBeamException
import dev.qbeam.core.Receiver
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = darkColorScheme()) { ReceiverScreen() } }
    }
}

/** UI state, written only on the main thread. */
class UiState {
    var status by mutableStateOf("Point the camera at the codes on the sending screen.")
    var progress by mutableStateOf<Float?>(null)
    var hint by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var needsPassphrase by mutableStateOf(false)
    var saved by mutableStateOf<Pair<String, Uri>?>(null)
    var stats by mutableStateOf("")
}

/** Owns the Receiver on a single background thread and publishes UiState updates to the main thread. */
class Controller(private val context: Context, private val ui: UiState) {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val receiver = Receiver()
    private val startedAt = HashMap<Long, Long>()   // session id -> first code seen (for speed and time left)
    private var pending: Receiver.Session? = null  // complete but waiting for a passphrase
    private var lastUi = 0L

    fun onStats(s: Scanner.Stats) {
        val text = s.summary
        main.post { ui.stats = text }
    }

    fun onCodes(codes: List<ByteArray>) = worker.execute {
        var complete: Receiver.Session? = null
        var notice: String? = null
        for (c in codes) {
            when (val e = receiver.onCode(c)) {
                is Receiver.Event.Complete -> complete = e.session
                is Receiver.Event.Notice -> notice = e.message
                else -> {}
            }
        }
        val now = System.currentTimeMillis()
        val session = receiver.session
        if (session != null) startedAt.getOrPut(session.id) { now }
        if (complete == null && now - lastUi < 250) return@execute // ~4 UI updates a second is plenty
        lastUi = now
        val rate = receiver.catchRate()
        val elapsed = session?.let { (now - startedAt.getValue(it.id)) / 1000.0 } ?: 0.0
        main.post {
            if (notice != null && (session == null || session.progress == 0.0)) ui.notice = notice
            if (session != null && !session.finished && ui.saved == null && !ui.needsPassphrase) {
                ui.progress = session.progress.toFloat()
                ui.status = "Receiving ${size(session.L.toLong())}${if (session.encrypted) " (encrypted)" else ""}: " +
                    "${(session.progress * 100).toInt()}%" + rateText(session, elapsed)
                ui.hint = if (rate != null && rate < 0.5) "Catching only ${(rate * 100).toInt()}% of the codes. Move closer so " +
                    "the codes fill the view, hold still and avoid glare. If it stays low, switch the sender to “safe” speed." else null
                if (session.progress > 0) ui.notice = null
            }
        }
        complete?.let { finish(it, null) }
    }

    fun submitPassphrase(pass: String) = worker.execute { pending?.let { finish(it, pass) } }

    fun reset() = worker.execute {
        receiver.reset()
        pending = null
        main.post {
            ui.saved = null; ui.progress = null; ui.hint = null; ui.notice = null; ui.needsPassphrase = false
            ui.status = "Ready for the next file. Point the camera at the sender."
        }
    }

    private fun finish(s: Receiver.Session, pass: String?) {
        try {
            val saved = receiver.finish(s, pass)
            val uri = Saver.save(context, saved.filename, saved.bytes)
            pending = null
            val took = took(s)
            main.post {
                ui.needsPassphrase = false; ui.hint = null; ui.progress = 1f
                ui.saved = saved.filename to uri
                ui.status = "Saved ${saved.filename} (${size(saved.bytes.size.toLong())}) to Downloads/qbeam$took."
            }
        } catch (e: QBeamException) {
            when (e.reason) {
                "passphrase" -> { pending = s; main.post { ui.needsPassphrase = true; ui.status = "Encrypted file received. Enter the passphrase shown in the sender's terminal." } }
                "auth" -> { pending = s; main.post { ui.needsPassphrase = true; ui.status = "Wrong passphrase (or the transfer was damaged). Try again." } }
                else -> main.post { ui.notice = e.message ?: e.reason; ui.progress = null }
            }
        } catch (e: Exception) {
            main.post { ui.notice = "Could not save: ${e.message}" }
        }
    }

    /** " in 28 s at 271 KB/s": from the first code to the last needed one (not passphrase typing), counting the
     *  bytes on screen (compressed). */
    private fun took(s: Receiver.Session): String {
        val sec = ((s.completedAt ?: System.currentTimeMillis()) - s.started) / 1000.0
        return if (sec < 0.5) "" else " in ${sec.toInt()} s at ${size((s.L / sec).toLong())}/s"
    }

    private fun rateText(s: Receiver.Session, elapsedSec: Double): String {
        if (elapsedSec < 0.5 || s.progress <= 0) return ""
        val rate = s.L * s.progress / elapsedSec
        return " · ${size(rate.toLong())}/s · about ${(s.L * (1 - s.progress) / rate).toInt()} s left"
    }

    fun shutdown() = worker.shutdown()
}

fun size(b: Long) = if (b >= 1 shl 20) "%.1f MB".format(b / 1048576.0) else "${maxOf(1, b / 1024)} KB"

@Composable
fun ReceiverScreen() {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val ui = remember { UiState() }
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    val controller = remember { Controller(context.applicationContext, ui) }
    var passphrase by remember { mutableStateOf("") }

    Column(
        // Android 15 draws apps edge to edge: keep content clear of the status and navigation bars.
        Modifier.fillMaxSize().background(Color(0xFF111111)).safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("qbeam", color = Color.White, fontSize = 22.sp)
        if (!granted) {
            Text("qbeam reads the codes on the sending screen with your camera. Nothing leaves this phone.", color = Color(0xFFBBBBBB))
            Button(onClick = { ask.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
            return@Column
        }
        val scanner = remember { Scanner(controller::onCodes, controller::onStats) }
        DisposableEffect(Unit) { onDispose { scanner.shutdown(); controller.shutdown() } }
        Box(Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(12.dp)).background(Color.Black)) {
            AndroidView(factory = { ctx -> PreviewView(ctx).also { scanner.bind(owner, it) } }, modifier = Modifier.fillMaxSize())
        }
        Text(ui.status, color = Color.White, fontSize = 15.sp)
        ui.progress?.let { p -> LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth()) }
        ui.hint?.let { Banner(it, Color(0xFF3D3210), Color(0xFFFFE08A)) }
        ui.notice?.let { Banner(it, Color(0xFF4A1414), Color(0xFFFFB3B3)) }
        if (ui.needsPassphrase) {
            OutlinedTextField(
                value = passphrase, onValueChange = { passphrase = it }, label = { Text("Passphrase") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = { controller.submitPassphrase(passphrase) }) { Text("Decrypt") }
        }
        ui.saved?.let { (name, uri) ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(Saver.mimeOf(name))
                        .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), name))
                }) { Text("Share") }
                OutlinedButton(onClick = {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, Saver.mimeOf(name))
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                    }
                }) { Text("Open") }
                OutlinedButton(onClick = { passphrase = ""; controller.reset() }) { Text("Next file") }
            }
        }
        Text(ui.stats, color = Color(0xFF777777), fontSize = 11.sp)
    }
}

@Composable
fun Banner(text: String, bg: Color, fg: Color) {
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(bg).padding(10.dp)) { Text(text, color = fg, fontSize = 13.sp) }
}
