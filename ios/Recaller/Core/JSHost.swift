import CryptoKit
import Foundation
import ImageIO
import JavaScriptCore
import Network
import os
import UniformTypeIdentifiers

/// Runs Recaller's core (the desktop's sync engine and account code, bundled by ios/core/build.js) in
/// JavaScriptCore, on one serial queue, and gives it what Node and Electron gave it on the desktop:
/// files, sha256/md5, random bytes, UTF-8 and base64, timers, fetch, the Keychain and thumbnails.
/// See ios/core/shims/native.js for the bridge's contract.
final class JSHost: @unchecked Sendable {
    let queue = DispatchQueue(label: "com.akhan.recaller.core", qos: .userInitiated)
    private let vm = JSVirtualMachine()!
    private(set) var context: JSContext!
    private var timers: [Int: DispatchWorkItem] = [:]
    private var tasks: [Int: URLSessionTask] = [:]
    private let session: URLSession
    private let log = Logger(subsystem: "com.akhan.recaller.ios", category: "core")
    private let pathMonitor = NWPathMonitor()
    private let onlineLock = OSAllocatedUnfairLock(initialState: true)

    /// Events from the core (`board`, `account`, `toast`), with their JSON. Called on the core queue.
    var onEvent: ((String, Data) -> Void)?

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 130
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
        pathMonitor.pathUpdateHandler = { [onlineLock] path in
            onlineLock.withLock { $0 = path.status == .satisfied }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.akhan.recaller.net"))
    }

