import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Users, ArrowUpRight, ShieldAlert, ListOrdered } from 'lucide-react';
import { useNexoraStore } from '../../store/useNexoraStore';
import { RiskBadge } from '../shared/RiskBadge';
import { PriorityRing } from '../shared/PriorityRing';
import { AssistanceNeed } from '../../types/sos';
import { fetchServerSOS, subscribeServerSOS } from '../../services/sosApi';

export const SOSQueue: React.FC = () => {
  const { sosReports, selectedSOSId, openDetailDrawer, openResponsePlan, sosServerStatus } = useNexoraStore();
  const [filterNeed, setFilterNeed] = useState<string>('ALL');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 4; // Strict finite pagination

  // Live bridge to the SOS backend (server/sos-server.mjs):
  // catch up with anything already stored, then stream new beacons via SSE.
  useEffect(() => {
    let disposed = false;
    const { setSosServerStatus, ingestServerSOS } = useNexoraStore.getState();

    setSosServerStatus('CONNECTING');
    fetchServerSOS().then((list) => {
      if (disposed) return;
      if (list.length) ingestServerSOS(list);
      setSosServerStatus('LIVE');
    });

    const unsubscribe = subscribeServerSOS({
      onReport: (report) => {
        if (disposed) return;
        ingestServerSOS([report]);
      },
      onStatus: (status) => {
        if (disposed) return;
        setSosServerStatus(status);
      },
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // Sort by AI Priority Score descending
  const sortedReports = [...sosReports].sort((a, b) => b.priorityScore - a.priorityScore);

  const filteredReports = sortedReports.filter((report) => {
    if (report.status === 'FALSE_ALARM') return false;
    if (filterNeed === 'ALL') return true;
    if (filterNeed === 'CRITICAL') return report.priorityLevel === 'CRITICAL';
    return report.needs.includes(filterNeed as AssistanceNeed);
  });

  const totalPages = Math.ceil(filteredReports.length / itemsPerPage) || 1;
  const paginatedReports = filteredReports.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const formatRelativeTime = (isoString: string) => {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="nexora-card flex flex-col h-[560px] lg:h-[620px] shadow-xs overflow-hidden bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl text-[#14151A] dark:text-[#F1F1EF]">
      
      {/* QUEUE HEADER */}
      <div className="p-4 border-b border-[#E4E4E0] dark:border-[#2E3038] flex items-center justify-between gap-3 bg-white dark:bg-[#17181C]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-heading font-bold text-base text-[#14151A] dark:text-[#F1F1EF] flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-[#B42318]" />
              Priority SOS Triage
            </h3>
            <span className="font-data text-xs px-2 py-0.5 rounded-full bg-[#EFEFEC] dark:bg-[#0D0E12] text-[#12294D] dark:text-[#9DB8DC] font-semibold border border-[#DCDCD8] dark:border-[#2E3038]">
              {filteredReports.length} Ranked
            </span>
            {/* SOS backend bridge status */}
            <span
              title="One-tap SOS beacons from citizens are received live from the backend bridge (server/sos-server.mjs)"
              className={`font-data text-xs px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1.5 ${ sosServerStatus === 'LIVE' ? 'bg-[#F1F8F3] dark:bg-[#14251F]/50 text-[#126B34] dark:text-[#7CC99A] border-[#E4F3E9] dark:border-[#234133]/60' : sosServerStatus === 'CONNECTING' ? 'bg-[#FAF0D8] dark:bg-[#241B0B]/40 text-[#93690F] dark:text-[#D9A03A] border-[#EFE3C4] dark:border-[#4A3A18]/50' : 'bg-[#F1F1EF] dark:bg-[#0D0E12] text-[#6B6D77] dark:text-[#74767F] border-[#E4E4E0] dark:border-[#2E3038]' }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${ sosServerStatus === 'LIVE' ? 'bg-[#126B34] animate-pulse' : sosServerStatus === 'CONNECTING' ? 'bg-[#D9A03A] animate-pulse' : 'bg-[#35363F]' }`}
              />
              Server {sosServerStatus === 'LIVE' ? 'Live' : sosServerStatus === 'CONNECTING' ? 'Connecting…' : 'Offline'}
            </span>
          </div>
          <p className="text-[11px] text-[#5A5C66] dark:text-[#A1A3AC] mt-0.5 flex items-center gap-1">
            <ListOrdered className="w-3 h-3 text-[#1A3A6B]" />
            Ranked by AI Priority Index with vulnerability weights
          </p>
        </div>

        {/* Filter Dropdown */}
        <div className="relative">
          <select
            value={filterNeed}
            onChange={(e) => {
              setFilterNeed(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs font-semibold py-1.5 px-2.5 bg-[#F8F8F7] dark:bg-[#0D0E12] border border-[#E4E4E0] dark:border-[#2E3038] rounded-lg text-[#14151A] dark:text-[#F1F1EF] focus:outline-none focus:ring-2 focus:ring-[#1A3A6B]/40 cursor-pointer"
          >
            <option value="ALL">All Reports</option>
            <option value="CRITICAL">Critical Only</option>
            <option value="Elderly">Elderly Need</option>
            <option value="Medical">Medical Urgent</option>
            <option value="Child">Infants / Children</option>
          </select>
        </div>
      </div>

      {/* QUEUE CARDS LIST */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-[#E4E4E0] dark:divide-[#2E3038]">
        {paginatedReports.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold text-[#5A5C66] dark:text-[#A1A3AC]">No matching SOS calls in this filter</p>
          </div>
        ) : (
          paginatedReports.map((report) => {
            const isSelected = selectedSOSId === report.id;
            return (
              <div
                key={report.id}
                onClick={() => openDetailDrawer(report.id)}
                className={`pt-3 first:pt-0 cursor-pointer group transition-all`}
              >
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-[#1A3A6B] bg-[#EFEFEC]/50 dark:bg-[#1C1D22] shadow-xs ring-2 ring-[#1A3A6B]/20'
                      : 'border-[#E4E4E0] dark:border-[#2E3038] bg-white dark:bg-[#17181C] hover:border-[#1A3A6B]/50 hover:shadow-2xs hover:dark:bg-[#26272E]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-data text-xs font-bold text-[#1A3A6B]">{report.id}</span>
                        <RiskBadge level={report.priorityLevel} showIcon={false} />
                        {report.isPriorityOverridden && (
                          <span className="text-[10px] font-semibold text-[#7A3E0B] dark:text-[#D9A03A] bg-[#FBF7EC] dark:bg-[#1C1D22] px-1.5 py-0.5 rounded border border-[#F7E9D6] dark:border-[#2E3038]">
                            Officer Override
                          </span>
                        )}
                      </div>

                      <div className="font-heading font-semibold text-sm text-[#14151A] dark:text-[#F1F1EF] truncate group-hover:text-[#1A3A6B] transition-colors">
                        {report.locationName}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-[#5A5C66] dark:text-[#A1A3AC] mt-1">
                        <span className="flex items-center gap-1 font-data font-medium text-[#14151A] dark:text-[#F1F1EF]">
                          <Users className="w-3.5 h-3.5 text-[#5A5C66] dark:text-[#A1A3AC]" />
                          {report.peopleCount} trapped
                        </span>
                        <span className="flex items-center gap-1 text-[11px]">
                          <Clock className="w-3.5 h-3.5 text-[#5A5C66] dark:text-[#A1A3AC]" />
                          {formatRelativeTime(report.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* AI Score Circular Progress */}
                    <div className="flex-shrink-0" title={`AI Priority Score: ${report.priorityScore}/100`}>
                      <PriorityRing score={report.priorityScore} size={48} strokeWidth={4} />
                    </div>
                  </div>

                  {/* AI Explanation Snippet with Tooltip indicator */}
                  <div className="mt-2.5 text-xs text-[#14151A] dark:text-[#F1F1EF] bg-[#F8F8F7] dark:bg-[#0D0E12] p-2 rounded-lg border border-[#E4E4E0] dark:border-[#2E3038] leading-snug line-clamp-2">
                    <span className="font-bold text-[#14151A] dark:text-[#9DB8DC] mr-1">AI Rationale:</span>
                    {report.aiExplanation}
                  </div>

                  {/* Assistance Chips */}
                  <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-[#E4E4E0] dark:border-[#2E3038]">
                    <div className="flex flex-wrap gap-1">
                      {report.needs.slice(0, 3).map((need) => (
                        <span
                          key={need}
                          className="px-2 py-0.5 rounded-md bg-[#F8F8F7] dark:bg-[#0D0E12] border border-[#E4E4E0] dark:border-[#2E3038] text-[10px] font-semibold text-[#14151A] dark:text-[#F1F1EF]"
                        >
                          {need}
                        </span>
                      ))}
                      {report.needs.length > 3 && (
                        <span className="px-1.5 py-0.5 text-[10px] text-[#5A5C66] dark:text-[#A1A3AC] font-semibold">
                          +{report.needs.length - 3}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openResponsePlan(report.id);
                      }}
                      className="text-xs font-bold text-[#1A3A6B] dark:text-[#9DB8DC] hover:underline flex items-center gap-0.5 cursor-pointer flex-shrink-0"
                    >
                      <span>Plan</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FINITE PAGINATION CONTROLS (Anti-infinite scroll rule) */}
      <div className="p-3 bg-[#F8F8F7] dark:bg-[#0D0E12] border-t border-[#E4E4E0] dark:border-[#2E3038] flex items-center justify-between text-xs text-[#5A5C66] dark:text-[#A1A3AC]">
        <span className="font-data font-medium">
          Page {currentPage} of {totalPages}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-lg border border-[#E4E4E0] dark:border-[#2E3038] bg-white dark:bg-[#1C1D22] hover:bg-[#EFEFEC] hover:dark:bg-[#282931] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4 text-[#14151A] dark:text-[#F1F1EF]" />
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-lg border border-[#E4E4E0] dark:border-[#2E3038] bg-white dark:bg-[#1C1D22] hover:bg-[#EFEFEC] hover:dark:bg-[#282931] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4 text-[#14151A] dark:text-[#F1F1EF]" />
          </button>
        </div>
      </div>

    </div>
  );
};
