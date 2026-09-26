import React, { useState, useCallback, useRef } from 'react';
import { TopBar } from '../components/dashboard/TopBar';
import { KPIRow } from '../components/dashboard/KPIRow';
import { ZoneMap } from '../components/dashboard/ZoneMap';
import { SOSQueue } from '../components/dashboard/SOSQueue';
import { CommTierStrip } from '../components/dashboard/CommTierStrip';
import { ScenarioPanel } from '../components/dashboard/ScenarioPanel';
import {
  Shield, ArrowLeft, Radio, Cpu, Camera, AlertTriangle, Home, Navigation,
  Upload, X, Flame, Droplets, Eye, CheckCircle2, Loader2, ScanSearch,
} from 'lucide-react';
import { useNexoraStore } from '../store/useNexoraStore';
import { getTranslation } from '../i18n/translations';

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface YoloDetection {
  model:      string;
  label:      string;
  confidence: number;
  bbox:       [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-100
}

interface YoloResult {
  ok:            boolean;
  disaster_type: 'FIRE_SMOKE' | 'FLOOD' | 'DETECTED' | 'CLEAR';
  detections:    YoloDetection[];
  count:         number;
  image_preview: string;
  error?:        string;
}

/* ─── Colour helpers ───────────────────────────────────────────────────────── */
const disasterColour = (type: string) => {
  if (type === 'FIRE_SMOKE') return { stroke: '#E05C2A', bg: '#FBE9E7', text: '#8A2000' };
  if (type === 'FLOOD')      return { stroke: '#1A3A6B', bg: '#EEF2F8', text: '#12294D' };
  return                            { stroke: '#5A5C66', bg: '#F1F1EF', text: '#14151A' };
};

/* ─── YOLO Upload Panel ────────────────────────────────────────────────────── */
const YoloUploadPanel: React.FC = () => {
  const [dragOver,  setDragOver]  = useState(false);
  const [modelType, setModelType] = useState<'auto' | 'fire_smoke' | 'flood'>('auto');
  const [file,      setFile]      = useState<File | null>(null);
  const [preview,   setPreview]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState<YoloResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);
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
      const res  = await fetch('/api/yolo/detect', { method: 'POST', body: form });
      const data: YoloResult = await res.json();
      if (!res.ok || !data.ok) throw new Error((data as any).error || 'Detection failed');
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const detectionColour = (det: YoloDetection) => {
    const l = det.label.toLowerCase();
    if (det.model === 'fire_smoke' || l.includes('fire') || l.includes('smoke') || l.includes('flame'))
      return disasterColour('FIRE_SMOKE');
    if (det.model === 'flood' || l.includes('flood') || l.includes('water'))
      return disasterColour('FLOOD');
    return disasterColour('DETECTED');
  };

  const col = result ? disasterColour(result.disaster_type) : null;

  return (
    <div className="bg-white dark:bg-[#17181C] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl shadow-xs overflow-hidden">

      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-[#DEDEDA] dark:border-[#2E3038]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#1A3A6B] flex items-center justify-center flex-shrink-0">
            <ScanSearch className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC] font-data">
              YOLO Vision • Local GPU
            </p>
            <h2 className="font-heading font-bold text-sm text-[#12294D] dark:text-[#F1F1EF]">
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
                  : 'bg-[#F1F1EF] dark:bg-[#1C1D22] text-[#5A5C66] dark:text-[#A1A3AC] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038]'
              }`}
            >
              {m === 'auto' ? 'Auto (Both)' : m === 'fire_smoke' ? '🔥 Fire / Smoke' : '🌊 Flood'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* ── Drop Zone (no file selected) ── */}
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-all ${
              dragOver
                ? 'border-[#1A3A6B] bg-[#EEF2F8] dark:bg-[#1B2434]/40'
                : 'border-[#DEDEDA] dark:border-[#2E3038] hover:border-[#1A3A6B]/50 hover:bg-[#F8F9FC] dark:hover:bg-[#1C1D22]'
            }`}
          >
            <div className="w-12 h-12 rounded-xl bg-[#EEF2F8] dark:bg-[#1C1D22] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[#1A3A6B] dark:text-[#9DB8DC]" />
            </div>
            <div className="text-center">
              <p className="font-heading font-bold text-sm text-[#12294D] dark:text-[#F1F1EF]">
                Drop an image here or click to browse
              </p>
              <p className="text-[11px] text-[#6B6D77] dark:text-[#A1A3AC] mt-1">
                JPG · PNG · BMP · WEBP — up to 20 MB
              </p>
            </div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
          </div>
        ) : (

          /* ── Image + results view ── */
          <div className="space-y-3">

            {/* Preview canvas with bounding boxes */}
            <div className="relative w-full rounded-xl overflow-hidden bg-[#14151A]" style={{ aspectRatio: '16/9' }}>
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
                        <rect x={xmin} y={ymin} width={xmax - xmin} height={ymax - ymin}
                          fill={`${c.stroke}25`} stroke={c.stroke} strokeWidth="0.7" />
                        <rect x={xmin} y={Math.max(0, ymin - 5)} width={labelW} height="4.5"
                          fill={c.stroke} rx="0.6" />
                        <text x={xmin + 1} y={Math.max(3.5, ymin - 1.2)}
                          fill="#fff" fontSize="2.6" fontWeight="bold" fontFamily="sans-serif">
                          {det.label} {det.confidence}%
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* GPU loading overlay */}
              {loading && (
                <div className="absolute inset-0 bg-[#14151A]/70 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                  <span className="text-white text-xs font-bold font-data">Running YOLO on local GPU…</span>
                </div>
              )}

              {/* Clear button */}
              <button onClick={clear}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#14151A]/80 text-white flex items-center justify-center hover:bg-[#B42318] transition-colors cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Result summary banner */}
            {result && col && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-bold"
                style={{ backgroundColor: col.bg, borderColor: `${col.stroke}40`, color: col.text }}>
                {result.disaster_type === 'FIRE_SMOKE' && <Flame    className="w-4 h-4 flex-shrink-0" style={{ color: col.stroke }} />}
                {result.disaster_type === 'FLOOD'      && <Droplets className="w-4 h-4 flex-shrink-0" style={{ color: col.stroke }} />}
                {result.disaster_type === 'CLEAR'      && <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#126B34]" />}
                {result.disaster_type === 'DETECTED'   && <Eye      className="w-4 h-4 flex-shrink-0" style={{ color: col.stroke }} />}
                <span>
                  {result.disaster_type === 'CLEAR'
                    ? 'No disaster detected — area appears clear'
                    : `${result.disaster_type.replace('_', ' ')} detected — ${result.count} object${result.count !== 1 ? 's' : ''} found`}
                </span>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#B42318]/30 bg-[#FBE9E7] text-[#8A1A12] text-xs font-bold">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Detection list */}
            {result && result.detections.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC]">
                  Detections ({result.count})
                </p>
                {result.detections.map((det, i) => {
                  const c = detectionColour(det);
                  return (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F1F1EF] dark:bg-[#1C1D22] border border-[#DEDEDA] dark:border-[#2E3038]">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.stroke }} />
                        <span className="text-xs font-bold text-[#14151A] dark:text-[#F1F1EF]">{det.label}</span>
                        <span className="text-[10px] text-[#6B6D77] dark:text-[#A1A3AC] font-data capitalize">{det.model.replace('_', ' ')}</span>
                      </div>
                      <span className="text-xs font-bold font-data text-[#12294D] dark:text-[#9DB8DC]">{det.confidence}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={detect} disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-[#1A3A6B] hover:bg-[#142C52] disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs">
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Detecting…</span></>
                  : <><Cpu     className="w-3.5 h-3.5" /><span>Run YOLO Detection</span></>}
              </button>
              <button onClick={clear}
                className="px-4 py-2.5 rounded-xl bg-[#F1F1EF] dark:bg-[#1C1D22] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038] text-[#5A5C66] dark:text-[#A1A3AC] text-xs font-bold border border-[#DEDEDA] dark:border-[#2E3038] transition-all cursor-pointer">
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Main Page ────────────────────────────────────────────────────────────── */
export const DDMOAuthorityPage: React.FC = () => {
  const { setCurrentView, currentLanguage, overallRiskLevel, rainfallMmPerHour, windSpeedKmh, sosReports, embankmentBreached } = useNexoraStore();
  const t = (k: string, f?: string) => getTranslation(currentLanguage, k, f);

  const isCritical  = overallRiskLevel === 'CRITICAL';
  const activeSOS   = sosReports.filter(r => r.status === 'PENDING' || r.status === 'TRIAGED').length;
  const peopleAtRisk = sosReports.filter(r => r.status !== 'RESCUED' && r.status !== 'FALSE_ALARM').reduce((acc, c) => acc + c.peopleCount, 0) * 120 + (embankmentBreached ? 840 : 0);

  return (
    <div data-testid="ddmo-authority-page" className="min-h-screen text-[#14151A] dark:text-[#F1F1EF] flex flex-col font-body">
      <TopBar />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 space-y-5">

        {/* COMMAND PAGE HEADER */}
        <div className="bg-white dark:bg-[#17181C] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentView('COMMAND_DASHBOARD')}
              className="p-2 rounded-xl bg-[#F1F1EF] dark:bg-[#0D0E12] hover:bg-[#EEF2F8] dark:hover:bg-[#1C1D22] text-[#6B6D77] dark:text-[#A1A3AC] hover:text-[#1A3A6B] dark:hover:text-[#F1F1EF] border border-[#DEDEDA] dark:border-[#2E3038] transition-colors cursor-pointer"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-[#1A3A6B] dark:bg-[#1C1D22] border border-[#1A3A6B] dark:border-[#2E3038] flex items-center justify-center flex-shrink-0 shadow-xs">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC] font-data">
                  {t('role_ddmo_title', 'DDMO Authority')}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-data border ${
                  isCritical ? 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30' : 'bg-[#126B34]/10 text-[#126B34] dark:text-[#5BBF7A] border-[#126B34]/30'
                }`}>
                  {isCritical ? t('critical', 'CRITICAL') : 'OPERATIONAL MONITORING'}
                </span>
              </div>
              <h1 className="font-heading text-lg sm:text-xl font-bold text-[#14151A] dark:text-[#F1F1EF] mt-0.5">
                {t('ddmo_title', 'DDMO Disaster Authority & Command Center')}
              </h1>
            </div>
          </div>

          {/* Quick status telemetry pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-data">
            <div className="bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] px-3 py-1.5 rounded-xl">
              <span className="text-[#6B6D77] dark:text-[#A1A3AC] text-[10px] block">{t('active_incidents', 'Active Incidents')}</span>
              <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">{activeSOS} Calls</span>
            </div>
            <div className="bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] px-3 py-1.5 rounded-xl">
              <span className="text-[#6B6D77] dark:text-[#A1A3AC] text-[10px] block">{t('affected_pop', 'Population At Risk')}</span>
              <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">~{peopleAtRisk.toLocaleString()}</span>
            </div>
            <div className="bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] px-3 py-1.5 rounded-xl">
              <span className="text-[#6B6D77] dark:text-[#A1A3AC] text-[10px] block">{t('water_level', 'Water Depth')}</span>
              <span className="font-bold text-[#1A3A6B] dark:text-[#9DB8DC]">82 cm (Danger: 95cm)</span>
            </div>
            <div className="bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] px-3 py-1.5 rounded-xl">
              <span className="text-[#6B6D77] dark:text-[#A1A3AC] text-[10px] block">{t('rainfall', 'Rainfall')}</span>
              <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">{rainfallMmPerHour} mm/h</span>
            </div>
            <div className="bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] px-3 py-1.5 rounded-xl">
              <span className="text-[#6B6D77] dark:text-[#A1A3AC] text-[10px] block">{t('wind_speed', 'Wind')}</span>
              <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">{windSpeedKmh} km/h</span>
            </div>
          </div>
        </div>

        {/* 4 OPERATIONAL KPI METRICS ROW */}
        <KPIRow />

        {/* MAIN OPERATIONAL GRID: MAP + PRIORITY QUEUE SIDE-BY-SIDE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8"><ZoneMap /></div>
          <div className="lg:col-span-4"><SOSQueue /></div>
        </div>

        {/* ── YOLO DISASTER IMAGE DETECTION PANEL ── */}
        <YoloUploadPanel />

        {/* CONNECTED LIFECYCLE QUICK WORKFLOW SHORTCUTS */}
        <div className="bg-white dark:bg-[#17181C] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-heading font-bold text-[#14151A] dark:text-[#F1F1EF] uppercase tracking-wider text-[11px]">Command Lifecycle:</span>
            <span className="text-[#6B6D77] dark:text-[#A1A3AC] hidden sm:inline">Sensors → AI Risk → Drone Vision → Alerts → Evacuation → Resources</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setCurrentView('SENSORS')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" /><span>Sensors</span>
            </button>
            <button onClick={() => setCurrentView('AI_RISK')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" /><span>AI Risk</span>
            </button>
            <button onClick={() => setCurrentView('DAMAGE_DETECTION')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" /><span>Drone Vision</span>
            </button>
            <button onClick={() => setCurrentView('ALERTS')}
              className="px-3 py-1.5 rounded-lg bg-[#B42318]/10 text-[#B42318] hover:bg-[#B42318]/20 border border-[#B42318]/20 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[#B42318]" /><span>Broadcast Alerts</span>
            </button>
            <button onClick={() => setCurrentView('SHELTER_EVACUATION')}
              className="px-3 py-1.5 rounded-lg bg-[#126B34]/10 text-[#126B34] dark:text-[#5BBF7A] hover:bg-[#126B34]/20 border border-[#126B34]/20 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5">
              <Home className="w-3.5 h-3.5 text-[#126B34] dark:text-[#5BBF7A]" /><span>Safe Routes</span>
            </button>
            <button onClick={() => setCurrentView('EMERGENCY_RESOURCES')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" /><span>Fleet Logistics</span>
            </button>
          </div>
        </div>

        {/* COMMUNICATION TIER TELEMETRY STRIP */}
        <CommTierStrip />

        {/* SCENARIO SIMULATION CONTROLS */}
        <ScenarioPanel />

      </main>

      <footer className="bg-white dark:bg-[#17181C] border-t border-[#DEDEDA] dark:border-[#2E3038] py-4 px-6 mt-8 text-center text-xs text-[#6B6D77] dark:text-[#A1A3AC]">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 font-data">
          <span>NEXORA Disaster Command • State Emergency Operations Centre (SEOC)</span>
          <span>Incident Command System ICS-2026 Protocol</span>
        </div>
      </footer>
    </div>
  );
};
