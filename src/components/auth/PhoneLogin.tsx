import React, { useState } from 'react';
import {
  Shield, Smartphone, Users, Home, Radio, ArrowRight, CheckCircle2,
  ChevronLeft, Siren, RefreshCw, Waves, Clock, Target
} from 'lucide-react';
import { OTPInput } from './OTPInput';
import { useNexoraStore, UserRole } from '../../store/useNexoraStore';
import {
  detectLocation, reverseGeocode, isGeolocationSupported, coordsLabel
} from '../../services/geolocationService';

type RoleType = 'CITIZEN' | 'AUTHORITY';
type Step = 'ROLE' | 'FORM' | 'OTP';

const AGENCIES = ['SEOC', 'DDMA', 'NDRF', 'SDRF', 'Assam Police', 'Fire & Emergency'];

const POSTINGS: { role: UserRole; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { role: 'DDMO_OFFICER', label: 'Command', icon: Shield },
  { role: 'FIELD_RESPONDER', label: 'Responder', icon: Smartphone },
  { role: 'SHELTER_MANAGER', label: 'Shelter', icon: Home },
];

const subRoleLabel = (role: UserRole) =>
  role === 'DDMO_OFFICER' ? 'Command / DDMO'
    : role === 'FIELD_RESPONDER' ? 'Field Responder'
    : 'Shelter Manager';

const STATS = [
  { icon: Clock, label: 'Dispatch', value: '15 min', note: 'Average response' },
  { icon: Target, label: 'Precision', value: '91%', note: 'Flood model accuracy' },
  { icon: Users, label: 'Reach', value: '100M+', note: 'Citizens connected' },
];

