import React, { useState, useCallback, useRef } from 'react';
import {
  Shield, Smartphone, Home, Droplets, CloudRain, Wind,
  ArrowRight, AlertTriangle, Compass, CheckCircle2, ChevronRight,
  Upload, X, Flame, Eye, Loader2, ScanSearch, Cpu,
} from 'lucide-react';
import { TopBar } from '../components/dashboard/TopBar';
import { useNexoraStore } from '../store/useNexoraStore';
import { getTranslation } from '../i18n/translations';

/* ─── helpers ──────────────────────────────────────────────────────────────── */
interface YoloDetection {
  model: string; label: string; confidence: number;
  bbox: [number, number, number, number];
}
interface YoloResult {
  ok: boolean; disaster_type: 'FIRE_SMOKE' | 'FLOOD' | 'DETECTED' | 'CLEAR';
  detections: YoloDetection[]; count: number; image_preview: string; error?: string;
}
const dc = (t: string) => {
  if (t === 'FIRE_SMOKE') return { stroke: '#E05C2A', bg: '#FBE9E7', text: '#8A2000' };
  if (t === 'FLOOD')      return { stroke: '#1A3A6B', bg: '#EEF2F8', text: '#12294D' };
  return                         { stroke: '#5A5C66', bg: '#F1F1EF', text: '#14151A' };
};

