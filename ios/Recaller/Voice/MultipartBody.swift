import Foundation

/// A `multipart/form-data` body, built in memory (phrases are at most ~9 s of AAC, ~60 KB).
nonisolated struct MultipartBody: Sendable {
    let boundary: String
    private(set) var data = Data()

    init(boundary: String = "recaller-\(UUID().uuidString)") {
        self.boundary = boundary
    }

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(_ name: String, _ value: String) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(Self.escape(name))\"\r\n\r\n")
        append(value)
        append("\r\n")
    }

    mutating func addFile(_ name: String, filename: String, mime: String, data file: Data) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(Self.escape(name))\"; filename=\"\(Self.escape(filename))\"\r\n")
        append("Content-Type: \(mime)\r\n\r\n")
        data.append(file)
        append("\r\n")
    }

    /// The finished body, with the closing boundary.
    func finalized() -> Data {
        var out = data
        out.append(Data("--\(boundary)--\r\n".utf8))
        return out
    }

    private mutating func append(_ string: String) {
        data.append(Data(string.utf8))
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
    }
}
