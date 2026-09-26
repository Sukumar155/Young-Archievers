import React from 'react';
import { CloudRain, AlertTriangle, RotateCcw, Flame } from 'lucide-react';
import { useNexoraStore } from '../../store/useNexoraStore';

export const ScenarioPanel: React.FC = () => {
  const {
    rainfallMmPerHour,
    riverLevelMeters,
    dangerMarkMeters,
    embankmentBreached,
    blockedRoads,
    setRainfall,
    toggleRoadBlock,
    simulateEmbankmentBreach,
    fillShelters,
    resetDemoScenario
  } = useNexoraStore();

  const isRiverCritical = riverLevelMeters >= dangerMarkMeters;

  return (
    <div className="nexora-card p-5 bg-white shadow-xs border border-[#E4E4E0] rounded-xl mt-6 text-[#14151A]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#E4E4E0]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-heading font-bold text-base text-[#14151A] flex items-center gap-1.5">
              <CloudRain className="w-5 h-5 text-[#12294D]" />
              Monsoon Incident & Simulation Controls
            </h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold font-data bg-[#EFEFEC] text-[#12294D] border border-[#DCDCD8]">
              Interactive Sandbox
            </span>
          </div>
          <p className="text-xs text-[#5A5C66] mt-0.5">
            Test AI triage, priority re-weighting, and logistics under escalating flood scenarios.
          </p>
        </div>

        <button
          onClick={resetDemoScenario}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E4E4E0] text-[#14151A] hover:bg-[#EFEFEC] text-xs font-semibold cursor-pointer transition-all shadow-2xs self-start md:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[#5A5C66]" />
          <span>Reset Scenario</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        
        {/* 1. RAINFALL SLIDER & WATER TELEMETRY */}
        <div className="space-y-3 bg-[#F8F8F7] p-4 rounded-xl border border-[#E4E4E0]">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-[#14151A] flex items-center gap-1.5">
              <CloudRain className="w-4 h-4 text-[#12294D]" />
              Rainfall Intensity
            </label>
            <span className="font-data font-bold text-sm text-[#14151A] bg-white px-2 py-0.5 rounded border border-[#E4E4E0]">
              {rainfallMmPerHour} mm/hr
            </span>
          </div>

          <input
            type="range"
            min="20"
            max="140"
            step="5"
            value={rainfallMmPerHour}
            onChange={(e) => setRainfall(Number(e.target.value))}
            className="w-full accent-[#12294D] cursor-pointer"
          />

          <div className="flex items-center justify-between text-[11px] text-[#5A5C66]">
            <span>20 (Normal)</span>
            <span>65 (Heavy)</span>
            <span>140 (Cloudburst)</span>
          </div>

          {/* River Level Gauge */}
          <div className="pt-2 border-t border-[#E4E4E0] flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-[#5A5C66]">Brahmaputra Gauge</div>
              <div className="font-data text-xs text-[#5A5C66]">Danger: {dangerMarkMeters}m</div>
            </div>
            <div className={`font-data text-base font-bold px-2 py-0.5 rounded ${
              isRiverCritical ? 'bg-[#FCF1F0] text-[#B42318] border border-[#F3CFC9]' : 'bg-white text-[#14151A] border border-[#E4E4E0]'
            }`}>
              {riverLevelMeters} m
            </div>
          </div>
        </div>

        {/* 2. INFRASTRUCTURE & ROAD BLOCKAGES */}
        <div className="space-y-3 bg-[#F8F8F7] p-4 rounded-xl border border-[#E4E4E0] flex flex-col justify-between">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[#14151A] flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-4 h-4 text-[#8A4D06]" />
              Simulated Road Closures
            </label>
            <div className="space-y-2">
              {blockedRoads.map((road) => (
                <div
                  key={road.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#E4E4E0] text-xs"
                >
                  <span className="font-medium text-[#14151A] truncate pr-2" title={road.name}>
                    {road.name}
                  </span>
                  <button
                    onClick={() => toggleRoadBlock(road.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                      road.active
                        ? 'bg-[#B42318] text-white'
                        : 'bg-[#F8F8F7] text-[#5A5C66] hover:bg-[#EFEFEC]'
                    }`}
                  >
                    {road.active ? 'BLOCKED' : 'CLEAR'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-[#5A5C66]">
            Blocks trigger instant route recalculations in Response Plans.
          </div>
        </div>

        {/* 3. INCIDENT STRESS ACTIONS */}
        <div className="space-y-3 bg-[#F8F8F7] p-4 rounded-xl border border-[#E4E4E0] flex flex-col justify-between">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[#14151A] flex items-center gap-1.5 mb-2">
              <Flame className="w-4 h-4 text-[#B42318]" />
              Catastrophe Injection
            </label>

            <div className="space-y-2">
              <button
                onClick={simulateEmbankmentBreach}
                disabled={embankmentBreached}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white hover:bg-[#FCF1F0] border border-[#F3CFC9] text-xs font-bold text-[#B42318] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
              >
                <span>{embankmentBreached ? '✓ Embankment Breached' : 'Simulate River Breach'}</span>
                <span className="text-[10px] font-data bg-[#FCF1F0] px-1.5 py-0.5 rounded text-[#B42318]">
                  +16 Trapped
                </span>
              </button>

              <button
                onClick={fillShelters}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white hover:bg-[#FBF7EC] border border-[#F7E9D6] text-xs font-bold text-[#8A4D06] transition-all cursor-pointer shadow-2xs"
              >
                <span>Fill Shelters to 95%</span>
                <span className="text-[10px] font-data bg-[#FBF7EC] px-1.5 py-0.5 rounded text-[#7A3E0B]">
                  Rations Low
                </span>
              </button>
            </div>
          </div>

          <div className="text-[11px] text-[#5A5C66]">
            Demonstrates shelter intake overflow and high-urgency AI rerouting.
          </div>
        </div>

      </div>
    </div>
  );
};