/* ─── YOLO Panel ───────────────────────────────────────────────────────────── */
const YoloUploadPanel: React.FC = () => {
  const [dragOver,  setDragOver]  = useState(false);
  const [modelType, setModelType] = useState<'auto'|'fire_smoke'|'flood'>('auto');
  const [file,      setFile]      = useState<File|null>(null);
  const [preview,   setPreview]   = useState<string|null>(null);
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState<YoloResult|null>(null);
  const [error,     setError]     = useState<string|null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = (f: File) => {
    setFile(f); setResult(null); setError(null);
    const r = new FileReader();
    r.onload = (e) => setPreview(e.target?.result as string);
    r.readAsDataURL(f);
  };
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) loadFile(f);
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
    } catch (e: any) { setError(e.message || 'Unknown error'); }
    finally { setLoading(false); }
  };
  const detCol = (d: YoloDetection) => {
    const l = d.label.toLowerCase();
    if (d.model==='fire_smoke'||l.includes('fire')||l.includes('smoke')) return dc('FIRE_SMOKE');
    if (d.model==='flood'||l.includes('flood')||l.includes('water'))     return dc('FLOOD');
    return dc('DETECTED');
  };
  const col = result ? dc(result.disaster_type) : null;

  return (
    <div className="bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl shadow-xs overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-[#DEDEDA] dark:border-[#2E3038]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#1A3A6B] flex items-center justify-center flex-shrink-0">
            <ScanSearch className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC] font-data">YOLO Vision • Local GPU</p>
            <h2 className="font-heading font-bold text-sm text-[#12294D] dark:text-[#F1F1EF]">Disaster Image Detection</h2>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(['auto','fire_smoke','flood'] as const).map(m => (
            <button key={m} onClick={() => setModelType(m)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${modelType===m ? 'bg-[#1A3A6B] text-white' : 'bg-[#F1F1EF] dark:bg-[#1C1D22] text-[#5A5C66] dark:text-[#A1A3AC] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038]'}`}>
              {m==='auto'?'Auto (Both)':m==='fire_smoke'?'🔥 Fire / Smoke':'🌊 Flood'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!file ? (
          <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
            onDrop={onDrop} onClick={()=>inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-all ${dragOver?'border-[#1A3A6B] bg-[#EEF2F8] dark:bg-[#1B2434]/40':'border-[#DEDEDA] dark:border-[#2E3038] hover:border-[#1A3A6B]/50 hover:bg-[#F8F9FC] dark:hover:bg-[#1C1D22]'}`}>
            <div className="w-12 h-12 rounded-xl bg-[#EEF2F8] dark:bg-[#1C1D22] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[#1A3A6B] dark:text-[#9DB8DC]" />
            </div>
            <div className="text-center">
              <p className="font-heading font-bold text-sm text-[#12294D] dark:text-[#F1F1EF]">Drop an image here or click to browse</p>
              <p className="text-[11px] text-[#6B6D77] dark:text-[#A1A3AC] mt-1">JPG · PNG · BMP · WEBP — up to 20 MB</p>
            </div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadFile(f);}} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative w-full rounded-xl overflow-hidden bg-[#14151A]" style={{aspectRatio:'16/9'}}>
              <img src={result?.image_preview??preview??''} alt="preview" className="w-full h-full object-contain select-none" />
              {result && result.detections.length>0 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {result.detections.map((d,i)=>{
                    const [ymin,xmin,ymax,xmax]=d.bbox; const c=detCol(d);
                    const lw=Math.min(100-xmin,d.label.length*1.65+14);
                    return (<g key={i}>
                      <rect x={xmin} y={ymin} width={xmax-xmin} height={ymax-ymin} fill={`${c.stroke}25`} stroke={c.stroke} strokeWidth="0.7"/>
                      <rect x={xmin} y={Math.max(0,ymin-5)} width={lw} height="4.5" fill={c.stroke} rx="0.6"/>
                      <text x={xmin+1} y={Math.max(3.5,ymin-1.2)} fill="#fff" fontSize="2.6" fontWeight="bold" fontFamily="sans-serif">{d.label} {d.confidence}%</text>
                    </g>);
                  })}
                </svg>
              )}
              {loading && (
                <div className="absolute inset-0 bg-[#14151A]/70 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 text-white animate-spin"/>
                  <span className="text-white text-xs font-bold font-data">Running YOLO on local GPU…</span>
                </div>
              )}
              <button onClick={clear} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#14151A]/80 text-white flex items-center justify-center hover:bg-[#B42318] transition-colors cursor-pointer">
                <X className="w-3.5 h-3.5"/>
              </button>
            </div>

            {result && col && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-bold"
                style={{backgroundColor:col.bg,borderColor:`${col.stroke}40`,color:col.text}}>
                {result.disaster_type==='FIRE_SMOKE'&&<Flame    className="w-4 h-4 flex-shrink-0" style={{color:col.stroke}}/>}
                {result.disaster_type==='FLOOD'     &&<Droplets className="w-4 h-4 flex-shrink-0" style={{color:col.stroke}}/>}
                {result.disaster_type==='CLEAR'     &&<CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#126B34]"/>}
                {result.disaster_type==='DETECTED'  &&<Eye      className="w-4 h-4 flex-shrink-0" style={{color:col.stroke}}/>}
                <span>{result.disaster_type==='CLEAR'?'No disaster detected — area appears clear':`${result.disaster_type.replace('_',' ')} detected — ${result.count} object${result.count!==1?'s':''} found`}</span>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#B42318]/30 bg-[#FBE9E7] text-[#8A1A12] text-xs font-bold">
                <AlertTriangle className="w-4 h-4 flex-shrink-0"/><span>{error}</span>
              </div>
            )}
            {result && result.detections.length>0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC]">Detections ({result.count})</p>
                {result.detections.map((d,i)=>{const c=detCol(d);return(
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F1F1EF] dark:bg-[#1C1D22] border border-[#DEDEDA] dark:border-[#2E3038]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor:c.stroke}}/>
                      <span className="text-xs font-bold text-[#14151A] dark:text-[#F1F1EF]">{d.label}</span>
                      <span className="text-[10px] text-[#6B6D77] dark:text-[#A1A3AC] font-data capitalize">{d.model.replace('_',' ')}</span>
                    </div>
                    <span className="text-xs font-bold font-data text-[#12294D] dark:text-[#9DB8DC]">{d.confidence}%</span>
                  </div>
                );})}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={detect} disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-[#1A3A6B] hover:bg-[#142C52] disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs">
                {loading?<><Loader2 className="w-3.5 h-3.5 animate-spin"/><span>Detecting…</span></>:<><Cpu className="w-3.5 h-3.5"/><span>Run YOLO Detection</span></>}
              </button>
              <button onClick={clear} className="px-4 py-2.5 rounded-xl bg-[#F1F1EF] dark:bg-[#1C1D22] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038] text-[#5A5C66] dark:text-[#A1A3AC] text-xs font-bold border border-[#DEDEDA] dark:border-[#2E3038] transition-all cursor-pointer">Clear</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const DashboardPage: React.FC = () => {
  const {
    currentLanguage,
    overallRiskLevel,
    rainfallMmPerHour,
    riverLevelMeters,
    dangerMarkMeters,
    windSpeedKmh,
    sosReports,
    shelters,
    teams,
    isOffline,
    commTier,
    setCurrentView
  } = useNexoraStore();

  const t = (key: string, fallback?: string) => getTranslation(currentLanguage, key, fallback);

  const activeSOS = sosReports.filter(r => r.status === 'PENDING' || r.status === 'TRIAGED').length;
  const criticalSOS = sosReports.filter(r => r.priorityLevel === 'CRITICAL' && r.status !== 'RESCUED').length;
  const totalShelterBeds = shelters.reduce((acc, s) => acc + s.totalCapacity, 0);
  const totalOccupiedBeds = shelters.reduce((acc, s) => acc + s.currentOccupancy, 0);
  const occupancyPct = Math.round((totalOccupiedBeds / totalShelterBeds) * 100);
  const freeBeds = totalShelterBeds - totalOccupiedBeds;
  const availableTeams = teams.filter(t => t.status === 'AVAILABLE' || t.status === 'STANDBY').length;
  const isCritical = overallRiskLevel === 'CRITICAL';

  // 3 Authority Role Tiles strictly on Dashboard landing
  const roleCards = [
    {
      id: 'DDMO_AUTHORITY',
      title: t('role_ddmo_title', 'DDMO Authority'),
      desc: t('role_ddmo_desc', 'Command, intelligence and disaster monitoring'),
      icon: Shield,
      iconColor: 'text-[#14151A]',
      iconBg: 'bg-[#EEF2F8] border-[#1A3A6B]/40',
      badge: isCritical ? t('critical', 'CRITICAL') : `${overallRiskLevel} ${t('overall_risk', 'RISK')}`,
      badgeColor: isCritical ? 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30' : 'bg-[#EEF2F8] text-[#14151A] border-[#1A3A6B]/40',
      metricLabel: t('role_ddmo_metric', 'Active Command Monitoring'),
      metricValue: `${activeSOS} ${t('active_incidents', 'Active Incidents')} (${criticalSOS} ${t('critical', 'Critical')})`,
      actionText: t('role_ddmo_action', 'Open Command Center'),
      targetView: 'DDMO_AUTHORITY' as const,
      accentBorder: 'hover:border-[#1A3A6B] hover:shadow-md',
      btnHover: 'group-hover:bg-[#1A3A6B] group-hover:text-white group-hover:border-[#1A3A6B]'
    },
    {
      id: 'FIELD_RESPONDER',
      title: t('role_responder_title', 'Field Responder'),
      desc: t('role_responder_desc', 'Mobile-first emergency field operations'),
      icon: Smartphone,
      iconColor: 'text-[#1A3A6B]',
      iconBg: 'bg-[#EEF2F8] border-[#1A3A6B]/30',
      badge: isOffline ? 'OFFLINE MESH' : 'MOBILE FIRST',
      badgeColor: isOffline ? 'bg-[#B54708]/10 text-[#B54708] border-[#B54708]/30' : 'bg-[#EEF2F8] text-[#1A3A6B] border-[#1A3A6B]/30',
      metricLabel: t('role_responder_metric', 'Field Mobile Mode'),
      metricValue: `${availableTeams} Ready Columns • ${teams[0]?.name.split('—')[0]}`,
      actionText: t('role_responder_action', 'Open Responder'),
      targetView: 'FIELD_RESPONDER' as const,
      accentBorder: 'hover:border-[#1A3A6B] hover:shadow-md',
      btnHover: 'group-hover:bg-[#1A3A6B] group-hover:text-white group-hover:border-[#1A3A6B]'
    },
    {
      id: 'SHELTER_MANAGER',
      title: t('role_shelter_title', 'Shelter Manager'),
      desc: t('role_shelter_desc', 'Shelter capacity, intake and resource management'),
      icon: Home,
      iconColor: 'text-[#A15C07]',
      iconBg: 'bg-[#A15C07]/10 border-[#A15C07]/30',
      badge: `${occupancyPct}% CAPACITY`,
      badgeColor: occupancyPct > 80 ? 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30' : 'bg-[#A15C07]/10 text-[#A15C07] border-[#A15C07]/30',
      metricLabel: t('role_shelter_metric', 'Camp Logistics Mode'),
      metricValue: `${totalOccupiedBeds} ${t('shelter_occupied', 'Occupied')} / ${totalShelterBeds} Total`,
      actionText: t('role_shelter_action', 'Open Shelter Manager'),
      targetView: 'SHELTER_MANAGER' as const,
      accentBorder: 'hover:border-[#A15C07] hover:shadow-md',
      btnHover: 'group-hover:bg-[#A15C07] group-hover:text-white group-hover:border-[#A15C07]'
    }
  ];

  return (
    <div className="min-h-screen text-[#14151A] dark:text-[#F1F1EF] flex flex-col font-body transition-colors">
      <TopBar />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 space-y-6">
        
        {/* EXECUTIVE DISASTER COMMAND HEADER BANNER */}
        <div className="bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 px-5 py-5 sm:px-6">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 h-5 px-2 bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#E4E4E0] dark:border-[#2E3038] rounded-sm font-data text-[10px] font-medium text-[#5A5C66] dark:text-[#8E9099] mb-2.5">
              {isOffline ? 'LoRa Mesh Mode' : `Tier 1 Cellular · ${commTier}`}
            </span>

            <h1 className="font-heading text-[22px] sm:text-[26px] font-semibold text-[#14151A] dark:text-[#F1F1EF] tracking-[-0.025em] leading-[1.2]">
              {t('overview_title', 'NEXORA Disaster Command Overview')}
            </h1>
            <p className="text-[13px] sm:text-sm text-[#5A5C66] dark:text-[#A1A3AC] leading-relaxed mt-1.5">
              {t('overview_subtitle', 'Real-time multi-agency flood resilience and emergency response coordination')}
            </p>
          </div>

          {/* Live telemetry — borderless metric columns divided by hairlines,
              so the header reads as one instrument panel rather than three
              nested boxes. */}
          <div className="flex items-stretch divide-x divide-[#E4E4E0] dark:divide-[#2E3038] w-full lg:w-auto shrink-0">
            {[
              { icon: Droplets, label: t('water_level', 'River Stage'), value: '82 cm', suffix: '/ 95cm max' },
              { icon: CloudRain, label: t('rainfall', 'Precipitation'), value: `${rainfallMmPerHour} mm/h`, suffix: 'last hour' },
              { icon: Wind, label: t('wind_speed', 'Wind Velocity'), value: `${windSpeedKmh} km/h`, suffix: 'sustained' },
            ].map(({ icon: Icon, label, value, suffix }, i) => (
              <div key={label} className={`flex items-center gap-2.5 px-4 sm:px-5 ${i === 0 ? 'pl-0 lg:pl-5' : ''}`}>
                <Icon className="w-4 h-4 text-[#1A3A6B] dark:text-[#9DB8DC] shrink-0" strokeWidth={1.9} />
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.07em] text-[#6B6D77] dark:text-[#74767F] leading-tight">
                    {label}
                  </span>
                  <span className="block font-data text-[15px] font-semibold text-[#14151A] dark:text-[#F1F1EF] leading-tight mt-1">
                    {value}
                  </span>
                  <span className="block text-[10px] text-[#6B6D77] dark:text-[#A1A3AC] leading-tight mt-0.5">
                    {suffix}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SECTION 3: THE 3 AUTHORITY ROLE CARDS STRICTLY ON DASHBOARD */}
        <div>
          <div className="mb-3.5">
            <h2 className="font-heading text-[17px] font-semibold text-[#14151A] dark:text-[#F1F1EF] tracking-[-0.015em]">
              {t('role_section_title', 'Operational Role Portals')}
            </h2>
            <p className="text-[13px] text-[#5A5C66] dark:text-[#A1A3AC] mt-1">
              {t('role_section_desc', 'Select an operational role to enter its dedicated workspace')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {roleCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.id}
                  data-role={card.id}
                  onClick={() => setCurrentView(card.targetView)}
                  className={`card-interactive bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl p-5 cursor-pointer flex flex-col justify-between group ${card.accentBorder}`}
                >
                  <div className="space-y-3">
                    {/* Header: Icon & Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-transform group-hover:scale-105 ${card.iconBg}`}>
                        <Icon className={`w-5 h-5 ${card.iconColor}`} />
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-data border ${card.badgeColor}`}>
                        {card.badge}
                      </span>
                    </div>

                    {/* Title & Description */}
                    <div>
                      <h3 className="font-heading font-semibold text-[15px] text-[#14151A] dark:text-[#F1F1EF] group-hover:text-[#1A3A6B] dark:group-hover:text-[#9DB8DC] transition-colors">
                        {card.title}
                      </h3>
                      <p className="text-xs text-[#5A5C66] dark:text-[#A1A3AC] mt-1 line-clamp-2 leading-relaxed">
                        {card.desc}
                      </p>
                    </div>
                  </div>

                  {/* Status / Metric preview & Action Button */}
                  <div className="mt-4 pt-4 border-t border-[#DEDEDA] dark:border-[#2E3038] space-y-3">
                    <div className="bg-[#F1F1EF] dark:bg-[#0D0E12] px-3 py-2 rounded-xl border border-[#DEDEDA] dark:border-[#2E3038]">
                      <span className="text-[10px] font-semibold text-[#5A5C66] dark:text-[#74767F] uppercase tracking-wider block font-data">
                        {card.metricLabel}
                      </span>
                      <span className="text-xs font-bold text-[#14151A] dark:text-[#F1F1EF] block truncate mt-0.5">
                        {card.metricValue}
                      </span>
                    </div>

                    <button
                      type="button"
                      data-role-btn={card.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentView(card.targetView);
                      }}
                      className={`w-full h-8 px-3.5 rounded-lg bg-[#F1F1EF] dark:bg-[#0D0E12] ${card.btnHover} text-[#14151A] dark:text-[#F1F1EF] border border-[#E4E4E0] dark:border-[#2E3038] text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer`}
                    >
                      <span>{card.actionText}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#5A5C66] dark:text-[#A1A3AC] group-hover:translate-x-1 group-hover:text-current transition-transform" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SUMMARY EMERGENCY SNAPSHOT: ACTIVE INCIDENTS & MAP PREVIEW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Left: Quick Incidents & Triage Summary */}
          <div className="lg:col-span-6 bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDEA] dark:border-[#2E3038]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B42318]" />
                <h3 className="font-heading font-semibold text-sm text-[#14151A] dark:text-[#F1F1EF]">
                  {t('dash_triage_title', 'Immediate Emergency Triage Summary')}
                </h3>
              </div>
              <button
                onClick={() => setCurrentView('DDMO_AUTHORITY')}
                className="text-xs font-bold text-[#1A3A6B] dark:text-[#9DB8DC] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>{t('dash_triage_full', 'Full Triage Queue')}</span>
                <ChevronRight className="w-3.5 h-3.5 text-[#1A3A6B]" />
              </button>
            </div>

            <div className="space-y-2.5">
              {sosReports.slice(0, 3).map((sos) => {
                const isCrit = sos.priorityLevel === 'CRITICAL';
                return (
                  <div
                    key={sos.id}
                    onClick={() => setCurrentView('DDMO_AUTHORITY')}
                    className="p-3 rounded-xl border border-[#DEDEDA] dark:border-[#2E3038] bg-[#F1F1EF] dark:bg-[#0D0E12] hover:bg-[#EEF2F8] hover:dark:bg-[#26272E] transition-all cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-data text-xs font-bold text-[#14151A] dark:text-[#F1F1EF]">{sos.id}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-data ${
                          isCrit ? 'bg-[#B42318]/10 text-[#B42318] border border-[#B42318]/30' : 'bg-[#B54708]/10 text-[#B54708] border border-[#B54708]/30'
                        }`}>
                          {sos.priorityLevel}
                        </span>
                        <span className="text-[11px] text-[#5A5C66] dark:text-[#A1A3AC] font-data">
                          {sos.peopleCount} {t('responder_trapped_count', 'trapped')}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-[#14151A] dark:text-[#F1F1EF] truncate mt-1">
                        {sos.locationName}
                      </div>
                    </div>

                    <span className="text-xs font-data font-bold text-[#14151A] dark:text-[#F1F1EF] px-2 py-1 bg-white dark:bg-[#1C1D22] rounded-lg border border-[#DEDEDA] dark:border-[#2E3038]">
                      {sos.priorityScore} pts
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Evacuation & Relief Status Summary */}
          <div className="lg:col-span-6 bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDEA] dark:border-[#2E3038]">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-[#1A3A6B] dark:text-[#9DB8DC]" />
                <h3 className="font-heading font-semibold text-sm text-[#14151A] dark:text-[#F1F1EF]">
                  {t('dash_gis_title', 'GIS Threat Map & Evacuation Hub')}
                </h3>
              </div>
              <button
                onClick={() => setCurrentView('DISASTER_MAP')}
                className="text-xs font-bold text-[#1A3A6B] dark:text-[#9DB8DC] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>{t('dash_gis_open', 'Open GIS Threat Map')}</span>
                <ChevronRight className="w-3.5 h-3.5 text-[#1A3A6B]" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 font-data text-xs">
              <div className="p-3 bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl">
                <span className="text-[#5A5C66] dark:text-[#A1A3AC] text-[10px] block font-sans">Active Safe Corridors</span>
                <span className="font-bold text-base text-[#126B34] dark:text-[#5BBF7A] block mt-0.5">2 Corridors Open</span>
                <span className="text-[11px] text-[#5A5C66] dark:text-[#74767F] mt-1 block">Avoiding AT Road inundation</span>
              </div>

              <div className="p-3 bg-[#F1F1EF] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl">
                <span className="text-[#5A5C66] dark:text-[#A1A3AC] text-[10px] block font-sans">{t('citizen_free_beds', 'Shelter Free Beds')}</span>
                <span className="font-bold text-base text-[#14151A] dark:text-[#F1F1EF] block mt-0.5">{freeBeds} Beds Available</span>
                <span className="text-[11px] text-[#5A5C66] dark:text-[#74767F] mt-1 block">Across {shelters.length} relief camps</span>
              </div>
            </div>

            <button
              onClick={() => setCurrentView('DISASTER_MAP')}
              className="w-full h-9 px-4 btn-primary-gradient text-white text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              <Compass className="w-4 h-4 text-white" />
              <span>{t('dash_gis_open', 'Launch Interactive Multi-Layer GIS Threat Map')}</span>
            </button>
          </div>

        </div>

        {/* YOLO DISASTER IMAGE DETECTION */}
        <YoloUploadPanel />

      </main>

      <footer className="bg-white dark:bg-[#17181C] border-t border-[#DEDEDA] dark:border-[#2E3038] py-4 px-6 mt-12 text-center text-xs text-[#5A5C66] dark:text-[#A1A3AC]">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 font-data">
          <span>NEXORA — Monsoon Resilience Disaster Intelligence Framework</span>
          <span>Guwahati River Basin SEOC • Incident Command System ICS-2026</span>
        </div>
      </footer>
    </div>
  );
};
