import ReplayKit
import CoreImage
import CoreMedia
import UIKit

private let appGroup = "group.ai.slickly.mobile"
private let endpoint = URL(string: "https://slicklyai.vercel.app/api/gemini")!

final class SampleHandler: RPBroadcastSampleHandler {
  private var didSubmitFrame = false
  private var captureNotBefore = Date.distantFuture
  private let imageContext = CIContext(options: [.cacheIntermediates: false])

  override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
    didSubmitFrame = false
    captureNotBefore = Date().addingTimeInterval(5)
    UserDefaults(suiteName: appGroup)?.set("Broadcast started. Waiting for the first screen frame…", forKey: "latest_screen_ai_status")
  }

  override func broadcastPaused() {}

  override func broadcastResumed() {}

  override func broadcastFinished() {
    UserDefaults(suiteName: appGroup)?.set("Screen broadcast stopped.", forKey: "latest_screen_ai_status")
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video, !didSubmitFrame, Date() >= captureNotBefore else { return }
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    didSubmitFrame = true
    submitFirstFrame(pixelBuffer)
  }

  private func submitFirstFrame(_ pixelBuffer: CVPixelBuffer) {
    let source = CIImage(cvPixelBuffer: pixelBuffer)
    let maxDimension: CGFloat = 1280
    let scale = min(1.0, maxDimension / max(source.extent.width, source.extent.height))
    let scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cgImage = imageContext.createCGImage(scaled, from: scaled.extent),
          let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.42) else {
      saveStatus("Could not prepare the captured screen image.")
      return
    }

    let defaults = UserDefaults(suiteName: appGroup)
    let installId = defaults?.string(forKey: "install_id") ?? UUID().uuidString.lowercased()
    defaults?.set(installId, forKey: "install_id")
    saveStatus("Screen captured. Slickly is analyzing it…")

    let base64 = data.base64EncodedString()
    let prompt = "Analyze this user-authorized iPhone screen capture for Slickly Screen AI. Describe what is visible, extract key text, and identify any visible question or task. Keep the answer useful for follow-up questions."
    let body: [String: Any] = [
      "request": [
        "contents": [[
          "role": "user",
          "parts": [
            ["text": prompt],
            ["inlineData": ["mimeType": "image/jpeg", "data": base64]]
          ]
        ]],
        "generationConfig": ["temperature": 0.4, "maxOutputTokens": 2048]
      ]
    ]

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 45
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(installId, forHTTPHeaderField: "x-opencluely-install-id")
    request.setValue("screen-vision", forHTTPHeaderField: "x-opencluely-feature")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)

    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        self.saveStatus("Screen AI request failed: \(error.localizedDescription)")
        return
      }
      guard let data = data,
            let http = response as? HTTPURLResponse,
            (200...299).contains(http.statusCode) else {
        self.saveStatus("Slickly could not analyze that screen. Return to the app and try again.")
        return
      }
      guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let answer = json["text"] as? String, !answer.isEmpty else {
        self.saveStatus("Slickly returned an empty screen analysis.")
        return
      }
      let defaults = UserDefaults(suiteName: appGroup)
      defaults?.set(answer, forKey: "latest_screen_ai_context")
      defaults?.set(ISO8601DateFormatter().string(from: Date()), forKey: "latest_screen_ai_captured_at")
      defaults?.set("Screen AI analysis ready. Return to Slickly to ask follow-up questions.", forKey: "latest_screen_ai_status")
    }.resume()
  }

  private func saveStatus(_ message: String) {
    UserDefaults(suiteName: appGroup)?.set(message, forKey: "latest_screen_ai_status")
  }
}
