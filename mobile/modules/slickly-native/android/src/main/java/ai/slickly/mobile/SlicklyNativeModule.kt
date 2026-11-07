package ai.slickly.mobile

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SlicklyNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SlicklyNative")

    AsyncFunction("hasOverlayPermission") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      Settings.canDrawOverlays(context)
    }

    AsyncFunction("requestOverlayPermission") {
      val context = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("startOverlay") {
      val context = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
      if (!Settings.canDrawOverlays(context)) {
        throw IllegalStateException("Allow display-over-other-apps permission before starting the Slickly overlay.")
      }
      val intent = Intent(context, SlicklyOverlayService::class.java)
      if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      true
    }

    AsyncFunction("stopOverlay") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      context.stopService(Intent(context, SlicklyOverlayService::class.java))
      true
    }

    AsyncFunction("setInstallId") { installId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
      context.getSharedPreferences("slickly_native", 0).edit().putString("install_id", installId).apply()
      true
    }
  }
}
