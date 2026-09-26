import React, { useState } from 'react';
import { X, MapPin, Phone, Users, ShieldAlert, AlertTriangle, CheckCircle2, ArrowRight, Edit3, XCircle } from 'lucide-react';
import { useNexoraStore } from '../../store/useNexoraStore';
import { PriorityRing } from '../shared/PriorityRing';
import { RiskBadge } from '../shared/RiskBadge';
import { getTranslation } from '../../i18n/translations';

export const SOSDetailDrawer: React.FC = () => {
  const {
    selectedSOSId,
    sosReports,
    isDetailOpen,
    closeDetailDrawer,
    openResponsePlan,
    overridePriority,
    markFalseAlarm,
    currentLanguage
  } = useNexoraStore();

  const t = (k: Parameters<typeof getTranslation>[1], f?: string) => getTranslation(currentLanguage, k, f);

  const [isOverriding, setIsOverriding] = useState(false);
  const [overrideScore, setOverrideScore] = useState(85);
  const [overrideReason, setOverrideReason] = useState('Critical oxygen supply shortage reported by field Aapda volunteer');

  if (!isDetailOpen || !selectedSOSId) return null;

  const report = sosReports.find(r => r.id === selectedSOSId);
  if (!report) return null;

  const handleSaveOverride = (e: React.FormEvent) => {
    e.preventDefault();
    overridePriority(report.id, overrideScore, overrideReason);
    setIsOverriding(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end text-[#14151A]/50 backdrop-blur-xs animate-fadeIn">
      {/* Background click to close */}
      <div className="absolute inset-0" onClick={closeDetailDrawer} />

      {/* Slide-out Drawer Surface */}
      <div className="relative w-full max-w-lg h-full bg-white dark:bg-[#17181C] text-[#14151A] dark:text-[#F1F1EF] shadow-xl flex flex-col justify-between overflow-y-auto border-l border-[#E4E4E0] dark:border-[#2E3038] z-10">
        
        {/* DRAWER HEADER */}
        <div className="p-6 border-b border-[#E4E4E0] dark:border-[#2E3038] flex items-center justify-between bg-white dark:bg-[#17181C] sticky top-0 z-20">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-data text-xs font-bold text-[#12294D] dark:text-[#9DB8DC] bg-[#F1F1EF] dark:bg-[#0D0E12] px-2 py-0.5 rounded border border-[#DEDEDA] dark:border-[#2E3038]">
                {report.id}
              </span>
              <RiskBadge level={report.priorityLevel} />
            </div>
            <h2 className="font-heading text-lg font-bold text-[#14151A] dark:text-[#F1F1EF] mt-1">
              {t('triage_drawer_title', 'SOS Incident Triage')}
            </h2>
          </div>

          <button
            onClick={closeDetailDrawer}
            className="w-8 h-8 rounded-full bg-[#F1F1EF] dark:bg-[#1C1D22] hover:bg-[#E4E4E0] dark:hover:bg-[#2E3038] text-[#6B6D77] dark:text-[#A1A3AC] flex items-center justify-center cursor-pointer transition-all"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* DRAWER BODY CONTENT */}
        <div className="p-6 space-y-6 flex-1">
          
          {/* 1. AI PRIORITY SCORE & RATIONALE */}
          <div className="bg-[#F8F8F7] dark:bg-[#0D0E12] border border-[#DEDEDA] dark:border-[#2E3038] rounded-xl p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC]">
                  AI Dynamic Priority Index
                </div>
                <div className="font-heading text-xl font-bold text-[#14151A] dark:text-[#F1F1EF] mt-0.5">
                  Priority Rating: {report.priorityLevel}
                </div>
                {report.isPriorityOverridden && (
                  <div className="text-xs font-medium text-[#93690F] dark:text-[#D9A03A] mt-1">
                    Overridden: {report.overriddenBy}
                  </div>
                )}
              </div>
              <PriorityRing score={report.priorityScore} size={64} strokeWidth={6} showLabel={false} />
            </div>

            {/* AI Explanation Text */}
            <div className="mt-4 pt-4 border-t border-[#DEDEDA] dark:border-[#2E3038] text-xs text-[#5A5C66] dark:text-[#A1A3AC] leading-relaxed">
              <span className="font-bold text-[#12294D] dark:text-[#9DB8DC] block mb-1">Algorithmic Rationale:</span>
              <p className="bg-white dark:bg-[#1C1D22] p-3 rounded-xl border border-[#DEDEDA]/80 dark:border-[#2E3038] text-[#5A5C66] dark:text-[#F1F1EF] shadow-2xs font-body">
                "{report.aiExplanation}"
              </p>
            </div>
          </div>

          {/* 2. REPORTER INFORMATION */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC]">
              Reporter & Geographic Coordinates
            </h4>

            <div className="bg-white dark:bg-[#1C1D22] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#6B6D77] dark:text-[#A1A3AC] flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-[#6B6D77] dark:text-[#74767F]" />
                  Reporter Contact (Masked)
                </span>
                <span className="font-data font-bold text-[#12294D] dark:text-[#9DB8DC]">{report.maskedPhone}</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#6B6D77] dark:text-[#A1A3AC] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#6B6D77] dark:text-[#74767F]" />
                  Reported Location
                </span>
                <span className="font-semibold text-[#14151A] dark:text-[#F1F1EF] text-right">{report.locationName}</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#6B6D77] dark:text-[#A1A3AC] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[#6B6D77] dark:text-[#74767F]" />
                  Headcount Trapped
                </span>
                <span className="font-data font-bold text-base text-[#B42318] dark:text-[#E0776C]">
                  {report.peopleCount} Citizens
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-[#E4E4E0] dark:border-[#2E3038]">
                <span className="text-[#6B6D77] dark:text-[#A1A3AC]">Current Inundation Depth</span>
                <span className="font-data font-bold text-[#12294D] dark:text-[#9DB8DC]">{report.waterLevelMeters} meters</span>
              </div>
            </div>
          </div>

          {/* 3. ASSISTANCE NEEDS CHIPS */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#6B6D77] dark:text-[#A1A3AC] mb-2">
              Specific Assistance Flags
            </h4>
            <div className="flex flex-wrap gap-2">
              {report.needs.map((need) => (
                <span
                  key={need}
                  className="px-3 py-1.5 rounded-xl bg-[#EFEFEC] dark:bg-[#1C1D22]/60 text-[#12294D] dark:text-[#9DB8DC] border border-[#DCDCD8] dark:border-[#2E3038] text-xs font-bold flex items-center gap-1.5 shadow-2xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1A3A6B] dark:bg-[#5B7BA8]" />
                  {need}
                </span>
              ))}
            </div>
          </div>

          {/* 4. OFFICER MANUAL OVERRIDE ACCORDION */}
          {isOverriding ? (
            <form onSubmit={handleSaveOverride} className="bg-[#FAF0D8]/70 dark:bg-[#241B0B]/40 border border-[#EFE3C4] dark:border-[#4A3A18]/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#7A3E0B] dark:text-[#D9A03A] flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5" />
                  Manual Priority Override
                </span>
                <button
                  type="button"
                  onClick={() => setIsOverriding(false)}
                  className="text-xs text-[#6B6D77] dark:text-[#A1A3AC] hover:underline cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#5A5C66] dark:text-[#A1A3AC] block mb-1">
                  Adjusted Score: <span className="font-data text-sm font-bold text-[#12294D] dark:text-[#9DB8DC]">{overrideScore}</span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="99"
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(Number(e.target.value))}
                  className="w-full accent-[#12294D] cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#5A5C66] dark:text-[#A1A3AC] block mb-1">
                  Reason for Override (Audited)
                </label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full text-xs p-2 border border-[#EFE3C4] dark:text-[#4A3A18]/60 rounded-lg bg-white dark:bg-[#0D0E12] text-[#14151A] dark:text-[#F1F1EF] focus:outline-none focus:ring-2 focus:ring-[#12294D]/20"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full btn-primary-gradient py-2 text-xs font-bold rounded-lg shadow-xs"
              >
                Apply Audited Override
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setIsOverriding(true)}
                className="text-xs font-semibold text-[#1A3A6B] dark:text-[#9DB8DC] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{t('override_priority', 'Override AI Score')}</span>
              </button>

              <button
                onClick={() => {
                  if (confirm("Are you sure you want to mark this report as a FALSE ALARM? This will remove it from the rescue dispatch queue.")) {
                    markFalseAlarm(report.id);
                  }
                }}
                className="text-xs font-semibold text-[#B42318] dark:text-[#E0776C] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{t('mark_false', 'Mark as False Alarm')}</span>
              </button>
            </div>
          )}

        </div>

        {/* DRAWER FOOTER ACTIONS */}
        <div className="p-6 border-t border-[#E4E4E0] dark:border-[#2E3038] bg-[#FFFFFF] dark:bg-[#17181C] space-y-2 sticky bottom-0 z-20">
          <button
            onClick={() => openResponsePlan(report.id)}
            className="w-full btn-primary-gradient py-3.5 px-4 rounded-xl text-sm font-bold shadow-md flex items-center justify-center gap-2"
          >
            <span>{t('approve_dispatch', 'Generate Response Plan')}</span>
            <ArrowRight className="w-4 h-4 text-white" />
          </button>
          
          <button
            onClick={closeDetailDrawer}
            className="w-full btn-ghost-outline py-2.5 px-4 rounded-xl text-xs font-medium text-[#6B6D77] dark:text-[#A1A3AC] dark:border-[#2E3038] dark:hover:bg-[#1C1D22]"
          >
            Return to Dashboard
          </button>
        </div>

      </div>
    </div>
  );
};
