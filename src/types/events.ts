import type { Server } from './server';

export interface DownloadProgressEvent {
  workshop_id: string;
  bytes_downloaded: string;
  bytes_total: string;
  percentage: string;
}

export interface ServerRefreshEvent {
  server: Server;
}

export interface DiscoveryProgressEvent {
  tier: number;
  requests: number;
  found: number;
}