import React, { useState } from 'react';
import { TopBar } from '../components/dashboard/TopBar';
import { Home, Compass, AlertTriangle, Droplets, Utensils, HeartPulse, Navigation, ExternalLink, Loader2 } from 'lucide-react';
import { useNexoraStore } from '../store/useNexoraStore';
import { RouteMap, LocateButton } from '../components/routing/RouteMap';
import { detectLocation, isGeolocationSupported } from '../services/geolocationService';

export const EvacuationPage: React.FC = () => {
  const {
    shelters,
    activeEvacuationRoute,
    calculateSafeRoute,
    setCurrentView,
    blockedRoads,
    districtSite
  } = useNexoraStore();

  const [selectedShelterId, setSelectedShelterId] = useState(shelters[0]?.id || 'SHELTER-01');
  const [routeGenerated, setRouteGenerated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{
    lat: number;
    lng: number;
    label: string;
    isRealFix: boolean;
  } | null>(null);

  /** Detect the operator's real position; fall back to the district centre. */
  const detectMyLocation = async () => {
    if (!isGeolocationSupported()) {
      setLocateError('This browser cannot share your location.');
      setOrigin({
        lat: districtSite.latitude,
        lng: districtSite.longitude,
        label: `${districtSite.latitude.toFixed(3)}, ${districtSite.longitude.toFixed(3)} (district centre)`,
        isRealFix: false
      });
      setRouteGenerated(false);
      return;
    }

    setLocating(true);
    setLocateError(null);
    try {
      const pos = await detectLocation(10000);
      setOrigin({ lat: pos.lat, lng: pos.lng, label: 'My current location', isRealFix: true });
      setRouteGenerated(false);
    } catch {
      setLocateError('Location permission was not granted.');
      setOrigin({
        lat: districtSite.latitude,
        lng: districtSite.longitude,
        label: `${districtSite.latitude.toFixed(3)}, ${districtSite.longitude.toFixed(3)} (district centre)`,
        isRealFix: false
      });
      setRouteGenerated(false);
    } finally {
      setLocating(false);
    }
  };

  const handleGenerateRoute = () => {
    if (!origin) return;
    const route = calculateSafeRoute(origin.label, selectedShelterId, {
      lat: origin.lat,
      lng: origin.lng
    });
    if (route) setRouteGenerated(true);
  };

  return (
    <div className="min-h-screen text-[#14151A] dark:text-[#F1F1EF] flex flex-col">
      <TopBar />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 space-y-6">
        
        {/* PAGE HEADER */}
        <div className="bg-white dark:bg-[#17181C] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl text-[#126B34] text-white flex items-center justify-center shadow-md flex-shrink-0">
              <Home className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC] font-data">
                  Citizen Safety & Evacuation Logistics
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E4F3E9] dark:bg-[#14251F]/60 text-[#126B34] dark:text-[#7CC99A] border border-[#E4F3E9] dark:border-[#234133]/60">
                  Corridor Planner
                </span>
              </div>
              <h1 className="font-heading text-xl sm:text-2xl font-bold text-[#12294D] dark:text-[#9DB8DC] mt-0.5">
                Safe Shelters & Evacuation Routes
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentView('DISASTER_MAP')}
              className="px-4 py-2 rounded-xl bg-[#12294D] hover:bg-[#0F2140] text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <span>View Evacuation Map</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* TOP: ROUTE PLANNER — controls + route-only map, nothing else */}
        <div className="nexora-card p-6 border border-[#E4E4E0] dark:border-[#2E3038] bg-white dark:bg-[#17181C] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#DEDEDA]/80 dark:border-[#2E3038] pb-3">
            <div>
              <h2 className="font-heading font-bold text-base text-[#12294D] dark:text-[#F1F1EF] flex items-center gap-2">
                <Compass className="w-5 h-5 text-[#1A3A6B] dark:text-[#9DB8DC]" />
                Dry Evacuation Corridor Algorithm (Avoiding Submerged Roads)
              </h2>
              <p className="text-xs text-[#5A5C66] dark:text-[#A1A3AC]">
                Calculates highest-elevation escape trajectory bypassing inundated roads and river surges.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E4F3E9] text-[#126B34] border border-[#E4F3E9] self-start sm:self-center">
              Active Roadblocks Avoided: {blockedRoads.filter(r => r.active).length}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">

            {/* 1 — Your Current Location */}
            <div className="md:col-span-5">
              <label className="block text-xs font-bold text-[#5A5C66] dark:text-[#A1A3AC] mb-1">
                Your Current Location
              </label>
              <div className="flex items-center gap-2">
                <div
                  data-testid="origin-readout"
                  className="flex-1 min-w-0 px-3 py-2 bg-[#F8F8F7] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl shadow-xs"
                >
                  {locating ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[#6B6D77] dark:text-[#A1A3AC]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Detecting your location…
                    </span>
                  ) : origin ? (
                    <span className="block min-w-0">
                      <span className="block text-xs font-bold text-[#14151A] dark:text-[#F1F1EF] truncate">
                        {origin.label}
                      </span>
                      <span className="block text-[10px] font-data text-[#6B6D77] dark:text-[#A1A3AC] mt-0.5">
                        {origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}
                        {origin.isRealFix ? '' : ' · approx.'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#A1A3AC]">
                      Press “My Location” to set your position
                    </span>
                  )}
                </div>
                <LocateButton
                  onClick={() => void detectMyLocation()}
                  loading={locating}
                  reason={locateError}
                />
              </div>
            </div>

            {/* 2 — Target Safe Relief Camp */}
            <div className="md:col-span-5">
              <label className="block text-xs font-bold text-[#5A5C66] dark:text-[#A1A3AC] mb-1">
                Target Safe Relief Camp
              </label>
              <select
                value={selectedShelterId}
                onChange={(e) => {
                  setSelectedShelterId(e.target.value);
                  setRouteGenerated(false);
                }}
                className="w-full px-3 py-2 bg-white dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl text-xs font-semibold text-[#14151A] dark:text-[#F1F1EF] focus:outline-none focus:ring-2 focus:ring-[#12294D]/20 shadow-xs"
              >
                {shelters.map((s) => {
                  const free = s.totalCapacity - s.currentOccupancy;
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} — {free > 0 ? `${free} beds free` : 'FULL'}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 3 — Calculate Path */}
            <div className="md:col-span-2">
              <button
                onClick={handleGenerateRoute}
                disabled={!origin}
                className="w-full py-2.5 px-4 rounded-xl bg-[#1A3A6B] hover:bg-[#12294D] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Calculate Path</span>
              </button>
            </div>
          </div>

          {/* Origin fallback notice — never present an approximation as a real fix */}
          {origin && !origin.isRealFix && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FAF0D8] dark:bg-[#241B0B]/40 border border-[#EFE3C4] dark:border-[#4A3A18]">
              <AlertTriangle className="w-3.5 h-3.5 text-[#A15C07] dark:text-[#D9A03A] flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#7A3E0B] dark:text-[#D9A03A] leading-snug">
                {locateError ? `${locateError} ` : ''}
                Using <strong>{origin.label}</strong> as your starting point. Grant location access
                and press <strong>My Location</strong> for an accurate route.
              </p>
            </div>
          )}

          {/* 4 — The route, drawn on a map carrying nothing else */}
          <RouteMap
            route={routeGenerated ? activeEvacuationRoute : null}
            center={origin ? [origin.lat, origin.lng] : [districtSite.latitude, districtSite.longitude]}
            className="h-[340px] sm:h-[420px]"
          />
        </div>

        {/* SHELTERS LIST & CAPACITY METRICS */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-heading font-bold text-base text-[#12294D] dark:text-[#F1F1EF]">
                Active Designated Relief Camps ({shelters.length})
              </h2>
              <p className="text-xs text-[#6B6D77] dark:text-[#A1A3AC]">
                Real-time occupancy tracking, rations supply, and bed availability
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {shelters.map((shelter) => {
              const freeBeds = shelter.totalCapacity - shelter.currentOccupancy;
              const occupancyPct = Math.round((shelter.currentOccupancy / shelter.totalCapacity) * 100);
              const isLimited = occupancyPct >= 80;

              return (
                <div key={shelter.id} className="nexora-card p-5 space-y-4 border dark:bg-[#17181C] dark:border-[#2E3038] hover:border-[#12294D]/40 dark:hover:border-[#5B7BA8]/50 transition-all">
                  
                  {/* Shelter Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-data ${ isLimited ? 'bg-[#FAF0D8] dark:bg-[#241B0B]/60 text-[#A15C07] dark:text-[#D9A03A]' : 'bg-[#E4F3E9] dark:bg-[#14251F]/60 text-[#126B34] dark:text-[#7CC99A]' }`}>
                          {isLimited ? 'LIMITED SPACE' : 'AVAILABLE'}
                        </span>
                        <span className="text-xs text-[#6B6D77] dark:text-[#74767F] font-data">#{shelter.id}</span>
                      </div>
                      <h3 className="font-heading font-bold text-sm text-[#12294D] dark:text-[#9DB8DC] mt-1 line-clamp-1">
                        {shelter.name}
                      </h3>
                      <p className="text-[11px] text-[#6B6D77] dark:text-[#A1A3AC] line-clamp-1">{shelter.address}</p>
                    </div>

                    <div className="w-9 h-9 rounded-xl bg-[#F1F8F3] dark:bg-[#14251F]/40 text-[#126B34] dark:text-[#7CC99A] flex items-center justify-center flex-shrink-0">
                      <Home className="w-5 h-5" />
                    </div>
                  </div>

                  {/* Occupancy Progress */}
                  <div className="space-y-1.5 bg-[#F1F1EF] dark:bg-[#0D0E12] p-3 rounded-xl border border-[#DEDEDA]/80 dark:border-[#2E3038]">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-bold text-[#5A5C66] dark:text-[#A1A3AC]">Capacity Status</span>
                      <span className="font-data font-bold text-[#14151A] dark:text-[#F1F1EF]">
                        {shelter.currentOccupancy} <span className="font-normal text-[#6B6D77] dark:text-[#74767F]">/ {shelter.totalCapacity}</span>
                      </span>
                    </div>

                    <div className="w-full bg-[#F1F1EF] dark:bg-[#2E3038] h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${ occupancyPct >= 85 ? 'bg-[#A15C07]' : 'text-[#126B34]' }`}
                        style={{ width: `${occupancyPct}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-data text-[#5A5C66] dark:text-[#A1A3AC] pt-0.5">
                      <span className="font-bold text-[#126B34] dark:text-[#7CC99A]">{freeBeds} beds available</span>
                      <span>{occupancyPct}% full</span>
                    </div>
                  </div>

                  {/* Rations / Supplies Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-xs font-data">
                    <div className="bg-white dark:bg-[#1C1D22] p-2 rounded-lg border border-[#DEDEDA] dark:border-[#2E3038] shadow-xs">
                      <Utensils className="w-3.5 h-3.5 text-[#A15C07] dark:text-[#D9A03A] mx-auto mb-1" />
                      <span className="text-[9px] text-[#6B6D77] dark:text-[#74767F] block uppercase">Food Packs</span>
                      <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">{shelter.resources.foodPackets}</span>
                    </div>

                    <div className="bg-white dark:bg-[#1C1D22] p-2 rounded-lg border border-[#DEDEDA] dark:border-[#2E3038] shadow-xs">
                      <Droplets className="w-3.5 h-3.5 text-[#1A3A6B] dark:text-[#9DB8DC] mx-auto mb-1" />
                      <span className="text-[9px] text-[#6B6D77] dark:text-[#74767F] block uppercase">Water (L)</span>
                      <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">{shelter.resources.waterLiters}</span>
                    </div>

                    <div className="bg-white dark:bg-[#1C1D22] p-2 rounded-lg border border-[#DEDEDA] dark:border-[#2E3038] shadow-xs">
                      <HeartPulse className="w-3.5 h-3.5 text-[#B42318] dark:text-[#E0776C] mx-auto mb-1" />
                      <span className="text-[9px] text-[#6B6D77] dark:text-[#74767F] block uppercase">Med Kits</span>
                      <span className="font-bold text-[#14151A] dark:text-[#F1F1EF]">{shelter.resources.medicalKits}</span>
                    </div>
                  </div>

                  {/* Expected Inflow / Arrivals */}
                  <div className="pt-2 border-t border-[#E4E4E0] dark:border-[#2E3038] flex items-center justify-between text-[11px] text-[#5A5C66] dark:text-[#A1A3AC]">
                    <span>
                      Inflow: <strong>{shelter.expectedArrivals.filter(a => !a.checkedIn).length} columns en-route</strong>
                    </span>
                    <button
                      onClick={() => {
                        setSelectedShelterId(shelter.id);
                        // Reuse the operator's detected position when we have it,
                        // otherwise anchor the route on the district centre.
                        calculateSafeRoute(
                          origin ? origin.label : 'District centre',
                          shelter.id,
                          origin ? { lat: origin.lat, lng: origin.lng } : undefined
                        );
                        setRouteGenerated(true);
                      }}
                      className="text-xs font-bold text-[#1A3A6B] dark:text-[#9DB8DC] hover:underline cursor-pointer"
                    >
                      Route Here →
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        </div>

      </main>
    </div>
  );
};
