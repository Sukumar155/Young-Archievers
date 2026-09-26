import React, { useState } from 'react';
import { TopBar } from '../components/dashboard/TopBar';
import { AlertTriangle, Bell, Radio, Send, ShieldAlert, CheckCircle2, Volume2, MessageSquare, Smartphone, Users, ExternalLink } from 'lucide-react';
import { useNexoraStore } from '../store/useNexoraStore';
import { BroadcastChannel, AlertSeverity } from '../types/alert';
import { getTranslation } from '../i18n/translations';

export const AlertsPage: React.FC = () => {
  const {
    alerts,
    broadcastNewAlert,
    dismissAlert,
    setCurrentView,
    currentLanguage
  } = useNexoraStore();

  const t = (k: string, f?: string) => getTranslation(currentLanguage, k, f);

  const [title, setTitle] = useState('FLASH FLOOD SURGE EMERGENCY — EVACUATION NOTICE');
  const [severity, setSeverity] = useState<AlertSeverity>('CRITICAL');
  const [zone, setZone] = useState('Zone A: Pandu Ghat & Lowlands');
  const [locationName, setLocationName] = useState('Pandu Lowlands & Temple Road, Ward 14');
  const [reason, setReason] = useState('Brahmaputra water level rapidly approaching danger crest (82cm, rising +14cm/hr). Embankment scouring active.');
  const [recommendedAction, setRecommendedAction] = useState('Immediate evacuation to Pragati High School camp. Pack dry rations and essential medicine. Avoid Pandu viaduct.');
  const [channels, setChannels] = useState<BroadcastChannel[]>(['CAP_PROTOCOL', 'CELL_BROADCAST', 'SMS_GATEWAY', 'USSD', 'SIREN_NETWORK']);
  const [broadcastSuccess, setBroadcastSuccess] = useState(false);

  const toggleChannel = (ch: BroadcastChannel) => {
    if (channels.includes(ch)) {
      setChannels(channels.filter(c => c !== ch));
    } else {
      setChannels([...channels, ch]);
    }
  };

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    broadcastNewAlert({
      title,
      severity,
      zone,
      locationName,
      lat: 26.178,
      lng: 91.702,
      reason,
      recommendedAction,
      issuedBy: "SEOC Incident Command System (ICS)",
      channels,
      affectedPopulation: 6800
    });

    setBroadcastSuccess(true);
    setTimeout(() => {
      setBroadcastSuccess(false);
    }, 2500);
  };

  return (
    <div className="min-h-screen text-[#14151A] dark:text-[#F1F1EF] flex flex-col font-body transition-colors">
      <TopBar />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 space-y-6">
        
        {/* PAGE HEADER */}
        <div className="bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#FCF1F0] dark:bg-[#1C1D22] text-[#B42318] dark:text-[#E0776C] border border-[#F3CFC9] dark:border-[#4A2622]/60 flex items-center justify-center shadow-xs flex-shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#5A5C66] dark:text-[#A1A3AC] font-data">
                  {t('alerts_subtitle', 'Common Alerting Protocol (CAP v1.2) • SEOC Early Warning')}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FCF1F0] dark:bg-[#1C1D22] text-[#B42318] dark:text-[#E0776C] border border-[#F3CFC9] dark:border-[#4A2622]/60">
                  SEOC Early Warning
                </span>
              </div>
              <h1 className="font-heading text-lg sm:text-xl font-bold text-[#14151A] dark:text-[#F1F1EF] mt-0.5">
                {t('alerts_title', 'Alerts & Multi-Channel Early Warning')}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block font-data">
              <span className="text-xs text-[#5A5C66] dark:text-[#A1A3AC] block">CAP v1.2 Standard</span>
              <span className="text-[11px] font-bold text-[#126B34] dark:text-[#5BBF7A]">Carrier Gateways Connected</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT: ACTIVE ALERTS FEED */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-heading font-bold text-base text-[#14151A] dark:text-[#F1F1EF] flex items-center gap-2">
                <span>{t('alerts_active_bulletins', 'Active Emergency Bulletins')}</span>
                <span className="px-2 py-0.5 text-xs font-data font-bold rounded-full bg-[#EFEFEC] dark:bg-[#0D0E12] text-[#12294D] dark:text-[#9DB8DC] border border-[#DCDCD8] dark:border-[#2E3038]">
                  {alerts.filter(a => a.active).length} Active
                </span>
              </h2>
            </div>

            <div className="space-y-3.5">
              {alerts.map((alert) => {
                const isCritical = alert.severity === 'CRITICAL';
                const isSevere = alert.severity === 'SEVERE';

                return (
                  <div
                    key={alert.id}
                    className={`p-5 rounded-xl bg-white dark:bg-[#17181C] border border-[#E4E4E0] dark:border-[#2E3038] border-l-4 space-y-3 shadow-xs transition-all ${
                      isCritical
                        ? 'border-l-[#B42318]'
                        : isSevere
                        ? 'border-l-[#8A4D06]'
                        : 'border-l-[#12294D] dark:border-l-[#9DB8DC]'
                    } ${!alert.active ? 'opacity-60' : ''}`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-data ${
                            isCritical
                              ? 'bg-[#FCF1F0] dark:bg-[#1C1D22] text-[#B42318] dark:text-[#E0776C] border border-[#F3CFC9] dark:border-[#4A2622]/60'
                              : isSevere
                              ? 'bg-[#FBF7EC] dark:bg-[#1C1D22] text-[#8A4D06] dark:text-[#DD8348] border border-[#F7E9D6] dark:border-[#2E3038]'
                              : 'bg-[#EFEFEC] dark:bg-[#0D0E12] text-[#12294D] dark:text-[#9DB8DC] border border-[#DCDCD8] dark:border-[#2E3038]'
                          }`}>
                            {alert.severity}
                          </span>
                          <span className="text-xs font-data text-[#5A5C66] dark:text-[#A1A3AC]">{alert.timestamp}</span>
                          <span className="text-xs font-data text-[#5A5C66] dark:text-[#A1A3AC]">• {alert.zone}</span>
                        </div>
                        <h3 className="font-heading font-bold text-sm sm:text-base text-[#14151A] dark:text-[#F1F1EF] mt-1">
                          {alert.title}
                        </h3>
                      </div>

                      {alert.active && (
                        <button
                          onClick={() => dismissAlert(alert.id)}
                          className="text-xs font-semibold text-[#5A5C66] dark:text-[#A1A3AC] hover:text-[#B42318] dark:hover:text-[#E0776C] px-2.5 py-1 rounded-lg hover:bg-[#FCF1F0] hover:dark:bg-[#1C1D22] transition-colors cursor-pointer"
                        >
                          {t('alerts_resolve', 'Resolve')}
                        </button>
                      )}
                    </div>

                    {/* Threat Diagnostic */}
                    <div className="bg-[#F8F8F7] dark:bg-[#0D0E12] p-3 rounded-xl border border-[#E4E4E0] dark:border-[#2E3038] text-xs text-[#14151A] dark:text-[#F1F1EF] leading-relaxed">
                      <strong className="text-[#14151A] dark:text-[#9DB8DC] block mb-0.5">{t('alerts_diagnostic', 'Threat Diagnostic / Hydro Reason')}:</strong>
                      {alert.reason}
                    </div>

                    {/* Recommended Action */}
                    <div className="bg-[#FBF7EC] dark:bg-[#1C1D22] border border-[#F7E9D6] dark:border-[#2E3038] p-3 rounded-xl text-xs text-[#7A3E0B] dark:text-[#F1F1EF] leading-relaxed">
                      <strong className="block text-[#7A3E0B] dark:text-[#DD8348] mb-0.5 flex items-center gap-1.5 font-bold">
                        <ShieldAlert className="w-3.5 h-3.5 text-[#8A4D06] dark:text-[#DD8348]" />
                        {t('alerts_citizen_action', 'Recommended Action for Citizens')}:
                      </strong>
                      {alert.recommendedAction}
                    </div>

                    {/* Distribution Channels & Demographics */}
                    <div className="pt-2 border-t border-[#E4E4E0] dark:border-[#2E3038] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5A5C66] dark:text-[#A1A3AC] font-data">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#14151A] dark:text-[#F1F1EF]">{t('alerts_channels', 'Broadcast Channels')}:</span>
                        <div className="flex items-center gap-1">
                          {alert.channels.map((ch, idx) => (
                            <span key={idx} className="bg-[#F8F8F7] dark:bg-[#0D0E12] border border-[#E4E4E0] dark:border-[#2E3038] px-1.5 py-0.5 rounded text-[#5A5C66] dark:text-[#A1A3AC] text-[10px]">
                              {ch.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-[#14151A] dark:text-[#F1F1EF]">
                        <Users className="w-3.5 h-3.5 text-[#5A5C66] dark:text-[#A1A3AC]" />
                        <span>~{alert.affectedPopulation.toLocaleString()} citizens targeted</span>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: AUTHORITY CAP BROADCAST COMPOSER */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 bg-white dark:bg-[#17181C] rounded-xl border border-[#E4E4E0] dark:border-[#2E3038] shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-[#E4E4E0] dark:border-[#2E3038] pb-3">
                <div>
                  <h2 className="font-heading font-bold text-base text-[#14151A] dark:text-[#F1F1EF] flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#12294D] dark:text-[#9DB8DC]" />
                    {t('alerts_cap_composer', 'CAP Broadcast Dispatcher')}
                  </h2>
                  <p className="text-xs text-[#5A5C66] dark:text-[#A1A3AC]">
                    {t('alerts_cap_desc', 'Dispatches synchronized alerts across Cell Broadcast, USSD, SMS & Sirens')}
                  </p>
                </div>
              </div>

              {broadcastSuccess && (
                <div className="bg-[#F1F8F3] border border-[#CFE6D8] p-3 rounded-xl flex items-center gap-2 text-xs font-bold text-[#126B34] animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 text-[#126B34] flex-shrink-0" />
                  <span>Alert broadcast successfully pushed to telecommunication carriers & SEOC mesh!</span>
                </div>
              )}

              <form onSubmit={handleBroadcast} className="space-y-3.5">
                
                {/* Severity Selection */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5C66] mb-1.5">
                    {t('alerts_severity_label', 'Alert Severity Level')}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['CRITICAL', 'SEVERE', 'MODERATE', 'ADVISORY'] as AlertSeverity[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setSeverity(lvl)}
                        className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                          severity === lvl
                            ? lvl === 'CRITICAL'
                              ? 'bg-[#B42318] text-white border-[#B42318]'
                              : lvl === 'SEVERE'
                              ? 'bg-[#8A4D06] text-white border-[#8A4D06]'
                              : lvl === 'MODERATE'
                              ? 'bg-[#BE9A2E] text-[#14151A] border-[#BE9A2E]'
                              : 'bg-[#126B34] text-white border-[#126B34]'
                            : 'bg-[#F8F8F7] text-[#14151A] border-[#E4E4E0] hover:bg-[#EFEFEC]'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Zone */}
                <div>
                  <label className="block text-xs font-bold text-[#14151A] mb-1">
                    {t('alerts_target_zone', 'Target Threat Zone')}
                  </label>
                  <select
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8F8F7] border border-[#E4E4E0] rounded-xl text-xs text-[#14151A] font-semibold focus:outline-none focus:ring-2 focus:ring-[#12294D]/20 cursor-pointer"
                  >
                    <option value="Zone A: Pandu Ghat & Lowlands">Zone A: Pandu Ghat & Lowlands</option>
                    <option value="Zone B: Bharalu River Confluence">Zone B: Bharalu River Confluence</option>
                    <option value="Zone C: Jalukbari Outer Basin">Zone C: Jalukbari Outer Basin</option>
                    <option value="All Kamrup Metro Basin">All Kamrup Metro Basin (District-Wide)</option>
                  </select>
                </div>

                {/* Headline */}
                <div>
                  <label className="block text-xs font-bold text-[#14151A] mb-1">
                    {t('alerts_headline', 'Alert Headline')}
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8F8F7] border border-[#E4E4E0] rounded-xl text-xs text-[#14151A] font-semibold focus:outline-none focus:ring-2 focus:ring-[#12294D]/20"
                  />
                </div>

                {/* Diagnosis / Reason */}
                <div>
                  <label className="block text-xs font-bold text-[#14151A] mb-1">
                    {t('alerts_diagnostic', 'Threat Diagnostic / Hydro Reason')}
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8F8F7] border border-[#E4E4E0] rounded-xl text-xs text-[#14151A] focus:outline-none focus:ring-2 focus:ring-[#12294D]/20"
                  />
                </div>

                {/* Citizen Advice */}
                <div>
                  <label className="block text-xs font-bold text-[#14151A] mb-1">
                    {t('alerts_citizen_action', 'Direct Citizen Directive / Evacuation Route')}
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={recommendedAction}
                    onChange={(e) => setRecommendedAction(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8F8F7] border border-[#E4E4E0] rounded-xl text-xs text-[#14151A] focus:outline-none focus:ring-2 focus:ring-[#12294D]/20"
                  />
                </div>

                {/* Channel Checkboxes */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5C66] mb-2">
                    {t('alerts_channels', 'Multi-Channel Carriers')}
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F8F7] border border-[#E4E4E0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channels.includes('CELL_BROADCAST')}
                        onChange={() => toggleChannel('CELL_BROADCAST')}
                        className="rounded accent-[#12294D]"
                      />
                      <Smartphone className="w-3.5 h-3.5 text-[#5A5C66]" />
                      <span>Cell Broadcast</span>
                    </label>

                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F8F7] border border-[#E4E4E0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channels.includes('USSD')}
                        onChange={() => toggleChannel('USSD')}
                        className="rounded accent-[#12294D]"
                      />
                      <Radio className="w-3.5 h-3.5 text-[#5A5C66]" />
                      <span>2G USSD (*123#)</span>
                    </label>

                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F8F7] border border-[#E4E4E0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channels.includes('SMS_GATEWAY')}
                        onChange={() => toggleChannel('SMS_GATEWAY')}
                        className="rounded accent-[#12294D]"
                      />
                      <MessageSquare className="w-3.5 h-3.5 text-[#5A5C66]" />
                      <span>SMS Broadcast</span>
                    </label>

                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F8F7] border border-[#E4E4E0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channels.includes('SIREN_NETWORK')}
                        onChange={() => toggleChannel('SIREN_NETWORK')}
                        className="rounded accent-[#12294D]"
                      />
                      <Volume2 className="w-3.5 h-3.5 text-[#5A5C66]" />
                      <span>Acoustic Sirens</span>
                    </label>
                  </div>
                </div>

                {/* Submit button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-[#B42318] hover:bg-[#9E2C25] text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>{t('alerts_broadcast_btn', 'Broadcast Common Alerting Protocol Notice')}</span>
                  </button>
                </div>

              </form>

            </div>
          </div>

        </div>

      </main>
    </div>
  );
};
