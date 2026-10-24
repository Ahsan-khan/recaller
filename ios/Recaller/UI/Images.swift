import SwiftUI

/// A row of picture tiles. Tap one to see it full size; with `onRemove`, each gets a remove button.
struct ImageStrip: View {
    let images: [ImageRef]
    var size: CGFloat = 64
    var onRemove: ((ImageRef) -> Void)?
    @State private var viewing: ImageRef?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(images) { ref in
                    ImageThumb(ref: ref, size: size)
                        .onTapGesture { viewing = ref }
                        .overlay(alignment: .topTrailing) {
                            if let onRemove {
                                Button { onRemove(ref) } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 20))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .black.opacity(0.6))
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                }
            }
            .padding(.top, onRemove == nil ? 0 : 6)
            .padding(.trailing, 6)
        }
        .scrollClipDisabled()
        .fullScreenCover(item: $viewing) { ref in
            ImageViewer(ref: ref)
        }
    }
}

struct ImageThumb: View {
    @EnvironmentObject private var store: AppStore
    let ref: ImageRef
    var size: CGFloat
    @State private var image: UIImage?
    @State private var missing = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.cardEdge)
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if missing {
                Image(systemName: "photo").foregroundStyle(Theme.ink3)
            } else {
                ProgressView().scaleEffect(0.7)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.black.opacity(0.08)))
        .task(id: ref.id) { await load() }
    }

    private func load() async {
        let thumb = store.imageURL(ref.id, thumb: true)
        let full = store.imageURL(ref.id, thumb: false)
        if let img = UIImage(contentsOfFile: thumb.path) ?? UIImage(contentsOfFile: full.path) {
            image = img
            return
        }
        if await store.ensureImage(ref.id, thumb: true), let img = UIImage(contentsOfFile: thumb.path) {
            image = img
        } else {
            missing = true
        }
    }
}

struct ImageViewer: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let ref: ImageRef
    @State private var image: UIImage?
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in withAnimation { scale = 1 } })
            } else {
                ProgressView().tint(.white)
            }
        }
        .overlay(alignment: .top) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).frame(width: 40, height: 40)
                        .background(Circle().fill(.white.opacity(0.15)))
                }
                Spacer()
                if let image {
                    ShareLink(item: Image(uiImage: image), preview: SharePreview("Picture", image: Image(uiImage: image))) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold)).frame(width: 40, height: 40)
                            .background(Circle().fill(.white.opacity(0.15)))
                    }
                }
                Button { store.copyImage(ref) } label: {
                    Label("Copy", systemImage: "doc.on.doc").font(Fonts.ui(14, .semibold))
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(Capsule().fill(Theme.primary))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
        }
        .task {
            let full = store.imageURL(ref.id, thumb: false)
            if UIImage(contentsOfFile: full.path) == nil { await store.ensureImage(ref.id, thumb: false) }
            image = UIImage(contentsOfFile: full.path) ?? UIImage(contentsOfFile: store.imageURL(ref.id, thumb: true).path)
        }
    }
}
