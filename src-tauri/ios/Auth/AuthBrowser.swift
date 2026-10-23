import SafariServices
import UIKit

@objc(SableAuthBrowser)
final class SableAuthBrowser: NSObject {
    @objc(presentURL:from:completion:)
    static func present(
        url: URL,
        from controller: UIViewController,
        completion: @escaping (Bool) -> Void
    ) {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil,
              controller.viewIfLoaded?.window != nil,
              controller.presentedViewController == nil else {
            completion(false)
            return
        }
        let browser = SFSafariViewController(url: url)
        controller.present(browser, animated: true) {
            completion(true)
        }
    }
}
