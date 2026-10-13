import CallKit
import Foundation
import Intents
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var completion: ((UNNotificationContent) -> Void)?
    private var fallback: UNMutableNotificationContent?
    private var policyRoot: String?
    private var originalSound: UNNotificationSound?
    private var noisy = false
    private var communication: INSendMessageIntent?
    private static let messageCategory = "sable-message"
    private static let inviteCategory = "sable-invite"
    private static let alertedAtKey = "sable_alerted_at"
    private static let notifyOnceWindow: TimeInterval = 5 * 60

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        // APNs must carry a generic alert: neither failure nor expiry may reveal a preview.
        content.title = "Sable"
        content.subtitle = ""
        content.body = "New message"
        content.attachments = []
        content.sound = nil
        content.threadIdentifier = Self.conversationThread(request.content.userInfo) ?? ""
        lock.lock()
        completion = contentHandler
        fallback = content
        originalSound = request.content.sound
        noisy = false
        communication = nil
        policyRoot = nil
        lock.unlock()

        guard let group = Bundle.main.object(forInfoDictionaryKey: "SableAppGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let data = try? JSONSerialization.data(withJSONObject: request.content.userInfo),
              let payload = String(data: data, encoding: .utf8) else {
            finish(content)
            return
        }
        let root = container.appendingPathComponent("Sable", isDirectory: true)
        lock.lock()
        policyRoot = root.path
        lock.unlock()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = root.path.withCString { path in
                payload.withCString { json in sable_push_render(path, json) }
            }
            guard let result else { self?.finish(content); return }
            defer { sable_push_free(result) }
            let bytes = Data(String(cString: result).utf8)
            guard let rendered = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
                self?.finish(content)
                return
            }
            if let ring = rendered["ring"] as? [String: Any], let room = rendered["room_id"] as? String {
                self?.ring(ring, room: room, fallback: content)
                return
            }
            if let read = rendered["read"] as? [String: Any], let user = rendered["user_id"] as? String {
                self?.clearRead(read, user: user)
                return
            }
            guard let body = rendered["body"] as? String,
                  let updated = content.mutableCopy() as? UNMutableNotificationContent else {
                self?.finish(content)
                return
            }
            if let title = rendered["title"] as? String { updated.title = title }
            updated.body = body
            let invite = rendered["invite"] as? Bool == true
            updated.categoryIdentifier = invite ? Self.inviteCategory : Self.messageCategory
            if rendered["noisy"] as? Bool == true {
                self?.lock.lock()
                self?.noisy = true
                self?.lock.unlock()
            }
            guard let user = rendered["user_id"] as? String, let room = rendered["room_id"] as? String else {
                self?.finish(updated)
                return
            }
            updated.threadIdentifier = user + "\u{0}" + room
            guard !invite, let intent = Self.intent(rendered, conversation: updated.threadIdentifier) else {
                self?.finish(updated)
                return
            }
            let interaction = INInteraction(intent: intent, response: nil)
            interaction.direction = .incoming
            interaction.donate { [weak self] error in
                if error == nil {
                    self?.lock.lock()
                    self?.communication = intent
                    self?.lock.unlock()
                }
                self?.finish(updated)
            }
        }
    }

    private static func intent(_ rendered: [String: Any], conversation: String) -> INSendMessageIntent? {
        guard let name = (rendered["sender"] as? String).flatMap({ $0.isEmpty ? nil : $0 }),
              let text = rendered["text"] as? String else { return nil }
        let id = (rendered["sender_id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? name
        let sender = INPerson(
            personHandle: INPersonHandle(value: id, type: .unknown),
            nameComponents: nil,
            displayName: name,
            image: nil,
            contactIdentifier: nil,
            customIdentifier: id
        )
        let group = rendered["group"] as? Bool == true
            ? (rendered["title"] as? String).map { INSpeakableString(spokenPhrase: $0) }
            : nil
        return INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: text,
            speakableGroupName: group,
            conversationIdentifier: conversation,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
    }

    private func clearRead(_ read: [String: Any], user: String) {
        guard read["clear"] as? Bool == true else {
            suppress()
            return
        }
        let room = read["room_id"] as? String
        UNUserNotificationCenter.current().getDeliveredNotifications { [weak self] delivered in
            let identifiers = delivered.filter { notification in
                let parts = notification.request.content.threadIdentifier
                    .split(separator: "\u{0}", maxSplits: 1, omittingEmptySubsequences: false)
                return parts.count == 2 && parts[0] == user && (room == nil || String(parts[1]) == room)
            }.map { $0.request.identifier }
            if !identifiers.isEmpty {
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
            }
            self?.suppress()
        }
    }

    private func suppress() {
        lock.lock()
        let handler = completion
        completion = nil
        lock.unlock()
        handler?(UNNotificationContent())
    }

    private func ring(_ ring: [String: Any], room: String, fallback: UNMutableNotificationContent) {
        let caller = (ring["caller_name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Someone"
        guard let alert = fallback.mutableCopy() as? UNMutableNotificationContent else {
            finish(fallback)
            return
        }
        alert.body = "\(caller) is calling"
        var payload: [AnyHashable: Any] = [
            "room_id": room,
            "uuid": UUID().uuidString,
            "caller_name": caller,
        ]
        if let expiresAt = ring["expires_at"] as? Double { payload["expires_at"] = expiresAt }
        CXProvider.reportNewIncomingVoIPPushPayload(payload) { [weak self] error in
            if error == nil {
                self?.suppress()
            } else {
                self?.finish(alert)
            }
        }
    }

    static func conversationThread(_ payload: [AnyHashable: Any]) -> String? {
        var notification = payload["notification"] as? [String: Any]
        if let encoded = payload["notification"] as? String,
           let data = encoded.data(using: .utf8) {
            notification = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        let event = notification ?? payload.reduce(into: [String: Any]()) {
            if let key = $1.key as? String { $0[key] = $1.value }
        }
        var users = Set<String>()
        for candidate in [payload["user_id"], event["user_id"]] {
            if let user = candidate as? String, !user.isEmpty { users.insert(user) }
        }
        for device in event["devices"] as? [[String: Any]] ?? [] {
            guard let data = device["data"] as? [String: Any] else { continue }
            for candidate in [data["user_id"], (data["default_payload"] as? [String: Any])?["user_id"]] {
                if let user = candidate as? String, !user.isEmpty { users.insert(user) }
            }
        }
        guard users.count == 1, let user = users.first,
              let room = event["room_id"] as? String, !room.isEmpty else { return nil }
        return user + "\u{0}" + room
    }

    private func finish(_ content: UNNotificationContent) {
        let identity = Self.messageIdentity(content.userInfo)
        let thread = Self.conversationThread(content.userInfo)
        guard identity != nil || thread != nil else {
            complete(content)
            return
        }
        UNUserNotificationCenter.current().getDeliveredNotifications { [weak self] delivered in
            let duplicates = identity.map { identity in
                delivered.filter { Self.messageIdentity($0.request.content.userInfo) == identity }
                    .map { $0.request.identifier }
            } ?? []
            let alertedAt = thread.flatMap { thread in
                delivered.filter { $0.request.content.threadIdentifier == thread }
                    .compactMap { $0.request.content.userInfo[Self.alertedAtKey] as? TimeInterval }
                    .max()
            }
            self?.complete(content, duplicates: duplicates, alertedAt: alertedAt)
        }
    }

    private static func messageIdentity(_ payload: [AnyHashable: Any]) -> String? {
        guard let thread = conversationThread(payload) else { return nil }
        var notification = payload["notification"] as? [String: Any]
        if let encoded = payload["notification"] as? String, let data = encoded.data(using: .utf8) {
            notification = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        guard let event = (notification?["event_id"] ?? payload["event_id"]) as? String,
              !event.isEmpty else { return nil }
        return thread + "\u{0}" + event
    }

    private func complete(
        _ content: UNNotificationContent,
        duplicates: [String] = [],
        alertedAt: TimeInterval? = nil
    ) {
        lock.lock()
        let handler = completion
        completion = nil
        let root = policyRoot
        let sound = originalSound
        let noisy = self.noisy
        let intent = communication
        communication = nil
        lock.unlock()
        guard let handler else { return }
        guard let updated = content.mutableCopy() as? UNMutableNotificationContent else {
            handler(content)
            return
        }
        let now = Date().timeIntervalSince1970
        let cooling = alertedAt.map { now >= $0 && now - $0 < Self.notifyOnceWindow } ?? false
        let quiet = !duplicates.isEmpty
            || (cooling && !noisy && root?.withCString { sable_push_notify_once($0) } == true)
        updated.sound = !quiet && root?.withCString { sable_push_sounds($0) } == true ? sound : nil
        if let stamp = quiet ? alertedAt : Optional(now) {
            updated.userInfo[Self.alertedAtKey] = stamp
        }
        if !duplicates.isEmpty {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: duplicates)
        }
        handler(intent.flatMap { try? updated.updating(from: $0) } ?? updated)
    }

    override func serviceExtensionTimeWillExpire() {
        lock.lock()
        let content = fallback
        communication = nil
        lock.unlock()
        if let content { complete(content) }
    }
}
