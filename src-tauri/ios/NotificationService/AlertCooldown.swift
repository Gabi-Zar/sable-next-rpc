import Darwin
import Foundation

enum AlertCooldown {
    static func record(root: String, thread: String, now: TimeInterval, window: TimeInterval) -> Bool? {
        let path = (root as NSString).appendingPathComponent("alert-cooldown.json")
        let fd = open(path, O_RDWR | O_CREAT, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { return nil }
        defer { flock(fd, LOCK_UN) }

        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        let data = handle.readDataToEndOfFile()
        var entries = (try? JSONDecoder().decode([String: TimeInterval].self, from: data)) ?? [:]
        if let previous = entries[thread], now >= previous, now - previous < window {
            return true
        }
        entries = entries.filter { now >= $0.value && now - $0.value < window }
        entries[thread] = now
        guard let encoded = try? JSONEncoder().encode(entries),
              lseek(fd, 0, SEEK_SET) >= 0, ftruncate(fd, 0) == 0 else { return nil }
        do {
            try handle.write(contentsOf: encoded)
            return false
        } catch {
            return nil
        }
    }
}
