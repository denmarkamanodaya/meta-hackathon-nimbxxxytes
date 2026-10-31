// Blurs every face in a video or image, using macOS built-ins only (AVFoundation, Vision,
// CoreImage). Faces are found with Vision on the whole frame and on overlapping tiles (so the small
// face thumbnails in app captures are found too), padded by 25 %, and blurred with a strong
// gaussian. In a video, detection runs every few frames and each frame blurs every face found
// within +-WINDOW frames of it, so the blur never flickers and covers moving faces. Audio is copied
// as it is.
//
// Usage: swift scripts/blur-faces.swift <input> <output> [ranges]
//   <input> .mp4 / .mov (H.264 out, audio kept) or .png / .jpg (same format out).
//   [ranges] (video only): seconds to blur, e.g. "4.2-7.5,11-14.5". Faces are looked for only
//   there (long captures where only a few seconds are used); frames outside stay as they were, so
//   use the output only inside those ranges. Leave out to blur the whole video.

import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

/// Detect on every DETECT_EVERY-th frame; blur each face found within +-WINDOW frames.
let DETECT_EVERY = 2
let WINDOW = 8
/// Box padding on each side, as a share of the box size.
let PAD = 0.25
/// Small faces: the frame is also cut into overlapping square tiles of about TILE_PX pixels, each
/// enlarged UPSCALE times before detection (Vision misses faces only a few percent of the frame).
let TILE_PX = Double(ProcessInfo.processInfo.environment["TILE_PX"] ?? "") ?? 300
let UPSCALE = Double(ProcessInfo.processInfo.environment["UPSCALE"] ?? "") ?? 2
let TILE_OVERLAP = 0.25

let ciContext = CIContext(options: [.useSoftwareRenderer: false])

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

/// Faces Vision finds in `image`, as boxes normalised to it (origin bottom left). Upper bodies are
/// found too and their head area (top 40 %, middle 60 %) counted, for side profiles and backs of
/// heads the face detector misses.
func facesIn(_ image: CIImage) -> [CGRect] {
  let faces = VNDetectFaceRectanglesRequest()
  let bodies = VNDetectHumanRectanglesRequest()
  bodies.upperBodyOnly = true
  let handler = VNImageRequestHandler(ciImage: image, options: [:])
  do { try handler.perform([faces, bodies]) } catch { return [] }
  let heads = (bodies.results ?? []).map { body in
    let b = body.boundingBox
    return CGRect(x: b.minX + b.width * 0.2, y: b.maxY - b.height * 0.4, width: b.width * 0.6, height: b.height * 0.4)
  }
  return (faces.results ?? []).map(\.boundingBox) + heads
}

/// Face boxes in normalised image coordinates (origin bottom left, as Vision and CoreImage use):
/// the whole frame, then each enlarged tile, mapped back to the frame.
func detectFaces(_ image: CIImage) -> [CGRect] {
  let extent = image.extent
  var boxes = facesIn(image)
  let step = TILE_PX * (1 - TILE_OVERLAP)
  var y = extent.minY
  while y < extent.maxY {
    var x = extent.minX
    while x < extent.maxX {
      let tile = CGRect(x: x, y: y, width: TILE_PX, height: TILE_PX).intersection(extent)
      let moved = image.cropped(to: tile).transformed(by: CGAffineTransform(translationX: -tile.minX, y: -tile.minY).concatenating(CGAffineTransform(scaleX: UPSCALE, y: UPSCALE)))
      for b in facesIn(moved) {
        boxes.append(CGRect(x: (tile.minX + b.minX * tile.width - extent.minX) / extent.width, y: (tile.minY + b.minY * tile.height - extent.minY) / extent.height, width: b.width * tile.width / extent.width, height: b.height * tile.height / extent.height))
      }
      x += step
    }
    y += step
  }
  return boxes
}

/// The image with every box (normalised) padded and blurred.
func blur(_ image: CIImage, boxes: [CGRect]) -> CIImage {
  let extent = image.extent
  var out = image
  for box in boxes {
    let w = box.width * extent.width
    let h = box.height * extent.height
    let rect = CGRect(x: extent.minX + box.minX * extent.width - w * PAD, y: extent.minY + box.minY * extent.height - h * PAD, width: w * (1 + 2 * PAD), height: h * (1 + 2 * PAD)).intersection(extent).integral
    if rect.isEmpty { continue }
    let sigma = max(6, Double(max(w, h)) * 0.18)
    let blurred = image.clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: rect)
    out = blurred.composited(over: out)
  }
  return out
}

func processImage(_ input: URL, _ output: URL) {
  guard let image = CIImage(contentsOf: input) else { fail("cannot read \(input.path)") }
  let boxes = detectFaces(image)
  let result = blur(image, boxes: boxes)
  let space = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
  do {
    if output.pathExtension.lowercased() == "png" {
      try ciContext.writePNGRepresentation(of: result, to: output, format: .RGBA8, colorSpace: space)
    } else {
      try ciContext.writeJPEGRepresentation(of: result, to: output, colorSpace: space, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92])
    }
  } catch { fail("cannot write \(output.path): \(error)") }
  print("\(input.lastPathComponent): \(boxes.count) faces")
}

