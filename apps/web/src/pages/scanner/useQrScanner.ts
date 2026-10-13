import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import {
  classifyCameraError,
  describeCameraFailure,
  describeEnvironmentFailure,
  queryCameraPermission,
  type CameraFailure,
} from './camera-permission'

/**
 * Pembacaan QR dari kamera (PRD §95–§97).
 *
 * Tiga keputusan teknis yang perlu dicatat:
 *
 *   1. **`jsqr`, bukan `BarcodeDetector`.** Yang kedua lebih cepat, tetapi hanya
 *      ada di sebagian browser (tidak di Firefox dan Safari). Satu jalur yang
 *      jalan di mana-mana lebih penting daripada kecepatan yang tidak terasa
 *      bedanya untuk scan tiket.
 *   2. **`facingMode: 'environment'`** supaya kamera belakang ponsel yang dipakai
 *      — panitia memindai layar peserta, bukan wajahnya sendiri. Bila perangkat
 *      menolak batasan itu (webcam laptop), dicoba sekali lagi tanpa batasan.
 *   3. **Kamera hanya hidup selama halaman ini terbuka**, dan selalu dimatikan
 *      saat komponen dilepas: lampu kamera yang menyala tanpa sebab akan membuat
 *      operator curiga, dan itu wajar.
 *
 * Kegagalan TIDAK pernah dilaporkan sebagai "gagal" generik — lihat
 * `camera-permission.ts` untuk alasannya.
 */
export type ScannerStatus = 'idle' | 'starting' | 'scanning'

export type QrScanner = {
  status: ScannerStatus
  failure: CameraFailure | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  start: () => Promise<void>
  stop: () => void
}

/** Lebar frame yang didekode. Cukup untuk QR di layar ponsel, jauh lebih ringan. */
const DECODE_WIDTH = 480

/** Jeda antar-frame. ~7 kali per detik: cukup responsif, tidak membakar CPU. */
const FRAME_INTERVAL_MS = 140

export function useQrScanner(onDecode: (payload: string) => void): QrScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onDecodeRef = useRef(onDecode)

  const [status, setStatus] = useState<ScannerStatus>('idle')
  const [failure, setFailure] = useState<CameraFailure | null>(null)

  // Callback disimpan di ref supaya loop tidak perlu dipasang ulang setiap render.
  useEffect(() => {
    onDecodeRef.current = onDecode
  }, [onDecode])

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null

    if (videoRef.current !== null) videoRef.current.srcObject = null
    setStatus('idle')
    setFailure(null)
  }, [])

  const start = useCallback(async () => {
    // 1. Bisa dipakai sama sekali? (konteks aman + API tersedia)
    const environmentFailure = describeEnvironmentFailure()
    if (environmentFailure !== null) {
      setFailure(environmentFailure)
      return
    }

    // 2. Izin sudah pasti ditolak? Memintanya lagi akan gagal tanpa dialog, dan
    //    operator tidak akan tahu sebabnya.
    const permission = await queryCameraPermission()
    if (permission === 'denied') {
      setFailure(describeCameraFailure('denied'))
      return
    }

    setStatus('starting')
    setFailure(null)

    const stream = await requestStream()
    if ('failure' in stream) {
      setStatus('idle')
      setFailure(stream.failure)
      return
    }

    streamRef.current = stream.stream
    const video = videoRef.current
    if (video === null) {
      stop()
      return
    }

    video.srcObject = stream.stream
    try {
      await video.play()
    } catch {
      // Autoplay bisa ditolak; loop tetap berjalan selama frame tersedia.
    }

    setStatus('scanning')

    timerRef.current = window.setInterval(() => {
      const canvas = canvasRef.current ?? document.createElement('canvas')
      canvasRef.current = canvas

      const width = DECODE_WIDTH
      const height = Math.round((video.videoHeight / (video.videoWidth || 1)) * width)
      if (height === 0) return

      canvas.width = width
      canvas.height = height

      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return

      context.drawImage(video, 0, 0, width, height)
      const image = context.getImageData(0, 0, width, height)
      const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })

      if (found !== null && found.data !== '') onDecodeRef.current(found.data)
    }, FRAME_INTERVAL_MS)
  }, [stop])

  // Kamera selalu dimatikan saat halaman ditinggalkan.
  useEffect(() => stop, [stop])

  return { status, failure, videoRef, start, stop }
}

type StreamResult = { stream: MediaStream } | { failure: CameraFailure }

/**
 * Minta stream kamera, dengan satu percobaan ulang tanpa batasan `facingMode`.
 *
 * Webcam laptop umumnya tidak punya kamera "environment"; tanpa percobaan kedua,
 * aplikasi akan terlihat rusak justru saat diuji di komputer.
 */
async function requestStream(): Promise<StreamResult> {
  const media = navigator.mediaDevices

  try {
    return {
      stream: await media.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }),
    }
  } catch (error) {
    const kind = classifyCameraError(error)
    if (kind !== 'no-camera') return { failure: describeCameraFailure(kind) }

    try {
      return { stream: await media.getUserMedia({ video: true, audio: false }) }
    } catch {
      return { failure: describeCameraFailure('no-camera') }
    }
  }
}
