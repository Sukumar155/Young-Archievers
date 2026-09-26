export type AlertSeverity = 'CRITICAL' | 'SEVERE' | 'MODERATE' | 'ADVISORY';
export type BroadcastChannel = 'CAP_PROTOCOL' | 'CELL_BROADCAST' | 'SMS_GATEWAY' | 'USSD' | 'SIREN_NETWORK';

export interface DisasterAlert {
  id: string;
  title: string;
  severity: AlertSeverity;
  zone: string;
  locationName: string;
  lat: number;
  lng: number;
  timestamp: string;
  reason: string;
  recommendedAction: string;
  issuedBy: string;
  channels: BroadcastChannel[];
  active: boolean;
  affectedPopulation: number;
}
