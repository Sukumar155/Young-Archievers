import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Bot, Mic, MicOff, Volume2, VolumeX, Square, MapPin, Navigation, RotateCcw, AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { useNexoraStore } from '../../store/useNexoraStore';
import { getTranslation, SupportedLanguage, LANGUAGE_CONFIG } from '../../i18n/translations';
import { voiceRecognitionService, VoiceState, VoiceErrorDetails, SPEECH_LOCALES } from '../../services/voiceRecognitionService';
import { textToSpeechService } from '../../services/textToSpeechService';
import { streamChatCompletion, isAiOnline, warmUpProvider, getLastAiError } from '../../services/llmService';
import { buildLiveSnapshot, buildSystemPrompt, extractLocationBlock, type LocationAction } from '../../services/chatEngine';

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  timestamp: string;
  locationAction?: LocationAction;
}

interface BotResponseResult {
  text: string;
  locationAction?: LocationAction;
}

export type VoiceAssistantState = VoiceState;

interface VoiceNoticeState {
  message: string;
  canRetryVoices?: boolean;
}

export const NexoraChatbot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceAssistantState>('IDLE');
  const [isMicSupported, setIsMicSupported] = useState(voiceRecognitionService.isSupported());
  const [voiceNotice, setVoiceNotice] = useState<VoiceNoticeState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Mini-ChatGPT state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const genIdRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  // AI connectivity: drives the launcher dot + header chip + fallback notice
  const [aiStatus, setAiStatus] = useState<'checking' | 'online' | 'offline'>(
    isAiOnline() === false ? 'offline' : 'checking'
  );
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const {
    currentLanguage,
    isOffline,
    mapDataStatus,
    overallRiskLevel,
    riverLevelMeters,
    dangerMarkMeters,
    rainfallMmPerHour,
    windSpeedKmh,
    sosReports,
    shelters,
    blockedRoads,
    district,
    hospitals,
    evacuationRoutes,
    setCurrentView,
    setActiveEvacuationRoute,
    setFocusedMapLocation,
  } = useNexoraStore();

  const t = (k: string, f?: string) => getTranslation(currentLanguage, k, f);

  // The Online/Offline switch in the top bar is the master network switch for
  // the whole app. While it reads OFFLINE the assistant must not touch the
  // network at all and answers from the on-device (pretrained) engine only.
  // Mirrors the exact condition TopBar uses to paint the button, so the
  // chatbot can never disagree with what the operator sees.
  const isForcedOffline = isOffline || mapDataStatus === 'OFFLINE';



  // Dynamic greeting matching active language (short & warm, like a real AI chat)
  const getGreeting = useCallback((lang: SupportedLanguage): string => {
    switch (lang) {
      case 'ta':
        return 'வணக்கம்! 👋 நான் NEXORA AI — வெள்ள நிலவரம், பாதுகாப்பான முகாம்கள், வெளியேற்றப் பாதைகள் பற்றி எதுவும் கேளுங்கள்… அல்லது சாதாரணமாகப் பேசலாம்.';
      case 'hi':
        return 'नमस्ते! 👋 मैं NEXORA AI हूं — बाढ़ की स्थिति, सुरक्षित शिविर, निकासी मार्गों के बारे में कुछ भी पूछें… या बस चैट करें।';
      case 'te':
        return 'నమస్కారం! 👋 నేను NEXORA AI — వరద పరిస్థితి, సురక్షిత ఆశ్రయాలు, తరలింపు మార్గాల గురించి ఏదైనా అడగండి… లేదా సరదాగా మాట్లాడవచ్చు.';
      case 'ml':
        return 'നമസ്കാരം! 👋 ഞാൻ NEXORA AI — വെള്ളപ്പൊക്ക സ്ഥിതി, സുരക്ഷിത കേന്ദ്രങ്ങൾ, ഒഴിപ്പിക്കൽ വഴികൾ എന്നിവയെക്കുറിച്ച് എന്തും ചോദിക്കൂ… അല്ലെങ്കിൽ വെറുതെ സംസാരിക്കാം.';
      case 'bn':
        return 'নমস্কার! 👋 আমি NEXORA AI — বন্যা পরিস্থিতি, নিরাপদ আশ্রয়, সরিয়ে নেওয়ার রুট সম্পর্কে কিছু জিজ্ঞাসা করুন… অথবা শুধু কথা বলুন।';
      case 'en':
      default:
        return 'Hey there! 👋 I\'m NEXORA AI — ask me anything about the flood situation, safe shelters, evacuation routes… or just chat.';
    }
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-init',
      sender: 'bot',
      text: getGreeting(currentLanguage),
      timestamp: 'Just now'
    }
  ]);

  // Keep a live copy of messages for building LLM history without stale closures
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Warm up the AI model at startup so the first reply is fast, and keep the
  // chatbot in lockstep with the app-wide Online/Offline switch.
  // -> OFFLINE: drop any in-flight reply, pin status to offline, local engine only.
  // -> back ONLINE: clear the notice and re-check the live AI.
  // Both branches live in one effect so a single warm-up request is made.
  useEffect(() => {
    if (isForcedOffline) {
      genIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setStreamingText('');
      setAiStatus('offline');
      setAiNotice(
        t('chat_offline_mode', 'Offline mode is on — answering from the built-in on-device knowledge base. Switch the network back to Online for full live AI.')
      );
      return;
    }

    setAiNotice(null);
    setAiStatus('checking');
    warmUpProvider().then(ok => {
      setAiStatus(ok ? 'online' : 'offline');
    });
    // Intentionally keyed on the switch alone: depending on `t`/`aiStatus`
    // would re-fire the AI warm-up request on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isForcedOffline]);

  // Update initial message when language changes
  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 1 && prev[0].id === 'm-init') {
        return [{
          id: 'm-init',
          sender: 'bot',
          text: getGreeting(currentLanguage),
          timestamp: 'Just now'
        }];
      }
      return prev;
    });
  }, [currentLanguage, getGreeting]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, streamingText, isStreaming]);

  // Stop any active speech and recognition on unmount
  useEffect(() => {
    return () => {
      voiceRecognitionService.abort();
      textToSpeechService.stop();
    };
  }, []);

  // Text-to-Speech (TTS) synthesizer in the current language
  const speakText = (text: string) => {
    const res = textToSpeechService.speak(text, currentLanguage, {
      onStart: () => setVoiceState('SPEAKING'),
      onEnd: () => setVoiceState('IDLE'),
      onError: () => setVoiceState('IDLE')
    });

    if (!res.success) {
      if (res.reason === 'NO_NATIVE_VOICE') {
        setVoiceNotice({
          message: t('voice_no_native_tts', res.message || 'Native voice engine for this language is not installed on this device. Displaying text response below.'),
          canRetryVoices: false
        });
      } else if (res.reason === 'UNSUPPORTED') {
        setVoiceNotice({
          message: t('voice_status_unsupported', 'Voice output is not supported in this browser. Please view text response.'),
          canRetryVoices: false
        });
      }
      setVoiceState('IDLE');
    } else {
      setVoiceNotice(null);
    }
  };

  const stopSpeaking = () => {
    textToSpeechService.stop();
    setVoiceState(prev => (prev === 'SPEAKING' ? 'IDLE' : prev));
  };

  const handleRetryVoices = () => {
    if (textToSpeechService.hasNativeVoiceFor(currentLanguage)) {
      setVoiceNotice(null);
    }
  };

  // Map and Direction Action Handlers with exact coordinates centering
  const handleOpenInMap = (action?: LocationAction) => {
    if (action?.lat && action?.lng) {
      setFocusedMapLocation({
        lat: action.lat,
        lng: action.lng,
        title: action.title,
        address: action.address,
        zoom: 15
      });
    }
    setCurrentView('DISASTER_MAP');
  };

  const handleGetDirections = (action?: LocationAction) => {
    if (action?.routeId) {
      const foundRoute = evacuationRoutes.find(r => r.id === action.routeId);
      if (foundRoute) {
        setActiveEvacuationRoute(foundRoute);
      }
    } else if (action?.lat && action?.lng) {
      if (evacuationRoutes.length > 0) {
        setActiveEvacuationRoute(evacuationRoutes[0]);
      }
    }
    setCurrentView('SHELTER_EVACUATION');
  };

  const handleClearChat = () => {
    stopSpeaking();
    // Abort any in-flight AI generation and reset streaming UI
    genIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStreamingText('');
    setVoiceState('IDLE');
    setMessages([
      {
        id: `m-${Date.now()}`,
        sender: 'bot',
        text: getGreeting(currentLanguage),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

  // Open the chat and make sure the AI model is warm for an instant first reply
  const openChat = () => {
    setIsOpen(true);
    if (isForcedOffline) return; // no network calls while offline
    if (isAiOnline() !== true) {
      warmUpProvider().then(ok => {
        setAiStatus(ok ? 'online' : 'offline');
      });
    }
  };

  // Re-check the AI connection from the offline notice banner
  const retryAi = () => {
    if (isForcedOffline) return; // the network switch is off — nothing to retry
    setAiNotice(null);
    setAiStatus('checking');
    warmUpProvider().then(ok => {
      setAiStatus(ok ? 'online' : 'offline');
    });
  };

  // Dynamic multilingual response generator
  const generateBotResponse = (query: string, lang: SupportedLanguage): BotResponseResult => {
    const q = query.toLowerCase();
    const activeSOS = sosReports.filter(r => r.status === 'PENDING' || r.status === 'TRIAGED');
    const criticalSOS = activeSOS.filter(r => r.priorityLevel === 'CRITICAL');
    const totalFreeBeds = shelters.reduce((acc, s) => acc + (s.totalCapacity - s.currentOccupancy), 0);
    const topShelter = shelters[0];

    // 0. QUICK CHIP DIRECT MATCHING (All 6 Languages)
    const q1Matches = [
      'what is the current risk', 'தற்போதைய ஆபத்து நிலை என்ன', 'वर्तमान जोखिम स्तर क्या है',
      'ప్రస్తుత ప్రమాద స్థాయి ఏమిటి', 'നിലവിലെ അപകട സാധ്യത എത്രയാണ്', 'বর্তমান দুর্যোগের ঝুঁকি কেমন'
    ];
    const q2Matches = [
      'where is the nearest safe shelter', 'அருகிலுள்ள பாதுகாப்பான முகாம் எங்கே உள்ளது', 'निकटतम सुरक्षित आश्रय कहां है',
      'సమీపంలోని సురక్షిత ఆశ్రయం ఎక్కడ ఉంది', 'അടുത്തുള്ള സുരക്ഷിത ക്യാമ്പ് എവിടെയാണ്', 'নিকটবর্তী নিরাপদ আশ্রয়কেন্দ্র কোথায়'
    ];
    const q3Matches = [
      'how many active incidents are there', 'எத்தனை அவசரச் சம்பவங்கள் பதிவாகியுள்ளன', 'कितनी सक्रिय आपातकालीन घटनाएं हैं',
      'ఎన్ని క్రియాశీల అత్యవసర సంఘటనలు ఉన్నాయి', 'എത്ര അടിയന്തര സംഭവങ്ങൾ റിപ്പോർട്ട് ചെയ്തിട്ടുണ്ട്', 'কতগুলি সক্রিয় ঘটনা রয়েছে'
    ];
    const q4Matches = [
      'which shelters have available capacity', 'எந்த முகாம்களில் காலி படுக்கைகள் உள்ளன', 'किन शिविरों में बिस्तर उपलब्ध हैं',
      'ఏ ఆశ్రయాలలో బెడ్లు అందుబాటులో ఉన్నాయి', 'ഏതൊക്കെ ക്യാമ്പുകളിൽ സ്ഥലസൗകര്യമുണ്ട്', 'কোন আশ্রয়কেন্দ্রে খালি জায়গা আছে'
    ];
    const q5Matches = [
      'what is the river water level', 'ஆற்று நீர்மட்டம் எவ்வளவு', 'नदी का जलस्तर कितना है',
      'నది నీటి మట్టం ఎంత', 'നദിയിലെ ജലനിരപ്പ് എത്രയാണ്', 'নদীর পানির উচ্চতা কত'
    ];

    // 1. SPECIFIC QUERY: "Where is Pragati High School Relief Camp?"
    const isPragati = q.includes('pragati') || q.includes('பிரகதி') || q.includes('प्रगति') ||
                      q.includes('ప్రగతి') || q.includes('പ്രഗതി') || q.includes('প্রগতি');

    if (isPragati) {
      const locAction: LocationAction = {
        type: 'shelter',
        title: 'Pragati High School Relief Camp',
        lat: 26.158,
        lng: 91.698,
        address: 'Maligaon Gate No. 3, Guwahati',
        routeId: 'ROUTE-PANDU-01'
      };

      switch (lang) {
        case 'ta':
          return {
            text: `பிரகதி உயர்நிலைப் பள்ளி நிவாரண முகாம் குவஹாத்தி மாலிகாவ் கேட் எண் 3 இல் அமைந்துள்ளது. இதில் தற்போது 128 காலி படுக்கைகள் (இருப்பு: 322/450) உள்ளன. 24x7 அவசர மருத்துவக் கூடாரம், 1,420 உணவுப் பொட்டலங்கள் மற்றும் 3,400 லிட்டர் குடிநீர் தயார் நிலையில் உள்ளன. பாண்டு காட் பகுதியிலிருந்து 2.1 கி.மீ தொலைவில் பாதுகாப்பான மேட்டுப்பாதையில் செல்லலாம்.`,
            locationAction: locAction
          };
        case 'hi':
          return {
            text: `प्रगति हाई स्कूल राहत शिविर मालीगांव गेट नंबर 3, गुवाहाटी में स्थित है। वर्तमान में यहाँ 128 खाली बिस्तर (322/450 अधिभोग) उपलब्ध हैं। यहाँ 24x7 आपातकालीन मेडिकल टेंट, 1,420 भोजन पैकेट और 3,400 लीटर पेयजल की सुविधा है। पांडु घाट से सुरक्षित ऊंचे मार्ग से दूरी 2.1 किमी है।`,
            locationAction: locAction
          };
        case 'te':
          return {
            text: `ప్రగతి హైస్కూల్ రిలీఫ్ క్యాంప్ మాలిగావ్ గేట్ నం. 3, గౌహతి వద్ద ఉంది. ఇక్కడ ప్రస్తుతం 128 ఖాళీ బెడ్లు (322/450 నిండినవి) అందుబాటులో ఉన్నాయి. 24x7 అత్యవసర వైద్య శిబిరం, 1,420 ఆహార ప్యాకెట్లు మరియు 3,400 లీటర్ల తాగునీరు సిద్ధంగా ఉన్నాయి. పాండు ఘాట్ నుండి సురక్షిత ఎత్తైన మార్గంలో దూరం 2.1 కి.మీ.`,
            locationAction: locAction
          };
        case 'ml':
          return {
            text: `പ്രഗതി ഹൈസ്കൂൾ ദുരിതാശ്വാസ ക്യാമ്പ് ഗുവാഹത്തി മാലിഗാവ് ഗേറ്റ് നമ്പർ 3-ൽ സ്ഥിതി ചെയ്യുന്നു. നിലവിൽ ഇവിടെ 128 ഒഴിവുള്ള ബെഡുകളുണ്ട് (322/450 ആൾക്കാർ). 24x7 മെഡിക്കൽ ടെന്റ്, 1,420 ഭക്ഷണ പാക്കറ്റുകൾ, 3,400 ലിറ്റർ കുടിവെള്ളം എന്നിവ സജ്ജീകരിച്ചിരിക്കുന്നു. പാണ്ഡു ഘാട്ടിൽ നിന്ന് സുരക്ഷിത പാത വഴി 2.1 കി.മീ ദൂരമുണ്ട്.`,
            locationAction: locAction
          };
        case 'bn':
          return {
            text: `প্রগতি হাই স্কুল ত্রাণ শিবিরটি গুয়াহাটির মালিগাঁও গেট নম্বর ৩ এ অবস্থিত। বর্তমানে এখানে ১২৮টি খালি বিছানা রয়েছে (৩২২/৪৫০ অধিকৃত)। এখানে ২৪x৭ জরুরি মেডিকেল তাঁবু, ১,৪২০টি খাবার প্যাকেট এবং ৩,৪০০ লিটার পানীয় জল উপলব্ধ। পান্ডু ঘাট থেকে নিরাপদ উঁচু সড়ক দিয়ে দূরত্ব ২.১ কিমি।`,
            locationAction: locAction
          };
        case 'en':
        default:
          return {
            text: `Pragati High School Relief Camp is located at Maligaon Gate No. 3, Guwahati. It currently has 128 free beds (322/450 occupied, 36 reserved). Facilities include an active 24x7 medical triaging tent, 1,420 food packets, and 3,400L potable water. Walking distance is 2.1 km (12 mins) from Pandu Ghat via elevated ridge route.`,
            locationAction: locAction
          };
      }
    }

    // 1b. SPECIFIC QUERY: "Where is Cotton Collegiate Relief Centre?"
    const isCotton = q.includes('cotton') || q.includes('collegiate') || q.includes('காட்டன்') ||
                     q.includes('कॉटन') || q.includes('కాటన్') || q.includes('കോട്ടൺ') || q.includes('কটন');

    if (isCotton) {
      const locAction: LocationAction = {
        type: 'shelter',
        title: 'Cotton Collegiate Relief Centre',
        lat: 26.186,
        lng: 91.748,
        address: 'Panbazar High Ground, Guwahati',
        routeId: 'ROUTE-FANCY-02'
      };

      switch (lang) {
        case 'ta':
          return {
            text: `காட்டன் காலேஜியேட் நிவாரண மையம் பான்பஜார் மேட்டு நிலப்பரப்பில் அமைந்துள்ளது (முகவரி: Panbazar High Ground, Guwahati). இதில் தற்போது 90 காலி படுக்கைகள் (இருப்பு: 510/600) உள்ளன. அவசர மருத்துவ மையம், 280 உணவுப் பொட்டலங்கள் மற்றும் 750 லிட்டர் சுத்திகரிக்கப்பட்ட குடிநீர் தயார் நிலையில் உள்ளன.`,
            locationAction: locAction
          };
        case 'hi':
          return {
            text: `कॉटन कॉलेजिएट राहत केंद्र पानबाजार हाई ग्राउंड, गुवाहाटी में स्थित है। यहाँ 90 खाली बिस्तर (510/600 अधिभोग) उपलब्ध हैं। केंद्र में मेडिकल यूनिट, 280 भोजन पैकेट और 750 लीटर पेयजल की सुविधा है। फैंसी बाजार से सुरक्षित मार्ग उपलब्ध है।`,
            locationAction: locAction
          };
        case 'te':
          return {
            text: `కాటన్ కాలేజియేట్ రిలీఫ్ సెంటర్ పాన్‌బజార్ హై గ్రౌండ్, గౌహతి వద్ద ఉంది. ఇక్కడ 90 ఖాళీ బెడ్లు (510/600 నిండినవి) అందుబాటులో ఉన్నాయి. మెడికల్ సదుపాయం, 280 ఆహార ప్యాకెట్లు మరియు 750 లీటర్ల తాగునీరు సిద్ధంగా ఉన్నాయి.`,
            locationAction: locAction
          };
        case 'ml':
          return {
            text: `കോട്ടൺ കൊളീജിയറ്റ് ദുരിതാശ്വാസ കേന്ദ്രം പാൻബസാർ ഹൈ ഗ്രൗണ്ടിൽ സ്ഥിതി ചെയ്യുന്നു. നിലവിൽ 90 ഒഴിവുള്ള ബെഡുകളുണ്ട് (510/600 ആളുകൾ). മെഡിക്കൽ ടീമും 280 ഭക്ഷണ പാക്കറ്റുകളും 750 ലിറ്റർ കുടിവെള്ളവും ഇവിടെ ലഭ്യമാണ്.`,
            locationAction: locAction
          };
        case 'bn':
          return {
            text: `কটন কলেজিয়েট ত্রাণ কেন্দ্রটি পানবাজার হাই গ্রাউন্ড, গুয়াহাটিতে অবস্থিত। এখানে ৯০টি খালি বিছানা রয়েছে (৫১০/৬০০ অধিকৃত)। এতে জরুরি মেডিকেল ইউনিট, ২৮০টি খাবার প্যাকেট এবং ৭৫০ লিটার পানীয় জল মজুত রয়েছে।`,
            locationAction: locAction
          };
        case 'en':
        default:
          return {
            text: `Cotton Collegiate Relief Centre is situated at Panbazar High Ground, Guwahati. It has 90 free beds available (510/600 occupied, 45 reserved). Facilities include an on-site medical unit, 280 meal packets, and 750L of purified drinking water.`,
            locationAction: locAction
          };
      }
    }

    // 1c. SPECIFIC QUERY: "Where is the incident?" / "Show me the incident on the map"
    const isIncidentLocation = (q.includes('where') && (q.includes('incident') || q.includes('sos') || q.includes('trapped') || q.includes('rescue'))) ||
                               (q.includes('location') && (q.includes('incident') || q.includes('sos'))) ||
                               q.includes('சம்பவம் எங்கே') || q.includes('சம்பவத்தின் இருப்பிடம்') || q.includes('மக்கள் எங்கே') ||
                               q.includes('घटना कहाँ') || q.includes('घटना कहां') || q.includes('लोग कहां') ||
                               q.includes('సంఘటన ఎక్కడ') || q.includes('ప్రజలు ఎక్కడ') ||
                               q.includes('സംഭവം എവിടെ') || q.includes('ആളുകൾ എവിടെ') ||
                               q.includes('ঘটনা কোথায়') || q.includes('কোথায় মানুষ');

    if (isIncidentLocation) {
      const topIncident = activeSOS[0] || sosReports[0];
      const locAction: LocationAction = {
        type: 'map',
        title: `${topIncident.id}: ${topIncident.locationName}`,
        lat: topIncident.lat,
        lng: topIncident.lng,
        address: topIncident.locationName,
        routeId: 'ROUTE-PANDU-01'
      };

      switch (lang) {
        case 'ta':
          return {
            text: `முக்கிய அவசர சம்பவம்: ${topIncident.id} — ${topIncident.locationName}. தற்போதைய நீர்மட்டம் ${topIncident.waterLevelMeters} மீ. இதில் ${topIncident.peopleCount} நபர்கள் (முதியவர் உட்பட) சிக்கியுள்ளனர். அவசர முன்னுரிமை மதிப்பெண்: ${topIncident.priorityScore}/100. NDRF மீட்புப் படகு அனுப்பப்பட்டுள்ளது.`,
            locationAction: locAction
          };
        case 'hi':
          return {
            text: `प्रमुख आपातकालीन घटना: ${topIncident.id} — ${topIncident.locationName} पर स्थित है। यहाँ बाढ़ का जलस्तर ${topIncident.waterLevelMeters} मीटर है और ${topIncident.peopleCount} नागरिक फंसे हैं। प्राथमिकता स्कोर: ${topIncident.priorityScore}/100। एनडीआरएफ मोटरबोट भेजी जा चुकी है।`,
            locationAction: locAction
          };
        case 'te':
          return {
            text: `ముఖ్య అత్యవసర సంఘటన: ${topIncident.id} — ${topIncident.locationName} వద్ద ఉంది. వరద నీటి మట్టం ${topIncident.waterLevelMeters} మీటర్లు మరియు ${topIncident.peopleCount} మంది చిక్కుకున్నారు. ప్రాధాన్యత స్కోరు: ${topIncident.priorityScore}/100. ఎన్డీఆర్ఎఫ్ బృందం పంపబడింది.`,
            locationAction: locAction
          };
        case 'ml':
          return {
            text: `പ്രധാന അടിയന്തര സംഭവം: ${topIncident.id} — ${topIncident.locationName}-ൽ സ്ഥിതി ചെയ്യുന്നു. ജലനിരപ്പ് ${topIncident.waterLevelMeters} മീറ്ററാണ്, ${topIncident.peopleCount} പേർ കുടുങ്ങിക്കിടക്കുന്നു. മുൻഗണനാ സ്കോർ: ${topIncident.priorityScore}/100. NDRF ബോട്ട് അയച്ചിട്ടുണ്ട്.`,
            locationAction: locAction
          };
        case 'bn':
          return {
            text: `প্রধান জরুরি ঘটনা: ${topIncident.id} — ${topIncident.locationName} এ অবস্থিত। পানির উচ্চতা ${topIncident.waterLevelMeters} মিটার এবং ${topIncident.peopleCount} জন আটকা পড়েছেন। জরুরি অগ্রাধিকার স্কোর: ${topIncident.priorityScore}/১০০। এনডিআরএফ উদ্ধারকারী বোট পাঠানো হয়েছে।`,
            locationAction: locAction
          };
        case 'en':
        default:
          return {
            text: `Critical incident ${topIncident.id} is located at ${topIncident.locationName} (Coordinates: ${topIncident.lat}° N, ${topIncident.lng}° E). Floodwater depth is ${topIncident.waterLevelMeters}m with ${topIncident.peopleCount} trapped citizens. Priority score is ${topIncident.priorityScore}/100 (CRITICAL). NDRF Column Alpha has been dispatched.`,
            locationAction: locAction
          };
      }
    }

    // 2. SPECIFIC QUERY: "Where is the nearest hospital?"
    const isHospital = q.includes('hospital') || q.includes('clinic') || q.includes('doctor') || q.includes('gmch') ||
                       q.includes('மருத்துவமனை') || q.includes('அஸ்பத்திரி') ||
                       q.includes('अस्पताल') || q.includes('चिकित्सालय') ||
                       q.includes('ఆసుపత్రి') || q.includes('ఆస్పత్రి') ||
                       q.includes('ആശുപത്രി') ||
                       q.includes('হাসপাতাল') || q.includes('ডাক্তারখানা');

    if (isHospital) {
      const locAction: LocationAction = {
        type: 'hospital',
        title: 'Gauhati Medical College & Hospital (GMCH)',
        lat: 26.155,
        lng: 91.770,
        address: 'Bhangagarh Emergency Complex, Guwahati'
      };

      switch (lang) {
        case 'ta':
          return {
            text: `அருகிலுள்ள முக்கிய மருத்துவமனை கவுகாத்தி மருத்துவக் கல்லூரி & மருத்துவமனை (GMCH), பாங்காகர் அவசர வளாகத்தில் உள்ளது. இதில் 142 படுக்கைகள் (18 தீவிர சிகிச்சைப் படுக்கைகள் உட்பட), அவசர ஹெலிபேட் மற்றும் 14 வெள்ள ஆம்புலன்ஸ்கள் தயார் நிலையில் உள்ளன. அவசர அழைப்பு: 108 / +91 361 2529457.`,
            locationAction: locAction
          };
        case 'hi':
          return {
            text: `निकटतम आपातकालीन अस्पताल गौहाटी मेडिकल कॉलेज और अस्पताल (GMCH) है, जो भंगागढ़ आपातकालीन परिसर में स्थित है। इसमें 142 उपलब्ध बिस्तर (18 आईसीयू बेड सहित), आपातकालीन हेलीपैड और 14 स्टैंडबाय एम्बुलेंस हैं। आपातकालीन संपर्क: 108 / +91 361 2529457.`,
            locationAction: locAction
          };
        case 'te':
          return {
            text: `సమీప అత్యవసర ఆసుపత్రి గౌహతి మెడికల్ కాలేజ్ & హాస్పిటల్ (GMCH), భంగగఢ్ ఎమర్జెన్సీ కాంప్లెక్స్ వద్ద ఉంది. ఇక్కడ 142 అందుబాటు బెడ్లు (18 ఐసీయూ బెడ్లు సహా), ఎమర్జెన్సీ హెలిప్యాడ్ మరియు 14 అంబులెన్సులు సిద్ధంగా ఉన్నాయి. అత్యవసర ఫోన్: 108 / +91 361 2529457.`,
            locationAction: locAction
          };
        case 'ml':
          return {
            text: `ഏറ്റവും അടുത്തുള്ള എമർജൻസി ആശുപത്രി ഭംഗാഗഡ് കോംപ്ലക്സിലുള്ള ഗുവാഹത്തി മെഡിക്കൽ കോളേജ് & ഹോസ്പിറ്റൽ (GMCH) ആണ്. ഇവിടെ 142 ബെഡുകളും (18 ഐസിയു ബെഡുകൾ ഉൾപ്പെടെ), ഹെലിപാഡും 14 ആംബുലൻസുകളും ലഭ്യമാണ്. അടിയന്തര നമ്പർ: 108 / +91 361 2529457.`,
            locationAction: locAction
          };
        case 'bn':
          return {
            text: `নিকটতম জরুরি হাসপাতালটি হলো ভানগাগড় ইমার্জেন্সি কমপ্লেক্সে অবস্থিত গৌহাটি মেডিকেল কলেজ ও হাসপাতাল (GMCH)। এতে ১৪২টি শয্যা (১৮টি আইসিইউ বেড সহ), জরুরি হেলিপ্যাড এবং ১৪টি স্ট্যান্ডবাই অ্যাম্বুলেন্স প্রস্তুত রয়েছে। জরুরি হেল্পলাইন: ১০৮ / +৯১ ৩৬১ ২৫২৯৪৫৭।`,
            locationAction: locAction
          };
        case 'en':
        default:
          return {
            text: `The nearest tertiary care hospital is Gauhati Medical College & Hospital (GMCH) located at Bhangagarh Emergency Complex. It has 142 available beds (including 18 ICU trauma beds), an active Emergency Helipad, and 14 standby flood rescue ambulances. Emergency Helpline: 108 / +91 361 2529457.`,
            locationAction: locAction
          };
      }
    }

    // 3. SPECIFIC QUERY: "Show me the evacuation route" / "safe route" / "corridor"
    const isRoute = (q.includes('evacuat') || q.includes('route') || q.includes('direction') || q.includes('corridor') || q.includes('path') ||
                     q.includes('பாதை') || q.includes('வழி') || q.includes('வழிகாட்டல்') ||
                     q.includes('मार्ग') || q.includes('रास्ता') || q.includes('दिशा') ||
                     q.includes('దారి') || q.includes('మార్గం') ||
                     q.includes('മാർഗ്ഗം') ||
                     q.includes('পথ') || q.includes('দিকনির্দেশ')) &&
                    !q.includes('capacity') && !q.includes('bed') && !q.includes('படுக்கை') && !q.includes('बिस्तर') && !q.includes('బెడ్');

    if (isRoute) {
      const locAction: LocationAction = {
        type: 'route',
        title: 'Safe Route: Pandu Ghat to Pragati High School',
        lat: 26.178,
        lng: 91.702,
        routeId: 'ROUTE-PANDU-01'
      };

      switch (lang) {
        case 'ta':
          return {
            text: `சரிபார்க்கப்பட்ட பாதுகாப்பான வெளியேற்றப் பாதை: மண்டலம் A (பாண்டு காட்) முதல் பிரகதி பள்ளி முகாம் வரை (பாதை எண்: ROUTE-PANDU-01). தூரம்: 2.1 கி.மீ (நடக்கும் நேரம்: 12 நிமிடங்கள்). நிலை: வறண்ட பாதுகாப்பான பாதை (+18 மீ மேட்டு நிலப்பரப்பு). வழிகாட்டல்: ஆற்று கரையை விட்டு தெற்கே சென்று மாலிகாவ் மேல் முகட்டைப் பயன்படுத்தவும்; மாலிகாவ் கேட் 3 இல் கிழக்கே திரும்பவும். வெள்ளம் சூழ்ந்த பாண்டு வயடக்டைத் தவிர்க்கவும்.`,
            locationAction: locAction
          };
        case 'hi':
          return {
            text: `सत्यापित सुरक्षित निकासी गलियारा: ज़ोन A (पांडु घाट) से प्रगति हाई स्कूल राहत शिविर तक (मार्ग: ROUTE-PANDU-01)। दूरी: 2.1 किमी (अनुमानित समय: 12 मिनट)। स्थिति: सूखा व सुरक्षित गलियारा (+18 मीटर ऊंचाई)। निर्देश: नदी तटबंध से दूर दक्षिण की ओर चलें, मालीगांव ऊपरी रिज मार्ग लें और गेट नंबर 3 पर पूर्व की ओर मुड़ें। जलभराव वाले वियाडक्ट से बचें।`,
            locationAction: locAction
          };
        case 'te':
          return {
            text: `ధృవీకరించబడిన సురక్షిత తరలింపు మార్గం: జోన్ A (పాండు ఘాట్) నుండి ప్రగతి హైస్కూల్ క్యాంప్ వరకు (రూట్: ROUTE-PANDU-01). దూరం: 2.1 కి.మీ (సుమారు 12 నిమిషాలు). స్థితి: సురక్షిత ఎత్తైన కారిడార్ (+18 మీటర్ల ఎత్తు). సూచనలు: నది కట్ట నుండి దక్షిణ దిశగా వెళ్లి, మాలిగావ్ ఎత్తైన రోడ్డు గుండా గేట్ నం. 3 వద్ద తూర్పుకు తిరగండి.`,
            locationAction: locAction
          };
        case 'ml':
          return {
            text: `സുരക്ഷിത ഒഴിപ്പിക്കൽ പാത: സോൺ A (പാണ്ഡു ഘാട്ട്) മുതൽ പ്രഗതി ഹൈസ്കൂൾ ക്യാമ്പ് വരെ (റൂട്ട്: ROUTE-PANDU-01). ദൂരം: 2.1 കി.മീ (ഏകദേശം 12 മിനിറ്റ്). നില: വെള്ളപ്പൊക്കമില്ലാത്ത സുരക്ഷിത പാത (+18 മീറ്റർ ഉയരം). നിർദ്ദേശം: നദീതീരത്ത് നിന്ന് തെക്കോട്ട് മാറി മാലിഗാവ് അപ്പർ റിഡ്ജ് വഴി സഞ്ചരിച്ച് ഗേറ്റ് 3-ൽ കിഴക്കോട്ട് തിരിയുക.`,
            locationAction: locAction
          };
        case 'bn':
          return {
            text: `যাচাইকৃত নিরাপদ স্থানান্তর করিডোর: জোন A (পান্ডু ঘাট) থেকে প্রগতি হাই স্কুল ত্রাণ শিবির পর্যন্ত (রুট: ROUTE-PANDU-01)। দূরত্ব: ২.১ কিমি (আনুমানিক সময়: ১২ মিনিট)। অবস্থা: শুষ্ক ও নিরাপদ উঁচু করিডোর (+১৮ মিটার উচ্চতা)। নির্দেশনা: নদী বাঁধ থেকে দক্ষিণে সরে মালিগাঁও আপার রিজ ধরে এগিয়ে গেট নং ৩ এ পূর্ব দিকে মোড় নিন।`,
            locationAction: locAction
          };
        case 'en':
        default:
          return {
            text: `Verified Safe Evacuation Corridor: Route ROUTE-PANDU-01 from Zone A (Pandu Ghat) to Pragati High School Relief Camp. Distance: 2.1 km (Estimated walking time: 12 minutes). Status: DRY CORRIDOR SAFE (+18m MSL high ridge). Instructions: Depart Pandu Temple Road South away from the river embankment, follow Maligaon Upper Ridge, and turn East at Gate 3. Avoid Pandu Link Viaduct.`,
            locationAction: locAction
          };
      }
    }

    // 4. NEAREST SHELTER / "Where is the nearest safe shelter?" / "What is the address of the relief camp?" / "Show the nearest safe shelter"
    const isNearest = q2Matches.some(m => q.includes(m.toLowerCase())) ||
                      q.includes('தங்குமிட') || q.includes('தங்குமிடம்') ||
                      ((q.includes('nearest') || q.includes('how far') || q.includes('where') || q.includes('show') || q.includes('give') || q.includes('direction') || q.includes('address') ||
                        q.includes('அருகில்') || q.includes('எங்கே') || q.includes('காட்டு') || q.includes('முகவரி') ||
                        q.includes('निकटतम') || q.includes('पास') || q.includes('कहाँ') || q.includes('कहा') || q.includes('दिखा') || q.includes('पता') ||
                        q.includes('సమీప') || q.includes('ఎక్కడ') || q.includes('చూప') || q.includes('చిరునామా') ||
                        q.includes('അടുത്തുള്ള') || q.includes('എവിടെ') || q.includes('കാണിക്കുക') || q.includes('വിലാസം') ||
                        q.includes('নিকটবর্তী') || q.includes('কোথায়') || q.includes('দেখান') || q.includes('ঠিকানা')) &&
                       (q.includes('shelter') || q.includes('camp') || q.includes('relief') || q.includes('safe') ||
                        q.includes('முகாம்') || q.includes('ஆசிரமம்') || q.includes('தங்குமிடம்') ||
                        q.includes('आश्रय') || q.includes('शिविर') || q.includes('राहत') ||
                        q.includes('ఆశ్రయం') || q.includes('పునరావాస') ||
                        q.includes('ക്യാമ്പ്') || q.includes('ദുരിതാശ്വാസ') ||
                        q.includes('আশ্রয়কেন্দ্র') || q.includes('ত্রাণ')));

    if (isNearest) {
      const locAction: LocationAction = {
        type: 'shelter',
        title: topShelter.name,
        lat: topShelter.lat,
        lng: topShelter.lng,
        address: topShelter.address,
        routeId: 'ROUTE-PANDU-01'
      };

      switch (lang) {
        case 'ta':
          return {
            text: `அருகிலுள்ள சரிபார்க்கப்பட்ட நிவாரண முகாம்: ${topShelter.name}.\nமுகவரி: ${topShelter.address} (அச்சுரேகை: ${topShelter.lat}° N, ${topShelter.lng}° E).\nதூரம்: பாண்டு பகுதியிலிருந்து 2.1 கி.மீ (வறண்ட பாதை வழியாக 12 நிமிடங்கள் நடைப்பயணம்).\nகொள்ளளவு: ${topShelter.totalCapacity - topShelter.currentOccupancy} காலி படுக்கைகள் (இருப்பு: ${topShelter.currentOccupancy}/${topShelter.totalCapacity}, ஒதுக்கீடு: ${topShelter.reservedSpaces}).\nவசதிகள்: 24x7 மருத்துவக் கூடாரம், ${topShelter.resources.foodPackets} உணவுப் பொட்டலங்கள், ${topShelter.resources.waterLiters}L குடிநீர் தயார்.`,
            locationAction: locAction
          };
        case 'hi':
          return {
            text: `निकटतम सत्यापित सुरक्षित राहत शिविर: ${topShelter.name}.\nपता: ${topShelter.address} (निर्देशांक: ${topShelter.lat}° N, ${topShelter.lng}° E).\nदूरी: पांडु घाट से 2.1 किमी (सुरक्षित ऊंचे मार्ग से 12 मिनट पैदल).\nक्षमता: ${topShelter.totalCapacity - topShelter.currentOccupancy} खाली बिस्तर (अधिभोग: ${topShelter.currentOccupancy}/${topShelter.totalCapacity}, आरक्षित: ${topShelter.reservedSpaces}).\nसुविधाएं: 24x7 आपातकालीन मेडिकल टेंट, ${topShelter.resources.foodPackets} भोजन पैकेट और ${topShelter.resources.waterLiters} लीटर पेयजल उपलब्ध।`,
            locationAction: locAction
          };
        case 'te':
          return {
            text: `సమీపంలోని ధృవీకరించబడిన సురక్షిత ఆశ్రయం: ${topShelter.name}.\nచిరునామా: ${topShelter.address} (కోఆర్డినేట్లు: ${topShelter.lat}° N, ${topShelter.lng}° E).\nదూరం: పాండు ఘాట్ నుండి 2.1 కి.మీ (ఎత్తైన మార్గంలో 12 నిమిషాలు).\nసామర్థ్యం: ${topShelter.totalCapacity - topShelter.currentOccupancy} ఖాళీ బెడ్లు (నిండినవి: ${topShelter.currentOccupancy}/${topShelter.totalCapacity}, రిజర్వ్: ${topShelter.reservedSpaces}).\nసదుపాయాలు: 24x7 అత్యవసర వైద్య శిబిరం, ${topShelter.resources.foodPackets} ఆహార ప్యాకెట్లు, ${topShelter.resources.waterLiters}L తాగునీరు.`,
            locationAction: locAction
          };
        case 'ml':
          return {
            text: `ഏറ്റവും അടുത്തുള്ള സുരക്ഷിത ദുരിതാശ്വാസ ക്യാമ്പ്: ${topShelter.name}.\nവിലാസം: ${topShelter.address} (കോർഡിനേറ്റുകൾ: ${topShelter.lat}° N, ${topShelter.lng}° E).\nദൂരം: പാണ്ഡുവിൽ നിന്ന് 2.1 കി.മീ (സുരക്ഷിത പാത വഴി 12 മിനിറ്റ് കാൽനട യാത്ര).\nസൗകര്യം: ${topShelter.totalCapacity - topShelter.currentOccupancy} ഒഴിവുള്ള ബെഡുകൾ (ആകെ: ${topShelter.currentOccupancy}/${topShelter.totalCapacity}, മാറ്റിവെച്ചത്: ${topShelter.reservedSpaces}).\nസജ്ജീകരണങ്ങൾ: 24x7 മെഡിക്കൽ ടെന്റ്, ${topShelter.resources.foodPackets} ഭക്ഷണ പാക്കറ്റുകൾ, ${topShelter.resources.waterLiters}L കുടിവെള്ളം.`,
            locationAction: locAction
          };
        case 'bn':
          return {
            text: `নিকটবর্তী যাচাইকৃত নিরাপদ ত্রাণ শিবির: ${topShelter.name}।\nঠিকানা: ${topShelter.address} (স্থানাঙ্ক: ${topShelter.lat}° N, ${topShelter.lng}° E)।\nদূরত্ব: পান্ডু ঘাট থেকে ২.১ কিমি (উঁচু করিডোর দিয়ে ১২ মিনিটের হাঁটা পথ)।\nধারণক্ষমতা: ${topShelter.totalCapacity - topShelter.currentOccupancy}টি খালি বিছানা (অধিকৃত: ${topShelter.currentOccupancy}/${topShelter.totalCapacity}, সংরক্ষিত: ${topShelter.reservedSpaces})।\nসুযোগ-সুবিধা: ২৪x৭ মেডিকেল তাঁবু, ${topShelter.resources.foodPackets}টি খাবার প্যাকেট ও ${topShelter.resources.waterLiters} লিটার পানীয় জল উপলব্ধ।`,
            locationAction: locAction
          };
        case 'en':
        default:
          return {
            text: `Nearest verified safe relief shelter: ${topShelter.name}.\nAddress: ${topShelter.address} (Coordinates: ${topShelter.lat}° N, ${topShelter.lng}° E).\nDistance: 2.1 km (12 mins walk via elevated dry corridor from Pandu Ghat).\nCapacity: ${topShelter.totalCapacity - topShelter.currentOccupancy} free beds (${topShelter.currentOccupancy}/${topShelter.totalCapacity} occupied, ${topShelter.reservedSpaces} reserved).\nFacilities: 24x7 active medical triaging tent, ${topShelter.resources.foodPackets} food packets, and ${topShelter.resources.waterLiters}L potable water.`,
            locationAction: locAction
          };
      }
    }

    // 5. GREETING / WELCOME / ASSIST
    const isGreeting = (/\b(hello|hi|hey|help)\b/i.test(q) || q.includes('who are you') ||
                       q.includes('வணக்கம்') || q.includes('ஹலோ') ||
                       q.includes('नमस्ते') || q.includes('नमस्कार') ||
                       q.includes('నమస్కారం') || q.includes('హలో') ||
                       q.includes('നമസ്കാരം') || q.includes('ഹലോ') ||
                       q.includes('নমস্কার') || q.includes('হ্যালো')) && q.length < 35;

    if (isGreeting && q.length < 25) {
      switch (lang) {
        case 'ta':
          return { text: `வணக்கம்! நான் NEXORA AI பேரிடர் மேலாண்மை வழிகாட்டி. நான் உங்களுக்கு தற்போதைய வெள்ள அபாய நிலை, அருகிலுள்ள நிவாரண முகாம்கள், ஆற்று நீர்மட்டம் மற்றும் அவசர உதவி எண்கள் குறித்த உடனடித் தகவல்களை வழங்க முடியும். உங்கள் கேள்வியைக் கேளுங்கள்.` };
        case 'hi':
          return { text: `नमस्ते! मैं NEXORA AI आपदा प्रतिक्रिया सहायक हूं। मैं आपको वास्तविक समय बाढ़ जोखिम, निकटतम सुरक्षित आश्रय, नदी जलस्तर और आपातकालीन हेल्पलाइन की सटीक जानकारी दे सकता हूं। आप क्या जानना चाहते हैं?` };
        case 'te':
          return { text: `నమస్కారం! నేను NEXORA AI విపత్తు సహాయక గైడ్. ప్రస్తుత వరద ముప్పు స్థాయి, సమీప పునరావాస కేంద్రాలు, నది నీటి మట్టం మరియు అత్యవసర హెల్ప్‌లైన్ సమాచారాన్ని మీకు అందించగలను. మీకు ఏ సహాయం కావాలి?` };
        case 'ml':
          return { text: `നമസ്കാരം! ഞാൻ NEXORA AI ദുരന്ത നിവാരണ സഹായി. തത്സമയ പ്രളയ സാധ്യത, അടുത്തുള്ള സുരക്ഷിത ക്യാമ്പുകൾ, ജലനിരപ്പ്, അടിയന്തര ഹെൽപ്പ്‌ലൈൻ വിവരങ്ങൾ എന്നിവ ഞാൻ ലഭ്യമാക്കാം. നിങ്ങൾക്കെന്താണ് അറിയേണ്ടത്?` };
        case 'bn':
          return { text: `নমস্কার! আমি NEXORA AI দুর্যোগ প্রতিক্রিয়া সহকারী। আমি আপনাকে রিয়েল-টাইম বন্যা ঝুঁকি, নিকটবর্তী আশ্রয়কেন্দ্র, নদীর পানির স্তর এবং জরুরি হেল্পলাইনের সঠিক তথ্য দিতে পারি। আপনার কী তথ্য প্রয়োজন?` };
        case 'en':
        default:
          return { text: `Hello! I am NEXORA AI, your emergency disaster response assistant. I can provide verified situational intelligence on flood risk levels, safe shelters, river hydrology, and active emergency operations. How may I help you?` };
      }
    }

    // 6. RISK / THREAT / DANGER
    const isRisk = q1Matches.some(m => q.includes(m.toLowerCase())) ||
                   q.includes('risk') || q.includes('threat') || q.includes('danger') || q.includes('severity') || q.includes('alert') ||
                   q.includes('ஆபத்து') || q.includes('நிலை') || q.includes('தீவிரம்') || q.includes('எச்சரிக்கை') ||
                   q.includes('जोखिम') || q.includes('खतरा') || q.includes('गंभीर') || q.includes('चेतावनी') ||
                   q.includes('ముప్పు') || q.includes('ప్రమాదం') || q.includes('తీవ్రత') || q.includes('హెచ్చరిక') ||
                   q.includes('അപകടം') || q.includes('സാധ്യത') || q.includes('തീവ്രത') || q.includes('മുന്നറിയിപ്പ്') ||
                   q.includes('ঝুঁকি') || q.includes('বিপদ') || q.includes('সতর্কবার্তা');

    if (isRisk) {
      switch (lang) {
        case 'ta':
          return { text: `தற்போதைய ஒட்டுமொத்த பேரிடர் ஆபத்து நிலை: ${overallRiskLevel} (மிகத் தீவிரம்). பிரம்மபுத்திரா நதி நீர்மட்டம் 82 செ.மீ (ஆபத்துக் குறியீடு: ${dangerMarkMeters} மீ). மழைப்பொழிவு ${rainfallMmPerHour} மி.மீ/மணி, காற்றின் வேகம் ${windSpeedKmh} கி.மீ/மணி. தாழ்வான மண்டலங்கள் உயர் எச்சரிக்கையில் வைக்கப்பட்டுள்ளன.` };
        case 'hi':
          return { text: `वर्तमान में समग्र बाढ़ जोखिम स्तर: ${overallRiskLevel} (गंभीर) है। ब्रह्मपुत्र नदी का जलस्तर 82 सेमी (खतरे का निशान: ${dangerMarkMeters} मीटर) पर है। वर्षा दर ${rainfallMmPerHour} मिमी/घंटा और हवा की गति ${windSpeedKmh} किमी/घंटा है। निचले क्षेत्रों के लिए चेतावनी जारी है।` };
        case 'te':
          return { text: `ప్రస్తుత వరద ముప్పు స్థాయి: ${overallRiskLevel} (తీవ్రమైనది). బ్రహ్మపుత్ర నది నీటి మట్టం 82 సెం.మీ (ప్రమాద స్థాయి: ${dangerMarkMeters} మీ). వర్షపాతం గంటకు ${rainfallMmPerHour} మి.మీ మరియు గాలి వేగం గంటకు ${windSpeedKmh} కి.మీ.` };
        case 'ml':
          return { text: `നിലവിലെ പ്രളയ സാധ്യത: ${overallRiskLevel} (അതിഗുരുതരം). ബ്രഹ്മപുത്ര നദിയിലെ ജലനിരപ്പ് 82 സെ.മീറ്ററിലാണ് (അപകട നില: ${dangerMarkMeters} മീറ്റർ). മഴയുടെ അളവ് മണിക്കൂറിൽ ${rainfallMmPerHour} മി.മീറ്ററും കാറ്റിന്റെ വേഗത മണിക്കൂറിൽ ${windSpeedKmh} കി.മീറ്ററുമാണ്.` };
        case 'bn':
          return { text: `বর্তমান সামগ্রিক বন্যা ঝুঁকির মাত্রা: ${overallRiskLevel} (চরম ঝুঁকিপূর্ণ)। ব্রহ্মপুত্র নদীর পানির উচ্চতা ৮২ সেমি (বিপজ্জনক স্তর: ${dangerMarkMeters} মিটার)। বৃষ্টিপাতের পরিমাণ ${rainfallMmPerHour} মিমি/ঘন্টা এবং বাতাসের গতিবেগ ${windSpeedKmh} কিমি/ঘন্টা।` };
        case 'en':
        default:
          return { text: `Current overall flood threat level is ${overallRiskLevel}. River stage is at 82 cm (critical crest mark: 95 cm, MSL: ${riverLevelMeters}m vs Danger Mark: ${dangerMarkMeters}m). Rainfall rate is ${rainfallMmPerHour} mm/h with wind velocity at ${windSpeedKmh} km/h.` };
      }
    }

    // 7. SHELTER CAPACITY & AVAILABLE BEDS
    const isCapacity = q4Matches.some(m => q.includes(m.toLowerCase())) ||
                       ((q.includes('shelter') || q.includes('camp')) && (q.includes('capacity') || q.includes('free') || q.includes('bed') || q.includes('available') || q.includes('occupan') || q.includes('space'))) ||
                       q.includes('படுக்கை') || q.includes('கொள்ளளவு') || q.includes('காலி') ||
                       q.includes('बिस्तर') || q.includes('क्षमता') || q.includes('खाली') ||
                       q.includes('బెడ్') || q.includes('సామర్థ్యం') || q.includes('ఖాళీ') ||
                       q.includes('സ്ഥലസൗകര്യം') || q.includes('ലഭ്യത') || q.includes('ഒഴിവുള്ള') ||
                       q.includes('বিছানা') || q.includes('ধারণক্ষমতা') || q.includes('খালি জায়গা') || q.includes('জায়গা');

    if (isCapacity) {
      switch (lang) {
        case 'ta':
          return { text: `நிவாரண முகாம்களின் கொள்ளளவு விவரம்:\n• ${shelters.map(s => `${s.name}: ${s.totalCapacity - s.currentOccupancy} காலி படுக்கைகள் (இருப்பு: ${s.currentOccupancy}/${s.totalCapacity})`).join('\n• ')}\nமொத்த காலி படுக்கைகள்: ${totalFreeBeds}. குடிநீர் மற்றும் உணவுப் பொட்டலங்கள் தயாராக உள்ளன.` };
        case 'hi':
          return { text: `आश्रय क्षमता विवरण:\n• ${shelters.map(s => `${s.name}: ${s.totalCapacity - s.currentOccupancy} खाली बिस्तर (कुल: ${s.currentOccupancy}/${s.totalCapacity})`).join('\n• ')}\nजिले के सभी शिविरों में कुल ${totalFreeBeds} खाली बिस्तर उपलब्ध हैं।` };
        case 'te':
          return { text: `పునరావాస కేంద్రాల సామర్థ్యం:\n• ${shelters.map(s => `${s.name}: ${s.totalCapacity - s.currentOccupancy} ఖాళీ బెడ్లు (మొత్తం: ${s.currentOccupancy}/${s.totalCapacity})`).join('\n• ')}\nమొత్తం అందుబాటులో ఉన్న బెడ్లు: ${totalFreeBeds}.` };
        case 'ml':
          return { text: `ദുരിതാശ്വാസ ക്യാമ്പുകളുടെ സൗകര്യങ്ങൾ:\n• ${shelters.map(s => `${s.name}: ${s.totalCapacity - s.currentOccupancy} ഒഴിവുള്ള ബെഡുകൾ (ആകെ: ${s.currentOccupancy}/${s.totalCapacity})`).join('\n• ')}\nആകെ ലഭ്യമായ ബെഡുകൾ: ${totalFreeBeds}.` };
        case 'bn':
          return { text: `ত্রাণ শিবিরের ধারণক্ষমতা বিবরণ:\n• ${shelters.map(s => `${s.name}: ${s.totalCapacity - s.currentOccupancy} খালি বিছানা (মোট: ${s.currentOccupancy}/${s.totalCapacity})`).join('\n• ')}\nজেলায় মোট ${totalFreeBeds}টি খালি বিছানা প্রস্তুত রয়েছে।` };
        case 'en':
        default:
          return { text: `Shelter capacity breakdown:\n${shelters.map(s => `• ${s.name}: ${s.totalCapacity - s.currentOccupancy} free beds (${s.currentOccupancy}/${s.totalCapacity} occupied)`).join('\n')}\nTotal free beds across all designated relief camps: ${totalFreeBeds}.` };
      }
    }

    // 8. ACTIVE INCIDENTS & SOS
    const isIncidents = q3Matches.some(m => q.includes(m.toLowerCase())) ||
                        q.includes('incident') || q.includes('active') || q.includes('sos') || q.includes('emergency') || q.includes('rescue') || q.includes('trapped') ||
                        q.includes('சம்பவம்') || q.includes('அவசரம்') || q.includes('மீட்பு') || q.includes('எத்தனை') ||
                        q.includes('घटना') || q.includes('आपातकालीन') || q.includes('बचाव') || q.includes('फंसे') || q.includes('कितनी') ||
                        q.includes('సంఘటన') || q.includes('రెస్క్యూ') || q.includes('అత్యవసర') || q.includes('ఎన్ని') ||
                        q.includes('സംഭവം') || q.includes('സംഭവങ്ങൾ') || q.includes('രക്ഷാപ്രവർത്തനം') || q.includes('അടിയന്തര') || q.includes('എത്ര') ||
                        q.includes('ঘটনা') || q.includes('উদ্ধার') || q.includes('জরুরি') || q.includes('আটকা') || q.includes('কতগুলি');

    if (isIncidents) {
      switch (lang) {
        case 'ta':
          return { text: `மாவட்டத்தில் தற்போது ${activeSOS.length} அவசர சம்பவங்கள் பதிவாகியுள்ளன. இதில் ${criticalSOS.length} சம்பவங்கள் அதிதீவிர முன்னுரிமை கொண்ட படகு மீட்புப் பணிகளாகும் (முக்கிய பகுதி: ${activeSOS[0]?.locationName || 'பாண்டு காட்'}). NDRF மீட்புக் குழுக்கள் களத்தில் உள்ளன.` };
        case 'hi':
          return { text: `जिले में वर्तमान में ${activeSOS.length} सक्रिय आपातकालीन घटनाएं दर्ज हैं, जिनमें ${criticalSOS.length} नाव बचाव की आवश्यकता वाली गंभीर घटनाएं शामिल हैं (शीर्ष क्षेत्र: ${activeSOS[0]?.locationName || 'पांडु घाट'})। एनडीआरएफ टीमें तैनात हैं।` };
        case 'te':
          return { text: `జిల్లాలో ప్రస్తుతం ${activeSOS.length} క్రియాశీల అత్యవసర సంఘటనలు ఉన్నాయి. వీటిలో ${criticalSOS.length} అత్యవసర బోట్ రెస్క్యూ అవసరమైనవి (${activeSOS[0]?.locationName || 'పాండు ఘాట్'}). రెస్క్యూ బృందాలు పని చేస్తున్నాయి.` };
        case 'ml':
          return { text: `ജില്ലയിൽ നിലവിൽ ${activeSOS.length} അടിയന്തര സംഭവങ്ങൾ റിപ്പോർട്ട് ചെയ്തിട്ടുണ്ട്. ഇതിൽ ${criticalSOS.length} എണ്ണം അതിഗുരുതര ബോട്ട് രക്ഷാപ്രവർത്തനങ്ങളാണ് (${activeSOS[0]?.locationName || 'പാണ്ഡു ഘാട്ട്'}). രക്ഷാപ്രവർത്തനം പുരോഗമിക്കുന്നു.` };
        case 'bn':
          return { text: `জেলায় বর্তমানে ${activeSOS.length}টি সক্রিয় জরুরি ঘটনা রেকর্ড করা হয়েছে, যার মধ্যে ${criticalSOS.length}টি বোট উদ্ধারের জন্য চরম জরুরি (${activeSOS[0]?.locationName || 'পান্ডু ঘাট'})। উদ্ধারকারী দল মোতায়েন রয়েছে।` };
        case 'en':
        default:
          return { text: `There are currently ${activeSOS.length} active emergency incidents recorded in the district, including ${criticalSOS.length} critical priority cases requiring motorboat evacuation (top incident at: ${activeSOS[0]?.locationName || 'Pandu Ghat'}).` };
      }
    }

    // 9. RIVER WATER LEVEL / HYDROLOGY
    const isWater = q5Matches.some(m => q.includes(m.toLowerCase())) ||
                    q.includes('water') || q.includes('river') || q.includes('hydro') || q.includes('level') || q.includes('depth') || q.includes('cwc') || q.includes('gauge') ||
                    q.includes('நீர்') || q.includes('ஆறு') || q.includes('மழை') || q.includes('ஆழம்') ||
                    q.includes('जलस्तर') || q.includes('पानी') || q.includes('नदी') || q.includes('जल') || q.includes('गहराई') ||
                    q.includes('నీటి') || q.includes('నది') || q.includes('వరద') || q.includes('మట్టం') ||
                    q.includes('വെള്ളം') || q.includes('നദി') || q.includes('ജലനിരപ്പ്') ||
                    q.includes('পানি') || q.includes('জল') || q.includes('নদী') || q.includes('উচ্চতা');

    if (isWater) {
      switch (lang) {
        case 'ta':
          return { text: `பாண்டு தெற்கு கரையில் உள்ள பிரம்மபுத்திரா நீர் அளவீடு 82 செ.மீ ஆழத்தில் (+12 செ.மீ/மணி உயர்வு) உள்ளது. CWC ஆபத்து குறியீடு ${dangerMarkMeters} மீட்டருக்கு எதிராக தற்போதைய நீர்மட்டம் ${riverLevelMeters} மீட்டராக உள்ளது.` };
        case 'hi':
          return { text: `पांडु साउथ बैंक पर ब्रह्मपुत्र जल स्तर 82 सेमी गहराई पर है (+12 सेमी/घंटा वृद्धि)। केंद्रीय जल आयोग के खतरे के निशान ${dangerMarkMeters} मीटर के मुकाबले स्तर ${riverLevelMeters} मीटर पर है।` };
        case 'te':
          return { text: `పాండు సౌత్ బ్యాంక్ వద్ద బ్రహ్మపుత్ర నది గేజ్ 82 సెం.మీ వద్ద ఉంది (+12 సెం.మీ/గంట పెరుగుదల). CWC ప్రమాద స్థాయి ${dangerMarkMeters} మీటర్లు కాగా ప్రస్తుత స్థాయి ${riverLevelMeters} మీటర్లు.` };
        case 'ml':
          return { text: `പാണ്ഡു സൗത്ത് ബാങ്കിലെ ബ്രഹ്മപുത്ര ജലനിരപ്പ് 82 സെ.മീറ്ററിലാണ് (+12 സെ.മീ/മണിക്കൂർ വർദ്ധന). സിഡബ്ല്യുസി അപകട നിരക്കായ ${dangerMarkMeters} മീറ്ററിനെതിരെ നിലവിലെ നില ${riverLevelMeters} മീറ്ററാണ്.` };
        case 'bn':
          return { text: `পান্ডু দক্ষিণ তীরে ব্রহ্মপুত্র নদীর গেজ ৮২ সেমি স্তরে রয়েছে (+১২ সেমি/ঘন্টা বৃদ্ধি)। CWC বিপদসীমা ${dangerMarkMeters} মিটারের বিপরীতে বর্তমান স্তর ${riverLevelMeters} মিটার।` };
        case 'en':
        default:
          return { text: `The Brahmaputra hydrological gauge at Pandu South Bank is standing at 82 cm depth (+12cm/h rise). Current stage is ${riverLevelMeters}m MSL against the Central Water Commission Danger Mark of ${dangerMarkMeters}m.` };
      }
    }

    // 10. EMERGENCY SAFETY, PRECAUTIONS, EVACUATION & HELPLINES
    const isSafety = q.includes('safet') || q.includes('precaution') || q.includes('helpline') || q.includes('phone') || q.includes('call') || q.includes('number') ||
                     q.includes('பாதுகாப்பு') || q.includes('உதவி') || q.includes('எண்') ||
                     q.includes('सुरक्षा') || q.includes('बचाव') || q.includes('हेल्पलाइन') || q.includes('नंबर') ||
                     q.includes('రక్షణ') || q.includes('సహాయం') || q.includes('హెల్ప్‌లైన్') ||
                     q.includes('സുരക്ഷ') || q.includes('മുൻകരുതൽ') || q.includes('ഹെൽപ്പ്') ||
                     q.includes('নিরাপত্তা') || q.includes('সতর্কতা') || q.includes('হেল্পলাইন') || q.includes('সাহায্য');

    if (isSafety) {
      switch (lang) {
        case 'ta':
          return { text: `வெள்ளப் பாதுகாப்பு வழிகாட்டல்கள்:\n1. உடனடியாக மின்சாரம் மற்றும் எரிவாயு இணைப்புகளை அணைக்கவும்.\n2. குறைந்தபட்சம் 3 நாட்களுக்குத் தேவையான குடிநீர், உலர்ந்த உணவு மற்றும் அவசர மருந்துகளை சேமிக்கவும்.\n3. முழங்கால் அளவிற்கு மேல் நீர் பாயும் சாலைகளில் நடக்கவோ வாகனங்களை இயக்கவோ வேண்டாம்.\n4. அரசு அங்கீகரித்த நிவாரண முகாம்களுக்கு உடனே செல்லவும்.\nஅவசர உதவி எண்கள் (24x7):\n• மாவட்ட அவசர கட்டுப்பாட்டு மையம்: 1077\n• மாநில பேரிடர் கட்டுப்பாட்டு மையம்: 1070\n• காவல் & பொது அவசரம்: 112\n• ஆம்புலன்ஸ்: 108 | தீயணைப்பு: 101` };
        case 'hi':
          return { text: `बाढ़ सुरक्षा निर्देश:\n1. तुरंत बिजली और गैस आपूर्ति बंद कर दें।\n2. कम से कम 3 दिनों के लिए पीने का पानी, सूखा भोजन और आवश्यक दवाएं सुरक्षित रखें।\n3. घुटने से अधिक बहते पानी में चलने या गाड़ी चलाने की कोशिश न करें।\n4. निकटतम सुरक्षित ऊंचे आश्रय में शरण लें।\nआपातकालीन हेल्पलाइन (24x7):\n• जिला आपदा नियंत्रण कक्ष: 1077\n• राज्य आपदा प्रबंधन: 1070\n• पुलिस व राष्ट्रीय आपातकाल: 112\n• एम्बुलेंस: 108 | दमकल: 101` };
        case 'te':
          return { text: `వరద రక్షణ మార్గదర్శకాలు:\n1. వెంటనే విద్యుత్ మరియు గ్యాస్ కనెక్షన్లను ఆపివేయండి.\n2. కనీసం 3 రోజులకు తాగునీరు, ఎండు ఆహారం మరియు మందులను భద్రపరుచుకోండి.\n3. నీరు ప్రవహిస్తున్న రోడ్లపై నడవవద్దు లేదా వాహనాలు నడపవద్దు.\n4. ప్రభుత్వ పునరావాస కేంద్రాలకు వెంటనే చేరుకోండి.\nఅత్యవసర హెల్ప్‌లైన్ నంబర్లు:\n• జిల్లా విపత్తు కేంద్రం: 1077\n• రాష్ట్ర అత్యవసర కేంద్రం: 1070\n• పోలీస్ / అత్యవసరం: 112\n• అంబులెన్స్: 108 | ఫైర్: 101` };
        case 'ml':
          return { text: `പ്രളയ സുരക്ഷാ നിർദ്ദേശങ്ങൾ:\n1. വൈദ്യുതി, ഗ്യാസ് കണക്ഷനുകൾ ഉടൻ വിച്ഛേദിക്കുക.\n2. കുറഞ്ഞത് 3 ദിവസത്തേക്കുള്ള കുടിവെള്ളവും ഉണങ്ങിയ ഭക്ഷണവും മരുന്നുകളും കരുതുക.\n3. വെള്ളക്കെട്ടിലൂടെ വാഹനമോടിക്കുകയോ നടക്കുകയോ ചെയ്യരുത്.\n4. എത്രയും വേഗം അടുത്തുള്ള ദുരിതാശ്വാസ ക്യാമ്പിലേക്ക് മാറുക.\nഅടിയന്തര ഹെൽപ്പ്‌ലൈൻ നമ്പറുകൾ:\n• ജില്ലാ ദുരന്ത നിവാരണ കൺട്രോൾ റൂം: 1077\n• സംസ്ഥാന കൺട്രോൾ റൂം: 1070\n• പോലീസ് / എമർജൻസി: 112\n• ആംബുലൻസ്: 108 | ഫയർ ഫോഴ്സ്: 101` };
        case 'bn':
          return { text: `বন্যা নিরাপত্তা নির্দেশাবলী:\n১. দ্রুত বিদ্যুৎ এবং গ্যাসের প্রধান সংযোগ বন্ধ করুন।\n২. কমপক্ষে ৩ দিনের জন্য নিরাপদ খাবার পানি, শুকনো খাবার ও প্রয়োজনীয় ওষুধ সংগ্রহে রাখুন।\n৩. প্রবাহিত বন্যার পানির মধ্য দিয়ে হাঁটা বা গাড়ি চালানোর চেষ্টা করবেন না।\n৪. দ্রুত নিকটবর্তী উঁচু আশ্রয়কেন্দ্রে চলে যান।\nজরুরি হেল্পলাইন নম্বর (২৪x৭):\n• জেলা দুর্যোগ নিয়ন্ত্রণ কক্ষ: ১০৭৭\n• রাজ্য জরুরি কেন্দ্র: ১০৭০\n• পুলিশ ও সার্বিক জরুরি: ১১২\n• অ্যাম্বুলেন্স: ১০৮ | ফায়ার সার্ভিস: ১০১` };
        case 'en':
        default:
          return { text: `Emergency Flood Safety Directives:\n1. Immediately turn off main electrical circuits and gas supplies.\n2. Store at least 3 days of potable water, dry rations, and critical medications.\n3. Never walk or drive through moving flood waters.\n4. Evacuate along high-ground ridges to designated relief camps.\n24x7 Emergency Helplines:\n• District Disaster Control Room: 1077\n• State Emergency Operations Center (SEOC): 1070\n• Police / National Emergency: 112\n• Ambulance: 108 | Fire Rescue: 101` };
      }
    }

    // 11. FOOD, WATER & RELIEF SUPPLIES
    const isSupplies = q.includes('food') || q.includes('ration') || q.includes('supply') || q.includes('medical kit') ||
                       q.includes('உணவு') || q.includes('மருந்து') ||
                       q.includes('भोजन') || q.includes('राशन') || q.includes('दवा') ||
                       q.includes('ఆహారం') || q.includes('మందులు') ||
                       q.includes('ഭക്ഷണം') || q.includes('മരുന്ന്') ||
                       q.includes('খাবার') || q.includes('ত্রাণ');

    if (isSupplies) {
      const totalWater = shelters.reduce((acc, s) => acc + s.resources.waterLiters, 0);
      const totalFood = shelters.reduce((acc, s) => acc + s.resources.foodPackets, 0);
      const totalMeds = shelters.reduce((acc, s) => acc + s.resources.medicalKits, 0);
      switch (lang) {
        case 'ta':
          return { text: `நிவாரணப் பொருட்கள் இருப்பு விவரம்:\n• மொத்த குடிநீர்: ${totalWater.toLocaleString()} லிட்டர்\n• உணவுப் பொட்டலங்கள்: ${totalFood.toLocaleString()} பொட்டலங்கள்\n• அவசர முதலுதவி பெட்டிகள்: ${totalMeds} பெட்டிகள்\nஅனைத்து நிவாரண முகாம்களிலும் சுத்திகரிக்கப்பட்ட குடிநீரும் மருத்துவக் குழுவும் தயார் நிலையில் உள்ளன.` };
        case 'hi':
          return { text: `राहत सामग्री स्टॉक विवरण:\n• कुल पेयजल: ${totalWater.toLocaleString()} लीटर\n• तैयार भोजन पैकेट: ${totalFood.toLocaleString()} पैकेट\n• आपातकालीन मेडिकल किट: ${totalMeds} किट\nसभी अधिकृत राहत शिविरों में भोजन और मेडिकल टीम तैनात है।` };
        case 'te':
          return { text: `సహాయ సామాగ్రి నిల్వ వివరాలు:\n• తాగునీరు: ${totalWater.toLocaleString()} లీటర్లు\n• ఆహార ప్యాకెట్లు: ${totalFood.toLocaleString()} ప్యాకెట్లు\n• మెడికల్ కిట్లు: ${totalMeds}\nఅన్ని పునరావాస కేంద్రాలలో తగినంత సరఫరా ఉంది.` };
        case 'ml':
          return { text: `ദുരിതാശ്വാസ വിഭവങ്ങളുടെ ലഭ്യത:\n• കുടിവെള്ളം: ${totalWater.toLocaleString()} ലിറ്റർ\n• ഭക്ഷണ പാക്കറ്റുകൾ: ${totalFood.toLocaleString()} എണ്ണം\n• മെഡിക്കൽ കിറ്റുകൾ: ${totalMeds} എണ്ണം\nഎല്ലാ ക്യാമ്പുകളിലും ആവശ്യമായ വിഭവങ്ങൾ സജ്ജീകരിച്ചിട്ടുണ്ട്.` };
        case 'bn':
          return { text: `ত্রাণ সামগ্রীর বর্তমান মজুদ:\n• মোট খাবার পানি: ${totalWater.toLocaleString()} লিটার\n• প্রস্তুত খাবার প্যাকেট: ${totalFood.toLocaleString()}টি\n• জরুরি ফার্স্ট এইড কিট: ${totalMeds}টি\nসকল অনুমোদিত আশ্রয়কেন্দ্রে পর্যাপ্ত ত্রাণ ও মেডিকেল টিম মোতায়েন রয়েছে।` };
        case 'en':
        default:
          return { text: `Emergency Relief Supplies Status:\n• Potable Water: ${totalWater.toLocaleString()} Liters\n• Ready Meal Rations: ${totalFood.toLocaleString()} Packets\n• Trauma / First Aid Kits: ${totalMeds} Kits\nAll designated flood shelters maintain minimum 48-hour reserve stocks.` };
      }
    }

    // 12. DEFAULT TELEMETRY SUMMARY
    switch (lang) {
      case 'ta':
        return { text: `நேரலை SEOC தரவு: மாவட்டம்: ${district}, ஆபத்து: ${overallRiskLevel}, தீவிர சம்பவங்கள்: ${activeSOS.length}, காலி முகாம் படுக்கைகள்: ${totalFreeBeds}. ஆபத்து நிலை, நிவாரண முகாம்கள், ஆற்று நீர்மட்டம் குறித்து கேட்கலாம்.` };
      case 'hi':
        return { text: `लाइव SEOC डेटा: जिला: ${district}, जोखिम: ${overallRiskLevel}, सक्रिय घटनाएं: ${activeSOS.length}, खाली शिविर बिस्तर: ${totalFreeBeds}। आप बाढ़ जोखिम, सुरक्षित आश्रय या जलस्तर के बारे में पूछ सकते हैं।` };
      case 'te':
        return { text: `లైవ్ SEOC డేటా: జిల్లా: ${district}, ముప్పు: ${overallRiskLevel}, అత్యవసర కాల్స్: ${activeSOS.length}, ఖాళీ బెడ్లు: ${totalFreeBeds}. రిస్క్ స్థాయి, ఆశ్రయాలు, వరద పరిస్థితి గురించి అడగండి.` };
      case 'ml':
        return { text: `തത്സമയ SEOC വിവരങ്ങൾ: ജില്ല: ${district}, അപകട സാധ്യത: ${overallRiskLevel}, സജീവ സംഭവങ്ങൾ: ${activeSOS.length}, ഒഴിവുള്ള ബെഡുകൾ: ${totalFreeBeds}. കൂടുതൽ വിവരങ്ങൾ ചോദിക്കാവുന്നതാണ്.` };
      case 'bn':
        return { text: `লাইভ SEOC তথ্য: জেলা: ${district}, ঝুঁকির মাত্রা: ${overallRiskLevel}, সক্রিয় ঘটনা: ${activeSOS.length}, খালি বিছানা: ${totalFreeBeds}। আপনি দুর্যোগ ঝুঁকি, আশ্রয়কেন্দ্র বা পানির উচ্চতা সম্পর্কে জিজ্ঞাসা করতে পারেন।` };
      case 'en':
      default:
        return { text: `Based on live SEOC telemetry: District: ${district}, Risk: ${overallRiskLevel}, Active SOS: ${activeSOS.length}, Free Shelter Beds: ${totalFreeBeds}. You can ask about risk levels, shelter locations, incidents, or water depths.` };
    }
  };

  const stopGenerating = () => {
    abortRef.current?.abort();
  };

  const handleAsk = async (queryText: string, autoSpeak = false) => {
    const q = queryText.trim();
    if (!q || isStreaming) return;

    const genId = ++genIdRef.current;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setVoiceState('PROCESSING');
    setIsStreaming(true);
    setStreamingText('');

    const controller = new AbortController();
    abortRef.current = controller;

    let streamed = '';
    let finalText: string | null = null;
    let locationAction: LocationAction | undefined;

    try {
      // Offline mode: never touch the network, answer straight from the
      // on-device (pretrained) knowledge base.
      if (isForcedOffline) {
        throw new Error('OFFLINE_MODE');
      }

      // Mini-ChatGPT: real LLM with conversation memory + live telemetry context
      const systemPrompt = buildSystemPrompt(currentLanguage, buildLiveSnapshot());
      const history = messagesRef.current
        .filter(m => m.id !== 'm-init')
        .slice(-16)
        .map(m => ({
          role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
          content: m.text
        }));

      const reply = await streamChatCompletion(
        [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: q }],
        {
          signal: controller.signal,
          onToken: (delta) => {
            streamed += delta;
            setStreamingText(prev => prev + delta);
          }
        }
      );

      if (genId !== genIdRef.current) return; // superseded by clear/new message

      if (reply && reply.trim()) {
        const parsed = extractLocationBlock(reply);
        finalText = parsed.text;
        locationAction = parsed.locationAction;
        setAiStatus('online');
        setAiNotice(null);
      } else {
        throw new Error('EMPTY_LLM_REPLY');
      }
    } catch (err) {
      if (genId !== genIdRef.current) return;

      const stopped = err instanceof DOMException && err.name === 'AbortError';

      if (isForcedOffline) {
        // Deliberate offline mode: the on-device engine is the expected path,
        // not a failure, so keep the status pinned to offline and skip the
        // "service unreachable" notice entirely.
        setAiStatus('offline');
        const result = generateBotResponse(q, currentLanguage);
        finalText = result.text;
        locationAction = result.locationAction;
      } else if (stopped) {
        // User pressed Stop — commit whatever was already streamed (if anything)
        finalText = streamed.trim() || null;
        if (!finalText) {
          abortRef.current = null;
          setIsStreaming(false);
          setStreamingText('');
          setVoiceState('IDLE');
          return;
        }
      } else {
        // LLM unreachable -> graceful fallback to the local intelligence engine.
        // Make it visible so it never looks like a canned bot: the next message
        // automatically tries the live AI again.
        setAiStatus('offline');
        const reason = getLastAiError() || '';
        const busy = /429|503|busy|queue|rate/i.test(reason);
        const hint = busy
          ? 'The free AI is just busy right now (too many requests) — it auto-retries. Tap Retry AI or ask again in a few seconds.'
          : reason
            ? `Reason: ${reason.replace(/\(.+\)/g, '').trim() || 'unreachable'}.`
            : 'Your next question will automatically retry the live AI.';
        setAiNotice(busy ? hint : `AI service unreachable right now — answering from the on-device engine. ${hint}`);
        const result = generateBotResponse(q, currentLanguage);
        finalText = result.text;
        locationAction = result.locationAction;
      }
    }

    abortRef.current = null;
    setIsStreaming(false);
    setStreamingText('');

    const botMsg: ChatMessage = {
      id: `b-${Date.now()}`,
      sender: 'bot',
      text: finalText.trim(),
      locationAction,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, botMsg]);

    // If triggered via voice or autoSpeak, read it aloud in current language
    // Note: speaks ONLY the verbal description without URLs or button labels
    if (autoSpeak) {
      speakText(botMsg.text);
    } else {
      setVoiceState('IDLE');
    }
  };

  const handleAskRef = useRef(handleAsk);
  handleAskRef.current = handleAsk;
  useEffect(() => {
    (window as any).__nexoraChatAsk = (q: string, autoSpeak = false) => handleAskRef.current(q, autoSpeak);
    (window as any).__nexoraGenerateBotResponse = (q: string, lang?: SupportedLanguage) =>
      generateBotResponse(q, lang || currentLanguage);
    return () => {
      delete (window as any).__nexoraChatAsk;
      delete (window as any).__nexoraGenerateBotResponse;
    };
  }, [currentLanguage, generateBotResponse]);

  // Language change synchronizer: safely clean up active recognition and speech
  useEffect(() => {
    voiceRecognitionService.reinitialize(currentLanguage);
    textToSpeechService.stop();
    setVoiceState('IDLE');
    setVoiceNotice(null);
  }, [currentLanguage]);

  // Toggle Speech Recognition with robust lifecycle and error handling
  const toggleVoiceInput = () => {
    if (!voiceRecognitionService.isSupported()) {
      setIsMicSupported(false);
      setVoiceState('UNAVAILABLE');
      setVoiceNotice({
        message: t('voice_status_unsupported', 'Voice input is not supported in this browser. Please type your question.'),
        canRetryVoices: false
      });
      return;
    }

    // Stop speaking if currently speaking
    if (voiceState === 'SPEAKING') {
      textToSpeechService.stop();
      setVoiceState('IDLE');
      return;
    }

    // Stop listening if currently listening
    if (voiceState === 'LISTENING') {
      voiceRecognitionService.stop();
      setVoiceState('IDLE');
      return;
    }

    // Cancel active audio before starting listening
    textToSpeechService.stop();
    setVoiceNotice(null);

    voiceRecognitionService.start(currentLanguage, {
      onStateChange: (state) => {
        setVoiceState(state);
      },
      onTranscript: (transcript, isFinal) => {
        if (transcript.trim() && isFinal) {
          setVoiceState('PROCESSING');
          handleAsk(transcript.trim(), true);
        }
      },
      onError: (err) => {
        setVoiceState('ERROR');
        setVoiceNotice({
          message: err.message,
          canRetryVoices: err.code === 'NETWORK_ERROR' || err.code === 'NO_SPEECH'
        });
      },
      onEnd: () => {
        setVoiceState(prev => (prev === 'LISTENING' ? 'IDLE' : prev));
      }
    });
  };

  const sampleQuestions = [
    t('chat_q1', 'What is the current risk?'),
    t('chat_q2', 'Where is the nearest safe shelter?'),
    t('chat_q3', 'How many active incidents are there?'),
    t('chat_q4', 'Which shelters have available capacity?'),
    t('chat_q5', 'What is the river water level?')
  ];

  return (
    <div className="fixed bottom-5 right-5 z-40 font-body">
      {/* COLLAPSED FLOATING ACTION BUTTON */}
      {!isOpen && (
        <button
          onClick={openChat}
          className="flex items-center gap-2.5 h-11 pl-3 pr-4 rounded-lg bg-[#1A3A6B] hover:bg-[#142C52] text-white shadow-[0_2px_6px_-1px_rgba(20,21,26,0.16),0_1px_2px_rgba(20,21,26,0.10)] transition-colors duration-150 cursor-pointer group"
          aria-label="Open NEXORA AI Chatbot"
        >
          <div className="w-6 h-6 rounded-md bg-white/15 text-white flex items-center justify-center relative">
            <MessageSquare className="w-3.5 h-3.5 text-white" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white/90 ring-2 ring-[#1A3A6B]" />
          </div>
          <div className="text-left">
            <div className="text-xs font-semibold font-heading text-white flex items-center gap-1.5">
              <span>{t('chat_header', 'NEXORA AI')}</span>
              <span className="text-[9px] font-normal text-white/60 font-data">
                {currentLanguage.toUpperCase()}
              </span>
            </div>
            <div className="text-[10px] text-white/65 flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${
                aiStatus === 'online' ? 'bg-[#7CC99A]' :
                aiStatus === 'offline' ? 'bg-[#F0A79E]' :
                'bg-[#E8C77A]'
              }`} />
              <span>
                {aiStatus === 'online' ? 'AI Ready — ask anything'
                  : isForcedOffline ? 'Offline — on-device answers'
                  : aiStatus === 'offline' ? 'AI Offline'
                  : 'Connecting…'}
              </span>
            </div>
          </div>
        </button>
      )}

      {/* EXPANDED CHAT PANEL */}
      {isOpen && (
        <div className="w-[calc(100vw-32px)] sm:w-[420px] h-[80vh] sm:h-[550px] max-h-[90vh] sm:max-h-[85vh] bg-white dark:bg-[#212121] text-[#14151A] dark:text-[#FFFFFF] rounded-xl shadow-[0_24px_48px_-12px_rgba(20,21,26,0.18),0_8px_16px_-8px_rgba(20,21,26,0.08)] border border-[#E4E4E0] dark:border-[#B4B4B4] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          
          {/* HEADER */}
          <div className="px-4 h-12 bg-[#1A3A6B] text-white flex items-center justify-between border-b border-[#12294D]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-white/15 text-white flex items-center justify-center">
                <Bot className="w-[15px] h-[15px] text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-heading font-bold text-xs text-white leading-none">
                    {t('chat_header', 'NEXORA AI Assistant')}
                  </h3>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold font-data bg-white/15 text-white/90 border border-white/20">
                    {currentLanguage.toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] text-white/60 font-data mt-1 block flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    aiStatus === 'online' ? 'bg-[#7CC99A]' :
                    aiStatus === 'offline' ? 'bg-[#F0A79E]' :
                    'bg-[#E8C77A]'
                  }`} />
                  <span className="truncate">
                    {district.split(' ')[0]} •{' '}
                    {aiStatus === 'online' ? 'AI Online — ask anything'
                      : isForcedOffline ? 'Offline — on-device answers'
                      : aiStatus === 'offline' ? 'AI Offline'
                      : 'Connecting to AI…'}
                  </span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Stop voice audio button if speaking */}
              {voiceState === 'SPEAKING' && (
                <button
                  onClick={stopSpeaking}
                  className="px-2 py-1 rounded-lg bg-[#B42318] text-white text-[10px] font-bold flex items-center gap-1 hover:bg-[#9A1C13] transition-all cursor-pointer"
                  title={t('voice_stop', 'Stop Voice')}
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>{t('voice_stop', 'Stop')}</span>
                </button>
              )}

              {/* Clear conversation button */}
              <button
                onClick={handleClearChat}
                className="p-1.5 rounded-lg text-[#6B6D77] hover:text-white hover:bg-[#12294D] transition-colors cursor-pointer dark:text-[#D0D0D0]"
                title={t('chat_clear', 'Clear conversation')}
                aria-label={t('chat_clear', 'Clear conversation')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  stopSpeaking();
                  setIsOpen(false);
                }}
                className="p-1 rounded-lg text-[#6B6D77] hover:text-white hover:bg-[#12294D] transition-colors cursor-pointer dark:text-[#D0D0D0]"
                title="Close Assistant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* VOICE STATE INDICATOR BAR (6 CLEAR STATES) */}
          <div data-voice-state={voiceState} className="px-3.5 py-1.5 bg-[#12294D] border-b border-[#1A3A6B] flex items-center justify-between text-[10px] font-data">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                voiceState === 'LISTENING' ? 'bg-[#1A3A6B] animate-ping' :
                voiceState === 'SPEAKING' ? 'bg-[#126B34] animate-pulse' :
                voiceState === 'PROCESSING' ? 'bg-[#E8C77A]' :
                voiceState === 'ERROR' ? 'bg-[#B42318]' :
                voiceState === 'UNAVAILABLE' ? 'bg-[#6B6D77]' :
                'bg-[#126B34]'
              }`} />
              <span className="font-bold text-white uppercase tracking-wider truncate">
                {voiceState === 'LISTENING' ? t('voice_status_listening', 'LISTENING...') :
                 voiceState === 'SPEAKING' ? t('voice_status_speaking', 'SPEAKING...') :
                 voiceState === 'PROCESSING' ? t('voice_status_processing', 'UNDERSTANDING...') :
                 voiceState === 'ERROR' ? t('voice_status_network_error', 'VOICE ERROR') :
                 voiceState === 'UNAVAILABLE' ? t('voice_status_unsupported', 'UNAVAILABLE') :
                 t('voice_status_idle', 'TAP MICROPHONE')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {voiceState === 'LISTENING' && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className="px-2 py-0.5 rounded bg-[#B42318] hover:bg-[#9A1C13] text-white text-[9px] font-bold cursor-pointer"
                >
                  Stop
                </button>
              )}
              {voiceState === 'SPEAKING' && (
                <button
                  type="button"
                  onClick={stopSpeaking}
                  className="px-2 py-0.5 rounded bg-[#B42318] hover:bg-[#9A1C13] text-white text-[9px] font-bold cursor-pointer flex items-center gap-1"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>Stop</span>
                </button>
              )}
              {voiceState === 'ERROR' && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className="px-2 py-0.5 rounded bg-[#A15C07] hover:bg-[#8A4D06] text-white text-[9px] font-bold cursor-pointer flex items-center gap-1"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>{t('voice_try_again', 'Try Again')}</span>
                </button>
              )}
              <span className="text-[#6B6D77] text-[9px] font-mono dark:text-[#D0D0D0]">
                {LANGUAGE_CONFIG[currentLanguage]?.speechRecognition || SPEECH_LOCALES[currentLanguage] || 'en-IN'}
              </span>
            </div>
          </div>

          {/* VOICE SYSTEM NOTICE / FALLBACK BANNER */}
          {voiceNotice && (
            <div data-voice-notice className="px-3.5 py-2 bg-[#FBF7EC] dark:bg-[#2F2F2F] border-b border-[#F5E0A0] dark:border-[#B4B4B4] text-[11px] text-[#7A3E0B] dark:text-[#FFFFFF] flex items-start justify-between gap-2 animate-fade-in">
              <div className="flex items-start gap-1.5 leading-snug">
                <AlertTriangle className="w-3.5 h-3.5 text-[#A15C07] flex-shrink-0 mt-0.5 dark:text-[#E0E0E0]" />
                <span>{voiceNotice.message}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {voiceNotice.canRetryVoices && (
                  <button
                    type="button"
                    onClick={handleRetryVoices}
                    className="px-2 py-0.5 rounded bg-[#1A3A6B] dark:bg-[#60A5FA] hover:bg-[#12294D] dark:hover:bg-[#1A3A6B] text-white text-[9px] font-bold cursor-pointer flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>{t('voice_retry_speech', 'Retry')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setVoiceNotice(null)}
                  className="text-[#7A3E0B] dark:text-[#D0D0D0] hover:text-[#6B360C] dark:hover:text-white font-bold text-xs cursor-pointer p-0.5"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* AI FALLBACK NOTICE (only when the live AI is unreachable) */}
          {aiNotice && (
            <div data-ai-notice className="px-3.5 py-2 bg-[#FBF7EC] dark:bg-[#2F2F2F] border-b border-[#F5E0A0] dark:border-[#B4B4B4] text-[11px] text-[#7A3E0B] dark:text-[#FFFFFF] flex items-start justify-between gap-2 animate-fade-in">
              <div className="flex items-start gap-1.5 leading-snug">
                <AlertTriangle className="w-3.5 h-3.5 text-[#A15C07] flex-shrink-0 mt-0.5 dark:text-[#E0E0E0]" />
                <span>{aiNotice}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!isForcedOffline && (
                  <button
                    type="button"
                    onClick={retryAi}
                    className="px-2 py-0.5 rounded bg-[#1A3A6B] dark:bg-[#60A5FA] hover:bg-[#12294D] dark:hover:bg-[#1A3A6B] text-white text-[9px] font-bold cursor-pointer flex items-center gap-1"
                    title="Reconnect to the AI service"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>Retry AI</span>
                  </button>
                )}
                {isForcedOffline && (
                  <span className="px-2 py-0.5 rounded bg-[#F0A79E]/25 text-[#7A3E0B] dark:text-[#FFFFFF] text-[9px] font-bold font-data whitespace-nowrap">
                    Network: OFFLINE
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setAiNotice(null)}
                  className="text-[#7A3E0B] dark:text-[#D0D0D0] hover:text-[#6B360C] dark:hover:text-white font-bold text-xs cursor-pointer p-0.5"
                  title="Dismiss"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* MESSAGES BODY */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs bg-[#F1F1EF] dark:bg-[#171717]">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`p-3 rounded-xl max-w-[88%] leading-relaxed whitespace-pre-line shadow-xs ${
                    m.sender === 'user'
                      ? 'bg-[#1A3A6B] dark:bg-[#60A5FA] text-white font-medium border border-[#1A3A6B] dark:border-[#60A5FA]/40'
                      : 'bg-white dark:bg-[#2F2F2F] text-[#14151A] dark:text-[#FFFFFF] border border-[#D5D6DA] dark:border-[#B4B4B4]'
                  }`}
                >
                  <div>{m.text}</div>
                  
                  {/* INTERACTIVE LOCATION ACTION BUTTONS */}
                  {m.sender === 'bot' && m.locationAction && (
                    <div className="mt-2.5 pt-2 border-t border-[#DEDEDA] dark:border-[#B4B4B4] flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleOpenInMap(m.locationAction)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1A3A6B] hover:bg-[#12294D] dark:bg-[#0A2E22] hover:dark:bg-[#3D3D3D] text-white text-[11px] font-medium flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer border border-[#1A3A6B] dark:border-[#B4B4B4]"
                        title="Open on Disaster Map"
                        data-action="open-in-maps"
                      >
                        <MapPin className="w-3.5 h-3.5 text-white" />
                        <span>{t('chat_open_maps', '📍 Open in Maps')}</span>
                      </button>
                      <button
                        onClick={() => handleGetDirections(m.locationAction)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1A3A6B] hover:bg-[#142C52] text-white font-semibold text-[11px] flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                        title="View Safe Evacuation Route"
                        data-action="get-directions"
                      >
                        <Navigation className="w-3.5 h-3.5 text-white" />
                        <span>{t('chat_get_directions', '🧭 Get Directions')}</span>
                      </button>
                      {m.locationAction.lat && m.locationAction.lng && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${m.locationAction.lat},${m.locationAction.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-lg bg-[#1A3A6B] hover:bg-[#12294D] text-white text-[11px] font-medium flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer border border-[#1A3A6B]/30"
                          title="Open in Google Maps"
                          data-action="google-maps"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-white" />
                          <span>Google Maps</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 px-1 text-[9px] text-[#6B6D77] dark:text-[#E0E0E0] font-data">
                  <span>{m.timestamp}</span>
                  {m.sender === 'bot' && (
                    <button
                      onClick={() => speakText(m.text)}
                      className="text-[#1A3A6B] dark:text-[#D0D0D0] hover:opacity-80 cursor-pointer"
                      title="Read aloud"
                    >
                      <Volume2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* LIVE STREAMING / TYPING INDICATOR (mini-ChatGPT) */}
            {isStreaming && (
              <div className="flex flex-col items-start">
                <div className="p-3 rounded-xl max-w-[88%] leading-relaxed whitespace-pre-line shadow-xs bg-white dark:bg-[#2F2F2F] text-[#14151A] dark:text-[#FFFFFF] border border-[#D5D6DA] dark:border-[#B4B4B4]">
                  {streamingText ? (
                    <span>
                      {streamingText}
                      <span className="inline-block w-1.5 h-3.5 bg-[#1A3A6B] rounded-[1px] align-text-bottom ml-0.5 animate-pulse" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A3A6B] nx-typing [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A3A6B] nx-typing [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A3A6B] nx-typing [animation-delay:300ms]" />
                    </span>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* SUGGESTED PROMPTS STRIP */}
          <div className="px-3 py-2 bg-white dark:bg-[#212121] border-t border-[#DEDEDA] dark:border-[#B4B4B4] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {sampleQuestions.slice(0, 3).map((sq, idx) => (
              <button
                key={idx}
                onClick={() => handleAsk(sq)}
                className="px-2.5 py-1 rounded-lg bg-[#F1F1EF] dark:bg-[#2F2F2F] hover:bg-[#EEF2F8] hover:dark:bg-[#3D3D3D] text-[#14151A] dark:text-[#FFFFFF] hover:text-[#1A3A6B] dark:hover:text-[#9DB8DC] border border-[#D5D6DA] dark:border-[#B4B4B4] text-[10px] font-medium whitespace-nowrap transition-all cursor-pointer"
              >
                {sq}
              </button>
            ))}
          </div>

          {/* INPUT FOOTER WITH VOICE MICROPHONE BUTTON */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const inputEl = e.currentTarget.querySelector('input[type="text"]') as HTMLInputElement;
              const val = (input.trim() || inputEl?.value || '').trim();
              if (val) {
                handleAsk(val);
              }
            }}
            className="p-2.5 bg-white dark:bg-[#212121] border-t border-[#DEDEDA] dark:border-[#B4B4B4] flex items-center gap-2"
          >
            {/* MICROPHONE BUTTON (Speech-to-Text) */}
            <button
              type="button"
              data-testid="voice-mic-btn"
              onClick={toggleVoiceInput}
              disabled={!isMicSupported}
              className={`min-w-[44px] min-h-[44px] p-2.5 rounded-xl border transition-all cursor-pointer flex-shrink-0 flex items-center justify-center ${
                voiceState === 'LISTENING'
                  ? 'bg-[#1A3A6B] text-[#14151A] border-[#1A3A6B] shadow-md animate-pulse ring-2 ring-[#1A3A6B]/50'
                  : voiceState === 'ERROR'
                  ? 'bg-[#FAF0D8] dark:bg-[#2F2F2F] text-[#B42318] border-[#E0776C]'
                  : voiceState === 'SPEAKING'
                  ? 'bg-[#E4F3E9] dark:bg-[#2F2F2F] text-[#126B34] border-[#7CC99A]'
                  : 'bg-[#F1F1EF] dark:bg-[#2F2F2F] text-[#1A3A6B] dark:text-[#D0D0D0] hover:bg-[#EEF2F8] hover:dark:bg-[#3D3D3D] border-[#D5D6DA] dark:border-[#B4B4B4]'
              }`}
              title={
                voiceState === 'LISTENING'
                  ? t('voice_status_listening', 'Listening... Speak now')
                  : voiceState === 'SPEAKING'
                  ? t('voice_status_speaking', 'Speaking... Tap to stop')
                  : `${t('voice_assistant', 'Voice Input')} (${LANGUAGE_CONFIG[currentLanguage]?.speechLocale || 'en-IN'})`
              }
              aria-label={
                voiceState === 'LISTENING'
                  ? t('voice_status_listening', 'Listening... Speak now')
                  : voiceState === 'SPEAKING'
                  ? t('voice_status_speaking', 'Speaking... Tap to stop')
                  : `${t('voice_assistant', 'Voice Input')} (${LANGUAGE_CONFIG[currentLanguage]?.speechLocale || 'en-IN'})`
              }
            >
              {voiceState === 'LISTENING' ? (
                <Mic className="w-5 h-5 text-[#14151A] dark:text-[#FFFFFF]" />
              ) : voiceState === 'ERROR' ? (
                <MicOff className="w-5 h-5 text-[#B42318] dark:text-[#FFFFFF]" />
              ) : voiceState === 'SPEAKING' ? (
                <Volume2 className="w-5 h-5 text-[#126B34] animate-pulse dark:text-[#D0D0D0]" />
              ) : (
                <Mic className="w-5 h-5 text-[#1A3A6B] dark:text-[#D0D0D0]" />
              )}
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                voiceState === 'LISTENING'
                  ? t('voice_status_listening', 'Listening to voice... Speak now')
                  : t('chat_placeholder', 'Ask me anything…')
              }
              className="flex-1 px-3 py-2 bg-[#F1F1EF] dark:bg-[#171717] border border-[#D5D6DA] dark:border-[#B4B4B4] rounded-xl text-xs text-[#14151A] dark:text-[#FFFFFF] placeholder-[#6B6D77] dark:placeholder-[#E0E0E0] focus:bg-white focus:dark:bg-[#171717] focus:outline-none focus:ring-2 focus:ring-[#1A3A6B]/40"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={stopGenerating}
                className="p-2 rounded-xl bg-[#B42318] hover:bg-[#9A1C13] text-white shadow-xs transition-colors cursor-pointer flex-shrink-0 border border-[#B42318]"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-2 rounded-xl bg-[#1A3A6B] dark:bg-[#60A5FA] hover:bg-[#12294D] dark:hover:bg-[#1A3A6B] text-white disabled:opacity-40 transition-colors cursor-pointer flex-shrink-0 border border-[#1A3A6B] dark:border-[#60A5FA]/40"
                title={t('chat_send', 'Send')}
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>

        </div>
      )}
    </div>
  );
};