/// Reads every video frame in order, calling `body` with its index, time and pixels.
func readFrames(_ asset: AVAsset, _ track: AVAssetTrack, _ body: (Int, CMTime, CVPixelBuffer) -> Void) {
  guard let reader = try? AVAssetReader(asset: asset) else { fail("cannot open reader") }
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  output.alwaysCopiesSampleData = false
  reader.add(output)
  reader.startReading()
  var index = 0
  while let sample = output.copyNextSampleBuffer() {
    guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
    autoreleasepool { body(index, CMSampleBufferGetPresentationTimeStamp(sample), pixels) }
    index += 1
  }
  if reader.status == .failed { fail("read failed: \(String(describing: reader.error))") }
}

func processVideo(_ input: URL, _ output: URL, ranges: [ClosedRange<Double>]?) async {
  let asset = AVURLAsset(url: input)
  guard let video = try? await asset.loadTracks(withMediaType: .video).first else { fail("no video track") }
  let audio = try? await asset.loadTracks(withMediaType: .audio).first
  let size = (try? await video.load(.naturalSize)) ?? .zero
  let rate = (try? await video.load(.nominalFrameRate)) ?? 30

  // Pass 1: faces on every DETECT_EVERY-th frame.
  var found: [Int: [CGRect]] = [:]
  var frames = 0
  readFrames(asset, video) { index, time, pixels in
    frames = index + 1
    let inRange = ranges?.contains { $0.contains(time.seconds) } ?? true
    if index % DETECT_EVERY == 0 && inRange { found[index] = detectFaces(CIImage(cvPixelBuffer: pixels)) }
  }
  let faceFrames = found.values.filter { !$0.isEmpty }.count
  print("\(input.lastPathComponent): \(frames) frames, faces on \(faceFrames) of \(found.count) checked")

  // Pass 2: blur and write.
  try? FileManager.default.removeItem(at: output)
  guard let writer = try? AVAssetWriter(outputURL: output, fileType: .mp4) else { fail("cannot open writer") }
  let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: Int(size.width),
    AVVideoHeightKey: Int(size.height),
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 40_000_000, AVVideoExpectedSourceFrameRateKey: Int(rate.rounded())],
  ])
  videoIn.expectsMediaDataInRealTime = false
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoIn, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: Int(size.width),
    kCVPixelBufferHeightKey as String: Int(size.height),
  ])
  writer.add(videoIn)
  var audioIn: AVAssetWriterInput?
  if let audio {
    let hint = (try? await audio.load(.formatDescriptions))?.first
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: hint)
    input.expectsMediaDataInRealTime = false
    writer.add(input)
    audioIn = input
  }
  writer.startWriting()
  writer.startSession(atSourceTime: .zero)

  // Audio is copied on its own thread while the video is written, so the writer can interleave.
  let audioDone = DispatchGroup()
  if let audio, let audioIn, let reader = try? AVAssetReader(asset: asset) {
    let out = AVAssetReaderTrackOutput(track: audio, outputSettings: nil)
    reader.add(out)
    reader.startReading()
    audioDone.enter()
    Thread {
      while let sample = out.copyNextSampleBuffer() {
        while !audioIn.isReadyForMoreMediaData { usleep(2000) }
        audioIn.append(sample)
      }
      audioIn.markAsFinished()
      audioDone.leave()
    }.start()
  }

  readFrames(asset, video) { index, time, pixels in
    var boxes: [CGRect] = []
    for near in max(0, index - WINDOW)...(index + WINDOW) { boxes += found[near] ?? [] }
    let image = blur(CIImage(cvPixelBuffer: pixels), boxes: boxes)
    while !videoIn.isReadyForMoreMediaData { usleep(2000) }
    guard let pool = adaptor.pixelBufferPool else { fail("no pixel buffer pool") }
    var outBuffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outBuffer)
    guard let outBuffer else { fail("no pixel buffer") }
    ciContext.render(image, to: outBuffer)
    adaptor.append(outBuffer, withPresentationTime: time)
  }
  videoIn.markAsFinished()

  await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in audioDone.notify(queue: .global()) { done.resume() } }
  await writer.finishWriting()
  if writer.status != .completed { fail("write failed: \(String(describing: writer.error))") }
  print("wrote \(output.path)")
}

let args = CommandLine.arguments
guard args.count == 3 || args.count == 4 else { fail("usage: swift scripts/blur-faces.swift <input> <output> [ranges]") }
let ranges: [ClosedRange<Double>]? = args.count == 4 ? args[3].split(separator: ",").map { part in
  let ends = part.split(separator: "-").compactMap { Double($0) }
  guard ends.count == 2, ends[0] <= ends[1] else { fail("bad range: \(part)") }
  return ends[0]...ends[1]
} : nil
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
switch input.pathExtension.lowercased() {
case "mp4", "mov", "m4v": await processVideo(input, output, ranges: ranges)
case "png", "jpg", "jpeg": processImage(input, output)
default: fail("unsupported file: \(input.path)")
}
