package ai.slickly.mobile

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle

class SlicklyScreenCaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE)
  }

  @Deprecated("The system screen-capture consent flow returns through onActivityResult.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_SCREEN_CAPTURE) return

    if (resultCode == Activity.RESULT_OK && data != null) {
      val serviceIntent = Intent(this, SlicklyOverlayService::class.java).apply {
        action = SlicklyOverlayService.ACTION_CAPTURE_SCREEN
        putExtra(SlicklyOverlayService.EXTRA_RESULT_CODE, resultCode)
        putExtra(SlicklyOverlayService.EXTRA_RESULT_DATA, data)
      }
      if (Build.VERSION.SDK_INT >= 26) startForegroundService(serviceIntent) else startService(serviceIntent)
    } else {
      getSharedPreferences("slickly_native", MODE_PRIVATE).edit()
        .putString("latest_screen_ai_status", "Screen sharing was not started. You can try again whenever you're ready.")
        .apply()
    }
    finish()
  }

  companion object {
    private const val REQUEST_SCREEN_CAPTURE = 8412
  }
}
