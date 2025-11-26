import WebSocket from 'ws';
import { ConsumeRequest, Message, ClusterMetadata, PartitionAssignment, OffsetCommit } from '../types';
import { Logger } from '../utils/logger';

export class MessageConsumer {
  private groupId: string;
  private consumerId: string;
  private logger: Logger;
  private connections: Map<string, WebSocket> = new Map();
  private metadata: ClusterMetadata | null = null;
  private assignments: PartitionAssignment[] = [];
  private offsets: Map<string, number> = new Map();

  constructor(groupId: string, consumerId?: string) {
    this.groupId = groupId;
    this.consumerId = consumerId || `consumer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.logger = new Logger(`Consumer-${this.consumerId}`);
  }

  async connect(brokerEndpoints: string[]) {
    for (const endpoint of brokerEndpoints) {
      try {
        const ws = new WebSocket(`ws://${endpoint}`);
        await this.waitForConnection(ws);
        this.connections.set(endpoint, ws);
        this.logger.info(`Connected to broker: ${endpoint}`);
      } catch (error: any) {
        this.logger.error(`Failed to connect to broker ${endpoint}:`, error);
      }
    }

    if (this.connections.size === 0) {
      throw new Error('Failed to connect to any brokers');
    }

    await this.fetchMetadata();
  }

  private waitForConnection(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  private async fetchMetadata() {
    const ws = this.connections.values().next().value;
    if (!ws) return;

    return new Promise<void>((resolve, reject) => {
      const request = { type: 'metadata' };
      
      ws.send(JSON.stringify(request));
      
      const handler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.error) {
            reject(new Error(response.error));
          } else {
            this.metadata = response;
            this.logger.info('Fetched cluster metadata');
            resolve();
          }
        } catch (error) {
          reject(error);
        }
        ws.off('message', handler);
      };

      ws.on('message', handler);
      setTimeout(() => {
        ws.off('message', handler);
        reject(new Error('Metadata fetch timeout'));
      }, 5000);
    });
  }

  async subscribe(topics: string[]) {
    if (!this.metadata) {
      throw new Error('No cluster metadata available');
    }

    this.assignments = [];
    
    for (const topic of topics) {
      const topicPartitions = this.metadata.partitions[topic];
      if (topicPartitions) {
        for (const partition of topicPartitions) {
          this.assignments.push({
            topic,
            partition: partition.id,
            offset: this.offsets.get(`${topic}-${partition.id}`) || 0
          });
        }
      }
    }

    this.logger.info(`Subscribed to topics: ${topics.join(', ')}, assigned ${this.assignments.length} partitions`);
  }

  async poll(timeoutMs: number = 1000): Promise<Message[]> {
    const messages: Message[] = [];
    const pollPromises: Promise<Message[]>[] = [];

    for (const assignment of this.assignments) {
      pollPromises.push(this.pollPartition(assignment, timeoutMs));
    }

    try {
      const results = await Promise.allSettled(pollPromises);
      for (const result of results) {
        if (result.status === 'fulfilled') {
          messages.push(...result.value);
        }
      }
    } catch (error: any) {
      this.logger.error('Error during polling:', error);
    }

    return messages;
  }

  private async pollPartition(assignment: PartitionAssignment, timeoutMs: number): Promise<Message[]> {
    if (!this.metadata) return [];

    const topicPartitions = this.metadata.partitions[assignment.topic];
    const partition = topicPartitions?.find(p => p.id === assignment.partition);
    if (!partition) return [];

    const leaderBroker = this.metadata.brokers.find(b => b.id === partition.leader);
    if (!leaderBroker) return [];

    const brokerEndpoint = `${leaderBroker.host}:${leaderBroker.port}`;
    const ws = this.connections.get(brokerEndpoint);
    if (!ws) return [];

    const request: ConsumeRequest = {
      topic: assignment.topic,
      partition: assignment.partition,
      offset: assignment.offset,
      maxBytes: 1024 * 1024
    };

    try {
      const response = await this.sendConsumeRequest(ws, request, timeoutMs);
      
      if (response.messages.length > 0) {
        const lastMessage = response.messages[response.messages.length - 1];
        assignment.offset = lastMessage.offset + 1;
        this.offsets.set(`${assignment.topic}-${assignment.partition}`, assignment.offset);
      }

      return response.messages;
    } catch (error: any) {
      this.logger.error(`Failed to poll partition ${assignment.topic}:${assignment.partition}:`, error);
      return [];
    }
  }

  private sendConsumeRequest(ws: WebSocket, request: ConsumeRequest, timeoutMs: number): Promise<{ messages: Message[] }> {
    return new Promise((resolve, reject) => {
      const message = {
        type: 'consume',
        data: request
      };

      ws.send(JSON.stringify(message));

      const handler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        } catch (error) {
          reject(error);
        }
        ws.off('message', handler);
      };

      ws.on('message', handler);
      setTimeout(() => {
        ws.off('message', handler);
        reject(new Error('Consume request timeout'));
      }, timeoutMs);
    });
  }

  async commitOffsets(commits?: OffsetCommit[]) {
    if (!commits) {
      commits = this.assignments.map(assignment => ({
        topic: assignment.topic,
        partition: assignment.partition,
        offset: assignment.offset
      }));
    }

    for (const commit of commits) {
      this.offsets.set(`${commit.topic}-${commit.partition}`, commit.offset);
    }

    this.logger.debug(`Committed offsets for ${commits.length} partitions`);
  }

  getAssignments(): PartitionAssignment[] {
    return [...this.assignments];
  }

  async close() {
    await this.commitOffsets();
    
    for (const ws of this.connections.values()) {
      ws.close();
    }
    this.connections.clear();
    this.logger.info('Consumer closed');
  }
}