package com.uniclip.app

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class ClipboardAccessibilityService : AccessibilityService() {

    private var lastClipboardText = ""

    override fun onServiceConnected() {
        super.onServiceConnected()
        val clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboardManager.addPrimaryClipChangedListener {
            val clipData: ClipData? = clipboardManager.primaryClip
            if (clipData != null && clipData.itemCount > 0) {
                val text = clipData.getItemAt(0).text?.toString()
                if (text != null && text.isNotEmpty() && text != lastClipboardText) {
                    lastClipboardText = text
                    broadcastClipboard(text)
                }
            }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    private fun broadcastClipboard(text: String) {
        val prefs = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        val roomId = prefs.getString("flutter.room_id", null)
        val deviceName = prefs.getString("flutter.device_name", null)
        val serverUrlRaw = prefs.getString("flutter.server_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
        val serverUrl = serverUrlRaw.removeSuffix("/")

        if (roomId != null && deviceName != null) {
            thread {
                try {
                    val url = URL("$serverUrl/broadcast")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("Accept", "application/json")
                    conn.setRequestProperty("User-Agent", "UniClip/1.0 (Android-Service)")
                    conn.connectTimeout = 5000
                    conn.readTimeout = 5000
                    conn.doOutput = true

                    val jsonParam = JSONObject()
                    jsonParam.put("room_id", roomId)
                    jsonParam.put("device_name", deviceName)
                    jsonParam.put("text", text)

                    val os = OutputStreamWriter(conn.outputStream)
                    os.write(jsonParam.toString())
                    os.flush()
                    os.close()

                    conn.responseCode
                    conn.disconnect()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }
}