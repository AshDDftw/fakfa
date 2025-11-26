import WebSocket from 'ws';
import { ProduceRequest, PartitionStrategy, ClusterMetadata } from '../types';
import { Logger } from '../utils/logger';

export class MessageProducer {
  private logger: Logger;
  private connections: Map<string, WebSocket> = new Map();
  private metadata: ClusterMetadata | null = null;
  private partitionStrategy: PartitionStrategy;

  constructor(partitionStrategy?: PartitionStrategy) {
    this.logger = new Logger('Producer');
    this.partitionStrategy = partitionStrategy || this.roundRobinStrategy;
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

  async produce(request: ProduceRequest): Promise<{ offset: number }> {
    if (!this.metadata) {
      throw new Error('No cluster metadata available');
    }

    const topicPartitions = this.metadata.partitions[request.topic];
    if (!topicPartitions) {
      throw new Error(`Topic ${request.topic} not found`);
    }

    const partition = request.partition !== undefined 
      ? request.partition 
      : this.partitionStrategy(request.key, topicPartitions.length);

    const targetPartition = topicPartitions.find(p => p.id === partition);
    if (!targetPartition) {
      throw new Error(`Partition ${partition} not found for topic ${request.topic}`);
    }

    const leaderBroker = this.metadata.brokers.find(b => b.id === targetPartition.leader);
    if (!leaderBroker) {
      throw new Error(`Leader broker not found for partition ${partition}`);
    }

    const brokerEndpoint = `${leaderBroker.host}:${leaderBroker.port}`;
    const ws = this.connections.get(brokerEndpoint);
    if (!ws) {
      throw new Error(`No connection to broker ${brokerEndpoint}`);
    }

    return this.sendProduceRequest(ws, { ...request, partition });
  }

  private sendProduceRequest(ws: WebSocket, request: ProduceRequest): Promise<{ offset: number }> {
    return new Promise((resolve, reject) => {
      const message = {
        type: 'produce',
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
        reject(new Error('Produce request timeout'));
      }, 10000);
    });
  }

  private roundRobinStrategy: PartitionStrategy = (key, partitionCount) => {
    return Math.floor(Math.random() * partitionCount);
  };

  static keyHashStrategy: PartitionStrategy = (key, partitionCount) => {
    if (!key) return 0;
    
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return Math.abs(hash) % partitionCount;
  };

  async close() {
    for (const ws of this.connections.values()) {
      ws.close();
    }
    this.connections.clear();
    this.logger.info('Producer closed');
  }
}