    /// Loads the bundle. Call on `queue`.
    func load(bundleURL: URL, moduleRoot: String) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        let ctx = JSContext(virtualMachine: vm)!
        ctx.name = "Recaller core"
        ctx.exceptionHandler = { [log] _, exc in
            let text = exc?.toString() ?? "?"
            let stack = exc?.objectForKeyedSubscript("stack")?.toString() ?? ""
            log.error("JS exception: \(text, privacy: .public)\n\(stack, privacy: .public)")
        }
        context = ctx
        ctx.setObject(moduleRoot, forKeyedSubscript: "__moduleRoot" as NSString)
        ctx.setObject(makeNative(), forKeyedSubscript: "__native" as NSString)
        let source = try String(contentsOf: bundleURL, encoding: .utf8)
        ctx.evaluateScript(source, withSourceURL: bundleURL)
    }

    /// nil until load() has run (a scene event can arrive first).
    var core: JSValue? { context?.objectForKeyedSubscript("RecallerCore") }

    // MARK: - bytes across the bridge

    func bytes(_ data: Data) -> JSValue {
        let ctx = context.jsGlobalContextRef
        var exc: JSValueRef?
        guard let obj = JSObjectMakeTypedArray(ctx, kJSTypedArrayTypeUint8Array, data.count, &exc) else {
            return JSValue(undefinedIn: context)
        }
        if !data.isEmpty, let ptr = JSObjectGetTypedArrayBytesPtr(ctx, obj, &exc) {
            data.withUnsafeBytes { src in
                ptr.copyMemory(from: src.baseAddress!, byteCount: data.count)
            }
        }
        return JSValue(jsValueRef: obj, in: context)
    }

    func data(_ value: JSValue?) -> Data {
        guard let value, let ref = value.jsValueRef else { return Data() }
        let ctx = context.jsGlobalContextRef
        if value.isString { return Data((value.toString() ?? "").utf8) }
        guard JSValueIsObject(ctx, ref), let obj = JSValueToObject(ctx, ref, nil) else { return Data() }
        let type = JSValueGetTypedArrayType(ctx, ref, nil)
        if type == kJSTypedArrayTypeArrayBuffer {
            guard let ptr = JSObjectGetArrayBufferBytesPtr(ctx, obj, nil) else { return Data() }
            return Data(bytes: ptr, count: JSObjectGetArrayBufferByteLength(ctx, obj, nil))
        }
        guard type != kJSTypedArrayTypeNone, let base = JSObjectGetTypedArrayBytesPtr(ctx, obj, nil) else { return Data() }
        // The pointer is the start of the backing buffer: add the view's own offset.
        let offset = JSObjectGetTypedArrayByteOffset(ctx, obj, nil)
        let length = JSObjectGetTypedArrayByteLength(ctx, obj, nil)
        return Data(bytes: base.advanced(by: offset), count: length)
    }

    private func error(_ code: String, _ message: String = "") -> JSValue {
        JSValue(object: ["__err": code, "message": message], in: context)
    }

    private func error(from err: Error) -> JSValue {
        let ns = err as NSError
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSPOSIXErrorDomain {
            return error(Self.errnoName(Int32(underlying.code)), underlying.localizedDescription)
        }
        if ns.domain == NSPOSIXErrorDomain { return error(Self.errnoName(Int32(ns.code)), ns.localizedDescription) }
        if ns.domain == NSCocoaErrorDomain {
            switch ns.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError: return error("ENOENT", ns.localizedDescription)
            case NSFileWriteFileExistsError: return error("EEXIST", ns.localizedDescription)
            case NSFileReadNoPermissionError, NSFileWriteNoPermissionError: return error("EACCES", ns.localizedDescription)
            default: break
            }
        }
        return error("EIO", ns.localizedDescription)
    }

    private static func errnoName(_ e: Int32) -> String {
        switch e {
        case ENOENT: return "ENOENT"
        case EEXIST: return "EEXIST"
        case ENOTDIR: return "ENOTDIR"
        case EISDIR: return "EISDIR"
        case EACCES: return "EACCES"
        case EPERM: return "EPERM"
        case ENOTEMPTY: return "ENOTEMPTY"
        case ENOSPC: return "ENOSPC"
        case EBUSY: return "EBUSY"
        default: return "EIO"
        }
    }

    private func posix(_ result: Int32) -> JSValue? {
        result == 0 ? nil : error(Self.errnoName(errno), String(cString: strerror(errno)))
    }

    // MARK: - the native object

    private func makeNative() -> JSValue {
        let native = JSValue(newObjectIn: context)!
        func put(_ name: String, _ block: Any) { native.setObject(block, forKeyedSubscript: name as NSString) }
        let fm = FileManager.default

        // files
        let fsRead: @convention(block) (String) -> JSValue = { [unowned self] path in
            do { return self.bytes(try Data(contentsOf: URL(fileURLWithPath: path))) } catch { return self.error(from: error) }
        }
        let fsWrite: @convention(block) (String, JSValue) -> JSValue = { [unowned self] path, value in
            let d = self.data(value)
            let fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
            if fd < 0 { return self.posix(-1)! }
            defer { close(fd) }
            var written = 0
            while written < d.count {
                let n = d.withUnsafeBytes { buf in write(fd, buf.baseAddress!.advanced(by: written), d.count - written) }
                if n < 0 { return self.posix(-1)! }
                written += n
            }
            fsync(fd)
            return JSValue(undefinedIn: self.context)
        }
        let fsExists: @convention(block) (String) -> Bool = { path in fm.fileExists(atPath: path) }
        let fsMkdir: @convention(block) (String, Bool) -> JSValue = { [unowned self] path, recursive in
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: path, isDirectory: &isDir) {
                return recursive && isDir.boolValue ? JSValue(undefinedIn: self.context) : self.error("EEXIST", path)
            }
            do {
                try fm.createDirectory(atPath: path, withIntermediateDirectories: recursive)
                return JSValue(undefinedIn: self.context)
            } catch { return self.error(from: error) }
        }
        let fsRename: @convention(block) (String, String) -> JSValue = { [unowned self] a, b in
            self.posix(rename(a, b)) ?? JSValue(undefinedIn: self.context)
        }
        let fsCopy: @convention(block) (String, String) -> JSValue = { [unowned self] a, b in
            guard fm.fileExists(atPath: a) else { return self.error("ENOENT", a) }
            return self.posix(copyfile(a, b, nil, copyfile_flags_t(COPYFILE_DATA))) ?? JSValue(undefinedIn: self.context)
        }
        let fsReaddir: @convention(block) (String) -> JSValue = { [unowned self] path in
            do { return JSValue(object: try fm.contentsOfDirectory(atPath: path).sorted(), in: self.context) } catch { return self.error(from: error) }
        }
        let fsRm: @convention(block) (String, Bool) -> JSValue = { [unowned self] path, recursive in
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: path, isDirectory: &isDir) else { return self.error("ENOENT", path) }
            if isDir.boolValue && !recursive { return self.error("EISDIR", path) }
            do {
                try fm.removeItem(atPath: path)
                return JSValue(undefinedIn: self.context)
            } catch { return self.error(from: error) }
        }
        let fsStat: @convention(block) (String) -> JSValue = { [unowned self] path in
            var st = stat()
            if stat(path, &st) != 0 { return self.posix(-1)! }
            let ms = { (t: timespec) in Double(t.tv_sec) * 1000 + Double(t.tv_nsec) / 1_000_000 }
            return JSValue(object: [
                "size": Double(st.st_size),
                "dir": (st.st_mode & S_IFMT) == S_IFDIR,
                "ino": Double(st.st_ino),
                "birthtimeMs": ms(st.st_birthtimespec),
                "mtimeMs": ms(st.st_mtimespec),
            ], in: self.context)
        }
        put("fsRead", fsRead); put("fsWrite", fsWrite); put("fsExists", fsExists); put("fsMkdir", fsMkdir)
        put("fsRename", fsRename); put("fsCopy", fsCopy); put("fsReaddir", fsReaddir); put("fsRm", fsRm); put("fsStat", fsStat)

        // text and bytes
        let utf8Encode: @convention(block) (JSValue) -> JSValue = { [unowned self] s in self.bytes(Data((s.toString() ?? "").utf8)) }
        let utf8Decode: @convention(block) (JSValue) -> String = { [unowned self] b in String(decoding: self.data(b), as: UTF8.self) }
        let utf8Length: @convention(block) (JSValue) -> Int = { s in (s.toString() ?? "").utf8.count }
        let b64Encode: @convention(block) (JSValue) -> String = { [unowned self] b in self.data(b).base64EncodedString() }
        let b64Decode: @convention(block) (String) -> JSValue = { [unowned self] s in
            self.bytes(Data(base64Encoded: s, options: .ignoreUnknownCharacters) ?? Data())
        }
        let hash: @convention(block) (String, JSValue) -> JSValue = { [unowned self] alg, b in
            let d = self.data(b)
            switch alg {
            case "md5": return self.bytes(Data(Insecure.MD5.hash(data: d)))
            default: return self.bytes(Data(SHA256.hash(data: d)))
            }
        }
        let randomBytes: @convention(block) (Int) -> JSValue = { [unowned self] n in
            var d = Data(count: max(0, n))
            if n > 0 { _ = d.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, n, $0.baseAddress!) } }
            return self.bytes(d)
        }
        put("utf8Encode", utf8Encode); put("utf8Decode", utf8Decode); put("utf8Length", utf8Length)
        put("base64Encode", b64Encode); put("base64Decode", b64Decode); put("hash", hash); put("randomBytes", randomBytes)

        // timers
        let setTimer: @convention(block) (Int, Double) -> Void = { [unowned self] id, ms in
            self.timers[id]?.cancel()
            // A cancelled work item never runs, so a cleared or replaced timer can't fire.
            let item = DispatchWorkItem { [weak self] in
                guard let self, self.timers.removeValue(forKey: id) != nil else { return }
                self.context.objectForKeyedSubscript("__timerFire").call(withArguments: [id])
            }
            self.timers[id] = item
            self.queue.asyncAfter(deadline: .now() + .milliseconds(Int(max(0, ms))), execute: item)
        }
        let clearTimer: @convention(block) (Int) -> Void = { [unowned self] id in
            self.timers.removeValue(forKey: id)?.cancel()
        }
        put("setTimer", setTimer); put("clearTimer", clearTimer)

        // network
        let fetch: @convention(block) (Int, String, String, JSValue, JSValue, Double) -> Void = { [unowned self] id, url, method, headers, body, _ in
            guard let u = URL(string: url) else {
                self.context.objectForKeyedSubscript("__fetchFail").call(withArguments: [id, "bad url"])
                return
            }
            var req = URLRequest(url: u)
            req.httpMethod = method
            req.httpShouldHandleCookies = false
            if let h = headers.toDictionary() as? [String: Any] {
                for (k, v) in h { req.setValue("\(v)", forHTTPHeaderField: k) }
            }
            if !body.isNull && !body.isUndefined { req.httpBody = self.data(body) }
            let task = self.session.dataTask(with: req) { [weak self] data, response, err in
                guard let self else { return }
                self.queue.async {
                    guard self.tasks.removeValue(forKey: id) != nil else { return }
                    if let http = response as? HTTPURLResponse, err == nil {
                        var hs: [String: String] = [:]
                        for (k, v) in http.allHeaderFields { hs[String(describing: k).lowercased()] = String(describing: v) }
                        self.context.objectForKeyedSubscript("__fetchDone").call(withArguments: [id, http.statusCode, hs, self.bytes(data ?? Data())])
                    } else {
                        self.context.objectForKeyedSubscript("__fetchFail").call(withArguments: [id, err?.localizedDescription ?? "no response"])
                    }
                }
            }
            self.tasks[id] = task
            task.resume()
        }
        let fetchCancel: @convention(block) (Int) -> Void = { [unowned self] id in
            self.tasks.removeValue(forKey: id)?.cancel()
        }
        let isOnline: @convention(block) () -> Bool = { [onlineLock] in onlineLock.withLock { $0 } }
        put("fetch", fetch); put("fetchCancel", fetchCancel); put("isOnline", isOnline)

        // the app
        let hostname: @convention(block) () -> String = { Self.hostID }
        let logFn: @convention(block) (String, String) -> Void = { [log] level, text in
            switch level {
            case "error": log.error("\(text, privacy: .public)")
            case "warn": log.warning("\(text, privacy: .public)")
            default: log.info("\(text, privacy: .public)")
            }
        }
        let emit: @convention(block) (String, String) -> Void = { [unowned self] event, json in
            self.onEvent?(event, Data(json.utf8))
        }
        let makeThumb: @convention(block) (String, String) -> Bool = { src, dst in
            ImageFiles.writeThumbnail(from: URL(fileURLWithPath: src), to: URL(fileURLWithPath: dst))
        }
        let seal: @convention(block) (String) -> JSValue = { [unowned self] s in
            guard let box = try? AES.GCM.seal(Data(s.utf8), using: Self.sealKey()), let out = box.combined else { return self.bytes(Data()) }
            return self.bytes(out)
        }
        let unseal: @convention(block) (JSValue) -> JSValue = { [unowned self] b in
            guard let box = try? AES.GCM.SealedBox(combined: self.data(b)),
                  let plain = try? AES.GCM.open(box, using: Self.sealKey()),
                  let s = String(data: plain, encoding: .utf8) else { return JSValue(undefinedIn: self.context) }
            return JSValue(object: s, in: self.context)
        }
        put("hostname", hostname); put("log", logFn); put("emit", emit); put("makeThumb", makeThumb)
        put("seal", seal); put("unseal", unseal)
        return native
    }

    /// A stable name for this install (the sync folder uses it to notice it was copied elsewhere).
    static let hostID: String = {
        let key = "hostID"
        if let v = UserDefaults.standard.string(forKey: key) { return v }
        let v = "iphone-\(UUID().uuidString.lowercased())"
        UserDefaults.standard.set(v, forKey: key)
        return v
    }()

    /// The key that seals the sign-in token (the desktop's safeStorage), kept in the Keychain.
    private static func sealKey() -> SymmetricKey {
        if let d = Keychain.data("seal-key"), d.count == 32 { return SymmetricKey(data: d) }
        let key = SymmetricKey(size: .bits256)
        Keychain.set(key.withUnsafeBytes { Data($0) }, for: "seal-key")
        return key
    }
}
