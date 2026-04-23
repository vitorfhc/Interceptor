// @ts-expect-error ocrad.js does not ship TypeScript declarations
import OCRAD from "ocrad.js/ocrad.js"

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return

  switch (msg.type) {
    case "crop":
      cropImage(msg.dataUrl, msg.clip).then(sendResponse)
      return true

    case "stitch":
      stitchImages(msg.strips, msg.totalWidth, msg.totalHeight, msg.format, msg.quality).then(sendResponse)
      return true

    case "diff":
      diffImages(msg.image1, msg.image2, msg.threshold, msg.returnImage).then(sendResponse)
      return true

    case "ocr":
      ocrImage(msg.dataUrl).then(sendResponse)
      return true

    case "capture_start":
      startCapture(msg.streamId)
      return false

    case "capture_frame":
      captureFrame(msg.format, msg.quality).then(sendResponse)
      return true

    case "capture_stop":
      stopCapture()
      sendResponse({ success: true })
      return false
  }
})

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("image load failed"))
    img.src = dataUrl
  })
}

async function cropImage(dataUrl: string, clip: { x: number; y: number; width: number; height: number }) {
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement("canvas")
    canvas.width = clip.width
    canvas.height = clip.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2d context unavailable")
    ctx.drawImage(img, clip.x, clip.y, clip.width, clip.height, 0, 0, clip.width, clip.height)
    const result = canvas.toDataURL("image/jpeg", 0.8)
    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

async function stitchImages(
  strips: Array<{ y: number; dataUrl: string }>,
  totalWidth: number,
  totalHeight: number,
  format: string,
  quality: number
) {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = totalWidth
    canvas.height = totalHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2d context unavailable")

    for (const strip of strips) {
      const img = await loadImage(strip.dataUrl)
      ctx.drawImage(img, 0, strip.y)
    }

    const mimeType = format === "png" ? "image/png" : "image/jpeg"
    const result = canvas.toDataURL(mimeType, quality || 0.5)
    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

async function diffImages(image1: string, image2: string, threshold: number, returnImage: boolean) {
  try {
    const [img1, img2] = await Promise.all([loadImage(image1), loadImage(image2)])
    const w = Math.max(img1.width, img2.width)
    const h = Math.max(img1.height, img2.height)

    const c1 = document.createElement("canvas")
    c1.width = w
    c1.height = h
    const ctx1 = c1.getContext("2d")
    if (!ctx1) throw new Error("2d context unavailable")
    ctx1.drawImage(img1, 0, 0)
    const d1 = ctx1.getImageData(0, 0, w, h)

    const c2 = document.createElement("canvas")
    c2.width = w
    c2.height = h
    const ctx2 = c2.getContext("2d")
    if (!ctx2) throw new Error("2d context unavailable")
    ctx2.drawImage(img2, 0, 0)
    const d2 = ctx2.getImageData(0, 0, w, h)

    const thr = threshold || 0
    let changedPixels = 0
    const totalPixels = w * h
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0

    let diffCanvas: HTMLCanvasElement | null = null
    let diffCtx: CanvasRenderingContext2D | null = null
    let diffData: ImageData | null = null

    if (returnImage) {
      diffCanvas = document.createElement("canvas")
      diffCanvas.width = w
      diffCanvas.height = h
      diffCtx = diffCanvas.getContext("2d")
      if (!diffCtx) throw new Error("2d context unavailable")
      diffData = diffCtx.createImageData(w, h)
    }

    for (let i = 0; i < d1.data.length; i += 4) {
      const dr = Math.abs(d1.data[i] - d2.data[i])
      const dg = Math.abs(d1.data[i + 1] - d2.data[i + 1])
      const db = Math.abs(d1.data[i + 2] - d2.data[i + 2])
      const changed = dr > thr || dg > thr || db > thr

      if (changed) {
        changedPixels++
        const px = (i / 4) % w
        const py = Math.floor((i / 4) / w)
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }

      if (diffData) {
        diffData.data[i] = changed ? 255 : d1.data[i]
        diffData.data[i + 1] = changed ? 0 : d1.data[i + 1]
        diffData.data[i + 2] = changed ? 0 : d1.data[i + 2]
        diffData.data[i + 3] = 255
      }
    }

    const result: Record<string, unknown> = {
      changedPixels,
      totalPixels,
      changedPercent: Math.round((changedPixels / totalPixels) * 10000) / 100,
      boundingBox: changedPixels > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
    }

    if (diffData && diffCtx && diffCanvas) {
      diffCtx.putImageData(diffData, 0, 0)
      result.diffImage = diffCanvas.toDataURL("image/png")
    }

    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

async function ocrImage(dataUrl: string) {
  try {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("2d context unavailable")
    ctx.drawImage(img, 0, 0)
    const text = OCRAD(canvas)
    return {
      success: true,
      data: {
        text,
        source: "ocrad-offscreen",
        confidence: null
      }
    }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

let captureStream: MediaStream | null = null
let captureVideo: HTMLVideoElement | null = null
let captureCanvas: HTMLCanvasElement | null = null
let captureCtx: CanvasRenderingContext2D | null = null
let captureAudioCtx: AudioContext | null = null

async function startCapture(streamId: string) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints
    })
    captureStream = stream

    captureAudioCtx = new AudioContext()
    const source = captureAudioCtx.createMediaStreamSource(stream)
    source.connect(captureAudioCtx.destination)

    captureVideo = document.createElement("video")
    captureVideo.srcObject = stream
    captureVideo.muted = true
    await captureVideo.play()
  } catch (e) {
    console.error("capture start failed:", e)
  }
}

async function captureFrame(format?: string, quality?: number) {
  if (!captureVideo || !captureStream) {
    return { success: false, error: "no active capture — run capture start first" }
  }
  try {
    if (!captureCanvas || captureCanvas.width !== captureVideo.videoWidth || captureCanvas.height !== captureVideo.videoHeight) {
      captureCanvas = document.createElement("canvas")
      captureCanvas.width = captureVideo.videoWidth
      captureCanvas.height = captureVideo.videoHeight
      captureCtx = captureCanvas.getContext("2d")
    }
    if (!captureCtx || !captureCanvas) throw new Error("capture canvas unavailable")
    captureCtx.drawImage(captureVideo, 0, 0)
    const dataUrl = captureCanvas.toDataURL(format, quality)
    return { success: true, data: dataUrl }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

function stopCapture() {
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop())
    captureStream = null
  }
  if (captureVideo) {
    captureVideo.srcObject = null
    captureVideo = null
  }
  if (captureAudioCtx) {
    void captureAudioCtx.close()
    captureAudioCtx = null
  }
  captureCanvas = null
  captureCtx = null
}
