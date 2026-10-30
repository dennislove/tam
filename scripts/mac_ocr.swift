// OCR helper dùng Apple Vision. Usage: mac_ocr <image.png>
// Output mỗi dòng: text \t x \t y \t w \t h   (tọa độ chuẩn hóa 0..1, gốc trên-trái)
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot load image\n".data(using: .utf8)!)
  exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["vi-VN", "en-US"]
req.usesLanguageCorrection = false
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
for obs in (req.results ?? []) {
  guard let top = obs.topCandidates(1).first else { continue }
  let b = obs.boundingBox
  let text = top.string.replacingOccurrences(of: "\t", with: " ")
  print(String(format: "%@\t%.4f\t%.4f\t%.4f\t%.4f", text, b.minX, 1 - b.maxY, b.width, b.height))
}
