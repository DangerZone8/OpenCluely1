import ExpoModulesCore
import ReplayKit
import UIKit

private let slicklyAppGroup = "group.ai.slickly.mobile"

final class SlicklyBroadcastPickerView: ExpoView {
  private let picker = RPSystemBroadcastPickerView(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.preferredExtension = "ai.slickly.mobile.SlicklyScreenBroadcast"
    picker.showsMicrophoneButton = false
    addSubview(picker)
    accessibilityLabel = "Start Slickly screen broadcast"
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }
}

public class SlicklyNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SlicklyNative")

    View(SlicklyBroadcastPickerView.self) {
      Prop("preferredExtension") { (view: SlicklyBroadcastPickerView, value: String) in
        view.pickerPreferredExtension = value
      }
    }

    AsyncFunction("setInstallId") { (installId: String) in
      UserDefaults(suiteName: slicklyAppGroup)?.set(installId, forKey: "install_id")
      return true
    }

    AsyncFunction("readLatestScreenContext") { () -> [String: String]? in
      guard let defaults = UserDefaults(suiteName: slicklyAppGroup),
            let text = defaults.string(forKey: "latest_screen_ai_context"),
            !text.isEmpty,
            let capturedAt = defaults.string(forKey: "latest_screen_ai_captured_at") else {
        return nil
      }
      return ["text": text, "capturedAt": capturedAt]
    }
  }
}

private extension SlicklyBroadcastPickerView {
  var pickerPreferredExtension: String {
    get { picker.preferredExtension ?? "" }
    set { picker.preferredExtension = newValue }
  }
}
