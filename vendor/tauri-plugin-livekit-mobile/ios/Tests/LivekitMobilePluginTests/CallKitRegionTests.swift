import XCTest
@testable import tauri_plugin_livekit_mobile

final class CallKitRegionTests: XCTestCase {
    @MainActor
    func testCallKitStaysUnavailableUntilTheStorefrontIsKnown() {
        let controller = CallKitController()
        controller.refreshRegion()
        XCTAssertFalse(controller.isCallKitAvailable)
        XCTAssertFalse(controller.hasRegisteredCall())
        XCTAssertNil(controller.voipToken)
        var outgoingSettled = false
        controller.startOutgoingCall(uuid: UUID(), callId: "test", callerName: "Test") { failure in
            XCTAssertEqual(failure, .unavailable)
            outgoingSettled = true
        }
        XCTAssertTrue(outgoingSettled)
        var incomingSettled = false
        controller.reportIncomingCall(uuid: UUID(), callerName: "Test") { failure in
            XCTAssertEqual(failure, .unavailable)
            incomingSettled = true
        }
        XCTAssertTrue(incomingSettled)
    }

    func testChinaStorefrontIsRestrictedWithAnyDeviceRegion() {
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "FR", storefrontCountry: "CHN"))
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "US", storefrontCountry: "chn"))
    }

    func testChinaDeviceRegionIsRestrictedWithAnyStorefront() {
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "CN", storefrontCountry: "FRA"))
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "cn", storefrontCountry: "USA"))
    }

    func testUnknownRegionOrStorefrontIsRestricted() {
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "FR", storefrontCountry: nil))
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: nil, storefrontCountry: "FRA"))
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "", storefrontCountry: "FRA"))
        XCTAssertFalse(CallKitRegion.isAllowed(deviceRegion: "FR", storefrontCountry: ""))
    }

    func testOtherRegionsKeepCallKit() {
        XCTAssertTrue(CallKitRegion.isAllowed(deviceRegion: "FR", storefrontCountry: "FRA"))
        XCTAssertTrue(CallKitRegion.isAllowed(deviceRegion: "US", storefrontCountry: "USA"))
        XCTAssertTrue(CallKitRegion.isAllowed(deviceRegion: "HK", storefrontCountry: "HKG"))
        XCTAssertTrue(CallKitRegion.isAllowed(deviceRegion: "TW", storefrontCountry: "TWN"))
    }
}
