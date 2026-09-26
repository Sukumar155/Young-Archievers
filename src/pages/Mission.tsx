import React from 'react';
import { TopBar } from '../components/dashboard/TopBar';
import { FieldResponderApp } from '../components/responder/FieldResponderApp';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { useNexoraStore } from '../store/useNexoraStore';
import { getTranslation } from '../i18n/translations';

export const MissionPage: React.FC = () => {
  const { setCurrentView, currentLanguage } = useNexoraStore();
  const t = (k: string, f?: string) => getTranslation(currentLanguage, k, f);

  return (
    <div data-testid="mission-page" className="min-h-screen text-[#14151A] dark:text-[#F1F1EF] flex flex-col font-body">
      <TopBar />

      <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-4 flex items-center justify-between">
        <button
          onClick={() => setCurrentView('COMMAND_DASHBOARD')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-[#17181C] hover:bg-[#EEF2F8] dark:hover:bg-[#1C1D22] text-[#6B6D77] dark:text-[#A1A3AC] hover:text-[#1A3A6B] dark:hover:text-[#F1F1EF] border border-[#DEDEDA] dark:border-[#2E3038] text-xs font-semibold transition-all cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('nav_dashboard', 'Dashboard')}</span>
        </button>

        <div className="flex items-center gap-2 text-xs font-semibold text-[#6B6D77] dark:text-[#A1A3AC]">
          <Smartphone className="w-4 h-4 text-[#1A3A6B] dark:text-[#9DB8DC]" />
          <span>{t('role_responder_metric', 'Field Mobile Mode')}</span>
        </div>
      </div>

      <div className="flex-1 py-4 px-4 flex items-center justify-center">
        <FieldResponderApp />
      </div>
    </div>
  );
};
