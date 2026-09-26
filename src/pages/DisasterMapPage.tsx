import React from 'react';
import { TopBar } from '../components/dashboard/TopBar';
import { ZoneMap } from '../components/dashboard/ZoneMap';
import { SOSQueue } from '../components/dashboard/SOSQueue';
import { Compass, AlertTriangle } from 'lucide-react';
import { useNexoraStore } from '../store/useNexoraStore';
import { getTranslation } from '../i18n/translations';

export const DisasterMapPage: React.FC = () => {
  const {
    activeEvacuationRoute,
    blockedRoads,
    toggleIncidentModal,
    currentLanguage
  } = useNexoraStore();

  const t = (k: string, f?: string) => getTranslation(currentLanguage, k, f);

  return (
    <div className="min-h-screen text-[#14151A] dark:text-[#F1F1EF] flex flex-col font-body transition-colors">
      <TopBar />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 space-y-4">
        
        {/* MAP OPERATIONAL CONTROL BANNER */}
        <div className="bg-white dark:bg-[#17181C] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1A3A6B] flex items-center justify-center font-bold shadow-xs border border-[#1A3A6B]">
              <Compass className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-heading text-base sm:text-lg font-bold text-[#14151A] dark:text-[#F1F1EF] leading-tight">
                {t('map_title', 'Live Disaster Inundation & Tactical Map')}
              </h1>
              <p className="text-[11px] text-[#6B6D77] dark:text-[#A1A3AC]">
                {t('map_subtitle', 'Leaflet GIS • High / Moderate / Low Risk Zones • Live Sensor Pins • Evacuation Waypoints')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleIncidentModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-[#B42318] hover:bg-[#9A1C13] text-white text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t('report_incident', 'Report Incident')}</span>
            </button>
          </div>
        </div>

        {/* FULL MAP + SIDEBAR TRIAGE QUEUE */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          
          {/* Main Full-Screen Leaflet Map */}
          <div className="xl:col-span-8">
            <ZoneMap fullScreen={true} />
          </div>

          {/* Right Sidebar: Active SOS Triage Queue & Navigation summary */}
          <div className="xl:col-span-4 space-y-4">
            
            {/* Active Evacuation Route Quick Card if present */}
            {activeEvacuationRoute && (
              <div className="p-4 rounded-xl border border-[#1A3A6B]/30 bg-[#EEF2F8]/50 dark:bg-[#1C1D22] space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1A3A6B] dark:text-[#9DB8DC] flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-[#1A3A6B] dark:text-[#9DB8DC]" />
                    Selected Safe Evacuation Path
                  </span>
                  <span className="text-[10px] font-bold font-data bg-[#E4F3E9] dark:bg-[#1C1D22] text-[#126B34] dark:text-[#5BBF7A] border border-[#E4F3E9] dark:border-[#2E3038] px-2 py-0.5 rounded">
                    DRY CORRIDOR
                  </span>
                </div>
                <div className="text-xs text-[#14151A] dark:text-[#F1F1EF] font-semibold">
                  {activeEvacuationRoute.originName} → {activeEvacuationRoute.destinationName}
                </div>
                <div className="flex items-center justify-between text-xs font-data text-[#6B6D77] dark:text-[#A1A3AC]">
                  <span>Distance: <strong className="text-[#14151A] dark:text-[#F1F1EF]">{activeEvacuationRoute.distanceKm} km</strong></span>
                  <span>Walking ETA: <strong className="text-[#14151A] dark:text-[#F1F1EF]">{activeEvacuationRoute.etaMinutes} mins</strong></span>
                </div>
                <div className="text-[11px] text-[#6B6D77] dark:text-[#74767F] italic pt-1 border-t border-[#DEDEDA] dark:border-[#2E3038]">
                  Bypassing {blockedRoads.filter(r => r.active).length} flooded roadways via elevated ridge road.
                </div>
              </div>
            )}

            {/* Priority SOS Queue */}
            <div className="h-[calc(100vh-280px)] overflow-hidden">
              <SOSQueue />
            </div>

          </div>

        </div>

      </main>
    </div>
  );
};
