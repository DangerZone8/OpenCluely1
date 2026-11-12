package ai.slickly.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.provider.Settings
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class SlicklyOverlayService : Service() {
  private lateinit var windowManager: WindowManager
  private var bubble: TextView? = null
  private var panel: LinearLayout? = null
  private val worker = Executors.newSingleThreadExecutor()
  private val endpoint = "https://slicklyai.vercel.app/api/gemini"
  // All overlay chat calls run on the single worker, so this history remains ordered.
  private val conversationHistory = JSONArray()

  private var mediaProjection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var captureHandler: Handler? = null
  private var captureNotBefore = 0L
  private var captureSubmitted = false

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      releaseScreenCapture()
    }
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val captureRequested = intent?.action == ACTION_CAPTURE_SCREEN
    if (Build.VERSION.SDK_INT >= 34) {
      val captureType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      val overlayType = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      val type = if (captureRequested) {
        if (bubble != null) captureType or overlayType else captureType
      } else overlayType
      startForeground(NOTIFICATION_ID, buildNotification(), type)
    } else {
      startForeground(NOTIFICATION_ID, buildNotification())
    }

    if (captureRequested && intent != null) {
      startScreenCapture(intent)
      return START_NOT_STICKY
    }
    if (Settings.canDrawOverlays(this)) showBubble()
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  @Suppress("DEPRECATION")
  private fun overlayType(): Int {
    return if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else WindowManager.LayoutParams.TYPE_PHONE
  }

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
      elevation = dp(8).toFloat()
      contentDescription = "Open Slickly floating assistant"
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
          startX = lp.x
          startY = lp.y
          touchX = event.rawX
          touchY = event.rawY
          true
        }
        MotionEvent.ACTION_MOVE -> {
          lp.x = (startX - (event.rawX - touchX).toInt()).coerceIn(0, (resources.displayMetrics.widthPixels - dp(54)).coerceAtLeast(0))
          lp.y = (startY + (event.rawY - touchY).toInt()).coerceIn(0, (resources.displayMetrics.heightPixels - dp(54)).coerceAtLeast(0))
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
    try { windowManager.addView(root, lp) } catch (_: Exception) { panel = null }
  }

  private fun askAssistant(prompt: String): String {
    val installId = installId()
    conversationHistory.put(JSONObject()
      .put("role", "user")
      .put("parts", JSONArray().put(JSONObject().put("text", prompt))))
    while (conversationHistory.length() > 20) conversationHistory.remove(0)

    val contents = JSONArray()
    for (index in 0 until conversationHistory.length()) {
      contents.put(conversationHistory.getJSONObject(index))
    }
    val screenContext = getSharedPreferences("slickly_native", Context.MODE_PRIVATE)
      .getString("latest_screen_ai_context", null)
      ?.takeIf { it.isNotBlank() }
    val instruction = buildString {
      append("You are Slickly, a helpful general-purpose assistant. Use the supplied conversation history to understand follow-up questions and references. Answer directly first. When asked to explain, use clear steps, define unfamiliar terms, and include a small relevant example. Give enough detail to be understandable without unrelated filler. If context is missing, ask one focused clarifying question.")
      if (screenContext != null) {
        append("\\n\\nLATEST USER-AUTHORIZED SCREEN ANALYSIS (snapshot, not live screen):\\n")
        append(screenContext.take(12000))
        append("\\nUse this to answer follow-ups about the captured screen.")
      }
    }
    val request = JSONObject().put("request", JSONObject()
      .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", instruction))))
      .put("contents", contents)
      .put("generationConfig", JSONObject().put("temperature", 0.7).put("maxOutputTokens", 1536)))
    val response = postRequest(request, installId, "chat")
    if (!response.startsWith("Couldn't reach Slickly") &&
        !response.startsWith("The shared AI service") &&
        !response.startsWith("The hosted AI service") &&
        !response.startsWith("Slickly could not") &&
        !response.startsWith("Slickly returned an empty")) {
      conversationHistory.put(JSONObject()
        .put("role", "model")
        .put("parts", JSONArray().put(JSONObject().put("text", response))))
      while (conversationHistory.length() > 20) conversationHistory.remove(0)
    }
    return response
  }

  private fun startScreenCapture(intent: Intent) {
    try {
      val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
      val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(EXTRA_RESULT_DATA)
      }
      if (data == null) {
        saveScreenStatus("Android did not return screen-sharing permission. Please try again.")
        if (bubble == null) stopSelf()
        return
      }
      val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val projection = manager.getMediaProjection(resultCode, data)
      if (projection == null) {
        saveScreenStatus("Android could not start screen sharing. Please try again.")
        if (bubble == null) stopSelf()
        return
      }
      mediaProjection = projection
      captureSubmitted = false
      captureNotBefore = System.currentTimeMillis() + 5000L
      captureHandler = Handler(mainLooper)
      projection.registerCallback(projectionCallback, captureHandler)

      val metrics = DisplayMetrics()
      @Suppress("DEPRECATION")
      windowManager.defaultDisplay.getRealMetrics(metrics)
      val width = metrics.widthPixels
      val height = metrics.heightPixels
      imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
      imageReader?.setOnImageAvailableListener({ reader ->
        if (captureSubmitted) {
          reader.acquireLatestImage()?.close()
          return@setOnImageAvailableListener
        }
        if (System.currentTimeMillis() < captureNotBefore) {
          reader.acquireLatestImage()?.close()
          return@setOnImageAvailableListener
        }
        val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
        captureSubmitted = true
        val base64 = encodeImage(image)
        image.close()
        releaseScreenCapture()
        if (base64 != null) {
          saveScreenStatus("Screen captured. Slickly is analyzing it…")
          submitScreenImage(base64)
        } else {
          saveScreenStatus("Slickly could not prepare the captured screen image.")
          if (bubble == null) stopSelf()
        }
      }, captureHandler)

      virtualDisplay = projection.createVirtualDisplay(
        "SlicklyScreenAI", width, height, metrics.densityDpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        imageReader?.surface, null, captureHandler
      )
      saveScreenStatus("Screen sharing is active. Switch to the app to analyze within five seconds.")
    } catch (error: Exception) {
      saveScreenStatus("Screen AI capture could not start: ${error.localizedMessage ?: "unknown error"}")
      releaseScreenCapture()
      if (bubble == null) stopSelf()
    }
  }

  private fun encodeImage(image: Image): String? {
    return try {
      val plane = image.planes.firstOrNull() ?: return null
      val pixelStride = plane.pixelStride
      if (pixelStride <= 0) return null
      val rowPadding = plane.rowStride - pixelStride * image.width
      val paddedWidth = image.width + rowPadding / pixelStride
      val raw = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
      raw.copyPixelsFromBuffer(plane.buffer)
      val cropped = Bitmap.createBitmap(raw, 0, 0, image.width, image.height)
      raw.recycle()
      val scale = min(1f, 1280f / max(cropped.width, cropped.height).toFloat())
      val scaled = if (scale < 1f) Bitmap.createScaledBitmap(cropped, (cropped.width * scale).toInt(), (cropped.height * scale).toInt(), true) else cropped
      if (scaled !== cropped) cropped.recycle()
      val output = ByteArrayOutputStream()
      scaled.compress(Bitmap.CompressFormat.JPEG, 42, output)
      scaled.recycle()
      Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
    } catch (_: Exception) {
      null
    }
  }

  private fun submitScreenImage(imageBase64: String) {
    worker.execute {
      val prompt = "Analyze this user-authorized Android screen capture for Slickly Screen AI. Describe what is visible, extract key text, and identify any visible question or task. Keep the answer useful for follow-up questions."
      val parts = JSONArray()
        .put(JSONObject().put("text", prompt))
        .put(JSONObject().put("inlineData", JSONObject().put("mimeType", "image/jpeg").put("data", imageBase64)))
      val request = JSONObject().put("request", JSONObject()
        .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
        .put("generationConfig", JSONObject().put("temperature", 0.4).put("maxOutputTokens", 2048)))
      val answer = postRequest(request, installId(), "screen-vision")
      val prefs = getSharedPreferences("slickly_native", Context.MODE_PRIVATE)
      if (answer.startsWith("Slickly could not") || answer.startsWith("Couldn't reach") || answer.startsWith("The shared AI service") || answer.startsWith("The hosted AI service") || answer.startsWith("Slickly returned an empty")) {
        prefs.edit().putString("latest_screen_ai_status", answer).apply()
      } else {
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).format(Date())
        prefs.edit()
          .putString("latest_screen_ai_context", answer)
          .putString("latest_screen_ai_captured_at", timestamp)
          .putString("latest_screen_ai_status", "Screen AI analysis ready. Return to Slickly to ask follow-up questions.")
          .apply()
      }
      if (bubble == null) stopSelf()
    }
  }

  private fun postRequest(request: JSONObject, id: String, feature: String): String {
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15000
        readTimeout = 45000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("x-opencluely-install-id", id)
        setRequestProperty("x-opencluely-feature", feature)
      }
      connection.outputStream.use { it.write(request.toString().toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val body = stream.bufferedReader().use { it.readText() }
      val parsed = JSONObject(body)
      if (status in 200..299) parsed.optString("text", "Slickly returned an empty response.")
      else parsed.optString("error", "Slickly could not complete that request.")
    } catch (_: Exception) {
      "Couldn't reach Slickly right now. Check your connection and try again."
    } finally {
      connection?.disconnect()
    }
  }

  private fun installId(): String {
    val prefs = getSharedPreferences("slickly_native", Context.MODE_PRIVATE)
    return prefs.getString("install_id", null) ?: UUID.randomUUID().toString().also {
      prefs.edit().putString("install_id", it).apply()
    }
  }

  private fun saveScreenStatus(status: String) {
    getSharedPreferences("slickly_native", Context.MODE_PRIVATE).edit()
      .putString("latest_screen_ai_status", status).apply()
  }

  private fun releaseScreenCapture() {
    imageReader?.setOnImageAvailableListener(null, null)
    virtualDisplay?.release()
    virtualDisplay = null
    imageReader?.close()
    imageReader = null
    captureHandler = null
    val projection = mediaProjection
    mediaProjection = null
    if (projection != null) {
      try { projection.unregisterCallback(projectionCallback) } catch (_: Exception) {}
      try { projection.stop() } catch (_: Exception) {}
    }
  }

  private fun removePanel() {
    panel?.let { try { windowManager.removeView(it) } catch (_: Exception) {} }
    panel = null
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL_ID, "Slickly assistant and Screen AI", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder.setContentTitle("Slickly is active")
      .setContentText("Your user-started floating assistant or Screen AI session is running.")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setOngoing(true)
      .build()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  override fun onDestroy() {
    releaseScreenCapture()
    removePanel()
    bubble?.let { try { windowManager.removeView(it) } catch (_: Exception) {} }
    bubble = null
    worker.shutdownNow()
    super.onDestroy()
  }

  companion object {
    const val ACTION_CAPTURE_SCREEN = "ai.slickly.mobile.ACTION_CAPTURE_SCREEN"
    const val EXTRA_RESULT_CODE = "slickly_screen_result_code"
    const val EXTRA_RESULT_DATA = "slickly_screen_result_data"
    private const val CHANNEL_ID = "slickly_overlay"
    private const val NOTIFICATION_ID = 4721
  }
}
