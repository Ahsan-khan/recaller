import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Pictures as the desktop keeps them: `images/<32 hex>.png` (full size, always PNG) and
/// `images/<id>.t.png` (at most 640 px wide). Notes refer to them only as { id, w, h } (ai_memory/03).
enum ImageFiles {
    static let thumbWidth: CGFloat = 640

    static func folder(_ dataDir: URL) -> URL { dataDir.appendingPathComponent("images", isDirectory: true) }
    static func url(_ dataDir: URL, id: String, thumb: Bool) -> URL {
        folder(dataDir).appendingPathComponent("\(id)\(thumb ? ".t" : "").png")
    }

    static func newID() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Stores any image (a photo, a camera shot, a paste) as PNG plus thumbnail → { id, w, h } in physical pixels.
    static func store(_ image: UIImage, dataDir: URL) throws -> ImageRef {
        let normalized = image.normalizedForPNG()
        guard let png = normalized.pngData(), let cg = normalized.cgImage else { throw CocoaError(.fileWriteUnknown) }
        let id = newID()
        try FileManager.default.createDirectory(at: folder(dataDir), withIntermediateDirectories: true)
        let full = url(dataDir, id: id, thumb: false)
        try png.write(to: full, options: .atomic)
        if !writeThumbnail(from: full, to: url(dataDir, id: id, thumb: true)) {
            try? FileManager.default.copyItem(at: full, to: url(dataDir, id: id, thumb: true))
        }
        return ImageRef(id: id, w: Double(cg.width), h: Double(cg.height))
    }

    /// A PNG at most 640 px wide (a copy of the picture when it's narrower).
    @discardableResult
    static func writeThumbnail(from src: URL, to dst: URL) -> Bool {
        guard let source = CGImageSourceCreateWithURL(src as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? CGFloat,
              let h = props[kCGImagePropertyPixelHeight] as? CGFloat, w > 0, h > 0 else { return false }
        let maxSide = w <= thumbWidth ? max(w, h) : max(thumbWidth, thumbWidth * h / w)
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary),
              let dest = CGImageDestinationCreateWithURL(dst as CFURL, UTType.png.identifier as CFString, 1, nil) else { return false }
        CGImageDestinationAddImage(dest, thumb, nil)
        return CGImageDestinationFinalize(dest)
    }
}

extension UIImage {
    /// Upright, in an sRGB bitmap, so the PNG looks the same everywhere (HEIC orientation applied).
    func normalizedForPNG() -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let px = CGSize(width: size.width * scale, height: size.height * scale)
        return UIGraphicsImageRenderer(size: px, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: px))
        }
    }
}
