package com.uniclip.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class ProcessTextActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Read SharedPreferences (Flutter uses 'FlutterSharedPreferences' by default)
        val prefs = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        val roomId = prefs.getString("flutter.room_id", null)
        val deviceName = prefs.getString("flutter.device_name", null)
        val serverUrlRaw = prefs.getString("flutter.server_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
        val serverUrl = serverUrlRaw.removeSuffix("/")

        if (intent.action == Intent.ACTION_PROCESS_TEXT && intent.type == "text/plain") {
            val text = intent.getStringExtra(Intent.EXTRA_PROCESS_TEXT)

            if (text != null && roomId != null && deviceName != null) {
                // Background network request
                thread {
                    try {
                        val url = URL("$serverUrl/broadcast")
                        val conn = url.openConnection() as HttpURLConnection
                        conn.requestMethod = "POST"
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.setRequestProperty("Accept", "application/json")
                        conn.setRequestProperty("User-Agent", "UniClip/1.0 (Android)")
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

                        val responseCode = conn.responseCode
                        if (responseCode == 200) {
                            runOnUiThread {
                                Toast.makeText(this@ProcessTextActivity, "Synced via UniClip", Toast.LENGTH_SHORT).show()
                            }
                        } else {
                            val errorBody = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "No details"
                            runOnUiThread {
                                Toast.makeText(this@ProcessTextActivity, "Sync Failed ($responseCode)", Toast.LENGTH_LONG).show()
                                android.util.Log.e("UniClip", "Background sync failed: $responseCode - $errorBody")
                            }
                        }
                        conn.disconnect()
                    } catch (e: Exception) {
                        e.printStackTrace()
                        runOnUiThread {
                            Toast.makeText(this@ProcessTextActivity, "Sync Error: ${e.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            } else if (roomId == null) {
                Toast.makeText(this, "UniClip: Not in a room", Toast.LENGTH_SHORT).show()
            }
        }
        
        // Close activity immediately so it acts as a background process
        finish()
    }
}