import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  QrCode,
  Camera,
  CameraOff,
  Download,
  ArrowLeft,
  Search,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import api from './services/api'
import { ShopkeeperLayout } from './components/layout/ShopkeeperLayout'
import { Card } from './components/ui/Card'
import { Button } from './components/ui/Button'
import { Input } from './components/ui/Input'
import { apiError } from './utils/formatters'

const SCAN_PLACEHOLDER = 'DETOMSITE-ORDER:… or enter order ID'

type BarcodeDetectorCtor = new (opts: { formats: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>
}

export default function ScanOrderPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [manual, setManual] = useState('')
  const [scanMsg, setScanMsg] = useState('')
  const [scanErr, setScanErr] = useState('')
  const [cameraOn, setCameraOn] = useState(false)

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const lookup = useCallback(
    async (code: string) => {
      const raw = (code || '').trim()
      if (!raw) {
        setScanErr('Enter or scan an order code')
        return
      }
      setScanErr('')
      setScanMsg('Looking up order in database…')
      try {
        await api.get(`/vendor/orders/lookup?code=${encodeURIComponent(raw)}`)
        stopCamera()
        navigate('/mobile/orders')
      } catch (err: any) {
        setScanErr(apiError(err, 'Order not found'))
        setScanMsg('')
      }
    },
    [navigate, stopCamera]
  )

  const startCamera = async () => {
    setScanErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
      const tick = async () => {
        const video = videoRef.current
        const Detector = (window as any).BarcodeDetector as BarcodeDetectorCtor | undefined
        if (video && Detector) {
          try {
            const codes = await new Detector({ formats: ['qr_code'] }).detect(video)
            const value = codes?.[0]?.rawValue
            if (value) {
              await lookup(value)
              return
            }
          } catch {
            /* normal frame decode skip */
          }
        }
        rafRef.current = requestAnimationFrame(() => {
          void tick()
        })
      }
      rafRef.current = requestAnimationFrame(() => {
        void tick()
      })
    } catch {
      setScanErr('Camera not accessible — type the order code manually below instead.')
      setCameraOn(false)
    }
  }

  const downloadScanner = () => {
    const origin = window.location.origin
    const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DETOMSITE — Order Scanner</title>
<style>body{font-family:system-ui;margin:2rem;max-width:30rem}
input{font-size:1.1rem;padding:.6rem;width:100%;box-sizing:border-box}
button{font-size:1rem;padding:.7rem 1rem;width:100%;margin-top:.6rem}
a.btn{display:block;text-align:center;text-decoration:none;padding:.8rem;background:#15803d;color:#fff;border-radius:0;margin-top:1rem}</style>
</head><body>
<h1>DETOMSITE — Order Scanner</h1>
<p>Type the order id printed under the student's QR, then open the shopkeeper app.</p>
<input id="code" placeholder="order id" autocomplete="off">
<button onclick="go()">Open in shopkeeper app</button>
<a class="btn" href="${origin}/scan">Camera scanner</a>
<script>function go(){var c=document.getElementById('code').value.trim();
if(!c)return;window.open('${origin}/scan?code='+encodeURIComponent(c),'_blank');}</script>
</body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'detomsite-order-scanner.html'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <ShopkeeperLayout>
      <div className="max-w-xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-main)] pb-3">
          <div className="flex items-center gap-2">
            <Link
              to="/mobile"
              className="p-2 text-[var(--text-dim)] hover:text-[var(--text-heading)] border border-[var(--border-main)] rounded-lg hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-[var(--text-heading)] flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-600" />
                Scan & Verify Order
              </h1>
              <p className="text-[11px] text-[var(--text-muted)]">
                Scan the QR code shown on the student's phone to pull up order
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={downloadScanner}
          >
            Standalone Scanner
          </Button>
        </div>

        {/* Camera Viewfinder */}
        <Card noPadding>
          <div className="relative overflow-hidden bg-black aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={cameraOn ? 'h-full w-full object-cover' : 'hidden'}
            />
            {!cameraOn && (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <CameraOff className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-xs font-semibold">Camera is currently paused</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                  Tap "Start Camera" to scan student QR codes in real-time
                </p>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[var(--border-main)] bg-[var(--bg-surface-subtle)] flex gap-2">
            {!cameraOn ? (
              <Button
                variant="primary"
                size="md"
                icon={<Camera className="w-4 h-4" />}
                onClick={() => void startCamera()}
                className="w-full"
              >
                Start Camera Scanner
              </Button>
            ) : (
              <Button
                variant="danger"
                size="md"
                icon={<CameraOff className="w-4 h-4" />}
                onClick={stopCamera}
                className="w-full"
              >
                Stop Camera
              </Button>
            )}
          </div>
        </Card>

        {/* Manual Lookup Card */}
        <Card
          title={
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
              <Search className="w-4 h-4 text-emerald-600" />
              Manual Order Code Lookup
            </span>
          }
          subtitle="If student's phone screen is cracked or camera is unavailable"
        >
          <div className="space-y-3">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookup(manual)
              }}
              placeholder={SCAN_PLACEHOLDER}
            />

            <Button
              variant="primary"
              size="md"
              onClick={() => void lookup(manual)}
              className="w-full"
            >
              Lookup & Open Order
            </Button>
          </div>
        </Card>

        {scanMsg && (
          <div className="p-3.5 rounded-xl border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{scanMsg}</span>
          </div>
        )}

        {scanErr && (
          <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{scanErr}</span>
          </div>
        )}
      </div>
    </ShopkeeperLayout>
  )
}
