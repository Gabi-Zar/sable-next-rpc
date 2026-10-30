import SafariServices
import UIKit

@objc(SableAuthBrowser)
final class SableAuthBrowser: NSObject {
    private static weak var browser: SFSafariViewController?
    private static var browserId: String?

    @objc(presentURL:id:from:completion:)
    static func present(
        url: URL,
        id: String,
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
        self.browser = browser
        browserId = id
        controller.present(browser, animated: true) {
            completion(true)
        }
    }

    @objc(dismissWithId:)
    static func dismiss(id: String) {
        guard browserId == id else { return }
        browser?.dismiss(animated: false)
        browser = nil
        browserId = nil
    }
}