export const PhoneLogin: React.FC = () => {
  const { login, submitQuickSOS, toggleUSSDModal } = useNexoraStore();

  const [roleType, setRoleType] = useState<RoleType | null>(null);
  const [subRole, setSubRole] = useState<UserRole>('DDMO_OFFICER');
  const [step, setStep] = useState<Step>('ROLE');
  const [phoneNumber, setPhoneNumber] = useState('9435100294');
  const [otp, setOtp] = useState('841290');
  const [countdown, setCountdown] = useState(45);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ fullName: '', locality: '', familySize: '2', agency: AGENCIES[0] });
  const [sosState, setSosState] = useState<'IDLE' | 'SENDING' | 'SENT' | 'ERROR'>('IDLE');
  const [sosMessage, setSosMessage] = useState('');

  const isCitizen = roleType === 'CITIZEN';
  const finalRole: UserRole = isCitizen ? 'CITIZEN' : subRole;

  const heading =
    step === 'ROLE' ? 'Choose your portal'
    : step === 'FORM' ? (isCitizen ? 'Your details' : 'Authority details')
    : 'Verify your number';

  const subcopy =
    step === 'ROLE'
      ? 'NEXORA routes citizens and response personnel to the right workspace. Verification takes a few seconds.'
      : step === 'FORM'
        ? isCitizen
          ? 'Your details let us send shelter availability, alerts and support to your area.'
          : 'Your posting decides which authority workspace opens after verification.'
        : `Enter the 6-digit code sent to +91 ${phoneNumber}.`;

  const steps: { key: Step; label: string }[] = [
    { key: 'ROLE', label: 'Portal' },
    { key: 'FORM', label: 'Details' },
    { key: 'OTP', label: 'Verify' },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  const handleChooseRole = (type: RoleType) => {
    setRoleType(type);
    setStep('FORM');
  };

  const goBack = () => {
    if (step === 'OTP') { setStep('FORM'); return; }
    if (step === 'FORM') { setRoleType(null); setStep('ROLE'); }
  };

  const handleSendOTP = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) {
      alert('Please enter your full name as per your identity card.');
      return;
    }
    if (phoneNumber.length !== 10) {
      alert('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep('OTP');
    }, 600);
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      alert('Please enter the 6-digit OTP code.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      login(`+91 ${phoneNumber}`, finalRole, {
        fullName: form.fullName.trim(),
        locality: isCitizen ? form.locality.trim() || undefined : undefined,
        familySize: isCitizen ? Number(form.familySize) || undefined : undefined,
        agency: isCitizen ? undefined : form.agency,
      });
    }, 500);
  };

  /** One-tap SOS beacon on the login page — reaches SEOC without signing in. */
  const handleSOSSignal = async () => {
    if (sosState === 'SENDING') return;
    setSosState('SENDING');
    setSosMessage('');
    try {
      let lat = 26.1445;
      let lng = 91.7362;
      let locationName = 'Guwahati (Default Sector)';
      if (isGeolocationSupported()) {
        const pos = await detectLocation(10000);
        lat = pos.lat;
        lng = pos.lng;
        locationName = (await reverseGeocode(lat, lng)) || coordsLabel(lat, lng);
      }
      submitQuickSOS({ lat, lng, locationName, accuracy: 50 });
      setSosState('SENT');
      setSosMessage('Beacon relayed to SEOC command — no login needed.');
    } catch {
      setSosState('ERROR');
      setSosMessage('Could not confirm your location. Allow location access & retry.');
    }
    window.setTimeout(() => {
      setSosState((prev) => (prev === 'SENT' || prev === 'ERROR' ? 'IDLE' : prev));
      setSosMessage('');
    }, 8000);
  };

  const recapChip = (
    <div className="flex items-center justify-between h-9 pl-3 pr-1.5 bg-[#F8F8F7] border border-[#E4E4E0] rounded-lg">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#2E3038]">
        {isCitizen ? (
          <><Users className="w-3.5 h-3.5 text-[#126B34]" /> Citizen Portal</>
        ) : (
          <><Shield className="w-3.5 h-3.5 text-[#1A3A6B]" /> Authority — {subRoleLabel(subRole)}</>
        )}
      </span>
      <button
        type="button"
        onClick={goBack}
        className="flex items-center gap-0.5 h-7 px-2 text-[12px] font-medium text-[#1A3A6B] hover:bg-[#EEF2F8] rounded-md transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-3 h-3" /> Change
      </button>
    </div>
  );

  const inputCls =
    'w-full h-10 px-3 text-[14px] text-[#14151A] placeholder-[#A1A3AC] bg-white border border-[#D4D4CE] rounded-lg focus:outline-none focus:border-[#1A3A6B] focus:ring-[3px] focus:ring-[#1A3A6B]/[0.13] transition-[border-color,box-shadow]';

  const selectCls =
    'w-full h-10 px-3 pr-8 text-[14px] text-[#14151A] bg-white border border-[#D4D4CE] rounded-lg focus:outline-none focus:border-[#1A3A6B] focus:ring-[3px] focus:ring-[#1A3A6B]/[0.13] transition-[border-color,box-shadow] cursor-pointer';

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-[1080px] bg-white border border-[#E4E4E0] rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 shadow-[0_4px_12px_-2px_rgba(20,21,26,0.08),0_2px_4px_-2px_rgba(20,21,26,0.04)]">

        {/* ══ LEFT: ROLE → DETAILS → OTP WIZARD ══════════════════════════════ */}
        <div className="p-6 sm:p-9 lg:p-10 flex flex-col bg-white">
          <div>
            {/* Brand */}
            <div className="flex items-center gap-2.5 mb-8">
              <div className="w-9 h-9 rounded-lg bg-[#1A3A6B] flex items-center justify-center">
                <Shield className="w-[18px] h-[18px] text-white" strokeWidth={2.1} />
              </div>
              <div className="leading-none">
                <div className="font-heading text-[17px] font-semibold tracking-[-0.02em] text-[#14151A]">NEXORA</div>
                <div className="font-data text-[9px] font-medium tracking-[0.14em] uppercase text-[#6B6D77] mt-1.5">
                  Disaster Intelligence
                </div>
              </div>
            </div>

            {/* Step indicator */}
            <ol className="flex items-center gap-2 mb-7" aria-label="Login progress">
              {steps.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-[18px] h-[18px] rounded-full text-[10px] font-semibold flex items-center justify-center transition-colors ${
                        i < stepIndex
                          ? 'bg-[#E4F3E9] text-[#126B34]'
                          : i === stepIndex
                            ? 'bg-[#1A3A6B] text-white'
                            : 'bg-[#F1F1EF] text-[#5A5C66] border border-[#E4E4E0]'
                      }`}
                    >
                      {i < stepIndex ? <CheckCircle2 className="w-2.5 h-2.5" /> : i + 1}
                    </span>
                    <span className={`text-[12px] ${i === stepIndex ? 'font-semibold text-[#14151A]' : 'font-medium text-[#6B6D77]'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <span className={`w-6 sm:w-8 h-px ${i < stepIndex ? 'bg-[#CFE6D8]' : 'bg-[#E4E4E0]'}`} />
                  )}
                </li>
              ))}
            </ol>

            <div className="mb-6">
              <h1 className="font-heading text-[26px] sm:text-[28px] font-semibold tracking-[-0.025em] text-[#14151A] leading-[1.2]">
                {heading}
              </h1>
              <p className="text-[14px] text-[#5A5C66] mt-2 leading-relaxed max-w-md">{subcopy}</p>
            </div>

            {step === 'ROLE' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* CITIZEN */}
                  <button
                    type="button"
                    data-login-role="CITIZEN"
                    onClick={() => handleChooseRole('CITIZEN')}
                    className="group w-full text-left bg-white border border-[#E4E4E0] hover:border-[#126B34] hover:shadow-[0_2px_6px_-2px_rgba(20,21,26,0.08)] rounded-xl p-4 transition-all cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#F1F1EF] group-hover:bg-[#E4F3E9] flex items-center justify-center transition-colors">
                      <Users className="w-[17px] h-[17px] text-[#126B34]" />
                    </div>
                    <h3 className="mt-3 font-heading text-[15px] font-semibold text-[#14151A]">Citizen</h3>
                    <p className="mt-1 text-[13px] text-[#5A5C66] leading-relaxed">
                      Area status, shelters, incident reports and one-tap SOS.
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#126B34]">
                      Continue <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>

                  {/* AUTHORITY */}
                  <button
                    type="button"
                    data-login-role="AUTHORITY"
                    onClick={() => handleChooseRole('AUTHORITY')}
                    className="group w-full text-left bg-white border border-[#C3D0E4] hover:border-[#1A3A6B] hover:shadow-[0_2px_6px_-2px_rgba(20,21,26,0.08)] rounded-xl p-4 transition-all cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#EEF2F8] group-hover:bg-[#E3EAF4] flex items-center justify-center transition-colors">
                      <Shield className="w-[17px] h-[17px] text-[#1A3A6B]" />
                    </div>
                    <h3 className="mt-3 font-heading text-[15px] font-semibold text-[#14151A]">Authority / Responder</h3>
                    <p className="mt-1 text-[13px] text-[#5A5C66] leading-relaxed">
                      Command hub for DDMO, field responders and shelter managers.
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#1A3A6B]">
                      Continue <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>
                </div>

                <p className="text-[12px] text-[#6B6D77] leading-relaxed">
                  <span className="font-medium text-[#2E3038]">Authority</span> covers DDMO, NDRF / SDRF, police and
                  district command personnel.{' '}
                  <span className="font-medium text-[#2E3038]">Citizens</span> receive SOS, shelter availability and
                  area alerts.
                </p>
              </div>
            )}

            {step === 'FORM' && (
              <form onSubmit={handleSendOTP} className="space-y-4">
                {recapChip}

                <div>
                  <label htmlFor="fullName" className="block text-[12px] font-medium text-[#5A5C66] mb-1.5">
                    Full name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="As per your identity card"
                    className={inputCls}
                    required
                  />
                </div>

                {isCitizen ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="locality" className="block text-[12px] font-medium text-[#5A5C66] mb-1.5">
                        Locality / area
                      </label>
                      <input
                        id="locality"
                        type="text"
                        value={form.locality}
                        onChange={(e) => setForm({ ...form, locality: e.target.value })}
                        placeholder="e.g. Hatigaon, Guwahati"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor="familySize" className="block text-[12px] font-medium text-[#5A5C66] mb-1.5">
                        Family members
                      </label>
                      <input
                        id="familySize"
                        type="number"
                        min={1}
                        max={30}
                        value={form.familySize}
                        onChange={(e) => setForm({ ...form, familySize: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-[12px] font-medium text-[#5A5C66] mb-1.5">
                        Your posting / workspace
                      </label>
                      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Authority posting">
                        {POSTINGS.map((p) => {
                          const Icon = p.icon;
                          const active = subRole === p.role;
                          return (
                            <button
                              key={p.role}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              data-posting={p.role}
                              onClick={() => setSubRole(p.role)}
                              className={`flex flex-col items-center gap-1.5 h-auto px-2 py-2.5 rounded-lg text-[12px] transition-all cursor-pointer border ${
                                active
                                  ? 'bg-[#EEF2F8] text-[#1A3A6B] border-[#1A3A6B] font-semibold'
                                  : 'bg-white text-[#5A5C66] border-[#E4E4E0] hover:border-[#C3D0E4] hover:text-[#14151A]'
                              }`}
                            >
                              <Icon className="w-4 h-4" strokeWidth={active ? 2.1 : 1.9} />
                              <span>{p.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="agency" className="block text-[12px] font-medium text-[#5A5C66] mb-1.5">
                        Agency
                      </label>
                      <select
                        id="agency"
                        value={form.agency}
                        onChange={(e) => setForm({ ...form, agency: e.target.value })}
                        className={selectCls}
                      >
                        {AGENCIES.map((a) => (
                          <option key={a} value={a} className="bg-white text-[#14151A]">{a}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {/* Mobile number */}
                <div>
                  <label htmlFor="phone" className="block text-[12px] font-medium text-[#5A5C66] mb-1.5">
                    Mobile number
                  </label>
                  <div className="flex h-10 rounded-lg border border-[#D4D4CE] bg-white overflow-hidden focus-within:border-[#1A3A6B] focus-within:ring-[3px] focus-within:ring-[#1A3A6B]/[0.13] transition-[border-color,box-shadow]">
                    <span className="inline-flex items-center px-3 bg-[#F1F1EF] text-[#2E3038] font-data font-medium text-[13px] border-r border-[#E4E4E0] select-none">
                      🇮🇳 +91
                    </span>
                    <input
                      id="phone"
                      type="tel"
                      pattern="[0-9]{10}"
                      maxLength={10}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                      placeholder="98765 43210"
                      className="flex-1 px-3 text-[14px] font-data font-medium text-[#14151A] placeholder-[#A1A3AC] placeholder:font-body focus:outline-none min-w-0"
                      required
                    />
                  </div>
                  <p className="text-[12px] text-[#6B6D77] mt-1.5">
                    Secured with two-factor SMS OTP and the Disaster Mesh gateway.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-primary-gradient h-10 px-5 rounded-lg text-[14px]"
                >
                  <span>{loading ? 'Dispatching OTP…' : 'Continue with OTP'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {step === 'OTP' && (
              <form onSubmit={handleVerify} className="space-y-5">
                {recapChip}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[12px] font-medium text-[#5A5C66]">6-digit SMS code</label>
                    <button
                      type="button"
                      onClick={goBack}
                      className="text-[12px] font-medium text-[#1A3A6B] hover:underline cursor-pointer"
                    >
                      Change details
                    </button>
                  </div>

                  <OTPInput value={otp} onChange={setOtp} disabled={loading} />

                  <div className="flex items-center justify-between mt-3 text-[12px] text-[#6B6D77]">
                    <span>Did not receive the code?</span>
                    <span className="font-data font-medium text-[#1A3A6B]">Resend in {countdown}s</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-primary-gradient h-10 px-5 rounded-lg text-[14px]"
                >
                  <span>
                    {loading
                      ? 'Verifying…'
                      : `Verify & enter ${isCitizen ? 'citizen portal' : 'authority dashboard'}`}
                  </span>
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>

          {/* ── Footer: one-tap SOS (no login) + USSD fallback ── */}
          <div className="pt-6 border-t border-[#EDEDEA] mt-8 space-y-3">
            <div className="rounded-xl border border-[#F3CFC9] bg-[#FCF1F0] p-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-[#B42318] flex items-center gap-1.5">
                    <Siren className="w-3.5 h-3.5" />
                    In an emergency? No login needed.
                  </div>
                  <p className="text-[12px] text-[#5A5C66] mt-1 leading-relaxed">
                    One tap sends an SOS beacon with your GPS location straight to the SEOC command centre.
                  </p>
                  {sosMessage && (
                    <p className="text-[12px] font-medium mt-1.5 flex items-center gap-1 text-[#B42318]">
                      {sosState === 'ERROR'
                        ? <RefreshCw className="w-3 h-3 text-[#B54708]" />
                        : <CheckCircle2 className="w-3 h-3 text-[#126B34]" />}
                      {sosMessage}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSOSSignal}
                  disabled={sosState === 'SENDING'}
                  className={`shrink-0 flex items-center gap-1.5 h-9 px-4 rounded-lg text-[12px] font-semibold text-white transition-colors whitespace-nowrap cursor-pointer ${
                    sosState === 'SENDING'
                      ? 'bg-[#B42318]/55 cursor-wait'
                      : sosState === 'SENT'
                        ? 'bg-[#126B34] hover:bg-[#12703C]'
                        : 'bg-[#B42318] hover:bg-[#9A1C13]'
                  }`}
                >
                  {sosState === 'SENDING'
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : sosState === 'SENT'
                      ? <CheckCircle2 className="w-3.5 h-3.5" />
                      : <Siren className="w-3.5 h-3.5" />}
                  <span>
                    {sosState === 'SENDING' ? 'Sending…' : sosState === 'SENT' ? 'Signal sent' : 'Send SOS signal'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium text-[#2E3038] flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-[#5A5C66]" />
                  <span>No internet connection?</span>
                </div>
                <p className="text-[12px] text-[#6B6D77] mt-0.5">
                  Field personnel can use a GSM dialer without 4G or WiFi.
                </p>
              </div>

              <button
                type="button"
                onClick={() => toggleUSSDModal(true)}
                className="shrink-0 h-9 px-3.5 rounded-lg text-[12px] font-medium text-[#1A3A6B] bg-white border border-[#D4D4CE] hover:bg-[#F8F8F7] hover:border-[#C3D0E4] transition-colors cursor-pointer whitespace-nowrap"
              >
                Continue with USSD (*123#)
              </button>
            </div>
          </div>
        </div>

        {/* ══ RIGHT: EDITORIAL BRAND PANEL ═════════════════════════════════ */}
        <aside className="relative lg:col-span-1 p-6 sm:p-9 lg:p-10 bg-[#F1F1EF] border-t lg:border-t-0 lg:border-l border-[#E4E4E0] flex flex-col justify-between overflow-hidden">

          {/* Topographic texture — still, hairline, ~4% */}
          <div className="absolute inset-0 opacity-70 pointer-events-none" aria-hidden="true">
            <svg width="100%" height="100%" viewBox="0 0 520 760" preserveAspectRatio="xMidYMid slice">
              <g fill="none" stroke="#1A3A6B" strokeWidth="1" strokeOpacity="0.07">
                <path d="M -40 300 C 90 258 190 296 300 262 C 400 232 470 274 560 246" />
                <path d="M -40 360 C 100 320 210 352 320 322 C 420 294 480 330 560 306" />
                <path d="M -40 420 C 110 384 220 412 330 386 C 428 362 484 392 560 370" />
                <path d="M -40 480 C 120 448 230 472 340 450 C 434 430 486 454 560 436" />
                <path d="M -40 540 C 130 512 240 532 350 514 C 440 498 488 518 560 502" />
                <path d="M -40 180 C 80 140 170 176 270 144 C 366 114 440 152 560 124" />
                <path d="M -40 620 C 140 594 250 612 360 596 C 444 584 490 600 560 588" />
              </g>
              <g fill="none" stroke="#5A5C66" strokeWidth="1" strokeOpacity="0.06">
                <ellipse cx="410" cy="672" rx="140" ry="58" />
                <ellipse cx="410" cy="672" rx="92" ry="38" />
                <ellipse cx="120" cy="96" rx="120" ry="50" />
              </g>
              <circle cx="300" cy="262" r="2" fill="#1A3A6B" fillOpacity="0.12" />
              <circle cx="330" cy="386" r="1.6" fill="#1A3A6B" fillOpacity="0.10" />
              <circle cx="210" cy="412" r="1.6" fill="#1A3A6B" fillOpacity="0.10" />
            </svg>
          </div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.09em] uppercase text-[#1A3A6B] mb-5">
              <Waves className="w-3.5 h-3.5" />
              <span>Monsoon Resilience Framework</span>
            </div>

            <h2 className="font-heading text-[30px] sm:text-[34px] font-semibold tracking-[-0.03em] text-[#14151A] leading-[1.14]">
              Calm under pressure.
              <br />
              Clarity in chaos.
            </h2>

            <p className="mt-4 text-[14px] text-[#5A5C66] leading-relaxed max-w-sm">
              NEXORA brings district authorities, hydrologic intelligence, NDRF response columns and 2G citizen
              networks into one operational picture — across every flood-prone river basin.
            </p>
          </div>

          {/* Key figures — hairline-ruled, no floating cards */}
          <dl className="relative z-10 grid grid-cols-3 gap-3 sm:gap-4 mt-8 pt-6 border-t border-[#DCDCD8]">
            {STATS.map(({ icon: Icon, label, value, note }) => (
              <div key={label}>
                <dt className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.07em] uppercase text-[#6B6D77]">
                  <Icon className="w-3 h-3 text-[#1A3A6B]" />
                  {label}
                </dt>
                <dd className="font-data text-[19px] font-semibold text-[#14151A] mt-1.5 tracking-[-0.02em]">{value}</dd>
                <dd className="text-[11px] text-[#6B6D77] mt-0.5 leading-snug">{note}</dd>
              </div>
            ))}
          </dl>

          <div className="relative z-10 flex items-center justify-between text-[11px] text-[#6B6D77] mt-8 pt-5 border-t border-[#DCDCD8]">
            <span>State Emergency Operations Centre (SEOC)</span>
            <span className="font-data">v2.4.8</span>
          </div>
        </aside>

      </div>
    </div>
  );
};
