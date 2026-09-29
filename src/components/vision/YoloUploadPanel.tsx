/**
 * YoloUploadPanel — drag an image in, run real YOLO inference, see boxes.
 *
 * This was copy-pasted into two pages (DDMOAuthorityPage and Dashboard) with
 * their own private copies of the same types and colour helpers. It is now a
 * single shared component so the two surfaces cannot drift apart.
 *
 * Backend: POST /api/yolo/detect -> server/yolo_detect.py -> Ultralytics.
 * See server/YOLO_SETUP.md for weights and tuning.
 *
 * `compact` shrinks the drop zone and type so the panel fits a narrow column
 * (citizen portal) instead of spanning a full page width.
 */
import React, { useState, useCallback, useRef } from 'react';
import { apiUrl } from '../../services/sosApi';
import { describeApiFailure, describeMissingApi, looksLikeMissingApi } from '../../services/apiErrors';
import {
  AlertTriangle, CheckCircle2, Cpu, Droplets, Eye, Flame, Loader2,
  ScanSearch, Upload, X,
} from 'lucide-react';

export interface YoloDetection {
  model: string;
  label: string;
  cls_id: number;
  confidence: number;
  /** True for civic/context classes (Potholes, person, car …) — not disasters. */
  non_disaster?: boolean;
  /** True when the box came from the COCO context pass rather than a disaster model. */
  is_context?: boolean;
  bbox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-100
}

/** What a loaded model is actually able to emit, read off its weights. */
export interface ModelManifest {
  role: 'disaster' | 'context';
  classes: string[];
  reported_classes: string[];
}

export interface YoloResult {
  ok: boolean;
  disaster_type: 'FIRE_SMOKE' | 'FLOOD' | 'DETECTED' | 'CLEAR';
  detections: YoloDetection[];
  count: number;
  image_preview: string;
  models_ran?: string[];
  models?: Record<string, ModelManifest>;
  warnings?: string[];
  /** Inference tuning the server actually used. */
  settings?: {
    conf: number; imgsz: number; iou: number; tta: boolean;
    context_conf?: number; context?: boolean;
  };
  error?: string;
}

const disasterColour = (type: string) => {
  if (type === 'FIRE_SMOKE') return { stroke: '#B42318', bg: '#FCF1F0', text: '#8A1A12' };
  if (type === 'FLOOD') return { stroke: '#1A3A6B', bg: '#EEF2F8', text: '#12294D' };
  return { stroke: '#5A5C66', bg: '#F1F1EF', text: '#14151A' };
};

/**
 * Per-CLASS colours. The old version keyed off `det.model`, so every box from a
 * model came out one identical colour and fire vs smoke was indistinguishable.
 * Classes are matched by name across both disaster and context passes.
 */
const CLASS_COLOURS: Array<{ match: RegExp; colour: string; label: string }> = [
  { match: /\bfire\b|flame|burn/i, colour: '#B42318', label: 'Fire' },
  { match: /\bsmoke\b/i, colour: '#6B7280', label: 'Smoke' },
  { match: /flood|inundat|water/i, colour: '#1A3A6B', label: 'Flood' },
  { match: /\bcar\b|vehicle/i, colour: '#B54708', label: 'Vehicle' },
  { match: /\bperson\b|people/i, colour: '#6941C6', label: 'Person' },
  { match: /boat/i, colour: '#0E7090', label: 'Boat' },
  { match: /truck|bus|motorcycle|bicycle/i, colour: '#C11574', label: 'Transport' },
  { match: /pothole/i, colour: '#7A5B00', label: 'Pothole' },
  { match: /waste|garbage|trash/i, colour: '#5A5C66', label: 'Waste' },
];

const detectionColour = (det: YoloDetection): { stroke: string } => {
  const l = det.label.toLowerCase();
  for (const c of CLASS_COLOURS) {
    if (c.match.test(l)) return { stroke: c.colour };
  }
  return det.model === 'context' ? { stroke: '#6941C6' } : disasterColour('DETECTED');
};

const classChipLabel = (label: string): string => {
  const l = label.toLowerCase();
  for (const c of CLASS_COLOURS) if (c.match.test(l)) return c.label;
  return label;
};

interface Props {
  /** Tighter layout for a narrow column. */
  compact?: boolean;
  className?: string;
}

