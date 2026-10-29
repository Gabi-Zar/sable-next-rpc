import Foundation

enum CallKitRegion {
    static func isAllowed(deviceRegion: String?, storefrontCountry: String?) -> Bool {
        guard let deviceRegion, let storefrontCountry,
              !deviceRegion.isEmpty, !storefrontCountry.isEmpty else { return false }
        return deviceRegion.uppercased() != "CN" && storefrontCountry.uppercased() != "CHN"
    }
}
