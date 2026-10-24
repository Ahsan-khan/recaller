import Foundation

/// AVAudioFile writes an `.m4a` with a large `free` atom (~25–60 KB of zeros, more than the audio
/// itself for a short phrase) between `moov` and `mdat`. This removes top-level `free`/`skip` atoms
/// and shifts the chunk offsets (`stco`/`co64`) to match, so each phrase uploads faster.
/// Anything unexpected returns the file unchanged.
nonisolated enum M4APadding {
    private static let containers: Set<String> = ["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]

    static func strip(_ input: Data) -> Data {
        let bytes = [UInt8](input)
        guard let top = atoms(in: bytes, from: 0, to: bytes.count) else { return input }
        let pads = top.filter { $0.type == "free" || $0.type == "skip" }
        guard !pads.isEmpty, top.contains(where: { $0.type == "moov" }), top.contains(where: { $0.type == "mdat" }) else { return input }

        var out = bytes
        // Shift every chunk offset that lies after a removed atom.
        func shifted(_ offset: UInt64) -> UInt64 {
            offset - pads.reduce(0) { $0 + (UInt64($1.start) < offset ? UInt64($1.size) : 0) }
        }
        var ok = true
        func patch(from: Int, to: Int) {
            guard ok, let list = atoms(in: bytes, from: from, to: to) else { ok = false; return }
            for atom in list {
                if containers.contains(atom.type) {
                    patch(from: atom.start + atom.header, to: atom.start + atom.size)
                } else if atom.type == "stco" || atom.type == "co64" {
                    let wide = atom.type == "co64"
                    let base = atom.start + atom.header + 4 // version + flags
                    guard base + 4 <= atom.start + atom.size else { ok = false; return }
                    let count = Int(read(bytes, base, 4))
                    let width = wide ? 8 : 4
                    guard base + 4 + count * width <= atom.start + atom.size else { ok = false; return }
                    for i in 0..<count {
                        let at = base + 4 + i * width
                        write(&out, at, width, shifted(read(bytes, at, width)))
                    }
                }
            }
        }
        for atom in top where atom.type == "moov" { patch(from: atom.start + atom.header, to: atom.start + atom.size) }
        guard ok else { return input }

        var result = Data(capacity: out.count)
        var cursor = 0
        for pad in pads.sorted(by: { $0.start < $1.start }) {
            result.append(contentsOf: out[cursor..<pad.start])
            cursor = pad.start + pad.size
        }
        result.append(contentsOf: out[cursor...])
        return result
    }

    private struct Atom {
        let type: String
        let start: Int
        let size: Int
        let header: Int
    }

    private static func atoms(in b: [UInt8], from: Int, to: Int) -> [Atom]? {
        var list: [Atom] = []
        var at = from
        while at < to {
            guard at + 8 <= to else { return nil }
            var size = Int(read(b, at, 4))
            var header = 8
            if size == 1 {
                guard at + 16 <= to else { return nil }
                size = Int(read(b, at + 8, 8))
                header = 16
            } else if size == 0 {
                size = to - at
            }
            guard size >= header, at + size <= to else { return nil }
            let type = String(decoding: b[(at + 4)..<(at + 8)], as: UTF8.self)
            list.append(Atom(type: type, start: at, size: size, header: header))
            at += size
        }
        return list
    }

    private static func read(_ b: [UInt8], _ at: Int, _ width: Int) -> UInt64 {
        var value: UInt64 = 0
        for i in 0..<width { value = value << 8 | UInt64(b[at + i]) }
        return value
    }

    private static func write(_ b: inout [UInt8], _ at: Int, _ width: Int, _ value: UInt64) {
        for i in 0..<width { b[at + i] = UInt8(truncatingIfNeeded: value >> (8 * UInt64(width - 1 - i))) }
    }
}