/** One detection row: colour chip, class name, source model, confidence. */
const DetectionRow: React.FC<{ det: YoloDetection }> = ({ det }) => {
  const c = detectionColour(det);
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F1F1EF] dark:bg-[#ECECEC] border border-[#E4E4E0] dark:border-[#B4B4B4]">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.stroke }} />
        <span className="text-xs font-bold text-[#14151A] dark:text-[#FFFFFF] truncate">
          {classChipLabel(det.label)}
        </span>
        <span className="text-[10px] text-[#5A5C66] dark:text-[#D0D0D0] font-data capitalize flex-shrink-0">
          {det.model.replace('_', ' ')}
        </span>
      </div>
      <span className="text-xs font-bold font-data text-[#12294D] dark:text-[#D0D0D0] flex-shrink-0">
        {det.confidence}%
      </span>
    </div>
  );
};

export const YoloUploadPanel: React.FC<Props> = ({ compact = false, className = '' }) => {
  const [dragOver, setDragOver] = useState(false);
  const [modelType, setModelType] = useState<'auto' | 'fire_smoke' | 'flood'>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<YoloResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = (f: File) => {
    setFile(f); setResult(null); setError(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadFile(f);
  }, []);

  const clear = () => {
    setFile(null); setPreview(null); setResult(null); setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const detect = async () => {
    if (!file) return;
    setLoading(true); setResult(null); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('model_type', modelType);
      form.append('include_context', includeContext ? '1' : '0');
      const res = await fetch(apiUrl('/api/yolo/detect'), { method: 'POST', body: form });
      const data: YoloResult = await res.json().catch(() => ({}) as YoloResult);
      if (looksLikeMissingApi(res)) {
        setError(describeMissingApi('run detection'));
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Detection failed');
      setResult(data);
    } catch (err) {
      setError(describeApiFailure(err));
    } finally {
      setLoading(false);
    }
  };

  const col = result ? disasterColour(result.disaster_type) : null;

  // Three buckets, not two. The flood weights bundle civic classes (Potholes,
  // Waste Management) which are neither disaster evidence nor the COCO context
  // pass — lumping them in with people/cars would mislabel them.
  const disasterDets = (result?.detections ?? []).filter((d) => !d.non_disaster);
  const contextDets = (result?.detections ?? []).filter((d) => d.is_context);
  const civicDets = (result?.detections ?? []).filter(
    (d) => d.non_disaster && !d.is_context
  );

  // Capability matrix, computed from the manifest the server read off the live
  // weights. This is what stops the panel from implying it can see something it
  // cannot: an unbacked chip simply doesn't exist for that class.
  const manifest = result?.models ?? {};
  const available = new Set<string>();
  Object.values(manifest).forEach((m) => m.reported_classes?.forEach((c) => available.add(c.toLowerCase())));
  const has = (label: string) => available.has(label.toLowerCase());
  const CAPS: Array<{ label: string; have: boolean }> = [
    { label: 'fire', have: has('fire') },
    { label: 'smoke', have: has('smoke') },
    { label: 'tree', have: has('tree') },
    { label: 'building', have: has('building') },
    { label: 'flood', have: available.has('flooding') || has('flood') },
    { label: 'car', have: has('car') },
    { label: 'person', have: has('person') },
  ];

  return (
    <div
      data-testid="yolo-panel"
      className={`bg-white dark:bg-[#1E3A5F] border border-[#E4E4E0] dark:border-[#B4B4B4] rounded-xl shadow-xs overflow-hidden ${className}`}
    >
      {/* Panel Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E4E0] dark:border-[#B4B4B4] ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#1A3A6B] flex items-center justify-center flex-shrink-0">
            <ScanSearch className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5C66] dark:text-[#D0D0D0] font-data truncate">
              YOLO Vision • Local CPU
            </p>
            <h2 className="font-heading font-bold text-sm text-[#12294D] dark:text-[#FFFFFF] truncate">
              Disaster Image Detection
            </h2>
          </div>
        </div>

        {/* Model type selector */}
        <div className="flex items-center gap-1.5">
          {(['auto', 'fire_smoke', 'flood'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModelType(m)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                modelType === m
                  ? 'bg-[#1A3A6B] text-white shadow-xs'
                  : 'bg-[#F1F1EF] dark:bg-[#ECECEC] text-[#5A5C66] dark:text-[#D0D0D0] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038]'
              }`}
            >
              {m === 'auto' ? 'Auto (Both)' : m === 'fire_smoke' ? '🔥 Fire / Smoke' : '🌊 Flood'}
            </button>
          ))}
        </div>
      </div>

      <div className={`space-y-4 ${compact ? 'p-3' : 'p-4'}`}>
        {/* ── Drop Zone (no file selected) ── */}
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
              compact ? 'p-6' : 'p-10'
            } ${
              dragOver
                ? 'border-[#1A3A6B] bg-[#EEF2F8] dark:bg-[#ECECEC]/40'
                : 'border-[#E4E4E0] dark:border-[#B4B4B4] hover:border-[#1A3A6B]/50 hover:bg-[#F8F8F7] dark:hover:bg-[#14151A]'
            }`}
          >
            <div className={`rounded-xl bg-[#EEF2F8] dark:bg-[#ECECEC] flex items-center justify-center ${compact ? 'w-9 h-9' : 'w-12 h-12'}`}>
              <Upload className={`text-[#1A3A6B] dark:text-[#D0D0D0] ${compact ? 'w-4 h-4' : 'w-6 h-6'}`} />
            </div>
            <div className="text-center">
              <p className="font-heading font-bold text-sm text-[#12294D] dark:text-[#FFFFFF]">
                Drop an image here or click to browse
              </p>
              <p className="text-[11px] text-[#5A5C66] dark:text-[#D0D0D0] mt-1">
                JPG · PNG · BMP · WEBP — up to 20 MB
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
            />
          </div>
        ) : (
          /* ── Image + results view ── */
          <div className="space-y-3">
            {/* Preview canvas with bounding boxes */}
            <div
              className="relative w-full rounded-xl overflow-hidden bg-[#14151A]"
              style={{ aspectRatio: compact ? '4/3' : '16/9' }}
            >
              <img
                src={result?.image_preview ?? preview ?? ''}
                alt="Uploaded image"
                className="w-full h-full object-contain select-none"
              />

              {/* YOLO bounding box SVG overlay */}
              {result && result.detections.length > 0 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {result.detections.map((det, i) => {
                    const [ymin, xmin, ymax, xmax] = det.bbox;
                    const c = detectionColour(det);
                    const labelW = Math.min(100 - xmin, det.label.length * 1.65 + 14);
                    return (
                      <g key={i}>
                        <rect
                          x={xmin} y={ymin} width={xmax - xmin} height={ymax - ymin}
                          fill={`${c.stroke}25`} stroke={c.stroke} strokeWidth="0.7"
                        />
                        <rect x={xmin} y={Math.max(0, ymin - 5)} width={labelW} height="4.5" fill={c.stroke} rx="0.6" />
                        <text
                          x={xmin + 1} y={Math.max(3.5, ymin - 1.2)}
                          fill="#fff" fontSize="2.6" fontWeight="bold" fontFamily="sans-serif"
                        >
                          {det.label} {det.confidence}%
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* Inference loading overlay */}
              {loading && (
                <div className="absolute inset-0 bg-[#14151A]/70 flex flex-col items-center justify-center gap-2 px-3 text-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                  <span className="text-white text-xs font-bold font-data">
                    Running YOLO on local CPU…
                  </span>
                </div>
              )}

              <button
                onClick={clear}
                aria-label="Clear image"
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#14151A]/80 text-white flex items-center justify-center hover:bg-[#B42318] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Result summary banner */}
            {result && col && (
              <div
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-bold"
                style={{ backgroundColor: col.bg, borderColor: `${col.stroke}40`, color: col.text }}
              >
                {result.disaster_type === 'FIRE_SMOKE' && <Flame className="w-4 h-4 flex-shrink-0" style={{ color: col.stroke }} />}
                {result.disaster_type === 'FLOOD' && <Droplets className="w-4 h-4 flex-shrink-0" style={{ color: col.stroke }} />}
                {result.disaster_type === 'CLEAR' && <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#126B34] dark:text-[#D0D0D0]" />}
                {result.disaster_type === 'DETECTED' && <Eye className="w-4 h-4 flex-shrink-0" style={{ color: col.stroke }} />}
                <span className="min-w-0">
                  {result.disaster_type === 'CLEAR'
                    ? 'No disaster detected — area appears clear'
                    : `${result.disaster_type.replace('_', ' ')} detected — ${disasterDets.length} disaster object${disasterDets.length !== 1 ? 's' : ''}`}
                </span>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl border border-[#B42318]/30 bg-[#FCF1F0] text-[#8A1A12] text-xs font-bold dark:text-[#F0A0A0] dark:bg-[#3F1414]">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
                <span className="min-w-0">{error}</span>
              </div>
            )}

            {/* Server-side warnings (e.g. context pass unavailable) */}
            {result && result.warnings && result.warnings.length > 0 && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-[#B54708]/30 bg-[#FEF6E7] text-[#8A3B06] text-[11px] font-bold dark:text-[#F0C08A] dark:bg-[#3A2A10]">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                <span className="min-w-0">{result.warnings.join(' ')}</span>
              </div>
            )}

            {/* Detection list — split into disaster evidence and context */}
            {result && result.detections.length > 0 && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5C66] dark:text-[#D0D0D0]">
                    Disaster evidence ({disasterDets.length})
                    {result.settings && (
                      <span className="ml-1.5 normal-case tracking-normal font-data text-[#5A5C66] dark:text-[#D0D0D0]">
                        (conf {result.settings.conf} · {result.settings.imgsz}px{result.settings.tta ? ' · TTA' : ''})
                      </span>
                    )}
                  </p>
                  {disasterDets.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-[#5A5C66] dark:text-[#D0D0D0] italic">
                      No disaster class detected above threshold.
                    </p>
                  ) : (
                    disasterDets.map((det, i) => <DetectionRow key={`d-${i}`} det={det} />)
                  )}
                </div>

                {contextDets.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5C66] dark:text-[#D0D0D0]">
                      Context — people &amp; vehicles ({contextDets.length})
                      {result.settings?.context && (
                        <span className="ml-1.5 normal-case tracking-normal font-data">
                          conf {result.settings.context_conf}
                        </span>
                      )}
                    </p>
                    {contextDets.map((det, i) => <DetectionRow key={`c-${i}`} det={det} />)}
                    <p className="px-1 text-[10px] text-[#5A5C66] dark:text-[#D0D0D0]">
                      Context boxes are situational awareness only — they do not
                      influence the disaster verdict.
                    </p>
                  </div>
                )}

                {/* Civic classes bundled into the flood weights (Potholes,
                    Waste Management). Real detections, but not disasters, and
                    the reason the flood model fires on ordinary street scenes. */}
                {civicDets.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5C66] dark:text-[#D0D0D0]">
                      Other classes bundled in these weights ({civicDets.length})
                    </p>
                    {civicDets.map((det, i) => <DetectionRow key={`o-${i}`} det={det} />)}
                    <p className="px-1 text-[10px] text-[#5A5C66] dark:text-[#D0D0D0]">
                      Not disasters. `flood.pt` ships these two civic classes
                      alongside <code>Flooding</code>, which dilutes flood
                      precision — a flood-only retrain removes them.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Capability matrix — honest about what the loaded weights can see */}
            {result && Object.keys(manifest).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[#E4E4E0] dark:border-[#B4B4B4]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5C66] dark:text-[#D0D0D0]">
                  Model capability
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CAPS.map((c) => (
                    <span
                      key={c.label}
                      title={c.have
                        ? `Detectable — loaded weights contain "${c.label}"`
                        : `NOT detectable — no loaded model has a "${c.label}" class`}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold font-data border ${
                        c.have
                          ? 'bg-[#F1F8F3] dark:bg-[#0A2E22]/40 border-[#B7E4C7] dark:border-[#14532D] text-[#126B34] dark:text-[#A6E3BC]'
                          : 'bg-[#F1F1EF] dark:bg-[#2A2A2A] border-[#E4E4E0] dark:border-[#4A4A4A] text-[#8A8A8A] line-through'
                      }`}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
                {CAPS.some((c) => !c.have) && (
                  <p className="px-1 text-[10px] text-[#5A5C66] dark:text-[#D0D0D0]">
                    Crossed-out classes are absent from the loaded weights — a
                    YOLO model can only emit classes it was trained on. They are
                    listed as unavailable rather than reported as "0 detected",
                    so a real absence is never mistaken for a missing feature.
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1">
              <label
                title="Also run a COCO-pretrained pass for person and car boxes. These are situational awareness only and never change the disaster verdict."
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#F1F1EF] dark:bg-[#ECECEC] border border-[#E4E4E0] dark:border-[#B4B4B4] cursor-pointer select-none flex-shrink-0"
              >
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(e) => setIncludeContext(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#1A3A6B] cursor-pointer"
                />
                <span className="text-[10px] font-bold font-data text-[#5A5C66] dark:text-[#D0D0D0] whitespace-nowrap">
                  + people/vehicles
                </span>
              </label>
              <button
                onClick={detect}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-[#1A3A6B] hover:bg-[#142C52] disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
              >
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Detecting…</span></>
                  : <><Cpu className="w-3.5 h-3.5" /><span>Run YOLO Detection</span></>}
              </button>
              <button
                onClick={clear}
                className="px-4 py-2.5 rounded-xl bg-[#F1F1EF] dark:bg-[#ECECEC] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038] text-[#5A5C66] dark:text-[#D0D0D0] text-xs font-bold border border-[#E4E4E0] dark:border-[#B4B4B4] transition-all cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
