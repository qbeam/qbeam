// Saves received files to Downloads/qbeam via MediaStore (Android 10+, no storage permission needed).
package dev.qbeam.app

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap

object Saver {
    fun save(context: Context, filename: String, bytes: ByteArray): Uri {
        val ext = filename.substringAfterLast('.', "").lowercase()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, filename)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/qbeam")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: error("Could not create $filename in Downloads")
        try {
            resolver.openOutputStream(uri)!!.use { it.write(bytes) }
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return uri
    }

    fun mimeOf(filename: String): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(filename.substringAfterLast('.', "").lowercase()) ?: "*/*"
}
