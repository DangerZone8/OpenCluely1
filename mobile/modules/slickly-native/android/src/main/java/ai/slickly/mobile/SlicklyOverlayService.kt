package ai.slickly.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs

class SlicklyOverlayService : Service() {
  private lateinit var windowManager: WindowManager
  private var bubble: TextView? = null
  private var panel: LinearLayout? = null
  private var panelParams: WindowManager.LayoutParams? = null
  private val worker = Executors.newSingleThreadExecutor()
  private val endpoint = "https://slicklyai.vercel.app/api/gemini"

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    if (Settings.canDrawOverlays(this)) showBubble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

  private fun params(width: Int, height: Int, flags: Int): WindowManager.LayoutParams =
    WindowManager.LayoutParams(width, height, overlayType(), flags, PixelFormat.TRANSLUCENT).apply {
      gravity = Gravity.TOP or Gravity.END
      x = dp(14)
      y = dp(150)
    }

  private fun showBubble() {
    if (bubble != null) return
    val view = TextView(this).apply {
      text = "×"
      textSize = 27f
      setTextColor(Color.rgb(20, 24, 12))
      gravity = Gravity.CENTER
      setBackgroundColor(Color.rgb(174, 239, 68))
      elevation = dp(8).toFloat()
      contentDescription = "Open Slickly floating assistant"
      setOnClickListener { togglePanel() }
    }
    val lp = params(dp(54), dp(54), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)
    lp.width = dp(54)
    lp.height = dp(54)
    lp.format = PixelFormat.TRANSLUCENT
    lp.windowAnimations = android.R.style.Animation_Dialog
    lp.gravity = Gravity.TOP or Gravity.END
    lp.x = dp(14)
    lp.y = dp(170)
    view.background = android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.OVAL
      setColor(Color.rgb(174, 239, 68))
      setStroke(dp(2), Color.rgb(12, 12, 16))
    }
    var startX = 0
    var startY = 0
    var touchX = 0f
    var touchY = 0f
    view.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = lp.x; startY = lp.y
          touchX = event.rawX; touchY = event.rawY
          true
        }
        MotionEvent.ACTION_MOVE -> {
          lp.x = (startX - (event.rawX - touchX).toInt()).coerceAtLeast(0)
          lp.y = (startY + (event.rawY - touchY).toInt()).coerceAtLeast(0)
          windowManager.updateViewLayout(view, lp)
          true
        }
        MotionEvent.ACTION_UP -> {
          val moved = abs(event.rawX - touchX) + abs(event.rawY - touchY) > dp(8)
          if (!moved) togglePanel()
          true
        }
        else -> true
      }
    }
    bubble = view
    try { windowManager.addView(view, lp) } catch (_: Exception) { bubble = null }
  }

  private fun togglePanel() {
    if (panel != null) {
      removePanel()
      return
    }
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(14), dp(12), dp(14), dp(12))
      background = android.graphics.drawable.GradientDrawable().apply {
        setColor(Color.rgb(19, 18, 25))
        cornerRadius = dp(18).toFloat()
        setStroke(dp(1), Color.rgb(104, 82, 158))
      }
      elevation = dp(12).toFloat()
    }
    val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    val title = TextView(this).apply {
      text = "SLICKLY  ·  AI"
      textSize = 13f
      setTextColor(Color.WHITE)
      setTypeface(null, android.graphics.Typeface.BOLD)
    }
    val close = Button(this).apply {
      text = "×"
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.TRANSPARENT)
      setOnClickListener { removePanel() }
    }
    header.addView(title, LinearLayout.LayoutParams(0, dp(42), 1f))
    header.addView(close, LinearLayout.LayoutParams(dp(42), dp(42)))
    val answer = TextView(this).apply {
      text = "Ask Slickly about what you're working on."
      textSize = 13f
      setTextColor(Color.rgb(230, 226, 241))
      setPadding(0, dp(8), 0, dp(8))
    }
    val input = EditText(this).apply {
      hint = "Message Slickly…"
      setTextColor(Color.WHITE)
      setHintTextColor(Color.GRAY)
      textSize = 14f
      maxLines = 3
      setPadding(dp(10), dp(8), dp(10), dp(8))
      background = android.graphics.drawable.GradientDrawable().apply {
        setColor(Color.rgb(36, 34, 44))
        cornerRadius = dp(10).toFloat()
      }
    }
    val send = Button(this).apply {
      text = "Send"
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.rgb(111, 78, 190))
      setOnClickListener {
        val prompt = input.text.toString().trim()
        if (prompt.isNotEmpty()) {
          isEnabled = false
          answer.text = "Slickly is thinking…"
          worker.execute {
            val result = askAssistant(prompt)
            android.os.Handler(mainLooper).post {
              answer.text = result
              isEnabled = true
            }
          }
          input.setText("")
          (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(input.windowToken, 0)
        }
      }
    }
    root.addView(header)
    root.addView(answer, LinearLayout.LayoutParams(-1, dp(90)))
    root.addView(input, LinearLayout.LayoutParams(-1, dp(48)))
    root.addView(send, LinearLayout.LayoutParams(-1, dp(44)))
    panel = root
    val lp = params(dp(320), WindowManager.LayoutParams.WRAP_CONTENT, 0)
    lp.gravity = Gravity.TOP or Gravity.END
    lp.x = dp(12)
    lp.y = dp(235)
    panelParams = lp
    try { windowManager.addView(root, lp) } catch (_: Exception) { panel = null }
  }

  private fun askAssistant(prompt: String): String {
    var connection: HttpURLConnection? = null
    return try {
      val prefs = getSharedPreferences("slickly_native", Context.MODE_PRIVATE)
      val installId = prefs.getString("install_id", null) ?: UUID.randomUUID().toString().also {
        prefs.edit().putString("install_id", it).apply()
      }
      val request = JSONObject().put("request", JSONObject()
        .put("contents", org.json.JSONArray().put(JSONObject()
          .put("role", "user")
          .put("parts", org.json.JSONArray().put(JSONObject().put("text", prompt)))))
        .put("generationConfig", JSONObject().put("temperature", 0.7).put("maxOutputTokens", 1024)))
      connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15000
        readTimeout = 30000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("x-opencluely-install-id", installId)
        setRequestProperty("x-opencluely-feature", "chat")
      }
      connection.outputStream.use { it.write(request.toString().toByteArray(Charsets.UTF_8)) }
      val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
      val body = stream.bufferedReader().use { it.readText() }
      val parsed = JSONObject(body)
      if (connection.responseCode in 200..299) parsed.optString("text", "Slickly returned an empty response.")
      else parsed.optString("error", "Slickly could not complete that request.")
    } catch (error: Exception) {
      "Couldn't reach Slickly right now. Check your connection and try again."
    } finally {
      connection?.disconnect()
    }
  }

  private fun removePanel() {
    panel?.let { try { windowManager.removeView(it) } catch (_: Exception) {} }
    panel = null
    panelParams = null
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL_ID, "Slickly floating assistant", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder.setContentTitle("Slickly floating assistant")
      .setContentText("Your floating assistant is active. Tap the Slickly bubble to chat.")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setOngoing(true)
      .build()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  override fun onDestroy() {
    removePanel()
    bubble?.let { try { windowManager.removeView(it) } catch (_: Exception) {} }
    bubble = null
    worker.shutdownNow()
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "slickly_overlay"
    private const val NOTIFICATION_ID = 4721
  }
}
