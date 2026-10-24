import CoreText
import SwiftUI

/// The desktop's Deep theme (ai_memory/05), for a phone: dark forest canvas, light columns,
/// the three stages in their own calm tones, the column colour only in the header.
enum Theme {
    // canvas and shell
    static let canvasTop = Color(hex: 0x145640)
    static let canvasMid = Color(hex: 0x0E3A2B)
    static let canvasBottom = Color(hex: 0x06231A)
    static let shell = Color(hex: 0x082A1F)
    static let leaf = Color(hex: 0x6EE7B7)

    // ink
    static let ink = Color(hex: 0x0C2A1D)
    static let ink2 = Color(hex: 0x3C5A4B)
    static let ink3 = Color(hex: 0x718D7D)
    static let line = Color(hex: 0x0C2A1D).opacity(0.09)
    static let lineStrong = Color(hex: 0x0C2A1D).opacity(0.16)

    // brand
    static let primary = Color(hex: 0x10A874)
    static let primaryDeep = Color(hex: 0x057A55)
    static let mint = Color(hex: 0xF0FDF6)
    static let recording = Color(hex: 0xE5484D)
    static let danger = Color(hex: 0xDC4F3A)

    // column body and cards
    static let column = Color(hex: 0xEEF2F0)
    static let card = Color.white
    static let cardEdge = Color(hex: 0xDFE9E3)

    // Cooked (Ocean) and Served (sage)
    static let cookedBg = Color(hex: 0xE9F1FB)
    static let cookedEdge = Color(hex: 0xC9DBF1)
    static let cookedLabel = Color(hex: 0x1D4F8C)
    static let cookedAccent = Color(hex: 0x3A6FB5)
    static let cookedNote = Color(hex: 0xFDFEFF)
    static let servedBg = Color(hex: 0xE4EEE8)
    static let servedEdge = Color(hex: 0xC6DCCD)
    static let servedLabel = Color(hex: 0x0B5A3F)
    static let servedBox = Color(hex: 0xFBFDFB)

    // eating
    static let eating = Color(hex: 0x047857)
    static let eatingBright = Color(hex: 0x10B981)

    static var canvas: LinearGradient {
        LinearGradient(colors: [canvasTop, canvasMid, canvasBottom], startPoint: .top, endPoint: .bottom)
    }

    // MARK: highlights (Check again, Important, Idea, Ready)

    struct Highlight: Identifiable {
        let id: String
        let name: String
        let bar: Color
        let fill: Color
    }

    static let highlights: [Highlight] = [
        .init(id: "amber", name: "Check again", bar: Color(hex: 0xF59E0B), fill: Color(hex: 0xFFF3D4)),
        .init(id: "rose", name: "Important", bar: Color(hex: 0xF43F5E), fill: Color(hex: 0xFFE4E9)),
        .init(id: "sky", name: "Idea", bar: Color(hex: 0x0EA5E9), fill: Color(hex: 0xDFF3FD)),
        .init(id: "lime", name: "Ready", bar: Color(hex: 0x65A30D), fill: Color(hex: 0xECF6DA)),
    ]

    static func highlight(_ id: String?) -> Highlight? {
        guard let id else { return nil }
        return highlights.first { $0.id == id }
    }

    // MARK: column colours (palette ids never change; unknown ones draw as the first)

    struct Swatch: Identifiable {
        let id: String
        let name: String
        let color: Color
    }

    static let palette: [Swatch] = [
        ("monstera", "Emerald", 0x0E9F6E), ("moss", "Sky", 0x0284C7), ("sun", "Sun", 0xD97706),
        ("orchid", "Orchid", 0x9333EA), ("fern", "Lime", 0x65A30D), ("clay", "Blossom", 0xDB2777),
        ("eucalyptus", "Teal", 0x0D9488), ("sage", "Bark", 0x78716C), ("indigo", "Indigo", 0x4F46E5),
        ("ember", "Ember", 0xEA580C), ("lagoon", "Lagoon", 0x0891B2), ("ruby", "Ruby", 0xDC2626),
        ("forest", "Forest", 0x15803D), ("fuchsia", "Fuchsia", 0xC026D3), ("slate", "Slate", 0x475569),
        ("mustard", "Mustard", 0xA16207), ("navy", "Navy", 0x1E3A8A), ("wine", "Wine", 0x9F1239),
    ].map { Swatch(id: $0.0, name: $0.1, color: Color(hex: $0.2)) }

    static func accent(_ id: String) -> Color {
        (palette.first { $0.id == id } ?? palette[0]).color
    }

    /// The header's gradient: 90% accent to the accent darkened (80% accent on black).
    static func header(_ id: String) -> LinearGradient {
        let a = accent(id)
        return LinearGradient(colors: [a.opacity(0.92), a.mix(with: .black, by: 0.2)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - fonts (the desktop's woff2 files, registered at launch)

enum Fonts {
    static func register() {
        let names = ["geist-latin", "geist-latin-ext", "geist-mono-latin", "instrument-sans-latin"]
        for name in names {
            guard let url = Bundle.main.url(forResource: name, withExtension: "woff2") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Geist", size: size).weight(weight)
    }

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .custom("Geist Mono", size: size).weight(weight)
    }

    static func title(_ size: CGFloat = 17, _ weight: Font.Weight = .semibold) -> Font {
        .custom("Instrument Sans", size: size).weight(weight)
    }

    /// Stage labels: 11.5 px / 700 / +0.045em, uppercase.
    static let label = Font.custom("Geist", size: 11.5).weight(.bold)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

extension View {
    /// The stage label look: uppercase, tracked, dark ink.
    func stageLabel(_ color: Color) -> some View {
        font(Fonts.label).tracking(0.5).textCase(.uppercase).foregroundStyle(color)
    }
}
