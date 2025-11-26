export interface Message {
  offset: number;
  timestamp: number;
  key?: string;
  value: any;
  headers?: Record<string, string>;
}

export interface Partition {
  id: number;
  topic: string;
  leader: string;
  replicas: string[];
  isr: string[]; // In-Sync Replicas
}

export interface Topic {
  name: string;
  partitions: number;
  replicationFactor: number;
  config: TopicConfig;
}

export interface TopicConfig {
  retentionMs: number;
  retentionBytes: number;
  segmentMs: number;
  segmentBytes: number;
}

export interface Broker {
  id: string;
  host: string;
  port: number;
  isController: boolean;
  lastHeartbeat: number;
}

export interface ConsumerGroup {
  id: string;
  members: Consumer[];
  coordinator: string;
  state: 'Stable' | 'PreparingRebalance' | 'CompletingRebalance';
}

export interface Consumer {
  id: string;
  groupId: string;
  assignments: PartitionAssignment[];
}

export interface PartitionAssignment {
  topic: string;
  partition: number;
  offset: number;
}

export interface ProduceRequest {
  topic: string;
  partition?: number;
  key?: string;
  value: any;
  headers?: Record<string, string>;
}

export interface ConsumeRequest {
  topic: string;
  partition: number;
  offset: number;
  maxBytes: number;
}

export interface PartitionStrategy {
  (key: string | undefined, partitionCount: number): number;
}

export interface ClusterMetadata {
  brokers: Broker[];
  topics: Record<string, Topic>;
  partitions: Record<string, Partition[]>;
}

export interface LogSegment {
  baseOffset: number;
  path: string;
  size: number;
  lastModified: number;
}

export interface OffsetCommit {
  topic: string;
  partition: number;
  offset: number;
  metadata?: string;
}