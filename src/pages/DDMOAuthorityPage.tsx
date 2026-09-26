import React from 'react';
import { TopBar } from '../components/dashboard/TopBar';
import { KPIRow } from '../components/dashboard/KPIRow';
import { ZoneMap } from '../components/dashboard/ZoneMap';
import { SOSQueue } from '../components/dashboard/SOSQueue';
import { CommTierStrip } from '../components/dashboard/CommTierStrip';
import { ScenarioPanel } from '../components/dashboard/ScenarioPanel';
import { Shield, ArrowLeft, Radio, Cpu, Camera, AlertTriangle, Home, Navigation } from 'lucide-react';
import { useNexoraStore } from '../store/useNexoraStore';
import { getTranslation } from '../i18n/translations';

export const DDMOAuthorityPage: React.FC = () => {
  const { setCurrentView, currentLanguage, overallRiskLevel, rainfallMmPerHour, windSpeedKmh, sosReports, embankmentBreached } = useNexoraStore();
  const t = (k: string, f?: string) => getTranslation(currentLanguage, k, f);

  const isCritical = overallRiskLevel === 'CRITICAL';
  const activeSOS = sosReports.filter(r => r.status === 'PENDING' || r.status === 'TRIAGED').length;
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
          {/* Interactive Leaflet Inundation Map */}
          <div className="lg:col-span-8">
            <ZoneMap />
          </div>

          {/* Priority SOS Queue Sidebar */}
          <div className="lg:col-span-4">
            <SOSQueue />
          </div>
        </div>

        {/* CONNECTED LIFECYCLE QUICK WORKFLOW SHORTCUTS */}
        <div className="bg-white dark:bg-[#17181C] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-heading font-bold text-[#14151A] dark:text-[#F1F1EF] uppercase tracking-wider text-[11px]">
              Command Lifecycle:
            </span>
            <span className="text-[#6B6D77] dark:text-[#A1A3AC] hidden sm:inline">
              Sensors → AI Risk → Drone Vision → Alerts → Evacuation → Resources
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setCurrentView('SENSORS')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Radio className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" />
              <span>Sensors</span>
            </button>
            <button
              onClick={() => setCurrentView('AI_RISK')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Cpu className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" />
              <span>AI Risk</span>
            </button>
            <button
              onClick={() => setCurrentView('DAMAGE_DETECTION')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" />
              <span>Drone Vision</span>
            </button>
            <button
              onClick={() => setCurrentView('ALERTS')}
              className="px-3 py-1.5 rounded-lg bg-[#B42318]/10 text-[#B42318] hover:bg-[#B42318]/20 border border-[#B42318]/20 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-[#B42318]" />
              <span>Broadcast Alerts</span>
            </button>
            <button
              onClick={() => setCurrentView('SHELTER_EVACUATION')}
              className="px-3 py-1.5 rounded-lg bg-[#126B34]/10 text-[#126B34] dark:text-[#5BBF7A] hover:bg-[#126B34]/20 border border-[#126B34]/20 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Home className="w-3.5 h-3.5 text-[#126B34] dark:text-[#5BBF7A]" />
              <span>Safe Routes</span>
            </button>
            <button
              onClick={() => setCurrentView('EMERGENCY_RESOURCES')}
              className="px-3 py-1.5 rounded-lg bg-[#EEF2F8] dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] hover:bg-[#E3EAF4] dark:hover:bg-[#1C1D22] border border-[#1A3A6B]/30 dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Navigation className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC]" />
              <span>Fleet Logistics</span>
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
